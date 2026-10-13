// ---------------------------------------------------------------------------
// DOM side of the game: HUD plates, shot hints, prompts, world markers,
// radar minimap, course map, toasts, banner, scorecard and screens.
// ---------------------------------------------------------------------------

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const cache = new Map();
  function text(id, v) {
    v = String(v);
    if (cache.get(id) === v) return;
    cache.set(id, v);
    $(id).textContent = v;
  }
  function html(id, v) {
    if (cache.get(id) === v) return;
    cache.set(id, v);
    $(id).innerHTML = v;
  }

  const fmtToPar = (d) => (d === 0 ? 'E' : d > 0 ? '+' + d : '−' + -d);
  const fmtYds = (y) => Math.round(y).toLocaleString('en-US');

  // ---------- HUD ----------
  let mode = '';
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    $('hud').dataset.mode = m;
  }
  function setHole(num, hole) {
    text('hHole', num);
    text('hName', hole.name);
    text('hPar', hole.par);
    text('hYards', hole.yards);
  }
  function setStroke(n) { text('hStroke', n); }
  function setTotal(toPar, played) {
    const el = $('hTotal');
    text('hTotal', played ? fmtToPar(toPar) : 'E');
    el.classList.toggle('under', played && toPar < 0);
  }
  function setClub(name, dist) { text('clubName', name); text('clubDist', dist); }
  function setFacts(toPin, lie) { text('toPin', toPin); text('lie', lie); }
  function objective(h) { html('objective', h); }
  function prompt(h) {
    const el = $('prompt');
    if (!h) { el.hidden = true; return; }
    html('prompt', h);
    el.hidden = false;
  }
  function setActionLabel(t) {
    text('actBtn', t || 'Action');
    $('actBtn').classList.toggle('ready', !!t);
  }

  // ---------- Shot hint ----------
  function setHint(h) { html('meterHint', h); }

  // ---------- World markers ----------
  // Places a marker at a projected screen position; off-screen targets are
  // pinned to the screen edge with an arrow pointing towards them.
  function marker(id, sx, sy, behind, visible, label, w, h) {
    const el = $(id);
    if (!visible) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    if (el.style.display !== 'block') el.style.display = 'block';
    const m = 46;
    let x = sx, y = sy, off = false;
    if (behind) { x = w - x; y = h - y; }
    if (behind || x < m || x > w - m || y < m + 40 || y > h - m) {
      off = true;
      const cx = w / 2, cy = h / 2;
      let dx = x - cx, dy = y - cy;
      if (behind && Math.abs(dy) < 1) dy = 1;
      const s = Math.min((w / 2 - m) / Math.max(Math.abs(dx), 1e-3), (h / 2 - m - 20) / Math.max(Math.abs(dy), 1e-3));
      x = cx + dx * s; y = cy + dy * s;
      el.style.setProperty('--ang', Math.atan2(dy, dx) + 'rad');
    }
    el.classList.toggle('off', off);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const span = el.querySelector('span');
    if (span.textContent !== label) span.textContent = label;
  }

  // ---------- Toast / banner ----------
  let toastTimer = 0;
  function toast(main, sub, ms, bad) {
    const el = $('toast');
    el.innerHTML = main + (sub ? `<small>${sub}</small>` : '');
    el.classList.toggle('bad', !!bad);
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ms || 2200);
  }
  function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; }
  let bannerTimer = 0;
  function banner(inner, cls, ms) {
    const el = $('banner');
    el.className = 'banner ' + (cls || '');
    el.innerHTML = inner;
    el.hidden = false;
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => (el.hidden = true), ms);
  }
  function hideBanner() { clearTimeout(bannerTimer); $('banner').hidden = true; }

  // ---------- Screens ----------
  function show(id, on) { $(id).hidden = !on; }
  function isShown(id) { return !$(id).hidden; }

  // ---------- Scorecard ----------
  function scoreMark(s, par) {
    if (s == null) return '';
    const d = s - par;
    const cls = d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
    return cls ? `<span class="mk ${cls}">${s}</span>` : `<span class="mk">${s}</span>`;
  }
  function renderCard(holes, scores, current, opts) {
    const cols = holes.map((_, i) => i);
    const parTot = holes.reduce((a, h) => a + h.par, 0);
    const ydTot = holes.reduce((a, h) => a + h.yards, 0);
    const played = scores.filter((s) => s != null);
    const scoreTot = played.reduce((a, s) => a + s, 0);
    const parPlayed = holes.reduce((a, h, i) => a + (scores[i] != null ? h.par : 0), 0);
    let toPar = 0;
    const rel = cols.map((i) => {
      if (scores[i] == null) return '';
      toPar += scores[i] - holes[i].par;
      return fmtToPar(toPar);
    });
    const cur = (i) => (i === current ? ' class="cur"' : '');
    let t = '<thead><tr><th scope="row">Hole</th>' + cols.map((i) => `<th${cur(i)}>${i + 1}</th>`).join('') + '<th class="tot">Out</th></tr></thead><tbody>';
    t += '<tr class="yards"><th scope="row">Yards</th>' + cols.map((i) => `<td>${holes[i].yards}</td>`).join('') + `<td class="tot">${fmtYds(ydTot)}</td></tr>`;
    t += '<tr><th scope="row">Par</th>' + cols.map((i) => `<td>${holes[i].par}</td>`).join('') + `<td class="tot">${parTot}</td></tr>`;
    t += '<tr class="score"><th scope="row">Score</th>' + cols.map((i) => `<td${cur(i)}>${scoreMark(scores[i], holes[i].par)}</td>`).join('') + `<td class="tot">${played.length ? scoreTot : ''}</td></tr>`;
    t += '<tr><th scope="row">To par</th>' + cols.map((i) => {
      const r = rel[i];
      return `<td class="${r && r.startsWith('−') ? 'under' : ''}">${r}</td>`;
    }).join('') + `<td class="tot">${played.length ? fmtToPar(scoreTot - parPlayed) : ''}</td></tr>`;
    t += '</tbody>';
    $('cardTable').innerHTML = t;
    text('cardTitle', opts.title);
    text('cardSub', played.length ? `${scoreTot} strokes · ${fmtToPar(scoreTot - parPlayed)}` : `Par ${parTot} · ${fmtYds(ydTot)} yards`);
    $('cardNext').hidden = !opts.next;
    if (opts.next) $('cardNext').textContent = opts.next;
    $('cardClose').hidden = !opts.closable;
  }

  // ---------- Radar minimap & course map ----------
  let overview = null, bounds = null;
  function setOverview(canvas, b) { overview = canvas; bounds = b; }

  function drawIcon(g, kind, x, y, d, ang) {
    g.save();
    g.translate(x, y);
    if (kind === 'player') {
      g.rotate(ang);
      g.fillStyle = '#f2c230'; g.strokeStyle = '#0b1a12'; g.lineWidth = 1.5 * d;
      g.beginPath(); g.moveTo(0, -7 * d); g.lineTo(5 * d, 5 * d); g.lineTo(0, 2.5 * d); g.lineTo(-5 * d, 5 * d); g.closePath();
      g.fill(); g.stroke();
    } else if (kind === 'ball') {
      g.fillStyle = '#ffffff'; g.strokeStyle = '#0b1a12'; g.lineWidth = 1.3 * d;
      g.beginPath(); g.arc(0, 0, 3.2 * d, 0, TAU); g.fill(); g.stroke();
    } else if (kind === 'pin') {
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.2 * d;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -10 * d); g.stroke();
      g.fillStyle = '#f2c230';
      g.beginPath(); g.moveTo(0, -10 * d); g.lineTo(7 * d, -7.5 * d); g.lineTo(0, -5 * d); g.fill();
    } else if (kind === 'cart') {
      g.rotate(ang);
      g.fillStyle = '#f1ede2'; g.strokeStyle = '#1d5537'; g.lineWidth = 1.5 * d;
      g.fillRect(-3 * d, -5 * d, 6 * d, 10 * d); g.strokeRect(-3 * d, -5 * d, 6 * d, 10 * d);
    } else if (kind === 'caddy') {
      g.fillStyle = '#f5f5f0'; g.strokeStyle = '#0b1a12'; g.lineWidth = 1.3 * d;
      g.beginPath(); g.arc(0, 0, 3.4 * d, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#1d5537'; g.fillRect(-1 * d, -1 * d, 2 * d, 2 * d);
    } else if (kind === 'tee') {
      g.fillStyle = '#d8342a'; g.strokeStyle = '#ffffff'; g.lineWidth = 1.2 * d;
      g.beginPath(); g.arc(0, 0, 4 * d, 0, TAU); g.fill(); g.stroke();
    }
    g.restore();
  }

  // st: { px, pz, yaw, items: [{kind, x, z, ang?}], aim: {x,z}? }
  function drawRadar(st) {
    const c = $('minimap');
    if (!overview || c.offsetParent === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const g = c.getContext('2d');
    const W = c.width, Hh = c.height, R = Math.min(W, Hh) / 2;
    const range = 170; // yards from centre to edge
    const s = R / range;
    g.clearRect(0, 0, W, Hh);
    g.save();
    g.beginPath(); g.arc(W / 2, Hh / 2, R - 1, 0, TAU); g.clip();
    g.fillStyle = '#16301f'; g.fillRect(0, 0, W, Hh);
    g.translate(W / 2, Hh / 2);
    g.rotate(-st.yaw);
    g.scale(s, s);
    g.translate(-st.px, -st.pz);
    g.imageSmoothingEnabled = true;
    g.drawImage(overview, bounds.minX, bounds.minZ, overview.width / LO_PPY, overview.height / LO_PPY);
    if (st.aim) {
      g.strokeStyle = 'rgba(242, 194, 48, 0.95)'; g.lineWidth = 1.6 / s * dpr;
      g.setLineDash([4 / s * dpr, 3 / s * dpr]);
      g.beginPath(); g.moveTo(st.aim.fx, st.aim.fz); g.lineTo(st.aim.x, st.aim.z); g.stroke();
      g.setLineDash([]);
    }
    g.restore();
    // Icons in screen space (clamped to the rim when far away).
    const cs = Math.cos(-st.yaw), sn = Math.sin(-st.yaw);
    for (const it of st.items) {
      let dx = (it.x - st.px) * s, dz = (it.z - st.pz) * s;
      let x = dx * cs - dz * sn, y = dx * sn + dz * cs;
      const r = Math.hypot(x, y), lim = R - 8 * dpr;
      if (r > lim) { x *= lim / r; y *= lim / r; }
      drawIcon(g, it.kind, W / 2 + x, Hh / 2 + y, dpr, (it.ang || 0) - st.yaw);
    }
    drawIcon(g, 'player', W / 2, Hh / 2, dpr, st.heading - st.yaw);
    g.strokeStyle = 'rgba(236, 246, 228, 0.35)'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.arc(W / 2, Hh / 2, R - 1, 0, TAU); g.stroke();
    // North tick
    g.fillStyle = '#f3f1e7';
    g.font = `600 ${10 * dpr}px "Barlow Condensed", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const na = -st.yaw - Math.PI / 2;
    g.fillText('N', W / 2 + Math.cos(na) * (R - 9 * dpr), Hh / 2 + Math.sin(na) * (R - 9 * dpr));
  }

  // Full course map. st: { holes, active, px, pz, heading, items }
  function drawMap(st) {
    const c = $('mapCanvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = c.parentElement.getBoundingClientRect();
    const bw = bounds.maxX - bounds.minX, bh = bounds.maxZ - bounds.minZ;
    const s = Math.min(box.width / bw, box.height / bh);
    const cw = Math.floor(bw * s), ch = Math.floor(bh * s);
    c.style.width = cw + 'px'; c.style.height = ch + 'px';
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    const g = c.getContext('2d');
    const k = s * dpr;
    const X = (x) => (x - bounds.minX) * k, Y = (z) => (z - bounds.minZ) * k;
    g.drawImage(overview, 0, 0, c.width, c.height);
    // Hole lines and numbers
    st.holes.forEach((h, i) => {
      const done = st.scores[i] != null;
      g.strokeStyle = i === st.active ? 'rgba(242,194,48,0.95)' : done ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)';
      g.lineWidth = (i === st.active ? 2.5 : 1.5) * dpr;
      g.setLineDash([5 * dpr, 4 * dpr]);
      g.beginPath();
      g.moveTo(X(h.tee.x), Y(h.tee.z));
      for (let s2 = 0; s2 <= h.length; s2 += 10) { const p = h.line.pointAt(s2); g.lineTo(X(p.x), Y(p.z)); }
      g.stroke();
      g.setLineDash([]);
      drawIcon(g, 'pin', X(h.pin.x), Y(h.pin.z), dpr);
      const r = 10 * dpr;
      g.fillStyle = i === st.active ? '#f2c230' : '#0f2219';
      g.strokeStyle = '#f3f1e7'; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.arc(X(h.tee.x), Y(h.tee.z), r, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = i === st.active ? '#0f2219' : '#f3f1e7';
      g.font = `700 ${13 * dpr}px "Barlow Condensed", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), X(h.tee.x), Y(h.tee.z) + 0.5 * dpr);
    });
    for (const it of st.items) drawIcon(g, it.kind, X(it.x), Y(it.z), dpr * 1.2, it.ang || 0);
    drawIcon(g, 'player', X(st.px), Y(st.pz), dpr * 1.4, st.heading);
  }

  function setLoading(on, msg) {
    if (msg) text('loadingText', msg);
    show('loading', on);
  }

  return {
    $, text, html, setMode, setHole, setStroke, setTotal, setClub, setFacts, objective, prompt, setActionLabel,
    setHint, marker, toast, hideToast, banner, hideBanner, show, isShown,
    renderCard, setOverview, drawRadar, drawMap, setLoading, fmtToPar, fmtYds,
  };
})();
