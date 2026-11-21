// The voice cast - Stage 2, Day 6.
// Loads humor/cast.json and answers three questions:
//   who speaks this roast?          resolveCharacter()
//   how does that character write?  characterSection()
//   which ElevenLabs voice is it?   chooseVoice()
// Pure logic, no network, so it is tested without a server.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'humor', 'cast.json');
const DATA = JSON.parse(readFileSync(FILE, 'utf8'));

export const CHARACTERS = DATA.characters;
export const ORDER = DATA.order;
export const BY_MOMENT = DATA.byMoment;
export const ROTATE = DATA.rotate;
export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'classic';

export const isCharacter = (id) => Object.hasOwn(CHARACTERS, id);

// Who speaks this roast?
//   requested  'auto' (or anything unknown) | a character id | 'classic'
//   type       the moment type (crash, scream, silence, lucky_win, rage_quit, panic, general)
//   last       the character used for the previous roast in this session (rotation avoids repeating it)
export function resolveCharacter(requested, type, last = null, rand = Math.random) {
  if (isCharacter(requested)) return requested;
  if (BY_MOMENT[type]) return BY_MOMENT[type];
  const pool = ROTATE.length > 1 ? ROTATE.filter((c) => c !== last) : ROTATE; // no same voice twice in a row
  return pool[Math.floor(rand() * pool.length)];
}

// The writing instructions for a character (empty for "classic": the plain Stage 1 voice).
export function characterSection(id) {
  const c = CHARACTERS[id];
  if (!c || !c.style) return '';
  return [
    `## Your character: ${c.name}`,
    c.style,
    'The way this character talks (copy the voice, never the jokes or the words):',
    ...c.examples.map((e) => `- ${e}`),
    'Every roast you write must sound like this character, and still follow every rule above.',
  ].join('\n');
}

// Each character has a "signature": words and tics it must use (humor/cast.json). A roast that
// is not in the character's voice is dropped, but only if one that IS in voice is left to pick.
const SIGNATURES = Object.fromEntries(
  Object.entries(CHARACTERS).map(([id, c]) => [id, c.signature ? new RegExp(c.signature, 'i') : null]),
);
export const matchesVoice = (id, text) => !SIGNATURES[id] || SIGNATURES[id].test(text);
export function dropOffVoice(list, id) {
  const inVoice = list.filter((c) => matchesVoice(id, c));
  return inVoice.length ? inVoice : list;
}
export const voiceHint = (id) => CHARACTERS[id]?.hint || '';

// Every hand-written character line, so the copy guard can catch a model that lifts one.
export const castExamples = () => CHARACTER_IDS.flatMap((id) => CHARACTERS[id].examples);

// What the page needs to draw the picker (no voice ids, no prompts).
export function publicCast() {
  return ORDER.map((id) => {
    const c = CHARACTERS[id];
    return { id, name: c.name, tagline: c.tagline, icon: c.icon, hue: c.hue, sample: `cast/${id}.mp3` };
  });
}

// Pick the ElevenLabs voice for a character from the voices an account actually has.
//   1) the first name in spec.prefer that exists (prefix match, case-insensitive)
//   2) otherwise the best match on spec.labels (gender, age, accent...)
//   3) otherwise the first premade voice, otherwise the first voice
// Returns the voice object, or null when the list is empty.
export function chooseVoice(voices, spec = {}) {
  if (!voices?.length) return null;
  const lower = (s) => String(s || '').toLowerCase();
  for (const name of spec.prefer || []) {
    const hit = voices.find((v) => lower(v.name).startsWith(lower(name)));
    if (hit) return hit;
  }
  const labels = spec.labels || {};
  let best = null;
  let bestScore = 0;
  for (const v of voices) {
    const score = Object.entries(labels).filter(([k, val]) => lower(v.labels?.[k]) === lower(val)).length;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  if (best) return best;
  return voices.find((v) => v.category === 'premade') || voices[0];
}
