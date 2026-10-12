// ---------------------------------------------------------------------------
// Atmosphere: haze that thickens low down and warms towards the sun, cloud
// shadows drifting over the course, dust motes in the sunlight, and a
// post-processing pass (bloom, sun shafts through the trees, colour grade,
// vignette).
//
// The haze and cloud shadows are written into three.js's own shader chunks,
// so every material gets them without changes of its own.
// ---------------------------------------------------------------------------

const Atmosphere = (() => {
  // Values shared by every material. Plain objects (not THREE.Vector3) are
  // shared by reference when three.js copies a material's uniforms, so
  // changing them here reaches every material on its next draw.
  const shared = {
    sun: { x: 0, y: 1, z: 0 },               // direction towards the sun
    sunHaze: { x: 1, y: 0.8, z: 0.55 },      // haze colour looking into the sun (linear)
    haze: { x: 0, y: 0.02, z: 0 },           // density per yard (0 = plain fog), height falloff, ground height
    cloud: { x: 0, y: 0, z: 0 },             // drift offset x/z (yards), shadow strength
  };

  let patched = false;
  function patchShaders() {
    if (patched) return;
    patched = true;
    const C = THREE.ShaderChunk;
    C.common += `
uniform vec3 atmoSun;
uniform vec3 atmoSunHaze;
uniform vec3 atmoHaze;
uniform vec3 atmoCloud;
`;
    C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogView;\n#endif';
    C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;\n#endif';
    C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;');
    C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		vec3 fogCol = fogColor;
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		vec3 fogCol = fogColor;
		if ( atmoHaze.x > 0.0 ) {
			// Height fog integrated along the view ray, in world space.
			vec3 fogRay = vec3( dot( viewMatrix[ 0 ].xyz, vFogView ), dot( viewMatrix[ 1 ].xyz, vFogView ), dot( viewMatrix[ 2 ].xyz, vFogView ) );
			float fogT = length( fogRay );
			vec3 fogDir = fogRay / max( fogT, 1e-4 );
			float fogK = atmoHaze.y * fogDir.y * fogT;
			float fogOpt = atmoHaze.x * exp( - atmoHaze.y * ( cameraPosition.y - atmoHaze.z ) ) * fogT
				* ( abs( fogK ) > 1e-3 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0 );
			fogFactor = 1.0 - exp( - fogOpt );
			fogCol = mix( fogColor, atmoSunHaze, pow( max( dot( fogDir, atmoSun ), 0.0 ), 5.0 ) );
		}
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
    // Cloud shadows dim the direct (sun) light only.
    C.lights_pars_begin += `
float atmoHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float atmoNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( atmoHash( i ), atmoHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( atmoHash( i + vec2( 0.0, 1.0 ) ), atmoHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float atmoCloudShade( vec3 viewPos ) {
	if ( atmoCloud.z <= 0.0 ) return 1.0;
	vec3 w = cameraPosition + vec3( dot( viewMatrix[ 0 ].xyz, viewPos ), dot( viewMatrix[ 1 ].xyz, viewPos ), dot( viewMatrix[ 2 ].xyz, viewPos ) );
	// Follow the sun's ray up to the cloud layer.
	vec2 p = ( w.xz - atmoSun.xz * ( w.y / max( atmoSun.y, 0.1 ) ) + atmoCloud.xy ) / 240.0;
	float n = atmoNoise( p ) * 0.62 + atmoNoise( p * 2.7 + 5.3 ) * 0.38;
	return 1.0 - atmoCloud.z * smoothstep( 0.56, 0.76, n );
}
`;
    C.lights_fragment_end += `
	float atmoShade = atmoCloudShade( geometryPosition );
	reflectedLight.directDiffuse *= atmoShade;
	reflectedLight.directSpecular *= atmoShade;
`;
    const add = {
      atmoSun: { value: shared.sun }, atmoSunHaze: { value: shared.sunHaze },
      atmoHaze: { value: shared.haze }, atmoCloud: { value: shared.cloud },
    };
    for (const k in THREE.ShaderLib) Object.assign(THREE.ShaderLib[k].uniforms, add);
  }

  // ---------- dust motes ------------------------------------------------------
  // Specks drifting in a box that travels with the camera; they catch the
  // light when you look towards the sun.
  function createMotes(count = 420) {
    const SIZE = 46;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    const rnd = mulberry32(911);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd() * SIZE; pos[i * 3 + 1] = rnd() * 16; pos[i * 3 + 2] = rnd() * SIZE;
      seed[i] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() },
        uScale: { value: 600 }, uColor: { value: new THREE.Color(1.0, 0.86, 0.62) },
      },
      vertexShader: `
        attribute float seed;
        uniform float uTime, uScale; uniform vec3 uCam, uSun;
        varying float vA;
        void main() {
          vec3 p = position + vec3(sin(uTime * 0.21 + seed * 40.0) * 2.0, sin(uTime * 0.13 + seed * 17.0) * 1.5, cos(uTime * 0.17 + seed * 23.0) * 2.0)
                 + vec3(uTime * 0.6, 0.0, uTime * 0.25);
          vec3 box = vec3(${SIZE.toFixed(1)}, 16.0, ${SIZE.toFixed(1)});
          vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
          vec3 wp = uCam + rel;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          float px = uScale * (0.014 + 0.012 * seed) / max(d, 0.5);
          gl_PointSize = clamp(px, 1.0, 5.0);
          vec3 v = normalize(wp - uCam);
          float scatter = 0.12 + 1.6 * pow(max(dot(v, uSun), 0.0), 6.0);
          float edge = (1.0 - smoothstep(14.0, 23.0, length(rel.xz))) * smoothstep(0.6, 2.5, d);
          vA = scatter * edge * min(px, 1.0) * (0.55 + 0.45 * sin(uTime * (0.7 + seed) + seed * 50.0));
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c));
          gl_FragColor = vec4(uColor * a * vA * 0.9, 1.0);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    pts.update = (dt, camera, sunDir, pixelHeight) => {
      mat.uniforms.uTime.value += dt;
      mat.uniforms.uCam.value.copy(camera.position);
      mat.uniforms.uSun.value.copy(sunDir);
      mat.uniforms.uScale.value = pixelHeight / (2 * Math.tan((camera.fov * DEG) / 2));
    };
    return pts;
  }

  // ---------- post-processing ------------------------------------------------
  const VS = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const FS_BRIGHT = `
    uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; varying vec2 vUv;
    void main() {
      vec3 c = (texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb
              + texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb) * 0.25;
      float l = max(c.r, max(c.g, c.b));
      float k = clamp(l - threshold + 0.6, 0.0, 1.2);
      k = k * k / 2.4;
      gl_FragColor = vec4(c * max(k, l - threshold) / max(l, 1e-4), 1.0);
    }`;
  const FS_DOWN = `
    uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
    void main() {
      gl_FragColor = vec4((texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb
                         + texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb) * 0.25, 1.0);
    }`;
  const FS_BLUR = `
    uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
      c += (texture2D(tSrc, vUv + dir * 1.3846153846).rgb + texture2D(tSrc, vUv - dir * 1.3846153846).rgb) * 0.3162162162;
      c += (texture2D(tSrc, vUv + dir * 3.2307692308).rgb + texture2D(tSrc, vUv - dir * 3.2307692308).rgb) * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`;
  // What can shine through towards the camera: open sky around the sun. The
  // sky writes alpha 0 and everything in front of it alpha 1 (clouds part way).
  const FS_SHAFT_MASK = `
    uniform sampler2D tSrc; uniform vec2 texel; uniform vec2 sunUv; uniform float aspect; varying vec2 vUv;
    void main() {
      vec4 c = (texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)) + texture2D(tSrc, vUv + texel * vec2(1.0, 1.0))) * 0.5;
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec2 d = (vUv - sunUv) * vec2(aspect, 1.0);
      float m = (1.0 - c.a) * (0.3 + 0.7 * smoothstep(0.5, 1.6, l)) * exp(-dot(d, d) * 3.5);
      gl_FragColor = vec4(vec3(m), 1.0);
    }`;
  const FS_SHAFT_BLUR = `
    uniform sampler2D tSrc; uniform vec2 sunUv; uniform float span; varying vec2 vUv;
    void main() {
      vec2 delta = (sunUv - vUv) * span / 32.0;
      vec2 uv = vUv;
      float acc = 0.0, w = 1.0, ws = 0.0;
      for (int i = 0; i < 32; i++) {
        acc += texture2D(tSrc, uv).r * w;
        ws += w;
        w *= 0.97;
        uv += delta;
      }
      gl_FragColor = vec4(vec3(acc / ws), 1.0);
    }`;
  const FS_COMPOSITE = `
    uniform sampler2D tScene, tBloom1, tBloom2, tShafts;
    uniform vec3 shaftColor; uniform vec2 bloomK, sunUv; uniform float exposure, vignette, saturation, debug, aspect, grade;
    varying vec2 vUv;
    vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      return clamp(outM * rrtOdt(inM * (c / 0.6)), 0.0, 1.0);
    }
    vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec3 c = texture2D(tScene, vUv).rgb;
      c += texture2D(tBloom1, vUv).rgb * bloomK.x + texture2D(tBloom2, vUv).rgb * bloomK.y;
      // Only the beams: the even glow between them is dropped.
      // Shafts are strongest near the sun and fade across the screen.
      vec2 sd = (vUv - sunUv) * vec2(aspect, 1.0);
      float sh = max(texture2D(tShafts, vUv).r - 0.05, 0.0) * exp(-dot(sd, sd) * 1.6);
      c += shaftColor * sh * 1.25;
      c = aces(c * exposure);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, saturation), 0.0);
      // Cool shadows, warm highlights.
      c *= mix(vec3(1.0), mix(vec3(0.95, 0.98, 1.05), vec3(1.025, 1.0, 0.97), smoothstep(0.04, 0.65, l)), grade);
      vec2 v = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.12, 0.62, dot(v, v) * 1.6);
      if (debug > 0.5) c = vec3(texture2D(tShafts, vUv).r);
      c = toSrgb(clamp(c, 0.0, 1.0));
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`;

  function createPost(renderer) {
    const caps = renderer.capabilities;
    const hdr = caps.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const target = (opts) => new THREE.WebGLRenderTarget(1, 1, Object.assign({ type, depthBuffer: false }, opts));
    const rt = {
      scene: target({ depthBuffer: true, samples: caps.isWebGL2 ? 4 : 0 }),
      b1: target(), b1t: target(), b2: target(), b2t: target(), s1: target(), s2: target(),
    };
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri);
    quad.frustumCulled = false;
    const qScene = new THREE.Scene();
    qScene.add(quad);
    const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const shader = (fs, uniforms) => new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const tex = () => ({ value: null }), v2 = () => ({ value: new THREE.Vector2() });
    const M = {
      bright: shader(FS_BRIGHT, { tSrc: tex(), texel: v2(), threshold: { value: 1.5 } }),
      down: shader(FS_DOWN, { tSrc: tex(), texel: v2() }),
      blur: shader(FS_BLUR, { tSrc: tex(), dir: v2() }),
      mask: shader(FS_SHAFT_MASK, { tSrc: tex(), texel: v2(), sunUv: v2(), aspect: { value: 1 } }),
      rays: shader(FS_SHAFT_BLUR, { tSrc: tex(), sunUv: v2(), span: { value: 1 } }),
      comp: shader(FS_COMPOSITE, {
        tScene: tex(), tBloom1: tex(), tBloom2: tex(), tShafts: tex(),
        shaftColor: { value: new THREE.Color() }, bloomK: { value: new THREE.Vector2(0.55, 0.35) },
        exposure: { value: 1 }, vignette: { value: 0.22 }, saturation: { value: 1.0 }, debug: { value: 0 },
        sunUv: v2(), aspect: { value: 1 }, grade: { value: 1 },
      }),
    };
    function pass(mat, out) {
      quad.material = mat;
      renderer.setRenderTarget(out);
      renderer.render(qScene, qCam);
    }
    function blur(src, tmp, w, h) {
      M.blur.uniforms.tSrc.value = src.texture;
      M.blur.uniforms.dir.value.set(1 / w, 0);
      pass(M.blur, tmp);
      M.blur.uniforms.tSrc.value = tmp.texture;
      M.blur.uniforms.dir.value.set(0, 1 / h);
      pass(M.blur, src);
    }

    let W = 1, H = 1;
    const size = new THREE.Vector2();
    function setSize() {
      renderer.getDrawingBufferSize(size);
      W = Math.max(1, size.x); H = Math.max(1, size.y);
      rt.scene.setSize(W, H);
      const q = (k) => [Math.max(1, Math.round(W / k)), Math.max(1, Math.round(H / k))];
      for (const r of [rt.b1, rt.b1t]) r.setSize(...q(4));
      for (const r of [rt.s1, rt.s2]) r.setSize(...q(2));
      for (const r of [rt.b2, rt.b2t]) r.setSize(...q(8));
    }

    const sunP = new THREE.Vector3(), fwd = new THREE.Vector3();
    const params = { shafts: 1.0, shaftColor: new THREE.Color(1.0, 0.84, 0.62), bloom: 1, exposure: 1, vignette: 0.22, grade: 1, debug: false };
    function render(scene, camera, sunDir) {
      renderer.getDrawingBufferSize(size);
      if (size.x !== W || size.y !== H) setSize();
      renderer.setRenderTarget(rt.scene);
      renderer.render(scene, camera);

      const [qw, qh] = [rt.b1.width, rt.b1.height];
      M.bright.uniforms.tSrc.value = rt.scene.texture;
      M.bright.uniforms.texel.value.set(1 / W, 1 / H);
      pass(M.bright, rt.b1);
      M.down.uniforms.tSrc.value = rt.b1.texture;
      M.down.uniforms.texel.value.set(0.5 / qw, 0.5 / qh);
      pass(M.down, rt.b2);
      blur(rt.b1, rt.b1t, qw, qh);
      blur(rt.b2, rt.b2t, rt.b2.width, rt.b2.height);

      // Sun shafts, when the sun is in front of the camera and near the screen.
      camera.getWorldDirection(fwd);
      sunP.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      const facing = smoothstep(0.05, 0.45, fwd.dot(sunDir));
      const off = Math.max(Math.abs(sunP.x), Math.abs(sunP.y));
      const vis = facing * (1 - smoothstep(1.1, 2.2, off)) * params.shafts;
      const su = sunP.x * 0.5 + 0.5, sv = sunP.y * 0.5 + 0.5;
      M.comp.uniforms.sunUv.value.set(su, sv);
      M.comp.uniforms.aspect.value = W / H;
      if (vis > 0.01) {
        M.mask.uniforms.tSrc.value = rt.scene.texture;
        M.mask.uniforms.texel.value.set(1 / W, 1 / H);
        M.mask.uniforms.sunUv.value.set(su, sv);
        M.mask.uniforms.aspect.value = W / H;
        pass(M.mask, rt.s1);
        M.rays.uniforms.sunUv.value.set(su, sv);
        M.rays.uniforms.tSrc.value = rt.s1.texture;
        M.rays.uniforms.span.value = 1.0;
        pass(M.rays, rt.s2);
        M.rays.uniforms.tSrc.value = rt.s2.texture;
        M.rays.uniforms.span.value = 1.0 / 32;
        pass(M.rays, rt.s1);
      }
      const U = M.comp.uniforms;
      U.tScene.value = rt.scene.texture;
      U.tBloom1.value = rt.b1.texture;
      U.tBloom2.value = rt.b2.texture;
      U.tShafts.value = rt.s1.texture;
      U.shaftColor.value.copy(params.shaftColor).multiplyScalar(vis);
      U.bloomK.value.set(0.32 * params.bloom, 0.16 * params.bloom);
      U.exposure.value = params.exposure;
      U.vignette.value = params.vignette;
      U.grade.value = params.grade;
      U.debug.value = params.debug ? 1 : 0;   // shows the shafts alone
      pass(M.comp, null);
    }
    return { render, setSize, params, hdr };
  }

  return { shared, patchShaders, createMotes, createPost };
})();
