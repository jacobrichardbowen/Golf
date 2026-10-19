// ---------------------------------------------------------------------------
// Game flow. You control your golfer the whole time: walk (or drive the cart)
// to the ball, press E to address it, hold to wind up and let go to swing,
// watch it fly, then walk on. Your caddy follows with the bag; walk up to it
// to change clubs. After holing out, head to the next tee.
//
// Modes: title -> select -> walk <-> cart, walk <-> shot, walk <-> bag.
// The ball simulates on its own timeline, whatever the player is doing.
// ---------------------------------------------------------------------------

// Which course to load: from the address (#course=golden or ?course=golden),
// else the one played last. Switching reloads the page into the other course.
const COURSE_KEY = 'pinehaven-course';
const COURSE_ID = (() => {
  const m = /course=(\w+)/.exec(location.hash) || /[?&]course=(\w+)/.exec(location.search);
  let id = m && m[1];
  if (!id) { try { id = localStorage.getItem(COURSE_KEY); } catch (e) { /* storage unavailable */ } }
  return courseDef(id).id;
})();
// rejoin: { code, name, char } to join that online game again after loading.
function switchCourse(id, rejoin) {
  try { localStorage.setItem(COURSE_KEY, id); } catch (e) { /* storage unavailable */ }
  try { if (rejoin) sessionStorage.setItem('pinehaven-rejoin', JSON.stringify(Object.assign({ at: Date.now() }, rejoin))); } catch (e) { /* storage unavailable */ }
  location.hash = 'course=' + id;
  location.reload();
}

