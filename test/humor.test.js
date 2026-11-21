import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOMENTS, MOMENT_TYPES, MAX_WORDS, countWords, classifyMoment, resolveType, buildSystemPrompt, buildUserPrompt,
  parseCandidates, validCandidates, dropCopies, copiesExample, rulePick, parsePick, capWords, Session, SessionStore,
} from '../server/humor.js';

// ---------- the hand-written example set ----------
test('there are exactly 30 hand-written examples: 5 for each of the 6 moment types', () => {
  for (const t of MOMENT_TYPES) assert.equal(MOMENTS[t].examples.length, 5, t);
  assert.equal(MOMENT_TYPES.reduce((n, t) => n + MOMENTS[t].examples.length, 0), 30);
});

test('every example roast is within the word limit and has a level', () => {
  for (const t of MOMENT_TYPES) {
    for (const e of MOMENTS[t].examples) {
      assert.ok(countWords(e.roast) <= MAX_WORDS, `${t}: "${e.roast}" is ${countWords(e.roast)} words`);
      assert.ok(['gentle', 'spicy', 'savage'].includes(e.level), `${t}: bad level ${e.level}`);
      assert.ok(e.moment.length > 3);
    }
  }
});

test('every type covers all three levels and has three joke shapes', () => {
  for (const t of MOMENT_TYPES) {
    const levels = new Set(MOMENTS[t].examples.map((e) => e.level));
    assert.deepEqual([...levels].sort(), ['gentle', 'savage', 'spicy'], t);
    assert.equal(MOMENTS[t].shapes.length, 3, t);
  }
});

// ---------- classify ----------
test('classifies the six quick-pick moments', () => {
  const cases = {
    'I drove straight into the ocean for the third time.': 'crash',
    'I screamed at a jump scare and threw my controller.': 'scream',
    'I stared at the same door for a full minute without moving.': 'silence',
    'I won the match with one health and zero idea how.': 'lucky_win',
    'I rage quit right before the final boss.': 'rage_quit',
    'I panicked and healed the enemy team.': 'panic',
  };
  for (const [text, type] of Object.entries(cases)) assert.equal(classifyMoment(text), type, text);
});

test('unknown moments fall back to general', () => {
  assert.equal(classifyMoment('my cat sat on the keyboard'), 'general');
  assert.equal(classifyMoment(''), 'general');
});

test('resolveType trusts an explicit type and classifies speech and typed text', () => {
  assert.equal(resolveType({ momentType: 'scream', moment: '' }), 'scream');
  assert.equal(resolveType({ momentType: 'panic', moment: 'whatever' }), 'panic');
  assert.equal(resolveType({ momentType: 'speech', moment: 'I just crashed the car' }), 'crash');
  assert.equal(resolveType({ momentType: 'typed', moment: 'I rage quit again' }), 'rage_quit');
});

// ---------- prompts ----------
test('the system prompt contains the guide, the type joke shapes and that type examples', () => {
  const p = buildSystemPrompt('crash');
  assert.match(p, /six ingredients/i);
  assert.match(p, /GENTLE/);
  assert.match(p, /Blame the object/);
  assert.match(p, /braked for a pigeon/i);
  assert.doesNotMatch(p, /Screamed at a jump scare/); // other types' examples stay out
});

test('the general prompt shows a spread of examples from every type', () => {
  const p = buildSystemPrompt('general');
  assert.equal((p.match(/- Moment:/g) || []).length, 6);
});

test('the user prompt asks for 3 roasts as JSON and includes level, moment and what was heard', () => {
  const u = buildUserPrompt({ momentType: 'speech', moment: 'I crashed again', transcript: 'oh no I crashed again' }, 'savage', 'crash', null);
  assert.match(u, /SAVAGE/);
  assert.match(u, /The player just said: "I crashed again"/);
  assert.match(u, /last 30 seconds/);
  assert.match(u, /3 different roasts/);
  assert.match(u, /JSON/);
});

