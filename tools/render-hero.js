/* render-hero.js — draws docs/hero.svg (a solved board with the Golden Star, plus the dice)
 * straight from the game's own geometry, pieces and solver. Run: node tools/render-hero.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;
for (const f of ['geometry', 'pieces', 'dice', 'solver']) require(path.join(__dirname, '..', 'js', f + '.js'));
const GS = global.GS;
const G = GS.geom, S = GS.solver;

const roll = [4, 10, 15, 18, 28, 33, 37];
const blocked = roll.map(n => n - 1);
const sol = S.solve({ blocked, star: true });
if (!sol) throw new Error('expected a Golden Star solution for the hero roll');

const pad = 34, diceH = 86;
const W = G.WIDTH + pad * 2, H = G.HEIGHT + pad * 2 + diceH;
const out = [];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pts = poly => poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
let uid = 0;

out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">`);
out.push(`<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="6" fill="#000"/>`);
out.push(`<rect x="2" y="2" width="${W - 20}" height="${H - 20}" rx="6" fill="#fff" stroke="#000" stroke-width="3"/>`);
out.push(`<g transform="translate(${pad - 8},${pad - 8})">`);
const all = G.cells.map(c => [c.r, c.c]);
const star = G.outlinePath(all);
out.push(`<path d="${star}" fill="#000" stroke="#000" stroke-width="14" stroke-linejoin="round"/>`);
for (const cell of G.cells) {
  out.push(`<polygon points="${pts(G.cellPolygon(cell.r, cell.c))}" fill="#141414" stroke="#3d3d3d" stroke-width="1.2"/>`);
}
for (const cell of G.cells) {
  if (blocked.includes(cell.i)) continue;
  const [cx, cy] = G.cellCentroid(cell.r, cell.c);
  out.push(`<text x="${cx.toFixed(1)}" y="${(cy + 1).toFixed(1)}" fill="#9d9d9d" font-size="12" font-weight="700" text-anchor="middle" dominant-baseline="middle">${cell.n}</text>`);
}
for (const i of blocked) {
  const cell = G.cells[i];
  out.push(`<polygon points="${pts(G.shrinkPolygon(G.cellPolygon(cell.r, cell.c), 0.86))}" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/>`);
  const [cx, cy] = G.cellCentroid(cell.r, cell.c);
  out.push(`<polygon points="${pts(G.starPoints(cx, cy, 11, 4.6, 5, -Math.PI / 2))}" fill="#000"/>`);
}
// pieces (the hexagon is drawn as the two sky halves)
const colour = {};
for (const p of GS.PIECES) colour[p.shape] = p.color;
function drawPiece(cellsIdx, fill, isStar) {
  const rc = cellsIdx.map(i => [G.cells[i].r, G.cells[i].c]);
  const d = G.outlinePath(rc);
  const id = 'c' + (++uid);
  out.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
  out.push(`<path d="${d}" transform="translate(3,3)" fill="#000" stroke="#000" stroke-width="3" stroke-linejoin="round"/>`);
  out.push(`<path d="${d}" fill="${fill}" stroke="#000" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`);
  if (isStar) {
    const v = G.commonVertex(rc);
    const R = G.SIDE * 0.84;
    out.push(`<g clip-path="url(#${id})"><polygon points="${pts(G.starPoints(v.x, v.y, R, R / Math.sqrt(3), 6, 0))}" fill="#ffd23f" stroke="#000" stroke-width="2" stroke-linejoin="round"/></g>`);
  }
}
for (const p of sol.placements) {
  if (p.shape === 'hex') {
    const rc = p.cells.map(i => [G.cells[i].r, G.cells[i].c]);
    const v = G.commonVertex(rc);
    const ang = i => { const [x, y] = G.cellCentroid(G.cells[i].r, G.cells[i].c); return Math.atan2(y - v.y, x - v.x); };
    const sorted = p.cells.slice().sort((a, b) => ang(a) - ang(b));
    drawPiece(sorted.slice(0, 3), colour.sky, true);
    drawPiece(sorted.slice(3), colour.sky, true);
  } else drawPiece(p.cells, colour[p.shape], false);
}
out.push(`<text x="${G.WIDTH - 6}" y="${G.HEIGHT - 8}" fill="#4a4a4a" font-size="11" font-weight="800" letter-spacing="4" text-anchor="end">GENIUS STAR</text>`);
out.push('</g>');
// dice row
const dice = GS.dice.DICE;
const dieW = 44, gap = 12;
const rowW = dice.length * dieW + (dice.length - 1) * gap;
let x = (W - 20) / 2 + 2 - rowW / 2;
const y = G.HEIGHT + pad + 16;
const oct = (x0, y0, s) => [[.3, 0], [.7, 0], [1, .3], [1, .7], [.7, 1], [.3, 1], [0, .7], [0, .3]].map(([a, b]) => [x0 + a * s, y0 + b * s]);
dice.forEach((die, i) => {
  const n = roll[i];
  if (die.sides === 8) {
    out.push(`<polygon points="${pts(oct(x + 3, y + 3, dieW))}" fill="#000"/>`);
    out.push(`<polygon points="${pts(oct(x, y, dieW))}" fill="#000"/>`);
    out.push(`<polygon points="${pts(oct(x + 2, y + 2, dieW - 4))}" fill="#fff"/>`);
  } else {
    out.push(`<rect x="${x + 3}" y="${y + 3}" width="${dieW}" height="${dieW}" rx="5" fill="#000"/>`);
    out.push(`<rect x="${x}" y="${y}" width="${dieW}" height="${dieW}" rx="5" fill="#fff" stroke="#000" stroke-width="2"/>`);
  }
  out.push(`<text x="${x + dieW / 2}" y="${y + dieW / 2 + 1}" font-size="18" font-weight="900" text-anchor="middle" dominant-baseline="middle" fill="#000">${n}</text>`);
  out.push(`<text x="${x + dieW - 5}" y="${y + dieW - 4}" font-size="8" font-weight="800" text-anchor="end" fill="#666">d${die.sides}</text>`);
  x += dieW + gap;
});
out.push('</svg>');

const file = path.join(__dirname, '..', 'docs', 'hero.svg');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out.join('\n'));
console.log('wrote', file, (fs.statSync(file).size / 1024).toFixed(1) + ' KB', esc(''));
