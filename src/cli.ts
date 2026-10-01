/**
 * qa — knowledge-graph CLI.
 *
 *   npm run qa -- analyze               build model + plan from the vault, write .qa/{model,plan}.json + coverage.md
 *   npm run qa -- feature <note>        everything the tool inferred about one note (route, auth, fields, ACs…)
 *   npm run qa -- graph <note> [-d N]   neighbourhood of a note
 *   npm run qa -- context <note> [-d N] full text of a note's neighbourhood (context pack for agents)
 *   npm run qa -- path <a> <b>          shortest link path between two notes
 *   npm run qa -- mermaid [note] [-d N] mermaid diagram of the vault (or a neighbourhood)
 *   npm run qa -- steps                 the step library — phrasing the ACs must use
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../qa.config';
import { allSteps } from './ac/steps';
import { Feature, loadModel } from './knowledge/model';
import { coverageReport } from './planner/coverage';
import { buildPlan, planSummary } from './planner/plan';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const flag = (name: string, def: number) => {
  const i = rest.findIndex((a) => a === `-${name}` || a === `--${name}`);
  if (i < 0) return def;
  const v = Number(rest[i + 1]);
  rest.splice(i, 2);
  return Number.isFinite(v) ? v : def;
};
const depth = flag('d', 1);
const args = rest;

const model = loadModel(config.vault, config.overlays);
const { graph } = model;

const need = (name: string | undefined, label = 'note'): string => {
  const id = name ? graph.resolve(name) : undefined;
  if (!id) {
    console.error(`Unknown ${label}: ${name ?? '(missing)'}. Known: ${[...graph.notes.values()].map((n) => n.title).join(', ')}`);
    process.exit(1);
  }
  return id;
};

const featureJson = (f: Feature) => ({ ...f, flow: f.flow.map((id) => model.byId.get(id)?.title ?? id) });

switch (cmd) {
  case 'analyze': {
    const plan = buildPlan(model, config);
    fs.mkdirSync(config.workDir, { recursive: true });
    fs.writeFileSync(path.join(config.workDir, 'model.json'), JSON.stringify(model.features.map(featureJson), null, 2));
    fs.writeFileSync(
      path.join(config.workDir, 'plan.json'),
      JSON.stringify(
        {
          summary: planSummary(plan),
          acceptance: plan.acceptance.map((a) => ({ feature: a.feature.title, scenario: a.scenario.name, steps: a.steps.map((s) => `${s.keyword} ${s.text}`), unmatched: a.unmatched })),
          routeSkips: plan.routeSkips.map((r) => ({ flow: r.flow.title, step: r.step.title, route: r.route })),
          authGuards: plan.authGuards.map((g) => g.route),
          roleGuards: plan.roleGuards.map((g) => ({ route: g.route, persona: g.persona })),
          tampering: plan.tampering.map((t) => t.route),
          fieldCases: plan.fieldCases.map((c) => c.id),
          stateChecks: plan.stateChecks.map((s) => `${s.flow.title}: ${s.kind}`),
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(config.workDir, 'coverage.md'), coverageReport(model, plan, config));
    console.log(`Vault: ${config.vault.join(', ')}  (${graph.notes.size} notes, ${graph.edges.length} links, ${graph.unresolved.length} unresolved)`);
    console.log(`Pages: ${model.pages.length}  Flows: ${model.flows.length}\n`);
    console.table(planSummary(plan));
    console.log(`\nWrote ${config.workDir}/model.json, plan.json, coverage.md`);
    break;
  }
  case 'feature': {
    const f = model.byId.get(need(args[0]))!;
    console.log(JSON.stringify(featureJson(f), null, 2));
    break;
  }
  case 'graph': {
    const id = need(args[0]);
    const n = graph.neighbors(id, depth);
    for (const [nid, d] of [...n].sort((a, b) => a[1] - b[1])) {
      const f = model.byId.get(nid)!;
      const out = graph.outgoing(nid).includes(id) ? '→ links here' : graph.incoming(nid).includes(id) ? '← linked from here' : '';
      console.log(`${'  '.repeat(d)}${f.title} [${f.type}]${f.route ? ` ${f.route}` : ''}${f.requiresAuth ? ' 🔒' : ''}${f.roles.length ? ` roles=${f.roles}` : ''} ${d === 1 ? out : ''}`);
    }
    break;
  }
  case 'context':
    console.log(graph.context(need(args[0]), depth));
    break;
  case 'path': {
    const p = graph.path(need(args[0]), need(args[1]));
    console.log(p ? p.map((id) => model.byId.get(id)!.title).join(' → ') : 'No path');
    break;
  }
  case 'mermaid':
    console.log(graph.toMermaid(args[0] ? graph.neighbors(need(args[0]), depth).keys() : undefined));
    break;
  case 'steps':
    for (const s of allSteps(config)) console.log(`- ${s.example}`);
    break;
  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, ''));
}
