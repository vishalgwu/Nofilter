// Records a short intro line in every character's voice, so the picker can play it when you click a
// character (an instant voice audition).
//   node --env-file=.env scripts/make-cast-samples.mjs            (creates only the missing files)
//   node --env-file=.env scripts/make-cast-samples.mjs --force    (regenerate everything, e.g. after changing a voice)
// The mp3 files live in client/cast/ and are committed, so this only needs to run when the cast changes.

import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTERS, ORDER } from '../server/cast.js';
import { resolveCastVoices, ttsForCharacter, voiceName } from '../server/speech.js';

if (!process.env.ELEVENLABS_API_KEY) { console.error('ELEVENLABS_API_KEY is missing in .env'); process.exit(1); }
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'cast');
const force = process.argv.includes('--force');

await mkdir(OUT, { recursive: true });
await resolveCastVoices();
for (const id of ORDER) {
  const file = path.join(OUT, `${id}.mp3`);
  if (!force && (await access(file).then(() => true, () => false))) { console.log('exists ', id); continue; }
  const res = await ttsForCharacter(CHARACTERS[id].intro, id);
  if (!res.ok) { console.error('FAILED ', id, res.status, (await res.text()).slice(0, 160)); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  console.log('created', id.padEnd(10), `${Math.round(buf.length / 1024)} KB`, ` voice: ${voiceName(id)}`);
}
