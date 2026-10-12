// ---------------------------------------------------------------------------
// Clubs, playing surfaces and the cast. Distances are in yards (carry at full
// power, from a clean lie, with no wind). Spin is backspin in rpm at full power.
//
// Each club has a niche:
//   meter  speed of the swing-meter marker (slower = easier to control)
//   curve  how much a mis-timed accuracy press bends the ball
//   kind   which club model it uses
// ---------------------------------------------------------------------------

const CLUBS = [
  { id: 'DR', name: 'Driver', short: 'DR', kind: 'driver', carry: 235, launch: 12.0, spin: 2700, meter: 1.15, curve: 1.25,
    desc: 'Longest club. Low, penetrating flight with lots of roll. Built for the tee box; it struggles from anywhere else.' },
  { id: '4I', name: '4 Iron', short: '4i', kind: 'iron4', carry: 185, launch: 16.0, spin: 4700, meter: 1.05, curve: 1.0,
    desc: 'Long approaches and second shots on par fives. Workable from the fairway and light rough.' },
  { id: '8I', name: '8 Iron', short: '8i', kind: 'iron8', carry: 140, launch: 23.5, spin: 7700, meter: 0.95, curve: 0.8,
    desc: 'Higher flight with plenty of spin, so it stops quickly on the green.' },
  { id: 'CW', name: 'Chipping Wedge', short: 'CW', kind: 'wedge', carry: 95, launch: 34.0, spin: 9800, meter: 0.8, curve: 0.55,
    desc: 'Lofted and easy to control. Chips, pitches and escapes from bunkers and thick rough.' },
  { id: 'PT', name: 'Putter', short: 'PT', kind: 'putter', putter: true, meter: 0.75, curve: 0.7,
    desc: 'Rolls the ball along the ground. For the green and the fringe.' },
];
const PUTTER_INDEX = CLUBS.length - 1;

// Surface ids.
const S_TEE = 0, S_FAIRWAY = 1, S_FRINGE = 2, S_GREEN = 3, S_ROUGH = 4,
  S_DEEP = 5, S_SAND = 6, S_WATER = 7, S_OOB = 8, S_PATH = 9;

// bounce: restitution on landing     mu: turf friction during a bounce
// grip:   how strongly backspin bites roll / rollV: rolling resistance (constant / speed-scaled)
// lie:    distance multiplier for shots played from here, spinLie: spin multiplier
const SURFACES = [
  { id: S_TEE,     name: 'Tee',        label: 'On the tee',        bounce: 0.36, mu: 0.50, grip: 0.55, roll: 0.10, rollV: 0.90, lie: 1.00, spinLie: 1.00 },
  { id: S_FAIRWAY, name: 'Fairway',    label: 'In the fairway',    bounce: 0.36, mu: 0.50, grip: 0.55, roll: 0.10, rollV: 0.90, lie: 1.00, spinLie: 1.00 },
  { id: S_FRINGE,  name: 'Fringe',     label: 'On the fringe',     bounce: 0.32, mu: 0.50, grip: 0.75, roll: 0.085, rollV: 0.45, lie: 0.97, spinLie: 0.95 },
  { id: S_GREEN,   name: 'Green',      label: 'On the green',      bounce: 0.30, mu: 0.45, grip: 1.00, roll: 0.060, rollV: 0.075, lie: 0.97, spinLie: 1.00 },
  { id: S_ROUGH,   name: 'Rough',      label: 'In the rough',      bounce: 0.22, mu: 0.70, grip: 0.30, roll: 0.30, rollV: 2.0, lie: 0.86, spinLie: 0.60 },
  { id: S_DEEP,    name: 'Deep rough', label: 'In the deep rough', bounce: 0.15, mu: 0.85, grip: 0.20, roll: 0.55, rollV: 3.0, lie: 0.72, spinLie: 0.45 },
  { id: S_SAND,    name: 'Bunker',     label: 'In the bunker',     bounce: 0.05, mu: 0.95, grip: 0.30, roll: 1.10, rollV: 4.0, lie: 0.62, spinLie: 0.70 },
  { id: S_WATER,   name: 'Water',      label: 'In the water',      bounce: 0.0,  mu: 1.0,  grip: 0.0,  roll: 9.0,  rollV: 9.0, lie: 0.0,  spinLie: 0.0 },
  { id: S_OOB,     name: 'Out of bounds', label: 'Out of bounds',  bounce: 0.2,  mu: 0.7,  grip: 0.2,  roll: 0.6,  rollV: 2.0, lie: 0.7,  spinLie: 0.5 },
  { id: S_PATH,    name: 'Cart path',  label: 'On the cart path',  bounce: 0.55, mu: 0.25, grip: 0.25, roll: 0.05, rollV: 0.12, lie: 0.95, spinLie: 0.8 },
];

// Distance multiplier for a club from a given lie.
function lieFactor(club, surf) {
  if (club.putter) return 1;
  const base = SURFACES[surf].lie;
  if (club.id === 'DR') {
    // Off the deck the driver loses a lot; from rough or sand it is a gamble.
    if (surf === S_TEE) return 1;
    if (surf === S_FAIRWAY || surf === S_FRINGE || surf === S_PATH || surf === S_GREEN) return 0.86;
    return base * 0.7;
  }
  if (club.id === 'CW') {
    if (surf === S_SAND) return 0.93;
    if (surf === S_ROUGH) return 0.96;
    if (surf === S_DEEP) return 0.88;
    return base;
  }
  if (club.id === '4I' && (surf === S_SAND || surf === S_DEEP)) return base * 0.85;
  return base;
}

// Spin multiplier for a club from a given lie: wedges keep their bite.
function spinLieFactor(club, surf) {
  const base = SURFACES[surf].spinLie;
  if (club.id === 'CW') return Math.min(1, base + 0.3);
  return base;
}

// The cast. Heights in yards (6 ft = 2 yd); `body` is the model each one wears.
const CHARACTERS = [
  { id: 'surlaw', name: 'G. Surlaw', body: 'golfer-surlaw', height: 2.0, heightLabel: '6′0″', look: 'White hair, gray shirt, cyan-blue pants',
    hair: 0xebe9e2, shirt: 0x8d9296, pants: 0x27b5d8, skin: 0xe2b18f, shoe: 0xf4f4f0 },
  { id: 'froth', name: 'F. Froth', body: 'golfer-froth', height: 1.667, heightLabel: '5′0″', look: 'Brown hair, forest green shirt, gold pants',
    hair: 0x6b4426, shirt: 0x2c5a33, pants: 0xd4a52f, skin: 0xd9a27c, shoe: 0xf4f4f0 },
  { id: 'mcbeaty', name: 'W. McBeaty', body: 'golfer', height: 1.333, heightLabel: '4′0″', look: 'Orange hair, red shirt, white pants',
    hair: 0xe2702a, shirt: 0xc8302c, pants: 0xf5f5f0, skin: 0xf0c3a2, shoe: 0x3a3a3a },
];
// The caddy uses McBeaty's build, dressed all in white.
const CADDY = Object.assign({}, CHARACTERS[2], { id: 'caddy', name: 'Caddy', shirt: 0xf5f5f0, pants: 0xf5f5f0 });

function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  if (d <= -3) return 'Albatross!';
  if (d === -2) return 'Eagle!';
  if (d === -1) return 'Birdie!';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double bogey';
  if (d === 3) return 'Triple bogey';
  return '+' + d;
}
