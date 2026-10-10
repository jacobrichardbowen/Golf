// ---------------------------------------------------------------------------
// The player's golfer: a low-poly figure built from primitives, with
// procedural poses for idle, walk/run, address, swing, putt and sitting in
// the cart. The model faces +Z; its left hand side is +X.
// ---------------------------------------------------------------------------

const Golfer = (() => {
  const COL = { skin: 0xd9a27c, shirt: 0x2e5e7e, pants: 0xcdb991, shoe: 0xf4f4f0, cap: 0xf2c230, dark: 0x1b1b1b };
  const CLUB_KINDS = {
    driver: { len: 1.12, head: 'wood', size: 1.25 },
    wood: { len: 1.06, head: 'wood', size: 1.0 },
    iron: { len: 0.98, head: 'iron', size: 1 },
    wedge: { len: 0.93, head: 'iron', size: 1.1 },
    putter: { len: 0.88, head: 'putter', size: 1 },
  };
  const ARM_IN = 0.345;    // inward arm angle at address, so the hands meet
  const HANDS_Y = -0.555;  // hands below the shoulder pivot at address

  function create() {
    const L = (c) => new THREE.MeshLambertMaterial({ color: c });
    const mats = {
      skin: L(COL.skin), shirt: L(COL.shirt), pants: L(COL.pants), shoe: L(COL.shoe), cap: L(COL.cap), dark: L(COL.dark),
      steel: new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.85, roughness: 0.3 }),
      head: new THREE.MeshStandardMaterial({ color: 0x23272b, metalness: 0.6, roughness: 0.35 }),
    };
    const shadowed = (m) => { m.castShadow = true; return m; };
    const cyl = (r1, r2, h, mat, seg = 8) => shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat));
    const box = (w, h, d, mat) => shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
    const ball = (r, mat, detail = 1) => shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat));

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hips = new THREE.Group();
    hips.position.y = 0.98;
    body.add(hips);
    hips.add(box(0.34, 0.18, 0.21, mats.pants));

    const legs = [1, -1].map((side) => {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.095, -0.05, 0);
      hips.add(thigh);
      const tm = cyl(0.078, 0.066, 0.47, mats.pants); tm.position.y = -0.235; thigh.add(tm);
      const knee = new THREE.Group();
      knee.position.y = -0.47;
      thigh.add(knee);
      const sm = cyl(0.064, 0.052, 0.44, mats.pants); sm.position.y = -0.22; knee.add(sm);
      const ankle = new THREE.Group();
      ankle.position.y = -0.45;
      knee.add(ankle);
      const shoe = box(0.11, 0.07, 0.27, mats.shoe); shoe.position.set(0, -0.0, 0.055); ankle.add(shoe);
      return { thigh, knee, ankle, side };
    });

    const spine = new THREE.Group();
    spine.position.y = 0.07;
    hips.add(spine);
    const torso = cyl(0.205, 0.17, 0.5, mats.shirt, 10);
    torso.scale.z = 0.62;
    torso.position.y = 0.26;
    spine.add(torso);
    const collar = cyl(0.075, 0.09, 0.05, mats.shirt, 10); collar.position.y = 0.52; spine.add(collar);
    const neck = new THREE.Group();
    neck.position.y = 0.53;
    spine.add(neck);
    const nm = cyl(0.05, 0.055, 0.1, mats.skin); nm.position.y = 0.04; neck.add(nm);
    const head = new THREE.Group();
    head.position.y = 0.09;
    neck.add(head);
    const hm = ball(0.115, mats.skin); hm.scale.set(0.95, 1.08, 1); hm.position.y = 0.1; head.add(hm);
    const crown = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.123, 12, 6, 0, TAU, 0, Math.PI / 2), mats.cap));
    crown.position.y = 0.135; head.add(crown);
    const brim = box(0.2, 0.014, 0.14, mats.cap); brim.position.set(0, 0.14, 0.12); head.add(brim);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 4), mats.dark);
      eye.position.set(sx * 0.04, 0.11, 0.104); head.add(eye);
    }

    const armsPivot = new THREE.Group();
    armsPivot.position.y = 0.47;
    spine.add(armsPivot);
    const swing = new THREE.Group();
    armsPivot.add(swing);
    const arms = [1, -1].map((side) => {
      const arm = new THREE.Group();
      arm.position.x = side * 0.2;
      swing.add(arm);
      const sleeve = cyl(0.064, 0.06, 0.15, mats.shirt); sleeve.position.y = -0.06; arm.add(sleeve);
      const upper = cyl(0.05, 0.046, 0.3, mats.skin); upper.position.y = -0.15; arm.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      arm.add(elbow);
      const fore = cyl(0.045, 0.04, 0.27, mats.skin); fore.position.y = -0.135; elbow.add(fore);
      const hand = ball(0.05, mats.skin, 0); hand.position.y = -0.29; elbow.add(hand);
      return { arm, elbow, side };
    });
    const club = new THREE.Group();
    club.position.y = HANDS_Y;
    swing.add(club);
    let clubHead = null, clubKind = null;

    function setClub(kind) {
      if (kind === clubKind) return;
      clubKind = kind;
      while (club.children.length) {
        const c = club.children.pop();
        c.geometry.dispose();
      }
      const k = CLUB_KINDS[kind];
      const grip = cyl(0.017, 0.015, 0.26, mats.dark); grip.position.y = -0.08; club.add(grip);
      const shaft = cyl(0.009, 0.007, k.len, mats.steel, 6); shaft.position.y = -k.len / 2; club.add(shaft);
      let hd;
      if (k.head === 'wood') {
        hd = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.06 * k.size, 10, 6), mats.head));
        hd.scale.set(1.3, 0.6, 1);
        hd.position.set(0, -k.len - 0.01, 0.03 * k.size);
      } else if (k.head === 'iron') {
        hd = box(0.02, 0.05, 0.085 * k.size, mats.steel);
        hd.position.set(0, -k.len - 0.01, 0.035);
      } else {
        hd = box(0.03, 0.03, 0.11, mats.head);
        hd.position.set(0, -k.len - 0.005, 0.03);
      }
      club.add(hd);
      clubHead = hd;
    }
    setClub('iron');

    // ---- pose state ----
    const P = {
      hipsY: 0.98, lean: 0, bend: 0, twist: 0, headY: 0, headX: 0, plane: 0, swingZ: 0, cock: 0,
      armX0: 0, armX1: 0, armZ0: 0.06, armZ1: -0.06, elbow0: 0.15, elbow1: 0.15,
      thigh0: 0, thigh1: 0, knee0: 0, knee1: 0, splay: 0, clubOn: 0,
    };
    const T = Object.assign({}, P);
    let phase = 0, t = 0;
    const planeCache = {};

    function targetPose(s) {
      Object.assign(T, {
        hipsY: 0.98, lean: 0, bend: 0.03, twist: 0, headY: 0, headX: 0, plane: 0, swingZ: 0, cock: 0,
        armX0: 0.05, armX1: 0.05, armZ0: 0.07, armZ1: -0.07, elbow0: 0.18, elbow1: 0.18,
        thigh0: 0, thigh1: 0, knee0: 0.04, knee1: 0.04, splay: 0.02, clubOn: 0,
      });
      if (s.mode === 'walk') {
        const v = s.speed || 0;
        const a = clamp(v / 3.5, 0, 1), r = clamp((v - 4.5) / 4, 0, 1);
        const sp = Math.sin(phase), cp = Math.cos(phase);
        const legA = (0.42 + 0.3 * r) * a;
        T.thigh0 = -sp * legA; T.thigh1 = sp * legA;
        T.knee0 = (0.1 + (0.4 + 0.8 * r) * Math.max(0, cp)) * a + 0.04;
        T.knee1 = (0.1 + (0.4 + 0.8 * r) * Math.max(0, -cp)) * a + 0.04;
        const armA = (0.35 + 0.45 * r) * a;
        T.armX0 = sp * armA; T.armX1 = -sp * armA;
        T.elbow0 = T.elbow1 = 0.2 + 1.0 * r;
        T.lean = (0.03 + 0.2 * r) * a;
        T.hipsY = 0.98 + (Math.abs(sp) - 0.6) * 0.035 * a - 0.03 * r;
        T.headX = -T.lean * 0.6;
      } else if (s.mode === 'address' || s.mode === 'swing') {
        const putt = s.putt;
        T.bend = putt ? 0.62 : 0.42;
        T.hipsY = putt ? 0.95 : 0.93;
        T.thigh0 = T.thigh1 = putt ? -0.12 : -0.22;
        T.knee0 = T.knee1 = putt ? 0.22 : 0.38;
        T.splay = putt ? 0.06 : 0.1;
        T.plane = planeFor(s.club, putt);
        T.armX0 = T.armX1 = 0;
        T.armZ0 = -ARM_IN; T.armZ1 = ARM_IN;
        T.elbow0 = T.elbow1 = putt ? 0.12 : 0.02;
        T.clubOn = 1;
        const a = s.mode === 'swing' ? s.swing || 0 : Math.sin(t * 2.2) * 0.02; // waggle at address
        T.swingZ = a;
        if (!putt) {
          T.twist = clamp(a * 0.42, -1.0, 1.1);
          T.headY = a < 0.3 ? -T.twist * 0.85 : -T.twist * 0.85 + (a - 0.3) * 0.5;
          T.cock = a < 0 ? -1.35 * smoothstep(-0.35, -2.1, a) : 0.9 * smoothstep(0.6, 2.3, a);
          // Weight shifts and the right knee releases through the finish.
          if (a > 0.5) { T.knee1 += 0.3 * smoothstep(0.5, 2.2, a); T.thigh1 += 0.15 * smoothstep(0.5, 2.2, a); }
        }
      } else if (s.mode === 'seated') {
        T.hipsY = 0.98;
        T.thigh0 = T.thigh1 = -1.42;
        T.knee0 = T.knee1 = 1.35;
        T.bend = -0.08;
        T.armX0 = T.armX1 = -0.95;
        T.elbow0 = T.elbow1 = -0.55;
        T.armZ0 = -0.12; T.armZ1 = 0.12;
        T.splay = 0.05;
      } else {
        T.bend += Math.sin(t * 1.6) * 0.012; // breathing
      }
    }

    function apply() {
      body.rotation.x = P.lean;
      hips.position.y = P.hipsY;
      spine.rotation.x = P.bend;
      spine.rotation.y = P.twist;
      head.rotation.y = P.headY;
      head.rotation.x = P.headX + P.bend * -0.35;
      armsPivot.rotation.x = P.plane;
      swing.rotation.z = P.swingZ;
      club.rotation.z = P.cock;
      club.visible = P.clubOn > 0.5;
      arms[0].arm.rotation.x = P.armX0; arms[1].arm.rotation.x = P.armX1;
      arms[0].arm.rotation.z = P.armZ0; arms[1].arm.rotation.z = P.armZ1;
      arms[0].elbow.rotation.x = -P.elbow0; arms[1].elbow.rotation.x = -P.elbow1;
      const th = [P.thigh0, P.thigh1], kn = [P.knee0, P.knee1];
      legs.forEach((l, i) => {
        l.thigh.rotation.x = th[i];
        l.thigh.rotation.z = l.side * P.splay;
        l.knee.rotation.x = kn[i];
        l.ankle.rotation.x = -(th[i] + kn[i]) - P.lean * 0.5; // keep feet flat
      });
    }

    // Solve the swing-plane angle that puts the club head on the ground.
    function planeFor(kind, putt) {
      const key = kind + (putt ? 'p' : '');
      if (planeCache[key] !== undefined) return planeCache[key];
      const save = Object.assign({}, P), saveKind = clubKind;
      setClub(kind);
      let lo = -1.9, hi = -0.1;
      const headY = (pl) => {
        Object.assign(P, {
          hipsY: putt ? 0.95 : 0.93, lean: 0, bend: putt ? 0.62 : 0.42, twist: 0, headY: 0, headX: 0, plane: pl, swingZ: 0, cock: 0,
          armX0: 0, armX1: 0, armZ0: -ARM_IN, armZ1: ARM_IN, elbow0: putt ? 0.12 : 0.02, elbow1: putt ? 0.12 : 0.02,
          thigh0: putt ? -0.12 : -0.22, thigh1: putt ? -0.12 : -0.22, knee0: putt ? 0.22 : 0.38, knee1: putt ? 0.22 : 0.38, splay: 0.1, clubOn: 1,
        });
        apply();
        root.updateMatrixWorld(true);
        return headWorld(root.matrixWorld).y;
      };
      // The arms hang straight down near plane = -bend; tilting them further
      // forward (more negative) lifts the club head off the ground.
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (headY(mid) > 0.03) lo = mid; else hi = mid;
      }
      planeCache[key] = (lo + hi) / 2;
      Object.assign(P, save);
      setClub(saveKind);
      apply();
      return planeCache[key];
    }

    const _v = new THREE.Vector3(), _m = new THREE.Matrix4();
    // Club-head position relative to the root (root transform removed).
    function headWorld(rootMatrix) {
      clubHead.getWorldPosition(_v);
      return _v.applyMatrix4(_m.copy(rootMatrix).invert());
    }

    // Where the club head sits at address, in root space.
    function addressOffset(kind, putt) {
      const pl = planeFor(kind, putt);
      const save = Object.assign({}, P);
      const pos = root.position.clone(), rot = root.rotation.y;
      root.position.set(0, 0, 0); root.rotation.y = 0;
      setClub(kind);
      targetPose({ mode: 'address', putt, club: kind });
      Object.assign(P, T, { plane: pl, swingZ: 0, twist: 0, cock: 0 });
      apply();
      root.updateMatrixWorld(true);
      clubHead.getWorldPosition(_v);
      const out = { x: _v.x, y: _v.y, z: _v.z };
      Object.assign(P, save);
      root.position.copy(pos); root.rotation.y = rot;
      apply();
      return out;
    }

    // s: { mode: 'idle'|'walk'|'address'|'swing'|'seated', speed, swing, putt, club, snap }
    function update(dt, s) {
      t += dt;
      if (s.mode === 'walk') phase += (s.speed || 0) * dt * 2.4;
      if (s.club) setClub(s.club);
      targetPose(s);
      const k = s.snap ? 1 : 1 - Math.exp(-dt * 14);
      const kSwing = s.mode === 'swing' ? 1 : 1 - Math.exp(-dt * 10);
      for (const key in T) {
        const kk = key === 'swingZ' || key === 'twist' || key === 'cock' || key === 'headY' ? kSwing : k;
        P[key] += (T[key] - P[key]) * kk;
      }
      P.clubOn = T.clubOn;
      apply();
    }

    function setVisible(v) { root.visible = v; }
    apply();

    return { root, update, setClub, addressOffset, setVisible };
  }

  // Map a club from the bag to the model's club shape.
  function kindFor(club) {
    if (club.putter) return 'putter';
    if (club.id === 'DR') return 'driver';
    if (club.id.endsWith('W')) return club.id === 'GW' ? 'wedge' : 'wood';
    if (club.id === 'PW' || club.id === 'SW' || club.id === 'LW') return 'wedge';
    return 'iron';
  }

  return { create, kindFor };
})();
