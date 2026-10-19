// ---------------------------------------------------------------------------
// The golf cart: a low-poly model and arcade driving physics that follow the
// terrain and bump off trees, buildings and the water's edge.
// The model faces +Z; the driver sits on the left (+X).
// ---------------------------------------------------------------------------

const CART_SEAT = { x: 0.3, y: 0.84, z: -0.22 };       // driver's seat (left)
const CART_PASSENGER = { x: -0.3, y: 0.84, z: -0.22 };  // passenger's seat (right)
const CART_BAG = { x: 0, y: 0.5, z: -1.15, tilt: -0.28 }; // bag rack at the back

// The built-in cart. Wheel groups are named wheel.FL/FR/RL/RR (each with a
// "spin.XX" child) and the steering wheel "steering-wheel", so they animate.
function cartModel() {
  const L = (name, c) => { const m = new THREE.MeshLambertMaterial({ color: c }); m.name = name; return m; };
  const cream = L('body', 0xefe9d8), green = L('seats', 0x1d5537), dark = L('trim', 0x202422), tan = L('frame', 0xd9cfb6);
  const roofMat = L('roof', 0x1d5537), dash = L('dash', 0x4a5248);
  const g = new THREE.Group();
  g.name = 'golf-cart';
  const box = (name, w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.name = name; m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  box('chassis', 1.25, 0.22, 2.55, cream, 0, 0.4, 0);
  box('floor', 1.18, 0.1, 2.35, dark, 0, 0.26, 0);
  box('cowl', 1.22, 0.48, 0.72, cream, 0, 0.72, 0.9);
  box('dash', 1.0, 0.06, 0.6, dash, 0, 0.98, 0.86);
  box('seat', 1.16, 0.2, 0.64, green, 0, 0.73, -0.22);
  box('backrest', 1.16, 0.5, 0.11, green, 0, 1.08, -0.55);
  box('rack', 1.22, 0.32, 0.55, cream, 0, 0.66, -0.96);
  for (const [px, pz] of [[0.56, 0.6], [-0.56, 0.6], [0.56, -0.66], [-0.56, -0.66]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.3, 6), tan);
    post.name = 'post'; post.position.set(px, 1.36, pz); post.castShadow = true;
    g.add(post);
  }
  box('roof', 1.34, 0.06, 1.95, roofMat, 0, 2.03, -0.02);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6), dark);
  column.name = 'steering-column'; column.position.set(CART_SEAT.x, 0.98, 0.5); column.rotation.x = 0.55;
  g.add(column);
  const wheelPivot = new THREE.Group();
  wheelPivot.name = 'steering-mount';
  wheelPivot.position.set(CART_SEAT.x, 1.17, 0.38);
  wheelPivot.rotation.x = -1.0;
  g.add(wheelPivot);
  const steering = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 18), dark);
  steering.name = 'steering-wheel'; steering.castShadow = true;
  wheelPivot.add(steering);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.6 });
  lampMat.name = 'lamp';
  for (const sx of [-0.42, 0.42]) box('headlight', 0.16, 0.08, 0.04, lampMat, sx, 0.78, 1.27);
  const tyre = new THREE.CylinderGeometry(0.21, 0.21, 0.16, 14).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.17, 10).rotateZ(Math.PI / 2);
  for (const [name, wx, wz] of [['wheel.FL', 0.6, 0.82], ['wheel.FR', -0.6, 0.82], ['wheel.RL', 0.6, -0.82], ['wheel.RR', -0.6, -0.82]]) {
    const steerG = new THREE.Group();
    steerG.name = name;
    steerG.position.set(wx, 0.21, wz);
    g.add(steerG);
    const spin = new THREE.Group();
    spin.name = 'spin.' + name.slice(6);
    steerG.add(spin);
    const t = new THREE.Mesh(tyre, dark); t.name = 'tyre'; t.castShadow = true;
    const h = new THREE.Mesh(hubGeo, tan); h.name = 'hub';
    spin.add(t, h);
  }
  return g;
}
Assets.define('golf-cart', { kind: 'model', group: 'Vehicles', name: 'Golf cart', build: cartModel,
  note: 'Real size (the default is about 2.3 m long). Ground at the origin, front towards +Z, driver on the left (+X). Wheels are nodes named wheel.FL, wheel.FR, wheel.RL and wheel.RR (origin at the hub); a child whose name starts with "spin" rolls around X, and the front pair steer. A node named "steering-wheel" turns with the steering.' });

