// Screenshots of the touch layout (walking, shot, cart) at phone sizes.
// Usage: node tests/mobile.js [outDir]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  for (const [w, h, tag] of [[390, 844, 'portrait'], [844, 390, 'landscape']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=0.12');
    await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 120000 });
    const waitGame = async (sec) => {
      const t = await page.evaluate(() => window.__golf.time);
      await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 180000 });
    };
    await page.tap('#startBtn');
    await page.waitForFunction(() => window.__golf.mode === 'select', null, { timeout: 120000 });
    await waitGame(1.5);
    await page.screenshot({ path: path.join(out, `m-${tag}-select.png`), timeout: 180000 });
    await page.tap('#selGo');
    await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });
    await waitGame(1);
    // Joystick: drag up to walk forward.
    const box = await page.locator('#joy').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 45 }] });
    await waitGame(1.5);
    await page.screenshot({ path: path.join(out, `m-${tag}-walk.png`), timeout: 180000 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const moved = await page.evaluate(() => window.__golf.player);
    console.log(tag, 'player after joystick', moved.x.toFixed(1), moved.z.toFixed(1));
    await page.evaluate(() => { const hh = window.__golfApi.course.holes[0]; window.__golfApi.placePlayer(hh.tee.x + 1.2, hh.tee.z + 1, 0); });
    await waitGame(0.4);
    await page.screenshot({ path: path.join(out, `m-${tag}-at-ball.png`), timeout: 180000 });
    await page.tap('#actBtn');
    await waitGame(1.5);
    await page.screenshot({ path: path.join(out, `m-${tag}-shot.png`), timeout: 180000 });
    console.log(tag, 'mode after action button:', await page.evaluate(() => window.__golf.mode));
    // The bag close-up: step back, walk up to the bag, tap the action button.
    await page.tap('#backBtn');
    await waitGame(3);
    await page.evaluate(() => { const b = window.__golfApi.bagBase; window.__golfApi.placePlayer(b.x + 1.2, b.z + 0.6, Math.atan2(-1.2, 0.6)); });
    await waitGame(0.4);
    await page.tap('#actBtn');
    await waitGame(1.6);
    await page.screenshot({ path: path.join(out, `m-${tag}-bag.png`), timeout: 180000 });
    const cs = await page.evaluate(() => window.__golfApi.clubScreen(3));
    await page.touchscreen.tap(cs.x, cs.y);
    await waitGame(1);
    console.log(tag, 'after tapping a club:', await page.evaluate(() => [window.__golf.mode, document.getElementById('inHandClub').textContent].join(' / ')));
    await page.close();
  }
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
