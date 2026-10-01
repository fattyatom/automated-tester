import fs from 'node:fs';
import path from 'node:path';
import type { QaConfig } from '../config';
import { ProductModel, routeRegex } from '../knowledge/model';
import { TestPlan, planSummary } from './plan';

export interface DiscoveredPage {
  url: string;
  path: string;
  status: number;
  persona: string;
  title: string;
  forms: { action: string; method: string; fields: { label: string; name: string; type: string; required: boolean; maxLength?: number; pattern?: string }[] }[];
}

export function loadDiscovery(config: QaConfig): DiscoveredPage[] {
  const dir = path.join(config.workDir, 'discovered');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as DiscoveredPage[]);
}

const link = (title: string) => `[[${title}]]`;

/** Markdown gap report: what the vault doesn't tell us yet, and where to look first. */
export function coverageReport(model: ProductModel, plan: TestPlan, config: QaConfig): string {
  const { graph } = model;
  const out: string[] = ['# QA coverage & knowledge gaps', '', `_Generated ${new Date().toISOString()}_`, ''];
  const title = (id: string) => model.byId.get(id)?.title ?? id;

  out.push('## Plan', '', '| Charter | Count |', '|---|---|');
  for (const [k, v] of Object.entries(planSummary(plan))) out.push(`| ${k} | ${v} |`);

  out.push('', '## Risk hotspots (most connected notes — test these first)', '');
  for (const [id, deg] of graph.centrality().slice(0, 8)) out.push(`- ${link(title(id))} — ${deg} links`);

  const section = (heading: string, hint: string, rows: string[]) => {
    out.push('', `## ${heading}`, '', `> ${hint}`, '');
    out.push(...(rows.length ? rows : ['_None_ ✅']));
  };

  section(
    'Pages without acceptance criteria',
    'Nothing to verify against — ask the PO or run the `qa-cartographer` agent to propose ACs.',
    model.pages
      .filter((p) => !p.scenarios.length && !p.vagueCriteria.length)
      .map((p) => {
        const via = model.flows.find((f) => f.flow.includes(p.id) && f.scenarios.length);
        return `- ${link(p.title)} \`${p.route}\`${via ? ` — only exercised end-to-end via ${link(via.title)}` : ''}`;
      }),
  );
  section(
    'Criteria that are not executable (no Given/When/Then)',
    'Feed to the `qa-ac-normalizer` agent; it writes executable versions to the overlay without touching the vault.',
    model.features.flatMap((f) => f.vagueCriteria.map((c) => `- ${link(f.title)}: ${c}`)),
  );
  section(
    'Steps with no matching step definition',
    'Rephrase using `npm run qa -- steps`, or let the `qa-step-author` agent add a custom step to qa.config.ts.',
    plan.acceptance.flatMap((a) => a.unmatched.map((u) => `- ${link(a.feature.title)} › ${a.scenario.name}: \`${u}\``)),
  );
  section(
    'Auth assumed, not declared',
    'Pages with a route whose auth requirement could not be found in the vault or inherited through the graph.',
    model.pages.filter((p) => p.authReason.startsWith('assumed') && p.route !== config.auth.loginRoute).map((p) => `- ${link(p.title)} \`${p.route}\` — add \`auth: required\` or \`auth: public\``),
  );
  section(
    'Forms without validation rules',
    'Fields exist but no rules — field-validation charters will only run security payloads.',
    model.pages.flatMap((p) => p.fields.filter((f) => !f.required && f.maxLength == null && f.minLength == null && !f.pattern && f.min == null && f.max == null && f.type === 'text').map((f) => `- ${link(p.title)} › ${f.name}`)),
  );
  section(
    'Flow steps without a route',
    'Route-skipping and state checks need every step of a flow to have a `route:`.',
    model.flows.flatMap((fl) => fl.flow.filter((id) => !model.byId.get(id)?.route).map((id) => `- ${link(fl.title)} → ${link(title(id))}`)),
  );
  section('Broken links (notes referenced but missing)', 'Missing knowledge — something is referenced that nobody documented.', [...new Set(graph.unresolved.map((u) => `- ${link(title(u.from))} → \`[[${u.target}]]\``))]);
  section('Orphan notes', 'Not linked to anything — possibly stale, or missing links.', graph.orphans().map((id) => `- ${link(title(id))}`));

  const discovered = loadDiscovery(config);
  if (discovered.length) {
    const documented = model.pages.map((p) => routeRegex(p.route!));
    const undocumented = [...new Set(discovered.filter((d) => d.status < 400 && !documented.some((r) => r.test(d.path))).map((d) => d.path))];
    section('Live routes missing from the vault (from discovery crawl)', 'The app has these, the docs do not — undocumented behaviour is untested behaviour.', undocumented.map((p) => `- \`${p}\``));
    const undocumentedForms = discovered.flatMap((d) =>
      d.forms.filter(() => {
        const page = model.pages.find((p) => routeRegex(p.route!).test(d.path));
        return page && !page.fields.length;
      }).map((f) => `- \`${d.path}\` form → ${f.fields.map((x) => x.label || x.name).join(', ')}`),
    );
    section('Live forms whose fields are not documented', 'Ask the `qa-cartographer` agent to write field specs into the overlay.', [...new Set(undocumentedForms)]);
  }
  return out.join('\n') + '\n';
}
