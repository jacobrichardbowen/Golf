// ---------------------------------------------------------------------------
// Commit Workshop changes to the game's GitHub repository, so the next build
// of Golf.html includes them for everyone. Files go to assets/<asset-id>.<ext>
// as a single commit on the chosen branch (the repository's default branch
// unless one is set); a GitHub Action then rebuilds Golf.html.
//
// Uses GitHub's REST API with a fine-grained personal access token that the
// player pastes into the Workshop once (kept in this browser's storage).
// ---------------------------------------------------------------------------

const Publish = (() => {
  const KEY = 'pinehaven-github';
  const API = 'https://api.github.com';
  const ASSET_DIR = 'assets';

  function settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* storage unavailable */ }
    return { repo: s.repo || window.__PINEHAVEN_REPO || '', branch: s.branch || '', token: s.token || '' };
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify({ repo: s.repo, branch: s.branch, token: s.token })); } catch (e) { /* storage unavailable */ }
  }
  function forgetToken() { save(Object.assign(settings(), { token: '' })); }

  function b64(buf) {
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function gh(s, method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: Object.assign({
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + s.token,
          'X-GitHub-Api-Version': '2022-11-28',
        }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error('Couldn’t reach GitHub from here. In the claude.ai viewer, open the downloaded Golf.html instead, or use Export my assets and send the pack to Claude.');
      err.offline = true;
      throw err;
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) { /* not JSON */ }
    const err = new Error(msg || 'GitHub returned ' + res.status);
    err.status = res.status;
    throw err;
  }

  // Turn an API failure into something a player can act on.
  function explain(e, s, branch) {
    if (e.offline) return e.message;
    if (e.status === 401) return 'GitHub didn’t accept the token. Check it’s pasted in full and hasn’t expired.';
    if (e.status === 403 && /rate limit/i.test(e.message)) return 'GitHub’s rate limit was hit. Try again in a few minutes.';
    if (e.status === 403) return `That token can’t write to ${s.repo}. Give it “Contents: Read and write” for this repository.`;
    if (e.status === 404 && e.where === 'branch') return `There’s no branch called “${branch}” in ${s.repo}.`;
    if (e.status === 404) return `Couldn’t find ${s.repo}, or the token can’t see it. Check the repository name and that the token covers it.`;
    return 'GitHub said: ' + e.message;
  }

  const refPath = (branch) => branch.split('/').map(encodeURIComponent).join('/');
  const stem = (name) => name.replace(/\.[^.]+$/, '');

  function defaultMessage(changes) {
    const writes = changes.filter((c) => c.kind === 'write').map((c) => c.id);
    const removes = changes.filter((c) => c.kind === 'remove').map((c) => c.id);
    const parts = [];
    if (writes.length) parts.push('replace ' + writes.join(', '));
    if (removes.length) parts.push('reset ' + removes.join(', ') + ' to built-in');
    return 'Workshop: ' + parts.join('; ');
  }

  // changes: [{ id, kind: 'write', ext, data } | { id, kind: 'remove' }]
  // Resolves { sha, url, branch, isDefault } or { upToDate: true, branch }.
  async function commit(changes, opts = {}, progress = () => {}) {
    const s = settings();
    if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo)) throw new Error('Enter the repository as owner/name, e.g. jacobrichardbowen/Golf.');
    if (!s.token) throw new Error('Paste a GitHub access token first (see GitHub connection).');
    if (!changes.length) return { upToDate: true, branch: s.branch };
    let branch = s.branch;
    try {
      progress('Connecting to GitHub…');
      const repo = await gh(s, 'GET', `/repos/${s.repo}`);
      branch = branch || repo.default_branch;
      const R = `/repos/${s.repo}`;
      const message = (opts.message || defaultMessage(changes)) + '\n\nCommitted from the Pinehaven Golf Workshop.';
      const blobs = new Map(); // id -> blob sha, reused if we have to retry
      for (let attempt = 0; ; attempt++) {
        let ref;
        try { ref = await gh(s, 'GET', `${R}/git/ref/heads/${refPath(branch)}`); } catch (e) { e.where = 'branch'; throw e; }
        const tip = ref.object.sha;
        const tipCommit = await gh(s, 'GET', `${R}/git/commits/${tip}`);
        const root = await gh(s, 'GET', `${R}/git/trees/${tipCommit.tree.sha}`);
        const dir = root.tree.find((e) => e.path === ASSET_DIR && e.type === 'tree');
        const existing = dir ? (await gh(s, 'GET', `${R}/git/trees/${dir.sha}`)).tree.filter((e) => e.type === 'blob') : [];
        const entries = [];
        for (const c of changes) {
          const mine = existing.filter((e) => stem(e.path) === c.id);
          const path = c.kind === 'write' ? `${c.id}.${c.ext}` : null;
          if (c.kind === 'write') {
            if (!blobs.has(c.id)) {
              progress(`Uploading ${c.id}…`);
              blobs.set(c.id, (await gh(s, 'POST', `${R}/git/blobs`, { content: b64(c.data), encoding: 'base64' })).sha);
            }
            const cur = mine.find((e) => e.path === path);
            if (!cur || cur.sha !== blobs.get(c.id)) entries.push({ path: `${ASSET_DIR}/${path}`, mode: '100644', type: 'blob', sha: blobs.get(c.id) });
          }
          // A replaced or reset asset keeps no other files under its name.
          for (const e of mine) if (e.path !== path) entries.push({ path: `${ASSET_DIR}/${e.path}`, mode: '100644', type: 'blob', sha: null });
        }
        if (!entries.length) return { upToDate: true, branch, isDefault: branch === repo.default_branch };
        progress('Committing…');
        const tree = await gh(s, 'POST', `${R}/git/trees`, { base_tree: tipCommit.tree.sha, tree: entries });
        const made = await gh(s, 'POST', `${R}/git/commits`, { message, tree: tree.sha, parents: [tip] });
        try {
          await gh(s, 'PATCH', `${R}/git/refs/heads/${refPath(branch)}`, { sha: made.sha });
        } catch (e) {
          // Someone (or the rebuild) pushed in the meantime: start again from the new tip.
          if (e.status === 422 && attempt < 3) continue;
          throw e;
        }
        return { sha: made.sha, url: made.html_url, branch, isDefault: branch === repo.default_branch };
      }
    } catch (e) {
      throw new Error(explain(e, s, branch));
    }
  }

  // Where people can download the latest build (published by the rebuild Action).
  const downloadUrl = (repo) => `https://github.com/${repo}/releases/download/build/Golf.html`;
  const actionsUrl = (repo) => `https://github.com/${repo}/actions`;

  return { settings, save, forgetToken, commit, defaultMessage, downloadUrl, actionsUrl };
})();
