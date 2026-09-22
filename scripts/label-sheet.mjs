#!/usr/bin/env node
/**
 * Terminal labeller for the conscience skill-label TSV.
 * For each row with an empty helpful (y/n) column, shows the prompt and skill
 * info and accepts y/n/s/b/q input. Writes back after every keypress.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const tsvPath = process.argv[2];
if (!tsvPath) { console.error('Usage: node scripts/label-sheet.mjs <path-to-tsv>'); process.exit(1); }

// Skill directories to search for SKILL.md frontmatter
const SKILL_DIRS = [
  join(homedir(), '.pi', 'agent', 'skills'),
  join(homedir(), '.agents', 'skills'),
  join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'pi-subagents', 'skills'),
];

function readSkillDescription(skillName) {
  for (const dir of SKILL_DIRS) {
    const skillFile = join(dir, skillName, 'SKILL.md');
    if (existsSync(skillFile)) {
      const raw = readFileSync(skillFile, 'utf8');
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const lines = fmMatch[1].split('\n');
        for (const line of lines) {
          if (line.startsWith('description:')) {
            return line.slice('description:'.length).trim();
          }
        }
      }
      // Fallback: first non-empty, non-heading line after frontmatter
      const body = raw.slice(fmMatch ? fmMatch[0].length : 0);
      const firstLine = body.split('\n').find(l => l.trim() && !l.startsWith('#'));
      return firstLine?.trim() || '(no description)';
    }
  }
  return '(skill file not found)';
}

function parseTSV(text) {
  const lines = text.split('\n');
  const header = lines[0];
  const rows = lines.slice(1).filter(l => l.trim()).map(l => l.split('\t'));
  return { header, rows };
}

function serializeTSV(header, rows) {
  return [header, ...rows.map(r => r.join('\t'))].join('\n') + '\n';
}

async function main() {
  const raw = readFileSync(tsvPath, 'utf8');
  const { header, rows } = parseTSV(raw);
  const helpfulIdx = header.split('\t').indexOf('helpful (y/n)');
  if (helpfulIdx === -1) { console.error('Column "helpful (y/n)" not found'); process.exit(1); }

  const total = rows.length;
  let pos = 0;
  let dirty = false;

  // Find first unlabelled row
  while (pos < total && rows[pos][helpfulIdx] !== '') pos++;
  if (pos >= total) { console.log('All rows already labelled.'); return; }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(q, resolve));

  const save = () => {
    writeFileSync(tsvPath, serializeTSV(header, rows), 'utf8');
    dirty = false;
  };

  const show = (idx) => {
    const row = rows[idx];
    const project = row[1] || '';
    const prompt = row[2] || '';
    const skillName = row[3] || '';
    const pUseful = row[4] || '';
    const firstUsage = row[5] || '';
    const labelled = row[helpfulIdx] || '';

    // Clear screen
    process.stdout.write('\x1B[2J\x1B[H');
    console.log(`── Row ${idx + 1} of ${total} ── project: ${project}`);
    console.log();
    console.log(`Prompt excerpt:`);
    console.log(prompt);
    console.log();
    console.log(`Recommended skill: ${skillName}`);
    if (skillName && skillName !== '(no skill selected)') {
      console.log(`  Full description: ${readSkillDescription(skillName)}`);
    }
    console.log(`  P(useful): ${pUseful}`);
    console.log(`  Agent did first: ${firstUsage}`);
    if (labelled) console.log(`  Current label: ${labelled}`);
    console.log();
  };

  while (pos < total) {
    show(pos);
    const answer = await ask('[y]es helpful / [n]o / [s]kip / [b]ack / [q]uit > ');
    const key = answer.trim().toLowerCase();

    if (key === 'q') { save(); break; }
    if (key === 'b') { if (pos > 0) pos--; continue; }
    if (key === 's') { pos++; continue; }
    if (key === 'y' || key === 'n') {
      rows[pos][helpfulIdx] = key;
      dirty = true;
      save();
      pos++;
    }
  }

  if (dirty) save();
  rl.close();
  if (pos >= total) console.log('All rows labelled.');
}

main().catch(e => { console.error(e); process.exit(1); });
