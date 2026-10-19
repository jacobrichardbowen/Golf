// ---------------------------------------------------------------------------
// Ball physics. Units: yards, seconds. Spin vectors are in rpm.
// Flight uses drag + Magnus lift; landing uses a bounce/skid/spin-check model;
// rolling uses slope gravity and per-surface rolling resistance.
//
// A "field" supplies: H(x,z), normal(x,z), surface(x,z), waterLevel(x,z),
// inBounds(x,z), pin {x,y,z} | null, nearTrees(x,z) -> array | null.
// Optionally floorInfo(x,z,y,tol) -> { h, kind } for ground the ball can pass
// under (bridge decks, kind 1) or inside (tunnels, kind 2), and
// tunnelClamp(p, v, r) to keep it inside a tunnel.
// ---------------------------------------------------------------------------

const G = 10.73;             // gravity, yd/s^2
const BALL_R = 0.0234;       // ball radius, yd (1.68in diameter)
const CUP_R = 0.059;         // cup radius, yd (4.25in diameter)
const DT = 1 / 240;
const AIR_K = 0.0171;        // rho*A/(2m) expressed per yard
const RPM2RAD = TAU / 60;
const MPH = 0.48889;         // yd/s per mph
const BRAKE = 8;             // yd/s of check from 10k rpm of backspin on a fully grippy surface
const WIND_PUSH = 1.8;       // how hard the wind gets hold of the ball (a game choice: reading it should matter)

function createBall(x, y, z) {
  return {
    p: { x, y, z }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 },
    mode: 'rest', t: 0, rollT: 0, bounces: 0, apex: y, startY: y,
    lastDry: { x, z }, treeCool: 0, lipCool: 0, carry: null, start: { x, y, z },
  };
}

function launchBall(ball, yaw, speed, launchDeg, spinRpm, tiltDeg) {
  const d = dirFromYaw(yaw);
  const la = launchDeg * DEG;
  ball.v = { x: d.x * Math.cos(la) * speed, y: Math.sin(la) * speed, z: d.z * Math.cos(la) * speed };
  const t = (tiltDeg || 0) * DEG;
  const rx = Math.cos(yaw), rz = Math.sin(yaw); // right vector
  ball.w = { x: rx * Math.cos(t) * spinRpm, y: Math.sin(t) * spinRpm, z: rz * Math.cos(t) * spinRpm };
  ball.mode = 'flight';
  ball.t = 0; ball.rollT = 0; ball.bounces = 0;
  ball.start = { x: ball.p.x, y: ball.p.y, z: ball.p.z };
  ball.apex = ball.p.y; ball.startY = ball.p.y; ball.carry = null;
  ball.lastDry = { x: ball.p.x, z: ball.p.z };
  ball.treeCool = 0; ball.lipCool = 0;
}

function startRoll(ball, yaw, speed) {
  const d = dirFromYaw(yaw);
  ball.v = { x: d.x * speed, y: 0, z: d.z * speed };
  ball.w = { x: 0, y: 0, z: 0 };
  ball.mode = 'roll';
  ball.t = 0; ball.rollT = 0; ball.bounces = 0;
  ball.start = { x: ball.p.x, y: ball.p.y, z: ball.p.z };
  ball.apex = ball.p.y; ball.carry = 0;
  ball.lastDry = { x: ball.p.x, z: ball.p.z };
  ball.lipCool = 0;
}

// Advance the ball one fixed step. Notable things are pushed into `events`.
function stepBall(ball, field, wind, dt, events, opts) {
  ball.t += dt;
  if (ball.treeCool > 0) ball.treeCool -= dt;
  if (ball.lipCool > 0) ball.lipCool -= dt;
  if (ball.mode === 'flight') stepFlight(ball, field, wind, dt, events, opts);
  else if (ball.mode === 'roll') stepRoll(ball, field, dt, events, opts);
  if (ball.t > 45 && (ball.mode === 'flight' || ball.mode === 'roll')) {
    ball.mode = 'rest';
    events && events.push({ type: 'rest' });
  }
}

