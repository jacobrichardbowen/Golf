// ---------------------------------------------------------------------------
// Golden Plains — 9 holes, par 36, on a windswept, hilly plain of golden
// grass dotted with rocky, grass-topped mesas. Built the same way as
// Pinehaven's generated holes (see course.js for the fields), plus:
//
//   mesas    steep-sided plateaus { x, z, rx, rz, rot, h (yards high),
//            cliff (yards wide), ramps: [{ a: foot, b: top, w }] }
//   bridges  rope suspension bridges { a, b, w }: deck from a to b at the
//            height of the ground at each end, walkable and drivable
//   tunnels  arches straight through the rock { a, b, w, h }: walk, drive or
//            play a ball through them
//
// Holes give these in their own frame; `mesas` at the top level are in
// course coordinates (scenery between the holes).
// ---------------------------------------------------------------------------

const GOLDEN_PLAINS = {
  id: 'golden', name: 'Golden Plains',
  title: ['Golden Plains', 'Golf Links'],
  tagline: 'Wind, grass and mesas. Rope bridges, a tunnel, nowhere to hide.',
  seed: 31,
  hills: 9,
  forest: 0.06,
  palette: {
    surfaces: {
      [S_TEE]: [122, 170, 62], [S_FAIRWAY]: [134, 168, 56], [S_FRINGE]: [116, 162, 58], [S_GREEN]: [100, 178, 76],
      [S_ROUGH]: [176, 160, 70], [S_DEEP]: [206, 172, 86], [S_OOB]: [206, 172, 86], [S_PATH]: [210, 194, 160],
    },
    mottle: [226, 200, 126],
    outer: 0xb89a4e,
  },
  clubhouse: { x: 58, z: 22, heading: 0 },
  cartStart: { x: 30, z: 14, heading: 0 },
  // Big mesas out between the holes.
  mesas: [
    { x: 190, z: -210, rx: 52, rz: 40, rot: 20, h: 22 },
    { x: 205, z: -830, rx: 58, rz: 46, rot: -15, h: 26 },
    { x: -95, z: -760, rx: 44, rz: 60, rot: 10, h: 20 },
    { x: -130, z: -300, rx: 40, rz: 34, rot: 35, h: 18 },
    { x: 520, z: -560, rx: 46, rz: 40, h: 24 },
  ],
  holes: [
    {
      name: 'Prairie Gate', par: 4, seed: 101, at: [0, 0, 0], wind: [5, 12],
      path: [[0, 0], [0, -230], [22, -382]],
      fairway: { start: 40, width: 40 },
      green: { r: 15, tilt: [0.008, -0.010] },
      pin: [3, -3],
      bunkers: [
        { x: 27, z: -240, rx: 8, rz: 12, rot: 0 },
        { x: 44, z: -378, rx: 6, rz: 9, rot: 10 },
        { x: 6, z: -400, rx: 9, rz: 4, rot: -5 },
      ],
      water: [],
      mounds: [],
      // A rock stands guard on the left of the landing area.
      mesas: [{ x: -64, z: -250, rx: 26, rz: 40, rot: 10, h: 14 }],
    },
    {
      // From a lookout high on a mesa down to a green on the plain.
      name: 'The Lookout', par: 3, seed: 113, at: [90, -460, 90], wind: [6, 13],
      path: [[0, 0], [0, -172]],
      fairway: { start: 130, width: 28 },
      green: { r: 15, tilt: [-0.006, -0.012] },
      pin: [-3, 2],
      bunkers: [
        { x: -18, z: -180, rx: 6, rz: 9, rot: 20 },
        { x: 20, z: -165, rx: 5, rz: 8, rot: 0 },
      ],
      water: [],
      mounds: [],
      mesas: [{ x: 0, z: 0, rx: 26, rz: 24, h: 15, ramps: [{ a: [51, 45], b: [15, 13], w: 7 }] }],
    },
    {
      // Mesa to mesa over a creek far below. Walk (or drive) the rope bridge.
      name: 'Sky Bridge', par: 3, seed: 127, at: [340, -490, 0], wind: [6, 14],
      path: [[0, 0], [0, -165]],
      fairway: { start: 140, width: 30 },
      green: { r: 14, tilt: [0.006, -0.010] },
      pin: [2, -2],
      bunkers: [{ x: -20, z: -160, rx: 5, rz: 7, rot: 0 }],
      water: [{ x: 0, z: -80, rx: 75, rz: 22, rot: 0 }],
      mounds: [{ x: 0, z: -80, r: 34, h: -5 }],
      mesas: [
        { x: 0, z: 0, rx: 34, rz: 24, h: 18, ramps: [{ a: [-46, 62], b: [-13, 18], w: 7 }] },
        { x: 0, z: -170, rx: 38, rz: 34, h: 18, ramps: [{ a: [33, -249], b: [12, -198], w: 7 }] },
      ],
      bridges: [{ a: [16, -15], b: [16, -145], w: 3.4 }],
    },
    {
      // A great arch through the rock: go round to the left, or thread it.
      name: 'The Keyhole', par: 4, seed: 131, at: [395, -770, 0], wind: [5, 12], cartSide: -1,
      path: [[0, 0], [0, -190], [-70, -255], [-34, -332], [4, -382]],
      fairway: { start: 45, width: 38 },
      green: { r: 15, tilt: [0.008, -0.012] },
      pin: [-3, -3],
      bunkers: [
        { x: -32, z: -385, rx: 6, rz: 10, rot: 0 },
        { x: 30, z: -372, rx: 6, rz: 9, rot: 0 },
      ],
      water: [],
      mounds: [],
      mesas: [{ x: 10, z: -255, rx: 46, rz: 28, h: 15 }],
      tunnels: [{ a: [6, -198], b: [6, -312], w: 12, h: 9 }],
    },
    {
      // Up a broad ramp to finish on top of a table mesa.
      name: 'Table Top', par: 5, seed: 149, at: [350, -1190, 270], wind: [6, 14],
      path: [[0, 0], [0, -260], [-20, -400], [-10, -515]],
      fairway: { start: 45, width: 36 },
      green: { r: 15, tilt: [-0.006, -0.012] },
      pin: [4, -3],
      bunkers: [
        { x: 24, z: -230, rx: 7, rz: 12, rot: 0 },
        { x: -36, z: -505, rx: 6, rz: 9, rot: 0 },
        { x: 14, z: -534, rx: 8, rz: 4, rot: 0 },
      ],
      water: [],
      mounds: [],
      mesas: [{
        x: -12, z: -440, rx: 70, rz: 120, h: 12,
        ramps: [{ a: [-4, -256], b: [-6, -326], w: 36 }, { a: [-94, -512], b: [-58, -485], w: 8 }],
      }],
    },
    {
      // Hoodoos: rock spires standing in the fairway, and the wind howling.
      name: 'Hoodoos', par: 5, seed: 157, at: [-235, -1060, 180], wind: [8, 16],
      path: [[0, 0], [0, -260], [-12, -420], [0, -505]],
      fairway: { start: 45, width: 38 },
      green: { r: 15, tilt: [0.006, -0.014] },
      pin: [-3, 2],
      bunkers: [
        { x: 26, z: -500, rx: 6, rz: 9, rot: 0 },
        { x: -30, z: -488, rx: 6, rz: 8, rot: 0 },
      ],
      water: [],
      mounds: [],
      mesas: [
        { x: 6, z: -268, rx: 7, rz: 7, h: 15, cliff: 2.5 },
        { x: -36, z: -196, rx: 9, rz: 8, h: 18, cliff: 3 },
        { x: 38, z: -360, rx: 8, rz: 10, h: 17, cliff: 3 },
      ],
    },
    {
      // Between two great rocks.
      name: 'Gatekeepers', par: 3, seed: 163, at: [-290, -520, 180], wind: [6, 14],
      path: [[0, 0], [0, -155]],
      fairway: { start: 120, width: 26 },
      green: { r: 12, tilt: [0.006, -0.012] },
      pin: [2, -2],
      bunkers: [{ x: 0, z: -174, rx: 9, rz: 4, rot: 0 }],
      water: [],
      mounds: [],
      mesas: [
        { x: -40, z: -150, rx: 11, rz: 13, h: 20, cliff: 3 },
        { x: 40, z: -145, rx: 11, rz: 15, h: 20, cliff: 3 },
      ],
    },
    {
      // Off a mesa, then over the creek: cross it on the rope bridge.
      name: 'Canyon Run', par: 5, seed: 173, at: [-265, -310, 180], wind: [6, 14],
      path: [[0, 0], [0, -280], [18, -530]],
      fairway: { start: 60, width: 38 },
      green: { r: 15, tilt: [-0.008, -0.010] },
      pin: [3, 3],
      bunkers: [
        { x: -24, z: -270, rx: 7, rz: 12, rot: 0 },
        { x: 40, z: -526, rx: 6, rz: 9, rot: 0 },
      ],
      water: [{ x: 4, z: -360, rx: 60, rz: 9, rot: 0 }],
      mounds: [{ x: 4, z: -360, r: 22, h: -3 }],
      mesas: [{ x: 0, z: 4, rx: 22, rz: 20, h: 12, ramps: [{ a: [54, 20], b: [18, 9], w: 7 }] }],
      bridges: [{ a: [24, -338], b: [24, -383], w: 3.4 }],
    },
    {
      // Home to a green up on a little plateau: run it up the ramp.
      name: 'Homestead', par: 4, seed: 181, at: [-250, 250, 69], wind: [5, 12],
      path: [[0, 0], [0, -200], [-14, -335]],
      fairway: { start: 45, width: 38 },
      green: { r: 15, tilt: [0.006, -0.010] },
      pin: [-3, -2],
      bunkers: [
        { x: 22, z: -205, rx: 7, rz: 11, rot: 0 },
        { x: -40, z: -330, rx: 5, rz: 8, rot: 0 },
      ],
      water: [],
      mounds: [],
      mesas: [{ x: -14, z: -340, rx: 32, rz: 30, h: 6, cliff: 3, ramps: [{ a: [-14, -266], b: [-14, -306], w: 24 }] }],
    },
  ],
};

// The courses you can play: the first is the default.
const COURSES = [COURSE, GOLDEN_PLAINS];
COURSE.id = COURSE.id || 'pinehaven';
COURSE.title = COURSE.title || ['Pinehaven', 'Golf Club'];
COURSE.tagline = COURSE.tagline || 'Walk the course, take the cart, play all nine.';
function courseDef(id) { return COURSES.find((c) => c.id === id) || COURSES[0]; }
