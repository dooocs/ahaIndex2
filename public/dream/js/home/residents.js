import * as THREE from '../../vendor/three-r170/three.module.min.js';
import { HOME_LOOP, POOL_WALK, createPatrol } from './patrol.js';

// Local characters, deliberately separate from real visitors and their chat.
export const RESIDENTS = [
  { name: '陈叔', role: '管家', at: [-2.9, 0.1], facing: [0.4, 1], look: { g: 'm', h: 1, hc: 0, t: 7, b: 1, s: 3 }, text: '欢迎回到云栖府。穿过水院就是云庭，左侧书廊适合坐坐，右边茶亭正好能听风。' },
  { name: '林女士', role: '邻居', path: POOL_WALK, speed: 0.48, rest: 6, offset: 8, look: { g: 'f', h: 1, hc: 1, t: 5, b: 4, s: 2 }, text: '我喜欢绕水院慢慢走一圈。每天留一点发呆的时间，也算在认真生活吧。' },
  { name: '周先生', role: '散步住户', path: HOME_LOOP, speed: 0.7, rest: 5, offset: 38, look: { g: 'm', h: 2, hc: 0, t: 1, b: 4, s: 2 }, text: '刚刚把工作收了尾，出来走走。沿着林荫步道能绕小区一圈，一起散散步？' },
  { name: '小乔', role: '慢跑者', path: [...HOME_LOOP].reverse(), speed: 1.15, rest: 0, offset: 14, look: { g: 'f', h: 3, hc: 0, t: 2, b: 3, s: 2 }, text: '今天也出来动一动！我就在这条环线上慢跑，跑完去茶亭歇一会儿。' },
  { name: '阿远', role: '园艺师', at: [19.5, -7], facing: [-1, 0], look: { g: 'm', h: 3, hc: 1, t: 6, b: 4, s: 3 }, text: '正在照料这片花境。树荫、草坪和花的高度错开，走起来才会一层一层有风景。' },
  { name: '苏苏', role: '书友', at: [-13.5, -14.8], facing: [0.2, 1], look: { g: 'f', h: 2, hc: 1, t: 4, b: 1, s: 2 }, text: '这里很安静，翻几页书，听一会儿树叶的声音。你也可以把脚步放慢一点。' },
];

