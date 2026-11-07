// 景物：地标、城市、树木、茶园、荷塘、游船。造型沿用梦想人生（保俶塔、雷峰塔、拱桥、三潭印月、亭子、马头墙民居、
// 柳树和桃树的写法），按赛车的尺度放大（梦想人生里 1 单位约 1.5 米、看的是近景；这里要在 200 公里时速下认得出来）。
// 静态几何按材质 + 300 米地块合并，树和茶树按地块做 InstancedMesh，都能被视锥剔除。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, mergeColored, BEND_GLSL, G } from './toon.js';
import * as LY from './layout.js';
import { WATER, baseHeight } from './terrain.js';
import { fbm2, makeRand, smoothstep, slice } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const TILE = 300;
const tileKey = (x, z) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;

// ---------- 合批 ----------
// 静态几何：同一种着色方式（kind 等）+ 同一地块合成一个网格，颜色走顶点属性，所以不同颜色也不用拆开画
const prep = g => { let n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; };
class Batch {
  constructor() { this.groups = new Map(); }
  add(geo, hex, opts = {}, m) {
    const { shade, ...rest } = opts;
    const g = prep(geo.clone()).applyMatrix4(m);
    const e = m.elements;
    const key = `${JSON.stringify(rest)}|${tileKey(e[12], e[14])}`;
    let b = this.groups.get(key);
    if (!b) this.groups.set(key, (b = { opts: rest, items: [] }));
    b.items.push({ geo: g, hex, shade });
  }
  flush(scene) {
    for (const { opts, items } of this.groups.values()) {
      const merged = mergeColored(items);
      items.forEach(it => it.geo.dispose());
      merged.computeBoundingSphere(); merged.boundingSphere.radius += 40;
      const m = new THREE.Mesh(merged, toon(0xffffff, { ...opts, vcol: true }));
      m.castShadow = opts.cast !== false; m.receiveShadow = true; m.matrixAutoUpdate = false;
      scene.add(m);
    }
    this.groups.clear();
  }
}
// 实例化的树：每个地块一组；有远景版本的种类，按相机到地块的距离在细/粗两套之间切换
const LODS = [];
export function updateLOD(cam, scale = 1) {
  for (const t of LODS) {
    const near = Math.hypot(cam.x - t.x, cam.z - t.z) < t.swap * scale;
    if (near === t.near) continue;
    t.near = near;
    t.nearMeshes.forEach(m => { m.visible = near; });
    t.farMeshes.forEach(m => { m.visible = !near; });
  }
}
class Inst {
  constructor() { this.sets = new Map(); }
  push(kind, m, color) {
    const e = m.elements, key = `${kind}|${tileKey(e[12], e[14])}`;
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = { kind, list: [], x: (Math.floor(e[12] / TILE) + 0.5) * TILE, z: (Math.floor(e[14] / TILE) + 0.5) * TILE }));
    s.list.push([m, color]);
  }
  flush(scene, kinds) {
    const mk = (parts, list, vis) => parts.map(part => {
      const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach(([m, c], i) => { im.setMatrixAt(i, m); if (part.tint) im.setColorAt(i, new THREE.Color(c ?? 0xffffff)); });
      im.castShadow = part.cast !== false; im.receiveShadow = true;
      if (part.layer) im.layers.set(part.layer);   // 第 1 层不进法线 pass，不描黑边
      im.computeBoundingSphere(); im.boundingSphere.radius += 40;
      im.visible = vis;
      scene.add(im);
      return im;
    });
    for (const s of this.sets.values()) {
      const k = kinds[s.kind];
      if (!k.far) { mk(k.near, s.list, true); continue; }
      LODS.push({ x: s.x, z: s.z, swap: k.swap || 300, near: false, nearMeshes: mk(k.near, s.list, false), farMeshes: mk(k.far, s.list, true) });
    }
  }
}
const M = (x, y, z, ry = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(s, s, s));

// 一个锚定在 (x, y, z)、朝向 ry、缩放 s 的建造器（与梦想人生的 kit 同一套 API）
function kitAt(batch, x, y, z, ry = 0, s = 1) {
  const m = M(x, y, z, ry, s);
  const K = {
    add(geo, hex, opts) { batch.add(geo, hex, opts, m); return K; },
    box(w, h, d, hex, px = 0, py = 0, pz = 0, opts, rot = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rot) g.rotateY(rot); g.translate(px, py, pz); return K.add(g, hex, opts); },
    cyl(rt, rb, h, hex, px = 0, py = 0, pz = 0, seg = 16, opts) { return K.add(new THREE.CylinderGeometry(rt, rb, h, seg).translate(px, py, pz), hex, opts); },
    ball(r, hex, px = 0, py = 0, pz = 0, opts) { return K.add(new THREE.SphereGeometry(r, 14, 10).translate(px, py, pz), hex, opts); },
  };
  return K;
}
function octo(k, rt, rb, h, hex, y, opts) { const g = new THREE.CylinderGeometry(rt, rb, h, 8); g.rotateY(Math.PI / 8); g.translate(0, y, 0); k.add(g, hex, opts); }
function upturn(k, r, y, hex, n = 8, off = Math.PI / 8) {
  for (let j = 0; j < n; j++) {
    const a = j / n * Math.PI * 2 + off, c = new THREE.ConeGeometry(0.045, 0.24, 5);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(Math.sin(a) * 0.75, 0.66, Math.cos(a) * 0.75).normalize()));
    c.translate(Math.sin(a) * r, y, Math.cos(a) * r);
    k.add(c, hex);
  }
}

