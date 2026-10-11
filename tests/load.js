// Loads the game's pure-JS modules (no THREE, no DOM) into a Node context
// so physics and terrain can be tested headlessly.
const fs = require('fs');
const path = require('path');

const FILES = ['util.js', 'data.js', 'physics.js', 'course.js', 'terrain.js'];

module.exports = function load(names = FILES) {
  const src = names
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8'))
    .join('\n;\n');
  const exportsList = [
    'CLUBS', 'SURFACES', 'createBall', 'launchBall', 'startRoll', 'stepBall', 'simulateFlat',
    'fullSpeed', 'speedForCarry', 'spinFor', 'puttSpeedFor', 'DT', 'BALL_R', 'MPH', 'lieFactor', 'spinLieFactor', 'CHARACTERS', 'CADDY',
    'COURSE', 'buildCourse', 'placeHole', 'S_PATH', 'S_GREEN', 'S_FAIRWAY', 'S_WATER', 'S_SAND', 'S_ROUGH', 'S_DEEP', 'S_TEE', 'S_FRINGE', 'S_OOB',
    'dirFromYaw', 'yawFromDir',
  ];
  const body = src + '\nreturn {' + exportsList.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',') + '};';
  return new Function(body)();
};
