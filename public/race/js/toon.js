// 卡通渲染：移植自梦想人生（public/dream/app.html 的 toon 着色器和描线后处理），改成平地世界：
// - 噪声按世界坐标（米）取样，不再经过星球的逆矩阵；
// - 顶点着色器里按到相机的水平距离把远处往下压（y -= max(0, d - d0)² · k），平地看起来像小星球的弧面，
//   近处 d0 以内完全不弯，所以车、路面和阴影都不受影响；
// - 后处理多了远景雾气（按深度）和氮气时的速度线。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const NOISE_GLSL = /* glsl */`
float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return 0.55*vn(p) + 0.3*vn(p*2.13+3.1) + 0.15*vn(p*4.37+7.7); }
`;

// 所有 toon 材质共享的 uniform
export const G = {
  uToon: { value: 1 }, uBreak: { value: 1 }, uInk: { value: new THREE.Color(0x2a3238) },
  uTime: { value: 0 }, uWater: { value: -1.0 },
  uBend: { value: 1 / 3400 }, uBendStart: { value: 140 },
};

const BEND_GLSL = /* glsl */`
uniform float uBend; uniform float uBendStart;
vec4 bendWorld(vec4 wp){
  float d = max(length(wp.xz - cameraPosition.xz) - uBendStart, 0.0);
  wp.y -= d * d * uBend;
  return wp;
}`;

const TOON_VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
${BEND_GLSL}
attribute float aPath;
#ifdef VCOL
  attribute vec3 aLit; attribute vec3 aShd;
  varying vec3 vLitC; varying vec3 vShdC;
#endif
varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying vec3 vCol; varying vec2 vUv; varying float vPath;
void main(){
  #ifdef VCOL
    vLitC = aLit; vShdC = aShd;
  #endif
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vN = normalize(transformedNormal);
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vW = wp.xyz; vObj = position; vUv = uv;
  vCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  #ifdef USE_PATH
    vPath = aPath;
  #else
    vPath = 0.0;
  #endif
  gl_Position = projectionMatrix * viewMatrix * bendWorld(wp);
}`;

const TOON_FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uInk;
uniform float uToon; uniform float uBreak; uniform float uBreakMul; uniform float uNoiseScale;
uniform float uTime; uniform float uWater; uniform float uGlow;
#ifdef USE_TMAP
  uniform sampler2D uMap;
#endif
#ifdef VCOL
  varying vec3 vLitC; varying vec3 vShdC;