// ---------- 树冠：噪声起伏的球团，法线朝整团中心（光照像一整团柔软的体积） ----------
function lump(r, detail, amp, s) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + amp * (fbm2(v.x * 2.2 + s, v.z * 2.2 - s + v.y * 1.7) - 0.5) * 2;
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.deleteAttribute('uv');
  return g;
}
function blobify(g, cen, keep = 0.18) {
  g.computeVertexNormals();
  const p = g.attributes.position, nrm = g.attributes.normal, v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(cen).normalize();
    nv.fromBufferAttribute(nrm, i);
    v.lerp(nv, keep).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
function canopy(clumps, seedOff, detail) {
  const parts = clumps.map(([x, y, z, r], i) => lump(r, detail, 0.22, seedOff + i * 3.7).translate(x, y, z));
  const cen = new THREE.Vector3();
  clumps.forEach(([x, y, z]) => cen.add(new THREE.Vector3(x, y, z)));
  return blobify(mergeGeometries(parts.map(prep)), cen.divideScalar(clumps.length));
}
const leafTints = [0xffffff, 0xf2f7ea, 0xe6f0de, 0xfaf3df];

function treeKinds() {
  const foliage = (hex, shade, ns = 1.4, bm = 0.75) => toon(hex, { kind: 'FOLIAGE', shade, breakMul: bm, noiseScale: ns });
  const trunkMat = toon(0x8a6a52, { shade: 0x5a4c50 });
  const trunk = new THREE.CylinderGeometry(0.06, 0.1, 0.8, 7).translate(0, 0.4, 0);
  const trunkLo = new THREE.CylinderGeometry(0.06, 0.1, 0.8, 4).translate(0, 0.4, 0);
  const K = {};
  const tree = (clumps, seed, hex, shade, swap = 320) => ({
    near: [{ geo: trunk, mat: trunkMat }, { geo: canopy(clumps, seed, 1), mat: foliage(hex, shade), tint: true }],
    far: [{ geo: trunkLo, mat: trunkMat, cast: false }, { geo: canopy(clumps, seed, 0), mat: foliage(hex, shade), tint: true, cast: false }],
    swap,
  });
  // 圆冠树（樟树）、高一点的乔木
  K.round = tree([[0, 0.95, 0, 0.6], [0.42, 0.78, 0.12, 0.42], [-0.38, 0.8, -0.14, 0.44]], 3, 0x5fa65a, 0x2f6f5e);
  K.tall = tree([[0, 1.2, 0, 0.45], [0.1, 0.85, 0.1, 0.42], [-0.1, 1.5, -0.05, 0.32]], 9, 0x4f9a63, 0x2a6460);
  // 柳树：上面一顶压扁的伞状树冠，冠沿和冠下垂下一圈一圈细长的柳条（每根是一条窄带，带一点外弯，越往下越细）
  const willowCrown = detail => {
    const parts = [lump(0.62, detail, 0.22, 51).scale(1.2, 0.5, 1.2).translate(0, 1.95, 0)];
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; parts.push(lump(0.34, detail, 0.25, 60 + i).scale(1.1, 0.55, 1.1).translate(Math.cos(a) * 0.5, 1.82, Math.sin(a) * 0.5)); }
    return blobify(mergeGeometries(parts.map(prep)), new THREE.Vector3(0, 1.7, 0), 0.25);
  };
  const willowStrands = (rings, segs) => {
    const pos = [], nor = [], idx = [];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [r0, n, y0, len] of rings) for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + rnd() * 0.25, L = len * (0.82 + rnd() * 0.3), ca = Math.cos(a), sa = Math.sin(a);
      const tx = -sa, tz = ca, base = pos.length / 3, sway = (rnd() - 0.5) * 0.12;
      for (let k = 0; k <= segs; k++) {
        // 细长、轻微 S 形摆动的柳条：根部 6 cm、梢部 2 cm（树按 3.5 倍放大后约 20 cm → 7 cm）
        const t = k / segs, r = r0 + 0.2 * t - 0.08 * t * t, y = y0 - L * t, w = 0.06 * (1 - 0.65 * t);
        const wave = Math.sin(t * Math.PI * 1.6 + j) * 0.035 * t;
        const cx = ca * (r + wave) + tx * sway * t, cz = sa * (r + wave) + tz * sway * t;
        pos.push(cx - tx * w / 2, y, cz - tz * w / 2, cx + tx * w / 2, y, cz + tz * w / 2);
        const nx = ca, ny = 0.35, nz = sa, nl = Math.hypot(nx, ny, nz);
        nor.push(nx / nl, ny / nl, nz / nl, nx / nl, ny / nl, nz / nl);
      }
      for (let k = 0; k < segs; k++) { const q = base + k * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  };
  const wTrunk = new THREE.CylinderGeometry(0.07, 0.11, 1.9, 6).translate(0, 0.95, 0), wTrunkMat = toon(0x7a6150, { shade: 0x56484c });
  const wLeaf = foliage(0xa3cf6e, 0x5e9264, 1.6, 0.6);
  const wStrand = toon(0xb6d978, { kind: 'FOLIAGE', shade: 0x6a9a5e, breakMul: 0.25, noiseScale: 4, side: THREE.DoubleSide });
  const nearRings = [[0.36, 18, 1.86, 1.15], [0.52, 26, 1.84, 1.35], [0.68, 34, 1.8, 1.5], [0.84, 40, 1.72, 1.55]];
  const farRings = [[0.55, 20, 1.82, 1.4], [0.84, 26, 1.72, 1.5]];
  K.willow = {
    near: [{ geo: wTrunk, mat: wTrunkMat }, { geo: willowCrown(1), mat: wLeaf }, { geo: willowStrands(nearRings, 6), mat: wStrand, layer: 1 }],
    far: [{ geo: wTrunk, mat: wTrunkMat, cast: false }, { geo: willowCrown(0), mat: wLeaf, cast: false }, { geo: willowStrands(farRings, 3), mat: wStrand, cast: false, layer: 1 }],
    swap: 260,
  };
  const pTrunk = new THREE.CylinderGeometry(0.05, 0.08, 0.8, 5).translate(0, 0.4, 0), pTrunkMat = toon(0x7a5a4a, { shade: 0x56484c });
  const pLeaf = foliage(0xf4b4c4, 0xc3809a, 1.8, 0.6), pClumps = [[0, 1.0, 0, 0.48], [0.3, 0.86, 0.1, 0.34], [-0.28, 0.9, -0.1, 0.35]];
  K.peach = { near: [{ geo: pTrunk, mat: pTrunkMat }, { geo: canopy(pClumps, 61, 1), mat: pLeaf }], far: [{ geo: pTrunk, mat: pTrunkMat, cast: false }, { geo: canopy(pClumps, 61, 0), mat: pLeaf, cast: false }], swap: 260 };
  // 茶树：贴地的一长条圆垄
  const teaGeo = d => { const g = lump(0.5, d, 0.18, 77); g.scale(1.5, 0.62, 0.95); g.translate(0, 0.28, 0); return blobify(g, new THREE.Vector3(0, 0, 0), 0.3); };
  const teaMat = foliage(0x6fb35a, 0x3b7a58, 2.2, 0.55);
  K.tea = { near: [{ geo: teaGeo(1), mat: teaMat, tint: true, cast: false }], far: [{ geo: teaGeo(0), mat: teaMat, tint: true, cast: false }], swap: 200 };
  // 竹子：一丛细竿，顶上几团竹叶
  {
    const st = [], lv = [];
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, r = 0.25 + (i % 3) * 0.18, h = 7 + (i % 4) * 1.4, x = Math.cos(a) * r, z = Math.sin(a) * r;
      st.push(prep(new THREE.CylinderGeometry(0.06, 0.08, h, 4).translate(x, h / 2, z)));
      lv.push(prep(lump(0.9, 0, 0.3, i * 5).scale(0.8, 1.6, 0.8).translate(x * 2.2, h - 0.8, z * 2.2)));
    }
    K.bamboo = { near: [{ geo: mergeGeometries(st), mat: toon(0x8fb76a, { shade: 0x5a7f5e }) },
      { geo: blobify(mergeGeometries(lv), new THREE.Vector3(0, 7.5, 0), 0.4), mat: foliage(0x7dbb5e, 0x3c7a5a, 1.6, 0.6) }] };
  }
  // 荷叶与荷花
  K.lotus = { near: [{ geo: new THREE.CylinderGeometry(1.0, 1.0, 0.08, 10).translate(0, 0.05, 0), mat: toon(0x5f9e58, { shade: 0x3f7a5c, breakMul: 0.3 }), cast: false, tint: true }] };
  K.lotusFlower = { near: [{ geo: new THREE.ConeGeometry(0.45, 0.8, 6).rotateX(Math.PI).translate(0, 0.9, 0), mat: toon(0xf6a9c0, { shade: 0xc77c9c }) }] };
  return K;
}

