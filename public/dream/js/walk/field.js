// WalkField: everything a planet knows about where the avatar can stand, and nothing else.
//
// A planet builder declares, in each site's local plane:
//   footprint(site, shape, { h })   a building or prop: blocks walking and keeps vegetation off it;
//                            h (its height) lets the camera know it can hide the avatar
//   barrier(site, shape)     a railing or wall: blocks walking only
//   deck(site, a, b, …)      a boardwalk or bridge: something to stand on over water
// plus the terrain height function and the water level.
//
// It answers:
//   surfaceH(d)       ground height under unit direction d (terrain or deck, whichever is higher)
//   clearance(d)      signed room around the avatar's body at d: >= 0 free, < 0 blocked
//   gradient(d)       { n, mag }: unit tangent toward more room and the slope of clearance (null where flat)
//   normal(d)         just gradient(d).n
//   inFootprint(d, m) the old square-cornered footprint test, for scatter
//   occluderHeight(d) height of the tallest footprint with a height that covers d (0 if none)
//
// It has no idea about input, the camera, the planet's rotation or three.js. One field per planet;
// switching planets throws the old one away, so there is no global state to reset by hand.

import { dot, anyTangent, cross, geodesic, scale, addScaled, normalize } from './vec.js';

const SITE_REACH = 0.72;     // cos of how far from a site's centre its local plane is still used

/**
 * @param {object} o
 * @param {number} o.radius        planet radius in units
 * @param {number} [o.water]       water surface height; ground lower than water + waterMargin is not walkable
 * @param {number} [o.waterMargin]
 * @param {number} [o.bodyRadius]  the avatar's footprint radius in units
 */
export function createWalkField({ radius, water = -Infinity, waterMargin = 0.05, bodyRadius = 0.1 }) {
  const groups = new Map();   // site → { site, foot: [], wall: [] }
  const decks = [];
  let terrain = () => 0;

  const group = site => {
    let g = groups.get(site);
    if (!g) groups.set(site, (g = { site, foot: [], wall: [], tall: [] }));
    return g;
  };

  /** Site-local plane coordinates of unit direction d (gnomonic), or null when d is far from the site. */
  function local(site, d) {
    const c = dot(d, site.dir);
    if (c < SITE_REACH) return null;
    const k = radius / c;
    return { x: dot(d, site.ex) * k, z: dot(d, site.ez) * k };
  }
  /** Unit direction of a site-local point. */
  const point = (site, x, z) => normalize(addScaled(addScaled(scale(site.dir, radius), site.ex, x), site.ez, z));

  // ---- decks ----
  function deckHeight(dk, t) { return dk.h0 + (dk.h1 - dk.h0) * t + dk.rise * Math.sin(Math.PI * t); }
  function deckAt(dk, p) {
    const [ax, az] = dk.a, [bx, bz] = dk.b, abx = bx - ax, abz = bz - az;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * abx + (p.z - az) * abz) / (abx * abx + abz * abz)));
    const off = Math.hypot(p.x - ax - abx * t, p.z - az - abz * t);
    return off < dk.hw ? deckHeight(dk, t) : -Infinity;
  }
  function decksH(d) {
    let best = -Infinity;
    for (const dk of decks) {
      const p = local(dk.site, d);
      if (p) best = Math.max(best, deckAt(dk, p));
    }
    return best;
  }

  const surfaceH = d => Math.max(terrain(d), decksH(d));

  function clearance(d) {
    let c = surfaceH(d) - water - waterMargin;
    for (const g of groups.values()) {
      if (!g.foot.length && !g.wall.length) continue;
      const p = local(g.site, d);
      if (!p) continue;
      for (const s of g.foot) c = Math.min(c, s.sdf(p.x, p.z) - bodyRadius);
      for (const s of g.wall) c = Math.min(c, s.sdf(p.x, p.z) - bodyRadius);
    }
    return c;
  }

  // Gradient of clearance by central differences. Walls are exact distance fields (slope 1), water is a
  // height difference (slope = the bank's), and a deck's edge is a step, so where the nearest change is
  // further than the first probe the probe widens until it finds one.
  const PROBES = [0.03, 0.12, 0.4];   // units
  function gradient(d) {
    const t1 = anyTangent(d), t2 = cross(d, t1);
    for (const h of PROBES) {
      const a = h / radius;
      const at = (t, s) => clearance(geodesic(d, scale(t, s * a)).p);
      const g1 = (at(t1, 1) - at(t1, -1)) / (2 * h), g2 = (at(t2, 1) - at(t2, -1)) / (2 * h);
      const mag = Math.hypot(g1, g2);
      if (mag > 1e-6) return { n: scale(addScaled(scale(t1, g1), t2, g2), 1 / mag), mag };
    }
    return null;
  }
  const normal = d => gradient(d)?.n ?? null;

  function occluderHeight(d) {
    let h = 0;
    for (const g of groups.values()) {
      if (!g.tall.length) continue;
      const p = local(g.site, d);
      if (p) for (const [s, sh] of g.tall) if (sh > h && s.sdf(p.x, p.z) < 0) h = sh;
    }
    return h;
  }

  function inFootprint(d, m = 0) {
    for (const g of groups.values()) {
      if (!g.foot.length) continue;
      const p = local(g.site, d);
      if (p && g.foot.some(s => s.within(p.x, p.z, m))) return true;
    }
    return false;
  }

  return {
    radius,
    bodyRadius,
    setTerrain(fn) { terrain = fn; return this; },
    footprint(site, shape, { h = 0 } = {}) { const g = group(site); g.foot.push(shape); if (h > 0) g.tall.push([shape, h]); return this; },
    barrier(site, shape) { group(site).wall.push(shape); return this; },
    /**
     * A walkable deck from a to b (site-local [x, z]), half-width hw, arching up by `rise` in the middle.
     * End heights follow the terrain (never below water + 0.3) unless flatH is given.
     */
    deck(site, a, b, hw, rise, flatH = null) {
      const endH = q => flatH ?? Math.max(terrain(point(site, q[0], q[1])), water + 0.3);
      const dk = { site, s: site, a, b, hw, rise, h0: endH(a), h1: endH(b) };
      dk.heightAt = t => deckHeight(dk, t);
      decks.push(dk);
      return dk;
    },
    local,
    surfaceH,
    clearance,
    gradient,
    normal,
    inFootprint,
    occluderHeight,
  };
}
