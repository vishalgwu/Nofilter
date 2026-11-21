import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { AudioTee } from '../server/speech.js';
import { percentile, summarize } from '../server/stats.js';
import { MODES, selectSelf, buildUserPrompt } from '../server/humor.js';
import { SOUNDS, REACTIONS, pickReaction } from '../client/fastlane.js';
import { MOMENT_TYPES } from '../server/humor.js';

// ---------- modes ----------
test('there are three roast modes', () => {
  assert.deepEqual(MODES, ['self', 'best', 'quick']);
});

test('each mode asks for the right thing', () => {
  const ctx = { momentType: 'typed', moment: 'I crashed the car' };
  const self = buildUserPrompt(ctx, 'spicy', 'crash', null, false, 'self');
  const best = buildUserPrompt(ctx, 'spicy', 'crash', null, false, 'best');
  const quick = buildUserPrompt(ctx, 'spicy', 'crash', null, false, 'quick');
  assert.match(self, /3 different roasts/);
  assert.match(self, /"best"/);
  assert.match(best, /3 different roasts/);
  assert.doesNotMatch(best, /"best"/);
  assert.match(quick, /ONE roast/);
  assert.doesNotMatch(quick, /JSON/);
});

test('selectSelf follows the writer\'s own choice', () => {
  const raw = JSON.stringify({ roasts: ['Alpha beta gamma.', 'Delta epsilon zeta.', 'Eta theta iota.'], best: 2 });
  const r = selectSelf(raw);
  assert.equal(r.candidates.length, 3);
  assert.equal(r.picked, 1);
  assert.equal(r.pickedBy, 'self');
});

test('selectSelf falls back to the shortest when the chosen roast is unusable', () => {
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
  const raw = JSON.stringify({ roasts: [long, 'Short one here.', 'A bit longer than that one.'], best: 1 });
  const r = selectSelf(raw);
  assert.deepEqual(r.candidates, ['Short one here.', 'A bit longer than that one.']);
  assert.equal(r.picked, 0);
  assert.equal(r.pickedBy, 'rule');
});

test('selectSelf copes with a missing or silly "best"', () => {
  const roasts = ['Alpha beta gamma delta.', 'Epsilon zeta.', 'Eta theta iota kappa.'];
  assert.equal(selectSelf(JSON.stringify({ roasts })).picked, 1); // shortest
  assert.equal(selectSelf(JSON.stringify({ roasts, best: 9 })).pickedBy, 'rule');
  assert.equal(selectSelf(JSON.stringify({ roasts: ['Only one here.'], best: 1 })).pickedBy, 'only');
  assert.deepEqual(selectSelf('not json at all').candidates, ['not json at all']);
  assert.equal(selectSelf('').picked, -1);
});

// ---------- the audio tee (voice starts before the browser asks for it) ----------
test('AudioTee replays what arrived before a listener attached, then follows live', () => {
  const tee = new AudioTee();
  tee.push('a'); tee.push('b');
  const got = [];
  let ended = false;
  tee.subscribe({ onChunk: (c) => got.push(c), onEnd: () => { ended = true; } });
  assert.deepEqual(got, ['a', 'b']); // replayed at once
  tee.push('c');
  assert.deepEqual(got, ['a', 'b', 'c']); // then live
  assert.equal(ended, false);
  tee.end();
  assert.equal(ended, true);
});

test('AudioTee replays everything to a late listener, including after it has finished', () => {
  const tee = new AudioTee();
  tee.push('x'); tee.push('y'); tee.end();
  const got = [];
  let ended = 0;
  tee.subscribe({ onChunk: (c) => got.push(c), onEnd: () => { ended++; } });
  assert.deepEqual(got, ['x', 'y']);
  assert.equal(ended, 1);
});

test('AudioTee passes an error to listeners and an unsubscribed listener hears nothing more', () => {
  const tee = new AudioTee();
  const got = [];
  const off = tee.subscribe({ onChunk: (c) => got.push(c), onEnd: () => {} });
  tee.push('1');
  off();
  tee.push('2');
  assert.deepEqual(got, ['1']);
  let err = null;
  tee.subscribe({ onChunk: () => {}, onEnd: (e) => { err = e; } });
  tee.end(new Error('boom'));
  assert.equal(err.message, 'boom');
});

// ---------- speed report maths ----------
test('percentile uses nearest rank and ignores junk', () => {
  const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 90), 90);
  assert.equal(percentile(v, 100), 100);
  assert.equal(percentile([5], 90), 5);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([3, NaN, undefined, 1, 2], 50), 2);
});

test('summarize reports the count, median and p90', () => {
  assert.deepEqual(summarize([100, 200, 300, 400, 500]), { n: 5, p50: 300, p90: 500 });
  assert.deepEqual(summarize([]), { n: 0, p50: null, p90: null });
});

// ---------- fast lane ----------
test('every moment type has a reaction, and every reaction is a real sound with a file', () => {
  for (const t of [...MOMENT_TYPES, 'default']) assert.ok(REACTIONS[t]?.length, `no reaction for ${t}`);
  for (const names of Object.values(REACTIONS)) {
    for (const n of names) {
      assert.ok(SOUNDS[n], `${n} is not in SOUNDS`);
      assert.ok(existsSync(new URL(`../client/sounds/${n}.mp3`, import.meta.url)), `client/sounds/${n}.mp3 is missing`);
    }
  }
});

test('pickReaction never repeats the previous reaction when there is a choice', () => {
  for (let i = 0; i < 50; i++) assert.notEqual(pickReaction('crash', 'gasp1'), 'gasp1');
  assert.equal(pickReaction('silence', 'crickets'), 'crickets'); // only one option: repeating is fine
  assert.ok(REACTIONS.default.includes(pickReaction('typed')));
  assert.ok(REACTIONS.default.includes(pickReaction('speech')));
});
