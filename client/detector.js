// Moment detector - Stage 1, Day 2
// Pure logic (no DOM, no audio APIs) so it can be tested in Node.
// Fed ~100 ms audio frames (rms, peak) plus speech-to-text events, it decides
// when a moment is worth a roast: scream, crash, silence, or something said.

export class MomentDetector {
  constructor(opts = {}) {
    this.o = {
      cooldownMs: 10000, // minimum gap between roasts
      silenceMs: 8000, // quiet this long -> "silence" moment
      minWords: 4, // spoken line must be at least this long
      voiceRms: 0.02, // above this a frame counts as voice
      loudMin: 0.3, // a scream must beat this and 3x the usual speaking level
      crashMin: 0.3, // a crash is a short spike above this...
      crashPeak: 0.8, // ...that nearly clips the microphone
      screamFrames: 3, // ~300 ms of sustained loud = scream
      ...opts,
    };
    this.onMoment = opts.onMoment || (() => {});
    this.enabled = true;
    this.reset(0);
  }

  reset(now = 0) {
    this.voiceLevel = 0.05; // running average of how loud the player normally is
    this.voicedFrames = 0; // used to learn that level quickly at the start
    this.hist = []; // last few frame levels
    this.loudRun = 0;
    this.runMax = 0;
    this.runPrevAvg = 0;
    this.lastVoiceAt = now;
    this.lastAudioVoiceAt = now; // last time the MICROPHONE heard a voice (words do not count)
    this.silenceFired = false;
    this.lastMomentAt = -Infinity;
    this.utter = [];
    this.screamFired = false;
  }

  // Pause detection while the roast is playing (so it does not roast itself).
  setEnabled(on, now = 0) {
    this.enabled = on;
    if (!on) { this.loudRun = 0; this.utter = []; this.screamFired = false; }
    this.lastVoiceAt = now; // restart the silence timer either way
    this.silenceFired = false;
  }

  cooldownLeft(now) {
    return Math.max(0, this.o.cooldownMs - (now - this.lastMomentAt));
  }

  fire(type, detail, now) {
    if (!this.enabled || this.cooldownLeft(now) > 0) return false;
    this.lastMomentAt = now;
    // detectMs: how long after the player's last sound we decided to roast (for the speed log)
    this.onMoment({ type, ...detail, at: now, detectMs: Math.max(0, Math.round(now - this.lastAudioVoiceAt)) });
    return true;
  }

  // One audio frame. rms/peak are 0..1.
  feed(rms, peak, now) {
    if (!this.enabled) { this.lastVoiceAt = now; return; }
    const o = this.o;

    if (rms > o.voiceRms) {
      this.lastVoiceAt = now;
      this.lastAudioVoiceAt = now;
      this.silenceFired = false;
      if (rms < 0.45) {
        // learn fast during the first ~2 s of talking, slowly afterwards
        const a = this.voicedFrames++ < 20 ? 0.12 : 0.03;
        this.voiceLevel = this.voiceLevel * (1 - a) + rms * a;
      }
    }

    const prevAvg = this.hist.length ? this.hist.reduce((a, b) => a + b, 0) / this.hist.length : 0;
    this.hist.push(rms);
    if (this.hist.length > 6) this.hist.shift();

    const loudT = Math.max(o.loudMin, this.voiceLevel * 3);
    if (rms > loudT) {
      if (this.loudRun === 0) { this.runMax = 0; this.runPeak = 0; this.runPrevAvg = prevAvg; }
      this.loudRun++;
      this.runMax = Math.max(this.runMax, rms);
      this.runPeak = Math.max(this.runPeak, peak);
      // Start early: fire as soon as the scream is clearly sustained, before it ends.
      if (this.loudRun >= o.screamFrames && !this.screamFired) {
        if (this.fire('scream', {}, now)) this.screamFired = true;
      }
    } else if (this.loudRun > 0) {
      // A crash is a short, sharp, near-clipping spike out of quiet that dies away at once.
      // Speech that merely starts loudly keeps going at a normal level, so it does not count.
      const shortSpike = this.loudRun < o.screamFrames;
      const sharp = this.runPeak >= o.crashPeak && this.runMax >= o.crashMin;
      const diedAway = rms < this.runMax * 0.5 && rms < Math.max(0.07, this.voiceLevel * 1.5);
      const standsOut = this.runMax >= this.runPrevAvg * 4; // well above whatever was happening before
      if (shortSpike && sharp && diedAway && standsOut) {
        this.fire('crash', {}, now);
      }
      this.loudRun = 0;
      this.screamFired = false;
    }

    // Long silence
    if (!this.silenceFired && now - this.lastVoiceAt >= o.silenceMs) {
      const seconds = Math.round((now - this.lastVoiceAt) / 1000);
      if (this.fire('silence', { seconds }, now)) this.silenceFired = true;
    }
  }

  // Speech-to-text event. final = this chunk is final; speechFinal = the player stopped talking.
  speech(text, { final = false, speechFinal = false } = {}, now) {
    if (!this.enabled) return;
    if (text) {
      this.lastVoiceAt = now;
      this.silenceFired = false;
      if (final) this.utter.push(text.trim());
    }
    // Deepgram can send speech_final with empty text: it still ends the line.
    if (speechFinal) this.flushUtterance(now);
  }

  // Called when the player has stopped talking (speech_final or UtteranceEnd).
  flushUtterance(now) {
    if (!this.utter.length) return;
    const line = this.utter.join(' ').replace(/\s+/g, ' ').trim();
    this.utter = [];
    const words = line.split(/\s+/).filter(Boolean).length;
    if (words >= this.o.minWords) this.fire('speech', { text: line }, now);
  }
}
