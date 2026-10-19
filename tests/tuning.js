// The gameplay settings (tuning.js) on the physics, without a browser: wind,
// terrain, lie penalty and green speed do what they say, values are clamped,
// and a change is something to commit.
// Usage: node tests/tuning.js
const G = require('./load')(['util.js', 'data.js', 'tuning.js', 'physics.js']);
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const { TUNE, Tune, SURFACES, SURFACES_BASE } = G;

check(G.TUNE.walkSpeed === 4.2 && TUNE.wind === 1 && TUNE.sweetAt === 95, 'the settings start at the game defaults');

// Wind: a 5 yd/s crosswind on an 8-iron, at 0, 1 and 2 times its influence.
const drift = (k) => {
  Tune.set('wind', k);
  const c = G.CLUBS.find((x) => x.id === '8I'), v = G.fullSpeed(c);
  const b = G.createBall(0, 0.1, 0);
  G.launchBall(b, 0, v, c.launch, c.spin, 0);
  const field = { H: () => 0, normal: () => ({ x: 0, y: 1, z: 0 }), surface: () => G.S_FAIRWAY, waterLevel: () => -Infinity, inBounds: () => true, pin: null, nearTrees: () => null };
  for (let i = 0; i < 240 * 12 && b.mode === 'flight'; i++) G.stepBall(b, field, { x: 5, z: 0 }, G.DT, null);
  return b.p.x;
};
const d0 = drift(0), d1 = drift(1), d2 = drift(2);
console.log(`   crosswind drift: ${d0.toFixed(1)} / ${d1.toFixed(1)} / ${d2.toFixed(1)} yd`);
check(Math.abs(d0) < 0.01 && d1 > 3 && d2 > d1 * 1.6, 'wind influence scales how far the wind pushes the ball (0: not at all)');
Tune.set('wind', 1);

// Terrain: at 0 the rough and sand play like fairway; at 2 twice as unlike it.
Tune.set('terrainBall', 0);
check(['bounce', 'mu', 'roll', 'rollV'].every((f) => Math.abs(SURFACES[G.S_SAND][f] - SURFACES_BASE[G.S_FAIRWAY][f]) < 1e-9), 'terrain influence 0: a bunker plays like fairway');
Tune.set('terrainBall', 2);
const r = SURFACES[G.S_ROUGH].rollV, rb = SURFACES_BASE[G.S_ROUGH].rollV, fw = SURFACES_BASE[G.S_FAIRWAY].rollV;
check(Math.abs(r - (fw + (rb - fw) * 2)) < 1e-9 && SURFACES[G.S_GREEN].rollV === SURFACES_BASE[G.S_GREEN].rollV, 'terrain influence 2: the rough grabs twice as hard (the green is left alone)');
Tune.set('terrainBall', 1);

// Lie penalty.
const iron = G.CLUBS.find((x) => x.id === '4I');
Tune.set('lie', 0);
const l0 = G.lieFactor(iron, G.S_ROUGH);
Tune.set('lie', 2);
const l2 = G.lieFactor(iron, G.S_ROUGH);
Tune.set('lie', 1);
const l1 = G.lieFactor(iron, G.S_ROUGH);
check(l0 === 1 && Math.abs((1 - l2) - 2 * (1 - l1)) < 1e-9, `lie penalty: from the rough 0 → ${l0}, 1 → ${l1.toFixed(2)}, 2 → ${l2.toFixed(2)}`);

// Green speed: the same 10 yd stroke rolls further on a faster green.
const roll = (k) => {
  Tune.set('greenSpeed', k);
  const b = G.createBall(0, G.BALL_R, 0);
  G.startRoll(b, 0, G.puttSpeedFor(10));
  for (let n = 0; b.mode === 'roll' && n < 240 * 60; n++) G.stepBall(b, G.GREEN_FIELD, null, G.DT, null);
  return -b.p.z;
};
const g1 = roll(1), g15 = roll(1.5), g07 = roll(0.7);
console.log(`   a 10 yd putt: ${g07.toFixed(1)} (slow) / ${g1.toFixed(1)} / ${g15.toFixed(1)} (fast) yd`);
check(Math.abs(g1 - 10) < 0.3 && g15 > g1 + 1.5 && g07 < g1 - 1.5, 'green speed: a putt runs on on fast greens and pulls up short on slow ones');
Tune.set('greenSpeed', 1);

// Clamping, and changes to commit.
Tune.set('walkSpeed', 999);
check(TUNE.walkSpeed === Tune.defs.get('walkSpeed').max, 'values are kept within their range');
const p = Tune.pending();
check(p.length === 1 && p[0].id === 'gameplay' && p[0].ext === 'json' && JSON.parse(new TextDecoder().decode(p[0].data)).walkSpeed === 12,
  'a changed setting is ready to commit as gameplay.json, with the values that differ from the defaults');
Tune.reset('walkSpeed');
check(TUNE.walkSpeed === 4.2 && Tune.pending().length === 0, 'reset puts it back, with nothing to commit');

console.log(failed ? `${failed} failed` : 'tuning test passed');
process.exit(failed ? 1 : 0);