function startGame(saved) {
  const MAX_STROKES = 10;
  const PUTT_RANGES = [3, 5, 8, 12, 16, 22, 30, 40, 55];
  const STORE_KEY = 'pinehaven-golf-v2';
  const REACH = 2.6;                     // how close to stand to the ball or cart
  const BAG_REACH = 2.1;

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
  const DEF = courseDef(COURSE_ID);
  const course = buildCourse(DEF, { images: (id) => Assets.pixels(id) });
  const HOLES = course.holes;
  const PAR = HOLES.reduce((a, h) => a + h.par, 0);
  UI.setOverview(World.buildCourse(course), course.bounds);

  const cart = Cart.create(course);
  World.add(cart.root);
  cart.place(DEF.cartStart.x, DEF.cartStart.z, (DEF.cartStart.heading || 0) * DEG);
  const bag = Equipment.createBag();
  World.add(bag.root);
  const caddy = Golfer.createCaddy();
  caddy.setVisible(false);
  World.add(caddy.root);
  let golfer = null;     // the player's golfer, created after choosing a character
  let lineup = [];       // golfers on the character screen

  const G = {
    mode: 'title', shotPhase: null, fp: false, character: 0,
    hole: 0, scores: [], strokes: 0, field: course.fieldFor(HOLES[0]),
    ball: createBall(0, 0, 0), ballState: 'tee', shot: null,
    player: { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, speed: 0 },
    cad: { x: 0, z: 0, y: 0, yaw: 0, speed: 0, riding: false, stuck: 0 },
    bagWhere: 'caddy', bagHover: -1, bagExit: 0, bagSpot: null,
    camYaw: 0, camPitch: 0.22, camDist: 4.4, cartLook: 0, lastMouse: -10,
    ballCam: false, ballCamTimer: 0, ff: false,
    aimYaw: 0, aimTouched: false, clubIndex: 0, lie: S_TEE, puttRange: 10, view: 0,
    swing: { a: 0, top: 0, t: 0, fired: false, finish: 0, putt: false, p: 0 },
    setup: { face: 0, head: 0 }, setupView: false, glance: 0,
    holdFinish: false, preview: { pts: [], landing: null, end: null }, previewDirty: true,
    wind: { x: 0, z: 0, mph: 0, yaw: 0 }, introShown: false, cardTimer: 0, pending: null, trace: [],
    time: 0, inRound: false, locked: false, toastGate: 0, stepT: 0, acc: 0, bounceSounds: 0,
    select: { index: 0, waveT: 0, resume: null },
    mp: null, // an online round: { seed, slot, name, players, remotes, ... }
  };
  window.__golf = G; // handy for debugging from the console
  window.__golfWorld = World;
  window.__golfAssets = Assets;

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
  const rightOf = (yaw) => ({ x: Math.cos(yaw), z: Math.sin(yaw) });
  const gScale = () => (golfer ? golfer.scale : 1);

  function placeBall(x, z, onTee) {
    G.ball = createBall(x, course.H(x, z) + BALL_R, z);
    G.ballState = onTee ? 'tee' : 'rest';
  }

  function setWind() {
    const def = hole().def;
    // Online, everyone feels the same wind on the same hole.
    const r = mulberry32(G.mp ? (G.mp.seed + (G.hole + 1) * 7919) >>> 0 : (def.seed || 1) * 13 + (Date.now() & 0xffff));
    const [lo, hi] = def.wind || [0, 10];
    const mph = lo + r() * (hi - lo);
    const yaw = r() * TAU;
    const d = dirFromYaw(yaw);
    G.wind = { mph, yaw, x: d.x * mph * MPH, z: d.z * mph * MPH };
  }

  // The flag comes out once the ball is on the green.
  function setFlag(v) {
    G.flagIn = v;
    World.setPinVisible(G.hole, v);
  }

  // The ground to stand on at (x, z) for someone around height y: the land,
  // or a bridge deck or tunnel floor (y omitted: the land).
  const standY = (x, z, y) => (y == null ? course.H(x, z) : course.floor(x, z, y + 0.6));
  function placePlayer(x, z, yaw, yHint) {
    Object.assign(G.player, { x, z, y: standY(x, z, yHint), yaw, vx: 0, vz: 0, speed: 0 });
    G.camYaw = yaw;
  }
  function placeCaddy(x, z, yaw, yHint) {
    Object.assign(G.cad, { x, z, y: standY(x, z, yHint), yaw, speed: 0, riding: false, stuck: 0 });
  }

  // Where you tee up. Online, each golfer has their own spot on the tee: three
  // abreast, and a second row behind (anyone in your line of sight steps out
  // of the picture while you address the ball).
  const TEE_SPOTS = [[0, 0], [-3.5, 0], [3.5, 0], [-3.5, -4.5], [3.5, -4.5], [0, -4.5]];
  function teeSpot(h) {
    const [side, along] = G.mp ? TEE_SPOTS[G.mp.slot] || [0, 0] : [0, 0];
    if (!side && !along) return { x: h.tee.x, z: h.tee.z };
    const rx = -h.teeDir.z, rz = h.teeDir.x, fx = h.teeDir.x, fz = h.teeDir.z;
    for (const f of [1, 0.75, 0.5]) {
      const x = h.tee.x + rx * side * f + fx * along, z = h.tee.z + rz * side * f + fz * along;
      if (course.surface(x, z) === S_TEE) return { x, z };
    }
    return { x: h.tee.x + rx * side * 0.5 + fx * along * 0.5, z: h.tee.z + rz * side * 0.5 + fz * along * 0.5 };
  }

  // ---------- holes & round ----------
  function activateHole(i) {
    G.hole = i;
    G.strokes = 0;
    G.cardAfterHole = false;
    G.field = course.fieldFor(HOLES[i]);
    setWind();
    const h = hole();
    const t = teeSpot(h);
    placeBall(t.x, t.z, true);
    G.introShown = false;
    G.trace = [];
    World.trailReset();
    setFlag(true);
    UI.setHole(i + 1, h);
    UI.setStroke(1);
    UI.setTotal(toPar(), playedAny());
  }

  function setCharacter(i) {
    G.character = i;
    if (golfer) { golfer.root.removeFromParent(); }
    golfer = Golfer.create(CHARACTERS[i]);
    World.add(golfer.root);
    // Your ball, your cart and your caddy's flag are in your colours.
    const cs = CHARACTERS[i].colors;
    World.setBallColor(cs.ball);
    cart.setColors(cs);
    caddy.setFlagColors(cs);
    UI.$('ballMarker').style.setProperty('--c', cs.ui);
  }

  function startRound(at, scores) {
    Sound.init();
    G.scores = scores || [];
    G.inRound = true;
    UI.show('title', false);
    UI.show('select', false);
    UI.show('hud', true);
    activateHole(at);
    G.clubIndex = 0; // the driver, for the opening tee shot
    G.fetch = null; G.cad.driving = false;
    G.bagWhere = 'caddy';
    G.bagSpot = null;
    const h = hole();
    if (at === 0) {
      // Online, everyone starts side by side, each with their own cart.
      const cl = course.clubhouse, slot = G.mp ? G.mp.slot : 0, k = [0, -1, 1, -2, 2, -3][slot] || 0;
      const pr = rightOf(-0.6);
      placePlayer(cl.x - 8 + pr.x * 2.2 * k, cl.z - 18 + pr.z * 2.2 * k, -0.6);
      const sp = cartSpot(slot);
      cart.place(sp.x, sp.z, sp.yaw);
      if (G.mp) UI.toast('Out on the course together', 'Everyone plays their own ball. Wait for each other at the end of each hole.', 4200);
      else UI.toast('Welcome to Pinehaven', 'Walk to the 1st tee, or hop in the cart. Your caddy has the bag.', 3800);
    } else {
      const back = { x: h.tee.x - h.teeDir.x * 12, z: h.tee.z - h.teeDir.z * 12 };
      placePlayer(back.x, back.z, yawFromDir(h.teeDir.x, h.teeDir.z));
      const side = { x: back.x - h.teeDir.z * 6, z: back.z + h.teeDir.x * 6 };
      cart.place(side.x, side.z, yawFromDir(h.teeDir.x, h.teeDir.z));
      UI.toast(`Back on the ${ordinal(at + 1)} tee`, 'Your round continues', 2600);
    }
    const P = G.player, f = dirFromYaw(P.yaw), r = rightOf(P.yaw);
    placeCaddy(P.x - f.x * 2.5 - r.x * 1.6, P.z - f.z * 2.5 - r.z * 1.6, P.yaw);
    caddy.setVisible(true);
    bag.setOut(G.clubIndex);
    G.mode = 'walk';
    UI.setMode('walk');
    saveProgress();
  }

  // Where cart number n parks at the start: the n-th clear spot in a row
  // (everyone works this out the same way, so no two carts share a spot).
  function cartSpot(n) {
    const cs = DEF.cartStart, yaw = (cs.heading || 0) * DEG, r = rightOf(yaw), f = dirFromYaw(yaw);
    const spots = [];
    for (const row of [0, -4.5, 4.5])
      for (const k of [0, -1, 1, -2, 2, -3, 3]) {
        const x = cs.x + r.x * 3 * k + f.x * row, z = cs.z + r.z * 3 * k + f.z * row;
        if (cart.clearAt(x, z, yaw, course.H(x, z))) spots.push({ x, z, yaw });
      }
    return spots[n] || spots[0] || { x: cs.x, z: cs.z, yaw };
  }

  function saveProgress() {
    if (G.mp) return; // online rounds can't be resumed
    const st = store.load();
    st.round = { scores: G.scores.slice(), next: G.hole, course: DEF.id };
    st.character = G.character;
    store.save(st);
  }

  function finishRound() {
    const total = G.scores.reduce((a, s) => a + s, 0);
    const st = store.load();
    const best = bestOf(st);
    if (!best || total < best) setBest(st, total);
    if (!G.mp) st.round = null;
    store.save(st);
    G.inRound = false;
  }

  // Best rounds and saved rounds belong to a course (Pinehaven's from before
  // there was a choice live in the old places).
  function bestOf(st) { return DEF.id === 'pinehaven' ? st.best : (st.bests || {})[DEF.id]; }
  function setBest(st, v) { if (DEF.id === 'pinehaven') st.best = v; else (st.bests = st.bests || {})[DEF.id] = v; }
  const roundHere = (r) => r && (r.course || 'pinehaven') === DEF.id;

  // ---------- character select ----------
  function lineupBase() {
    const cl = course.clubhouse;
    return { x: cl.x, z: cl.z - 21 };
  }
  function openSelect(resume) {
    Sound.init();
    G.select.resume = resume;
    G.mode = 'select';
    UI.show('title', false);
    UI.show('select', true);
    for (const l of lineup) l.root.removeFromParent();
    lineup = CHARACTERS.map((c) => { const g = Golfer.create(c); World.add(g.root); return g; });
    const st = store.load();
    G.select.index = clamp(st.character != null ? st.character : 0, 0, CHARACTERS.length - 1);
    if (matchMedia('(pointer: coarse)').matches) UI.$('selSub').textContent = 'Tap a golfer, then tee off.';
    renderSelectCards();
    chooseSelect(G.select.index);
  }
  function renderSelectCards() {
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    UI.$('selCards').innerHTML = CHARACTERS.map((c, i) =>
      `<button class="sel-card" data-i="${i}"><b>${c.name}</b><span class="h">${c.heightLabel}</span>` +
      `<span class="sw" aria-hidden="true"><i style="background:${hex(c.colors.primary)}"></i><i style="background:${hex(c.colors.secondary)}"></i><i class="ball" style="background:${hex(c.colors.ball)}"></i></span>` +
      `<span class="sw-l">${c.look}</span></button>`).join('');
    UI.$('selCards').querySelectorAll('.sel-card').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.i);
        if (i === G.select.index) confirmSelect(); else chooseSelect(i);
      });
    });
  }
  function chooseSelect(i) {
    G.select.index = (i + CHARACTERS.length) % CHARACTERS.length;
    G.select.waveT = 1.6;
    UI.$('selCards').querySelectorAll('.sel-card').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === G.select.index));
    UI.$('selGo').textContent = `Tee off as ${CHARACTERS[G.select.index].name}`;
    Sound.click();
  }
  function confirmSelect() {
    if (G.mode !== 'select') return;
    selRing.visible = false;
    for (const l of lineup) l.root.removeFromParent();
    lineup = [];
    setCharacter(G.select.index);
    const r = G.select.resume;
    if (r) startRound(r.next, r.scores); else startRound(0, []);
  }
  function backFromSelect() {
    selRing.visible = false;
    for (const l of lineup) l.root.removeFromParent();
    lineup = [];
    G.mode = 'title';
    UI.show('select', false);
    UI.show('title', true);
  }
  // A ring on the grass under the highlighted golfer.
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.9, depthWrite: false }));
  selRing.renderOrder = 3;
  selRing.visible = false;
  World.add(selRing);

  // Stand the line-up so each golfer sits above their card.
  function updateLineup(dt) {
    const base = lineupBase();
    const gy = course.H(base.x, base.z);
    camera.updateProjectionMatrix();
    // On a narrow screen, the three golfers in the selected card's row.
    const row = camera.aspect < 0.9 && lineup.length > 3 ? Math.floor(G.select.index / 3) * 3 : -1;
    const shown = lineup.map((_, i) => i).filter((i) => row < 0 || (i >= row && i < row + 3));
    G.select.shown = shown;
    const N = shown.length;
    // Back off on narrow screens so everyone fits.
    const spread = Math.tan((camera.fov * DEG) / 2) * camera.aspect;
    const D = Math.max(7.2, (N * 1.15) / 2 / spread / 0.92);
    const halfW = D * spread;
    lineup.forEach((g, i) => {
      const k = shown.indexOf(i);
      g.root.visible = k >= 0;
      if (k < 0) return;
      const ndc = ((k + 0.5) / N) * 2 - 1;
      // The camera looks south (+Z), so screen-right is world -X.
      const x = base.x - ndc * halfW * 0.92, z = base.z;
      g.root.position.set(x, course.H(x, z), z);
      g.root.rotation.set(0, Math.PI, 0);
      const sel = i === G.select.index;
      g.update(dt, sel && G.select.waveT > 0 ? { mode: 'wave' } : { mode: 'idle', lookAt: sel ? 0 : (i - G.select.index) * -0.3 });
      if (sel) { selRing.position.set(x, course.H(x, z) + 0.03, z); selRing.scale.setScalar(0.8 + 0.2 * g.scale); }
    });
    selRing.visible = G.mode === 'select';
    G.select.waveT -= dt;
    cam.tPos.set(base.x, gy + 1.45, base.z - D);
    cam.tLook.set(base.x, gy + 0.85, base.z);
  }

  // ---------- club & aim ----------
  // What the caddy would hit from here.
  function recommendedClub() {
    const lie = G.lie;
    if (lie === S_GREEN) return PUTTER_INDEX;
    const d = distToPin();
    if (lie === S_FRINGE && d < 22) return PUTTER_INDEX;
    for (let i = CLUBS.length - 2; i >= 0; i--) {
      const c = CLUBS[i];
      if (c.id === 'DR' && lie !== S_TEE) continue;
      if (carryOf(c, lie) >= d - 8) return i;
    }
    return lie === S_TEE ? 0 : 1;
  }

  // A club's full-power carry from a lie (the shot distance setting included).
  const carryOf = (c, lie) => c.carry * lieFactor(c, lie) * TUNE.distance;

  // Stepping up to the ball you're never quite lined up: a nudge either way,
  // a degree or two on the green, a few degrees for a full shot (scaled by
  // the auto-aim error setting).
  function aimNudge(putt) {
    const k = TUNE.autoAim;
    if (Math.random() < 0.15) return (Math.random() - 0.5) * (putt ? 0.5 : 1.2) * DEG * k;
    const mag = putt ? 0.6 + Math.random() * 1.6 : 1.5 + Math.random() * 3.5;
    return (Math.random() < 0.5 ? -1 : 1) * mag * DEG * k;
  }

  function defaultAim() {
    return wrapAngle(idealAim() + aimNudge(club().putter));
  }
  function idealAim() {
    const b = G.ball.p, pin = hole().pin, c = club();
    const yPin = yawFromDir(pin.x - b.x, pin.z - b.z);
    if (c.putter) return yPin;
    const r = carryOf(c, G.lie) + 12;
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

  function refreshShotHud() {
    const c = club();
    if (c.putter) {
      UI.setClub('Putter', `${G.puttRange * 3} ft max`);
    } else {
      const lf = lieFactor(c, G.lie);
      UI.setClub(c.name, `${Math.round(carryOf(c, G.lie))} yds${lf < 0.99 ? ' · lie −' + Math.round((1 - lf) * 100) + '%' : ''}`);
    }
    const onGreen = G.lie === S_GREEN || G.lie === S_FRINGE;
    UI.setFacts(fmtDist(distToPin(), onGreen), SURFACES[G.lie].name);
    UI.setStroke(G.strokes + 1);
    UI.setTotal(toPar(), playedAny());
  }

  const _speedCache = new Map();
  Tune.onChange(() => _speedCache.clear());
  function fullShotSpeed(c, lie) {
    const k = c.id + ':' + lie;
    if (!_speedCache.has(k)) _speedCache.set(k, speedForCarry(c, carryOf(c, lie), spinLieFactor(c, lie)));
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
      launchBall(sim, G.aimYaw, speed, c.launch, spinFor(c, speed, spinLieFactor(c, G.lie)), 0);
      pts.push({ x: b.x, y: b.y, z: b.z });
      for (let i = 0; i < 240 * 12; i++) {
        stepBall(sim, G.field, null, DT, null, { noTrees: true });
        if (i % 5 === 0) pts.push({ x: sim.p.x, y: sim.p.y, z: sim.p.z });
        if (sim.mode !== 'flight' || sim.carry !== null) break;
      }
      pts.push({ x: sim.p.x, y: sim.p.y, z: sim.p.z });
      G.preview = { pts, landing: { x: sim.p.x, z: sim.p.z }, end: { x: sim.p.x, z: sim.p.z } };
    }
    // Nothing is drawn: the flight only frames the landing-area cameras.
  }

  // ---------- addressing the ball ----------
  // Stand the golfer at address: facing across the target line, target on the left.
  function stanceFor(yaw) {
    const face = yaw + Math.PI / 2;
    const rot = Math.PI - face;
    const o = golfer.addressOffset(club().kind, club().putter);
    const c = Math.cos(rot), s = Math.sin(rot);
    // Once the ball is struck, stay where it was hit rather than following it.
    const b0 = G.shotPhase === 'down' && G.swing.fired && G.shot ? G.shot.start : G.ball.p;
    // The club face rests just behind the ball.
    const ahead = dirFromYaw(yaw), gap = BALL_R + (o.ahead || 0) + 0.004;
    const b = { x: b0.x - ahead.x * gap, z: b0.z - ahead.z * gap };
    // Pushing the club out (set up in the close-up) means standing that much nearer the ball.
    const t = dirFromYaw(face), h = G.setup.head;
    const x = b.x - (o.x * c + o.z * s) + t.x * h, z = b.z - (-o.x * s + o.z * c) + t.z * h;
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
    if (isPutt()) choosePuttRange();
    G.aimYaw = defaultAim();
    G.previewDirty = true;
    G.swing.a = 0;
    refreshShotHud();
    const rec = recommendedClub();
    UI.setHint(rec !== G.clubIndex
      ? `Caddy: “I’d hit the <b>${CLUBS[rec].name}</b> here.” Press <kbd>E</kbd> to step back.`
      : swingHint());
    setFlag(G.lie !== S_GREEN);
    G.view = 0;
    UI.setMode('shot');
    UI.prompt(null);
    Sound.click();
  }

  function leaveShot() {
    if (G.mode !== 'shot') return;
    leaveSetup();
    G.mode = 'walk';
    G.shotPhase = null;
    World.hideGuides();
    UI.setMode('walk');
    G.camYaw = G.aimYaw;
  }

  function swingHint() {
    return matchMedia('(pointer: coarse)').matches
      ? 'Hold <b>Swing</b> to wind up, let go to hit · <b>Setup</b> to check the club'
      : 'Hold <kbd>Space</kbd> to wind up, let go to hit · <kbd>Q</kbd> to check the club';
  }

  // ---------- the bag ----------
  const bagBase = new THREE.Vector3();
  function bagAccessible() {
    if (G.bagWhere === 'cart') return G.mode !== 'cart';
    if (G.bagSpot) return true;
    return !G.cad.riding && G.cad.speed < 0.4;
  }
  function enterBag() {
    // The caddy sets the bag down here and steps back while you choose.
    if (G.bagWhere === 'caddy' && !G.cad.riding && !G.bagSpot) {
      G.bagSpot = { x: bag.root.position.x, y: bag.root.position.y, z: bag.root.position.z, ry: bag.root.rotation.y };
    }
    G.mode = 'bag';
    G.bagHover = -1;
    G.bagExit = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    canvas.style.cursor = 'grab';
    bag.setOut(G.clubIndex);
    bag.setHover(-1);
    const dCart = Math.hypot(cart.st.x - G.player.x, cart.st.z - G.player.z);
    const dCad = Math.hypot(G.cad.x - G.player.x, G.cad.z - G.player.z);
    const mv = UI.$('bagMove');
    if (G.bagWhere === 'caddy' && dCart < 15) { mv.hidden = false; mv.textContent = 'Leave the bag on the cart'; }
    else if (G.bagWhere === 'cart' && dCad < 15) { mv.hidden = false; mv.textContent = 'Give the bag to your caddy'; }
    else mv.hidden = true;
    UI.$('bagSub').innerHTML = matchMedia('(pointer: coarse)').matches
      ? 'Tap a club in the bag.'
      : 'Click a club in the bag, or press <kbd>1</kbd>–<kbd>5</kbd>. <kbd>Esc</kbd> to close.';
    UI.setMode('bag');
    Sound.click();
  }
  function exitBag() {
    if (G.mode !== 'bag') return;
    G.mode = 'walk';
    canvas.style.cursor = '';
    bag.setHover(-1);
    bag.setOut(G.clubIndex);
    UI.show('bagTip', false);
    UI.setMode('walk');
  }
  function selectClub(i) {
    if (G.mode !== 'bag' || G.bagExit > 0 || i < 0 || i >= CLUBS.length) return;
    G.clubIndex = i;
    bag.pull(i);
    G.bagExit = 0.45;
    Sound.clubs();
    UI.toast(`${CLUBS[i].name} in hand`, CLUBS[i].putter ? 'Rolls it along the ground' : `${Math.round(CLUBS[i].carry * TUNE.distance)} yds at full power`, 1800);
    UI.show('bagTip', false);
  }
  function moveBag() {
    G.bagSpot = null;
    if (G.bagWhere === 'caddy') {
      G.bagWhere = 'cart';
      UI.toast('Bag strapped to the cart', 'Walk back to the cart to change clubs', 2400);
    } else {
      G.bagWhere = 'caddy';
      UI.toast('Your caddy has the bag', 'He’ll follow you around the course', 2400);
    }
    exitBag();
  }
  // Raycast the clubs under a screen point.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function clubAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const live = bag.pickables.filter((o) => o.parent && isShown(o));
    let hits = ray.intersectObjects(live.filter((o) => !o.userData.pick), false);
    if (!hits.length) hits = ray.intersectObjects(live.filter((o) => o.userData.pick), false);
    return hits.length ? hits[0].object.userData.clubIndex : -1;
  }
  function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  function hoverBag(i, cx, cy) {
    if (i === G.bagHover && cx === undefined) return;
    G.bagHover = i;
    bag.setHover(i);
    canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    const tip = UI.$('bagTip');
    if (i < 0) { tip.hidden = true; return; }
    const c = CLUBS[i];
    UI.text('bagTipName', `${i + 1} · ${c.name}`);
    UI.text('bagTipDist', c.putter ? 'Putter · rolls only' : `${Math.round(c.carry * TUNE.distance)} yds carry`);
    UI.text('bagTipDesc', c.desc);
    tip.hidden = false;
    if (cx !== undefined) {
      const w = window.innerWidth;
      tip.style.left = Math.min(cx, w - 290) + 'px';
      tip.style.top = cy + 'px';
    } else {
      // Keyboard: park the tip near the top of the bag view.
      tip.style.left = (w2() - 130) + 'px';
      tip.style.top = '18%';
    }
  }
  const w2 = () => window.innerWidth / 2;

  // Where the bag is: on the caddy's back, on the ground beside him, or on the cart.
  function updateBag(dt) {
    const onCart = G.bagWhere === 'cart' || G.cad.riding;
    if (onCart) {
      if (bag.root.parent !== cart.bagMount) { cart.bagMount.add(bag.root); }
      bag.root.position.set(0, 0, 0);
      bag.root.rotation.set(0, 0, 0);
    } else if (G.bagSpot) {
      // Standing on the grass where the caddy left it.
      if (bag.root.parent !== World.scene) World.add(bag.root);
      bag.root.position.set(G.bagSpot.x, G.bagSpot.y, G.bagSpot.z);
      bag.root.rotation.set(0, G.bagSpot.ry, 0);
      bag.root.rotateX(-0.1);
    } else {
      if (bag.root.parent !== World.scene) World.add(bag.root);
      const c = G.cad, f = dirFromYaw(c.yaw), r = rightOf(c.yaw);
      if (c.speed > 0.4) {
        // Slung on his back: base by the left hip, top over the right shoulder.
        bag.root.position.set(c.x - f.x * 0.18 - r.x * 0.2, c.y + 0.28, c.z - f.z * 0.18 - r.z * 0.2);
        bag.root.rotation.set(0, Math.PI - c.yaw, 0);
        bag.root.rotateZ(0.5);
        bag.root.rotateX(-0.2);
      } else {
        const x = c.x + r.x * 0.55 + f.x * 0.2, z = c.z + r.z * 0.55 + f.z * 0.2;
        bag.root.position.set(x, standY(x, z, c.y), z);
        bag.root.rotation.set(0, Math.PI - c.yaw + 0.6, 0);
        bag.root.rotateX(-0.1);
      }
    }
    bag.update(dt);
    bag.root.updateMatrixWorld(true);
    bag.root.getWorldPosition(bagBase);
  }

  // ---------- the caddy ----------
  // ---------- the caddy fetches the cart ----------
  // He sets the bag down beside you and runs off; once he's out of sight the
  // cart is "on its way" (half a minute if it was a long way off), and he
  // turns up driving it in from somewhere you aren't looking.
  const FETCH_NEAR = 30;
  function canFetch() {
    return G.mode === 'walk' && !G.fetch && !G.cad.riding && Math.hypot(cart.st.x - G.player.x, cart.st.z - G.player.z) > FETCH_NEAR;
  }
  function fetchCart() {
    if (G.mode !== 'walk' || G.cad.riding) return;
    if (G.fetch) { UI.toast('Your caddy is already on it', 'The cart is on its way', 1800); return; }
    const d = Math.hypot(cart.st.x - G.player.x, cart.st.z - G.player.z);
    if (d <= FETCH_NEAR) { UI.toast('The cart’s right there', 'Walk over and press E to drive', 1800); return; }
    // Leave the clubs with you.
    if (G.bagWhere === 'caddy' && !G.bagSpot) {
      const P = G.player, r = rightOf(P.yaw), x = P.x + r.x * 1.2, z = P.z + r.z * 1.2;
      G.bagSpot = { x, y: standY(x, z, P.y), z, ry: Math.PI - P.yaw + 0.6 };
    }
    G.fetch = { phase: 'leaving', t: 0, wait: d > 120 ? 30 : clamp(d / 5, 5, 30), from: { x: cart.st.x, z: cart.st.z } };
    UI.toast('“I’ll fetch the cart!”', d > 120 ? 'It’s a long way back: give him half a minute' : 'He won’t be long', 2600);
    Sound.click();
  }
  // Is a point on screen right now?
  function onScreen(x, y, z) {
    const p = project(x, y, z);
    return !p.behind && p.x > -40 && p.x < p.w + 40 && p.y > -40 && p.y < p.h + 40;
  }
  function updateFetch(dt) {
    const f = G.fetch, c = G.cad, P = G.player;
    f.t += dt;
    if (f.phase === 'leaving') {
      // Run off (towards the cart if that's possible, else away from you).
      let dx = f.from.x - c.x, dz = f.from.z - c.z;
      if (Math.hypot(dx, dz) < 5) { dx = c.x - P.x; dz = c.z - P.z; }
      const l = Math.hypot(dx, dz) || 1;
      let mx = dx / l, mz = dz / l, moved = false;
      for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const ca = Math.cos(a), sa = Math.sin(a), vx = mx * ca - mz * sa, vz = mx * sa + mz * ca;
        if (!blockedAt(c.x + vx * 0.6, c.z + vz * 0.6, true)) { mx = vx; mz = vz; moved = true; break; }
      }
      c.speed += ((moved ? TUNE.runSpeed : 0) - c.speed) * (1 - Math.exp(-dt * 6));
      c.x += mx * c.speed * dt; c.z += mz * c.speed * dt;
      c.yaw += wrapAngle(yawFromDir(mx, mz) - c.yaw) * (1 - Math.exp(-dt * 10));
      c.y = standY(c.x, c.z, c.y);
      caddy.root.position.set(c.x, c.y, c.z);
      caddy.root.rotation.set(0, Math.PI - c.yaw, 0);
      caddy.update(dt, { mode: 'walk', speed: c.speed });
      const gone = !onScreen(c.x, c.y + 1, c.z) || Math.hypot(c.x - P.x, c.z - P.z) > 60 || f.t > 12;
      if (gone && f.t > 1) { caddy.setVisible(false); f.phase = 'away'; f.t = 0; }
      return;
    }
    if (f.phase === 'away') {
      if (f.t < f.wait) return;
      const spot = cartArrival();
      if (!spot) { f.t = f.wait - 2; return; } // nowhere out of sight yet: try again shortly
      cart.place(spot.x, spot.z, spot.yaw, spot.y);
      c.driving = true;
      caddy.setVisible(true);
      Object.assign(f, { phase: 'arriving', t: 0, best: Infinity, stall: 0, park: null });
    }
    if (f.phase === 'arriving') {
      // Drive in and pull up a few yards to one side of you.
      const st = cart.st;
      if (!f.park) {
        const ax = P.x - st.x, az = P.z - st.z, al = Math.hypot(ax, az) || 1;
        f.park = { x: P.x - (ax / al) * 3 - (az / al) * 4, z: P.z - (az / al) * 3 + (ax / al) * 4 };
      }
      const dx = f.park.x - st.x, dz = f.park.z - st.z, d = Math.hypot(dx, dz);
      const diff = wrapAngle(yawFromDir(dx, dz) - st.yaw);
      const arrive = d < 3.5 || Math.hypot(P.x - st.x, P.z - st.z) < 4.5;
      cart.update(dt, { throttle: arrive ? 0 : Math.abs(diff) > 1.1 ? 0.35 : d < 14 ? 0.3 : 0.8, steer: clamp(diff * 1.8, -1, 1), brake: arrive });
      if (d < f.best - 0.5) { f.best = d; f.stall = 0; } else f.stall += dt;
      const s = cart.seatPose(caddy.seatScale);
      Object.assign(c, { x: s.x, z: s.z, y: s.y, yaw: s.yaw, speed: 0 });
      caddy.root.position.set(s.x, s.y, s.z);
      caddy.root.rotation.set(0, Math.PI - s.yaw, 0);
      caddy.update(dt, { mode: 'seated' });
      // Pulled up (or stuck on something: he gets out and you walk the last bit).
      if ((arrive && Math.abs(st.speed) < 0.3) || f.stall > 4 || f.t > 40) {
        st.speed = 0;
        const q = cart.exitSpot(false);
        placeCaddy(q.x, q.z, st.yaw, st.y);
        c.driving = false;
        G.fetch = null;
        UI.toast('“Your cart!”', 'Hop in with E', 2200);
      }
    }
  }
  // Somewhere 30-45 yards away, out of sight, clear for the cart and at about
  // your level (not up on a mesa when you're down below), to drive in from.
  function cartArrival() {
    const P = G.player;
    let best = null;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * TAU, r = 32 + (k % 3) * 6;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      if (!course.inBounds(x, z)) continue;
      const y = course.H(x, z);
      if (Math.abs(y - P.y) > 4 || course.waterLevel(x, z) > y - 0.1) continue;
      const yaw = yawFromDir(P.x - x, P.z - z);
      if (!cart.clearAt(x, z, yaw, y)) continue;
      const surf = course.surface(x, z);
      if (surf === S_GREEN || surf === S_SAND || surf === S_ROCK) continue;
      const hidden = !onScreen(x, y + 1, z);
      const score = (hidden ? 0 : 100) + Math.abs(y - P.y) * 3 + (surf === S_PATH ? -2 : 0);
      if (!best || score < best.score) best = { x, z, y, yaw, score };
    }
    return best && best.score < 100 ? best : (G.fetch && G.fetch.t > G.fetch.wait + 8 ? best : null);
  }

  function updateCaddy(dt) {
    const c = G.cad, P = G.player;
    if (G.fetch) { updateFetch(dt); return; }
    if (c.riding) {
      const s = cart.seatPose(caddy.seatScale, true);
      Object.assign(c, { x: s.x, z: s.z, y: s.y, yaw: s.yaw, speed: 0 });
      caddy.root.position.set(s.x, s.y, s.z);
      caddy.root.rotation.set(0, Math.PI - s.yaw, 0);
      caddy.update(dt, { mode: 'seated', passenger: true });
      return;
    }
    // Where to stand: off to the side at address, otherwise a few yards from the player.
    let tx, tz, near;
    const spot = G.bagSpot;
    if (spot && G.mode === 'bag') {
      // Step back from the bag, off to one side, while the player chooses.
      let ux = P.x - spot.x, uz = P.z - spot.z;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul; uz /= ul;
      const side = (c.x - spot.x) * -uz + (c.z - spot.z) * ux >= 0 ? 1 : -1;
      tx = spot.x + ux * 0.6 - uz * side * 1.8; tz = spot.z + uz * 0.6 + ux * side * 1.8;
      near = 0.3;
    } else if (spot) {
      // Go back and pick the bag up.
      tx = spot.x; tz = spot.z;
      near = 0.45;
      if (Math.hypot(c.x - spot.x, c.z - spot.z) < 0.75) G.bagSpot = null;
    } else if (G.mode === 'shot') {
      // Off to the side behind you; online, well back out of everyone's way.
      const b = G.ball.p, d = dirFromYaw(G.aimYaw), r = rightOf(G.aimYaw);
      const back = G.mp ? 8 : 3.4, side = G.mp ? 1.5 : 3.6;
      tx = b.x - d.x * back - r.x * side; tz = b.z - d.z * back - r.z * side;
      near = 0.6;
    } else {
      const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz) || 1;
      tx = P.x + (dx / d) * 3.2; tz = P.z + (dz / d) * 3.2;
      near = d < 4.6 ? Infinity : 0.4;
      if (G.mode === 'bag') near = Infinity;
    }
    const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
    let want = dist > near ? clamp(dist * 1.8, 0, TUNE.runSpeed + 0.5) : 0;
    let mx = 0, mz = 0;
    if (want > 0.05) {
      mx = dx / dist; mz = dz / dist;
      // Step around trees, the clubhouse and the water's edge.
      let ok = false;
      for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        const vx = mx * ca - mz * sa, vz = mx * sa + mz * ca;
        if (!blockedAt(c.x + vx * 0.6, c.z + vz * 0.6, true)) { mx = vx; mz = vz; ok = true; break; }
      }
      if (!ok) { want = 0; c.stuck += dt; } else c.stuck = 0;
    }
    c.speed += (want - c.speed) * (1 - Math.exp(-dt * 8));
    if (c.speed > 0.05 && (mx || mz)) {
      c.x += mx * c.speed * dt; c.z += mz * c.speed * dt;
      c.yaw += wrapAngle(yawFromDir(mx, mz) - c.yaw) * (1 - Math.exp(-dt * 10));
    } else {
      const look = G.mode === 'shot' ? yawFromDir(G.ball.p.x - c.x, G.ball.p.z - c.z) : yawFromDir(P.x - c.x, P.z - c.z);
      c.yaw += wrapAngle(look - c.yaw) * (1 - Math.exp(-dt * 4));
    }
    // Lost behind something, or left far behind: catch up.
    const far = Math.hypot(c.x - P.x, c.z - P.z);
    if (far > 70 || c.stuck > 2.5) {
      const f = dirFromYaw(P.yaw), r = rightOf(P.yaw);
      for (const [b, s] of [[6, -3], [6, 3], [3, -5], [3, 5], [9, 0]]) {
        const x = P.x - f.x * b + r.x * s, z = P.z - f.z * b + r.z * s;
        if (!blockedAt(x, z, true, P.y)) { placeCaddy(x, z, P.yaw, P.y); G.bagSpot = null; break; }
      }
    }
    c.y = standY(c.x, c.z, c.y);
    caddy.root.position.set(c.x, c.y, c.z);
    caddy.root.rotation.set(0, Math.PI - c.yaw, 0);
    caddy.update(dt, { mode: 'walk', speed: c.speed, carry: c.speed > 0.4 && G.bagWhere === 'caddy' && !G.bagSpot });
  }

  // ---------- the swing: hold to wind up, let go to hit ----------
  // How long the backswing takes to reach the top (faster clubs leave less
  // time to judge it). How far back he gets is the power.
  const backswingTime = () => (isPutt() ? 1.6 : TUNE.backswing) / (club().meter || 1);
  const isTouch = () => matchMedia('(pointer: coarse)').matches;

  function swingPress() {
    if (G.mode !== 'shot' || G.shotPhase !== 'aim' || !ballPlayable()) return false;
    if (G.setupView) leaveSetup();
    if (G.previewDirty) computePreview();
    G.shotPhase = 'swing';
    G.swing = { a: 0, top: isPutt() ? 0.5 : 2.5, t: 0, fired: false, finish: 0, putt: isPutt(), p: 0, T: 0, frameAt: performance.now(), held: 0, wobble: 0, wv: 0 };
    UI.setHint(isTouch() ? 'Let go of <b>Swing</b> to hit' : 'Let go of <kbd>Space</kbd> to hit');
    return true;
  }

  // at: when he lets go, in seconds since the backswing began (tests pass it;
  // otherwise it's now, to within a fraction of a frame).
  function swingRelease(at) {
    if (G.mode !== 'shot' || G.shotPhase !== 'swing') return false;
    const s = G.swing;
    if (at === undefined && s.p < 0.03) return cancelSwing(); // just a tap: no swing
    const T = at !== undefined ? at : s.T + clamp((performance.now() - s.frameAt) / 1000, 0, 0.05);
    startDownswing(swingOutcome(T, backswingTime(), s.putt, s.wobble));
    return true;
  }

  function cancelSwing() {
    if (G.mode !== 'shot' || G.shotPhase !== 'swing') return false;
    G.shotPhase = 'aim';
    G.swing.a = 0;
    UI.setHint(swingHint());
    return true;
  }

  // While the button is held he winds up to the top and waits there. Wait
  // too long and he tenses up: the club trembles and the strike wanders.
  function updateBackswing(dt) {
    const s = G.swing, Tf = backswingTime(), limit = TUNE.holdLimit;
    s.T += dt;
    s.frameAt = performance.now();
    s.p = Math.min(1, s.T / Tf);
    s.held = Math.max(0, s.T - Tf);
    if (s.held > limit) {
      const k = Math.min(1, (s.held - limit) / 2);
      s.wv = (s.wv + (Math.random() - 0.5) * 9 * dt * k) * Math.exp(-dt * 1.5);
      s.wobble = clamp(s.wobble + s.wv * dt, -1, 1);
    }
    const tremble = s.held > limit ? Math.sin(G.time * 23) * 0.02 * Math.min(1, s.held - limit) : 0;
    s.a = -s.top * s.p + tremble;
  }

  // How a swing let go T seconds into the backswing comes off (Tf: the time
  // it takes to reach the top). The power is how far back he got; waiting at
  // the top builds a touch more, but wait too long and it drains away. The
  // strike sprays more the harder he goes and the longer he waits, except in
  // the sweet spot: a small window just before the top that nothing on screen
  // shows, with a perfect strike in its middle that flies true. Both add a
  // little power, and each has its own sound. (Putts have no sweet spot.)
  function swingOutcome(T, Tf, putt, wobble = 0) {
    const t = TUNE, windup = clamp(T / Tf, 0, 1), over = Math.max(0, T - Tf);
    let power = windup, spray = 1;
    if (!putt && over > 0) {
      const k = Math.min(1, over / t.holdLimit);
      power += (t.overBoost / 100) * k;
      spray += t.overSpray * k;
      if (over > t.holdLimit) {
        const x = over - t.holdLimit;
        power -= (t.holdDecay / 100) * x;
        spray += 2.5 * x;
      }
    }
    let sweet = false, perfect = false;
    if (!putt) {
      const off = Math.abs(T - (Tf * t.sweetAt) / 100) * 1000; // ms from the middle of the sweet spot
      perfect = off <= t.perfectWidth / 2;
      sweet = !perfect && off <= t.sweetWidth / 2;
      if (perfect) { power *= 1 + t.perfectBoost / 100; spray = 0; }
      else if (sweet) { power *= 1 + t.sweetBoost / 100; spray *= t.sweetSpray; }
    }
    // The golfer's own variation: more on a full swing, and giving it
    // everything sprays it (the last stretch of the backswing adds the most).
    const flat = Math.max(0, (windup - 0.85) / 0.15);
    const base = (0.03 + 0.06 * windup * windup + 0.26 * flat * flat) * spray * t.spray;
    const tri = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
    const e = perfect ? 0 : wobble + tri() * base;
    // Off the sweet spot the strike's distance varies a little too.
    const dist = perfect || putt ? 1 : 1 + tri() * 0.045 * Math.min(1.5, base * 3);
    return { T, windup, power: Math.max(0.03, power), e, dist, sweet, perfect };
  }

  function startDownswing(o) {
    G.shotPhase = 'down';
    G.lastSwing = o; // for tests: nothing on screen shows how it came off
    Object.assign(G.swing, { t: 0, from: -G.swing.top * Math.min(1, o.windup), power: o.power, o, fired: false,
      finish: G.swing.putt ? 0.15 + 0.35 * Math.min(1, o.power) : 2.3 });
    if (!G.swing.putt) Sound.swing(Math.min(1, o.power));
  }

  function updateDownswing(dt) {
    const s = G.swing;
    s.t += dt;
    const D = s.putt ? 0.3 : 0.24, F = s.putt ? 0.4 : 0.5;
    if (s.t < D) {
      const u = s.t / D;
      s.a = s.from * (1 - u * u);
    } else {
      if (!s.fired) { s.fired = true; takeShot(s.o); }
      const u = clamp((s.t - D) / F, 0, 1);
      s.a = s.finish * (1 - (1 - u) * (1 - u));
      if (s.t > D + F + 0.15) {
        G.mode = 'walk';
        G.shotPhase = null;
        G.holdFinish = true;
        G.setup = { face: 0, head: 0 }; // set up afresh for the next shot
        UI.setMode('walk');
        G.camYaw = G.aimYaw;
      }
    }
  }

  function gradeLabel(curl, startDeg, putter) {
    if (putter) {
      if (Math.abs(startDeg) < 0.6) return '<span class="grade good">On line</span>';
      return `<span class="grade">${Math.abs(startDeg) < 2 ? 'Slightly ' : ''}${startDeg < 0 ? 'pulled' : 'pushed'}</span>`;
    }
    const a = Math.abs(curl);
    if (a < 0.12) return '<span class="grade good">Straight</span>';
    if (curl < 0) return `<span class="grade">${a < 0.45 ? 'Draw' : a < 0.8 ? 'Hook' : 'Big hook'}</span>`;
    return `<span class="grade">${a < 0.45 ? 'Fade' : a < 0.8 ? 'Slice' : 'Big slice'}</span>`;
  }

  // A perfect strike's quiet help: if the ball is going to finish near the
  // hole, take some of the miss out of its line and length (never more than
  // 2 degrees or 4% of the distance). Nothing on screen shows it.
  function assistAim(yaw, speed, launch, spin, tilt) {
    const k = TUNE.assist / 100;
    if (k <= 0) return { yaw, speed };
    const b = G.ball.p, pin = hole().pin;
    const sim = createBall(b.x, b.y, b.z);
    launchBall(sim, yaw, speed, launch, spin, tilt);
    for (let i = 0; i < 240 * 40 && (sim.mode === 'flight' || sim.mode === 'roll'); i++) stepBall(sim, G.field, G.wind, DT, null, { noTrees: true });
    if (sim.mode === 'holed') return { yaw, speed };
    const dx = sim.p.x - b.x, dz = sim.p.z - b.z, d = Math.hypot(dx, dz);
    const px = pin.x - b.x, pz = pin.z - b.z, dp = Math.hypot(px, pz);
    const miss = Math.hypot(sim.p.x - pin.x, sim.p.z - pin.z);
    if (d < 5 || miss > Math.max(12, dp * 0.15)) return { yaw, speed };
    const turn = wrapAngle(yawFromDir(px, pz) - yawFromDir(dx, dz));
    return {
      yaw: yaw + clamp(turn * k, -2 * DEG, 2 * DEG),
      speed: speed * (1 + clamp((dp / d - 1) * k * 0.6, -0.04, 0.04)),
    };
  }

  // The setup decides the shape of the shot: an open face starts the ball
  // right and curves it right (closed: left), and a strike off the heel
  // (club pushed out) fades it while one off the toe draws it, through gear
  // effect; off-centre strikes also lose distance. o: how the swing came off
  // (swingOutcome), with e its own wobble.
  function takeShot(o) {
    const { power, e } = o;
    const c = club();
    const b = G.ball;
    const curve = c.curve || 1;
    const faceDeg = (G.setup.face / DEG) * TUNE.faceEffect, off = (G.setup.head / HEAD_MAX) * TUNE.strikeEffect;
    const loss = Math.max(0.5, 1 - 0.13 * Math.pow(Math.abs(off), 1.5));
    const curl = faceDeg / 7 + off * 0.6 + e;
    const startDeg = faceDeg * 0.75 + e * 1.6 * curve;
    G.shot = { start: { x: b.p.x, y: b.p.y, z: b.p.z }, club: c, power, e, putter: !!c.putter, stroke: G.strokes + 1, lie: G.lie };
    G.strokes++;
    UI.setStroke(G.strokes);
    if (c.putter) {
      const putStart = faceDeg * 0.9 + e * 1.4 * curve;
      startRoll(b, G.aimYaw + putStart * DEG, puttSpeedFor(power * G.puttRange) * loss);
      Sound.hit(power, true);
      UI.setHint(`${gradeLabel(0, putStart, true)} · ${Math.round(power * 100)}% of ${G.puttRange * 3} ft`);
    } else {
      const spinMul = spinLieFactor(c, G.lie);
      let speed = speedForCarry(c, power * carryOf(c, G.lie), spinMul) * loss * o.dist;
      if (G.ballState === 'tee') b.p.y += 0.045;
      let yaw = G.aimYaw + startDeg * DEG;
      const launch = c.launch + (G.lie === S_SAND ? 3 : 0), spin = spinFor(c, speed, spinMul), tilt = -curl * 22 * curve;
      if (o.perfect) ({ yaw, speed } = assistAim(yaw, speed, launch, spin, tilt));
      launchBall(b, yaw, speed, launch, spin, tilt);
      Sound.hit(Math.min(1, power), false);
      if (o.perfect) Sound.perfect();
      else if (o.sweet) Sound.sweet();
      UI.setHint(`${gradeLabel(curl, startDeg, false)} · ${Math.round(o.windup * 100)}% power`);
    }
    G.shotYaw = G.aimYaw;
    G.ballState = 'moving';
    World.hideGuides();
    World.trailReset();
    G.trace = [{ x: b.p.x, z: b.p.z }];
    G.acc = 0;
    G.bounceSounds = 0;
    G.ballCam = true;
    G.ballCamTimer = 0;
  }

  // ---------- club setup: a close look at the club head behind the ball ----------
  const HEAD_MAX = 0.045; // yards (about 4 cm either way); the face turns up to TUNE.faceMax
  function enterSetup() {
    if (G.mode !== 'shot' || G.shotPhase !== 'aim' || G.setupView) return false;
    G.setupView = true;
    G.glance = 0;
    World.hideGuides();
    UI.$('hud').classList.add('setup');
    UI.$('setupBtn').textContent = 'Done';
    setupHint();
    Sound.click();
    return true;
  }
  function leaveSetup() {
    if (!G.setupView) return false;
    G.setupView = false;
    G.glance = 0;
    UI.$('hud').classList.remove('setup');
    UI.$('setupBtn').textContent = 'Setup';
    World.setAlignmentStick(null);
    G.previewDirty = true;
    UI.setHint(swingHint());
    return true;
  }
  function setupWords() {
    const f = G.setup.face / DEG, h = G.setup.head;
    const fa = Math.abs(f);
    const face = fa < 0.75 ? 'square' : `${fa < 3 ? 'a touch ' : fa < 7 ? '' : 'well '}${f > 0 ? 'open' : 'closed'}`;
    const ha = Math.abs(h) / HEAD_MAX;
    const hit = ha < 0.15 ? 'the middle of the face' : `${ha < 0.5 ? 'a little towards ' : ''}the ${h > 0 ? 'heel' : 'toe'}`;
    return `Face <b>${face}</b> · ball on <b>${hit}</b>`;
  }
  function setupHint() {
    UI.setHint(setupWords() + (isTouch()
      ? '<br>◀ ▶ turn the face · ▲ ▼ club out or in · hold <b>Look</b> to eye the hole'
      : '<br><kbd>A</kbd> <kbd>D</kbd> turn the face · <kbd>W</kbd> <kbd>S</kbd> club out or in · hold <kbd>R</kbd> to eye the hole · <kbd>Q</kbd> done'));
  }
  function updateSetup(dt) {
    // Looking up at the hole (and back down at the ball) while R is held.
    const look = held('KeyR') || hold.look ? 1 : 0;
    G.glance += (look - G.glance) * (1 - Math.exp(-dt * 6));
    let turn = 0, push = 0;
    if (held('ArrowLeft', 'KeyA') || hold.left) turn -= 1;
    if (held('ArrowRight', 'KeyD') || hold.right) turn += 1;
    if (held('ArrowUp', 'KeyW') || hold.up) push += 1;
    if (held('ArrowDown', 'KeyS') || hold.down) push -= 1;
    if (!turn && !push) return;
    const fine = held('ShiftLeft', 'ShiftRight') ? 0.3 : 1, faceMax = TUNE.faceMax * DEG;
    G.setup.face = clamp(G.setup.face + turn * TUNE.faceSpeed * DEG * fine * dt, -faceMax, faceMax);
    G.setup.head = clamp(G.setup.head + push * (TUNE.headSpeed / 91.44) * fine * dt, -HEAD_MAX, HEAD_MAX);
    setupHint();
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
    setFlag(lie !== S_GREEN);
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
    setFlag(true);
    G.ballCamTimer = 2.4;
    G.cardTimer = 3.4;
    saveProgress();
    sendScore();
  }

  function pickUp() {
    G.scores[G.hole] = MAX_STROKES;
    G.ballState = 'holed';
    UI.banner(`<div class="b-eyebrow">Maximum ${MAX_STROKES} strokes</div><div class="b-title">Picked up</div>`, 'result', 2600);
    UI.setTotal(toPar(), true);
    G.cardTimer = 2.6;
    saveProgress();
    sendScore();
  }

  // afterHole: you've finished the hole and the card leads on to the next.
  // Online, it waits for the others to hole out too (you can watch them, or
  // go on ahead).
  function showCard(afterHole) {
    const last = G.hole >= HOLES.length - 1;
    const done = afterHole && last;
    const wait = afterHole ? stillPlaying(G.hole) : [];
    const opts = {
      title: done ? 'Final round' : afterHole ? `After ${G.hole + 1}` : 'Scorecard',
      next: afterHole ? (done ? (G.mp ? 'Back to the clubhouse' : 'Play again') : wait.length ? 'Go on ahead' : `On to the ${ordinal(G.hole + 2)}`) : null,
      closable: !afterHole || wait.length > 0,
      closeLabel: afterHole && wait.length ? 'Watch' : 'Close',
      leave: !!G.mp && !done,
    };
    if (G.mp) {
      opts.players = cardRows();
      if (wait.length) opts.sub = `Waiting for ${listNames(wait)} to hole out`;
      else if (afterHole && G.mp.players.size > 1) opts.sub = 'Everyone’s in';
    }
    UI.renderCard(HOLES, G.scores, G.hole, opts);
    G.cardAfterHole = afterHole;
    G.cardClosable = opts.closable;
    G.cardWaiting = wait.length > 0;
    openOverlay('card');
    if (done && G.inRound) finishRound();
  }

  function nextFromCard() {
    closeOverlay('card');
    if (!G.cardAfterHole) return;
    G.cardAfterHole = false;
    if (G.hole >= HOLES.length - 1) {
      if (G.mp) backToTitle(); else startRound(0, []);
      return;
    }
    activateHole(G.hole + 1);
    const h = hole();
    UI.toast(`Next: the ${ordinal(G.hole + 1)} tee`, `${Math.round(distTo(h.tee.x, h.tee.z))} yds away · follow the red marker`, 3000);
    saveProgress();
  }

  // ---------- online play ----------
  // Up to three golfers on their own devices (see net.js). Each plays their
  // own ball; everyone sends where they are a few times a second and draws the
  // others from that (remote.js). Scores are swapped as each hole is finished.
  const defaultName = (slot) => `Player ${slot + 1}`;
  const listNames = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const lobby = { char: 0, busy: false, token: 0, nameT: 0 };

  function openLobby() {
    Sound.init();
    const st = store.load();
    lobby.char = clamp(st.character != null ? st.character : 0, 0, CHARACTERS.length - 1);
    UI.$('lbName').value = st.name || '';
    renderLobbyChars();
    lobbyStatus('');
    lobbyView();
    UI.show('title', false);
    UI.show('lobby', true);
  }
  function closeLobby() {
    lobby.token++;
    lobby.busy = false;
    Net.leave();
    UI.show('lobby', false);
    UI.show('title', true);
  }
  function lobbyMe() { return { char: lobby.char, name: Net.cleanName(UI.$('lbName').value) }; }
  function saveMe() {
    const st = store.load();
    st.character = lobby.char;
    st.name = Net.cleanName(UI.$('lbName').value);
    store.save(st);
  }
  // In a game each golfer can be played by one person only.
  function renderLobbyChars() {
    const takenBy = new Map();
    if (Net.active) for (const p of Net.players) if (p.slot !== Net.slot) takenBy.set(p.char, p.name || defaultName(p.slot));
    UI.$('lbChars').innerHTML = CHARACTERS.map((c, i) => {
      const who = takenBy.get(i);
      return `<button class="lb-char${i === lobby.char ? ' on' : ''}${who ? ' taken' : ''}" data-i="${i}"${who ? ' disabled' : ''}>` +
        `<i style="background:${c.colors.ui}"></i><b>${c.name}</b><span>${who ? UI.esc(who) : c.heightLabel}</span></button>`;
    }).join('');
    UI.$('lbChars').querySelectorAll('.lb-char:not(.taken)').forEach((el) => el.addEventListener('click', () => {
      lobby.char = Number(el.dataset.i);
      renderLobbyChars();
      saveMe();
      if (Net.active) Net.setMe(lobbyMe());
      Sound.click();
    }));
  }
  function lobbyStatus(text, bad) {
    const el = UI.$('lbStatus');
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
  }
  // Before connecting: host or join. After: the code and who's in.
  function lobbyView() {
    const inRoom = Net.active;
    UI.show('lbStart', !inRoom);
    UI.show('lbRoom', inRoom);
    UI.show('lbLead', !inRoom); // room for the player list on small screens
    UI.$('lbHost').disabled = UI.$('lbJoin').disabled = lobby.busy;
    if (!inRoom) return;
    UI.text('lbCodeShow', Net.code);
    UI.text('lbCourse', '· ' + courseDef(Net.room.course || DEF.id).name);
    const pl = Net.players.slice().sort((a, b) => a.slot - b.slot);
    // The host may have handed us another golfer if ours was taken.
    const mine = pl.find((p) => p.slot === Net.slot);
    if (mine && mine.char !== lobby.char) { lobby.char = mine.char; saveMe(); }
    renderLobbyChars();
    UI.$('lbPlayers').innerHTML = pl.map((p) => {
      const c = CHARACTERS[p.char] || CHARACTERS[0];
      const who = [p.slot === Net.slot ? 'You' : '', p.slot === 0 ? 'Host' : ''].filter(Boolean).join(' · ');
      return `<li><i style="background:${c.colors.ui}"></i><b>${UI.esc(p.name || defaultName(p.slot))}</b>` +
        `<span>${UI.esc(c.name)}</span>${who ? `<em>${who}</em>` : ''}</li>`;
    }).join('');
    UI.show('lbGo', Net.isHost);
    UI.show('lbWait', !Net.isHost);
    if (Net.isHost) UI.$('lbGo').textContent = pl.length > 1 ? `Tee off · ${pl.length} golfers` : 'Tee off';
  }

  async function hostGame() {
    if (lobby.busy) return;
    saveMe();
    const token = ++lobby.token;
    lobby.busy = true;
    lobbyView();
    lobbyStatus('Setting up a game…');
    try {
      await Net.host(lobbyMe(), { course: DEF.id });
      if (token !== lobby.token) return;
      lobbyStatus('Give your friends the code: they choose Play with friends, type it in and press Join.');
    } catch (e) {
      if (token !== lobby.token) return;
      Net.leave();
      lobbyStatus(String(e), true);
    }
    lobby.busy = false;
    lobbyView();
  }
  async function joinGame() {
    if (lobby.busy) return;
    const code = UI.$('lbCode').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { lobbyStatus('A game code is four letters.', true); return; }
    saveMe();
    const token = ++lobby.token;
    lobby.busy = true;
    lobbyView();
    lobbyStatus('Looking for that game…');
    try {
      await Net.join(code, lobbyMe());
      if (token !== lobby.token) return;
      // The game is on the other course: go there, then join again.
      const there = Net.room.course;
      if (there && there !== DEF.id) {
        lobbyStatus(`That game is on ${courseDef(there).name}. Heading there…`);
        const me = lobbyMe();
        Net.leave();
        setTimeout(() => switchCourse(there, { code, name: me.name, char: me.char }), 600);
        return;
      }
      lobbyStatus('You’re in. The host tees off when everyone’s here.');
    } catch (e) {
      if (token !== lobby.token) return;
      lobbyStatus(String(e), true);
    }
    lobby.busy = false;
    lobbyView();
  }
  function teeOffOnline() {
    if (!Net.isHost || !Net.active) return;
    Net.start(Math.floor(Math.random() * 0x7fffffff));
  }

  // The host said go: everyone heads for the first tee.
  function startMultiplayer(seed) {
    if (G.mp || !Net.active) return;
    const me = Net.slot;
    G.mp = { seed: seed >>> 0, slot: me, name: '', players: new Map(), remotes: new Map(), sendT: 0, listT: 0 };
    for (const p of Net.players) mpPlayer(p.slot, { ch: p.char, nm: p.name });
    G.mp.name = G.mp.players.get(me).name;
    UI.show('lobby', false);
    setCharacter(G.mp.players.get(me).char);
    startRound(0, []);
    UI.show('mpList', true);
    renderMpList();
  }
  // What we know about each golfer in the round (scores outlive their avatar).
  function mpPlayer(s, m) {
    let p = G.mp.players.get(s);
    if (!p) {
      const char = clamp((m && m.ch) | 0, 0, CHARACTERS.length - 1);
      p = { slot: s, name: '', char, color: CHARACTERS[char].colors.ui, scores: [], left: false };
      p.name = (m && Net.cleanName(m.nm)) || defaultName(s);
      G.mp.players.set(s, p);
    }
    return p;
  }
  const validSlot = (s) => Number.isInteger(s) && s >= 0 && s < Net.MAX;

  function onRemoteState(m) {
    if (!G.mp || !validSlot(m.s) || m.s === G.mp.slot || !Array.isArray(m.g) || !Array.isArray(m.c) || !Array.isArray(m.k) || !Array.isArray(m.b)) return;
    const p = mpPlayer(m.s, m);
    if (p.left) return;
    let r = G.mp.remotes.get(m.s);
    if (!r) {
      r = Remote.create(m.s, { char: p.char, name: p.name }, course, UI.$('hud'));
      G.mp.remotes.set(m.s, r);
    }
    r.apply(m);
    p.name = r.name;
  }

  function sendScore() {
    if (!G.mp) return;
    Net.send({ t: 'score', h: G.hole, n: G.scores[G.hole] });
    checkGroupDone();
  }
  function onRemoteScore(m) {
    if (!G.mp || !validSlot(m.s) || m.s === G.mp.slot) return;
    const h = m.h | 0, n = m.n | 0;
    if (h < 0 || h >= HOLES.length || n < 1) return;
    const p = mpPlayer(m.s);
    p.scores[h] = n;
    if (G.mode !== 'title') {
      UI.toast(`${UI.esc(p.name)}: ${n >= MAX_STROKES ? 'Picked up' : scoreName(n, HOLES[h].par)}`, `Hole ${h + 1} · ${n} stroke${n === 1 ? '' : 's'}`, 2600);
    }
    checkGroupDone();
    renderMpList();
  }
  // The others still playing the hole you've finished.
  function stillPlaying(h) {
    if (!G.mp) return [];
    const out = [];
    for (const p of G.mp.players.values()) if (p.slot !== G.mp.slot && !p.left && p.scores[h] == null) out.push(p.name);
    return out;
  }
  // Everyone's holed out: bring the card back to lead on to the next tee.
  function checkGroupDone() {
    if (!G.mp || !G.cardAfterHole || G.cardTimer > 0) return;
    if (UI.isShown('card') && !G.cardWaiting) return;
    if (stillPlaying(G.hole).length) { if (UI.isShown('card')) showCard(true); return; }
    showCard(true);
    Sound.click();
  }
  function cardRows() {
    const rows = [];
    for (const p of [...G.mp.players.values()].sort((a, b) => a.slot - b.slot)) {
      const me = p.slot === G.mp.slot;
      rows.push({ name: me ? G.mp.name || defaultName(p.slot) : p.name, color: p.color, scores: me ? G.scores : p.scores, me, left: p.left });
    }
    return rows;
  }

  function onRemoteLeft(s, quiet) {
    if (!G.mp) return;
    const r = G.mp.remotes.get(s);
    if (r) { r.dispose(); G.mp.remotes.delete(s); }
    const p = G.mp.players.get(s);
    if (p && !p.left) {
      p.left = true;
      if (!quiet) UI.toast(`${UI.esc(p.name)} left the game`, 'You can carry on without them', 2600, true);
    }
    checkGroupDone();
    renderMpList();
  }
  function onHostGone() {
    if (!G.mp) {
      if (UI.isShown('lobby')) { lobby.busy = false; lobbyView(); lobbyStatus('The host closed the game.', true); }
      return;
    }
    for (const p of G.mp.players.values()) if (p.slot !== G.mp.slot) onRemoteLeft(p.slot, true);
    UI.toast('Lost touch with the host', 'The others are gone, but you can finish your round', 3600, true);
  }

  function endMultiplayer() {
    if (!G.mp) return;
    for (const r of G.mp.remotes.values()) r.dispose();
    G.mp = null;
    Net.leave();
    UI.html('mpList', '');
    UI.show('mpList', false);
  }
  // Leave the course for the title screen.
  function backToTitle() {
    leaveSetup();
    endMultiplayer();
    for (const id of ['card', 'map', 'help']) UI.show(id, false);
    UI.hideBanner();
    UI.hideToast();
    if (document.pointerLockElement) document.exitPointerLock();
    Sound.engine(0);
    Object.assign(G, { mode: 'title', shotPhase: null, ballCam: false, holdFinish: false, cardTimer: 0, cardAfterHole: false, pending: null, inRound: false, titleT: 0 });
    World.hideGuides();
    UI.show('hud', false);
    if (golfer) { golfer.root.removeFromParent(); golfer = null; }
    caddy.setVisible(false);
    G.cad.riding = false; G.cad.driving = false; G.fetch = null;
    activateHole(0);
    const cl = course.clubhouse;
    placePlayer(cl.x - 8, cl.z - 18, -0.6);
    cart.place(DEF.cartStart.x, DEF.cartStart.z, (DEF.cartStart.heading || 0) * DEG);
    UI.show('title', true);
  }

  // Where you are and what you're doing, for the others to draw.
  const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
  const POSE_CODE = { walk: 0, address: 1, swing: 2, seated: 3 };
  function snapshot() {
    const c = G.cad, k = cart.st, b = G.ball.p, gr = golfer.root, pose = G.lastPose || { mode: 'walk' };
    const onCart = bag.root.parent === cart.bagMount;
    const bp = bag.root.position, bq = bag.root.quaternion;
    return {
      t: 'st', h: G.hole, ch: G.character, nm: G.mp.name,
      m: G.mode === 'cart' ? 'c' : G.mode === 'shot' ? 's' : G.mode === 'bag' ? 'b' : 'w',
      g: [r2(gr.position.x), r2(gr.position.y), r2(gr.position.z), r3(Math.PI - gr.rotation.y)],
      ps: POSE_CODE[pose.mode] || 0, sp: r2(pose.speed || 0), sw: r3(pose.swing || 0), pu: pose.putt ? 1 : 0,
      cl: G.clubIndex, fa: r3(G.mode === 'shot' ? G.setup.face : 0),
      c: [r2(c.x), r2(c.y), r2(c.z), r3(c.yaw), r2(c.speed)], cr: c.riding ? 1 : 0, cd: c.driving ? 1 : 0, cv: caddy.root.visible ? 1 : 0,
      cc: !c.riding && c.speed > 0.4 && G.bagWhere === 'caddy' && !G.bagSpot ? 1 : 0,
      k: [r2(k.x), r2(k.y), r2(k.z), r3(k.yaw), r3(k.steer), r3(k.pitch), r3(k.roll)], ks: r2(k.speed),
      bg: onCart ? 0 : [r2(bp.x), r2(bp.y), r2(bp.z), r3(bq.x), r3(bq.y), r3(bq.z), r3(bq.w)], bo: G.clubIndex,
      b: [r2(b.x), r3(b.y), r2(b.z)], bs: G.ballState, bm: G.ball.mode === 'holed' ? 1 : 0, n: G.strokes,
      pw: G.shot ? r2(G.shot.power) : 0,
    };
  }
  function updateOnline(dt) {
    const mp = G.mp;
    if (!mp) return;
    if (Net.active && golfer) {
      mp.sendT -= dt;
      if (mp.sendT <= 0) {
        const busy = G.ballState === 'moving' || G.mode === 'cart' || G.shotPhase === 'swing' || G.shotPhase === 'down';
        mp.sendT = busy ? 0.05 : 0.1;
        Net.send(snapshot());
      }
    }
    const show = (G.mode === 'walk' || G.mode === 'cart' || G.mode === 'shot') && !overlayOpen() && !G.setupView;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const clear = G.mode === 'shot' && !G.ballCam;
    for (const r of mp.remotes.values()) r.update(dt, camera, show, w, h, clear);
    mp.listT -= dt;
    if (mp.listT <= 0) { mp.listT = 0.5; renderMpList(); }
  }
  // Under the hole plate: where the others are.
  function renderMpList() {
    if (!G.mp) return;
    const rows = [];
    for (const p of [...G.mp.players.values()].sort((a, b) => a.slot - b.slot)) {
      if (p.slot === G.mp.slot) continue;
      const r = G.mp.remotes.get(p.slot);
      let what;
      if (p.left) what = 'left';
      else if (!r || !r.have) what = 'on the way';
      else if (p.scores[r.hole] != null) what = `Hole ${r.hole + 1} · in ${p.scores[r.hole]}`;
      else what = `Hole ${r.hole + 1} · ${r.ballState === 'tee' && !r.strokes ? 'on the tee' : `${r.strokes} played`}`;
      rows.push(`<li class="${p.left ? 'gone' : ''}"><i style="background:${p.color}"></i><b>${UI.esc(p.name)}</b><span>${what}</span></li>`);
    }
    UI.html('mpList', rows.join(''));
  }

  // ---------- the cart ----------
  function enterCart() {
    // Climbing in while the caddy drives it over: he shifts across.
    if (G.fetch) { G.fetch = null; G.cad.driving = false; caddy.setVisible(true); }
    G.mode = 'cart';
    G.holdFinish = false;
    G.cartLook = 0;
    G.cad.riding = true; // the caddy hops in the passenger seat
    G.bagSpot = null;
    UI.setMode('cart');
    Sound.click();
  }
  function exitCart() {
    const p = cart.exitSpot();
    cart.st.speed = 0;
    placePlayer(p.x, p.z, cart.st.yaw, cart.st.y);
    G.camYaw = cart.st.yaw + G.cartLook;
    const q = cart.exitSpot(true);
    placeCaddy(q.x, q.z, cart.st.yaw, cart.st.y);
    G.mode = 'walk';
    UI.setMode('walk');
    Sound.engine(0);
  }

  // ---------- walking ----------
  const keys = new Set();
  const hold = { left: false, right: false, up: false, down: false, look: false };
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

  // Can a person stand here? (`isCaddy`: the caddy ignores the player and the bag.)
  // y: the height of whoever is moving (for bridges and tunnels).
  function blockedAt(x, z, isCaddy, y) {
    if (!course.inBounds(x, z)) return true;
    const yRef = y == null ? (isCaddy ? G.cad.y : G.player.y) : y;
    const gy = standY(x, z, yRef);
    if (course.waterLevel(x, z) > gy + 0.25) return true;
    // A sudden drop or wall: the edge of a bridge, the side of a tunnel.
    if (Math.abs(gy - yRef) > 0.9) return true;
    const trees = course.nearTrees(x, z);
    if (trees) for (const t of trees) if (Math.hypot(x - t.x, z - t.z) < t.trunkR + 0.28) return true;
    for (const o of course.obstacles) if (Math.abs(x - o.x) < o.hx + 0.3 && Math.abs(z - o.z) < o.hz + 0.3) return true;
    const c = cart.st, f = { x: Math.sin(c.yaw), z: -Math.cos(c.yaw) };
    const dx = x - c.x, dz = z - c.z;
    const along = dx * f.x + dz * f.z, side = dx * -f.z + dz * f.x;
    if (Math.abs(along) < 1.45 && Math.abs(side) < 0.8) return true;
    if (!isCaddy && !G.cad.riding && caddy.root.visible && Math.hypot(x - G.cad.x, z - G.cad.z) < 0.45) return true;
    return false;
  }

  // Online: the others and their carts. Only stepping into them is blocked,
  // so nobody gets stuck if one of them walks or drives into you.
  function othersAt(x, z) {
    if (!G.mp) return false;
    for (const r of G.mp.remotes.values()) {
      if (!r.have) continue;
      const g = r.golfer.root.position;
      if (r.msg.m !== 'c' && Math.hypot(x - g.x, z - g.z) < 0.5) return true;
      const c = r.cart.st, fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw), dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx * fx + dz * fz) < 1.45 && Math.abs(dx * -fz + dz * fx) < 0.8) return true;
    }
    return false;
  }

  function updateWalk(dt) {
    const P = G.player;
    const inp = moveInput();
    if (inp.m > 0.05) { G.holdFinish = false; G.ballCam = false; }
    const run = held('ShiftLeft', 'ShiftRight') || (joy.active && inp.m > 0.92);
    let target = inp.m * (run ? TUNE.runSpeed : TUNE.walkSpeed);
    const surf = course.surface(P.x, P.z);
    // Sand and deep rough hold him up, and steep ground is a scramble (a ramp
    // or a bridge is quicker), as much as the terrain setting says.
    const tw = TUNE.terrainWalk;
    if (surf === S_SAND) target *= 1 - 0.4 * tw;
    else if (surf === S_DEEP) target *= 1 - 0.15 * tw;
    const n = course.floorInfo(P.x, P.z, P.y + 0.6).kind ? null : course.normal(P.x, P.z);
    if (n && n.y < 0.85) target *= 1 - (1 - clamp(1 - (0.85 - n.y) * 2.4, 0.22, 1)) * Math.min(1, tw);
    target = Math.max(0, target);
    const yaw = G.camYaw;
    const fw = dirFromYaw(yaw), rt = rightOf(yaw);
    let mx = fw.x * inp.f + rt.x * inp.r, mz = fw.z * inp.f + rt.z * inp.r;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) { mx /= ml; mz /= ml; }
    const k = 1 - Math.exp(-dt * 10);
    P.vx += (mx * target - P.vx) * k;
    P.vz += (mz * target - P.vz) * k;
    const nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    const inOthers = othersAt(P.x, P.z);
    const stop = (x, z) => blockedAt(x, z) || (!inOthers && othersAt(x, z));
    if (!stop(nx, nz)) { P.x = nx; P.z = nz; }
    else if (!stop(nx, P.z)) { P.x = nx; P.vz *= 0.5; }
    else if (!stop(P.x, nz)) { P.z = nz; P.vx *= 0.5; }
    else { P.vx = P.vz = 0; }
    P.speed = Math.hypot(P.vx, P.vz);
    if (P.speed > 0.3) {
      const want = yawFromDir(P.vx, P.vz);
      P.yaw += wrapAngle(want - P.yaw) * (1 - Math.exp(-dt * 12));
    }
    P.y = standY(P.x, P.z, P.y);
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
    const s = cart.seatPose(golfer.seatScale);
    Object.assign(G.player, { x: s.x, z: s.z, y: s.y, yaw: s.yaw, vx: 0, vz: 0, speed: 0 });
    Sound.engine(Math.abs(cart.st.speed) / 13);
    if (G.time - G.lastMouse > 1.2) G.cartLook *= Math.exp(-dt * 1.8);
    if (inp.m > 0.05 && G.ballCam) G.ballCam = false;
  }

  // ---------- camera ----------
  const V3 = THREE.Vector3;
  const cam = { pos: new V3(0, 30, 60), look: new V3(0, 0, 0), tPos: new V3(), tLook: new V3() };
  const focus = new V3();

  const _eye = new THREE.Vector3();
  const _gA = new V3(), _gB = new V3();
  function shotPose(outPos, outLook) {
    const b = G.ball.p, d = dirFromYaw(G.aimYaw), r = rightOf(G.aimYaw);
    const putt = isPutt();
    const s = gScale();
    if (G.setupView) {
      // Through the golfer's own eyes, looking down at the club behind the
      // ball, the target off to the left: the face against the alignment
      // stick, and where on the face the ball sits.
      // (Leaning in along that line, so the ball and club head fill the view.)
      golfer.joints.head.getWorldPosition(_eye);
      _eye.x += r.x * 0.1; _eye.y += 0.04; _eye.z += r.z * 0.1;
      outPos.set(b.x + (_eye.x - b.x) * 0.55, b.y + (_eye.y - b.y) * 0.55, b.z + (_eye.z - b.z) * 0.55);
      outLook.set(b.x - r.x * 0.05, b.y, b.z - r.z * 0.05);
      // Holding R he looks up the line to the hole, the way golfers do: the
      // head comes back from leaning over the ball and turns to the target.
      const g = G.glance * G.glance * (3 - 2 * G.glance);
      if (g > 0.001) {
        const pin = hole().pin;
        _gA.subVectors(outLook, outPos).normalize();
        _gB.set(pin.x - _eye.x, pin.y + 1.2 - _eye.y, pin.z - _eye.z).normalize();
        outPos.lerp(_eye, g);
        _gA.lerp(_gB, g).normalize();
        outLook.copy(outPos).addScaledVector(_gA, 10);
      }
      // (No alignment stick or face line for a putt.)
      World.setAlignmentStick(isPutt() ? null : { x: b.x + r.x * 0.28, z: b.z + r.z * 0.28, yaw: G.aimYaw, face: golfer.faceInfo() });
      return;
    }
    if (G.fp) {
      const st = stanceFor(G.aimYaw);
      const gy = standY(st.x, st.z, G.ball.p.y);
      outPos.set(st.x - d.x * 0.15, gy + (putt ? 1.45 : 1.58) * s, st.z - d.z * 0.15);
      const ahead = putt ? clamp(distToPin(), 3, 14) : 45;
      outLook.set(b.x + d.x * ahead, b.y + (putt ? -0.4 : 2), b.z + d.z * ahead);
      return;
    }
    if (G.view === 0) {
      // Behind the ball and off to the right of the line, so the golfer
      // (who stands on the left) never hides the target.
      const back = putt ? 3.0 : 5.4, side = putt ? 1.0 : 1.35, up = (putt ? 1.25 : 1.9) * (0.75 + 0.25 * s);
      outPos.set(b.x - d.x * back + r.x * side, b.y + up, b.z - d.z * back + r.z * side);
      const ahead = putt ? clamp(distToPin(), 2.5, 10) : 32;
      const t = putt ? Math.min(1, ahead / Math.max(distToPin(), 0.1)) : 1;
      const lx = b.x + d.x * ahead, lz = b.z + d.z * ahead;
      outLook.set(lx + r.x * side * 0.25, (putt ? course.H(lx, lz) * t + b.y * (1 - t) : b.y + 1.6), lz + r.z * side * 0.25);
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

  // Close-up looking down into the mouth of the bag, from where the player
  // stands (or from behind the cart when it's strapped on there).
  const _bt = new V3();
  function bagPose(outPos, outLook) {
    bag.root.updateMatrixWorld(true);
    bag.root.localToWorld(_bt.set(0, BAG_TOP, 0));
    let ux, uz;
    if (bag.root.parent === cart.bagMount) { ux = _bt.x - cart.st.x; uz = _bt.z - cart.st.z; }
    else { ux = G.player.x - _bt.x; uz = G.player.z - _bt.z; }
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    outPos.set(_bt.x + ux * 0.8, _bt.y + 0.62, _bt.z + uz * 0.8);
    outLook.set(_bt.x, _bt.y + 0.1, _bt.z);
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
    const P = G.player, b = G.ball.p, s = gScale();
    if (G.mode === 'title') {
      G.titleT = (G.titleT || 0) + dt / 70;
      titlePose(G.titleT, cam.tPos, cam.tLook);
      rate = lookRate = 40;
    } else if (G.mode === 'select') {
      updateLineup(dt);
      rate = lookRate = 4;
    } else if (G.mode === 'bag') {
      bagPose(cam.tPos, cam.tLook);
      rate = lookRate = 7;
    } else if (G.ballCam) {
      const sh = G.shot, d = dirFromYaw(G.shotYaw);
      if (G.ballState === 'moving' || G.ballState === 'gone') {
        if (sh.putter) cam.tPos.set(b.x - d.x * 3.2, b.y + 1.3, b.z - d.z * 3.2);
        else {
          const dist = Math.hypot(b.x - sh.start.x, b.z - sh.start.z);
          const back = 9 + Math.min(dist * 0.03, 8);
          // Low behind it inside a tunnel, otherwise up and back.
          const inside = course.floorInfo(b.x, b.z, b.y).kind === 2;
          cam.tPos.set(b.x - d.x * back, Math.max(b.y, course.H(b.x, b.z)) + 3.5 + Math.min(dist * 0.02, 6), b.z - d.z * back);
          if (inside) cam.tPos.y = b.y + 1.2;
        }
        rate = sh.putter ? 1.6 : 1.3;
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
      const d = dirFromYaw(yaw);
      if (G.fp) {
        const e = cart.eyePose(golfer.eyeScale);
        cam.tPos.set(e.x, e.y, e.z);
        cam.tLook.set(e.x + d.x * 10, e.y - 0.8 - G.camPitch * 4, e.z + d.z * 10);
        rate = lookRate = 60;
      } else {
        cam.tPos.set(cart.st.x - d.x * 7.2, cart.st.y + 3.0, cart.st.z - d.z * 7.2);
        cam.tLook.set(cart.st.x + d.x * 4, cart.st.y + 1.2, cart.st.z + d.z * 4);
        rate = 6; lookRate = 10;
      }
    } else {
      const cp = Math.cos(G.camPitch), sp = Math.sin(G.camPitch);
      const d = dirFromYaw(G.camYaw);
      if (G.fp) {
        cam.tPos.set(P.x + d.x * 0.12, P.y + 1.66 * s, P.z + d.z * 0.12);
        cam.tLook.set(cam.tPos.x + d.x * cp * 10, cam.tPos.y - sp * 10, cam.tPos.z + d.z * cp * 10);
        rate = lookRate = 60;
      } else {
        // Over the right shoulder, so the golfer sits left of centre and
        // the way ahead stays clear.
        const r = rightOf(G.camYaw);
        const dist = G.camDist * (0.7 + 0.3 * s);
        const tx = P.x + r.x * 0.6, ty = P.y + 1.5 * s + 0.1, tz = P.z + r.z * 0.6;
        cam.tPos.set(tx - d.x * cp * dist, ty + sp * dist, tz - d.z * cp * dist);
        cam.tLook.set(tx, ty, tz);
        rate = 18; lookRate = 40;
      }
    }
    if (G.camHold) { // for tests: { pos, look } in world space
      cam.tPos.copy(G.camHold.pos); cam.tLook.copy(G.camHold.look);
      rate = lookRate = 60;
    }
    const kp = 1 - Math.exp(-dt * rate), kl = 1 - Math.exp(-dt * lookRate);
    cam.pos.lerp(cam.tPos, kp);
    cam.look.lerp(cam.tLook, kl);
    const gh = course.floor(cam.pos.x, cam.pos.z, cam.pos.y);
    if (cam.pos.y < gh + 0.35) cam.pos.y = gh + 0.35;
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    if (G.ballCam) focus.set(b.x, b.y, b.z);
    else if (G.mode === 'select') focus.copy(cam.look);
    else focus.set(P.x, P.y, P.z).lerp(cam.pos, 0.2);
  }

  // ---------- golfer animation ----------
  function updateGolfer(dt) {
    if (!golfer) return;
    const P = G.player;
    let pose;
    if (G.mode === 'cart') {
      const s = cart.seatPose(golfer.seatScale);
      golfer.root.position.set(s.x, s.y, s.z);
      golfer.root.rotation.set(0, Math.PI - s.yaw, 0);
      pose = { mode: 'seated' };
    } else if (G.mode === 'shot') {
      const st = stanceFor(G.aimYaw);
      Object.assign(P, { x: st.x, z: st.z, y: standY(st.x, st.z, G.ball.p.y), yaw: st.face, vx: 0, vz: 0, speed: 0 });
      golfer.root.position.set(st.x, P.y, st.z);
      golfer.root.rotation.set(0, Math.PI - st.face, 0);
      pose = G.shotPhase === 'aim' ? { mode: 'address', putt: isPutt(), club: club().kind } : { mode: 'swing', putt: G.swing.putt, club: club().kind, swing: G.swing.a };
    } else {
      if (G.mode === 'bag') P.yaw += wrapAngle(yawFromDir(bagBase.x - P.x, bagBase.z - P.z) - P.yaw) * (1 - Math.exp(-dt * 8));
      golfer.root.position.set(P.x, P.y, P.z);
      golfer.root.rotation.set(0, Math.PI - P.yaw, 0);
      pose = G.holdFinish ? { mode: 'swing', putt: G.swing.putt, swing: G.swing.a, club: club().kind } : { mode: 'walk', speed: P.speed, club: club().kind };
    }
    golfer.setFace(G.mode === 'shot' ? G.setup.face : 0);
    golfer.update(dt, pose);
    golfer.setBodyVisible(!(G.setupView && G.mode === 'shot'));
    G.lastPose = pose;
    // Hidden in first person, and when the bag close-up camera is right where he stands.
    const camInside = G.mode === 'bag' && Math.hypot(camera.position.x - P.x, camera.position.z - P.z) < 0.75 * golfer.scale;
    golfer.setVisible(!(G.fp && G.mode !== 'title' && G.mode !== 'bag' && !G.ballCam) && !camInside);
  }

  // ---------- HUD: prompts, markers, radar ----------
  const proj = new V3();
  function project(x, y, z) {
    proj.set(x, y, z).project(camera);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return { x: (proj.x * 0.5 + 0.5) * w, y: (-proj.y * 0.5 + 0.5) * h, behind: proj.z > 1, w, h };
  }

  function nearest() {
    if (G.mode !== 'walk') return null;
    const opts = [];
    if (ballPlayable() && !G.cardTimer) opts.push(['ball', distTo(G.ball.p.x, G.ball.p.z), REACH]);
    if (bagAccessible()) opts.push(['bag', distTo(bagBase.x, bagBase.z), BAG_REACH]);
    if (!G.fetch || G.fetch.phase === 'arriving') opts.push(['cart', distTo(cart.st.x, cart.st.z), REACH]);
    let best = null, bd = Infinity;
    for (const [k, d, r] of opts) if (d <= r && d < bd) { best = k; bd = d; }
    return best;
  }

  function updateHud() {
    const P = G.player, h = hole(), b = G.ball.p;
    const touch = matchMedia('(pointer: coarse)').matches;
    let act = null;
    if (G.mode === 'walk' && !G.ballCam) {
      const n = nearest();
      if (n === 'ball') act = G.ballState === 'tee' ? 'Tee off' : 'Play shot';
      else if (n === 'bag') act = 'Clubs';
      else if (n === 'cart') act = 'Drive';
    } else if (G.mode === 'cart') act = 'Get out';
    const label = { 'Drive': 'Drive the cart', 'Get out': 'Get out of the cart', 'Tee off': 'Tee off', 'Play shot': 'Play your shot', 'Clubs': 'Choose a club' }[act];
    UI.prompt(act && !touch ? `<kbd>E</kbd>${label}` : null);
    UI.setActionLabel(act);
    UI.$('hud').classList.toggle('fp', G.fp);
    const fb = canFetch() && Math.hypot(cart.st.x - P.x, cart.st.z - P.z) > 60;
    if (UI.$('fetchBtn').hidden === fb) UI.$('fetchBtn').hidden = !fb;
    UI.text('inHandClub', club().name);

    if (G.ballState === 'tee') UI.objective(`Hole ${G.hole + 1} tee · <b>${Math.round(distTo(h.tee.x, h.tee.z))} yds</b>`);
    else if (G.ballState === 'rest') UI.objective(`Your ball · <b>${Math.round(distTo(b.x, b.z))} yds</b> · ${SURFACES[course.surface(b.x, b.z)].name}`);
    else if (G.ballState === 'moving') UI.objective('Ball in play…');
    else if (G.ballState === 'holed') UI.objective('Holed');
    else UI.objective('');

    const inShot = G.mode === 'shot', inBag = G.mode === 'bag';
    const pinTop = project(h.pin.x, h.pin.y + (G.flagIn === false ? 0.3 : 2.7), h.pin.z);
    const ballLie = G.ballState === 'rest' ? course.surface(b.x, b.z) : -1;
    const onGreen = ballLie === S_GREEN || ballLie === S_FRINGE;
    const pinVis = !inBag && G.ballState !== 'holed' && !(G.ballState === 'tee' && distTo(h.tee.x, h.tee.z) > 60) && (!pinTop.behind || inShot);
    const ballFar = distTo(b.x, b.z);
    const bm = project(b.x, b.y + 0.4, b.z);
    const ballVis = G.ballState === 'rest' && !inShot && !inBag && !G.ballCam && ballFar > 5;
    // Keep the pin's label from sitting on top of the ball's.
    let pinY = pinTop.y;
    if (ballVis && !bm.behind && !pinTop.behind && Math.abs(pinTop.x - bm.x) < 110 && Math.abs(pinY - bm.y) < 30) pinY = Math.min(pinY, bm.y - 30);
    UI.marker('pinMarker', pinTop.x, pinY, pinTop.behind, pinVis && !(pinTop.behind && inShot), fmtDist(distToPin(), onGreen), pinTop.w, pinTop.h);
    UI.marker('ballMarker', bm.x, bm.y, bm.behind, ballVis, `Ball · ${Math.round(ballFar)}y`, bm.w, bm.h);
    const tm = project(h.tee.x, h.tee.y + 1.2, h.tee.z);
    const teeFar = distTo(h.tee.x, h.tee.z);
    UI.marker('goalMarker', tm.x, tm.y, tm.behind, G.ballState === 'tee' && !inShot && !inBag && teeFar > 6, `Hole ${G.hole + 1} tee · ${Math.round(teeFar)}y`, tm.w, tm.h);

    const camYaw = yawFromDir(cam.look.x - cam.pos.x, cam.look.z - cam.pos.z);

    const items = [{ kind: 'pin', x: h.pin.x, z: h.pin.z }, { kind: 'cart', x: cart.st.x, z: cart.st.z, ang: cart.st.yaw }];
    if (G.ballState === 'tee') items.push({ kind: 'tee', x: h.tee.x, z: h.tee.z });
    if (G.ballState !== 'holed' && G.ballState !== 'gone') items.push({ kind: 'ball', x: b.x, z: b.z });
    if (!G.cad.riding) items.push({ kind: 'caddy', x: G.cad.x, z: G.cad.z });
    if (G.mp) {
      // The others, and their balls on this hole.
      for (const r of G.mp.remotes.values()) {
        if (!r.have) continue;
        if (r.hole === G.hole && (r.ballState === 'tee' || r.ballState === 'rest' || r.ballState === 'moving')) items.push({ kind: 'fball', x: r.b[0], z: r.b[2], color: r.color });
        const gp = r.golfer.root.position;
        items.push({ kind: 'friend', x: gp.x, z: gp.z, ang: r.msg.m === 'c' ? r.cart.st.yaw : r.g[3], color: r.color });
      }
    }
    // The radar shows which way you're aiming, not how far it will go.
    const ad = dirFromYaw(G.aimYaw);
    const aim = inShot ? { fx: b.x, fz: b.z, x: b.x + ad.x * 90, z: b.z + ad.z * 90 } : null;
    UI.drawRadar({ px: P.x, pz: P.z, yaw: camYaw, heading: G.mode === 'cart' ? cart.st.yaw : P.yaw, items, aim });
    G.radarItems = items;

    if (G.ballState === 'tee' && !G.introShown && teeFar < 32) {
      G.introShown = true;
      UI.banner(
        `<div class="b-eyebrow">Hole ${G.hole + 1} of ${HOLES.length}</div><div class="b-title">${h.name}</div>` +
          `<div class="b-meta">Par ${h.par} · ${h.yards} yds</div>`, '', 3600);
    }
  }

  // ---------- overlays ----------
  function openOverlay(id) {
    if (document.pointerLockElement) document.exitPointerLock();
    UI.show(id, true);
    if (id === 'map') drawMap();
  }
  function closeOverlay(id) { UI.show(id, false); }
  const overlayOpen = () => UI.isShown('help') || UI.isShown('card') || UI.isShown('map') || UI.isShown('title') || UI.isShown('lobby') || UI.isShown('glError');
  function drawMap() {
    const P = G.player;
    UI.drawMap({ holes: HOLES, active: G.hole, scores: G.scores, px: P.x, pz: P.z, heading: G.mode === 'cart' ? cart.st.yaw : P.yaw, items: G.radarItems || [] });
  }

  function openWorkshop() {
    G.mode = 'workshop';
    UI.show('title', false);
    Workshop.open(World.renderer, (changed) => {
      if (changed) {
        UI.setLoading(true, 'Applying your assets…');
        setTimeout(() => location.reload(), 60);
        return;
      }
      G.mode = 'title';
      UI.show('title', true);
    });
  }

  // ---------- input ----------
  function interact() {
    if (G.mode === 'shot') { if (G.shotPhase === 'aim') leaveShot(); return; }
    if (G.mode === 'cart') { exitCart(); return; }
    if (G.mode === 'bag') { exitBag(); return; }
    if (G.mode !== 'walk') return;
    if (G.ballCam && G.ballState !== 'moving') G.ballCam = false;
    const n = nearest();
    if (n === 'ball') enterShot();
    else if (n === 'bag') enterBag();
    else if (n === 'cart') enterCart();
  }

  function toggleFP() {
    G.fp = !G.fp;
    if (G.fp) G.camPitch = clamp(G.camPitch, -0.6, 0.9);
  }

  window.addEventListener('keydown', (e) => {
    const k = e.code;
    // Typing in a text box (a name, a game code) isn't playing.
    const tag = e.target && e.target.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && k !== 'Escape') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    if (keys.has(k)) return;
    keys.add(k);
    if (G.mode === 'workshop') return;
    if (UI.isShown('lobby')) { if (k === 'Escape') closeLobby(); return; }
    if (k === 'Escape') {
      if (UI.isShown('help')) return closeOverlay('help');
      if (UI.isShown('map')) return closeOverlay('map');
      if (UI.isShown('card') && G.cardClosable) return closeOverlay('card');
      if (G.mode === 'select') return backFromSelect();
      if (G.mode === 'bag') return exitBag();
      if (cancelSwing()) return;
      if (leaveSetup()) return;
      if (G.mode === 'shot' && G.shotPhase === 'aim') return leaveShot();
      return;
    }
    if (UI.isShown('help')) { if (k === 'Enter' || k === 'Space') closeOverlay('help'); return; }
    if (G.mode === 'select') {
      if (k === 'ArrowLeft' || k === 'KeyA') chooseSelect(G.select.index - 1);
      else if (k === 'ArrowRight' || k === 'KeyD') chooseSelect(G.select.index + 1);
      else if (k === 'Enter' || k === 'Space') confirmSelect();
      return;
    }
    if (UI.isShown('title')) { if (k === 'Enter') onStart(); return; }
    if (UI.isShown('map')) { if (k === 'KeyM' || k === 'Enter') closeOverlay('map'); return; }
    if (UI.isShown('card')) {
      // Going on ahead of the others takes a click on the button.
      if (G.cardAfterHole && !G.cardWaiting && (k === 'Enter' || k === 'Space')) nextFromCard();
      else if (k === 'KeyC' && G.cardClosable) closeOverlay('card');
      return;
    }
    if (G.mode === 'bag') {
      if (/^Digit[1-5]$/.test(k)) selectClub(Number(k.slice(5)) - 1);
      else if (k === 'ArrowLeft' || k === 'KeyA') hoverBag(((G.bagHover < 0 ? 0 : G.bagHover) - 1 + CLUBS.length) % CLUBS.length);
      else if (k === 'ArrowRight' || k === 'KeyD') hoverBag((G.bagHover + 1) % CLUBS.length);
      else if ((k === 'Enter' || k === 'Space') && G.bagHover >= 0) selectClub(G.bagHover);
      else if (k === 'KeyE' || k === 'KeyF') exitBag();
      return;
    }
    const shot = G.mode === 'shot';
    if (k === 'Space') {
      if (shot && G.shotPhase === 'down') G.ff = true;
      else if (shot && G.setupView) leaveSetup();
      else if (shot) swingPress();
      else if (G.ballCam && G.ballState === 'moving') G.ff = true;
      else if (G.mode === 'walk') interact();
    } else if (k === 'KeyE' || k === 'Enter' || k === 'KeyF') {
      if (!(shot && G.shotPhase !== 'aim')) interact();
    } else if (k === 'KeyQ') {
      if (shot && G.shotPhase === 'aim') { if (!leaveSetup()) enterSetup(); }
    } else if (k === 'KeyV') toggleFP();
    else if (k === 'KeyT') { if (shot) G.view = (G.view + 1) % 3; }
    else if (k === 'KeyC') showCard(!!G.cardAfterHole);
    else if (k === 'KeyM') openOverlay('map');
    else if (k === 'KeyN') toggleMute();
    else if (k === 'KeyG') fetchCart();
    else if (k === 'KeyH' || k === 'Slash') openOverlay('help');
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') { G.ff = false; swingRelease(); }
  });
  window.addEventListener('blur', () => { keys.clear(); G.ff = false; hold.left = hold.right = hold.up = hold.down = hold.look = false; cancelSwing(); });

  // Mouse look (pointer lock on desktop, drag as a fallback and on touch).
  function applyLook(dx, dy, touch) {
    G.lastMouse = G.time;
    const s = touch ? 0.006 : 0.0024;
    if (G.mode === 'shot') {
      if (G.shotPhase === 'aim' && !G.setupView) {
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
    if (G.mode !== 'walk') return;
    G.camYaw = wrapAngle(G.camYaw + dx * s);
    G.camPitch = clamp(G.camPitch + dy * s, G.fp ? -1.2 : -0.35, G.fp ? 1.3 : 1.25);
  }
  document.addEventListener('pointerlockchange', () => { G.locked = document.pointerLockElement === canvas; });
  document.addEventListener('mousemove', (e) => { if (G.locked) applyLook(e.movementX, e.movementY, false); });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (G.mode === 'title' || G.mode === 'workshop') return;
    if (G.mode === 'select') {
      // Click a golfer to pick them.
      const shown = G.select.shown || CHARACTERS.map((_, k) => k);
      const w = canvas.clientWidth, i = shown[clamp(Math.floor((e.clientX / w) * shown.length), 0, shown.length - 1)];
      if (i === G.select.index) confirmSelect(); else chooseSelect(i);
      return;
    }
    if (G.mode === 'bag') {
      const i = clubAt(e.clientX, e.clientY);
      if (i >= 0) selectClub(i);
      return;
    }
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
    if (G.mode === 'bag') { hoverBag(clubAt(e.clientX, e.clientY), e.clientX, e.clientY); return; }
    if (!drag || drag.id !== e.pointerId || G.locked) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    applyLook(dx, dy, drag.touch);
  });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (G.mode === 'workshop') return;
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
  holdButton('setUp', () => (hold.up = true), () => (hold.up = false));
  holdButton('setDown', () => (hold.down = true), () => (hold.down = false));
  holdButton('lookBtn', () => (hold.look = true), () => (hold.look = false));
  holdButton('swingBtn', () => swingPress(), () => swingRelease());
  // A tap on the action button can swap the controls under the finger (the
  // bag's Close button sits where it was); swallow the click that follows.
  let swallowClicksUntil = 0;
  document.addEventListener('click', (e) => {
    if (performance.now() < swallowClicksUntil && !e.target.closest('#actBtn')) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  holdButton('actBtn', () => {
    swallowClicksUntil = performance.now() + 500;
    if (G.ballCam && G.ballState === 'moving') G.ff = true; else interact();
  }, () => (G.ff = false));
  UI.$('viewBtn').addEventListener('click', () => (G.view = (G.view + 1) % 3));
  UI.$('backBtn').addEventListener('click', () => { if (!cancelSwing() && !leaveSetup()) leaveShot(); });
  UI.$('setupBtn').addEventListener('click', () => { if (G.shotPhase === 'aim' && !leaveSetup()) enterSetup(); });
  UI.$('fpBtn').addEventListener('click', toggleFP);
  UI.$('cardBtn').addEventListener('click', () => showCard(!!G.cardAfterHole));
  UI.$('mapBtn').addEventListener('click', () => openOverlay('map'));
  UI.$('fetchBtn').addEventListener('click', fetchCart);
  UI.$('mapClose').addEventListener('click', () => closeOverlay('map'));
  UI.$('helpBtn').addEventListener('click', () => openOverlay('help'));
  UI.$('helpClose').addEventListener('click', () => closeOverlay('help'));
  UI.$('howBtn').addEventListener('click', () => openOverlay('help'));
  UI.$('workshopBtn').addEventListener('click', openWorkshop);
  UI.$('muteBtn').addEventListener('click', toggleMute);
  UI.$('cardClose').addEventListener('click', () => closeOverlay('card'));
  UI.$('cardNext').addEventListener('click', nextFromCard);
  UI.$('cardLeave').addEventListener('click', backToTitle);
  UI.$('mpBtn').addEventListener('click', openLobby);
  UI.$('lbHost').addEventListener('click', hostGame);
  UI.$('lbJoin').addEventListener('click', joinGame);
  UI.$('lbGo').addEventListener('click', teeOffOnline);
  UI.$('lbBack').addEventListener('click', closeLobby);
  UI.$('lbCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
  UI.$('lbCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  UI.$('lbName').addEventListener('input', () => {
    clearTimeout(lobby.nameT);
    lobby.nameT = setTimeout(() => { saveMe(); if (Net.active) Net.setMe(lobbyMe()); }, 400);
  });
  Net.on('lobby', () => { if (UI.isShown('lobby')) { lobbyView(); Sound.click(); } });
  Net.on('start', (m) => startMultiplayer(m.seed));
  Net.on('st', onRemoteState);
  Net.on('score', onRemoteScore);
  Net.on('left', (m) => onRemoteLeft(m.s));
  Net.on('hostgone', onHostGone);
  Net.on('error', (e) => { if (UI.isShown('lobby')) lobbyStatus(e.text, true); });
  window.addEventListener('pagehide', () => Net.leave());
  UI.$('startBtn').addEventListener('click', onStart);
  UI.$('selGo').addEventListener('click', confirmSelect);
  UI.$('selBack').addEventListener('click', backFromSelect);
  UI.$('bagClose').addEventListener('click', exitBag);
  UI.$('bagMove').addEventListener('click', moveBag);
  UI.$('resumeBtn').addEventListener('click', () => {
    const r = store.load().round;
    if (roundHere(r) && r.next < HOLES.length) openSelect(r);
    else onStart();
  });

  function onStart() {
    const st = store.load();
    st.round = null;
    store.save(st);
    openSelect(null);
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
    const playing = G.mode === 'walk' || G.mode === 'cart' || G.mode === 'shot' || G.mode === 'bag';
    const paused = overlayOpen() && playing;
    if (playing && !paused) {
      if (G.mode === 'walk') updateWalk(dt);
      else if (G.mode === 'cart') updateCart(dt);
      else if (G.mode === 'bag') {
        if (G.bagExit > 0) { G.bagExit -= dt; if (G.bagExit <= 0) exitBag(); }
      } else if (G.mode === 'shot') {
        if (G.shotPhase === 'aim') { if (G.setupView) updateSetup(dt); else updateAim(dt); }
        else if (G.shotPhase === 'swing') updateBackswing(dt);
        else if (G.shotPhase === 'down') updateDownswing(dt);
        if (G.shotPhase === 'aim' && G.previewDirty && !G.setupView) computePreview();
      }
      updateBall(dt);
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
    bag.root.visible = playing;
    if (playing) { updateCaddy(dt); updateBag(dt); }
    updateGolfer(dt);
    updateOnline(dt);
    World.setBall(G.ball.p, G.ballState === 'gone' || !playing ? 'water' : G.ball.mode === 'holed' ? 'holed' : 'ok', G.ballState === 'tee');
    if (playing) updateHud();
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
      if (Workshop.isOpen) { G.time += dt; Workshop.render(dt); return; }
      update(dt);
      World.update(dt, G.wind, focus);
      World.paintTick(G.mode === 'title' || G.mode === 'select' ? 10 : 4, G.player.x, G.player.z);
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
  const best = bestOf(st);
  if (best) {
    UI.$('bestLine').hidden = false;
    UI.$('bestLine').textContent = `Your best round here: ${best} (${UI.fmtToPar(best - PAR)})`;
  }
  UI.$('wordmark').innerHTML = `${DEF.title[0]}<span>${DEF.title[1]}</span>`;
  UI.text('tagline', DEF.tagline);
  UI.$('coursePick').innerHTML = COURSES.map((c) => `<button data-id="${c.id}" class="${c.id === DEF.id ? 'on' : ''}">${c.name}</button>`).join('');
  UI.$('coursePick').querySelectorAll('button').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.id === DEF.id) return;
    UI.setLoading(true, `Heading to ${courseDef(el.dataset.id).name}…`);
    setTimeout(() => switchCourse(el.dataset.id), 30);
  }));
  const resumable = [(saved && saved.round), st.round].find(roundHere);
  if (resumable && resumable.next > 0 && resumable.next < HOLES.length) {
    if (saved && saved.round) { const s2 = store.load(); s2.round = saved.round; store.save(s2); }
    UI.$('resumeBtn').hidden = false;
    UI.$('resumeBtn').textContent = `Resume at hole ${resumable.next + 1}`;
  }
  activateHole(0);
  const cl = course.clubhouse;
  placePlayer(cl.x - 8, cl.z - 18, -0.6);
  titlePose(0, cam.pos, cam.look);
  requestAnimationFrame(frame);

  // Arrived here to join a friend's game on this course: join it again.
  try {
    const r = JSON.parse(sessionStorage.getItem('pinehaven-rejoin') || 'null');
    sessionStorage.removeItem('pinehaven-rejoin');
    if (r && Date.now() - r.at < 180000 && /^[A-Z]{4}$/.test(r.code)) {
      openLobby();
      UI.$('lbName').value = r.name || '';
      lobby.char = clamp(r.char | 0, 0, CHARACTERS.length - 1);
      renderLobbyChars();
      UI.$('lbCode').value = r.code;
      setTimeout(joinGame, 300);
    }
  } catch (e) { /* storage unavailable: join by hand */ }

  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    try {
      window.claude.hot.snapshot(() => ({ round: G.inRound && !G.mp ? { scores: G.scores.slice(), next: G.hole, course: DEF.id } : null }));
    } catch (e) { /* optional */ }
  }

  // Small API for automated tests and console tinkering.
  return {
    G, course, cart, bag, swingPress, swingRelease, enterSetup, leaveSetup, fetchCart, cartArrival, takeShot, enterShot, leaveShot, interact, enterCart, exitCart, activateHole,
    startRound, placePlayer, setCharacter, nextFromCard, showCard, backToTitle, openLobby, recommendedClub, openSelect, chooseSelect, confirmSelect, enterBag, exitBag, selectClub, openWorkshop,
    get golfer() { return golfer; }, caddy, bagBase, camera, stickShown: () => World.stickShown(),
    // An exact swing, for tests: power (0-1) and wobble e, no sweet spot.
    swingNow(power, e) {
      if (G.mode !== 'shot' || G.shotPhase !== 'aim') return false;
      leaveSetup();
      G.swing = { a: 0, top: isPutt() ? 0.5 : 2.5, t: 0, fired: false, finish: 0, putt: isPutt(), p: power };
      startDownswing({ T: 0, windup: power, power, e, dist: 1, sweet: false, perfect: false });
      return true;
    },
    swingOutcome, backswingTime,
    teleportToBall() { const b = G.ball.p; placePlayer(b.x - 1.5, b.z + 1.5, 0, b.y); },
    dropBall(x, z) { placeBall(x, z, false); },
    // Screen position of a club in the bag (for tests that click it).
    clubScreen(i) {
      bag.root.updateMatrixWorld(true);
      const p = bag.headPoint(i, new V3());
      return project(p.x, p.y, p.z);
    },
  };
}

// Boot once the page is ready: load any custom assets first.
(function boot() {
  const go = (data) => {
    UI.setLoading(true, 'Mowing the fairways…');
    // Let the loading overlay paint before building the course.
    setTimeout(async () => {
      try { await Assets.init(); } catch (e) { console.warn('Custom assets unavailable', e); }
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
