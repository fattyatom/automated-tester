import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { MARKER, checkAdapters, loadCanonical, renderAdapters, writeAdapters } from '../../src/agents/sync';

test.describe('canonical agents → runtime adapters', () => {
  test('every runtime adapter is in sync with agents/ (run `npm run agents:sync` if this fails)', () => {
    expect(checkAdapters('.')).toEqual({ missing: [], changed: [], orphaned: [] });
  });

  test('the QA and knowledge-base agents and playbooks are all defined canonically', () => {
    const names = loadCanonical('.').map((c) => `${c.kind}:${c.name}`);
    for (const n of ['qa-cartographer', 'qa-ac-normalizer', 'qa-step-author', 'qa-explorer', 'qa-triager', 'kb-bootstrapper', 'kb-sync', 'kb-reviewer']) {
      expect(names).toContain(`agent:${n}`);
    }
    expect(names).toEqual(expect.arrayContaining(['playbook:qa-pipeline', 'playbook:kb-build']));
  });

  test('canonical text is runtime-neutral', () => {
    for (const c of loadCanonical('.')) {
      // Paths such as `.claude/agents/*` may appear as harvest sources; runtime vocabulary may not.
      expect(c.body, c.file).not.toMatch(/\bsub-?agents?\b/i);
      expect(c.body, c.file).not.toMatch(/\b(Bash|Glob|Grep|WebFetch|WebSearch|MultiEdit|TodoWrite)\b/);
    }
  });

  test('capabilities map to each runtime; catalog agents get every tool', () => {
    const root = test.info().outputPath('agents-repo');
    fs.mkdirSync(path.join(root, 'agents', 'playbooks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents', 'reader.md'), '---\nname: reader\ndescription: Reads.\ntools: [read, search, shell]\n---\nRead things.\n');
    fs.writeFileSync(path.join(root, 'agents', 'syncer.md'), '---\nname: syncer\ndescription: Syncs.\ntools: [read, edit, catalog]\n---\nSync things.\n');
    fs.writeFileSync(path.join(root, 'agents', 'playbooks', 'flow.md'), '---\nname: flow\ndescription: Does a flow.\n---\nStep 1.\n');
    const out = renderAdapters(loadCanonical(root));
    const fm = (rel: string) => YAML.parse(out.get(rel)!.split('---')[1]);

    expect(fm('.claude/agents/reader.md')).toEqual({ name: 'reader', description: 'Reads.', tools: 'Read, Glob, Grep, Bash' });
    expect(fm('.github/agents/reader.agent.md')).toEqual({ name: 'reader', description: 'Reads.', tools: ['read', 'search', 'execute'] });
    expect(fm('.opencode/agents/reader.md')).toEqual({ description: 'Reads.', mode: 'subagent', permission: { edit: 'deny', bash: 'allow', webfetch: 'deny' } });
    expect(fm('.claude/agents/syncer.md').tools).toBeUndefined();
    expect(fm('.github/agents/syncer.agent.md').tools).toBeUndefined();
    expect(fm('.claude/skills/flow/SKILL.md')).toEqual({ name: 'flow', description: 'Does a flow.' });
    expect(fm('.github/prompts/flow.prompt.md')).toMatchObject({ description: 'Does a flow.', agent: 'agent' });
    expect(fm('.opencode/commands/flow.md')).toEqual({ description: 'Does a flow.' });
    expect(out.get('.claude/agents/reader.md')).toContain(`${MARKER} from agents/reader.md`);
    expect(out.get('.claude/agents/reader.md')!.trimEnd().endsWith('Read things.')).toBe(true);

    // Writing then checking is clean; a hand edit, a removed canonical and a stray generated file are caught.
    writeAdapters(root);
    expect(checkAdapters(root)).toEqual({ missing: [], changed: [], orphaned: [] });
    fs.appendFileSync(path.join(root, '.github/agents/reader.agent.md'), 'edited by hand\n');
    fs.rmSync(path.join(root, 'agents', 'syncer.md'));
    fs.writeFileSync(path.join(root, '.opencode/agents/handwritten.md'), '---\ndescription: mine\n---\nNot generated.\n');
    expect(checkAdapters(root)).toEqual({
      missing: [],
      changed: ['.github/agents/reader.agent.md'],
      orphaned: ['.claude/agents/syncer.md', '.github/agents/syncer.agent.md', '.opencode/agents/syncer.md'],
    });
    writeAdapters(root);
    expect(fs.existsSync(path.join(root, '.claude/agents/syncer.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.opencode/agents/handwritten.md'))).toBe(true);
  });

  test('canonical files must name a known capability and match their file name', () => {
    const root = test.info().outputPath('bad-agents');
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents', 'x.md'), '---\nname: x\ndescription: X.\ntools: [Bash]\n---\nx\n');
    expect(() => loadCanonical(root)).toThrow(/unknown tools Bash/);
    fs.writeFileSync(path.join(root, 'agents', 'x.md'), '---\nname: y\ndescription: X.\n---\nx\n');
    expect(() => loadCanonical(root)).toThrow(/must match the file name/);
  });
});
