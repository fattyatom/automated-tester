/**
 * Exploratory charter: "Can I get somewhere I shouldn't?"
 *  - route skipping: deep-link to step N of a flow without doing steps 1..N-1
 *  - auth guards: protected pages in an anonymous session
 *  - role guards: role-restricted pages as a persona without that role
 *  - param tampering: nonsense / hostile values in route params
 *  - unknown routes: soft-404s and error pages
 */
import type { Page } from '@playwright/test';
import { load, test } from '../../src/runtime';
import { personaHasRole } from '../../src/config';
import { pathOf } from '../../src/explore/flow';
import { routeRegex } from '../../src/knowledge/model';

const { plan, config } = load();

const guardVisible = (page: Page) => page.getByText(config.explore.guardText).first().isVisible().catch(() => false);
const allowedPersona = (roles: string[]) => Object.entries(config.personas).find(([, p]) => personaHasRole(p, roles))?.[0];

async function wasBlocked(page: Page, route: string, status: number): Promise<boolean> {
  return status === 401 || status === 403 || status === 404 || !routeRegex(route).test(pathOf(page)) || (await guardVisible(page));
}

test.describe('Route skipping', () => {
  for (const item of plan.routeSkips) {
    const before = item.flow.flow.slice(0, item.index);
    test(`${item.flow.title}: open step ${item.index + 1} "${item.step.title}" directly`, async ({ page, qa }) => {
      qa.forFeature(item.step);
      if (item.flow.requiresAuth || item.step.requiresAuth) await qa.login(allowedPersona(item.step.roles));
      const status = (await page.goto(item.route))?.status() ?? 0;
      await qa.inspect();
      if (status >= 500) return; // already recorded by the server-error oracle
      if (!(await wasBlocked(page, item.route, status))) {
        qa.add({
          severity: 'high',
          category: 'route-skip',
          title: `"${item.step.title}" is reachable without completing earlier steps of "${item.flow.title}"`,
          detail: `Opened ${item.route} in a fresh session and got HTTP ${status} with the page rendered. Skipped prerequisites: ${before.join(' → ')}.`,
          url: page.url(),
        });
      }
    });
  }
});

test.describe('Auth guards (anonymous)', () => {
  for (const item of plan.authGuards) {
    test(`${item.page.title} ${item.route} requires login`, async ({ page, qa }) => {
      qa.forFeature(item.page);
      const status = (await page.goto(item.route))?.status() ?? 0;
      await qa.inspect();
      if (status >= 500) return;
      const onLogin = routeRegex(config.auth.loginRoute).test(pathOf(page));
      if (!onLogin && !(await wasBlocked(page, item.route, status))) {
        qa.add({ severity: 'high', category: 'auth-bypass', title: `Protected page "${item.page.title}" is accessible without logging in`, detail: `Auth: ${item.page.authReason}. HTTP ${status}.`, url: page.url() });
      }
    });
  }
});

test.describe('Role guards', () => {
  for (const item of plan.roleGuards) {
    test(`${item.page.title} denies "${item.persona}" (needs ${item.page.roles.join('/')})`, async ({ page, qa }) => {
      qa.forFeature(item.page);
      await qa.login(item.persona);
      const status = (await page.goto(item.route))?.status() ?? 0;
      await qa.inspect();
      if (status >= 500) return;
      if (!(await wasBlocked(page, item.route, status))) {
        qa.add({ severity: 'high', category: 'authorization', title: `"${item.persona}" can open "${item.page.title}" which is restricted to ${item.page.roles.join('/')}`, detail: `HTTP ${status}.`, url: page.url() });
      }
    });
  }
});

test.describe('Route param tampering', () => {
  for (const item of plan.tampering) {
    test(`${item.page.title} with param ${JSON.stringify(item.value)}`, async ({ page, qa }) => {
      qa.forFeature(item.page);
      if (item.page.requiresAuth) await qa.login(allowedPersona(item.page.roles));
      await page.goto(item.route);
      await qa.inspect();
    });
  }
});

test('Unknown route returns a proper 404', async ({ page, qa }) => {
  const status = (await page.goto(`/qa-route-that-does-not-exist-${Date.now()}`))?.status() ?? 0;
  await qa.inspect();
  const looksNotFound = await page.getByText(config.explore.notFoundText).first().isVisible().catch(() => false);
  if (status !== 404 && status < 500) {
    qa.add({ severity: looksNotFound ? 'low' : 'medium', category: 'routing', title: `Unknown route answers HTTP ${status} instead of 404${looksNotFound ? ' (soft 404)' : ''}`, url: page.url() });
  }
});
