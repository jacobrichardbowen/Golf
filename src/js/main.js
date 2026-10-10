// ---------------------------------------------------------------------------
// Game flow: title -> hole intro flyover -> aim -> 3-press swing -> ball in
// motion -> next shot ... -> holed -> scorecard -> next hole -> final card.
// ---------------------------------------------------------------------------

function startGame(saved) {
  const MAX_STROKES = 10;
  const PUTT_RANGES = [3, 5, 8, 12, 16, 22, 30, 40, 55];
  const STORE_KEY = 'pinehaven-golf-v1';
  const HOLES = COURSE.holes;
  const YARDS = HOLES.map((h) => Math.round(makePolyline(h.path).length));
  const PAR = HOLES.reduce((a, h) => a + h.par, 0);

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
    return;
  }
  const camera = World.camera;

  const G = {
    state: 'boot', holeIndex: 0, scores: [], strokes: 0, field: null,
    ball: createBall(0, 0, 0), aimYaw: 0, aimTouched: false, clubIndex: 0, lie: S_TEE,
    wind: { x: 0, z: 0, mph: 0, yaw: 0 }, view: 0, zoom: 1,
    meter: { phase: 'idle', p: 0, power: 0 },
    shot: null, previewDirty: true, preview: { pts: [], landing: null }, previewVer: 0, guidesVer: -1,
    timer: 0, acc: 0, puttRange: 10, introT: 0, introDur: 4, trace: [], titleT: 0, ff: false,
    inRound: false, time: 0,
  };
  window.__golf = G; // handy for debugging from the console
  window.__golfWorld = World;

  // ---------- helpers ----------
  const club = () => CLUBS[G.clubIndex];
  const isPutt = () => club().putter;
  const ballPos = () => G.ball.p;
  const distToPin = () => Math.hypot(G.field.pin.x - G.ball.p.x, G.field.pin.z - G.ball.p.z);
  const toPar = () => G.scores.reduce((a, s, i) => a + (s != null ? s - HOLES[i].par : 0), 0);
  const playedAny = () => G.scores.some((s) => s != null);
  const fmtDist = (yd, putting) => (putting && yd < 30 ? `${Math.max(1, Math.round(yd * 3))} ft` : `${Math.round(yd)} yds`);

  function placeBall(x, z) {
    const y = G.field.H(x, z) + BALL_R;
    G.ball = createBall(x, y, z);
  }

  function setWind() {
    const def = HOLES[G.holeIndex];
    const r = mulberry32((def.seed || 1) * 13 + (Date.now() & 0xffff));
    const [lo, hi] = def.wind || [0, 10];
    const mph = lo + r() * (hi - lo);
    const yaw = r() * TAU;
    const d = dirFromYaw(yaw);
    G.wind = { mph, yaw, x: d.x * mph * MPH, z: d.z * mph * MPH };
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

  function reach(c) { return c.carry * lieFactor(c, G.lie); }

  function defaultAim() {
    const b = ballPos(), pin = G.field.pin, c = club();
    const yPin = yawFromDir(pin.x - b.x, pin.z - b.z);
    if (c.putter) return yPin;
    const r = reach(c) + 12;
    if (distToPin() <= r) return yPin;
    const line = G.field.line;
    const s0 = line.query(b.x, b.z).s;
    for (let s = G.field.length; s > s0; s -= 2) {
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

  // ---------- HUD ----------
  function refreshShotHud() {
    const c = club();
    const putting = c.putter;
    if (putting) {
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

  // ---------- preview of a full-power, no-wind shot ----------
  const _speedCache = new Map();
  function fullShotSpeed(c, lie) {
    const k = c.id + ':' + lie;
    if (!_speedCache.has(k)) _speedCache.set(k, speedForCarry(c, c.carry * lieFactor(c, lie), SURFACES[lie].spinLie));
    return _speedCache.get(k);
  }

  function computePreview() {
    G.previewDirty = false;
    const c = club(), b = ballPos(), f = G.field;
    const pts = [];
    if (c.putter) {
      const d = dirFromYaw(G.aimYaw);
      const len = clamp(distToPin(), 1, G.puttRange);
      for (let s = 0; s <= len + 0.001; s += Math.max(0.25, len / 60)) {
        const x = b.x + d.x * s, z = b.z + d.z * s;
        pts.push({ x, y: f.H(x, z) + 0.03, z });
      }
      G.preview = { pts, landing: null, end: pts[pts.length - 1] };
      G.previewVer++;
      return;
    }
    const sim = createBall(b.x, b.y, b.z);
    const speed = fullShotSpeed(c, G.lie);
    launchBall(sim, G.aimYaw, speed, c.launch, spinFor(c, speed, SURFACES[G.lie].spinLie), 0);
    pts.push({ x: b.x, y: b.y, z: b.z });
    for (let i = 0; i < 240 * 12; i++) {
      stepBall(sim, f, null, DT, null, { noTrees: true });
      if (i % 5 === 0) pts.push({ x: sim.p.x, y: sim.p.y, z: sim.p.z });
      if (sim.mode !== 'flight' || sim.carry !== null) break;
    }
    pts.push({ x: sim.p.x, y: sim.p.y, z: sim.p.z });
    G.preview = { pts, landing: { x: sim.p.x, z: sim.p.z }, end: { x: sim.p.x, z: sim.p.z } };
    G.previewVer++;
  }

  // ---------- flow ----------
  function loadHole(i, then) {
    G.holeIndex = i;
    G.state = 'loading';
    UI.hideBanner(); UI.hideToast();
    UI.setLoading(true, `Hole ${i + 1} · ${HOLES[i].name}`);
    // Let the overlay paint before the heavy lifting.
    setTimeout(() => {
      G.field = buildField(HOLES[i]);
      const surfCanvas = World.setHole(G.field, i + 1);
      UI.prepMinimap(surfCanvas, G.field);
      UI.setLoading(false);
      setWind();
      G.strokes = 0;
      placeBall(G.field.tee.x, G.field.tee.z);
      G.trace = [];
      World.trailReset();
      UI.setHole(i + 1, HOLES[i], G.field.yards);
      if (then) then(); else startIntro();
    }, 40);
  }

  function startIntro() {
    G.state = 'intro';
    G.introT = 0;
    G.introDur = 3 + G.field.length / 220;
    prepareShot(true);
    G.state = 'intro';
    const def = HOLES[G.holeIndex];
    UI.banner(
      `<div class="b-eyebrow">Hole ${G.holeIndex + 1} of ${HOLES.length}</div><div class="b-title">${def.name}</div>` +
        `<div class="b-meta">Par ${def.par} · ${G.field.yards} yds · Wind ${Math.round(G.wind.mph)} mph</div>` +
        `<div class="b-skip">Press Space or tap to skip</div>`,
    );
    UI.meterEnabled(false);
  }

  function endIntro() {
    if (G.state !== 'intro') return;
    UI.hideBanner();
    G.state = 'aim';
    UI.meterEnabled(true);
    UI.setHint(swingHint());
  }

  function prepareShot(first) {
    G.lie = first ? S_TEE : G.field.surface(G.ball.p.x, G.ball.p.z);
    if (G.lie === S_OOB) G.lie = S_DEEP;
    G.aimTouched = false;
    G.clubIndex = autoClub();
    if (isPutt()) choosePuttRange();
    G.aimYaw = defaultAim();
    G.previewDirty = true;
    G.meter = { phase: 'idle', p: 0, power: 0 };
    UI.setMeter(0, null);
    refreshShotHud();
    World.setPinVisible(G.lie !== S_GREEN);
    World.showSlope(G.lie === S_GREEN || G.lie === S_FRINGE);
    World.trailReset();
    G.trace = [];
    G.state = 'aim';
    UI.meterEnabled(true);
    UI.swingLabel('Swing');
    UI.setHint(swingHint());
  }

  function swingHint() {
    return matchMedia('(pointer: coarse)').matches
      ? 'Tap <b>Swing</b> three times: start, power, accuracy'
      : 'Press <kbd>Space</kbd> three times: start, power, accuracy';
  }

  // ---------- the swing meter ----------
  function meterPress() {
    if (G.state === 'intro') { endIntro(); return; }
    if (G.state === 'settle' || G.state === 'penalty') { G.timer = Math.min(G.timer, 0.15); return; }
    if (G.state === 'aim') {
      if (G.previewDirty) computePreview();
      G.state = 'swing';
      G.meter = { phase: 'power', p: 0, power: 0 };
      UI.setHint('Press again to set <b>power</b>');
      Sound.click();
      return;
    }
    if (G.state !== 'swing') return;
    const m = G.meter;
    if (m.phase === 'power') {
      if (m.p < 0.02) return; // too soon to be intentional
      m.power = m.p;
      m.phase = 'acc';
      UI.setHint('Stop on the <b>white line</b>');
      Sound.click();
    } else if (m.phase === 'acc') {
      takeShot(m.power, clamp(-m.p / P_ACC, -1, 1));
    }
  }
  const P_ACC = 0.15;

  function cancelSwing() {
    if (G.state !== 'swing') return;
    G.state = 'aim';
    G.meter = { phase: 'idle', p: 0, power: 0 };
    UI.setMeter(0, null);
    UI.setHint(swingHint());
  }

  function updateMeter(dt) {
    const m = G.meter;
    const speed = isPutt() ? 0.8 : 1.05;
    if (m.phase === 'power') {
      m.p += speed * dt;
      if (m.p >= 1) { m.p = 1; m.power = 1; m.phase = 'acc'; UI.setHint('Stop on the <b>white line</b>'); }
      UI.setMeter(m.p, null);
    } else if (m.phase === 'acc') {
      m.p -= speed * 0.95 * dt;
      UI.setMeter(m.p, m.power);
      if (m.p <= -P_ACC) takeShot(m.power, 1);
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
    // Small dead zone around the line, so a 'Perfect' strike flies straight.
    const eff = (Math.sign(e) * Math.max(0, Math.abs(e) - 0.1)) / 0.9;
    G.shot = {
      start: { x: b.p.x, y: b.p.y, z: b.p.z }, club: c, power, e, putter: !!c.putter,
      stroke: G.strokes + 1, lie: G.lie, toPinBefore: distToPin(),
    };
    G.strokes++;
    UI.setStroke(G.strokes);
    if (c.putter) {
      const yaw = G.aimYaw + eff * 1.6 * DEG;
      startRoll(b, yaw, puttSpeedFor(power * G.puttRange));
      Sound.hit(power, true);
    } else {
      const spinMul = SURFACES[G.lie].spinLie;
      const speed = speedForCarry(c, power * c.carry * lieFactor(c, G.lie), spinMul);
      const yaw = G.aimYaw + eff * 2.0 * DEG;
      launchBall(b, yaw, speed, c.launch + (G.lie === S_SAND ? 3 : 0), spinFor(c, speed, spinMul), -eff * 22);
      Sound.swing(power);
      Sound.hit(power, false);
    }
    G.shotYaw = G.aimYaw;
    UI.setHint(`${gradeLabel(e, c.putter)} · ${Math.round(power * 100)}% power`);
    UI.setMeter(G.meter.p, power);
    G.meter.phase = 'done';
    UI.meterEnabled(false);
    World.hideGuides();
    G.guidesVer = -1;
    World.trailReset();
    G.trace = [{ x: b.p.x, z: b.p.z }];
    G.acc = 0;
    G.bounceSounds = 0;
    G.state = 'flight';
    UI.swingLabel('Faster');
  }

  // ---------- ball in motion ----------
  function updateFlight(dt) {
    const scale = G.ff ? 4 : 1;
    G.acc += dt * scale;
    const events = [];
    const b = G.ball;
    let n = 0;
    while (G.acc >= DT && (b.mode === 'flight' || b.mode === 'roll')) {
      stepBall(b, G.field, G.wind, DT, events);
      G.acc -= DT;
      if ((++n & 3) === 0 || b.mode !== 'flight') World.trailPush(b.p);
      if (n > 2400) break;
    }
    if (G.trace.length === 0 || Math.hypot(b.p.x - G.trace[G.trace.length - 1].x, b.p.z - G.trace[G.trace.length - 1].z) > 2) {
      G.trace.push({ x: b.p.x, z: b.p.z });
    }
    for (const ev of events) {
      if (ev.type === 'bounce') {
        if (G.bounceSounds++ < 5 && ev.speed > 0.6) Sound.bounce(ev.speed, ev.surf);
      } else if (ev.type === 'tree') Sound.tree(ev.hard);
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
    const dist = Math.hypot(b.p.x - s.start.x, b.p.z - s.start.z);
    const lie = G.field.surface(b.p.x, b.p.z);
    const toPin = distToPin();
    const onGreen = lie === S_GREEN || lie === S_FRINGE;
    UI.toast(
      `${shotName(s)} · ${fmtDist(dist, s.putter)}`,
      `${SURFACES[lie].label} · ${fmtDist(toPin, onGreen)} to the pin`,
      2200,
    );
    if (G.strokes >= MAX_STROKES) return pickUp();
    UI.swingLabel('Next');
    G.state = 'settle';
    G.timer = s.putter ? 1.1 : 1.8;
  }

  function onWater() {
    const b = G.ball, s = G.shot;
    Sound.splash();
    World.splash(b.p.x, b.p.y, b.p.z);
    G.strokes++;
    UI.toast('Water hazard', 'One-stroke penalty · dropping near where it went in', 2600, true);
    // Find a dry drop spot near the point of entry, nudged back towards the shot.
    let x = b.lastDry.x, z = b.lastDry.z;
    const dx = s.start.x - x, dz = s.start.z - z, dl = Math.hypot(dx, dz) || 1;
    let ok = false;
    for (let i = 0; i < 60; i++) {
      const tx = x + (dx / dl) * (2 + i * 1.5), tz = z + (dz / dl) * (2 + i * 1.5);
      if (G.field.inBounds(tx, tz) && G.field.waterLevel(tx, tz) === -Infinity && G.field.surface(tx, tz) !== S_WATER &&
        Math.hypot(tx - s.start.x, tz - s.start.z) < dl + 1) { x = tx; z = tz; ok = true; break; }
    }
    if (!ok) { x = s.start.x; z = s.start.z; }
    G.pending = { x, z };
    G.state = 'penalty';
    G.timer = 2.4;
    if (G.strokes >= MAX_STROKES) { G.timer = 1.4; G.pickUpAfter = true; }
  }

  function onOOB() {
    const s = G.shot;
    G.strokes++;
    Sound.groan();
    UI.toast('Out of bounds', 'Stroke and distance · replay from the last spot', 2600, true);
    G.pending = { x: s.start.x, z: s.start.z };
    G.state = 'penalty';
    G.timer = 2.2;
    if (G.strokes >= MAX_STROKES) { G.timer = 1.4; G.pickUpAfter = true; }
  }

  function onHoled(dunk) {
    const def = HOLES[G.holeIndex];
    G.scores[G.holeIndex] = G.strokes;
    const name = scoreName(G.strokes, def.par);
    const d = G.strokes - def.par;
    Sound.cup();
    if (d <= 0) setTimeout(() => Sound.applause(clamp(0.35 - d * 0.3, 0.2, 1)), 250);
    const under = d < 0 || G.strokes === 1;
    UI.banner(
      `<div class="b-eyebrow">${dunk ? 'Straight in' : 'In the hole'}</div><div class="b-title">${name}</div>` +
        `<div class="b-meta">${G.strokes} stroke${G.strokes === 1 ? '' : 's'} · Round ${UI.fmtToPar(toPar())}</div>`,
      'result' + (under ? ' under' : ''),
    );
    UI.setTotal(toPar(), true);
    UI.swingLabel('Swing');
    saveProgress();
    G.state = 'holed';
    G.timer = 3.4;
  }

  function pickUp() {
    G.scores[G.holeIndex] = MAX_STROKES;
    UI.banner(`<div class="b-eyebrow">Maximum ${MAX_STROKES} strokes</div><div class="b-title">Picked up</div>`, 'result');
    UI.setTotal(toPar(), true);
    saveProgress();
    G.state = 'holed';
    G.timer = 2.6;
  }

  function showCard(afterHole) {
    const last = G.holeIndex >= HOLES.length - 1;
    const done = afterHole && last;
    UI.renderCard(HOLES, YARDS, G.scores, G.holeIndex, {
      title: done ? 'Final round' : afterHole ? `After ${G.holeIndex + 1}` : 'Scorecard',
      next: afterHole ? (done ? 'Play again' : `Hole ${G.holeIndex + 2}`) : null,
      closable: !afterHole,
    });
    UI.show('card', true);
    if (afterHole) G.state = 'card';
    if (done) finishRound();
  }

  function finishRound() {
    const total = G.scores.reduce((a, s) => a + s, 0);
    const st = store.load();
    if (!st.best || total < st.best) st.best = total;
    st.round = null;
    store.save(st);
    G.inRound = false;
  }

  function saveProgress() {
    const st = store.load();
    st.round = { scores: G.scores.slice(), next: G.holeIndex + 1 };
    store.save(st);
  }

  function nextFromCard() {
    UI.show('card', false);
    UI.hideBanner();
    if (G.holeIndex >= HOLES.length - 1) {
      startRound(0, []);
    } else {
      loadHole(G.holeIndex + 1);
    }
  }

  function startRound(at, scores) {
    Sound.init();
    G.scores = scores || [];
    G.inRound = true;
    UI.show('title', false);
    UI.show('hud', true);
    if (at === 0 && G.field && G.holeIndex === 0 && G.state === 'title') {
      // Hole 1 is already built for the title backdrop.
      setWind();
      G.strokes = 0;
      placeBall(G.field.tee.x, G.field.tee.z);
      UI.setHole(1, HOLES[0], G.field.yards);
      startIntro();
    } else loadHole(at);
  }

  // ---------- camera ----------
  const V3 = THREE.Vector3;
  const cam = { pos: new V3(0, 5, 10), look: new V3(0, 0, 0), tPos: new V3(), tLook: new V3() };
  const focus = new V3();

  function aimPose(outPos, outLook) {
    const b = G.ball.p, d = dirFromYaw(G.aimYaw);
    const putt = isPutt();
    if (G.view === 0) {
      const back = (putt ? 3.0 : 6.5) * G.zoom, up = (putt ? 1.15 : 2.3) * Math.sqrt(G.zoom);
      outPos.set(b.x - d.x * back, b.y + up, b.z - d.z * back);
      const ahead = putt ? clamp(distToPin() * 0.6, 2, 8) : 32;
      outLook.set(b.x + d.x * ahead, b.y + (putt ? -0.3 : 1.6), b.z + d.z * ahead);
    } else if (G.view === 1) {
      const t = G.preview.end || G.field.pin;
      const ty = G.field.H(t.x, t.z);
      const dist = Math.hypot(t.x - b.x, t.z - b.z);
      const back = clamp(dist * 0.18, 8, 40) * G.zoom;
      outPos.set(t.x - d.x * back, ty + back * 0.75, t.z - d.z * back);
      outLook.set(t.x, ty, t.z);
    } else {
      const t = G.preview.end || G.field.pin;
      const mx = (b.x + t.x) / 2, mz = (b.z + t.z) / 2;
      const span = Math.max(30, Math.hypot(t.x - b.x, t.z - b.z));
      const h = span * 1.05 * G.zoom;
      outPos.set(mx - d.x * h * 0.25, G.field.H(mx, mz) + h, mz - d.z * h * 0.25);
      outLook.set(mx, G.field.H(mx, mz), mz);
    }
  }

  function introPose(u, outPos, outLook) {
    const f = G.field, L = f.length;
    const e = u * u * (3 - 2 * u);
    const s = (L - 50) * (1 - e);
    const p = f.line.pointAt(s);
    const la = f.line.pointAt(Math.min(L, s + 110));
    const h = lerp(32, 6, e) + 14 * Math.sin(Math.PI * e);
    outPos.set(p.x - p.ux * 10, f.H(p.x, p.z) + h, p.z - p.uz * 10);
    outLook.set(la.x, f.H(la.x, la.z) + 2, la.z);
    if (u > 0.7) {
      const k = smoothstep(0.7, 1, u);
      const ap = new V3(), al = new V3();
      aimPose(ap, al);
      outPos.lerp(ap, k);
      outLook.lerp(al, k);
    }
  }

  function titlePose(t, outPos, outLook) {
    const f = G.field, L = f.length;
    const u = 0.5 - 0.5 * Math.cos(t * TAU);
    const s = L * (0.08 + 0.62 * u);
    const p = f.line.pointAt(s);
    const la = f.line.pointAt(Math.min(L, s + 150));
    outPos.set(p.x - p.uz * 26, f.H(p.x, p.z) + 22, p.z + p.ux * 26);
    outLook.set(la.x, f.H(la.x, la.z) + 4, la.z);
  }

  function updateCamera(dt) {
    let rate = 4, lookRate = 6;
    const b = G.ball.p;
    switch (G.state) {
      case 'title':
        G.titleT += dt / 60;
        titlePose(G.titleT, cam.tPos, cam.tLook);
        rate = lookRate = 30;
        break;
      case 'intro':
        introPose(clamp(G.introT / G.introDur, 0, 1), cam.tPos, cam.tLook);
        rate = lookRate = 40;
        break;
      case 'aim': case 'swing':
        aimPose(cam.tPos, cam.tLook);
        rate = 4.5; lookRate = 6;
        break;
      case 'flight': {
        const s = G.shot;
        const d = dirFromYaw(G.shotYaw);
        if (s.putter) {
          cam.tPos.set(b.x - d.x * 3.2, b.y + 1.3, b.z - d.z * 3.2);
          rate = 1.6;
        } else {
          const dist = Math.hypot(b.x - s.start.x, b.z - s.start.z);
          const back = 9 + Math.min(dist * 0.03, 8);
          cam.tPos.set(b.x - d.x * back, Math.max(b.y, G.field.H(b.x, b.z)) + 3.5 + Math.min(dist * 0.02, 6), b.z - d.z * back);
          rate = 1.3;
        }
        cam.tLook.set(b.x, b.y, b.z);
        lookRate = 8;
        break;
      }
      case 'settle': case 'penalty': case 'holed':
        cam.tLook.set(b.x, b.y, b.z);
        rate = 0.6; lookRate = 4;
        cam.tPos.copy(cam.pos);
        break;
      default:
        break;
    }
    const kp = 1 - Math.exp(-dt * rate), kl = 1 - Math.exp(-dt * lookRate);
    cam.pos.lerp(cam.tPos, kp);
    cam.look.lerp(cam.tLook, kl);
    if (G.field) {
      const gh = G.field.H(cam.pos.x, cam.pos.z);
      if (cam.pos.y < gh + 0.5) cam.pos.y = gh + 0.5;
    }
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    // Shadow focus: a little ahead of the camera.
    focus.copy(cam.look).lerp(cam.pos, 0.35);
  }

  // ---------- input ----------
  const keys = new Set();
  const hold = { left: false, right: false };

  window.addEventListener('keydown', (e) => {
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (keys.has(k)) return;
    keys.add(k);
    if (k === 'Escape') {
      if (UI.isShown('help')) return UI.show('help', false);
      if (UI.isShown('card') && G.state !== 'card') return UI.show('card', false);
      return cancelSwing();
    }
    if (UI.isShown('title')) { if (k === 'Enter') onStart(); return; }
    if (UI.isShown('help')) { if (k === 'Enter' || k === 'Space') UI.show('help', false); return; }
    if (UI.isShown('card')) {
      if (G.state === 'card' && (k === 'Enter' || k === 'Space')) nextFromCard();
      else if (k === 'KeyC' && G.state !== 'card') UI.show('card', false);
      return;
    }
    if (k === 'Space' || k === 'Enter') {
      if (G.state === 'flight') G.ff = true;
      else meterPress();
    } else if (k === 'ArrowUp' || k === 'KeyW') {
      if (G.state === 'aim') setClub(G.clubIndex - 1, true);
    } else if (k === 'ArrowDown' || k === 'KeyS') {
      if (G.state === 'aim') setClub(G.clubIndex + 1, true);
    } else if (k === 'KeyV') {
      G.view = (G.view + 1) % 3;
    } else if (k === 'KeyC') {
      if (G.field) showCard(false);
    } else if (k === 'KeyM') {
      toggleMute();
    } else if (k === 'KeyH' || k === 'Slash') {
      UI.show('help', true);
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space' || e.code === 'Enter') G.ff = false;
  });
  window.addEventListener('blur', () => { keys.clear(); G.ff = false; hold.left = hold.right = false; });

  // Drag to aim, wheel to zoom.
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (G.state === 'intro') { endIntro(); return; }
    drag = { id: e.pointerId, x: e.clientX };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    if (G.state === 'aim') {
      G.aimYaw += dx * (isPutt() ? 0.0012 : 0.0028);
      G.aimTouched = true;
      G.previewDirty = true;
    }
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    G.zoom = clamp(G.zoom * Math.exp(e.deltaY * 0.001), 0.45, 2.6);
  }, { passive: false });

  function holdButton(id, on, off) {
    const el = UI.$(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  }
  holdButton('aimLeft', () => (hold.left = true), () => (hold.left = false));
  holdButton('aimRight', () => (hold.right = true), () => (hold.right = false));
  holdButton('swingBtn', () => { if (G.state === 'flight') G.ff = true; else meterPress(); }, () => (G.ff = false));
  UI.$('meter').addEventListener('pointerdown', (e) => { e.preventDefault(); meterPress(); });
  UI.$('viewBtn').addEventListener('click', () => (G.view = (G.view + 1) % 3));
  UI.$('clubPrev').addEventListener('click', () => G.state === 'aim' && setClub(G.clubIndex - 1, true));
  UI.$('clubNext').addEventListener('click', () => G.state === 'aim' && setClub(G.clubIndex + 1, true));
  UI.$('cardBtn').addEventListener('click', () => G.field && showCard(false));
  UI.$('helpBtn').addEventListener('click', () => UI.show('help', true));
  UI.$('helpClose').addEventListener('click', () => UI.show('help', false));
  UI.$('howBtn').addEventListener('click', () => UI.show('help', true));
  UI.$('muteBtn').addEventListener('click', toggleMute);
  UI.$('cardClose').addEventListener('click', () => UI.show('card', false));
  UI.$('cardNext').addEventListener('click', nextFromCard);
  UI.$('startBtn').addEventListener('click', onStart);
  UI.$('resumeBtn').addEventListener('click', () => {
    const r = store.load().round;
    if (r && r.next < HOLES.length) startRound(r.next, r.scores);
    else onStart();
  });
  document.getElementById('banner').addEventListener('pointerdown', () => G.state === 'intro' && endIntro());

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
    if (keys.has('ArrowLeft') || keys.has('KeyA') || hold.left) dir -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD') || hold.right) dir += 1;
    if (!dir) return;
    const fine = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const rate = isPutt() ? (fine ? 0.04 : 0.25) : (fine ? 0.08 : 0.55);
    G.aimYaw = wrapAngle(G.aimYaw + dir * rate * dt);
    G.aimTouched = true;
    G.previewDirty = true;
  }

  // ---------- main update ----------
  const projV = new V3();
  function update(dt) {
    G.time += dt;
    switch (G.state) {
      case 'intro':
        G.introT += dt;
        if (G.introT >= G.introDur) endIntro();
        break;
      case 'aim':
        updateAim(dt);
        break;
      case 'swing':
        updateMeter(dt);
        break;
      case 'flight':
        updateFlight(dt);
        break;
      case 'settle':
        G.timer -= dt;
        World.trailFade(dt);
        if (G.timer <= 0) prepareShot(false);
        break;
      case 'penalty':
        G.timer -= dt;
        if (G.timer <= 0) {
          if (G.pickUpAfter) { G.pickUpAfter = false; pickUp(); break; }
          placeBall(G.pending.x, G.pending.z);
          prepareShot(false);
        }
        break;
      case 'holed':
        G.timer -= dt;
        // Let the ball drop into the cup.
        if (G.ball.mode === 'holed') G.ball.p.y = Math.max(G.field.pin.y - 0.09, G.ball.p.y - dt * 0.6);
        if (G.timer <= 0) { UI.hideBanner(); showCard(true); }
        break;
    }
    if ((G.state === 'aim' || G.state === 'swing') && G.previewDirty) computePreview();
    if ((G.state === 'aim' || G.state === 'swing' || G.state === 'intro') && G.guidesVer !== G.previewVer) {
      World.setGuides(G.preview.pts, G.preview.landing, isPutt());
      G.guidesVer = G.previewVer;
    }

    updateCamera(dt);

    if (G.field) {
      World.setBall(G.ball.p, G.ball.mode === 'water' ? 'water' : G.ball.mode === 'holed' ? 'holed' : 'ok');
      // Wind arrow relative to where the camera faces.
      const camYaw = yawFromDir(cam.look.x - cam.pos.x, cam.look.z - cam.pos.z);
      UI.setWind(G.wind.mph, wrapAngle(G.wind.yaw - camYaw) / DEG);
      // Floating pin marker
      const pin = G.field.pin;
      projV.set(pin.x, pin.y + (G.lie === S_GREEN ? 0.3 : 2.7), pin.z).project(camera);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const vis = G.state !== 'title' && projV.z < 1 && Math.abs(projV.x) < 1.05 && Math.abs(projV.y) < 1.05 && G.state !== 'holed';
      const onGreen = G.lie === S_GREEN || G.lie === S_FRINGE;
      UI.pinMarker((projV.x * 0.5 + 0.5) * w, (-projV.y * 0.5 + 0.5) * h, vis, fmtDist(distToPin(), onGreen && G.state !== 'flight'));
      if (G.state !== 'title') {
        const showAim = G.state === 'aim' || G.state === 'swing';
        UI.drawMinimap({ ball: G.ball.p, pin, target: showAim ? G.preview.end : null, trace: G.trace });
      }
    }
    Sound.ambient(dt);
  }

  // ---------- resize & loop ----------
  function resize() {
    const app = UI.$('app');
    World.resize(app.clientWidth, app.clientHeight);
    if (G.field && World.hole) UI.prepMinimap(World.hole.canvas, G.field);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      update(dt);
      World.update(dt, G.wind, focus);
      World.render();
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- boot ----------
  UI.text('tHoles', HOLES.length);
  UI.text('tPar', PAR);
  UI.text('tYards', UI.fmtYds(YARDS.reduce((a, b) => a + b, 0)));
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
  // Build hole 1 behind the title screen.
  loadHole(0, () => {
    G.state = 'title';
    prepareShot(true);
    G.state = 'title';
    World.hideGuides();
    G.guidesVer = -1;
    titlePose(0, cam.pos, cam.look);
  });
  requestAnimationFrame(frame);

  // Keep the round across live updates of the page.
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    try {
      window.claude.hot.snapshot(() => ({ round: G.inRound ? { scores: G.scores.slice(), next: G.holeIndex } : null }));
    } catch (e) { /* optional */ }
  }

  return { G, takeShot, meterPress, prepareShot, loadHole, endIntro, setClub };
}

// Boot once the page is ready.
(function boot() {
  const go = (data) => {
    const api = startGame(data || {});
    window.__golfApi = api;
  };
  const start = () => {
    const hot = window.claude && window.claude.hot;
    if (hot && hot.ready) hot.ready(go);
    else go((hot && hot.data) || {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