#endif
varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying vec3 vCol; varying vec2 vUv; varying float vPath;
${NOISE_GLSL}
void main(){
  vec3 N = normalize(vN);
  vec3 L = directionalLights[0].direction;
  float ndl = dot(N, L);
  #ifdef LOCALNOISE
    vec3 P = vObj * uNoiseScale * 3.0;
  #else
    vec3 P = vW * 0.11 * uNoiseScale;
  #endif
  float n = fbm(P * 2.2) - 0.5;
  float n2 = vn(P * 9.0) - 0.5;
  float brk = uBreak * uBreakMul * (n * 0.9 + n2 * 0.35);
  float sh = getShadowMask();

  // toon：硬分界、噪声打碎边缘
  float litT = smoothstep(-0.015, 0.015, ndl - 0.04 + brk);
  float shT = smoothstep(0.47, 0.53, sh + brk * 0.9);
  float litS = clamp(ndl * 0.85 + 0.25, 0.0, 1.0);
  float l = mix(litS * sh, litT * shT, uToon);

  #ifdef VCOL
    vec3 lc = vLitC * vCol, sc = vShdC * vCol;
  #else
    vec3 lc = uLit * vCol, sc = uShade * vCol;
  #endif

  #ifdef GROUND
    // 草地上的斑驳、林下（高处）偏冷、水边一圈湿沙，铺装区域（vPath）是浅石板
    vec3 Pg = vW * 0.035;
    float wob = (fbm(Pg * 1.1) - 0.5) * 0.5 + n2 * 0.12;
    float dapple = smoothstep(0.6, 0.63, fbm(Pg * 0.55 + 11.0));
    lc = mix(lc, lc * vec3(1.05, 1.08, 0.96) + vec3(0.02, 0.03, 0.0), dapple);
    sc = mix(sc, sc * vec3(1.04, 1.06, 1.0), dapple);
    float high = smoothstep(8.0, 30.0, vW.y);
    lc = mix(lc, lc * vec3(0.84, 0.92, 0.88), high); sc = mix(sc, sc * vec3(0.88, 0.92, 0.94), high);
    float shore = 1.0 - smoothstep(0.25, 0.9, vW.y - uWater + wob * 0.6);
    lc = mix(lc, vec3(0.82, 0.78, 0.62), shore * 0.85); sc = mix(sc, vec3(0.56, 0.58, 0.6), shore * 0.85);
    float path = smoothstep(0.52, 0.56, vPath + wob * 0.6);
    lc = mix(lc, vec3(0.90, 0.85, 0.71), path); sc = mix(sc, vec3(0.62, 0.64, 0.68), path);
    float edge = smoothstep(0.495, 0.52, vPath + wob * 0.6) - smoothstep(0.52, 0.545, vPath + wob * 0.6);
  #endif

  #ifdef ROAD
    // vUv.x：横向 0..1；vUv.y：沿路距离（米）。vPath：0 沥青、1 石板（苏堤、断桥）
    float u = vUv.x, v = vUv.y;
    vec3 aL = vec3(0.58, 0.61, 0.64), aS = vec3(0.41, 0.45, 0.53);
    vec3 sL = vec3(0.90, 0.85, 0.71), sS = vec3(0.62, 0.64, 0.68);
    float stone = step(0.5, vPath);
    lc = mix(aL, sL, stone); sc = mix(aS, sS, stone);
    float grain = (vn(vec3(u * 40.0, v * 0.9, 1.0)) - 0.5);
    lc += grain * 0.025; sc += grain * 0.02;
    // 石板缝
    float joint = stone * max(step(0.92, fract(v / 1.3 + step(0.5, fract(u * 11.0)) * 0.5)), step(0.93, fract(u * 11.0)));
    lc = mix(lc, lc * 0.9, joint * 0.6); sc = mix(sc, sc * 0.92, joint * 0.6);
    float edgeL = (step(0.035, u) - step(0.05, u)) + (step(0.95, u) - step(0.965, u));
    float dash = (1.0 - stone) * step(abs(u - 0.5), 0.0055) * step(0.5, fract(v / 12.0));
    float markW = clamp(edgeL * (1.0 - stone) + dash, 0.0, 1.0);
  #endif

  #ifdef WATER
    float rip = fbm(P * 0.55 + vec3(uTime * 0.12, 0.0, uTime * 0.08));
    float stroke = smoothstep(0.6, 0.612, rip) * (1.0 - smoothstep(0.628, 0.64, rip)) * step(0.45, vn(P * 1.6 + vec3(0.0, uTime * 0.2, 0.0)));
    lc = mix(lc, lc * 1.08 + 0.03, smoothstep(0.55, 0.56, rip));
  #endif

  #ifdef FOLIAGE
    float fleck = step(0.74, vn(P * 6.5 + 3.0));
    lc = mix(lc, mix(lc, sc, 0.55), fleck * uBreak);
    sc = mix(sc, mix(sc, lc, 0.35), step(0.8, vn(P * 7.0 + 9.0)) * uBreak);
  #endif

  vec3 c = mix(sc, lc, l);

  #ifdef GROUND
    c = mix(c, uInk, edge * 0.5 * uBreak);
  #endif
  #ifdef ROAD
    c = mix(c, mix(vec3(0.78, 0.8, 0.8), vec3(0.95, 0.95, 0.91), l), markW * 0.9);
  #endif
  #ifdef WATER
    c = mix(c, vec3(0.93, 0.97, 0.96), stroke * 0.8);
  #endif
  #ifdef GLASS
    float s1 = fract(dot(P * 2.0, vec3(0.55, 0.9, 0.35)) * 0.9);
    float sheen = step(0.86, s1) * step(s1, 0.93) + step(0.95, s1) * step(s1, 0.97);
    c = mix(c, vec3(0.95, 0.97, 0.98), sheen * (0.2 + 0.4 * l));
  #endif
  #ifdef ROCK
    float crack = 1.0 - smoothstep(0.0, 0.018, abs(fbm(P * 2.6) - 0.5));
    crack *= step(0.45, vn(P * 1.3 + 4.0));
    c = mix(c, uInk, crack * 0.75 * uBreak);
  #endif
  #ifdef GLOW
    #ifdef VCOL
      c = vLitC * vCol * uGlow;
    #else
      c = uLit * vCol * uGlow;
    #endif
  #endif
  #ifdef USE_TMAP
    vec4 tx = texture2D(uMap, vUv);
    c = mix(c, tx.rgb * (0.86 + 0.14 * l), tx.a);
  #endif

  gl_FragColor = vec4(c, 1.0);
}`;

export const shadeOf = hex => {
  const c = new THREE.Color(hex);
  return new THREE.Color(c.r * 0.6 + 0.02, c.g * 0.64 + 0.04, c.b * 0.74 + 0.09);
};
const matCache = new Map();
export function toon(hex, opts = {}) {
  const { map, ...rest } = opts;
  const key = hex + JSON.stringify(rest) + (map ? map.uuid : '');
  if (matCache.has(key)) return matCache.get(key);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
    uLit: { value: new THREE.Color(hex) },
    uShade: { value: opts.shade != null ? new THREE.Color(opts.shade) : shadeOf(hex) },
    uBreakMul: { value: opts.breakMul ?? 0.45 },
    uNoiseScale: { value: opts.noiseScale ?? 1 },
    uGlow: { value: opts.glow ?? 1 },
  }]);
  Object.assign(uniforms, G);
  const defines = {};
  if (opts.map) { uniforms.uMap = { value: opts.map }; defines.USE_TMAP = ''; }
  if (opts.kind) defines[opts.kind] = '';
  if (opts.local) defines.LOCALNOISE = '';
  if (opts.path) defines.USE_PATH = '';
  if (opts.vcol) defines.VCOL = '';
  const m = new THREE.ShaderMaterial({
    uniforms, defines, vertexShader: TOON_VERT, fragmentShader: TOON_FRAG, lights: true,
    side: opts.side ?? THREE.FrontSide,
    polygonOffset: !!opts.offset, polygonOffsetFactor: opts.offset || 0, polygonOffsetUnits: opts.offset || 0,
  });
  matCache.set(key, m);
  return m;
}
export function mesh(geo, hex, opts = {}) {
  const m = new THREE.Mesh(geo, toon(hex, opts));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  return m;
}

// 法线 + 深度 pass 用的材质：和 toon 一样弯曲，否则描线会和画面错位
export const normalMat = new THREE.ShaderMaterial({
  uniforms: { uBend: G.uBend, uBendStart: G.uBendStart },
  vertexShader: /* glsl */`
    #include <common>
    ${BEND_GLSL}
    varying vec3 vN;
    void main(){
      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      vN = normalize(transformedNormal);
      vec4 wp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
      #endif
      gl_Position = projectionMatrix * viewMatrix * bendWorld(modelMatrix * wp);
    }`,
  fragmentShader: /* glsl */`varying vec3 vN; void main(){ gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }`,
});

// ---------- 后处理：天空、描线、雾气、纸纹、速度线 ----------
export function createPost(camera) {
  const rtColor = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
  const rtNormal = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
  const post = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: rtColor.texture }, tNormal: { value: rtNormal.texture }, tDepth: { value: rtNormal.depthTexture },
      uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: camera.near }, uFar: { value: camera.far },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uTime: { value: 0 }, uLine: { value: 1 }, uLineW: { value: 1.2 }, uGrain: { value: 1 },
      uInk: G.uInk, uSpeed: { value: 0 }, uHaze: { value: new THREE.Color(0.80, 0.91, 0.90) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tColor, tNormal, tDepth;
      uniform vec2 uRes; uniform float uNear, uFar, uTime, uLine, uLineW, uGrain, uSpeed;
      uniform mat4 uInvProj, uCamWorld; uniform vec3 uInk, uHaze;
      varying vec2 vUv;
      ${NOISE_GLSL}
      float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
      float hash2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 skyCol(vec3 dir){
        float y = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 top = vec3(0.40, 0.73, 0.80), hor = vec3(0.80, 0.93, 0.90);
        vec3 c = mix(hor, top, smoothstep(0.45, 0.95, y));
        vec2 p = dir.xz / (dir.y + 0.55) * 1.3 + vec2(uTime * 0.012, 0.0);
        float f = fbm(vec3(p * 0.9, 1.7)) + (vn(vec3(p * 7.0, 3.0)) - 0.5) * 0.07;
        float f2 = fbm(vec3(p * 0.9 + vec2(0.0, 0.12), 1.7));
        float body = smoothstep(0.585, 0.595, f) * smoothstep(-0.35, 0.0, dir.y);
        vec3 cloud = mix(vec3(0.95, 0.985, 0.965), vec3(0.78, 0.89, 0.90), 1.0 - smoothstep(0.6, 0.61, f2));
        return mix(c, cloud, body);
      }
      void main(){
        vec2 uv = vUv;
        // 速度线：氮气时画面四周往中心收的径向条纹（只在边缘）
        vec2 cc = uv - 0.5; float rr = length(cc * vec2(uRes.x / uRes.y, 1.0));
        vec4 col = texture2D(tColor, uv);
        vec4 ndc = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
        vec4 v = uInvProj * ndc; v /= v.w;
        vec3 dir = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
        vec3 sky = skyCol(dir);
        float d0 = lin(texture2D(tDepth, uv).r);
        float isGeo = step(d0, uFar * 0.98);
        // 远景雾气：越远越接近地平线的天色
        float haze = smoothstep(260.0, 1500.0, d0) * 0.72 * isGeo;
        vec3 c = mix(sky, col.rgb, col.a);
        c = mix(c, uHaze, haze);

        if (uLine > 0.5) {
          float wob = vn(vec3(uv * uRes / 22.0, 0.0)) - 0.5;
          vec2 px = uLineW * (1.0 + wob * 0.7) / uRes;
          float dl = lin(texture2D(tDepth, uv - vec2(px.x, 0)).r), dr = lin(texture2D(tDepth, uv + vec2(px.x, 0)).r);
          float dd = lin(texture2D(tDepth, uv - vec2(0, px.y)).r), du = lin(texture2D(tDepth, uv + vec2(0, px.y)).r);
          float lap = abs(dl + dr + dd + du - 4.0 * d0) / max(d0, 0.001);
          float eD = smoothstep(0.06, 0.16, lap);
          vec3 n0 = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
          vec3 nl = texture2D(tNormal, uv - vec2(px.x, 0)).xyz * 2.0 - 1.0, nr = texture2D(tNormal, uv + vec2(px.x, 0)).xyz * 2.0 - 1.0;
          vec3 nd = texture2D(tNormal, uv - vec2(0, px.y)).xyz * 2.0 - 1.0, nu = texture2D(tNormal, uv + vec2(0, px.y)).xyz * 2.0 - 1.0;
          float nn = (1.0 - dot(n0, nl)) + (1.0 - dot(n0, nr)) + (1.0 - dot(n0, nd)) + (1.0 - dot(n0, nu));
          float eN = smoothstep(0.55, 1.0, nn) * isGeo;
          // 描线随距离淡出：近处满墨，200 米外渐淡，远山只剩轮廓
          float fade = 1.0 - smoothstep(120.0, 520.0, d0) * 0.75;
          float e = max(eD, eN * (1.0 - smoothstep(160.0, 420.0, d0))) * fade;
          c = mix(c, mix(uInk, uHaze, haze * 0.8), e * 0.85);
        }
        if (uSpeed > 0.001) {
          float a = atan(cc.y, cc.x);
          float streak = step(0.82, vn(vec3(a * 38.0, uTime * 9.0, 0.0)));
          float ring = smoothstep(0.32, 0.62, rr);
          c = mix(c, vec3(0.97, 0.99, 0.98), streak * ring * uSpeed * 0.55);
        }
        if (uGrain > 0.5) {
          float g = hash2(floor(uv * uRes) + floor(uTime * 12.0) * 17.0) - 0.5;
          float paper = vn(vec3(uv * uRes / 3.0, 5.0)) - 0.5;
          c += g * 0.025 + paper * 0.03;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  quad.frustumCulled = false;
  postScene.add(quad);

  return {
    post,
    setSize(W, H, pr) {
      rtColor.setSize(W, H); rtNormal.setSize(W, H);
      post.uniforms.uRes.value.set(W, H);
      post.uniforms.uLineW.value = Math.max(1, 1.15 * pr);
    },
    render(renderer, scene, cam, { lines = true, layer1 = true } = {}) {
      post.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
      post.uniforms.uCamWorld.value.copy(cam.matrixWorld);
      post.uniforms.uLine.value = lines ? 1 : 0;
      cam.layers.set(0);
      renderer.setRenderTarget(rtNormal); renderer.setClearColor(0x000000, 0); renderer.clear();
      // 描线关掉时依旧要深度给雾气用：用法线材质画一遍很便宜
      scene.overrideMaterial = normalMat; renderer.render(scene, cam); scene.overrideMaterial = null;
      if (layer1) cam.layers.enable(1);
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(rtColor); renderer.clear();
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
  };
}

// 把若干 (几何, 亮色, 暗色) 合成一个带顶点颜色的几何，配合 toon(…, { vcol: true }) 一次画完
export function mergeColored(items) {
  const geos = items.map(({ geo, hex, shade }) => {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const n = g.attributes.position.count, L = new THREE.Color(hex), S = shade != null ? new THREE.Color(shade) : shadeOf(hex);
    const a = new Float32Array(n * 3), b = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = L.r; a[i * 3 + 1] = L.g; a[i * 3 + 2] = L.b; b[i * 3] = S.r; b[i * 3 + 1] = S.g; b[i * 3 + 2] = S.b; }
    g.setAttribute('aLit', new THREE.BufferAttribute(a, 3)); g.setAttribute('aShd', new THREE.BufferAttribute(b, 3));
    return g;
  });
  return mergeGeometries(geos);
}
