// RoastCast humor engine - Stage 1, Day 3
// Pure logic (no network): moment types, prompt building from the humor guide,
// candidate cleaning and validation, and per-session memory for callbacks.
// The model calls themselves live in roaster.js.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HUMOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'humor');
const GUIDE = readFileSync(path.join(HUMOR_DIR, 'guide.md'), 'utf8').trim();
export const MOMENTS = JSON.parse(readFileSync(path.join(HUMOR_DIR, 'moments.json'), 'utf8')).types;

export const MAX_WORDS = 15;
export const MOMENT_TYPES = ['crash', 'scream', 'silence', 'lucky_win', 'rage_quit', 'panic'];
// What the browser may send as `momentType`. 'speech' and 'typed' are classified from the words.
export const ACCEPTED_TYPES = new Set([...MOMENT_TYPES, 'speech', 'typed']);

export const LEVELS = {
  gentle: 'GENTLE: a proud friend watching you struggle. Warm, light, affectionate.',
  spicy: 'SPICY: sharper punchlines and bigger exaggeration, still playful.',
  savage: 'SAVAGE: big, theatrical, over the top. Aimed at the gameplay only.',
};

// ---------- text helpers ----------
export const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;

export function cleanRoast(text) {
  return String(text || '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Hard cap in code, not only in the prompt. Cut at 15 words and end cleanly.
export function capWords(text, max = MAX_WORDS) {
  const words = text.split(/\s+/);
  if (words.length <= max) return text;
  return words.slice(0, max).join(' ').replace(/[,;:\-—]+$/, '') + '.';
}

// ---------- classify a moment ----------
// Order matters: the first rule that matches wins.
const RULES = [
  ['rage_quit', /\b(rage ?quit\w*|quit(ting)?|uninstall\w*|i'?m done|i am done|never (playing|again)|delete the game)\b/i],
  ['panic', /\b(panic\w*|oh no|no no no|help me|help|run away|running away|hide|hiding|freaking out|i'?m dead|about to die)\b/i],
  ['lucky_win', /\b(won|win|winning|victory|clutch|lucky|luck|champion|first place|let'?s go|no way|how did i)\b/i],
  ['scream', /\b(scream\w*|yell\w*|shout\w*|shriek\w*)\b/i],
  ['silence', /\b(silent|silence|quiet|stared|staring|froze|frozen|standing there|not moving)\b/i],
  ['crash', /\b(crash\w*|drove|driving|collided|wrecked|flipped|exploded|explosion|fell off|ran into|hit a|ocean|wall)\b/i],
];

export function classifyMoment(text) {
  for (const [type, re] of RULES) if (re.test(text || '')) return type;
  return 'general';
}

// The type the roast writer will use for this request.
export function resolveType({ momentType, moment }) {
  if (MOMENT_TYPES.includes(momentType)) return momentType;
  return classifyMoment(moment);
}

export function describeMoment({ momentType, moment, seconds }) {
  if (momentType === 'speech') return `The player just said: "${moment}"`;
  if (moment) return moment;
  switch (momentType) {
    case 'scream': return 'The player just let out a loud scream or shout.';
    case 'crash': return 'A sudden loud crash or bang just happened.';
    case 'silence': return `The player has gone completely silent for ${seconds || 8} seconds.`;
    default: return 'Something just happened.';
  }
}

// ---------- prompts ----------
const exampleLine = (e) => `- Moment: ${e.moment} | Level: ${e.level} | Roast: ${e.roast}`;

function examplesFor(type) {
  const own = MOMENTS[type]?.examples || [];
  if (own.length) return own;
  // "general": one example from every type so the model sees the range
  return MOMENT_TYPES.map((t) => MOMENTS[t].examples[1] || MOMENTS[t].examples[0]).filter(Boolean);
}

export function buildSystemPrompt(type) {
  const m = MOMENTS[type] || MOMENTS.general;
  return [
    GUIDE,
    `## This moment: ${m.label}`,
    'Joke shapes that work for it (use a different one for each of your three roasts):',
    ...m.shapes.map((s) => `- ${s}`),
    'Hand-written examples (copy the quality and the length, never the words):',
    ...examplesFor(type).map(exampleLine),
  ].join('\n');
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function buildUserPrompt(ctx, level, type, session, strict = false) {
  const lines = [`Roast level: ${LEVELS[level]}`, `Moment: ${describeMoment(ctx)}`];
  if (ctx.transcript) lines.push(`Heard in the last 30 seconds (oldest first): "${ctx.transcript}"`);
  const memory = session ? session.summary(type) : '';
  if (memory) lines.push(memory);
  lines.push(
    `Write 3 different roasts of this moment. Each one uses a different joke shape, is specific to this exact moment, ` +
      `and is short: ideally 6 to 11 words, never more than ${MAX_WORDS}.`,
    'Reply with JSON only: {"roasts":["...","...","..."]}',
  );
  if (strict) lines.push(`Your last attempt was too long. Every roast must be under 12 words.`);
  return lines.join('\n');
}

export const PICK_SYSTEM =
  'You are the editor of a comedy writing room. Choose the single funniest roast for the moment. ' +
  'The best one is specific to the moment, short, and lands on its last word. ' +
  'If two are close, pick the shorter one. Reply with JSON only: {"best": 1}, {"best": 2} or {"best": 3}.';

export function buildPickPrompt(ctx, candidates) {
  return `Moment: ${describeMoment(ctx)}\n` + candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
}

// ---------- candidates ----------
export function parseCandidates(raw) {
  let list = [];
  try {
    const data = JSON.parse(raw);
    list = Array.isArray(data) ? data : data.roasts || data.candidates || Object.values(data).flat();
  } catch {
    list = String(raw || '').split('\n'); // model ignored JSON: take one roast per line
  }
  return list
    .map((x) => cleanRoast(typeof x === 'string' ? x.replace(/^\s*(\d+[.)]|-)\s*/, '') : ''))
    .filter(Boolean);
}

// Keep only roasts inside the word limit, de-duplicated. Order is preserved.
export function validCandidates(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = c.toLowerCase();
    if (seen.has(key) || countWords(c) > MAX_WORDS) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// The model sometimes lifts a line from the hand-written examples. Drop candidates that share
// a run of 4 words with any example, but only if a fresh candidate is left to pick from.
const words4 = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const grams = (s) => {
  const w = words4(s);
  const out = [];
  for (let i = 0; i + 4 <= w.length; i++) out.push(w.slice(i, i + 4).join(' '));
  return out;
};
const EXAMPLE_GRAMS = new Set(
  Object.values(MOMENTS).flatMap((m) => m.examples).flatMap((e) => grams(e.roast)),
);
export const copiesExample = (c) => grams(c).some((g) => EXAMPLE_GRAMS.has(g));

export function dropCopies(list) {
  const fresh = list.filter((c) => !copiesExample(c));
  return fresh.length ? fresh : list;
}

// Fallback when the pick step fails: the shortest candidate wins (first one on a tie).
export function rulePick(list) {
  let best = 0;
  list.forEach((c, i) => { if (countWords(c) < countWords(list[best])) best = i; });
  return best;
}

export function parsePick(raw, count) {
  try {
    const n = Number(JSON.parse(raw).best);
    if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1;
  } catch { /* fall through */ }
  const m = String(raw || '').match(/[1-9]/);
  if (m && Number(m[0]) <= count) return Number(m[0]) - 1;
  return -1;
}

// ---------- session memory (running jokes) ----------
export class Session {
  constructor() {
    this.events = []; // { type, moment, roast }
    this.counts = {};
    this.touched = Date.now();
  }

  record(type, moment, roast) {
    this.events.push({ type, moment: moment.slice(0, 80), roast });
    if (this.events.length > 8) this.events.shift();
    this.counts[type] = (this.counts[type] || 0) + 1;
    this.touched = Date.now();
  }

  // Text added to the prompt so the writer can call back to earlier moments.
  summary(type) {
    if (!this.events.length) return '';
    const lines = ['Earlier in this session (oldest first):'];
    this.events.slice(-5).forEach((e, i) => lines.push(`${i + 1}. ${e.moment}  -> you said: "${e.roast}"`));
    const seen = this.counts[type] || 0;
    if (seen >= 1 && type !== 'general') {
      lines.push(`This is the ${ordinal(seen + 1)} ${(MOMENTS[type]?.label || type).replace(/^an? /, '')} this session. A callback may fit.`);
    }
    lines.push('Do not reuse any joke or phrase from those earlier roasts. Only call back if it is natural.');
    return lines.join('\n');
  }
}

export class SessionStore {
  constructor(max = 200, ttlMs = 2 * 60 * 60 * 1000) {
    this.map = new Map();
    this.max = max;
    this.ttl = ttlMs;
  }

  get(id) {
    const key = String(id || 'anon').slice(0, 64);
    const now = Date.now();
    for (const [k, s] of this.map) if (now - s.touched > this.ttl) this.map.delete(k);
    let s = this.map.get(key);
    if (!s) {
      s = new Session();
      this.map.set(key, s);
      if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    }
    return s;
  }
}
