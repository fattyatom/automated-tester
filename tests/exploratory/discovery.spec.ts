/**
 * Exploratory charter: "What's actually out there?"
 * Crawls the live app per persona, runs the oracles on every page, flags broken links and
 * unlabeled inputs, and saves what it found so `npm run qa -- analyze` can diff docs vs reality.
 */
import fs from 'node:fs';
import path from 'node:path';
import { load, test } from '../../src/runtime';
import type { DiscoveredPage } from '../../src/planner/coverage';

const { config, model } = load();
// Seed with documented routes too, so pages nobody links to still get visited.
const documented = model.pages.map((p) => p.route!).filter((r) => !/[:{]/.test(r));
const personas = ['anonymous', ...Object.keys(config.personas)];

for (const persona of personas) {
  test(`crawl as ${persona}`, async ({ page, qa }) => {
    test.setTimeout(180_000);
    if (persona !== 'anonymous') await qa.login(persona);
    const origin = new URL(config.baseURL).origin;
    const queue: { path: string; from?: string }[] = [{ path: '/' }];
    if (page.url().startsWith('http')) queue.push({ path: new URL(page.url()).pathname }); // post-login landing page
    queue.push(...documented.map((p) => ({ path: p })));
    const seen = new Set<string>();
    const pages: DiscoveredPage[] = [];

    while (queue.length && pages.length < config.explore.crawl.maxPages) {
      const { path: p, from } = queue.shift()!;
      if (seen.has(p) || config.explore.crawl.exclude.some((r) => r.test(p))) continue;
      seen.add(p);
      const res = await page.goto(p).catch(() => null);
      const status = res?.status() ?? 0;
      await qa.inspect();
      if (status >= 400 && status < 500 && from) {
        qa.add({ severity: 'medium', category: 'broken-link', title: `Link to ${p} returns HTTP ${status}`, detail: `Linked from ${from}`, url: `${origin}${p}` });
      }
      const info = await page.evaluate(() => {
        const labelOf = (el: Element) => {
          const e = el as HTMLInputElement;
          return (e.labels?.[0]?.innerText ?? e.getAttribute('aria-label') ?? '').replace(/\s*\*$/, '').trim();
        };
        return {
          title: document.title,
          links: [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
          forms: [...document.querySelectorAll('form')].map((f) => ({
            action: f.getAttribute('action') ?? '',
            method: (f.getAttribute('method') ?? 'get').toLowerCase(),
            fields: [...f.querySelectorAll('input, select, textarea')]
              .filter((el) => !['hidden', 'submit', 'button'].includes((el as HTMLInputElement).type))
              .map((el) => {
                const e = el as HTMLInputElement;
                return { label: labelOf(el), name: e.name, type: e.type || el.tagName.toLowerCase(), required: e.required, maxLength: e.maxLength > 0 ? e.maxLength : undefined, pattern: e.pattern || undefined, placeholder: e.placeholder };
              }),
          })),
        };
      });
      for (const f of info.forms) {
        for (const field of f.fields.filter((x) => !x.label)) {
          qa.add({ severity: 'low', category: 'accessibility', title: `Input "${field.name || field.placeholder || field.type}" on ${p} has no accessible label`, url: page.url() });
        }
      }
      const landed = new URL(page.url()).pathname;
      if (landed !== p && seen.has(landed)) continue; // redirected somewhere already recorded
      seen.add(landed);
      pages.push({ url: page.url(), path: landed, status, persona, title: info.title, forms: info.forms.filter((f) => f.fields.length) });
      for (const href of info.links) {
        const u = new URL(href);
        if (u.origin === origin && !seen.has(u.pathname)) queue.push({ path: u.pathname, from: p });
      }
    }

    const dir = path.join(config.workDir, 'discovered');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${persona}.json`), JSON.stringify(pages, null, 2));
    test.info().annotations.push({ type: 'qa-note', description: `crawled ${pages.length} pages` });
  });
}
