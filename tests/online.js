// Online play with three golfers: three headless browsers (one host, two
// guests) meet through a PeerJS server, tee off together, see each other,
// share the wind, swap scores and wait for each other between holes.
// (tests/net.js covers the message layer itself, quickly.)
// Needs a PeerJS server: run `npx peer --port 9000` (or set PEER=host:port).
// Usage: node tests/online.js [outDir]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });
const PEER = process.env.PEER || '127.0.0.1:9000';
const errors = [];
const fail = (msg) => { throw new Error(msg); };

(async () => {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const url = 'file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=0.15&peer=' + encodeURIComponent(PEER);
  const names = ['Ann', 'Bob', 'Cy'];
  const pages = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: i === 0 ? 800 : 480, height: i === 0 ? 500 : 300 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${names[i]} console] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${names[i]} pageerror] ${e.message}`));
    // One at a time: building three courses at once starves a software renderer.
    await page.goto(url, { timeout: 600000 });
    await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 600000 });
    pages.push(page);
  }
  const [A, B, C] = pages;
  console.log('three games loaded');
  const ev = (p, fn, arg) => p.evaluate(fn, arg);
  const waitGame = async (p, sec) => {
    const t = await ev(p, () => window.__golf.time);
    await p.waitForFunction((t) => window.__golf.time >= t, t + sec, { timeout: 480000 });
  };
  const shot = (p, name) => p.screenshot({ path: path.join(out, name), timeout: 240000 });

  // The lobby: Ann hosts, Bob and Cy join with her code.
  async function meet(p, i) {
    await p.click('#mpBtn');
    await p.fill('#lbName', names[i]);
    await p.click(`#lbChars .lb-char[data-i="${i}"]`);
  }
  await meet(A, 0);
  await A.click('#lbHost');
  await A.waitForFunction(() => !document.getElementById('lbRoom').hidden, null, { timeout: 180000 });
  const code = await ev(A, () => document.getElementById('lbCodeShow').textContent);
  console.log('hosting with code', code);
  for (const [p, i] of [[B, 1], [C, 2]]) {
    await meet(p, i);
    await p.fill('#lbCode', code.toLowerCase());
    await p.click('#lbJoin');
    await p.waitForFunction(() => !document.getElementById('lbRoom').hidden, null, { timeout: 180000 })
      .catch(async () => fail(`${names[i]} could not join: ` + await ev(p, () => document.getElementById('lbStatus').textContent)));
  }
  await A.waitForFunction(() => document.querySelectorAll('#lbPlayers li').length === 3, null, { timeout: 180000 });
  await C.waitForFunction(() => document.querySelectorAll('#lbPlayers li').length === 3, null, { timeout: 180000 });
  console.log('lobby:', await ev(A, () => [...document.querySelectorAll('#lbPlayers li')].map((l) => l.textContent).join(' | ')));
  await shot(A, 'mp-01-lobby-host.png');
  await shot(B, 'mp-02-lobby-guest.png');

  // Tee off together.
  await A.click('#lbGo');
  for (const p of pages) await p.waitForFunction(() => window.__golf.mode === 'walk' && window.__golf.mp, null, { timeout: 300000 });
  const info = [];
  for (const p of pages) info.push(await ev(p, () => ({ slot: window.__golf.mp.slot, char: window.__golfApi.golfer.style.name, wind: window.__golf.wind.mph.toFixed(3) + '@' + window.__golf.wind.yaw.toFixed(3), ball: [window.__golf.ball.p.x.toFixed(1), window.__golf.ball.p.z.toFixed(1)] })));
  console.log('on the course:', JSON.stringify(info));
  if (new Set(info.map((x) => x.slot)).size !== 3) fail('slots should differ');
  if (new Set(info.map((x) => x.wind)).size !== 1) fail('everyone should feel the same wind');
  if (new Set(info.map((x) => x.ball.join())).size !== 3) fail('everyone should tee up on their own spot');

  for (const p of pages) {
    await p.waitForFunction(() => [...window.__golf.mp.remotes.values()].filter((r) => r.have).length === 2, null, { timeout: 180000 })
      .catch(async () => fail('not everyone appeared: ' + JSON.stringify(await Promise.all(pages.map((q) => ev(q, () => ({
        slot: window.__golf.mp && window.__golf.mp.slot, mode: window.__golf.mode, time: window.__golf.time.toFixed(1),
        remotes: window.__golf.mp ? [...window.__golf.mp.remotes.values()].map((r) => r.slot + (r.have ? '+' : '-')) : null,
        left: window.__golf.mp ? [...window.__golf.mp.players.values()].filter((x) => x.left).map((x) => x.slot) : null,
        toast: document.getElementById('toast').textContent,
      })))))));
  }
  console.log('everyone sees the other two');
  // Walk Bob and Cy towards the camera of Ann, so they're in her picture.
  await ev(A, () => { window.__golf.camYaw = 0.4; });
  await B.keyboard.down('KeyW');
  await C.keyboard.down('KeyD');
  await waitGame(A, 2);
  await B.keyboard.up('KeyW');
  await C.keyboard.up('KeyD');
  await waitGame(A, 1);
  const seen = await ev(A, () => [...window.__golf.mp.remotes.values()].map((r) => ({ name: r.name, at: r.g.slice(0, 3).map((v) => v.toFixed(1)), pose: r.msg.ps, tag: document.getElementById('mpTag' + r.slot).style.display })));
  console.log('Ann sees', JSON.stringify(seen));
  const bobAt = await ev(B, () => [window.__golf.player.x, window.__golf.player.z]);
  const bobSeen = await ev(A, () => window.__golf.mp.remotes.get(1).g);
  const lag = Math.hypot(bobAt[0] - bobSeen[0], bobAt[1] - bobSeen[2]);
  console.log('Bob is', lag.toFixed(2), 'yds from where Ann sees him');
  if (lag > 3) fail('remote golfer too far off');
  await shot(A, 'mp-03-together.png');

  // Everyone to the tee; Bob tees off and Ann watches his ball fly.
  for (const p of pages) await ev(p, () => { const api = window.__golfApi; api.teleportToBall(); api.enterShot(); });
  await waitGame(A, 1.2);
  await shot(A, 'mp-04-tee-ann.png');
  await shot(B, 'mp-05-tee-bob.png');
  await ev(B, () => window.__golfApi.swingNow(0.85, 0));
  await A.waitForFunction(() => window.__golf.mp.remotes.get(1).ballState === 'moving', null, { timeout: 180000 });
  await waitGame(A, 1.2);
  await shot(A, 'mp-06-bob-ball-in-flight.png');
  await B.waitForFunction(() => window.__golf.ballState === 'rest' || window.__golf.ballState === 'tee', null, { timeout: 480000 });
  await A.waitForFunction(() => window.__golf.mp.remotes.get(1).ballState === 'rest', null, { timeout: 180000 });
  await waitGame(A, 1);
  const bb = await ev(B, () => [window.__golf.ball.p.x, window.__golf.ball.p.z]);
  const ba = await ev(A, () => window.__golf.mp.remotes.get(1).b);
  console.log("Bob's ball came to rest; Ann sees it", Math.hypot(bb[0] - ba[0], bb[1] - ba[2]).toFixed(2), 'yds from where it is');

  // Hole out: drop each ball by the pin and putt it in.
  async function holeOut(p) {
    await ev(p, () => {
      const g = window.__golf, api = window.__golfApi, h = api.course.holes[g.hole];
      if (g.mode === 'shot') api.leaveShot();
      api.dropBall(h.pin.x + 1.2, h.pin.z + 0.6);
    });
    for (let i = 0; i < 8; i++) {
      const st = await ev(p, () => window.__golf.ballState);
      if (st === 'holed') return;
      const n = await ev(p, () => {
        const g = window.__golf, api = window.__golfApi, h = api.course.holes[g.hole];
        api.teleportToBall(); g.clubIndex = 4; api.enterShot();
        g.aimYaw = Math.atan2(h.pin.x - g.ball.p.x, -(h.pin.z - g.ball.p.z));
        const d = Math.hypot(h.pin.x - g.ball.p.x, h.pin.z - g.ball.p.z);
        const n = g.strokes;
        api.swingNow(Math.min(1, (d + 0.4) / g.puttRange), 0);
        return n;
      });
      await p.waitForFunction((n) => window.__golf.strokes > n, n, { timeout: 300000 });
      await p.waitForFunction(() => ['rest', 'holed'].includes(window.__golf.ballState), null, { timeout: 480000 });
    }
    if (await ev(p, () => window.__golf.ballState) !== 'holed') fail('could not hole out');
  }
  await holeOut(A);
  await holeOut(B);
  await A.waitForFunction(() => !document.getElementById('card').hidden, null, { timeout: 300000 });
  await A.waitForFunction(() => window.__golf.mp.players.get(1).scores[0] != null, null, { timeout: 180000 });
  await waitGame(A, 0.3);
  const wait1 = await ev(A, () => ({ sub: document.getElementById('cardSub').textContent, next: document.getElementById('cardNext').textContent, close: document.getElementById('cardClose').textContent }));
  console.log('Ann after holing out:', JSON.stringify(wait1));
  if (!/Waiting for Cy/.test(wait1.sub)) fail('should be waiting for Cy');
  await shot(A, 'mp-07-card-waiting.png');
  // Ann watches while Cy finishes; the card comes back when he's in.
  await A.click('#cardClose');
  await holeOut(C);
  await A.waitForFunction(() => !document.getElementById('card').hidden && /On to/.test(document.getElementById('cardNext').textContent), null, { timeout: 300000 });
  const rows = await ev(A, () => [...document.querySelectorAll('#cardTable tr.score')].map((r) => r.querySelector('th').textContent + ':' + r.children[1].textContent));
  console.log('card rows:', rows.join(' | '));
  if (rows.length !== 3) fail('card should have three golfers');
  await shot(A, 'mp-08-card-all-in.png');
  for (const p of pages) {
    await p.waitForFunction(() => !document.getElementById('card').hidden, null, { timeout: 300000 });
    await p.click('#cardNext');
  }
  for (const p of pages) await p.waitForFunction(() => window.__golf.hole === 1, null, { timeout: 180000 });
  const w2 = [];
  for (const p of pages) w2.push(await ev(p, () => window.__golf.wind.mph.toFixed(3)));
  console.log('hole 2 wind:', w2.join(' / '));
  if (new Set(w2).size !== 1) fail('hole 2 wind should match');

  // Cy leaves; then the host goes and Bob carries on alone.
  await ev(C, () => window.__golfApi.showCard(false));
  await C.click('#cardLeave');
  await C.waitForFunction(() => window.__golf.mode === 'title' && !window.__golf.mp, null, { timeout: 180000 });
  await A.waitForFunction(() => window.__golf.mp.players.get(2).left, null, { timeout: 180000 });
  await waitGame(A, 0.6);
  console.log('Ann after Cy left:', await ev(A, () => document.getElementById('mpList').textContent), '| toast:', await ev(A, () => document.getElementById('toast').textContent));
  await shot(A, 'mp-09-cy-left.png');
  await ev(A, () => window.__golfApi.backToTitle());
  await B.waitForFunction(() => window.__golf.mp && window.__golf.mp.players.get(0).left, null, { timeout: 180000 });
  console.log('Bob after the host left:', await ev(B, () => document.getElementById('toast').textContent), '| remotes', await ev(B, () => window.__golf.mp.remotes.size), '| mode', await ev(B, () => window.__golf.mode));
  await shot(B, 'mp-10-bob-alone.png');

  await browser.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('online test passed');
})().catch(async (e) => { console.error('FAILED:', e.message); if (errors.length) console.log(errors.join('\n')); process.exit(1); });
