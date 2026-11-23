// RoastCast server - Stage 1
// Holds the API keys, writes the roast (OpenAI), voices it (ElevenLabs, OpenAI fallback),
// relays live speech-to-text (Deepgram) and serves the client from /client.

import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { writeRoast, defaultMode } from './roaster.js';
import { startSpeech, getSpeech, warmSpeech, voiceName } from './speech.js';
import { CHARACTERS, BY_MOMENT, publicCast, resolveCharacter } from './cast.js';
import { ACCEPTED_TYPES, LEVELS, MODES, SessionStore, countWords, resolveType } from './humor.js';
import { isAuthorized, accessCookie, codeMatches, RateLimiter } from './guard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const LOG_FILE = process.env.TIMING_LOG
  ? path.resolve(ROOT, process.env.TIMING_LOG)
  : path.join(ROOT, 'data', 'timing-log.jsonl');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY || '';
const LLM_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'; // fast, non-reasoning

// Sharing with testers (see docs/day5-test-guide.md). All optional; local use needs none of it.
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const roastLimiter = new RateLimiter(Number(process.env.MAX_ROASTS_PER_MIN) || 20);
const MAX_MICS = Number(process.env.MAX_MICS) || 5; // each open mic streams to Deepgram, which bills by the minute
let openMics = 0;

// ---------- small helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req, limit = 8 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

const sessions = new SessionStore(); // per-browser-session memory for running jokes

// The browser asks for the audio of a roast it just received. The voice job was started by
// handleRoast, so this attaches to it: buffered audio first, then the live rest.
async function handleSpeak(req, res, url) {
  const job = getSpeech(url.searchParams.get('id') || '');
  if (!job) return json(res, 404, { error: 'Unknown roast. Generate a new one first.' });
  await job.ready;
  if (!job.provider) return json(res, 502, { error: job.tee.error?.message || 'The voice failed.' });
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Provider': job.provider });
  const unsubscribe = job.tee.subscribe({
    onChunk: (c) => res.write(c),
    onEnd: () => res.end(),
  });
  req.on('close', unsubscribe);
}


// ---------- routes ----------
async function handleRoast(req, res) {
  if (!OPENAI_KEY) return json(res, 500, { error: 'OPENAI_API_KEY is missing in .env' });
  if (!roastLimiter.hit(req.socket.remoteAddress)) {
    return json(res, 429, { error: 'Slow down a little: too many roasts in the last minute.' });
  }
  const body = await readBody(req);
  const clean = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const moment = clean(body.moment, 200);
  const transcript = clean(body.transcript, 700);
  const momentType = ACCEPTED_TYPES.has(body.momentType) ? body.momentType : 'typed';
  const seconds = Math.min(600, Math.max(1, Number(body.seconds) || 8));
  const level = Object.hasOwn(LEVELS, body.level) ? body.level : 'spicy';
  const mode = MODES.includes(body.mode) ? body.mode : defaultMode();
  const audioOnly = ['scream', 'crash', 'silence'].includes(momentType); // detected from sound, no words needed
  if (!audioOnly && moment.length < 3) return json(res, 400, { error: 'Tell me what just happened first.' });

  const ctx = { momentType, moment, transcript, seconds };
  const session = sessions.get(body.sessionId); // running jokes live here
  // Who speaks? The page can pick a character, or leave it on "auto": the moment decides (crash -> announcer...).
  const character = resolveCharacter(body.character, resolveType(ctx), session.lastCharacter);
  session.lastCharacter = character;
  const r = await writeRoast(ctx, level, session, mode, character);
  const id = randomUUID();
  startSpeech(id, r.text, character); // the voice starts NOW, in parallel with this response travelling to the browser
  const c = CHARACTERS[character];
  json(res, 200, {
    id, roast: r.text, level, momentType, type: r.type, mode: r.mode, words: countWords(r.text),
    character: { id: character, name: c.name, icon: c.icon, hue: c.hue }, voice: voiceName(character),
    candidates: r.candidates, picked: r.picked, pickedBy: r.pickedBy,
    promptMs: r.promptMs, firstTokenMs: r.firstTokenMs, candMs: r.candMs, pickMs: r.pickMs, llmMs: r.llmMs,
    model: LLM_MODEL,
  });
}

