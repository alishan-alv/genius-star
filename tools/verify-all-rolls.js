/* verify-all-rolls.js — exhaustive check that every possible dice roll is solvable.
 *
 * Usage:  node tools/verify-all-rolls.js
 *
 * Enumerates all 165,888 rolls, reduces them by the 12 board symmetries, solves
 * each unique puzzle (Golden Star first, then plain) and prints the totals.
 */
const path = require('path');
global.window = global;
for (const f of ['geometry', 'pieces', 'dice', 'solver']) require(path.join(__dirname, '..', 'js', f + '.js'));

const GS = global.GS;
const S = GS.solver;
const DICE = GS.dice.DICE;
const syms = GS.geom.symmetries();

const t0 = Date.now();
S.build();

const seen = new Map();       // canonical key -> 'star' | 'plain' | 'none'
let total = 0, star = 0, plain = 0, none = 0, unique = 0;
const failures = [];

function canonical(cells) {
  let best = null;
  for (const perm of syms) {
    const mapped = cells.map(i => perm[i]).sort((a, b) => a - b).join(',');
    if (best === null || mapped < best) best = mapped;
  }
  return best;
}

function walk(dieIdx, chosen) {
  if (dieIdx === DICE.length) {
    total++;
    const cells = chosen.map(n => n - 1);
    const key = canonical(cells);
    let result = seen.get(key);
    if (result === undefined) {
      unique++;
      if (S.solve({ blocked: cells, star: true })) result = 'star';
      else if (S.solve({ blocked: cells, star: false })) result = 'plain';
      else { result = 'none'; failures.push(chosen.slice()); }
      seen.set(key, result);
      if (unique % 1000 === 0) process.stdout.write(`  ${unique} unique puzzles solved (${total} rolls, ${((Date.now() - t0) / 1000).toFixed(1)}s)\r`);
    }
    if (result === 'star') star++; else if (result === 'plain') plain++; else none++;
    return;
  }
  for (const v of DICE[dieIdx].values) { chosen.push(v); walk(dieIdx + 1, chosen); chosen.pop(); }
}

walk(0, []);
console.log('');
console.log(`Rolls enumerated      : ${total}`);
console.log(`Unique (by symmetry)  : ${unique}`);
console.log(`Solvable with star    : ${star} (${(100 * star / total).toFixed(1)}%)`);
console.log(`Solvable without star : ${plain}`);
console.log(`Unsolvable            : ${none}`);
if (failures.length) console.log('Unsolvable rolls:', failures.slice(0, 20));
console.log(`Time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(none === 0 ? 0 : 1);
