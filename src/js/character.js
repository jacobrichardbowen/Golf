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
      note: `Real size for a ${B.size} figure; ${who} scaled from it. Keep the joint empties and their names, and edit the meshes under them. Materials named skin, shirt, pants, hair, shoe and eye take each character’s colors.`,
      build: () => {
        const J = skeleton(B.dims);
        B.parts(J, materialsFor(styleFor(id)));
        J.root.name = id;
        J.club.removeFromParent();
        return J.root;
      },
    });
  }

  function create(style) {
    const B = BODIES[bodyOf(style)];
    const D = B.dims;
    const J = skeleton(D);
    const mats = materialsFor(style);
    const rig = Assets.rigParts(bodyOf(style));
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
    } else B.parts(J, mats);
    const root = J.root, body = J.body, hips = J.hips, spine = J.spine, head = J.head;
    const armsPivot = J.shoulders, swing = J.swing, club = J.club;
    const scale = style.height / BASE_HEIGHT;   // overall size, for cameras and the like
    const mscale = style.height / B.height;     // the model's own scale
    body.scale.setScalar(mscale);
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
    return { root, update, setClub, setFace, faceInfo, addressOffset, setVisible, setBodyVisible, scale, seatScale, eyeScale, style, joints: J };
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
