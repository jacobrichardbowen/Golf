// Minimal PNG decoder for the Node tests (8-bit grey, grey+alpha, RGB, RGBA,
// and palette images; not interlaced). Returns { w, h, data } with RGBA bytes.
const fs = require('fs');
const zlib = require('zlib');

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), kind = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * ch, o = i * 4;
    if (type === 0) { data[o] = data[o + 1] = data[o + 2] = px[p]; data[o + 3] = 255; }
    else if (type === 4) { data[o] = data[o + 1] = data[o + 2] = px[p]; data[o + 3] = px[p + 1]; }
    else if (type === 2) { data[o] = px[p]; data[o + 1] = px[p + 1]; data[o + 2] = px[p + 2]; data[o + 3] = 255; }
    else if (type === 6) { data[o] = px[p]; data[o + 1] = px[p + 1]; data[o + 2] = px[p + 2]; data[o + 3] = px[p + 3]; }
    else { const k = px[p]; data[o] = palette[k * 3]; data[o + 1] = palette[k * 3 + 1]; data[o + 2] = palette[k * 3 + 2]; data[o + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { w, h, data };
}

// Map images by asset id (map-<name> -> src/maps/<name>.png, or an override
// in assets/<asset-id>.png). JPEGs aren't decoded here (only the painting is one).
function mapImages(root) {
  const path = require('path');
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    let img = null;
    for (const f of [path.join(root, 'assets', id + '.png'), path.join(root, 'src', 'maps', id.replace(/^map-/, '') + '.png')]) {
      if (fs.existsSync(f)) { img = decodePng(fs.readFileSync(f)); break; }
    }
    cache.set(id, img);
    return img;
  };
}

module.exports = { decodePng, mapImages };
