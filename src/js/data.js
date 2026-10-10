// ---------------------------------------------------------------------------
// Clubs and playing surfaces. Distances are in yards (carry at full power,
// from a clean lie, with no wind). Spin is backspin in rpm at full power.
// ---------------------------------------------------------------------------

const CLUBS = [
  { id: 'DR', name: 'Driver',         short: '1W', carry: 235, launch: 12.0, spin: 2700 },
  { id: '3W', name: '3 Wood',         short: '3W', carry: 215, launch: 13.0, spin: 3500 },
  { id: '5W', name: '5 Wood',         short: '5W', carry: 200, launch: 14.5, spin: 4200 },
  { id: '4I', name: '4 Iron',         short: '4i', carry: 185, launch: 16.0, spin: 4700 },
  { id: '5I', name: '5 Iron',         short: '5i', carry: 175, launch: 17.5, spin: 5300 },
  { id: '6I', name: '6 Iron',         short: '6i', carry: 163, launch: 19.0, spin: 6100 },
  { id: '7I', name: '7 Iron',         short: '7i', carry: 152, launch: 21.0, spin: 6900 },
  { id: '8I', name: '8 Iron',         short: '8i', carry: 140, launch: 23.5, spin: 7700 },
  { id: '9I', name: '9 Iron',         short: '9i', carry: 128, launch: 26.0, spin: 8400 },
  { id: 'PW', name: 'Pitching Wedge', short: 'PW', carry: 115, launch: 29.0, spin: 9000 },
  { id: 'GW', name: 'Gap Wedge',      short: 'GW', carry: 100, launch: 32.0, spin: 9500 },
  { id: 'SW', name: 'Sand Wedge',     short: 'SW', carry: 82,  launch: 36.0, spin: 9800, sand: true },
  { id: 'LW', name: 'Lob Wedge',      short: 'LW', carry: 62,  launch: 42.0, spin: 10000, sand: true },
  { id: 'PT', name: 'Putter',         short: 'PT', putter: true },
];
const PUTTER_INDEX = CLUBS.length - 1;

// Surface ids.
const S_TEE = 0, S_FAIRWAY = 1, S_FRINGE = 2, S_GREEN = 3, S_ROUGH = 4,
  S_DEEP = 5, S_SAND = 6, S_WATER = 7, S_OOB = 8;

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
];

// Distance multiplier for a club from a given lie (wedges cope with sand).
function lieFactor(club, surf) {
  if (club.putter) return 1;
  if (surf === S_SAND && club.sand) return 0.9;
  if (surf === S_SAND && club.id === 'GW') return 0.75;
  return SURFACES[surf].lie;
}

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
