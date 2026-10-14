// ---------------------------------------------------------------------------
// The other golfers in an online round: their golfer, caddy, cart, bag and
// ball, each glided towards where its player last said it was, plus a name
// tag over their head. Only what they send is shown; nothing is simulated.
// ---------------------------------------------------------------------------

const Remote = (() => {
  const POSES = ['walk', 'address', 'swing', 'seated'];
  const NEAR_CAMERA = 2.6; // yards: closer than this to the camera, people step out of the picture

  function create(slot, info, course, hud) {
    const style = CHARACTERS[info.char] || CHARACTERS[0];
    const cs = style.colors;
    const golfer = Golfer.create(style);
    const caddy = Golfer.createCaddy(cs);
    const cart = Cart.create(course);
    cart.setColors(cs);
    const bag = Equipment.createBag();
    const ball = World.createBall(cs.ball);
    for (const o of [golfer.root, caddy.root, cart.root, bag.root]) { o.visible = false; World.add(o); }

    const tag = document.createElement('div');
    tag.className = 'marker mp-tag';
    tag.id = 'mpTag' + slot;
    tag.style.setProperty('--c', cs.ui);
    tag.innerHTML = '<i></i><span></span>';
    hud.appendChild(tag);

    const R = {
      slot, name: info.name, char: info.char, color: cs.ui, style,
      hole: 0, strokes: 0, ballState: 'tee', have: false, msg: null,
      g: [0, 0, 0, 0], c: [0, 0, 0, 0], k: [0, 0, 0, 0, 0, 0, 0], b: [0, 0, 0],
      sw: 0, out: -1, bagP: new THREE.Vector3(), bagQ: new THREE.Quaternion(), lastTrail: null,
    };
    const _q = new THREE.Quaternion(), _t = new THREE.Vector3(), _tag = new THREE.Vector3();

    function snapAll(m) {
      R.g = m.g.slice(); R.c = m.c.slice(); R.k = m.k.slice(); R.b = m.b.slice();
      R.sw = m.sw || 0;
      if (m.bg) { R.bagP.fromArray(m.bg, 0); R.bagQ.fromArray(m.bg, 3); }
    }

    // A snapshot from this player.
    function apply(m) {
      const prev = R.msg;
      R.msg = m;
      R.hole = m.h | 0;
      R.strokes = m.n | 0;
      R.ballState = m.bs;
      if (m.nm) R.name = Net.cleanName(m.nm) || R.name;
      if (!R.have) {
        R.have = true;
        snapAll(m);
        for (const o of [golfer.root, caddy.root, cart.root, bag.root]) o.visible = true;
        return;
      }
      // Their shots and putts, heard from wherever you are.
      if (prev && prev.bs !== 'moving' && m.bs === 'moving') {
        R.lastTrail = null;
        ball.trailReset();
        const g = loudness(m.b);
        if (g > 0.05) Sound.hit(m.pw || 0.7, !!m.pu, g);
      }
      if (prev && !prev.bm && m.bm) {
        const g = loudness(m.b);
        if (g > 0.05) Sound.cup(g);
      }
    }

    function loudness(p) {
      const cp = World.camera.position;
      const d = Math.hypot(p[0] - cp.x, p[2] - cp.z);
      return clamp(1 - d / 140, 0, 1) ** 2;
    }

    // Glide a vector towards the target: positions first, then an angle at index ai.
    function glide(cur, tgt, k, snapDist, ai) {
      if (Math.hypot(tgt[0] - cur[0], tgt[2] - cur[2]) > snapDist) { for (let i = 0; i < tgt.length; i++) cur[i] = tgt[i]; return; }
      for (let i = 0; i < tgt.length; i++) {
        if (i === ai) cur[i] += wrapAngle(tgt[i] - cur[i]) * k;
        else cur[i] += (tgt[i] - cur[i]) * k;
      }
    }

    // Is this standing in the middle of the picture, close to the camera?
    function inTheWay(o, camera) {
      _t.copy(o.position);
      _t.y += 0.9;
      if (_t.distanceTo(camera.position) > 14) return false;
      _t.project(camera);
      return _t.z < 1 && Math.abs(_t.x) < 0.5 && _t.y < 0.7;
    }

    // w, h: size of the view, for placing the name tag. clear: you're lining
    // up a shot, so anyone in front of you steps out of the picture.
    function update(dt, camera, showTag, w, h, clear) {
      const m = R.msg;
      if (!m) return;
      const k = 1 - Math.exp(-dt * 12);
      glide(R.g, m.g, k, 6, 3);
      glide(R.c, m.c, k, 6, 3);
      glide(R.k, m.k, k, 8, 3);
      glide(R.b, m.b, 1 - Math.exp(-dt * 16), 30, -1);
      R.sw += ((m.sw || 0) - R.sw) * (1 - Math.exp(-dt * 25));

      // The cart.
      const st = cart.st;
      st.x = R.k[0]; st.y = R.k[1]; st.z = R.k[2]; st.yaw = R.k[3];
      st.steer = R.k[4]; st.pitch = R.k[5]; st.roll = R.k[6];
      st.speed = m.ks || 0;
      st.spin += st.speed * dt / 0.21;
      cart.sync();

      // The golfer.
      const club = CLUBS[m.cl] || CLUBS[0];
      const mode = POSES[m.ps] || 'walk';
      if (m.m === 'c') {
        const s = cart.seatPose(golfer.seatScale);
        golfer.root.position.set(s.x, s.y, s.z);
        golfer.root.rotation.set(0, Math.PI - s.yaw, 0);
        golfer.update(dt, { mode: 'seated' });
      } else {
        golfer.root.position.set(R.g[0], R.g[1], R.g[2]);
        golfer.root.rotation.set(0, Math.PI - R.g[3], 0);
        golfer.setFace(m.m === 's' ? m.fa || 0 : 0);
        golfer.update(dt, { mode, speed: m.sp || 0, putt: !!m.pu, club: club.kind, swing: R.sw });
      }

      // The caddy (riding along, driving the cart over, or on foot).
      if (m.cr || m.cd) {
        const s = cart.seatPose(caddy.seatScale, !!m.cr);
        caddy.root.position.set(s.x, s.y, s.z);
        caddy.root.rotation.set(0, Math.PI - s.yaw, 0);
        caddy.update(dt, { mode: 'seated', passenger: !!m.cr });
      } else {
        caddy.root.position.set(R.c[0], R.c[1], R.c[2]);
        caddy.root.rotation.set(0, Math.PI - R.c[3], 0);
        caddy.update(dt, { mode: 'walk', speed: m.c[4] || 0, carry: !!m.cc });
      }

      // The bag: on the cart's rack, or wherever they say it is.
      if (!m.bg) {
        if (bag.root.parent !== cart.bagMount) cart.bagMount.add(bag.root);
        bag.root.position.set(0, 0, 0);
        bag.root.rotation.set(0, 0, 0);
      } else {
        if (bag.root.parent !== World.scene) World.add(bag.root);
        _t.fromArray(m.bg, 0);
        _q.fromArray(m.bg, 3);
        if (R.bagP.distanceTo(_t) > 4) { R.bagP.copy(_t); R.bagQ.copy(_q); }
        R.bagP.lerp(_t, k);
        R.bagQ.slerp(_q, k);
        bag.root.position.copy(R.bagP);
        bag.root.quaternion.copy(R.bagQ);
      }
      if (m.bo !== R.out) { R.out = m.bo; bag.setOut(m.bo); }
      bag.update(dt);

      // The ball, and the trail behind it while it flies.
      const bp = { x: R.b[0], y: R.b[1], z: R.b[2] };
      ball.set(bp, m.bs === 'gone' ? 'hidden' : m.bm ? 'holed' : 'ok', m.bs === 'tee');
      if (m.bs === 'moving') {
        const l = R.lastTrail;
        if (!l || Math.hypot(bp.x - l.x, bp.y - l.y, bp.z - l.z) > 0.6) { ball.trailPush(bp); R.lastTrail = bp; }
      } else ball.trailFade(dt);

      // Step out of the way of the camera when it's right on top of them.
      const cp = camera.position;
      const near = (o, r) => o.position.distanceTo(cp) < r;
      golfer.root.visible = !(m.m !== 'c' && (near(golfer.root, NEAR_CAMERA) || (clear && inTheWay(golfer.root, camera))));
      caddy.root.visible = m.cv !== 0 && !(!m.cr && !m.cd && (near(caddy.root, NEAR_CAMERA) || (clear && inTheWay(caddy.root, camera))));
      bag.root.visible = !(m.bg && (near(bag.root, NEAR_CAMERA) || (clear && inTheWay(bag.root, camera))));
      cart.root.visible = !near(cart.root, 1.9);

      // Name tag over their head.
      const seated = m.m === 'c';
      const p = _tag.copy(golfer.root.position);
      p.y += m.m === 's' ? style.height * 0.85 : style.height * (seated ? 0.8 : 1) + 0.15; // just over the head (lower when bent over the ball)
      const dist = p.distanceTo(cp);
      p.project(camera);
      const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
      const on = showTag && golfer.root.visible && p.z < 1 && x > 10 && x < w - 10 && y > 10 && y < h - 10 && dist < 260 && dist > 1.5;
      UI.marker(tag.id, x, y, false, on, R.name, w, h);
    }

    function dispose() {
      WindCues.forget(caddy.root);
      for (const o of [golfer.root, caddy.root, cart.root, bag.root]) o.removeFromParent();
      ball.dispose();
      tag.remove();
    }

    return Object.assign(R, { apply, update, dispose, cart, golfer, caddy });
  }

  return { create };
})();
