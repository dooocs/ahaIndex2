// 赛道的几何：路面、路肩下沿、弯心路肩、护栏（湖边石栏 / 山路木护栏 / 桥上白石栏杆）、拱桥、起点线与牌坊、加速带。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, mesh } from './toon.js';
import { WATER } from './terrain.js';

const STONE = 0xe6e0d2, STONE_CAP = 0xc9c1b0, MARBLE = 0xf1eee6, WOOD = 0x8a6a52, KERB_R = 0xd8584a, KERB_W = 0xf3efe6;

// 赛段风格：山路（木护栏）、苏堤（石板路面）、其余湖边城市路
export function classify(track) {
  const N = track.N;
  track.mountain = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const x = track.px[i], z = track.pz[i];
    // 三台山之字形是山路（木护栏）；白堤和所有拱桥是石板路
    track.mountain[i] = x < -408 && z > -48 && z < 246 ? 1 : 0;
    track.surface[i] = track.bridge[i] || (x > -16 && x < 258 && z > -420 && z < -330) ? 1 : 0;
  }
}

// 一条沿路的带子：fn(i) 返回这一行的若干顶点 [[x,y,z], ...]，相邻行之间连成四边形
function strip(track, i0, i1, fn, uvFn) {
  const N = track.N, pos = [], uv = [], idx = [];
  let cols = 0, rows = 0;
  for (let r = i0; r <= i1; r++) {
    const i = ((r % N) + N) % N, row = fn(i, r);
    cols = row.length;
    row.forEach((p, c) => { pos.push(p[0], p[1], p[2]); uv.push(...(uvFn ? uvFn(i, r, c) : [c, r * track.ds])); });
    rows++;
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// 连续区间：pred(i) 为真的若干段 [i0, i1]（闭环，可能跨越 0）
function runs(track, pred, minLen = 2) {
  const N = track.N, out = [];
  let start = 0;
  while (start < N && pred(start)) start++;
  if (start === N) return [[0, N]];
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (pred(i)) { if (!cur) cur = [start + k, start + k]; else cur[1] = start + k; }
    else if (cur) { if (cur[1] - cur[0] + 1 >= minLen) out.push(cur); cur = null; }
  }
  if (cur && cur[1] - cur[0] + 1 >= minLen) out.push(cur);
  return out;
}

const P = (track, i, lat, dy = 0) => {
  const sb = Math.sin(track.bank[i]);
  return [track.px[i] + track.rx[i] * lat, track.py[i] + lat * sb + dy, track.pz[i] + track.rz[i] * lat];
};

// 按 260 米分块合并，便于剔除
function chunked(track, i0, i1, build, hex, opts, add) {
  const step = Math.round(260 / track.ds);
  for (let a = i0; a < i1; a += step) add(mesh(build(a, Math.min(a + step, i1)), hex, opts));
}

export function buildTrackMeshes(track, scene) {
  const N = track.N, hw = track.halfW;
  const add = m => { m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); return m; };

  // 路面（沥青 / 石板由 aPath 区分）
  chunked(track, 0, N, (a, b) => {
    const g = strip(track, a, b, i => [P(track, i, -hw), P(track, i, hw)], (i, r, c) => [c, r * track.ds]);
    const sf = new Float32Array(g.attributes.position.count);
    for (let r = 0; r <= b - a; r++) sf[r * 2] = sf[r * 2 + 1] = track.surface[(a + r) % N];
    g.setAttribute('aPath', new THREE.BufferAttribute(sf, 1));
    return g;
  }, 0x8a8f96, { kind: 'ROAD', path: true, breakMul: 0.3, cast: false }, add);

  // 路面两侧的下沿（让路面像是铺在路基上）
  chunked(track, 0, N, (a, b) => mergeGeometries([-1, 1].map(s => strip(track, a, b, i => s < 0
    ? [P(track, i, -hw - 0.5, -2.2), P(track, i, -hw - 0.5, 0)]
    : [P(track, i, hw + 0.5, 0), P(track, i, hw + 0.5, -2.2)]))), 0xcfc8b8, { cast: false }, add);

  // 弯心路肩：红白相间，每 3 米换色
  {
    const red = [], white = [];
    for (const side of [-1, 1]) {
      const inner = i => track.curv[i] * -side > 1 / 95;
      for (const [a, b] of runs(track, inner, 12)) {
        for (let r = a; r < b; r += 2) {
          const blk = strip(track, r, Math.min(r + 2, b), i => side < 0
            ? [P(track, i, -hw + 0.02, 0.06), P(track, i, -hw + 1.3, 0.06)]
            : [P(track, i, hw - 1.3, 0.06), P(track, i, hw - 0.02, 0.06)]);
          (Math.floor((r - a) / 2) % 2 ? red : white).push(blk);
        }
      }
    }
    if (red.length) add(mesh(mergeGeometries(red), KERB_R, { cast: false, breakMul: 0.2 }));
    if (white.length) add(mesh(mergeGeometries(white), KERB_W, { cast: false, breakMul: 0.2 }));
  }

  // 护栏：平地和桥上是石栏（桥上更高更白），山路是木护栏
  const wallH = i => (track.bridge[i] ? 1.05 : 0.85);
  for (const side of [-1, 1]) {
    for (const [a, b] of runs(track, i => !track.mountain[i], 2)) {
      chunked(track, a, b, (s, e) => strip(track, s, e, i => {
        const h = wallH(i), l0 = side * hw, l1 = side * (hw + 0.55);
        return side < 0
          ? [P(track, i, l1, -0.6), P(track, i, l1, h), P(track, i, l0, h), P(track, i, l0, -0.05)]
          : [P(track, i, l0, -0.05), P(track, i, l0, h), P(track, i, l1, h), P(track, i, l1, -0.6)];
      }), STONE, { breakMul: 0.35 }, add);
      // 压顶
      chunked(track, a, b, (s, e) => strip(track, s, e, i => {
        const h = wallH(i) + 0.12, l0 = side * (hw - 0.08), l1 = side * (hw + 0.63);
        return side < 0 ? [P(track, i, l1, h), P(track, i, l0, h)] : [P(track, i, l0, h), P(track, i, l1, h)];
      }), STONE_CAP, { breakMul: 0.2, cast: false }, add);
    }
    // 山路：木柱 + 两道横木
    for (const [a, b] of runs(track, i => track.mountain[i], 2)) {
      for (const [y0, y1] of [[0.45, 0.62], [0.8, 0.97]]) {
        chunked(track, a, b, (s, e) => strip(track, s, e, i => {
          const l = side * (hw + 0.15);
          return side < 0 ? [P(track, i, l, y0), P(track, i, l, y1)] : [P(track, i, l, y1), P(track, i, l, y0)];
        }), WOOD, { side: THREE.DoubleSide, breakMul: 0.3 }, add);
      }
    }
  }
  {
    const posts = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < N; i += 2) if (track.mountain[i]) for (const side of [-1, 1]) {
      const p = P(track, i, side * (hw + 0.15));
      posts.push(m4.compose(new THREE.Vector3(p[0], p[1] + 0.25, p[2]), q.setFromEuler(e.set(0, track.hd[i], 0)), new THREE.Vector3(1, 1, 1)).clone());
    }
    const pg = new THREE.BoxGeometry(0.22, 1.5, 0.22);
    const im = new THREE.InstancedMesh(pg, toon(0x6e5446, { shade: 0x4f4448 }), posts.length);
    posts.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
  }

  // 拱桥：两侧桥身带拱洞，拱券底面，桥上栏杆柱
  const bridges = runs(track, i => track.bridge[i], 6);
  track.bridgeRuns = bridges;
  for (const [a, b] of bridges) {
    const n = b - a, mid = Math.round((a + b) / 2) % N;
    const deckMid = track.py[mid];
    const half = n * 0.36, rise = deckMid - 1.1 - WATER;
    const archY = r => { const x = (r - (a + b) / 2) / half; return Math.abs(x) >= 1 ? null : WATER - 0.4 + rise * Math.sqrt(1 - x * x); };
    const parts = [];
    for (const side of [-1, 1]) {
      parts.push(strip(track, a - 4, b + 4, (i, r) => {
        const top = P(track, i, side * (hw + 0.55), -0.6), btm = [top[0], archY(r) ?? WATER - 3.5, top[2]];
        return side < 0 ? [btm, top] : [top, btm];
      }));
    }
    // 拱券底面
    const r0 = Math.ceil((a + b) / 2 - half), r1 = Math.floor((a + b) / 2 + half);
    parts.push(strip(track, r0, r1, (i, r) => { const y = archY(r) ?? WATER; return [-1, 1].map(s => { const p = P(track, i, s * (hw + 0.55)); return [p[0], y, p[2]]; }); }));
    add(mesh(mergeGeometries(parts), 0xdedad0, { side: THREE.DoubleSide, kind: 'ROCK', shade: 0x9a978f, breakMul: 0.35 }));
    // 栏杆柱
    const pg = [];
    for (let r = a - 2; r <= b + 2; r += 2) for (const side of [-1, 1]) {
      const i = ((r % N) + N) % N, p = P(track, i, side * (hw + 0.27), 0);
      const g = new THREE.BoxGeometry(0.42, 1.55, 0.42); g.translate(p[0], p[1] + 0.6, p[2]); pg.push(g);
      const c = new THREE.SphereGeometry(0.24, 8, 6); c.translate(p[0], p[1] + 1.45, p[2]); pg.push(c);
    }
    add(mesh(mergeGeometries(pg), MARBLE, { breakMul: 0.2 }));
  }

  // 起点线：黑白格
  {
    const d0 = track.dAt(...track.startAt), i0 = Math.round(d0 / track.ds);
    const blk = [], wht = [], cols = 12, sq = (2 * hw) / cols;
    for (let row = 0; row < 2; row++) for (let c = 0; c < cols; c++) {
      const g = strip(track, i0 + row * 2, i0 + row * 2 + 2, i => [P(track, i, -hw + c * sq, 0.05), P(track, i, -hw + (c + 1) * sq, 0.05)]);
      ((row + c) % 2 ? blk : wht).push(g);
    }
    add(mesh(mergeGeometries(blk), 0x2a3238, { cast: false, breakMul: 0, offset: -2 }));
    add(mesh(mergeGeometries(wht), 0xf6f3ea, { cast: false, breakMul: 0, offset: -2 }));
    buildGate(track, i0 + 2, scene);
  }

  // 加速带：发光的箭头
  track.pads = [];
  for (const at of track.padAt) {
    const d = track.dAt(at[0], at[1]), i0 = Math.round(d / track.ds);
    const parts = [];
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
      const r = i0 + k * 3;
      parts.push(strip(track, r, r + 2, (i, rr) => {
        const t = 1 - (rr - r) / 2, lat0 = s * (0.4 + t * 2.6), lat1 = s * (1.2 + t * 2.6);
        return s < 0 ? [P(track, i, lat1, 0.07), P(track, i, lat0, 0.07)] : [P(track, i, lat0, 0.07), P(track, i, lat1, 0.07)];
      }));
    }
    const base = strip(track, i0 - 1, i0 + 9, i => [P(track, i, -4.2, 0.04), P(track, i, 4.2, 0.04)]);
    add(mesh(base, 0x2f6f8a, { cast: false, breakMul: 0, offset: -2 }));
    add(mesh(mergeGeometries(parts), 0x9ff4ff, { cast: false, kind: 'GLOW', glow: 1.15, offset: -4 }));
    track.pads.push({ d: (i0 - 1) * track.ds, len: 10 * track.ds, halfW: 4.2 });
  }
}