const UP = { x: 0, y: 1, z: 0 };
// The ground under the ball: height, slope and what it's made of.
function groundUnder(field, x, z, y, tol) {
  if (field.floorInfo) {
    const f = field.floorInfo(x, z, y, tol);
    if (f.kind === 1) return { h: f.h, n: UP, surf: S_PATH, kind: 1 };
    if (f.kind === 2) return { h: f.h, n: UP, surf: S_ROCK, kind: 2 };
    return { h: f.h, n: null, surf: -1, kind: 0 };
  }
  return { h: field.H(x, z), n: null, surf: -1, kind: 0 };
}

function stepFlight(ball, field, wind, dt, events, opts) {
  const p = ball.p, v = ball.v, w = ball.w;
  const gh = field.H(p.x, p.z);
  // Wind is weaker close to the ground.
  const wf = wind ? (0.45 + 0.55 * clamp((p.y - gh) / 20, 0, 1)) * WIND_PUSH * TUNE.wind : 0;
  const rx = v.x - (wind ? wind.x * wf : 0), ry = v.y, rz = v.z - (wind ? wind.z * wf : 0);
  const sp = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6;
  const wm = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
  const S = (BALL_R * wm * RPM2RAD) / sp;
  const Cd = 0.21 + 0.12 * Math.min(S, 0.5);
  const CL = wm > 1 ? 0.40 * (1 - Math.exp(-S / 0.14)) : 0;
  let ax = -AIR_K * Cd * sp * rx, ay = -G - AIR_K * Cd * sp * ry, az = -AIR_K * Cd * sp * rz;
  if (CL > 0) {
    // Magnus: direction of (spin x relative velocity)
    let lx = w.y * rz - w.z * ry, ly = w.z * rx - w.x * rz, lz = w.x * ry - w.y * rx;
    const lm = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    const L = (AIR_K * CL * sp * sp) / lm;
    ax += lx * L; ay += ly * L; az += lz * L;
  }
  v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  const decay = Math.exp(-dt / 24);
  w.x *= decay; w.y *= decay; w.z *= decay;
  if (p.y > ball.apex) ball.apex = p.y;

  if (!field.inBounds(p.x, p.z)) {
    ball.mode = 'oob';
    events && events.push({ type: 'oob' });
    return;
  }

  // Remember the last point flown over dry land (for hazard drops).
  if (((ball.t * 240) | 0) % 6 === 0 && field.waterLevel(p.x, p.z) === -Infinity) {
    ball.lastDry.x = p.x; ball.lastDry.z = p.z;
  }

  // Trees.
  if (!(opts && opts.noTrees) && ball.treeCool <= 0) {
    const trees = field.nearTrees(p.x, p.z);
    if (trees) for (const t of trees) {
      if (p.y > t.top) continue;
      const dx = p.x - t.x, dz = p.z - t.z;
      const hd2 = dx * dx + dz * dz;
      if (p.y < t.y0 + t.trunkH && hd2 < (t.trunkR + BALL_R) * (t.trunkR + BALL_R)) {
        // Trunk: reflect off the bark.
        const hd = Math.sqrt(hd2) || 1;
        const nx = dx / hd, nz = dz / hd;
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
          v.x -= 1.6 * vn * nx; v.z -= 1.6 * vn * nz;
          v.x *= 0.6; v.y *= 0.6; v.z *= 0.6;
        }
        ball.treeCool = 0.12;
        events && events.push({ type: 'tree', hard: true });
        break;
      }
      const dy = p.y - t.cy;
      if (hd2 / (t.cr * t.cr) + (dy * dy) / (t.ch * t.ch) < 1) {
        // Leaves and branches: knock it down and scatter it.
        const keep = 0.18 + Math.random() * 0.22;
        const s = Math.hypot(v.x, v.y, v.z) * keep;
        const a = Math.random() * TAU;
        v.x = v.x * keep + Math.cos(a) * s * 0.6;
        v.z = v.z * keep + Math.sin(a) * s * 0.6;
        v.y = Math.min(v.y * keep, 1) - Math.random() * 2;
        w.x *= 0.2; w.y *= 0.2; w.z *= 0.2;
        ball.treeCool = 0.35;
        events && events.push({ type: 'tree', hard: false });
        break;
      }
    }
  }

  // Tunnel walls and roof.
  if (field.tunnelClamp && field.tunnelClamp(p, v, BALL_R) && ball.treeCool <= 0) {
    ball.treeCool = 0.1;
    events && events.push({ type: 'tree', hard: true });
  }

  // Water surface.
  const wl = field.waterLevel(p.x, p.z);
  if (p.y - BALL_R <= wl) {
    ball.mode = 'water';
    events && events.push({ type: 'water' });
    return;
  }

  const gr = groundUnder(field, p.x, p.z, p.y - BALL_R, 0.3);
  const h = gr.h;
  if (p.y - BALL_R > h) return;

  // --- Landing ---
  p.y = h + BALL_R;
  if (ball.carry === null) {
    ball.carry = Math.hypot(p.x - ball.start.x, p.z - ball.start.z);
  }
  const surf = gr.kind ? gr.surf : field.surface(p.x, p.z);
  if (surf === S_WATER) {
    ball.mode = 'water';
    events && events.push({ type: 'water' });
    return;
  }
  const P = SURFACES[surf];
  const n = gr.n || field.normal(p.x, p.z);
  const vn = v.x * n.x + v.y * n.y + v.z * n.z;
  if (vn >= 0) return;
  const vnA = -vn;

  // Straight into the cup?
  const pin = field.pin;
  if (pin && Math.hypot(p.x - pin.x, p.z - pin.z) < CUP_R + 0.012 && vnA < 14) {
    ball.mode = 'holed';
    events && events.push({ type: 'holed', dunk: true });
    return;
  }

  let tx = v.x - vn * n.x, ty = v.y - vn * n.y, tz = v.z - vn * n.z;
  const ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
  let ux = 0, uy = 0, uz = 0;
  if (ts > 1e-6) { ux = tx / ts; uy = ty / ts; uz = tz / ts; }
  // Backspin component about the axis (motion x normal) = "right" of travel.
  const bx = uy * n.z - uz * n.y, by = uz * n.x - ux * n.z, bz = ux * n.y - uy * n.x;
  const back = w.x * bx + w.y * by + w.z * bz;
  const e = P.bounce * clamp(1 - vnA / 45, 0.35, 1);
  // Turf friction scales with how hard the ball hits (Coulomb), then backspin
  // bites on top of that; high-spin wedges can even zip back a little.
  let nt = Math.max(0, ts - P.mu * (1 + e) * vnA);
  nt -= clamp(back / 10000, 0, 1.2) * P.grip * BRAKE;
  const maxBack = -2.2 * P.grip * clamp((back - 7000) / 3000, 0, 1);
  if (nt < maxBack) nt = maxBack;
  const nn = vnA * e;
  v.x = ux * nt + n.x * nn; v.y = uy * nt + n.y * nn; v.z = uz * nt + n.z * nn;
  w.x *= 0.45; w.y *= 0.2; w.z *= 0.45;
  ball.bounces++;
  events && events.push({ type: 'bounce', speed: vnA, surf });
  if (nn < 1.3 || surf === S_SAND) {
    ball.mode = 'roll';
    ball.rollT = 0;
    // Drop the normal component; continue rolling along the ground.
    const vn2 = v.x * n.x + v.y * n.y + v.z * n.z;
    v.x -= vn2 * n.x; v.y -= vn2 * n.y; v.z -= vn2 * n.z;
  }
}

