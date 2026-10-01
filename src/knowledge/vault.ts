import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface Section {
  heading: string;
  level: number;
  /** Content until the next heading of the same or higher level (includes sub-headings). */
  content: string;
}

export interface Link {
  target: string;
  heading?: string;
  display?: string;
  embed: boolean;
  /** Frontmatter key or body section heading the link appeared in. */
  context: string;
}

export interface Note {
  /** Lower-cased basename — Obsidian resolves links by file name. */
  id: string;
  title: string;
  file: string;
  frontmatter: Record<string, unknown>;
  body: string;
  links: Link[];
  tags: string[];
  aliases: string[];
  sections: Section[];
}

const WIKILINK = /(!?)\[\[([^\]|#^]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const TAG = /(?:^|\s)#([A-Za-z][\w/-]*)/g;
const FENCE = /^(```|~~~)/;

export const noteKey = (name: string) => path.basename(name.trim(), '.md').toLowerCase();

function stripCode(text: string): string {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (FENCE.test(line.trim())) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line.replace(/`[^`]*`/g, '');
    })
    .join('\n');
}

function linksIn(text: string, context: string): Link[] {
  const out: Link[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    out.push({ embed: m[1] === '!', target: m[2].trim(), heading: m[3]?.trim(), display: m[4]?.trim(), context });
  }
  return out;
}

function frontmatterLinks(value: unknown, key: string): Link[] {
  if (typeof value === 'string') return linksIn(value, key);
  if (Array.isArray(value)) return value.flatMap((v) => frontmatterLinks(v, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => frontmatterLinks(v, `${key}.${k}`));
  }
  return [];
}

function parseSections(body: string): Section[] {
  const lines = body.split('\n');
  const heads: { level: number; heading: string; line: number }[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line.trim())) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) heads.push({ level: m[1].length, heading: m[2].trim(), line: i });
  });
  return heads.map((h, idx) => {
    const next = heads.slice(idx + 1).find((n) => n.level <= h.level);
    return {
      heading: h.heading,
      level: h.level,
      content: lines.slice(h.line + 1, next ? next.line : lines.length).join('\n').trim(),
    };
  });
}

export function parseNote(file: string, raw: string): Note {
  let frontmatter: Record<string, unknown> = {};
  let body = raw.replace(/^﻿/, '');
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (fm) {
    try {
      frontmatter = (YAML.parse(fm[1]) as Record<string, unknown>) ?? {};
    } catch (e) {
      frontmatter = { __parseError: String(e) };
    }
    body = body.slice(fm[0].length);
  }
  body = body.replace(/\r\n/g, '\n');
  const sections = parseSections(body);
  const codeless = stripCode(body);

  const links: Link[] = [];
  for (const [key, value] of Object.entries(frontmatter)) links.push(...frontmatterLinks(value, key));
  // Attribute body links to the innermost section they appear in.
  let current = '';
  for (const line of codeless.split('\n')) {
    const h = line.match(/^#{1,6}\s+(.+)/);
    if (h) current = h[1].trim();
    links.push(...linksIn(line, current));
  }

  const fmTags = ([] as unknown[]).concat(frontmatter.tags ?? []).map((t) => String(t).replace(/^#/, ''));
  const bodyTags = [...codeless.matchAll(TAG)].map((m) => m[1]);
  const aliases = ([] as unknown[]).concat(frontmatter.aliases ?? frontmatter.alias ?? []).map(String);
  const h1 = sections.find((s) => s.level === 1)?.heading;

  return {
    id: noteKey(file),
    title: String(frontmatter.title ?? h1 ?? path.basename(file, '.md')),
    file,
    frontmatter,
    body,
    links,
    tags: [...new Set([...fmTags, ...bodyTags].map((t) => t.toLowerCase()))],
    aliases,
    sections,
  };
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.') || e.name === 'node_modules') return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.toLowerCase().endsWith('.md') ? [full] : [];
  });
}

/**
 * Loads one or more vaults. Overlay notes (written by agents) with the same name as a vault
 * note are merged into it: frontmatter keys override, body is appended.
 */
export function loadVault(dirs: string[], overlays: string[] = []): Map<string, Note> {
  const notes = new Map<string, Note>();
  for (const file of dirs.flatMap(walk)) {
    const note = parseNote(file, fs.readFileSync(file, 'utf8'));
    notes.set(note.id, note);
  }
  for (const file of overlays.flatMap(walk)) {
    const overlay = parseNote(file, fs.readFileSync(file, 'utf8'));
    const base = notes.get(overlay.id);
    if (!base) {
      notes.set(overlay.id, overlay);
      continue;
    }
    const merged = { ...base.frontmatter, ...overlay.frontmatter };
    const raw = `---\n${YAML.stringify(merged)}---\n${base.body}\n\n${overlay.body}`;
    notes.set(base.id, { ...parseNote(base.file, raw), file: base.file });
  }
  return notes;
}
