import type { Locator, Page } from '@playwright/test';
import type { FieldSpec } from '../knowledge/model';
import { routeRegex } from '../knowledge/model';

const pollUntil = async <T>(fn: () => Promise<T | undefined>, timeout: number): Promise<T | undefined> => {
  const deadline = Date.now() + timeout;
  do {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  return undefined;
};

/** Returns the first candidate that resolves to an element; candidates are ordered by precision. */
export async function firstMatch(candidates: Locator[], what: string, timeout = 5000): Promise<Locator> {
  const hit = await pollUntil(async () => {
    for (const c of candidates) if ((await c.count().catch(() => 0)) > 0) return c.first();
    return undefined;
  }, timeout);
  if (!hit) throw new Error(`Could not find ${what}`);
  return hit;
}

const cssString = (s: string) => s.replace(/["\\]/g, '\\$&');

export function fieldCandidates(scope: Page | Locator, name: string): Locator[] {
  const id = name.trim().toLowerCase().replace(/\s+/g, '-');
  return [
    scope.getByLabel(name, { exact: true }),
    scope.getByPlaceholder(name, { exact: true }),
    scope.locator(`[name="${cssString(name)}" i], [id="${cssString(id)}" i]`),
    scope.getByLabel(name),
    scope.getByPlaceholder(name),
    scope.getByTestId(name),
  ];
}

export function actionCandidates(scope: Page | Locator, name: string): Locator[] {
  return [
    scope.getByRole('button', { name, exact: true }),
    scope.getByRole('link', { name, exact: true }),
    scope.getByRole('button', { name }),
    scope.getByRole('link', { name }),
    scope.getByRole('menuitem', { name }),
    scope.getByRole('tab', { name }),
    scope.locator(`input[type=submit][value="${cssString(name)}" i]`),
    scope.getByText(name, { exact: true }),
    scope.getByTestId(name),
  ];
}

export const findField = (page: Page, name: string) => firstMatch(fieldCandidates(page, name), `field "${name}"`);
export const findAction = (page: Page, name: string) => firstMatch(actionCandidates(page, name), `button or link "${name}"`);

/** Fills inputs, textareas, selects and checkboxes uniformly. Returns what the element actually holds. */
export async function fillField(field: Locator, value: string, opts: { forceOption?: boolean } = {}): Promise<string> {
  const kind = await field.evaluate((el) => ({ tag: el.tagName.toLowerCase(), type: (el as HTMLInputElement).type }));
  if (kind.tag === 'select') {
    if (opts.forceOption) {
      // Server-side test: inject an option the UI would never offer.
      await field.evaluate((el, v) => {
        const s = el as HTMLSelectElement;
        if (![...s.options].some((o) => o.value === v)) s.add(new Option(v, v));
      }, value);
    }
    const option = await field.evaluate((el, v) => {
      const o = [...(el as HTMLSelectElement).options].find((x) => x.label.trim() === v || x.value === v);
      return o ? o.value : null;
    }, value);
    if (option === null) return field.inputValue(); // the UI cannot express this value
    await field.selectOption(option);
    return value;
  }
  if (kind.type === 'checkbox' || kind.type === 'radio') {
    const on = /^(true|yes|on|checked|1|x)$/i.test(value);
    await field.setChecked(on);
    return String(on);
  }
  await field.fill(value);
  return field.inputValue().catch(() => value);
}

/** Strips client-side constraints so the payload reaches the server untouched. */
export async function bypassClientValidation(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('form').forEach((f) => (f.noValidate = true));
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      ['required', 'maxlength', 'minlength', 'pattern', 'min', 'max', 'step'].forEach((a) => el.removeAttribute(a));
      const input = el as HTMLInputElement;
      if (['email', 'number', 'tel', 'url', 'date'].includes(input.type)) input.type = 'text';
    });
  });
}

export async function findSubmit(page: Page, name?: string, near?: Locator): Promise<Locator> {
  if (name) return findAction(page, name);
  const form = near ? near.locator('xpath=ancestor::form[1]') : page.locator('main form, form').first();
  return firstMatch(
    [form.locator('button[type=submit], input[type=submit]'), form.locator('button:not([type=button]):not([type=reset])')],
    'a submit button',
  );
}

