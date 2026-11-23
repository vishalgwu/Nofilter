// RoastCast client - Stage 1, Day 1
// typed moment -> /api/roast (OpenAI) -> /api/speak (streamed voice) -> played here.
// Also: mic permission + live input-level meter (ready for Day 2).

import { MomentDetector } from './detector.js';
import { pickReaction } from './fastlane.js';
import { bankFiles, pickPre, pickBed, pickSting } from './soundbank.js';
import { Mixer } from './mixer.js';

const $ = (id) => document.getElementById(id);

const MOMENTS = [
  { label: 'Crash', type: 'crash', c: '#ff8a1f', text: 'I drove straight into the ocean for the third time.' },
  { label: 'Scream', type: 'scream', c: '#ff3d81', text: 'I screamed at a jump scare and threw my controller.' },
  { label: 'Silence', type: 'silence', c: '#7b8cff', text: 'I stared at the same door for a full minute without moving.' },
  { label: 'Lucky win', type: 'lucky_win', c: '#3ddc97', text: 'I won the match with one health and zero idea how.' },
  { label: 'Rage quit', type: 'rage_quit', c: '#ff5c6c', text: 'I rage quit right before the final boss.' },
  { label: 'Panic', type: 'panic', c: '#ffb347', text: 'I panicked and healed the enemy team.' },
];
const LEVEL_HINTS = {
  gentle: 'Friendly teasing, like a proud friend watching you struggle.',
  spicy: 'Sharper punchlines, more exaggeration, still playful.',
  savage: 'Big, theatrical, over the top. Gameplay only.',
};
const LEVEL_INDEX = { gentle: 0, spicy: 1, savage: 2 };
const GOAL_MS = 1500;
const LIMIT_MS = 3000;

const el = {
  moment: $('moment'), count: $('count'), chips: $('chips'), seg: $('seg'), levelHint: $('levelHint'),
  roastBtn: $('roastBtn'), micBtn: $('micBtn'), micLabel: $('micLabel'), micStatus: $('micStatus'),
  meter: $('meter'), meterWrap: $('meterWrap'), stage: $('stage'), liveText: $('liveText'),
  roast: $('roast'), vReact: $('vReact'), vWrite: $('vWrite'), vVoice: $('vVoice'), vFirst: $('vFirst'),
  statReact: $('statReact'), statWrite: $('statWrite'), statVoice: $('statVoice'), statFirst: $('statFirst'),
  budgetBar: $('budgetBar'), modeSeg: $('modeSeg'), modeHint: $('modeHint'),
  rate: $('rate'), replayBtn: $('replayBtn'), copyBtn: $('copyBtn'),
  historyWrap: $('historyWrap'), hist: $('hist'), histCount: $('histCount'),
  status: $('status'), statusText: $('statusText'), toast: $('toast'), kbdHint: $('kbdHint'),
  autoToggle: $('autoToggle'), cooldownTag: $('cooldownTag'), captions: $('captions'), trigger: $('trigger'),
  testbar: $('testbar'), tester: $('tester'), sessionLabel: $('sessionLabel'), newSession: $('newSession'),
  sessionStats: $('sessionStats'), cast: $('cast'), voiceHint: $('voiceHint'),
  speaker: $('speaker'), speakerAv: $('speakerAv'), speakerName: $('speakerName'),
  mixLine: $('mixLine'), layersToggle: $('layersToggle'), layersHint: $('layersHint'),
};

// localStorage can be blocked (private windows), so every use is wrapped.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
// Test sessions (Day 5): open the page with ?test=1 to show the tester bar. ?test=0 turns it off again.
const testParam = new URLSearchParams(location.search).get('test');
if (testParam === '1') store.set('rc_test', '1');
if (testParam === '0') store.del('rc_test');

const state = {
  level: 'spicy', busy: false, current: null, history: [], toastTimer: 0, transcript: [],
  chipType: null, // the moment type of the quick-pick chip, until the text is edited
  character: store.get('rc_character') || 'auto', // who speaks: 'auto' lets the moment decide
  hue: 36, // colour of the speaking character (the ring, the glow, the last word)
  layers: store.get('rc_layers') !== '0', // Stage 2: sound layers on (default) or just the single reaction
  byMoment: {}, // which character Auto uses for each moment type (from /api/cast)
  testMode: store.get('rc_test') === '1',
  tester: store.get('rc_tester') || '',
  session: 1, // set below from the tester's saved session number
  // How the roast is written: 'self' (best of 3) or 'quick' (one roast). ?mode=best tests the Day 3 judge.
  mode: ['self', 'quick', 'best'].includes(new URLSearchParams(location.search).get('mode'))
    ? new URLSearchParams(location.search).get('mode') : 'self',
  // One id per page load: the server uses it to remember running jokes for this session.
  sessionId: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2) + Date.now(),
};
const MOMENT_LABEL = {
  scream: 'Scream', crash: 'Crash', silence: 'Long silence', speech: 'Speech', typed: 'Typed',
  lucky_win: 'Lucky win', rage_quit: 'Rage quit', panic: 'Panic',
};

