// Headless smoke test: loads Golf.html in Chromium, plays a few shots through
// the real UI, records console errors and saves screenshots.
// Usage: node tests/smoke.js [outDir]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wait for `sec` seconds of *game* time (software GL can run at a few fps).
async function waitGame(page, sec) {
  const t = await page.evaluate(() => window.__golf.time);
  await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 120000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const vw = Number(process.env.VW || 1280), vh = Number(process.env.VH || 760);
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'Golf.html'));
  await page.waitForFunction(() => window.__golf && window.__golf.state === 'title', null, { timeout: 60000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(out, '01-title.png') });

  await page.click('#startBtn');
  await page.waitForFunction(() => window.__golf.state === 'intro', null, { timeout: 30000 });
  await waitGame(page, 1.2);
  await page.screenshot({ path: path.join(out, '02-intro.png') });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__golf.state === 'aim');
  await waitGame(page, 1.5);
  await page.screenshot({ path: path.join(out, '03-aim.png') });

  // Real three-press swing via keyboard: start, power at ~90%, accuracy near the line.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__golf.meter.p > 0.88);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__golf.meter.p < 0.02);
  await page.keyboard.press('Space');
  await waitGame(page, 2.5);
  await page.screenshot({ path: path.join(out, '04-flight.png') });
  const t0 = Date.now();
  // fast-forward
  await page.keyboard.down('Space');
  await page.waitForFunction(() => ['settle', 'aim', 'penalty', 'holed'].includes(window.__golf.state), null, { timeout: 60000 });
  await page.keyboard.up('Space');
  const info = await page.evaluate(() => {
    const G = window.__golf;
    return { state: G.state, strokes: G.strokes, ball: G.ball.p, carry: G.ball.carry, shot: G.shot && { power: G.shot.power, e: G.shot.e, club: G.shot.club.name } };
  });
  console.log('after shot 1 (' + (Date.now() - t0) + 'ms):', JSON.stringify(info));
  await sleep(400);
  await page.screenshot({ path: path.join(out, '05-rest.png') });
  await page.waitForFunction(() => window.__golf.state === 'aim', null, { timeout: 120000 });
  await waitGame(page, 1.5);
  await page.screenshot({ path: path.join(out, '06-aim2.png') });

  // Play out the hole with API shots (perfect accuracy, power to reach the pin).
  for (let i = 0; i < 8; i++) {
    const st = await page.evaluate(() => window.__golf.state);
    if (st !== 'aim') break;
    await page.evaluate(() => {
      const G = window.__golf, api = window.__golfApi;
      const d = Math.hypot(G.field.pin.x - G.ball.p.x, G.field.pin.z - G.ball.p.z);
      api.meterPress(); // enter swing state
      // power: putt -> distance/range; full shot -> distance/carry
      let p = 1;
      const isPutt = document.getElementById('clubName').textContent === 'Putter';
      if (isPutt) p = Math.min(1, (d + 0.4) / G.puttRange);
      else {
        const carry = Number(document.getElementById('clubDist').textContent.split(' ')[0]);
        p = Math.min(1, (d - 6) / carry);
      }
      api.takeShot(Math.max(0.05, p), 0);
    });
    await page.keyboard.down('Space');
    await page.waitForFunction(() => ['settle', 'aim', 'penalty', 'holed', 'card'].includes(window.__golf.state), null, { timeout: 60000 });
    await page.keyboard.up('Space');
    const s = await page.evaluate(() => ({ state: window.__golf.state, strokes: window.__golf.strokes, lie: window.__golf.lie, d: Math.hypot(window.__golf.field.pin.x - window.__golf.ball.p.x, window.__golf.field.pin.z - window.__golf.ball.p.z) }));
    console.log('shot', i + 2, JSON.stringify(s));
    if (i === 0) await page.screenshot({ path: path.join(out, '07-approach.png') });
    if (s.state === 'holed') {
      await waitGame(page, 0.8);
      await page.screenshot({ path: path.join(out, '08-holed.png') });
      break;
    }
    await page.waitForFunction(() => ['aim', 'holed', 'card'].includes(window.__golf.state), null, { timeout: 120000 });
    await waitGame(page, 1.2);
    const lie = await page.evaluate(() => window.__golf.lie);
    if (lie === 3) await page.screenshot({ path: path.join(out, '07b-putt.png') });
  }
  await page.waitForFunction(() => window.__golf.state === 'card', null, { timeout: 120000 }).catch(() => {});
  await sleep(500);
  await page.screenshot({ path: path.join(out, '09-card.png') });
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t = performance.now();
    function f() { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else res(n / 2); }
    requestAnimationFrame(f);
  }));
  console.log('fps (software GL):', fps);
  console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