// ---------- 地标（造型源自梦想人生，放大到赛车尺度） ----------
function baochu(b, x, y, z) {   // 保俶塔：细高的七层砖塔
  const k = kitAt(b, x, y, z, 0, 11);
  const BRICK = 0x9d8b74, LEDGE = 0x7d705f;
  octo(k, 0.5, 0.58, 1.0, 0xcfc7b6, -0.3);
  let yy = 0.2;
  for (let i = 0; i < 7; i++) {
    const r = 0.3 - i * 0.022, h = 0.44;
    octo(k, r * 0.95, r, h, BRICK, yy + h / 2);
    octo(k, r + 0.06, r + 0.06, 0.05, LEDGE, yy + h);
    yy += h + 0.05;
  }
  k.cyl(0.03, 0.03, 0.9, 0x474b4f, 0, yy + 0.45, 0, 6);
  [0.15, 0.32, 0.5].forEach(o => k.cyl(0.08 - o * 0.06, 0.08 - o * 0.06, 0.03, 0x474b4f, 0, yy + o, 0, 8));
}
function leifeng(b, x, y, z) {  // 雷峰塔：五层，红身金顶
  const k = kitAt(b, x, y, z, 0.3, 10);
  const BODY = 0xa85a42, ROOF = 0xcaa45c, ROOF_SH = 0x8a6a4a, STONE = 0xd6cebd;
  octo(k, 1.15, 1.25, 1.2, STONE, -0.25);
  octo(k, 0.95, 1.0, 0.2, STONE, 0.42);
  let yy = 0.52;
  for (let i = 0; i < 5; i++) {
    const r = 0.68 - i * 0.065, hb = 0.5 - i * 0.02;
    octo(k, r, r, hb, BODY, yy + hb / 2);
    octo(k, r + 0.14, r + 0.14, 0.05, 0xe8dcc0, yy + 0.03);
    octo(k, r * 0.62, r + 0.44, 0.17, ROOF, yy + hb + 0.085, { shade: ROOF_SH });
    upturn(k, (r + 0.44) * 1.08, yy + hb + 0.1, ROOF);
    yy += hb + 0.17;
  }
  octo(k, 0.06, 0.52, 0.52, ROOF, yy + 0.26, { shade: ROOF_SH });
  k.cyl(0.035, 0.035, 0.95, 0xd8b65e, 0, yy + 0.95, 0, 6);
  [0.62, 0.78, 0.94, 1.1].forEach((o, i) => k.cyl(0.1 - i * 0.015, 0.1 - i * 0.015, 0.04, 0xd8b65e, 0, yy + o, 0, 10));
}
function liuhe(b, x, y, z) {    // 六和塔：宽胖的十三层檐，砖红塔身白檐
  const k = kitAt(b, x, y, z, 0, 9);
  octo(k, 1.3, 1.4, 1.0, 0xcfc7b6, 0);
  let yy = 0.5;
  for (let i = 0; i < 9; i++) {
    const r = 0.95 - i * 0.06, h = 0.42;
    octo(k, r * 0.86, r * 0.88, h, 0xa4513e, yy + h / 2);
    octo(k, r * 0.6, r + 0.2, 0.12, 0xece4d2, yy + h + 0.06, { shade: 0x9c9a9a });
    yy += h + 0.12;
  }
  octo(k, 0.05, 0.4, 0.5, 0x5a5a5a, yy + 0.25);
  k.cyl(0.04, 0.04, 0.8, 0x474b4f, 0, yy + 0.8, 0, 6);
}
function pavilion(b, x, y, z, size = 0.5, s = 6, ry = 0) {
  const k = kitAt(b, x, y, z, ry, s);
  k.box(size * 2 + 0.24, 0.14, size * 2 + 0.24, 0xcfc7b6, 0, 0.0, 0);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, c]) => k.cyl(0.045, 0.045, 0.62, 0xa4473a, a * size, 0.38, c * size, 8));
  k.box(size * 2 + 0.12, 0.06, size * 2 + 0.12, 0x8a3f33, 0, 0.7, 0);
  const roof = new THREE.ConeGeometry(size * 1.6, 0.5, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 0.97, 0);
  k.add(roof, 0x4b5159, { shade: 0x30353c });
  upturn(k, size * 1.55, 0.76, 0x3a3f46, 4, Math.PI / 4);
  k.ball(0.06, 0xd8b65e, 0, 1.25, 0);
}
function archBridge(b, x, z, ry, len, width, rise) {   // 石拱桥：弧形桥面 + 两侧拱券
  const N = 12, seg = len / N, hAt = t => WATER + 0.9 + rise * Math.sin(Math.PI * t);
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, h0 = hAt(t0), h1 = hAt(t1), slope = Math.atan2(h1 - h0, seg), zc = -len / 2 + (i + 0.5) * seg;
    const k = kitAt(b, x, 0, z, ry, 1);
    k.add(new THREE.BoxGeometry(width, 0.5, seg * 1.06 / Math.cos(slope)).rotateX(-slope).translate(0, (h0 + h1) / 2 - 0.25, zc), 0xdedad0);
    for (const sd of [-1, 1]) k.add(new THREE.BoxGeometry(0.3, 0.7, seg * 1.04 / Math.cos(slope)).rotateX(-slope).translate(sd * (width / 2 - 0.15), (h0 + h1) / 2 + 0.3, zc), 0xe8e4da);
  }
  const k = kitAt(b, x, WATER, z, ry, 1), rr = Math.min(len * 0.3, rise + 0.6);
  for (const sd of [-1, 1]) k.add(new THREE.TorusGeometry(rr, 0.45, 6, 18, Math.PI).rotateY(Math.PI / 2).translate(sd * (width / 2 - 0.2), 0, 0), 0xd5d0c5);
}
function lantern(b, x, z) {     // 三潭印月的石塔：圆肚、镂空小圆洞、葫芦顶
  const k = kitAt(b, x, WATER, z, 0, 3.2);
  k.cyl(0.14, 0.18, 0.9, 0xd6cebd, 0, 0.3, 0, 10);
  k.ball(0.42, 0xe2dccf, 0, 1.05, 0);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; k.add(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10).rotateX(Math.PI / 2).rotateY(a).translate(Math.sin(a) * 0.4, 1.05, Math.cos(a) * 0.4), 0x3a3f46); }
  k.cyl(0.3, 0.42, 0.14, 0xcfc7b6, 0, 1.5, 0, 10);
  k.ball(0.14, 0xd6cebd, 0, 1.7, 0); k.ball(0.09, 0xd6cebd, 0, 1.88, 0);
}
function jiangnan(b, x, y, z, w, d, h, ry, s = 4.5) {   // 白墙黛瓦马头墙
  const k = kitAt(b, x, y, z, ry, s);
  const WALL = 0xf5f2ea, TILE = 0x4b5159, CAP = 0x3a3f46, WOOD = 0x5a4234;
  k.box(w, h + 1, d, WALL, 0, (h - 1) / 2, 0);
  const tri = new THREE.Shape(); tri.moveTo(-(d / 2 + 0.22), 0); tri.lineTo(d / 2 + 0.22, 0); tri.lineTo(0, 0.62); tri.closePath();
  const rg = new THREE.ExtrudeGeometry(tri, { depth: w + 0.1, bevelEnabled: false });
  rg.translate(0, 0, -(w + 0.1) / 2); rg.rotateY(Math.PI / 2); rg.translate(0, h, 0);
  k.add(rg, TILE, { shade: 0x30353c });
  k.box(w + 0.3, 0.08, 0.1, CAP, 0, h + 0.64, 0);
  [-1, 1].forEach(sd => {
    const gx = sd * (w / 2 + 0.04);
    [[d + 0.1, h + 0.28], [d * 0.6, h + 0.55], [d * 0.24, h + 0.84]].forEach(([len, top]) => {
      k.box(0.14, top + 1, len, WALL, gx, (top - 1) / 2, 0);
      k.box(0.24, 0.07, len + 0.12, CAP, gx, top + 0.03, 0);
    });
  });
  [-0.28, 0.28].forEach(f => { k.box(0.5, 0.44, 0.04, WOOD, f * w, 0.62, d / 2 + 0.02); k.box(0.4, 0.34, 0.04, 0xd8c7a4, f * w, 0.62, d / 2 + 0.035); });
  if (h > 1.6) [-0.28, 0, 0.28].forEach(f => { k.box(0.5, 0.44, 0.04, WOOD, f * w, h - 0.45, d / 2 + 0.02); k.box(0.4, 0.34, 0.04, 0xd8c7a4, f * w, h - 0.45, d / 2 + 0.035); });
  k.box(0.44, 0.78, 0.05, WOOD, 0, 0.42, d / 2 + 0.02);
}
function temple(b, x, y, z, ry, sc = 1) {   // 岳王庙、于谦祠：红墙、重檐歇山的大殿
  const k = kitAt(b, x, y, z, ry, sc);
  const RED = 0x9e3b30, TILE = 0x3f454c, STONE = 0xd6cebd;
  k.box(52, 1.4, 34, STONE, 0, 0.7, 0);
  k.box(36, 9, 20, RED, 0, 6, 0);
  for (let i = -3; i <= 3; i++) k.cyl(0.55, 0.6, 9, 0x7e2c24, i * 5.4, 6, 10.8, 10);
  const hip = (w, d, h, yy) => {
    const g = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1); g.rotateY(Math.PI / 4); g.scale(w * 0.75, h, d * 0.75); g.translate(0, yy + h / 2, 0);
    k.add(g, TILE, { shade: 0x2c3036 });
  };
  hip(46, 30, 6, 10.4); hip(30, 18, 4.5, 15.2);
  k.box(28, 0.8, 1.2, 0x2f3438, 0, 19.6, 0);
  // 院墙与门
  k.box(74, 6, 1.6, RED, 0, 3, 28); k.box(74, 0.8, 2.4, TILE, 0, 6.3, 28);
  k.box(10, 7.5, 3, 0x7e2c24, 0, 3.7, 28.4); k.box(12, 1.2, 4.2, TILE, 0, 8.0, 28.4);
}

