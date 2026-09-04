/* dice.js — the seven dice of The Genius Star (four six-sided, three eight-sided).
 * The numbers are chosen so that every one of the 165,888 possible rolls can be solved.
 * Cells 3, 6, 14, 35, 43 and 46 never appear on any die.
 */
(function (root) {
  'use strict';
  const GS = root.GS = root.GS || {};

  const DICE = [
    { sides: 6, faces: [1, 5, 15, 34, 44, 48] },
    { sides: 8, faces: [2, 4, 7, 8, 9, 11, 16, 17] },
    { sides: 6, faces: [10, 10, 27, 27, 31, 31] },
    { sides: 8, faces: [12, 13, 23, 24, 32, 33, 41, 42] },
    { sides: 6, faces: [18, 18, 22, 22, 39, 39] },
    { sides: 6, faces: [19, 20, 21, 28, 29, 30] },
    { sides: 8, faces: [25, 26, 36, 37, 38, 40, 45, 47] },
  ];
  for (const d of DICE) d.values = [...new Set(d.faces)];

  const DIE_OF_NUMBER = {};
  DICE.forEach((d, i) => d.values.forEach(v => { DIE_OF_NUMBER[v] = i; }));

  function roll(rng) {
    const rand = rng || Math.random;
    return DICE.map(d => d.faces[Math.floor(rand() * d.faces.length)]);
  }

  // Returns the numbers ordered by die (or null if the set is not a possible roll).
  function normalizeRoll(numbers) {
    if (!Array.isArray(numbers) || numbers.length !== DICE.length) return null;
    const out = new Array(DICE.length).fill(null);
    for (const n of numbers) {
      const v = Number(n);
      const die = DIE_OF_NUMBER[v];
      if (die === undefined || out[die] !== null) return null;
      out[die] = v;
    }
    return out;
  }

  // Deterministic PRNG (mulberry32) for daily / shareable seeds.
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailyRoll(date) {
    const d = date || new Date();
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return roll(seededRandom(seed * 2654435761));
  }

  const TOTAL_ROLLS = DICE.reduce((p, d) => p * d.values.length, 1);

  GS.dice = { DICE, DIE_OF_NUMBER, roll, normalizeRoll, seededRandom, dailyRoll, TOTAL_ROLLS };
})(typeof window !== 'undefined' ? window : globalThis);
