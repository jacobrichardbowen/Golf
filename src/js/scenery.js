// ---------------------------------------------------------------------------
// Scenery for painted holes: buildings, a bridge, fences and boulders, each a
// replaceable asset (low-poly placeholders here), plus the hole maps
// themselves. Models are in yards, front towards +Z, base at y = 0; painted
// holes scale them to the footprint given in course.js.
// ---------------------------------------------------------------------------

const SCENERY_MATS = () => ({
  stone: namedMat('stone', { color: 0x9a958c, flatShading: true }),
  darkStone: namedMat('stone-dark', { color: 0x6c6862, flatShading: true }),
  roof: namedMat('roof', { color: 0x34529c, flatShading: true }),
  trim: namedMat('trim', { color: 0xd8b13c }),
  wood: namedMat('wood', { color: 0x6b4a2e }),
  plaster: namedMat('plaster', { color: 0xe6dac0 }),
  banner: namedMat('banner', { color: 0x27428f, side: THREE.DoubleSide }),
  dark: namedMat('opening', { color: 0x1d1a17 }),
});

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function sceneryAdd(g, name, geo, mat, x, y, z, ry) {
  const m = namedMesh(name, geo, mat);
  m.position.set(x || 0, y || 0, z || 0);
  if (ry) m.rotation.y = ry;
  g.add(m);
  return m;
}
// A row of merlons along the top of a wall running along x.
function merlons(g, mat, x0, x1, y, z, depth) {
  for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.8) sceneryAdd(g, 'merlon', box(0.9, 0.9, depth), mat, x, y + 0.45, z);
}
// A gable roof (triangular prism) with its ridge along x, base at y = 0.
function gableGeo(w, h, len) {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2).rotateY(Math.PI / 2);
}
// A round tower with a conical roof and a little trim ring.
function roundTower(g, M, x, z, r, h, roofH) {
  sceneryAdd(g, 'tower', new THREE.CylinderGeometry(r, r * 1.08, h, 10), M.stone, x, h / 2, z);
  sceneryAdd(g, 'tower-ring', new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.5, 10), M.darkStone, x, h, z);
  sceneryAdd(g, 'roof', new THREE.ConeGeometry(r * 1.3, roofH, 10), M.roof, x, h + 0.25 + roofH / 2, z);
  sceneryAdd(g, 'finial', new THREE.ConeGeometry(0.25, 1.4, 6), M.trim, x, h + roofH + 0.9, z);
}

function castleModel() {
  const M = SCENERY_MATS();
  const g = new THREE.Group();
  g.name = 'castle';
  // Curtain wall with a gate, flanked by two big towers, corner towers and a keep behind.
  sceneryAdd(g, 'wall', box(46, 9, 3), M.stone, 0, 4.5, 0);
  merlons(g, M.stone, -23, 23, 9, 1.1, 0.8);
  sceneryAdd(g, 'gate', box(6, 6, 0.4), M.dark, 0, 3, 1.55);
  sceneryAdd(g, 'gate-arch', new THREE.CylinderGeometry(3, 3, 0.4, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), M.dark, 0, 6, 1.55);
  roundTower(g, M, -9, 1.5, 5.5, 15, 8);
  roundTower(g, M, 9, 1.5, 5.5, 15, 8);
  roundTower(g, M, -24, 0, 4, 11, 6);
  roundTower(g, M, 24, 0, 4, 11, 6);
  sceneryAdd(g, 'keep', box(18, 16, 12), M.stone, 0, 8, -10);
  sceneryAdd(g, 'keep-roof', new THREE.ConeGeometry(13.5, 8, 4).rotateY(Math.PI / 4).scale(1, 1, 0.68), M.roof, 0, 20, -10);
  sceneryAdd(g, 'banner', new THREE.PlaneGeometry(3.2, 6.5), M.banner, 0, 9.5, 1.62);
  sceneryAdd(g, 'banner-crest', new THREE.CircleGeometry(0.9, 8), M.trim, 0, 10.2, 1.66);
  return g;
}

function towerModel() {
  const M = SCENERY_MATS();
  const g = new THREE.Group();
  g.name = 'tower';
  roundTower(g, M, 0, 0, 8, 17, 11);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    sceneryAdd(g, 'window', box(1.1, 1.8, 0.3), M.dark, Math.sin(a) * 8.05, 11, Math.cos(a) * 8.05, a);
  }
  sceneryAdd(g, 'door', box(2.4, 3.6, 0.4), M.dark, 0, 1.8, 8.1);
  // A small annex with a gable roof.
  sceneryAdd(g, 'annex', box(7, 6, 6), M.stone, 8, 3, 6);
  sceneryAdd(g, 'annex-roof', gableGeo(7, 3.2, 7.6), M.roof, 8, 6, 6);
  return g;
}

