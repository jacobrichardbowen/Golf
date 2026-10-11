// ---------------------------------------------------------------------------
// Builds the whole course as one continuous world: an analytic height
// function, surface classification, water levels, trees, cart paths and the
// clubhouse. Pure JS so it can be tested from Node; world.js builds meshes.
// Holes with a `map` are painted as images (maphole.js); they replace the
// generated land inside their rectangle and blend into it at the edges.
// ---------------------------------------------------------------------------

const TEE_HALF_W = 5, TEE_FRONT = 6, TEE_BACK = 9;
const FRINGE_W = 2.2;
const PATH_HALF_W = 1.2;
const CELL = 64;

// Place a hole designed in its own frame onto the course.
function placeHole(def) {
  const [ox, oz, hdg] = def.at || [0, 0, 0];
  const t = hdg * DEG, c = Math.cos(t), s = Math.sin(t);
  const fx = def.flip ? -1 : 1;
  const P = ([lx, lz]) => [ox + fx * lx * c - lz * s, oz + fx * lx * s + lz * c];
  const V = ([vx, vz]) => [fx * vx * c - vz * s, fx * vx * s + vz * c];
  const E = (e) => {
    const [x, z] = P([e.x, e.z]);
    return Object.assign({}, e, { x, z, rot: fx * (e.rot || 0) + hdg });
  };
  const M = (m) => { const [x, z] = P([m.x, m.z]); return Object.assign({}, m, { x, z }); };
  return {
    path: def.path.map(P),
    bunkers: (def.bunkers || []).map(E),
    water: (def.water || []).map(E),
    mounds: (def.mounds || []).map(M),
    tilt: V(def.green.tilt || [0, 0]),
    pin: V(def.pin),
  };
}

