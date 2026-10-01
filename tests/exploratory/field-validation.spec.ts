/**
 * Exploratory charter: "Does every field defend itself?"
 * For each documented field: boundary + negative values (as a user, then again with client-side
 * validation stripped to hit the server directly) and security payloads.
 * All other fields are filled with valid baseline data so only one variable changes per test.
 */
import { load, test } from '../../src/runtime';
import { personaHasRole } from '../../src/config';
import { walkFlow } from '../../src/explore/flow';
import { bypassClientValidation, fillBaseline, fillField, findField, findSubmit, submitAndObserve } from '../../src/explore/interact';
import { QA_MARKER } from '../../src/explore/session';

const { plan, model, config } = load();
const allowedPersona = (roles: string[]) => Object.entries(config.personas).find(([, p]) => personaHasRole(p, roles))?.[0];

const pages = [...new Set(plan.fieldCases.map((c) => c.page))];
for (const pageSpec of pages) {
  test.describe(`${pageSpec.title} fields`, () => {
    for (const c of plan.fieldCases.filter((x) => x.page === pageSpec)) {
      const shown = c.value.length > 40 ? `${c.value.slice(0, 37)}…(${c.value.length})` : c.value;
      test(`${c.field.name} [${c.mode}] ${c.expect}: ${c.reason} ${JSON.stringify(shown)}`, async ({ page, qa }) => {
        qa.forFeature(pageSpec);
        if (pageSpec.requiresAuth) await qa.login(allowedPersona(pageSpec.roles));
        if (c.via) await walkFlow(page, model, c.via.flow, c.via.index);
        else await page.goto(pageSpec.route!);
        if (c.mode === 'server') await bypassClientValidation(page);

        await fillBaseline(page, pageSpec.fields, c.field.name);
        const field = await findField(page, c.field.name);
        const held = await fillField(field, c.value, { forceOption: c.mode === 'server' });
        if (c.expect === 'reject' && c.mode === 'client' && held !== c.value) {
          test.info().annotations.push({ type: 'qa-note', description: `input constraint prevented the value (field holds ${held.length} chars)` });
          return;
        }

        const obs = await submitAndObserve(page, await findSubmit(page, pageSpec.submit, field), {
          successText: pageSpec.successText,
          errorText: config.explore.errorText,
          loginRoute: config.auth.loginRoute,
        });
        test.info().annotations.push({ type: 'qa-note', description: `${obs.outcome}: ${obs.reason}` });
        await qa.inspect();
        const base = { url: obs.url, detail: `Field "${c.field.name}" (${c.field.rules || c.field.type}) = ${JSON.stringify(shown)} → ${obs.reason}` };

        if (c.expect === 'reject' && obs.outcome === 'accepted') {
          qa.add({
            ...base,
            severity: 'high',
            category: 'validation',
            title: c.mode === 'server'
              ? `Server accepts invalid "${c.field.name}" when client validation is bypassed: ${c.reason}`
              : `Invalid "${c.field.name}" accepted: ${c.reason}`,
          });
        } else if (c.expect === 'reject' && obs.outcome === 'unknown') {
          qa.add({ ...base, severity: 'low', category: 'validation-feedback', title: `No clear feedback for invalid "${c.field.name}": ${c.reason}` });
        } else if (c.expect === 'accept' && obs.outcome === 'rejected') {
          qa.add({ ...base, severity: 'medium', category: 'validation', title: `Valid boundary value rejected for "${c.field.name}": ${c.reason}` });
        } else if (c.expect === 'safe' && c.value.includes('<')) {
          const html = await page.content();
          if (html.includes(c.value) && !qa.findings.some((f) => f.category === 'xss')) {
            qa.add({ ...base, severity: 'high', category: 'xss', title: `"${c.field.name}" payload is reflected without HTML escaping` });
          }
        }
        if (c.value.includes(QA_MARKER)) await page.waitForTimeout(250); // let any injected handler fire
      });
    }
  });
}
