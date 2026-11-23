// Shared by make-sounds.mjs and make-voice-lines.mjs: level a clip and fade its end WITHOUT changing its length.
// (ffmpeg's loudnorm filter looks 3 s ahead and silently cuts short clips, so it is not used here.)
// The method: measure the average loudness, apply a plain gain towards a target, limit the peaks, fade the end.

import { rename, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ff = (args) => run('ffmpeg', ['-hide_banner', '-nostats', ...args], { maxBuffer: 16 * 1024 * 1024 });

export const hasFfmpeg = () => run('ffmpeg', ['-version']).then(() => true, () => false);

// ffmpeg prints its progress and results on stderr; execFile rejects on a non-zero exit, so read both ways.
async function stderrOf(args) {
  try { return (await ff(args)).stderr; } catch (e) { return e.stderr || ''; }
}

// The length of the audio ffmpeg actually decodes (the file header can lie after processing).
export async function decodedSeconds(file) {
  const err = await stderrOf(['-i', file, '-f', 'null', '-']);
  const all = [...err.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function meanVolume(file) {
  const err = await stderrOf(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = err.match(/mean_volume: (-?[\d.]+) dB/);
  return m ? Number(m[1]) : null;
}

// Level `file` in place towards `target` dB (mean), fade the last `fadeSec`, optionally trim leading silence
// and cap the length at `maxSeconds`.
// Returns { before, after, gain } in seconds/dB, or null if it left the file alone (and says why).
export async function polish(file, { target = -20, fadeSec = 0.18, trimStart = false, maxGain = 20, maxSeconds = null } = {}) {
  const before = await decodedSeconds(file);
  const mean = await meanVolume(file);
  if (before == null || mean == null || mean < -70) return { skipped: 'file looks silent or unreadable' };
  const gain = Math.max(-12, Math.min(maxGain, target - mean));
  const filters = [
    ...(trimStart ? ['silenceremove=start_periods=1:start_silence=0.02:start_threshold=-45dB'] : []),
    // a hard length cap: one rambling text-to-speech take must never become a 4-second "interjection"
    ...(maxSeconds ? [`atrim=end=${maxSeconds}`] : []),
    `volume=${gain.toFixed(1)}dB`,
    'alimiter=limit=0.89:attack=2:release=30',
    // fade the END without knowing the length: reverse, fade in, reverse back
    `areverse,afade=t=in:d=${fadeSec},areverse`,
  ];
  const tmp = `${file}.tmp.mp3`;
  await ff(['-loglevel', 'error', '-y', '-i', file, '-af', filters.join(','), '-ar', '44100', '-b:a', '96k', tmp]);
  const after = await decodedSeconds(tmp);
  // Safety net: a processed clip that came out clearly shorter is a bug, never keep it.
  const minimum = trimStart || maxSeconds ? 0.2 : before * 0.92;
  if (after == null || after < minimum) {
    await unlink(tmp).catch(() => {});
    return { skipped: `output was ${after?.toFixed(2)}s from ${before.toFixed(2)}s, kept the original` };
  }
  await rename(tmp, file);
  return { before, after, gain };
}
