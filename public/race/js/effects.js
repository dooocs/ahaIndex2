// 特效：漂移烟（卡通的白色团子）、刹车印、撞墙火星。都是预先分配好的池子，每帧只改矩阵。
import * as THREE from 'three';
import { toon } from './toon.js';

export class Smoke {
  constructor(scene, n = 260) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(g, toon(0xf7f5ee, { shade: 0xbfc8cf, breakMul: 0.5, kind: 'FOLIAGE', noiseScale: 3 }), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    this.p = Array.from({ length: n }, () => ({ life: 0 }));
    this.k = 0; this.m4 = new THREE.Matrix4(); this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, this.zero);
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, size = 0.6, life = 0.9, tint = null) {
    const i = this.k, p = this.p[i]; this.k = (this.k + 1) % this.p.length;
    Object.assign(p, { x, y, z, vx, vy, vz, size, life, max: life });
    this.mesh.instanceColor.setXYZ(i, ...(tint || [1, 1, 1]));
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    this.p.forEach((p, i) => {
      if (p.life <= 0) return;
      p.life -= dt;
      if (p.life <= 0) { this.mesh.setMatrixAt(i, this.zero); return; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 1 - dt * 2.5; p.vz *= 1 - dt * 2.5; p.vy += dt * 0.8;
      const t = 1 - p.life / p.max, r = p.size * (0.6 + t * 1.8) * (t > 0.75 ? (1 - t) * 4 : 1);
      this.mesh.setMatrixAt(i, this.m4.compose(v.set(p.x, p.y, p.z), q, s.set(r, r * 0.8, r)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Skids {
  constructor(scene, n = 1400) {
    this.n = n; this.k = 0;
    this.pos = new Float32Array(n * 4 * 3);
    const idx = [];
    for (let i = 0; i < n; i++) { const a = i * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const nrm = new Float32Array(n * 4 * 3); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, toon(0x4a5058, { shade: 0x353b45, breakMul: 0, offset: -3, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.last = new Map();
  }
  // 每个轮子一条：传入这一帧轮子落地点和车的右向量
  mark(key, x, y, z, rx, rz, on) {
    const prev = this.last.get(key);
    if (!on) { this.last.delete(key); return; }
    const w = 0.22;
    if (prev && Math.hypot(x - prev[0], z - prev[2]) > 0.6) {
      const a = this.k * 12, P = this.pos;
      P.set([prev[0] - prev[3] * w, prev[1] + 0.04, prev[2] - prev[4] * w, prev[0] + prev[3] * w, prev[1] + 0.04, prev[2] + prev[4] * w,
        x - rx * w, y + 0.04, z - rz * w, x + rx * w, y + 0.04, z + rz * w], a);
      this.k = (this.k + 1) % this.n;
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.last.set(key, [x, y, z, rx, rz]);
    } else if (!prev) this.last.set(key, [x, y, z, rx, rz]);
  }
}
