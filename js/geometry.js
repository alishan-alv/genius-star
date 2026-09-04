/* geometry.js — triangular-grid math and the 48-cell star board for The Genius Star.
 *
 * Coordinates
 * -----------
 * Every triangle on the board is addressed by (row r, column c). Rows run top to
 * bottom (0..7); columns are counted in half-triangle steps so that neighbouring
 * triangles in a row differ by one column. A cell is an UP-pointing triangle when
 * (r + c) is even and DOWN-pointing when it is odd.
 *
 * The star is made of two overlapping big triangles of side 6 (48 unit triangles).
 * Row widths are 1, 3, 11, 9, 9, 11, 3, 1 and cells are numbered 1..48 row by row,
 * left to right, exactly like the printed board.
 *
 * For rotations and reflections we convert to tri-coordinates (t0, t1, t2) whose
 * sum is 0 for up triangles and 1 for down triangles; a 60° rotation and a mirror are
 * then simple integer maps.
 */
(function (root) {
  'use strict';
  const GS = root.GS = root.GS || {};

  const SIDE = 60;                        // triangle side in board units
  const H = SIDE * Math.sqrt(3) / 2;      // triangle height
  const PAD = 26;
  const ROW_RANGE = [[6, 6], [5, 7], [1, 11], [2, 10], [2, 10], [1, 11], [5, 7], [6, 6]];

  function isUp(r, c) { return ((r + c) & 1) === 0; }
  function rcKey(r, c) { return r + ',' + c; }

  const cells = [];
  const byRC = new Map();
  ROW_RANGE.forEach(([c0, c1], r) => {
    for (let c = c0; c <= c1; c++) {
      const i = cells.length;
      cells.push({ i, n: i + 1, r, c, up: isUp(r, c) });
      byRC.set(rcKey(r, c), i);
    }
  });

  function cellIndex(r, c) {
    const i = byRC.get(rcKey(r, c));
    return i === undefined ? -1 : i;
  }

  const WIDTH = 6 * SIDE + 2 * PAD;
  const HEIGHT = 8 * H + 2 * PAD;
  const OX = PAD, OY = PAD;

  // Lattice vertices sit at integer rows and half-triangle columns.
  function vx(cv) { return OX + cv * SIDE / 2; }
  function vy(rv) { return OY + rv * H; }

  // Vertex keys [rv, cv] of a cell, clockwise on screen.
  function cellVertexKeys(r, c) {
    return isUp(r, c)
      ? [[r, c], [r + 1, c + 1], [r + 1, c - 1]]
      : [[r, c - 1], [r, c + 1], [r + 1, c]];
  }
  function cellPolygon(r, c) {
    return cellVertexKeys(r, c).map(([rv, cv]) => [vx(cv), vy(rv)]);
  }
  function cellCentroid(r, c) {
    const x = vx(c);
    return isUp(r, c) ? [x, vy(r) + 2 * H / 3] : [x, vy(r) + H / 3];
  }
  function pointsAttr(poly) {
    return poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
  }
  // Shrink a polygon towards its centroid (0 < f <= 1).
  function shrinkPolygon(poly, f) {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return poly.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
  }

  // ---- tri-coordinate transforms -------------------------------------------
  function rcToT(r, c) {
    const S = isUp(r, c) ? 0 : 1;
    return [r, (S - r - c) / 2, (S - r + c) / 2];
  }
  function tToRc(t) { return [t[0], t[2] - t[1]]; }
  const rot60 = t => [-t[1], -t[2], 1 - t[0]];      // 60° clockwise on screen
  const mirror = t => [1 - t[0], -t[2], -t[1]];     // vertical flip
  function applyT(cellsRC, fn) {
    return cellsRC.map(([r, c]) => tToRc(fn(rcToT(r, c))));
  }

  // Translate so that min row = 0 and min column is 0 or 1 (parity preserved).
  function normalize(cellsRC) {
    let minR = Infinity, minC = Infinity;
    for (const [r, c] of cellsRC) { if (r < minR) minR = r; if (c < minC) minC = c; }
    let dc = -minC;
    if (((-minR) + dc) & 1) dc += 1;
    const out = cellsRC.map(([r, c]) => [r - minR, c + dc]);
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return out;
  }
  function shapeKey(cellsRC) { return cellsRC.map(p => p.join(',')).join(';'); }

  // All distinct orientations of a shape, with cw / ccw / flip transitions.
  function orientations(baseCells) {
    const list = [], index = new Map();
    const add = cs => {
      const n = normalize(cs);
      const k = shapeKey(n);
      if (!index.has(k)) { index.set(k, list.length); list.push({ cells: n, key: k }); }
      return index.get(k);
    };
    add(baseCells);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      o.cw = add(applyT(o.cells, rot60));
      o.flip = add(applyT(o.cells, mirror));
    }
    list.forEach((o, i) => { let j = i; for (let k = 0; k < 5; k++) j = list[j].cw; o.ccw = j; });
    return list;
  }

  // Centroid (board units) of a set of cells.
  function cellsCentroid(cellsRC) {
    let x = 0, y = 0;
    for (const [r, c] of cellsRC) { const p = cellCentroid(r, c); x += p[0]; y += p[1]; }
    return [x / cellsRC.length, y / cellsRC.length];
  }
  function cellsBBox(cellsRC) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [r, c] of cellsRC) {
      for (const [x, y] of cellPolygon(r, c)) {
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // Vertex shared by every cell in the set (or null).
  function commonVertex(cellsRC) {
    let common = null;
    for (const [r, c] of cellsRC) {
      const keys = new Set(cellVertexKeys(r, c).map(k => k.join(',')));
      common = common === null ? keys : new Set([...common].filter(k => keys.has(k)));
      if (common.size === 0) return null;
    }
    const [rv, cv] = [...common][0].split(',').map(Number);
    return { rv, cv, x: vx(cv), y: vy(rv) };
  }

  // Outline loops (union boundary) of a set of cells, as arrays of [x, y].
  function outlineLoops(cellsRC) {
    const edges = new Map();     // "a>b" -> [a, b]
    for (const [r, c] of cellsRC) {
      const v = cellVertexKeys(r, c).map(p => p.join(','));
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3];
        const rev = b + '>' + a;
        if (edges.has(rev)) edges.delete(rev); else edges.set(a + '>' + b, [a, b]);
      }
    }
    const out = new Map();
    for (const [, [a, b]] of edges) { if (!out.has(a)) out.set(a, []); out.get(a).push(b); }
    const loops = [];
    let guard = 0;
    while (edges.size && guard++ < 1000) {
      const [a0] = edges.values().next().value;
      let cur = a0; const loop = [];
      let steps = 0;
      do {
        loop.push(cur);
        const nexts = out.get(cur);
        if (!nexts || !nexts.length) break;
        const nxt = nexts.pop();
        edges.delete(cur + '>' + nxt);
        cur = nxt;
      } while (cur !== a0 && steps++ < 500);
      loops.push(loop.map(k => { const [rv, cv] = k.split(',').map(Number); return [vx(cv), vy(rv)]; }));
    }
    return loops;
  }
  function outlinePath(cellsRC) {
    return outlineLoops(cellsRC)
      .map(loop => 'M' + loop.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z')
      .join('');
  }

  // Star polygon points (n points, outer radius R, inner radius r, first point at angle rot).
  function starPoints(cx, cy, R, r, n, rot) {
    const pts = [];
    for (let i = 0; i < 2 * n; i++) {
      const ang = rot + i * Math.PI / n;
      const rad = i % 2 === 0 ? R : r;
      pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
    }
    return pts;
  }

  // The 12 symmetries of the board as permutations of cell indices (about the centre vertex).
  function symmetries() {
    const fns = [];
    for (let k = 0; k < 6; k++) {
      fns.push(t => { for (let i = 0; i < k; i++) t = rot60(t); return t; });
      fns.push(t => { for (let i = 0; i < k; i++) t = rot60(t); return mirror(t); });
    }
    return fns.map(fn => cells.map(cell => {
      const [r, c] = tToRc(fn(rcToT(cell.r - 3, cell.c - 5)));
      return cellIndex(r + 3, c + 5);
    }));
  }

  GS.geom = {
    SIDE, H, PAD, WIDTH, HEIGHT, OX, OY, ROW_RANGE, cells,
    isUp, cellIndex, vx, vy, cellVertexKeys, cellPolygon, cellCentroid, pointsAttr, shrinkPolygon,
    rcToT, tToRc, rot60, mirror, applyT, normalize, shapeKey, orientations,
    cellsCentroid, cellsBBox, commonVertex, outlineLoops, outlinePath, starPoints, symmetries,
  };
})(typeof window !== 'undefined' ? window : globalThis);
