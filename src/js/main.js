// ---------------------------------------------------------------------------
// Game flow. You control your golfer the whole time: walk (or drive the cart)
// to the ball, press E to address it, swing with the three-press meter,
// watch it fly, then walk on. After holing out, head to the next tee.
//
// Modes: title -> walk <-> cart, walk <-> shot. The ball simulates on its own
// timeline, independent of what the player is doing.
// ---------------------------------------------------------------------------

function startGame(saved) {
  const MAX_STROKES = 10;
  const PUTT_RANGES = [3, 5, 8, 12, 16, 22, 30, 40, 55];
  const STORE_KEY = 'pinehaven-golf-v2';
  const WALK = 4.2, RUN = 8.5;           // yd/s
  const REACH = 2.6;                     // how close to stand to the ball or cart
  const P_ACC = 0.15;

  const store = {
    load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } },
    save(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const canvas = UI.$('scene');
  try {
    World.init(canvas);
  } catch (e) {
    console.error(e);
    UI.show('title', false);
    UI.show('glError', true);
    return null;
  }
  const camera = World.camera;
  const course = buildCourse(COURSE);
  const HOLES = course.holes;
  const PAR = HOLES.reduce((a, h) => a + h.par, 0);
  UI.setOverview(World.buildCourse(course), course.bounds);

  const golfer = Golfer.create();
  World.add(golfer.root);
  const cart = Cart.create(course);
  World.add(cart.root);
  cart.place(COURSE.cartStart.x, COURSE.cartStart.z, (COURSE.cartStart.heading || 0) * DEG);

  const G = {
    mode: 'title', shotPhase: null, fp: false,
    hole: 0, scores: [], strokes: 0, field: course.fieldFor(HOLES[0]),
    ball: createBall(0, 0, 0), ballState: 'tee', shot: null,
    player: { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, speed: 0 },
    camYaw: 0, camPitch: 0.22, camDist: 4.4, cartLook: 0, lastMouse: -10,
    ballCam: false, ballCamTimer: 0, ff: false,
    aimYaw: 0, aimTouched: false, clubIndex: 0, lie: S_TEE, puttRange: 10, view: 0,
    meter: { phase: 'idle', p: 0, power: 0 }, swing: { a: 0, top: 0, t: 0, fired: false, finish: 0, putt: false },
    holdFinish: false, preview: { pts: [], landing: null, end: null }, previewDirty: true,
    wind: { x: 0, z: 0, mph: 0, yaw: 0 }, introShown: false, cardTimer: 0, pending: null, trace: [],
    time: 0, inRound: false, locked: false, toastGate: 0, stepT: 0, acc: 0, bounceSounds: 0,
  };
  window.__golf = G; // handy for debugging from the console
  window.__golfWorld = World;

  // ---------- helpers ----------
  const hole = () => HOLES[G.hole];
  const club = () => CLUBS[G.clubIndex];
  const isPutt = () => club().putter;
  const distToPin = () => Math.hypot(hole().pin.x - G.ball.p.x, hole().pin.z - G.ball.p.z);
  const toPar = () => G.scores.reduce((a, s, i) => a + (s != null ? s - HOLES[i].par : 0), 0);
  const playedAny = () => G.scores.some((s) => s != null);
  const fmtDist = (yd, putting) => (putting && yd < 30 ? `${Math.max(1, Math.round(yd * 3))} ft` : `${Math.round(yd)} yds`);
  const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
  const ballPlayable = () => G.ballState === 'tee' || G.ballState === 'rest';
  const distTo = (x, z) => Math.hypot(x - G.player.x, z - G.player.z);

  function placeBall(x, z, onTee) {
    G.ball = createBall(x, course.H(x, z) + BALL_R, z);
    G.ballState = onTee ? 'tee' : 'rest';
  }

  function setWind() {
    const def = hole().def;
    const r = mulberry32((def.seed || 1) * 13 + (Date.now() & 0xffff));
    const [lo, hi] = def.wind || [0, 10];
    const mph = lo + r() * (hi - lo);
    const yaw = r() * TAU;
    const d = dirFromYaw(yaw);
    G.wind = { mph, yaw, x: d.x * mph * MPH, z: d.z * mph * MPH };
  }

  function placePlayer(x, z, yaw) {
    Object.assign(G.player, { x, z, y: course.H(x, z), yaw, vx: 0, vz: 0, speed: 0 });
    G.camYaw = yaw;
  }

  // ---------- holes & round ----------
  function activateHole(i) {
    G.hole = i;
    G.strokes = 0;
    G.field = course.fieldFor(HOLES[i]);
    setWind();
    const h = hole();
    placeBall(h.tee.x, h.tee.z, true);
    G.introShown = false;
    G.trace = [];
    World.trailReset();
    World.setPinVisible(i, true);
    World.showSlope(i, false);
    UI.setHole(i + 1, h);
    UI.setStroke(1);
    UI.setTotal(toPar(), playedAny());
  }

  function startRound(at, scores) {
    Sound.init();
    G.scores = scores || [];
    G.inRound = true;
    UI.show('title', false);
    UI.show('hud', true);
    activateHole(at);
    const h = hole();
    if (at === 0) {
      const cl = course.clubhouse;
      placePlayer(cl.x - 8, cl.z - 17, -0.6);
      cart.place(COURSE.cartStart.x, COURSE.cartStart.z, (COURSE.cartStart.heading || 0) * DEG);
      UI.toast('Welcome to Pinehaven', 'Walk to the 1st tee, or hop in the cart', 3600);
    } else {
      // Resume: start beside the tee with the cart parked nearby.
      const back = { x: h.tee.x - h.teeDir.x * 12, z: h.tee.z - h.teeDir.z * 12 };
      placePlayer(back.x, back.z, yawFromDir(h.teeDir.x, h.teeDir.z));
      const side = { x: back.x - h.teeDir.z * 6, z: back.z + h.teeDir.x * 6 };
      cart.place(side.x, side.z, yawFromDir(h.teeDir.x, h.teeDir.z));
      UI.toast(`Back on the ${ordinal(at + 1)} tee`, 'Your round continues', 2600);
    }
    G.mode = 'walk';
    UI.setMode('walk');
    saveProgress();
  }

  function saveProgress() {
    const st = store.load();
    st.round = { scores: G.scores.slice(), next: G.hole };
    store.save(st);
  }

  function finishRound() {
    const total = G.scores.reduce((a, s) => a + s, 0);
    const st = store.load();
    if (!st.best || total < st.best) st.best = total;
    st.round = null;
    store.save(st);
    G.inRound = false;
  }

  // ---------- club & aim ----------
  function autoClub() {
    const lie = G.lie;
    if (lie === S_GREEN) return PUTTER_INDEX;
    const d = distToPin();
    if (lie === S_FRINGE && d < 22) return PUTTER_INDEX;
    for (let i = CLUBS.length - 2; i >= 0; i--) {
      const c = CLUBS[i];
      if (c.id === 'DR' && lie !== S_TEE) continue;
      if (c.carry * lieFactor(c, lie) >= d - 3) return i;
    }
    return lie === S_TEE ? 0 : 1;
  }

  function defaultAim() {
    const b = G.ball.p, pin = hole().pin, c = club();
    const yPin = yawFromDir(pin.x - b.x, pin.z - b.z);
    if (c.putter) return yPin;
    const r = c.carry * lieFactor(c, G.lie) + 12;
    if (distToPin() <= r) return yPin;
    const line = hole().line;
    const s0 = line.query(b.x, b.z).s;
    for (let s = hole().length; s > s0; s -= 2) {
      const pt = line.pointAt(s);
      if (Math.hypot(pt.x - b.x, pt.z - b.z) <= r) return yawFromDir(pt.x - b.x, pt.z - b.z);
    }
    return yPin;
  }

  function choosePuttRange() {
    const need = distToPin() * 1.3 + 0.5;
    G.puttRange = PUTT_RANGES.find((r) => r >= need) || PUTT_RANGES[PUTT_RANGES.length - 1];
  }

  function setClub(i, userChange) {
    G.clubIndex = clamp(i, 0, CLUBS.length - 1);
    if (isPutt()) choosePuttRange();
    if (!G.aimTouched) G.aimYaw = defaultAim();
    G.previewDirty = true;
    refreshShotHud();
    if (userChange) Sound.click();
  }

  function refreshShotHud() {
    const c = club();
    if (c.putter) {
      UI.setClub('Putter', `${G.puttRange * 3} ft max`);
      UI.setTicks([0.25, 0.5, 0.75, 1].map((f) => `${Math.round(G.puttRange * 3 * f)}ft`));
    } else {
      const lf = lieFactor(c, G.lie);
      UI.setClub(c.name, `${Math.round(c.carry * lf)} yds${lf < 0.99 ? ' · lie −' + Math.round((1 - lf) * 100) + '%' : ''}`);
      UI.setTicks([0.25, 0.5, 0.75, 1].map((f) => `${Math.round(c.carry * lf * f)}`));
    }
    const onGreen = G.lie === S_GREEN || G.lie === S_FRINGE;
    UI.setFacts(fmtDist(distToPin(), onGreen), SURFACES[G.lie].name);
    UI.setStroke(G.strokes + 1);
    UI.setTotal(toPar(), playedAny());
  }

  const _speedCache = new Map();
  function fullShotSpeed(c, lie) {
    const k = c.id + ':' + lie;
    if (!_speedCache.has(k)) _speedCache.set(k, speedForCarry(c, c.carry * lieFactor(c, lie), SURFACES[lie].spinLie));
    return _speedCache.get(k);
  }

  function computePreview() {
    G.previewDirty = false;
    const c = club(), b = G.ball.p;
    const pts = [];
    if (c.putter) {
      const d = dirFromYaw(G.aimYaw);
      const len = clamp(distToPin(), 1, G.puttRange);
      for (let s = 0; s <= len + 0.001; s += Math.max(0.25, len / 60)) {
        const x = b.x + d.x * s, z = b.z + d.z * s;
        pts.push({ x, y: course.H(x, z) + 0.03, z });
      }
      G.preview = { pts, landing: null, end: pts[pts.length - 1] };
    } else {
      const sim = createBall(b.x, b.y, b.z);
      const speed = fullShotSpeed(c, G.lie);
      launchBall(sim, G.aimYaw, speed, c.launch, spinFor(c, speed, SURFACES[G.lie].spinLie), 0);
      pts.push({ x: b.x, y: b.y, z: b.z });
      for (let i = 0; i < 240 * 12; i++) {
        stepBall(sim, G.field, null, DT, null, { noTrees: true });
        if (i % 5 === 0) pts.push({ x: sim.p.x, y: sim.p.y, z: sim.p.z });
        if (sim.mode !== 'flight' || sim.carry !== null) break;
      }
      pts.push({ x: sim.p.x, y: sim.p.y, z: sim.p.z });
      G.preview = { pts, landing: { x: sim.p.x, z: sim.p.z }, end: { x: sim.p.x, z: sim.p.z } };
    }
    World.setGuides(G.preview.pts, G.preview.landing, c.putter);
  }

  // ---------- addressing the ball ----------
  const _addr = {};
  function addressOffset() {
    const kind = Golfer.kindFor(club());
    if (!_addr[kind]) _addr[kind] = golfer.addressOffset(kind, club().putter);
    return _addr[kind];
  }
  // Stand the golfer at address: facing across the target line, target on the left.
  function stanceFor(yaw) {
    const face = yaw + Math.PI / 2;
    const rot = Math.PI - face;
    const o = addressOffset();
    const c = Math.cos(rot), s = Math.sin(rot);
    const x = G.ball.p.x - (o.x * c + o.z * s), z = G.ball.p.z - (-o.x * s + o.z * c);
    return { x, z, face };
  }

  function enterShot() {
    if (!ballPlayable()) return;
    G.mode = 'shot';
    G.shotPhase = 'aim';
    G.holdFinish = false;
    G.ballCam = false;
    G.lie = G.ballState === 'tee' ? S_TEE : course.surface(G.ball.p.x, G.ball.p.z);
    if (G.lie === S_OOB) G.lie = S_DEEP;
    G.aimTouched = false;
    G.clubIndex = autoClub();
    if (isPutt()) choosePuttRange();
    G.aimYaw = defaultAim();
    G.previewDirty = true;
    G.meter = { phase: 'idle', p: 0, power: 0 };
    UI.setMeter(0, null);
    UI.meterEnabled(true);
    UI.setHint(swingHint());
    refreshShotHud();
    World.setPinVisible(G.hole, G.lie !== S_GREEN);
    World.showSlope(G.hole, G.lie === S_GREEN || G.lie === S_FRINGE);
    G.view = 0;
    UI.setMode('shot');
    UI.prompt(null);
    Sound.click();
  }

  function leaveShot() {
    if (G.mode !== 'shot') return;
    G.mode = 'walk';
    G.shotPhase = null;
    World.hideGuides();
    UI.setMode('walk');
    G.camYaw = G.aimYaw;
  }

  function swingHint() {
    return matchMedia('(pointer: coarse)').matches
      ? 'Tap <b>Swing</b> three times: start, power, accuracy'
      : 'Press <kbd>Space</kbd> three times: start, power, accuracy';
  }

  // ---------- the swing meter and the swing itself ----------
  function meterPress() {
    if (G.mode !== 'shot') return;
    const m = G.meter;
    if (G.shotPhase === 'aim') {
      if (!ballPlayable()) return;
      if (G.previewDirty) computePreview();
      G.shotPhase = 'swing';
      G.meter = { phase: 'power', p: 0, power: 0 };
      G.swing = { a: 0, top: isPutt() ? 0.5 : 2.5, t: 0, fired: false, finish: 0, putt: isPutt() };
      UI.setHint('Press again to set <b>power</b>');
      Sound.click();
    } else if (G.shotPhase === 'swing') {
      if (m.phase === 'power') {
        if (m.p < 0.02) return;
        m.power = m.p;
        m.phase = 'acc';
        UI.setHint('Stop on the <b>white line</b>');
        Sound.click();
      } else if (m.phase === 'acc') {
        startDownswing(m.power, clamp(-m.p / P_ACC, -1, 1));
      }
    }
  }

  function cancelSwing() {
    if (G.mode !== 'shot' || G.shotPhase !== 'swing') return false;
    G.shotPhase = 'aim';
    G.meter = { phase: 'idle', p: 0, power: 0 };
    UI.setMeter(0, null);
    UI.setHint(swingHint());
    return true;
  }

  function updateMeter(dt) {
    const m = G.meter;
    const speed = isPutt() ? 0.8 : 1.05;
    if (m.phase === 'power') {
      m.p += speed * dt;
      if (m.p >= 1) { m.p = 1; m.power = 1; m.phase = 'acc'; UI.setHint('Stop on the <b>white line</b>'); }
      UI.setMeter(m.p, null);
      G.swing.a = -G.swing.top * Math.max(0, m.p);
    } else if (m.phase === 'acc') {
      m.p -= speed * 0.95 * dt;
      UI.setMeter(m.p, m.power);
      G.swing.a = -G.swing.top * m.power;
      if (m.p <= -P_ACC) startDownswing(m.power, 1);
    }
  }

  function startDownswing(power, e) {
    G.shotPhase = 'down';
    G.meter.phase = 'done';
    Object.assign(G.swing, { t: 0, from: -G.swing.top * power, power, e, fired: false,
      finish: G.swing.putt ? 0.15 + 0.35 * power : 2.3 });
    UI.meterEnabled(false);
    if (!G.swing.putt) Sound.swing(power);
  }

  function updateDownswing(dt) {
    const s = G.swing;
    s.t += dt;
    const D = s.putt ? 0.3 : 0.24, F = s.putt ? 0.4 : 0.5;
    if (s.t < D) {
      const u = s.t / D;
      s.a = s.from * (1 - u * u);
    } else {
      if (!s.fired) { s.fired = true; takeShot(s.power, s.e); }
      const u = clamp((s.t - D) / F, 0, 1);
      s.a = s.finish * (1 - (1 - u) * (1 - u));
      if (s.t > D + F + 0.15) {
        // Hold the finish; the player can walk off whenever they like.
        G.mode = 'walk';
        G.shotPhase = null;
        G.holdFinish = true;
        UI.setMode('walk');
        G.camYaw = G.aimYaw;
      }
    }
  }

  function gradeLabel(e, putter) {
    const a = Math.abs(e);
    if (a < 0.15) return '<span class="grade good">Perfect</span>';
    if (putter) return `<span class="grade">${a < 0.5 ? 'Slightly ' : ''}${e < 0 ? 'pulled' : 'pushed'}</span>`;
    if (e < 0) return `<span class="grade">${a < 0.45 ? 'Draw' : a < 0.8 ? 'Hook' : 'Big hook'}</span>`;
    return `<span class="grade">${a < 0.45 ? 'Fade' : a < 0.8 ? 'Slice' : 'Big slice'}</span>`;
  }

  function takeShot(power, e) {
    const c = club();
    const b = G.ball;
    const eff = (Math.sign(e) * Math.max(0, Math.abs(e) - 0.1)) / 0.9;
    G.shot = { start: { x: b.p.x, y: b.p.y, z: b.p.z }, club: c, power, e, putter: !!c.putter, stroke: G.strokes + 1, lie: G.lie };
    G.strokes++;
    UI.setStroke(G.strokes);
    if (c.putter) {
      startRoll(b, G.aimYaw + eff * 1.6 * DEG, puttSpeedFor(power * G.puttRange));
      Sound.hit(power, true);
    } else {
      const spinMul = SURFACES[G.lie].spinLie;
      const speed = speedForCarry(c, power * c.carry * lieFactor(c, G.lie), spinMul);
      if (G.ballState === 'tee') b.p.y += 0.045;
      launchBall(b, G.aimYaw + eff * 2.0 * DEG, speed, c.launch + (G.lie === S_SAND ? 3 : 0), spinFor(c, speed, spinMul), -eff * 22);
      Sound.hit(power, false);
    }
    G.shotYaw = G.aimYaw;
    G.ballState = 'moving';
    UI.setHint(`${gradeLabel(e, c.putter)} · ${Math.round(power * 100)}% power`);
    World.hideGuides();
    World.trailReset();
    G.trace = [{ x: b.p.x, z: b.p.z }];
    G.acc = 0;
    G.bounceSounds = 0;
    G.ballCam = true;
    G.ballCamTimer = 0;
  }

  // ---------- ball in motion ----------
  function updateBall(dt) {
    if (G.ballState !== 'moving') return;
    G.acc += dt * (G.ff && G.ballCam ? 4 : 1);
    const events = [];
    const b = G.ball;
    let n = 0;
    while (G.acc >= DT && (b.mode === 'flight' || b.mode === 'roll')) {
      stepBall(b, G.field, G.wind, DT, events);
      G.acc -= DT;
      if ((++n & 3) === 0 || b.mode !== 'flight') World.trailPush(b.p);
      if (n > 2400) break;
    }
    const last = G.trace[G.trace.length - 1];
    if (!last || Math.hypot(b.p.x - last.x, b.p.z - last.z) > 2) G.trace.push({ x: b.p.x, z: b.p.z });
    for (const ev of events) {
      if (ev.type === 'bounce') { if (G.bounceSounds++ < 5 && ev.speed > 0.6) Sound.bounce(ev.speed, ev.surf); }
      else if (ev.type === 'tree') Sound.tree(ev.hard);
      else if (ev.type === 'lip') Sound.lip();
      else if (ev.type === 'water') return onWater();
      else if (ev.type === 'oob') return onOOB();
      else if (ev.type === 'holed') return onHoled(ev.dunk);
      else if (ev.type === 'rest') return onRest();
    }
  }

  function shotName(s) {
    if (s.putter) return 'Putt';
    if (s.stroke === 1 && s.club.id === 'DR') return 'Drive';
    return s.club.name;
  }

  function onRest() {
    const b = G.ball, s = G.shot;
    G.ballState = 'rest';
    const dist = Math.hypot(b.p.x - s.start.x, b.p.z - s.start.z);
    const lie = course.surface(b.p.x, b.p.z);
    const onGreen = lie === S_GREEN || lie === S_FRINGE;
    UI.toast(`${shotName(s)} · ${fmtDist(dist, s.putter)}`, `${SURFACES[lie].label} · ${fmtDist(distToPin(), onGreen)} to the pin`, 2600);
    G.ballCamTimer = s.putter ? 1.0 : 1.6;
    World.showSlope(G.hole, onGreen);
    World.setPinVisible(G.hole, lie !== S_GREEN);
    if (G.strokes >= MAX_STROKES) pickUp();
  }

  function onWater() {
    const b = G.ball, s = G.shot;
    Sound.splash();
    World.splash(b.p.x, b.p.y, b.p.z);
    G.strokes++;
    UI.toast('Water hazard', 'One-stroke penalty · dropping near where it went in', 2800, true);
    let x = b.lastDry.x, z = b.lastDry.z;
    const dx = s.start.x - x, dz = s.start.z - z, dl = Math.hypot(dx, dz) || 1;
    let ok = false;
    for (let i = 0; i < 60; i++) {
      const tx = x + (dx / dl) * (2 + i * 1.5), tz = z + (dz / dl) * (2 + i * 1.5);
      if (course.inBounds(tx, tz) && course.waterLevel(tx, tz) === -Infinity && course.surface(tx, tz) !== S_WATER &&
        Math.hypot(tx - s.start.x, tz - s.start.z) < dl + 1) { x = tx; z = tz; ok = true; break; }
    }
    if (!ok) { x = s.start.x; z = s.start.z; }
    G.ballState = 'gone';
    G.pending = { x, z, t: 1.8, msg: 'Ball dropped' };
  }

  function onOOB() {
    const s = G.shot;
    G.strokes++;
    Sound.groan();
    UI.toast('Out of bounds', 'Stroke and distance · replay from the last spot', 2800, true);
    G.ballState = 'gone';
    G.pending = { x: s.start.x, z: s.start.z, t: 1.8, tee: s.lie === S_TEE && s.stroke === 1, msg: 'Ball replaced' };
  }

  function onHoled(dunk) {
    const h = hole();
    G.scores[G.hole] = G.strokes;
    G.ballState = 'holed';
    const name = scoreName(G.strokes, h.par);
    const d = G.strokes - h.par;
    Sound.cup();
    if (d <= 0) setTimeout(() => Sound.applause(clamp(0.35 - d * 0.3, 0.2, 1)), 250);
    UI.banner(
      `<div class="b-eyebrow">${dunk ? 'Straight in' : 'In the hole'}</div><div class="b-title">${name}</div>` +
        `<div class="b-meta">${G.strokes} stroke${G.strokes === 1 ? '' : 's'} · Round ${UI.fmtToPar(toPar())}</div>`,
      'result' + (d < 0 || G.strokes === 1 ? ' under' : ''), 3200,
    );
    UI.setTotal(toPar(), true);
    World.showSlope(G.hole, false);
    World.setPinVisible(G.hole, true);
    G.ballCamTimer = 2.4;
    G.cardTimer = 3.4;
    saveProgress();
  }

  function pickUp() {
    G.scores[G.hole] = MAX_STROKES;
    G.ballState = 'holed';
    UI.banner(`<div class="b-eyebrow">Maximum ${MAX_STROKES} strokes</div><div class="b-title">Picked up</div>`, 'result', 2600);
    UI.setTotal(toPar(), true);
    G.cardTimer = 2.6;
    saveProgress();
  }

  function showCard(afterHole) {
    const last = G.hole >= HOLES.length - 1;
    const done = afterHole && last;
    UI.renderCard(HOLES, G.scores, G.hole, {
      title: done ? 'Final round' : afterHole ? `After ${G.hole + 1}` : 'Scorecard',
      next: afterHole ? (done ? 'Play again' : `On to the ${ordinal(G.hole + 2)}`) : null,
      closable: !afterHole,
    });
    G.cardAfterHole = afterHole;
    openOverlay('card');
    if (done) finishRound();
  }

  function nextFromCard() {
    closeOverlay('card');
    if (!G.cardAfterHole) return;
    G.cardAfterHole = false;
    if (G.hole >= HOLES.length - 1) {
      startRound(0, []);
      return;
    }
    activateHole(G.hole + 1);
    const h = hole();
    UI.toast(`Next: the ${ordinal(G.hole + 1)} tee`, `${Math.round(distTo(h.tee.x, h.tee.z))} yds away · follow the red marker`, 3000);
    saveProgress();
  }

  // ---------- the cart ----------
  function enterCart() {
    G.mode = 'cart';
    G.holdFinish = false;
    G.cartLook = 0;
    UI.setMode('cart');
    Sound.click();
  }
  function exitCart() {
    const p = cart.exitSpot();
    cart.st.speed = 0;
    placePlayer(p.x, p.z, cart.st.yaw);
    G.camYaw = cart.st.yaw + G.cartLook;
    G.mode = 'walk';
    UI.setMode('walk');
    Sound.engine(0);
  }

  // ---------- walking ----------
  const keys = new Set();
  const hold = { left: false, right: false };
  const joy = { x: 0, y: 0, active: false };
  const held = (...codes) => codes.some((c) => keys.has(c));

  function moveInput() {
    let f = 0, r = 0;
    if (held('KeyW', 'ArrowUp')) f += 1;
    if (held('KeyS', 'ArrowDown')) f -= 1;
    if (held('KeyD', 'ArrowRight')) r += 1;
    if (held('KeyA', 'ArrowLeft')) r -= 1;
    if (joy.active) { f += -joy.y; r += joy.x; }
    const m = Math.hypot(f, r);
    if (m > 1) { f /= m; r /= m; }
    return { f, r, m: Math.min(1, m) };
  }

  function blockedAt(x, z) {
    if (!course.inBounds(x, z)) return true;
    if (course.waterLevel(x, z) > course.H(x, z) + 0.25) return true;
    const trees = course.nearTrees(x, z);
    if (trees) for (const t of trees) if (Math.hypot(x - t.x, z - t.z) < t.trunkR + 0.28) return true;
    for (const o of course.obstacles) if (Math.abs(x - o.x) < o.hx + 0.3 && Math.abs(z - o.z) < o.hz + 0.3) return true;
    // The cart (as an oriented box)
    const c = cart.st, f = { x: Math.sin(c.yaw), z: -Math.cos(c.yaw) };
    const dx = x - c.x, dz = z - c.z;
    const along = dx * f.x + dz * f.z, side = dx * -f.z + dz * f.x;
    return Math.abs(along) < 1.45 && Math.abs(side) < 0.8;
  }

  function updateWalk(dt) {
    const P = G.player;
    const inp = moveInput();
    // Moving hands control back from the ball camera.
    if (inp.m > 0.05) { G.holdFinish = false; G.ballCam = false; }
    const run = held('ShiftLeft', 'ShiftRight') || (joy.active && inp.m > 0.92);
    let target = inp.m * (run ? RUN : WALK);
    const surf = course.surface(P.x, P.z);
    if (surf === S_SAND) target *= 0.6;
    else if (surf === S_DEEP) target *= 0.85;
    const yaw = G.camYaw;
    const fw = dirFromYaw(yaw), rt = { x: Math.cos(yaw), z: Math.sin(yaw) };
    let mx = fw.x * inp.f + rt.x * inp.r, mz = fw.z * inp.f + rt.z * inp.r;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) { mx /= ml; mz /= ml; }
    const k = 1 - Math.exp(-dt * 10);
    P.vx += (mx * target - P.vx) * k;
    P.vz += (mz * target - P.vz) * k;
    const nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    if (!blockedAt(nx, nz)) { P.x = nx; P.z = nz; }
    else if (!blockedAt(nx, P.z)) { P.x = nx; P.vz *= 0.5; }
    else if (!blockedAt(P.x, nz)) { P.z = nz; P.vx *= 0.5; }
    else { P.vx = P.vz = 0; }
    P.speed = Math.hypot(P.vx, P.vz);
    if (P.speed > 0.3) {
      const want = yawFromDir(P.vx, P.vz);
      P.yaw += wrapAngle(want - P.yaw) * (1 - Math.exp(-dt * 12));
    }
    P.y = course.H(P.x, P.z);
    // Footsteps
    if (P.speed > 1) {
      G.stepT -= dt * P.speed;
      if (G.stepT <= 0) { G.stepT = 1.25; Sound.step(surf); }
    }
    // Keyboard-only players: drift the camera in behind when walking forward.
    if (G.time - G.lastMouse > 2.5 && inp.f > 0.5 && !G.fp && Math.abs(inp.r) < 0.3) {
      G.camYaw += wrapAngle(P.yaw - G.camYaw) * (1 - Math.exp(-dt * 1.5));
    }
  }

  function updateCart(dt) {
    const inp = moveInput();
    const ev = cart.update(dt, { throttle: inp.f, steer: inp.r, brake: held('Space') });
    for (const e of ev) {
      if (e.type === 'bump') Sound.bump(e.speed);
      if ((e.type === 'green' || e.type === 'sand') && G.time > G.toastGate) {
        G.toastGate = G.time + 6;
        UI.toast(e.type === 'green' ? 'Keep the cart off the green!' : 'Carts and bunkers don’t mix', 'The greenkeeper is watching', 2000, true);
      }
    }
    const s = cart.seatPose();
    Object.assign(G.player, { x: s.x, z: s.z, y: s.y, yaw: s.yaw, vx: 0, vz: 0, speed: 0 });
    Sound.engine(Math.abs(cart.st.speed) / 13);
    if (G.time - G.lastMouse > 1.2) G.cartLook *= Math.exp(-dt * 1.8);
    if (inp.m > 0.05 && G.ballCam) G.ballCam = false;
  }

  // ---------- camera ----------
  const V3 = THREE.Vector3;
  const cam = { pos: new V3(0, 30, 60), look: new V3(0, 0, 0), tPos: new V3(), tLook: new V3() };
  const focus = new V3();

  function shotPose(outPos, outLook) {
    const b = G.ball.p, d = dirFromYaw(G.aimYaw), r = { x: Math.cos(G.aimYaw), z: Math.sin(G.aimYaw) };
    const putt = isPutt();
    if (G.fp) {
      const st = stanceFor(G.aimYaw);
      const gy = course.H(st.x, st.z);
      outPos.set(st.x - d.x * 0.15, gy + (putt ? 1.45 : 1.58), st.z - d.z * 0.15);
      const ahead = putt ? clamp(distToPin(), 3, 14) : 45;
      outLook.set(b.x + d.x * ahead, b.y + (putt ? -0.4 : 2), b.z + d.z * ahead);
      return;
    }
    if (G.view === 0) {
      const back = putt ? 3.4 : 5.6, up = putt ? 1.5 : 2.1;
      outPos.set(b.x - d.x * back - r.x * 0.7, b.y + up, b.z - d.z * back - r.z * 0.7);
      const ahead = putt ? clamp(distToPin() * 0.6, 2, 8) : 32;
      outLook.set(b.x + d.x * ahead, b.y + (putt ? -0.2 : 1.6), b.z + d.z * ahead);
    } else if (G.view === 1) {
      const t = G.preview.end || hole().pin;
      const ty = course.H(t.x, t.z);
      const back = clamp(Math.hypot(t.x - b.x, t.z - b.z) * 0.18, 8, 40);
      outPos.set(t.x - d.x * back, ty + back * 0.75, t.z - d.z * back);
      outLook.set(t.x, ty, t.z);
    } else {
      const t = G.preview.end || hole().pin;
      const mx = (b.x + t.x) / 2, mz = (b.z + t.z) / 2;
      const h = Math.max(30, Math.hypot(t.x - b.x, t.z - b.z)) * 1.05;
      outPos.set(mx - d.x * h * 0.25, course.H(mx, mz) + h, mz - d.z * h * 0.25);
      outLook.set(mx, course.H(mx, mz), mz);
    }
  }

  function titlePose(t, outPos, outLook) {
    const cl = course.clubhouse, h = HOLES[0];
    const a = t * TAU * 0.6 - 0.8;
    const cx = (cl.x + h.tee.x) / 2, cz = (cl.z + h.tee.z) / 2 - 60;
    outPos.set(cx + Math.sin(a) * 110, cl.y + 42, cz + Math.cos(a) * 110);
    const la = h.line.pointAt(120);
    outLook.set(la.x, course.H(la.x, la.z) + 2, la.z);
  }

  function updateCamera(dt) {
    let rate = 14, lookRate = 20;
    const P = G.player, b = G.ball.p;
    if (G.mode === 'title') {
      G.titleT = (G.titleT || 0) + dt / 70;
      titlePose(G.titleT, cam.tPos, cam.tLook);
      rate = lookRate = 40;
    } else if (G.ballCam) {
      const s = G.shot, d = dirFromYaw(G.shotYaw);
      if (G.ballState === 'moving' || G.ballState === 'gone') {
        if (s.putter) cam.tPos.set(b.x - d.x * 3.2, b.y + 1.3, b.z - d.z * 3.2);
        else {
          const dist = Math.hypot(b.x - s.start.x, b.z - s.start.z);
          const back = 9 + Math.min(dist * 0.03, 8);
          cam.tPos.set(b.x - d.x * back, Math.max(b.y, course.H(b.x, b.z)) + 3.5 + Math.min(dist * 0.02, 6), b.z - d.z * back);
        }
        rate = s.putter ? 1.6 : 1.3;
      } else {
        cam.tPos.copy(cam.pos);
        rate = 1;
      }
      cam.tLook.set(b.x, b.y, b.z);
      lookRate = 8;
    } else if (G.mode === 'shot') {
      shotPose(cam.tPos, cam.tLook);
      rate = G.fp ? 10 : 6; lookRate = 10;
    } else if (G.mode === 'cart') {
      const yaw = cart.st.yaw + G.cartLook;
      if (G.fp) {
        const e = cart.eyePose();
        cam.tPos.set(e.x, e.y, e.z);
        const d = dirFromYaw(yaw);
        cam.tLook.set(e.x + d.x * 10, e.y - 0.8 - G.camPitch * 4, e.z + d.z * 10);
        rate = lookRate = 60;
      } else {
        const d = dirFromYaw(yaw);
        cam.tPos.set(cart.st.x - d.x * 7.2, cart.st.y + 3.0, cart.st.z - d.z * 7.2);
        cam.tLook.set(cart.st.x + d.x * 4, cart.st.y + 1.2, cart.st.z + d.z * 4);
        rate = 6; lookRate = 10;
      }
    } else {
      const cp = Math.cos(G.camPitch), sp = Math.sin(G.camPitch);
      const d = dirFromYaw(G.camYaw);
      if (G.fp) {
        cam.tPos.set(P.x + d.x * 0.12, P.y + 1.66, P.z + d.z * 0.12);
        cam.tLook.set(cam.tPos.x + d.x * cp * 10, cam.tPos.y - sp * 10, cam.tPos.z + d.z * cp * 10);
        rate = lookRate = 60;
      } else {
        const r = { x: Math.cos(G.camYaw), z: Math.sin(G.camYaw) };
        const tx = P.x + r.x * 0.35, ty = P.y + 1.55, tz = P.z + r.z * 0.35;
        cam.tPos.set(tx - d.x * cp * G.camDist, ty + sp * G.camDist, tz - d.z * cp * G.camDist);
        cam.tLook.set(tx, ty, tz);
        rate = 18; lookRate = 40;
      }
    }
    const kp = 1 - Math.exp(-dt * rate), kl = 1 - Math.exp(-dt * lookRate);
    cam.pos.lerp(cam.tPos, kp);
    cam.look.lerp(cam.tLook, kl);
    const gh = course.H(cam.pos.x, cam.pos.z);
    if (cam.pos.y < gh + 0.35) cam.pos.y = gh + 0.35;
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    if (G.ballCam) focus.set(b.x, b.y, b.z);
    else focus.set(P.x, P.y, P.z).lerp(cam.pos, 0.2);
  }

  // ---------- golfer animation ----------
  function updateGolfer(dt) {
    const P = G.player;
    let pose;
    if (G.mode === 'cart') {
      const s = cart.seatPose();
      golfer.root.position.set(s.x, s.y, s.z);
      golfer.root.rotation.set(0, Math.PI - s.yaw, 0);
      pose = { mode: 'seated' };
    } else if (G.mode === 'shot') {
      const st = stanceFor(G.aimYaw);
      Object.assign(P, { x: st.x, z: st.z, y: course.H(st.x, st.z), yaw: st.face, vx: 0, vz: 0, speed: 0 });
      golfer.root.position.set(st.x, P.y, st.z);
      golfer.root.rotation.set(0, Math.PI - st.face, 0);
      const kind = Golfer.kindFor(club());
      pose = G.shotPhase === 'aim' ? { mode: 'address', putt: isPutt(), club: kind } : { mode: 'swing', putt: G.swing.putt, club: kind, swing: G.swing.a };
    } else {
      golfer.root.position.set(P.x, P.y, P.z);
      golfer.root.rotation.set(0, Math.PI - P.yaw, 0);
      pose = G.holdFinish ? { mode: 'swing', putt: G.swing.putt, swing: G.swing.a, club: Golfer.kindFor(club()) } : { mode: 'walk', speed: P.speed };
    }
    golfer.update(dt, pose);
    golfer.setVisible(!(G.fp && G.mode !== 'title' && !G.ballCam));
  }

  // ---------- HUD: prompts, markers, radar ----------
  const proj = new V3();
  function project(x, y, z) {
    proj.set(x, y, z).project(camera);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const behind = proj.z > 1;
    return { x: (proj.x * 0.5 + 0.5) * w, y: (-proj.y * 0.5 + 0.5) * h, behind, w, h };
  }

  function nearest() {
    if (G.mode !== 'walk') return null;
    const dBall = ballPlayable() && !G.cardTimer ? distTo(G.ball.p.x, G.ball.p.z) : Infinity;
    const dCart = distTo(cart.st.x, cart.st.z);
    if (dBall <= REACH && dBall <= dCart) return 'ball';
    if (dCart <= REACH) return 'cart';
    if (dBall <= REACH) return 'ball';
    return null;
  }

  function updateHud() {
    const P = G.player, h = hole(), b = G.ball.p;
    const touch = matchMedia('(pointer: coarse)').matches;
    // Prompt and touch action button
    let act = null;
    if (G.mode === 'walk' && !G.ballCam) {
      const n = nearest();
      if (n === 'ball') act = G.ballState === 'tee' ? 'Tee off' : 'Play shot';
      else if (n === 'cart') act = 'Drive';
    } else if (G.mode === 'cart') act = 'Get out';
    UI.prompt(act && !touch ? `<kbd>E</kbd>${act === 'Drive' ? 'Drive the cart' : act === 'Get out' ? 'Get out of the cart' : act === 'Tee off' ? 'Tee off' : 'Play your shot'}` : null);
    UI.setActionLabel(act);
    UI.$('hud').classList.toggle('fp', G.fp);

    // Objective line
    if (G.ballState === 'tee') UI.objective(`Hole ${G.hole + 1} tee · <b>${Math.round(distTo(h.tee.x, h.tee.z))} yds</b>`);
    else if (G.ballState === 'rest') UI.objective(`Your ball · <b>${Math.round(distTo(b.x, b.z))} yds</b> · ${SURFACES[course.surface(b.x, b.z)].name}`);
    else if (G.ballState === 'moving') UI.objective('Ball in play…');
    else if (G.ballState === 'holed') UI.objective('Holed');
    else UI.objective('');

    // Markers
    const inShot = G.mode === 'shot';
    const pinTop = project(h.pin.x, h.pin.y + (G.lie === S_GREEN && inShot ? 0.3 : 2.7), h.pin.z);
    const onGreen = (G.ballState === 'rest') && (course.surface(b.x, b.z) === S_GREEN || course.surface(b.x, b.z) === S_FRINGE);
    const pinVis = G.ballState !== 'holed' && G.mode !== 'title' && !(G.ballState === 'tee' && distTo(h.tee.x, h.tee.z) > 60) && (!pinTop.behind || inShot);
    UI.marker('pinMarker', pinTop.x, pinTop.y, pinTop.behind, pinVis && !(pinTop.behind && inShot), fmtDist(distToPin(), onGreen), pinTop.w, pinTop.h);
    const ballFar = distTo(b.x, b.z);
    const bm = project(b.x, b.y + 0.4, b.z);
    UI.marker('ballMarker', bm.x, bm.y, bm.behind, G.ballState === 'rest' && !inShot && !G.ballCam && ballFar > 5, `Ball · ${Math.round(ballFar)}y`, bm.w, bm.h);
    const tm = project(h.tee.x, h.tee.y + 1.2, h.tee.z);
    const teeFar = distTo(h.tee.x, h.tee.z);
    UI.marker('goalMarker', tm.x, tm.y, tm.behind, G.ballState === 'tee' && !inShot && teeFar > 6, `Hole ${G.hole + 1} tee · ${Math.round(teeFar)}y`, tm.w, tm.h);

    // Wind relative to the camera
    const camYaw = yawFromDir(cam.look.x - cam.pos.x, cam.look.z - cam.pos.z);
    UI.setWind(G.wind.mph, wrapAngle(G.wind.yaw - camYaw) / DEG);

    // Radar
    const items = [{ kind: 'pin', x: h.pin.x, z: h.pin.z }, { kind: 'cart', x: cart.st.x, z: cart.st.z, ang: cart.st.yaw }];
    if (G.ballState === 'tee') items.push({ kind: 'tee', x: h.tee.x, z: h.tee.z });
    if (G.ballState !== 'holed' && G.ballState !== 'gone') items.push({ kind: 'ball', x: b.x, z: b.z });
    const aim = inShot && G.preview.end ? { fx: b.x, fz: b.z, x: G.preview.end.x, z: G.preview.end.z } : null;
    UI.drawRadar({ px: P.x, pz: P.z, yaw: camYaw, heading: G.mode === 'cart' ? cart.st.yaw : P.yaw, items, aim });
    G.radarItems = items;

    // Intro banner as you reach a new tee
    if (G.ballState === 'tee' && !G.introShown && teeFar < 32) {
      G.introShown = true;
      UI.banner(
        `<div class="b-eyebrow">Hole ${G.hole + 1} of ${HOLES.length}</div><div class="b-title">${h.name}</div>` +
          `<div class="b-meta">Par ${h.par} · ${h.yards} yds · Wind ${Math.round(G.wind.mph)} mph</div>`, '', 3600);
    }
  }

  // ---------- overlays ----------
  function openOverlay(id) {
    if (document.pointerLockElement) document.exitPointerLock();
    UI.show(id, true);
    if (id === 'map') drawMap();
  }
  function closeOverlay(id) { UI.show(id, false); }
  const overlayOpen = () => UI.isShown('help') || UI.isShown('card') || UI.isShown('map') || UI.isShown('title') || UI.isShown('glError');
  function drawMap() {
    const P = G.player;
    UI.drawMap({ holes: HOLES, active: G.hole, scores: G.scores, px: P.x, pz: P.z, heading: G.mode === 'cart' ? cart.st.yaw : P.yaw, items: G.radarItems || [] });
  }

  // ---------- input ----------
  function interact() {
    if (G.mode === 'shot') { if (G.shotPhase === 'aim') leaveShot(); return; }
    if (G.mode === 'cart') { exitCart(); return; }
    if (G.mode !== 'walk') return;
    if (G.ballCam && G.ballState !== 'moving') G.ballCam = false;
    const n = nearest();
    if (n === 'ball') enterShot();
    else if (n === 'cart') enterCart();
  }

  function toggleFP() {
    G.fp = !G.fp;
    if (G.fp) G.camPitch = clamp(G.camPitch, -0.6, 0.9);
  }

  window.addEventListener('keydown', (e) => {
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    if (keys.has(k)) return;
    keys.add(k);
    if (k === 'Escape') {
      if (UI.isShown('help')) return closeOverlay('help');
      if (UI.isShown('map')) return closeOverlay('map');
      if (UI.isShown('card') && !G.cardAfterHole) return closeOverlay('card');
      if (cancelSwing()) return;
      if (G.mode === 'shot' && G.shotPhase === 'aim') return leaveShot();
      return;
    }
    if (UI.isShown('title')) { if (k === 'Enter') onStart(); return; }
    if (UI.isShown('help')) { if (k === 'Enter' || k === 'Space') closeOverlay('help'); return; }
    if (UI.isShown('map')) { if (k === 'KeyM' || k === 'Enter') closeOverlay('map'); return; }
    if (UI.isShown('card')) {
      if (G.cardAfterHole && (k === 'Enter' || k === 'Space')) nextFromCard();
      else if (k === 'KeyC' && !G.cardAfterHole) closeOverlay('card');
      return;
    }
    const shot = G.mode === 'shot';
    if (k === 'Space') {
      if (shot && G.shotPhase === 'down') G.ff = true;
      else if (shot) meterPress();
      else if (G.ballCam && G.ballState === 'moving') G.ff = true;
      else if (G.mode === 'walk') interact();
    } else if (k === 'KeyE' || k === 'Enter' || k === 'KeyF') {
      if (shot && G.shotPhase === 'aim' && k === 'Enter') meterPress();
      else interact();
    } else if (shot && G.shotPhase === 'aim' && (k === 'ArrowUp' || k === 'KeyW')) setClub(G.clubIndex - 1, true);
    else if (shot && G.shotPhase === 'aim' && (k === 'ArrowDown' || k === 'KeyS')) setClub(G.clubIndex + 1, true);
    else if (k === 'KeyV') toggleFP();
    else if (k === 'KeyT') { if (shot) G.view = (G.view + 1) % 3; }
    else if (k === 'KeyC') showCard(false);
    else if (k === 'KeyM') openOverlay('map');
    else if (k === 'KeyN') toggleMute();
    else if (k === 'KeyH' || k === 'Slash') openOverlay('help');
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') G.ff = false;
  });
  window.addEventListener('blur', () => { keys.clear(); G.ff = false; hold.left = hold.right = false; });

  // Mouse look (pointer lock on desktop, drag as a fallback and on touch).
  function applyLook(dx, dy, touch) {
    G.lastMouse = G.time;
    const s = touch ? 0.006 : 0.0024;
    if (G.mode === 'shot') {
      if (G.shotPhase === 'aim') {
        G.aimYaw = wrapAngle(G.aimYaw + dx * (isPutt() ? 0.0009 : 0.0018) * (touch ? 2 : 1));
        G.aimTouched = true;
        G.previewDirty = true;
      }
      return;
    }
    if (G.mode === 'cart') {
      G.cartLook = clamp(G.cartLook + dx * s, -Math.PI, Math.PI);
      G.camPitch = clamp(G.camPitch + dy * s, -0.5, 0.9);
      return;
    }
    G.camYaw = wrapAngle(G.camYaw + dx * s);
    G.camPitch = clamp(G.camPitch + dy * s, G.fp ? -1.2 : -0.35, G.fp ? 1.3 : 1.25);
  }
  document.addEventListener('pointerlockchange', () => { G.locked = document.pointerLockElement === canvas; });
  document.addEventListener('mousemove', (e) => { if (G.locked) applyLook(e.movementX, e.movementY, false); });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (G.mode === 'title') return;
    if (e.pointerType === 'mouse' && !G.locked && canvas.requestPointerLock) {
      try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch (err) { /* not allowed here: fall back to dragging */ }
    }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId || G.locked) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    applyLook(dx, dy, drag.touch);
  });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    G.camDist = clamp(G.camDist * Math.exp(e.deltaY * 0.001), 2.2, 12);
  }, { passive: false });

  // Touch joystick
  const joyZone = UI.$('joyZone'), knob = UI.$('joyKnob'), joyEl = UI.$('joy');
  let joyId = null, joyC = null;
  joyZone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    joyId = e.pointerId;
    const r = joyEl.getBoundingClientRect();
    joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    joyZone.setPointerCapture(e.pointerId);
    joyMove(e);
  });
  function joyMove(e) {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - joyC.x, dy = e.clientY - joyC.y;
    const m = Math.hypot(dx, dy), R = 50;
    if (m > R) { dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    Object.assign(joy, { x: dx / R, y: dy / R, active: true });
  }
  joyZone.addEventListener('pointermove', joyMove);
  const joyEnd = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    knob.style.transform = '';
    Object.assign(joy, { x: 0, y: 0, active: false });
  };
  joyZone.addEventListener('pointerup', joyEnd);
  joyZone.addEventListener('pointercancel', joyEnd);

  function holdButton(id, on, off) {
    const el = UI.$(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  }
  holdButton('aimLeft', () => (hold.left = true), () => (hold.left = false));
  holdButton('aimRight', () => (hold.right = true), () => (hold.right = false));
  holdButton('swingBtn', () => meterPress(), () => {});
  holdButton('actBtn', () => { if (G.ballCam && G.ballState === 'moving') G.ff = true; else interact(); }, () => (G.ff = false));
  UI.$('meter').addEventListener('pointerdown', (e) => { e.preventDefault(); meterPress(); });
  UI.$('viewBtn').addEventListener('click', () => (G.view = (G.view + 1) % 3));
  UI.$('backBtn').addEventListener('click', () => { if (!cancelSwing()) leaveShot(); });
  UI.$('fpBtn').addEventListener('click', toggleFP);
  UI.$('clubPrev').addEventListener('click', () => G.shotPhase === 'aim' && setClub(G.clubIndex - 1, true));
  UI.$('clubNext').addEventListener('click', () => G.shotPhase === 'aim' && setClub(G.clubIndex + 1, true));
  UI.$('cardBtn').addEventListener('click', () => showCard(false));
  UI.$('mapBtn').addEventListener('click', () => openOverlay('map'));
  UI.$('mapClose').addEventListener('click', () => closeOverlay('map'));
  UI.$('helpBtn').addEventListener('click', () => openOverlay('help'));
  UI.$('helpClose').addEventListener('click', () => closeOverlay('help'));
  UI.$('howBtn').addEventListener('click', () => openOverlay('help'));
  UI.$('muteBtn').addEventListener('click', toggleMute);
  UI.$('cardClose').addEventListener('click', () => closeOverlay('card'));
  UI.$('cardNext').addEventListener('click', nextFromCard);
  UI.$('startBtn').addEventListener('click', onStart);
  UI.$('resumeBtn').addEventListener('click', () => {
    const r = store.load().round;
    if (r && r.next < HOLES.length) startRound(r.next, r.scores);
    else onStart();
  });

  function onStart() {
    const st = store.load();
    st.round = null;
    store.save(st);
    startRound(0, []);
  }

  function toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    UI.$('muteBtn').setAttribute('aria-pressed', String(Sound.muted));
  }

  function updateAim(dt) {
    let dir = 0;
    if (held('ArrowLeft', 'KeyA') || hold.left) dir -= 1;
    if (held('ArrowRight', 'KeyD') || hold.right) dir += 1;
    if (!dir) return;
    const fine = held('ShiftLeft', 'ShiftRight');
    const rate = isPutt() ? (fine ? 0.04 : 0.25) : (fine ? 0.08 : 0.55);
    G.aimYaw = wrapAngle(G.aimYaw + dir * rate * dt);
    G.aimTouched = true;
    G.previewDirty = true;
  }

  // ---------- main update ----------
  function update(dt) {
    G.time += dt;
    const paused = overlayOpen() && G.mode !== 'title';
    if (!paused) {
      if (G.mode === 'walk') updateWalk(dt);
      else if (G.mode === 'cart') updateCart(dt);
      else if (G.mode === 'shot') {
        if (G.shotPhase === 'aim') updateAim(dt);
        else if (G.shotPhase === 'swing') updateMeter(dt);
        else if (G.shotPhase === 'down') updateDownswing(dt);
        if (G.shotPhase === 'aim' && G.previewDirty) computePreview();
      }
      updateBall(dt);
      // Penalty drops
      if (G.pending) {
        G.pending.t -= dt;
        if (G.pending.t <= 0) {
          const p = G.pending;
          G.pending = null;
          placeBall(p.x, p.z, p.tee);
          G.ballCam = false;
          UI.toast(p.msg, `${Math.round(distTo(p.x, p.z))} yds from you · stroke ${G.strokes + 1} next`, 2400);
          if (G.strokes >= MAX_STROKES) pickUp();
        }
      }
      if (G.ballCam && G.ballState !== 'moving' && G.ballState !== 'gone') {
        G.ballCamTimer -= dt;
        if (G.ballCamTimer <= 0) G.ballCam = false;
      }
      if (G.ballState !== 'moving') World.trailFade(dt);
      if (G.ballState === 'holed' && G.ball.mode === 'holed') G.ball.p.y = Math.max(hole().pin.y - 0.09, G.ball.p.y - dt * 0.6);
      if (G.cardTimer > 0) {
        G.cardTimer -= dt;
        if (G.cardTimer <= 0) { G.cardTimer = 0; showCard(true); }
      }
    }
    if (G.mode !== 'cart') Sound.engine(0);
    updateCamera(dt);
    updateGolfer(dt);
    World.setBall(G.ball.p, G.ballState === 'gone' ? 'water' : G.ball.mode === 'holed' ? 'holed' : 'ok', G.ballState === 'tee');
    if (G.mode !== 'title') updateHud();
    Sound.ambient(dt);
  }

  // ---------- resize & loop ----------
  function resize() {
    const app = UI.$('app');
    World.resize(app.clientWidth, app.clientHeight);
    if (UI.isShown('map')) drawMap();
  }
  window.addEventListener('resize', resize);
  resize();

  const HQ = /[?&]hq\b/.test(location.search);
  // Tests on slow software renderers can let each frame cover more game time.
  const DT_CAP = parseFloat((location.search.match(/[?&]dtcap=([\d.]+)/) || [])[1]) || 0.05;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(DT_CAP, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      update(dt);
      World.update(dt, G.wind, focus);
      World.paintTick(G.mode === 'title' ? 10 : 4, G.player.x, G.player.z);
      World.render();
      if (!HQ && G.mode !== 'title') World.adapt(dt);
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- boot ----------
  UI.text('tHoles', HOLES.length);
  UI.text('tPar', PAR);
  UI.text('tYards', UI.fmtYds(HOLES.reduce((a, h) => a + h.yards, 0)));
  const st = store.load();
  if (st.best) {
    UI.$('bestLine').hidden = false;
    UI.$('bestLine').textContent = `Your best round: ${st.best} (${UI.fmtToPar(st.best - PAR)})`;
  }
  const resumable = (saved && saved.round) || st.round;
  if (resumable && resumable.next > 0 && resumable.next < HOLES.length) {
    if (saved && saved.round) { const s2 = store.load(); s2.round = saved.round; store.save(s2); }
    UI.$('resumeBtn').hidden = false;
    UI.$('resumeBtn').textContent = `Resume at hole ${resumable.next + 1}`;
  }
  activateHole(0);
  const cl = course.clubhouse;
  placePlayer(cl.x - 8, cl.z - 17, -0.6);
  titlePose(0, cam.pos, cam.look);
  requestAnimationFrame(frame);

  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    try {
      window.claude.hot.snapshot(() => ({ round: G.inRound ? { scores: G.scores.slice(), next: G.hole } : null }));
    } catch (e) { /* optional */ }
  }

  // Small API for automated tests and console tinkering.
  return {
    G, course, cart, golfer, meterPress, takeShot, enterShot, leaveShot, interact, enterCart, exitCart, activateHole,
    startRound, placePlayer, nextFromCard,
    // Run a swing with a given power and accuracy through the real downswing.
    swingNow(power, e) {
      if (G.mode !== 'shot' || G.shotPhase !== 'aim') return false;
      G.swing = { a: 0, top: isPutt() ? 0.5 : 2.5, t: 0, fired: false, finish: 0, putt: isPutt() };
      startDownswing(power, e);
      return true;
    },
    teleportToBall() { const b = G.ball.p; placePlayer(b.x - 1.5, b.z + 1.5, 0); },
  };
}

// Boot once the page is ready.
(function boot() {
  const go = (data) => {
    UI.setLoading(true, 'Mowing the fairways…');
    // Let the loading overlay paint before building the course.
    setTimeout(() => {
      const api = startGame(data || {});
      UI.setLoading(false);
      window.__golfApi = api;
    }, 30);
  };
  const start = () => {
    const hot = window.claude && window.claude.hot;
    if (hot && hot.ready) hot.ready(go);
    else go((hot && hot.data) || {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
