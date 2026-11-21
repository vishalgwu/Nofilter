// Turns data/timing-log.jsonl into the speed table (median and 90th percentile for every step).
//   node scripts/speed-report.mjs              print the table
//   node scripts/speed-report.mjs --write      also save it to docs/speed-table.md
//   node scripts/speed-report.mjs --since 2026-11-21T10:00:00Z   ignore older rows
// Only rows logged since Day 4 (they carry a "mode") are used.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from '../server/stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'data', 'timing-log.jsonl');
const args = process.argv.slice(2);
const since = args.includes('--since') ? Date.parse(args[args.indexOf('--since') + 1]) : 0;

// [column, label, what it is, target]
const STEPS = [
  ['reactionMs', 'Reaction (fast lane)', 'trigger to the reaction sound being started (speaker latency not included)', 'under 100 ms'],
  ['detectMs', 'Detect (speech only)', 'last sound to the decision to roast', '100-400 ms'],
  ['promptMs', 'Build the prompt', 'server builds the prompt', 'under 50 ms'],
  ['firstTokenMs', 'First LLM token', 'writer starts answering', '300-700 ms'],
  ['candMs', 'Write', 'roast text is final (all takes written)', ''],
  ['pickMs', 'Judge', 'separate judge call ("best" mode only)', ''],
  ['llmMs', 'Write + judge', 'roast text is final (with the judge)', ''],
  ['ttsFirstByteMs', 'Voice, first audio', 'server: voice request to first audio byte', '200-400 ms'],
  ['voiceMs', 'Voice, in the browser', 'browser asks for audio until it plays', '50-400 ms'],
  ['roastStartMs', 'Roast starts speaking', 'trigger to the first word of the roast', 'about 1-2 s, ceiling 3 s'],
];
const MODE_NAME = { self: 'Best of 3 (self-pick)', quick: 'Quick (one roast)', best: 'Best of 3 + judge (Day 3)' };

const raw = await readFile(LOG, 'utf8').catch(() => '');
const rows = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.type === 'roast' && r.mode && Date.parse(r.ts) >= since);
if (!rows.length) { console.log('No Day 4 roasts in the log yet. Run some roasts first.'); process.exit(0); }

const fmt = (v) => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`);
let md = `# RoastCast speed table\n\nMeasured on ${new Date().toISOString().slice(0, 10)} from \`data/timing-log.jsonl\`. ` +
  'All times count from the moment the roast is triggered. Median (p50) and 90th percentile (p90).\n';
const out = [];

for (const mode of ['self', 'quick', 'best']) {
  const m = rows.filter((r) => r.mode === mode);
  if (!m.length) continue;
  const starts = m.map((r) => r.roastStartMs).filter(Number.isFinite);
  const under = (ms) => Math.round((starts.filter((s) => s < ms).length / starts.length) * 100);
  md += `\n## ${MODE_NAME[mode]}  (${m.length} roasts)\n\n| Step | What it measures | p50 | p90 | n | Target |\n| --- | --- | --- | --- | --- | --- |\n`;
  out.push(`\n== ${MODE_NAME[mode]} (${m.length} roasts) ==`);
  for (const [key, label, what, target] of STEPS) {
    // detect delay only means something for spoken moments (for silence it is just the 8 s wait)
    const rowsForStep = key === 'detectMs' ? m.filter((r) => r.momentType === 'speech') : m;
    const s = summarize(rowsForStep.map((r) => r[key]));
    if (!s.n) continue;
    if (mode !== 'best' && (key === 'pickMs' || key === 'llmMs')) continue; // no judge step in this mode
    md += `| ${label} | ${what} | ${fmt(s.p50)} | ${fmt(s.p90)} | ${s.n} | ${target} |\n`;
    out.push(`${label.padEnd(24)} p50 ${fmt(s.p50).padStart(8)}   p90 ${fmt(s.p90).padStart(8)}   n=${s.n}`);
  }
  const line = `Roast starts in under 3 s: ${under(3000)}% of roasts. Under 1.5 s: ${under(1500)}%.`;
  md += `\n${line}\n`;
  out.push(line);
}

console.log(out.join('\n'));
if (args.includes('--write')) {
  const file = path.join(ROOT, 'docs', 'speed-table.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, md);
  console.log(`\nSaved ${path.relative(ROOT, file)}`);
}
