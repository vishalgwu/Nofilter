import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  CHARACTERS, CHARACTER_IDS, ORDER, BY_MOMENT, ROTATE, DEFAULT_CHARACTER, isCharacter,
  resolveCharacter, characterSection, castExamples, publicCast, chooseVoice,
} from '../server/cast.js';
import { buildSystemPrompt, MOMENT_TYPES, countWords, copiesExample, Session } from '../server/humor.js';
import { analyze } from '../server/laugh.js';

// ---------- the cast file itself ----------
test('the cast is Classic plus four characters, listed once each in the picker order', () => {
  assert.deepEqual([...CHARACTER_IDS].sort(), ['announcer', 'classic', 'grandma', 'kid', 'tired']);
  assert.deepEqual([...ORDER].sort(), [...CHARACTER_IDS].sort());
  assert.equal(DEFAULT_CHARACTER, 'classic');
  assert.ok(isCharacter('kid'));
  assert.ok(!isCharacter('nope'));
  assert.ok(!isCharacter('__proto__')); // never trust an id from the browser
});

test('every character has a name, colour, intro, voice choice, tuning and an OpenAI fallback', () => {
  for (const [id, c] of Object.entries(CHARACTERS)) {
    assert.ok(c.name && c.tagline && c.intro && c.icon, `${id}: missing text`);
    assert.ok(Number.isFinite(c.hue) && c.hue >= 0 && c.hue <= 360, `${id}: hue`);
    assert.ok(c.voice.prefer.length >= 1, `${id}: no preferred voices`);
    const s = c.settings;
    assert.ok(s.stability >= 0 && s.stability <= 1, `${id}: stability`);
    assert.ok(s.similarity_boost >= 0 && s.similarity_boost <= 1, `${id}: similarity`);
    assert.ok(s.speed >= 0.7 && s.speed <= 1.2, `${id}: speed must be 0.7-1.2 for ElevenLabs`);
    assert.ok(c.openai.voice && c.openai.instructions, `${id}: no OpenAI fallback`);
  }
});

test('the four characters each have a style and at least 3 sample lines within the word limit', () => {
  for (const id of ['announcer', 'tired', 'kid', 'grandma']) {
    const c = CHARACTERS[id];
    assert.ok(c.style.length > 40, `${id}: style`);
    assert.ok(c.examples.length >= 3, `${id}: examples`);
    for (const e of c.examples) assert.ok(countWords(e) <= 15, `${id}: "${e}" is ${countWords(e)} words`);
  }
  assert.equal(CHARACTERS.classic.style, ''); // Classic is the plain Stage 1 voice
});

test('the four characters sound clearly different: distinct voices to try, colours and pace', () => {
  const four = ['announcer', 'tired', 'kid', 'grandma'].map((id) => CHARACTERS[id]);
  assert.equal(new Set(four.map((c) => c.voice.prefer[0])).size, 4);
  assert.equal(new Set(four.map((c) => c.hue)).size, 4);
  assert.equal(new Set(four.map((c) => c.openai.voice)).size, 4);
  assert.ok(CHARACTERS.kid.settings.speed > CHARACTERS.tired.settings.speed); // the kid is fast, the tired friend slow
  assert.ok(CHARACTERS.tired.settings.stability > CHARACTERS.kid.settings.stability); // flat vs excitable
});

test('every moment type has a character, and only real characters are used', () => {
  for (const t of MOMENT_TYPES) assert.ok(isCharacter(BY_MOMENT[t]), `no character for ${t}`);
  for (const id of ROTATE) assert.ok(isCharacter(id) && id !== 'classic', `bad rotate entry ${id}`);
  assert.equal(BY_MOMENT.crash, 'announcer');
  assert.equal(BY_MOMENT.silence, 'tired');
  assert.equal(BY_MOMENT.lucky_win, 'kid');
});

// ---------- who speaks ----------
test('an explicit character always wins, including Classic', () => {
  assert.equal(resolveCharacter('grandma', 'crash'), 'grandma');
  assert.equal(resolveCharacter('classic', 'silence'), 'classic');
});

test('auto follows the moment type', () => {
  assert.equal(resolveCharacter('auto', 'crash'), 'announcer');
  assert.equal(resolveCharacter('auto', 'silence'), 'tired');
  assert.equal(resolveCharacter(undefined, 'lucky_win'), 'kid');
  assert.equal(resolveCharacter('whoever', 'rage_quit'), 'grandma'); // unknown ids fall back to auto
});

