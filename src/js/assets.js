// ---------------------------------------------------------------------------
// Asset registry. Every model and texture the game draws is registered here
// with a built-in (procedural) default. Players can swap any of them for
// their own glTF/GLB models or images in the Workshop.
//
// Where a custom asset comes from, in priority order:
//   1. "local"   uploaded in the Workshop, kept in this browser (IndexedDB)
//   2. "project" files in the repo's assets/ folder, baked into Golf.html
//   3. the built-in default
// A local "removed" record means "use the built-in one" even though the
// project has a file. Local changes stay pending until they are committed to
// the project (see publish.js); once a build includes them they're dropped.
//
// Units: glTF files are in meters (+Y up, front faces +Z). The game works in
// yards, so models are scaled on the way in and out.
// ---------------------------------------------------------------------------

const Assets = (() => {
  const YD_PER_M = 1 / 0.9144, M_PER_YD = 0.9144;
  const defs = new Map();
  const custom = new Map();     // id -> { source, name, type, bytes, size, scene?, image? }
  const project = new Map();    // id -> raw record from the build (for "reset")
  const partsCache = new Map();
  const localRecs = new Map();  // id -> IndexedDB record: an upload, or { removed: true }
  let changed = false;

  // def: { kind: 'model'|'rig'|'texture', group, name, note, fit: 'real'|'height', build(), joints? }
  function define(id, def) { defs.set(id, Object.assign({ id, fit: 'real' }, def)); }
  const list = () => [...defs.values()];
  const get = (id) => defs.get(id);
  const isCustom = (id) => custom.has(id);
  const info = (id) => custom.get(id) || null;

  // ---------- storage ----------
  const DB = 'pinehaven-assets', STORE = 'assets';
  function openDb() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('IndexedDB unavailable')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function dbDo(mode, fn) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const dbAll = () => dbDo('readonly', (s) => s.getAll()).catch(() => []);
  const dbPut = (rec) => dbDo('readwrite', (s) => s.put(rec));
  const dbDel = (id) => dbDo('readwrite', (s) => s.delete(id));

  // ---------- encoding helpers ----------
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }
  function bufToB64(buf) {
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const extOf = (name) => (name.split('.').pop() || '').toLowerCase();

  // ---------- parsing ----------
  function parseModel(bytes) {
    return new Promise((res, rej) => {
      if (!window.GLTFKit) { rej(new Error('glTF support is missing from this build')); return; }
      new GLTFKit.GLTFLoader().parse(bytes, '', (gltf) => {
        const wrap = new THREE.Group();
        gltf.scene.scale.multiplyScalar(YD_PER_M);
        wrap.add(gltf.scene);
        wrap.updateMatrixWorld(true);
        res(wrap);
      }, (err) => rej(err instanceof Error ? err : new Error(String(err && err.message || err))));
    });
  }
  function decodeImage(bytes, type) {
    const blob = new Blob([bytes], { type: type || 'image/png' });
    // No colour management: map colours have to come back exactly as painted.
    if (window.createImageBitmap) return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not read that image'));
      img.src = URL.createObjectURL(blob);
    });
  }

  async function load(rec, source) {
    const def = defs.get(rec.id);
    if (!def) return;
    const entry = { source, name: rec.name, type: rec.type, bytes: rec.data, size: rec.data.byteLength };
    if (def.kind === 'texture') entry.image = await decodeImage(rec.data, rec.type);
    else entry.scene = await parseModel(rec.data.slice(0));
    custom.set(rec.id, entry);
    partsCache.delete(rec.id);
  }

  function sameBytes(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a), y = new Uint8Array(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  // Built-in hole maps ship with the game (src/maps); keyed by asset id.
  const builtinMaps = new Map();
  const builtinMapFiles = new Map();
  const builtinMap = (id) => builtinMaps.get(id) || null;

  async function init() {
    const maps = window.__PINEHAVEN_MAPS || {};
    for (const def of defs.values()) {
      if (!def.map) continue;
      const f = maps[def.id.replace(/^map-/, '')];
      if (!f) continue;
      const bytes = b64ToBuf(f.b64);
      builtinMapFiles.set(def.id, { name: f.name, type: f.type, bytes });
      try { builtinMaps.set(def.id, await decodeImage(bytes, f.type)); } catch (e) { console.warn('Could not read built-in map', def.id, e); }
    }
    const emb = window.__PINEHAVEN_ASSETS || {};
    for (const id of Object.keys(emb)) {
      const rec = { id, name: emb[id].name, type: emb[id].type, data: b64ToBuf(emb[id].b64) };
      project.set(id, rec);
      try { await load(rec, 'project'); } catch (e) { console.warn('Could not load project asset', id, e); }
    }
    for (const rec of await dbAll()) {
      if (!defs.has(rec.id)) continue;
      const proj = project.get(rec.id);
      // Already part of this build: the local copy has done its job.
      const inBuild = rec.removed ? !proj && rec.committed : proj && sameBytes(proj.data, rec.data);
      if (inBuild) { dbDel(rec.id).catch(() => {}); continue; }
      localRecs.set(rec.id, rec);
      if (rec.removed) { custom.delete(rec.id); partsCache.delete(rec.id); continue; }
      try { await load(rec, 'local'); } catch (e) { console.warn('Could not load saved asset', rec.id, e); }
    }
  }

  // What an asset is using now, and whether that's waiting to be committed.
  function state(id) {
    const rec = localRecs.get(id);
    const hasProject = project.has(id);
    if (rec && !rec.removed) return { using: 'local', pending: !rec.committed, hasProject };
    if (rec && rec.removed) return { using: 'builtin', pending: !rec.committed, removing: true, hasProject };
    return { using: hasProject ? 'project' : 'builtin', pending: false, hasProject };
  }
  // Changes in this browser that the project doesn't have yet.
  function pending() {
    const out = [];
    for (const rec of localRecs.values()) {
      if (rec.committed) continue;
      if (rec.removed) out.push({ id: rec.id, kind: 'remove' });
      else out.push({ id: rec.id, kind: 'write', name: rec.name, ext: extOf(rec.name), data: rec.data });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  async function markCommitted(ids, sha) {
    for (const id of ids) {
      const rec = localRecs.get(id);
      if (!rec || rec.committed) continue;
      rec.committed = sha;
      try { await dbPut(rec); } catch (e) { /* kept in memory for this visit */ }
    }
  }

  // ---------- geometry helpers ----------
  // Flatten a hierarchy into meshes with their transforms baked in, relative to `root`.
  function flatten(root) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const out = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!g.attributes.normal) g.computeVertexNormals();
      out.push({ geometry: g, material: o.material, name: o.name });
    });
    return out;
  }
  function fitToUnitHeight(parts) {
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    const h = Math.max(1e-6, box.max.y - box.min.y);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    for (const p of parts) {
      p.geometry.translate(-cx, -box.min.y, -cz);
      p.geometry.scale(1 / h, 1 / h, 1 / h);
      p.geometry.computeBoundingSphere();
    }
    return parts;
  }

  // Meshes for instancing: [{ geometry, material, name }]
  function parts(id) {
    if (partsCache.has(id)) return partsCache.get(id);
    const def = defs.get(id);
    const c = custom.get(id);
    let ps = flatten(c ? c.scene : def.build());
    if (def.fit === 'height') ps = fitToUnitHeight(ps);
    partsCache.set(id, ps);
    return ps;
  }

  // A fresh object to place in the scene (yards). Custom models keep their
  // node hierarchy and names; height-fitted ones are normalized.
  function object(id) {
    const def = defs.get(id);
    const c = custom.get(id);
    if (!c) return def.build();
    if (def.fit === 'height') {
      const g = new THREE.Group();
      g.name = id;
      for (const p of parts(id)) {
        const m = new THREE.Mesh(p.geometry, p.material);
        m.name = p.name;
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
      return g;
    }
    const g = c.scene.clone(true);
    g.name = id;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  // For rigged characters: joint name -> list of meshes to hang off that joint.
  // Meshes are re-expressed in each joint's frame (without the joint's scale).
  function rigParts(id) {
    const c = custom.get(id), def = defs.get(id);
    if (!c || !def.joints) return null;
    const scene = c.scene;
    scene.updateMatrixWorld(true);
    // Match joints by their letters only: the glTF loader drops the dots
    // ("thigh.L" arrives as "thighL"), and Blender (".001") and three.js ("_1")
    // number duplicate names. An empty wins over a mesh of the same name.
    const key = (n) => (n || '').replace(/[^a-z]/gi, '').toLowerCase();
    const wanted = new Map(def.joints.map((j) => [key(j), j]));
    const byName = new Map();
    scene.traverse((o) => {
      const n = wanted.get(key(o.name));
      if (!n) return;
      const had = byName.get(n);
      if (!had || (had.isMesh && !o.isMesh)) byName.set(n, o);
    });
    const isJoint = (o) => [...byName.values()].includes(o);
    const out = new Map();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const [name, joint] of byName) {
      joint.matrixWorld.decompose(p, q, s);
      const inv = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).invert();
      const list = [];
      const visit = (o) => {
        for (const ch of o.children) {
          if (isJoint(ch)) continue; // belongs to a child joint
          if (ch.isMesh) {
            const g = ch.geometry.clone();
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, ch.matrixWorld));
            if (!g.attributes.normal) g.computeVertexNormals();
            const mats = Array.isArray(ch.material) ? ch.material.map((m) => m.clone()) : ch.material.clone();
            const mesh = new THREE.Mesh(g, mats);
            mesh.name = ch.name;
            mesh.castShadow = true;
            list.push(mesh);
          }
          visit(ch);
        }
      };
      if (joint.isMesh) {
        const g = joint.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, joint.matrixWorld));
        const mesh = new THREE.Mesh(g, Array.isArray(joint.material) ? joint.material.map((m) => m.clone()) : joint.material.clone());
        mesh.castShadow = true;
        list.push(mesh);
      }
      visit(joint);
      out.set(name, list);
    }
    return out;
  }

  // Custom texture (or null to use the built-in one).
  function texture(id) {
    const c = custom.get(id);
    if (!c || !c.image) return null;
    const t = new THREE.Texture(c.image);
    t.needsUpdate = true;
    return t;
  }
  function image(id) {
    const c = custom.get(id);
    return c && c.image ? c.image : null;
  }

  // Raw RGBA pixels of an image asset (yours, the project's or the built-in one).
  const pixelCache = new Map();
  function pixels(id) {
    const def = defs.get(id);
    if (!def) return null;
    const c = custom.get(id);
    const src = c && c.image ? c.image : def.map ? builtinMap(id) : def.build();
    if (!src) return null;
    if (pixelCache.has(id) && pixelCache.get(id).src === src) return pixelCache.get(id).px;
    const w = src.width, h = src.height;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0);
    const px = { w, h, data: g.getImageData(0, 0, w, h).data };
    pixelCache.set(id, { src, px });
    return px;
  }

  // ---------- export ----------
  // Deep copy of a hierarchy, converted from yards to meters.
  function toMeters(obj) {
    const copy = obj.clone(true);
    copy.traverse((o) => {
      o.position.multiplyScalar(M_PER_YD);
      if (o.isMesh) {
        o.geometry = o.geometry.clone();
        o.geometry.scale(M_PER_YD, M_PER_YD, M_PER_YD);
      }
    });
    return copy;
  }
  function exportGLB(obj) {
    return new Promise((res, rej) => {
      if (!window.GLTFKit) { rej(new Error('glTF support is missing from this build')); return; }
      const scene = new THREE.Scene();
      scene.add(toMeters(obj));
      new GLTFKit.GLTFExporter().parse(scene, (out) => res(out), (err) => rej(err), { binary: true, onlyVisible: false });
    });
  }
  function canvasToPng(canvas) {
    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
  }

  // The file a player downloads for an asset: their own upload as-is, or
  // the built-in default exported fresh.
  async function download(id) {
    const def = defs.get(id), c = custom.get(id);
    if (c) return { filename: c.name, data: new Blob([c.bytes], { type: c.type }) };
    if (def.map && builtinMapFiles.has(id)) {
      const f = builtinMapFiles.get(id);
      return { filename: id + '.' + extOf(f.name), data: new Blob([f.bytes], { type: f.type }) };
    }
    if (def.kind === 'texture') return { filename: id + '.png', data: await canvasToPng(def.build()) };
    const buf = await exportGLB(def.build());
    return { filename: id + '.glb', data: new Blob([buf], { type: 'model/gltf-binary' }) };
  }

  // ---------- replace / reset ----------
  async function replace(id, file) {
    const def = defs.get(id);
    const data = await file.arrayBuffer();
    const ext = extOf(file.name);
    if (def.kind === 'texture') {
      if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error('Choose a PNG, JPEG or WebP image.');
    } else if (ext !== 'glb' && ext !== 'gltf') {
      throw new Error('Choose a .glb file (or a self-contained .gltf).');
    }
    const type = def.kind === 'texture' ? (file.type || 'image/' + (ext === 'jpg' ? 'jpeg' : ext)) : 'model/gltf-binary';
    const rec = { id, name: file.name, type, data, updated: Date.now() };
    await load(rec, 'local'); // throws if it can't be read
    localRecs.set(id, rec);
    let saved = true;
    try { await dbPut(rec); } catch (e) { saved = false; console.warn('Could not save asset to this browser', e); }
    changed = true;
    return saved;
  }
  // Back to the built-in version. If the project has a file for it (in this
  // build, or one you committed), its removal waits to be committed too.
  async function reset(id) {
    const prior = localRecs.get(id);
    custom.delete(id);
    partsCache.delete(id);
    if (project.has(id) || (prior && !prior.removed && prior.committed)) {
      const tomb = { id, removed: true, updated: Date.now() };
      localRecs.set(id, tomb);
      try { await dbPut(tomb); } catch (e) { /* kept in memory for this visit */ }
    } else {
      localRecs.delete(id);
      try { await dbDel(id); } catch (e) { /* nothing stored */ }
    }
    changed = true;
  }
  // Drop local changes and use the version built into the game.
  async function useProject(id) {
    localRecs.delete(id);
    try { await dbDel(id); } catch (e) { /* nothing stored */ }
    custom.delete(id);
    partsCache.delete(id);
    if (project.has(id)) { try { await load(project.get(id), 'project'); } catch (e) { /* ignore */ } }
    changed = true;
  }

  // ---------- packs ----------
  function exportPack() {
    const assets = [];
    for (const [id, c] of custom) if (c.source === 'local') assets.push({ id, name: c.name, type: c.type, b64: bufToB64(c.bytes) });
    return JSON.stringify({ format: 'pinehaven-assets', version: 1, assets });
  }
  async function importPack(text) {
    const pack = JSON.parse(text);
    if (!pack || pack.format !== 'pinehaven-assets' || !Array.isArray(pack.assets)) throw new Error('That file is not a Pinehaven asset pack.');
    let n = 0;
    for (const a of pack.assets) {
      if (!defs.has(a.id)) continue;
      const rec = { id: a.id, name: a.name, type: a.type, data: b64ToBuf(a.b64), updated: Date.now() };
      await load(rec, 'local');
      localRecs.set(a.id, rec);
      try { await dbPut(rec); } catch (e) { /* ignore */ }
      n++;
    }
    changed = true;
    return n;
  }

  // ---------- saving files ----------
  // Inside the claude.ai viewer, downloads go through the `downloads`
  // capability (which takes a fixed list of file types, so models travel in
  // a .zip). Elsewhere, a plain browser download.
  const ALLOWED = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip'];
  let dlPromise = null;
  function downloadsCap() {
    if (!dlPromise) dlPromise = window.claude && typeof window.claude.use === 'function' ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
    return dlPromise;
  }
  async function saveFile(filename, blob) {
    const dl = await downloadsCap();
    if (dl) {
      let name = filename, data = blob;
      if (!ALLOWED.includes(extOf(filename))) {
        data = zip([{ name: filename, data: new Uint8Array(await blob.arrayBuffer()) }]);
        name = filename.replace(/\.[^.]+$/, '') + '.zip';
      }
      try { await dl.save({ filename: name, data }); return 'saved'; } catch (e) {
        if (e && e.code === 'declined') return 'declined';
        throw new Error(e && e.message ? e.message : 'The download was blocked.');
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  }

  // Minimal "stored" (uncompressed) zip writer.
  const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  function crc32(u8) { let c = -1; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
      h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, u) => a + u.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  return {
    define, list, get, isCustom, info, state, pending, markCommitted, init, parts, object, rigParts, texture, image, pixels, builtinMap,
    download, replace, reset, useProject, exportPack, importPack, saveFile, downloadsCap,
    get changed() { return changed; }, YD_PER_M, M_PER_YD,
  };
})();
