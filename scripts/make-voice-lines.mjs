// Records the one-word interjections ("Whoa!", "Oh dear.", "Folks!"...) in each character's own voice.
//   node --env-file=.env scripts/make-voice-lines.mjs            (creates only the missing files)
//   node --env-file=.env scripts/make-voice-lines.mjs --force    (regenerate everything)
// The list lives in client/soundbank.js. Files go to client/voices/ and are committed. With ffmpeg,
// the silence at the start is trimmed (so a line starts the instant it is played) and the end gets a
// short fade.

import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_LINES } from '../client/soundbank.js';
import { resolveCastVoices, ttsForCharacter, voiceName } from '../server/speech.js';
import { hasFfmpeg, polish } from './audio-polish.mjs';

if (!process.env.ELEVENLABS_API_KEY) { console.error('ELEVENLABS_API_KEY is missing in .env'); process.exit(1); }
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'voices');
const force = process.argv.includes('--force');
const ffmpeg = await hasFfmpeg();
if (!ffmpeg) console.warn('ffmpeg not found: leading silence will not be trimmed.');

// Trim the silence at the start (a line should start the instant it is played), level it, fade the end.
async function level(id, file) {
  if (!ffmpeg) return;
  const r = await polish(file, { target: -19, fadeSec: 0.08, trimStart: true, maxSeconds: 1.3 });
  if (r.skipped) console.log(`  ! ${id}: ${r.skipped}`);
}

await mkdir(OUT, { recursive: true });
await resolveCastVoices();
for (const [id, line] of Object.entries(VOICE_LINES)) {
  const file = path.join(OUT, `${id}.mp3`);
  if (!force && (await access(file).then(() => true, () => false))) { console.log('exists ', id); continue; }
  const res = await ttsForCharacter(line.text, line.character);
  if (!res.ok) { console.error('FAILED ', id, res.status, (await res.text()).slice(0, 160)); continue; }
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  await level(id, file);
  console.log('created', id.padEnd(24), `"${line.text}"`.padEnd(16), voiceName(line.character));
}