/** A value that should satisfy the field spec — used to fill "everything else" around a mutated field. */
export function validValue(f: FieldSpec): string {
  if (f.example != null) return f.example;
  if (f.options?.length) return f.options[0];
  switch (f.type) {
    case 'email':
      return 'qa.tester@example.com';
    case 'number':
      return String(f.min ?? 1);
    case 'password':
      return 'Qa-Passw0rd!';
    case 'tel':
      return '0412345678';
    case 'date':
      return '2030-01-15';
    case 'checkbox':
      return 'true';
  }
  const base = 'QA Tester';
  if (f.minLength && base.length < f.minLength) return base.padEnd(f.minLength, 'x');
  if (f.maxLength && base.length > f.maxLength) return base.slice(0, f.maxLength);
  return base;
}

export async function fillBaseline(page: Page, fields: FieldSpec[], except?: string): Promise<void> {
  for (const f of fields) {
    if (f.name === except) continue;
    await fillField(await findField(page, f.name), validValue(f));
  }
}

export interface SubmitObservation {
  outcome: 'accepted' | 'rejected' | 'server-error' | 'unknown';
  reason: string;
  url: string;
}

const ERROR_SELECTORS = '[role=alert], [aria-invalid=true], .error, .errors, .invalid-feedback, .field-error, [class*="error" i]';

export async function visibleErrors(page: Page, errorText: RegExp): Promise<string[]> {
  const els = page.locator(ERROR_SELECTORS).filter({ visible: true });
  const texts = (await els.allInnerTexts().catch(() => [] as string[])).map((t) => t.trim()).filter(Boolean);
  const invalid = await page.locator('[aria-invalid=true]').filter({ visible: true }).count();
  return texts.filter((t) => errorText.test(t) || invalid > 0);
}

export async function submitAndObserve(
  page: Page,
  submit: Locator,
  opts: { successText?: string; errorText: RegExp; loginRoute: string },
): Promise<SubmitObservation> {
  const before = new URL(page.url()).pathname;
  let serverError: number | undefined;
  const onResponse = (r: import('@playwright/test').Response) => {
    if (r.status() >= 500 && ['document', 'xhr', 'fetch'].includes(r.request().resourceType())) serverError = r.status();
  };
  page.on('response', onResponse);
  const blockedByBrowser = await submit
    .evaluate((b) => {
      const f = (b as HTMLButtonElement).form;
      return f ? !f.noValidate && !f.checkValidity() : false;
    })
    .catch(() => false);
  await submit.click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  page.off('response', onResponse);

  const url = page.url();
  const after = new URL(url).pathname;
  if (serverError) return { outcome: 'server-error', reason: `HTTP ${serverError}`, url };
  if (blockedByBrowser) return { outcome: 'rejected', reason: 'browser constraint validation blocked submit', url };
  if (after !== before && routeRegex(opts.loginRoute).test(after)) {
    return { outcome: 'unknown', reason: 'redirected to login', url };
  }
  const errors = await visibleErrors(page, opts.errorText);
  if (errors.length) return { outcome: 'rejected', reason: `error shown: ${errors[0].slice(0, 120)}`, url };
  if (opts.successText && (await page.getByText(opts.successText).first().isVisible().catch(() => false))) {
    return { outcome: 'accepted', reason: `success text "${opts.successText}" visible`, url };
  }
  if (after !== before) return { outcome: 'accepted', reason: `navigated to ${after}`, url };
  return { outcome: 'unknown', reason: 'stayed on page with no visible feedback', url };
}

export const STACK_TRACE =
  /\bat [\w.$<>]+ \(.*:\d+:\d+\)|Traceback \(most recent call last\)|\bException in thread\b|SQLSTATE\[|ORA-\d{5}|Microsoft OLE DB|You have an error in your SQL syntax|Whitelabel Error Page|\bat [\w.]+\.java:\d+\)|node_modules\//;
