// Visits every hole and screenshots the tee view (and an overhead view).
// Usage: node tests/tour.js [outDir] [holeNumbers e.g. 2,4]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const vw = Number(process.env.VW || 1280), vh = Number(process.env.VH || 760);
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'Golf.html'));
  await page.waitForFunction(() => window.__golf && window.__golf.state === 'title', null, { timeout: 60000 });
  const waitGame = async (sec) => {
    const t = await page.evaluate(() => window.__golf.time);
    await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 120000 });
  };
  if (process.env.TOUCH) await page.tap('#startBtn'); else await page.click('#startBtn');
  for (let i = 0; i < 9; i++) {
    if (only && !only.includes(i + 1)) continue;
    await page.evaluate((i) => window.__golfApi.loadHole(i), i);
    await page.waitForFunction(() => window.__golf.state === 'intro', null, { timeout: 60000 });
    await waitGame(1.0);
    if (i === 0 || only) await page.screenshot({ path: path.join(out, `tour-${i + 1}-intro.png`) });
    await page.evaluate(() => window.__golfApi.endIntro());
    await waitGame(2.0);
    await page.screenshot({ path: path.join(out, `tour-${i + 1}-tee.png`) });
    if (process.env.OVERHEAD) {
      await page.evaluate(() => (window.__golf.view = 2));
      await waitGame(2.0);
      await page.screenshot({ path: path.join(out, `tour-${i + 1}-overhead.png`) });
      await page.evaluate(() => (window.__golf.view = 0));
    }
  }
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
