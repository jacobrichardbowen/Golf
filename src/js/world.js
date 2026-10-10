// ---------------------------------------------------------------------------
// Everything that draws: renderer, sky, terrain, trees, water, flag, ball,
// trail, aim guides. Built with THREE from a field produced by terrain.js.
// ---------------------------------------------------------------------------

const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.42).normalize();
const SKY = { top: 0x3f7fd0, horizon: 0xbcd7ec, ground: 0x7d9a76 };

const World = (() => {
  let renderer, scene, camera, sun, hemi;
  let hole = null;            // per-hole objects (disposed on change)
  let detailTex, waterNormal, flagCanvas, flagTex;
  const ball = {}, guides = {};
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
    // blur with wrap-around so it tiles
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
    camera = new THREE.PerspectiveCamera(52, 1, 0.08, 9000);
    camera.position.set(0, 3, 8);

    detailTex = makeDetailTexture();
    waterNormal = makeWaterNormal();

    // Sky dome
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
    sky.name = 'sky';
    scene.add(sky);
    scene.userData.sky = sky;

    // Environment map (for water and ball reflections) from a copy of the sky.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;

    // Distant hills: two hazy rings of silhouettes.
    const nM = makePerlin(5);
    [[1350, 0, 55, 0x5d8a5a, true], [3400, 0.62, 230, 0x6f8c99, false]].forEach(([R, haze, amp, col, fogged], k) => {
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
      const m = new THREE.Mesh(geo, fogged
        ? new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({ color: c, fog: false, side: THREE.DoubleSide }));
      m.renderOrder = -5 + k;
      m.userData.followCamera = true;
      scene.add(m);
    });

    // Clouds
    for (let i = 0; i < 14; i++) {
      const rnd = mulberry32(300 + i);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(400 + i), fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
      const a = rnd() * TAU, R = 2200 + rnd() * 2400;
      sp.position.set(Math.cos(a) * R, 380 + rnd() * 700, Math.sin(a) * R);
      sp.scale.set(900 + rnd() * 900, 300 + rnd() * 250, 1);
      sp.userData.followCamera = true;
      scene.add(sp);
    }

    // Lights
    hemi = new THREE.HemisphereLight(0xd8ecff, 0x56703a, 1.25);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    buildBall();
    buildGuides();
    flagCanvas = document.createElement('canvas');
    flagCanvas.width = 128; flagCanvas.height = 84;
    flagTex = new THREE.CanvasTexture(flagCanvas);
    flagTex.colorSpace = THREE.SRGBColorSpace;
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
    // Flight trail
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
    scene.add(guides.arc);
    const ring = new THREE.RingGeometry(0.78, 1, 48);
    ring.rotateX(-Math.PI / 2);
    guides.ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, side: THREE.DoubleSide }));
    guides.ring.renderOrder = 5;
    scene.add(guides.ring);
    const dot = new THREE.CircleGeometry(0.22, 24);
    dot.rotateX(-Math.PI / 2);
    guides.dot = new THREE.Mesh(dot, guides.ring.material);
    guides.ring.add(guides.dot);
  }

  // ---------- per-hole construction ----------------------------------------
  const SURF_RGB = [
    [112, 176, 74],  // tee
    [104, 170, 66],  // fairway
    [92, 160, 68],   // fringe
    [108, 182, 82],  // green
    [80, 138, 50],   // rough
    [64, 112, 40],   // deep rough
    [226, 210, 166], // sand
    [70, 86, 58],    // under water
    [60, 108, 38],   // oob
  ];

  function paintSurface(field, canvas, ppy) {
    const b = field.bounds;
    const W = canvas.width, Hh = canvas.height;
    const g = canvas.getContext('2d');
    const img = g.createImageData(W, Hh);
    const data = img.data;
    const nM = makePerlin((field.def.seed || 1) + 555);
    const line = field.line;
    for (let py = 0; py < Hh; py++) {
      const z = b.minZ + (py + 0.5) / ppy;
      for (let px = 0; px < W; px++) {
        const x = b.minX + (px + 0.5) / ppy;
        const s = field.surface(x, z);
        const c = SURF_RGB[s];
        let k = 1 + (hash2(px, py) - 0.5) * 0.07;
        let r = c[0], gg = c[1], bb = c[2];
        if (s === S_FAIRWAY || s === S_TEE) {
          const q = line.query(x, z);
          k *= (Math.floor(q.s / 9) & 1) ? 1.055 : 0.95;
        } else if (s === S_GREEN) {
          k *= (Math.floor((x * 0.8 + z * 0.6) / 2.2) & 1) ? 1.04 : 0.965;
        } else if (s === S_SAND) {
          k = 1 + (hash2(px, py) - 0.5) * 0.12;
        } else if (s === S_DEEP || s === S_OOB || s === S_ROUGH) {
          const m = nM(x / 26, z / 26);
          const t = smoothstep(0.1, 0.7, m) * (s === S_ROUGH ? 0.3 : 0.55);
          r = lerp(r, 132, t); gg = lerp(gg, 134, t); bb = lerp(bb, 64, t);
          k *= 1 + 0.10 * nM(x / 6 + 50, z / 6) + 0.05 * (hash2(px >> 1, py >> 1) - 0.5);
        }
        if (s !== S_SAND && s !== S_WATER) k *= 1 + 0.05 * nM(x / 15 - 20, z / 15 + 20);
        const i = (py * W + px) * 4;
        data[i] = clamp(r * k, 0, 255);
        data[i + 1] = clamp(gg * k, 0, 255);
        data[i + 2] = clamp(bb * k, 0, 255);
        data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
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

  function buildTrees(field, group) {
    // Collision trees plus a decorative ring outside the property.
    const all = field.trees.slice();
    const b = field.bounds;
    const rnd = mulberry32((field.def.seed || 1) * 7 + 3);
    for (let x = b.minX - 90; x < b.maxX + 90; x += 9) {
      for (let z = b.minZ - 90; z < b.maxZ + 90; z += 9) {
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) continue;
        if (rnd() > 0.7) continue;
        const px = x + (rnd() - 0.5) * 8, pz = z + (rnd() - 0.5) * 8;
        const pine = rnd() < 0.6;
        const height = pine ? 11 + rnd() * 9 : 9 + rnd() * 7;
        all.push({ x: px, z: pz, y0: -0.2, kind: pine ? 0 : 1, height, trunkR: 0.22 + height * 0.018, trunkH: height * (pine ? 0.3 : 0.42), rot: rnd() * TAU, tint: rnd() });
      }
    }
    const pines = all.filter((t) => t.kind === 0), oaks = all.filter((t) => t.kind === 1);

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
    const leafMat = new THREE.MeshLambertMaterial({ flatShading: true });
    const barkMat = new THREE.MeshLambertMaterial({ color: 0x5a4330 });

    const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, all.length);
    const pineMesh = new THREE.InstancedMesh(pineGeo, leafMat, Math.max(1, pines.length));
    const oakMesh = new THREE.InstancedMesh(oakGeo, leafMat, Math.max(1, oaks.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    all.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      m.compose(p.set(t.x, t.y0, t.z), q, s.set(t.trunkR, t.trunkH + 0.5, t.trunkR));
      trunks.setMatrixAt(i, m);
    });
    pines.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      const h = t.height * 0.78;
      m.compose(p.set(t.x, t.y0 + t.height * 0.22, t.z), q, s.set(t.height * 0.27, h, t.height * 0.27));
      pineMesh.setMatrixAt(i, m);
      col.setRGB(0.13 + t.tint * 0.05, 0.29 + t.tint * 0.08, 0.16 + t.tint * 0.04);
      pineMesh.setColorAt(i, col);
    });
    oaks.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      const cr = t.height * 0.36, ch = t.height * 0.34;
      m.compose(p.set(t.x, t.y0 + t.height * 0.66, t.z), q, s.set(cr, ch, cr));
      oakMesh.setMatrixAt(i, m);
      col.setRGB(0.22 + t.tint * 0.12, 0.38 + t.tint * 0.1, 0.12 + t.tint * 0.04);
      oakMesh.setColorAt(i, col);
    });
    pineMesh.count = pines.length; oakMesh.count = oaks.length;
    for (const im of [trunks, pineMesh, oakMesh]) {
      im.castShadow = true;
      im.receiveShadow = false;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  function drawFlag(num) {
    const g = flagCanvas.getContext('2d');
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 128, 84);
    g.fillStyle = '#16261d';
    g.font = '800 62px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), 64, 46);
    flagTex.needsUpdate = true;
  }

  function buildPin(field, group, num) {
    const pin = field.pin;
    const n = field.normal(pin.x, pin.z);
    const pg = new THREE.Group();
    pg.position.set(pin.x, pin.y, pin.z);
    // Cup
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
    // Pole and flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.45, 8), new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.4 }));
    pole.position.y = 1.2;
    pole.castShadow = true;
    pg.add(pole);
    drawFlag(num);
    const fg = new THREE.PlaneGeometry(0.8, 0.52, 12, 4);
    fg.translate(0.4, 0, 0);
    fg.userData.base = Float32Array.from(fg.attributes.position.array);
    const flag = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.castShadow = true;
    const fpivot = new THREE.Group();
    fpivot.position.y = 2.15;
    fpivot.add(flag);
    pg.add(fpivot);
    group.add(pg);
    return { group: pg, flag, fpivot, pole };
  }

  function buildSlopeArrows(field, group) {
    const g = field.green;
    const pts = [];
    for (let x = g.x - g.r * 1.3; x <= g.x + g.r * 1.3; x += 1.1)
      for (let z = g.z - g.r * 1.3; z <= g.z + g.r * 1.3; z += 1.1) {
        const s = field.surface(x, z);
        if (s === S_GREEN || s === S_FRINGE) pts.push([x, z]);
      }
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.28); shape.lineTo(0.16, 0.02); shape.lineTo(0.06, 0.04); shape.lineTo(0.06, -0.26);
    shape.lineTo(-0.06, -0.26); shape.lineTo(-0.06, 0.04); shape.lineTo(-0.16, 0.02); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // arrow now points to -Z
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    pts.forEach(([x, z], i) => {
      const n = field.normal(x, z);
      const slope = Math.hypot(n.x, n.z) / n.y;
      const yaw = yawFromDir(n.x, n.z); // downhill
      q.setFromAxisAngle(up, -yaw);
      const k = clamp(slope / 0.035, 0, 1);
      m.compose(p.set(x, field.H(x, z) + 0.02, z), q, sc.setScalar(0.32 + k * 0.38));
      im.setMatrixAt(i, m);
      col.setHSL(0.15 - 0.15 * k, 0.85 * k + 0.1, 0.92 - 0.3 * k);
      im.setColorAt(i, col);
    });
    im.count = pts.length;
    im.visible = false;
    im.renderOrder = 3;
    group.add(im);
    return im;
  }

  function setHole(field, num) {
    disposeHole();
    const group = new THREE.Group();
    const b = field.bounds;
    const W = b.maxX - b.minX, D = b.maxZ - b.minZ;

    // Surface texture
    const ppy = Math.min(3, 2048 / Math.max(W, D));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * ppy); canvas.height = Math.round(D * ppy);
    paintSurface(field, canvas, canvas.width / W);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Terrain mesh
    const step = 1.4;
    const nx = Math.ceil(W / step) + 1, nz = Math.ceil(D / step) + 1;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    for (let iz = 0; iz < nz; iz++)
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        const x = b.minX + (ix / (nx - 1)) * W, z = b.minZ + (iz / (nz - 1)) * D;
        pos[i * 3] = x; pos[i * 3 + 1] = field.H(x, z); pos[i * 3 + 2] = z;
        uv[i * 2] = ix / (nx - 1); uv[i * 2 + 1] = iz / (nz - 1);
      }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let o = 0;
    for (let iz = 0; iz < nz - 1; iz++)
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix, bb = a + 1, c = a + nx, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = bb;
        idx[o++] = bb; idx[o++] = c; idx[o++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, terrainMaterial(tex));
    terrain.receiveShadow = true;
    group.add(terrain);

    // Water
    const waters = [];
    for (const w of field.waters) {
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
      waters.push(wm);
    }

    buildTrees(field, group);
    const pin = buildPin(field, group, num);

    // Tee markers
    const markerGeo = new THREE.SphereGeometry(0.075, 12, 8);
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const mk = new THREE.Mesh(markerGeo, markerMat);
      const x = field.tee.x - field.teeDir.z * side * 3.2 + field.teeDir.x * 1.2;
      const z = field.tee.z + field.teeDir.x * side * 3.2 + field.teeDir.z * 1.2;
      mk.position.set(x, field.H(x, z) + 0.06, z);
      mk.castShadow = true;
      group.add(mk);
    }

    // Surrounding countryside: a flat ring around the terrain (never under it).
    const ring = new THREE.Shape();
    ring.moveTo(-7000, -7000); ring.lineTo(7000, -7000); ring.lineTo(7000, 7000); ring.lineTo(-7000, 7000); ring.closePath();
    const holePath = new THREE.Path();
    holePath.moveTo(b.minX, -b.minZ); holePath.lineTo(b.minX, -b.maxZ); holePath.lineTo(b.maxX, -b.maxZ); holePath.lineTo(b.maxX, -b.minZ); holePath.closePath();
    ring.holes.push(holePath);
    const outerGeo = new THREE.ShapeGeometry(ring);
    outerGeo.rotateX(-Math.PI / 2); // shape y -> world -z
    const outer = new THREE.Mesh(outerGeo, new THREE.MeshLambertMaterial({ color: 0x41702c }));
    outer.position.y = 0.0;
    outer.receiveShadow = true;
    group.add(outer);

    const slope = buildSlopeArrows(field, group);
    scene.add(group);
    hole = { group, field, terrain, tex, canvas, waters, pin, slope };
    return canvas;
  }

  function disposeHole() {
    if (!hole) return;
    scene.remove(hole.group);
    hole.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.map && m.map !== flagTex) m.map.dispose(); m.dispose(); });
      }
    });
    hole = null;
  }

  // ---------- per-frame ------------------------------------------------------
  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Widen the vertical field of view on tall (portrait) screens.
    camera.fov = camera.aspect < 1 ? 52 + (1 - camera.aspect) * 34 : 52;
    camera.updateProjectionMatrix();
  }

  function setBall(p, mode) {
    const field = hole && hole.field;
    const dist = camera.position.distanceTo(ball.mesh.position);
    const r = Math.max(BALL_R, dist * 0.0032);
    ball.mesh.scale.setScalar(r);
    ball.mesh.position.set(p.x, p.y - BALL_R + r, p.z);
    ball.mesh.visible = mode !== 'water' && mode !== 'hidden';
    if (mode === 'holed') ball.mesh.position.y = p.y;
    if (!field) return;
    const gh = field.H(p.x, p.z);
    const agl = Math.max(0, p.y - BALL_R - gh);
    const n = field.normal(p.x, p.z);
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

  // pts: array of {x,y,z}; landing: {x,y,z} | null
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
    guides.landing = landing;
    guides.ring.visible = !!landing;
    if (landing && hole) {
      const nn = hole.field.normal(landing.x, landing.z);
      guides.ring.position.set(landing.x, hole.field.H(landing.x, landing.z) + 0.05, landing.z);
      guides.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nn.x, nn.y, nn.z));
    }
  }
  function hideGuides() { guides.arc.visible = false; guides.ring.visible = false; guides.landing = null; }
  function showSlope(v) { if (hole) hole.slope.visible = v; }

  function update(dt, wind, focus) {
    time += dt;
    // Keep sky decorations centred on the camera.
    scene.children.forEach((o) => {
      if (o.userData.followCamera && !o.userData.base) o.userData.base = o.position.clone();
      if (o.userData.followCamera) o.position.set(o.userData.base.x + camera.position.x, o.userData.base.y, o.userData.base.z + camera.position.z);
    });
    scene.userData.sky.position.copy(camera.position);
    // Shadows follow the action.
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(SUN_DIR, 300);
    waterNormal.offset.set(time * 0.012, time * 0.02);
    updateSplashes(dt);
    if (guides.ring.visible) {
      const d = camera.position.distanceTo(guides.ring.position);
      const s = clamp(d * 0.018, 0.35, 7) * (1 + 0.06 * Math.sin(time * 4));
      guides.ring.scale.setScalar(s);
    }
    if (hole) {
      // Flag waves downwind.
      const ws = Math.hypot(wind.x, wind.z);
      hole.pin.fpivot.rotation.y = ws > 0.01 ? Math.atan2(-wind.z, wind.x) : 0;
      const fg = hole.pin.flag.geometry, base = fg.userData.base, arr = fg.attributes.position.array;
      const amp = 0.03 + Math.min(ws, 8) * 0.012;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i];
        arr[i + 2] = Math.sin(x * 7 - time * (5 + ws)) * amp * x * 1.6;
        arr[i + 1] = base[i + 1] - x * x * 0.12 * (1 - Math.min(ws, 6) / 6);
      }
      fg.attributes.position.needsUpdate = true;
      fg.computeVertexNormals();
      if (hole.slope.visible) hole.slope.material.opacity = 0.42 + 0.12 * Math.sin(time * 3);
    }
  }

  // Water splash: an expanding ripple and a burst of droplets.
  const splashes = [];
  function splash(x, y, z) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.position.set(x, y + 0.03, z);
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
    scene.add(ring, drops);
    splashes.push({ ring, drops, vel, y, t: 0 });
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

  function render() { renderer.render(scene, camera); }

  // The flagstick is pulled out when putting from close range.
  function setPinVisible(v) { if (hole) { hole.pin.pole.visible = v; hole.pin.fpivot.visible = v; } }

  return {
    init, setHole, resize, render, update, setBall, trailReset, trailPush, trailFade,
    setGuides, hideGuides, showSlope, setPinVisible, splash,
    get camera() { return camera; }, get renderer() { return renderer; }, get hole() { return hole; },
  };
})();
