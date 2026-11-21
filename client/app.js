// RoastCast client - Stage 1, Day 1
// typed moment -> /api/roast (OpenAI) -> /api/speak (streamed voice) -> played here.
// Also: mic permission + live input-level meter (ready for Day 2).

import { MomentDetector } from './detector.js';

const $ = (id) => document.getElementById(id);

const MOMENTS = [
  { label: 'Crash', c: '#ff8a1f', text: 'I drove straight into the ocean for the third time.' },
  { label: 'Scream', c: '#ff3d81', text: 'I screamed at a jump scare and threw my controller.' },
  { label: 'Silence', c: '#7b8cff', text: 'I stared at the same door for a full minute without moving.' },
  { label: 'Lucky win', c: '#3ddc97', text: 'I won the match with one health and zero idea how.' },
  { label: 'Rage quit', c: '#ff5c6c', text: 'I rage quit right before the final boss.' },
  { label: 'Panic', c: '#ffb347', text: 'I panicked and healed the enemy team.' },
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
  roast: $('roast'), vWrite: $('vWrite'), vVoice: $('vVoice'), vFirst: $('vFirst'),
  statWrite: $('statWrite'), statVoice: $('statVoice'), statFirst: $('statFirst'), budgetBar: $('budgetBar'),
  rate: $('rate'), replayBtn: $('replayBtn'), copyBtn: $('copyBtn'),
  historyWrap: $('historyWrap'), hist: $('hist'), histCount: $('histCount'),
  status: $('status'), statusText: $('statusText'), toast: $('toast'), kbdHint: $('kbdHint'),
  autoToggle: $('autoToggle'), cooldownTag: $('cooldownTag'), captions: $('captions'), trigger: $('trigger'),
};

const state = { level: 'spicy', busy: false, current: null, history: [], toastTimer: 0, transcript: [] };
const MOMENT_LABEL = { scream: 'Scream', crash: 'Crash', silence: 'Long silence', speech: 'Speech', typed: 'Typed' };

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
  }
  if (ctx.state === 'suspended') ctx.resume();
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
const log = (row) => post('/api/log', row).catch(() => {});

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
function afterSpeak() {
  setStage('idle', 'Idle');
  setTimeout(() => { if (!state.busy && audio.paused) armDetector(); }, 1000);
}

function playRoast(id, t0) {
  ensureAudioContext();
  detector.setEnabled(false, performance.now()); // never roast our own voice
  return new Promise((resolve) => {
    const tStart = performance.now();
    let done = false;
    const finish = (res) => { if (!done) { done = true; resolve(res); } };
    audio.onplaying = () => {
      const now = performance.now();
      setStage('speaking', 'Speaking');
      finish({ voiceMs: now - tStart, firstSoundMs: now - t0 });
    };
    audio.onended = afterSpeak;
    audio.onerror = () => { afterSpeak(); toast('The voice could not play. Check the server log.'); finish(null); };
    audio.src = `/api/speak?id=${encodeURIComponent(id)}&_=${Date.now()}`;
    audio.play().catch((err) => { afterSpeak(); toast('Audio was blocked: ' + err.message); finish(null); });
  });
}

