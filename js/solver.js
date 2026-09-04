/* solver.js — exact-cover solver for The Genius Star.
 *
 * Every legal placement of every shape is pre-computed once. A puzzle is then solved
 * by backtracking: always fill the empty cell that has the fewest candidate placements
 * (this prunes dead ends quickly). Board occupancy is kept in two 32-bit masks.
 *
 * solve({ blocked, star, fixed, maxNodes })
 *   blocked : array of cell indices (0..47) covered by blockers
 *   star    : true  -> the two sky pieces must form the Golden Star hexagon
 *             false -> the two sky pieces are placed independently
 *   fixed   : optional [{ shape, cells }] already on the board
 * returns { star, placements: [{ shape, cells, orient, r, c }] } or null.
 */
(function (root) {
  'use strict';
  const GS = root.GS = root.GS || {};
  const G = GS.geom;

  const ALL_LO = -1 | 0;      // cells 0..31
  const ALL_HI = 0xFFFF;      // cells 32..47

  let shapes = null;   // id -> { placements }
  let byCell = null;   // cell index -> placements covering it

  function build() {
    shapes = {};
    byCell = Array.from({ length: 48 }, () => []);
    for (const id in GS.SHAPES) {
      const placements = [];
      GS.SHAPES[id].orients.forEach((o, orient) => {
        for (let dr = 0; dr < 8; dr++) {
          for (let dc = -1; dc <= 11; dc++) {
            if ((dr + dc) & 1) continue;
            const idx = [];
            let ok = true;
            for (const [r, c] of o.cells) {
              const i = G.cellIndex(r + dr, c + dc);
              if (i < 0) { ok = false; break; }
              idx.push(i);
            }
            if (!ok) continue;
            let lo = 0, hi = 0;
            for (const i of idx) { if (i < 32) lo |= (1 << i); else hi |= (1 << (i - 32)); }
            const p = { shape: id, orient, r: dr, c: dc, cells: idx, lo, hi };
            placements.push(p);
            for (const i of idx) byCell[i].push(p);
          }
        }
      });
      shapes[id] = { placements };
    }
  }

  function ensureBuilt() { if (!shapes) build(); }

  function baseCounts(star) {
    const counts = { blue: 1, yellow: 1, pink: 1, red: 1, lime: 1, orange: 1, green: 1, purple: 1, brown: 1, sky: 0, hex: 0 };
    if (star) counts.hex = 1; else counts.sky = 2;
    return counts;
  }

  function solve(opts) {
    ensureBuilt();
    const star = !!opts.star;
    const counts = baseCounts(star);
    let lo = 0, hi = 0;
    const setBits = idx => {
      for (const i of idx) {
        if (i < 32) { if (lo & (1 << i)) return false; lo |= (1 << i); }
        else { if (hi & (1 << (i - 32))) return false; hi |= (1 << (i - 32)); }
      }
      return true;
    };
    if (!setBits(opts.blocked || [])) return null;
    for (const f of opts.fixed || []) {
      if (counts[f.shape] === undefined || counts[f.shape] <= 0) return null;
      counts[f.shape]--;
      if (!setBits(f.cells)) return null;
    }
    const chosen = [];
    let nodes = 0;
    const maxNodes = opts.maxNodes || Infinity;
    let aborted = false;

    function rec() {
      if (lo === ALL_LO && hi === ALL_HI) return true;
      if (++nodes > maxNodes) { aborted = true; return false; }
      let best = -1, bestCount = Infinity;
      for (let i = 0; i < 48; i++) {
        const occupied = i < 32 ? (lo >>> i) & 1 : (hi >>> (i - 32)) & 1;
        if (occupied) continue;
        let cnt = 0;
        const list = byCell[i];
        for (let k = 0; k < list.length; k++) {
          const p = list[k];
          if (counts[p.shape] > 0 && (p.lo & lo) === 0 && (p.hi & hi) === 0) {
            if (++cnt >= bestCount) break;
          }
        }
        if (cnt === 0) return false;
        if (cnt < bestCount) { bestCount = cnt; best = i; if (cnt === 1) break; }
      }
      const list = byCell[best];
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        if (counts[p.shape] > 0 && (p.lo & lo) === 0 && (p.hi & hi) === 0) {
          counts[p.shape]--; lo |= p.lo; hi |= p.hi; chosen.push(p);
          if (rec()) return true;
          chosen.pop(); lo &= ~p.lo; hi &= ~p.hi; counts[p.shape]++;
          if (aborted) return false;
        }
      }
      return false;
    }

    if (!rec()) return null;
    return {
      star,
      nodes,
      placements: chosen.map(p => ({ shape: p.shape, cells: p.cells.slice(), orient: p.orient, r: p.r, c: p.c })),
    };
  }

  // Try the Golden Star first, then a plain solution.
  function solveAny(opts) {
    const s = solve(Object.assign({}, opts, { star: true }));
    if (s) return s;
    return solve(Object.assign({}, opts, { star: false }));
  }

  // Find the pre-computed placement of a shape covering exactly these cells.
  function findPlacement(shape, cellIdx) {
    ensureBuilt();
    const want = cellIdx.slice().sort((a, b) => a - b).join(',');
    return shapes[shape].placements.find(p => p.cells.slice().sort((a, b) => a - b).join(',') === want) || null;
  }

  function placementsOf(shape) { ensureBuilt(); return shapes[shape].placements; }

  GS.solver = { solve, solveAny, findPlacement, placementsOf, build };
})(typeof window !== 'undefined' ? window : globalThis);
