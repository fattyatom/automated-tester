import { Note, noteKey } from './vault';
import { maskFrontmatter, redact, secretValues } from './credentials';

export interface Edge {
  from: string;
  to: string;
  context: string;
}

/** Directed link graph over vault notes, with alias-aware resolution. */
export class KnowledgeGraph {
  readonly notes: Map<string, Note>;
  readonly edges: Edge[] = [];
  readonly unresolved: { from: string; target: string }[] = [];
  private readonly index = new Map<string, string>();
  private readonly out = new Map<string, Set<string>>();
  private readonly inc = new Map<string, Set<string>>();

  constructor(notes: Map<string, Note>) {
    this.notes = notes;
    for (const n of notes.values()) {
      this.index.set(n.id, n.id);
      this.index.set(n.title.toLowerCase(), n.id);
      for (const a of n.aliases) this.index.set(a.toLowerCase(), n.id);
      this.out.set(n.id, new Set());
      this.inc.set(n.id, new Set());
    }
    for (const n of notes.values()) {
      for (const link of n.links) {
        const to = this.resolve(link.target);
        if (!to) {
          this.unresolved.push({ from: n.id, target: link.target });
          continue;
        }
        if (to === n.id) continue;
        this.edges.push({ from: n.id, to, context: link.context });
        this.out.get(n.id)!.add(to);
        this.inc.get(to)!.add(n.id);
      }
    }
  }

  resolve(name: string): string | undefined {
    const clean = name.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    return this.index.get(clean.toLowerCase()) ?? this.index.get(noteKey(clean));
  }

  get(name: string): Note | undefined {
    const id = this.resolve(name);
    return id ? this.notes.get(id) : undefined;
  }

  outgoing(id: string): string[] {
    return [...(this.out.get(id) ?? [])];
  }

  incoming(id: string): string[] {
    return [...(this.inc.get(id) ?? [])];
  }

  /** BFS neighbourhood: id -> distance. */
  neighbors(id: string, depth = 1, dir: 'out' | 'in' | 'both' = 'both'): Map<string, number> {
    const seen = new Map<string, number>([[id, 0]]);
    let frontier = [id];
    for (let d = 1; d <= depth; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        const adj = [
          ...(dir !== 'in' ? this.outgoing(cur) : []),
          ...(dir !== 'out' ? this.incoming(cur) : []),
        ];
        for (const a of adj) {
          if (seen.has(a)) continue;
          seen.set(a, d);
          next.push(a);
        }
      }
      frontier = next;
    }
    return seen;
  }

  /** Shortest undirected path between two notes. */
  path(a: string, b: string): string[] | undefined {
    const from = this.resolve(a);
    const to = this.resolve(b);
    if (!from || !to) return undefined;
    const prev = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) break;
      for (const n of [...this.outgoing(cur), ...this.incoming(cur)]) {
        if (prev.has(n)) continue;
        prev.set(n, cur);
        queue.push(n);
      }
    }
    if (!prev.has(to)) return undefined;
    const out: string[] = [];
    for (let c: string | null = to; c; c = prev.get(c) ?? null) out.unshift(c);
    return out;
  }

  orphans(): string[] {
    return [...this.notes.keys()].filter((id) => !this.out.get(id)!.size && !this.inc.get(id)!.size);
  }

  components(): string[][] {
    const seen = new Set<string>();
    const comps: string[][] = [];
    for (const id of this.notes.keys()) {
      if (seen.has(id)) continue;
      const comp = [...this.neighbors(id, Infinity).keys()];
      comp.forEach((c) => seen.add(c));
      comps.push(comp);
    }
    return comps.sort((x, y) => y.length - x.length);
  }

  /** Degree centrality — heavily linked notes are where regressions hurt most. */
  centrality(): [string, number][] {
    return [...this.notes.keys()]
      .map((id): [string, number] => [id, this.out.get(id)!.size + this.inc.get(id)!.size])
      .sort((a, b) => b[1] - a[1]);
  }

  /**
   * Concatenated content of a note's neighbourhood, nearest first — context pack for agents.
   * Secrets (password/token keys in any note, e.g. credentials.md) are masked everywhere.
   */
  context(name: string, depth = 1): string {
    const id = this.resolve(name);
    if (!id) throw new Error(`Note not found: ${name}`);
    const secrets = [...this.notes.values()].flatMap((n) => secretValues(n.frontmatter));
    return redact(this.rawContext(id, depth), secrets);
  }

  private rawContext(id: string, depth: number): string {
    return [...this.neighbors(id, depth)]
      .sort((a, b) => a[1] - b[1])
      .map(([nid, d]) => {
        const n = this.notes.get(nid)!;
        const fm = Object.keys(n.frontmatter).length ? `\nfrontmatter: ${JSON.stringify(maskFrontmatter(n.frontmatter))}` : '';
        return `<note id="${nid}" title="${n.title}" distance="${d}" file="${n.file}">${fm}\n${n.body.trim()}\n</note>`;
      })
      .join('\n\n');
  }

  toMermaid(ids?: Iterable<string>): string {
    const keep = new Set(ids ?? this.notes.keys());
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_');
    const lines = ['graph LR'];
    for (const id of keep) lines.push(`  ${safe(id)}["${this.notes.get(id)?.title ?? id}"]`);
    for (const e of this.edges) {
      if (keep.has(e.from) && keep.has(e.to)) lines.push(`  ${safe(e.from)} --> ${safe(e.to)}`);
    }
    return lines.join('\n');
  }
}
