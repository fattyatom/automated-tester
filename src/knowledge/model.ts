import { KnowledgeGraph } from './graph';
import { Note, loadVault } from './vault';
import { credentialScenarios, parseCredentials } from './credentials';

export interface FieldSpec {
  name: string;
  type: string;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: string[];
  example?: string;
  rules: string;
}

export interface Step {
  keyword: string;
  text: string;
}

export interface Scenario {
  id: string;
  name: string;
  steps: Step[];
  tags: string[];
}

export interface Feature {
  id: string;
  title: string;
  file: string;
  type: string;
  route?: string;
  requiresAuth: boolean;
  /** Why we believe auth is (or isn't) required — explicit, inherited via graph, or assumed. */
  authReason: string;
  roles: string[];
  fields: FieldSpec[];
  submit?: string;
  successText?: string;
  scenarios: Scenario[];
  /** Criteria that are not written as Given/When/Then — candidates for the ac-normalizer agent. */
  vagueCriteria: string[];
  /** For flows: ordered feature ids. */
  flow: string[];
  tags: string[];
}

export interface ProductModel {
  graph: KnowledgeGraph;
  features: Feature[];
  byId: Map<string, Feature>;
  pages: Feature[];
  flows: Feature[];
}

const AC_HEADING = /acceptance|criteria|scenarios?|\bacs?\b|behaviou?rs?|requirements/i;
const FIELD_HEADING = /fields|inputs|form|validation/i;
const FLOW_HEADING = /flow|journey|steps|sequence/i;
const STEP_KW = /^(given|when|then|and|but|\*)\s+(.+)$/i;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const truthy = (v: unknown) => /^(y|yes|true|required|mandatory|✓|✔|x)$/i.test(String(v ?? '').trim());
const toList = (v: unknown): string[] =>
  v == null ? [] : ([] as unknown[]).concat(v).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Acceptance criteria
// ---------------------------------------------------------------------------------------------