const Cart = (() => {
  const WHEELBASE = 1.64;
  // Top speed and acceleration come from the gameplay settings (13 yd/s,
  // about 27 mph, and 6.5 yd/s² by default: faster than a real cart, for fun).
  const MAX_REV = 4.5;
  const BRAKE = 15;

  function create(course) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const model = Assets.object('golf-cart');
    body.add(model);
    // Animated parts (built-in names, or any node called "wheel...").
    const wheels = [];
    let steering = null;
    model.traverse((o) => {
      if (/^wheel/i.test(o.name) && !wheels.some((w) => w.node === o || o.parent === w.node)) {
        // (Blender may add ".001"-style suffixes to repeated names.)
        let spin = null;
        o.traverse((c) => { if (!spin && c !== o && /^spin/i.test(c.name)) spin = c; });
        wheels.push({ node: o, spin: spin || o, front: /^wheel\W*F[LR]/i.test(o.name) && !!spin });
      }
      if (/^steering-wheel/i.test(o.name)) steering = o;
    });
    // A mount for the golf bag when it rides on the back.
    const bagMount = new THREE.Group();
    bagMount.position.set(CART_BAG.x, CART_BAG.y, CART_BAG.z);
    bagMount.rotation.x = CART_BAG.tilt;
    body.add(bagMount);

    const st = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, steer: 0, pitch: 0, roll: 0, spin: 0, surf: S_ROUGH };

    // The ground under a wheel: the land, or a bridge deck or tunnel floor
    // the cart is on.
    const ground = (x, z) => (course.floor ? course.floor(x, z, st.y + 0.6) : course.H(x, z));

    // yHint: the height it's being put at (for a spot on a bridge or in a tunnel).
    function place(x, z, yaw, yHint) {
      st.x = x; st.z = z; st.yaw = yaw; st.speed = 0; st.steer = 0;
      st.y = yHint != null ? yHint : course.H(x, z);
      st.y = ground(x, z);
      settle(1);
      sync();
    }

    const fwd = () => ({ x: Math.sin(st.yaw), z: -Math.cos(st.yaw) });

    // Is the cart's footprint clear at (x, z, yaw)?
    // yRef: the height it's driving at (default: where it is now).
    function clearAt(x, z, yaw, yRef = st.y) {
      const fx = Math.sin(yaw), fz = -Math.cos(yaw);
      for (const k of [-0.95, 0, 0.95]) {
        const px = x + fx * k, pz = z + fz * k;
        if (!course.inBounds(px, pz)) return false;
        const gy = course.floor ? course.floor(px, pz, yRef + 0.6) : course.H(px, pz);
        if (course.waterLevel(px, pz) > gy - 0.05) return false;
        // Off the side of a bridge, or into a tunnel wall.
        if (Math.abs(gy - yRef) > 1.1) return false;
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
      const hFL = ground(st.x + f.x * hb + rx * -ht, st.z + f.z * hb + rz * -ht);
      const hFR = ground(st.x + f.x * hb + rx * ht, st.z + f.z * hb + rz * ht);
      const hRL = ground(st.x - f.x * hb + rx * -ht, st.z - f.z * hb + rz * -ht);
      const hRR = ground(st.x - f.x * hb + rx * ht, st.z - f.z * hb + rz * ht);
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
      const MAX_FWD = TUNE.cartSpeed, ACCEL = TUNE.cartAccel;
      // Rough, deep rough and sand hold its top speed down and drag on it
      // (sand down to 3 yd/s of 13), as much as the terrain setting says.
      let maxF = MAX_FWD;
      let drag = 0.7;
      const tc = TUNE.terrainCart;
      const off = (frac, d) => { maxF = MAX_FWD * (1 - (1 - frac) * Math.min(1, tc)); drag = 0.7 + (d - 0.7) * tc; };
      if (surf === S_SAND) off(3 / 13, 5);
      else if (surf === S_DEEP) off(9 / 13, 1.6);
      else if (surf === S_ROUGH) off(11.5 / 13, 1.0);
      else if (surf === S_PATH) drag = 0.4;
      const th = input.throttle;
      if (input.brake) st.speed -= Math.sign(st.speed) * Math.min(Math.abs(st.speed), BRAKE * dt);
      else if (th > 0) st.speed += (st.speed < 0 ? BRAKE : ACCEL) * th * dt;
      else if (th < 0) st.speed += (st.speed > 0 ? -BRAKE : -ACCEL * 0.7) * -th * dt;
      else st.speed -= Math.sign(st.speed) * Math.min(Math.abs(st.speed), drag * dt);
      // Slopes
      const f = fwd();
      const slope = (ground(st.x + f.x, st.z + f.z) - ground(st.x - f.x, st.z - f.z)) / 2;
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
        if (w.front) w.node.rotation.y = -st.steer;
      }
      if (steering) steering.rotation.z = st.steer * 2.5;
    }

    const _v = new THREE.Vector3();
    // World position for a golfer's root (feet) when sitting in a seat; the
    // pelvis sits on the cushion, so taller people sit with their feet lower.
    function seatPose(scale, passenger) {
      const seat = passenger ? CART_PASSENGER : CART_SEAT;
      root.updateMatrixWorld(true);
      body.localToWorld(_v.set(seat.x, seat.y - 0.89 * (scale || 1), seat.z));
      return { x: _v.x, y: _v.y, z: _v.z, yaw: st.yaw };
    }
    // Eye position for the first-person driving view.
    function eyePose(scale) {
      root.updateMatrixWorld(true);
      body.localToWorld(_v.set(CART_SEAT.x - 0.02, CART_SEAT.y + 0.74 * (scale || 1), CART_SEAT.z + 0.2));
      return { x: _v.x, y: _v.y, z: _v.z };
    }
    // Somewhere free to step out: driver's side first, then the other side.
    function exitSpot(passenger) {
      const f = fwd(), rx = -f.z, rz = f.x;
      // Somewhere at the cart's own level (not off the side of a bridge).
      const level = (x, z) => Math.abs(ground(x, z) - st.y) < 0.9;
      for (const side of passenger ? [1, -1] : [-1, 1]) {
        for (const d of [1.25, 1.8, 2.4]) {
          const x = st.x + rx * side * d, z = st.z + rz * side * d;
          if (course.inBounds(x, z) && course.waterLevel(x, z) === -Infinity && level(x, z)) return { x, z };
        }
      }
      const b = passenger ? -2.6 : -2.2;
      return { x: st.x + f.x * b + rx * (passenger ? 0.5 : -0.5), z: st.z + f.z * b + rz * (passenger ? 0.5 : -0.5) };
    }

    // Paint the cart in a golfer's colours: the body in the first, the seats
    // and roof in the second (materials named body, seats and roof).
    function setColors(colors) {
      model.traverse((o) => {
        if (!o.isMesh) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        const out = list.map((m) => {
          const n = (m.name || '').toLowerCase();
          const c = n.startsWith('body') ? colors.primary : n.startsWith('seat') || n.startsWith('roof') ? colors.secondary : null;
          if (c == null || !m.color) return m;
          if (!m.userData.own) { m = m.clone(); m.userData.own = true; }
          m.color.setHex(c);
          return m;
        });
        o.material = Array.isArray(o.material) ? out : out[0];
      });
    }

    return { root, st, update, place, seatPose, eyePose, exitSpot, sync, bagMount, setColors, clearAt };
  }

  return { create };
})();
