// Sanity checks for the whole course, plus an optional top-down map image.
// Usage: node tests/course-check.js [outDir]
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const G = require('./load')();

const outDir = process.argv[2];
const COLORS = {
  [G.S_TEE]: [120, 190, 90], [G.S_FAIRWAY]: [95, 170, 70], [G.S_FRINGE]: [80, 160, 80],
  [G.S_GREEN]: [110, 200, 100], [G.S_ROUGH]: [55, 110, 40], [G.S_DEEP]: [40, 80, 30],
  [G.S_SAND]: [225, 205, 150], [G.S_WATER]: [50, 100, 170], [G.S_OOB]: [0, 0, 0], [G.S_PATH]: [190, 182, 160],
};

function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const { mapImages } = require('./png');
const t0 = Date.now();
const course = G.buildCourse(G.COURSE, { images: mapImages(path.join(__dirname, '..')) });
const buildMs = Date.now() - t0;
const b = course.bounds;
let problems = 0, par = 0;
console.log(`Course ${b.maxX - b.minX} x ${b.maxZ - b.minZ} yds, ${course.trees.length} trees, ${course.paths.length} cart paths, built in ${buildMs}ms`);
course.holes.forEach((h, i) => {
  par += h.par;
  const issues = [];
  if (course.surface(h.tee.x, h.tee.z) !== G.S_TEE) issues.push('tee not on tee surface (' + course.surface(h.tee.x, h.tee.z) + ')');
  if (course.surface(h.pin.x, h.pin.z) !== G.S_GREEN) issues.push('pin not on green');
  if (h.greenEdge(h.pin.x, h.pin.z) - Math.hypot(h.pin.x - h.green.x, h.pin.z - h.green.z) < 3) issues.push('pin within 3yd of green edge');
  for (const w of h.waters) if (!isFinite(w.level)) issues.push('bad water level');
  const next = course.holes[i + 1];
  const walk = next ? Math.hypot(next.tee.x - h.green.x, next.tee.z - h.green.z) : 0;
  if (h.def.map && !h.map) issues.push('painted maps did not load (playing the fallback)');
  if (h.map) {
    const m = h.map;
    console.log(`   painted: ${m.W}x${m.H}px at ${m.s}yd/px, ${m.trees.length} trees, ${m.boulders.length} boulders, ${m.props.length} props, height offset ${m.offset.toFixed(2)}yd, fairway half-width ${m.hw.toFixed(1)}yd`);
  }
  console.log(`#${i + 1} ${h.name.padEnd(16)} par ${h.par} ${String(h.yards).padStart(3)}yd  tee (${h.tee.x.toFixed(0)},${h.tee.z.toFixed(0)})  green (${h.green.x.toFixed(0)},${h.green.z.toFixed(0)})  walk to next ${walk.toFixed(0)}yd  ${issues.join('; ') || 'ok'}`);
  problems += issues.length;
});

// Holes must not overlap: compare sampled centre lines (ignoring the
// green -> next tee hand-over between consecutive holes).
const samples = course.holes.map((h) => {
  const pts = [];
  for (let s = 0; s <= h.length; s += 5) { const p = h.line.pointAt(s); pts.push({ x: p.x, z: p.z, s }); }
  return pts;
});
for (let i = 0; i < course.holes.length; i++)
  for (let j = i + 1; j < course.holes.length; j++) {
    let best = Infinity, at = null;
    for (const p of samples[i]) for (const q of samples[j]) {
      if (j === i + 1 && (p.s > course.holes[i].length - 45 || q.s < 45)) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < best) { best = d; at = p; }
    }
    const need = course.holes[i].hw + course.holes[j].hw + 35;
    if (best < need) {
      console.log(`  ! holes ${i + 1} and ${j + 1} come within ${best.toFixed(0)}yd (need ${need.toFixed(0)}) near (${at.x.toFixed(0)},${at.z.toFixed(0)})`);
      problems++;
    }
  }