// env.images(id) -> { w, h, data } pixels for map holes (null if unavailable).
function buildCourse(C, env = {}) {
  const seed = C.seed || 7;
  const images = env.images || (() => null);
  const nBroad = makePerlin(seed);
  const nBump = makePerlin(seed + 101);
  const nEdge = makePerlin(seed + 202);
  const nGreen = makePerlin(seed + 303);
  const nForest = makePerlin(seed + 404);

  // ---------- holes ----------
  const holes = C.holes.map((def0, index) => {
    let def = def0;
    if (def.map) {
      let mh = null;
      try { mh = buildMapHole(def, images); } catch (e) { if (typeof console !== 'undefined') console.warn('Map hole failed', def.name, e); }
      if (mh) {
        const pin = mh.pin;
        return {
          index, def, name: def.name, par: def.par, line: mh.line, length: mh.line.length, yards: Math.round(mh.line.length),
          tee: { x: mh.tee.x, z: mh.tee.z }, teeDir: mh.teeDir,
          green: { x: mh.green.x, z: mh.green.z, r: mh.green.r },
          hw: mh.hw, fwStart: 0, tilt: [0, 0], bunkers: [], waters: [], mounds: [],
          pinOffset: [pin.x - mh.green.x, pin.z - mh.green.z], map: mh, bbox: mh.bbox,
        };
      }
      // No images (or they failed): play the generated stand-in instead.
      def = Object.assign({}, def.fallback, { name: def.name, par: def.par, seed: def.seed, at: def.at, wind: def.wind });
    }
    const w = placeHole(def);
    const line = makePolyline(w.path);
    const last = w.path[w.path.length - 1];
    const t0 = line.pointAt(0);
    const h = {
      index, def, name: def.name, par: def.par, line, length: line.length, yards: Math.round(line.length),
      tee: { x: w.path[0][0], z: w.path[0][1] }, teeDir: { x: t0.ux, z: t0.uz },
      green: { x: last[0], z: last[1], r: def.green.r },
      hw: def.fairway.width / 2, fwStart: def.fairway.start, tilt: w.tilt,
      bunkers: w.bunkers.map(prepEllipse), waters: w.water.map(prepEllipse), mounds: w.mounds,
      pinOffset: w.pin,
    };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of w.path) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const m = h.hw + 40;
    h.bbox = { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m };
    return h;
  });
  const maps = holes.filter((h) => h.map).map((h) => h.map);
  const allBunkers = holes.flatMap((h) => h.bunkers);
  const allWaters = holes.flatMap((h) => h.waters);
  const allMounds = holes.flatMap((h) => h.mounds);

  // Course bounds
  let bMinX = C.clubhouse.x - 60, bMaxX = C.clubhouse.x + 60, bMinZ = C.clubhouse.z - 60, bMaxZ = C.clubhouse.z + 60;
  for (const h of holes) {
    bMinX = Math.min(bMinX, h.bbox.minX); bMaxX = Math.max(bMaxX, h.bbox.maxX);
    bMinZ = Math.min(bMinZ, h.bbox.minZ); bMaxZ = Math.max(bMaxZ, h.bbox.maxZ);
  }
  const bounds = { minX: Math.floor(bMinX - 50), maxX: Math.ceil(bMaxX + 50), minZ: Math.floor(bMinZ - 50), maxZ: Math.ceil(bMaxZ + 50) };
  const inBounds = (x, z) => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ;

  // ---------- spatial index ----------
  const grid = new Map();
  const ckey = (ix, iz) => ix * 100003 + iz;
  const EMPTY = { holes: [], bunkers: [], waters: [], mounds: [], paths: [], maps: [] };
  function register(kind, obj, minX, maxX, minZ, maxZ) {
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const k = ckey(ix, iz);
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = { holes: [], bunkers: [], waters: [], mounds: [], paths: [], maps: [] }));
        if (!cell[kind].includes(obj)) cell[kind].push(obj);
      }
  }
  const cellAt = (x, z) => grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY;
  for (const h of holes) {
    register('holes', h, h.bbox.minX, h.bbox.maxX, h.bbox.minZ, h.bbox.maxZ);
  }
  for (const b of allBunkers) { const r = b._bound * 1.7; register('bunkers', b, b.x - r, b.x + r, b.z - r, b.z + r); }
  for (const w of allWaters) { const r = w._bound * 1.45; register('waters', w, w.x - r, w.x + r, w.z - r, w.z + r); }
  for (const m of allMounds) { const r = m.r * 2.6; register('mounds', m, m.x - r, m.x + r, m.z - r, m.z + r); }
  for (const mh of maps) register('maps', mh, mh.bbox.minX, mh.bbox.maxX, mh.bbox.minZ, mh.bbox.maxZ);

  // ---------- per-hole helpers ----------
  const greenEdge = (h, x, z) => h.green.r * (1 + 0.1 * nEdge(x / 8 + 40, z / 8));
  const bunkerDist = (b, x, z) => ellipseDist(b, x, z) * (1 + 0.1 * nEdge(x / 5 + 7, z / 5 - 3));
  const waterDist = (w, x, z) => ellipseDist(w, x, z) * (1 + 0.07 * nEdge(x / 9 - 3, z / 9 + 5));
  const teeLocal = (h, x, z) => {
    const dx = x - h.tee.x, dz = z - h.tee.z;
    return { along: dx * h.teeDir.x + dz * h.teeDir.z, side: dx * -h.teeDir.z + dz * h.teeDir.x };
  };

  // ---------- height, built up in layers ----------
  function rawH(x, z) {
    const cell = cellAt(x, z);
    let h = C.hills * nBroad(x / 170, z / 170);
    let rough = 1;
    for (const ho of cell.holes) {
      const d = ho.line.query(x, z).d;
      const r = smoothstep(ho.hw - 4, ho.hw + 30, d);
      if (r < rough) rough = r;
    }
    h += (0.6 + 2.6 * rough) * fbm(nBump, x / 38, z / 38, 3);
    for (const m of cell.mounds) {
      const dx = x - m.x, dz = z - m.z;
      h += m.h * Math.exp(-(dx * dx + dz * dz) / (m.r * m.r));
    }
    // Fade to a flat skirt at the edge of the property.
    const edge = Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z);
    return h * smoothstep(-5, 45, edge);
  }

  for (const h of holes) {
    if (h.map) continue;
    h.teeH = rawH(h.tee.x, h.tee.z) + 0.5;
    h.green.y = rawH(h.green.x, h.green.z);
  }
  const greenPlane = (h, x, z) =>
    h.green.y + h.tilt[0] * (x - h.green.x) + h.tilt[1] * (z - h.green.z) + 0.10 * nGreen(x / 9, z / 9);

  // The clubhouse sits on a levelled pad.
  const club = C.clubhouse;
  const clubPadH = rawH(club.x, club.z) + 0.2;

  function dryH(x, z) {
    let h = rawH(x, z);
    const cell = cellAt(x, z);
    for (const ho of cell.holes) {
      if (ho.map) continue;
      // Tee box: a flat raised pad.
      const tl = teeLocal(ho, x, z);
      if (Math.abs(tl.side) < 16 && tl.along > -22 && tl.along < 20) {
        const ox = Math.max(Math.abs(tl.side) - TEE_HALF_W, 0);
        const oa = Math.max(tl.along - TEE_FRONT, -TEE_BACK - tl.along, 0);
        const td = Math.hypot(ox, oa);
        if (td < 8) h = lerp(h, ho.teeH, 1 - smoothstep(0, 7, td));
      }
      // Green: blend into a gently tilted plane.
      const gd = Math.hypot(x - ho.green.x, z - ho.green.z);
      if (gd < ho.green.r * 1.2 + 16) {
        const r = greenEdge(ho, x, z);
        h = lerp(h, greenPlane(ho, x, z), 1 - smoothstep(r + 1, r + 14, gd));
      }
    }
    // Bunkers: a dished hollow with a raised lip.
    for (const b of cell.bunkers) {
      if (Math.abs(x - b.x) > b._bound * 1.6 || Math.abs(z - b.z) > b._bound * 1.6) continue;
      const ed = bunkerDist(b, x, z);
      if (ed < 1.5) {
        h -= 0.7 * (1 - smoothstep(0.65, 1.02, ed));
        const k = (ed - 1.12) / 0.14;
        h += 0.28 * Math.exp(-k * k);
      }
    }
    // Clubhouse pad
    const cd = Math.max(Math.abs(x - club.x) - 26, Math.abs(z - club.z) - 20, 0);
    if (cd < 14) h = lerp(h, clubPadH, 1 - smoothstep(0, 14, cd));
    return h;
  }

  // Water level for each pond: just under the lowest point of its banks.
  for (const w of allWaters) {
    let lo = Infinity;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const lx = Math.cos(a) * w.rx * 1.25, lz = Math.sin(a) * w.rz * 1.25;
      const x = w.x + lx * w._cos - lz * w._sin, z = w.z + lx * w._sin + lz * w._cos;
      lo = Math.min(lo, dryH(x, z));
    }
    w.level = lo - 0.45;
  }

  function procH(x, z) {
    let h = dryH(x, z);
    for (const w of cellAt(x, z).waters) {
      if (Math.abs(x - w.x) > w._bound * 1.4 || Math.abs(z - w.z) > w._bound * 1.4) continue;
      const ed = waterDist(w, x, z);
      if (ed < 1.25) {
        const bottom = w.level - 1.8;
        if (h > bottom) h = lerp(h, bottom, 1 - smoothstep(0.8, 1.22, ed));
      }
    }
    return h;
  }

  // Painted holes take over inside their rectangle, fading in at the edges.
  function H(x, z) {
    for (const mh of cellAt(x, z).maps) {
      const w = mh.weight(x, z);
      if (w > 0) return w >= 1 ? mh.height(x, z) : lerp(procH(x, z), mh.height(x, z), w);
    }
    return procH(x, z);
  }
  // Seat each painted hole on the land around it.
  for (const mh of maps) {
    let sum = 0, n = 0;
    const W = mh.W, Hh = mh.H, ins = mh.margin / mh.s;
    for (let k = 0; k <= 40; k++) {
      const f = k / 40;
      for (const [u, v] of [[f * W, ins], [f * W, Hh - ins], [ins, f * Hh], [W - ins, f * Hh]]) {
        const p = mh.toWorld(u, v);
        sum += procH(p.x, p.z) - mh.height(p.x, p.z);
        n++;
      }
    }
    mh.setOffset(sum / n);
  }
  const mapAt = (x, z, min) => {
    for (const mh of cellAt(x, z).maps) if (mh.weight(x, z) > min) return mh;
    return null;
  };

  function normal(x, z) {
    const e = 0.2;
    const hx = (H(x + e, z) - H(x - e, z)) / (2 * e);
    const hz = (H(x, z + e) - H(x, z - e)) / (2 * e);
    const l = Math.sqrt(hx * hx + 1 + hz * hz);
    return { x: -hx / l, y: 1 / l, z: -hz / l };
  }

  function waterLevel(x, z) {
    const mh = mapAt(x, z, 0.5);
    if (mh) {
      const L = mh.waterLevel(x, z);
      return L > -Infinity && H(x, z) < L ? L : -Infinity;
    }
    for (const w of cellAt(x, z).waters) {
      if (Math.abs(x - w.x) > w._bound * 1.4 || Math.abs(z - w.z) > w._bound * 1.4) continue;
      if (waterDist(w, x, z) < 1.25 && H(x, z) < w.level) return w.level;
    }
    return -Infinity;
  }

  // ---------- cart paths ----------
  const paths = [];
  function addPath(pts) {
    if (pts.length < 2) return;
    // light smoothing
    const sm = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      return [(pts[i - 1][0] + p[0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + p[1] * 2 + pts[i + 1][1]) / 4];
    });
    const line = makePolyline(sm);
    const p = { line, pts: sm };
    paths.push(p);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of sm) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    register('paths', p, minX - 8, maxX + 8, minZ - 8, maxZ + 8);
  }
  const blocked = (x, z) => {
    for (const w of allWaters) if (waterDist(w, x, z) < 1.5) return true;
    for (const b of allBunkers) if (bunkerDist(b, x, z) < 1.6) return true;
    for (const h of holes) {
      if (Math.hypot(x - h.green.x, z - h.green.z) < h.green.r + 8) return true;
      const tl = teeLocal(h, x, z);
      if (Math.abs(tl.side) < TEE_HALF_W + 2 && tl.along > -TEE_BACK - 2 && tl.along < TEE_FRONT + 2) return true;
    }
    return false;
  };
  const sidePaths = holes.map((h) => {
    // Painted holes draw their own paths: just link up to their tee and green.
    if (h.map) return [[h.tee.x, h.tee.z], [h.green.x, h.green.z]];
    const side = h.def.cartSide || 1;
    const pts = [];
    const L = h.length;
    for (let s = 0; s <= L + 0.01; s += Math.min(12, L / 6)) {
      const p = h.line.pointAt(s);
      const nx = -p.uz * side, nz = p.ux * side; // right-hand normal
      let off = h.hw + 13;
      if (s > L - 40) off = Math.max(off, h.green.r + 14);
      let x = p.x + nx * off, z = p.z + nz * off;
      for (let k = 0; k < 12 && blocked(x, z); k++) { off += 4; x = p.x + nx * off; z = p.z + nz * off; }
      pts.push([x, z]);
    }
    return pts;
  });
  const clubDoor = [club.x - 6, club.z - 22];
  for (let i = 0; i < holes.length; i++) {
    if (!holes[i].map) addPath(sidePaths[i]);
    const from = sidePaths[i][sidePaths[i].length - 1];
    const to = i + 1 < holes.length ? sidePaths[i + 1][0] : clubDoor;
    addPath([from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to]);
  }
  addPath([clubDoor, [(clubDoor[0] + sidePaths[0][0][0]) / 2, (clubDoor[1] + sidePaths[0][0][1]) / 2], sidePaths[0][0]]);
  const pathDist = (x, z) => {
    let d = Infinity;
    for (const p of cellAt(x, z).paths) d = Math.min(d, p.line.query(x, z).d);
    return d;
  };

  // ---------- surface classification ----------
  // `h` may be passed in when the caller already knows the height.
  const _q = [];
  function surface(x, z, h) {
    if (!inBounds(x, z)) return S_OOB;
    const cell = cellAt(x, z);
    for (const mh of cell.maps) {
      const w = mh.weight(x, z);
      if (w > 0 && w > 0.5 + 0.3 * nEdge(x / 9 + 31, z / 9 - 17)) return mh.surface(x, z);
    }
    for (const w of cell.waters) {
      if (Math.abs(x - w.x) > w._bound * 1.4 || Math.abs(z - w.z) > w._bound * 1.4) continue;
      if (waterDist(w, x, z) < 1.25 && (h === undefined ? H(x, z) : h) < w.level) return S_WATER;
    }
    let fringe = false;
    for (const ho of cell.holes) {
      const gd = Math.hypot(x - ho.green.x, z - ho.green.z);
      if (gd < ho.green.r * 1.3 + FRINGE_W) {
        const ge = greenEdge(ho, x, z);
        if (gd < ge) return S_GREEN;
        if (gd < ge + FRINGE_W) fringe = true;
      }
    }
    for (const b of cell.bunkers) {
      if (Math.abs(x - b.x) > b._bound * 1.3 || Math.abs(z - b.z) > b._bound * 1.3) continue;
      if (bunkerDist(b, x, z) < 1) return S_SAND;
    }
    if (fringe) return S_FRINGE;
    let n = 0;
    for (const ho of cell.holes) {
      const tl = teeLocal(ho, x, z);
      if (Math.abs(tl.side) < TEE_HALF_W && tl.along < TEE_FRONT && tl.along > -TEE_BACK) return S_TEE;
      const q = ho.line.query(x, z);
      const wob = 1 + 0.13 * nEdge(x / 22, z / 22);
      if (Math.hypot(q.d, Math.max(0, ho.fwStart - q.s)) < ho.hw * wob) return S_FAIRWAY;
      _q[n++] = q.d - ho.hw;
    }
    if (pathDist(x, z) < PATH_HALF_W) return S_PATH;
    const roughW = 15 + 7 * nEdge(x / 30 + 11, z / 30);
    for (let i = 0; i < n; i++) if (_q[i] < roughW) return S_ROUGH;
    for (const ho of cell.holes) if (Math.hypot(x - ho.green.x, z - ho.green.z) < ho.green.r + 10) return S_ROUGH;
    if (Math.abs(x - club.x) < 30 && Math.abs(z - club.z) < 24) return S_ROUGH;
    return S_DEEP;
  }

  // Which hole's corridor (if any) a point belongs to: used for fairway stripes.
  function stripeS(x, z) {
    if (mapAt(x, z, 0.5)) return null;
    let best = null, bd = Infinity;
    for (const ho of cellAt(x, z).holes) {
      const q = ho.line.query(x, z);
      if (q.d < bd) { bd = q.d; best = q.s; }
    }
    return best;
  }

  // ---------- obstacles (character / cart collisions) ----------
  const obstacles = [{ x: club.x, z: club.z, hx: 15, hz: 9 }];
  // Buildings on painted holes (bridges and other decks can be walked on).
  for (const mh of maps)
    for (const p of mh.props) {
      if (p.deck || p.open) continue;
      const c = Math.abs(Math.cos(p.yaw * DEG)), sn = Math.abs(Math.sin(p.yaw * DEG));
      obstacles.push({ x: p.x, z: p.z, hx: (p.w * c + p.d * sn) / 2 * 0.9, hz: (p.w * sn + p.d * c) / 2 * 0.9, prop: p });
    }

  // ---------- trees ----------
  const rnd = mulberry32(seed * 31 + 7);
  const trees = [];
  const TGRID = 10;
  const tgrid = new Map();
  // `wide` widens the crown (painted trees can be broader than the models).
  function addTree(x, z, kind, height, wide = 1) {
    const y0 = H(x, z) - 0.2;
    const pine = kind === 0;
    const t = {
      x, z, y0, kind, height, wide,
      trunkR: 0.22 + height * 0.018,
      trunkH: height * (pine ? 0.3 : 0.42),
      cy: y0 + height * (pine ? 0.58 : 0.66),
      cr: height * (pine ? 0.24 : 0.36) * wide,
      ch: height * (pine ? 0.44 : 0.34),
      top: y0 + height,
      rot: rnd() * TAU,
      tint: rnd(),
    };
    trees.push(t);
    const r = t.cr + 0.5;
    for (let ix = Math.floor((x - r) / TGRID); ix <= Math.floor((x + r) / TGRID); ix++)
      for (let iz = Math.floor((z - r) / TGRID); iz <= Math.floor((z + r) / TGRID); iz++) {
        const k = ckey(ix, iz);
        let cell = tgrid.get(k);
        if (!cell) tgrid.set(k, (cell = []));
        cell.push(t);
      }
  }
  const SP = 7.5;
  for (let gx = bounds.minX + 3; gx < bounds.maxX - 3; gx += SP) {
    for (let gz = bounds.minZ + 3; gz < bounds.maxZ - 3; gz += SP) {
      const x = gx + (rnd() - 0.5) * SP * 0.9;
      const z = gz + (rnd() - 0.5) * SP * 0.9;
      const cell = cellAt(x, z);
      if (mapAt(x, z, 0.02)) continue; // painted holes plant their own
      // Open forest away from the holes, with a few meadows.
      let dens = 0.72 * smoothstep(-0.35, 0.1, nForest(x / 110, z / 110));
      let near = false;
      for (const ho of cell.holes) {
        const q = ho.line.query(x, z);
        const clear = ho.hw + 11 + 9 * nEdge(x / 35 - 20, z / 35);
        let d = smoothstep(clear, clear + 32, q.d) * 0.8;
        if (q.d > ho.hw + 4 && q.d < clear && nEdge(x / 15 + 3, z / 15 + 9) > 0.45) d = 0.25; // lone stands
        if (d < dens) dens = d;
        if (Math.hypot(x - ho.green.x, z - ho.green.z) < ho.green.r + 14) near = true;
        const tl = teeLocal(ho, x, z);
        if (Math.abs(tl.side) < 14 && tl.along > -22 && tl.along < 30) near = true;
        if (q.s < 1 && q.d < 20) near = true;
      }
      const edge = Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z);
      if (edge < 22) dens = Math.max(dens, 0.9);
      if (near || rnd() > dens) continue;
      if (pathDist(x, z) < 4) continue;
      if (Math.abs(x - club.x) < 42 && Math.abs(z - club.z) < 36) continue;
      let bad = false;
      for (const w of cell.waters) if (waterDist(w, x, z) < 1.45) bad = true;
      for (const b of cell.bunkers) if (bunkerDist(b, x, z) < 1.6) bad = true;
      if (bad) continue;
      const pine = rnd() < 0.55;
      addTree(x, z, pine ? 0 : 1, pine ? 10 + rnd() * 8 : 8 + rnd() * 6);
    }
  }
  // Boulders share the trees' collision grid (kind 2): a squat solid trunk, no crown.
  function addRock(x, z, r, rot) {
    const y0 = H(x, z) - r * 0.35;
    const t = { x, z, y0, kind: 2, height: r * 1.3, r, wide: 1, trunkR: r * 0.85, trunkH: r * 1.15 + 0.3, cy: y0, cr: 0.001, ch: 0.001, top: y0 + r * 1.3, rot, tint: 0 };
    trees.push(t);
    for (let ix = Math.floor((x - r) / TGRID); ix <= Math.floor((x + r) / TGRID); ix++)
      for (let iz = Math.floor((z - r) / TGRID); iz <= Math.floor((z + r) / TGRID); iz++) {
        const k = ckey(ix, iz);
        let cell = tgrid.get(k);
        if (!cell) tgrid.set(k, (cell = []));
        cell.push(t);
      }
  }
  for (const mh of maps) {
    for (const t of mh.trees) {
      if (Math.abs(t.x - club.x) < 36 && Math.abs(t.z - club.z) < 30) continue;
      if (mh.weight(t.x, t.z) < 0.35) continue;
      addTree(t.x, t.z, t.kind, t.height, t.wide);
    }
    for (const b of mh.boulders) if (mh.weight(b.x, b.z) > 0.35) addRock(b.x, b.z, b.r, b.rot);
  }
  const nearTrees = (x, z) => tgrid.get(ckey(Math.floor(x / TGRID), Math.floor(z / TGRID))) || null;

  for (const h of holes) {
    h.pin = { x: h.green.x + h.pinOffset[0], z: h.green.z + h.pinOffset[1] };
    h.pin.y = H(h.pin.x, h.pin.z);
    h.tee.y = H(h.tee.x, h.tee.z);
    h.greenEdge = (x, z) => greenEdge(h, x, z);
  }

  return {
    holes, bounds, trees, paths, obstacles, clubhouse: Object.assign({ y: clubPadH }, club),
    H, normal, surface, waterLevel, inBounds, nearTrees, stripeS, pathDist,
    waters: allWaters, bunkers: allBunkers, maps,
    // The painted colour of the ground (and how much of it to use), or null.
    paintColor(x, z) {
      for (const mh of cellAt(x, z).maps) {
        if (!mh.paint) continue;
        const w = mh.weight(x, z);
        if (w <= 0) continue;
        const c = mh.paint(x, z);
        if (c) return [c[0], c[1], c[2], w];
      }
      return null;
    },
    // The physics needs a "field" with the pin of the hole being played.
    fieldFor(hole) { return Object.assign(Object.create(this), { pin: hole.pin, hole }); },
  };
}