function stepRoll(ball, field, dt, events) {
  const p = ball.p, v = ball.v;
  ball.rollT += dt;
  const g0 = groundUnder(field, p.x, p.z, p.y - BALL_R, 0.3);
  const surf = g0.kind ? g0.surf : field.surface(p.x, p.z);
  if (!g0.kind && (surf === S_WATER || field.waterLevel(p.x, p.z) > p.y - BALL_R)) {
    ball.mode = 'water';
    events && events.push({ type: 'water' });
    return;
  }
  const P = SURFACES[surf];
  const n = g0.n || field.normal(p.x, p.z);
  // Gravity along the slope.
  const gx = G * n.y * n.x, gy = -G + G * n.y * n.y, gz = G * n.y * n.z;
  let sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const decel = P.roll * G * n.y + P.rollV * sp;
  if (sp > 0) {
    const ns = Math.max(0, sp - decel * dt);
    const k = ns / sp;
    v.x *= k; v.y *= k; v.z *= k;
  }
  const gmag = Math.sqrt(gx * gx + gy * gy + gz * gz);
  // Static friction holds the ball on gentle slopes once it has nearly stopped.
  const stuck = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) < 0.06 && gmag < P.roll * G * n.y * 1.25;
  if (!stuck) { v.x += gx * dt; v.y += gy * dt; v.z += gz * dt; }

  const ox = p.x, oz = p.z;
  p.x += v.x * dt; p.z += v.z * dt;
  if (!field.inBounds(p.x, p.z)) {
    ball.mode = 'oob';
    events && events.push({ type: 'oob' });
    return;
  }
  if (field.tunnelClamp) field.tunnelClamp(p, v, BALL_R);
  const oy = p.y;
  const g1 = groundUnder(field, p.x, p.z, oy - BALL_R, 0.3);
  // Rolled off the edge of a bridge, or over a cliff: it falls.
  const n2 = g1.n || field.normal(p.x, p.z);
  if (g1.h < oy - BALL_R - 0.25 || (n2.y < 0.55 && v.x * n2.x + v.z * n2.z > 0.2)) {
    ball.mode = 'flight';
    ball.carry = ball.carry === null ? 0 : ball.carry;
    return;
  }
  p.y = g1.h + BALL_R;
  if (field.waterLevel(p.x, p.z) === -Infinity) { ball.lastDry.x = p.x; ball.lastDry.z = p.z; }
  // Keep velocity tangent to the new ground.
  const vn = v.x * n2.x + v.y * n2.y + v.z * n2.z;
  v.x -= vn * n2.x; v.y -= vn * n2.y; v.z -= vn * n2.z;
  sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

  // Tree trunks block rolling balls too.
  const trees = field.nearTrees(p.x, p.z);
  if (trees) for (const t of trees) {
    const dx = p.x - t.x, dz = p.z - t.z;
    const hd = Math.hypot(dx, dz);
    if (hd < t.trunkR + BALL_R && hd > 0) {
      const nx = dx / hd, nz = dz / hd;
      const vr = v.x * nx + v.z * nz;
      if (vr < 0) { v.x -= 1.5 * vr * nx; v.z -= 1.5 * vr * nz; v.x *= 0.5; v.z *= 0.5; }
      p.x = t.x + nx * (t.trunkR + BALL_R); p.z = t.z + nz * (t.trunkR + BALL_R);
      events && events.push({ type: 'tree', hard: true });
    }
  }

  // The cup.
  const pin = field.pin;
  if (pin) {
    // Closest approach to the cup centre along this step.
    const sx = p.x - ox, sz = p.z - oz;
    const sl2 = sx * sx + sz * sz;
    let t = sl2 > 0 ? ((pin.x - ox) * sx + (pin.z - oz) * sz) / sl2 : 1;
    t = clamp(t, 0, 1);
    const cx = ox + sx * t, cz = oz + sz * t;
    const d = Math.hypot(cx - pin.x, cz - pin.z);
    if (d < CUP_R) {
      // Faster balls need to hit nearer the centre to drop.
      const capture = 1.75 * Math.sqrt(Math.max(0, 1 - (d / CUP_R) * (d / CUP_R))) + 0.35;
      if (sp < capture) {
        ball.mode = 'holed';
        p.x = cx; p.z = cz;
        events && events.push({ type: 'holed' });
        return;
      } else if (ball.lipCool <= 0) {
        // Lip out: deflect and lose pace.
        const side = Math.sign((pin.x - cx) * v.z - (pin.z - cz) * v.x) || 1;
        const a = side * (0.25 + 0.35 * (1 - d / CUP_R)) * (0.6 + Math.random() * 0.4);
        const c = Math.cos(a), s = Math.sin(a);
        const vx = v.x * c - v.z * s, vz = v.x * s + v.z * c;
        v.x = vx * 0.7; v.z = vz * 0.7;
        ball.lipCool = 0.3;
        events && events.push({ type: 'lip' });
      }
    } else if (d < CUP_R + BALL_R * 0.6 && sp < 0.35) {
      ball.mode = 'holed';
      events && events.push({ type: 'holed' });
      return;
    }
  }

  if (sp < 0.03 && gmag < P.roll * G * n2.y * 1.25) {
    v.x = v.y = v.z = 0;
    ball.mode = 'rest';
    events && events.push({ type: 'rest' });
  } else if (ball.rollT > 40) {
    ball.mode = 'rest';
    events && events.push({ type: 'rest' });
  }
}

