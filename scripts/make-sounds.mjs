// Generates the sound-effect layers (gasps, oooh, splash, rimshot...) with ElevenLabs sound effects.
//   node --env-file=.env scripts/make-sounds.mjs                 (creates only the missing files)
//   node --env-file=.env scripts/make-sounds.mjs --force         (regenerate everything: costs credits)
//   node --env-file=.env scripts/make-sounds.mjs --repolish      (re-level and fade the existing files: free)
// The list lives in client/soundbank.js. The mp3 files go to client/sounds/ and are committed, so this
// only needs to run when the bank changes. If ffmpeg is installed, each new file is levelled to the same
// loudness and given a short fade-out so it does not end with a click (see audio-polish.mjs).

import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX } from '../client/soundbank.js';
import { hasFfmpeg, polish } from './audio-polish.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'sounds');
const KEY = process.env.ELEVENLABS_API_KEY;
const force = process.argv.includes('--force');
const repolish = process.argv.includes('--repolish');
if (!KEY && !repolish) { console.error('ELEVENLABS_API_KEY is missing in .env'); process.exit(1); }

// Most sounds are 1.2 s; these need a little longer to make sense.
const SECONDS = { sad_trombone: 1.8, drumroll: 1.6, crowd_laugh: 1.6, applause: 1.6, tumbleweed: 4 };

const ffmpeg = await hasFfmpeg();
if (!ffmpeg) console.warn('ffmpeg not found: files will not be levelled or faded. (Install ffmpeg and use --repolish to fix.)');

async function level(name, file) {
  if (!ffmpeg) return;
  const r = await polish(file, { target: -20, fadeSec: 0.18 });
  console.log(r.skipped ? `  ! ${name}: ${r.skipped}` : `  ${name}: ${r.before.toFixed(2)}s -> ${r.after.toFixed(2)}s, gain ${r.gain.toFixed(1)} dB`);
}

await mkdir(OUT, { recursive: true });
for (const [name, def] of Object.entries(SFX)) {
  const file = path.join(OUT, `${name}.mp3`);
  const exists = await access(file).then(() => true, () => false);
  if (repolish) { if (exists) await level(name, file); continue; }
  if (exists && !force) { console.log('exists ', name); continue; }
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: def.prompt, duration_seconds: SECONDS[name] || 1.2, prompt_influence: 0.5 }),
  });
  if (!res.ok) { console.error('FAILED ', name, res.status, (await res.text()).slice(0, 160)); continue; }
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log('created', name);
  await level(name, file);
}
