// AudioWorklet: turns microphone audio into 16 kHz 16-bit PCM chunks (~100 ms each)
// and reports the loudness (rms, peak) of every chunk. Runs off the main thread.

const TARGET_RATE = 16000;
const CHUNK = 1600; // 100 ms at 16 kHz

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // input samples per output sample
    this.acc = 0; // box-filter accumulator (a simple low-pass before downsampling)
    this.filled = 0;
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.sumSq = 0;
    this.peak = 0;
  }

  emit(v) {
    const c = v > 1 ? 1 : v < -1 ? -1 : v;
    this.out[this.n++] = c < 0 ? c * 32768 : c * 32767;
    this.sumSq += c * c;
    const a = c < 0 ? -c : c;
    if (a > this.peak) this.peak = a;
    if (this.n === CHUNK) {
      const buf = this.out.buffer;
      this.port.postMessage({ pcm: buf, rms: Math.sqrt(this.sumSq / CHUNK), peak: this.peak }, [buf]);
      this.out = new Int16Array(CHUNK);
      this.n = 0;
      this.sumSq = 0;
      this.peak = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      let w = 1; // this input sample covers one unit of time
      const s = ch[i];
      while (w > 0) {
        const room = this.ratio - this.filled;
        if (w >= room) {
          this.acc += s * room;
          this.emit(this.acc / this.ratio);
          this.acc = 0;
          this.filled = 0;
          w -= room;
        } else {
          this.acc += s * w;
          this.filled += w;
          w = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