// The detector decides when a moment is worth a roast (see detector.js).
const detector = new MomentDetector({
  onMoment: (m) => { if (el.autoToggle.checked) roast(m); },
});
const armDetector = () => detector.setEnabled(el.autoToggle.checked && !!mic.stream, performance.now());
el.autoToggle.addEventListener('change', armDetector);

// What the player said in the last 30 seconds (final words only).
function recentTranscript() {
  const cutoff = performance.now() - 30000;
  state.transcript = state.transcript.filter((x) => x.t >= cutoff);
  return state.transcript.map((x) => x.text).join(' ').slice(-600);
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
el.kbdHint.innerHTML = (isMac ? '&#8984;' : 'Ctrl') + '&nbsp;&#8629;';

// ---------- one shared audio context ----------
const audio = new Audio();
audio.preload = 'auto';
let ctx = null;
let playAnalyser = null;
let mixer = null; // plays the sound bank layers (mixer.js)

function ensureAudioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const src = ctx.createMediaElementSource(audio);
    playAnalyser = ctx.createAnalyser();
    playAnalyser.fftSize = 256;
    playAnalyser.smoothingTimeConstant = 0.8;
    src.connect(playAnalyser);
    playAnalyser.connect(ctx.destination);
    mixer = new Mixer(ctx, playAnalyser);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// ---------- sound layers (Stage 2) ----------
// Every sound in the bank is decoded into memory at page load, so starting a layer takes a few milliseconds.
// A roast is a small score: an opening sound at t = 0 (it never delays anything), a one-word interjection from
// ANOTHER character a moment later, a quiet bed under the roast (some moments), and a sting after the last word.
const lastLayers = { open: null, line: null, sting: null }; // never the same sound twice in a row
let lastReaction = null;
let bedHandle = null;
const GAME_MOMENTS = ['crash', 'scream', 'silence', 'lucky_win', 'rage_quit', 'panic'];
const soundTypeOf = (momentType) => (GAME_MOMENTS.includes(momentType) ? momentType : 'general');

async function preloadBank() {
  ensureAudioContext(); // created suspended is fine: decoding does not need it running
  await mixer.load(bankFiles());
}

// "Sound layers" OFF: just the single reaction from Day 4.
function playReaction(type) {
  const name = pickReaction(type, lastReaction);
  const h = mixer?.start(name, { gain: 0.9 });
  if (!h) return null;
  lastReaction = name;
  return { picks: [], startedAt: h.startsAt, ended: h.ended, fadeOut: (ms) => h.stop(ms) };
}

// "Sound layers" ON: the opening layers, started the instant the roast is triggered.
function startPre(soundType, main) {
  const picks = pickPre({ type: soundType, main, level: state.level, last: lastLayers });
  const started = picks.map((p) => ({ p, h: mixer.start(p.id, { at: p.at, gain: p.gain }) })).filter((x) => x.h);
  if (!started.length) return null;
  for (const { p } of started) lastLayers[p.kind === 'voice' ? 'line' : 'open'] = p.id;
  return {
    picks: started.map((x) => x.p),
    startedAt: started[0].h.startsAt,
    ended: Promise.all(started.map((x) => x.h.ended)),
    fadeOut: (ms) => started.forEach((x) => x.h.stop(ms)), // the roast arrives: fade the openers out, never talk over them
  };
}

// ---------- helpers ----------
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => (el.toast.hidden = true), 5200);
}
const fmt = (ms) => (ms == null ? '--' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);
const grade = (ms, g = GOAL_MS, l = LIMIT_MS) => (ms <= g ? 'good' : ms <= l ? 'ok' : 'bad');
function setStage(s, label) {
  el.stage.dataset.state = s;
  el.liveText.textContent = label;
}
function setStat(node, valueEl, ms, g) {
  valueEl.textContent = fmt(ms);
  if (g) node.dataset.grade = g; else delete node.dataset.grade;
}
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
// Every log row carries who was testing and which session, so the laugh report can group them.
const log = (row) => post('/api/log', {
  ...row, ...(state.tester ? { tester: state.tester } : {}), session: state.session, sessionId: state.sessionId,
}).catch(() => {});

// ---------- compose UI ----------
MOMENTS.forEach((m) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.setAttribute('aria-pressed', 'false');
  b.style.setProperty('--c', m.c);
  b.innerHTML = `<i></i>${m.label}`;
  b.addEventListener('click', () => {
    el.moment.value = m.text;
    updateCount();
    state.chipType = m.type;
    el.chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    el.moment.focus();
  });
  el.chips.appendChild(b);
});

function updateCount() {
  el.count.textContent = `${el.moment.value.length} / 200`;
  autosize();
}
function autosize() {
  el.moment.style.height = 'auto';
  el.moment.style.height = Math.min(el.moment.scrollHeight, 180) + 'px';
}
el.moment.addEventListener('input', () => {
  updateCount();
  state.chipType = null;
  el.chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
});
el.moment.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); roast(); }
});

