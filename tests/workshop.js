// Workshop round trip: open the Workshop, download built-in models, load one
// back in place of another (as a player would after editing it in Blender),
// reload, and check the game uses it. Then reset everything.
// Usage: node tests/workshop.js [outDir]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const url = 'file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=0.12';
  const ready = () => page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 120000 });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: path.join(out, name), timeout: 180000 });
  const frames = (n) => G((n) => new Promise((res) => { let k = 0; (function f() { if (++k >= n) res(); else requestAnimationFrame(f); })(); }), n);

  await page.goto(url);
  await ready();
  await page.click('#workshopBtn');
  await page.waitForFunction(() => !document.getElementById('workshop').hidden, null, { timeout: 60000 });
  const count = await G(() => document.querySelectorAll('.ws-item').length);
  console.log('assets listed:', count, await G(() => [...document.querySelectorAll('.ws-list h3')].map((h) => h.textContent).join(', ')));
  // Let the thumbnails render (one per frame).
  await frames(count + 4);
  await shot('w1-workshop.png');

  async function download(id) {
    await page.click(`.ws-item[data-id="${id}"]`);
    await frames(2);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#wsDownload')]);
    const file = path.join(out, dl.suggestedFilename());
    await dl.saveAs(file);
    const head = fs.readFileSync(file).subarray(0, 4).toString('latin1');
    console.log(`downloaded ${id} -> ${dl.suggestedFilename()} (${fs.statSync(file).size} bytes, magic ${JSON.stringify(head)})`);
    return file;
  }
  async function replace(id, file) {
    await page.click(`.ws-item[data-id="${id}"]`);
    await frames(2);
    await page.setInputFiles('#wsFileInput', file);
    await page.waitForFunction(() => /Using|didn/.test(document.getElementById('wsStatus').textContent), null, { timeout: 60000 });
    console.log(`replace ${id}:`, await G(() => document.getElementById('wsStatus').textContent));
  }

  // Rewrite node names inside a .glb (to mimic what Blender does to duplicates).
  function renameNodes(file, fn) {
    const b = fs.readFileSync(file);
    const jsonLen = b.readUInt32LE(12);
    const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
    json.nodes.forEach((n) => { if (n.name) n.name = fn(n.name, n); });
    let text = Buffer.from(JSON.stringify(json), 'utf8');
    if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
    const rest = b.subarray(20 + jsonLen);
    const head = Buffer.alloc(20);
    head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8);
    head.writeUInt32LE(text.length, 12); head.write('JSON', 16);
    const outFile = file.replace(/\.glb$/, '-renamed.glb');
    fs.writeFileSync(outFile, Buffer.concat([head, text, rest]));
    return outFile;
  }

  const oak = await download('tree-oak');
  const golferGlb = await download('golfer');
  const cart = await download('golf-cart');
  const grass = await download('tex-grass');
  // A pine tree that is really the oak, a golfer and cart that went through glTF and back.
  await replace('tree-pine', oak);
  await replace('golfer', golferGlb);
  await replace('golf-cart', cart);
  // A golfer whose joints all came back from Blender as "name.001".
  const JOINTS = ['hips', 'thigh.L', 'knee.L', 'ankle.L', 'thigh.R', 'knee.R', 'ankle.R', 'spine', 'neck', 'head', 'shoulders', 'swing', 'arm.L', 'elbow.L', 'arm.R', 'elbow.R'];
  const renamed = renameNodes(golferGlb, (n, node) => (JOINTS.includes(n) && node.mesh === undefined ? n + '.001' : n));
  await replace('golfer', renamed);
  const rig = await G(() => [...window.__golfAssets.rigParts('golfer')].map(([k, v]) => `${k}:${v.length}`).join(' '));
  console.log('rig joints after Blender-style rename:', rig);
  await page.click('.ws-item[data-id="golfer"]');
  await frames(6);
  await shot('w2-golfer-replaced.png');
  await page.click('.ws-item[data-id="tex-grass"]');
  await frames(3);
  await shot('w3-texture.png');

  // Export a pack.
  const [pack] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#wsExport')]);
  const packFile = path.join(out, pack.suggestedFilename());
  await pack.saveAs(packFile);
  const packJson = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  console.log('exported pack:', packJson.format, packJson.assets.map((a) => a.id).join(', '));

  // Done reloads the game with the custom assets.
  await page.click('#wsDone');
  await page.waitForEvent('load', { timeout: 120000 });
  await ready();
  const custom = await G(() => ['tree-pine', 'golfer', 'golf-cart', 'tree-oak'].map((id) => `${id}:${window.__golfAssets.isCustom(id)}`).join(' '));
  console.log('after reload:', custom);
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__golf.mode === 'select', null, { timeout: 120000 });
  await G(() => window.__golfApi.confirmSelect());
  await page.waitForFunction(() => window.__golf.mode === 'walk', null, { timeout: 120000 });
  await G(() => { const c = window.__golfApi.cart.st; window.__golfApi.placePlayer(c.x - 3, c.z + 4, Math.atan2(3, -4)); });
  await frames(8);
  await shot('w4-game-custom.png');

  // Reset everything through the Workshop.
  await G(() => { window.__golf.mode = 'title'; });
  await page.evaluate(() => window.__golfApi.openWorkshop());
  for (const id of ['tree-pine', 'golfer', 'golf-cart']) {
    await page.click(`.ws-item[data-id="${id}"]`);
    await page.click('#wsReset');
    await page.waitForFunction(() => /Back to the built-in/.test(document.getElementById('wsStatus').textContent), null, { timeout: 30000 });
  }
  // Import the pack back, then reset again: exercises the import path.
  await page.setInputFiles('#wsImport', packFile);
  await page.waitForFunction(() => /Imported|Could not/.test(document.getElementById('wsStatus').textContent), null, { timeout: 60000 });
  console.log('import:', await G(() => document.getElementById('wsStatus').textContent));
  for (const id of ['tree-pine', 'golfer', 'golf-cart']) {
    await page.click(`.ws-item[data-id="${id}"]`);
    await page.click('#wsReset');
    await page.waitForFunction(() => /Back to the built-in/.test(document.getElementById('wsStatus').textContent), null, { timeout: 30000 });
  }
  const left = await G(() => window.__golfAssets.list().filter((d) => window.__golfAssets.isCustom(d.id)).map((d) => d.id));
  console.log('custom after reset:', left.length ? left.join(', ') : 'none');
  console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
