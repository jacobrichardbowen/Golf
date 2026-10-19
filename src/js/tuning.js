// ---------------------------------------------------------------------------
// Gameplay settings: the numbers that decide how the game plays, every one
// adjustable in the Workshop (Gameplay). Each starts at the game's default;
// the project's values (assets/gameplay.json, built into Golf.html) go on top,
// and then this browser's own (local storage), until they're committed to the
// project. TUNE holds the values in use.
// ---------------------------------------------------------------------------

const TUNING = [
  { group: 'Moving about', items: [
    { key: 'walkSpeed', name: 'Walk speed', unit: 'yd/s', def: 4.2, min: 1, max: 12, step: 0.1,
      note: 'His walking pace, and the most a half-pushed stick moves him.' },
    { key: 'runSpeed', name: 'Sprint speed', unit: 'yd/s', def: 8.5, min: 2, max: 25, step: 0.1,
      note: 'Holding Shift, or the stick pushed all the way.' },
    { key: 'terrainWalk', name: 'Terrain slows walking', unit: '×', def: 1, min: 0, max: 2, step: 0.05,
      note: 'Sand, deep rough and steep slopes. 0: they don’t slow him at all.' },
    { key: 'cartSpeed', name: 'Cart top speed', unit: 'yd/s', def: 13, min: 3, max: 35, step: 0.5,
      note: '13 yd/s is about 27 mph.' },
    { key: 'cartAccel', name: 'Cart acceleration', unit: 'yd/s²', def: 6.5, min: 1, max: 25, step: 0.5 },
    { key: 'terrainCart', name: 'Terrain slows the cart', unit: '×', def: 1, min: 0, max: 2, step: 0.05,
      note: 'Sand, rough and deep rough hold its top speed down and drag on it. 0: no effect.' },
  ] },
  { group: 'Ball flight', items: [
    { key: 'wind', name: 'Wind influence', unit: '×', def: 1, min: 0, max: 3, step: 0.05,
      note: 'How hard the wind pushes the ball. 0: the wind blows but the ball ignores it.' },
    { key: 'distance', name: 'Shot distance', unit: '×', def: 1, min: 0.5, max: 1.6, step: 0.01,
      note: 'Every club’s full-power carry. The caddy and the club card follow it.' },
    { key: 'lie', name: 'Lie penalty', unit: '×', def: 1, min: 0, max: 2, step: 0.05,
      note: 'The distance and spin lost hitting from the rough, deep rough, sand and so on. 0: none.' },
    { key: 'terrainBall', name: 'Terrain grabs the ball', unit: '×', def: 1, min: 0, max: 2, step: 0.05,
      note: 'How much rough, sand and the like stop a bouncing, rolling ball (and how much paths and rock kick it on). 0: they play like fairway.' },
    { key: 'greenSpeed', name: 'Green speed', unit: '×', def: 1, min: 0.5, max: 2, step: 0.05,
      note: 'Faster greens: a putt rolls further for the same stroke.' },
  ] },
  { group: 'Swing', items: [
    { key: 'backswing', name: 'Backswing time', unit: 's', def: 1.3, min: 0.5, max: 3, step: 0.05,
      note: 'From address to the top at full power with an average club (the driver is quicker, the wedge slower).' },
    { key: 'spray', name: 'Spray', unit: '×', def: 1, min: 0, max: 3, step: 0.05,
      note: 'How much a swing wanders off line when it misses the sweet spot. More power, more spray.' },
    { key: 'sweetAt', name: 'Sweet spot', unit: '% of backswing', def: 95, min: 60, max: 110, step: 0.5,
      note: 'When to let go: this far through the backswing (over 100: after reaching the top). Nothing on screen shows it.' },
    { key: 'sweetWidth', name: 'Sweet spot width', unit: 'ms', def: 80, min: 10, max: 500, step: 5,
      note: 'The whole window, in thousandths of a second.' },
    { key: 'sweetSpray', name: 'Spray in the sweet spot', unit: '×', def: 0.15, min: 0, max: 1, step: 0.05,
      note: 'Of the usual spray: 0 flies dead straight.' },
    { key: 'sweetBoost', name: 'Sweet spot power', unit: '%', def: 2, min: 0, max: 15, step: 0.5 },
    { key: 'perfectWidth', name: 'Perfect strike width', unit: 'ms', def: 14, min: 2, max: 100, step: 1,
      note: 'A window in the middle of the sweet spot: the ball flies true.' },
    { key: 'perfectBoost', name: 'Perfect strike power', unit: '%', def: 3.5, min: 0, max: 15, step: 0.5 },
    { key: 'assist', name: 'Perfect strike aim assist', unit: '%', def: 30, min: 0, max: 100, step: 5,
      note: 'How much of the miss a perfect strike takes out, when the hole is in reach (never more than 2° or 4% of the distance).' },
    { key: 'overBoost', name: 'Held at the top: power', unit: '%', def: 4, min: 0, max: 20, step: 0.5,
      note: 'Waiting at the top builds a little more power, up to this much…' },
    { key: 'overSpray', name: 'Held at the top: spray', unit: '×', def: 0.8, min: 0, max: 3, step: 0.05,
      note: '…and this much more spray (on top of the usual).' },
    { key: 'holdLimit', name: 'Held too long after', unit: 's', def: 0.8, min: 0.1, max: 3, step: 0.05,
      note: 'At the top any longer than this and he tenses up: the strike wanders much more…' },
    { key: 'holdDecay', name: 'Held too long: power lost', unit: '%/s', def: 18, min: 0, max: 60, step: 1,
      note: '…and the power drains away.' },
    { key: 'autoAim', name: 'Auto-aim error', unit: '×', def: 1, min: 0, max: 3, step: 0.05,
      note: 'How far off the hole he lines up when he steps up to the ball (so it usually needs a nudge). 0: dead on.' },
  ] },
  { group: 'Club setup (the close-up)', items: [
    { key: 'faceSpeed', name: 'Face turn speed', unit: '°/s', def: 18, min: 1, max: 90, step: 1,
      note: 'Holding A/D (◀ ▶). Shift turns it slower.' },
    { key: 'headSpeed', name: 'Club in/out speed', unit: 'cm/s', def: 8, min: 0.5, max: 40, step: 0.5,
      note: 'Holding W/S (▲ ▼).' },
    { key: 'faceMax', name: 'Face turns up to', unit: '°', def: 12, min: 2, max: 30, step: 0.5 },
    { key: 'faceEffect', name: 'Face angle effect', unit: '×', def: 1, min: 0, max: 3, step: 0.05,
      note: 'How much an open or closed face starts the ball off line and curves it.' },
    { key: 'strikeEffect', name: 'Off-centre strike effect', unit: '×', def: 1, min: 0, max: 3, step: 0.05,
      note: 'Heel and toe strikes: how much they curve the ball and cost distance.' },
  ] },
];