function houseModel() {
  const M = SCENERY_MATS();
  const g = new THREE.Group();
  g.name = 'house';
  // Stone ground floor, timber-framed upper floor, a steep gable roof.
  sceneryAdd(g, 'ground-floor', box(10, 4, 8), M.stone, 0, 2, 0);
  sceneryAdd(g, 'upper-floor', box(10.6, 4, 8.6), M.plaster, 0, 6, 0);
  for (const x of [-5.2, -1.7, 1.7, 5.2]) sceneryAdd(g, 'beam', box(0.35, 4, 8.8), M.wood, x, 6, 0);
  sceneryAdd(g, 'beam', box(10.8, 0.35, 8.8), M.wood, 0, 4.1, 0);
  sceneryAdd(g, 'roof', gableGeo(9.8, 5.5, 11.6), M.roof, 0, 8, 0);
  sceneryAdd(g, 'door', box(1.8, 3, 0.3), M.wood, 1.5, 1.5, 4.05);
  for (const x of [-3, 3]) sceneryAdd(g, 'window', box(1.4, 1.4, 0.3), M.dark, x, 6.2, 4.35);
  sceneryAdd(g, 'chimney', box(1.2, 4, 1.2), M.darkStone, -3, 11.5, -1.6);
  return g;
}

function bridgeModel() {
  const M = SCENERY_MATS();
  const g = new THREE.Group();
  g.name = 'bridge';
  // Runs along x. The deck's walking surface is at y = 0; the course raises
  // the ground under it to the same height.
  const L = 36, half = 3.2;
  sceneryAdd(g, 'deck', box(L, 0.5, half * 2), M.darkStone, 0, -0.2, 0);
  for (const z of [-half, half]) {
    sceneryAdd(g, 'parapet', box(L, 1.1, 0.7), M.stone, 0, 0.55, z);
    for (let x = -L / 2 + 1; x < L / 2 - 0.5; x += 2.2) sceneryAdd(g, 'merlon', box(0.9, 0.6, 0.75), M.stone, x, 1.4, z);
    sceneryAdd(g, 'side', box(L - 4, 5, 0.6), M.stone, 0, -2.7, z);
    sceneryAdd(g, 'arch', new THREE.CircleGeometry(6, 16, 0, Math.PI).rotateX(Math.PI), M.dark, 0, -0.6, z + Math.sign(z) * 0.32);
  }
  return g;
}

// One length of fence, 2.5 yd along +x: a post at the start and two rails.
const FENCE_LEN = 2.5;
function fenceModel() {
  const M = SCENERY_MATS();
  const g = new THREE.Group();
  g.name = 'fence';
  sceneryAdd(g, 'post', box(0.16, 1.15, 0.16), M.wood, 0, 0.55, 0);
  for (const y of [0.45, 0.88]) sceneryAdd(g, 'rail', box(FENCE_LEN, 0.1, 0.07), M.wood, FENCE_LEN / 2, y, 0);
  return g;
}

// A rough stone about 1 yd across (scaled per boulder).
function boulderModel() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const rnd = mulberry32(4242);
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.82 + rnd() * 0.3);
    const f = seen.get(k);
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.72 + 0.35, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.name = 'boulder';
  g.add(namedMesh('rock', geo, namedMat('rock', { color: 0x8f877a, flatShading: true })));
  return g;
}

const SCENERY_NOTE = 'Real size in meters, base at the origin, front towards +Z. Each placement is scaled to fit its footprint on the hole.';
Assets.define('castle', { kind: 'model', group: 'Scenery', name: 'Castle', build: castleModel, note: SCENERY_NOTE });
Assets.define('tower', { kind: 'model', group: 'Scenery', name: 'Tower', build: towerModel, note: SCENERY_NOTE });
Assets.define('house', { kind: 'model', group: 'Scenery', name: 'House', build: houseModel, note: SCENERY_NOTE });
Assets.define('bridge', { kind: 'model', group: 'Scenery', name: 'Bridge', build: bridgeModel,
  note: 'Runs along X with its walking surface at height 0 (the ground under it is raised to that level). Scaled to fit its footprint.' });
Assets.define('fence', { kind: 'model', group: 'Scenery', name: 'Fence', build: fenceModel,
  note: 'One 2.3 m length running along +X from the origin, post at the start. Repeated along each fence line.' });
Assets.define('boulder', { kind: 'model', group: 'Scenery', name: 'Boulder', build: boulderModel,
  note: 'About 1 m across with its base near the origin; scaled for each rock on painted holes.' });

// The images painted holes are built from (see maphole.js and the README).
for (const hole of COURSE.holes) {
  if (!hole.map) continue;
  for (const [key, what, note] of [
    ['surface', 'surface map', 'One flat colour per kind of ground: see "Painted holes" in the README for the colours.'],
    ['height', 'height map', 'Greyscale, light = high. Trees and buildings drawn into it are found and taken out of the ground.'],
    ['ground', 'painting', 'Drawn onto the ground as its colour. Same area as the surface map.'],
  ]) {
    const id = hole.map[key];
    if (!id) continue;
    Assets.define(id, { kind: 'texture', group: 'Course maps', name: `${hole.name}: ${what}`, map: true, note,
      build: () => Assets.builtinMap(id) });
  }
}
