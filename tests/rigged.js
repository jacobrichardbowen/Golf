// The rigged, skinned golfers in headless Chromium. G. Surlaw (KayKit's
// Barbarian): his clips play when he stands and walks (with his planted foot
// not sliding), the joints' poses take over at address, in the swing and in
// the cart, and his hands stay on the club's grip throughout. A. Salt (the
// Auto-Rig Pro base mesh, no clips): the joints' poses drive him everywhere,
// hands on the grip with the fingers closed round it. Saves screenshots,
// reports errors.
// Usage: node tests/rigged.js [outDir]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });
const errors = [];
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const ev = (fn, a) => page.evaluate(fn, a);
  const waitGame = async (sec) => {
    const t = await ev(() => window.__golf.time);
    await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 600000 });
  };
  const shot = (name) => page.screenshot({ path: path.join(out, name), timeout: 600000 });
  // Hold the camera at a spot in the golfer's own frame.
  const hold = (p, l) => ev(([p, l]) => {
    const g = window.__golfApi.golfer;
    g.root.updateMatrixWorld(true);
    window.__golf.camHold = { pos: g.root.localToWorld(new THREE.Vector3(...p)), look: g.root.localToWorld(new THREE.Vector3(...l)) };
  }, [p, l]);
  const weights = () => ev(() => window.__golfApi.golfer.skin.weights());
  // How far each hand (its grip bone, if it has one) is from the top of the
  // club's grip (yards).
  const grip = () => ev(() => {
    const g = window.__golfApi.golfer, b = g.skin.bones;
    g.root.updateMatrixWorld(true);
    const c = g.joints.club.getWorldPosition(new THREE.Vector3());
    return ['handl', 'handr'].map((h) => (b[h].children.find((k) => /grip/i.test(k.name)) || b[h]).getWorldPosition(new THREE.Vector3()).distanceTo(c));
  });
  const play = async (i) => {
    await page.goto('file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=0.12', { timeout: 600000 });
    await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 600000 });
    await ev((i) => { const api = window.__golfApi; api.openSelect(null); api.chooseSelect(i); api.confirmSelect(); }, i);
    await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });
  };

  await play(0);
  const info = await ev(() => {
    const g = window.__golfApi.golfer;
    return g.skin && { name: g.style.name, clips: g.skin.clips, walk: g.skin.speed('walk'), run: g.skin.speed('run') };
  });
  console.log('skinned:', JSON.stringify(info));
  check(info && info.clips.sort().join() === 'idle,run,walk', 'Surlaw is a skinned model with idle, walk and run clips');
  check(info && info.walk > 0.3 && info.walk < 3 && info.run > info.walk * 1.5, `the walk and run clips cover the ground at ${info.walk.toFixed(2)} and ${info.run.toFixed(2)} yd/s`);

  await waitGame(1);
  const wi = await weights();
  check(wi.idle > 0.9, `standing still plays the idle clip (${JSON.stringify(wi)})`);
  await hold([0, 1.1, 4], [0, 0.9, 0]);
  await waitGame(0.6);
  await shot('r-01-idle.png');
  await ev(() => { window.__golf.camHold = null; });

  // The planted foot should stay put while he walks and runs: step his
  // animation finely (60 a second) at the game's walking and running speeds,
  // moving him along, and see how fast the foot moves while it's down.
  const slide = await ev(() => {
    const g = window.__golfApi.golfer, foot = g.skin.bones.footl, root = g.root, dt = 1 / 60;
    return [4.2, 8.5].map((speed) => {
      const s = [];
      for (let i = 0; i < 90; i++) g.update(dt, { mode: 'walk', speed });
      for (let i = 0; i < 120; i++) {
        root.translateZ(speed * dt);
        g.update(dt, { mode: 'walk', speed });
        root.updateMatrixWorld(true);
        const p = foot.getWorldPosition(new THREE.Vector3());
        s.push({ x: p.x, z: p.z, h: p.y - root.position.y });
      }
      const lo = Math.min(...s.map((q) => q.h)), hi = Math.max(...s.map((q) => q.h)), down = (q) => q.h < lo + (hi - lo) * 0.2;
      const v = [];
      for (let i = 1; i < s.length; i++) if (down(s[i]) && down(s[i - 1])) v.push(Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z) / dt);
      v.sort((a, b) => a - b);
      return { speed, planted: v.length ? v[v.length >> 1] : Infinity };
    });
  });
  for (const r of slide) check(r.planted < r.speed * 0.2, `at ${r.speed} yd/s the planted foot hardly slides (${r.planted.toFixed(2)} yd/s)`);

  // Walk down the first fairway.
  await ev(() => {
    const api = window.__golfApi, g = window.__golf, h = api.course.holes[0];
    const dx = h.pin.x - h.tee.x, dz = h.pin.z - h.tee.z, l = Math.hypot(dx, dz), yaw = Math.atan2(dx, -dz);
    api.placePlayer(h.tee.x + (dx / l) * 25, h.tee.z + (dz / l) * 25, yaw);
    g.camYaw = yaw; g.camPitch = 0.2;
  });
  await waitGame(0.5);
  await page.keyboard.down('KeyW');
  await waitGame(1.5);
  const ww = await weights();
  // (A short-legged body has to break into its run to keep up.)
  check(ww.walk + ww.run > 0.9, `walking plays the walk and run clips (${JSON.stringify(ww)})`);
  await hold([4, 1.0, 0], [0, 0.9, 0]);
  await waitGame(0.12);
  await shot('r-02-walk.png');
  await page.keyboard.down('ShiftLeft');
  await waitGame(1.5);
  const wr = await weights();
  check(wr.run > 0.6, `running plays the run clip (${JSON.stringify(wr)})`);
  await hold([4, 1.0, 0], [0, 0.9, 0]);
  await waitGame(0.12);
  await shot('r-03-run.png');
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await ev(() => { window.__golf.camHold = null; });

  // At address and in the swing the joints' poses take over, hands on the grip.
  await ev(() => { const api = window.__golfApi; api.teleportToBall(); api.enterShot(); });
  await waitGame(1.5);
  const wa = await weights(), ga = await grip();
  console.log('address:', JSON.stringify(wa), 'hands from grip', ga.map((d) => d.toFixed(3)).join(', '));
  check(wa.pose > 0.95, 'at address the bones take the address pose');
  check(Math.max(...ga) < 0.12, 'both hands are on the grip at address');
  const feet = await ev(() => {
    const g = window.__golfApi.golfer, api = window.__golfApi;
    return ['footl', 'footr'].map((f) => { const p = g.skin.bones[f].getWorldPosition(new THREE.Vector3()); return p.y - api.course.floor(p.x, p.z, p.y); });
  });
  check(feet.every((h) => h > 0 && h < 0.3), `his ankles stay just above the ground (${feet.map((h) => h.toFixed(2)).join(', ')} yd)`);
  await hold([0, 1.0, 4.2], [0, 0.75, 0]);
  await waitGame(1);
  await shot('r-04-address.png');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__golf.swing.p > 0.97, null, { timeout: 120000 });
  const gt = await grip();
  check(Math.max(...gt) < 0.12, `and at the top of the backswing (${gt.map((d) => d.toFixed(3)).join(', ')})`);
  await shot('r-05-top.png');
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__golf.ballState === 'moving', null, { timeout: 60000 });
  await waitGame(0.6);
  const gf = await grip();
  check(Math.max(...gf) < 0.12, `and through to the finish (${gf.map((d) => d.toFixed(3)).join(', ')})`);
  await shot('r-06-finish.png');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__golf.ballState === 'rest', null, { timeout: 600000 });
  await page.keyboard.up('Space');
  await ev(() => { window.__golf.camHold = null; });

  // Driving the cart.
  await ev(() => { const c = window.__golfApi.cart.st; window.__golfApi.placePlayer(c.x + 1.6, c.z, 0); });
  await waitGame(0.3);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__golf.mode === 'cart', null, { timeout: 120000 });
  await waitGame(1.2);
  const wc = await weights();
  check(wc.pose > 0.95, 'in the cart he sits at the wheel');
  await hold([2.2, 1.4, 2.5], [0, 0.6, 0]);
  await waitGame(0.6);
  await shot('r-07-cart.png');

  // A. Salt: no clips, so the joints' poses drive him throughout.
  await play(3);
  const salt = await ev(() => {
    const g = window.__golfApi.golfer;
    return g.skin && { name: g.style.name, clips: g.skin.clips, bones: Object.keys(g.skin.bones).length };
  });
  console.log('skinned:', JSON.stringify(salt));
  check(salt && salt.name === 'A. Salt' && salt.clips.length === 0 && salt.bones >= 15, 'Salt is a skinned model with every bone the game needs, and no clips yet');
  await waitGame(1);
  check((await weights()).pose > 0.95, 'standing, the bones take the pose the game works out');
  await hold([0, 0.9, 2.6], [0, 0.75, 0]);
  await waitGame(0.6);
  await shot('r-08-salt-idle.png');
  await ev(() => { window.__golf.camHold = null; });
  await ev(() => { const api = window.__golfApi; api.teleportToBall(); api.enterShot(); });
  await waitGame(1.5);
  const sa = await grip();
  check(Math.max(...sa) < 0.08, `at address both hands hold the grip (${sa.map((d) => d.toFixed(3)).join(', ')})`);
  const curl = await ev(() => {
    const b = window.__golfApi.golfer.skin.model.getObjectByName('index_02L');
    return b ? 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))) : null;
  });
  check(curl === null || curl > 0.6, `with the fingers closed round it (${curl === null ? 'no finger bones' : curl.toFixed(2) + ' rad'})`);
  await hold([0.35, 0.95, 1.5], [0, 0.6, 0.3]);
  await waitGame(1);
  await shot('r-09-salt-grip.png');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__golf.swing.p > 0.97, null, { timeout: 120000 });
  const st = await grip();
  check(Math.max(...st) < 0.08, `and at the top of the backswing (${st.map((d) => d.toFixed(3)).join(', ')})`);
  await hold([0, 1.0, 4.2], [0, 0.75, 0]);
  await waitGame(0.3);
  await shot('r-10-salt-top.png');
  await page.keyboard.up('Space');

  await browser.close();
  console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  if (errors.length) failed++;
  console.log(failed ? `${failed} failed` : 'rigged test passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
