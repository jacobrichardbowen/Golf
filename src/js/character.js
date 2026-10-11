// ---------------------------------------------------------------------------
// Golfers (the player, the caddy and the line-up on the character screen).
// A low-poly figure built from rigid parts hung on named joints, with
// procedural poses for idle, walk/run, address, swing, putt and sitting.
// The model faces +Z; its left-hand side is +X.
//
// The body is a replaceable "rig" asset: export it, edit the meshes in
// Blender while keeping the joint names, and load it back. Materials named
// skin, shirt, pants, hair, shoe or eye take each character's colors.
// ---------------------------------------------------------------------------

const BASE_HEIGHT = 1.9;  // yards, unscaled model
const RIG_JOINTS = ['hips', 'thigh.L', 'knee.L', 'ankle.L', 'thigh.R', 'knee.R', 'ankle.R', 'spine', 'neck', 'head',
  'shoulders', 'swing', 'arm.L', 'elbow.L', 'arm.R', 'elbow.R'];
const ROLE_NAMES = ['skin', 'shirt', 'pants', 'hair', 'shoe', 'eye'];

const Golfer = (() => {
  const ARM_IN = 0.345;    // inward arm angle at address, so the hands meet
  const HANDS_Y = -0.555;  // hands below the shoulder pivot at address

  // Joint skeleton (positions in unscaled yards).
  function skeleton() {
    const J = {};
    const joint = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      (parent ? J[parent] : J.body).add(g);
      J[name] = g;
      return g;
    };
    J.root = new THREE.Group();
    J.body = new THREE.Group();
    J.body.name = 'body';
    J.root.add(J.body);
    joint('hips', null, 0, 0.98, 0);
    for (const [s, x] of [['L', 0.095], ['R', -0.095]]) {
      joint('thigh.' + s, 'hips', x, -0.05, 0);
      joint('knee.' + s, 'thigh.' + s, 0, -0.47, 0);
      joint('ankle.' + s, 'knee.' + s, 0, -0.45, 0);
    }
    joint('spine', 'hips', 0, 0.07, 0);
    joint('neck', 'spine', 0, 0.53, 0);
    joint('head', 'neck', 0, 0.09, 0);
    joint('shoulders', 'spine', 0, 0.47, 0);
    joint('swing', 'shoulders', 0, 0, 0);
    for (const [s, x] of [['L', 0.2], ['R', -0.2]]) {
      joint('arm.' + s, 'swing', x, 0, 0);
      joint('elbow.' + s, 'arm.' + s, 0, -0.3, 0);
    }
    joint('club', 'swing', 0, HANDS_Y, 0);
    return J;
  }

  // The built-in body parts, hung on a skeleton.
  function defaultParts(J, mats) {
    const add = (joint, name, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = true;
      J[joint].add(m);
      return m;
    };
    const cyl = (r1, r2, h, seg = 8) => new THREE.CylinderGeometry(r1, r2, h, seg);
    add('hips', 'pelvis', new THREE.BoxGeometry(0.34, 0.18, 0.21), mats.pants);
    for (const s of ['L', 'R']) {
      add('thigh.' + s, 'upper-leg.' + s, cyl(0.078, 0.066, 0.47), mats.pants, 0, -0.235);
      add('knee.' + s, 'shin.' + s, cyl(0.064, 0.052, 0.44), mats.pants, 0, -0.22);
      add('ankle.' + s, 'shoe.' + s, new THREE.BoxGeometry(0.11, 0.07, 0.27), mats.shoe, 0, 0, 0.055);
      add('arm.' + s, 'sleeve.' + s, cyl(0.064, 0.06, 0.15), mats.shirt, 0, -0.06);
      add('arm.' + s, 'upper-arm.' + s, cyl(0.05, 0.046, 0.3), mats.skin, 0, -0.15);
      add('elbow.' + s, 'forearm.' + s, cyl(0.045, 0.04, 0.27), mats.skin, 0, -0.135);
      add('elbow.' + s, 'hand.' + s, new THREE.IcosahedronGeometry(0.05, 0), mats.skin, 0, -0.29);
    }
    const torso = add('spine', 'torso', cyl(0.205, 0.17, 0.5, 10), mats.shirt, 0, 0.26);
    torso.scale.z = 0.62;
    add('spine', 'collar', cyl(0.075, 0.09, 0.05, 10), mats.shirt, 0, 0.52);
    add('neck', 'neck-skin', cyl(0.05, 0.055, 0.1), mats.skin, 0, 0.04);
    const face = add('head', 'face', new THREE.IcosahedronGeometry(0.115, 1), mats.skin, 0, 0.1);
    face.scale.set(0.95, 1.08, 1);
    const hair = add('head', 'hair', new THREE.SphereGeometry(0.124, 14, 8, 0, TAU, 0, Math.PI * 0.56), mats.hair, 0, 0.115, -0.012);
    hair.rotation.x = -0.42;
    hair.scale.set(1, 1.05, 1.06);
    const fringe = add('head', 'fringe', new THREE.BoxGeometry(0.17, 0.035, 0.05), mats.hair, 0, 0.19, 0.085);
    fringe.rotation.x = 0.35;
    for (const sx of [-1, 1]) add('head', 'eye', new THREE.SphereGeometry(0.013, 6, 4), mats.eye, sx * 0.04, 0.11, 0.104);
  }

  function materialsFor(style) {
    const L = (role, c) => { const m = new THREE.MeshLambertMaterial({ color: c }); m.name = role; return m; };
    return {
      skin: L('skin', style.skin), shirt: L('shirt', style.shirt), pants: L('pants', style.pants),
      hair: L('hair', style.hair), shoe: L('shoe', style.shoe || 0xf4f4f0), eye: L('eye', 0x1b1b1b),
    };
  }

  // Exportable default body (neutral palette = F. Froth).
  Assets.define('golfer', {
    kind: 'rig', group: 'Characters', name: 'Golfer body', joints: RIG_JOINTS,
    note: 'Real size for a 5′9″ golfer; every character and the caddy is scaled from it. Keep the joint empties and their names, and edit the meshes under them. Materials named skin, shirt, pants, hair, shoe and eye take each character’s colors.',
    build: () => {
      const J = skeleton();
      defaultParts(J, materialsFor(CHARACTERS[1]));
      J.root.name = 'golfer';
      J.club.removeFromParent();
      return J.root;
    },
  });

  function create(style) {
    const J = skeleton();
    const mats = materialsFor(style);
    const rig = Assets.rigParts('golfer');
    if (rig) {
      for (const [name, meshes] of rig) {
        if (!J[name]) continue;
        for (const m of meshes) {
          m.traverse((o) => {
            if (!o.isMesh) return;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            list.forEach((mat, i) => {
              const role = ROLE_NAMES.find((r) => (mat.name || '').toLowerCase().startsWith(r));
              if (role && mat.color) mat.color.copy(mats[role].color);
              if (Array.isArray(o.material)) o.material[i] = mat;
            });
          });
          J[name].add(m);
        }
      }
    } else defaultParts(J, mats);
    const root = J.root, body = J.body, hips = J.hips, spine = J.spine, head = J.head;
    const armsPivot = J.shoulders, swing = J.swing, club = J.club;
    const scale = style.height / BASE_HEIGHT;
    body.scale.setScalar(scale);
    const legs = ['L', 'R'].map((s, i) => ({ thigh: J['thigh.' + s], knee: J['knee.' + s], ankle: J['ankle.' + s], side: i === 0 ? 1 : -1 }));
    const arms = ['L', 'R'].map((s) => ({ arm: J['arm.' + s], elbow: J['elbow.' + s] }));

    // Club in the hands: a registered asset, with a marker at its head.
    let clubKind = null, clubHead = new THREE.Object3D();
    function setClub(kind) {
      if (kind === clubKind) return;
      clubKind = kind;
      while (club.children.length) club.remove(club.children[0]);
      const model = Assets.object(CLUB_ASSET[kind]);
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      // Measure before attaching, so the box is in the club's own frame.
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      club.add(model);
      clubHead = new THREE.Object3D();
      clubHead.position.set((box.min.x + box.max.x) / 2, box.min.y + 0.02, (box.min.z + box.max.z) / 2);
      club.add(clubHead);
    }
    setClub('iron8');

    // ---- pose state ----
    const P = {
      hipsY: 0.98, lean: 0, bend: 0, twist: 0, headY: 0, headX: 0, plane: 0, swingZ: 0, cock: 0,
      armX0: 0, armX1: 0, armZ0: 0.06, armZ1: -0.06, elbow0: 0.15, elbow1: 0.15,
      thigh0: 0, thigh1: 0, knee0: 0, knee1: 0, splay: 0, clubOn: 0,
    };
    const T = Object.assign({}, P);
    let phase = 0, t = Math.random() * 10;
    const planeCache = {};

    function targetPose(s) {
      Object.assign(T, {
        hipsY: 0.98, lean: 0, bend: 0.03, twist: 0, headY: 0, headX: 0, plane: 0, swingZ: 0, cock: 0,
        armX0: 0.05, armX1: 0.05, armZ0: 0.07, armZ1: -0.07, elbow0: 0.18, elbow1: 0.18,
        thigh0: 0, thigh1: 0, knee0: 0.04, knee1: 0.04, splay: 0.02, clubOn: 0,
      });
      if (s.mode === 'walk') {
        const v = (s.speed || 0) / scale;
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
        if (s.carry) { T.armX1 = -0.25; T.armZ1 = -0.05; T.elbow1 = 1.4; } // right hand on the bag strap
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
          if (a > 0.5) { T.knee1 += 0.3 * smoothstep(0.5, 2.2, a); T.thigh1 += 0.15 * smoothstep(0.5, 2.2, a); }
        }
      } else if (s.mode === 'seated') {
        T.hipsY = 0.98;
        T.thigh0 = T.thigh1 = -1.42;
        T.knee0 = T.knee1 = 1.35;
        T.bend = -0.08;
        if (s.passenger) {
          T.armX0 = T.armX1 = -0.35; T.elbow0 = T.elbow1 = 1.2; T.armZ0 = -0.2; T.armZ1 = 0.2;
        } else {
          T.armX0 = T.armX1 = -0.95; T.elbow0 = T.elbow1 = -0.55; T.armZ0 = -0.12; T.armZ1 = 0.12;
        }
        T.splay = 0.05;
      } else if (s.mode === 'wave') {
        T.armX0 = -2.6; T.armZ0 = 0.25 + Math.sin(t * 9) * 0.25; T.elbow0 = 0.4;
        T.bend += Math.sin(t * 1.6) * 0.012;
      } else {
        T.bend += Math.sin(t * 1.6) * 0.012; // breathing
        if (s.lookAt) T.headY = clamp(s.lookAt, -1, 1);
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

    const _v = new THREE.Vector3(), _m = new THREE.Matrix4();
    function headInRoot() {
      root.updateMatrixWorld(true);
      clubHead.getWorldPosition(_v);
      return _v.applyMatrix4(_m.copy(root.matrixWorld).invert());
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
        return headInRoot().y;
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

    // Where the club head sits at address, relative to the root (no rotation).
    const addrCache = {};
    function addressOffset(kind, putt) {
      const key = kind + (putt ? 'p' : '');
      if (addrCache[key]) return addrCache[key];
      const pl = planeFor(kind, putt);
      const save = Object.assign({}, P), saveKind = clubKind;
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
      setClub(saveKind);
      apply();
      return (addrCache[key] = out);
    }

    // s: { mode: 'idle'|'walk'|'address'|'swing'|'seated'|'wave', speed, swing, putt, club, snap, carry }
    function update(dt, s) {
      t += dt;
      if (s.mode === 'walk') phase += ((s.speed || 0) / scale) * dt * 2.4;
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

    return { root, update, setClub, addressOffset, setVisible, scale, style, joints: J };
  }

  // Map a club from the bag to its model.
  const kindFor = (club) => club.kind;

  return { create, kindFor };
})();
