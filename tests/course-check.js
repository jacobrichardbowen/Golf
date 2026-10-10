// Sanity checks for every hole, plus optional top-down layout images.
// Usage: node tests/course-check.js [outDir]
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const G = require('./load')();

const outDir = process.argv[2];
const COLORS = {
  [G.S_TEE]: [120, 190, 90], [G.S_FAIRWAY]: [95, 170, 70], [G.S_FRINGE]: [80, 160, 80],
  [G.S_GREEN]: [110, 200, 100], [G.S_ROUGH]: [55, 110, 40], [G.S_DEEP]: [40, 80, 30],
  [G.S_SAND]: [225, 205, 150], [G.S_WATER]: [50, 100, 170], [G.S_OOB]: [0, 0, 0],
};

function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

let problems = 0;
let par = 0;
G.COURSE.holes.forEach((def, i) => {
  const t0 = Date.now();
  const f = G.buildField(def);
  const ms = Date.now() - t0;
  par += def.par;
  const teeS = f.surface(f.tee.x, f.tee.z);
  const pinS = f.surface(f.pin.x, f.pin.z);
  const pinEdge = f.greenEdge(f.pin.x, f.pin.z) - Math.hypot(f.pin.x - f.green.x, f.pin.z - f.green.z);
  const issues = [];
  if (teeS !== G.S_TEE) issues.push('tee not on tee surface (' + teeS + ')');
  if (pinS !== G.S_GREEN) issues.push('pin not on green');
  if (pinEdge < 3) issues.push('pin within 3yd of green edge');
  for (const w of f.waters) if (!isFinite(w.level)) issues.push('bad water level');
  // Fairway crossing water is only allowed where intended (creeks).
  console.log(
    `#${i + 1} ${def.name.padEnd(16)} par ${def.par} ${String(f.yards).padStart(3)}yd  trees ${String(f.trees.length).padStart(4)}  build ${ms}ms  ` +
      `water ${f.waters.map((w) => w.level.toFixed(1)).join(',') || '-'}  ${issues.join('; ') || 'ok'}`,
  );
  problems += issues.length;

  if (outDir) {
    const b = f.bounds;
    const scale = 1; // px per yard
    const w = Math.round((b.maxX - b.minX) * scale), h = Math.round((b.maxZ - b.minZ) * scale);
    const rgb = Buffer.alloc(w * h * 3);
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const x = b.minX + (px + 0.5) / scale, z = b.minZ + (py + 0.5) / scale;
        const s = f.surface(x, z);
        let c = COLORS[s];
        const hh = f.H(x, z);
        const shade = 0.75 + 0.25 * Math.sin(hh * 2); // contour hint
        const o = (py * w + px) * 3;
        rgb[o] = c[0] * shade; rgb[o + 1] = c[1] * shade; rgb[o + 2] = c[2] * shade;
      }
    for (const t of f.trees) {
      const px = Math.round((t.x - b.minX) * scale), py = Math.round((t.z - b.minZ) * scale);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = px + dx, Y = py + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const o = (Y * w + X) * 3; rgb[o] = 20; rgb[o + 1] = 50; rgb[o + 2] = 20;
      }
    }
    const mark = (x, z, col) => {
      const px = Math.round((x - b.minX) * scale), py = Math.round((z - b.minZ) * scale);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const o = ((py + dy) * w + px + dx) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
      }
    };
    mark(f.pin.x, f.pin.z, [255, 0, 0]);
    mark(f.tee.x, f.tee.z, [255, 255, 255]);
    fs.mkdirSync(outDir, { recursive: true });
    writePng(path.join(outDir, `hole${i + 1}.png`), w, h, rgb);
  }
});
console.log(`Total par ${par}. ${problems ? problems + ' problem(s)' : 'All holes OK'}`);
process.exit(problems ? 1 : 0);
