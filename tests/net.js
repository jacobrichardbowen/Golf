// Online play's message layer on its own (no 3D, takes seconds): a host and
// three would-be guests in bare pages with PeerJS and src/js/net.js. Checks
// joining, the three-golfer limit, relaying with the sender stamped, someone
// leaving, and the host going.
// Needs a PeerJS server: run `npx peer --port 9000` (or set PEER=host:port).
// Usage: node tests/net.js
const path = require('path');
const fs = require('fs');
const os = require('os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const PEER = process.env.PEER || '127.0.0.1:9000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Ask again and again (up to 15 s) until the answer is true.
async function soon(fn) {
  for (const t0 = Date.now(); Date.now() - t0 < 15000; await sleep(200)) if (await fn()) return true;
  return false;
}
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-net-'));
  const src = (f) => 'file://' + path.join(__dirname, '..', f);
  const page = path.join(dir, 'net.html');
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><script src="${src('vendor/peerjs.min.js')}"></script><script src="${src('src/js/net.js')}"></script>
<script>window.NetT = Net; window.heard = [];
for (const t of ['lobby', 'start', 'st', 'score', 'left', 'hostgone']) Net.on(t, (m) => heard.push(Object.assign({ type: t }, m)));</script>`);
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const P = [];
  for (let i = 0; i < 4; i++) {
    const p = await (await browser.newContext()).newPage();
    p.on('pageerror', (e) => { console.log(`[page ${i}]`, e.message); failed++; });
    await p.goto('file://' + page + '?peer=' + encodeURIComponent(PEER));
    P.push(p);
  }
  const heard = (i) => P[i].evaluate(() => window.heard);

  const code = await P[0].evaluate(() => window.NetT.host({ char: 0, name: 'Ann' }));
  check(/^[A-Z]{4}$/.test(code), `host gets a code (${code})`);
  const joins = [];
  for (let i = 1; i < 4; i++) {
    joins.push(await P[i].evaluate(([c, n]) => window.NetT.join(c.toLowerCase(), { char: 1, name: n }).then((s) => 'slot ' + s, (e) => String(e)), [code, ['', 'Bob', 'Cy', 'Dee'][i]]));
  }
  check(joins[0] === 'slot 1' && joins[1] === 'slot 2', `two guests join (${joins[0]}, ${joins[1]})`);
  check(/three players/.test(joins[2]), `a fourth is turned away (${joins[2]})`);
  const lineup = () => P[2].evaluate(() => window.NetT.players.map((p) => p.name).join(','));
  await soon(async () => (await lineup()) === 'Ann,Bob,Cy');
  const names = await lineup();
  check(names === 'Ann,Bob,Cy', `everyone sees the line-up (${names})`);

  await P[1].evaluate(() => window.NetT.setMe({ char: 2, name: 'Bobby<b>' }));
  await soon(() => P[0].evaluate(() => window.NetT.players.find((p) => p.slot === 1).char === 2));
  const bob = await P[0].evaluate(() => window.NetT.players.find((p) => p.slot === 1));
  check(bob.char === 2 && bob.name === 'Bobbyb', `a guest changes golfer and name, cleaned (${bob.name})`);

  await P[0].evaluate(() => window.NetT.start(1234));
  await P[1].evaluate(() => window.NetT.send({ t: 'st', x: 1 }));
  await P[2].evaluate(() => window.NetT.send({ t: 'score', h: 0, n: 4, s: 0 })); // claims to be the host
  await P[1].evaluate(() => window.NetT.send({ t: 'start', seed: 666 })); // only the host may start
  await soon(async () => (await heard(0)).some((m) => m.type === 'st') && (await heard(2)).some((m) => m.type === 'st') && (await heard(1)).some((m) => m.type === 'score'));
  await sleep(500); // and anything that shouldn't arrive has had its chance
  const h0 = await heard(0), h1 = await heard(1), h2 = await heard(2);
  check(h1.some((m) => m.type === 'start' && m.seed === 1234) && h2.some((m) => m.type === 'start' && m.seed === 1234), 'guests hear the start and its seed');
  check(!h0.concat(h2).some((m) => m.type === 'start' && m.seed === 666), "a guest can't start the round");
  check(h0.some((m) => m.type === 'st' && m.s === 1) && h2.some((m) => m.type === 'st' && m.s === 1), "Bob's position reaches the host and Cy, stamped as his");
  check(h1.some((m) => m.type === 'score' && m.s === 2), 'a score is stamped with its real sender');
  check(!h1.some((m) => m.type === 'st'), "nobody hears their own messages back");

  await P[2].evaluate(() => window.NetT.leave());
  const told = async () => (await heard(0)).some((m) => m.type === 'left' && m.s === 2) && (await heard(1)).some((m) => m.type === 'left' && m.s === 2);
  check(await soon(told), 'when Cy leaves, the others are told');

  await P[0].evaluate(() => window.NetT.leave());
  check(await soon(async () => (await heard(1)).some((m) => m.type === 'hostgone')), 'when the host leaves, Bob is told');
  check(!(await P[1].evaluate(() => window.NetT.active)), "and Bob's connection is closed");

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'net test passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
