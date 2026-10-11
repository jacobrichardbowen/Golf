// Prints carry/apex/roll for every club so ball flight can be tuned.
// Usage: node tests/calibrate.js
const G = require('./load')(['util.js', 'data.js', 'physics.js']);

console.log('club   speed(mph)  carry  apex  flight  total(fw)  total(green)');
for (const c of G.CLUBS) {
  if (c.putter) continue;
  const v = G.fullSpeed(c);
  const r = G.simulateFlat(v, c.launch, c.spin);
  const t = G.simulateFlat(v, c.launch, c.spin, { total: true });
  const tg = G.simulateFlat(v, c.launch, c.spin, { total: true, green: true });
  console.log(
    c.short.padEnd(5),
    (v / G.MPH).toFixed(0).padStart(8),
    r.carry.toFixed(0).padStart(8),
    r.apex.toFixed(0).padStart(5),
    r.flight.toFixed(1).padStart(6),
    t.total.toFixed(0).padStart(9),
    tg.total.toFixed(0).padStart(12),
  );
}
// Half-power shots
for (const id of ['4I', '8I', 'CW']) {
  const c = G.CLUBS.find((k) => k.id === id);
  for (const f of [0.25, 0.5, 0.75]) {
    const target = c.carry * f;
    const s = G.speedForCarry(c, target, 1);
    const r = G.simulateFlat(s, c.launch, G.spinFor(c, s, 1), { total: true, green: true });
    console.log(`${id} ${Math.round(f * 100)}% target ${target.toFixed(0)} -> carry ${r.carry.toFixed(1)} total(green) ${r.total.toFixed(1)}`);
  }
}
for (const d of [1, 3, 5, 10, 20, 30]) {
  console.log(`putt ${d}yd -> speed ${G.puttSpeedFor(d).toFixed(2)} yd/s`);
}