// roast()        -> roast the typed moment (button / Ctrl+Enter)
// roast(moment)  -> roast a moment the detector heard: { type, text?, seconds? }
async function roast(auto = null) {
  if (state.busy) return;
  const typed = !auto;
  const moment = typed ? el.moment.value.trim() : auto.text || '';
  if (typed && moment.length < 3) { toast('Tell me what just happened first.'); el.moment.focus(); return; }
  const momentType = typed ? 'typed' : auto.type;
  const shownMoment = typed ? moment : auto.type === 'speech' ? moment
    : auto.type === 'silence' ? `Silent for ${auto.seconds}s` : MOMENT_LABEL[auto.type];
  const transcript = typed ? '' : recentTranscript();

  state.busy = true;
  detector.setEnabled(false, performance.now());
  showTrigger(typed ? null : { type: momentType, text: moment, seconds: auto.seconds });
  el.roastBtn.disabled = true;
  el.roastBtn.classList.add('is-loading');
  el.roastBtn.querySelector('.btn-label').textContent = 'Writing';
  audio.pause();
  el.rate.hidden = true;
  setStat(el.statWrite, el.vWrite, null); setStat(el.statVoice, el.vVoice, null); setStat(el.statFirst, el.vFirst, null);
  el.budgetBar.style.width = '0';
  setStage('writing', 'Writing');
  ensureAudioContext(); // unlock audio inside the click

  const t0 = performance.now();
  try {
    const r = await post('/api/roast', {
      moment, momentType, transcript, seconds: auto?.seconds, level: state.level,
    });
    renderRoast(r.roast);
    setStat(el.statWrite, el.vWrite, r.llmMs, grade(r.llmMs, 700, 1500));
    el.replayBtn.disabled = false;
    el.copyBtn.disabled = false;
    state.current = { id: r.id, text: r.roast, level: r.level, moment: shownMoment, momentType, llmMs: r.llmMs };

    const t = await playRoast(r.id, t0);
    if (t) {
      setStat(el.statVoice, el.vVoice, t.voiceMs, grade(t.voiceMs, 600, 1500));
      setStat(el.statFirst, el.vFirst, t.firstSoundMs, grade(t.firstSoundMs));
      el.budgetBar.style.width = Math.min(100, (t.firstSoundMs / (LIMIT_MS * 2)) * 100) + '%';
      Object.assign(state.current, t);
      el.rate.hidden = false;
      el.rate.classList.remove('is-done');
      el.rate.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      addHistory(state.current);
      log({ type: 'roast', id: r.id, level: r.level, momentType, moment: shownMoment, roast: r.roast,
        llmMs: r.llmMs, voiceMs: Math.round(t.voiceMs), firstSoundMs: Math.round(t.firstSoundMs) });
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

el.rate.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-score]');
  if (!b || !state.current) return;
  const score = Number(b.dataset.score);
  el.rate.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  el.rate.classList.add('is-done');
  state.current.laughScore = score;
  log({ type: 'laugh', id: state.current.id, laughScore: score });
});

function addHistory(item) {
  state.history.unshift(item);
  el.historyWrap.hidden = false;
  el.histCount.textContent = `${state.history.length} roast${state.history.length === 1 ? '' : 's'}`;
  const li = document.createElement('li');
  const left = document.createElement('div');
  const t = document.createElement('div'); t.className = 't'; t.textContent = item.text;
  const m = document.createElement('div'); m.className = 'm';
  const tag = document.createElement('span'); tag.className = 'tag ' + item.level; tag.textContent = item.level;
  const w = document.createElement('span'); w.className = 'mono'; w.textContent = `first sound ${fmt(item.firstSoundMs)}`;
  const mo = document.createElement('span'); mo.textContent = item.moment.length > 54 ? item.moment.slice(0, 54) + '...' : item.moment;
  m.append(tag, w, mo);
  left.append(t, m);
  const btn = document.createElement('button');
  btn.className = 'icon-btn'; btn.type = 'button'; btn.textContent = 'Play';
  btn.addEventListener('click', () => {
    state.current = item;
    renderRoast(item.text);
    playRoast(item.id, performance.now());
  });
  li.append(left, btn);
  el.hist.prepend(li);
}

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
    grd.addColorStop(0, 'rgba(255,179,71,0.9)');
    grd.addColorStop(1, 'rgba(255,61,129,0.9)');
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

// ---------- server status ----------
async function checkHealth() {
  try {
    const h = await (await fetch('/api/health', { cache: 'no-store' })).json();
    if (!h.openai) { el.status.dataset.state = 'bad'; el.statusText.textContent = 'OPENAI_API_KEY missing'; }
    else if (!h.deepgram) { el.status.dataset.state = 'warn'; el.statusText.textContent = 'DEEPGRAM_API_KEY missing'; }
    else if (!h.elevenlabs) { el.status.dataset.state = 'ok'; el.statusText.textContent = 'Ready (OpenAI voice)'; }
    else { el.status.dataset.state = 'ok'; el.statusText.textContent = 'Ready'; }
  } catch {
    el.status.dataset.state = 'bad';
    el.statusText.textContent = 'Server offline';
  }
}
checkHealth();
