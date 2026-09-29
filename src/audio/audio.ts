// Synthesized SFX — SPEC §11. No shipped samples: every cue is a few
// oscillator/noise nodes. Muted until the first user interaction (mobile
// autoplay policy); the caller should invoke unlock() from a click/tap.

/** Fade-in at the start of every cue, seconds. */
const ATTACK = 0.004;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  enabled = false;

  unlock() {
    clearTimeout(this.sleepTimer);
    if (this.ctx) {
      // Suspended between matches (see sleep); wake it for this one.
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.15;
    this.musicGain.connect(this.master);
    this.enabled = true;
  }

  /** Close the output stream while nothing can play (the menus). An idle
   *  but running AudioContext keeps the sound device open, and some drivers
   *  hiss or crackle faintly the whole time a stream is open. */
  sleep() {
    // Deferred, so the match-end fanfare that plays as the match screen
    // unmounts still finishes.
    clearTimeout(this.sleepTimer);
    this.sleepTimer = setTimeout(() => {
      if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
    }, 2000);
  }
  private sleepTimer: ReturnType<typeof setTimeout> | undefined;

  setVolume(v: number) {
    if (this.master) this.master.gain.value = v;
  }

  /** Briefly lowers the master gain so a big cue (GRENADE) doesn't clip
   *  everything else playing at the same time. */
  private duck(amount: number, ms: number) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(g.value * (1 - amount), now + 0.02);
    g.linearRampToValueAtTime(g.value, now + ms / 1000);
  }

  private tone(freq: number, duration: number, type: OscillatorType = "square", gain = 0.2, slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slideTo !== undefined) osc.frequency.linearRampToValueAtTime(slideTo, this.ctx.currentTime + duration);
    // A few ms of attack instead of jumping straight to full gain: a waveform
    // that starts mid-swing is a click, heard as crackle when cues overlap.
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + ATTACK);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  private noiseBurst(duration: number, gain = 0.3, filterFreq = 1200) {
    if (!this.ctx || !this.master) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + ATTACK);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  fire() { this.tone(660, 0.08, "square", 0.12, 440); }
  ricochet() { this.tone(900, 0.06, "triangle", 0.1, 1400); }
  brickCrumble() { this.noiseBurst(0.15, 0.25, 900); }
  steelClang() { this.tone(180, 0.12, "square", 0.2); this.tone(220, 0.1, "square", 0.15); }
  explosion() { this.noiseBurst(0.35, 0.4, 600); this.tone(90, 0.3, "sawtooth", 0.2, 40); }
  grenadeBlast() {
    this.duck(0.35, 600);
    this.noiseBurst(0.6, 0.5, 450);
    this.tone(70, 0.5, "sawtooth", 0.25, 30);
  }
  spawn() { this.tone(440, 0.15, "sine", 0.15, 660); }
  bonusPickup() { this.tone(523, 0.08, "square", 0.15, 784); this.tone(784, 0.1, "square", 0.12); }
  teamBonusFanfare() {
    this.duck(0.4, 500);
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.15, "square", 0.2), i * 90));
  }
  flagAlarm() { this.tone(300, 0.2, "sawtooth", 0.2, 200); this.duck(0.3, 400); }
  matchEnd() {
    this.duck(0.2, 800);
    [392, 523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, "triangle", 0.2), i * 140));
  }
}

export const audio = new Audio();
