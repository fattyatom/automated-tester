import { Note } from './vault';

/**
 * Provenance frontmatter written by the knowledge-base agents (see docs/KNOWLEDGE_BASE.md):
 *
 *   source: [SHOP-142, "local:~/repos/shop-web/AGENTS.md"]   # catalog ids or local:<path>
 *   source_updated: 2026-09-30T08:12:44Z                    # newest `updated` among the sources
 *   synced_at: 2026-10-01T02:00:05Z                         # when an agent last wrote the note
 *   keywords: [payment, paypal, card]                        # lookup terms for impact analysis
 *
 * None of it changes what is tested; it powers `qa find` (impact analysis) and `qa stale`.
 */
export interface Provenance {
  sources: string[];
  sourceUpdated?: string;
  syncedAt?: string;
  keywords: string[];
}

const list = (v: unknown): string[] =>
  v == null ? [] : ([] as unknown[]).concat(v).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);

/** YAML may hand back a Date (YAML 1.1 timestamps) or a string; normalise to ISO. */
function iso(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function provenance(note: Note): Provenance {
  const fm = note.frontmatter;
  return {
    sources: list(fm.source ?? fm.sources),
    sourceUpdated: iso(fm.source_updated),
    syncedAt: iso(fm.synced_at),
    keywords: list(fm.keywords).map((k) => k.toLowerCase()),
  };
}

/** Notes that describe the vault or the tool rather than the product. */
const NOT_KNOWLEDGE = /^(guide|template|meta|readme|credentials)$/i;
const isKnowledge = (n: Note) => !NOT_KNOWLEDGE.test(String(n.frontmatter.type ?? ''));

export interface FindHit {
  id: string;
  title: string;
  file: string;
  score: number;
  /** Why the note matched, e.g. `keyword "paypal"`, `alias "checkout"`, `source SHOP-142`. */
  reasons: string[];
  sources: string[];
}

const WEIGHTS = { title: 100, source: 90, keyword: 80, alias: 70, tag: 60, partialName: 40, partialKeyword: 30, body: 5 };

/**
 * Ranks notes against one or more terms (keywords, entities, catalog ids) — the first step of a
 * sync's impact analysis. Exact name/source/keyword hits outrank partial ones; body mentions only
 * add a little so a passing reference doesn't drown out the note that owns the concept.
 */
export function findNotes(notes: Iterable<Note>, terms: string[]): FindHit[] {
  const wanted = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const hits: FindHit[] = [];
  for (const note of notes) {
    if (!isKnowledge(note)) continue;
    const p = provenance(note);
    const names = [note.title, note.id, ...note.aliases].map((s) => s.toLowerCase());
    const body = note.body.toLowerCase();
    let score = 0;
    const reasons: string[] = [];
    const add = (w: number, why: string) => {
      score += w;
      reasons.push(why);
    };
    for (const t of wanted) {
      if (t === note.title.toLowerCase() || t === note.id) add(WEIGHTS.title, `title "${t}"`);
      else if (note.aliases.some((a) => a.toLowerCase() === t)) add(WEIGHTS.alias, `alias "${t}"`);
      else if (names.some((n) => n.includes(t))) add(WEIGHTS.partialName, `name contains "${t}"`);
      if (p.sources.some((s) => s.toLowerCase() === t)) add(WEIGHTS.source, `source ${t.toUpperCase()}`);
      if (p.keywords.includes(t)) add(WEIGHTS.keyword, `keyword "${t}"`);
      else if (p.keywords.some((k) => k.includes(t) || (t.length > 3 && t.includes(k)))) add(WEIGHTS.partialKeyword, `keyword ~ "${t}"`);
      if (note.tags.includes(t)) add(WEIGHTS.tag, `tag #${t}`);
      const mentions = body.split(t).length - 1;
      if (mentions) add(Math.min(mentions, 4) * WEIGHTS.body, `"${t}" ${mentions}× in text`);
    }
    if (score) hits.push({ id: note.id, title: note.title, file: note.file, score, reasons, sources: p.sources });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export interface StaleEntry {
  id: string;
  title: string;
  file: string;
  sources: string[];
  sourceUpdated?: string;
  syncedAt?: string;
  /** Days since synced_at (undefined when never synced). */
  ageDays?: number;
  flags: ('no-provenance' | 'never-synced' | 'old-sync' | 'conflict')[];
}

/**
 * Freshness of every knowledge note, oldest first. It can't see the catalog, so "stale" here
 * means "not re-checked recently"; the kb-reviewer agent compares `source_updated` with the
 * catalog's `updated` to find notes that are actually behind.
 */
export function staleReport(notes: Iterable<Note>, now = new Date(), maxAgeDays = 30): StaleEntry[] {
  const out: StaleEntry[] = [];
  for (const note of notes) {
    if (!isKnowledge(note)) continue;
    const p = provenance(note);
    const flags: StaleEntry['flags'] = [];
    const synced = p.syncedAt ? new Date(p.syncedAt) : undefined;
    const ageDays = synced && !Number.isNaN(synced.getTime()) ? Math.floor((now.getTime() - synced.getTime()) / 86_400_000) : undefined;
    if (!p.sources.length) flags.push('no-provenance');
    if (ageDays === undefined) flags.push('never-synced');
    else if (ageDays > maxAgeDays) flags.push('old-sync');
    if (/\[!conflict\]/i.test(note.body)) flags.push('conflict');
    out.push({ id: note.id, title: note.title, file: note.file, sources: p.sources, sourceUpdated: p.sourceUpdated, syncedAt: p.syncedAt, ageDays, flags });
  }
  return out.sort((a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity) || a.title.localeCompare(b.title));
}
