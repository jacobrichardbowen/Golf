// Gameplay settings and the feel of the swing, in headless Chromium:
// - the Workshop's Gameplay panel: sliders and number boxes change the
//   settings, they're kept in this browser, and they're offered to commit;
// - the settings take effect (walking pace);
// - the swing's hidden sweet spot and perfect strike: when they hit, what
//   they do, and that holding at the top builds power, then loses it;
// - no alignment stick or face line for a putt, and glancing at the hole
//   (hold R) in the club close-up.
// Usage: node tests/gameplay.js [outDir]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });
const errors = [];
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const URL = 'file://' + path.join(__dirname, '..', 'Golf.html') + '?dtcap=0.12';

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const ev = (fn, a) => page.evaluate(fn, a);
  const ready = () => page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 600000 });
  const waitGame = async (sec) => {
    const t = await ev(() => window.__golf.time);
    await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 600000 });
  };
  const shot = (name) => page.screenshot({ path: path.join(out, name), timeout: 600000 });
  await page.goto(URL, { timeout: 600000 });
  await ready();

  // ---- The Workshop's Gameplay panel ----
  await ev(() => window.__golfApi.openWorkshop());
  await page.waitForSelector('#workshop:not([hidden])', { timeout: 120000 });
  await page.click('.ws-item[data-id="gameplay"]');
  const rows = await ev(() => document.querySelectorAll('#wsGameList .ws-tune').length);
  check(rows >= 20, `the Gameplay panel lists the settings (${rows}), each with a slider and a number box`);
  await ev(() => { const r = document.querySelector('.ws-tune[data-key="walkSpeed"] input[type=range]'); r.value = 6.5; r.dispatchEvent(new Event('input')); });
  await page.fill('#tune-cartSpeed', '20');
  await page.press('#tune-cartSpeed', 'Enter');
  const panel = await ev(() => ({
    walk: document.querySelector('#tune-walkSpeed').value,
    cart: document.querySelector('.ws-tune[data-key="cartSpeed"] input[type=range]').value,
    changed: [...document.querySelectorAll('.ws-tune.local')].map((r) => r.dataset.key).join(),
    commit: document.querySelector('#wsCommitOpen').textContent,
  }));
  console.log('panel:', JSON.stringify(panel));
  check(panel.walk === '6.5' && panel.cart === '20', 'the slider fills the number box, and the number box moves the slider');
  check(panel.changed === 'walkSpeed,cartSpeed' && /\(1\)/.test(panel.commit), 'the changed settings are marked, and offered to commit');
  await page.click('#wsCommitOpen');
  check(/Gameplay settings\s*use gameplay\.json/.test(await ev(() => document.querySelector('#wsCommitList').textContent)), 'the commit puts them in assets/gameplay.json');
  await page.click('#wsCommitClose');
  await shot('gp-01-panel.png');

  // ---- Kept in this browser, and in effect ----
  await page.goto(URL, { timeout: 600000 });
  await ready();
  await ev(() => { const api = window.__golfApi; api.openSelect(null); api.chooseSelect(3); api.confirmSelect(); });
  await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });
  await ev(() => {
    const api = window.__golfApi, g = window.__golf, h = api.course.holes[0];
    const dx = h.pin.x - h.tee.x, dz = h.pin.z - h.tee.z, l = Math.hypot(dx, dz), yaw = Math.atan2(dx, -dz);
    api.placePlayer(h.tee.x + (dx / l) * 25, h.tee.z + (dz / l) * 25, yaw);
    g.camYaw = yaw;
  });
  await waitGame(0.3);
  await page.keyboard.down('KeyW');
  await waitGame(1.5);
  const pace = await ev(() => window.__golf.player.speed);
  await page.keyboard.up('KeyW');
  check(Math.abs(pace - 6.5) < 0.3, `after a reload he walks at the new pace (${pace.toFixed(2)} yd/s)`);

  // ---- The sweet spot ----
  await ev(() => { const api = window.__golfApi; api.teleportToBall(); api.enterShot(); });
  await waitGame(0.5);
  const sw = await ev(() => {
    const api = window.__golfApi, Tf = api.backswingTime(), mid = Tf * 0.95;
    const many = (T, n = 300) => {
      const os = [];
      for (let i = 0; i < n; i++) os.push(api.swingOutcome(T, Tf, false));
      const es = os.map((o) => o.e), mean = es.reduce((a, x) => a + x, 0) / n;
      return { power: os[0].power, sd: Math.sqrt(es.reduce((a, x) => a + (x - mean) ** 2, 0) / n), sweet: os[0].sweet, perfect: os[0].perfect };
    };
    return {
      Tf, early: many(Tf * 0.8), before: many(mid - 0.05), sweet: many(mid + 0.03), perfect: many(mid + 0.005), edge: many(mid + 0.009),
      top: many(Tf), held: many(Tf + 0.6), tooLong: many(Tf + 2.5), putt: api.swingOutcome(mid, Tf, true),
    };
  });
  const f = (o) => `${(o.power * 100).toFixed(1)}% spray ${o.sd.toFixed(3)}`;
  console.log(`   backswing ${sw.Tf.toFixed(2)}s: 80% ${f(sw.early)} · before the sweet spot ${f(sw.before)} · sweet ${f(sw.sweet)} · perfect ${f(sw.perfect)} · top ${f(sw.top)} · held ${f(sw.held)} · too long ${f(sw.tooLong)}`);
  check(sw.perfect.perfect && sw.perfect.sd === 0 && !sw.edge.perfect && sw.edge.sweet, 'the perfect strike is a tiny window in the middle of the sweet spot, and flies true');
  check(sw.sweet.sweet && !sw.before.sweet && !sw.before.perfect && !sw.top.sweet, 'the sweet spot is a small window just before the top');
  check(sw.sweet.sd < sw.before.sd * 0.6 && sw.sweet.sd < sw.top.sd * 0.3, 'in the sweet spot the strike sprays far less');
  check(sw.sweet.power > (sw.Tf * 0.95 + 0.03) / sw.Tf && sw.perfect.power > 0.95 * 1.02, 'the sweet spot and the perfect strike add a little power');
  check(sw.top.power > sw.sweet.power && sw.top.power > sw.perfect.power, 'all the way to the top is still more powerful than the sweet spot, but sprays more');
  check(sw.held.power > sw.top.power && sw.held.sd > sw.top.sd, 'holding at the top builds a touch more power, and more spray');
  check(sw.tooLong.power < sw.top.power && sw.tooLong.sd > sw.held.sd * 2, 'held too long, the power drains away and the strike goes wild');
  check(!sw.putt.sweet && !sw.putt.perfect, 'putts have no sweet spot');
  // A real perfect strike.
  const perfect = await ev(() => {
    const api = window.__golfApi, g = window.__golf;
    api.swingPress();
    api.swingRelease(api.backswingTime() * 0.95);
    return g.lastSwing;
  });
  await page.waitForFunction(() => window.__golf.ballState === 'moving', null, { timeout: 60000 });
  const hint = await ev(() => document.getElementById('meterHint').innerText);
  check(perfect.perfect && perfect.e === 0 && /Straight · 95% power/i.test(hint), `a perfect strike flies true, and nothing says it was one (“${hint}”)`);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__golf.ballState === 'rest', null, { timeout: 600000 });
  await page.keyboard.up('Space');

  // ---- The club close-up: putts without guides, and the glance ----
  await ev(() => {
    const api = window.__golfApi, g = window.__golf, h = api.course.holes[g.hole];
    api.dropBall(h.pin.x - 5, h.pin.z + 3);
    api.teleportToBall(); g.clubIndex = 4; api.enterShot(); api.enterSetup();
  });
  await waitGame(1.2);
  check(!(await ev(() => window.__golfApi.stickShown())), 'putting, the close-up has no alignment stick or face line');
  const toPin = () => ev(() => {
    const api = window.__golfApi, g = window.__golf, cam = api.camera, pin = api.course.holes[g.hole].pin;
    const f = new THREE.Vector3(); cam.getWorldDirection(f);
    const d = new THREE.Vector3(pin.x - cam.position.x, 0, pin.z - cam.position.z).normalize();
    return { pitch: Math.asin(f.y), along: (f.x * d.x + f.z * d.z) / Math.hypot(f.x, f.z) };
  });
  const down = await toPin();
  await page.keyboard.down('KeyR');
  await waitGame(1.2);
  const up = await toPin();
  await shot('gp-02-glance.png');
  await page.keyboard.up('KeyR');
  await waitGame(1.2);
  const back = await toPin();
  console.log(`   looking ${(down.pitch * 57.3).toFixed(0)}° → ${(up.pitch * 57.3).toFixed(0)}° → ${(back.pitch * 57.3).toFixed(0)}° (facing the hole: ${up.along.toFixed(2)})`);
  check(down.pitch < -0.6 && up.pitch > -0.35 && up.along > 0.95 && back.pitch < -0.6, 'holding R he looks up the line at the hole, and back down at the ball when let go');
  await ev(() => { const api = window.__golfApi, g = window.__golf; api.leaveSetup(); api.leaveShot(); g.clubIndex = 2; api.enterShot(); api.enterSetup(); });
  await waitGame(1.2);
  check(await ev(() => window.__golfApi.stickShown()), 'with an iron, the alignment stick is still there');

  // ---- Back to the defaults ----
  await ev(() => window.__golfApi.backToTitle());
  await page.waitForFunction(() => window.__golf.mode === 'title', null, { timeout: 120000 });
  await ev(() => window.__golfApi.openWorkshop());
  await page.waitForSelector('#workshop:not([hidden])', { timeout: 120000 });
  await page.click('.ws-item[data-id="gameplay"]');
  check((await ev(() => document.querySelector('#tune-walkSpeed').value)) === '6.5', 'the Workshop still shows the change after a reload');
  await page.click('#wsGameReset');
  const after = await ev(() => ({ walk: document.querySelector('#tune-walkSpeed').value, stored: localStorage.getItem('pinehaven-gameplay'), commit: document.querySelector('#wsCommitOpen').textContent }));
  check(after.walk === '4.2' && after.stored === null && !/\(/.test(after.commit), 'Reset all to defaults puts everything back, with nothing left to commit');

  await browser.close();
  console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  if (errors.length) failed++;
  console.log(failed ? `${failed} failed` : 'gameplay test passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
