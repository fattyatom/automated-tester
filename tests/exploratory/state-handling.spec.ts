/**
 * Exploratory charter: "What happens when the user doesn't behave?"
 * Reloads mid-flow, double-clicks submit, goes back and resubmits, loses the session mid-flow.
 */
import type { Page, Request } from '@playwright/test';
import { load, test } from '../../src/runtime';
import { personaHasRole } from '../../src/config';
import { pathOf, walkFlow } from '../../src/explore/flow';
import { fillBaseline, findSubmit } from '../../src/explore/interact';
import { routeRegex } from '../../src/knowledge/model';

const { plan, model, config } = load();
const allowedPersona = (roles: string[]) => Object.entries(config.personas).find(([, p]) => personaHasRole(p, roles))?.[0];

function countSubmissions(page: Page): () => number {
  let n = 0;
  page.on('request', (r: Request) => {
    if (r.method() !== 'GET' && ['document', 'xhr', 'fetch'].includes(r.resourceType())) n++;
  });
  return () => n;
}

const settle = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
};

for (const item of plan.stateChecks) {
  const { flow } = item;
  const steps = flow.flow.map((id) => model.byId.get(id)!);
  // The last step that submits something "for real" (e.g. Place order).
  const commitIndex = steps.map((s, i) => (s.submit ? i : -1)).filter((i) => i >= 0 && i < steps.length - 1).pop() ?? -1;

  test(`${flow.title}: ${item.kind}`, async ({ page, qa }) => {
    qa.forFeature(flow);
    if (flow.requiresAuth) await qa.login(allowedPersona(flow.roles));

    switch (item.kind) {
      case 'reload-each-step':
        for (let i = 0; i < steps.length; i++) {
          await test.step(`reload on "${steps[i].title}"`, async () => {
            await walkFlow(page, model, flow, i);
            await page.reload();
            await settle(page);
            await qa.inspect();
            if (!routeRegex(steps[i].route!).test(pathOf(page))) {
              qa.add({ severity: 'medium', category: 'state', title: `Reloading "${steps[i].title}" loses flow progress`, detail: `Expected to stay on ${steps[i].route}, landed on ${pathOf(page)}`, url: page.url() });
            }
          });
        }
        break;

      case 'session-loss-mid-flow': {
        const mid = Math.min(1, steps.length - 2);
        await walkFlow(page, model, flow, mid);
        await page.context().clearCookies();
        await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* opaque origin */ } });
        await fillBaseline(page, steps[mid].fields);
        await (await findSubmit(page, steps[mid].submit)).click();
        await settle(page);
        await qa.inspect();
        const next = steps[mid + 1];
        if (next?.route && routeRegex(next.route).test(pathOf(page))) {
          qa.add({ severity: 'high', category: 'session', title: `"${flow.title}" continues after the session was cleared on "${steps[mid].title}"`, url: page.url() });
        } else if (!routeRegex(config.auth.loginRoute).test(pathOf(page)) && !(await page.getByText(config.explore.guardText).first().isVisible().catch(() => false))) {
          qa.add({ severity: 'low', category: 'session', title: `No clear "session expired" handling on "${steps[mid].title}"`, detail: `Landed on ${pathOf(page)} without a login redirect or message`, url: page.url() });
        }
        break;
      }

      case 'double-submit': {
        test.skip(commitIndex < 0, 'flow has no submitting step');
        await walkFlow(page, model, flow, commitIndex);
        const submissions = countSubmissions(page);
        // An impatient user: second click ~100ms after the first, while the request is in flight.
        // Done in-page because Playwright's click() waits for the pending navigation, and a
        // synthetic dblclick is collapsed into one submission by Chromium — both hide the bug.
        const button = await findSubmit(page, steps[commitIndex].submit);
        await button.evaluate((el: HTMLElement) => {
          el.click();
          setTimeout(() => el.isConnected && el.click(), 100);
        });
        await page.waitForTimeout(300);
        await settle(page);
        await qa.inspect();
        if (submissions() > 1) {
          qa.add({ severity: 'medium', category: 'double-submit', title: `Double-clicking "${steps[commitIndex].submit}" on "${steps[commitIndex].title}" sends ${submissions()} submissions`, detail: 'Button is not disabled after the first click and/or the server is not idempotent.', url: page.url() });
        }
        break;
      }

      case 'back-then-resubmit': {
        test.skip(commitIndex < 0, 'flow has no submitting step');
        await walkFlow(page, model, flow, commitIndex);
        await (await findSubmit(page, steps[commitIndex].submit)).click();
        await settle(page);
        const first = page.url();
        await page.goBack();
        await settle(page);
        const submit = await findSubmit(page, steps[commitIndex].submit).catch(() => undefined);
        if (!submit) break; // the app moved the user away — good
        await submit.click();
        await settle(page);
        await qa.inspect();
        const next = steps[commitIndex + 1];
        if (page.url() !== first && next?.route && routeRegex(next.route).test(pathOf(page))) {
          qa.add({ severity: 'medium', category: 'state', title: `Back + resubmit on "${steps[commitIndex].title}" completes "${flow.title}" a second time`, detail: `First result: ${first}\nSecond result: ${page.url()}`, url: page.url() });
        }
        break;
      }
    }
  });
}
