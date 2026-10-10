// ---------------------------------------------------------------------------
// The golf cart: a low-poly model and arcade driving physics that follow the
// terrain and bump off trees, buildings and the water's edge.
// The model faces +Z; the driver sits on the left (+X).
// ---------------------------------------------------------------------------

const Cart = (() => {
  const WHEELBASE = 1.64;
  const MAX_FWD = 13;     // yd/s (about 27 mph: faster than a real cart, for fun)
  const MAX_REV = 4.5;
  const ACCEL = 6.5;
  const BRAKE = 15;
  const SEAT = { x: 0.3, y: 0.84, z: -0.22 };

  function create(course) {
    const L = (c) => new THREE.MeshLambertMaterial({ color: c });
    const cream = L(0xefe9d8), green = L(0x1d5537), dark = L(0x202422), tan = L(0xd9cfb6);
    const shadowed = (m) => { m.castShadow = true; return m; };
    const box = (w, h, d, mat, x, y, z) => { const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); return m; };

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    body.add(box(1.25, 0.22, 2.55, cream, 0, 0.4, 0));
    body.add(box(1.18, 0.1, 2.35, dark, 0, 0.26, 0));
    body.add(box(1.22, 0.48, 0.72, cream, 0, 0.72, 0.9));
    body.add(box(1.0, 0.06, 0.6, L(0x4a5248), 0, 0.98, 0.86));
    body.add(box(1.16, 0.2, 0.64, green, 0, 0.73, -0.22));
    body.add(box(1.16, 0.5, 0.11, green, 0, 1.08, -0.55));
    body.add(box(1.22, 0.32, 0.55, cream, 0, 0.66, -0.96));
    // Roof on four posts
    for (const [px, pz] of [[0.56, 0.6], [-0.56, 0.6], [0.56, -0.66], [-0.56, -0.66]]) {
      const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.3, 6), tan));
      post.position.set(px, 1.36, pz);
      body.add(post);
    }
    body.add(box(1.34, 0.06, 1.95, green, 0, 2.03, -0.02));
    // Steering wheel
    const column = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6), dark));
    column.position.set(SEAT.x, 0.98, 0.5);
    column.rotation.x = 0.55;
    body.add(column);
    const wheelPivot = new THREE.Group();
    wheelPivot.position.set(SEAT.x, 1.17, 0.38);
    wheelPivot.rotation.x = -1.0;
    body.add(wheelPivot);
    const steering = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 18), dark));
    wheelPivot.add(steering);
    // Headlights
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.6 });
    for (const sx of [-0.42, 0.42]) body.add(box(0.16, 0.08, 0.04, lampMat, sx, 0.78, 1.27));
    // Golf bag on the back
    const bag = new THREE.Group();
    bag.position.set(0, 0.85, -1.15);
    bag.rotation.x = -0.28;
    body.add(bag);
    const bagBody = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.95, 10), L(0x8e2f2a)));
    bagBody.position.y = 0.45;
    bag.add(bagBody);
    const steel = new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.8, roughness: 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const c = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 4), steel));
      c.position.set(Math.cos(a) * 0.07, 1.02, Math.sin(a) * 0.07);
      bag.add(c);
      const hd = box(0.05, 0.04, 0.07, i < 2 ? dark : steel, Math.cos(a) * 0.07, 1.15, Math.sin(a) * 0.07 + 0.02);
      bag.add(hd);
    }
    // Wheels
    const tyre = new THREE.CylinderGeometry(0.21, 0.21, 0.16, 14);
    tyre.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.17, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const wheels = [];
    for (const [wx, wz, front] of [[0.6, 0.82, 1], [-0.6, 0.82, 1], [0.6, -0.82, 0], [-0.6, -0.82, 0]]) {
      const steerG = new THREE.Group();
      steerG.position.set(wx, 0.21, wz);
      body.add(steerG);
      const spin = new THREE.Group();
      steerG.add(spin);
      spin.add(shadowed(new THREE.Mesh(tyre, dark)));
      spin.add(new THREE.Mesh(hubGeo, tan));
      wheels.push({ steerG, spin, front });
    }

    const st = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, steer: 0, pitch: 0, roll: 0, spin: 0, surf: S_ROUGH };

    function place(x, z, yaw) {
      st.x = x; st.z = z; st.yaw = yaw; st.speed = 0; st.steer = 0;
      st.y = course.H(x, z);
      settle(1);
      sync();
    }

    const fwd = () => ({ x: Math.sin(st.yaw), z: -Math.cos(st.yaw) });

    // Is the cart's footprint clear at (x, z, yaw)?
    function clearAt(x, z, yaw) {
      const fx = Math.sin(yaw), fz = -Math.cos(yaw);
      for (const k of [-0.95, 0, 0.95]) {
        const px = x + fx * k, pz = z + fz * k;
        if (!course.inBounds(px, pz)) return false;
        if (course.waterLevel(px, pz) > course.H(px, pz) - 0.05) return false;
        const trees = course.nearTrees(px, pz);
        if (trees) for (const t of trees) if (Math.hypot(px - t.x, pz - t.z) < t.trunkR + 0.68) return false;
        for (const o of course.obstacles) if (Math.abs(px - o.x) < o.hx + 0.7 && Math.abs(pz - o.z) < o.hz + 0.7) return false;
      }
      return true;
    }

    // Follow the ground: height, pitch and roll from the four wheels.
    function settle(k) {
      const f = fwd(), rx = -f.z, rz = f.x;
      const hb = WHEELBASE / 2, ht = 0.6;
      const hFL = course.H(st.x + f.x * hb + rx * -ht, st.z + f.z * hb + rz * -ht);
      const hFR = course.H(st.x + f.x * hb + rx * ht, st.z + f.z * hb + rz * ht);
      const hRL = course.H(st.x - f.x * hb + rx * -ht, st.z - f.z * hb + rz * -ht);
      const hRR = course.H(st.x - f.x * hb + rx * ht, st.z - f.z * hb + rz * ht);
      const y = (hFL + hFR + hRL + hRR) / 4;
      const pitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, WHEELBASE);
      const roll = Math.atan2((hFR + hRR) / 2 - (hFL + hRL) / 2, ht * 2);
      st.y += (y - st.y) * k; st.pitch += (pitch - st.pitch) * k; st.roll += (roll - st.roll) * k;
    }

    // input: { throttle: -1..1, steer: -1..1, brake: bool }. Returns events.
    function update(dt, input) {
      const ev = [];
      const surf = course.surface(st.x, st.z);
      st.surf = surf;
      let maxF = MAX_FWD;
      let drag = 0.7;
      if (surf === S_SAND) { maxF = 3; drag = 5; }
      else if (surf === S_DEEP) { maxF = 9; drag = 1.6; }
      else if (surf === S_ROUGH) { maxF = 11.5; drag = 1.0; }
      else if (surf === S_PATH) { drag = 0.4; }
      const th = input.throttle;
      if (input.brake) st.speed -= Math.sign(st.speed) * Math.min(Math.abs(st.speed), BRAKE * dt);
      else if (th > 0) st.speed += (st.speed < 0 ? BRAKE : ACCEL) * th * dt;
      else if (th < 0) st.speed += (st.speed > 0 ? -BRAKE : -ACCEL * 0.7) * -th * dt;
      else st.speed -= Math.sign(st.speed) * Math.min(Math.abs(st.speed), drag * dt);
      // Slopes
      const f = fwd();
      const slope = (course.H(st.x + f.x, st.z + f.z) - course.H(st.x - f.x, st.z - f.z)) / 2;
      st.speed -= G * slope * 0.55 * dt;
      if (st.speed > maxF) st.speed = Math.max(maxF, st.speed - 12 * dt);
      st.speed = clamp(st.speed, -MAX_REV, MAX_FWD);
      if (Math.abs(st.speed) < 0.02 && th === 0) st.speed = 0;
      // Steering (less lock at speed)
      const lock = 0.6 * (1 - 0.55 * clamp(Math.abs(st.speed) / MAX_FWD, 0, 1));
      st.steer += (input.steer * lock - st.steer) * (1 - Math.exp(-dt * 7));
      const yaw = st.yaw + (st.speed * Math.tan(st.steer) / WHEELBASE) * dt;
      const nx = st.x + Math.sin(yaw) * st.speed * dt, nz = st.z - Math.cos(yaw) * st.speed * dt;
      if (clearAt(nx, nz, yaw)) {
        st.x = nx; st.z = nz; st.yaw = yaw;
      } else {
        if (Math.abs(st.speed) > 2.5) ev.push({ type: 'bump', speed: Math.abs(st.speed) });
        st.speed = -st.speed * 0.25;
      }
      if (surf === S_GREEN && Math.abs(st.speed) > 1) ev.push({ type: 'green' });
      if (surf === S_SAND && Math.abs(st.speed) > 0.5) ev.push({ type: 'sand' });
      settle(1 - Math.exp(-dt * 12));
      st.spin += st.speed * dt / 0.21;
      sync();
      return ev;
    }

    function sync() {
      root.position.set(st.x, st.y, st.z);
      root.rotation.set(0, Math.PI - st.yaw, 0);
      body.rotation.set(-st.pitch, 0, -st.roll, 'YXZ'); // model's right side is -X
      for (const w of wheels) {
        w.spin.rotation.x = st.spin;
        w.steerG.rotation.y = w.front ? -st.steer : 0;
      }
      steering.rotation.z = st.steer * 2.5;
    }

    const _v = new THREE.Vector3();
    // World transform for the driver (golfer root) sitting in the seat.
    function seatPose() {
      root.updateMatrixWorld(true);
      body.localToWorld(_v.set(SEAT.x, SEAT.y - 0.89, SEAT.z));
      return { x: _v.x, y: _v.y, z: _v.z, yaw: st.yaw };
    }
    // Eye position for the first-person driving view.
    function eyePose() {
      root.updateMatrixWorld(true);
      body.localToWorld(_v.set(SEAT.x - 0.02, SEAT.y + 0.74, SEAT.z + 0.2));
      return { x: _v.x, y: _v.y, z: _v.z };
    }
    // Somewhere free to step out: driver's side first, then the other side.
    function exitSpot() {
      const f = fwd(), rx = -f.z, rz = f.x;
      for (const side of [-1, 1]) {
        for (const d of [1.25, 1.8, 2.4]) {
          const x = st.x + rx * side * d, z = st.z + rz * side * d;
          if (course.inBounds(x, z) && course.waterLevel(x, z) === -Infinity) return { x, z };
        }
      }
      return { x: st.x - f.x * 2.2, z: st.z - f.z * 2.2 };
    }

    return { root, st, update, place, seatPose, eyePose, exitSpot, sync };
  }

  return { create };
})();
