/* pieces.js — the eleven coloured pieces of The Genius Star.
 *
 * Shapes are given as (row, column) cells in the coordinate system of geometry.js:
 * a cell is an up-pointing triangle when (row + column) is even.
 * Sizes: 1 + 2 + 4 + 5 + 5 + 4 + 5 + 4 + 5 + 3 + 3 = 41 = 48 cells - 7 blockers.
 * The two light-blue pieces are identical; joined along their long edges they form a
 * hexagon that shows the "Golden Star".
 */
(function (root) {
  'use strict';
  const GS = root.GS = root.GS || {};

  const SHAPES = {
    blue:   { cells: [[0, 0]] },
    yellow: { cells: [[0, 0], [1, 0]] },
    pink:   { cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    red:    { cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
    lime:   { cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 0]] },
    orange: { cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
    green:  { cells: [[0, 0], [1, 0], [1, 1], [1, 2], [0, 2]] },
    purple: { cells: [[0, 0], [1, 0], [1, 1], [1, -1]] },
    brown:  { cells: [[0, 0], [1, 0], [1, 1], [1, -1], [2, 1]] },
    sky:    { cells: [[0, 0], [0, 1], [1, 0]] },
    // The Golden Star hexagon used by the solver (two sky pieces joined).
    hex:    { cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]] },
  };

  const PIECES = [
    { id: 'blue',   shape: 'blue',   name: 'Blue triangle',      color: '#3b63d6', edge: '#22408f' },
    { id: 'yellow', shape: 'yellow', name: 'Yellow diamond',     color: '#f9c62a', edge: '#b08a0e' },
    { id: 'pink',   shape: 'pink',   name: 'Pink parallelogram', color: '#f29ab9', edge: '#b25f80' },
    { id: 'red',    shape: 'red',    name: 'Red bar',            color: '#e3403c', edge: '#9a2521' },
    { id: 'lime',   shape: 'lime',   name: 'Lime hook',          color: '#93d13a', edge: '#5f8f1f' },
    { id: 'orange', shape: 'orange', name: 'Orange chevron',     color: '#f58b2b', edge: '#b25a12' },
    { id: 'green',  shape: 'green',  name: 'Green cup',          color: '#22855a', edge: '#145238' },
    { id: 'purple', shape: 'purple', name: 'Purple triangle',    color: '#8146b5', edge: '#552b7c' },
    { id: 'brown',  shape: 'brown',  name: 'Brown kite',         color: '#8f5a3a', edge: '#5c3822' },
    { id: 'sky1',   shape: 'sky',    name: 'Golden Star half',   color: '#7cc8ef', edge: '#3c88b5', star: true },
    { id: 'sky2',   shape: 'sky',    name: 'Golden Star half',   color: '#7cc8ef', edge: '#3c88b5', star: true },
  ];

  // Pre-compute orientations for every shape (needs geometry.js).
  for (const id in SHAPES) SHAPES[id].orients = GS.geom.orientations(SHAPES[id].cells);

  const PIECE_BY_ID = {};
  for (const p of PIECES) PIECE_BY_ID[p.id] = p;

  GS.SHAPES = SHAPES;
  GS.PIECES = PIECES;
  GS.PIECE_BY_ID = PIECE_BY_ID;
})(typeof window !== 'undefined' ? window : globalThis);
