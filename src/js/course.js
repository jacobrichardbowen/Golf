// ---------------------------------------------------------------------------
// Pinehaven — 9 holes, par 36, laid out as one walkable course. All
// coordinates are in yards. Each hole is designed in its own frame (tee at the
// origin, play heading towards -Z) and placed on the course with
//   at       [x, z, heading]  world position of the tee; heading in degrees,
//            0 = north (-Z), 90 = east (+X)
//   flip     mirror the design left-to-right
//   cartSide which side of the hole the cart path runs (1 right, -1 left)
//
//   path     centre line of the hole: tee -> ... -> centre of the green
//   fairway  { start: yards from tee where the short grass begins, width }
//   green    { r: radius, tilt: [rise per yard in x, rise per yard in z] }
//   pin      flag position relative to the centre of the green
//   bunkers / water: rotated ellipses { x, z, rx, rz, rot (degrees) }
//   mounds   gaussian bumps { x, z, r, h } to shape elevation
//   wind     [min, max] mph
// ---------------------------------------------------------------------------

const COURSE = {
  name: 'Pinehaven',
  seed: 7,
  hills: 5,
  // The clubhouse sits beside the first tee; the cart is parked out front.
  clubhouse: { x: 52, z: 42, heading: 0 },
  cartStart: { x: 26, z: 26, heading: 0 },
  holes: [
    {
      name: 'First Light', par: 4, seed: 11, at: [0, 0, 0], wind: [2, 7],
      path: [[0, 0], [0, -235], [-14, -372]],
      fairway: { start: 45, width: 36 },
      green: { r: 15, tilt: [0.006, -0.016] },
      pin: [3, -4],
      bunkers: [
        { x: 22, z: -240, rx: 8, rz: 15, rot: 10 },
        { x: -37, z: -366, rx: 6, rz: 11, rot: -10 },
        { x: 4, z: -350, rx: 9, rz: 4.5, rot: -25 },
      ],
      water: [],
      mounds: [{ x: -14, z: -372, r: 28, h: 1.5 }],
    },
    {
      name: 'Glass Pond', par: 3, seed: 23, at: [-35, -400, 270], wind: [3, 10],
      path: [[0, 0], [6, -162]],
      fairway: { start: 128, width: 26 },
      green: { r: 14, tilt: [-0.008, -0.012] },
      pin: [-4, 2],
      bunkers: [
        { x: -16, z: -178, rx: 7, rz: 5, rot: 30 },
        { x: 26, z: -158, rx: 5, rz: 9, rot: 0 },
      ],
      water: [{ x: 2, z: -84, rx: 30, rz: 34, rot: 15 }],
      mounds: [{ x: 6, z: -162, r: 30, h: 1.5 }],
    },
    {
      name: 'Long Way Round', par: 5, seed: 37, at: [-228, -372, 180], wind: [4, 12],
      path: [[0, 0], [0, -250], [-55, -400], [-70, -525]],
      fairway: { start: 50, width: 40 },
      green: { r: 16, tilt: [0.010, -0.010] },
      pin: [-5, -5],
      bunkers: [
        { x: -26, z: -258, rx: 9, rz: 12, rot: -20 },
        { x: 26, z: -292, rx: 8, rz: 14, rot: -10 },
        { x: -93, z: -512, rx: 7, rz: 12, rot: 10 },
        { x: -52, z: -543, rx: 8, rz: 6, rot: -20 },
      ],
      water: [{ x: -8, z: -432, rx: 22, rz: 38, rot: -15 }],
      mounds: [{ x: -70, z: -525, r: 30, h: 2 }],
    },
    {
      name: 'The Cape', par: 4, seed: 41, at: [-110, 195, 90], wind: [3, 11],
      path: [[0, 0], [0, -225], [60, -330], [78, -395]],
      fairway: { start: 55, width: 34 },
      green: { r: 14, tilt: [-0.012, -0.006] },
      pin: [4, -3],
      bunkers: [
        { x: -24, z: -245, rx: 8, rz: 16, rot: 5 },
        { x: 99, z: -390, rx: 6, rz: 10, rot: -15 },
        { x: 64, z: -414, rx: 8, rz: 5, rot: 20 },
      ],
      water: [{ x: 56, z: -232, rx: 28, rz: 42, rot: -25 }],
      mounds: [],
    },
    {
      name: "Eagle's Perch", par: 3, seed: 53, at: [318, 250, 0], wind: [5, 14],
      path: [[0, 0], [-8, -142]],
      fairway: { start: 112, width: 22 },
      green: { r: 13, tilt: [0.006, -0.020] },
      pin: [2, -3],
      bunkers: [
        { x: -27, z: -140, rx: 5, rz: 9, rot: 10 },
        { x: 10, z: -127, rx: 6, rz: 5, rot: -30 },
        { x: -6, z: -164, rx: 9, rz: 4, rot: 0 },
      ],
      water: [],
      mounds: [{ x: -8, z: -142, r: 34, h: 6 }],
    },
    {
      name: 'Creek Crossing', par: 4, seed: 67, at: [322, 75, 0], wind: [2, 9],
      path: [[0, 0], [12, -215], [2, -345]],
      fairway: { start: 45, width: 34 },
      green: { r: 15, tilt: [0.008, -0.012] },
      pin: [-3, -4],
      bunkers: [
        { x: -14, z: -205, rx: 7, rz: 12, rot: 0 },
        { x: 38, z: -225, rx: 7, rz: 12, rot: 10 },
        { x: 21, z: -362, rx: 6, rz: 8, rot: 0 },
      ],
      water: [{ x: 6, z: -292, rx: 50, rz: 8, rot: -5 }],
      mounds: [{ x: 2, z: -345, r: 26, h: 1.2 }],
    },
    {
      name: 'Serpentine', par: 5, seed: 79, at: [330, -305, 0], wind: [4, 12],
      path: [[0, 0], [-28, -200], [22, -370], [2, -490]],
      fairway: { start: 50, width: 36 },
      green: { r: 15, tilt: [-0.006, -0.014] },
      pin: [-4, 3],
      bunkers: [
        { x: -52, z: -210, rx: 8, rz: 12, rot: -10 },
        { x: -2, z: -218, rx: 6, rz: 9, rot: 20 },
        { x: 46, z: -375, rx: 7, rz: 12, rot: 0 },
        { x: -20, z: -488, rx: 6, rz: 10, rot: 0 },
        { x: 23, z: -497, rx: 5, rz: 8, rot: 0 },
      ],
      water: [{ x: -42, z: -340, rx: 20, rz: 30, rot: 20 }],
      mounds: [],
    },
    {
      name: 'Long Iron', par: 3, seed: 83, at: [300, -820, 270], wind: [3, 10],
      path: [[0, 0], [-4, -205]],
      fairway: { start: 150, width: 26 },
      green: { r: 16, tilt: [0.004, -0.012] },
      pin: [3, 3],
      bunkers: [
        { x: -22, z: -190, rx: 6, rz: 9, rot: -15 },
        { x: 15, z: -185, rx: 6, rz: 8, rot: 15 },
        { x: -3, z: -229, rx: 10, rz: 4, rot: 0 },
      ],
      water: [{ x: 42, z: -140, rx: 16, rz: 42, rot: 5 }],
      mounds: [],
    },
    {
      name: 'Homecoming', par: 5, seed: 97, at: [150, -778, 180], wind: [3, 12],
      path: [[0, 0], [-10, -260], [22, -400], [32, -500]],
      fairway: { start: 50, width: 38 },
      green: { r: 15, tilt: [0.010, -0.008] },
      pin: [4, -2],
      bunkers: [
        { x: 26, z: -262, rx: 8, rz: 14, rot: -10 },
        { x: -36, z: -282, rx: 7, rz: 10, rot: 0 },
        { x: 54, z: -505, rx: 6, rz: 10, rot: 0 },
        { x: 37, z: -524, rx: 9, rz: 4, rot: -10 },
      ],
      water: [{ x: -14, z: -470, rx: 24, rz: 44, rot: 10 }],
      mounds: [{ x: 32, z: -500, r: 26, h: 1 }],
    },
  ],
};
