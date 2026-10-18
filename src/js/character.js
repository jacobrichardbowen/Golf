// ---------------------------------------------------------------------------
// Golfers (the player, the caddy and the line-up on the character screen).
// A low-poly figure built from rigid parts hung on named joints, with
// procedural poses for idle, walk/run, address, swing, putt and sitting.
// The model faces +Z; its left-hand side is +X.
//
// Each body type is a replaceable "rig" asset with its own proportions:
// export it, edit the meshes in Blender while keeping the joint names, and
// load it back. Materials named skin, shirt, pants, hair, shoe or eye take
// each character's colors.
// ---------------------------------------------------------------------------

const BASE_HEIGHT = 1.9;  // yards: the height `scale` is measured against
const RIG_JOINTS = ['hips', 'thigh.L', 'knee.L', 'ankle.L', 'thigh.R', 'knee.R', 'ankle.R', 'spine', 'neck', 'head',
  'shoulders', 'swing', 'arm.L', 'elbow.L', 'arm.R', 'elbow.R'];
const ROLE_NAMES = ['skin', 'shirt', 'pants', 'hair', 'shoe', 'eye'];

const Golfer = (() => {
  // Body proportions in unscaled yards: where each joint sits on its parent,
  // how far the hands hang below the shoulders at address, and the inward
  // arm angle that brings them together.
  const DEFAULT_DIMS = {
    hip: 0.98, hipX: 0.095, thigh: 0.47, shin: 0.45, spine: 0.07, neck: 0.53, head: 0.09,
    shoulders: 0.47, armX: 0.2, upper: 0.3, hands: 0.555, armIn: 0.345,
  };

  // Joint skeleton (positions in unscaled yards).
  function skeleton(D = DEFAULT_DIMS) {
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
    joint('hips', null, 0, D.hip, 0);
    for (const [s, x] of [['L', D.hipX], ['R', -D.hipX]]) {
      joint('thigh.' + s, 'hips', x, -0.05, 0);
      joint('knee.' + s, 'thigh.' + s, 0, -D.thigh, 0);
      joint('ankle.' + s, 'knee.' + s, 0, -D.shin, 0);
    }
    joint('spine', 'hips', 0, D.spine, 0);
    joint('neck', 'spine', 0, D.neck, 0);
    joint('head', 'neck', 0, D.head, 0);
    joint('shoulders', 'spine', 0, D.shoulders, 0);
    joint('swing', 'shoulders', 0, 0, 0);
    for (const [s, x] of [['L', D.armX], ['R', -D.armX]]) {
      joint('arm.' + s, 'swing', x, 0, 0);
      joint('elbow.' + s, 'arm.' + s, 0, -D.upper, 0);
    }
    joint('club', 'swing', 0, -D.hands, 0);
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

  // A helper that hangs a named mesh on a joint.
  function hanger(J) {
    return (joint, name, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = true;
      J[joint].add(m);
      return m;
    };
  }
  const cyl = (r1, r2, h, seg = 8) => new THREE.CylinderGeometry(r1, r2, h, seg);
  const ball = (r, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);

  // The inward arm angle that brings the hands together at address.
  const armIn = (D) => Math.atan2(D.armX, D.hands);

  // G. Surlaw: a tall, broad-shouldered human with a walrus moustache, who
  // stands like the hero of the story.
  const HUMAN_DIMS = {
    hip: 1.04, hipX: 0.1, thigh: 0.5, shin: 0.48, spine: 0.07, neck: 0.55, head: 0.09,
    shoulders: 0.49, armX: 0.235, upper: 0.31, hands: 0.575,
  };
  HUMAN_DIMS.armIn = armIn(HUMAN_DIMS);
  function humanParts(J, mats) {
    const add = hanger(J);
    add('hips', 'pelvis', cyl(0.17, 0.155, 0.2, 12), mats.pants).scale.z = 0.66;
    add('hips', 'belt', cyl(0.174, 0.174, 0.05, 12), mats.belt, 0, 0.085).scale.z = 0.68;
    add('hips', 'buckle', new THREE.BoxGeometry(0.06, 0.045, 0.02), mats.buckle, 0, 0.085, 0.118);
    for (const s of ['L', 'R']) {
      add('thigh.' + s, 'upper-leg.' + s, cyl(0.08, 0.066, 0.5), mats.pants, 0, -0.25);
      add('knee.' + s, 'shin.' + s, cyl(0.064, 0.053, 0.48), mats.pants, 0, -0.24);
      add('ankle.' + s, 'shoe.' + s, new THREE.BoxGeometry(0.11, 0.07, 0.3), mats.shoe, 0, 0, 0.06);
      add('arm.' + s, 'shoulder.' + s, ball(0.078, 10, 7), mats.shirt, 0, -0.015).scale.set(1.05, 0.9, 1);
      add('arm.' + s, 'sleeve.' + s, cyl(0.07, 0.062, 0.16), mats.shirt, 0, -0.065);
      add('arm.' + s, 'upper-arm.' + s, cyl(0.054, 0.047, 0.31), mats.skin, 0, -0.155);
      add('elbow.' + s, 'forearm.' + s, cyl(0.047, 0.039, 0.29), mats.skin, 0, -0.145);
      add('elbow.' + s, 'hand.' + s, new THREE.IcosahedronGeometry(0.052, 0), mats.skin, 0, -0.305);
    }
    // A broad chest tapering to the waist.
    add('spine', 'torso', cyl(0.238, 0.162, 0.52, 12), mats.shirt, 0, 0.27).scale.z = 0.64;
    add('spine', 'chest', ball(0.16, 12, 8), mats.shirt, 0, 0.38, 0.03).scale.set(1.3, 0.75, 0.75);
    for (const sx of [-1, 1]) {
      const flap = add('spine', 'collar', new THREE.BoxGeometry(0.075, 0.012, 0.06), mats.shirt, sx * 0.045, 0.535, 0.06);
      flap.rotation.set(0.5, 0, sx * -0.35);
    }
    add('spine', 'placket', new THREE.BoxGeometry(0.035, 0.12, 0.012), mats.shirt, 0, 0.47, 0.098);
    add('neck', 'neck-skin', cyl(0.048, 0.052, 0.12), mats.skin, 0, 0.04);
    add('head', 'face', new THREE.IcosahedronGeometry(0.112, 1), mats.skin, 0, 0.1).scale.set(0.92, 1.1, 1);
    add('head', 'nose', new THREE.ConeGeometry(0.02, 0.06, 6).rotateX(Math.PI / 2), mats.skin, 0, 0.095, 0.118);
    for (const sx of [-1, 1]) {
      add('head', 'ear', ball(0.026, 6, 5), mats.skin, sx * 0.102, 0.1, -0.005).scale.set(0.45, 1, 0.8);
      add('head', 'eye', ball(0.012, 6, 4), mats.eye, sx * 0.037, 0.118, 0.101);
      add('head', 'brow', new THREE.BoxGeometry(0.045, 0.014, 0.02), mats.hair, sx * 0.04, 0.142, 0.1).rotation.z = sx * -0.15;
      add('head', 'moustache-end', ball(0.022, 6, 5), mats.hair, sx * 0.055, 0.03, 0.088).scale.set(0.8, 1.5, 0.7);
    }
    // White hair round the back and sides, thinning on top, and the moustache.
    const hair = add('head', 'hair', new THREE.SphereGeometry(0.119, 14, 8, 0, TAU, 0, Math.PI * 0.62), mats.hair, 0, 0.11, -0.018);
    hair.rotation.x = -0.95;
    hair.scale.set(1.04, 1, 1.05);
    add('head', 'moustache', ball(0.05, 10, 6), mats.hair, 0, 0.055, 0.1).scale.set(1.45, 0.5, 0.55);
  }

  // F. Froth: a dwarf. Short legs, a barrel chest, broad shoulders, big
  // hands, a big round nose and a beard down to the belt.
  const DWARF_DIMS = {
    hip: 0.66, hipX: 0.12, thigh: 0.31, shin: 0.29, spine: 0.07, neck: 0.5, head: 0.1,
    shoulders: 0.43, armX: 0.27, upper: 0.26, hands: 0.48, armIn: 0.56,
  };
  function dwarfParts(J, mats) {
    const add = hanger(J);
    add('hips', 'pelvis', cyl(0.25, 0.22, 0.22, 14), mats.pants).scale.z = 0.76;
    add('hips', 'belt', cyl(0.255, 0.255, 0.08, 14), mats.belt, 0, 0.1).scale.z = 0.74;
    add('hips', 'buckle', new THREE.BoxGeometry(0.1, 0.075, 0.025), mats.buckle, 0, 0.1, 0.19);
    for (const s of ['L', 'R']) {
      add('thigh.' + s, 'upper-leg.' + s, cyl(0.1, 0.088, 0.31), mats.pants, 0, -0.155);
      add('knee.' + s, 'shin.' + s, cyl(0.086, 0.078, 0.29), mats.pants, 0, -0.145);
      add('ankle.' + s, 'boot.' + s, cyl(0.092, 0.095, 0.12, 10), mats.shoe, 0, 0.05);
      add('ankle.' + s, 'shoe.' + s, new THREE.BoxGeometry(0.15, 0.09, 0.32), mats.shoe, 0, 0.0, 0.06);
      add('arm.' + s, 'shoulder.' + s, ball(0.095, 10, 7), mats.shirt, 0, -0.02);
      add('arm.' + s, 'sleeve.' + s, cyl(0.088, 0.08, 0.15), mats.shirt, 0, -0.07);
      add('arm.' + s, 'upper-arm.' + s, cyl(0.07, 0.064, 0.26), mats.skin, 0, -0.13);
      add('elbow.' + s, 'forearm.' + s, cyl(0.068, 0.058, 0.24), mats.skin, 0, -0.12);
      add('elbow.' + s, 'hand.' + s, new THREE.IcosahedronGeometry(0.066, 0), mats.skin, 0, -0.255);
    }
    add('spine', 'torso', cyl(0.29, 0.245, 0.5, 14), mats.shirt, 0, 0.25).scale.z = 0.78;
    add('neck', 'neck-skin', cyl(0.085, 0.095, 0.1), mats.skin, 0, 0.03);
    add('head', 'face', new THREE.IcosahedronGeometry(0.15, 1), mats.skin, 0, 0.12).scale.set(1, 1.04, 0.98);
    add('head', 'nose', ball(0.046, 10, 7), mats.skin, 0, 0.1, 0.152).scale.set(0.95, 0.95, 1.1);
    for (const sx of [-1, 1]) {
      add('head', 'ear', ball(0.034, 6, 5), mats.skin, sx * 0.148, 0.12, -0.01).scale.set(0.45, 1, 0.8);
      add('head', 'eye', ball(0.016, 6, 4), mats.eye, sx * 0.052, 0.142, 0.138);
      add('head', 'brow', new THREE.BoxGeometry(0.075, 0.03, 0.035), mats.hair, sx * 0.055, 0.172, 0.135).rotation.z = sx * 0.2;
    }
    const hair = add('head', 'hair', new THREE.SphereGeometry(0.158, 14, 8, 0, TAU, 0, Math.PI * 0.56), mats.hair, 0, 0.13, -0.012);
    hair.rotation.x = -0.4;
    hair.scale.set(1.04, 1.05, 1.06);
    // The beard: cheeks to chest, with a moustache over it and a braided tip.
    add('head', 'beard', ball(0.165, 14, 10), mats.hair, 0, -0.07, 0.07).scale.set(1, 1.3, 0.66);
    add('head', 'moustache', ball(0.07, 10, 6), mats.hair, 0, 0.065, 0.138).scale.set(1.35, 0.45, 0.6);
    add('head', 'braid', new THREE.ConeGeometry(0.06, 0.2, 8).rotateX(Math.PI), mats.hair, 0, -0.3, 0.12);
    add('head', 'braid-ring', cyl(0.05, 0.05, 0.035, 10), mats.buckle, 0, -0.24, 0.12);
  }

  // A. Salt: a sporty human, a little shorter than Surlaw, with a swept-up
  // quiff, sideburns and a neat chin beard.
  const SALT_DIMS = {
    hip: 1.01, hipX: 0.094, thigh: 0.485, shin: 0.465, spine: 0.07, neck: 0.54, head: 0.09,
    shoulders: 0.48, armX: 0.215, upper: 0.305, hands: 0.565,
  };
  SALT_DIMS.armIn = armIn(SALT_DIMS);
  function saltParts(J, mats) {
    const add = hanger(J);
    add('hips', 'pelvis', cyl(0.162, 0.15, 0.2, 12), mats.pants).scale.z = 0.66;
    add('hips', 'belt', cyl(0.167, 0.167, 0.05, 12), mats.belt, 0, 0.085).scale.z = 0.68;
    add('hips', 'buckle', new THREE.BoxGeometry(0.055, 0.04, 0.02), mats.buckle, 0, 0.085, 0.113);
    for (const s of ['L', 'R']) {
      add('thigh.' + s, 'upper-leg.' + s, cyl(0.076, 0.063, 0.485), mats.pants, 0, -0.243);
      add('knee.' + s, 'shin.' + s, cyl(0.061, 0.051, 0.465), mats.pants, 0, -0.232);
      add('ankle.' + s, 'shoe.' + s, new THREE.BoxGeometry(0.105, 0.075, 0.285), mats.shoe, 0, 0, 0.06);
      add('ankle.' + s, 'sole.' + s, new THREE.BoxGeometry(0.11, 0.02, 0.29), mats.buckle, 0, -0.04, 0.06);
      add('arm.' + s, 'shoulder.' + s, ball(0.07, 10, 7), mats.shirt, 0, -0.015);
      add('arm.' + s, 'sleeve.' + s, cyl(0.066, 0.06, 0.15), mats.shirt, 0, -0.06);
      add('arm.' + s, 'cuff.' + s, cyl(0.061, 0.061, 0.025), mats.pants, 0, -0.135);
      add('arm.' + s, 'upper-arm.' + s, cyl(0.05, 0.045, 0.3), mats.skin, 0, -0.15);
      add('elbow.' + s, 'forearm.' + s, cyl(0.045, 0.038, 0.285), mats.skin, 0, -0.142);
      add('elbow.' + s, 'hand.' + s, new THREE.IcosahedronGeometry(0.049, 0), mats.skin, 0, -0.3);
    }
    add('spine', 'torso', cyl(0.212, 0.165, 0.5, 12), mats.shirt, 0, 0.26).scale.z = 0.62;
    add('spine', 'stripe', cyl(0.214, 0.205, 0.05, 12), mats.pants, 0, 0.36).scale.z = 0.63;
    for (const sx of [-1, 1]) {
      const flap = add('spine', 'collar', new THREE.BoxGeometry(0.075, 0.012, 0.06), mats.pants, sx * 0.045, 0.515, 0.065);
      flap.rotation.set(0.5, 0, sx * -0.35);
    }
    add('neck', 'neck-skin', cyl(0.05, 0.054, 0.12), mats.skin, 0, 0.04);
    add('head', 'face', new THREE.IcosahedronGeometry(0.11, 1), mats.skin, 0, 0.1).scale.set(0.94, 1.08, 1);
    add('head', 'jaw', ball(0.075, 10, 6), mats.skin, 0, 0.035, 0.035).scale.set(1.15, 0.8, 1);
    add('head', 'nose', new THREE.ConeGeometry(0.019, 0.055, 6).rotateX(Math.PI / 2), mats.skin, 0, 0.1, 0.115);
    for (const sx of [-1, 1]) {
      add('head', 'ear', ball(0.026, 6, 5), mats.skin, sx * 0.102, 0.1, -0.005).scale.set(0.45, 1, 0.8);
      add('head', 'eye', ball(0.012, 6, 4), mats.eye, sx * 0.037, 0.118, 0.1);
      add('head', 'brow', new THREE.BoxGeometry(0.046, 0.013, 0.02), mats.hair, sx * 0.04, 0.143, 0.099).rotation.z = sx * 0.12;
      add('head', 'sideburn', new THREE.BoxGeometry(0.018, 0.075, 0.035), mats.hair, sx * 0.1, 0.085, 0.03);
    }
    const hair = add('head', 'hair', new THREE.SphereGeometry(0.118, 14, 8, 0, TAU, 0, Math.PI * 0.6), mats.hair, 0, 0.115, -0.012);
    hair.rotation.x = -0.55;
    hair.scale.set(1.04, 1.02, 1.06);
    // The quiff, swept up and back off the forehead.
    const quiff = add('head', 'quiff', ball(0.075, 10, 7), mats.hair, 0, 0.215, 0.05);
    quiff.scale.set(1.2, 0.7, 1.15);
    quiff.rotation.x = -0.4;
    add('head', 'chin-beard', ball(0.03, 8, 6), mats.hair, 0, -0.005, 0.098).scale.set(1, 1.3, 0.7);
  }

  // B. B. Beetor: lanky and long-limbed, hunched forward on bent knees, with a
  // long face, a balding head, slicked-back hair at the sides and a pencil
  // moustache. Upright he'd be the tallest of them all.
  const BEETOR_DIMS = {
    hip: 1.2, hipX: 0.085, thigh: 0.585, shin: 0.555, spine: 0.06, neck: 0.56, head: 0.1,
    shoulders: 0.5, armX: 0.19, upper: 0.37, hands: 0.68,
  };
  BEETOR_DIMS.armIn = armIn(BEETOR_DIMS);
  function beetorParts(J, mats) {
    const add = hanger(J);
    add('hips', 'pelvis', cyl(0.14, 0.13, 0.2, 12), mats.pants).scale.z = 0.66;
    add('hips', 'belt', cyl(0.145, 0.145, 0.04, 12), mats.belt, 0, 0.08).scale.z = 0.68;
    for (const s of ['L', 'R']) {
      add('thigh.' + s, 'upper-leg.' + s, cyl(0.06, 0.05, 0.585), mats.pants, 0, -0.292);
      add('knee.' + s, 'knee-cap.' + s, ball(0.054, 8, 6), mats.pants, 0, 0, 0.006);
      add('knee.' + s, 'shin.' + s, cyl(0.05, 0.041, 0.555), mats.pants, 0, -0.277);
      add('ankle.' + s, 'shoe.' + s, new THREE.BoxGeometry(0.095, 0.06, 0.34), mats.shoe, 0, -0.005, 0.08);
      add('arm.' + s, 'shoulder.' + s, ball(0.058, 8, 6), mats.shirt, 0, -0.01);
      add('arm.' + s, 'sleeve.' + s, cyl(0.05, 0.044, 0.37), mats.shirt, 0, -0.185);
      add('elbow.' + s, 'forearm.' + s, cyl(0.043, 0.036, 0.3), mats.shirt, 0, -0.15);
      add('elbow.' + s, 'cuff.' + s, cyl(0.032, 0.032, 0.04), mats.skin, 0, -0.31);
      add('elbow.' + s, 'hand.' + s, new THREE.IcosahedronGeometry(0.05, 0), mats.skin, 0, -0.35).scale.set(0.8, 1.35, 0.8);
    }
    // A narrow jacket over a white shirt and a thin black tie.
    add('spine', 'torso', cyl(0.168, 0.145, 0.56, 12), mats.shirt, 0, 0.29).scale.z = 0.6;
    add('spine', 'shirt-front', new THREE.BoxGeometry(0.07, 0.24, 0.02), mats.belt, 0, 0.44, 0.088).material = mats.white;
    add('spine', 'tie', new THREE.BoxGeometry(0.022, 0.26, 0.012), mats.eye, 0, 0.43, 0.098);
    for (const sx of [-1, 1]) {
      const lapel = add('spine', 'lapel', new THREE.BoxGeometry(0.06, 0.2, 0.018), mats.shirt, sx * 0.052, 0.47, 0.09);
      lapel.rotation.z = sx * 0.3;
    }
    add('neck', 'neck-skin', cyl(0.038, 0.044, 0.15), mats.skin, 0, 0.055);
    add('head', 'face', new THREE.IcosahedronGeometry(0.105, 1), mats.skin, 0, 0.115).scale.set(0.88, 1.28, 0.98);
    add('head', 'nose', new THREE.ConeGeometry(0.021, 0.075, 6).rotateX(Math.PI / 2), mats.skin, 0, 0.11, 0.112);
    for (const sx of [-1, 1]) {
      add('head', 'ear', ball(0.03, 6, 5), mats.skin, sx * 0.093, 0.11, -0.005).scale.set(0.45, 1.15, 0.8);
      add('head', 'eye', ball(0.011, 6, 4), mats.eye, sx * 0.034, 0.142, 0.094);
      add('head', 'brow', new THREE.BoxGeometry(0.04, 0.007, 0.012), mats.hair, sx * 0.037, 0.168, 0.093).rotation.z = sx * -0.25;
      // The pencil moustache: two thin lines meeting under the nose.
      const m = add('head', 'moustache', new THREE.BoxGeometry(0.042, 0.0065, 0.008), mats.hair, sx * 0.021, 0.072, 0.105);
      m.rotation.z = sx * -0.16;
    }
    // Balding: a band of slicked-back hair round the back and sides only.
    const band = add('head', 'hair', new THREE.SphereGeometry(0.109, 16, 8, 0, TAU, Math.PI * 0.3, Math.PI * 0.27), mats.hair, 0, 0.13, -0.02);
    band.rotation.x = -0.5;
    band.scale.set(1.02, 1.15, 1.04);
  }

  // R. Cord: an elf. Slender, with long pointed ears, long fair hair, a tunic
  // and tall boots.
  const CORD_DIMS = {
    hip: 1.0, hipX: 0.085, thigh: 0.48, shin: 0.46, spine: 0.07, neck: 0.5, head: 0.09,
    shoulders: 0.45, armX: 0.19, upper: 0.3, hands: 0.55,
  };
  CORD_DIMS.armIn = armIn(CORD_DIMS);
  function cordParts(J, mats) {
    const add = hanger(J);
    add('hips', 'pelvis', cyl(0.15, 0.14, 0.2, 12), mats.pants).scale.z = 0.66;
    // The tunic flares over the hips.
    add('hips', 'tunic-hem', cyl(0.165, 0.205, 0.2, 14, true), mats.shirt, 0, -0.04).scale.z = 0.72;
    add('hips', 'belt', cyl(0.158, 0.158, 0.045, 12), mats.belt, 0, 0.08).scale.z = 0.7;
    add('hips', 'buckle', new THREE.BoxGeometry(0.045, 0.04, 0.02), mats.buckle, 0, 0.08, 0.11);
    for (const s of ['L', 'R']) {
      add('thigh.' + s, 'upper-leg.' + s, cyl(0.067, 0.056, 0.48), mats.pants, 0, -0.24);
      add('knee.' + s, 'shin.' + s, cyl(0.054, 0.045, 0.46), mats.pants, 0, -0.23);
      add('knee.' + s, 'boot.' + s, cyl(0.06, 0.054, 0.3, 10), mats.shoe, 0, -0.31);
      add('ankle.' + s, 'shoe.' + s, new THREE.BoxGeometry(0.095, 0.07, 0.27), mats.shoe, 0, 0, 0.06);
      add('ankle.' + s, 'toe.' + s, new THREE.ConeGeometry(0.035, 0.08, 6).rotateX(Math.PI / 2), mats.shoe, 0, 0.0, 0.22);
      add('arm.' + s, 'sleeve.' + s, cyl(0.056, 0.046, 0.3), mats.shirt, 0, -0.15);
      add('elbow.' + s, 'forearm.' + s, cyl(0.045, 0.04, 0.27), mats.shirt, 0, -0.135);
      add('elbow.' + s, 'cuff.' + s, cyl(0.046, 0.046, 0.04), mats.pants, 0, -0.25);
      add('elbow.' + s, 'hand.' + s, new THREE.IcosahedronGeometry(0.044, 0), mats.skin, 0, -0.29);
    }
    add('spine', 'torso', cyl(0.18, 0.152, 0.5, 12), mats.shirt, 0, 0.26).scale.z = 0.6;
    add('spine', 'trim', new THREE.BoxGeometry(0.03, 0.34, 0.012), mats.pants, 0, 0.3, 0.095);
    add('neck', 'neck-skin', cyl(0.04, 0.046, 0.12), mats.skin, 0, 0.04);
    add('head', 'face', new THREE.IcosahedronGeometry(0.104, 1), mats.skin, 0, 0.1).scale.set(0.88, 1.12, 0.96);
    add('head', 'chin', new THREE.ConeGeometry(0.05, 0.06, 8).rotateX(Math.PI), mats.skin, 0, 0.008, 0.035);
    add('head', 'nose', new THREE.ConeGeometry(0.016, 0.05, 6).rotateX(Math.PI / 2), mats.skin, 0, 0.1, 0.106);
    for (const sx of [-1, 1]) {
      // Long ears, pointing up and back.
      const ear = add('head', 'ear', new THREE.ConeGeometry(0.03, 0.17, 6), mats.skin, sx * 0.105, 0.15, -0.02);
      ear.rotation.set(-0.5, 0, sx * -0.95);
      ear.scale.z = 0.45;
      add('head', 'eye', ball(0.013, 6, 4), mats.eye, sx * 0.036, 0.118, 0.094).scale.set(1.3, 0.8, 1);
      add('head', 'brow', new THREE.BoxGeometry(0.045, 0.009, 0.015), mats.hair, sx * 0.04, 0.142, 0.094).rotation.z = sx * -0.28;
      // Locks of hair framing the face.
      add('head', 'lock', new THREE.BoxGeometry(0.03, 0.2, 0.035), mats.hair, sx * 0.09, 0.05, 0.035).rotation.z = sx * -0.08;
    }
    const hair = add('head', 'hair', new THREE.SphereGeometry(0.117, 14, 8, 0, TAU, 0, Math.PI * 0.6), mats.hair, 0, 0.11, -0.012);
    hair.rotation.x = -0.35;
    hair.scale.set(1.04, 1.05, 1.07);
    // Long hair down the back.
    add('head', 'hair-back', new THREE.BoxGeometry(0.19, 0.3, 0.05), mats.hair, 0, -0.03, -0.09).rotation.x = 0.12;
  }

  function materialsFor(style) {
    const L = (role, c) => { const m = new THREE.MeshLambertMaterial({ color: c }); m.name = role; return m; };
    return {
      skin: L('skin', style.skin), shirt: L('shirt', style.shirt), pants: L('pants', style.pants),
      hair: L('hair', style.hair), shoe: L('shoe', style.shoe || 0xf4f4f0), eye: L('eye', 0x1b1b1b),
      belt: L('belt', 0x3a2a1c), buckle: L('buckle', 0xd8b13c), white: L('white', 0xf2f0ea),
    };
  }

  // Body types: each is its own asset. `height` is the unscaled model's height;
  // characters are scaled from it to their own height.
  const BODIES = {
    golfer: { name: 'W. McBeaty & caddy body', dims: DEFAULT_DIMS, height: BASE_HEIGHT, parts: defaultParts, size: '5′9″' },
    'golfer-surlaw': { name: 'G. Surlaw body (human)', dims: HUMAN_DIMS, height: 2.0, parts: humanParts, size: '6′0″',
      // Chest out, shoulders back, feet planted wide.
      posture: { bend: -0.13, splay: 0.095, chin: 0.07 } },
    'golfer-froth': { name: 'F. Froth body (dwarf)', dims: DWARF_DIMS, height: 1.62, parts: dwarfParts, size: '4′10″' },
    'golfer-salt': { name: 'A. Salt body (human)', dims: SALT_DIMS, height: 1.944, parts: saltParts, size: '5′10″',
      posture: { bend: -0.02, splay: 0.03 } },
    'golfer-beetor': { name: 'B. B. Beetor body (human)', dims: BEETOR_DIMS, height: 2.16, parts: beetorParts, size: '6′5″',
      // Hunched over on bent knees.
      posture: { bend: 0.42, knee: 0.46, lean: 0.03 } },
    'golfer-cord': { name: 'R. Cord body (elf)', dims: CORD_DIMS, height: 1.889, parts: cordParts, size: '5′8″',
      posture: { bend: -0.03, splay: 0.02 } },
  };
  const bodyOf = (style) => style.body || 'golfer';
  // The character who wears a body (for its colors and previews).
  const styleFor = (id) => CHARACTERS.find((c) => bodyOf(c) === id) || CHARACTERS[2];

  for (const [id, B] of Object.entries(BODIES)) {
    const who = id === 'golfer' ? 'W. McBeaty and the caddy are' : `${styleFor(id).name} is`;
    Assets.define(id, {
      kind: 'rig', group: 'Characters', name: B.name, joints: RIG_JOINTS,
      note: `Real size for a ${B.size} figure; ${who} scaled from it. Keep the joint empties and their names, and edit the meshes under them. Materials named skin, shirt, pants, hair, shoe and eye take each character’s colors. Or load a rigged, skinned character (see tools/blender/ANIMATIONS.md).`,
      build: () => {
        const J = skeleton(B.dims);
        B.parts(J, materialsFor(styleFor(id)));
        J.root.name = id;
        J.club.removeFromParent();
        return J.root;
      },
    });
  }

  // ---- Rigged, skinned bodies ----
  // A body can also be a mesh skinned to an armature (tools/blender/ANIMATIONS.md).
  // Its bones are matched to the joints by name and the joint skeleton is
  // sized from them, so it still works out every pose; the bones copy those
  // poses, except where the file has a clip for what he's doing (idle, walk,
  // run...), which plays instead.

  // Bone roles and the names they go by: letters only, lower case, with the
  // side as left/right or l/r at either end ("upper_arm.L", "LeftUpLeg",
  // "DEF-thigh.L").
  const BONE_NAMES = {
    hips: ['hips', 'hip', 'pelvis'], spine: ['spine', 'abdomen', 'waist'], head: ['head'],
    upperarm: ['upperarm', 'arm'], forearm: ['forearm', 'lowerarm'], hand: ['hand'],
    thigh: ['thigh', 'upperleg', 'upleg'], shin: ['shin', 'lowerleg', 'calf', 'leg'], foot: ['foot'],
  };
  const SIDED = ['upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'];
  const NEEDED = ['hips', 'spine', 'head', 'upperarml', 'forearml', 'handl', 'thighl', 'shinl', 'footl',
    'upperarmr', 'forearmr', 'handr', 'thighr', 'shinr', 'footr'];
  // Which joint each bone copies.
  const BONE_JOINT = {
    hips: 'hips', spine: 'spine', head: 'head',
    upperarml: 'arm.L', forearml: 'elbow.L', thighl: 'thigh.L', shinl: 'knee.L', footl: 'ankle.L',
    upperarmr: 'arm.R', forearmr: 'elbow.R', thighr: 'thigh.R', shinr: 'knee.R', footr: 'ankle.R',
  };
  // Limbs are lined up along the next bone down the chain.
  const BONE_NEXT = { upperarm: 'forearm', forearm: 'hand', thigh: 'shin', shin: 'foot' };
  // Clips that play for a whole mode (walking blends walk and run by speed).
  const MODE_CLIP = { idle: 'idle', wave: 'wave' };
  const CLIP_NAMES = ['idle', 'walk', 'run', 'wave'];

  function boneRole(name) {
    let n = (name || '').toLowerCase().replace(/[^a-z]/g, '').replace(/^(mixamorig|def)/, '');
    let side = '', m;
    if ((m = n.match(/^(left|right)(.+)$/))) { side = m[1][0]; n = m[2]; } else if ((m = n.match(/^(.+?)(left|right)$/))) { side = m[2][0]; n = m[1]; }
    for (const role in BONE_NAMES) {
      const sided = SIDED.includes(role);
      if (BONE_NAMES[role].includes(n)) return sided === !!side ? role + side : null;
      if (sided && !side && /[lr]$/.test(n) && BONE_NAMES[role].includes(n.slice(0, -1))) return role + n.slice(-1);
    }
    return null;
  }

  // The skinned model for a body, with its bones found and its proportions
  // measured; null if the body isn't one (or its bones can't be told apart).
  function skinnedBody(id) {
    const sk = Assets.skinned(id);
    if (!sk) return null;
    const model = sk.scene;
    const bones = {}, order = [];
    model.traverse((o) => {
      if (!o.isBone) return;
      order.push(o);
      const r = boneRole(o.name);
      if (r && !bones[r]) bones[r] = o;
    });
    const missing = NEEDED.filter((r) => !bones[r]);
    if (missing.length) { console.warn(`${id}: no bone for ${missing.join(', ')}; using the built-in body`); return null; }
    model.updateMatrixWorld(true);
    const at = (b) => b.getWorldPosition(new THREE.Vector3());
    // His left is +X: if the names say otherwise, believe the positions.
    if (at(bones.upperarml).x < at(bones.upperarmr).x) {
      for (const r of SIDED) [bones[r + 'l'], bones[r + 'r']] = [bones[r + 'r'], bones[r + 'l']];
    }
    const thigh = at(bones.thighl), spine = at(bones.spine), sh = at(bones.upperarml), el = at(bones.forearml);
    // Where each hand holds the club: a bone named grip in the hand if there
    // is one, else part way along the hand, towards the next bone (fingers,
    // or a slot for things held), or on along the forearm.
    const grip = {};
    for (const s of ['l', 'r']) {
      const hand = bones['hand' + s], hp = at(hand);
      const marker = hand.children.find((c) => c.isBone && /grip/i.test(c.name));
      const next = hand.children.find((c) => c.isBone);
      const dir = next ? at(next).sub(hp) : hp.clone().sub(at(bones['forearm' + s])).setLength(0.12);
      grip[s] = marker ? at(marker) : hp.addScaledVector(dir, 0.6);
    }
    const fore = el.distanceTo(grip.l);
    const D = {
      hip: thigh.y + 0.05, hipX: Math.abs(thigh.x), thigh: thigh.distanceTo(at(bones.shinl)),
      shin: at(bones.shinl).distanceTo(at(bones.footl)), spine: spine.y - thigh.y - 0.05,
      neck: at(bones.head).y - spine.y, head: 0, shoulders: sh.y - spine.y, armX: Math.abs(sh.x), upper: sh.distanceTo(el),
    };
    const reach = D.upper + fore;
    D.hands = Math.sqrt(Math.max(0.01, reach * reach - D.armX * D.armX));
    D.armIn = armIn(D);
    const height = new THREE.Box3().setFromObject(model).max.y;
    return { model, clips: sk.clips, bones, order, grip, dims: D, height };
  }

  const isUnder = (o, anc) => { for (let p = o.parent; p; p = p.parent) if (p === anc) return true; return false; };

  // Drives a skinned model from the joint skeleton J (both at rest now).
  function skinDriver(S, J, mats) {
    const { model, bones, order } = S;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // the swing takes the arms outside the rest pose's bounds
      // Matte like the other golfers; materials named for a role take his colors.
      const conv = (m) => {
        const l = new THREE.MeshLambertMaterial({ map: m.map || null, color: m.color ? m.color.clone() : 0xffffff, transparent: m.transparent, alphaTest: m.alphaTest, side: m.side });
        l.name = m.name;
        const role = ROLE_NAMES.find((r) => (m.name || '').toLowerCase().startsWith(r));
        if (role) l.color.copy(mats[role].color);
        return l;
      };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    J.root.add(model);
    J.root.updateMatrixWorld(true);

    // How each bone sits against its joint: its rest orientation, turned so
    // the limb lies along the joint's limb (the rest poses needn't match: a
    // T-pose maps onto the joints' arms-down rest).
    const roleOf = new Map(Object.entries(bones).map(([r, b]) => [b, r]));
    const info = new Map();
    const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
    for (const b of order) {
      const rec = { restQ: b.quaternion.clone(), restP: b.position.clone() };
      const role = roleOf.get(b);
      const joint = role && J[BONE_JOINT[role]];
      if (joint) {
        rec.joint = joint;
        const qJ = joint.getWorldQuaternion(new THREE.Quaternion());
        const qB = b.getWorldQuaternion(new THREE.Quaternion());
        const base = role.replace(/[lr]$/, ''), next = BONE_NEXT[base] && bones[BONE_NEXT[base] + role.slice(-1)];
        if (base in BONE_NEXT) {
          b.getWorldPosition(_a);
          if (next) next.getWorldPosition(_b); else b.localToWorld(_b.set(0, 1, 0));
          const dirB = _b.sub(_a).normalize();
          joint.getWorldPosition(_c);
          const jNext = joint.children.find((c) => /^(knee|ankle|elbow)\./.test(c.name));
          if (jNext) jNext.getWorldPosition(_d); else joint.localToWorld(_d.set(0, -1, 0));
          const dirJ = _d.sub(_c).normalize();
          qB.premultiply(new THREE.Quaternion().setFromUnitVectors(dirB, dirJ));
        }
        rec.offset = qJ.invert().multiply(qB);
        if (role === 'hips') rec.offsetM = new THREE.Matrix4().copy(joint.matrixWorld).invert().multiply(b.matrixWorld);
      }
      info.set(b, rec);
    }

    // The arms, for reaching the club: bone lengths, and each grip point in
    // its forearm's frame.
    const arms = ['l', 'r'].map((sd) => {
      const up = bones['upperarm' + sd], fo = bones['forearm' + sd];
      const g = fo.worldToLocal(S.grip[sd].clone());
      return {
        up, fo, sd, upLen: up.getWorldPosition(_a).distanceTo(fo.getWorldPosition(_b)), foreLen: g.length(),
        upDir: fo.position.clone().normalize(), gripDir: g.normalize(),
      };
    });

    // Fingers, to close round the grip: each joint bends towards the grip
    // point (the knuckles at the base of the hand stay put).
    const fingers = [];
    for (const b of order) {
      if (!/(index|middle|ring|pinky|finger|thumb)/i.test(b.name) || /(^|[^0-9])0?0([^0-9]|$)|base|meta/i.test(b.name)) continue;
      // Along the finger: to the next joint, or (the tip) along the bone.
      const child = b.children.find((c) => c.isBone), from = b.getWorldPosition(new THREE.Vector3());
      const along = (child ? child.getWorldPosition(new THREE.Vector3()) : b.localToWorld(new THREE.Vector3(0, 1, 0))).sub(from).normalize();
      const toGrip = S.grip[isUnder(b, bones.handl) ? 'l' : 'r'].clone().sub(from);
      const axis = new THREE.Vector3().crossVectors(along, toGrip).normalize();
      if (axis.lengthSq() < 0.5) continue;
      axis.applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert());
      fingers.push({ b, axis, angle: /thumb/i.test(b.name) ? 0.45 : 1.05 });
    }

    // Clips, and how fast the walk and run cover the ground.
    const mixer = new THREE.AnimationMixer(model);
    const act = {};
    for (const c of S.clips) {
      const name = c.name.toLowerCase();
      if (!CLIP_NAMES.includes(name) || act[name]) continue;
      const a = mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      act[name] = { a, dur: Math.max(0.05, c.duration), w: 0, speed: 1, phase0: 0 };
    }
    const _p = new THREE.Vector3();
    for (const name of ['walk', 'run']) {
      const A = act[name];
      if (!A) continue;
      A.a.setEffectiveWeight(1);
      const N = 64, pts = [];
      for (let i = 0; i < N; i++) {
        A.a.time = (i / N) * A.dur;
        mixer.update(0);
        model.updateMatrixWorld(true);
        bones.footl.getWorldPosition(_p);
        pts.push({ y: _p.y, z: _p.z });
      }
      A.a.setEffectiveWeight(0);
      // The planted foot slides back at the speed he walks: how far it goes
      // while it's down (the longest stretch of it on the ground), how fast.
      const ys = pts.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
      const down = (i) => pts[i % N].y < lo + (hi - lo) * 0.3;
      let n = 0, dz = 0;
      for (let i = 0; i < N; i++) {
        if (!down(i) || down(i + N - 1)) continue;
        let k = 0;
        while (k < N - 1 && down(i + k + 1)) k++;
        if (k > n) { n = k; dz = pts[i].z - pts[(i + k) % N].z; }
      }
      A.speed = n && dz > 0 ? dz / ((n * A.dur) / N) : (name === 'run' ? 3 : 1.4);
      // Line the clips up on the left foot's furthest reach forward.
      let best = 0;
      for (let i = 1; i < N; i++) if (pts[i].z > pts[best].z) best = i;
      A.phase0 = best / N;
    }
    if (act.idle) act.idle.w = 1;
    mixer.update(0);

    let wProc = act.idle ? 0 : 1, gait = 0, scale = 1;
    const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _s = new THREE.Vector3();

    // Turn a bone (in the world) so that `dir` (in its own frame) points from
    // `from` towards `to`; by w.
    const _cur = new THREE.Vector3(), _to = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qw = new THREE.Quaternion();
    function aim(bone, dir, from, to, w) {
      bone.getWorldQuaternion(_qw);
      _cur.copy(dir).applyQuaternion(_qw);
      _to.subVectors(to, from).normalize();
      _qw.premultiply(_qa.setFromUnitVectors(_cur, _to));
      bone.parent.getWorldQuaternion(_pq);
      bone.quaternion.slerp(_qw.premultiply(_pq.invert()), w);
      bone.updateMatrixWorld(true);
    }
    // Two-bone reach: the arm bends at the elbow (down and back) to put the
    // grip point on `T`, or stretches towards it.
    const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _t = new THREE.Vector3(), _w = new THREE.Vector3();
    function reach(arm, T, w) {
      arm.up.getWorldPosition(_S);
      const a = arm.upLen * scale, b = arm.foreLen * scale;
      const d = clamp(T.distanceTo(_S), Math.abs(a - b) + 1e-4, a + b - 1e-4);
      _t.subVectors(T, _S).normalize();
      // Elbows point at the ground, a little behind him.
      _w.set(0, 0, -1).transformDirection(J.root.matrixWorld).multiplyScalar(0.4).add(_c.set(0, -1, 0));
      _w.addScaledVector(_t, -_w.dot(_t));
      if (_w.lengthSq() < 1e-6) _w.set(1, 0, 0).addScaledVector(_t, -_t.x);
      _w.normalize();
      const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
      _E.copy(_S).addScaledVector(_t, a * cosA).addScaledVector(_w, a * Math.sqrt(1 - cosA * cosA));
      aim(arm.up, arm.upDir, _S, _E, w);
      arm.fo.getWorldPosition(_E);
      aim(arm.fo, arm.gripDir, _E, T, w);
    }
    // Hands on the club. The joints' arms swing as a rigid triangle whose
    // shoulders turn with it; his shoulders stay on his chest, so where the
    // grip is out of reach (deep in the backswing and the finish) the club
    // comes in towards him along the line it's on.
    const _G = new THREE.Vector3(), _M = new THREE.Vector3(), _u = new THREE.Vector3(), _SL = new THREE.Vector3(), _SR = new THREE.Vector3(), _hT = new THREE.Vector3();
    function holdClub(w) {
      const club = J.club;
      club.getWorldPosition(_G);
      arms[0].up.getWorldPosition(_SL);
      arms[1].up.getWorldPosition(_SR);
      _M.addVectors(_SL, _SR).multiplyScalar(0.5);
      _u.subVectors(_G, _M);
      const len = _u.length();
      _u.divideScalar(len || 1);
      let t = len;
      for (const [arm, sp] of [[arms[0], _SL], [arms[1], _SR]]) {
        const L = (arm.upLen + arm.foreLen) * scale * 0.97;
        _c.subVectors(sp, _M);
        const bb = _u.dot(_c), disc = bb * bb - _c.lengthSq() + L * L;
        if (disc > 0) t = Math.min(t, bb + Math.sqrt(disc));
      }
      if (t < len) {
        _G.copy(_M).addScaledVector(_u, t);
        club.position.lerp(club.parent.worldToLocal(_c.copy(_G)), w);
        club.updateMatrixWorld(true);
        club.getWorldPosition(_G);
      }
      // Left hand above the right on the grip.
      _u.setFromMatrixColumn(club.matrixWorld, 1).normalize();
      const gap = 0.032 * scale;
      reach(arms[0], _hT.copy(_G).addScaledVector(_u, gap), w);
      reach(arms[1], _hT.copy(_G).addScaledVector(_u, -gap), w);
      // Fingers closed round it.
      for (const f of fingers) {
        f.b.quaternion.multiply(_qa.setFromAxisAngle(f.axis, f.angle * w));
        f.b.updateMatrixWorld(true);
      }
    }

    // Copy the joints' pose onto the bones, by w (0 = leave the clip's pose).
    function copyPose(w) {
      J.root.updateWorldMatrix(true, true);
      for (const b of order) {
        const rec = info.get(b);
        if (rec.offsetM) {
          _mi.copy(b.parent.matrixWorld).invert();
          _m.multiplyMatrices(rec.joint.matrixWorld, rec.offsetM).premultiply(_mi);
          _m.decompose(_p, _q, _s);
          b.position.lerp(_p, w);
        } else if (rec.joint) {
          rec.joint.getWorldQuaternion(_q).multiply(rec.offset);
          b.parent.matrixWorld.decompose(_p, _pq, _s);
          _q.premultiply(_pq.invert());
          b.position.lerp(rec.restP, w);
        } else {
          _q.copy(rec.restQ);
          b.position.lerp(rec.restP, w);
        }
        b.quaternion.slerp(_q, w);
        b.updateMatrix();
        b.matrixWorld.multiplyMatrices(b.parent.matrixWorld, b.matrix);
      }
    }

    function drive(dt, s, clubOn) {
      const k = s.snap ? 1 : 1 - Math.exp(-dt * 9);
      // The clips for what he's doing, if the model has them.
      let want = null;
      if (s.mode === 'walk' && act.walk) {
        const u = s.speed || 0, W = act.walk, R = act.run;
        const move = act.idle ? smoothstep(0.05, 0.6, u) : 1;
        const run = R ? smoothstep(W.speed * scale * 1.1, R.speed * scale * 0.95, u) : 0;
        want = { idle: 1 - move, walk: move * (1 - run), run: move * run };
        const cycle = (W.speed * W.dur * (1 - run) + (R ? R.speed * R.dur * run : 0)) * scale; // yards per stride
        gait = (gait + (dt * u) / Math.max(0.05, cycle)) % 1;
        W.a.time = ((gait + W.phase0) % 1) * W.dur;
        if (R) R.a.time = ((gait + R.phase0) % 1) * R.dur;
      } else if (MODE_CLIP[s.mode] && act[MODE_CLIP[s.mode]]) want = { [MODE_CLIP[s.mode]]: 1 };
      // Clips blend among themselves; with none, the joints' pose takes over
      // (the clips underneath carry on as they were).
      if (want) {
        for (const n in act) act[n].w += ((want[n] || 0) - act[n].w) * k;
        wProc += (0 - wProc) * k;
      } else wProc += (1 - wProc) * k;
      for (const n in act) {
        const A = act[n];
        if (n !== 'walk' && n !== 'run') A.a.time = (A.a.time + dt) % A.dur;
        A.a.setEffectiveWeight(A.w);
      }
      mixer.update(0);
      if (wProc > 0.002) {
        copyPose(Math.min(1, wProc));
        if (clubOn) holdClub(Math.min(1, wProc));
      }
    }
    return {
      drive, setScale: (m) => { scale = m; model.scale.setScalar(m); }, model, bones,
      clips: Object.keys(act),
      // How much each clip shows now, and the joints' pose (for tests).
      weights: () => Object.assign({ pose: wProc }, ...Object.entries(act).map(([n, A]) => ({ [n]: A.w * (1 - wProc) }))),
      speed: (n) => (act[n] ? act[n].speed * scale : 0),
    };
  }

  function create(style) {
    const S = skinnedBody(bodyOf(style));
    const B = S ? Object.assign({}, BODIES[bodyOf(style)], { dims: S.dims, height: S.height }) : BODIES[bodyOf(style)];
    const D = B.dims;
    const J = skeleton(D);
    const mats = materialsFor(style);
    const rig = S ? null : Assets.rigParts(bodyOf(style));
    // A skinned body: the joints carry no meshes, they pose the model.
    const skin = S ? skinDriver(S, J, mats) : null;
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
    } else if (!skin) B.parts(J, mats);
    const root = J.root, body = J.body, hips = J.hips, spine = J.spine, head = J.head;
    const armsPivot = J.shoulders, swing = J.swing, club = J.club;
    const clubRest = club.position.clone(); // a skinned body may draw the club in
    const scale = style.height / BASE_HEIGHT;   // overall size, for cameras and the like
    const mscale = style.height / B.height;     // the model's own scale
    body.scale.setScalar(mscale);
    if (skin) skin.setScale(mscale);
    // Poses are written for the default legs; these adapt them to this body.
    const legK = (D.thigh + D.shin) / (DEFAULT_DIMS.thigh + DEFAULT_DIMS.shin);
    const hy = (v) => D.hip - (DEFAULT_DIMS.hip - v) * legK;
    const stride = mscale * legK;
    const legs = ['L', 'R'].map((s, i) => ({ thigh: J['thigh.' + s], knee: J['knee.' + s], ankle: J['ankle.' + s], side: i === 0 ? 1 : -1 }));
    const arms = ['L', 'R'].map((s) => ({ arm: J['arm.' + s], elbow: J['elbow.' + s] }));

    // Club in the hands: a registered asset, with a marker at its head.
    let clubKind = null, clubHead = new THREE.Object3D(), clubFace = new THREE.Object3D(), clubModel = null, face = 0;
    function setClub(kind) {
      if (kind === clubKind) return;
      clubKind = kind;
      while (club.children.length) club.remove(club.children[0]);
      const model = Assets.object(CLUB_ASSET[kind]);
      clubModel = model;
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      // Measure before attaching, so the boxes are in the club's own frame.
      // The head is whatever sits at the very bottom; the face looks along +X.
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const head = new THREE.Box3(), mb = new THREE.Box3();
      model.traverse((o) => {
        if (!o.isMesh) return;
        mb.setFromObject(o);
        if (mb.min.y < box.min.y + 0.02) head.union(mb);
      });
      if (head.isEmpty()) head.copy(box);
      club.add(model);
      const cx = (head.min.x + head.max.x) / 2, cz = (head.min.z + head.max.z) / 2;
      clubHead = new THREE.Object3D();
      clubHead.position.set(cx, box.min.y + 0.02, cz);
      club.add(clubHead);
      // The middle of the face, turning with the club.
      clubFace = new THREE.Object3D();
      clubFace.position.set(head.max.x, box.min.y + 0.02, cz);
      model.add(clubFace);
      model.rotation.y = face;
    }
    setClub('iron8');
    // Turn the club in the hands, about the shaft: opens (+) or closes (-) the face.
    function setFace(a) {
      face = -a;
      if (clubModel) clubModel.rotation.y = face;
    }
    // Where the face is and which way it points, flat on the ground (world).
    const _fx = new THREE.Vector3();
    function faceInfo() {
      if (!clubModel) return null;
      clubModel.updateMatrixWorld(true);
      const p = clubFace.getWorldPosition(new THREE.Vector3());
      _fx.setFromMatrixColumn(clubModel.matrixWorld, 0);
      const l = Math.hypot(_fx.x, _fx.z) || 1;
      return { x: p.x, z: p.z, dx: _fx.x / l, dz: _fx.z / l };
    }

    // ---- pose state ----
    const P = {
      hipsY: hy(0.98), lean: 0, bend: 0, twist: 0, headY: 0, headX: 0, plane: 0, swingZ: 0, cock: 0,
      armX0: 0, armX1: 0, armZ0: 0.06, armZ1: -0.06, elbow0: 0.15, elbow1: 0.15,
      thigh0: 0, thigh1: 0, knee0: 0, knee1: 0, splay: 0, clubOn: 0,
    };
    const T = Object.assign({}, P);
    let phase = 0, t = Math.random() * 10;
    const planeCache = {};

    function targetPose(s) {
      Object.assign(T, {
        hipsY: hy(0.98), lean: 0, bend: 0.03, twist: 0, headY: 0, headX: 0, plane: 0, swingZ: 0, cock: 0,
        armX0: 0.05, armX1: 0.05, armZ0: 0.07, armZ1: -0.07, elbow0: 0.18, elbow1: 0.18,
        thigh0: 0, thigh1: 0, knee0: 0.04, knee1: 0.04, splay: 0.02, clubOn: 0,
      });
      if (s.mode === 'walk') {
        const v = (s.speed || 0) / stride;
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
        T.hipsY = hy(0.98 + (Math.abs(sp) - 0.6) * 0.035 * a - 0.03 * r);
        T.headX = -T.lean * 0.6;
        if (s.carry) { T.armX1 = -0.25; T.armZ1 = -0.05; T.elbow1 = 1.4; } // right hand on the bag strap
      } else if (s.mode === 'address' || s.mode === 'swing') {
        const putt = s.putt;
        T.bend = putt ? 0.62 : 0.42;
        T.hipsY = hy(putt ? 0.95 : 0.93);
        T.thigh0 = T.thigh1 = putt ? -0.12 : -0.22;
        T.knee0 = T.knee1 = putt ? 0.22 : 0.38;
        T.splay = putt ? 0.06 : 0.1;
        T.plane = planeFor(s.club, putt);
        T.armX0 = T.armX1 = 0;
        T.armZ0 = -D.armIn; T.armZ1 = D.armIn;
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
        T.hipsY = hy(0.98);
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
      // How this body stands about: a hunch, a puffed-out chest, bent knees.
      const PO = B.posture;
      if (PO && s.mode !== 'address' && s.mode !== 'swing' && s.mode !== 'seated') {
        const f = s.mode === 'walk' ? 0.75 : 1;
        const bend = (PO.bend || 0) * f, k = (PO.knee || 0) * f;
        T.bend += bend;
        T.lean += (PO.lean || 0) * f;
        T.headX -= bend * 0.9 + (PO.chin || 0);  // keep looking ahead
        T.splay += (PO.splay || 0) * (s.mode === 'walk' ? 0.35 : 1);
        if (k) {
          T.knee0 += k; T.knee1 += k;
          T.thigh0 -= k * 0.55; T.thigh1 -= k * 0.55;
          T.hipsY -= D.thigh * (1 - Math.cos(k * 0.55)) + D.shin * (1 - Math.cos(k * 0.45));
        }
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
      club.position.copy(clubRest);
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
          hipsY: hy(putt ? 0.95 : 0.93), lean: 0, bend: putt ? 0.62 : 0.42, twist: 0, headY: 0, headX: 0, plane: pl, swingZ: 0, cock: 0,
          armX0: 0, armX1: 0, armZ0: -D.armIn, armZ1: D.armIn, elbow0: putt ? 0.12 : 0.02, elbow1: putt ? 0.12 : 0.02,
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
      const fp = clubFace.getWorldPosition(new THREE.Vector3());
      // ahead: how far the face stands in front of the head's centre (yards).
      const out = { x: _v.x, y: _v.y, z: _v.z, ahead: Math.hypot(fp.x - _v.x, fp.z - _v.z) };
      Object.assign(P, save);
      root.position.copy(pos); root.rotation.y = rot;
      setClub(saveKind);
      apply();
      return (addrCache[key] = out);
    }

    // s: { mode: 'idle'|'walk'|'address'|'swing'|'seated'|'wave', speed, swing, putt, club, snap, carry }
    function update(dt, s) {
      t += dt;
      if (s.mode === 'walk') phase += ((s.speed || 0) / stride) * dt * 2.4;
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
      if (skin) skin.drive(dt, s, P.clubOn > 0.5);
    }

    function setVisible(v) { root.visible = v; }
    // Hide everything but the club (looking down through his own eyes).
    let bodyShown = true;
    function setBodyVisible(v) {
      if (v === bodyShown) return;
      bodyShown = v;
      root.traverse((o) => {
        if (!o.isMesh) return;
        let q = o;
        while (q && q !== club) q = q.parent;
        if (!q) o.visible = v;
      });
    }
    apply();

    // Sizes for sitting in the cart: hips above the seat, eyes above the hips.
    const seatScale = mscale * (D.hip - 0.09) / (DEFAULT_DIMS.hip - 0.09);
    const eyeScale = mscale * (D.spine + D.neck + D.head + 0.2) / (DEFAULT_DIMS.spine + DEFAULT_DIMS.neck + DEFAULT_DIMS.head + 0.2);
    return { root, update, setClub, setFace, faceInfo, addressOffset, setVisible, setBodyVisible, scale, seatScale, eyeScale, style, joints: J, skin };
  }

  // Map a club from the bag to its model.
  const kindFor = (club) => club.kind;

  // The caddy, with a flag on a pole strapped to his back: the wind goes where he goes.
  // colors: the golfer's colours for the flag (field and emblem).
  function createCaddy(colors) {
    const c = create(CADDY);
    const f = WindCues.makeFlag({ height: 2.5, w: 0.9, h: 0.58, color: WindCues.PALETTE[0], emblem: 'disc', pole: 0x5a4330 });
    f.position.set(0.12, -0.2, -0.3); // in the spine joint's frame (unscaled body)
    f.rotation.x = -0.1;
    c.joints.spine.add(f);
    c.setFlagColors = (cs) => WindCues.dye(f, hexColor(cs.primary), hexColor(cs.secondary));
    if (colors) c.setFlagColors(colors);
    return c;
  }

  return { create, createCaddy, kindFor, styleFor };
})();