async function handleLog(req, res) {
  const body = await readBody(req);
  const allowed = ['id', 'type', 'level', 'momentType', 'momentKind', 'moment', 'roast', 'picked', 'pickedBy', 'mode', 'character',
    'layered', 'detectMs', 'reactionMs', 'promptMs', 'firstTokenMs', 'candMs', 'pickMs', 'llmMs', 'voiceMs', 'roastStartMs',
    'firstSoundMs', 'laughScore'];
  const row = { ts: new Date().toISOString() };
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  // who was testing, and in which session (Day 5): short plain strings only
  const short = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  if (body.tester) row.tester = short(body.tester, 40);
  if (body.sessionId) row.sessionId = short(body.sessionId, 64);
  if (Number.isFinite(Number(body.session))) row.session = Math.max(1, Math.min(999, Math.round(Number(body.session))));
  if (Array.isArray(body.layers)) row.layers = body.layers.slice(0, 8).map((x) => String(x).slice(0, 40)); // sound ids used
  if (Array.isArray(body.candidates)) row.candidates = body.candidates.slice(0, 5).map((c) => String(c).slice(0, 120));
  const job = body.id && getSpeech(String(body.id));
  if (job) { row.ttsFirstByteMs = job.firstByteMs; row.voiceProvider = job.provider; } // measured on the server
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, JSON.stringify(row) + '\n');
  json(res, 200, { ok: true });
}

// Open connections and resolve the voice ahead of the first roast.
async function warmUp() {
  const t0 = performance.now();
  const [voiceMs, openai] = await Promise.all([
    warmSpeech(),
    OPENAI_KEY
      ? fetch(`https://api.openai.com/v1/models/${LLM_MODEL}`, { headers: { Authorization: `Bearer ${OPENAI_KEY}` } })
          .then((r) => r.ok, () => false)
      : false,
  ]);
  return { ok: true, voiceMs, openai, totalMs: Math.round(performance.now() - t0) };
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(CLIENT_DIR, rel));
  if (!file.startsWith(CLIENT_DIR + path.sep)) return json(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const authorized = isAuthorized(ACCESS_CODE, req.headers.cookie);
    // Open the shared link (it ends in ?code=...) once: it sets a cookie and the code leaves the address bar.
    if (ACCESS_CODE && req.method === 'GET' && url.searchParams.has('code') && codeMatches(ACCESS_CODE, url.searchParams.get('code'))) {
      url.searchParams.delete('code');
      res.writeHead(302, {
        'Set-Cookie': accessCookie(ACCESS_CODE, req.headers['x-forwarded-proto'] === 'https'),
        Location: url.pathname + url.search,
      });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true, authorized, openai: !!OPENAI_KEY, elevenlabs: !!ELEVEN_KEY, deepgram: !!DEEPGRAM_KEY,
        model: LLM_MODEL, mode: defaultMode(),
      });
    }
    if (url.pathname.startsWith('/api/') && !authorized) {
      return json(res, 401, { error: 'Access code needed. Open the link your host sent you.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/cast') return json(res, 200, { cast: publicCast(), byMoment: BY_MOMENT });
    if (req.method === 'POST' && url.pathname === '/api/warm') return json(res, 200, await warmUp());
    if (req.method === 'POST' && url.pathname === '/api/roast') return await handleRoast(req, res);
    if (req.method === 'GET' && url.pathname === '/api/speak') return await handleSpeak(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/log') return await handleLog(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(res, url.pathname);
    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.message || 'Server error' });
    else res.destroy();
  }
});