// ---------- candidates ----------
test('parseCandidates reads JSON, numbered lists and plain lines', () => {
  assert.deepEqual(parseCandidates('{"roasts":["One.","Two.","Three."]}'), ['One.', 'Two.', 'Three.']);
  assert.deepEqual(parseCandidates('["A","B"]'), ['A', 'B']);
  assert.deepEqual(parseCandidates('1. First one\n2) Second one\n- Third one'), ['First one', 'Second one', 'Third one']);
  assert.deepEqual(parseCandidates('{"roasts":["\\"Quoted.\\""]}'), ['Quoted.']);
});

test('validCandidates drops roasts over 15 words and duplicates', () => {
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
  const out = validCandidates(['Short one.', long, 'short one.', 'Another short roast.']);
  assert.deepEqual(out, ['Short one.', 'Another short roast.']);
});

test('dropCopies removes lines lifted from the examples, but never leaves nothing', () => {
  const copy = 'The controller filed for divorce after that.'; // lifted from an example
  const fresh = 'A brand new joke about wobbling spaghetti legs.';
  assert.deepEqual(dropCopies([copy, fresh]), [fresh]);
  assert.deepEqual(dropCopies([copy]), [copy]);
  assert.equal(copiesExample('Parking like a raccoon with a license.'), true);
  assert.equal(copiesExample('Raccoons have better parking skills.'), false);
});

test('rulePick chooses the shortest roast, first on a tie', () => {
  assert.equal(rulePick(['a b c d', 'a b', 'c d']), 1);
  assert.equal(rulePick(['only one']), 0);
});

test('parsePick accepts JSON or a bare digit and rejects out-of-range', () => {
  assert.equal(parsePick('{"best": 2}', 3), 1);
  assert.equal(parsePick('3', 3), 2);
  assert.equal(parsePick('{"best": 9}', 3), -1);
  assert.equal(parsePick('no idea', 3), -1);
});

test('capWords hard-cuts at 15 words and ends cleanly', () => {
  const t = capWords('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen,');
  assert.equal(countWords(t), 15);
  assert.ok(t.endsWith('.'));
});

// ---------- running jokes ----------
test('a new session has no memory text', () => {
  assert.equal(new Session().summary('crash'), '');
});

test('the session remembers earlier moments and counts repeats for callbacks', () => {
  const s = new Session();
  s.record('crash', 'drove into the ocean', 'Is the car a boat now?');
  s.record('scream', 'screamed at a spider', 'Brave warrior.');
  s.record('crash', 'drove into the ocean again', 'Ocean fan club president.');
  const text = s.summary('crash');
  assert.match(text, /drove into the ocean/);
  assert.match(text, /Ocean fan club president/);
  assert.match(text, /This is the 3rd crash this session/);
  assert.match(text, /Do not reuse/);
});

test('ordinals read correctly (2nd, 3rd, 4th, 12th)', () => {
  const after = (earlier) => {
    const s = new Session();
    for (let i = 0; i < earlier; i++) s.record('panic', 'x', 'y');
    return s.summary('panic');
  };
  assert.match(after(1), /2nd panic/);
  assert.match(after(2), /3rd panic/);
  assert.match(after(3), /4th panic/);
  assert.match(after(11), /12th panic/);
});

test('"threw the controller and quit" is a rage quit, but throwing alone is not', () => {
  assert.equal(classifyMoment('I threw the controller and quit'), 'rage_quit');
  assert.equal(classifyMoment('I threw my controller at the wall'), 'crash'); // "wall" - heuristic, fine
});

test('session history is capped and the store keeps sessions apart', () => {
  const s = new Session();
  for (let i = 0; i < 20; i++) s.record('panic', `m${i}`, `r${i}`);
  assert.equal(s.events.length, 8);
  const store = new SessionStore();
  assert.notEqual(store.get('a'), store.get('b'));
  assert.equal(store.get('a'), store.get('a'));
});

test('the store forgets sessions that have been idle too long', () => {
  const store = new SessionStore(200, 1000);
  const a = store.get('a');
  a.touched = Date.now() - 5000;
  assert.notEqual(store.get('a'), a);
});
