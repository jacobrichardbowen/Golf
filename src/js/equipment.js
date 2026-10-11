// ---------------------------------------------------------------------------
// Clubs and the golf bag. Each club model is registered as an asset:
//   grip end at the origin, shaft running down -Y, head at the bottom with
//   the face towards +Z.
// The bag's opening is at the top (+Y) with its pocket facing +Z; the clubs
// stand in it head-up.
// ---------------------------------------------------------------------------

const CLUB_MODELS = {
  driver: { len: 1.12 },
  iron4: { len: 1.0 },
  iron8: { len: 0.96 },
  wedge: { len: 0.93 },
  putter: { len: 0.88 },
};

function clubModel(kind) {
  const k = CLUB_MODELS[kind];
  const g = new THREE.Group();
  g.name = 'club-' + kind;
  const grip = new THREE.MeshLambertMaterial({ color: 0x1b1b1b }); grip.name = 'grip';
  const steel = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.85, roughness: 0.28 }); steel.name = 'steel';
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272b, metalness: 0.6, roughness: 0.35 }); dark.name = 'head';
  const add = (name, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add('grip', new THREE.CylinderGeometry(0.017, 0.015, 0.26, 8), grip, 0, -0.11, 0);
  add('shaft', new THREE.CylinderGeometry(0.009, 0.007, k.len, 6), steel, 0, -k.len / 2, 0);
  const y = -k.len - 0.012;
  if (kind === 'driver') {
    const h = add('head', new THREE.SphereGeometry(0.075, 14, 8), dark, 0, y, 0.04);
    h.scale.set(1.25, 0.62, 1.05);
    const crown = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.2, roughness: 0.4 }); crown.name = 'crown';
    const c = add('crown', new THREE.SphereGeometry(0.03, 8, 6), crown, 0, y + 0.03, 0.03);
    c.scale.set(1.2, 0.35, 1);
  } else if (kind === 'putter') {
    add('head', new THREE.BoxGeometry(0.034, 0.032, 0.12), dark, 0, y + 0.004, 0.035);
    add('sight', new THREE.BoxGeometry(0.004, 0.034, 0.03), steel, 0.016, y + 0.006, 0.035);
  } else {
    // Blade heads get more loft and depth down the bag.
    const loft = kind === 'iron4' ? 0.28 : kind === 'iron8' ? 0.55 : 0.85;
    const hgt = kind === 'iron4' ? 0.052 : kind === 'iron8' ? 0.06 : 0.07;
    const h = add('head', new THREE.BoxGeometry(0.02, hgt, 0.09), steel, 0, y + 0.004, 0.038);
    h.rotation.z = -loft * 0.35;
    const numMat = new THREE.MeshLambertMaterial({ color: kind === 'wedge' ? 0xc8302c : 0x1d5537 }); numMat.name = 'badge';
    add('badge', new THREE.BoxGeometry(0.004, hgt * 0.45, 0.04), numMat, -0.012, y + 0.004, 0.04);
  }
  return g;
}

const CLUB_ASSET = { driver: 'club-driver', iron4: 'club-4-iron', iron8: 'club-8-iron', wedge: 'club-wedge', putter: 'club-putter' };
const CLUB_LABEL = { driver: 'Driver', iron4: '4 Iron', iron8: '8 Iron', wedge: 'Chipping wedge', putter: 'Putter' };
for (const kind of Object.keys(CLUB_MODELS)) {
  Assets.define(CLUB_ASSET[kind], {
    kind: 'model', group: 'Clubs', name: CLUB_LABEL[kind], build: () => clubModel(kind),
    note: 'Real size (about ' + Math.round((CLUB_MODELS[kind].len + 0.13) * 91.44) + ' cm). Grip end at the origin, shaft down −Y, face towards +Z.',
  });
}