// ---------- live transcription: browser <-> this server <-> Deepgram ----------
// The browser streams 16 kHz mono PCM here; we relay it to Deepgram and send back
// the words as they are heard. The Deepgram key never reaches the browser.
const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen?' +
  new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    endpointing: '400', // ms of quiet that ends a line
    utterance_end_ms: '1000',
    vad_events: 'true',
  });

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Same-origin only: another website must not be able to spend your Deepgram minutes.
  const origin = req.headers.origin;
  const sameOrigin = !origin || new URL(origin).host === req.headers.host;
  if (url.pathname !== '/ws' || !sameOrigin || !isAuthorized(ACCESS_CODE, req.headers.cookie)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (client) => {
  const send = (obj) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(obj));
  if (!DEEPGRAM_KEY) { send({ type: 'error', message: 'DEEPGRAM_API_KEY is missing in .env' }); client.close(); return; }
  if (openMics >= MAX_MICS) { send({ type: 'error', message: 'Too many microphones are open right now. Try again in a minute.' }); client.close(); return; }
  openMics++;
  let counted = true;
  const release = () => { if (counted) { counted = false; openMics--; } };
  client.on('close', release);

  const queue = []; // audio that arrives before Deepgram is connected
  let ready = false;
  const dg = new WebSocket(DEEPGRAM_URL, { headers: { Authorization: `Token ${DEEPGRAM_KEY}` } });
  let keepAlive = null;

  dg.on('open', () => {
    ready = true;
    for (const chunk of queue.splice(0)) dg.send(chunk);
    keepAlive = setInterval(() => dg.readyState === WebSocket.OPEN && dg.send(JSON.stringify({ type: 'KeepAlive' })), 5000);
    send({ type: 'ready' });
  });

  dg.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.type === 'Results') {
      const text = m.channel?.alternatives?.[0]?.transcript || '';
      if (text || m.speech_final) {
        send({ type: 'transcript', text, final: !!m.is_final, speechFinal: !!m.speech_final });
      }
    } else if (m.type === 'SpeechStarted') send({ type: 'speech_started' });
    else if (m.type === 'UtteranceEnd') send({ type: 'utterance_end' });
  });

  dg.on('unexpected-response', (_req, res) => {
    console.error('Deepgram refused the connection:', res.statusCode);
    send({ type: 'error', message: `Deepgram refused the connection (${res.statusCode}). Check DEEPGRAM_API_KEY.` });
    client.close();
  });
  dg.on('error', (err) => { console.error('Deepgram error:', err.message); send({ type: 'error', message: 'Transcription connection failed.' }); });
  dg.on('close', () => { clearInterval(keepAlive); client.close(); });

  client.on('message', (data, isBinary) => {
    if (!isBinary) return;
    if (!ready) { if (queue.length < 60) queue.push(data); return; }
    if (dg.readyState === WebSocket.OPEN) dg.send(data);
  });
  client.on('close', () => {
    clearInterval(keepAlive);
    if (dg.readyState === WebSocket.OPEN) { dg.send(JSON.stringify({ type: 'CloseStream' })); dg.close(); }
    else if (dg.readyState === WebSocket.CONNECTING) dg.terminate();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`RoastCast running at http://localhost:${PORT}`);
  console.log(`  LLM: ${OPENAI_KEY ? LLM_MODEL : 'MISSING OPENAI_API_KEY'}`);
  console.log(`  Voice: ${ELEVEN_KEY ? 'ElevenLabs (OpenAI fallback)' : OPENAI_KEY ? 'OpenAI TTS' : 'MISSING KEYS'}`);
  console.log(`  Listening (speech-to-text): ${DEEPGRAM_KEY ? 'Deepgram nova-3' : 'MISSING DEEPGRAM_API_KEY'}`);
  console.log(`  Roast mode: ${defaultMode()} (self | best | quick, set ROAST_MODE in .env)`);
  console.log(`  Sharing: ${ACCESS_CODE ? 'ACCESS_CODE is set (open /?code=...)' : 'no access code (local use)'}; limits ${roastLimiter.max} roasts/min, ${MAX_MICS} mics`);
  warmUp().then((w) => console.log(`  Warm-up done in ${w.totalMs}ms (voice ${w.voiceMs}ms)`)).catch(() => {});
});
