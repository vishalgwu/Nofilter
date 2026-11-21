// RoastCast roaster - Stage 1, Day 4
// Writes the roast in one of three modes (see humor.js MODES) and times every step.

import { chatStream } from './llm.js';
import {
  MAX_WORDS, MODES, resolveType, buildSystemPrompt, buildUserPrompt, PICK_SYSTEM, buildPickPrompt,
  parseCandidates, validCandidates, dropCopies, dropStock, selectSelf, parsePick, rulePick, capWords, cleanRoast, describeMoment,
} from './humor.js';

const MODEL = () => process.env.OPENAI_MODEL || 'gpt-4.1-mini'; // fast, non-reasoning
const PICK_MODEL = () => process.env.OPENAI_PICK_MODEL || MODEL();
export const defaultMode = () => (MODES.includes(process.env.ROAST_MODE) ? process.env.ROAST_MODE : 'self');

const fail = (message, status = 502) => Object.assign(new Error(message), { status });

// One write attempt in the given mode -> { candidates, picked, pickedBy } (candidates may be empty).
function interpret(mode, raw) {
  if (mode === 'self') return selectSelf(raw);
  if (mode === 'quick') {
    // A single roast as plain text (if the model sent JSON anyway, take its first roast).
    const text = raw.trim().startsWith('{') ? parseCandidates(raw)[0] || '' : cleanRoast(raw);
    const keep = text ? dropStock(dropCopies(validCandidates([text]))) : [];
    return keep.length ? { candidates: keep, picked: 0, pickedBy: 'only' } : { candidates: [], picked: -1, pickedBy: 'none', loose: text };
  }
  const keep = dropStock(dropCopies(validCandidates(parseCandidates(raw))));
  return { candidates: keep, picked: keep.length ? 0 : -1, pickedBy: keep.length > 1 ? 'pending' : 'only', loose: parseCandidates(raw)[0] };
}

// ctx: { momentType, moment, transcript, seconds }   level: gentle | spicy | savage
// session: a Session from humor.js (running jokes), or null
export async function writeRoast(ctx, level, session = null, mode = defaultMode()) {
  if (!MODES.includes(mode)) mode = defaultMode();

  const tp = performance.now();
  const type = resolveType(ctx);
  const system = buildSystemPrompt(type);
  const promptMs = Math.round(performance.now() - tp);

  // 1) the writing call
  const t0 = performance.now();
  let result = { candidates: [] };
  let firstTokenMs = 0;
  let loose = '';
  for (let attempt = 0; attempt < 2 && !result.candidates.length; attempt++) {
    const out = await chatStream({
      model: MODEL(), system, user: buildUserPrompt(ctx, level, type, session, attempt === 1, mode),
      maxTokens: mode === 'quick' ? 60 : 240, temperature: 1, json: mode !== 'quick', timeoutMs: 9000,
    });
    firstTokenMs = firstTokenMs || out.firstTokenMs;
    result = interpret(mode, out.text);
    loose = result.loose || loose;
  }
  if (!result.candidates.length) {
    if (!loose) throw fail('The roast writer returned nothing.');
    result = { candidates: [capWords(loose)], picked: 0, pickedBy: 'only' }; // last resort: hard cut at the word limit
  }
  const candMs = Math.round(performance.now() - t0);

  // 2) "best" mode only: a separate judge picks the funniest (this is the extra ~0.4 s)
  let { candidates: valid, picked, pickedBy } = result;
  let pickMs = 0;
  if (mode === 'best' && valid.length > 1) {
    const t1 = performance.now();
    try {
      const pick = await chatStream({
        model: PICK_MODEL(), system: PICK_SYSTEM, user: buildPickPrompt(ctx, valid),
        maxTokens: 12, temperature: 0, json: true, timeoutMs: 2500,
      });
      const idx = parsePick(pick.text, valid.length);
      if (idx >= 0) { picked = idx; pickedBy = 'judge'; } else { picked = rulePick(valid); pickedBy = 'rule'; }
    } catch (err) {
      console.warn('Judge failed, using the shortest roast:', err.message);
      picked = rulePick(valid);
      pickedBy = 'rule';
    }
    pickMs = Math.round(performance.now() - t1);
  }

  const text = valid[picked];
  session?.record(type, ctx.moment || describeMoment(ctx), text);
  return {
    text, candidates: valid, picked, pickedBy, type, mode,
    promptMs, firstTokenMs, candMs, pickMs, llmMs: candMs + pickMs,
    words: text.split(/\s+/).length, maxWords: MAX_WORDS,
  };
}