// ---------------------------------------------------------------------------
// Calibration: find launch speeds that produce a given carry, so the swing
// meter maps power directly onto yardage.
// ---------------------------------------------------------------------------
const FLAT_UP = { x: 0, y: 1, z: 0 };
const FLAT_FIELD = {
  H: () => 0, normal: () => FLAT_UP, surface: () => S_FAIRWAY, waterLevel: () => -Infinity,
  inBounds: () => true, pin: null, nearTrees: () => null,
};
const GREEN_FIELD = Object.assign({}, FLAT_FIELD, { surface: () => S_GREEN });

function simulateFlat(speed, launchDeg, spinRpm, opts) {
  const b = createBall(0, BALL_R, 0);
  launchBall(b, 0, speed, launchDeg, spinRpm, 0);
  const field = opts && opts.green ? GREEN_FIELD : FLAT_FIELD;
  const total = !!(opts && opts.total);
  let steps = 0, flight = 0;
  while (steps++ < 240 * 40) {
    stepBall(b, field, null, DT, null, { noTrees: true });
    if (b.mode === 'flight') flight += DT;
    if (!total && b.carry !== null) break;
    if (b.mode === 'rest') break;
  }
  return { carry: b.carry || 0, total: -b.p.z, apex: b.apex, flight };
}

