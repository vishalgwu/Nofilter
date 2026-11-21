// RoastCast roaster - Stage 1, Day 3
// Writes THREE candidate roasts in one fast call, drops any over 15 words,
// then a quick pick step chooses the funniest. Every step is timed.

import {
  MAX_WORDS, resolveType, buildSystemPrompt, buildUserPrompt, PICK_SYSTEM, buildPickPrompt,
  parseCandidates, validCandidates, dropCopies, parsePick, rulePick, capWords, describeMoment,
} from './humor.js';

const MODEL = () => process.env.OPENAI_MODEL || 'gpt-4.1-mini'; // fast, non-reasoning
const PICK_MODEL = () => process.env.OPENAI_PICK_MODEL || MODEL();

const fail = (message, status = 502) => Object.assign(new Error(message), { status });

async function chat({ model, system, user, maxTokens, temperature, timeoutMs }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw fail('OPENAI_API_KEY is missing in .env', 500);
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature,
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
  } catch (err) {
    throw fail(err.name === 'TimeoutError' ? 'The roast writer timed out.' : 'Could not reach OpenAI.', 504);
  }
  if (!res.ok) {
    console.error('OpenAI error', res.status, (await res.text()).slice(0, 300));
    throw fail(`The roast writer failed (OpenAI ${res.status}).`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ctx: { momentType, moment, transcript, seconds }   level: gentle | spicy | savage
// session: a Session from humor.js (running jokes), or null
export async function writeRoast(ctx, level, session = null) {
  const type = resolveType(ctx);
  const system = buildSystemPrompt(type);

  // 1) three candidates, one call
  const t0 = performance.now();
  let all = [];
  let valid = [];
  for (let attempt = 0; attempt < 2 && !valid.length; attempt++) {
    const raw = await chat({
      model: MODEL(), system, user: buildUserPrompt(ctx, level, type, session, attempt === 1),
      maxTokens: 220, temperature: 1, timeoutMs: 9000,
    });
    all = parseCandidates(raw);
    valid = dropCopies(validCandidates(all));
  }
  if (!valid.length) {
    if (!all.length) throw fail('The roast writer returned nothing.');
    valid = [capWords(all[0])]; // last resort: hard cut at the word limit
  }
  const candMs = Math.round(performance.now() - t0);

  // 2) quick pick (skipped when only one roast survived)
  let picked = 0;
  let pickedBy = 'only';
  let pickMs = 0;
  if (valid.length > 1) {
    const t1 = performance.now();
    try {
      const raw = await chat({
        model: PICK_MODEL(), system: PICK_SYSTEM, user: buildPickPrompt(ctx, valid),
        maxTokens: 12, temperature: 0, timeoutMs: 2500,
      });
      const idx = parsePick(raw, valid.length);
      if (idx >= 0) { picked = idx; pickedBy = 'ai'; }
      else { picked = rulePick(valid); pickedBy = 'rule'; }
    } catch (err) {
      console.warn('Pick step failed, using the shortest roast:', err.message);
      picked = rulePick(valid);
      pickedBy = 'rule';
    }
    pickMs = Math.round(performance.now() - t1);
  }

  const text = valid[picked];
  session?.record(type, ctx.moment || describeMoment(ctx), text);
  return {
    text, candidates: valid, picked, pickedBy, type,
    candMs, pickMs, llmMs: candMs + pickMs, words: text.split(/\s+/).length, maxWords: MAX_WORDS,
  };
}