function setLevel(level) {
  state.level = level;
  el.seg.style.setProperty('--i', LEVEL_INDEX[level]);
  el.levelHint.textContent = LEVEL_HINTS[level];
}
el.seg.addEventListener('change', (e) => setLevel(e.target.value));
setLevel('spicy');

const MODE_INDEX = { self: 0, quick: 1 };
const MODE_HINTS = {
  self: 'Writes three takes and keeps its funniest.',
  quick: 'One take, straight away. Fastest.',
  best: 'Three takes, then a separate judge picks (slowest, test mode).',
};
function setMode(mode) {
  state.mode = mode;
  el.modeSeg.style.setProperty('--i', MODE_INDEX[mode] ?? 0);
  el.modeSeg.querySelectorAll('input').forEach((i) => { i.checked = i.value === mode; });
  el.modeHint.textContent = MODE_HINTS[mode];
}
el.modeSeg.addEventListener('change', (e) => setMode(e.target.value));
setMode(state.mode);

// "Sound layers": the full score (effects, a second voice, a sting) or just one quick reaction.
// Switching it off is how a layered roast is compared with a plain one.
function setLayers(on) {
  state.layers = on;
  store.set('rc_layers', on ? '1' : '0');
  el.layersToggle.checked = on;
  el.layersHint.textContent = on ? 'effects, a second voice and a sting' : 'one quick reaction only';
}
el.layersToggle.addEventListener('change', () => setLayers(el.layersToggle.checked));
setLayers(state.layers);
updateCount();

// ---------- roast flow ----------
function renderRoast(text) {
  const words = text.split(/\s+/).filter(Boolean);
  el.roast.innerHTML = '';
  const p = document.createElement('p');
  p.setAttribute('aria-label', text);
  words.forEach((w, i) => {
    const s = document.createElement('span');
    s.className = 'w' + (i === words.length - 1 ? ' last' : '');
    s.style.setProperty('--n', i);
    s.textContent = w + (i < words.length - 1 ? ' ' : '');
    p.appendChild(s);
  });
  el.roast.appendChild(p);
}

// After the roast ends, wait a beat (so the speaker tail is not heard) and listen again.
function afterSpeak(extras = null) {
  bedHandle?.stop(250);
  bedHandle = null;
  let tailMs = 0;
  const sting = extras?.sting;
  const h = sting && mixer?.start(sting.id, { at: sting.at, gain: sting.gain });
  if (h) {
    tailMs = Math.max(0, h.endsAt - performance.now());
    setStage('speaking', 'Sting');
    h.ended.then(() => { if (el.liveText.textContent === 'Sting') setStage('idle', 'Idle'); });
  } else {
    setStage('idle', 'Idle');
  }
  // wait for the sting too, so the microphone never hears our own sound effects
  setTimeout(() => { if (!state.busy && audio.paused) armDetector(); }, 1000 + tailMs);
}

function playRoast(id, t0, react = null, extras = null) {
  ensureAudioContext();
  detector.setEnabled(false, performance.now()); // never roast our own voice
  return new Promise((resolve) => {
    const tStart = performance.now();
    let done = false;
    const finish = (res) => { if (!done) { done = true; resolve(res); } };
    audio.onplaying = () => {
      const now = performance.now();
      react?.fadeOut(); // hand over from the opening layers to the roast
      if (extras?.bed) bedHandle = mixer?.start(extras.bed.id, { gain: extras.bed.gain });
      setStage('speaking', 'Speaking');
      finish({ voiceMs: now - tStart, roastStartMs: now - t0 });
    };
    audio.onended = () => afterSpeak(extras);
    audio.onerror = () => { afterSpeak(); toast('The voice could not play. Check the server log.'); finish(null); };
    audio.src = `/api/speak?id=${encodeURIComponent(id)}&_=${Date.now()}`;
    audio.play().catch((err) => { afterSpeak(); toast('Audio was blocked: ' + err.message); finish(null); });
  });
}