function bagModel() {
  const g = new THREE.Group();
  g.name = 'golf-bag';
  const body = new THREE.MeshLambertMaterial({ color: 0x8e2f2a }); body.name = 'bag';
  const trim = new THREE.MeshLambertMaterial({ color: 0x1b1d1c }); trim.name = 'trim';
  const pocket = new THREE.MeshLambertMaterial({ color: 0xa8423b }); pocket.name = 'pocket';
  const add = (name, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add('body', new THREE.CylinderGeometry(0.15, 0.13, 0.86, 16, 1, true), body, 0, 0.47, 0).material.side = THREE.DoubleSide;
  add('base', new THREE.CylinderGeometry(0.14, 0.14, 0.06, 16), trim, 0, 0.03, 0);
  add('rim', new THREE.TorusGeometry(0.15, 0.022, 8, 24).rotateX(Math.PI / 2), trim, 0, 0.9, 0);
  add('band', new THREE.CylinderGeometry(0.152, 0.152, 0.04, 16, 1, true), trim, 0, 0.62, 0);
  // Dividers inside the opening
  add('divider', new THREE.BoxGeometry(0.28, 0.06, 0.012), trim, 0, 0.87, 0);
  add('divider', new THREE.BoxGeometry(0.012, 0.06, 0.28), trim, 0, 0.87, 0);
  const pk = add('pocket', new THREE.BoxGeometry(0.17, 0.42, 0.06), pocket, 0, 0.4, 0.15);
  pk.rotation.x = -0.04;
  add('zip', new THREE.BoxGeometry(0.15, 0.012, 0.064), trim, 0, 0.52, 0.152);
  // Shoulder strap
  const strap = add('strap', new THREE.TorusGeometry(0.2, 0.012, 6, 16, Math.PI), trim, -0.17, 0.55, 0);
  strap.rotation.set(0, Math.PI / 2, Math.PI / 2);
  return g;
}
Assets.define('golf-bag', { kind: 'model', group: 'Clubs', name: 'Golf bag', build: bagModel,
  note: 'Real size (the default is about 87 cm tall). Base at the origin, opening at the top (+Y), pocket facing +Z. The clubs are separate assets.' });

// Club slots in the bag's opening, by club index (x, z offsets in yards),
// and how far each club stands above the rim (the driver tallest).
const BAG_SLOTS = [[-0.07, -0.055], [0.07, -0.055], [-0.075, 0.06], [0.075, 0.06], [0, 0.0]];
const BAG_RISE = [0.44, 0.36, 0.32, 0.28, 0.3];
const BAG_TOP = 0.9;

const Equipment = (() => {
  const PICK_MAT = new THREE.MeshBasicMaterial({ visible: false });

  // A bag with every club standing in it, head up.
  function createBag() {
    const root = new THREE.Group();
    root.name = 'bag';
    const bag = Assets.object('golf-bag');
    root.add(bag);
    const clubs = CLUBS.map((c, i) => {
      const holder = new THREE.Group();
      const model = Assets.object(CLUB_ASSET[c.kind]);
      model.rotation.x = Math.PI; // head up
      // Stand the club so its head sits well above the rim.
      const box = new THREE.Box3().setFromObject(model);
      const len = box.max.y - box.min.y;
      const top = BAG_TOP + BAG_RISE[i];
      model.position.y = -box.min.y + (top - len);
      holder.add(model);
      // Each club rests on the bottom of the bag and leans against the rim
      // at its slot, so the heads fan out a little.
      const [sx, sz] = BAG_SLOTS[i];
      holder.rotation.set(Math.atan2(sz, BAG_TOP), Math.atan2(sx, sz || 0.01), -Math.atan2(sx, BAG_TOP), 'XZY');
      holder.userData.clubIndex = i;
      model.traverse((o) => { if (o.isMesh) { o.userData.clubIndex = i; o.castShadow = true; } });
      // Shafts are thin: an invisible, fatter stand-in around the part above
      // the rim makes each club easy to point at.
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top - BAG_TOP + 0.12, 8), PICK_MAT);
      pick.position.y = (top + BAG_TOP - 0.12) / 2;
      pick.userData.clubIndex = i;
      pick.userData.pick = true;
      holder.add(pick);
      root.add(holder);
      return { holder, model, pick, top, lift: 0, target: 0 };
    });
    const highlight = new THREE.Color(0xf2c230);
    let hovered = -1;

    function setHover(i) {
      if (i === hovered) return;
      hovered = i;
      clubs.forEach((c, k) => {
        c.target = k === i ? 0.07 : 0;
        c.model.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m.emissive) continue;
            if (!o.userData.baseEmissive) o.userData.baseEmissive = m.emissive.clone();
            m.emissive.copy(k === i ? highlight : o.userData.baseEmissive).multiplyScalar(k === i ? 0.35 : 1);
          }
        });
      });
    }
    function setOut(i) { clubs.forEach((c, k) => { c.holder.visible = k !== i; }); }
    function pull(i) { if (clubs[i]) clubs[i].target = 0.45; }
    function update(dt) {
      for (const c of clubs) {
        c.lift += (c.target - c.lift) * (1 - Math.exp(-dt * 14));
        c.holder.position.y = c.lift;
      }
    }
    // Clubs need their own materials so highlighting one doesn't light the others.
    clubs.forEach((c) => c.model.traverse((o) => {
      if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    }));
    const pickables = [];
    clubs.forEach((c) => { c.model.traverse((o) => { if (o.isMesh) pickables.push(o); }); pickables.push(c.pick); });
    // World position of a club's head (for pointing at it).
    function headPoint(i, out) { const c = clubs[i]; return c.holder.localToWorld(out.set(0, c.top - 0.06, 0)); }
    return { root, clubs, setHover, setOut, pull, update, headPoint, pickables, get hovered() { return hovered; } };
  }

  return { createBag };
})();