const TUNE = {};

const Tune = (() => {
  const KEY = 'pinehaven-gameplay';
  const defs = new Map(TUNING.flatMap((g) => g.items).map((it) => [it.key, it]));
  const defaults = Object.fromEntries([...defs].map(([k, it]) => [k, it.def]));
  const listeners = [];
  // The project's values, built into this Golf.html (assets/gameplay.json).
  const project = clean((typeof window !== 'undefined' && window.__PINEHAVEN_GAMEPLAY) || {});
  // This browser's: { values: { key: value }, committed: false | json }.
  let local = { values: {}, committed: false };

  function clean(o) {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) {
      const d = defs.get(k);
      if (d && typeof v === 'number' && isFinite(v)) out[k] = clamp(v, d.min, d.max);
    }
    return out;
  }
  const same = (a, b) => Math.abs(a - b) < 1e-9;

  function load() {
    try {
      const rec = JSON.parse(localStorage.getItem(KEY));
      if (rec && rec.values) local = { values: clean(rec.values), committed: rec.committed || false };
    } catch (e) { /* storage unavailable */ }
    // Committed and now built in: the local copy has done its job.
    const built = local.committed === 'removed' ? !Object.keys(project).length : local.committed === projectJson();
    if (local.committed && built) local = { values: {}, committed: false };
  }
  function save() {
    try {
      if (Object.keys(local.values).length || local.committed) localStorage.setItem(KEY, JSON.stringify(local));
      else localStorage.removeItem(KEY);
    } catch (e) { /* kept for this visit */ }
  }

  function apply() {
    Object.assign(TUNE, defaults, project, local.values);
    for (const f of listeners) f(TUNE);
  }
  const onChange = (f) => { listeners.push(f); f(TUNE); };

  // Where a value comes from.
  function source(key) {
    if (key in local.values && !(key in project && same(project[key], local.values[key]))) return 'local';
    return key in project ? 'project' : 'default';
  }
  function set(key, value) {
    const d = defs.get(key);
    if (!d) return;
    const v = clamp(Number(value), d.min, d.max);
    if (!isFinite(v)) return;
    const base = key in project ? project[key] : d.def;
    if (same(v, base)) delete local.values[key];
    else local.values[key] = v;
    local.committed = false;
    save();
    apply();
  }
  // Back to the game's default (which, if the project has its own value, is a change to commit).
  function reset(key) {
    if (key in project) local.values[key] = defs.get(key).def;
    else delete local.values[key];
    if (key in project && same(project[key], defs.get(key).def)) delete local.values[key];
    local.committed = false;
    save();
    apply();
  }
  function resetAll() {
    local = { values: {}, committed: false };
    for (const k of Object.keys(project)) if (!same(project[k], defaults[k])) local.values[k] = defaults[k];
    save();
    apply();
  }
  // Drop this browser's changes: back to the project's values.
  function useProject() {
    local = { values: {}, committed: false };
    save();
    apply();
  }

  // The file the project keeps: every value that isn't the game's default.
  function fileValues() {
    const out = {};
    for (const k of Object.keys(defaults)) if (!same(TUNE[k], defaults[k])) out[k] = TUNE[k];
    return out;
  }
  const toJson = (o) => JSON.stringify(o, Object.keys(o).sort(), 2) + '\n';
  function projectJson() { return Object.keys(project).length ? toJson(project) : ''; }
  // In the shape Assets.pending() uses, for the Workshop's commit.
  function pending() {
    if (local.committed || !Object.keys(local.values).some((k) => !(k in project) || !same(project[k], local.values[k]))) return [];
    const vals = fileValues();
    if (!Object.keys(vals).length) return Object.keys(project).length ? [{ id: 'gameplay', kind: 'remove' }] : [];
    return [{ id: 'gameplay', kind: 'write', name: 'gameplay.json', ext: 'json', data: new TextEncoder().encode(toJson(vals)).buffer }];
  }
  function markCommitted() {
    if (!Object.keys(local.values).length) return;
    const vals = fileValues();
    local.committed = Object.keys(vals).length ? toJson(vals) : 'removed';
    save();
  }
  const changedFromProject = () => pending().length > 0;

  load();
  apply();
  return { defs, defaults, set, reset, resetAll, useProject, source, onChange, pending, markCommitted, changedFromProject, get project() { return project; } };
})();

// The surfaces follow the settings.
Tune.onChange(tuneSurfaces);
