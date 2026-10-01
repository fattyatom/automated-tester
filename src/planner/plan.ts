import { QA_MARKER } from '../explore/session';
import { QaConfig, personaHasRole } from '../config';
import { CompiledStep, allSteps, compileStep } from '../ac/steps';
import { Feature, FieldSpec, ProductModel, Scenario, fillParams, hasParams } from '../knowledge/model';

export interface AcceptanceItem {
  feature: Feature;
  scenario: Scenario;
  steps: CompiledStep[];
  unmatched: string[];
}

export interface FieldCase {
  id: string;
  page: Feature;
  field: FieldSpec;
  value: string;
  /** reject: must be refused; accept: valid boundary that must pass; safe: payload must not break anything. */
  expect: 'reject' | 'accept' | 'safe';
  /** client: as a user would; server: client-side validation stripped first. */
  mode: 'client' | 'server';
  reason: string;
  /** If the page is step N of a flow, the flow to walk first. */
  via?: { flow: Feature; index: number };
}

export interface RouteSkipItem {
  flow: Feature;
  index: number;
  step: Feature;
  route: string;
}

export interface GuardItem {
  page: Feature;
  route: string;
  persona?: string;
}

export interface TamperItem {
  page: Feature;
  route: string;
  value: string;
}

export interface StateItem {
  flow: Feature;
  kind: 'reload-each-step' | 'double-submit' | 'back-then-resubmit' | 'session-loss-mid-flow';
}

export interface TestPlan {
  acceptance: AcceptanceItem[];
  routeSkips: RouteSkipItem[];
  authGuards: GuardItem[];
  roleGuards: GuardItem[];
  tampering: TamperItem[];
  fieldCases: FieldCase[];
  stateChecks: StateItem[];
}

const routeOf = (f: Feature) => (f.route && hasParams(f.route) ? fillParams(f.route, '1') : f.route);

function flowPosition(model: ProductModel, page: Feature): { flow: Feature; index: number } | undefined {
  for (const flow of model.flows) {
    const index = flow.flow.indexOf(page.id);
    if (index >= 0) return { flow, index };
  }
  return undefined;
}

export function fieldCases(page: Feature, f: FieldSpec, config: QaConfig): Omit<FieldCase, 'id' | 'page' | 'mode' | 'via'>[] {
  const out: Omit<FieldCase, 'id' | 'page' | 'mode' | 'via'>[] = [];
  const reject = (value: string, reason: string) => out.push({ field: f, value, expect: 'reject', reason });
  const accept = (value: string, reason: string) => out.push({ field: f, value, expect: 'accept', reason });
  const safe = (value: string, reason: string) => out.push({ field: f, value, expect: 'safe', reason });
  const isText = !['select', 'checkbox', 'radio', 'number', 'date'].includes(f.type);
  // Length probes must only break the length rule, so use characters the field otherwise accepts.
  const digits = f.type === 'tel' || /digit/i.test(f.rules) || /^\^?\\d/.test(f.pattern ?? '');
  const ch = digits ? '1' : 'x';

  if (f.required) {
    reject('', 'required field left empty');
    if (isText) reject('   ', 'required field filled with whitespace only');
  }
  if (f.maxLength != null) {
    reject(ch.repeat(f.maxLength + 1), `one over max length (${f.maxLength + 1} > ${f.maxLength})`);
    if (!f.pattern || digits) accept(ch.repeat(f.maxLength), `exactly max length (${f.maxLength})`);
  }
  if (f.minLength != null && f.minLength > 1) {
    reject(ch.repeat(f.minLength - 1), `one under min length (${f.minLength - 1} < ${f.minLength})`);
    if (f.minLength !== f.maxLength) accept(ch.repeat(f.minLength), `exactly min length (${f.minLength})`);
  }
  if (f.type === 'number') {
    reject('abc', 'non-numeric input');
    if (f.min != null) reject(String(f.min - 1), `below minimum (${f.min - 1} < ${f.min})`);
    if (f.max != null) reject(String(f.max + 1), `above maximum (${f.max + 1} > ${f.max})`);
    if (f.min != null) accept(String(f.min), `minimum boundary (${f.min})`);
  }
  if (f.type === 'email') {
    for (const v of ['plainaddress', 'user@', '@example.com', 'user@@example.com']) reject(v, `malformed email "${v}"`);
  }
  if (f.pattern) {
    reject('zz!!--', `does not match pattern ${f.pattern}`);
    const exact = f.pattern.match(/\\d\{(\d+)\}/);
    if (exact && f.maxLength == null) {
      reject('1'.repeat(Number(exact[1]) - 1), `one digit short for ${f.pattern}`);
      reject('1'.repeat(Number(exact[1]) + 1), `one digit too many for ${f.pattern}`);
    }
  }
  if (f.type === 'select' && f.options?.length) reject('QA-NOT-AN-OPTION', 'value outside the allowed options');
  if (config.explore.securityPayloads && isText && f.type !== 'password') {
    safe(`<script>alert('${QA_MARKER}')</script>`, 'script tag injection (stored/reflected XSS)');
    safe(`"><img src=x onerror=alert('${QA_MARKER}')>`, 'attribute-breaking XSS');
    safe(`' OR '1'='1' --`, 'SQL injection probe');
    safe('Zoë 🚀 ẞ 漢字 ‮evil', 'unicode / RTL override');
  }
  return out;
}

