// Turn a KayKit Adventurers character (CC0, Kay Lousberg) into a golfer body
// for the game: drop the weapons and props, keep the clips the game uses
// (renamed to the names in tools/blender/ANIMATIONS.md), and drop animation
// tracks that don't move anything the mesh is bound to.
//
//   npm install @gltf-transform/core@4 @gltf-transform/functions@4
//   node prepare-kaykit.mjs Barbarian.glb ../../assets/golfer-surlaw.glb
//
// Source: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample } from '@gltf-transform/functions';

const [src, out] = process.argv.slice(2);
// KayKit clip -> the game's clip name.
const CLIPS = { Idle: 'idle', Walking_A: 'walk', Running_A: 'run' };
// Props hung on the hands and back.
const DROP = /axe|shield|mug|cape|crossbow|sword|dagger|staff|wand|spellbook|quiver|arrow/i;

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

for (const node of root.listNodes()) if (DROP.test(node.getName()) && node.getMesh()) node.dispose();

// Joints the mesh is actually weighted to.
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const weighted = new Set();
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
  const J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0');
  if (!J) continue;
  const a = [], w = [];
  for (let i = 0; i < J.getCount(); i++) {
    J.getElement(i, a); W.getElement(i, w);
    for (let k = 0; k < 4; k++) if (w[k] > 0) weighted.add(joints[a[k]]);
  }
}

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
for (const anim of root.listAnimations()) {
  const name = CLIPS[anim.getName()];
  if (!name) {
    for (const ch of anim.listChannels()) ch.dispose();
    for (const s of anim.listSamplers()) s.dispose(); // prune() then drops their keyframes
    anim.dispose();
    continue;
  }
  anim.setName(name);
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), path = ch.getTargetPath(), s = ch.getSampler();
    let drop = !weighted.has(node) || path === 'scale';
    if (!drop) {
      // A track that holds the rest pose throughout changes nothing.
      const rest = path === 'rotation' ? node.getRotation() : node.getTranslation();
      const v = [], o = s.getOutput();
      drop = true;
      for (let i = 0; i < o.getCount() && drop; i++) if (!near(o.getElement(i, v), rest)) drop = false;
    }
    if (drop) { ch.dispose(); s.dispose(); }
  }
}

await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune());
await io.write(out, doc);
