import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import {
  SFX, VOICE_LINES, CHARACTER_LABEL, bankFiles, sfxFile, voiceFile, pickPre, pickBed, pickSting, pickScore,
} from '../client/soundbank.js';
import { scheduleTimes } from '../client/mixer.js';
import { CHARACTER_IDS } from '../server/cast.js';
import { MOMENT_TYPES } from '../server/humor.js';
import { analyze } from '../server/laugh.js';

const TYPES = [...MOMENT_TYPES, 'general'];
const LEVELS = ['gentle', 'spicy', 'savage'];
const fileOf = (rel) => new URL(`../client/${rel}`, import.meta.url);
// a repeatable "random": cycles through the numbers given
const seq = (...nums) => { let i = 0; return () => nums[i++ % nums.length]; };

// ---------- the bank itself ----------
test('the bank has 24 effects and 14 voice lines, and every one has a real audio file', () => {
  assert.equal(Object.keys(SFX).length, 24);
  assert.equal(Object.keys(VOICE_LINES).length, 14);
  for (const id of Object.keys(SFX)) {
    assert.ok(existsSync(fileOf(sfxFile(id))), `${sfxFile(id)} is missing (run scripts/make-sounds.mjs)`);
    assert.ok(statSync(fileOf(sfxFile(id))).size > 3000, `${id}: file is suspiciously small`);
  }
  for (const id of Object.keys(VOICE_LINES)) {
    assert.ok(existsSync(fileOf(voiceFile(id))), `${voiceFile(id)} is missing (run scripts/make-voice-lines.mjs)`);
    assert.ok(statSync(fileOf(voiceFile(id))).size > 2000, `${id}: file is suspiciously small`);
  }
  assert.equal(bankFiles().length, 38);
});

test('every effect is tagged with a label, a prompt, roles, moment types and levels', () => {
  for (const [id, s] of Object.entries(SFX)) {
    assert.ok(s.label && s.prompt, `${id}: label/prompt`);
    assert.ok(s.roles.length && s.roles.every((r) => ['open', 'sting', 'bed'].includes(r)), `${id}: roles`);
    assert.ok(s.types.length && s.types.every((t) => TYPES.includes(t)), `${id}: types`);
    assert.ok(s.levels.length && s.levels.every((l) => LEVELS.includes(l)), `${id}: levels`);
  }
});

test('every voice line is spoken by a real character, and every character has at least 2 lines', () => {
  for (const [id, v] of Object.entries(VOICE_LINES)) {
    assert.ok(CHARACTER_IDS.includes(v.character), `${id}: unknown character ${v.character}`);
    assert.ok(CHARACTER_LABEL[v.character], `${id}: no label`);
    assert.ok(v.text.split(/\s+/).length <= 3, `${id}: an interjection should be 1-3 words`);
  }
  for (const c of CHARACTER_IDS) {
    assert.ok(Object.values(VOICE_LINES).filter((v) => v.character === c).length >= 2, `${c} has fewer than 2 lines`);
  }
});

// ---------- picking the opening layers ----------
test('every moment type at every level gets an opening sound, which starts at t = 0', () => {
  for (const type of TYPES) for (const level of LEVELS) {
    const pre = pickPre({ type, level }, seq(0.1, 0.5, 0.9));
    assert.equal(pre[0].kind, 'sfx', `${type}/${level}`);
    assert.equal(pre[0].at, 0, 'the first layer must start immediately: layering never delays the first sound');
    assert.ok(SFX[pre[0].id].roles.includes('open'));
  }
});

test('the interjection comes from ANOTHER character than the one speaking the roast', () => {
  for (const main of CHARACTER_IDS) for (const type of TYPES) {
    const pre = pickPre({ type, main, level: 'spicy' }, seq(0.05, 0.4, 0.8));
    for (const layer of pre.filter((l) => l.kind === 'voice')) {
      assert.notEqual(VOICE_LINES[layer.id].character, main, `${main} interrupted itself on ${type}`);
    }
  }
});

test('the interjection joins about 300 ms in, after the opener has started', () => {
  const pre = pickPre({ type: 'crash', main: 'announcer' }, seq(0.1, 0.5, 0.2, 0.3));
  const line = pre.find((l) => l.kind === 'voice');
  assert.ok(line, 'expected an interjection');
  assert.ok(line.at >= 280 && line.at < 400, `at = ${line.at}`);
  assert.ok(pre[0].at < line.at);
});

