// ---------------------------------------------------------------------------
// Synthesised sound effects (WebAudio, no sample files).
// ---------------------------------------------------------------------------

const Sound = (() => {
  let ctx = null, master = null, noise = null, muted = false, birdTimer = 4;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
  }

  function env(gainNode, t, a, peak, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  function noiseBurst({ t = 0, dur = 0.2, type = 'bandpass', f = 1000, f2 = null, q = 1, vol = 0.3, attack = 0.005 }) {
    if (!ctx) return;
    const now = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.setValueAtTime(f, now); filt.Q.value = q;
    if (f2) filt.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = ctx.createGain();
    env(g, now, attack, vol, dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(now, Math.random() * 1.5);
    src.stop(now + attack + dur + 0.05);
  }

  function tone({ t = 0, f = 440, f2 = null, dur = 0.2, type = 'sine', vol = 0.2, attack = 0.003 }) {
    if (!ctx) return;
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = ctx.createGain();
    env(g, now, attack, vol, dur);
    o.connect(g); g.connect(master);
    o.start(now); o.stop(now + attack + dur + 0.05);
  }

  return {
    init, setMuted, get muted() { return muted; },
    swing(power) {
      noiseBurst({ dur: 0.22, f: 500, f2: 2200, q: 1.2, vol: 0.12 + 0.12 * power, attack: 0.08 });
    },
    hit(power, putter) {
      if (putter) {
        tone({ f: 1250, f2: 900, dur: 0.06, vol: 0.18 + 0.2 * power });
        noiseBurst({ dur: 0.03, f: 3000, q: 2, vol: 0.08 });
        return;
      }
      noiseBurst({ dur: 0.05, f: 2600, q: 0.8, vol: 0.5 + 0.3 * power, attack: 0.001 });
      tone({ f: 190, f2: 70, dur: 0.12, vol: 0.35 + 0.2 * power, attack: 0.001 });
      tone({ f: 1800, f2: 1400, dur: 0.05, type: 'triangle', vol: 0.07 });
    },
    bounce(speed, surf) {
      const v = clamp(speed / 25, 0.05, 1);
      if (surf === S_SAND) noiseBurst({ dur: 0.2, f: 1800, q: 0.5, vol: 0.2 * v + 0.05 });
      else {
        tone({ f: 140 + Math.random() * 30, f2: 60, dur: 0.08, vol: 0.25 * v });
        noiseBurst({ dur: 0.06, type: 'lowpass', f: 900, vol: 0.18 * v });
      }
    },
    tree(hard) {
      if (hard) { tone({ f: 420, f2: 180, dur: 0.08, type: 'triangle', vol: 0.25 }); return; }
      for (let i = 0; i < 4; i++) noiseBurst({ t: i * 0.05, dur: 0.12, f: 3500, q: 0.6, vol: 0.12 });
    },
    splash() {
      noiseBurst({ dur: 0.7, type: 'lowpass', f: 3000, f2: 300, q: 0.7, vol: 0.45, attack: 0.01 });
      for (let i = 0; i < 6; i++) tone({ t: 0.15 + i * 0.07 + Math.random() * 0.05, f: 500 + Math.random() * 600, f2: 1400, dur: 0.06, vol: 0.05 });
    },
    cup() {
      tone({ f: 1500, f2: 1300, dur: 0.05, type: 'triangle', vol: 0.18 });
      tone({ t: 0.09, f: 1100, f2: 900, dur: 0.06, type: 'triangle', vol: 0.16 });
      tone({ t: 0.17, f: 260, f2: 120, dur: 0.18, vol: 0.3 });
    },
    lip() { tone({ f: 900, f2: 700, dur: 0.05, type: 'triangle', vol: 0.12 }); },
    applause(strength) {
      if (!ctx) return;
      const n = Math.round(80 + 220 * strength);
      const dur = 1.6 + 2 * strength;
      for (let i = 0; i < n; i++) {
        const t = Math.pow(Math.random(), 1.4) * dur;
        noiseBurst({ t, dur: 0.03 + Math.random() * 0.03, f: 1200 + Math.random() * 2400, q: 1.5, vol: 0.05 + 0.05 * strength });
      }
    },
    groan() {
      tone({ f: 220, f2: 140, dur: 0.6, type: 'sawtooth', vol: 0.03, attack: 0.15 });
      noiseBurst({ dur: 0.7, type: 'lowpass', f: 600, vol: 0.06, attack: 0.15 });
    },
    click() { tone({ f: 900, dur: 0.03, type: 'square', vol: 0.03 }); },
    // Occasional birdsong for atmosphere; call every frame with dt.
    ambient(dt) {
      if (!ctx || muted) return;
      birdTimer -= dt;
      if (birdTimer > 0) return;
      birdTimer = 5 + Math.random() * 9;
      const base = 2600 + Math.random() * 1600;
      const notes = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < notes; i++) {
        tone({ t: i * 0.13, f: base * (0.9 + Math.random() * 0.25), f2: base * (1.15 + Math.random() * 0.3), dur: 0.07, vol: 0.025 });
      }
    },
  };
})();
