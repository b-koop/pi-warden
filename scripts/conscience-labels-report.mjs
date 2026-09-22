#!/usr/bin/env node
/**
 * Reads the labelled TSV and the replay JSONL; prints skill precision, estimated
 * recall, per-project rows, threshold sweep, and the list of n-labelled skills.
 */
import { readFileSync } from 'node:fs';

const tsvPath = process.argv[2];
if (!tsvPath) { console.error('Usage: node scripts/conscience-labels-report.mjs <labelled.tsv>'); process.exit(1); }

function parseTSV(text) {
  const lines = text.split('\n');
  const header = lines[0];
  const rows = lines.slice(1).filter(l => l.trim()).map(l => l.split('\t'));
  return { header, rows };
}

function pct(v, n) { return n === 0 ? '-' : `${(v / n * 100).toFixed(0)}% (${v}/${n})`; }

const { header, rows } = parseTSV(readFileSync(tsvPath, 'utf8'));
const helpfulIdx = header.split('\t').indexOf('helpful (y/n)');
if (helpfulIdx === -1) { console.error('Column "helpful (y/n)" not found'); process.exit(1); }

// Split rows: 86 picks (skill selected) vs 40 unpicked
// 86 skill selections first, then 40 no-skill turns
const picks = rows.filter((_, i) => i < 86);
const unpicked = rows.filter((_, i) => i >= 86);

const pickLabelled = picks.filter(r => r[helpfulIdx] !== '');
const unpickedLabelled = unpicked.filter(r => r[helpfulIdx] !== '');

const pickYes = pickLabelled.filter(r => r[helpfulIdx] === 'y');
const pickNo = pickLabelled.filter(r => r[helpfulIdx] === 'n');

const unpickedYes = unpickedLabelled.filter(r => r[helpfulIdx] === 'y');

const lines = [];
const out = l => { const s = l ?? ''; lines.push(s); console.log(s); };

out('# Conscience skill-label report');
out(`\nLabelled: ${pickLabelled.length} of ${picks.length} picks, ${unpickedLabelled.length} of ${unpicked.length} unpicked.\n`);

out('## Skill precision (picks)');
out(`  y (helpful): ${pct(pickYes.length, pickLabelled.length)}`);
out(`  n (not helpful): ${pct(pickNo.length, pickLabelled.length)}`);
out(`  unlabelled: ${picks.length - pickLabelled.length}`);
out();

out('## Estimated recall (unpicked turns)');
out(`  y (would have been helpful): ${pct(unpickedYes.length, unpickedLabelled.length)}`);
out(`  unlabelled: ${unpicked.length - unpickedLabelled.length}`);
out();

// Per-project
const byProject = new Map();
for (const r of pickLabelled) {
  const proj = r[1];
  if (!byProject.has(proj)) byProject.set(proj, { y: 0, n: 0, total: 0 });
  const entry = byProject.get(proj);
  entry.total++;
  if (r[helpfulIdx] === 'y') entry.y++;
  if (r[helpfulIdx] === 'n') entry.n++;
}
if (byProject.size > 1) {
  out('## Per-project (picks)');
  for (const [proj, { y, n, total }] of byProject) {
    out(`  ${proj.padEnd(25)} y=${pct(y, total)}  n=${pct(n, total)}`);
  }
  out();
}

out('## Precision at P(useful) threshold (labelled picks only)');
out('  threshold | y | n | precision');
for (const t of [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95]) {
  const atThreshold = pickLabelled.filter(r => parseFloat(r[4]) >= t);
  const yAt = atThreshold.filter(r => r[helpfulIdx] === 'y').length;
  const nAt = atThreshold.filter(r => r[helpfulIdx] === 'n').length;
  out(`  ${t.toFixed(2)}       | ${String(yAt).padStart(2)} | ${String(nAt).padStart(2)} | ${pct(yAt, yAt + nAt)}`);
}
out();

if (pickNo.length) {
  out(`## Skills labelled n (${pickNo.length})`);
  for (const r of pickNo) {
    out(`  ${r[3].padEnd(30)} P=${r[4]} project=${r[1]} | ${(r[2] || '').slice(0, 80)}`);
  }
  out();
}

const skillCounts = new Map();
for (const r of pickLabelled) {
  const s = r[3];
  skillCounts.set(s, (skillCounts.get(s) || 0) + 1);
}
const repeated = [...skillCounts.entries()].filter(([_, c]) => c > 1).sort((a, b) => b[1] - a[1]);
if (repeated.length) {
  out('## Most-recommended skills (labelled picks)');
  for (const [skill, count] of repeated) {
    const yCount = pickLabelled.filter(r => r[3] === skill && r[helpfulIdx] === 'y').length;
    out(`  ${skill.padEnd(30)} ${count} picks, ${yCount} y`);
  }
}
