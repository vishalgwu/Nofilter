// Generates the fast-lane reaction sounds (gasps, oooh, laughs...) with ElevenLabs sound effects.
//   node --env-file=.env scripts/make-sounds.mjs            (creates only the missing files)
//   node --env-file=.env scripts/make-sounds.mjs --force    (regenerate everything)
// The mp3 files live in client/sounds/ and are committed, so this only needs to run once.

import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS } from '../client/fastlane.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'sounds');
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is missing in .env'); process.exit(1); }
const force = process.argv.includes('--force');

await mkdir(OUT, { recursive: true });
for (const [name, prompt] of Object.entries(SOUNDS)) {
  const file = path.join(OUT, `${name}.mp3`);
  if (!force && (await access(file).then(() => true, () => false))) { console.log('exists ', name); continue; }
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds: 1.2, prompt_influence: 0.5 }),
  });
  if (!res.ok) { console.error('FAILED ', name, res.status, (await res.text()).slice(0, 160)); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  console.log('created', name, `${Math.round(buf.length / 1024)} KB`);
}
