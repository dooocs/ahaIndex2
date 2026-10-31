// 景物：地标、城市、树木、茶园、荷塘、游船。造型沿用梦想人生（保俶塔、雷峰塔、拱桥、三潭印月、亭子、马头墙民居、
// 柳树和桃树的写法），按赛车的尺度放大（梦想人生里 1 单位约 1.5 米、看的是近景；这里要在 200 公里时速下认得出来）。
// 静态几何按材质 + 300 米地块合并，树和茶树按地块做 InstancedMesh，都能被视锥剔除。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, mergeColored } from './toon.js';
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
export function updateLOD(cam) {
  for (const t of LODS) {
    const near = Math.hypot(cam.x - t.x, cam.z - t.z) < t.swap;
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
  // 柳树：一团柔软的冠，四周垂下柳条（远处少几根柳条）
  const willow = (detail, strands) => {
    const parts = [lump(0.62, detail, 0.25, 51)]; parts[0].scale(1.15, 0.6, 1.15); parts[0].translate(0, 1.85, 0);
    for (let i = 0; i < strands; i++) {
      const a = i / strands * Math.PI * 2 + (i % 2) * 0.16, rr = 0.5 + (i % 3) * 0.12, len = 0.85 + ((i * 7) % 5) * 0.13;
      parts.push(new THREE.ConeGeometry(0.075 * 20 / strands, len, 4).rotateX(Math.PI).translate(Math.cos(a) * rr, 1.75 - len / 2, Math.sin(a) * rr));
    }
    return blobify(mergeGeometries(parts.map(prep)), new THREE.Vector3(0, 1.5, 0), 0.25);
  };
  const wTrunk = new THREE.CylinderGeometry(0.07, 0.11, 1.75, 6).translate(0, 0.87, 0), wTrunkMat = toon(0x7a6150, { shade: 0x56484c });
  const wLeaf = foliage(0xa3cf6e, 0x5e9264, 1.6, 0.6);
  K.willow = { near: [{ geo: wTrunk, mat: wTrunkMat }, { geo: willow(1, 18), mat: wLeaf }], far: [{ geo: wTrunk, mat: wTrunkMat, cast: false }, { geo: willow(0, 9), mat: wLeaf, cast: false }], swap: 260 };
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

// 平海路：龙翔桥起步的商业街。临街是几家旗舰店的样子（不用真实品牌名和标志）：
// 右手（北侧）一座通透的玻璃盒子数码旗舰店、一家黑色门面的影音店；左手（南侧）米白石材配金色菱格的奢侈品店、
// 一家浅粉色的美妆店；龙翔桥地铁站口在起点右后方。
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
function shoppingStreet(b, scene, track, groundAt) {
  const z0 = -46, hw = track.halfW, front = hw + 8;   // 门面离路中心 19 米（含人行道）
  const N = z0 - front, S = z0 + front;               // 北侧门面线、南侧门面线
  const gy = x => groundAt(x, z0) - 0.4;
  // 北侧：玻璃盒子数码旗舰店（通高玻璃、白色薄屋檐、门前一排小树池）
  { const x = 560, w = 40, d = 26, h = 15, k = kitAt(b, x, gy(x), N - d / 2, 0, 1);
    k.box(w, h, d, 0xbcd8e0, 0, h / 2, 0, { kind: 'GLASS', shade: 0x6f97a6 });
    k.box(w + 2.4, 0.8, d + 2.4, 0xf4f4f0, 0, h + 0.4, 0);
    for (let i = -3; i <= 3; i++) k.box(0.35, h, 0.35, 0xe8ecec, i * (w / 7), h / 2, d / 2 + 0.2);
    k.box(w * 0.5, 6, 0.2, 0xf4f4f0, 0, 3, d / 2 + 0.15, { cast: false });
    for (let i = -2; i <= 2; i++) k.box(2.4, 0.6, 2.4, 0xcfc8b8, i * 8, 0.3, d / 2 + 4); }
  // 北侧：黑色门面的影音店，门头一块发光的大屏
  { const x = 510, w = 22, d = 22, h = 20, k = kitAt(b, x, gy(x), N - d / 2, 0, 1);
    k.box(w, h, d, 0x2f3438, 0, h / 2, 0, { breakMul: 0.2 });
    k.box(w - 4, 7, 0.4, 0x8fe0ff, 0, h - 6, d / 2 + 0.2, { kind: 'GLOW', glow: 1.0 });
    k.box(w - 6, 5, 0.3, 0xcfe7ea, 0, 3, d / 2 + 0.2, { kind: 'GLASS', shade: 0x6f97a6 }); }
  // 南侧：奢侈品店——米白石材、金色菱格立面、深色雨棚
  { const x = 568, w = 34, d = 22, h = 18, k = kitAt(b, x, gy(x), S + d / 2, Math.PI, 1);
    k.box(w, h, d, 0xece4d2, 0, h / 2, 0, { breakMul: 0.25 });
    for (let r = 0; r < 4; r++) for (let q = 0; q < 8; q++) {
      const g = new THREE.BoxGeometry(2.2, 2.2, 0.25); g.rotateZ(Math.PI / 4); g.translate(-w / 2 + 2.5 + q * 4.2, 6 + r * 3.2, d / 2 + 0.15);
      k.add(g, 0xc9a352, { breakMul: 0.15 });
    }
    k.box(w - 4, 0.5, 3, 0x3a2f2a, 0, 4.4, d / 2 + 1.5);
    k.box(w - 8, 3.8, 0.3, 0xcfe7ea, 0, 2.1, d / 2 + 0.2, { kind: 'GLASS', shade: 0x6f97a6 });
    k.box(w + 1, 0.8, d + 1, 0xc9a352, 0, h + 0.4, 0); }
  // 南侧：浅粉色的美妆店，二楼一排拱窗
  { const x = 518, w = 24, d = 20, h = 14, k = kitAt(b, x, gy(x), S + d / 2, Math.PI, 1);
    k.box(w, h, d, 0xf3d6d8, 0, h / 2, 0, { breakMul: 0.25 });
    for (let q = -2; q <= 2; q++) { k.box(3, 4, 0.3, 0xffffff, q * 4.5, 9, d / 2 + 0.15); k.add(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(q * 4.5, 11, d / 2 + 0.15), 0xffffff); }
    k.box(w - 6, 3.8, 0.3, 0xcfe7ea, 0, 2.1, d / 2 + 0.2, { kind: 'GLASS', shade: 0x6f97a6 });
    k.box(w + 1, 0.6, d + 1, 0xe6b8bd, 0, h + 0.3, 0); }
  // 再往东两侧补几栋带骑楼的街面房子，让起步那一段像一条完整的商业街
  [[650, N, 0, 0xe8e2d4], [680, N, 0, 0xdcd8cc], [612, S, Math.PI, 0xe9dccb], [642, S, Math.PI, 0xf2eee4], [672, S, Math.PI, 0xe8e2d4]].forEach(([x, zf, ry, col], i) => {
    const w = 26, d = 18, h = 16 + (i % 2) * 8, k = kitAt(b, x, gy(x), zf + (ry ? 1 : -1) * d / 2, ry, 1);
    k.box(w, h, d, col, 0, h / 2, 0, { breakMul: 0.3 });
    k.box(w, 0.6, 3, 0x8a98a2, 0, 4.5, d / 2 + 1.5);
    for (let fy = 7.5; fy < h - 1; fy += 3.6) k.box(w + 0.3, 0.9, d + 0.3, 0x8a98a2, 0, fy, 0, { cast: false, breakMul: 0.1 });
  });
  // 龙翔桥地铁站口：玻璃雨棚 + 红色站牌
  { const [x, z] = LY.LONGXIANG, k = kitAt(b, x, groundAt(x, z) - 0.3, z, 0, 1);
    k.box(10, 0.4, 7, 0xd8dcdc, 0, 4.2, 0);
    k.box(9.6, 3.6, 0.2, 0xcfe7ea, 0, 2.2, -3.4, { kind: 'GLASS', shade: 0x6f97a6 });
    for (const sx of [-4.8, 4.8]) k.box(0.3, 4.2, 7, 0xb8bcbc, sx, 2.1, 0);
    k.box(0.5, 6.5, 0.5, 0x8a8f96, 7, 3.25, 2.5);
    signMesh(scene, signTex([['地铁', 96, 82], ['龙翔桥站', 120, 200]], 512, 280, '#c4473a', '#ffffff'), 3.2, 1.75, x + 7, groundAt(x, z) + 6.5, z + 2.5 + 0.3, 0); }
  // 平海路路牌（路口）
  signMesh(scene, signTex([['平海路', 120, 90], ['PINGHAI RD', 52, 190]], 512, 256, '#2f6f8a', '#ffffff'), 4, 2, 458, groundAt(458, -78) + 5, -78, Math.PI / 2);
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
  const shopZone = (x, z) => x > 450 && x < 700 && z > -118 && z < 26;   // 平海路商业街，留给下面的旗舰店
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
        if (lakeSide) place('willow', x, z, 3.6 + rand() * 0.5);
        else if (i % 12 === 0 && !(x > 450 && x < 700 && z > -118 && z < 26)) place('round', x, z, 6 + rand() * 2, undefined, leafTints[i % 4]);
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
  // 湖滨音乐喷泉：一圈水柱，高低起伏
  const jets = [], jetMat = toon(0xeef8f8, { shade: 0x9cc7d0, kind: 'FOLIAGE', breakMul: 0.4, noiseScale: 3 });
  const jetGeo = new THREE.CylinderGeometry(0.5, 2.0, 1, 10).translate(0, 0.5, 0);
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2, r = i % 3 === 0 ? 0 : i % 2 ? 9 : 16;
    const j = new THREE.Mesh(jetGeo, jetMat);
    j.position.set(LY.FOUNTAIN[0] + Math.cos(a) * r, WATER, LY.FOUNTAIN[1] + Math.sin(a) * r);
    j.castShadow = false; j.receiveShadow = true; j.layers.set(1); scene.add(j); jets.push({ j, ph: a * 2 + r });
  }
  return t => {
    for (const { j, ph } of jets) j.scale.set(1, 3 + 11 * (0.5 + 0.5 * Math.sin(t * 1.6 + ph)), 1);
    for (const bt of boats) {
      const a = bt.a + t * bt.w;
      bt.g.position.set(bt.cx + Math.cos(a) * bt.r, WATER + 0.05 + Math.sin(t * 1.3 + bt.a) * 0.06, bt.cz + Math.sin(a) * bt.r);
      bt.g.rotation.y = Math.atan2(-Math.sin(a) * bt.w, Math.cos(a) * bt.w);
      bt.g.rotation.z = Math.sin(t * 1.1 + bt.a) * 0.03;
    }
  };
}
