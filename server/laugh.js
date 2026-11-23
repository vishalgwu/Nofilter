// Day 5: turn the timing log into laugh scores.
// Pure functions (no file access) so they can be tested with made-up rows.
// Log rows are { type: 'roast', id, tester, session, momentKind, level, mode, roast, roastStartMs, ... }
// and { type: 'laugh', id, laughScore } (a roast can be re-rated: the latest rating wins).

import { summarize } from './stats.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// Join each roast with its latest score. Rows are in log order (oldest first).
export function joinRoasts(rows, { testOnly = true, since = 0 } = {}) {
  const roasts = new Map();
  for (const r of rows) {
    if (!r || r.type !== 'roast' || !r.id) continue;
    if (since && Date.parse(r.ts) < since) continue;
    if (testOnly && !r.tester) continue;
    roasts.set(r.id, { ...r, score: null });
  }
  for (const r of rows) {
    if (!r || r.type !== 'laugh' || !roasts.has(r.id)) continue;
    const s = Number(r.laughScore);
    if (Number.isInteger(s) && s >= 0 && s <= 3) roasts.get(r.id).score = s; // later rows overwrite earlier ones
  }
  return [...roasts.values()];
}

function group(roasts, keyOf) {
  const m = new Map();
  for (const r of roasts) {
    const k = keyOf(r) ?? 'unknown';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()].map(([key, list]) => {
    const rated = list.filter((r) => r.score != null);
    return { key, roasts: list.length, rated: rated.length, avg: round2(avg(rated.map((r) => r.score))) };
  });
}

const byAvgAsc = (a, b) => (a.avg ?? 99) - (b.avg ?? 99);

export function analyze(rows, opts = {}) {
  const roasts = joinRoasts(rows, opts);
  const rated = roasts.filter((r) => r.score != null);
  const scores = rated.map((r) => r.score);
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const s of scores) dist[s]++;

  const byType = group(roasts, (r) => r.momentKind || r.momentType).sort(byAvgAsc);
  const byLevel = group(roasts, (r) => r.level);
  const byMode = group(roasts, (r) => r.mode);
  // Stage 2: which voice made people laugh? (rows from before the cast existed count as "classic")
  const byCharacter = group(roasts, (r) => r.character || 'classic').sort(byAvgAsc);
  // Stage 2: do the sound layers (effects, a second voice, a sting) help? Older rows had one plain reaction.
  const bySound = group(roasts, (r) => (r.layered === true ? 'layered' : 'plain'));
  const byTester = group(roasts, (r) => r.tester).map((t) => ({
    ...t,
    sessions: new Set(roasts.filter((r) => r.tester === t.key).map((r) => r.session)).size,
  }));

  const starts = roasts.map((r) => r.roastStartMs).filter(Number.isFinite);
  const speed = {
    n: starts.length,
    ...summarize(starts),
    pctUnder3s: starts.length ? Math.round((starts.filter((s) => s < 3000).length / starts.length) * 100) : null,
    pctUnder1500: starts.length ? Math.round((starts.filter((s) => s < 1500).length / starts.length) * 100) : null,
  };

  // The weakest moment type that has enough ratings to mean something (at least 3).
  const candidates = byType.filter((t) => t.rated >= 3 && t.key !== 'unknown');
  const weakest = candidates.length ? candidates[0] : null;
  const ofType = weakest ? rated.filter((r) => (r.momentKind || r.momentType) === weakest.key) : [];
  const sorted = [...ofType].sort((a, b) => a.score - b.score);

  const average = round2(avg(scores));
  const testers = new Set(roasts.map((r) => r.tester).filter(Boolean)).size;
  const sessions = new Set(roasts.filter((r) => r.tester).map((r) => `${r.tester}#${r.session}`)).size;

  return {
    roasts: roasts.length, rated: rated.length, unrated: roasts.length - rated.length,
    average, pctAtLeast2: rated.length ? Math.round((scores.filter((s) => s >= 2).length / rated.length) * 100) : null, dist,
    byType, byLevel, byMode, byCharacter, bySound, byTester, speed, testers, sessions,
    weakest: weakest && {
      ...weakest,
      worst: sorted.slice(0, 3).map((r) => ({ score: r.score, moment: r.moment, roast: r.roast })),
      best: sorted.slice(-3).reverse().map((r) => ({ score: r.score, moment: r.moment, roast: r.roast })),
    },
    // Stage 1 is done when the average is at least 2 out of 3 AND 90% of roasts start speaking in under 3 s.
    verdict: {
      laughOk: average != null && average >= 2,
      speedOk: speed.pctUnder3s != null && speed.pctUnder3s >= 90,
    },
    winners: roasts.filter((r) => r.score === 3),
  };
}
