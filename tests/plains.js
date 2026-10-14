// Golden Plains in headless Chromium: walk across a rope bridge (staying on
// the deck high above the creek), walk through the tunnel (on its floor, not
// up on the mesa), send the caddy for the cart, and look at the club through
// the golfer's eyes. Saves screenshots and reports console errors.
// Usage: node tests/plains.js [outDir]
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
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=0.12&course=golden', { timeout: 600000 });
  await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 600000 });
  const ev = (fn, a) => page.evaluate(fn, a);
  const waitGame = async (sec) => {
    const t = await ev(() => window.__golf.time);
    await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 600000 });
  };
  const shot = (name) => page.screenshot({ path: path.join(out, name), timeout: 600000 });
  check(await ev(() => document.getElementById('wordmark').textContent.startsWith('Golden Plains')), 'the title shows Golden Plains');

  // Play as Beetor.
  await ev(() => { const api = window.__golfApi; api.openSelect(null); api.chooseSelect(4); api.confirmSelect(); });
  await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });
  console.log('playing as', await ev(() => window.__golfApi.golfer.style.name));

  // The rope bridge on the 3rd: from the tee mesa to the green mesa.
  const br = await ev(() => { const b = window.__golfApi.course.bridges[0]; return { ax: b.ax, az: b.az, ux: b.ux, uz: b.uz, len: b.len, ya: b.ya }; });
  await ev((b) => {
    const api = window.__golfApi, g = window.__golf;
    api.activateHole(2);
    api.placePlayer(b.ax - b.ux * 3, b.az - b.uz * 3, Math.atan2(b.ux, -b.uz), b.ya);
    g.camYaw = Math.atan2(b.ux, -b.uz); g.camPitch = 0.3; g.camDist = 6;
  }, br);
  await waitGame(0.5);
  let low = Infinity;
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 12; i++) {
    await waitGame(1);
    const p = await ev(() => ({ ...window.__golf.player }));
    const s = (p.x - br.ax) * br.ux + (p.z - br.az) * br.uz;
    if (s > 5 && s < br.len - 5) low = Math.min(low, p.y);
    if (i === 4) await shot('p-01-on-the-bridge.png');
    if (s > br.len + 2) break;
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const pb = await ev(() => ({ ...window.__golf.player }));
  const sb = (pb.x - br.ax) * br.ux + (pb.z - br.az) * br.uz;
  console.log(`crossed to ${sb.toFixed(0)} of ${br.len.toFixed(0)}yd, lowest ${low.toFixed(1)}yd (deck ${br.ya.toFixed(1)} at the ends)`);
  check(sb > br.len * 0.6 && low > br.ya - 3, 'walking across the bridge stays on the deck');

  // The tunnel on the 4th: walk in at one end and out of the other.
  const tn = await ev(() => { const t = window.__golfApi.course.tunnels[0]; return { ax: t.ax, az: t.az, ux: t.ux, uz: t.uz, s0: t.s0, s1: t.s1, ya: t.ya, yb: t.yb, len: t.len }; });
  await ev((t) => {
    const api = window.__golfApi, g = window.__golf;
    api.activateHole(3);
    const yaw = Math.atan2(t.ux, -t.uz);
    api.placePlayer(t.ax + t.ux * (t.s0 - 6), t.az + t.uz * (t.s0 - 6), yaw);
    g.camYaw = yaw; g.camPitch = 0.12; g.camDist = 5;
  }, tn);
  let high = -Infinity;
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 16; i++) {
    await waitGame(1);
    const p = await ev(() => ({ ...window.__golf.player }));
    const s = (p.x - tn.ax) * tn.ux + (p.z - tn.az) * tn.uz;
    const floor = tn.ya + (tn.yb - tn.ya) * (s / tn.len);
    if (s > tn.s0 + 2 && s < tn.s1 - 2) high = Math.max(high, p.y - floor);
    if (i === 5) await shot('p-02-in-the-tunnel.png');
    if (s > tn.s1 + 4) break;
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const pt = await ev(() => ({ ...window.__golf.player }));
  const st = (pt.x - tn.ax) * tn.ux + (pt.z - tn.az) * tn.uz;
  console.log(`walked to ${st.toFixed(0)}yd (rock from ${tn.s0} to ${tn.s1}), at most ${high.toFixed(2)}yd above the tunnel floor`);
  check(st > tn.s1 && high < 0.5, 'walking through the tunnel stays on its floor');

  // Send the caddy for the cart, parked a long way off.
  await ev(() => {
    const api = window.__golfApi, g = window.__golf;
    api.activateHole(0);
    api.placePlayer(10, -150, 0);
    api.cart.place(60, 40, 0);
    g.camYaw = 0; g.camPitch = 0.2; g.camDist = 5;
  });
  await waitGame(1);
  await ev(() => window.__golfApi.fetchCart());
  const f0 = await ev(() => ({ ...window.__golf.fetch }));
  console.log('fetch:', JSON.stringify(f0));
  check(f0.phase === 'leaving' && f0.wait === 30, 'the caddy sets off for a far-away cart, half a minute away');
  await page.waitForFunction(() => window.__golf.fetch && window.__golf.fetch.phase === 'away', null, { timeout: 300000 });
  check(await ev(() => !window.__golfApi.caddy.root.visible), 'he is out of sight once he has gone');
  await ev(() => { window.__golf.fetch.wait = 1; }); // don't wait the full half minute
  await page.waitForFunction(() => window.__golf.fetch && window.__golf.fetch.phase === 'arriving', null, { timeout: 300000 });
  const arrive = await ev(() => {
    const g = window.__golf, c = window.__golfApi.cart.st;
    return { d: Math.hypot(c.x - g.player.x, c.z - g.player.z) };
  });
  console.log(`the cart turns up ${arrive.d.toFixed(0)}yd away`);
  await waitGame(1.5);
  await shot('p-03-cart-arriving.png');
  await page.waitForFunction(() => !window.__golf.fetch, null, { timeout: 300000 });
  const done = await ev(() => {
    const g = window.__golf, c = window.__golfApi.cart.st;
    return { d: Math.hypot(c.x - g.player.x, c.z - g.player.z), caddy: window.__golfApi.caddy.root.visible };
  });
  console.log(`cart parked ${done.d.toFixed(1)}yd away`);
  check(arrive.d > 25 && done.d < 14 && done.d > 3 && done.caddy, 'the caddy drives the cart in from out of sight and parks it beside you');
  await shot('p-04-cart-delivered.png');

  // The club close-up, through the golfer's eyes.
  await ev(() => { const api = window.__golfApi; api.activateHole(0); api.teleportToBall(); api.enterShot(); api.enterSetup(); });
  await waitGame(2);
  await shot('p-05-setup-pov.png');
  check(await ev(() => window.__golf.setupView), 'the club close-up opens');

  await browser.close();
  console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  if (errors.length) failed++;
  console.log(failed ? `${failed} failed` : 'plains test passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
