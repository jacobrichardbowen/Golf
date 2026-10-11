// ---------------------------------------------------------------------------
// The Workshop: browse every model and texture the game uses, download any of
// them (as .glb / .png), and swap in your own. The selected asset spins on a
// turntable drawn with the game's renderer behind the panels.
// ---------------------------------------------------------------------------

const Workshop = (() => {
  let isOpen = false, renderer = null;
  let scene, camera, pivot, current = null, currentId = null, previewGolfer = null;
  const orbit = { yaw: 0.7, pitch: 0.32, dist: 4, target: new THREE.Vector3(0, 0.5, 0), spin: true };
  const thumbs = new Map();
  let thumbQueue = [];
  const GROUPS = ['Course', 'Clubs', 'Vehicles', 'Characters', 'Textures'];

  const $ = (id) => document.getElementById(id);
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14261c);
    scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x3a4a30, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 1.0);
    rim.position.set(-4, 3, -5);
    scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x24402d }));
    disc.name = 'turntable';
    scene.add(disc);
    scene.userData.disc = disc;
    pivot = new THREE.Group();
    scene.add(pivot);
    camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
  }

  // Something to look at for an asset id.
  function previewObject(id) {
    const def = Assets.get(id);
    previewGolfer = null;
    if (def.kind === 'rig') {
      previewGolfer = Golfer.create(CHARACTERS[1]);
      previewGolfer.update(0.016, { mode: 'idle', snap: true });
      return previewGolfer.root;
    }
    if (def.kind === 'texture') {
      const img = Assets.image(id) || def.build();
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      tex.colorSpace = id === 'tex-water' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      const w = img.width || 256, h = img.height || 256;
      const aspect = w / h;
      let mat;
      if (id === 'tex-grass') {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(3, 3);
        mat = new THREE.MeshLambertMaterial({ color: 0x6aa84f, map: tex });
      } else if (id === 'tex-water') {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2);
        mat = new THREE.MeshStandardMaterial({ color: 0x2a5f78, roughness: 0.1, metalness: 0.1, normalMap: tex });
      } else if (id === 'tex-cloud') {
        mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      } else {
        mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      }
      const g = new THREE.Group();
      if (id === 'tex-cloud') {
        const back = new THREE.Mesh(new THREE.PlaneGeometry(2.4 * aspect, 2.4), new THREE.MeshBasicMaterial({ color: 0x5b93cf }));
        back.position.set(0, 1, -0.01);
        g.add(back);
      }
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * Math.min(aspect, 2), 2 / Math.max(1, aspect / 2)), mat);
      plane.position.y = 1;
      g.add(plane);
      return g;
    }
    return Assets.object(id);
  }

  function frame(obj, id) {
    const def = Assets.get(id);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    // Trees are unit height: show them at a typical size.
    if (def.fit === 'height') { obj.scale.setScalar(12); obj.updateMatrixWorld(true); box.setFromObject(obj); }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    orbit.target.copy(center);
    // Fit it into the part of the screen the panels leave free.
    const W = renderer.domElement.clientWidth || 800, H = renderer.domElement.clientHeight || 600;
    const top = W > 760 ? 70 : $('wsSide').offsetHeight;
    const free = clamp((H - $('wsDetail').offsetHeight - top) / H, 0.3, 1);
    orbit.dist = r / Math.sin((camera.fov * DEG) / 2) / free * (def.kind === 'texture' ? 1.15 : 1.08);
    orbit.pitch = def.kind === 'texture' ? 0.05 : 0.32;
    orbit.yaw = def.kind === 'texture' ? 0 : 0.7;
    const disc = scene.userData.disc;
    disc.visible = def.kind !== 'texture';
    disc.scale.setScalar(Math.max(size.x, size.z) * 0.8 + 0.2);
    disc.position.y = box.min.y - 0.002;
  }

  function show(id) {
    if (current) { pivot.remove(current); }
    currentId = id;
    current = previewObject(id);
    pivot.add(current);
    frame(current, id);
    renderDetail();
    document.querySelectorAll('.ws-item').forEach((el) => el.classList.toggle('on', el.dataset.id === id));
  }

  function badge(id) {
    const c = Assets.info(id);
    if (!c) return '<span class="ws-badge">Built-in</span>';
    return c.source === 'local' ? '<span class="ws-badge mine">Yours</span>' : '<span class="ws-badge proj">Project</span>';
  }

  function renderList() {
    const list = $('wsList');
    const defs = Assets.list();
    list.innerHTML = GROUPS.map((g) => {
      const items = defs.filter((d) => d.group === g);
      if (!items.length) return '';
      return `<h3>${g}</h3><ul>` + items.map((d) => `<li><button class="ws-item" data-id="${d.id}"><img alt="" src="${thumbs.get(d.id) || ''}"><span><b>${d.name}</b>${badge(d.id)}</span></button></li>`).join('') + '</ul>';
    }).join('');
    list.querySelectorAll('.ws-item').forEach((el) => el.addEventListener('click', () => show(el.dataset.id)));
    if (currentId) list.querySelector(`[data-id="${currentId}"]`)?.classList.add('on');
  }

  function renderDetail() {
    const def = Assets.get(currentId);
    const c = Assets.info(currentId);
    $('wsName').textContent = def.name;
    $('wsBadge').innerHTML = badge(currentId);
    $('wsNote').textContent = def.note || '';
    const ext = def.kind === 'texture' ? '.png' : '.glb';
    $('wsFile').textContent = c ? `${c.source === 'local' ? 'Your file' : 'Project file'}: ${c.name} (${fmtSize(c.size)})` : `Built-in. Download it as ${currentId}${ext} to start from it.`;
    $('wsDownload').textContent = 'Download ' + (c ? c.name.split('.').pop().toUpperCase() : ext.slice(1).toUpperCase());
    $('wsReset').disabled = !c || c.source !== 'local';
    $('wsFileInput').accept = def.kind === 'texture' ? 'image/png,image/jpeg,image/webp' : '.glb,.gltf,model/gltf-binary';
    status('');
  }

  function status(msg, bad) {
    const el = $('wsStatus');
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
  }

  // Thumbnails, one per frame so opening the Workshop stays snappy.
  let rt = null;
  function makeThumb(id) {
    const W = 160, H = 120;
    if (!rt) rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });
    const saveCur = current, saveId = currentId;
    const obj = previewObject(id);
    if (current) pivot.remove(current);
    pivot.add(obj);
    current = obj; currentId = id;
    frame(obj, id);
    const camSave = camera.aspect;
    camera.clearViewOffset();
    camera.aspect = W / H;
    placeCamera(0.7);
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(null);
    camera.aspect = camSave;
    camera.updateProjectionMatrix();
    pivot.remove(obj);
    current = saveCur; currentId = saveId;
    if (current) { pivot.add(current); frame(current, currentId); }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    g.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    thumbs.set(id, url);
    const el = document.querySelector(`.ws-item[data-id="${id}"] img`);
    if (el) el.src = url;
  }

  function placeCamera(yaw) {
    const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
    camera.position.set(
      orbit.target.x + Math.sin(yaw) * cp * orbit.dist,
      orbit.target.y + sp * orbit.dist,
      orbit.target.z + Math.cos(yaw) * cp * orbit.dist,
    );
    camera.lookAt(orbit.target);
  }

  // ---------- input ----------
  let drag = null;
  function onDown(e) {
    if (!isOpen) return;
    drag = { x: e.clientX, y: e.clientY };
    orbit.spin = false;
  }
  function onMove(e) {
    if (!isOpen || !drag) return;
    orbit.yaw -= (e.clientX - drag.x) * 0.008;
    orbit.pitch = clamp(orbit.pitch + (e.clientY - drag.y) * 0.006, -0.3, 1.4);
    drag = { x: e.clientX, y: e.clientY };
  }
  function onUp() { drag = null; }
  function onWheel(e) {
    if (!isOpen) return;
    orbit.dist *= Math.exp(e.deltaY * 0.001);
  }

  async function doDownload() {
    status('Preparing the file…');
    try {
      const f = await Assets.download(currentId);
      const r = await Assets.saveFile(f.filename, f.data);
      status(r === 'declined' ? 'Download cancelled.' : `Saved ${f.filename}${/\.(glb|gltf)$/.test(f.filename) && (await Assets.downloadsCap()) ? ' (inside a .zip)' : ''}.`);
    } catch (e) {
      status('Could not create the file: ' + (e.message || e), true);
    }
  }
  async function doReplace(file) {
    if (!file) return;
    status(`Reading ${file.name}…`);
    try {
      const saved = await Assets.replace(currentId, file);
      show(currentId);
      makeThumb(currentId);
      renderList();
      status(saved ? `Using ${file.name}. It’s saved in this browser.`
        : `Using ${file.name}, but this browser won’t let the game keep it. Use Export my assets to keep a copy.`, !saved);
    } catch (e) {
      status('That file didn’t work: ' + (e.message || e), true);
    }
  }
  async function doReset() {
    await Assets.reset(currentId);
    show(currentId);
    makeThumb(currentId);
    renderList();
    status('Back to the built-in version.');
  }
  async function doExport() {
    const json = Assets.exportPack();
    const n = JSON.parse(json).assets.length;
    if (!n) { status('You haven’t replaced anything yet.'); return; }
    try {
      const r = await Assets.saveFile('pinehaven-assets.json', new Blob([json], { type: 'application/json' }));
      status(r === 'declined' ? 'Export cancelled.' : `Exported ${n} asset${n === 1 ? '' : 's'}.`);
    } catch (e) { status('Could not export: ' + (e.message || e), true); }
  }
  async function doImport(file) {
    if (!file) return;
    try {
      const n = await Assets.importPack(await file.text());
      thumbQueue = Assets.list().map((d) => d.id);
      renderList();
      show(currentId);
      status(`Imported ${n} asset${n === 1 ? '' : 's'}.`);
    } catch (e) { status('Could not import that pack: ' + (e.message || e), true); }
  }

  let onClose = null;
  function open(r, closeCb) {
    renderer = r;
    onClose = closeCb;
    if (!scene) {
      setupScene();
      const canvas = renderer.domElement;
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      canvas.addEventListener('wheel', onWheel, { passive: true });
      $('wsDownload').addEventListener('click', doDownload);
      $('wsFileInput').addEventListener('change', (e) => { doReplace(e.target.files[0]); e.target.value = ''; });
      $('wsReset').addEventListener('click', doReset);
      $('wsExport').addEventListener('click', doExport);
      $('wsImport').addEventListener('change', (e) => { doImport(e.target.files[0]); e.target.value = ''; });
      $('wsDone').addEventListener('click', close);
      Assets.downloadsCap();
    }
    scene.environment = World.scene.environment;
    isOpen = true;
    document.getElementById('workshop').hidden = false;
    renderList();
    show(currentId || GROUPS.map((g) => Assets.list().find((d) => d.group === g)).find(Boolean).id);
    thumbQueue = Assets.list().map((d) => d.id).filter((id) => !thumbs.has(id));
  }

  function close() {
    isOpen = false;
    document.getElementById('workshop').hidden = true;
    if (onClose) onClose(Assets.changed);
  }

  function render(dt) {
    if (!isOpen) return false;
    if (thumbQueue.length) makeThumb(thumbQueue.shift());
    const canvas = renderer.domElement;
    const W = canvas.clientWidth, H = Math.max(1, canvas.clientHeight);
    camera.aspect = W / H;
    // Centre the turntable in the space the panels leave free.
    const side = $('wsSide'), det = $('wsDetail');
    if (W > 760) camera.setViewOffset(W, H, -side.offsetWidth / 2, det.offsetHeight / 2 - 30, W, H);
    else camera.setViewOffset(W, H, 0, (det.offsetHeight - side.offsetHeight) / 2, W, H);
    camera.updateProjectionMatrix();
    if (orbit.spin) orbit.yaw += dt * 0.35;
    if (previewGolfer) previewGolfer.update(dt, { mode: 'idle' });
    placeCamera(orbit.yaw);
    renderer.render(scene, camera);
    return true;
  }

  return { open, close, render, get isOpen() { return isOpen; } };
})();