// roast()        -> roast the typed moment (button / Ctrl+Enter)
// roast(moment)  -> roast a moment the detector heard: { type, text?, seconds? }
async function roast(auto = null) {
  if (state.busy) return;
  const t0 = performance.now(); // the moment of the trigger: every timing below counts from here
  const typed = !auto;
  const moment = typed ? el.moment.value.trim() : auto.text || '';
  if (typed && moment.length < 3) { toast('Tell me what just happened first.'); el.moment.focus(); return; }
  if (needTester()) return;
  const momentType = typed ? state.chipType || 'typed' : auto.type;
  const shownMoment = typed ? moment : auto.type === 'speech' ? moment
    : auto.type === 'silence' ? `Silent for ${auto.seconds}s` : MOMENT_LABEL[auto.type];
  const transcript = typed ? '' : recentTranscript();

  state.busy = true;
  detector.setEnabled(false, performance.now());
  ensureAudioContext(); // unlock audio inside the click

  // FAST LANE: the reaction plays before anything slow happens.
  audio.pause();
  const soundType = soundTypeOf(momentType);
  // who will probably speak (so the interjection comes from someone else); Auto follows the moment
  const predictedMain = state.character !== 'auto' ? state.character : state.byMoment[soundType] || null;
  const react = state.layers ? startPre(soundType, predictedMain) : playReaction(momentType);
  const reactionMs = react ? Math.round(react.startedAt - t0) : null;
  if (react) {
    setStage('speaking', 'Reaction');
    react.ended.then(() => { if (el.liveText.textContent === 'Reaction') setStage('writing', 'Writing'); });
  } else {
    setStage('writing', 'Writing');
  }

  showTrigger(typed ? null : { type: momentType, text: moment, seconds: auto.seconds });
  el.roastBtn.disabled = true;
  el.roastBtn.classList.add('is-loading');
  el.roastBtn.querySelector('.btn-label').textContent = 'Writing';
  el.rate.hidden = true;
  [[el.statWrite, el.vWrite], [el.statVoice, el.vVoice], [el.statFirst, el.vFirst]].forEach(([n, v]) => setStat(n, v, null));
  setStat(el.statReact, el.vReact, reactionMs, reactionMs == null ? null : grade(reactionMs, 100, 250));
  el.budgetBar.style.width = '0';

  try {
    const r = await post('/api/roast', {
      moment, momentType, transcript, seconds: auto?.seconds, level: state.level, mode: state.mode,
      character: state.character, sessionId: state.sessionId,
    });
    renderRoast(r.roast);
    renderTakes(r);
    showSpeaker(r.character);
    // now the real moment type is known: pick the bed under the roast and the sting after it
    const extras = state.layers
      ? { bed: pickBed({ type: r.type, level: state.level }), sting: pickSting({ type: r.type, level: state.level, last: lastLayers }) }
      : null;
    if (extras?.sting) lastLayers.sting = extras.sting.id;
    showMixLine(state.layers ? react?.picks || [] : null, extras, r.character);
    setStat(el.statWrite, el.vWrite, r.llmMs, grade(r.llmMs, 800, 1500));
    el.replayBtn.disabled = false;
    el.copyBtn.disabled = false;
    state.current = { id: r.id, text: r.roast, level: r.level, moment: shownMoment, momentType, llmMs: r.llmMs, character: r.character };

    const t = await playRoast(r.id, t0, react, extras);
    if (t) {
      setStat(el.statVoice, el.vVoice, t.voiceMs, grade(t.voiceMs, 400, 1000));
      setStat(el.statFirst, el.vFirst, t.roastStartMs, grade(t.roastStartMs));
      el.budgetBar.style.width = Math.min(100, (t.roastStartMs / (LIMIT_MS * 2)) * 100) + '%';
      Object.assign(state.current, t, { firstSoundMs: t.roastStartMs });
      syncStageRating(state.current); // shows the "Did it make you laugh?" row, unscored
      addHistory(state.current);
      log({
        type: 'roast', id: r.id, level: r.level, mode: r.mode, character: r.character.id, momentType, momentKind: r.type, moment: shownMoment,
        roast: r.roast, candidates: r.candidates, picked: r.picked, pickedBy: r.pickedBy,
        detectMs: auto?.detectMs, reactionMs, promptMs: r.promptMs, firstTokenMs: r.firstTokenMs,
        candMs: r.candMs, pickMs: r.pickMs, llmMs: r.llmMs,
        voiceMs: Math.round(t.voiceMs), roastStartMs: Math.round(t.roastStartMs),
        layered: state.layers,
        layers: state.layers ? [...(react?.picks || []).map((x) => x.id), extras?.bed?.id, extras?.sting?.id].filter(Boolean) : [],
      });
    }
  } catch (err) {
    afterSpeak();
    toast(err.message);
  } finally {
    state.busy = false;
    el.roastBtn.disabled = false;
    el.roastBtn.classList.remove('is-loading');
    el.roastBtn.querySelector('.btn-label').textContent = 'Roast me';
  }
}
el.roastBtn.addEventListener('click', () => roast());

// What layered into this roast, in order: openers, the roast voice (over its bed), the sting.
// `pre` is null when Sound layers is off.
function showMixLine(pre, extras, c) {
  el.mixLine.innerHTML = '';
  if (pre == null) { el.mixLine.hidden = true; return; }
  const steps = [
    ...pre.map((p) => ({ k: p.kind, t: p.label })),
    { k: 'roast', t: `Roast: ${shortName(c.name)}${extras?.bed ? ` over ${extras.bed.label}` : ''}` },
    ...(extras?.sting ? [{ k: 'sting', t: extras.sting.label }] : []),
  ];
  for (const s of steps) {
    const sp = document.createElement('span');
    sp.className = `mix-step mix-${s.k}`;
    sp.textContent = s.t;
    el.mixLine.appendChild(sp);
  }
  el.mixLine.hidden = false;
}

