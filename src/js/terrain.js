// ---------------------------------------------------------------------------
// Turns a hole definition into a playable "field": an analytic height
// function, surface classification, water levels, trees and helpers.
// Pure JS so it can be tested from Node; world.js builds meshes from it.
// ---------------------------------------------------------------------------

const TEE_HALF_W = 5, TEE_FRONT = 6, TEE_BACK = 9;
const FRINGE_W = 2.2;

function buildField(def) {
  const seed = def.seed || 1;
  const nBroad = makePerlin(seed);
  const nBump = makePerlin(seed + 101);
  const nEdge = makePerlin(seed + 202);
  const nGreen = makePerlin(seed + 303);
  const line = makePolyline(def.path);
  const L = line.length;
  const last = def.path[def.path.length - 1];
  const gc = { x: last[0], z: last[1] };
  const tee = { x: def.path[0][0], z: def.path[0][1] };
  const t0 = line.pointAt(0);
  const teeDir = { x: t0.ux, z: t0.uz };
  const hw = def.fairway.width / 2;
  const fwStart = def.fairway.start;
  const greenR = def.green.r;
  const tilt = def.green.tilt || [0, 0];
  const bunkers = (def.bunkers || []).map((b) => prepEllipse(Object.assign({}, b)));
  const waters = (def.water || []).map((w) => prepEllipse(Object.assign({}, w)));
  const mounds = def.mounds || [];

  // Playable bounds (beyond these the ball is out of bounds).
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of def.path) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const bounds = { minX: minX - 115, maxX: maxX + 115, minZ: minZ - 85, maxZ: maxZ + 60 };
  const inBounds = (x, z) => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ;

  const teeLocal = (x, z) => {
    const dx = x - tee.x, dz = z - tee.z;
    return { along: dx * teeDir.x + dz * teeDir.z, side: dx * -teeDir.z + dz * teeDir.x };
  };
  const greenEdge = (x, z) => greenR * (1 + 0.1 * nEdge(x / 8 + 40, z / 8));
  const bunkerDist = (b, x, z) => ellipseDist(b, x, z) * (1 + 0.1 * nEdge(x / 5 + 7, z / 5 - 3));
  const waterDist = (w, x, z) => ellipseDist(w, x, z) * (1 + 0.07 * nEdge(x / 9 - 3, z / 9 + 5));

  // --- Height, built up in layers ---------------------------------------
  function rawH(x, z) {
    const q = line.query(x, z);
    let h = def.hills * nBroad(x / 170, z / 170);
    const rough = smoothstep(hw - 4, hw + 30, q.d);
    h += (0.6 + 2.6 * rough) * fbm(nBump, x / 38, z / 38, 3);
    for (const m of mounds) {
      const dx = x - m.x, dz = z - m.z;
      h += m.h * Math.exp(-(dx * dx + dz * dz) / (m.r * m.r));
    }
    // Fade to a flat skirt at the edge of the property.
    const edge = Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z);
    return h * smoothstep(-5, 45, edge);
  }

  const teeH = rawH(tee.x, tee.z) + 0.5;
  const greenH = rawH(gc.x, gc.z);
  const greenPlane = (x, z) =>
    greenH + tilt[0] * (x - gc.x) + tilt[1] * (z - gc.z) + 0.10 * nGreen(x / 9, z / 9);

  function dryH(x, z) {
    let h = rawH(x, z);
    // Tee box: a flat raised pad.
    const tl = teeLocal(x, z);
    const ox = Math.max(Math.abs(tl.side) - TEE_HALF_W, 0);
    const oa = Math.max(tl.along - TEE_FRONT, -TEE_BACK - tl.along, 0);
    const td = Math.hypot(ox, oa);
    if (td < 8) h = lerp(h, teeH, 1 - smoothstep(0, 7, td));
    // Green: blend into a gently tilted plane.
    const gd = Math.hypot(x - gc.x, z - gc.z);
    if (gd < greenR * 1.2 + 16) {
      const r = greenEdge(x, z);
      h = lerp(h, greenPlane(x, z), 1 - smoothstep(r + 1, r + 14, gd));
    }
    // Bunkers: a dished hollow with a raised lip.
    for (const b of bunkers) {
      if (Math.abs(x - b.x) > b._bound * 1.6 || Math.abs(z - b.z) > b._bound * 1.6) continue;
      const ed = bunkerDist(b, x, z);
      if (ed < 1.5) {
        h -= 0.7 * (1 - smoothstep(0.65, 1.02, ed));
        const k = (ed - 1.12) / 0.14;
        h += 0.28 * Math.exp(-k * k);
      }
    }
    return h;
  }

  // Water level for each pond: just under the lowest point of its banks.
  for (const w of waters) {
    let lo = Infinity;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const lx = Math.cos(a) * w.rx * 1.25, lz = Math.sin(a) * w.rz * 1.25;
      const x = w.x + lx * w._cos - lz * w._sin, z = w.z + lx * w._sin + lz * w._cos;
      lo = Math.min(lo, dryH(x, z));
    }
    w.level = lo - 0.45;
  }

  function H(x, z) {
    let h = dryH(x, z);
    for (const w of waters) {
      if (Math.abs(x - w.x) > w._bound * 1.4 || Math.abs(z - w.z) > w._bound * 1.4) continue;
      const ed = waterDist(w, x, z);
      if (ed < 1.25) {
        const bottom = w.level - 1.8;
        if (h > bottom) h = lerp(h, bottom, 1 - smoothstep(0.8, 1.22, ed));
      }
    }
    return h;
  }

  function normal(x, z) {
    const e = 0.2;
    const hx = (H(x + e, z) - H(x - e, z)) / (2 * e);
    const hz = (H(x, z + e) - H(x, z - e)) / (2 * e);
    const l = Math.sqrt(hx * hx + 1 + hz * hz);
    return { x: -hx / l, y: 1 / l, z: -hz / l };
  }

  function waterLevel(x, z) {
    for (const w of waters) {
      if (Math.abs(x - w.x) > w._bound * 1.4 || Math.abs(z - w.z) > w._bound * 1.4) continue;
      if (waterDist(w, x, z) < 1.25 && H(x, z) < w.level) return w.level;
    }
    return -Infinity;
  }

  // --- Surface classification ---------------------------------------------
  // `h` may be passed in when the caller already knows the height.
  function surface(x, z, h) {
    if (!inBounds(x, z)) return S_OOB;
    for (const w of waters) {
      if (Math.abs(x - w.x) > w._bound * 1.4 || Math.abs(z - w.z) > w._bound * 1.4) continue;
      if (waterDist(w, x, z) < 1.25 && (h === undefined ? H(x, z) : h) < w.level) return S_WATER;
    }
    const gd = Math.hypot(x - gc.x, z - gc.z);
    let ge = -1e9;
    if (gd < greenR * 1.3 + FRINGE_W) {
      ge = greenEdge(x, z);
      if (gd < ge) return S_GREEN;
    }
    for (const b of bunkers) {
      if (Math.abs(x - b.x) > b._bound * 1.3 || Math.abs(z - b.z) > b._bound * 1.3) continue;
      if (bunkerDist(b, x, z) < 1) return S_SAND;
    }
    if (gd < ge + FRINGE_W) return S_FRINGE;
    const tl = teeLocal(x, z);
    if (Math.abs(tl.side) < TEE_HALF_W && tl.along < TEE_FRONT && tl.along > -TEE_BACK) return S_TEE;
    const q = line.query(x, z);
    const wob = 1 + 0.13 * nEdge(x / 22, z / 22);
    const dFw = Math.hypot(q.d, Math.max(0, fwStart - q.s));
    if (dFw < hw * wob) return S_FAIRWAY;
    if (q.d < hw + 15 + 7 * nEdge(x / 30 + 11, z / 30) || gd < greenR + 10) return S_ROUGH;
    return S_DEEP;
  }

  // --- Trees ----------------------------------------------------------------
  const rnd = mulberry32(seed * 31 + 7);
  const trees = [];
  const GRID = 10;
  const grid = new Map();
  const key = (ix, iz) => ix * 100003 + iz;
  function addTree(x, z, kind, height) {
    const y0 = H(x, z) - 0.2;
    const pine = kind === 0;
    const t = {
      x, z, y0, kind, height,
      trunkR: 0.22 + height * 0.018,
      trunkH: height * (pine ? 0.3 : 0.42),
      cy: y0 + height * (pine ? 0.58 : 0.66),
      cr: height * (pine ? 0.24 : 0.36),
      ch: height * (pine ? 0.44 : 0.34),
      top: y0 + height,
      rot: rnd() * TAU,
      tint: rnd(),
    };
    trees.push(t);
    const r = t.cr + 0.5;
    for (let ix = Math.floor((x - r) / GRID); ix <= Math.floor((x + r) / GRID); ix++)
      for (let iz = Math.floor((z - r) / GRID); iz <= Math.floor((z + r) / GRID); iz++) {
        const k = key(ix, iz);
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = []));
        cell.push(t);
      }
  }
  const SP = 7.5;
  for (let gx = bounds.minX + 3; gx < bounds.maxX - 3; gx += SP) {
    for (let gz = bounds.minZ + 3; gz < bounds.maxZ - 3; gz += SP) {
      const x = gx + (rnd() - 0.5) * SP * 0.9;
      const z = gz + (rnd() - 0.5) * SP * 0.9;
      const q = line.query(x, z);
      const clear = hw + 11 + 9 * nEdge(x / 35 - 20, z / 35);
      let dens = smoothstep(clear, clear + 32, q.d) * 0.8;
      if (q.d > hw + 4 && q.d < clear && nEdge(x / 15 + 3, z / 15 + 9) > 0.45) dens = 0.25; // lone stands
      const edge = Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z);
      if (edge < 22) dens = Math.max(dens, 0.9);
      if (rnd() > dens) continue;
      if (Math.hypot(x - gc.x, z - gc.z) < greenR + 14) continue;
      const tl = teeLocal(x, z);
      if (Math.abs(tl.side) < 14 && tl.along > -22 && tl.along < 30) continue;
      if (q.s < 1 && q.d < 20) continue;
      let blocked = false;
      for (const w of waters) if (waterDist(w, x, z) < 1.45) blocked = true;
      for (const b of bunkers) if (bunkerDist(b, x, z) < 1.6) blocked = true;
      if (blocked) continue;
      const pine = rnd() < 0.55;
      addTree(x, z, pine ? 0 : 1, pine ? 10 + rnd() * 8 : 8 + rnd() * 6);
    }
  }
  const nearTrees = (x, z) => grid.get(key(Math.floor(x / GRID), Math.floor(z / GRID))) || null;

  const pin = { x: gc.x + def.pin[0], z: gc.z + def.pin[1] };
  pin.y = H(pin.x, pin.z);

  return {
    def, line, length: L, yards: Math.round(L), par: def.par,
    tee: { x: tee.x, z: tee.z, y: H(tee.x, tee.z) }, teeDir,
    green: { x: gc.x, z: gc.z, r: greenR, y: greenH },
    pin, bounds, bunkers, waters, trees,
    H, normal, surface, waterLevel, inBounds, nearTrees,
    greenEdge, fairwayHalf: hw,
  };
}
