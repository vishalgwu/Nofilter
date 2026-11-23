// The mixer - Stage 2, Day 7.
// Plays layers from the sound bank on the Web Audio timeline. Each layer is scheduled by start time
// (`at`, in ms from now), so several can overlap. The first layer of a roast has at = 0: it starts at
// once, so layering never delays the first sound. Everything goes through one bus (the analyser the
// ring is drawn from), and any layer can be faded out, e.g. when the roast voice arrives.

// Pure helper (tested in Node): absolute start times for a list of layers.
export function scheduleTimes(layers, nowMs) {
  return layers
    .map((l) => ({ ...l, startMs: nowMs + (l.at || 0) }))
    .sort((a, b) => a.startMs - b.startMs);
}

export class Mixer {
  constructor(ctx, bus) {
    this.ctx = ctx;
    this.bus = bus; // an AudioNode that goes on to the speakers
    this.buffers = new Map();
  }

  has(id) {
    return this.buffers.has(id);
  }

  durationMs(id) {
    return this.buffers.has(id) ? Math.round(this.buffers.get(id).duration * 1000) : 0;
  }

  // Fetch and decode files into memory. `entries` is [{ id, url }]. A missing file only means that
  // sound never plays; it never breaks the page. Returns the ids that loaded.
  async load(entries) {
    const loaded = await Promise.all(entries.map(async ({ id, url }) => {
      if (this.buffers.has(id)) return id;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        this.buffers.set(id, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        return id;
      } catch {
        return null;
      }
    }));
    return loaded.filter(Boolean);
  }

  // Start a layer `at` ms from now. Returns a handle, or null if the sound is not loaded.
  start(id, { at = 0, gain = 1, loop = false } = {}) {
    const buf = this.buffers.get(id);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.bus);
    const when = this.ctx.currentTime + at / 1000;
    src.start(when);
    const startsAt = performance.now() + at;
    return {
      id,
      startsAt,
      endsAt: loop ? Infinity : startsAt + buf.duration * 1000,
      ended: new Promise((resolve) => { src.onended = resolve; }),
      // fade out instead of cutting off (the roast arrives, the sting is over...)
      stop: (fadeMs = 90) => {
        try {
          const t = Math.max(this.ctx.currentTime, when);
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(0, t, fadeMs / 3000);
          src.stop(t + fadeMs / 1000 + 0.05);
        } catch { /* already finished */ }
      },
    };
  }
}