test('for unclassified moments the cast rotates and never repeats the last voice', () => {
  for (let i = 0; i < 100; i++) {
    const last = ROTATE[i % ROTATE.length];
    assert.notEqual(resolveCharacter('auto', 'general', last), last);
  }
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(resolveCharacter('auto', 'general', null));
  assert.deepEqual([...seen].sort(), [...ROTATE].sort()); // everyone gets a turn
});

test('a session remembers who spoke last', () => {
  const s = new Session();
  assert.equal(s.lastCharacter, null);
  s.lastCharacter = 'kid';
  assert.equal(s.lastCharacter, 'kid');
});

// ---------- how a character writes ----------
test('a character adds a section to the prompt; Classic leaves the prompt unchanged', () => {
  const kid = buildSystemPrompt('crash', 'kid');
  assert.match(kid, /## Your character: Hyper Kid/);
  assert.match(kid, /over-excited kid/);
  assert.match(kid, /was it a MONSTER/i);
  assert.match(kid, /braked for a pigeon/i); // the normal humor examples are still there
  const classic = buildSystemPrompt('crash', 'classic');
  assert.doesNotMatch(classic, /Your character/);
  assert.equal(buildSystemPrompt('crash'), classic);
  assert.equal(characterSection('classic'), '');
  assert.equal(characterSection('nope'), '');
});

test("a character's own sample lines are protected by the copy guard", () => {
  assert.ok(castExamples().length >= 12);
  assert.equal(copiesExample("He's in the ocean again, folks! Unbelievable scenes!"), true);
  assert.equal(copiesExample('Fresh joke about wobbling spaghetti legs.'), false);
});

// ---------- the picker data ----------
test('the public cast lists every character in order and exposes no voice ids or prompts', () => {
  const list = publicCast();
  assert.deepEqual(list.map((c) => c.id), ORDER);
  for (const c of list) {
    assert.deepEqual(Object.keys(c).sort(), ['hue', 'icon', 'id', 'name', 'sample', 'tagline']);
    assert.equal(c.sample, `cast/${c.id}.mp3`);
  }
});

test('every character has a recorded voice sample for the picker', () => {
  for (const id of CHARACTER_IDS) {
    assert.ok(existsSync(new URL(`../client/cast/${id}.mp3`, import.meta.url)), `client/cast/${id}.mp3 is missing (run scripts/make-cast-samples.mjs)`);
  }
});

// ---------- choosing a voice from an account's voices ----------
const V = (name, labels = {}, category = 'premade') => ({ name, voice_id: `id-${name}`, labels, category });
const VOICES = [
  V('Roger - Laid-Back', { gender: 'male', age: 'middle_aged' }),
  V('Daniel - Steady Broadcaster', { gender: 'male', accent: 'british' }),
  V('Jessica - Playful', { gender: 'female', age: 'young' }),
  V('Lily - Velvety Actress', { gender: 'female', age: 'middle_aged' }),
  V('Custom Thing', { gender: 'female', age: 'old' }, 'cloned'),
];

test('chooseVoice takes the first preferred name that exists (prefix, any case)', () => {
  assert.equal(chooseVoice(VOICES, { prefer: ['daniel'] }).name, 'Daniel - Steady Broadcaster');
  assert.equal(chooseVoice(VOICES, { prefer: ['Nobody', 'Lily', 'Roger'] }).name, 'Lily - Velvety Actress'); // order matters
});

test('chooseVoice falls back to the best label match, then to any premade voice', () => {
  assert.equal(chooseVoice(VOICES, { prefer: ['Nobody'], labels: { gender: 'female', age: 'young' } }).name, 'Jessica - Playful');
  assert.equal(chooseVoice(VOICES, { prefer: ['Nobody'], labels: { gender: 'robot' } }).name, 'Roger - Laid-Back'); // first premade
  assert.equal(chooseVoice([V('Only', {}, 'cloned')], { prefer: ['Nobody'] }).name, 'Only');
  assert.equal(chooseVoice([], { prefer: ['x'] }), null);
});

test('every character in the real cast finds a voice in an account that has the premade set', () => {
  for (const [id, c] of Object.entries(CHARACTERS)) assert.ok(chooseVoice(VOICES, c.voice), id);
});

// ---------- the report can compare voices ----------
test('the laugh report groups scores by character (older rows count as classic)', () => {
  const T = '2026-11-22T10:00:00Z';
  const roast = (id, character) => ({ ts: T, type: 'roast', id, tester: 'sam', session: 1, momentKind: 'crash', level: 'spicy', mode: 'self', character, roast: `r${id}`, moment: `m${id}`, roastStartMs: 1000 });
  const laugh = (id, laughScore) => ({ ts: T, type: 'laugh', id, laughScore });
  const a = analyze([roast('1', 'kid'), laugh('1', 3), roast('2', 'kid'), laugh('2', 3), roast('3', undefined), laugh('3', 1), roast('4', 'classic'), laugh('4', 1)]);
  const by = Object.fromEntries(a.byCharacter.map((r) => [r.key, r]));
  assert.equal(by.kid.avg, 3);
  assert.equal(by.classic.roasts, 2); // the untagged row and the explicit classic row
  assert.equal(by.classic.avg, 1);
  assert.equal(a.byCharacter[0].key, 'classic'); // weakest first
});

// ---------- keeping each character in voice ----------
import { matchesVoice, dropOffVoice, voiceHint } from '../server/cast.js';
import { buildUserPrompt, selectSelf, isStock } from '../server/humor.js';

test("each character's own sample lines match its signature (the check agrees with the hand-written examples)", () => {
  for (const id of ['announcer', 'tired', 'kid', 'grandma']) {
    for (const line of CHARACTERS[id].examples) assert.ok(matchesVoice(id, line), `${id}: "${line}" should be in voice`);
  }
});

test('Classic has no signature, so everything is in its voice', () => {
  assert.equal(matchesVoice('classic', 'anything at all'), true);
  assert.deepEqual(dropOffVoice(['a', 'b'], 'classic'), ['a', 'b']);
});

test('lines that are off-voice are dropped, but never all of them', () => {
  const lines = ['A plain joke about the ocean.', 'Oh dear, the ocean again, sweetheart.'];
  assert.deepEqual(dropOffVoice(lines, 'grandma'), ['Oh dear, the ocean again, sweetheart.']);
  assert.deepEqual(dropOffVoice(['No signature here.'], 'grandma'), ['No signature here.']); // nothing in voice: keep all
  assert.equal(matchesVoice('kid', 'Whoa that was big'), true);
  assert.equal(matchesVoice('kid', 'That was big!'), true);
  assert.equal(matchesVoice('announcer', 'He drove into the ocean again.'), false);
  assert.equal(matchesVoice('announcer', "And he's in the ocean again."), true);
  assert.equal(matchesVoice('announcer', 'The crowd goes wild.'), true);
});

test('self-pick prefers the roast that is in the character voice, even over the writer\'s own pick', () => {
  const raw = JSON.stringify({ roasts: ['A plain joke here.', 'Oh dear, sweetheart, that car needs swimming lessons.', 'Another plain joke.'], best: 1 });
  const r = selectSelf(raw, 'grandma');
  assert.deepEqual(r.candidates, ['Oh dear, sweetheart, that car needs swimming lessons.']);
  assert.equal(r.pickedBy, 'only');
  assert.equal(selectSelf(raw, 'classic').candidates.length, 3); // Classic keeps everything
});

test('the request tells the writer to stay in character, and Classic gets no such line', () => {
  const ctx = { momentType: 'typed', moment: 'I crashed the car' };
  const grandma = buildUserPrompt(ctx, 'spicy', 'crash', null, false, 'self', 'grandma');
  assert.match(grandma, /Voice: every roast must sound like Grandma/);
  assert.match(grandma, /sweetheart/);
  assert.doesNotMatch(buildUserPrompt(ctx, 'spicy', 'crash', null, false, 'self', 'classic'), /Voice:/);
  assert.doesNotMatch(buildUserPrompt(ctx, 'spicy', 'crash', null, false, 'self'), /Voice:/);
  assert.ok(voiceHint('tired').includes('Great.'));
});

test('the stock-phrase filter catches the variants that slipped past on Day 6', () => {
  for (const s of ['The official ocean entry ceremony happens again.', 'Neighbors just filed noise and damage complaints.',
    "The controller's divorce papers are ready.", 'Fish are filing restraining orders now.', 'Official calm down ceremony canceled.']) {
    assert.equal(isStock(s), true, s);
  }
  for (const s of ['Third ocean dive, the car thinks it is a fish.', 'Whoa, the ocean expects you now!']) assert.equal(isStock(s), false, s);
});
