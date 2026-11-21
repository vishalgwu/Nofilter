// Day 5 report: how funny were the roasts, and is Stage 1 done?
//   node scripts/laugh-report.mjs                 print the report (tester sessions only)
//   node scripts/laugh-report.mjs --write         also save docs/laugh-report.md
//   node scripts/laugh-report.mjs --winners       also save every score-3 roast to data/winners.jsonl
//   node scripts/laugh-report.mjs --since 2026-11-22T00:00:00Z    ignore older rows
//   node scripts/laugh-report.mjs --all           include rows that have no tester name
//   node scripts/laugh-report.mjs --log some-file.jsonl           read a different log

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../server/laugh.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (flag(n) ? args[args.indexOf(n) + 1] : null);

const logFile = value('--log') ? path.resolve(value('--log')) : path.join(ROOT, 'data', 'timing-log.jsonl');
const since = value('--since') ? Date.parse(value('--since')) : 0;
const raw = await readFile(logFile, 'utf8').catch(() => '');
const rows = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const a = analyze(rows, { testOnly: !flag('--all'), since });
if (!a.roasts) {
  console.log('No tester roasts in the log yet.');
  console.log('Open the page with ?test=1, type a tester name, and run a session. (Use --all to include untagged rows.)');
  process.exit(0);
}

const fmt = (v) => (v == null ? '-' : v);
const ms = (v) => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`);
const table = (title, list, keyName) => {
  let t = `\n### ${title}\n\n| ${keyName} | roasts | rated | avg laugh (0-3) |\n| --- | --- | --- | --- |\n`;
  for (const r of list) t += `| ${r.key} | ${r.roasts} | ${r.rated} | ${fmt(r.avg)} |\n`;
  return t;
};

let md = `# RoastCast laugh report\n\nGenerated ${new Date().toISOString().slice(0, 10)} from \`${path.relative(ROOT, logFile)}\`. ` +
  'Laugh score: 0 no reaction, 1 a smile, 2 a real laugh, 3 laughed out loud.\n';

md += `\n## Stage 1 check\n\n`;
md += `- **Average laugh score:** ${fmt(a.average)} out of 3 (needs 2.0 or more) ${a.verdict.laughOk ? 'PASS' : 'NOT YET'}\n`;
md += `- **Roasts that start speaking in under 3 s:** ${fmt(a.speed.pctUnder3s)}% (needs 90% or more) ${a.verdict.speedOk ? 'PASS' : 'NOT YET'}\n`;
md += `- **Coverage:** ${a.testers} testers (goal 10), ${a.sessions} sessions (goal 30), ${a.rated} rated of ${a.roasts} roasts` +
  `${a.unrated ? `, **${a.unrated} still unrated**` : ''}\n`;
md += `- **Laughed (score 2 or 3):** ${fmt(a.pctAtLeast2)}% of rated roasts. Scores: 0 x${a.dist[0]}, 1 x${a.dist[1]}, 2 x${a.dist[2]}, 3 x${a.dist[3]}\n`;
md += `- **Speed:** roast starts at ${ms(a.speed.p50)} median, ${ms(a.speed.p90)} p90 (n=${a.speed.n})\n`;

md += table('By moment type (weakest first)', a.byType, 'moment type');
md += table('By roast level', a.byLevel, 'level');
md += table('By roast style', a.byMode, 'style');
md += `\n### By tester\n\n| tester | sessions | roasts | rated | avg laugh |\n| --- | --- | --- | --- | --- |\n`;
for (const t of a.byTester) md += `| ${t.key} | ${t.sessions} | ${t.roasts} | ${t.rated} | ${fmt(t.avg)} |\n`;

if (a.weakest) {
  const w = a.weakest;
  md += `\n## Fix this first: ${w.key} (average ${w.avg} from ${w.rated} ratings)\n\n`;
  md += `Open \`humor/moments.json\`, find "${w.key}", and rewrite its joke shapes and examples using what worked.\n\n`;
  md += `Lowest scoring:\n${w.worst.map((r) => `- (${r.score}) ${r.moment} -> "${r.roast}"`).join('\n')}\n\n`;
  md += `Highest scoring:\n${w.best.map((r) => `- (${r.score}) ${r.moment} -> "${r.roast}"`).join('\n')}\n`;
}
md += `\n## Winners\n\n${a.winners.length} roasts scored 3. Save them with \`--winners\`: they join the example set now and become training data in Stage 3.\n`;

console.log(md);

if (flag('--write')) {
  const file = path.join(ROOT, 'docs', 'laugh-report.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, md);
  console.log(`Saved ${path.relative(ROOT, file)}`);
}
if (flag('--winners')) {
  const file = path.join(ROOT, 'data', 'winners.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  const lines = a.winners.map((r) => JSON.stringify({
    moment: r.moment, momentKind: r.momentKind, level: r.level, mode: r.mode, roast: r.roast, tester: r.tester,
  }));
  await writeFile(file, lines.length ? lines.join('\n') + '\n' : '');
  console.log(`Saved ${lines.length} winners to ${path.relative(ROOT, file)} (not committed: data/*.jsonl is ignored)`);
}