test('about 15% of roasts skip the interjection, so it stays a surprise', () => {
  const none = pickPre({ type: 'crash', main: 'announcer' }, seq(0.1, 0.99, 0.5)); // the 2nd draw is the 85% gate
  assert.equal(none.filter((l) => l.kind === 'voice').length, 0);
});

test('the same opener and the same line never repeat back to back when there is a choice', () => {
  for (let i = 0; i < 60; i++) {
    const a = pickPre({ type: 'crash', main: 'announcer', level: 'spicy' });
    const open = a.find((l) => l.kind === 'sfx').id;
    const line = a.find((l) => l.kind === 'voice')?.id;
    const b = pickPre({ type: 'crash', main: 'announcer', level: 'spicy', last: { open, line } });
    assert.notEqual(b.find((l) => l.kind === 'sfx').id, open);
    if (line && b.find((l) => l.kind === 'voice')) assert.notEqual(b.find((l) => l.kind === 'voice').id, line);
  }
});

test('the level changes the mood: savage gets big sounds, gentle gets soft ones', () => {
  const ids = (level) => new Set(Array.from({ length: 80 }, () => pickPre({ type: 'crash', level })[0].id));
  assert.ok(ids('savage').has('crash') || ids('savage').has('ooh1'));
  assert.ok(!ids('gentle').has('crash')); // "crash" is spicy/savage only
  assert.ok(ids('gentle').has('aww') || ids('gentle').has('splash') || ids('gentle').has('gasp1'));
});

// ---------- the bed and the sting ----------
test('only a silence gets a quiet bed under the roast', () => {
  for (const type of TYPES) {
    const bed = pickBed({ type, level: 'spicy' });
    if (type === 'silence') {
      assert.equal(bed.id, 'tumbleweed');
      assert.ok(bed.gain <= 0.35, 'a bed must stay quiet under the voice');
    } else {
      assert.equal(bed, null, type);
    }
  }
});

test('the sting plays for about 7 in 10 roasts, comes just after the last word, and never repeats', () => {
  assert.equal(pickSting({ type: 'crash' }, () => 0.99), null);
  const s = pickSting({ type: 'crash', level: 'spicy' }, seq(0.1, 0.5, 0.5));
  assert.ok(s && SFX[s.id].roles.includes('sting'));
  assert.ok(s.at >= 100 && s.at < 220, `at = ${s.at}`);
  assert.ok(s.gain < 1, 'a sting sits under the roast voice in loudness');
  for (let i = 0; i < 60; i++) {
    const first = pickSting({ type: 'crash', level: 'spicy' }, seq(0.1, 0.4, 0.4));
    const second = pickSting({ type: 'crash', level: 'spicy', last: { sting: first.id } }, seq(0.1, 0.4, 0.4));
    assert.notEqual(second.id, first.id);
  }
});

test('pickScore returns opening layers, a bed (or null) and a sting (or null)', () => {
  const score = pickScore({ type: 'silence', main: 'tired', level: 'gentle' }, seq(0.1));
  assert.ok(score.pre.length >= 1);
  assert.equal(score.bed.id, 'tumbleweed');
  assert.ok(score.sting === null || SFX[score.sting.id].roles.includes('sting'));
});

// ---------- the mixer's timeline ----------
test('scheduleTimes turns "ms from now" into absolute start times, in order', () => {
  const out = scheduleTimes([{ id: 'b', at: 300 }, { id: 'a', at: 0 }, { id: 'c' }], 1000);
  assert.deepEqual(out.map((l) => [l.id, l.startMs]), [['a', 1000], ['c', 1000], ['b', 1300]]);
});

// ---------- the report can compare layered with plain ----------
test('the laugh report groups scores by layered vs plain (older rows count as plain)', () => {
  const T = '2026-11-22T10:00:00Z';
  const roast = (id, layered) => ({ ts: T, type: 'roast', id, tester: 'sam', session: 1, momentKind: 'crash', level: 'spicy', mode: 'self', layered, roast: `r${id}`, moment: `m${id}`, roastStartMs: 1000 });
  const laugh = (id, laughScore) => ({ ts: T, type: 'laugh', id, laughScore });
  const a = analyze([roast('1', true), laugh('1', 3), roast('2', true), laugh('2', 2), roast('3', false), laugh('3', 1), roast('4', undefined), laugh('4', 1)]);
  const by = Object.fromEntries(a.bySound.map((r) => [r.key, r]));
  assert.equal(by.layered.avg, 2.5);
  assert.equal(by.plain.roasts, 2); // the explicit false and the old untagged row
  assert.equal(by.plain.avg, 1);
});
