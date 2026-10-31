// 声音全部用 WebAudio 现场合成：引擎（两路锯齿波 + 低通，音高跟车速和档位走）、漂移胎噪、氮气呼啸、倒计时、撞墙。
export class Sound {
  constructor() { this.ctx = null; this.on = true; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.55 : 0; this.master.connect(c.destination);
    // 引擎
    this.eng = c.createGain(); this.eng.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
    this.engLp = lp;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    const g2 = c.createGain(); g2.gain.value = 0.35;
    this.o1.connect(lp); this.o2.connect(g2).connect(lp); lp.connect(this.eng).connect(this.master);
    this.o1.start(); this.o2.start();
    // 噪声源（胎噪、风声、呼啸共用）
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkNoise = (type, f, q) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = type; bp.frequency.value = f; bp.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.master); src.start();
      return { g, bp };
    };
    this.skid = mkNoise('bandpass', 1500, 4);
    this.wind = mkNoise('lowpass', 500, 0.7);
  }
  setOn(on) { this.on = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05); }
  update(speed, throttle, drifting, boost, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 简单的“换挡”：每档一段音高
    const v = Math.abs(speed), gear = Math.min(5, Math.floor(v / 14)), inGear = (v - gear * 14) / 14;
    const f = 55 + gear * 9 + inGear * 70 + (boost ? 18 : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.05); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engLp.frequency.setTargetAtTime(600 + v * 30 + (throttle ? 500 : 0), t, 0.08);
    this.eng.gain.setTargetAtTime(active ? 0.1 + (throttle ? 0.06 : 0) + v * 0.0012 : 0.05, t, 0.1);
    this.skid.g.gain.setTargetAtTime(drifting && v > 10 ? 0.12 : 0, t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.2, v * 0.0028) + (boost ? 0.08 : 0), t, 0.2);
    this.wind.bp.frequency.setTargetAtTime(400 + v * 12, t, 0.2);
  }
  blip(freq = 660, dur = 0.12, type = 'square', vol = 0.18) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.02);
  }
  whoosh(vol = 0.35, dur = 0.9) {
    if (!this.ctx) return;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, c.currentTime); bp.frequency.exponentialRampToValueAtTime(2400, c.currentTime + dur * 0.6);
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(bp).connect(g).connect(this.master); src.start(); src.stop(c.currentTime + dur);
  }
  thud(power) {
    if (!this.ctx) return;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = c.createGain(); g.gain.setValueAtTime(Math.min(0.6, power * 0.04), c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
    src.connect(lp).connect(g).connect(this.master); src.start(); src.stop(c.currentTime + 0.3);
  }
}
