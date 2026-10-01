import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../../src/knowledge/model';
import { findNotes, provenance, staleReport } from '../../src/knowledge/provenance';
import { loadVault, parseNote } from '../../src/knowledge/vault';

const BEFORE = ['./examples/vault'];
const AFTER = ['./examples/vault', './examples/kb-worked-example/after'];

test.describe('provenance frontmatter', () => {
  test('one or many sources, ISO timestamps, keywords as list or comma string', () => {
    const one = parseNote('A.md', '---\nsource: SHOP-1\nsource_updated: 2026-09-30T08:12:44Z\nsynced_at: 2026-10-01 02:00:05Z\nkeywords: Payment, PayPal\n---\n# A');
    expect(provenance(one)).toEqual({
      sources: ['SHOP-1'],
      sourceUpdated: '2026-09-30T08:12:44.000Z',
      syncedAt: '2026-10-01T02:00:05.000Z',
      keywords: ['payment', 'paypal'],
    });
    const many = parseNote('B.md', '---\nsource: [SHOP-1, "local:~/repos/web/AGENTS.md"]\n---\n# B');
    expect(provenance(many).sources).toEqual(['SHOP-1', 'local:~/repos/web/AGENTS.md']);
    expect(provenance(parseNote('C.md', '# C'))).toEqual({ sources: [], keywords: [] });
  });

  test('provenance keys do not change what is tested; they surface on the feature', () => {
    const plain = buildModel(loadVault(BEFORE)).byId.get('review order')!;
    const synced = buildModel(loadVault(AFTER)).byId.get('review order')!;
    expect({ ...synced, sources: [], keywords: [], file: '' }).toEqual({ ...plain, file: '' });
    expect(synced.sources).toEqual(['manual', 'SHOP-142']);
    expect(synced.keywords).toContain('paypal');
  });

  test('the _sync folder (watermark, review queue) is not part of the knowledge graph', () => {
    const notes = loadVault(AFTER);
    expect([...notes.values()].some((n) => n.file.includes('_sync'))).toBe(false);
    expect(fs.existsSync('examples/kb-worked-example/after/_sync/state.md')).toBe(true);
  });
});

test.describe('find — impact analysis lookup', () => {
  test('ranks exact names, aliases, keywords and catalog ids above body mentions', () => {
    const notes = [
      parseNote('Payment.md', '---\naliases: [Pay step]\nkeywords: [card, paypal]\nsource: SHOP-142\n---\n# Payment'),
      parseNote('Review Order.md', '# Review Order\nShows the masked card from [[Payment]].'),
      parseNote('Guide.md', '---\ntype: guide\n---\n# Guide\npayment payment payment'),
    ];
    const byTerm = (...t: string[]) => findNotes(notes, t).map((h) => h.title);
    expect(byTerm('payment')).toEqual(['Payment', 'Review Order']);
    expect(byTerm('pay step')).toEqual(['Payment']);
    expect(byTerm('paypal')).toEqual(['Payment']);
    expect(byTerm('shop-142')).toEqual(['Payment']);
    expect(byTerm('card')[0]).toBe('Payment');
    expect(findNotes(notes, ['card'])[0].reasons).toContain('keyword "card"');
    expect(byTerm('loyalty points')).toEqual([]);
  });

  test('worked example: PayPal is unknown before the sync, owned by Payment after it', () => {
    expect(findNotes(loadVault(BEFORE).values(), ['paypal'])).toEqual([]);
    const candidates = findNotes(loadVault(BEFORE).values(), ['payment', 'card', 'checkout']).map((h) => h.title);
    expect(candidates.slice(0, 3)).toEqual(expect.arrayContaining(['Payment', 'Payment Rules', 'Checkout Flow']));

    const after = loadVault(AFTER);
    expect(findNotes(after.values(), ['paypal'])[0].title).toBe('Payment');
    expect(findNotes(after.values(), ['SHOP-142']).filter((h) => h.sources.includes('SHOP-142')).map((h) => h.title).sort())
      .toEqual(['Payment', 'Payment Rules', 'Review Order']);
  });

  test('worked example: the synced notes still parse into runnable knowledge', () => {
    const payment = buildModel(loadVault(AFTER)).byId.get('payment')!;
    expect(payment.fields.find((f) => f.name === 'Payment method')).toMatchObject({ type: 'select', options: ['Card', 'PayPal'], example: 'Card' });
    expect(payment.fields.find((f) => f.name === 'Card number')).toMatchObject({ required: true, minLength: 16, maxLength: 16 });
    expect(payment.scenarios.map((s) => s.tags)).toEqual([['SHOP-142']]);
    expect(payment.vagueCriteria).toEqual([]);
  });
});

test.describe('stale report', () => {
  test('flags never-synced, old syncs, missing provenance and open conflicts; oldest first', () => {
    const root = test.info().outputPath('stale-vault');
    fs.mkdirSync(root, { recursive: true });
    const write = (name: string, text: string) => fs.writeFileSync(path.join(root, name), text);
    write('Fresh.md', '---\nsource: SHOP-1\nsynced_at: 2026-09-28T00:00:00Z\n---\n# Fresh');
    write('Old.md', '---\nsource: SHOP-2\nsynced_at: 2026-06-01T00:00:00Z\n---\n# Old');
    write('Manual.md', '# Manual');
    write('Disputed.md', '---\nsource: SHOP-3\nsynced_at: 2026-09-30T00:00:00Z\n---\n# Disputed\n## Sync conflicts\n> [!conflict] SHOP-3 vs SHOP-1');
    write('credentials.md', '---\ntype: credentials\n---\n');
    const rows = staleReport(loadVault([root]).values(), new Date('2026-10-01T00:00:00Z'), 30);
    expect(rows.map((r) => [r.title, r.ageDays, r.flags])).toEqual([
      ['Manual', undefined, ['no-provenance', 'never-synced']],
      ['Old', 122, ['old-sync']],
      ['Fresh', 3, []],
      ['Disputed', 1, ['conflict']],
    ]);
  });
});
