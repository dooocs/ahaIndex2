// 声音全部用 WebAudio 现场合成，没有音频文件：
// - 背景音乐：一段原创的江南五声音阶小曲（D 宫调，104 BPM，8 小节循环）——拨弦主旋律带回声、柔和铺底、低音、轻打击；
// - 车：引擎（两路锯齿波 + 低通，音高跟车速和档位）、漂移胎噪、风声、氮气呼啸、撞墙。
// 音量层次：音乐在前，车声垫在下面。
const MIDI = n => 440 * Math.pow(2, (n - 69) / 12);

// 主旋律（八分音符一步，null 为休止），8 小节 × 8 步
const MELODY = [
  74, null, 76, 78, 81, null, 78, 76,
  74, null, 71, null, 69, 71, 74, null,
  76, null, 74, 71, 69, null, 71, 74,
  76, null, null, null, 78, 76, 74, null,
  71, 74, 76, null, 78, null, 76, 74,
  76, null, 74, 71, 69, null, null, null,
  71, null, 74, 76, 78, 81, 78, null,
  76, null, 74, null, 74, null, null, null,
];
// 每小节的和弦（根音 + 铺底三音）
const CHORDS = [
  [50, [62, 66, 69]], [47, [59, 62, 66]], [43, [55, 59, 62]], [45, [57, 61, 64]],
  [43, [55, 59, 62]], [45, [57, 61, 64]], [47, [59, 62, 66]], [45, [57, 62, 66]],
];
const BPM = 104, STEP = 60 / BPM / 2;

export class Sound {
  constructor() { this.ctx = null; this.on = true; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.6 : 0; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.55; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = 0; this.music.connect(this.master);
    this.music.gain.setTargetAtTime(0.9, c.currentTime, 0.8);
    // 主旋律的回声（附点八分）
    this.echo = c.createDelay(1); this.echo.delayTime.value = STEP * 1.5;
    const fb = c.createGain(); fb.gain.value = 0.32;
    const wet = c.createGain(); wet.gain.value = 0.35;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2200;
    this.echo.connect(tone).connect(fb).connect(this.echo); tone.connect(wet).connect(this.music);

    // 引擎
    this.eng = c.createGain(); this.eng.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
    this.engLp = lp;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    const g2 = c.createGain(); g2.gain.value = 0.35;
    this.o1.connect(lp); this.o2.connect(g2).connect(lp); lp.connect(this.eng).connect(this.sfx);
    this.o1.start(); this.o2.start();
    // 噪声源（胎噪、风声、呼啸、镲片共用）
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkNoise = (type, f, q) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = type; bp.frequency.value = f; bp.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.sfx); src.start();
      return { g, bp };
    };
    this.skid = mkNoise('bandpass', 1500, 4);
    this.wind = mkNoise('lowpass', 500, 0.7);

    // 音乐时钟：每 25 ms 往前排 0.15 s 的音符
    this.step = 0; this.next = c.currentTime + 0.3;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  setOn(on) { this.on = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.05); }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    while (this.next < c.currentTime + 0.15) {
      this.playStep(this.step, this.next);
      this.next += STEP;
      this.step = (this.step + 1) % MELODY.length;
    }
  }
  playStep(i, t) {
    const bar = Math.floor(i / 8), beat = i % 8, [root, triad] = CHORDS[bar];
    const n = MELODY[i];
    if (n != null) this.pluck(MIDI(n), t, 0.16);
    if (beat === 0 || beat === 4) this.bass(MIDI(root), t, beat === 0 ? 0.2 : 0.14);
    if (beat === 0) triad.forEach(m => this.pad(MIDI(m), t, STEP * 8));
    // 轻打击：一拍一个闷鼓，反拍一点沙锤，第二、四拍一个木鱼一样的轻敲
    if (beat === 0 || beat === 4) this.kick(t);
    if (beat % 2 === 1) this.shaker(t, beat === 3 || beat === 7 ? 0.05 : 0.03);
    if (beat === 2 || beat === 6) this.block(t);
  }
  pluck(f, t, vol) {   // 拨弦：三角波 + 高八度的正弦，快起慢落，送一点到回声
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(3800, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g); g.connect(this.music); g.connect(this.echo);
    o.start(t); o2.start(t); o.stop(t + 1); o2.stop(t + 1);
  }
  bass(f, t, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 3.5);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + STEP * 4);
  }
  pad(f, t, dur) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.022, t + 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + dur + 0.05);
  }
  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.22);
  }
  shaker(t, vol) {
    const c = this.ctx, src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf; hp.type = 'highpass'; hp.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp).connect(g).connect(this.music); src.start(t, Math.random()); src.stop(t + 0.06);
  }
  block(t) {   // 木鱼似的轻敲
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 820;
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.1);
  }

  update(speed, throttle, drifting, boost, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.abs(speed), gear = Math.min(5, Math.floor(v / 14)), inGear = (v - gear * 14) / 14;
    const f = 55 + gear * 9 + inGear * 70 + (boost ? 18 : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.05); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engLp.frequency.setTargetAtTime(500 + v * 22 + (throttle ? 350 : 0), t, 0.08);
    // 车声垫在音乐下面：引擎、胎噪、风声都比之前低一半左右
    this.eng.gain.setTargetAtTime(active ? 0.045 + (throttle ? 0.025 : 0) + v * 0.0006 : 0.02, t, 0.1);
    this.skid.g.gain.setTargetAtTime(drifting && v > 10 ? 0.06 : 0, t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.08, v * 0.0011) + (boost ? 0.04 : 0), t, 0.2);
    this.wind.bp.frequency.setTargetAtTime(400 + v * 12, t, 0.2);
  }
  blip(freq = 660, dur = 0.12, type = 'square', vol = 0.18) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.sfx); o.start(); o.stop(c.currentTime + dur + 0.02);
  }
  whoosh(vol = 0.35, dur = 0.9) {
    if (!this.ctx) return;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, c.currentTime); bp.frequency.exponentialRampToValueAtTime(2400, c.currentTime + dur * 0.6);
    const g = c.createGain(); g.gain.setValueAtTime(vol * 0.7, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(bp).connect(g).connect(this.sfx); src.start(); src.stop(c.currentTime + dur);
  }
  thud(power) {
    if (!this.ctx) return;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = c.createGain(); g.gain.setValueAtTime(Math.min(0.45, power * 0.03), c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
    src.connect(lp).connect(g).connect(this.sfx); src.start(); src.stop(c.currentTime + 0.3);
  }
}
