// Visits every tee and screenshots the address view (and optionally the
// overhead shot camera). Usage: node tests/tour.js [outDir] [holes e.g. 2,4]
// Set OVERHEAD=1 for the overhead view too.
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 960), height: Number(process.env.VH || 600) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=0.12');
  await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 120000 });
  const waitGame = async (sec) => {
    const t = await page.evaluate(() => window.__golf.time);
    await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 180000 });
  };
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__golf.mode === 'select', null, { timeout: 120000 });
  await page.evaluate((c) => { window.__golfApi.chooseSelect(c); window.__golfApi.confirmSelect(); }, Number(process.env.CHAR || 1));
  for (let i = 0; i < 9; i++) {
    if (only && !only.includes(i + 1)) continue;
    await page.evaluate((i) => {
      const api = window.__golfApi, h = api.course.holes[i];
      api.activateHole(i);
      api.placePlayer(h.tee.x + 1.2, h.tee.z + 1, 0);
      api.enterShot();
    }, i);
    await waitGame(2);
    await page.screenshot({ path: path.join(out, `tour-${i + 1}-tee.png`), timeout: 180000 });
    if (process.env.OVERHEAD) {
      await page.evaluate(() => (window.__golf.view = 2));
      await waitGame(2);
      await page.screenshot({ path: path.join(out, `tour-${i + 1}-overhead.png`), timeout: 180000 });
      await page.evaluate(() => (window.__golf.view = 0));
    }
    await page.evaluate(() => window.__golfApi.leaveShot());
  }
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