// 起点牌坊：两根朱红柱、黛瓦顶、牌匾“杭州飞车”
function buildGate(track, i, scene) {
  const hw = track.halfW, g = new THREE.Group();
  const RED = 0xb4483a, TILE = 0x4b5159;
  for (const s of [-1, 1]) {
    const x = s * (hw + 2.2);
    g.add(mesh(new THREE.CylinderGeometry(0.75, 0.85, 11, 12).translate(x, 5.5, 0), RED));
    g.add(mesh(new THREE.BoxGeometry(2.6, 1.2, 2.6).translate(x, 0.6, 0), 0xcfc7b6));
  }
  g.add(mesh(new THREE.BoxGeometry(2 * hw + 7, 1.0, 1.1).translate(0, 10.2, 0), RED));
  g.add(mesh(new THREE.BoxGeometry(2 * hw + 6, 0.6, 1.0).translate(0, 8.4, 0), RED));
  // 屋顶：一条长的坡屋面加两头翘角
  const roof = new THREE.Shape(); roof.moveTo(-1.8, 0); roof.lineTo(1.8, 0); roof.lineTo(0.6, 1.4); roof.lineTo(-0.6, 1.4); roof.closePath();
  const rg = new THREE.ExtrudeGeometry(roof, { depth: 2 * hw + 10, bevelEnabled: false });
  rg.translate(0, 0, -(2 * hw + 10) / 2); rg.rotateY(Math.PI / 2); rg.translate(0, 10.7, 0);
  g.add(mesh(rg, TILE, { shade: 0x30353c }));
  g.add(mesh(new THREE.BoxGeometry(2 * hw + 10.6, 0.35, 0.5).translate(0, 12.15, 0), 0x3a3f46));
  for (const s of [-1, 1]) g.add(mesh(new THREE.ConeGeometry(0.35, 1.8, 6).rotateZ(s * -1.0).translate(s * (hw + 5.6), 11.6, 0), 0x3a3f46));
  // 牌匾
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#2f3a3f'; c.fillRect(0, 0, 1024, 256);
  c.strokeStyle = '#d8b65e'; c.lineWidth = 14; c.strokeRect(14, 14, 996, 228);
  c.fillStyle = '#f2e3b3'; c.font = '900 150px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('杭州飞车', 512, 136);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.25), toon(0xffffff, { map: tex, breakMul: 0, side: THREE.DoubleSide }));
  sign.position.set(0, 9.3, 0.62); g.add(sign);
  const back = sign.clone(); back.position.z = -0.62; back.rotation.y = Math.PI; g.add(back);
  const p = P(track, i, 0);
  g.position.set(p[0], track.py[i], p[2]);
  g.rotation.y = track.hd[i];
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
}