const _fullSpeed = {};
function fullSpeed(club) {
  if (_fullSpeed[club.id]) return _fullSpeed[club.id];
  let lo = 5, hi = 160;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (simulateFlat(mid, club.launch, club.spin).carry < club.carry) lo = mid; else hi = mid;
  }
  return (_fullSpeed[club.id] = (lo + hi) / 2);
}

// Spin scales with how hard the ball is struck.
function spinFor(club, speed, spinMul) {
  return club.spin * spinMul * clamp(speed / fullSpeed(club), 0.3, 1.2);
}

function speedForCarry(club, target, spinMul) {
  if (target <= 0.5) return 0.5;
  const full = fullSpeed(club);
  let lo = 0.5, hi = full * 1.6;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (simulateFlat(mid, club.launch, spinFor(club, mid, spinMul)).carry < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Initial roll speed for a putt that stops `dist` yards away on a flat green
// (at the default green speed: on a faster green the same stroke runs on).
function puttSpeedFor(dist) {
  const green = SURFACES[S_GREEN], saved = { roll: green.roll, rollV: green.rollV };
  green.roll = SURFACES_BASE[S_GREEN].roll; green.rollV = SURFACES_BASE[S_GREEN].rollV;
  try { return puttSpeedOn(dist); } finally { Object.assign(green, saved); }
}
function puttSpeedOn(dist) {
  let lo = 0, hi = 30;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const b = createBall(0, BALL_R, 0);
    startRoll(b, 0, mid);
    let n = 0;
    while (b.mode === 'roll' && n++ < 240 * 60) stepBall(b, GREEN_FIELD, null, DT, null);
    if (-b.p.z < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