// "Other takes": every candidate the writer produced, and which one the pick step chose.
function renderTakes(r) {
  const list = $('takesList');
  list.innerHTML = '';
  r.candidates.forEach((c, i) => {
    const li = document.createElement('li');
    if (i === r.picked) li.className = 'picked';
    const t = document.createElement('span');
    t.textContent = c;
    li.appendChild(t);
    if (i === r.picked) {
      const tag = document.createElement('em');
      tag.textContent = { self: 'its pick', judge: 'judge pick', rule: 'shortest', only: 'only take' }[r.pickedBy] || 'picked';
      li.appendChild(tag);
    }
    list.appendChild(li);
  });
  const n = r.candidates.length;
  $('takesSummary').textContent =
    `${n} take${n === 1 ? '' : 's'} · ${r.pickMs ? `write ${fmt(r.candMs)} + judge ${fmt(r.pickMs)}` : `write ${fmt(r.candMs)}`}`;
  $('takes').hidden = false;
  $('takes').open = false;
}

function showTrigger(t) {
  el.trigger.innerHTML = '';
  if (!t) { el.trigger.hidden = true; return; }
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = MOMENT_LABEL[t.type] || t.type;
  el.trigger.appendChild(tag);
  const note = document.createElement('span');
  if (t.type === 'speech') {
    note.append('you said ');
    const q = document.createElement('q');
    q.textContent = t.text.length > 90 ? t.text.slice(0, 90) + '...' : t.text;
    note.appendChild(q);
  } else {
    note.textContent = t.type === 'silence' ? `detected after ${t.seconds}s of quiet` : 'detected from the audio';
  }
  el.trigger.appendChild(note);
  el.trigger.hidden = false;
}

el.replayBtn.addEventListener('click', async () => {
  if (!state.current) return;
  renderRoast(state.current.text);
  setStage('writing', 'Loading voice');
  await playRoast(state.current.id, performance.now());
});
el.copyBtn.addEventListener('click', async () => {
  if (!state.current) return;
  try { await navigator.clipboard.writeText(state.current.text); toast('Copied.'); }
  catch { toast('Could not copy.'); }
});

// ----- laugh scores -----
// One place sets a score, so the stage row, the session list and the log always agree.
const SCORE_WORDS = ['no laugh', 'a smile', 'a real laugh', 'laughed out loud'];

function syncStageRating(item) {
  el.rate.hidden = false;
  el.rate.classList.toggle('is-done', item.laughScore != null);
  el.rate.querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-pressed', String(item.laughScore != null && Number(b.dataset.score) === item.laughScore)));
}

function setRating(item, score) {
  item.laughScore = score;
  item.ratingEl?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.score) === score)));
  if (state.current === item) syncStageRating(item);
  log({ type: 'laugh', id: item.id, laughScore: score });
  updateSessionStats();
}

el.rate.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-score]');
  if (b && state.current) setRating(state.current, Number(b.dataset.score));
});

function updateSessionStats() {
  const rated = state.history.filter((h) => h.laughScore != null);
  const avg = rated.length ? (rated.reduce((a, h) => a + h.laughScore, 0) / rated.length).toFixed(1) : '-';
  el.sessionStats.textContent = `${rated.length}/${state.history.length} rated · avg ${avg}`;
}

function addHistory(item) {
  state.history.unshift(item);
  el.historyWrap.hidden = false;
  el.histCount.textContent = `${state.history.length} roast${state.history.length === 1 ? '' : 's'}`;
  const li = document.createElement('li');
  const left = document.createElement('div');
  const t = document.createElement('div'); t.className = 't'; t.textContent = item.text;
  const m = document.createElement('div'); m.className = 'm';
  const tag = document.createElement('span'); tag.className = 'tag ' + item.level; tag.textContent = item.level;
  const who = document.createElement('span'); who.textContent = item.character?.name || '';
  const w = document.createElement('span'); w.className = 'mono'; w.textContent = `first sound ${fmt(item.firstSoundMs)}`;
  const mo = document.createElement('span'); mo.textContent = item.moment.length > 54 ? item.moment.slice(0, 54) + '...' : item.moment;
  m.append(tag, ...(who.textContent ? [who] : []), w, mo);

  // every roast can be scored 0-3, not only the latest one
  const rate = document.createElement('div');
  rate.className = 'hist-rate';
  rate.setAttribute('role', 'group');
  rate.setAttribute('aria-label', 'Laugh score');
  const lab = document.createElement('span');
  lab.textContent = 'Laugh?';
  rate.appendChild(lab);
  for (let s = 0; s <= 3; s++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.score = String(s);
    b.textContent = String(s);
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `Rate ${s}: ${SCORE_WORDS[s]}`);
    b.addEventListener('click', () => setRating(item, s));
    rate.appendChild(b);
  }
  item.ratingEl = rate;
  left.append(t, m, rate);

  const btn = document.createElement('button');
  btn.className = 'icon-btn'; btn.type = 'button'; btn.textContent = 'Play';
  btn.addEventListener('click', () => {
    state.current = item;
    renderRoast(item.text);
    syncStageRating(item);
    playRoast(item.id, performance.now());
  });
  li.append(left, btn);
  el.hist.prepend(li);
  updateSessionStats();
}

