// Try the humor engine on a spread of moments and print every candidate.
//   node --env-file=.env scripts/humor-eval.mjs           (default set)
//   node --env-file=.env scripts/humor-eval.mjs "I fell off the map" spicy
// Use it to tune humor/guide.md and humor/moments.json, then rate roasts with friends (Day 5).

import { writeRoast } from '../server/roaster.js';
import { Session, countWords } from '../server/humor.js';

const SET = [
  ['typed', 'I drove straight into the ocean for the third time.', 'gentle'],
  ['typed', 'I screamed at a jump scare and threw my controller.', 'spicy'],
  ['silence', '', 'savage'],
  ['typed', 'I won the match with one health and zero idea how.', 'spicy'],
  ['typed', 'I rage quit right before the final boss.', 'savage'],
  ['typed', 'I panicked and healed the enemy team.', 'gentle'],
  ['speech', 'Okay okay okay I am totally calm, I have this completely under control', 'spicy'],
  ['crash', '', 'spicy'],
];

const custom = process.argv[2];
const rows = custom ? [['typed', custom, process.argv[3] || 'spicy']] : SET;
const session = new Session(); // shared across the set so callbacks can happen

for (const [momentType, moment, level] of rows) {
  const ctx = { momentType, moment, transcript: '', seconds: 9 };
  const r = await writeRoast(ctx, level, session);
  console.log(`\n[${r.type} | ${level}] ${moment || '(' + momentType + ' detected)'}`);
  r.candidates.forEach((c, i) => console.log(`  ${i === r.picked ? '>>' : '  '} ${c}  (${countWords(c)}w)`));
  console.log(`  candidates ${r.candMs}ms + pick ${r.pickMs}ms (${r.pickedBy}) = ${r.llmMs}ms`);
}
