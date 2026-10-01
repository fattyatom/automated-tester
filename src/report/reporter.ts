import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import config from '../../qa.config';
import { SEVERITY_ORDER } from '../config';
import { FINDING_ANNOTATION, Finding, SOURCE_ANNOTATION } from '../explore/session';

interface Row {
  project: string;
  title: string;
  status: string;
  source?: { id: string; title: string; file: string };
  findings: Finding[];
  notes: string[];
  unmatched: string[];
  error?: string;
}

const ICON: Record<string, string> = { critical: '🟥', high: '🟧', medium: '🟨', low: '🟦', info: '⬜' };

/** Writes findings.{json,md} + traceability.md, and optionally a run note into the vault. */
export default class QaReporter implements Reporter {
  private rows: Row[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const anns = [...test.annotations, ...(result.annotations ?? [])];
    const seen = new Set<string>();
    const unique = anns.filter((a) => {
      const k = `${a.type}|${a.description}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    const of = (type: string) => unique.filter((a) => a.type === type).map((a) => a.description ?? '');
    const source = of(SOURCE_ANNOTATION)[0];
    this.rows.push({
      project: test.parent.project()?.name ?? '',
      title: test.titlePath().slice(3).join(' › '),
      status: test.expectedStatus === 'skipped' && result.status === 'skipped' && unique.some((a) => a.type === 'fixme') ? 'fixme' : result.status,
      source: source ? JSON.parse(source) : undefined,
      findings: of(FINDING_ANNOTATION).map((d) => JSON.parse(d) as Finding),
      notes: of('qa-note'),
      unmatched: of('unmatched-step'),
      error: result.error?.message?.split('\n')[0],
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    const out = config.report.outputDir;
    fs.mkdirSync(out, { recursive: true });

    // De-duplicate findings across tests (same issue spotted by several charters).
    const grouped = new Map<string, Finding & { foundBy: string[] }>();
    for (const row of this.rows) {
      for (const f of row.findings) {
        const key = `${f.severity}|${f.title}`;
        const g = grouped.get(key) ?? { ...f, foundBy: [] };
        g.foundBy.push(`${row.project} › ${row.title}`);
        grouped.set(key, g);
      }
    }
    const findings = [...grouped.values()].sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
    fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(findings, null, 2));

    const md: string[] = ['# QA findings', '', `Run status: **${result.status}** · ${new Date().toISOString()}`, ''];
    md.push('| Severity | Count |', '|---|---|');
    for (const s of [...SEVERITY_ORDER].reverse()) md.push(`| ${ICON[s]} ${s} | ${findings.filter((f) => f.severity === s).length} |`);
    findings.forEach((f, i) => {
      md.push('', `## ${i + 1}. ${ICON[f.severity]} [${f.severity}] ${f.title}`, '');
      md.push(`- **Category:** ${f.category}`);
      if (f.feature) md.push(`- **Spec:** [[${f.feature}]] (\`${f.file}\`)`);
      if (f.url) md.push(`- **URL:** ${f.url}`);
      md.push(`- **Found by:** ${f.foundBy.slice(0, 5).join('; ')}${f.foundBy.length > 5 ? ` (+${f.foundBy.length - 5} more)` : ''}`);
      if (f.detail) md.push('', '```', f.detail.slice(0, 1500), '```');
    });
    fs.writeFileSync(path.join(out, 'findings.md'), md.join('\n') + '\n');

    const trace: string[] = ['# Traceability: vault → tests', '', '| Spec note | Charter | Test | Result |', '|---|---|---|---|'];
    const icon = (s: string) => ({ passed: '✅', failed: '❌', timedOut: '⏱️', skipped: '⏭️', interrupted: '⛔', fixme: '🛠️' })[s] ?? s;
    for (const r of [...this.rows].sort((a, b) => (a.source?.title ?? '~').localeCompare(b.source?.title ?? '~'))) {
      const extra = r.unmatched.length ? ` — unmatched: \`${r.unmatched.join('`, `')}\`` : r.error ? ` — ${r.error.slice(0, 120).replace(/\|/g, '\\|')}` : '';
      trace.push(`| ${r.source ? `[[${r.source.title}]]` : '—'} | ${r.project} | ${r.title.replace(/\|/g, '\\|')} | ${icon(r.status)}${extra} |`);
    }
    fs.writeFileSync(path.join(out, 'traceability.md'), trace.join('\n') + '\n');

    if (config.report.writeToVault) this.writeVaultNote(findings, result);

    const counts = SEVERITY_ORDER.map((s) => `${s}: ${findings.filter((f) => f.severity === s).length}`).reverse().join(', ');
    const fixme = this.rows.filter((r) => r.status === 'fixme').length;
    console.log(`\n[qa] ${findings.length} unique findings (${counts}); ${fixme} scenario(s) need step definitions.`);
    console.log(`[qa] Reports: ${path.join(out, 'findings.md')}, ${path.join(out, 'traceability.md')}, ${path.join(out, 'html')}`);
  }

  private writeVaultNote(findings: (Finding & { foundBy: string[] })[], result: FullResult) {
    const dir = config.report.writeToVault!;
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const lines = ['---', 'type: qa-run', `status: ${result.status}`, `date: ${new Date().toISOString()}`, 'tags: [qa-run]', '---', `# QA Run ${stamp}`, ''];
    const byFeature = new Map<string, Row[]>();
    for (const r of this.rows) {
      const k = r.source?.title ?? 'Unmapped';
      byFeature.set(k, [...(byFeature.get(k) ?? []), r]);
    }
    for (const [feature, rows] of byFeature) {
      const pass = rows.filter((r) => r.status === 'passed').length;
      lines.push(`- [[${feature}]] — ${pass}/${rows.length} passed`);
    }
    lines.push('', '## Findings', '');
    for (const f of findings) lines.push(`- **${f.severity}** ${f.title}${f.feature ? ` — [[${f.feature}]]` : ''}`);
    fs.writeFileSync(path.join(dir, `QA Run ${stamp}.md`), lines.join('\n') + '\n');
  }
}
