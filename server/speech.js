// The voice. As soon as a roast's text exists the server starts the text-to-speech request
// (ElevenLabs, OpenAI as fallback) and buffers the audio in a "tee". The browser's request for
// the audio then attaches to that tee: it gets what has already arrived, then the live rest.
// So the voice request overlaps the browser round trip, and a replay costs nothing.

export class AudioTee {
  constructor() {
    this.chunks = [];
    this.done = false;
    this.error = null;
    this.subs = new Set();
  }

  push(chunk) {
    this.chunks.push(chunk);
    for (const s of this.subs) s.onChunk(chunk);
  }

  end(err = null) {
    this.done = true;
    this.error = err;
    for (const s of this.subs) s.onEnd(err);
    this.subs.clear();
  }

  // Replays what we have, then follows live. Returns an unsubscribe function.
  subscribe(sub) {
    for (const c of this.chunks) sub.onChunk(c);
    if (this.done) { sub.onEnd(this.error); return () => {}; }
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }
}

const jobs = new Map(); // roast id -> job (also guarantees we only ever voice text we wrote)
const MAX_JOBS = 60;

let elevenVoiceId = process.env.ELEVENLABS_VOICE_ID || '';
const PREFERRED_VOICES = ['adam', 'brian', 'josh', 'daniel', 'george', 'liam', 'charlie'];

export async function resolveElevenVoice() {
  if (elevenVoiceId) return elevenVoiceId;
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  const { voices = [] } = await res.json();
  const premade = voices.filter((v) => v.category === 'premade');
  const pool = premade.length ? premade : voices;
  const pick = PREFERRED_VOICES.map((n) => pool.find((v) => v.name?.toLowerCase().startsWith(n))).find(Boolean) || pool[0];
  if (!pick) throw new Error('No ElevenLabs voices available');
  elevenVoiceId = pick.voice_id;
  console.log(`Voice: ${pick.name} (${pick.voice_id})`);
  return elevenVoiceId;
}

async function elevenStream(text) {
  const voice = await resolveElevenVoice();
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.4, similarity_boost: 0.75 },
    }),
  });
}

function openaiSpeech(text) {
  return fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'ash',
      input: text,
      instructions: 'Deadpan comedy roast delivery. Punchy, playful, perfectly timed. Land the last word.',
      response_format: 'mp3',
    }),
  });
}

async function run(job) {
  const t0 = performance.now();
  let upstream = null;
  let provider = 'elevenlabs';
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      upstream = await elevenStream(job.text);
      if (!upstream.ok) {
        console.warn('ElevenLabs TTS failed', upstream.status, (await upstream.text()).slice(0, 200));
        upstream = null;
      }
    } catch (err) {
      console.warn('ElevenLabs TTS error', err.message);
      upstream = null;
    }
  }
  if (!upstream && process.env.OPENAI_API_KEY) {
    provider = 'openai';
    try { upstream = await openaiSpeech(job.text); } catch (err) { console.warn('OpenAI TTS error', err.message); }
  }
  if (!upstream || !upstream.ok || !upstream.body) {
    job.tee.end(new Error('The voice failed. Check the ElevenLabs / OpenAI keys.'));
    job.settle();
    return;
  }
  job.provider = provider;
  job.settle();
  try {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (job.firstByteMs == null) job.firstByteMs = Math.round(performance.now() - t0);
      job.tee.push(Buffer.from(value));
    }
    job.tee.end();
  } catch (err) {
    job.tee.end(err);
  }
}

// Start voicing a roast right now (does not wait for the audio).
export function startSpeech(id, text) {
  let settle;
  const job = {
    id, text, tee: new AudioTee(), provider: null, firstByteMs: null,
    ready: new Promise((r) => { settle = r; }),
    settle: () => settle(),
  };
  jobs.set(id, job);
  if (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
  run(job).catch((err) => { job.tee.end(err); job.settle(); });
  return job;
}

export const getSpeech = (id) => jobs.get(id);

// Resolve the voice and open connections before the first roast, so it does not pay for them.
export async function warmSpeech() {
  const t0 = performance.now();
  if (process.env.ELEVENLABS_API_KEY) await resolveElevenVoice().catch((e) => console.warn('Voice warm-up failed:', e.message));
  return Math.round(performance.now() - t0);
}