export function createResidents({ planet, site, ground, tangent, makeAvatar, poseAvatar, radius, surfaceHeight, playerDirection }) {
  const layer = document.getElementById('home-npc-tags'), note = document.getElementById('home-note');
  const close = document.getElementById('home-note-close');
  const projected = new THREE.Vector3(), world = new THREE.Vector3();
  const matrix = new THREE.Matrix4(), forward = new THREE.Vector3(), right = new THREE.Vector3(), pos = new THREE.Vector3();
  const people = RESIDENTS.map(def => {
    const a = makeAvatar(def.look), anchor = new THREE.Group(); anchor.add(a.root); planet.add(anchor);
    const props = [];
    if (def.role === '书友') {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.22), new THREE.MeshBasicMaterial({ color: 0x667f63 }));
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.035, 0.2), new THREE.MeshBasicMaterial({ color: 0xf5efdf }));
      cover.position.set(0, 0.12, 0.25); pages.position.set(0, 0.148, 0.25);
      a.body.add(cover, pages); props.push(cover, pages);
    }
    const tag = document.createElement('button'); tag.type = 'button'; tag.className = 'home-npc-tag'; tag.hidden = true;
    tag.setAttribute('aria-label', `与${def.role}${def.name}打招呼（NPC）`);
    const badge = document.createElement('small'); badge.textContent = 'NPC'; tag.append(badge, `${def.role} · ${def.name}`); layer.append(tag);
    const r = { def, a, anchor, tag, props, patrol: def.path ? createPatrol(def.path, def) : null, time: 0, phase: 0, k: 0, direction: new THREE.Vector3() };
    tag.addEventListener('pointerdown', e => e.stopPropagation());
    tag.addEventListener('click', e => {
      e.stopPropagation(); active = r;
      document.getElementById('home-note-name').textContent = `${def.role} · ${def.name}`;
      document.getElementById('home-note-text').textContent = def.text;
      note.hidden = false; close.focus({ preventScroll: true });
    });
    return r;
  });
  let previous = null, active = null;
  const dismiss = () => { const tag = active?.tag; active = null; note.hidden = true; if (tag && !tag.hidden) tag.focus({ preventScroll: true }); };
  const escape = e => { if (e.key === 'Escape' && active) { e.stopPropagation(); dismiss(); } };
  close.addEventListener('click', dismiss); note.addEventListener('keydown', escape);
  return {
    update(t) {
      const dt = previous === null ? 0 : Math.max(0, Math.min(0.05, t - previous)); previous = t;
      const player = playerDirection();
      for (const r of people) {
        // Stop to greet the visitor, or to let them pass. No teleport on resume.
        const nearby = r.direction.lengthSq() > 0 && r.direction.angleTo(player) * radius < 0.85;
        if (active !== r && !nearby) r.time += dt;
        const p = r.patrol ? r.patrol.at(r.time) : { x: r.def.at[0], z: r.def.at[1], dx: r.def.facing[0], dz: r.def.facing[1], moving: false };
        const d = ground(site, p.x, p.z); r.direction.copy(d);
        r.anchor.visible = d.angleTo(player) * radius < 34;
        const moving = p.moving && active !== r && !nearby;
        r.k += ((moving ? Math.min(1, r.def.speed / 1.15) : 0) - r.k) * Math.min(1, dt * 8);
        r.phase += dt * (moving ? 4 + r.def.speed * 5 : 0);
        poseAvatar(r.a, r.k, r.phase, t, false);
        if (r.def.role === '园艺师') r.a.armR.rotation.x = -0.5 + Math.sin(t * 1.7) * 0.15;
        if (r.def.role === '书友') { r.a.armL.rotation.x = -0.7; r.a.armR.rotation.x = -0.7; }
        if (r.def.role === '管家' && active === r) r.a.armR.rotation.x = -1.1 + Math.sin(t * 3) * 0.12;
        forward.copy(tangent(site, p.dx, p.dz)).addScaledVector(d, -forward.dot(d)).normalize();
        // Ease heading around polyline corners, preserving the surface normal.
        if (!r.heading) r.heading = forward.clone();
        else r.heading.lerp(forward, Math.min(1, dt * 5)).addScaledVector(d, -r.heading.dot(d)).normalize();
        right.crossVectors(d, r.heading); pos.copy(d).multiplyScalar(radius + surfaceHeight(d));
        matrix.makeBasis(right, d, r.heading).setPosition(pos); matrix.decompose(r.anchor.position, r.anchor.quaternion, r.anchor.scale);
        if (active === r && d.angleTo(player) * radius > 12) { active = null; note.hidden = true; }
      }
    },
    placeTags(camera, insetTop) {
      const player = playerDirection();
      for (const r of people) {
        world.copy(r.direction).multiplyScalar(radius + 1.35).applyMatrix4(planet.matrixWorld);
        projected.copy(world).project(camera);
        const y = (0.5 - projected.y * 0.5) * innerHeight;
        const show = r.anchor.visible && r.direction.angleTo(player) * radius < 9 && world.y > 0 && projected.z > -1 && projected.z < 1
          && Math.abs(projected.x) < 0.88 && y > insetTop + 60 && y < innerHeight - 60;
        r.tag.hidden = !show;
        if (show) r.tag.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px, ${y}px) translate(-50%, -100%)`;
      }
    },
    dispose() {
      for (const r of people) {
        r.anchor.removeFromParent(); r.tag.remove();
        r.props.forEach(p => { p.geometry.dispose(); p.material.dispose(); });
      }
      // Avatar geometries/materials belong to the shared cache, including the player's.
      close.removeEventListener('click', dismiss); note.removeEventListener('keydown', escape);
      note.hidden = true; active = null;
    },
  };
}
