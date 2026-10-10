// ---------------------------------------------------------------------------
// Small math helpers, seeded randomness and noise. Pure JS (no THREE) so the
// physics and terrain code can also be exercised from Node tests.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Classic 2D gradient (Perlin) noise, roughly in [-1, 1].
function makePerlin(seed) {
  const rnd = mulberry32(seed * 9973 + 17);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rnd() * TAU;
    gx[i] = Math.cos(a); gy[i] = Math.sin(a);
  }
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const n00 = gx[aa] * xf + gy[aa] * yf;
    const n10 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const n01 = gx[ab] * xf + gy[ab] * (yf - 1);
    const n11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41;
  };
}

function fbm(noise, x, y, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq + i * 31.7, y * freq - i * 17.3);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// Cheap integer hash -> [0,1), used for per-pixel color jitter.
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Closest point on a polyline. Returns distance, distance-along-path (s),
// and the local direction of the path at that point.
function makePolyline(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    segs.push({ ax, az, dx, dz, len, s0: total, ux: dx / len, uz: dz / len });
    total += len;
  }
  const out = { d: 0, s: 0, px: 0, pz: 0, ux: 0, uz: -1 };
  function query(x, z) {
    let best = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.len * g.len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = g.ax + g.dx * t, pz = g.az + g.dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2;
        out.s = g.s0 + g.len * t; out.px = px; out.pz = pz; out.ux = g.ux; out.uz = g.uz;
      }
    }
    out.d = Math.sqrt(best);
    return out;
  }
  function pointAt(s) {
    s = clamp(s, 0, total);
    for (const g of segs) {
      if (s <= g.s0 + g.len) {
        const t = (s - g.s0) / g.len;
        return { x: g.ax + g.dx * t, z: g.az + g.dz * t, ux: g.ux, uz: g.uz };
      }
    }
    const g = segs[segs.length - 1];
    return { x: g.ax + g.dx, z: g.az + g.dz, ux: g.ux, uz: g.uz };
  }
  return { query, pointAt, length: total, segs };
}

// Normalised distance inside a rotated ellipse (1.0 = on the edge).
function ellipseDist(e, x, z) {
  const dx = x - e.x, dz = z - e.z;
  const c = e._cos, s = e._sin;
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return Math.sqrt((lx * lx) / (e.rx * e.rx) + (lz * lz) / (e.rz * e.rz));
}
function prepEllipse(e) {
  const r = (e.rot || 0) * DEG;
  e._cos = Math.cos(r); e._sin = Math.sin(r);
  e._bound = Math.max(e.rx, e.rz);
  return e;
}

// Yaw convention used throughout: yaw 0 looks down -Z, positive yaw turns right.
const dirFromYaw = (yaw) => ({ x: Math.sin(yaw), z: -Math.cos(yaw) });
const yawFromDir = (x, z) => Math.atan2(x, -z);
const wrapAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