export function buildPlan(model: ProductModel, config: QaConfig): TestPlan {
  const defs = allSteps(config);
  const plan: TestPlan = { acceptance: [], routeSkips: [], authGuards: [], roleGuards: [], tampering: [], fieldCases: [], stateChecks: [] };

  for (const feature of model.features) {
    for (const scenario of feature.scenarios) {
      const steps = scenario.steps.map((s) => compileStep(s.text, s.keyword, defs));
      plan.acceptance.push({ feature, scenario, steps, unmatched: steps.filter((s) => !s.def).map((s) => `${s.keyword} ${s.text}`) });
    }
  }

  for (const flow of model.flows) {
    flow.flow.forEach((id, index) => {
      const step = model.byId.get(id);
      if (index === 0 || !step?.route || hasParams(step.route)) return;
      plan.routeSkips.push({ flow, index, step, route: step.route });
    });
    const steps = flow.flow.map((id) => model.byId.get(id));
    if (steps.every((s) => s?.route)) {
      plan.stateChecks.push({ flow, kind: 'reload-each-step' }, { flow, kind: 'session-loss-mid-flow' });
      if (steps.some((s) => s!.submit)) plan.stateChecks.push({ flow, kind: 'double-submit' }, { flow, kind: 'back-then-resubmit' });
    }
  }

  for (const page of model.pages) {
    const route = routeOf(page)!;
    if (page.route === config.auth.loginRoute) continue;
    if (page.requiresAuth) plan.authGuards.push({ page, route });
    if (page.roles.length) {
      for (const [name, persona] of Object.entries(config.personas)) {
        if (!personaHasRole(persona, page.roles)) plan.roleGuards.push({ page, route, persona: name });
      }
    }
    if (hasParams(page.route!)) {
      for (const value of config.explore.paramValues) plan.tampering.push({ page, route: fillParams(page.route!, encodeURIComponent(value)), value });
    }
  }

  for (const page of model.pages.filter((p) => p.fields.length && !hasParams(p.route!))) {
    const via = flowPosition(model, page);
    for (const f of page.fields) {
      for (const c of fieldCases(page, f, config)) {
        const modes: FieldCase['mode'][] = ['client'];
        if (c.expect === 'reject' && config.explore.serverSideBypass) modes.push('server');
        for (const mode of modes) {
          plan.fieldCases.push({ ...c, page, mode, via: via && via.index > 0 ? via : undefined, id: `${page.title} › ${f.name} › ${mode} › ${c.reason}` });
        }
      }
    }
  }
  return plan;
}

export function planSummary(plan: TestPlan): Record<string, number> {
  return {
    'acceptance scenarios': plan.acceptance.length,
    '  …with unmatched steps': plan.acceptance.filter((a) => a.unmatched.length).length,
    'route-skip probes': plan.routeSkips.length,
    'auth-guard probes': plan.authGuards.length,
    'role-guard probes': plan.roleGuards.length,
    'param-tampering probes': plan.tampering.length,
    'field validation cases': plan.fieldCases.length,
    'state-handling checks': plan.stateChecks.length,
  };
}
