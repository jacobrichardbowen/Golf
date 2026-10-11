// ---------------------------------------------------------------------------
// Holes painted as pictures. A map hole is built from up to three images of
// the same area, placed on the course with `at` like any other hole:
//
//   surface  colour-coded surfaces, one colour per kind of ground (MAP_PALETTE)
//   height   greyscale height map, light = high. Trees and buildings drawn
//            into it are recognised: they're taken out of the ground shape,
//            and the trees are planted where they stand.
//   ground   optional painting used as the colour of the ground
//
// Pure JS with no DOM: images arrive as { w, h, data } RGBA pixel arrays.
// All grids below are at the surface map's resolution, `s` yards per pixel.
// ---------------------------------------------------------------------------

const MAP_PALETTE = [
  { key: 'fairway', name: 'Fairway', rgb: [110, 200, 60], s: S_FAIRWAY },
  { key: 'green', name: 'Green', rgb: [180, 255, 150], s: S_GREEN },
  { key: 'tee', name: 'Tee', rgb: [255, 255, 80], s: S_TEE },
  { key: 'rough', name: 'Rough', rgb: [60, 130, 40], s: S_ROUGH },
  { key: 'forest', name: 'Forest (deep rough, trees)', rgb: [20, 70, 30], s: S_DEEP },
  { key: 'long', name: 'Long grass (deep rough, no trees)', rgb: [130, 140, 40], s: S_DEEP },
  { key: 'sand', name: 'Bunker', rgb: [240, 210, 150], s: S_SAND },
  { key: 'water', name: 'Water', rgb: [30, 90, 220], s: S_WATER },
  { key: 'path', name: 'Path', rgb: [160, 90, 40], s: S_PATH },
  { key: 'rock', name: 'Rocks (deep rough, boulders)', rgb: [128, 128, 128], s: S_DEEP },
  { key: 'oob', name: 'Out of bounds', rgb: [0, 0, 0], s: S_OOB },
];
const MC = {};
MAP_PALETTE.forEach((p, i) => { MC[p.key] = i; });

// ---- grid helpers ----
// Distance (in pixels) from every cell to the nearest cell where mask is set
// (two-pass 3-4 chamfer, accurate to a few percent).
function mapDistance(mask, W, H) {
  const BIG = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? 0 : BIG;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 3);
        if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
      }
      d[i] = v;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 3);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
      }
      d[i] = v;
    }
  for (let i = 0; i < W * H; i++) d[i] /= 3;
  return d;
}

// Running min or max over a window of 2r+1 along rows, then columns
// (van Herk / Gil-Werman: constant work per cell whatever the radius).
function mapMinMax(src, W, H, r, isMax) {
  const op = isMax ? Math.max : Math.min;
  const k = 2 * r + 1;
  const pass = (inp, n, count, stride, step) => {
    const out = new Float32Array(inp.length);
    const buf = new Float32Array(n), g = new Float32Array(n), h = new Float32Array(n);
    for (let c = 0; c < count; c++) {
      const base = c * stride;
      for (let i = 0; i < n; i++) buf[i] = inp[base + i * step];
      for (let i = 0; i < n; i++) g[i] = i % k === 0 ? buf[i] : op(g[i - 1], buf[i]);
      for (let i = n - 1; i >= 0; i--) h[i] = i === n - 1 || (i + 1) % k === 0 ? buf[i] : op(h[i + 1], buf[i]);
      for (let i = 0; i < n; i++) {
        const a = i - r, b = i + r;
        let v;
        if (a >= 0 && b < n) v = op(h[a], g[b]);
        else {
          v = buf[i];
          for (let j = Math.max(0, a); j <= Math.min(n - 1, b); j++) v = op(v, buf[j]);
        }
        out[base + i * step] = v;
      }
    }
    return out;
  };
  return pass(pass(src, W, H, W, 1), H, W, 1, W);
}

// Box blur of radius r, repeated `times` (three passes is close to a Gaussian).
function mapBlur(src, W, H, r, times) {
  let a = src;
  const tmp = new Float32Array(W * H);
  for (let t = 0; t < times; t++) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * W + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = acc / (2 * r + 1);
        acc += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
    a = out;
  }
  return a;
}

