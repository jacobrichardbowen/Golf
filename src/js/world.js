// ---------------------------------------------------------------------------
// Everything that draws: renderer, sky, chunked course terrain (with grass
// textures that sharpen progressively near the player), trees, water, flags,
// clubhouse, ball, trail and aim guides. Replaceable models and textures are
// registered with Assets so the Workshop can swap them.
// ---------------------------------------------------------------------------

// A late-afternoon sun, low and warm, ahead and to the left down the first hole.
const SUN_DIR = new THREE.Vector3(-0.52, 0.5, -0.69).normalize();
const SUN_HAZE = new THREE.Color(0xffd9a8).multiplyScalar(1.12); // haze looking into the sun (linear)
const SKY = { top: 0x3f7fd0, horizon: 0xbcd7ec, ground: 0x7d9a76 };
const CHUNK = 128;          // terrain chunk size, yards
const LO_PPY = 1;           // first-pass texture density, px per yard
const HI_PPY = 2.5;         // final texture density near the action

// ---------- built-in textures (as canvases) ----------------------------------
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function grassDetailCanvas() {
  const N = 256;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const rnd = mulberry32(99);
  let v = new Float32Array(N * N).map(() => rnd());
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let s = 0;
        for (let k = -1; k <= 1; k++) s += v[y * N + ((x + k + N) % N)] + v[((y + k + N) % N) * N + x];
        o[y * N + x] = s / 6;
      }
    v = o;
  }
  for (let i = 0; i < N * N; i++) {
    const q = clamp((v[i] - 0.5) * 3 + 0.5, 0, 1) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = q;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function waterNormalCanvas() {
  const N = 128;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const waves = [[3, 1, 0.3, 0.2], [1, 4, 0.25, 1.1], [5, -2, 0.12, 2.3], [-2, 7, 0.08, 0.7], [9, 3, 0.05, 4.1]];
  const h = (u, v) => waves.reduce((s, [a, b, amp, ph]) => s + amp * Math.sin(TAU * (a * u + b * v) + ph), 0);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, e = 1 / N;
      const dx = (h(u + e, v) - h(u - e, v)) * 3, dy = (h(u, v + e) - h(u, v - e)) * 3;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

function cloudCanvas(seed) {
  const c = makeCanvas(256, 128);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  for (let i = 0; i < 26; i++) {
    const x = 40 + rnd() * 176, y = 60 + (rnd() - 0.5) * 34, r = 14 + rnd() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return c;
}

function flagClothCanvas() {
  const c = makeCanvas(128, 84);
  const g = c.getContext('2d');
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 128, 84);
  return c;
}

Assets.define('tex-grass', { kind: 'texture', group: 'Textures', name: 'Grass grain', build: grassDetailCanvas,
  note: 'Greyscale and seamlessly tiling. Multiplied over all the turf (about one tile per yard) to give it grain.' });
Assets.define('tex-water', { kind: 'texture', group: 'Textures', name: 'Water ripples', build: waterNormalCanvas,
  note: 'A seamless tangent-space normal map that slowly scrolls across the ponds.' });
Assets.define('tex-flag', { kind: 'texture', group: 'Textures', name: 'Flag cloth', build: flagClothCanvas,
  note: 'Fills the pin flags; the hole number is printed on top. About 3:2.' });
Assets.define('tex-cloud', { kind: 'texture', group: 'Textures', name: 'Cloud', build: () => cloudCanvas(400),
  note: 'A soft white cloud on a transparent background (PNG with alpha).' });

// ---------- built-in models ---------------------------------------------------
function mergeGeoms(geoms) {
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  parts.forEach((g) => (n += g.attributes.position.count));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  parts.forEach((g) => {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
function namedMat(name, opts) { const m = new THREE.MeshLambertMaterial(opts); m.name = name; return m; }
function namedMesh(name, geo, mat) { const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = true; m.receiveShadow = true; return m; }

// Trees are authored at unit height with their base at the origin; the game
// scales each one to the height of the spot it grows in.
function pineTree() {
  const g = new THREE.Group();
  g.name = 'tree-pine';
  g.add(namedMesh('trunk', new THREE.CylinderGeometry(0.022, 0.034, 0.34, 6).translate(0, 0.17, 0), namedMat('bark', { color: 0x5a4330 })));
  const crown = mergeGeoms([
    new THREE.ConeGeometry(1, 0.62, 8).translate(0, 0.31, 0),
    new THREE.ConeGeometry(0.78, 0.5, 8).translate(0, 0.52, 0),
    new THREE.ConeGeometry(0.5, 0.42, 8).translate(0, 0.75, 0),
  ]);
  crown.scale(0.27, 0.78, 0.27);
  crown.translate(0, 0.22, 0);
  g.add(namedMesh('crown', crown, namedMat('leaves', { color: 0x2c5a34, flatShading: true })));
  return g;
}
function oakTree() {
  const g = new THREE.Group();
  g.name = 'tree-oak';
  g.add(namedMesh('trunk', new THREE.CylinderGeometry(0.026, 0.038, 0.5, 6).translate(0, 0.25, 0), namedMat('bark', { color: 0x5a4330 })));
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const p = ico.attributes.position;
  const r = mulberry32(17);
  for (let i = 0; i < p.count; i++) {
    const k = 0.85 + r() * 0.3;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  const crown = mergeGeoms([ico]);
  crown.scale(0.36, 0.34, 0.36);
  crown.translate(0, 0.66, 0);
  g.add(namedMesh('crown', crown, namedMat('leaves', { color: 0x557d2c, flatShading: true })));
  return g;
}
Assets.define('tree-pine', { kind: 'model', group: 'Course', name: 'Pine tree', fit: 'height', build: pineTree,
  note: 'Any size: it is rescaled to each tree’s height (10–18 yards). Base at the origin, +Y up. Materials named "leaves" get a little color variety.' });
Assets.define('tree-oak', { kind: 'model', group: 'Course', name: 'Oak tree', fit: 'height', build: oakTree,
  note: 'Any size: it is rescaled to each tree’s height (8–14 yards). Base at the origin, +Y up. Materials named "leaves" get a little color variety.' });

function teeMarker() {
  const g = new THREE.Group();
  g.name = 'tee-marker';
  const m = namedMesh('marker', new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.4 }));
  m.material.name = 'paint';
  m.position.y = 0.06;
  g.add(m);
  return g;
}
Assets.define('tee-marker', { kind: 'model', group: 'Course', name: 'Tee marker', build: teeMarker,
  note: 'Real size (about 15 cm). Sits on the ground at the origin. Two mark the front of every tee box.' });

function textCanvasTexture(w, h, draw) {
  const c = makeCanvas(w, h);
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function clubhouseModel() {
  const g = new THREE.Group();
  g.name = 'clubhouse';
  const wall = namedMat('walls', { color: 0xf1ede2 });
  const trim = namedMat('trim', { color: 0x1d5537 });
  const roofMat = namedMat('roof', { color: 0x3b4a44 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2c3e46, roughness: 0.15, metalness: 0.3 });
  glass.name = 'glass';
  const body = namedMesh('building', new THREE.BoxGeometry(30, 6, 18), wall);
  body.position.y = 3;
  g.add(body);
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-10.5, 0); roofShape.lineTo(10.5, 0); roofShape.lineTo(0, 5); roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 32, bevelEnabled: false });
  roofGeo.translate(0, 0, -16);
  roofGeo.rotateY(Math.PI / 2);
  const roof = namedMesh('roof', roofGeo, roofMat);
  roof.position.y = 6;
  g.add(roof);
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const w = namedMesh('window', new THREE.BoxGeometry(2.4, 2.2, 0.2), glass);
    w.position.set(i * 4, 3.3, -9.05);
    g.add(w);
  }
  const door = namedMesh('door', new THREE.BoxGeometry(2.6, 3.4, 0.2), trim);
  door.position.set(0, 1.7, -9.05);
  g.add(door);
  const porch = namedMesh('porch', new THREE.BoxGeometry(14, 0.3, 4), namedMat('deck', { color: 0x8a6f52 }));
  porch.position.set(0, 0.15, -11);
  g.add(porch);
  const awning = namedMesh('awning', new THREE.BoxGeometry(14, 0.25, 4.4), trim);
  awning.position.set(0, 4.2, -11);
  g.add(awning);
  for (const px of [-6.5, -2.2, 2.2, 6.5]) {
    const col = namedMesh('column', new THREE.CylinderGeometry(0.15, 0.15, 4, 8), wall);
    col.position.set(px, 2.1, -12.8);
    g.add(col);
  }
  const signTex = textCanvasTexture(512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#1d5537'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2c230';
    // Shrink to fit when the condensed web font isn't available (offline).
    const font = (px) => `800 ${px}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    ctx.font = font(58);
    const tw = ctx.measureText('PINEHAVEN GOLF CLUB').width;
    if (tw > w * 0.92) ctx.font = font(Math.floor(58 * (w * 0.92) / tw));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PINEHAVEN GOLF CLUB', w / 2, h / 2 + 2);
  });
  const board = namedMesh('sign', new THREE.PlaneGeometry(11, 2.06), namedMat('sign', { map: signTex }));
  board.position.set(0, 5.1, -9.2);
  board.rotation.y = Math.PI;
  g.add(board);
  const pole = namedMesh('flagpole', new THREE.CylinderGeometry(0.06, 0.08, 12, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3 }));
  pole.position.set(-17, 6, -12);
  g.add(pole);
  return g;
}
Assets.define('clubhouse', { kind: 'model', group: 'Course', name: 'Clubhouse', build: clubhouseModel,
  note: 'Real size (the default is about 27 × 16 m). Ground level at the origin; the entrance faces −Z, towards the course.' });

const World = (() => {
  let renderer, scene, camera, sun, hemi, post = null, postOn = true, motes = null, streaks = null;
  let course = null;
  let detailTex, waterNormal;
  const ball = {}, guides = {};
  const chunks = [];
  const pins = [];
  let terrainMat = null;
  let paintJob = null;
  let time = 0;

  // ---------- textures ----------------------------------------------------
  // A custom texture from the Workshop, or the built-in canvas.
  function assetTexture(id) {
    return Assets.texture(id) || new THREE.CanvasTexture(Assets.get(id).build());
  }

  function radialTexture(inner, outer) {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function cloudTexture(seed) {
    const t = Assets.texture('tex-cloud') || new THREE.CanvasTexture(cloudCanvas(seed));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const textTexture = textCanvasTexture;

  // ---------- one-time scene setup -----------------------------------------
  function init(canvas) {
    Atmosphere.patchShaders();
    const A = Atmosphere.shared;
    Object.assign(A.sun, { x: SUN_DIR.x, y: SUN_DIR.y, z: SUN_DIR.z });
    Object.assign(A.sunHaze, { x: SUN_HAZE.r, y: SUN_HAZE.g, z: SUN_HAZE.b });
    Object.assign(A.haze, { x: 0.0006, y: 0.018, z: 0 });
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    post = Atmosphere.createPost(renderer);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(SKY.horizon, 320, 2300);
    camera = new THREE.PerspectiveCamera(60, 1, 0.08, 9000);
    camera.position.set(0, 3, 8);

    detailTex = assetTexture('tex-grass');
    detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    waterNormal = assetTexture('tex-water');
    waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;

    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(SKY.top) },
        horizon: { value: new THREE.Color(SKY.horizon) },
        ground: { value: new THREE.Color(SKY.ground) },
        sunDir: { value: SUN_DIR },
        sunHaze: { value: SUN_HAZE },
        skyAlpha: { value: 1 },
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vDir = wp.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunHaze; uniform float skyAlpha; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          float s = max(dot(d, sunDir), 0.0);
          // The horizon warms towards the sun, matching the haze on the ground.
          vec3 hz = mix(horizon, sunHaze, pow(s, 5.0));
          vec3 c = h > 0.0 ? mix(hz, top, pow(clamp(h,0.0,1.0), 0.5)) : mix(hz, ground, pow(clamp(-h*4.0,0.0,1.0), 0.6));
          c += sunHaze * (pow(s, 24.0) * 0.22 + pow(s, 200.0) * 0.9);
          c += vec3(1.0, 0.9, 0.72) * smoothstep(0.99962, 0.99985, s) * 16.0;
          // With post-processing on, alpha 0 marks open sky for the sun shafts.
          gl_FragColor = vec4(c, skyAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    scene.userData.sky = sky;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;

    // Distant hills: a forested ridge and a far blue range.
    const nM = makePerlin(5);
    [[1500, 0, 55, 0x5d8a5a, true], [3400, 0.62, 230, 0x6f8c99, false]].forEach(([R, haze, amp, col, fogged], k) => {
      const seg = 180;
      const pos = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const h = amp * (0.35 + 0.65 * (fbm(nM, Math.cos(a) * 3 + k * 9, Math.sin(a) * 3, 4) * 0.5 + 0.5));
        const x = Math.cos(a) * R, z = Math.sin(a) * R;
        pos.push(x, -20, z, x, h, z);
      }
      const idx = [];
      for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const c = new THREE.Color(col).lerp(new THREE.Color(SKY.horizon), haze);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, fog: fogged, side: THREE.DoubleSide }));
      m.renderOrder = -5 + k;
      m.userData.followCamera = true;
      scene.add(m);
    });

    for (let i = 0; i < 14; i++) {
      const rnd = mulberry32(300 + i);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(400 + i), fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
      const a = rnd() * TAU, R = 2200 + rnd() * 2400;
      sp.position.set(Math.cos(a) * R, 380 + rnd() * 700, Math.sin(a) * R);
      sp.scale.set(900 + rnd() * 900, 300 + rnd() * 250, 1);
      sp.userData.followCamera = true;
      scene.add(sp);
    }

    hemi = new THREE.HemisphereLight(0xd2e4ff, 0x5e7040, 1.3);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffe8c8, 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    motes = Atmosphere.createMotes();
    scene.add(motes);
    streaks = WindCues.createStreaks();
    scene.add(streaks.mesh);

    buildBall();
    buildGuides();
  }

  // A ball with its shadow, tee peg and flight trail. In an online round every
  // player has one, each in their own colour.
  let ballGeo = null;
  function makeBall(color, trailOpacity) {
    const b = { trailOpacity };
    ballGeo = ballGeo || new THREE.SphereGeometry(1, 24, 16);
    b.mesh = new THREE.Mesh(ballGeo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0, emissive: new THREE.Color(color).multiplyScalar(0.19) }));
    b.mesh.castShadow = true;
    scene.add(b.mesh);
    b.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    scene.add(b.shadow);
    // A wooden tee peg, shown while the ball sits on the tee.
    b.peg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.07, 6), new THREE.MeshLambertMaterial({ color: 0xf0e2c0 }));
    b.peg.visible = false;
    scene.add(b.peg);
    const tg = new THREE.BufferGeometry();
    b.trailPos = new Float32Array(3 * 2048);
    tg.setAttribute('position', new THREE.BufferAttribute(b.trailPos, 3));
    tg.setDrawRange(0, 0);
    b.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: trailOpacity, depthWrite: false }));
    b.trail.frustumCulled = false;
    b.trailN = 0;
    scene.add(b.trail);
    return b;
  }
  function buildBall() { Object.assign(ball, makeBall(0xffffff, 0.6)); }

  function buildGuides() {
    const ag = new THREE.BufferGeometry();
    guides.arcPos = new Float32Array(3 * 512);
    ag.setAttribute('position', new THREE.BufferAttribute(guides.arcPos, 3));
    guides.arc = new THREE.Line(ag, new THREE.LineDashedMaterial({ color: 0xfff6c8, dashSize: 2, gapSize: 1.4, transparent: true, opacity: 0.75, depthWrite: false }));
    guides.arc.frustumCulled = false;
    guides.arc.visible = false;
    scene.add(guides.arc);
    const ring = new THREE.RingGeometry(0.78, 1, 48);
    ring.rotateX(-Math.PI / 2);
    guides.ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, side: THREE.DoubleSide }));
    guides.ring.renderOrder = 5;
    guides.ring.visible = false;
    scene.add(guides.ring);
    const dot = new THREE.CircleGeometry(0.22, 24);
    dot.rotateX(-Math.PI / 2);
    guides.ring.add(new THREE.Mesh(dot, guides.ring.material));
  }

  // ---------- surface painting ---------------------------------------------
  const SURF_RGB = [
    [112, 176, 74],  // tee
    [104, 170, 66],  // fairway
    [92, 160, 68],   // fringe
    [108, 182, 82],  // green
    [80, 138, 50],   // rough
    [64, 112, 40],   // deep rough
    [226, 210, 166], // sand
    [70, 86, 58],    // under water
    [64, 112, 40],   // oob
    [196, 186, 162], // cart path
  ];
  let nMottle = null;

  // Paints rows [r0, r1) of a w x h image covering [x0, x0+size] x [z0, z0+size].
  function paintRows(data, w, ppy, x0, z0, r0, r1) {
    for (let py = r0; py < r1; py++) {
      const z = z0 + (py + 0.5) / ppy;
      for (let px = 0; px < w; px++) {
        const x = x0 + (px + 0.5) / ppy;
        const s = course.surface(x, z);
        const c = SURF_RGB[s];
        const gx = Math.floor(x * 3), gz = Math.floor(z * 3);
        let k = 1 + (hash2(gx, gz) - 0.5) * 0.07;
        let r = c[0], gg = c[1], bb = c[2];
        if (s === S_FAIRWAY || s === S_TEE) {
          const ss = course.stripeS(x, z);
          if (ss !== null) k *= (Math.floor(ss / 9) & 1) ? 1.055 : 0.95;
        } else if (s === S_GREEN) {
          k *= (Math.floor((x * 0.8 + z * 0.6) / 2.2) & 1) ? 1.04 : 0.965;
        } else if (s === S_SAND || s === S_PATH) {
          k = 1 + (hash2(gx, gz) - 0.5) * 0.12;
        } else if (s === S_DEEP || s === S_OOB || s === S_ROUGH) {
          const m = nMottle(x / 26, z / 26);
          const t = smoothstep(0.1, 0.7, m) * (s === S_ROUGH ? 0.3 : 0.55);
          r = lerp(r, 132, t); gg = lerp(gg, 134, t); bb = lerp(bb, 64, t);
          k *= 1 + 0.10 * nMottle(x / 6 + 50, z / 6) + 0.05 * (hash2(gx >> 1, gz >> 1) - 0.5);
        }
        if (s !== S_SAND && s !== S_WATER && s !== S_PATH) k *= 1 + 0.05 * nMottle(x / 15 - 20, z / 15 + 20);
        r *= k; gg *= k; bb *= k;
        // Painted holes bring their own picture of the ground.
        const pc = course.paintColor(x, z);
        if (pc) { r = lerp(r, pc[0], pc[3]); gg = lerp(gg, pc[1], pc[3]); bb = lerp(bb, pc[2], pc[3]); }
        const i = (py * w + px) * 4;
        data[i] = clamp(r, 0, 255);
        data[i + 1] = clamp(gg, 0, 255);
        data[i + 2] = clamp(bb, 0, 255);
        data[i + 3] = 255;
      }
    }
  }

  function chunkTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  function terrainMaterial(map) {
    const mat = new THREE.MeshLambertMaterial({ map });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.detailMap = { value: detailTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;\nuniform sampler2D detailMap;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float dn = texture2D(detailMap, vWXZ * 0.9).r * 0.55 + texture2D(detailMap, vWXZ * 0.11).r * 0.45;
          diffuseColor.rgb *= 0.82 + 0.36 * dn;`);
    };
    return mat;
  }

  // A square terrain tile with skirts hiding cracks between tiles of
  // different resolution. Normals come from the height function itself so
  // lighting matches across tile edges.
  function chunkGeometry(x0, z0, size, segs) {
    const n = segs + 1;
    const step = size / segs;
    const hs = new Float32Array((n + 2) * (n + 2));
    for (let j = -1; j <= n; j++)
      for (let i = -1; i <= n; i++) hs[(j + 1) * (n + 2) + (i + 1)] = course.H(x0 + i * step, z0 + j * step);
    const hAt = (i, j) => hs[(j + 1) * (n + 2) + (i + 1)];
    const vCount = n * n + 4 * n;
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
    const setV = (k, i, j, drop) => {
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = hAt(i, j) - drop; pos[k * 3 + 2] = z0 + j * step;
      const hx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * step), hz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * step);
      const l = Math.sqrt(hx * hx + 1 + hz * hz);
      nor[k * 3] = -hx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -hz / l;
      uv[k * 2] = i / segs; uv[k * 2 + 1] = j / segs;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) setV(j * n + i, i, j, 0);
    const idx = [];
    for (let j = 0; j < segs; j++)
      for (let i = 0; i < segs; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    // Skirts along the four edges.
    let k = n * n;
    const edges = [
      (t) => [t, 0], (t) => [n - 1, t], (t) => [n - 1 - t, n - 1], (t) => [0, n - 1 - t],
    ];
    for (const e of edges) {
      const start = k;
      for (let t = 0; t < n; t++) { const [i, j] = e(t); setV(k++, i, j, 2.5); }
      for (let t = 0; t < n - 1; t++) {
        const [i0, j0] = e(t), [i1, j1] = e(t + 1);
        const a = j0 * n + i0, b = j1 * n + i1, sa = start + t, sb = start + t + 1;
        idx.push(a, b, sa, b, sb, sa);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // ---------- trees ----------------------------------------------------------
  // Cheap stand-ins for distant default trees (custom trees reuse their mesh).
  function farTree(kind) {
    const g = new THREE.Group();
    g.add(namedMesh('trunk', new THREE.CylinderGeometry(0.024, 0.034, kind === 0 ? 0.34 : 0.5, 4).translate(0, kind === 0 ? 0.17 : 0.25, 0), namedMat('bark', { color: 0x5a4330 })));
    const crown = kind === 0
      ? new THREE.ConeGeometry(0.25, 0.78, 6).translate(0, 0.22 + 0.39, 0)
      : new THREE.IcosahedronGeometry(1, 0).scale(0.36, 0.34, 0.36).translate(0, 0.66, 0);
    g.add(namedMesh('crown', crown, namedMat('leaves', { color: kind === 0 ? 0x2c5a34 : 0x557d2c, flatShading: true })));
    return g;
  }
  const isLeaf = (p) => /leaf|leaves|foliage|needle|crown|canopy/i.test((p.material && p.material.name) || p.name || '');

  // A far stand-in for a custom tree, which can be thousands of triangles:
  // the model drawn from the front, the side and above onto three cards.
  function impostorParts(parts) {
    const box = new THREE.Box3();
    let ySum = 0, yN = 0;
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
      const ys = p.geometry.attributes.position;
      for (let i = 0; i < ys.count; i++) ySum += ys.getY(i);
      yN += ys.count;
    }
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.52 + 1e-3;
    const tall = box.max.y - box.min.y;
    const y0 = box.min.y - tall * 0.02, y1 = box.max.y + tall * 0.02;
    // The top card sits at the middle of the model's bulk (the crown, for most trees).
    const yc = clamp(ySum / Math.max(1, yN), box.min.y + tall * 0.4, box.max.y - tall * 0.1);

    // Three views in a 2 x 2 atlas: front (from +Z), side (from +X), top.
    const N = 256;
    const rt = new THREE.WebGLRenderTarget(2 * N, 2 * N, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const sc = new THREE.Scene();
    // three.js lights are in physical units: an intensity of PI lights a surface at its full colour.
    sc.add(new THREE.AmbientLight(0xffffff, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(0.4, 1, 0.8);
    sc.add(key);
    const turn = new THREE.Group(), model = new THREE.Group();
    model.position.set(-cx, 0, -cz);
    turn.add(model);
    sc.add(turn);
    for (const p of parts) {
      const m = p.material;
      model.add(new THREE.Mesh(p.geometry, new THREE.MeshLambertMaterial({
        color: m.color, map: m.map || null, vertexColors: !!m.vertexColors, side: THREE.DoubleSide,
        alphaTest: m.alphaTest || (m.transparent ? 0.5 : 0),
      })));
    }
    const sideCam = new THREE.OrthographicCamera(-half, half, y1, y0, -50, 50);
    const topCam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, tall * 3 + 10);
    topCam.position.set(0, y1 + 1, 0);
    topCam.up.set(0, 0, -1);   // screen up = -Z
    topCam.lookAt(0, y0, 0);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    // Transparent, but leaf-coloured so filtering doesn't darken the edges.
    renderer.setClearColor(0x2e4a24, 0);
    rt.scissorTest = true;
    for (const [i, j, yaw, cam] of [[0, 0, 0, sideCam], [1, 0, -Math.PI / 2, sideCam], [0, 1, 0, topCam], [1, 1, 0, null]]) {
      rt.viewport.set(i * N, j * N, N, N);
      rt.scissor.set(i * N, j * N, N, N);
      turn.rotation.y = yaw;   // -90 degrees brings the model's +X side to the front
      turn.visible = !!cam;
      renderer.setRenderTarget(rt);
      renderer.render(sc, cam || sideCam);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    model.traverse((o) => { if (o.isMesh) o.material.dispose(); });

    // Each card is drawn from both sides and lit as if facing up (a two-sided
    // material would flip the normal on the back and turn half the cards dark).
    const pos = [
      cx - half, y0, cz, cx + half, y0, cz, cx + half, y1, cz, cx - half, y1, cz,                     // faces +Z
      cx, y0, cz + half, cx, y0, cz - half, cx, y1, cz - half, cx, y1, cz + half,                     // faces +X
      cx - half, yc, cz + half, cx + half, yc, cz + half, cx + half, yc, cz - half, cx - half, yc, cz - half, // faces up
    ];
    const uv = [0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, 1, 0, 1, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 1, 0, 1];
    const idx = [];
    for (let k = 0; k < 12; k += 4) idx.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(12).fill([0, 1, 0]).flat(), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.MeshLambertMaterial({ map: rt.texture, alphaTest: 0.3 });
    mat.name = 'tree-far';
    return [{ geometry: geo, material: mat, name: 'tree-far' }];
  }

  function buildTrees(group) {
    const b = course.bounds;
    const all = course.trees.slice();
    const rnd = mulberry32(77);
    // Decorative forest outside the property.
    for (let x = b.minX - 100; x < b.maxX + 100; x += 9)
      for (let z = b.minZ - 100; z < b.maxZ + 100; z += 9) {
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) continue;
        if (rnd() > 0.7) continue;
        const pine = rnd() < 0.6;
        const height = pine ? 11 + rnd() * 9 : 9 + rnd() * 7;
        all.push({ x: x + (rnd() - 0.5) * 8, z: z + (rnd() - 0.5) * 8, y0: -0.2, kind: pine ? 0 : 1, height, rot: rnd() * TAU, tint: rnd() });
      }
    const ids = ['tree-pine', 'tree-oak'];
    const nearParts = ids.map((id) => Assets.parts(id));
    const farParts = ids.map((id, k) => (Assets.isCustom(id) ? impostorParts(nearParts[k]) : flattenFar(k)));
    // Kind 2: boulders on painted holes.
    const rockParts = Assets.parts('boulder');
    nearParts.push(rockParts);
    farParts.push(rockParts);
    function flattenFar(k) {
      const ps = [];
      const g = farTree(k);
      g.updateMatrixWorld(true);
      g.traverse((o) => { if (o.isMesh) { const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); ps.push({ geometry: geo, material: o.material, name: o.name }); } });
      return ps;
    }
    // Bucket trees into tiles: off-screen tiles are culled, distant ones
    // switch to simple shapes and only nearby trees cast shadows. Custom trees
    // are heavier, so they switch to their stand-ins sooner.
    const heavy = ids.some((id) => Assets.isCustom(id));
    const TILE = heavy ? 64 : 160, FAR = heavy ? 120 : 250;
    const tiles = new Map();
    for (const t of all) {
      const k = Math.floor(t.x / TILE) + ':' + Math.floor(t.z / TILE);
      if (!tiles.has(k)) tiles.set(k, []);
      tiles.get(k).push(t);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    function tileMeshes(list, partsByKind, shadows) {
      const g = new THREE.Group();
      for (let kind = 0; kind < 3; kind++) {
        const trees = list.filter((t) => t.kind === kind);
        if (!trees.length) continue;
        for (const part of partsByKind[kind]) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, trees.length);
          const tint = isLeaf(part);
          trees.forEach((t, i) => {
            q.setFromAxisAngle(up, t.rot);
            if (kind === 2) m.compose(p.set(t.x, t.y0, t.z), q, s.set(t.r, t.r, t.r));
            else {
              const w = (0.9 + (t.tint || 0) * 0.2) * (t.wide || 1);
              m.compose(p.set(t.x, t.y0, t.z), q, s.set(t.height * w, t.height, t.height * w));
            }
            im.setMatrixAt(i, m);
            if (tint) im.setColorAt(i, col.setRGB(0.82 + t.tint * 0.3, 0.88 + t.tint * 0.22, 0.85 + t.tint * 0.15));
          });
          im.castShadow = shadows;
          im.computeBoundingSphere();
          g.add(im);
        }
      }
      return g;
    }
    for (const list of tiles.values()) {
      let cx = 0, cz = 0;
      for (const t of list) { cx += t.x; cz += t.z; }
      cx /= list.length; cz /= list.length;
      const lod = new THREE.LOD();
      lod.position.set(cx, course.H(cx, cz), cz);
      // Instances are placed in world space, so undo the LOD's own offset.
      const near = tileMeshes(list, nearParts, true);
      const far = tileMeshes(list, farParts, false);
      near.position.set(-cx, -lod.position.y, -cz);
      far.position.copy(near.position);
      lod.addLevel(near, 0);
      lod.addLevel(far, FAR);
      group.add(lod);
    }
  }

  // ---------- painted holes: water, buildings, fences ---------------------------
  function buildPainted(mh, group) {
    // Water: a sheet following the river's level, tucked under its banks.
    if (mh.hasWater) {
      const step = Math.max(1, Math.round(1.2 / mh.s));
      const nu = Math.floor(mh.W / step) + 1, nv = Math.floor(mh.H / step) + 1;
      const lvl = (u, v) => mh.levelGrid[Math.min(mh.H - 1, v) * mh.W + Math.min(mh.W - 1, u)];
      const pos = [], idx = [], vid = new Int32Array(nu * nv).fill(-1);
      const vert = (i, j) => {
        const k = j * nu + i;
        if (vid[k] >= 0) return vid[k];
        const u = Math.min(mh.W - 1, i * step), v = Math.min(mh.H - 1, j * step);
        const L = lvl(u, v);
        if (isNaN(L)) return -1;
        const w = mh.toWorld(u + 0.5, v + 0.5);
        vid[k] = pos.length / 3;
        pos.push(w.x, L + mh.offset, w.z);
        return vid[k];
      };
      for (let j = 0; j < nv - 1; j++)
        for (let i = 0; i < nu - 1; i++) {
          const a = vert(i, j), b = vert(i + 1, j), cc = vert(i, j + 1), d = vert(i + 1, j + 1);
          if (a < 0 || b < 0 || cc < 0 || d < 0) continue;
          idx.push(a, cc, b, b, cc, d);
        }
      if (idx.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const uv = new Float32Array((pos.length / 3) * 2);
        for (let k = 0; k < pos.length / 3; k++) { uv[k * 2] = pos[k * 3] / 24; uv[k * 2 + 1] = pos[k * 3 + 2] / 24; }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        const wm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: 0x2d6a86, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.72,
          normalMap: waterNormal, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.1, depthWrite: false,
        }));
        wm.receiveShadow = true;
        wm.renderOrder = 1;
        group.add(wm);
      }
    }
    // Buildings and bridges, scaled to their footprints.
    for (const p of mh.props) {
      const obj = Assets.object(p.asset);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const bw = Math.max(0.01, box.max.x - box.min.x), bd = Math.max(0.01, box.max.z - box.min.z);
      const k = Math.min(p.w / bw, p.d / bd);
      const holder = new THREE.Group();
      obj.scale.multiplyScalar(k);
      obj.position.set(-(box.min.x + box.max.x) / 2 * k, 0, -(box.min.z + box.max.z) / 2 * k);
      holder.add(obj);
      let y;
      if (p.deckY0 !== undefined) y = p.deckY0 + mh.offset + 0.06; // the deck sits on the raised ground
      else {
        // Settle onto the lowest ground under the footprint.
        y = Infinity;
        const c = Math.cos(p.yaw * DEG), sn = Math.sin(p.yaw * DEG);
        for (const [a, b] of [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
          const lx = a * p.w, lz = b * p.d;
          y = Math.min(y, course.H(p.x + lx * c - lz * sn, p.z + lx * sn + lz * c));
        }
        y -= box.min.y * k;
      }
      holder.position.set(p.x, y, p.z);
      holder.rotation.y = -p.yaw * DEG;
      group.add(holder);
      // Flags flying from the roof: drop a ray onto the model at each spot.
      if (p.flags) {
        holder.updateMatrixWorld(true);
        const rc = new THREE.Raycaster();
        for (const [fx, fz] of p.flags) {
          const wp = holder.localToWorld(new THREE.Vector3(fx * p.w, 0, fz * p.d));
          rc.set(new THREE.Vector3(wp.x, wp.y + 400, wp.z), new THREE.Vector3(0, -1, 0));
          const hit = rc.intersectObject(obj, true)[0];
          if (!hit) continue;
          // Big enough to read from the fairway, sized to the building.
          const k = clamp(Math.max(p.w, p.d) / 30, 0.8, 2);
          const f = WindCues.makeFlag({ height: 5 * k, w: 3.4 * k, h: 1.9 * k, color: WindCues.PALETTE[1], emblem: 'cross', shape: 'pennant' });
          f.position.copy(hit.point).y -= 0.3;
          group.add(f);
        }
      }
    }
    // Fences: lengths of the fence model along each line, instanced per part.
    const segs = [];
    for (const line of mh.fences) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.round(L / FENCE_LEN));
        for (let k = 0; k < n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
          segs.push({ x, z, y: course.H(x, z), len: L / n, ang: Math.atan2(-(b.z - a.z), b.x - a.x) });
        }
      }
    }
    if (segs.length) {
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(), pp = new THREE.Vector3(), upv = new THREE.Vector3(0, 1, 0);
      for (const part of Assets.parts('fence')) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, segs.length);
        segs.forEach((g, i) => {
          qq.setFromAxisAngle(upv, g.ang);
          im.setMatrixAt(i, mm.compose(pp.set(g.x, g.y, g.z), qq, ss.set(g.len / FENCE_LEN, 1, 1)));
        });
        im.castShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      }
    }
  }

  // ---------- flags, tees, clubhouse -----------------------------------------
  function flagTexture(num) {
    const cloth = Assets.image('tex-flag');
    return textTexture(128, 84, (g) => {
      if (cloth) g.drawImage(cloth, 0, 0, 128, 84);
      else g.drawImage(flagClothCanvas(), 0, 0);
      g.fillStyle = '#16261d';
      g.font = '800 62px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), 64, 46);
    });
  }

  function buildPin(hole, group) {
    const pin = hole.pin;
    const n = course.normal(pin.x, pin.z);
    const pg = new THREE.Group();
    pg.position.set(pin.x, pin.y, pin.z);
    const cupGeo = new THREE.CircleGeometry(CUP_R, 28);
    cupGeo.rotateX(-Math.PI / 2);
    const cup = new THREE.Mesh(cupGeo, new THREE.MeshBasicMaterial({ color: 0x0b0f0b, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -12 }));
    cup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z));
    cup.position.y = 0.006;
    cup.renderOrder = 2;
    pg.add(cup);
    const rimGeo = new THREE.RingGeometry(CUP_R, CUP_R * 1.25, 28);
    rimGeo.rotateX(-Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: 0xdfe8d8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -12 }));
    rim.quaternion.copy(cup.quaternion);
    rim.position.y = 0.006;
    rim.renderOrder = 2;
    pg.add(rim);
    // With the flag out (putting), a soft ring marks the hole so it can't get
    // lost against the grass at a low angle.
    const haloGeo = new THREE.RingGeometry(CUP_R * 2.2, CUP_R * 3.2, 36);
    haloGeo.rotateX(-Math.PI / 2);
    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -12 }));
    halo.quaternion.copy(cup.quaternion);
    halo.position.y = 0.006;
    halo.renderOrder = 2;
    halo.visible = false;
    pg.add(halo);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.45, 8), new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.4 }));
    pole.position.y = 1.2;
    pole.castShadow = true;
    pg.add(pole);
    const fg = new THREE.PlaneGeometry(0.8, 0.52, 12, 4);
    fg.translate(0.4, 0, 0);
    const ftex = flagTexture(hole.index + 1);
    const flag = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: ftex, side: THREE.FrontSide }));
    flag.castShadow = true;
    // The back face gets a mirrored copy so the number reads correctly from both sides.
    const btex = ftex.clone();
    btex.wrapS = THREE.RepeatWrapping; btex.repeat.x = -1; btex.offset.x = 1; btex.needsUpdate = true;
    const flagBack = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: btex, side: THREE.BackSide }));
    const fpivot = new THREE.Group();
    fpivot.position.y = 2.15;
    fpivot.add(flag, flagBack);
    pg.add(fpivot);
    group.add(pg);
    pins.push({ group: pg, flag, fpivot, pole, halo });
    WindCues.addWaver(fpivot, fg, 0.8, hole.index * 1.7);
  }

  function buildTeeMarkers(hole, group) {
    for (const side of [-1, 1]) {
      const mk = Assets.object('tee-marker');
      const x = hole.tee.x - hole.teeDir.z * side * 3.2 + hole.teeDir.x * 1.2;
      const z = hole.tee.z + hole.teeDir.x * side * 3.2 + hole.teeDir.z * 1.2;
      mk.position.set(x, course.H(x, z), z);
      mk.rotation.y = Math.atan2(hole.teeDir.x, hole.teeDir.z);
      group.add(mk);
    }
    // Two flags in the hole's colour framing the tee shot, out to the sides
    // and a little ahead so they stand at the edges of the view.
    const col = WindCues.PALETTE[hole.index % WindCues.PALETTE.length];
    for (const side of [-1, 1]) {
      const x = hole.tee.x - hole.teeDir.z * side * 9.5 + hole.teeDir.x * 8;
      const z = hole.tee.z + hole.teeDir.x * side * 9.5 + hole.teeDir.z * 8;
      const f = WindCues.makeFlag({ height: 4.6, w: 1.5, h: 0.95, color: col, emblem: side < 0 ? 'disc' : 'cross', phase: hole.index + side });
      f.position.set(x, course.H(x, z) - 0.05, z);
      group.add(f);
    }
    // A small sign at the back of the tee: hole number, par and yardage.
    const sx = hole.tee.x - hole.teeDir.z * 6.5 - hole.teeDir.x * 6, sz = hole.tee.z + hole.teeDir.x * 6.5 - hole.teeDir.z * 6;
    const sy = course.H(sx, sz);
    const sign = new THREE.Group();
    sign.position.set(sx, sy, sz);
    sign.rotation.y = Math.atan2(hole.teeDir.x, hole.teeDir.z); // board faces along the hole
    const tex = textTexture(256, 160, (g, w, h) => {
      g.fillStyle = '#1d5537'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f2c230'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#f7f5ec'; g.textAlign = 'center';
      g.font = '800 64px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      g.fillText(String(hole.index + 1), w / 2, 70);
      g.font = '600 30px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      g.fillText(`PAR ${hole.par} · ${hole.yards} YDS`, w / 2, 122);
    });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.88, 0.06), [
      new THREE.MeshLambertMaterial({ color: 0x1d5537 }), new THREE.MeshLambertMaterial({ color: 0x1d5537 }),
      new THREE.MeshLambertMaterial({ color: 0x1d5537 }), new THREE.MeshLambertMaterial({ color: 0x1d5537 }),
      new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex }),
    ]);
    board.position.y = 1.25;
    board.castShadow = true;
    sign.add(board);
    for (const px of [-0.55, 0.55]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 0.08), new THREE.MeshLambertMaterial({ color: 0x5a4330 }));
      post.position.set(px, 0.6, 0);
      sign.add(post);
    }
    group.add(sign);
  }

  // A few pennants around each hole, in the rough beside the fairway and
  // behind the green: decoration, and something to read the wind from.
  function buildCourseFlags(hole, group) {
    const L = hole.line.length;
    const rnd = mulberry32(hole.index * 97 + 13);
    const spots = [[0.32, 1], [0.64, -1], [1.0, rnd() < 0.5 ? 1 : -1]];
    for (const [f, side0] of spots) {
      const s = Math.min(L, f * L);
      const p = hole.line.pointAt(s), q = hole.line.pointAt(Math.max(0, s - 2));
      let tx = p.x - q.x, tz = p.z - q.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const back = f >= 1 ? hole.green.r + 7 : 0;
      for (let attempt = 0; attempt < 6; attempt++) {
        const side = attempt % 2 ? -side0 : side0;
        const off = (hole.hw || 18) + 9 + attempt * 3 + rnd() * 3;
        const x = p.x + tx * back - tz * side * (f >= 1 ? 6 : off), z = p.z + tz * back + tx * side * (f >= 1 ? 6 : off);
        const surf = course.surface(x, z);
        if (surf === S_WATER || surf === S_SAND || surf === S_OOB || surf === S_GREEN || surf === S_FAIRWAY || surf === S_PATH) continue;
        if ((course.nearTrees(x, z) || []).some((t) => Math.hypot(t.x - x, t.z - z) < t.trunkR + 1.5)) continue;
        const fl = WindCues.makeFlag({
          height: 4, w: 1.7, h: 0.9, shape: 'pennant', emblem: 'chevron',
          color: WindCues.PALETTE[(hole.index * 3 + Math.round(f * 3)) % WindCues.PALETTE.length], phase: rnd() * 10,
        });
        fl.position.set(x, course.H(x, z) - 0.05, z);
        group.add(fl);
        break;
      }
    }
  }

  // In the club close-up: an alignment stick on the ground beside the ball,
  // parallel to the aim, and a faint line straight out from the club face.
  let stick = null, faceLine = null;
  function setAlignmentStick(o) {
    if (!stick) {
      stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.4, 6).rotateX(Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xf2c230 }));
      stick.castShadow = true;
      faceLine = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
      faceLine.renderOrder = 5;
      scene.add(stick, faceLine);
    }
    stick.visible = !!o;
    faceLine.visible = !!(o && o.face);
    if (!o) return;
    const d = dirFromYaw(o.yaw);
    const cx = o.x + d.x * 0.25, cz = o.z + d.z * 0.25;
    stick.position.set(cx, course.H(cx, cz) + 0.012, cz);
    stick.rotation.set(0, -o.yaw, 0);
    if (o.face) {
      const f = o.face;
      faceLine.position.set(f.x, course.H(f.x, f.z) + 0.004, f.z);
      faceLine.rotation.set(0, -yawFromDir(f.dx, f.dz), 0);
    }
  }

  function buildClubhouse(group) {
    const c = course.clubhouse;
    const g = Assets.object('clubhouse');
    g.position.set(c.x, c.y, c.z);
    g.rotation.y = -(c.heading || 0) * DEG;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(g);
    // Walls block walking and driving: fit the footprint to the model.
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const ob = course.obstacles[0];
    ob.hx = Math.max(1, (box.max.x - box.min.x) / 2 - 0.5);
    ob.hz = Math.max(1, (box.max.z - box.min.z) / 2 - 0.5);
    ob.x = (box.max.x + box.min.x) / 2; ob.z = (box.max.z + box.min.z) / 2;
  }

  // ---------- whole-course build ----------------------------------------------
  // Returns a canvas with a 1px-per-yard map of the course (for the minimap).
  function buildCourse(c) {
    course = c;
    nMottle = makePerlin(555);
    const group = new THREE.Group();
    const b = c.bounds;
    const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
    const overview = document.createElement('canvas');
    overview.width = Math.ceil(W * LO_PPY); overview.height = Math.ceil(D * LO_PPY);
    const og = overview.getContext('2d');
    terrainMat = null;

    // Which areas need full mesh detail.
    const detailed = (x0, z0) => {
      for (const h of c.holes) {
        const bb = h.bbox;
        if (bb.maxX > x0 - 10 && bb.minX < x0 + CHUNK + 10 && bb.maxZ > z0 - 10 && bb.minZ < z0 + CHUNK + 10) return true;
      }
      for (const p of c.paths) for (const [x, z] of p.pts) if (x > x0 - 5 && x < x0 + CHUNK + 5 && z > z0 - 5 && z < z0 + CHUNK + 5) return true;
      const cl = c.clubhouse;
      return cl.x > x0 - 50 && cl.x < x0 + CHUNK + 50 && cl.z > z0 - 50 && cl.z < z0 + CHUNK + 50;
    };

    for (let z0 = b.minZ; z0 < b.maxZ; z0 += CHUNK) {
      for (let x0 = b.minX; x0 < b.maxX; x0 += CHUNK) {
        const det = detailed(x0, z0);
        const geo = chunkGeometry(x0, z0, CHUNK, det ? 80 : 26);
        const geoFar = chunkGeometry(x0, z0, CHUNK, det ? 24 : 12);
        const n = Math.round(CHUNK * LO_PPY);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = n;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(n, n);
        paintRows(img.data, n, LO_PPY, x0, z0, 0, n);
        ctx.putImageData(img, 0, 0);
        og.drawImage(canvas, (x0 - b.minX) * LO_PPY, (z0 - b.minZ) * LO_PPY);
        const tex = chunkTexture(canvas);
        const mat = terrainMaterial(tex);
        // Full detail up close, a coarse mesh further away (skirts hide the seams).
        const lod = new THREE.LOD();
        const cx = x0 + CHUNK / 2, cz = z0 + CHUNK / 2;
        lod.position.set(cx, course.H(cx, cz), cz);
        const near = new THREE.Mesh(geo, mat), far = new THREE.Mesh(geoFar, mat);
        near.position.set(-cx, -lod.position.y, -cz);
        far.position.copy(near.position);
        near.receiveShadow = far.receiveShadow = true;
        lod.addLevel(near, 0);
        lod.addLevel(far, 230);
        group.add(lod);
        chunks.push({ x0, z0, lod, mat, tex, hi: false });
      }
    }

    // Surrounding countryside: a flat ring around the terrain (never under it).
    const ring = new THREE.Shape();
    ring.moveTo(-9000, -9000); ring.lineTo(9000, -9000); ring.lineTo(9000, 9000); ring.lineTo(-9000, 9000); ring.closePath();
    const ex = { minX: b.minX, maxX: b.minX + Math.ceil(W / CHUNK) * CHUNK, minZ: b.minZ, maxZ: b.minZ + Math.ceil(D / CHUNK) * CHUNK };
    const holePath = new THREE.Path();
    holePath.moveTo(ex.minX, -ex.minZ); holePath.lineTo(ex.minX, -ex.maxZ); holePath.lineTo(ex.maxX, -ex.maxZ); holePath.lineTo(ex.maxX, -ex.minZ); holePath.closePath();
    ring.holes.push(holePath);
    const outerGeo = new THREE.ShapeGeometry(ring);
    outerGeo.rotateX(-Math.PI / 2);
    const outer = new THREE.Mesh(outerGeo, new THREE.MeshLambertMaterial({ color: 0x41702c }));
    outer.receiveShadow = true;
    group.add(outer);

    // Water
    for (const w of c.waters) {
      const wg = new THREE.CircleGeometry(1, 64);
      wg.rotateX(-Math.PI / 2);
      const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
        color: 0x2a5f78, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.9,
        normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.1,
      }));
      wm.scale.set(w.rx * 1.4, 1, w.rz * 1.4);
      wm.rotation.y = -(w.rot || 0) * DEG;
      wm.position.set(w.x, w.level, w.z);
      wm.receiveShadow = true;
      group.add(wm);
      og.save();
      og.fillStyle = 'rgba(52, 110, 150, 0.95)';
      og.translate((w.x - b.minX) * LO_PPY, (w.z - b.minZ) * LO_PPY);
      og.rotate((w.rot || 0) * DEG);
      og.beginPath(); og.ellipse(0, 0, w.rx * LO_PPY, w.rz * LO_PPY, 0, 0, TAU); og.fill();
      og.restore();
    }
    og.fillStyle = 'rgba(14, 40, 20, 0.5)';
    for (const t of c.trees) {
      og.beginPath();
      og.arc((t.x - b.minX) * LO_PPY, (t.z - b.minZ) * LO_PPY, Math.max(0.8, t.cr * 0.55), 0, TAU);
      og.fill();
    }
    const cl = c.clubhouse;
    og.fillStyle = '#e8e2d2';
    og.fillRect((cl.x - 15 - b.minX) * LO_PPY, (cl.z - 9 - b.minZ) * LO_PPY, 30 * LO_PPY, 18 * LO_PPY);

    for (const mh of c.maps) buildPainted(mh, group);
    buildTrees(group);
    for (const h of c.holes) { buildPin(h, group); buildTeeMarkers(h, group); buildCourseFlags(h, group); }
    buildClubhouse(group);
    scene.add(group);
    return overview;
  }

  // Upgrade terrain textures near `focus`, a few rows at a time.
  function paintTick(budgetMs, fx, fz) {
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (!paintJob) {
        let best = null, bd = Infinity;
        for (const ch of chunks) {
          if (ch.hi) continue;
          const d = Math.hypot(ch.x0 + CHUNK / 2 - fx, ch.z0 + CHUNK / 2 - fz);
          if (d < bd) { bd = d; best = ch; }
        }
        if (!best) return false;
        const n = Math.round(CHUNK * HI_PPY);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = n;
        const ctx = canvas.getContext('2d');
        paintJob = { ch: best, n, canvas, ctx, img: ctx.createImageData(n, n), row: 0 };
      }
      const j = paintJob;
      const r1 = Math.min(j.n, j.row + 8);
      paintRows(j.img.data, j.n, HI_PPY, j.ch.x0, j.ch.z0, j.row, r1);
      j.row = r1;
      if (j.row >= j.n) {
        j.ctx.putImageData(j.img, 0, 0);
        const tex = chunkTexture(j.canvas);
        j.ch.mat.map = tex;
        j.ch.tex.dispose();
        j.ch.tex = tex;
        j.ch.hi = true;
        paintJob = null;
      }
    }
    return true;
  }

  // ---------- per-frame ------------------------------------------------------
  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 60 + (1 - camera.aspect) * 30 : 60;
    camera.updateProjectionMatrix();
  }

  function placeBall(b, p, mode, onTee) {
    const dist = camera.position.distanceTo(b.mesh.position);
    const r = Math.max(BALL_R, dist * 0.0032);
    b.mesh.scale.setScalar(r);
    const lift = onTee ? 0.045 : 0;
    b.mesh.position.set(p.x, p.y - BALL_R + r + lift, p.z);
    b.mesh.visible = mode !== 'water' && mode !== 'hidden';
    if (mode === 'holed') b.mesh.position.y = p.y;
    b.peg.visible = !!onTee && b.mesh.visible;
    if (onTee) b.peg.position.set(p.x, p.y - BALL_R + 0.03, p.z);
    if (!course) return;
    const gh = course.H(p.x, p.z);
    const agl = Math.max(0, p.y - BALL_R - gh);
    const n = course.normal(p.x, p.z);
    b.shadow.visible = b.mesh.visible && mode !== 'holed';
    b.shadow.position.set(p.x + n.x * 0.02, gh + 0.02, p.z + n.z * 0.02);
    b.shadow.quaternion.setFromUnitVectors(_zAxis, _n.set(n.x, n.y, n.z));
    b.shadow.scale.setScalar(r * 1.25 * (1 + agl * 0.04));
    b.shadow.material.opacity = clamp(1 - agl / 60, 0.15, 0.9);
  }
  const _zAxis = new THREE.Vector3(0, 0, 1), _n = new THREE.Vector3();
  function ballTrailReset(b) { b.trailN = 0; b.trail.geometry.setDrawRange(0, 0); b.trail.material.opacity = b.trailOpacity; }
  function ballTrailPush(b, p) {
    if (b.trailN >= 2048) return;
    const i = b.trailN++ * 3;
    b.trailPos[i] = p.x; b.trailPos[i + 1] = p.y; b.trailPos[i + 2] = p.z;
    b.trail.geometry.attributes.position.needsUpdate = true;
    b.trail.geometry.setDrawRange(0, b.trailN);
  }
  function ballTrailFade(b, dt) { b.trail.material.opacity = Math.max(0, b.trail.material.opacity - dt * 0.25); }

  function setBall(p, mode, onTee) { placeBall(ball, p, mode, onTee); }
  function trailReset() { ballTrailReset(ball); }
  function trailPush(p) { ballTrailPush(ball, p); }
  function trailFade(dt) { ballTrailFade(ball, dt); }
  function setBallColor(c) {
    ball.mesh.material.color.set(c);
    ball.mesh.material.emissive.set(c).multiplyScalar(0.19);
  }
  // Another player's ball.
  function createBall(color) {
    const b = makeBall(color, 0.45);
    return {
      set: (p, mode, onTee) => placeBall(b, p, mode, onTee),
      trailReset: () => ballTrailReset(b),
      trailPush: (p) => ballTrailPush(b, p),
      trailFade: (dt) => ballTrailFade(b, dt),
      get trailN() { return b.trailN; },
      dispose() {
        for (const o of [b.mesh, b.shadow, b.peg, b.trail]) {
          o.removeFromParent();
          if (o.geometry !== ballGeo) o.geometry.dispose();
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      },
    };
  }

  function setGuides(pts, landing, putt) {
    const n = Math.min(pts.length, 512);
    for (let i = 0; i < n; i++) {
      guides.arcPos[i * 3] = pts[i].x; guides.arcPos[i * 3 + 1] = pts[i].y; guides.arcPos[i * 3 + 2] = pts[i].z;
    }
    const g = guides.arc.geometry;
    g.attributes.position.needsUpdate = true;
    g.setDrawRange(0, n);
    guides.arc.computeLineDistances();
    let len = 0;
    for (let i = 1; i < n; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    guides.arc.material.dashSize = putt ? 0.18 : Math.max(0.5, len / 70);
    guides.arc.material.gapSize = guides.arc.material.dashSize * 0.7;
    guides.arc.visible = n > 1;
    guides.ring.visible = !!landing;
    if (landing && course) {
      const nn = course.normal(landing.x, landing.z);
      guides.ring.position.set(landing.x, course.H(landing.x, landing.z) + 0.05, landing.z);
      guides.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nn.x, nn.y, nn.z));
    }
  }
  function hideGuides() { guides.arc.visible = false; guides.ring.visible = false; }
  // The flagstick is pulled out when putting.
  function setPinVisible(index, v) {
    pins.forEach((p, i) => { const on = i !== index || v; p.pole.visible = on; p.fpivot.visible = on; p.halo.visible = !on; });
  }

  // Water splash: an expanding ripple and a burst of droplets.
  const splashes = [];
  function splash(x, y, z) {
    const ringM = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ringM.position.set(x, y + 0.03, z);
    const n = 40;
    const pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const a = Math.random() * TAU, r = Math.random() * 2.2;
      vel.push(Math.cos(a) * r, 3 + Math.random() * 4, Math.sin(a) * r);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const drops = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xe8f4ff, size: 0.18, transparent: true, opacity: 0.9, depthWrite: false }));
    drops.frustumCulled = false;
    scene.add(ringM, drops);
    splashes.push({ ring: ringM, drops, vel, y, t: 0 });
  }
  function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      s.t += dt;
      s.ring.scale.setScalar(0.3 + s.t * 3.2);
      s.ring.material.opacity = Math.max(0, 0.8 - s.t * 0.55);
      const p = s.drops.geometry.attributes.position.array;
      for (let k = 0; k < s.vel.length; k += 3) {
        s.vel[k + 1] -= G * 0.9 * dt;
        p[k] += s.vel[k] * dt; p[k + 1] = Math.max(s.y, p[k + 1] + s.vel[k + 1] * dt); p[k + 2] += s.vel[k + 2] * dt;
      }
      s.drops.geometry.attributes.position.needsUpdate = true;
      s.drops.material.opacity = Math.max(0, 0.9 - s.t * 0.7);
      if (s.t > 1.6) {
        scene.remove(s.ring, s.drops);
        s.ring.geometry.dispose(); s.ring.material.dispose();
        s.drops.geometry.dispose(); s.drops.material.dispose();
        splashes.splice(i, 1);
      }
    }
  }

  function update(dt, wind, focus) {
    time += dt;
    scene.children.forEach((o) => {
      if (o.userData.followCamera && !o.userData.base) o.userData.base = o.position.clone();
      if (o.userData.followCamera) o.position.set(o.userData.base.x + camera.position.x, o.userData.base.y, o.userData.base.z + camera.position.z);
    });
    scene.userData.sky.position.copy(camera.position);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(SUN_DIR, 300);
    // Cloud shadows drift with the wind (wrapped to keep the numbers small).
    const cl = Atmosphere.shared.cloud, WRAP = 240 * 64;
    cl.x = (cl.x - (wind.x * 0.5 + 1.6) * dt) % WRAP;
    cl.y = (cl.y - (wind.z * 0.5 + 0.7) * dt) % WRAP;
    motes.update(dt, camera, SUN_DIR, renderer.domElement.height || 600);
    waterNormal.offset.set(time * 0.012, time * 0.02);
    updateSplashes(dt);
    if (guides.ring.visible) {
      const d = camera.position.distanceTo(guides.ring.position);
      guides.ring.scale.setScalar(clamp(d * 0.018, 0.35, 7) * (1 + 0.06 * Math.sin(time * 4)));
    }
    // Flags stream downwind and the air shows streaks: the wind, without a dial.
    WindCues.updateFlags(time, wind, camera);
    if (course) streaks.update(dt, time, wind, camera, course.H);
  }

  const CLOUD_SHADOW = 0.3;
  function render() {
    // Cloud shadows only in the game's own view (not the Workshop's turntable).
    Atmosphere.shared.cloud.z = CLOUD_SHADOW;
    scene.userData.sky.material.uniforms.skyAlpha.value = postOn ? 0 : 1;
    if (postOn) post.render(scene, camera, SUN_DIR);
    else renderer.render(scene, camera);
    Atmosphere.shared.cloud.z = 0;
  }
  // Bloom, sun shafts and grading can be switched off (slow devices do it automatically).
  function setPost(on) { postOn = !!on; }

  // Adaptive resolution: drop the pixel ratio when frames run slow.
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  let ratio = maxRatio, slowT = 0, fastT = 0;
  function adapt(dt) {
    if (dt > 1 / 38) { slowT += dt; fastT = 0; } else if (dt < 1 / 57) { fastT += dt; slowT = 0; }
    if (slowT > 1.5 && ratio > 0.6) { ratio = Math.max(0.6, ratio * 0.85); slowT = 0; apply(); }
    else if (slowT > 3 && postOn) { postOn = false; slowT = 0; } // still slow at the lowest resolution
    else if (fastT > 5 && ratio < maxRatio) { ratio = Math.min(maxRatio, ratio * 1.12); fastT = 0; apply(); }
    function apply() {
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
    }
  }
  function add(obj) { scene.add(obj); }

  return {
    init, buildCourse, paintTick, resize, render, update, add, adapt, setBall, trailReset, trailPush, trailFade, setPost, createBall, setBallColor,
    setGuides, hideGuides, setAlignmentStick, setPinVisible, splash,
    get camera() { return camera; }, get renderer() { return renderer; }, get scene() { return scene; }, get post() { return postOn; }, get postParams() { return post.params; },
    get paintedChunks() { return chunks.filter((c) => c.hi).length; }, get chunkCount() { return chunks.length; },
  };
})();
