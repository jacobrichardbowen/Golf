// ---------------------------------------------------------------------------
// Everything that draws: renderer, sky, chunked course terrain (with grass
// textures that sharpen progressively near the player), trees, water, flags,
// clubhouse, ball, trail and aim guides.
// ---------------------------------------------------------------------------

const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.42).normalize();
const SKY = { top: 0x3f7fd0, horizon: 0xbcd7ec, ground: 0x7d9a76 };
const CHUNK = 128;          // terrain chunk size, yards
const LO_PPY = 1;           // first-pass texture density, px per yard
const HI_PPY = 2.5;         // final texture density near the action

const World = (() => {
  let renderer, scene, camera, sun, hemi;
  let course = null;
  let detailTex, waterNormal;
  const ball = {}, guides = {};
  const chunks = [];
  const pins = [];
  const slopes = [];
  let terrainMat = null;
  let paintJob = null;
  let time = 0;

  // ---------- textures ----------------------------------------------------
  function makeDetailTexture() {
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
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
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  function makeWaterNormal() {
    const N = 128;
    const c = document.createElement('canvas');
    c.width = c.height = N;
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
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function radialTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function cloudTexture(seed) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
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
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function textTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  // ---------- one-time scene setup -----------------------------------------
  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(SKY.horizon, 320, 2300);
    camera = new THREE.PerspectiveCamera(60, 1, 0.08, 9000);
    camera.position.set(0, 3, 8);

    detailTex = makeDetailTexture();
    waterNormal = makeWaterNormal();

    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(SKY.top) },
        horizon: { value: new THREE.Color(SKY.horizon) },
        ground: { value: new THREE.Color(SKY.ground) },
        sunDir: { value: SUN_DIR },
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vDir = wp.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, pow(clamp(-h*4.0,0.0,1.0), 0.6));
          float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (pow(s, 1200.0) * 6.0 + pow(s, 14.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
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

    hemi = new THREE.HemisphereLight(0xd8ecff, 0x56703a, 1.25);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    buildBall();
    buildGuides();
  }

  function buildBall() {
    ball.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0, emissive: 0x303030 }),
    );
    ball.mesh.castShadow = true;
    scene.add(ball.mesh);
    ball.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    scene.add(ball.shadow);
    // A wooden tee peg, shown while the ball sits on the tee.
    ball.peg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.07, 6), new THREE.MeshLambertMaterial({ color: 0xf0e2c0 }));
    ball.peg.visible = false;
    scene.add(ball.peg);
    const tg = new THREE.BufferGeometry();
    ball.trailPos = new Float32Array(3 * 2048);
    tg.setAttribute('position', new THREE.BufferAttribute(ball.trailPos, 3));
    tg.setDrawRange(0, 0);
    ball.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    ball.trail.frustumCulled = false;
    ball.trailN = 0;
    scene.add(ball.trail);
  }

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
        const i = (py * w + px) * 4;
        data[i] = clamp(r * k, 0, 255);
        data[i + 1] = clamp(gg * k, 0, 255);
        data[i + 2] = clamp(bb * k, 0, 255);
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
        all.push({ x: x + (rnd() - 0.5) * 8, z: z + (rnd() - 0.5) * 8, y0: -0.2, kind: pine ? 0 : 1, height, trunkR: 0.22 + height * 0.018, trunkH: height * (pine ? 0.3 : 0.42), rot: rnd() * TAU, tint: rnd() });
      }
    const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const pineGeo = mergeGeoms([
      new THREE.ConeGeometry(1, 0.62, 8).translate(0, 0.31, 0),
      new THREE.ConeGeometry(0.78, 0.5, 8).translate(0, 0.52, 0),
      new THREE.ConeGeometry(0.5, 0.42, 8).translate(0, 0.75, 0),
    ]);
    const oakGeo = (() => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      const r = mulberry32(17);
      for (let i = 0; i < p.count; i++) {
        const k = 0.85 + r() * 0.3;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      return mergeGeoms([g]);
    })();
    // Cheap stand-ins for distant trees.
    const pineFar = new THREE.ConeGeometry(0.85, 1, 6).translate(0, 0.5, 0);
    const oakFar = new THREE.IcosahedronGeometry(1, 0);
    const trunkFar = new THREE.CylinderGeometry(0.7, 1, 1, 4).translate(0, 0.5, 0);
    const leafMat = new THREE.MeshLambertMaterial({ flatShading: true });
    const barkMat = new THREE.MeshLambertMaterial({ color: 0x5a4330 });
    // Bucket trees into tiles: off-screen tiles are culled, distant ones
    // switch to simple shapes and only nearby trees cast shadows.
    const TILE = 160;
    const tiles = new Map();
    for (const t of all) {
      const k = Math.floor(t.x / TILE) + ':' + Math.floor(t.z / TILE);
      if (!tiles.has(k)) tiles.set(k, []);
      tiles.get(k).push(t);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    function tileMeshes(list, geos, shadows) {
      const pines = list.filter((t) => t.kind === 0), oaks = list.filter((t) => t.kind === 1);
      const g = new THREE.Group();
      const trunks = new THREE.InstancedMesh(geos.trunk, barkMat, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        m.compose(p.set(t.x, t.y0, t.z), q, s.set(t.trunkR, t.trunkH + 0.5, t.trunkR));
        trunks.setMatrixAt(i, m);
      });
      const meshes = [trunks];
      if (pines.length) {
        const pm = new THREE.InstancedMesh(geos.pine, leafMat, pines.length);
        pines.forEach((t, i) => {
          q.setFromAxisAngle(up, t.rot);
          m.compose(p.set(t.x, t.y0 + t.height * 0.22, t.z), q, s.set(t.height * 0.27, t.height * 0.78, t.height * 0.27));
          pm.setMatrixAt(i, m);
          pm.setColorAt(i, col.setRGB(0.13 + t.tint * 0.05, 0.29 + t.tint * 0.08, 0.16 + t.tint * 0.04));
        });
        meshes.push(pm);
      }
      if (oaks.length) {
        const om = new THREE.InstancedMesh(geos.oak, leafMat, oaks.length);
        oaks.forEach((t, i) => {
          q.setFromAxisAngle(up, t.rot);
          const cr = t.height * 0.36, ch = t.height * 0.34;
          m.compose(p.set(t.x, t.y0 + t.height * 0.66, t.z), q, s.set(cr, ch, cr));
          om.setMatrixAt(i, m);
          om.setColorAt(i, col.setRGB(0.22 + t.tint * 0.12, 0.38 + t.tint * 0.1, 0.12 + t.tint * 0.04));
        });
        meshes.push(om);
      }
      for (const im of meshes) {
        im.castShadow = shadows;
        im.computeBoundingSphere();
        g.add(im);
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
      const near = tileMeshes(list, { trunk: trunkGeo, pine: pineGeo, oak: oakGeo }, true);
      const far = tileMeshes(list, { trunk: trunkFar, pine: pineFar, oak: oakFar }, false);
      near.position.set(-cx, -lod.position.y, -cz);
      far.position.copy(near.position);
      lod.addLevel(near, 0);
      lod.addLevel(far, 250);
      group.add(lod);
    }
  }

  // ---------- flags, tees, clubhouse -----------------------------------------
  function flagTexture(num) {
    return textTexture(128, 84, (g) => {
      g.fillStyle = '#f2c230';
      g.fillRect(0, 0, 128, 84);
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
    const cup = new THREE.Mesh(cupGeo, new THREE.MeshBasicMaterial({ color: 0x0b0f0b, polygonOffset: true, polygonOffsetFactor: -8 }));
    cup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z));
    cup.position.y = 0.003;
    pg.add(cup);
    const rimGeo = new THREE.RingGeometry(CUP_R, CUP_R * 1.12, 28);
    rimGeo.rotateX(-Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: 0xdfe8d8, polygonOffset: true, polygonOffsetFactor: -8 }));
    rim.quaternion.copy(cup.quaternion);
    rim.position.y = 0.003;
    pg.add(rim);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.45, 8), new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.4 }));
    pole.position.y = 1.2;
    pole.castShadow = true;
    pg.add(pole);
    const fg = new THREE.PlaneGeometry(0.8, 0.52, 12, 4);
    fg.translate(0.4, 0, 0);
    fg.userData.base = Float32Array.from(fg.attributes.position.array);
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
    pins.push({ group: pg, flag, fpivot, pole, phase: hole.index * 1.7 });
  }

  function buildTeeMarkers(hole, group) {
    const markerGeo = new THREE.SphereGeometry(0.075, 12, 8);
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const mk = new THREE.Mesh(markerGeo, markerMat);
      const x = hole.tee.x - hole.teeDir.z * side * 3.2 + hole.teeDir.x * 1.2;
      const z = hole.tee.z + hole.teeDir.x * side * 3.2 + hole.teeDir.z * 1.2;
      mk.position.set(x, course.H(x, z) + 0.06, z);
      mk.castShadow = true;
      group.add(mk);
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

  function buildClubhouse(group) {
    const c = course.clubhouse;
    const g = new THREE.Group();
    g.position.set(c.x, c.y, c.z);
    g.rotation.y = -(c.heading || 0) * DEG;
    const wall = new THREE.MeshLambertMaterial({ color: 0xf1ede2 });
    const trim = new THREE.MeshLambertMaterial({ color: 0x1d5537 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3b4a44 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2c3e46, roughness: 0.15, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(30, 6, 18), wall);
    body.position.y = 3;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    // Pitched roof
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-10.5, 0); roofShape.lineTo(10.5, 0); roofShape.lineTo(0, 5); roofShape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 32, bevelEnabled: false });
    roofGeo.translate(0, 0, -16);
    roofGeo.rotateY(Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 6;
    roof.castShadow = true;
    g.add(roof);
    // Windows and door on the course side (-Z)
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 0.2), glass);
      w.position.set(i * 4, 3.3, -9.05);
      g.add(w);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 0.2), trim);
    door.position.set(0, 1.7, -9.05);
    g.add(door);
    // Porch
    const porch = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 4), new THREE.MeshLambertMaterial({ color: 0x8a6f52 }));
    porch.position.set(0, 0.15, -11);
    porch.receiveShadow = true;
    g.add(porch);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(14, 0.25, 4.4), trim);
    awning.position.set(0, 4.2, -11);
    awning.castShadow = true;
    g.add(awning);
    for (const px of [-6.5, -2.2, 2.2, 6.5]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 8), wall);
      col.position.set(px, 2.1, -12.8);
      g.add(col);
    }
    // Name board
    const signTex = textTexture(512, 96, (ctx, w, h) => {
      ctx.fillStyle = '#1d5537'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f2c230';
      ctx.font = '800 58px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('PINEHAVEN GOLF CLUB', w / 2, h / 2 + 2);
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.06), new THREE.MeshLambertMaterial({ map: signTex }));
    board.position.set(0, 5.1, -9.2);
    board.rotation.y = Math.PI;
    g.add(board);
    // Flagpole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 12, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3 }));
    pole.position.set(-17, 6, -12);
    pole.castShadow = true;
    g.add(pole);
    group.add(g);
  }

  function buildSlope(hole, group) {
    const g = hole.green;
    const pts = [];
    for (let x = g.x - g.r * 1.3; x <= g.x + g.r * 1.3; x += 1.1)
      for (let z = g.z - g.r * 1.3; z <= g.z + g.r * 1.3; z += 1.1) {
        const s = course.surface(x, z);
        if (s === S_GREEN || s === S_FRINGE) pts.push([x, z]);
      }
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.28); shape.lineTo(0.16, 0.02); shape.lineTo(0.06, 0.04); shape.lineTo(0.06, -0.26);
    shape.lineTo(-0.06, -0.26); shape.lineTo(-0.06, 0.04); shape.lineTo(-0.16, 0.02); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    pts.forEach(([x, z], i) => {
      const n = course.normal(x, z);
      const slope = Math.hypot(n.x, n.z) / n.y;
      q.setFromAxisAngle(up, -yawFromDir(n.x, n.z));
      const k = clamp(slope / 0.035, 0, 1);
      m.compose(p.set(x, course.H(x, z) + 0.02, z), q, sc.setScalar(0.32 + k * 0.38));
      im.setMatrixAt(i, m);
      col.setHSL(0.15 - 0.15 * k, 0.85 * k + 0.1, 0.92 - 0.3 * k);
      im.setColorAt(i, col);
    });
    im.count = pts.length;
    im.visible = false;
    im.renderOrder = 3;
    group.add(im);
    slopes[hole.index] = im;
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
        const near = new THREE.Mesh(geo, mat), far = new THREE.Mesh(geoFar, mat);
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

    buildTrees(group);
    for (const h of c.holes) { buildPin(h, group); buildTeeMarkers(h, group); buildSlope(h, group); }
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

  function setBall(p, mode, onTee) {
    const dist = camera.position.distanceTo(ball.mesh.position);
    const r = Math.max(BALL_R, dist * 0.0032);
    ball.mesh.scale.setScalar(r);
    const lift = onTee ? 0.045 : 0;
    ball.mesh.position.set(p.x, p.y - BALL_R + r + lift, p.z);
    ball.mesh.visible = mode !== 'water' && mode !== 'hidden';
    if (mode === 'holed') ball.mesh.position.y = p.y;
    ball.peg.visible = !!onTee && ball.mesh.visible;
    if (onTee) ball.peg.position.set(p.x, p.y - BALL_R + 0.03, p.z);
    if (!course) return;
    const gh = course.H(p.x, p.z);
    const agl = Math.max(0, p.y - BALL_R - gh);
    const n = course.normal(p.x, p.z);
    ball.shadow.visible = ball.mesh.visible && mode !== 'holed';
    ball.shadow.position.set(p.x + n.x * 0.02, gh + 0.02, p.z + n.z * 0.02);
    ball.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, n.y, n.z));
    ball.shadow.scale.setScalar(r * 1.25 * (1 + agl * 0.04));
    ball.shadow.material.opacity = clamp(1 - agl / 60, 0.15, 0.9);
  }

  function trailReset() { ball.trailN = 0; ball.trail.geometry.setDrawRange(0, 0); ball.trail.material.opacity = 0.6; }
  function trailPush(p) {
    if (ball.trailN >= 2048) return;
    const i = ball.trailN++ * 3;
    ball.trailPos[i] = p.x; ball.trailPos[i + 1] = p.y; ball.trailPos[i + 2] = p.z;
    ball.trail.geometry.attributes.position.needsUpdate = true;
    ball.trail.geometry.setDrawRange(0, ball.trailN);
  }
  function trailFade(dt) {
    ball.trail.material.opacity = Math.max(0, ball.trail.material.opacity - dt * 0.25);
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
  function showSlope(index, v) { slopes.forEach((s, i) => { if (s) s.visible = v && i === index; }); }
  // The flagstick is pulled out when putting.
  function setPinVisible(index, v) { pins.forEach((p, i) => { const on = i !== index || v; p.pole.visible = on; p.fpivot.visible = on; }); }

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
    waterNormal.offset.set(time * 0.012, time * 0.02);
    updateSplashes(dt);
    if (guides.ring.visible) {
      const d = camera.position.distanceTo(guides.ring.position);
      guides.ring.scale.setScalar(clamp(d * 0.018, 0.35, 7) * (1 + 0.06 * Math.sin(time * 4)));
    }
    // Flags wave downwind; only animate the ones near the camera.
    const ws = Math.hypot(wind.x, wind.z);
    const amp = 0.03 + Math.min(ws, 8) * 0.012;
    for (const p of pins) {
      p.fpivot.rotation.y = ws > 0.01 ? Math.atan2(-wind.z, wind.x) : 0;
      if (p.group.position.distanceTo(camera.position) > 400) continue;
      const fg = p.flag.geometry, base = fg.userData.base, arr = fg.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i];
        arr[i + 2] = Math.sin(x * 7 - time * (5 + ws) + p.phase) * amp * x * 1.6;
        arr[i + 1] = base[i + 1] - x * x * 0.12 * (1 - Math.min(ws, 6) / 6);
      }
      fg.attributes.position.needsUpdate = true;
      fg.computeVertexNormals();
    }
    for (const s of slopes) if (s && s.visible) s.material.opacity = 0.42 + 0.12 * Math.sin(time * 3);
  }

  function render() { renderer.render(scene, camera); }

  // Adaptive resolution: drop the pixel ratio when frames run slow.
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  let ratio = maxRatio, slowT = 0, fastT = 0;
  function adapt(dt) {
    if (dt > 1 / 38) { slowT += dt; fastT = 0; } else if (dt < 1 / 57) { fastT += dt; slowT = 0; }
    if (slowT > 1.5 && ratio > 0.6) { ratio = Math.max(0.6, ratio * 0.85); slowT = 0; apply(); }
    else if (fastT > 5 && ratio < maxRatio) { ratio = Math.min(maxRatio, ratio * 1.12); fastT = 0; apply(); }
    function apply() {
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
    }
  }
  function add(obj) { scene.add(obj); }

  return {
    init, buildCourse, paintTick, resize, render, update, add, adapt, setBall, trailReset, trailPush, trailFade,
    setGuides, hideGuides, showSlope, setPinVisible, splash,
    get camera() { return camera; }, get renderer() { return renderer; }, get scene() { return scene; },
    get paintedChunks() { return chunks.filter((c) => c.hi).length; }, get chunkCount() { return chunks.length; },
  };
})();