// Blur of `src` counting only cells where `use` is set: fills the rest from
// their surroundings. Cells with no usable neighbours come back as NaN.
function mapFill(src, use, W, H, r, times) {
  const v = new Float32Array(W * H), w = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) if (use[i]) { v[i] = src[i]; w[i] = 1; }
  const bv = mapBlur(v, W, H, r, times), bw = mapBlur(w, W, H, r, times);
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = bw[i] > 1e-4 ? bv[i] / bw[i] : NaN;
  return out;
}

// Image (any size) resampled to W x H, one channel (0-255) or RGB.
function mapResample(img, W, H, channel) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = ((y + 0.5) / H) * img.h - 0.5;
    const y0 = clamp(Math.floor(fy), 0, img.h - 1), y1 = Math.min(img.h - 1, y0 + 1), ty = clamp(fy - y0, 0, 1);
    for (let x = 0; x < W; x++) {
      const fx = ((x + 0.5) / W) * img.w - 0.5;
      const x0 = clamp(Math.floor(fx), 0, img.w - 1), x1 = Math.min(img.w - 1, x0 + 1), tx = clamp(fx - x0, 0, 1);
      const p = (xx, yy) => {
        const i = (yy * img.w + xx) * 4;
        return channel === 'lum' ? (img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11) : img.data[i + channel];
      };
      out[y * W + x] = lerp(lerp(p(x0, y0), p(x1, y0), tx), lerp(p(x0, y1), p(x1, y1), tx), ty);
    }
  }
  return out;
}

function rgbHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// ---- the hole ----
// def: a hole definition with `map` (see course.js); img(id) -> pixels or null.
function buildMapHole(def, img) {
  const m = def.map;
  const surfImg = img(m.surface), hImg = img(m.height), gImg = m.ground ? img(m.ground) : null;
  if (!surfImg || !hImg) return null;
  const W = surfImg.w, H = surfImg.h, N = W * H;
  const s = m.scale;
  const [ox, oz, hdg] = def.at || [0, 0, 0];
  const [tu, tv] = m.tee;
  const ca = Math.cos(hdg * DEG), sa = Math.sin(hdg * DEG);
  const toWorld = (u, v) => {
    const lx = (u - tu) * s, lz = (v - tv) * s;
    return { x: ox + lx * ca - lz * sa, z: oz + lx * sa + lz * ca };
  };
  const toImage = (x, z) => {
    const dx = x - ox, dz = z - oz;
    return { u: tu + (dx * ca + dz * sa) / s, v: tv + (-dx * sa + dz * ca) / s };
  };
  const rnd = mulberry32((def.seed || 1) * 977 + 13);

  // ---- surfaces: nearest palette colour ----
  const cls = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = surfImg.data[i * 4], g = surfImg.data[i * 4 + 1], b = surfImg.data[i * 4 + 2];
    let best = 0, bd = Infinity;
    for (let k = 0; k < MAP_PALETTE.length; k++) {
      const c = MAP_PALETTE[k].rgb;
      const d = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]);
      if (d < bd) { bd = d; best = k; }
    }
    cls[i] = best;
  }
  const isK = (k) => { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = cls[i] === k ? 1 : 0; return a; };
  const greenM = isK(MC.green), teeM = isK(MC.tee), sandM = isK(MC.sand), waterM = isK(MC.water);
  const dGreen = mapDistance(greenM, W, H);
  const surf = new Uint8Array(N);
  const FR = FRINGE_W / s;
  for (let i = 0; i < N; i++) {
    let sv = MAP_PALETTE[cls[i]].s;
    if (dGreen[i] > 0 && dGreen[i] < FR && (sv === S_FAIRWAY || sv === S_ROUGH)) sv = S_FRINGE;
    surf[i] = sv;
  }

  // ---- props (footprints matter to trees and the bridge deck) ----
  const props = (m.props || []).map((p) => {
    const c = toWorld(p.at[0], p.at[1]);
    return Object.assign({}, p, { x: c.x, z: c.z, yaw: hdg + (p.rot || 0), w: p.size[0], d: p.size[1] });
  });
  const inProp = (u, v, pad) => {
    for (const p of m.props || []) {
      const r = (p.rot || 0) * DEG, c = Math.cos(r), sn = Math.sin(r);
      const du = (u - p.at[0]) * s, dv = (v - p.at[1]) * s;
      const a = du * c + dv * sn, b = -du * sn + dv * c;
      if (Math.abs(a) < p.size[0] / 2 + pad && Math.abs(b) < p.size[1] / 2 + pad) return p;
    }
    return null;
  };

  // ---- height ----
  const lo = m.heights[0], hi = m.heights[1];
  const raw = mapResample(hImg, W, H, 'lum');
  // Opening (min then max) removes anything narrower than ~2R: trees, posts, paths.
  const R = Math.max(1, Math.round(8 / s));
  const opened = mapMinMax(mapMinMax(raw, W, H, R, false), W, H, R, true);
  const resid = new Float32Array(N);
  for (let i = 0; i < N; i++) resid[i] = raw[i] - opened[i];
  const base = mapBlur(opened, W, H, Math.max(1, Math.round(3 / s)), 3);
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) y[i] = lo + (base[i] / 255) * (hi - lo);

  // Bunkers: fill in from their surroundings, then dish them with a lip.
  const notSand = new Uint8Array(N);
  for (let i = 0; i < N; i++) notSand[i] = sandM[i] ? 0 : 1;
  const sandFill = mapFill(y, notSand, W, H, Math.round(5 / s), 2);
  const dInSand = mapDistance(notSand, W, H), dOutSand = mapDistance(sandM, W, H);
  for (let i = 0; i < N; i++) {
    if (sandM[i]) y[i] = (isNaN(sandFill[i]) ? y[i] : sandFill[i]) - 0.75 * smoothstep(0, 2.2, dInSand[i] * s);
    else {
      const k = (dOutSand[i] * s - 0.6) / 0.6;
      if (k < 3) y[i] += 0.25 * Math.exp(-k * k);
    }
  }
  // Greens: a gently tilted plane fitted to the ground (at most a 2% slope).
  let gn = 0, gx = 0, gz = 0, gy = 0;
  for (let i = 0; i < N; i++) if (greenM[i]) { gn++; gx += i % W; gz += Math.floor(i / W); gy += y[i]; }
  const green = gn ? { u: gx / gn, v: gz / gn, y: gy / gn, n: gn } : null;
  if (green) {
    let sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
    for (let i = 0; i < N; i++) {
      if (!greenM[i]) continue;
      const dx = ((i % W) - green.u) * s, dz = (Math.floor(i / W) - green.v) * s, dy = y[i] - green.y;
      sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxy += dx * dy; szy += dz * dy;
    }
    const det = sxx * szz - sxz * sxz;
    let ax = det > 1e-6 ? (sxy * szz - szy * sxz) / det : 0, az = det > 1e-6 ? (szy * sxx - sxy * sxz) / det : 0;
    const sl = Math.hypot(ax, az);
    if (sl > 0.02) { ax *= 0.02 / sl; az *= 0.02 / sl; }
    green.ax = ax; green.az = az;
    const plane = (u, v) => green.y + ax * (u - green.u) * s + az * (v - green.v) * s;
    for (let i = 0; i < N; i++) {
      const d = dGreen[i] * s;
      if (d > 9 || sandM[i] || waterM[i]) continue;
      const u = i % W, v = Math.floor(i / W);
      y[i] = lerp(y[i], plane(u, v), 1 - smoothstep(0.5, 9, d));
    }
  }
  // Tee: a flat pad standing a little proud.
  let tn = 0, ty = 0;
  for (let i = 0; i < N; i++) if (teeM[i]) { tn++; ty += y[i]; }
  if (tn) {
    const teeH = ty / tn + 0.3;
    const dTee = mapDistance(teeM, W, H);
    for (let i = 0; i < N; i++) {
      const d = dTee[i] * s;
      if (d < 5 && !sandM[i] && !waterM[i]) y[i] = lerp(y[i], teeH, 1 - smoothstep(0, 5, d));
    }
  }
  // Water: a surface just under its banks, sloping gently along a river; the
  // bed drops away from the edge, and the banks are kept above the water.
  const level = new Float32Array(N).fill(NaN);
  let hasWater = false;
  for (let i = 0; i < N; i++) if (waterM[i]) { hasWater = true; break; }
  if (hasWater) {
    const dry = new Uint8Array(N);
    for (let i = 0; i < N; i++) dry[i] = waterM[i] ? 0 : 1;
    const bank = mapFill(y, dry, W, H, Math.round(6 / s), 2);
    const lv0 = new Float32Array(N);
    for (let i = 0; i < N; i++) lv0[i] = (isNaN(bank[i]) ? y[i] : bank[i]) - 0.55;
    const lvl = mapFill(lv0, waterM, W, H, Math.round(8 / s), 2);
    const dIn = mapDistance(dry, W, H), dOut = mapDistance(waterM, W, H);
    for (let i = 0; i < N; i++) {
      const L = lvl[i];
      if (isNaN(L)) continue;
      if (waterM[i]) {
        y[i] = Math.min(y[i], L - 0.5 - 1.6 * smoothstep(0, 5, dIn[i] * s));
        level[i] = L;
      } else if (dOut[i] * s < 2.5) {
        y[i] = Math.max(y[i], L + 0.2 + 0.3 * smoothstep(0, 2.5, dOut[i] * s));
        level[i] = L; // under the bank: lets the water's edge tuck in
      }
    }
  }
  // Bridges and other decks: a walkable top over whatever is below.
  (m.props || []).forEach((p, idx) => {
    if (!p.deck) return;
    const r = (p.rot || 0) * DEG, c = Math.cos(r), sn = Math.sin(r);
    const ends = [-1, 1].map((e) => {
      const u = Math.round(p.at[0] + (c * e * (p.size[0] / 2 + 1)) / s), v = Math.round(p.at[1] + (sn * e * (p.size[0] / 2 + 1)) / s);
      return y[clamp(v, 0, H - 1) * W + clamp(u, 0, W - 1)];
    });
    const deckY = Math.max(ends[0], ends[1]) + 0.25;
    props[idx].deckY0 = deckY;
    const reach = Math.hypot(p.size[0], p.size[1]) / s / 2 + 2;
    for (let v = Math.max(0, Math.floor(p.at[1] - reach)); v < Math.min(H, p.at[1] + reach); v++)
      for (let u = Math.max(0, Math.floor(p.at[0] - reach)); u < Math.min(W, p.at[0] + reach); u++) {
        const du = (u - p.at[0]) * s, dv = (v - p.at[1]) * s;
        const a = du * c + dv * sn, b = -du * sn + dv * c;
        if (Math.abs(a) < p.size[0] / 2 && Math.abs(b) < p.size[1] / 2 * 0.62) {
          const i = v * W + u;
          y[i] = Math.max(y[i], deckY);
          surf[i] = S_PATH;
        }
      }
  });

  // ---- sampling ----
  let offset = 0;
  const sample = (grid, u, v) => {
    const fx = clamp(u - 0.5, 0, W - 1.001), fy = clamp(v - 0.5, 0, H - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, tz = fy - y0;
    const i = y0 * W + x0;
    return lerp(lerp(grid[i], grid[i + 1], tx), lerp(grid[i + W], grid[i + W + 1], tx), tz);
  };
  const inside = (u, v) => u >= 0 && v >= 0 && u < W && v < H;
  const margin = m.blend || 14;
  function weight(x, z) {
    const p = toImage(x, z);
    if (!inside(p.u, p.v)) return 0;
    const e = Math.min(p.u, W - p.u, p.v, H - p.v) * s;
    return smoothstep(0, margin, e);
  }
  function height(x, z) {
    const p = toImage(x, z);
    return sample(y, p.u, p.v) + offset;
  }
  function surface(x, z) {
    const p = toImage(x, z);
    if (!inside(p.u, p.v)) return S_DEEP;
    return surf[Math.floor(p.v) * W + Math.floor(p.u)];
  }
  function waterLevel(x, z) {
    const p = toImage(x, z);
    if (!inside(p.u, p.v)) return -Infinity;
    const L = level[Math.floor(p.v) * W + Math.floor(p.u)];
    return isNaN(L) ? -Infinity : L + offset;
  }
  // The painting, resampled to the surface map's grid as needed.
  let paint = null;
  if (gImg) {
    const kx = gImg.w / W, ky = gImg.h / H;
    paint = (x, z) => {
      const p = toImage(x, z);
      if (!inside(p.u, p.v)) return null;
      const fx = clamp(p.u * kx - 0.5, 0, gImg.w - 1.001), fy = clamp(p.v * ky - 0.5, 0, gImg.h - 1.001);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, tz = fy - y0;
      const i = (y0 * gImg.w + x0) * 4, j = i + gImg.w * 4, d = gImg.data;
      return [
        lerp(lerp(d[i], d[i + 4], tx), lerp(d[j], d[j + 4], tx), tz),
        lerp(lerp(d[i + 1], d[i + 5], tx), lerp(d[j + 1], d[j + 5], tx), tz),
        lerp(lerp(d[i + 2], d[i + 6], tx), lerp(d[j + 2], d[j + 6], tx), tz),
      ];
    };
  }
  const paintAvg = (u, v, r) => {
    if (!gImg) return null;
    const kx = gImg.w / W, ky = gImg.h / H;
    let n = 0, R = 0, G = 0, B = 0;
    for (let dv = -r; dv <= r; dv += Math.max(1, r / 3))
      for (let du = -r; du <= r; du += Math.max(1, r / 3)) {
        const gx = clamp(Math.round((u + du) * kx), 0, gImg.w - 1), gy = clamp(Math.round((v + dv) * ky), 0, gImg.h - 1);
        const i = (gy * gImg.w + gx) * 4;
        R += gImg.data[i]; G += gImg.data[i + 1]; B += gImg.data[i + 2]; n++;
      }
    return [R / n, G / n, B / n];
  };

  // ---- trees: tops in the height map, then fill painted forest ----
  const trees = [];
  const tHash = new Map();
  const hkey = (x, z) => Math.floor(x / 6) * 73856 + Math.floor(z / 6);
  const nearTree = (x, z, r) => {
    for (let ix = -1; ix <= 1; ix++)
      for (let iz = -1; iz <= 1; iz++) {
        const cell = tHash.get(hkey(x + ix * 6, z + iz * 6));
        if (cell) for (const t of cell) if (Math.hypot(t.x - x, t.z - z) < r) return true;
      }
    return false;
  };
  const plant = (t) => {
    trees.push(t);
    const k = hkey(t.x, t.z);
    if (!tHash.has(k)) tHash.set(k, []);
    tHash.get(k).push(t);
  };
  const treeOk = (u, v) => {
    const k = cls[Math.floor(v) * W + Math.floor(u)];
    return (k === MC.forest || k === MC.rough || k === MC.long || k === MC.rock) && !inProp(u, v, 2.5);
  };
  const peaks = [];
  const minPeak = m.treeMin || 20;
  for (let v = 2; v < H - 2; v++)
    for (let u = 2; u < W - 2; u++) {
      const i = v * W + u, r = resid[i];
      if (r < minPeak) continue;
      if (r < resid[i - 1] || r < resid[i + 1] || r < resid[i - W] || r < resid[i + W] ||
        r < resid[i - W - 1] || r < resid[i - W + 1] || r < resid[i + W - 1] || r < resid[i + W + 1]) continue;
      peaks.push(i);
    }
  peaks.sort((a, b) => resid[b] - resid[a]);
  for (const i of peaks) {
    const u = i % W, v = Math.floor(i / W);
    if (!treeOk(u, v)) continue;
    const c = toWorld(u + 0.5, v + 0.5);
    if (nearTree(c.x, c.z, 3.4)) continue;
    // Crown size: how far the bump reaches before it falls to 40% of its height.
    const pk = resid[i];
    let sum = 0;
    for (let a = 0; a < 8; a++) {
      const du = Math.cos((a * Math.PI) / 4), dv = Math.sin((a * Math.PI) / 4);
      let d = 1;
      while (d < 7 / s) {
        const uu = Math.round(u + du * d), vv = Math.round(v + dv * d);
        if (uu < 0 || vv < 0 || uu >= W || vv >= H || resid[vv * W + uu] < pk * 0.4) break;
        d++;
      }
      sum += d;
    }
    const cr = clamp((sum / 8) * s, 2, 7);
    // Pine or broadleaf from the painting: dark blue-green crowns are pines.
    const col = paintAvg(u, v, Math.max(1, cr / s / 2));
    let pine;
    if (col) {
      const hue = rgbHue(col[0], col[1], col[2]), lum = (col[0] + col[1] + col[2]) / 3;
      pine = hue > 92 || lum < 62;
    } else pine = rnd() < 0.55;
    const height = pine ? clamp((cr / 0.24) * 0.8, 10, 19) : clamp((cr / 0.36) * 0.9, 8, 15);
    const wide = clamp(cr / (height * (pine ? 0.24 : 0.36)), 0.75, 1.7);
    plant({ x: c.x, z: c.z, kind: pine ? 0 : 1, height, wide });
  }
  // Painted forest the height map didn't pick out still gets trees.
  const SP = 6.5 / s;
  for (let v = SP / 2; v < H; v += SP)
    for (let u = SP / 2; u < W; u += SP) {
      const uu = clamp(u + (rnd() - 0.5) * SP * 0.8, 0, W - 1), vv = clamp(v + (rnd() - 0.5) * SP * 0.8, 0, H - 1);
      if (cls[Math.floor(vv) * W + Math.floor(uu)] !== MC.forest || inProp(uu, vv, 2.5)) continue;
      const c = toWorld(uu, vv);
      if (nearTree(c.x, c.z, 5)) continue;
      const pine = rnd() < 0.55;
      plant({ x: c.x, z: c.z, kind: pine ? 0 : 1, height: pine ? 11 + rnd() * 6 : 9 + rnd() * 5, wide: 1 });
    }
  // Boulders on painted rock.
  const boulders = [];
  const BS = 3.2 / s;
  for (let v = BS / 2; v < H; v += BS)
    for (let u = BS / 2; u < W; u += BS) {
      const uu = clamp(u + (rnd() - 0.5) * BS, 0, W - 1), vv = clamp(v + (rnd() - 0.5) * BS, 0, H - 1);
      if (cls[Math.floor(vv) * W + Math.floor(uu)] !== MC.rock || inProp(uu, vv, 1)) continue;
      const c = toWorld(uu, vv);
      if (nearTree(c.x, c.z, 1.6)) continue;
      boulders.push({ x: c.x, z: c.z, r: 0.45 + rnd() * rnd() * 1.4, rot: rnd() * TAU });
    }

  // ---- the hole: tee, green, pin, centre line ----
  const teeW = { x: ox, z: oz };
  const linePts = (m.line || [m.tee, m.pin || [green.u, green.v]]).map(([u, v]) => { const c = toWorld(u, v); return [c.x, c.z]; });
  const line = makePolyline(linePts);
  const t0 = line.pointAt(0);
  const gw = green ? toWorld(green.u, green.v) : toWorld(m.pin[0], m.pin[1]);
  const pinW = m.pin ? toWorld(m.pin[0], m.pin[1]) : gw;
  let fwN = 0;
  for (let i = 0; i < N; i++) if (cls[i] === MC.fairway) fwN++;
  const hw = clamp((fwN * s * s) / Math.max(1, line.length) / 2, 8, 40);
  const corners = [toWorld(0, 0), toWorld(W, 0), toWorld(0, H), toWorld(W, H)];
  const bbox = {
    minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)),
    minZ: Math.min(...corners.map((c) => c.z)), maxZ: Math.max(...corners.map((c) => c.z)),
  };
  const fences = (m.fences || []).map((f) => f.map(([u, v]) => toWorld(u, v)));

  return {
    def, W, H, s, toWorld, toImage, bbox, margin,
    tee: teeW, teeDir: { x: t0.ux, z: t0.uz },
    green: { x: gw.x, z: gw.z, r: green ? Math.sqrt(green.n / Math.PI) * s : 12 },
    pin: pinW, line, hw,
    weight, height, surface, waterLevel, paint,
    trees, boulders, props, fences,
    levelGrid: level, hasWater,
    // Heights are relative until the course matches them to the land around.
    get offset() { return offset; },
    setOffset(o) { offset = o; },
  };
}
