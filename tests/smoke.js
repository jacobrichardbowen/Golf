// Headless smoke test: loads Golf.html in Chromium and plays through the
// open-world flow (walk, address, swing, ball cam, first person, cart, hole
// out, next tee), saving screenshots and reporting console errors.
// Usage: node tests/smoke.js [outDir]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });

const errors = [];
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const vw = Number(process.env.VW || 960), vh = Number(process.env.VH || 600);
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const t0 = Date.now();
  await page.goto('file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=' + (process.env.DTCAP || '0.12'));
  await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 120000 });
  console.log(`course ready in ${Date.now() - t0}ms`);
  const G = (fn, arg) => page.evaluate(fn, arg);
  const waitGame = async (sec) => {
    const t = await G(() => window.__golf.time);
    await page.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 180000 });
  };
  const shot = (name) => page.screenshot({ path: path.join(out, name), timeout: 180000 });
  await waitGame(1);
  await shot('01-title.png');

  // Character select: step through the line-up, then tee off as G. Surlaw (the tallest).
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__golf.mode === 'select', null, { timeout: 120000 });
  await page.keyboard.press('ArrowRight');
  await waitGame(2.5);
  await shot('02-select.png');
  await G(() => window.__golfApi.chooseSelect(Number(0)));
  await waitGame(0.6);
  await page.click('#selGo');
  await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });
  console.log('playing as', await G(() => window.__golfApi.golfer.style.name));
  await waitGame(1.5);
  await shot('02-walk-start.png');

  // Walk forward (towards the tee) for a couple of seconds of game time.
  const p0 = await G(() => ({ ...window.__golf.player }));
  await page.keyboard.down('KeyW');
  await waitGame(2);
  await page.keyboard.up('KeyW');
  const p1 = await G(() => ({ ...window.__golf.player }));
  console.log('walked', Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1), 'yds');
  await shot('03-walking.png');

  // Step up to the ball on the tee and address it.
  await G(() => { const h = window.__golfApi.course.holes[0]; window.__golfApi.placePlayer(h.tee.x + 1.2, h.tee.z + 1.0, 0); });
  await waitGame(0.5);
  const prompt = await G(() => document.getElementById('prompt').textContent);
  console.log('prompt near ball:', prompt);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__golf.mode === 'shot', null, { timeout: 120000 });
  await waitGame(1.5);
  await shot('04-address.png');

  // Look at the club in the close-up, open the face a touch, then come back.
  await page.keyboard.press('KeyQ');
  await waitGame(0.8);
  await page.keyboard.down('KeyD');
  await waitGame(0.3);
  await page.keyboard.up('KeyD');
  const setup = await G(() => ({ view: window.__golf.setupView, face: window.__golf.setup.face, hint: document.getElementById('meterHint').innerText }));
  console.log('setup:', JSON.stringify(setup));
  if (!setup.view || !(setup.face > 0)) errors.push('club close-up did not open the face');
  await shot('04b-setup.png');
  await page.keyboard.press('KeyQ');
  await waitGame(0.6);

  // Hold to wind up, let go to swing.
  const stance = await G(() => ({ ...window.__golf.player }));
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__golf.swing.p > 0.85, null, { timeout: 120000 });
  await shot('05-backswing.png'); // he holds at the top while the key is down
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__golf.ballState === 'moving', null, { timeout: 60000 });
  await waitGame(0.15);
  await shot('06-impact.png');
  await waitGame(1.6);
  await shot('07-ballcam.png');
  // The golfer stays where he stood through the follow-through.
  const after = await G(() => ({ ...window.__golf.player }));
  const slid = Math.hypot(after.x - stance.x, after.z - stance.z);
  console.log('golfer moved during the swing:', slid.toFixed(2), 'yds');
  if (slid > 0.1) errors.push(`golfer slid ${slid.toFixed(2)} yds during the swing`);
  await page.keyboard.down('Space'); // fast-forward the ball
  await page.waitForFunction(() => window.__golf.ballState === 'rest', null, { timeout: 600000 });
  await page.keyboard.up('Space');
  const r1 = await G(() => ({ ball: window.__golf.ball.p, strokes: window.__golf.strokes, mode: window.__golf.mode }));
  console.log('after drive:', JSON.stringify(r1));
  await waitGame(2.5);
  await shot('08-after-drive.png');

  // Change clubs at the bag: wait for the caddy to stop, walk up to the bag, pick the 4 iron.
  await G(() => window.__golfApi.teleportToBall());
  await waitGame(4);
  await G(() => {
    // Stand just beyond the bag, on the side away from the ball, facing it.
    const b = window.__golfApi.bagBase, ball = window.__golf.ball.p;
    let dx = b.x - ball.x, dz = b.z - ball.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    window.__golfApi.placePlayer(b.x + dx * 1.2, b.z + dz * 1.2, Math.atan2(-dx, dz));
  });
  await waitGame(0.4);
  console.log('prompt near bag:', await G(() => document.getElementById('prompt').textContent));
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__golf.mode === 'bag', null, { timeout: 120000 });
  await waitGame(1.8);
  await shot('08b-bag.png');
  const cs = await G(() => window.__golfApi.clubScreen(1));
  await page.mouse.move(cs.x, cs.y);
  await waitGame(0.4);
  const hover = await G(() => ({ hover: window.__golf.bagHover, cursor: document.getElementById('scene').style.cursor }));
  console.log('hovering club', JSON.stringify(hover));
  await shot('08c-bag-hover.png');
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });
  console.log('club in hand:', await G(() => document.getElementById('inHandClub').textContent));

  // First person
  await page.keyboard.press('KeyV');
  await waitGame(0.6);
  await shot('09-first-person.png');
  await page.keyboard.press('KeyV');

  // Drive the cart a little
  await G(() => { const c = window.__golfApi.cart.st; window.__golfApi.placePlayer(c.x + 1.6, c.z, 0); });
  await waitGame(0.3);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__golf.mode === 'cart', null, { timeout: 120000 });
  const c0 = await G(() => ({ ...window.__golfApi.cart.st }));
  await page.keyboard.down('KeyW');
  await waitGame(2.5);
  await page.keyboard.up('KeyW');
  const c1 = await G(() => ({ ...window.__golfApi.cart.st }));
  console.log('cart drove', Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(1), 'yds, speed', c1.speed.toFixed(1));
  await shot('10-cart.png');
  await page.keyboard.press('KeyV');
  await waitGame(0.5);
  await shot('11-cart-fp.png');
  await page.keyboard.press('KeyV');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });

  // Play out the hole: walk (teleport) to the ball, address, hit with good power.
  let putted = false;
  for (let i = 0; i < 9; i++) {
    const st = await G(() => window.__golf.ballState);
    if (st !== 'rest' && st !== 'tee') break;
    await G(() => {
      // Take the caddy's advice (tests skip the walk to the bag).
      const api = window.__golfApi;
      api.teleportToBall(); api.enterShot();
      const rec = api.recommendedClub(); api.leaveShot();
      window.__golf.clubIndex = rec; api.enterShot();
    });
    const strokesBefore = await G(() => window.__golf.strokes);
    const info = await G(() => {
      const g = window.__golf, h = window.__golfApi.course.holes[g.hole];
      const d = Math.hypot(h.pin.x - g.ball.p.x, h.pin.z - g.ball.p.z);
      const putt = document.getElementById('clubName').textContent === 'Putter';
      let p;
      if (putt) p = Math.min(1, (d + 0.4) / g.puttRange);
      else p = Math.min(1, (d - 6) / Number(document.getElementById('clubDist').textContent.split(' ')[0]));
      window.__golfApi.swingNow(Math.max(0.05, p), 0);
      return { d: d.toFixed(1), putt };
    });
    // Wait for the stroke rather than for 'moving': a tap-in can drop within a single frame.
    await page.waitForFunction((n) => window.__golf.strokes > n, strokesBefore, { timeout: 120000 });
    if (i === 1) { await waitGame(0.1); await shot('12-approach.png'); }
    await page.keyboard.down('Space');
    await page.waitForFunction(() => ['rest', 'holed', 'tee'].includes(window.__golf.ballState), null, { timeout: 600000 });
    await page.keyboard.up('Space');
    const s = await G(() => ({ state: window.__golf.ballState, strokes: window.__golf.strokes }));
    console.log('shot from', info.d, 'yds', info.putt ? '(putt)' : '', '->', JSON.stringify(s));
    if (s.state === 'holed') break;
    const lie = await G(() => window.__golfApi.course.surface(window.__golf.ball.p.x, window.__golf.ball.p.z));
    if (lie === 3 && !putted) {
      putted = true;
      await G(() => { const api = window.__golfApi; api.teleportToBall(); window.__golf.clubIndex = 4; api.enterShot(); });
      await waitGame(1.2);
      await shot('13-putt.png');
      await G(() => window.__golfApi.leaveShot());
      // Stand right next to the cup and look down at it.
      await G(() => { const h = window.__golfApi.course.holes[window.__golf.hole]; window.__golfApi.placePlayer(h.pin.x - 1.2, h.pin.z + 1.2, Math.atan2(1.2, -1.2)); window.__golf.camPitch = 0.75; });
      await waitGame(1.0);
      await shot('13b-cup-close.png');
      await G(() => { window.__golf.fp = true; window.__golf.camPitch = 0.9; });
      await waitGame(0.6);
      await shot('13c-cup-fp.png');
      await G(() => { window.__golf.fp = false; window.__golf.camPitch = 0.22; });
    }
  }
  await page.waitForFunction(() => !document.getElementById('card').hidden, null, { timeout: 600000 }).catch(() => {});
  await shot('14-card.png');
  await page.keyboard.press('Enter');
  await waitGame(1.5);
  const nx = await G(() => ({ hole: window.__golf.hole, state: window.__golf.ballState, score: window.__golf.scores[0] }));
  console.log('next hole:', JSON.stringify(nx));
  await shot('15-next-tee.png');
  await page.keyboard.press('KeyM');
  await waitGame(0.3);
  await shot('16-map.png');
  await page.keyboard.press('KeyM');

  const fps = await G(() => new Promise((res) => {
    let n = 0; const t = performance.now();
    function f() { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else res(n / 2); }
    requestAnimationFrame(f);
  }));
  const painted = await G(() => `${window.__golfWorld.paintedChunks}/${window.__golfWorld.chunkCount}`);
  console.log('fps (software GL):', fps, ' hi-res chunks painted:', painted);
  console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  if (errors.length) console.error('page errors so far:\n' + errors.join('\n'));
  process.exit(1);
});