function splitInline(text: string): Step[] | undefined {
  if (!/\bwhen\b[\s\S]*\bthen\b/i.test(text)) return undefined;
  return text
    .split(/,?\s+(?=\b(?:given|when|then)\b\s)|,\s+(?=and\s)/i)
    .map((part) => part.trim().replace(/[.;]$/, ''))
    .map((part) => {
      const m = part.match(STEP_KW);
      return m ? { keyword: cap(m[1]), text: m[2] } : { keyword: 'Given', text: part };
    });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function parseCriteria(content: string, featureId: string): { scenarios: Scenario[]; vague: string[] } {
  const scenarios: Scenario[] = [];
  const vague: string[] = [];
  let current: Scenario | undefined;
  let examples: { header?: string[]; rows: string[][] } | undefined;
  let outline: Scenario | undefined;
  let pendingTags: string[] = [];

  const finishOutline = () => {
    if (!outline || !examples?.header) return;
    const idx = scenarios.indexOf(outline);
    const expanded = examples.rows.map((row, i) => {
      const sub = (s: string) => s.replace(/<([^>]+)>/g, (_, k) => row[examples!.header!.indexOf(k.trim())] ?? `<${k}>`);
      return { ...outline!, id: `${outline!.id}-${i + 1}`, name: `${outline!.name} [${row.join(', ')}]`, steps: outline!.steps.map((s) => ({ ...s, text: sub(s.text) })) };
    });
    scenarios.splice(idx, 1, ...expanded);
    outline = undefined;
    examples = undefined;
  };

  const start = (name: string) => {
    finishOutline();
    current = { id: `${featureId}::${slug(name) || scenarios.length + 1}`, name, steps: [], tags: pendingTags };
    pendingTags = [];
    scenarios.push(current);
    return current;
  };

  for (const rawLine of content.split('\n')) {
    let line = rawLine.trim();
    if (!line || FENCE_ONLY.test(line) || /^#{1,6}\s*$/.test(line)) continue;
    line = line.replace(/^#{1,6}\s+/, '').replace(BULLET, '').trim();
    if (/^Feature:/i.test(line) || /^Background:/i.test(line)) continue;

    if (/^@\S/.test(line)) {
      pendingTags = line.split(/\s+/).map((t) => t.replace(/^@/, ''));
      continue;
    }
    if (examples && line.startsWith('|')) {
      const cells = splitRow(line);
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!examples.header) examples.header = cells;
      else examples.rows.push(cells);
      continue;
    }
    if (/^Examples:/i.test(line)) {
      examples = { rows: [] };
      outline = current;
      continue;
    }
    const sc = line.match(/^(?:Scenario(?: Outline| Template)?|Example|AC[\s-]?\d*|Rule)\s*:\s*(.*)$/i);
    if (sc) {
      start(sc[1] || `${featureId} scenario ${scenarios.length + 1}`);
      continue;
    }
    const inline = /^given\b/i.test(line) || !STEP_KW.test(line) ? splitInline(line) : undefined;
    if (inline) {
      start(line.length > 80 ? `${line.slice(0, 77)}...` : line).steps.push(...inline);
      current = undefined;
      continue;
    }
    const step = line.match(STEP_KW);
    if (step) {
      const target = current ?? start(`${featureId} criterion ${scenarios.length + 1}`);
      target.steps.push({ keyword: cap(step[1]), text: step[2].replace(/\.$/, '') });
      continue;
    }
    if (line.startsWith('|')) continue;
    vague.push(line);
    current = undefined;
  }
  finishOutline();
  return { scenarios: scenarios.filter((s) => s.steps.length), vague };
}
const FENCE_ONLY = /^(```|~~~)\s*\w*$/;

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

export function applyRules(field: FieldSpec, text: string): FieldSpec {
  const t = text;
  const numeric = field.type === 'number';
  if (/\b(required|mandatory)\b/i.test(t) && !/\bnot required\b/i.test(t)) field.required = true;
  if (/\boptional\b/i.test(t)) field.required = false;
  if (/\bemail\b/i.test(t) && field.type === 'text') field.type = 'email';

  const range = t.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(chars?|characters|digits|letters)?/i);
  if (range && !/pattern|regex/i.test(t)) {
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    if (numeric && !range[3]) [field.min, field.max] = [lo, hi];
    else [field.minLength, field.maxLength] = [lo, hi];
    if (/digit/i.test(range[3] ?? '')) field.pattern ??= `^\\d{${lo},${hi}}$`;
  }
  const max = t.match(/(?:max(?:imum)?(?:\s*length)?|<=|≤|up to|at most|no more than)\s*:?\s*(\d+)/i);
  if (max) numeric ? (field.max = Number(max[1])) : (field.maxLength = Number(max[1]));
  const min = t.match(/(?:min(?:imum)?(?:\s*length)?|>=|≥|at least|no less than)\s*:?\s*(\d+)/i);
  if (min) numeric ? (field.min = Number(min[1])) : (field.minLength = Number(min[1]));
  const exact = t.match(/exactly\s+(\d+)\s*(digits|chars?|characters)/i) ?? t.match(/^\s*(\d+)\s+(digits)\b/i);
  if (exact) {
    field.minLength = field.maxLength = Number(exact[1]);
    if (/digit/i.test(exact[2])) field.pattern ??= `^\\d{${exact[1]}}$`;
  }
  const pattern = t.match(/(?:pattern|regex|format)\s*:?\s*`([^`]+)`/i) ?? t.match(/(?:pattern|regex)\s*:?\s*\/(.+)\//i);
  if (pattern) field.pattern = pattern[1];
  const options = t.match(/(?:options?|one of|values?)\s*:?\s*(.+)$/i);
  if (options) field.options = options[1].split(/\s*[,/]\s*/).map((s) => s.replace(/[`"']/g, '').trim()).filter(Boolean);
  return field;
}

function fieldFromObject(o: Record<string, unknown>): FieldSpec {
  const name = String(o.name ?? o.label ?? o.field ?? '');
  const rules = String(o.rules ?? o.validation ?? o.constraints ?? '');
  const f: FieldSpec = {
    name,
    type: String(o.type ?? 'text').toLowerCase(),
    required: truthy(o.required),
    example: o.example != null ? String(o.example) : undefined,
    rules,
  };
  for (const k of ['minLength', 'maxLength', 'min', 'max'] as const) if (o[k] != null) f[k] = Number(o[k]);
  if (o.pattern) f.pattern = String(o.pattern);
  if (o.options) f.options = toList(o.options);
  return applyRules(f, rules);
}

/** Splits a markdown table row, honouring `\|` escapes (needed for regexes in Obsidian tables). */
const splitRow = (line: string) =>
  line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|'));

export function parseFieldTable(content: string): FieldSpec[] {
  const rows = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
    .map(splitRow)
    .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c)));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = {
    name: col(/^(field|name|label|input)/),
    type: col(/^type/),
    required: col(/^(required|mandatory)/),
    rules: col(/rules|validation|constraints/),
    example: col(/example|valid|sample/),
  };
  if (c.name < 0) return [];
  return rows.slice(1).map((r) =>
    fieldFromObject({
      name: r[c.name].replace(/\*\*/g, ''),
      type: c.type >= 0 ? r[c.type] || 'text' : 'text',
      required: c.required >= 0 ? r[c.required] : undefined,
      rules: c.rules >= 0 ? r[c.rules] : '',
      example: c.example >= 0 && r[c.example] ? r[c.example].replace(/^`|`$/g, '') : undefined,
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

function inferType(note: Note): string {
  if (note.frontmatter.type) return String(note.frontmatter.type).toLowerCase();
  if (note.frontmatter.flow || note.sections.some((s) => FLOW_HEADING.test(s.heading) && /\[\[/.test(s.content))) return 'flow';
  if (note.frontmatter.route) return 'page';
  return 'concept';
}

function extractFlow(note: Note, graph: KnowledgeGraph): string[] {
  const fromFm = toList(note.frontmatter.flow).map((x) => graph.resolve(x)).filter(Boolean) as string[];
  if (fromFm.length) return fromFm;
  const section = note.sections.find((s) => FLOW_HEADING.test(s.heading) && /\[\[/.test(s.content));
  if (!section) return [];
  return section.content
    .split('\n')
    .filter((l) => BULLET.test(l))
    .map((l) => l.match(/\[\[([^\]|#]+)/)?.[1])
    .map((t) => (t ? graph.resolve(t) : undefined))
    .filter(Boolean) as string[];
}

function authDeclared(note: Note, graph: KnowledgeGraph): boolean | undefined {
  const auth = note.frontmatter.auth;
  if (auth != null) return !/^(false|no|none|public|anonymous)$/i.test(String(auth));
  if (note.tags.includes('public')) return false;
  if (note.tags.some((t) => /^(auth|auth-required|authenticated|protected)$/.test(t))) return true;
  const requires = toList(note.frontmatter.requires).map((r) => graph.get(r));
  if (requires.some((r) => r && (String(r.frontmatter.type).toLowerCase() === 'auth' || r.id === 'login'))) return true;
  return undefined;
}

export function buildModel(notes: Map<string, Note>): ProductModel {
  const graph = new KnowledgeGraph(notes);
  const features: Feature[] = [];

  for (const note of notes.values()) {
    const scenarios: Scenario[] = [];
    const vague: string[] = [];
    // Guides and templates contain example criteria that must never run.
    const documentation = /^(guide|template|meta|readme)$/i.test(String(note.frontmatter.type ?? ''));
    for (const s of documentation ? [] : note.sections.filter((s) => AC_HEADING.test(s.heading))) {
      // Skip nested sub-sections already covered by a parent AC section.
      const parent = note.sections.find((p) => p !== s && p.level < s.level && AC_HEADING.test(p.heading) && p.content.includes(s.content));
      if (parent) continue;
      const named = /^(scenario|example)/i.test(s.heading) ? `${s.heading}\n` : '';
      const parsed = parseCriteria(named + s.content, note.id);
      scenarios.push(...parsed.scenarios);
      vague.push(...parsed.vague);
    }
    if (String(note.frontmatter.type).toLowerCase() === 'credentials') {
      scenarios.push(...credentialScenarios(parseCredentials(note.frontmatter, note.file), note.id));
    }
    let fields: FieldSpec[] = [];
    if (Array.isArray(note.frontmatter.fields)) {
      fields = note.frontmatter.fields.map((f) => (typeof f === 'string' ? applyRules({ name: f, type: 'text', required: false, rules: '' }, '') : fieldFromObject(f as Record<string, unknown>)));
    } else {
      const s = note.sections.find((s) => FIELD_HEADING.test(s.heading) && s.content.includes('|'));
      if (s) fields = parseFieldTable(s.content);
    }
    const roles = toList(note.frontmatter.roles ?? note.frontmatter.role).map((r) => {
      const n = graph.get(r);
      return (n?.frontmatter.role ? String(n.frontmatter.role) : n?.title ?? r.replace(/^\[\[|\]\]$/g, '')).toLowerCase();
    });
    const fm = note.frontmatter;
    features.push({
      id: note.id,
      title: note.title,
      file: note.file,
      type: inferType(note),
      route: fm.route ? String(fm.route) : undefined,
      requiresAuth: false,
      authReason: '',
      roles,
      fields,
      submit: fm.submit ? String(fm.submit) : undefined,
      successText: fm.success ? String(fm.success) : undefined,
      scenarios,
      vagueCriteria: vague,
      flow: extractFlow(note, graph),
      tags: note.tags,
    });
  }

  // The login page's route lives in credentials.md; an `auth` note without its own route inherits it.
  const credsNote = [...notes.values()].find((n) => String(n.frontmatter.type).toLowerCase() === 'credentials');
  if (credsNote) {
    const loginRoute = parseCredentials(credsNote.frontmatter, credsNote.file).login.route;
    for (const f of features) if (f.type === 'auth' && !f.route) f.route = loginRoute;
  }

  const byId = new Map(features.map((f) => [f.id, f]));

  // Auth & roles: explicit declaration wins; otherwise inherit through the graph from flows that
  // include the page, or from a `parent` / `part-of` note.
  const declared = new Map(features.map((f) => [f.id, authDeclared(notes.get(f.id)!, graph)]));
  const flowsOf = (id: string) => features.filter((f) => f.flow.includes(id));
  for (const f of features) {
    const own = declared.get(f.id);
    if (own !== undefined) {
      f.requiresAuth = own;
      f.authReason = 'declared';
      continue;
    }
    const parents = [
      ...flowsOf(f.id).map((p) => p.id),
      ...toList(notes.get(f.id)!.frontmatter.parent ?? notes.get(f.id)!.frontmatter['part-of']).map((p) => graph.resolve(p)),
    ].filter(Boolean) as string[];
    const authParent = parents.find((p) => declared.get(p) === true);
    if (authParent) {
      f.requiresAuth = true;
      f.authReason = `inherited from [[${byId.get(authParent)!.title}]]`;
    } else {
      f.authReason = 'assumed public (not declared)';
    }
    if (!f.roles.length) {
      const roleParent = parents.map((p) => byId.get(p)!).find((p) => p.roles.length);
      if (roleParent) f.roles = [...roleParent.roles];
    }
  }

  return {
    graph,
    features,
    byId,
    pages: features.filter((f) => f.route && f.type !== 'credentials'),
    flows: features.filter((f) => f.flow.length > 1),
  };
}

export function loadModel(vault: string[], overlays: string[] = []): ProductModel {
  return buildModel(loadVault(vault, overlays));
}

/** Converts `/orders/:id` or `/orders/{id}` to a matcher. */
export function routeRegex(route: string): RegExp {
  const esc = route
    .replace(/[.+?^$()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_]\w*|\{[^}]+\}/g, '[^/]+')
    .replace(/\*/g, '.*');
  return new RegExp(`^${esc}/?$`);
}

export const hasParams = (route: string) => /:[A-Za-z_]|\{[^}]+\}/.test(route);
export const fillParams = (route: string, value: string) => route.replace(/:[A-Za-z_]\w*|\{[^}]+\}/g, value);
