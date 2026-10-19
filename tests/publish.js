// Workshop "Commit to project" against a mock of GitHub's REST API: replaces
// assets, commits them (surviving a concurrent push), resets one back to
// built-in (deleting its file), and checks a rejected token is explained.
// Usage: node tests/publish.js [outDir]
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || path.join(__dirname, '..', 'tmp-shots');
fs.mkdirSync(out, { recursive: true });
const TOKEN = 'github_pat_TEST_TOKEN_123';

// ---- a tiny in-memory GitHub: trees are flat maps of path -> blob sha ----
const gh = {
  defaultBranch: 'main',
  refs: { main: 'c0' },
  commits: { c0: { tree: 't0', parents: [], message: 'initial' } },
  trees: { t0: { 'README.md': 'b-readme', 'assets/README.md': 'b-assets-readme', 'assets/tex-flag.jpg': 'b-flag-jpg', 'Golf.html': 'b-golf' } },
  blobs: {},
  requests: [],
  failNextPatch: false,
};
let seq = 0;
const blobSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
function listing(treeId, dir) {
  const flat = gh.trees[treeId], seen = new Set(), entries = [];
  for (const [p, sha] of Object.entries(flat)) {
    if (dir && !p.startsWith(dir + '/')) continue;
    const rest = dir ? p.slice(dir.length + 1) : p;
    const [head, ...more] = rest.split('/');
    if (more.length) { if (!seen.has(head)) { seen.add(head); entries.push({ path: head, mode: '040000', type: 'tree', sha: `${treeId}~${dir ? dir + '.' : ''}${head}` }); } }
    else entries.push({ path: head, mode: '100644', type: 'blob', sha });
  }
  return { sha: dir ? `${treeId}~${dir}` : treeId, tree: entries, truncated: false };
}
function handle(method, url, body) {
  const m = url.match(/^\/repos\/test\/Golf(\/.*)?$/);
  if (!m) return [404, { message: 'Not Found' }];
  const p = m[1] || '';
  if (method === 'GET' && p === '') return [200, { full_name: 'test/Golf', default_branch: gh.defaultBranch }];
  let r;
  if (method === 'GET' && (r = p.match(/^\/git\/ref\/heads\/(.+)$/))) {
    const b = decodeURIComponent(r[1]);
    return gh.refs[b] ? [200, { ref: 'refs/heads/' + b, object: { sha: gh.refs[b], type: 'commit' } }] : [404, { message: 'Not Found' }];
  }
  if (method === 'GET' && (r = p.match(/^\/git\/commits\/(\w+)$/))) return [200, { sha: r[1], tree: { sha: gh.commits[r[1]].tree } }];
  if (method === 'GET' && (r = p.match(/^\/git\/trees\/([^/]+)$/))) {
    const [id, dir] = decodeURIComponent(r[1]).split('~');
    return [200, listing(id, dir ? dir.replace(/\./g, '/') : '')];
  }
  if (method === 'POST' && p === '/git/blobs') {
    const buf = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8');
    const sha = blobSha(buf);
    gh.blobs[sha] = buf;
    return [201, { sha }];
  }
  if (method === 'POST' && p === '/git/trees') {
    const flat = Object.assign({}, gh.trees[body.base_tree]);
    for (const e of body.tree) { if (e.sha === null) delete flat[e.path]; else flat[e.path] = e.sha; }
    const id = 't' + (++seq);
    gh.trees[id] = flat;
    return [201, { sha: id }];
  }
  if (method === 'POST' && p === '/git/commits') {
    const id = 'c' + (++seq);
    gh.commits[id] = { tree: body.tree, parents: body.parents, message: body.message };
    return [201, { sha: id, html_url: `https://github.com/test/Golf/commit/${id}` }];
  }
  if (method === 'PATCH' && (r = p.match(/^\/git\/refs\/heads\/(.+)$/))) {
    const b = decodeURIComponent(r[1]);
    if (gh.failNextPatch) {
      // Someone else pushed first: move the branch on and refuse this update.
      gh.failNextPatch = false;
      const t = 't' + (++seq);
      gh.trees[t] = Object.assign({}, gh.trees[gh.commits[gh.refs[b]].tree], { 'src/other.js': 'b-other' });
      const c = 'c' + (++seq);
      gh.commits[c] = { tree: t, parents: [gh.refs[b]], message: 'someone else' };
      gh.refs[b] = c;
    }
    if (gh.commits[body.sha].parents[0] !== gh.refs[b]) return [422, { message: 'Update is not a fast forward' }];
    gh.refs[b] = body.sha;
    return [200, { object: { sha: body.sha } }];
  }
  return [404, { message: 'Not Found' }];
}
const headTree = () => gh.trees[gh.commits[gh.refs.main].tree];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|422)/.test(m.text())) errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE', 'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version' } });
      return;
    }
    const u = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    gh.requests.push({ method: req.method(), path: u.pathname, auth: req.headers().authorization, body: req.postData() || '' });
    const [status, json] = req.headers().authorization === 'Bearer ' + TOKEN ? handle(req.method(), u.pathname, body) : [401, { message: 'Bad credentials' }];
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) });
  });
  await page.goto('file://' + path.join(__dirname, '..', 'Golf.html') + '?hq&dtcap=0.12');
  await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 120000 });
  const G = (fn, a) => page.evaluate(fn, a);
  const frames = (n) => G((n) => new Promise((res) => { let k = 0; (function f() { if (++k >= n) res(); else requestAnimationFrame(f); })(); }), n);
  const click = (sel) => G((sel) => document.querySelector(sel).click(), sel);
  const statusOf = (id) => G((id) => document.getElementById(id).textContent, id);
  let failed = 0;
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

  // Built-in versions of a few assets, to load back as "edited" files.
  async function exported(id) {
    const r = await G(async (id) => {
      const f = await window.__golfAssets.download(id);
      const buf = new Uint8Array(await f.data.arrayBuffer());
      let s = ''; for (const c of buf) s += String.fromCharCode(c);
      return { name: f.filename, b64: btoa(s) };
    }, id);
    const file = path.join(out, 'pub-' + r.name);
    fs.writeFileSync(file, Buffer.from(r.b64, 'base64'));
    return file;
  }
  await G(() => window.__golfApi.openWorkshop());
  await page.waitForFunction(() => !document.getElementById('workshop').hidden);
  const oak = await exported('tree-oak'), tee = await exported('tee-marker'), flag = await exported('tex-flag');
  async function replace(id, file) {
    await click(`.ws-item[data-id="${id}"]`);
    await page.setInputFiles('#wsFileInput', file);
    await page.waitForFunction(() => /Using|didn/.test(document.getElementById('wsStatus').textContent), null, { timeout: 60000 });
  }
  await replace('tree-pine', oak);
  await replace('tee-marker', tee);
  await replace('tex-flag', flag);
  check((await statusOf('wsCommitOpen')) === 'Commit to project (3)', 'commit button counts 3 pending changes');

  // First commit: fill in the connection, and have someone else push meanwhile.
  await click('#wsCommitOpen');
  await G((t) => {
    document.getElementById('wsGhRepo').value = 'test/Golf';
    document.getElementById('wsGhToken').value = t;
  }, TOKEN);
  await frames(3);
  await page.screenshot({ path: path.join(out, 'pub-1-dialog.png') });
  gh.failNextPatch = true;
  await click('#wsCommitGo');
  await page.waitForFunction(() => /Committed|said|couldn|token/i.test(document.getElementById('wsCommitStatus').textContent), null, { timeout: 60000 });
  console.log('status:', await statusOf('wsCommitStatus'));
  let t = headTree();
  check(gh.blobs[t['assets/tree-pine.glb']] && gh.blobs[t['assets/tree-pine.glb']].subarray(0, 4).toString() === 'glTF', 'assets/tree-pine.glb is a .glb');
  check(fs.readFileSync(oak).equals(gh.blobs[t['assets/tree-pine.glb']]), 'tree-pine.glb holds the uploaded bytes');
  check(!!t['assets/tee-marker.glb'], 'assets/tee-marker.glb added');
  check(!!t['assets/tex-flag.png'] && !t['assets/tex-flag.jpg'], 'tex-flag.png added and the old tex-flag.jpg removed');
  check(t['src/other.js'] === 'b-other' && t['assets/README.md'] && t['README.md'], 'the concurrent push and other files are kept');
  const head = gh.commits[gh.refs.main];
  check(/^Workshop: replace tee-marker, tex-flag, tree-pine\n/.test(head.message), 'commit message: ' + head.message.split('\n')[0]);
  check(/releases\/download\/build\/Golf\.html/.test(await G(() => document.getElementById('wsCommitStatus').innerHTML)), 'status links to the release download');
  check((await statusOf('wsCommitOpen')) === 'Commit to project', 'nothing pending after the commit');
  await click('#wsCommitClose');
  await click('.ws-item[data-id="tree-pine"]');
  check(/committed/i.test(await statusOf('wsBadge')), 'tree-pine shows as committed');

  // Reset a committed asset to built-in: its file goes on the next commit.
  await click('.ws-item[data-id="tee-marker"]');
  await click('#wsReset');
  await page.waitForFunction(() => /Back to the built-in/.test(document.getElementById('wsStatus').textContent));
  check((await statusOf('wsCommitOpen')) === 'Commit to project (1)', 'reset of a committed asset is pending');
  await click('#wsCommitOpen');
  // A bad token is explained, and nothing is written.
  await G(() => { document.getElementById('wsGhToken').value = 'nope'; });
  const before = gh.refs.main;
  await click('#wsCommitGo');
  await page.waitForFunction(() => /token/i.test(document.getElementById('wsCommitStatus').textContent), null, { timeout: 60000 });
  check(/didn’t accept the token/.test(await statusOf('wsCommitStatus')) && gh.refs.main === before, 'bad token: ' + (await statusOf('wsCommitStatus')));
  await G((t) => { document.getElementById('wsGhToken').value = t; }, TOKEN);
  await click('#wsCommitGo');
  await page.waitForFunction(() => /Committed/.test(document.getElementById('wsCommitStatus').textContent), null, { timeout: 60000 });
  t = headTree();
  check(!t['assets/tee-marker.glb'] && !!t['assets/tree-pine.glb'], 'tee-marker.glb deleted, tree-pine.glb kept');
  await frames(2);
  await page.screenshot({ path: path.join(out, 'pub-2-committed.png') });

  // Gameplay settings go to the project as assets/gameplay.json.
  await click('.ws-item[data-id="gameplay"]');
  await G(() => { const r = document.querySelector('.ws-tune[data-key="wind"] input[type=range]'); r.value = 1.5; r.dispatchEvent(new Event('input')); });
  check((await statusOf('wsCommitOpen')) === 'Commit to project (1)', 'a changed gameplay setting is pending');
  await click('#wsCommitOpen');
  await click('#wsCommitGo');
  await page.waitForFunction(() => /Committed/.test(document.getElementById('wsCommitStatus').textContent), null, { timeout: 60000 });
  t = headTree();
  const gp = t['assets/gameplay.json'] && JSON.parse(gh.blobs[t['assets/gameplay.json']].toString());
  check(gp && gp.wind === 1.5 && Object.keys(gp).length === 1, 'assets/gameplay.json holds the changed setting: ' + JSON.stringify(gp));
  check((await statusOf('wsCommitOpen')) === 'Commit to project', 'nothing pending after committing the settings');
  await click('#wsCommitClose');

  // The token only ever travels in the Authorization header.
  check(gh.requests.every((r) => !r.body.includes(TOKEN)), 'token never appears in a request body');
  check(gh.requests.filter((r) => r.auth === 'Bearer ' + TOKEN).length > 0, 'requests carry the token as a Bearer header');
  // Settings survive a reload; pending changes stay committed.
  await page.reload();
  await page.waitForFunction(() => window.__golfApi && window.__golf.mode === 'title', null, { timeout: 120000 });
  const after = await G(() => ({ repo: JSON.parse(localStorage.getItem('pinehaven-github')).repo, pending: window.__golfAssets.pending().length }));
  check(after.repo === 'test/Golf' && after.pending === 0, 'connection remembered and nothing pending after reload');

  console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
