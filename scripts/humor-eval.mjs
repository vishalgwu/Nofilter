// Try the humor engine and print every candidate.
//   node --env-file=.env scripts/humor-eval.mjs                      a spread of moments, Classic voice
//   node --env-file=.env scripts/humor-eval.mjs "I fell off the map" spicy         one moment
//   node --env-file=.env scripts/humor-eval.mjs --cast               the same moments through every character
//   node --env-file=.env scripts/humor-eval.mjs "I fell off the map" spicy --cast  one moment, every character
// Use it to tune humor/guide.md, humor/moments.json and humor/cast.json, then rate roasts with friends.

import { writeRoast } from '../server/roaster.js';
import { Session, countWords } from '../server/humor.js';
import { CHARACTERS, ORDER } from '../server/cast.js';

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

const args = process.argv.slice(2);
const cast = args.includes('--cast');
const positional = args.filter((a) => !a.startsWith('--'));
const custom = positional[0];
const rows = custom ? [['typed', custom, positional[1] || 'spicy']] : cast ? SET.slice(0, 4) : SET;
const characters = cast ? ORDER : ['classic'];

for (const [momentType, moment, level] of rows) {
  console.log(`\n=== [${level}] ${moment || '(' + momentType + ' detected)'}`);
  for (const character of characters) {
    const session = new Session(); // a fresh session per character so they do not borrow each other's callbacks
    const ctx = { momentType, moment, transcript: '', seconds: 9 };
    const r = await writeRoast(ctx, level, session, undefined, character);
    console.log(`\n  ${CHARACTERS[character].name}  (${r.type})`);
    r.candidates.forEach((c, i) => console.log(`   ${i === r.picked ? '>>' : '  '} ${c}  (${countWords(c)}w)`));
    console.log(`     ${r.llmMs}ms, ${r.pickedBy}`);
  }
}