// ----- test sessions (Day 5): who is testing, and which session -----
function applyTester(name) {
  state.tester = name.trim().slice(0, 30);
  store.set('rc_tester', state.tester);
  state.session = Number(store.get('rc_session_' + state.tester)) || 1;
  updateSessionUI();
}
function updateSessionUI() {
  el.sessionLabel.textContent = `Session ${state.session}`;
  updateSessionStats();
}
function newSession() {
  state.session += 1;
  store.set('rc_session_' + state.tester, String(state.session));
  // a new session forgets the running jokes too, like a new group of friends would
  state.sessionId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2) + Date.now();
  state.history = [];
  state.current = null;
  state.transcript = [];
  el.hist.innerHTML = '';
  el.historyWrap.hidden = true;
  el.rate.hidden = true;
  updateSessionUI();
}
el.tester.addEventListener('change', () => applyTester(el.tester.value));
el.newSession.addEventListener('click', newSession);
const needTester = () => {
  if (!state.testMode || state.tester) return false;
  toast('Type your name in the Tester box first, so your ratings are saved under it.');
  el.tester.focus();
  return true;
};

// ---------- microphone, live transcription, level meter ----------
// mic -> AudioWorklet (16 kHz PCM, 100 ms chunks + loudness) -> WebSocket -> server -> Deepgram
// The loudness of every chunk feeds the moment detector; the words come back as captions.
const BARS = 28;
const bars = [];
for (let i = 0; i < BARS; i++) { const s = document.createElement('span'); el.meter.appendChild(s); bars.push(s); }
const mic = { stream: null, source: null, node: null, mute: null, ws: null, ready: false, level: 0 };
let workletLoaded = false;

const setMicStatus = (t) => { el.micStatus.textContent = t; };

function drawMeter(rms) {
  const level = Math.min(1, rms * 5.5);
  const on = Math.round(level * BARS);
  for (let i = 0; i < BARS; i++) {
    const b = bars[i];
    const active = i < on;
    b.className = active ? (i > BARS * 0.85 ? 'peak' : i > BARS * 0.62 ? 'hot' : 'on') : '';
    b.style.transform = `scaleY(${active ? 0.35 + 0.65 * Math.min(1, (i + 1) / BARS + level * 0.4) : 0.12})`;
  }
}

// ----- captions -----
const caps = { lines: [], partial: '' };
function renderCaptions() {
  el.captions.innerHTML = '';
  if (!caps.lines.length && !caps.partial) {
    const s = document.createElement('span');
    s.className = 'cap-empty';
    s.textContent = mic.stream ? 'Listening... say something, or make some noise.' : 'Live words appear here once you start listening.';
    el.captions.appendChild(s);
    return;
  }
  caps.lines.slice(-3).forEach((t, i, arr) => {
    const p = document.createElement('p');
    if (i < arr.length - 1 || caps.partial) p.className = 'old';
    p.textContent = t;
    el.captions.appendChild(p);
  });
  if (caps.partial) {
    const p = document.createElement('p');
    p.className = 'partial';
    p.textContent = caps.partial;
    el.captions.appendChild(p);
  }
}

function onTranscript(m) {
  if (!detector.enabled) return; // ignore words heard while the roast plays
  const now = performance.now();
  if (m.text) {
    if (m.final) {
      caps.lines.push(m.text);
      caps.partial = '';
      state.transcript.push({ t: now, text: m.text });
    } else {
      caps.partial = m.text;
    }
    renderCaptions();
  }
  detector.speech(m.text, { final: m.final, speechFinal: m.speechFinal }, now);
}

// ----- socket to the server -----
function openSocket() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  mic.ws = ws;
  mic.ready = false;
  setMicStatus('Connecting');
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'ready') { mic.ready = true; setMicStatus('Listening'); }
    else if (m.type === 'transcript') onTranscript(m);
    else if (m.type === 'utterance_end') { if (detector.enabled) detector.flushUtterance(performance.now()); }
    else if (m.type === 'error') { toast(m.message); setMicStatus('Transcription offline'); }
  };
  ws.onclose = () => {
    if (mic.stream && mic.ws === ws) { mic.ready = false; setMicStatus('Transcription offline'); toast('Live transcription disconnected. Stop and start listening again.'); }
  };
}

// ----- one 100 ms audio chunk -----
let lastCool = '';
function onFrame({ pcm, rms, peak }) {
  const now = performance.now();
  drawMeter(rms);
  if (mic.ws && mic.ws.readyState === WebSocket.OPEN && mic.ws.bufferedAmount < 256 * 1024) mic.ws.send(pcm);
  detector.feed(rms, peak, now);
  const left = Math.ceil(detector.cooldownLeft(now) / 1000);
  const txt = !detector.enabled ? 'paused' : left > 0 ? `next roast in ${left}s` : 'ready';
  if (txt !== lastCool) {
    lastCool = txt;
    el.cooldownTag.textContent = txt;
    el.cooldownTag.classList.toggle('wait', left > 0);
  }
}

