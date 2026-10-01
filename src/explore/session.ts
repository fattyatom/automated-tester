import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { QaConfig, Persona, SEVERITY_ORDER, Severity, personaFor } from '../config';
import { Feature, routeRegex } from '../knowledge/model';
import { STACK_TRACE, fillField, findAction, findField } from './interact';

export interface Finding {
  severity: Severity;
  category: string;
  title: string;
  detail?: string;
  url?: string;
  /** Vault note the finding traces back to. */
  feature?: string;
  file?: string;
}

export const FINDING_ANNOTATION = 'qa-finding';
export const SOURCE_ANNOTATION = 'qa-source';
/** XSS payloads call alert(QA_MARKER) so we never confuse them with the app's own dialogs. */
export const QA_MARKER = 'qa-xss-7f3a';

export const sourceOf = (f: Feature) => JSON.stringify({ id: f.id, title: f.title, file: f.file });

export async function defaultLogin(page: Page, persona: Persona, config: QaConfig): Promise<void> {
  const { auth } = config;
  await page.goto(auth.loginRoute);
  await fillField(await findField(page, auth.usernameField), persona.username);
  await fillField(await findField(page, auth.passwordField), persona.password);
  await (await findAction(page, auth.submit)).click();
  await page.waitForURL((u) => !routeRegex(auth.loginRoute).test(u.pathname), { timeout: 10_000 }).catch(() => {
    throw new Error(`Login as ${persona.username} did not leave ${auth.loginRoute} — check qa.config.ts personas/auth`);
  });
}

/**
 * Per-test QA context: oracles that watch every page for errors, a findings log, persona
 * helpers, and teardown that fails the test when findings reach the configured severity.
 */
export class QaSession {
  readonly findings: Finding[] = [];
  private readonly contexts: BrowserContext[] = [];
  feature?: Feature;

  constructor(
    readonly page: Page,
    readonly browser: Browser,
    readonly testInfo: TestInfo,
    readonly config: QaConfig,
  ) {
    this.watch(page);
  }

  forFeature(feature: Feature): this {
    this.feature = feature;
    if (!this.testInfo.annotations.some((a) => a.type === SOURCE_ANNOTATION)) {
      this.testInfo.annotations.push({ type: SOURCE_ANNOTATION, description: sourceOf(feature) });
    }
    return this;
  }

  add(f: Finding): void {
    const full = { feature: this.feature?.title, file: this.feature?.file, ...f };
    if (this.findings.some((x) => x.title === full.title && x.url === full.url)) return;
    this.findings.push(full);
  }

  private readonly detachers: (() => void)[] = [];

  private listen<E extends string>(page: Page, event: E, handler: (arg: any) => unknown): void {
    (page as any).on(event, handler);
    this.detachers.push(() => (page as any).off(event, handler));
  }

  watch(page: Page): void {
    this.listen(page, 'pageerror', (err: Error) => this.add({ severity: 'medium', category: 'js-error', title: `Uncaught page error: ${err.message.split('\n')[0]}`, detail: err.stack, url: page.url() }));
    this.listen(page, 'console', (msg: import('@playwright/test').ConsoleMessage) => {
      if (msg.type() !== 'error' || /Failed to load resource/i.test(msg.text())) return;
      this.add({ severity: 'low', category: 'console-error', title: `Console error: ${msg.text().slice(0, 160)}`, url: page.url() });
    });
    this.listen(page, 'response', (res: import('@playwright/test').Response) => {
      const type = res.request().resourceType();
      if (res.status() >= 500 && ['document', 'xhr', 'fetch'].includes(type)) {
        this.add({ severity: 'high', category: 'server-error', title: `HTTP ${res.status()} from ${res.request().method()} ${new URL(res.url()).pathname}`, url: res.url() });
      }
    });
    this.listen(page, 'dialog', async (dialog: import('@playwright/test').Dialog) => {
      if (dialog.message().includes(QA_MARKER)) {
        this.add({ severity: 'critical', category: 'xss', title: 'Injected script executed (XSS)', detail: `alert("${dialog.message()}") fired`, url: page.url() });
        await dialog.dismiss().catch(() => {});
      } else {
        await dialog.accept().catch(() => {});
      }
    });
  }

  /** Content oracles that need the DOM: stack traces / DB errors leaking to the user. */
  async inspect(page: Page = this.page): Promise<void> {
    const text = await page.locator('body').innerText().catch(() => '');
    const m = text.match(STACK_TRACE);
    if (m) {
      this.add({ severity: 'high', category: 'info-disclosure', title: 'Stack trace / internal error exposed to user', detail: m[0], url: page.url() });
    }
  }

  async login(nameOrRole?: string, page: Page = this.page): Promise<Persona> {
    const [, persona] = personaFor(this.config, nameOrRole);
    await (this.config.auth.login ?? defaultLogin)(page, persona, this.config);
    return persona;
  }

  /** A brand-new, isolated browser session (no cookies/storage) that is still watched by the oracles. */
  async freshPage(): Promise<Page> {
    const ctx = await this.browser.newContext({ baseURL: this.config.baseURL });
    this.contexts.push(ctx);
    const page = await ctx.newPage();
    this.watch(page);
    return page;
  }

  async finish(): Promise<void> {
    this.detachers.forEach((d) => d());
    for (const f of this.findings) {
      this.testInfo.annotations.push({ type: FINDING_ANNOTATION, description: JSON.stringify(f) });
    }
    if (this.findings.length && !this.page.isClosed()) {
      const shot = await this.page.screenshot({ fullPage: true }).catch(() => undefined);
      if (shot) await this.testInfo.attach('finding-evidence', { body: shot, contentType: 'image/png' });
    }
    await Promise.all(this.contexts.map((c) => c.close().catch(() => {})));
    const threshold = SEVERITY_ORDER.indexOf(this.config.explore.failOn);
    const blocking = this.findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) >= threshold);
    if (blocking.length) {
      expect.soft(blocking, `QA findings at or above "${this.config.explore.failOn}":\n${blocking.map((f) => `  [${f.severity}] ${f.title}${f.url ? ` (${f.url})` : ''}`).join("\n")}`).toEqual([]);
    }
  }
}
