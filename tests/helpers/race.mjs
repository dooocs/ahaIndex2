import { readFileSync } from 'node:fs';

// Run the browser's physics modules in Node with the same vendored Three.js.
// Only the unused shader/model import is omitted; no handling code is copied.
const root = new URL('../../public/race/', import.meta.url);
const three = new URL('../dream/vendor/three-r170/three.module.min.js', root).href;
const modules = new Map();
export function raceModule(name) {
  if (modules.has(name)) return modules.get(name);
  let source = readFileSync(new URL(`js/${name}`, root), 'utf8');
  if (name === 'car.js') source = source.replace(/^import .* from '\.\/toon\.js';\r?\n/m, '');
  source = source.replace(/^(import .+ from )(['"])([^'"]+)\2;/gm, (_all, start, _quote, spec) => {
    const url = spec === 'three' ? three : spec === './car.js' ? raceModule('car.js') : new URL(`js/${spec}`, root).href;
    return `${start}${JSON.stringify(url)};`;
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  modules.set(name, url);
  return url;
}

export const { PlayerCar, IDLE, TUNE } = await import(raceModule('car.js'));
export const { Track } = await import(raceModule('track.js'));
export const { AICar, AI_DRIVERS, AI_TUNE } = await import(raceModule('ai.js'));
export const { makePilot } = await import(raceModule('pilot.js'));
export { racingLine } from '../../public/race/js/line.js';
export { CENTERLINE, ROAD_WIDTH, START_AT } from '../../public/race/js/layout.js';

export function driver(halfW = 500) {
  const track = {
    halfW, slope: [0], hd: [0], vcurv: [0], sslope: [0], pads: [],
    sample(d) { return { x: 0, z: d, rx: -1, rz: 0, hd: 0, i: 0 }; },
    surfaceY() { return 0; },
    project(x, z, _hint, out) {
      return Object.assign(out, { i: 0, d: z, lat: -x, rx: -1, rz: 0, hd: 0 });
    },
  };
  const p = new PlayerCar(track, {});
  p.reset(0, 0);
  return p;
}
