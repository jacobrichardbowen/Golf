// ---------------------------------------------------------------------------
// Wind you can see instead of a dial: flags that stream downwind (limp in a
// calm, snapping straight in a gale) and faint streaks drifting through the
// air, thicker and faster the stronger it blows.
// ---------------------------------------------------------------------------

const WindCues = (() => {
  const wavers = [];
  const PALETTE = ['#27428f', '#9c2a2a', '#2c5a33', '#c8962a', '#6b3d8a', '#1f6f74', '#a24a1c', '#33408a', '#7a1f3d'];
  const TRIM = '#e6c25a';

  // Cloth: a field colour, a gold edge and a simple emblem.
  function clothTexture(color, emblem) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 128, 80);
    g.fillStyle = TRIM;
    g.fillRect(0, 0, 128, 6); g.fillRect(0, 74, 128, 6); g.fillRect(0, 0, 6, 80);
    g.globalAlpha = 0.9;
    if (emblem === 'cross') { g.fillRect(28, 34, 50, 12); g.fillRect(47, 16, 12, 48); }
    else if (emblem === 'disc') { g.beginPath(); g.arc(46, 40, 17, 0, Math.PI * 2); g.fill(); }
    else if (emblem === 'chevron') { g.beginPath(); g.moveTo(20, 22); g.lineTo(60, 40); g.lineTo(20, 58); g.lineTo(20, 48); g.lineTo(42, 40); g.lineTo(20, 32); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Register a cloth for waving. geo spans x = 0..w from the pole (at x = 0);
  // pivot is turned each frame so +x points downwind.
  function addWaver(pivot, geo, w, phase) {
    geo.userData.base = Float32Array.from(geo.attributes.position.array);
    wavers.push({ pivot, geo, w, phase });
  }

  // A flag on a pole, base at the origin. shape: 'banner' | 'pennant'.
  function makeFlag({ height = 4, w = 1.4, h = 0.9, color = PALETTE[0], emblem = 'disc', shape = 'banner', pole = 0x6b4a2e, phase = Math.random() * 10 } = {}) {
    const g = new THREE.Group();
    g.name = 'flag';
    const poleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, height, 6).translate(0, height / 2, 0),
      new THREE.MeshLambertMaterial({ color: pole }));
    poleMesh.castShadow = true;
    g.add(poleMesh);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshLambertMaterial({ color: 0xd8b13c }));
    knob.position.y = height + 0.05;
    g.add(knob);
    const geo = new THREE.PlaneGeometry(w, h, 12, 4).translate(w / 2, -h / 2, 0);
    if (shape === 'pennant') {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / w;
        p.setY(i, -h / 2 + (p.getY(i) + h / 2) * (1 - 0.85 * u));
      }
    }
    const cloth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: clothTexture(color, emblem), side: THREE.DoubleSide }));
    cloth.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.y = height - 0.08;
    pivot.add(cloth);
    g.add(pivot);
    addWaver(pivot, geo, w, phase);
    return g;
  }

  // Stop waving the cloth of flags inside obj (it is being thrown away).
  function forget(obj) {
    for (let i = wavers.length - 1; i >= 0; i--) {
      let o = wavers[i].pivot;
      while (o && o !== obj) o = o.parent;
      if (o) wavers.splice(i, 1);
    }
  }

  // ---------- per frame ----------
  const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
  let frame = 0;
  function updateFlags(time, wind, camera) {
    const ws = Math.hypot(wind.x, wind.z);
    const sN = clamp(ws / 6.5, 0, 1);
    const yaw = ws > 0.01 ? Math.atan2(-wind.z, wind.x) : 0;
    const droop = (1 - sN) * 1.15;            // limp cloth hangs down the pole
    const cd = Math.cos(droop), sd = Math.sin(droop);
    const freq = 3 + ws * 1.3, amp = 0.05 + 0.13 * sN;
    frame++;
    for (let n = 0; n < wavers.length; n++) {
      const f = wavers[n];
      if (!f.pivot.parent) continue;
      // Downwind in world space, whatever the pole is fixed to.
      f.pivot.parent.getWorldQuaternion(_qw).invert();
      f.pivot.quaternion.copy(_qw).multiply(_q.setFromAxisAngle(_up, yaw));
      // Distant cloth only needs to move now and then.
      f.pivot.getWorldPosition(_p);
      if (_p.distanceToSquared(camera.position) > 220 * 220 && (frame + n) % 6) continue;
      const arr = f.geo.attributes.position.array, base = f.geo.userData.base, w = f.w;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i], y = base[i + 1], u = x / w;
        const flap = (Math.sin(u * 5.5 - time * freq + f.phase) * amp + Math.sin(u * 12 - time * freq * 1.7 + f.phase * 1.3) * 0.025 * sN) * w * u;
        arr[i] = x * cd;
        arr[i + 1] = y - x * sd;
        arr[i + 2] = flap;
      }
      f.geo.attributes.position.needsUpdate = true;
      f.geo.computeVertexNormals();
    }
  }

  // ---------- streaks in the air ----------
  // Thin curling ribbons that drift with the wind around the camera, like the
  // wind lines sailors read in Sea of Thieves.
  function createStreaks(count = 64) {
    const SEG = 14;
    const nv = count * SEG * 2;
    const pos = new Float32Array(nv * 3), alpha = new Float32Array(nv);
    const idx = [];
    for (let k = 0; k < count; k++)
      for (let i = 0; i < SEG - 1; i++) {
        const a = (k * SEG + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      vertexShader: 'attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * vA, 1.0); }',
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    const S = [];
    const rnd = Math.random;
    for (let k = 0; k < count; k++) S.push({ life: 0, t: 1, ox: 0, oy: 0, oz: 0, len: 4, amp: 0.4, k1: 0.6, ph: 0, ph2: 0, w: 0.05, on: false });
    const side = new THREE.Vector3(), tan = new THREE.Vector3(), view = new THREE.Vector3(), pt = new THREE.Vector3();

    function spawn(s, cam, dir, ground) {
      // Somewhere ahead of the camera and upwind, so it drifts across the view.
      const f = new THREE.Vector3();
      cam.getWorldDirection(f);
      f.y = 0; f.normalize();
      const a = rnd() * Math.PI * 2, r = 6 + rnd() * 30;
      const x = cam.position.x + f.x * 14 + Math.cos(a) * r - dir.x * 10;
      const z = cam.position.z + f.z * 14 + Math.sin(a) * r - dir.z * 10;
      s.ox = x; s.oz = z; s.oy = ground(x, z) + 1.2 + rnd() * rnd() * 9;
      s.len = 3 + rnd() * 5;
      s.amp = 0.2 + rnd() * 0.6;
      s.k1 = 0.35 + rnd() * 0.5;
      s.ph = rnd() * 6.3; s.ph2 = rnd() * 6.3;
      s.w = 0.025 + rnd() * 0.03;
      s.life = 2.2 + rnd() * 2.6;
      s.t = 0;
      s.on = true;
    }

    // wind in yd/s; ground(x, z) gives the ground height.
    function update(dt, time, wind, cam, ground) {
      const ws = Math.hypot(wind.x, wind.z);
      const dir = ws > 0.01 ? { x: wind.x / ws, z: wind.z / ws } : { x: 1, z: 0 };
      const strength = smoothstep(0.6, 5.5, ws);
      // Gusts: the number of streaks swells and fades.
      const gust = 0.65 + 0.35 * Math.sin(time * 0.37) * Math.sin(time * 0.23 + 1.3);
      const active = Math.round(count * clamp(strength * gust * 1.1, 0, 1));
      const speed = 1.5 + ws * 1.5;
      for (let k = 0; k < count; k++) {
        const s = S[k];
        if (s.on) s.t += dt;
        if ((!s.on || s.t > s.life) && k < active) spawn(s, cam, dir, ground);
        else if (s.t > s.life) s.on = false;
        const fade = s.on ? Math.min(1, s.t / 0.7, (s.life - s.t) / 0.9) : 0;
        const head = s.t * speed;
        for (let i = 0; i < SEG; i++) {
          const u = i / (SEG - 1);               // 0 tail .. 1 head
          const d = head - (1 - u) * s.len;
          const wig = Math.sin(d * s.k1 + s.ph) * s.amp, lift = Math.sin(d * s.k1 * 0.7 + s.ph2) * s.amp * 0.5;
          pt.set(s.ox + dir.x * d - dir.z * wig, s.oy + lift, s.oz + dir.z * d + dir.x * wig);
          // Tangent along the path, and a width across it facing the camera.
          tan.set(dir.x - dir.z * Math.cos(d * s.k1 + s.ph) * s.amp * s.k1, Math.cos(d * s.k1 * 0.7 + s.ph2) * s.amp * 0.35 * s.k1, dir.z + dir.x * Math.cos(d * s.k1 + s.ph) * s.amp * s.k1).normalize();
          view.subVectors(pt, cam.position);
          const dist = view.length();
          side.crossVectors(tan, view).normalize().multiplyScalar(s.w * (0.6 + dist * 0.012));
          const a = (k * SEG + i) * 2;
          pos[a * 3] = pt.x - side.x; pos[a * 3 + 1] = pt.y - side.y; pos[a * 3 + 2] = pt.z - side.z;
          pos[a * 3 + 3] = pt.x + side.x; pos[a * 3 + 4] = pt.y + side.y; pos[a * 3 + 5] = pt.z + side.z;
          // Thin at both ends, faint up close and far away.
          const along = Math.sin(Math.PI * Math.pow(u, 0.8));
          const near = smoothstep(1.5, 5, dist) * (1 - smoothstep(30, 48, dist));
          alpha[a] = alpha[a + 1] = fade * along * near * (0.16 + 0.16 * strength);
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.alpha.needsUpdate = true;
    }
    return { mesh, update };
  }

  return { makeFlag, addWaver, forget, updateFlags, createStreaks, PALETTE };
})();
