import test from 'node:test';
import assert from 'node:assert/strict';
import { MomentDetector } from '../client/detector.js';

// Feed `n` frames of the same level, 100 ms apart, starting at `t`. Returns the new time.
function frames(d, t, n, rms, peak = rms) {
  for (let i = 0; i < n; i++) { t += 100; d.feed(rms, peak, t); }
  return t;
}
const make = (o) => {
  const moments = [];
  const d = new MomentDetector({ ...o, onMoment: (m) => moments.push(m) });
  return { d, moments };
};

test('normal talking does not trigger a moment', () => {
  const { d, moments } = make();
  frames(d, 0, 60, 0.07);
  assert.equal(moments.length, 0);
});

test('loud but steady talking (a hot microphone) is not a scream', () => {
  const { d, moments } = make();
  frames(d, 0, 10, 0.005);
  frames(d, 1000, 60, 0.26, 0.85); // six seconds of full-volume speech
  assert.equal(moments.length, 0);
});

test('sustained loud audio is a scream (fires early, once)', () => {
  const { d, moments } = make();
  let t = frames(d, 0, 10, 0.06);
  t = frames(d, t, 8, 0.6);
  assert.deepEqual(moments.map((m) => m.type), ['scream']);
});

test('a short sharp spike out of quiet is a crash', () => {
  const { d, moments } = make();
  let t = frames(d, 0, 10, 0.01);
  t = frames(d, t, 1, 0.7, 0.95);
  frames(d, t, 3, 0.02);
  assert.deepEqual(moments.map((m) => m.type), ['crash']);
});

test('a bang while the player is talking is still a crash', () => {
  const { d, moments } = make();
  let t = frames(d, 0, 40, 0.08, 0.3); // steady talking
  t = frames(d, t, 1, 0.55, 0.97); // sudden bang
  frames(d, t, 5, 0.08, 0.3); // back to talking
  assert.deepEqual(moments.map((m) => m.type), ['crash']);
});

test('speech that starts loudly and keeps going is not a crash', () => {
  const { d, moments } = make();
  let t = frames(d, 0, 10, 0.005);
  t = frames(d, t, 1, 0.32, 0.6); // loud first syllable...
  t = frames(d, t, 20, 0.12, 0.4); // ...then ordinary talking
  assert.equal(moments.length, 0);
});

test('8 seconds of quiet is a silence moment, only once per silence', () => {
  const { d, moments } = make();
  let t = frames(d, 0, 5, 0.08);
  t = frames(d, t, 120, 0.002); // 12 s of quiet
  assert.equal(moments.length, 1);
  assert.equal(moments[0].type, 'silence');
  assert.ok(moments[0].seconds >= 8);
});

test('a spoken line of 4+ words fires when the player stops talking', () => {
  const { d, moments } = make();
  d.speech('I cannot believe', { final: true }, 1000);
  d.speech('I just crashed again', { final: true, speechFinal: true }, 2000);
  assert.equal(moments.length, 1);
  assert.equal(moments[0].type, 'speech');
  assert.equal(moments[0].text, 'I cannot believe I just crashed again');
});

test('short lines (under 4 words) are ignored', () => {
  const { d, moments } = make();
  d.speech('oh no', { final: true, speechFinal: true }, 1000);
  assert.equal(moments.length, 0);
});

test('cooldown blocks a second moment, then allows one after it ends', () => {
  const { d, moments } = make();
  d.speech('this is the first line', { final: true, speechFinal: true }, 1000);
  d.speech('this is the second line', { final: true, speechFinal: true }, 5000);
  assert.equal(moments.length, 1);
  d.speech('this is the third line', { final: true, speechFinal: true }, 12000);
  assert.equal(moments.length, 2);
});

test('disabled detector (roast playing) ignores everything', () => {
  const { d, moments } = make();
  d.setEnabled(false, 0);
  let t = frames(d, 0, 10, 0.7);
  d.speech('should be ignored entirely', { final: true, speechFinal: true }, t);
  assert.equal(moments.length, 0);
  d.setEnabled(true, t);
  d.speech('now this one counts for real', { final: true, speechFinal: true }, t + 100);
  assert.equal(moments.length, 1);
});
