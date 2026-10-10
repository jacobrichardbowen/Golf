// ---------------------------------------------------------------------------
// DOM side of the game: HUD plates, swing meter, minimap, toasts, banner,
// scorecard and screens.
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

  const P0 = 0.15, SPAN = 1.15;
  const meterPct = (p) => ((p + P0) / SPAN) * 100;
  const fmtToPar = (d) => (d === 0 ? 'E' : d > 0 ? '+' + d : '−' + -d);
  const fmtYds = (y) => Math.round(y).toLocaleString('en-US');

  // ---------- HUD ----------
  function setHole(num, def, yards) {
    text('hHole', num);
    text('hName', def.name);
    text('hPar', def.par);
    text('hYards', yards);
  }
  function setStroke(n) { text('hStroke', n); }
  function setTotal(toPar, played) {
    const el = $('hTotal');
    text('hTotal', played ? fmtToPar(toPar) : 'E');
    el.classList.toggle('under', played && toPar < 0);
  }
  function setWind(mph, relDeg) {
    text('windSpeed', Math.round(mph));
    $('windArrow').style.transform = `rotate(${relDeg.toFixed(1)}deg)`;
  }
  function setClub(name, dist) { text('clubName', name); text('clubDist', dist); }
  function setFacts(toPin, lie) { text('toPin', toPin); text('lie', lie); }

  // ---------- Meter ----------
  let lastTicks = '';
  function setTicks(labels) {
    const key = labels.join('|');
    if (key === lastTicks) return;
    lastTicks = key;
    $('meterTicks').innerHTML = labels
      .map((l, i) => `<span style="left:${meterPct((i + 1) / labels.length).toFixed(2)}%">${l}</span>`)
      .join('');
  }
  function setMeter(p, lockP) {
    const mk = $('meterMark'), fill = $('meterFill'), lock = $('meterLock');
    mk.style.left = meterPct(p) + '%';
    const fp = lockP !== null && lockP !== undefined ? lockP : Math.max(0, p);
    fill.style.width = ((Math.max(0, fp) / SPAN) * 100).toFixed(2) + '%';
    if (lockP !== null && lockP !== undefined) {
      lock.style.display = 'block';
      lock.style.left = meterPct(lockP) + '%';
    } else lock.style.display = 'none';
  }
  function setHint(h) { html('meterHint', h); }
  function meterEnabled(on) {
    $('meter').classList.toggle('disabled', !on);
    $('swingBtn').classList.toggle('idle', !on);
  }
  function swingLabel(t) { text('swingBtn', t); }

  // ---------- Pin marker ----------
  function pinMarker(x, y, visible, label) {
    const el = $('pinMarker');
    if (!visible) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    if (el.style.display === 'none') el.style.display = '';
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    text('pinDist', label);
  }

  // ---------- Toast / banner ----------
  let toastTimer = 0;
  function toast(main, sub, ms, bad) {
    const el = $('toast');
    el.innerHTML = main + (sub ? `<small>${sub}</small>` : '');
    el.classList.toggle('bad', !!bad);
    el.hidden = false;
    // restart animation
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ms || 2200);
  }
  function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; }
  function banner(inner, cls) {
    const el = $('banner');
    el.className = 'banner ' + (cls || '');
    el.innerHTML = inner;
    el.hidden = false;
  }
  function hideBanner() { $('banner').hidden = true; }

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
  function renderCard(holes, yards, scores, current, opts) {
    const n = holes.length;
    const cols = holes.map((_, i) => i);
    const parTot = holes.reduce((a, h) => a + h.par, 0);
    const ydTot = yards.reduce((a, y) => a + y, 0);
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
    t += '<tr class="yards"><th scope="row">Yards</th>' + cols.map((i) => `<td>${yards[i]}</td>`).join('') + `<td class="tot">${fmtYds(ydTot)}</td></tr>`;
    t += '<tr><th scope="row">Par</th>' + cols.map((i) => `<td>${holes[i].par}</td>`).join('') + `<td class="tot">${parTot}</td></tr>`;
    t += '<tr class="score"><th scope="row">Score</th>' + cols.map((i) => `<td${cur(i)}>${scoreMark(scores[i], holes[i].par)}</td>`).join('') + `<td class="tot">${played.length ? scoreTot : ''}</td></tr>`;
    t += '<tr><th scope="row">To par</th>' + cols.map((i) => {
      const r = rel[i];
      const under = r && r.startsWith('−');
      return `<td class="${under ? 'under' : ''}">${r}</td>`;
    }).join('') + `<td class="tot">${played.length ? fmtToPar(scoreTot - parPlayed) : ''}</td></tr>`;
    t += '</tbody>';
    $('cardTable').innerHTML = t;
    text('cardTitle', opts.title);
    text('cardSub', played.length ? `${scoreTot} strokes · ${fmtToPar(scoreTot - parPlayed)}` : `Par ${parTot} · ${fmtYds(ydTot)} yards`);
    $('cardNext').hidden = !opts.next;
    if (opts.next) $('cardNext').textContent = opts.next;
    $('cardClose').hidden = !opts.closable;
  }

  // ---------- Minimap ----------
  const mm = { img: null, view: null, scale: 1, ox: 0, oy: 0, dpr: 1 };
  function prepMinimap(srcCanvas, field) {
    const c = $('minimap');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(40, c.clientWidth), ch = Math.max(60, c.clientHeight);
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    mm.dpr = dpr;
    // Frame the playing corridor rather than the whole forest.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of field.def.path) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    minX -= 50; maxX += 50; minZ -= 35; maxZ += 25;
    const s = Math.min(c.width / (maxX - minX), c.height / (maxZ - minZ));
    mm.scale = s;
    mm.ox = (c.width - (maxX - minX) * s) / 2 - minX * s;
    mm.oy = (c.height - (maxZ - minZ) * s) / 2 - minZ * s;
    // Pre-render the course image once.
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const g = off.getContext('2d');
    g.fillStyle = '#16301f';
    g.fillRect(0, 0, off.width, off.height);
    const b = field.bounds;
    const ppy = srcCanvas.width / (b.maxX - b.minX);
    g.imageSmoothingQuality = 'high';
    g.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, mm.ox + b.minX * s, mm.oy + b.minZ * s, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    // Water on top (the texture shows the lake bed).
    g.fillStyle = 'rgba(52, 110, 150, 0.95)';
    for (const w of field.waters) {
      g.save();
      g.translate(mm.ox + w.x * s, mm.oy + w.z * s);
      g.rotate((w.rot || 0) * DEG);
      g.beginPath();
      g.ellipse(0, 0, w.rx * 1.02 * s, w.rz * 1.02 * s, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    g.fillStyle = 'rgba(14, 40, 20, 0.55)';
    for (const t of field.trees) {
      g.beginPath();
      g.arc(mm.ox + t.x * s, mm.oy + t.z * s, Math.max(0.8 * dpr, t.cr * 0.6 * s), 0, TAU);
      g.fill();
    }
    void ppy;
    mm.img = off;
  }
  function drawMinimap(st) {
    if (!mm.img) return;
    const c = $('minimap');
    const g = c.getContext('2d');
    const s = mm.scale, d = mm.dpr;
    const X = (x) => mm.ox + x * s, Y = (z) => mm.oy + z * s;
    g.drawImage(mm.img, 0, 0);
    // Shot trace
    if (st.trace && st.trace.length > 1) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.2 * d;
      g.beginPath();
      st.trace.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
      g.stroke();
    }
    // Aim line
    if (st.target) {
      g.strokeStyle = 'rgba(242, 194, 48, 0.95)';
      g.lineWidth = 1.4 * d;
      g.setLineDash([3 * d, 2.5 * d]);
      g.beginPath();
      g.moveTo(X(st.ball.x), Y(st.ball.z));
      g.lineTo(X(st.target.x), Y(st.target.z));
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(X(st.target.x), Y(st.target.z), 3.2 * d, 0, TAU);
      g.stroke();
    }
    // Pin
    const px = X(st.pin.x), py = Y(st.pin.z);
    g.strokeStyle = '#ffffff'; g.lineWidth = 1 * d;
    g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - 9 * d); g.stroke();
    g.fillStyle = '#f2c230';
    g.beginPath(); g.moveTo(px, py - 9 * d); g.lineTo(px + 6 * d, py - 6.5 * d); g.lineTo(px, py - 4 * d); g.fill();
    // Ball
    g.fillStyle = '#ffffff'; g.strokeStyle = '#0b1a12'; g.lineWidth = 1.2 * d;
    g.beginPath(); g.arc(X(st.ball.x), Y(st.ball.z), 2.6 * d, 0, TAU); g.fill(); g.stroke();
  }

  function setLoading(on, msg) {
    if (msg) text('loadingText', msg);
    show('loading', on);
  }

  return {
    $, text, swingLabel, setHole, setStroke, setTotal, setWind, setClub, setFacts, setTicks, setMeter, setHint, meterEnabled,
    pinMarker, toast, hideToast, banner, hideBanner, show, isShown, renderCard, prepMinimap, drawMinimap,
    setLoading, fmtToPar, fmtYds,
  };
})();