// 平海路：龙翔桥起步的商业街，按湖滨真实的两家旗舰店来做建筑（只做建筑造型，不放品牌标志和字样）：
// 右手（北侧）是通高的玻璃盒子：两层通透、里面一块悬挑的夹层楼板、一排排木桌，两侧是米色石材 + 砖格栅的街区建筑，
// 门前是人字形拼花的石材广场；左手（南侧）是蓝色玻璃塔楼，正面一整块带菱格图案的蓝色装饰墙，底层是暖光的玻璃入口。
// 再往东是一家黑色门面的影音店、一家浅粉色的美妆店和带骑楼的街面房子；龙翔桥地铁站口在起点右后方。
function canvasTex(w, h, draw, rw = 1, rh = 1) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.userData.tile = [rw, rh];          // 一张贴图对应多少米
  return t;
}
const TEX = {};
function streetTextures() {
  if (TEX.lattice) return TEX;
  // 米色石材横带 + 深灰砖格栅（一张 = 6 m × 6 m，一层楼高）
  TEX.lattice = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#ddd5c7'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e2d6'; c.fillRect(0, 0, w, 34);
    c.fillStyle = '#c9c0b0'; c.fillRect(0, 34, w, 3);
    for (let r = 0; r < 26; r++) for (let q = 0; q < 22; q++) {
      const x = q * 12 + (r % 2 ? 6 : 0), y = 44 + r * 8;
      c.fillStyle = (r * 7 + q * 3) % 5 === 0 ? '#7f776b' : '#958b7d';
      c.fillRect(x, y, 9, 5);
    }
  }, 6, 6);
  // 门前人字形拼花广场（一张 = 6 m × 3 m）
  TEX.zigzag = canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = '#e4e4e2'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#8f9396';
    for (let row = 0; row < 4; row++) for (let k = -1; k < 9; k++) {
      const x = k * 32, y = row * 32;
      c.beginPath(); c.moveTo(x, y + 8); c.lineTo(x + 16, y); c.lineTo(x + 32, y + 8); c.lineTo(x + 32, y + 18); c.lineTo(x + 16, y + 10); c.lineTo(x, y + 18); c.closePath(); c.fill();
    }
  }, 6, 3);
  // 蓝色玻璃幕墙：楼层线 + 竖挺（一张 = 6 m × 6 m）
  TEX.blueglass = canvasTex(256, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3f6fd8'); g.addColorStop(1, '#2d58c4');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let q = 0; q < 8; q++) for (let r = 0; r < 4; r++) if ((q * 5 + r * 3) % 7 === 0) { c.fillStyle = 'rgba(170,200,255,0.35)'; c.fillRect(q * 32, r * 64, 32, 64); }
    c.fillStyle = '#a9c3ff';
    for (let r = 0; r < 4; r++) c.fillRect(0, r * 64, w, 5);
    for (let q = 0; q < 8; q++) c.fillRect(q * 32, 0, 2, h);
  }, 6, 6);
  // 蓝色装饰墙：菱格 + 小圆点（通用几何图案，一张 = 3 m × 3 m）
  TEX.diamond = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#2650c2'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#6f95ff'; c.lineWidth = 5;
    for (let k = -2; k < 6; k++) {
      c.beginPath(); c.moveTo(k * 64, 0); c.lineTo(k * 64 + 256, 256); c.stroke();
      c.beginPath(); c.moveTo(k * 64 + 256, 0); c.lineTo(k * 64, 256); c.stroke();
    }
    c.fillStyle = '#9fb9ff';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.beginPath(); c.arc(x * 64 + 32, y * 64 + 32, 7, 0, Math.PI * 2); c.fill(); }
  }, 3, 3);
  return TEX;
}
// 按米铺贴图的盒子：四个侧面贴 tex，顶底用 topHex 纯色
function texBox(scene, tex, w, h, d, x, y, z, ry = 0, topHex = 0xd9d3c7, opts = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, [tw, th] = tex.userData.tile;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x −x +y −y +z −z
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tw, uv.getY(i) * dims[f][1] / th); }
  const side = toon(0xffffff, { map: tex, breakMul: 0, ...opts }), top = toon(topHex, { breakMul: 0.2 });
  const m = new THREE.Mesh(g, [side, side, top, top, side, side]);
  m.position.set(x, y + h / 2, z); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  return m;
}
function texPlane(scene, tex, w, d, x, y, z, ry = 0) {
  const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv, [tw, th] = tex.userData.tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tw, uv.getY(i) * d / th);
  const m = new THREE.Mesh(g, toon(0xffffff, { map: tex, breakMul: 0, offset: -2 }));
  m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true;
  scene.add(m);
}
function signTex(lines, w, h, bg, fg, font = 900) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
  lines.forEach(([text, size, y]) => { c.font = `${font} ${size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; c.fillText(text, w / 2, y); });
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
}
function signMesh(scene, tex, w, h, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), toon(0xffffff, { map: tex, breakMul: 0, side: THREE.DoubleSide }));
  m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = false; m.receiveShadow = true; scene.add(m);
}
// 透明玻璃：只上一层淡淡的天色，不进法线 pass（不描线），轮廓靠玻璃竖挺和屋檐来画
const glassMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ea, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
function glassPane(scene, w, h, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
  m.position.set(x, y, z); m.rotation.y = ry; m.layers.set(1); m.renderOrder = 3;
  scene.add(m);
}

// 玻璃盒子旗舰店（北侧，正面朝南）
function glassBoxStore(b, scene, x, gy, zFront) {
  const W = 46, H = 19, D = 26, zc = zFront - D / 2;
  const k = kitAt(b, x, gy, zc, 0, 1);
  const WOOD = 0xd8b47a, STONE = 0xe3e1dc, FIN = 0xeef2f3;
  k.box(W, 0.5, D, STONE, 0, 0.25, 0);                                   // 室内地坪
  k.box(W, H, 0.6, 0xe6e2da, 0, H / 2, -D / 2 + 0.3);                     // 后墙
  k.box(W - 6, 7, 0.3, 0xcfb2c6, 0, 13.5, -D / 2 + 0.7, { breakMul: 0.1 });   // 后墙二层的大屏
  k.box(W - 10, 2.2, 0.8, 0xc9c2b4, 0, 1.6, -D / 2 + 1.2);               // 一层靠墙的展示柜
  for (let q = 0; q < 9; q++) k.box(2.6, 0.5, 0.5, [0xd65b4f, 0xf2c14e, 0x6fb1d8, 0x9ad08a, 0xf3efe6][q % 5], -W / 2 + 7 + q * 4, 2.9, -D / 2 + 1.2, { breakMul: 0 });
  // 悬挑夹层：楼板前缘离玻璃 4 米，白色封边
  k.box(W - 6, 0.6, 15, 0xf1f0ec, 0, 9.4, -D / 2 + 8.1);
  k.box(W - 6, 1.0, 0.25, 0xffffff, 0, 9.2, -D / 2 + 15.6);
  k.box(W - 6, 1.1, 0.12, 0xcfe7ea, 0, 10.25, -D / 2 + 15.5, { kind: 'GLASS', shade: 0x8fb0bb });   // 夹层玻璃栏板
  // 木桌：一层两排，夹层一排
  const table = (tx, ty, tz) => { k.box(3.4, 0.18, 1.3, WOOD, tx, ty + 0.92, tz); k.box(0.16, 0.9, 1.1, 0xc49a5c, tx - 1.5, ty + 0.45, tz); k.box(0.16, 0.9, 1.1, 0xc49a5c, tx + 1.5, ty + 0.45, tz);
    for (let i = 0; i < 3; i++) k.box(0.42, 0.06, 0.3, 0x2f3438, tx - 1.1 + i * 1.1, ty + 1.04, tz, { breakMul: 0 }); };
  for (let q = 0; q < 6; q++) { table(-W / 2 + 6 + q * 6.8, 0.5, D / 2 - 4); table(-W / 2 + 6 + q * 6.8, 0.5, D / 2 - 9.5); table(-W / 2 + 6 + q * 6.8, 9.7, -D / 2 + 9); }
  // 屋顶和屋檐：白色薄板，四周一圈封边
  k.box(W + 0.4, 0.5, D + 0.4, 0xf4f4f0, 0, H + 0.25, 0);
  k.box(W + 0.6, 0.9, 0.3, 0xf4f4f0, 0, H - 0.2, D / 2 + 0.05);
  // 玻璃竖挺（玻璃肋），正面每 4.6 米一道，两侧每 5.2 米
  for (let q = 0; q <= 10; q++) k.box(0.16, H, 0.9, FIN, -W / 2 + q * W / 10, H / 2, D / 2 - 0.45);
  for (const sx of [-1, 1]) for (let q = 1; q < 5; q++) k.box(0.9, H, 0.16, FIN, sx * (W / 2 - 0.45), H / 2, -D / 2 + q * D / 5);
  // 入口：中间一樘玻璃门框
  k.box(4.6, 6.2, 0.2, 0xdfe3e4, 0, 3.1, D / 2 + 0.05, { breakMul: 0 });
  k.box(4.0, 5.8, 0.25, 0xa9c6cf, 0, 3.0, D / 2 + 0.1, { kind: 'GLASS', shade: 0x6f97a6 });
  // 透明玻璃面
  glassPane(scene, W, H, x, gy + H / 2, zFront, 0);
  glassPane(scene, D, H, x - W / 2, gy + H / 2, zc, Math.PI / 2);
  glassPane(scene, D, H, x + W / 2, gy + H / 2, zc, Math.PI / 2);
}
// 湖滨街区的米色石材 + 砖格栅建筑，底层是深色玻璃商铺
function latticeBlock(scene, b, x, gy, zFront, facing, w, d, floors) {
  const T = streetTextures(), h = floors * 6, zc = zFront - facing * d / 2;
  texBox(scene, T.lattice, w, h - 5.5, d, x, gy + 5.5, zc, 0, 0xd9d3c7);
  const k = kitAt(b, x, gy, zc, facing > 0 ? 0 : Math.PI, 1);
  k.box(w, 5.5, d - 1.2, 0x5f6b72, 0, 2.75, -0.6, { kind: 'GLASS', shade: 0x3e4a52 });
  k.box(w + 0.2, 0.8, d + 0.2, 0xe8e2d6, 0, 5.5, 0);
  for (let q = 0; q <= Math.floor(w / 5); q++) k.box(0.4, 5.5, 0.4, 0xe8e2d6, -w / 2 + q * (w / Math.floor(w / 5)), 2.75, d / 2 - 0.1);
}
// 蓝色玻璃塔楼旗舰店（南侧，正面朝北）
function blueTowerStore(b, scene, x, gy, zFront) {
  const T = streetTextures();
  // 主塔、副塔、侧边裙楼
  texBox(scene, T.blueglass, 26, 44, 22, x, gy, zFront + 11, 0, 0x8fb0e8);
  texBox(scene, T.blueglass, 18, 36, 18, x + 21, gy, zFront + 13, 0, 0x8fb0e8);
  texBox(scene, T.blueglass, 22, 12, 20, x - 22, gy, zFront + 10, 0, 0x8fb0e8);
  // 正面装饰墙：整块菱格图案，略微凸出主塔
  texBox(scene, T.diamond, 18, 30, 1.4, x - 2, gy + 9, zFront - 0.6, 0, 0x2650c2);
  const k = kitAt(b, x - 2, gy, zFront, Math.PI, 1);
  // 底层入口：暖光玻璃盒子 + 上方一条蓝色门楣（不写字）
  k.box(14, 7.5, 3, 0xf6e7c8, 0, 3.75, -1.4, { kind: 'GLOW', glow: 1.05 });
  k.box(14.6, 0.4, 3.4, 0x1f3f9e, 0, 7.7, -1.4);
  k.box(16, 1.6, 0.6, 0x2a56c6, 0, 8.6, 0.2);
  for (const sx of [-7.1, 7.1]) k.box(0.4, 7.5, 3.2, 0x1f3f9e, sx, 3.75, -1.4);
  // 两侧橱窗
  for (const sx of [-14, 14]) { k.box(6, 6, 0.4, 0xf3dfb8, sx, 3.4, -0.4, { kind: 'GLOW', glow: 1.0 }); k.box(6.6, 0.5, 0.6, 0x1f3f9e, sx, 6.6, -0.4); }
}
function shoppingStreet(b, scene, track, groundAt) {
  const z0 = -46, hw = track.halfW, front = hw + 8;   // 门面离路中心 19 米（含人行道）
  const N = z0 - front, S = z0 + front;               // 北侧门面线、南侧门面线
  const gy = x => groundAt(x, z0) - 0.35;
  const T = streetTextures();
  // 北侧（右手）：玻璃盒子 + 两侧砖格栅街区，门前人字形拼花广场
  glassBoxStore(b, scene, 562, gy(562), N);
  latticeBlock(scene, b, 519, gy(519), N, 1, 38, 24, 3);
  latticeBlock(scene, b, 610, gy(610), N, 1, 48, 24, 3);
  texPlane(scene, T.zigzag, 130, 7.0, 562, gy(562) + 0.42, N + 3.6);
  // 南侧（左手）：蓝色玻璃塔楼
  blueTowerStore(b, scene, 560, gy(560), S);
  // 再往东：黑色门面的影音店（北）、浅粉色美妆店（南）、带骑楼的街面房子
  { const x = 656, w = 22, d = 22, h = 20, k = kitAt(b, x, gy(x), N - d / 2, 0, 1);
    k.box(w, h, d, 0x2f3438, 0, h / 2, 0, { breakMul: 0.2 });
    k.box(w - 4, 7, 0.4, 0x8fe0ff, 0, h - 6, d / 2 + 0.2, { kind: 'GLOW', glow: 1.0 });
    k.box(w - 6, 5, 0.3, 0xcfe7ea, 0, 3, d / 2 + 0.2, { kind: 'GLASS', shade: 0x6f97a6 }); }
  { const x = 612, w = 24, d = 20, h = 14, k = kitAt(b, x, gy(x), S + d / 2, Math.PI, 1);
    k.box(w, h, d, 0xf3d6d8, 0, h / 2, 0, { breakMul: 0.25 });
    for (let q = -2; q <= 2; q++) { k.box(3, 4, 0.3, 0xffffff, q * 4.5, 9, d / 2 + 0.15); k.add(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(q * 4.5, 11, d / 2 + 0.15), 0xffffff); }
    k.box(w - 6, 3.8, 0.3, 0xcfe7ea, 0, 2.1, d / 2 + 0.2, { kind: 'GLASS', shade: 0x6f97a6 });
    k.box(w + 1, 0.6, d + 1, 0xe6b8bd, 0, h + 0.3, 0); }
  // 一块地（含骑楼雨棚）有没有压到赛道：在占地范围里撒点检查
  const blocked = (cx, cz, w, d, m = 2) => {
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (track.distTo(cx - w / 2 + w * i / 4, cz - d / 2 + d * j / 4, 60) < hw + m) return true;
    return false;
  };
  [[686, N, 0, 0xe8e2d4], [642, S, Math.PI, 0xf2eee4], [672, S, Math.PI, 0xe8e2d4], [500, S, Math.PI, 0xe9dccb]].forEach(([x, zf, ry, col], i) => {
    const w = 26, d = 18, h = 16 + (i % 2) * 8;
    if (blocked(x, zf + (ry ? 1 : -1) * (d / 2 - 1.5), w, d + 3)) return;
    const k = kitAt(b, x, gy(x), zf + (ry ? 1 : -1) * d / 2, ry, 1);
    k.box(w, h, d, col, 0, h / 2, 0, { breakMul: 0.3 });
    k.box(w, 0.6, 3, 0x8a98a2, 0, 4.5, d / 2 + 1.5);
    for (let fy = 7.5; fy < h - 1; fy += 3.6) k.box(w + 0.3, 0.9, d + 0.3, 0x8a98a2, 0, fy, 0, { cast: false, breakMul: 0.1 });
  });
  // 路灯：两侧人行道每 26 米一盏，灯臂伸向路面
  for (let x = 480; x < 700; x += 26) for (const sd of [-1, 1]) {
    if (Math.abs(x - 562) < 12 || Math.abs(x - 558) < 10) continue;   // 别挡住两家旗舰店的大门
    const zz = z0 + sd * (hw + 2.4);
    // 平海路东头接延安路的弯道一带，路灯会落到赛道上：灯杆和灯臂都要离路面边缘至少 1.5 米
    if (track.distTo(x, zz, 40) < hw + 1.5 || track.distTo(x, zz - sd * 2.5, 40) < hw + 0.5) continue;
    const k = kitAt(b, x, gy(x), zz, sd > 0 ? Math.PI : 0, 1);
    k.cyl(0.14, 0.2, 8, 0x5a6168, 0, 4, 0, 8);
    k.box(0.16, 0.16, 2.6, 0x5a6168, 0, 7.9, 1.2);
    k.box(0.9, 0.25, 0.5, 0x3a3f46, 0, 7.8, 2.5);
    k.box(0.7, 0.08, 0.36, 0xfff3c8, 0, 7.64, 2.5, { kind: 'GLOW', glow: 1.0 });
  }
  // 龙翔桥地铁站口：玻璃雨棚 + 红色站牌
  { const [x, z] = LY.LONGXIANG, k = kitAt(b, x, groundAt(x, z) - 0.3, z, 0, 1);
    k.box(10, 0.4, 7, 0xd8dcdc, 0, 4.2, 0);
    k.box(9.6, 3.6, 0.2, 0xcfe7ea, 0, 2.2, -3.4, { kind: 'GLASS', shade: 0x6f97a6 });
    for (const sx of [-4.8, 4.8]) k.box(0.3, 4.2, 7, 0xb8bcbc, sx, 2.1, 0);
    k.box(0.5, 6.5, 0.5, 0x8a8f96, 7, 3.25, 2.5);
    signMesh(scene, signTex([['地铁', 96, 82], ['龙翔桥站', 120, 200]], 512, 280, '#c4473a', '#ffffff'), 3.2, 1.75, x + 7, groundAt(x, z) + 6.5, z + 2.5 + 0.3, 0); }
  // 平海路路牌（路口）
  { // 路口的路牌：从 (458,-78) 往外找一个离路面足够远的位置
    let sx = 458, sz = -78;
    for (let r = 0; r < 40 && track.distTo(sx, sz, 60) < hw + 3; r += 2) for (let a = 0; a < 8; a++) {
      const tx = 458 + Math.cos(a * Math.PI / 4) * r, tz = -78 + Math.sin(a * Math.PI / 4) * r;
      if (track.distTo(tx, tz, 60) >= hw + 3) { sx = tx; sz = tz; break; }
    }
    signMesh(scene, signTex([['平海路', 120, 90], ['PINGHAI RD', 52, 190]], 512, 256, '#2f6f8a', '#ffffff'), 4, 2, sx, groundAt(sx, sz) + 5, sz, Math.PI / 2);
  }
}

// 城市：湖滨以东的街区，近湖低、越往东越高
function city(b, rand, groundAt, clear) {
  const c = LY.CITY;
  const cols = [0xf2eee4, 0xe8e2d4, 0xdcd8cc, 0xc9d3d6, 0xe9dccb, 0xd6dde0];
  for (let x = c.x0 + 10; x < c.x1; x += 62) for (let z = c.z0; z < c.z1; z += 58) {
    if (rand() < 0.12) continue;
    const far = (x - c.x0) / (c.x1 - c.x0);
    const n = 1 + Math.floor(rand() * 2);
    for (let j = 0; j < n; j++) {
      const w = 18 + rand() * 18, d = 16 + rand() * 18;
      const bx = x + (j ? 26 : 0) + rand() * 6, bz = z + rand() * 10;
      const tall = rand() < 0.15 + far * 0.45;
      const h = tall ? 40 + rand() * (40 + far * 80) : 12 + rand() * (10 + far * 14);
      if (!clear(bx, bz, Math.max(w, d) * 0.6 + 6)) continue;
      const gy = groundAt(bx, bz) - 0.5, col = cols[Math.floor(rand() * cols.length)];
      const k = kitAt(b, bx, gy, bz, 0, 1);
      if (tall && rand() < 0.6) {
        k.box(w, h, d, 0x9fc0cc, 0, h / 2, 0, { kind: 'GLASS', shade: 0x4c6f86 });
        k.box(w + 1, 1.2, d + 1, 0xe8e6e0, 0, h + 0.6, 0);
      } else {
        k.box(w, h, d, col, 0, h / 2, 0, { breakMul: 0.3 });
        for (let fy = 3.6; fy < h - 1; fy += 3.6) k.box(w + 0.3, 0.9, d + 0.3, 0x8a98a2, 0, fy, 0, { cast: false, breakMul: 0.1 });
        k.box(w * 0.3, 2.4, d * 0.3, 0xcfcac0, w * 0.15, h + 1.2, 0);
      }
    }
  }
}

// ---------- 总装 ----------
export async function buildScenery(track, terrain, scene, onProgress = () => {}) {
  const rand = makeRand(11);
  const { groundAt, isWater } = terrain;
  const b = new Batch(), inst = new Inst();
  const hw = track.halfW;
  const nearTrack = (x, z, m) => track.distTo(x, z, hw + m + 2) < hw + m;

  // 地标
  baochu(b, LY.BAOCHU[0], groundAt(...LY.BAOCHU) - 2, LY.BAOCHU[1]);
  leifeng(b, LY.LEIFENG[0], groundAt(...LY.LEIFENG) - 1, LY.LEIFENG[1]);
  liuhe(b, LY.LIUHE[0], groundAt(...LY.LIUHE) - 1, LY.LIUHE[1]);
  LY.SANTAN.forEach(([x, z]) => lantern(b, x, z));
  { const [x, z] = LY.ISLANDS[1].c; pavilion(b, x, groundAt(x, z), z, 0.5, 9); }
  { const [x, z] = LY.ISLANDS[0].c; pavilion(b, x - 12, groundAt(x - 12, z - 8), z - 8, 0.5, 8); pavilion(b, x + 18, groundAt(x + 18, z + 6), z + 6, 0.5, 6, 0.4);
    // 九曲桥：小瀛洲里的折线石桥
    let px = x - 30, pz = z + 30;
    for (let i = 0; i < 6; i++) { const ang = i % 2 ? 0.6 : -0.6, nx = px + Math.sin(ang) * 9, nz = pz - Math.cos(ang) * 9; kitAt(b, (px + nx) / 2, WATER + 0.5, (pz + nz) / 2, ang, 1).box(2.4, 0.5, 9.4, 0xe2dccf); px = nx; pz = nz; } }
  { const [x, z] = LY.ISLANDS[2].c; pavilion(b, x, groundAt(x, z), z, 0.45, 6, 0.5); }
  // 孤山：西泠印社的小石塔、平湖秋月伸进湖面的亭子、山上几座白墙民居（孤山路在南麓）
  { const g = LY.GUSHAN.c;
    const tx = g[0] - 44, tz = g[1] - 16;
    const k = kitAt(b, tx, groundAt(tx, tz) - 0.5, tz, 0, 3.4);
    octo(k, 0.5, 0.6, 0.6, 0xcfc7b6, 0.3);
    for (let i = 0; i < 6; i++) { octo(k, 0.36 - i * 0.04, 0.38 - i * 0.04, 0.5, 0xd8d0c0, 0.85 + i * 0.6); octo(k, 0.5 - i * 0.045, 0.5 - i * 0.045, 0.08, 0x9d9488, 1.12 + i * 0.6); }
    pavilion(b, -2, WATER + 1.4, -306, 0.5, 7, 0.2);
    [[-20, -12], [6, -20], [34, -14], [56, -20]].forEach(([dx, dz], i) => { const x = g[0] + dx, z = g[1] + dz; if (!nearTrack(x, z, 9)) jiangnan(b, x, groundAt(x, z) - 0.3, z, 2.4, 1.6, 1.4 + (i % 2), 0.1 * i, 4); }); }
  // 于谦祠：三台山半山，之字形山路中间
  temple(b, LY.YUQIAN[0], groundAt(...LY.YUQIAN) - 0.3, LY.YUQIAN[1], 0, 0.42);
  // 苏堤的六座拱桥（景观，不在赛道上）
  LY.SUDI_GAPS.forEach(([x, z], k) => {
    const nxt = LY.SUDI_GAPS[Math.min(k + 1, 5)], prv = LY.SUDI_GAPS[Math.max(k - 1, 0)];
    archBridge(b, x, z, Math.atan2(nxt[0] - prv[0], nxt[1] - prv[1]), 30, 7, 3.2);
  });
  temple(b, LY.YUEWANG[0], groundAt(...LY.YUEWANG) - 0.3, LY.YUEWANG[1], 0.1);
  // 龙井村：山顶发卡弯边上几户白墙黛瓦
  [[-150, 838, 0.3], [-118, 852, 0.1], [-178, 826, 0.6], [-90, 842, -0.2], [-240, 790, 1.4], [-250, 830, 1.2]].forEach(([x, z, r], i) => {
    if (nearTrack(x, z, 14)) return;
    jiangnan(b, x, groundAt(x, z) - 0.4, z, 2.6, 1.6, i % 2 ? 2.0 : 1.4, r, 4.6);
  });
  // 湖滨与北山街路边的茶室、码头
  [[150, -490, 0], [-130, -495, 0], [460, -150, Math.PI / 2], [462, 120, Math.PI / 2]].forEach(([x, z, r]) => { if (!nearTrack(x, z, 8)) jiangnan(b, x, groundAt(x, z) - 0.4, z, 3.2, 1.8, 1.5, r, 4.4); });
  const shopZone = (x, z) => x > 450 && x < 720 && z > -130 && z < 40;   // 平海路商业街，留给下面的旗舰店
  city(b, rand, groundAt, (x, z, r) => !nearTrack(x, z, r) && !shopZone(x, z) && Math.hypot(x - LY.FOUNTAIN[0], z - LY.FOUNTAIN[1]) > 40);
  shoppingStreet(b, scene, track, groundAt);
  onProgress(0.15);
  await slice();

  // 树：苏堤、白堤上“一株杨柳一株桃”，北山街和湖滨沿湖一排柳树、靠城一侧一排行道树
  const place = (kind, x, z, s, ry = rand() * 6.28, tint) => { if (kind !== 'tea' && nearTrack(x, z, 2.5)) return; inst.push(kind, M(x, groundAt(x, z) - 0.15, z, ry, s), tint); };
  for (let i = 0; i < track.N; i += 6) {
    if (track.bridge[i] || track.mountain[i]) continue;
    const onSudi = track.surface[i] === 1;   // 白堤：一株杨柳一株桃
    for (const side of [-1, 1]) {
      const lat = side * (hw + 6 + rand() * 2), x = track.px[i] + track.rx[i] * lat, z = track.pz[i] + track.rz[i] * lat;
      if (isWater(x, z)) continue;
      if (onSudi) place((i / 6 + (side > 0 ? 1 : 0)) % 2 ? 'peach' : 'willow', x, z, (onSudi ? 3.4 : 3.6) + rand() * 0.6);
      else {
        const lakeSide = baseHeight(track.px[i] - track.rx[i] * side * 40, track.pz[i] - track.rz[i] * side * 40) > WATER && baseHeight(x + track.rx[i] * side * 30, z + track.rz[i] * side * 30) < WATER;
        if (lakeSide) { if (i % 12 === 0) place('willow', x, z, 3.6 + rand() * 0.5); }   // 和行道树一样 18 米一株
        else if (i % 12 === 0 && !(x > 450 && x < 720 && z > -130 && z < 40)) place('round', x, z, 6 + rand() * 2, undefined, leafTints[i % 4]);
      }
    }
  }
  // 苏堤（景观堤）两侧：一株杨柳一株桃，桥口留空
  for (let k = 0; k < LY.SUDI.length - 1; k++) {
    const [ax, az] = LY.SUDI[k], [bx, bz] = LY.SUDI[k + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let t = 0; t < len; t += 12) for (const sd of [-1, 1]) {
      const cx = ax + (bx - ax) * t / len, cz = az + (bz - az) * t / len;
      if (LY.SUDI_GAPS.some(([gx, gz]) => Math.hypot(cx - gx, cz - gz) < 20)) continue;
      place(Math.floor(t / 12 + (sd > 0)) % 2 ? 'peach' : 'willow', cx + nx * sd * 4.5, cz + nz * sd * 4.5, 3.2 + rand() * 0.4);
    }
  }
  for (const s of LY.ISLANDS) for (let a = 0; a < 6.28; a += 0.5) {
    const x = s.c[0] + Math.cos(a) * (s.r - 6), z = s.c[1] + Math.sin(a) * (s.r - 6);
    if (!isWater(x, z)) place('willow', x, z, 3.2);
  }
  onProgress(0.3);
  await slice();

  // 山林：宝石山、葛岭、孤山、夕照山、玉皇山、西湖群山。离赛道 140 米以内用细一点的树冠
  const core = (x, z) => x > -520 && x < 600 && z > -760 && z < 920;
  for (let z = -1250; z < 1650; z += 1) {
    const stepZ = core(0, z) ? 13 : 26;
    for (let x = -1250; x < 1650; x += core(x, z) ? 13 : 26) {
      const jx = x + (rand() - 0.5) * 10, jz = z + (rand() - 0.5) * 10;
      const h = groundAt(jx, jz);
      if (h < 2.5 || isWater(jx, jz)) continue;
      if (jx > LY.CITY.x0 - 30 && jz < LY.CITY.z1 + 60 && jz > LY.CITY.z0 - 60) continue;
      const tea = Math.hypot(jx - LY.TEA.c[0], jz - LY.TEA.c[1]) < LY.TEA.r;
      if (tea) continue;
      const dens = smoothstep(2.5, 9, h) * (0.55 + 0.5 * fbm2(jx * 0.01, jz * 0.01));
      if (rand() > dens) continue;
      if (nearTrack(jx, jz, 5)) continue;
      if (Math.hypot(jx - LY.BAOCHU[0], jz - LY.BAOCHU[1]) < 14 || Math.hypot(jx - LY.LEIFENG[0], jz - LY.LEIFENG[1]) < 22 || Math.hypot(jx - LY.LIUHE[0], jz - LY.LIUHE[1]) < 22) continue;
      place(rand() < 0.22 ? 'tall' : 'round', jx, jz, 7 + rand() * 5, undefined, leafTints[Math.floor(rand() * 4)]);
    }
    z += stepZ - 1;
    if ((z & 63) < stepZ) await slice();
  }
  onProgress(0.6);

  // 龙井茶园：茶垄沿等高线排（按高度取条纹），一垄一垄绕着山
  for (let z = LY.TEA.c[1] - LY.TEA.r; z < LY.TEA.c[1] + LY.TEA.r; z += 2.0) {
    for (let x = LY.TEA.c[0] - LY.TEA.r; x < LY.TEA.c[0] + LY.TEA.r; x += 2.4) {
      if (Math.hypot(x - LY.TEA.c[0], z - LY.TEA.c[1]) > LY.TEA.r - rand() * 10) continue;
      const h = groundAt(x, z);
      if ((h / 1.7) % 1 > 0.42 || h < 3) continue;
      if (nearTrack(x, z, 3)) continue;
      // 让茶垄顺着等高线：朝向沿梯度的垂直方向
      const gx = groundAt(x + 1, z) - groundAt(x - 1, z), gz = groundAt(x, z + 1) - groundAt(x, z - 1);
      place('tea', x, z, 1.6 + rand() * 0.3, Math.atan2(gx, gz), leafTints[Math.floor(rand() * 4)]);
    }
  }
  // 竹林：三台山山路两侧几片
  [[-520, -52, 26], [-590, 96, 30], [-470, 168, 22], [-560, 236, 26], [-380, -10, 20]].forEach(([cx, cz, r]) => {
    for (let k = 0; k < r * 0.9; k++) {
      const a = rand() * 6.28, d = Math.sqrt(rand()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!nearTrack(x, z, 2) && !isWater(x, z)) place('bamboo', x, z, 0.9 + rand() * 0.4);
    }
  });
  // 曲院风荷
  for (let k = 0; k < 260; k++) {
    const x = -396 + rand() * 98, z = -532 + rand() * 80;
    if (groundAt(x, z) > WATER - 0.6) continue;
    inst.push('lotus', M(x, WATER, z, rand() * 6.28, 1 + rand() * 1.4), leafTints[k % 4]);
    if (rand() < 0.2) inst.push('lotusFlower', M(x + 0.6, WATER, z, 0, 1 + rand() * 0.4));
  }
  onProgress(0.8);
  await slice();

  b.flush(scene);
  inst.flush(scene, treeKinds());
  onProgress(1);
}

// 湖上的游船：手划船和画舫，慢慢地绕圈
export function buildBoats(scene) {
  const rand = makeRand(5);
  const boats = [];
  const mk = (canopyHex, len, wid, s) => {
    const g = new THREE.Group(), inner = new THREE.Group();
    const L2 = len / 2, sh = new THREE.Shape();
    sh.moveTo(-L2, 0); sh.quadraticCurveTo(0, wid, L2, 0); sh.quadraticCurveTo(0, -wid, -L2, 0);
    const hull = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: false }); hull.rotateX(-Math.PI / 2); hull.translate(0, -0.06, 0);
    inner.add(new THREE.Mesh(hull, toon(0x5b4434, { breakMul: 0.2 })));
    const can = new THREE.CylinderGeometry(0.21, 0.21, len * 0.42, 12, 1, true, 0, Math.PI); can.rotateZ(Math.PI / 2); can.translate(-0.05, 0.14, 0);
    inner.add(new THREE.Mesh(can, toon(canopyHex, { side: THREE.DoubleSide, breakMul: 0.2 })));
    inner.rotation.y = Math.PI / 2;
    g.add(inner); g.scale.setScalar(s);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    return g;
  };
  const spots = [[60, -200], [180, -100], [-80, 120], [200, 200], [120, 330], [-120, -150], [250, -260], [-60, 330], [280, 40], [-150, 260]];
  spots.forEach(([x, z], i) => {
    const big = i % 4 === 0;
    const g = mk(big ? 0xb4483a : [0xd65b4f, 0x4f9d8f, 0xe8b14a][i % 3], big ? 3.2 : 1.4, big ? 0.9 : 0.5, big ? 5 : 3.4);
    boats.push({ g, cx: x, cz: z, r: 18 + rand() * 25, w: (0.012 + rand() * 0.02) * (i % 2 ? 1 : -1), a: rand() * 6.28 });
  });
  // 湖滨音乐喷泉：一圈彩色水柱，高低起伏；颜色随时间转（彩虹一圈转 → 全场同色闪 → 再转），水面一圈同色的光
  const jets = [];
  const jetGeo = new THREE.CylinderGeometry(0.45, 2.0, 1, 14, 6).translate(0, 0.5, 0);
  const jetMat = () => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uTime: G.uTime, uBend: G.uBend, uBendStart: G.uBendStart },
    vertexShader: /* glsl */`
      ${BEND_GLSL}
      varying float vY; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vY = position.y; vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * bendWorld(wp);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime;
      varying float vY; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float streak = 0.82 + 0.18 * sin(vUv.x * 75.0 + vY * 6.0 - uTime * 9.0);
        float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 1.5);
        vec3 c = uColor * streak;
        c = mix(c, vec3(1.0), smoothstep(0.45, 1.0, vY) * 0.7 + rim * 0.25);   // 顶上是白色水花，边缘发亮
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2, r = i % 3 === 0 ? 0 : i % 2 ? 9 : 16;
    const j = new THREE.Mesh(jetGeo, jetMat());
    j.position.set(LY.FOUNTAIN[0] + Math.cos(a) * r, WATER, LY.FOUNTAIN[1] + Math.sin(a) * r);
    j.castShadow = false; j.receiveShadow = false; j.layers.set(1); scene.add(j); jets.push({ j, ph: a * 2 + r, a });
  }
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uBend: G.uBend, uBendStart: G.uBendStart },
    vertexShader: /* glsl */`
      ${BEND_GLSL}
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * viewMatrix * bendWorld(modelMatrix * vec4(position, 1.0)); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying vec2 vP;
      void main() { float d = length(vP) / 24.0; gl_FragColor = vec4(uColor * smoothstep(1.0, 0.25, d) * 0.55, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2), glowMat);
  glow.position.set(LY.FOUNTAIN[0], WATER + 0.06, LY.FOUNTAIN[1]); glow.layers.set(1); glow.renderOrder = 2; scene.add(glow);
  const hue = (t, a) => {
    const phase = (t / 8) % 3;                       // 每 8 秒换一个花样
    if (phase < 1) return (t * 0.12 + a / 6.283) % 1;  // 彩虹沿圆圈转
    if (phase < 2) return (Math.floor(t * 1.5) * 0.37) % 1;   // 全场同色，跟着节拍换色
    return (t * 0.2 + (a < 3.14 ? 0 : 0.5)) % 1;     // 两半对比色
  };
  return t => {
    for (const { j, ph, a } of jets) {
      j.scale.set(1, 3 + 11 * (0.5 + 0.5 * Math.sin(t * 1.6 + ph)), 1);
      j.material.uniforms.uColor.value.setHSL(hue(t, a), 0.9, 0.58);
    }
    glowMat.uniforms.uColor.value.setHSL(hue(t, 0), 0.9, 0.55);
    for (const bt of boats) {
      const a = bt.a + t * bt.w;
      bt.g.position.set(bt.cx + Math.cos(a) * bt.r, WATER + 0.05 + Math.sin(t * 1.3 + bt.a) * 0.06, bt.cz + Math.sin(a) * bt.r);
      bt.g.rotation.y = Math.atan2(-Math.sin(a) * bt.w, Math.cos(a) * bt.w);
      bt.g.rotation.z = Math.sin(t * 1.1 + bt.a) * 0.03;
    }
  };
}

