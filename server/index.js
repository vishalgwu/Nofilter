// RoastCast server - Stage 1, Day 1
// Zero dependencies. Holds the API keys, writes the roast (OpenAI) and streams the voice
// (ElevenLabs, with OpenAI TTS as a fallback). Serves the client from /client.

import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const LOG_FILE = path.join(ROOT, 'data', 'timing-log.jsonl');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const LLM_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'; // fast, non-reasoning
const MAX_WORDS = 15;
const LEVELS = {
  gentle: 'GENTLE: friendly teasing, like a proud friend watching you struggle. Warm, light, affectionate.',
  spicy: 'SPICY: sharper punchlines and more exaggeration, still playful.',
  savage: 'SAVAGE: big, theatrical, over the top. Aimed at the gameplay only.',
};

const SYSTEM_PROMPT = `You are RoastCast, a live comedy roaster for gamers and streamers.
A moment just happened. Reply with exactly ONE roast of it.

Rules:
- ${MAX_WORDS} words maximum. Shorter is funnier.
- Be specific: mention the exact thing that happened, never a generic insult.
- Exaggerate the real moment one step too far. Use a surprise at the end when you can.
- Tease the play, never the person. Never mention race, gender, religion, sexuality, disability, appearance, family or anything personal.
- No profanity, no hashtags, no emojis, no quotation marks.
- Output only the roast text.`;

// ---------- small helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;
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

function cleanRoast(text) {
  return text
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Hard cap in code, not only in the prompt. Cut at 15 words and end cleanly.
function capWords(text) {
  const words = text.split(/\s+/);
  if (words.length <= MAX_WORDS) return text;
  return words.slice(0, MAX_WORDS).join(' ').replace(/[,;:\-—]+$/, '') + '.';
}

// Remember the last roasts so /api/speak only ever voices text this server wrote.
const roastStore = new Map();
function remember(id, entry) {
  roastStore.set(id, entry);
  if (roastStore.size > 200) roastStore.delete(roastStore.keys().next().value);
}

// ---------- roast writer (OpenAI) ----------
async function askLLM(moment, level, strict) {
  const userMsg =
    `Roast level: ${LEVELS[level]}\nMoment: ${moment}` +
    (strict ? `\nYour last answer was too long. Use fewer than 12 words.` : '');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 1,
      max_completion_tokens: 60,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('OpenAI error', res.status, detail.slice(0, 300));
    throw Object.assign(new Error(`The roast writer failed (OpenAI ${res.status}).`), { status: 502 });
  }
  const data = await res.json();
  return cleanRoast(data.choices?.[0]?.message?.content || '');
}

async function writeRoast(moment, level) {
  let text = await askLLM(moment, level, false);
  if (!text) throw Object.assign(new Error('The roast writer returned nothing.'), { status: 502 });
  if (countWords(text) > MAX_WORDS) {
    const retry = await askLLM(moment, level, true);
    if (retry) text = retry;
  }
  return capWords(text);
}

// ---------- voice (ElevenLabs primary, OpenAI fallback) ----------
let elevenVoiceId = process.env.ELEVENLABS_VOICE_ID || '';
const PREFERRED_VOICES = ['adam', 'brian', 'josh', 'daniel', 'george', 'liam', 'charlie'];

async function resolveElevenVoice() {
  if (elevenVoiceId) return elevenVoiceId;
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': ELEVEN_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  const { voices = [] } = await res.json();
  const premade = voices.filter((v) => v.category === 'premade');
  const pool = premade.length ? premade : voices;
  const pick =
    PREFERRED_VOICES.map((n) => pool.find((v) => v.name?.toLowerCase().startsWith(n))).find(Boolean) || pool[0];
  if (!pick) throw new Error('No ElevenLabs voices available');
  elevenVoiceId = pick.voice_id;
  console.log(`Voice: ${pick.name} (${pick.voice_id})`);
  return elevenVoiceId;
}

async function elevenStream(text) {
  const voice = await resolveElevenVoice();
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.75 },
      }),
    },
  );
}

function openaiSpeech(text) {
  return fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'ash',
      input: text,
      instructions: 'Deadpan comedy roast delivery. Punchy, playful, perfectly timed. Land the last word.',
      response_format: 'mp3',
    }),
  });
}

async function handleSpeak(req, res, url) {
  const entry = roastStore.get(url.searchParams.get('id') || '');
  if (!entry) return json(res, 404, { error: 'Unknown roast. Generate a new one first.' });

  let upstream = null;
  let provider = 'elevenlabs';
  if (ELEVEN_KEY) {
    try {
      upstream = await elevenStream(entry.text);
      if (!upstream.ok) {
        console.warn('ElevenLabs TTS failed', upstream.status, (await upstream.text()).slice(0, 200));
        upstream = null;
      }
    } catch (err) {
      console.warn('ElevenLabs TTS error', err.message);
      upstream = null;
    }
  }
  if (!upstream && OPENAI_KEY) {
    provider = 'openai';
    upstream = await openaiSpeech(entry.text);
  }
  if (!upstream || !upstream.ok || !upstream.body) {
    return json(res, 502, { error: 'The voice failed. Check the ElevenLabs / OpenAI keys.' });
  }
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'X-Voice-Provider': provider,
  });
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ---------- routes ----------
async function handleRoast(req, res) {
  if (!OPENAI_KEY) return json(res, 500, { error: 'OPENAI_API_KEY is missing in .env' });
  const body = await readBody(req);
  const moment = String(body.moment || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const level = Object.hasOwn(LEVELS, body.level) ? body.level : 'spicy';
  if (moment.length < 3) return json(res, 400, { error: 'Tell me what just happened first.' });

  const t0 = performance.now();
  const text = await writeRoast(moment, level);
  const llmMs = Math.round(performance.now() - t0);
  const id = randomUUID();
  remember(id, { text, moment, level });
  json(res, 200, { id, roast: text, level, words: countWords(text), llmMs, model: LLM_MODEL });
}

async function handleLog(req, res) {
  const body = await readBody(req);
  const allowed = ['id', 'type', 'level', 'moment', 'roast', 'llmMs', 'voiceMs', 'firstSoundMs', 'laughScore'];
  const row = { ts: new Date().toISOString() };
  for (const k of allowed) if (body[k] !== undefined) row[k] = body[k];
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, JSON.stringify(row) + '\n');
  json(res, 200, { ok: true });
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
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, openai: !!OPENAI_KEY, elevenlabs: !!ELEVEN_KEY, model: LLM_MODEL });
    }
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

server.listen(PORT, HOST, () => {
  console.log(`RoastCast running at http://localhost:${PORT}`);
  console.log(`  LLM: ${OPENAI_KEY ? LLM_MODEL : 'MISSING OPENAI_API_KEY'}`);
  console.log(`  Voice: ${ELEVEN_KEY ? 'ElevenLabs (OpenAI fallback)' : OPENAI_KEY ? 'OpenAI TTS' : 'MISSING KEYS'}`);
});