// Other holes must stay out of painted holes (their centre line plus half a
// fairway and some rough), except where play hands over from one to the next.
for (const [mi, mh] of course.holes.entries()) {
  if (!mh.map) continue;
  const m = mh.map;
  course.holes.forEach((h, j) => {
    if (j === mi) return;
    let worst = Infinity, at = null;
    for (const p of samples[j]) {
      if (j === mi + 1 && p.s < 45) continue;
      if (j === mi - 1 && p.s > h.length - 45) continue;
      const q = m.toImage(p.x, p.z);
      const dx = Math.max(-q.u, q.u - m.W, 0) * m.s, dz = Math.max(-q.v, q.v - m.H, 0) * m.s;
      const inside = q.u > 0 && q.v > 0 && q.u < m.W && q.v < m.H;
      const d = inside ? -Math.min(q.u, m.W - q.u, q.v, m.H - q.v) * m.s : Math.hypot(dx, dz);
      if (d < worst) { worst = d; at = p; }
    }
    if (worst < h.hw + 6) {
      console.log(`  ! hole ${j + 1} comes within ${worst.toFixed(0)}yd of painted hole ${mi + 1} (need ${(h.hw + 6).toFixed(0)}) near (${at.x.toFixed(0)},${at.z.toFixed(0)})`);
      problems++;
    }
  });
}

// Rough painting cost estimate.
const t1 = Date.now();
let n = 0;
for (let z = b.minZ; z < b.maxZ; z += 2) for (let x = b.minX; x < b.maxX; x += 2) { course.surface(x, z); n++; }
const per = (Date.now() - t1) / n;
console.log(`surface(): ${(per * 1000).toFixed(2)}us per call -> ~${(per * (b.maxX - b.minX) * (b.maxZ - b.minZ) * 9 / 1000).toFixed(1)}s for a full 3px/yd paint`);
const t2 = Date.now();
n = 0;
for (let z = b.minZ; z < b.maxZ; z += 3) for (let x = b.minX; x < b.maxX; x += 3) { course.H(x, z); n++; }
console.log(`H(): ${((Date.now() - t2) / n * 1000).toFixed(2)}us per call`);

if (outDir) {
  const scale = 0.75;
  const w = Math.round((b.maxX - b.minX) * scale), hgt = Math.round((b.maxZ - b.minZ) * scale);
  const rgb = Buffer.alloc(w * hgt * 3);
  for (let py = 0; py < hgt; py++)
    for (let px = 0; px < w; px++) {
      const x = b.minX + (px + 0.5) / scale, z = b.minZ + (py + 0.5) / scale;
      const c = COLORS[course.surface(x, z)];
      const shade = 0.78 + 0.22 * Math.sin(course.H(x, z) * 2);
      const o = (py * w + px) * 3;
      rgb[o] = c[0] * shade; rgb[o + 1] = c[1] * shade; rgb[o + 2] = c[2] * shade;
    }
  const dot = (x, z, col, r) => {
    const px = Math.round((x - b.minX) * scale), py = Math.round((z - b.minZ) * scale);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = px + dx, Y = py + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= hgt) continue;
      const o = (Y * w + X) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
    }
  };
  for (const t of course.trees) dot(t.x, t.z, [18, 45, 18], 1);
  for (const h of course.holes) { dot(h.pin.x, h.pin.z, [255, 0, 0], 2); dot(h.tee.x, h.tee.z, [255, 255, 255], 2); }
  const cl = course.clubhouse;
  for (let dz = -9; dz <= 9; dz += 1) for (let dx = -15; dx <= 15; dx += 1) dot(cl.x + dx, cl.z + dz, [140, 60, 50], 0);
  fs.mkdirSync(outDir, { recursive: true });
  writePng(path.join(outDir, 'course.png'), w, hgt, rgb);
}
console.log(`Total par ${par}. ${problems ? problems + ' problem(s)' : 'All checks OK'}`);
process.exit(problems ? 1 : 0);