async function startMic() {
  if (mic.stream) return;
  if (needTester()) return;
  el.micBtn.disabled = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (err) {
    el.micBtn.disabled = false;
    toast(err.name === 'NotAllowedError' ? 'Microphone blocked. Allow it in the address bar and try again.' : 'No microphone found.');
    return;
  }
  try {
    ensureAudioContext();
    if (!workletLoaded) { await ctx.audioWorklet.addModule('worklet.js'); workletLoaded = true; }
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    el.micBtn.disabled = false;
    toast('Could not start audio capture: ' + err.message);
    return;
  }
  mic.stream = stream;
  mic.source = ctx.createMediaStreamSource(stream);
  mic.node = new AudioWorkletNode(ctx, 'pcm-capture');
  mic.mute = ctx.createGain(); // keeps the worklet running without playing the mic out loud
  mic.mute.gain.value = 0;
  mic.source.connect(mic.node);
  mic.node.connect(mic.mute);
  mic.mute.connect(ctx.destination);
  mic.node.port.onmessage = (e) => onFrame(e.data);

  state.transcript = [];
  caps.lines = []; caps.partial = '';
  detector.reset(performance.now());
  armDetector();
  openSocket();
  renderCaptions();
  el.micBtn.disabled = false;
  el.micBtn.setAttribute('aria-pressed', 'true');
  el.micLabel.textContent = 'Stop listening';
  el.meterWrap.dataset.on = 'true';
}

function stopMic() {
  mic.node && (mic.node.port.onmessage = null);
  mic.stream?.getTracks().forEach((t) => t.stop());
  mic.source?.disconnect(); mic.node?.disconnect(); mic.mute?.disconnect();
  const ws = mic.ws;
  mic.stream = mic.source = mic.node = mic.mute = mic.ws = null;
  mic.ready = false;
  ws && ws.close();
  armDetector(); // disables, since the mic is off
  el.micBtn.setAttribute('aria-pressed', 'false');
  el.micLabel.textContent = 'Start listening';
  el.meterWrap.dataset.on = 'false';
  setMicStatus('Mic off');
  el.cooldownTag.textContent = '';
  lastCool = '';
  caps.lines = []; caps.partial = '';
  renderCaptions();
  bars.forEach((b) => { b.className = ''; b.style.transform = ''; });
}
el.micBtn.addEventListener('click', () => (mic.stream ? stopMic() : startMic()));

