// One streaming chat call to OpenAI. Streaming does not make the whole answer arrive sooner,
// but it lets us time the FIRST token, which is the number that matters for the speed log.

const fail = (message, status = 502) => Object.assign(new Error(message), { status });

export async function chatStream({ model, system, user, maxTokens, temperature, json = false, timeoutMs = 9000 }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw fail('OPENAI_API_KEY is missing in .env', 500);
  const t0 = performance.now();
  let firstTokenMs = 0;
  let text = '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature,
        max_completion_tokens: maxTokens,
        stream: true,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      console.error('OpenAI error', res.status, (await res.text()).slice(0, 300));
      throw fail(`The roast writer failed (OpenAI ${res.status}).`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
        let delta;
        try { delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content; } catch { continue; }
        if (!delta) continue;
        if (!firstTokenMs) firstTokenMs = performance.now() - t0;
        text += delta;
      }
    }
  } catch (err) {
    if (err.status) throw err;
    throw fail(err.name === 'TimeoutError' ? 'The roast writer timed out.' : 'Could not reach OpenAI.', 504);
  }
  return { text, firstTokenMs: Math.round(firstTokenMs), totalMs: Math.round(performance.now() - t0) };
}