// ---------- visualizer ----------
const canvas = $('viz');
const g = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;
function resize() {
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(canvas);
resize();

const NB = 72;
const smooth = new Float32Array(NB);
const freq = new Uint8Array(128);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function draw(ts) {
  const t = ts / 1000;
  const s = el.stage.dataset.state;
  const cx = W / 2, cy = H / 2;
  const base = Math.min(W, H) * 0.33;
  let energy = 0;
  const speaking = s === 'speaking' && playAnalyser;
  if (speaking) playAnalyser.getByteFrequencyData(freq);

  g.clearRect(0, 0, W, H);
  for (let i = 0; i < NB; i++) {
    let target;
    if (speaking) {
      const bin = Math.floor((i / NB) * 56);
      target = freq[bin] / 255;
      energy += target;
    } else if (s === 'writing') {
      target = 0.18 + 0.14 * Math.sin(t * 6 + i * 0.5);
    } else {
      target = 0.07 + 0.045 * Math.sin(t * 1.4 + i * 0.35);
    }
    smooth[i] += (target - smooth[i]) * (speaking ? 0.5 : 0.12);
    const a = (i / NB) * Math.PI * 2 - Math.PI / 2;
    const len = 4 + smooth[i] * Math.min(W, H) * 0.2;
    const x1 = cx + Math.cos(a) * base, y1 = cy + Math.sin(a) * base;
    const x2 = cx + Math.cos(a) * (base + len), y2 = cy + Math.sin(a) * (base + len);
    const grd = g.createLinearGradient(x1, y1, x2, y2);
    grd.addColorStop(0, `hsla(${state.hue}, 95%, 62%, 0.9)`);
    grd.addColorStop(1, `hsla(${state.hue - 45}, 90%, 58%, 0.9)`);
    g.strokeStyle = grd;
    g.lineWidth = Math.max(2, (Math.PI * 2 * base) / NB * 0.45);
    g.lineCap = 'round';
    g.globalAlpha = speaking ? 1 : 0.55 + smooth[i];
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  g.globalAlpha = 1;
  energy = speaking ? energy / NB : 0;
  const orb = base * (0.9 + energy * 0.25 + (reduce ? 0 : Math.sin(t * 1.2) * 0.012));
  const og = g.createRadialGradient(cx, cy, orb * 0.1, cx, cy, orb);
  og.addColorStop(0, speaking ? 'rgba(255,120,60,0.20)' : 'rgba(255,255,255,0.035)');
  og.addColorStop(1, 'rgba(255,255,255,0.01)');
  g.fillStyle = og;
  g.beginPath(); g.arc(cx, cy, orb, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, orb, 0, Math.PI * 2); g.stroke();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ---------- voice cast (Stage 2) ----------
// The picker is drawn from /api/cast. Clicking a character selects it AND plays a short sample of
// its voice, so you can audition the cast. "Auto" lets each moment pick who speaks.
const ICONS = {
  auto: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  mug: '<path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>',
  glasses: '<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M10.5 14h3M3.5 14 5 8M20.5 14 19 8"/>',
  wave: '<path d="M8 8v8M12 5v14M16 8v8M4 11v2M20 11v2"/>',
};
const iconSvg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.wave}</svg>`;
const shortName = (n) => String(n).replace(/^The /, '');
const AUTO_HINT = 'Each moment picks who speaks: crash and panic get the Announcer, silence the Tired Friend...';
let castList = [];

const sampleAudio = new Audio();
function playSample(id) {
  const c = castList.find((x) => x.id === id);
  if (!c || state.busy || !audio.paused) return; // not while a roast is on
  if (mic.stream) detector.setEnabled(false, performance.now()); // the mic must not roast the sample
  sampleAudio.onended = () => setTimeout(() => { if (!state.busy && audio.paused) armDetector(); }, 1000);
  sampleAudio.src = c.sample;
  sampleAudio.currentTime = 0;
  sampleAudio.play().catch(() => armDetector());
}

function setCharacter(id, { sample = false } = {}) {
  state.character = id;
  store.set('rc_character', id);
  el.cast.querySelectorAll('input').forEach((i) => { i.checked = i.value === id; });
  const c = castList.find((x) => x.id === id);
  el.voiceHint.textContent = id === 'auto' || !c ? AUTO_HINT : c.tagline;
  if (sample && id !== 'auto') playSample(id);
}

function renderCast(list) {
  castList = list;
  el.cast.querySelectorAll('.cast-card:not(:first-child)').forEach((n) => n.remove());
  for (const c of list) {
    const label = document.createElement('label');
    label.className = 'cast-card';
    label.style.setProperty('--c', c.hue);
    label.innerHTML = `<input type="radio" name="character" value="${c.id}"><span class="av" style="--h:${c.hue}">${iconSvg(c.icon)}</span><span class="nm"></span>`;
    label.querySelector('.nm').textContent = shortName(c.name);
    label.title = c.tagline;
    el.cast.appendChild(label);
  }
  const known = state.character === 'auto' || list.some((c) => c.id === state.character);
  setCharacter(known ? state.character : 'auto');
}

// "Speaking as ..." on the stage, and the ring takes on the character's colour.
function showSpeaker(c) {
  if (!c) return;
  state.hue = c.hue;
  el.stage.style.setProperty('--h', c.hue);
  el.speakerAv.style.setProperty('--h', c.hue);
  el.speakerAv.innerHTML = iconSvg(c.icon);
  el.speakerName.textContent = shortName(c.name);
  el.speaker.hidden = false;
}

el.cast.addEventListener('change', (e) => setCharacter(e.target.value, { sample: true }));
el.cast.querySelector('.av[data-icon]').innerHTML = iconSvg('auto');
setCharacter(state.character); // Auto's hint until the list arrives
fetch('/api/cast').then((r) => r.json()).then((d) => { state.byMoment = d.byMoment || {}; renderCast(d.cast || []); }).catch(() => {});

// ---------- test bar ----------
el.testbar.hidden = !state.testMode;
el.tester.value = state.tester;
state.session = Number(store.get('rc_session_' + state.tester)) || 1;
updateSessionUI();

// ---------- warm up: do the slow one-time work before the first roast ----------
preloadBank();
fetch('/api/warm', { method: 'POST' }).catch(() => {});

// ---------- server status ----------
async function checkHealth() {
  try {
    const h = await (await fetch('/api/health', { cache: 'no-store' })).json();
    if (h.authorized === false) {
      el.status.dataset.state = 'bad';
      el.statusText.textContent = 'Access code needed';
      toast('This page is locked. Open the link your host sent you (it ends with ?code=...).');
    } else if (!h.openai) { el.status.dataset.state = 'bad'; el.statusText.textContent = 'OPENAI_API_KEY missing'; }
    else if (!h.deepgram) { el.status.dataset.state = 'warn'; el.statusText.textContent = 'DEEPGRAM_API_KEY missing'; }
    else if (!h.elevenlabs) { el.status.dataset.state = 'ok'; el.statusText.textContent = 'Ready (OpenAI voice)'; }
    else { el.status.dataset.state = 'ok'; el.statusText.textContent = 'Ready'; }
  } catch {
    el.status.dataset.state = 'bad';
    el.statusText.textContent = 'Server offline';
  }
}
checkHealth();
