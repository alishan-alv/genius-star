# The Genius Star — web edition

A browser recreation of **The Genius Star**, the star-shaped tiling puzzle by The Happy Puzzle Company
(the follow-up to The Genius Square). Roll seven dice, place the seven star blockers on the numbered
triangles they show, then race to fill every remaining triangle with the eleven coloured pieces.

No build step and no dependencies: open `index.html` in any modern browser and play.

## How to play

1. **Roll** — press *Roll the dice*. Blockers appear on the seven numbered triangles.
2. **Fill** — drag pieces from the tray onto the star. A piece snaps into place when every triangle
   under it is free. Drag a piece off the board, or click it, to send it back to the tray.
3. **Rotate / flip** — `R` rotates clockwise, `Shift+R` anticlockwise, `F` flips. The scroll wheel
   rotates too, even while you are holding a piece. The ⟲ ⟳ ⇅ buttons do the same for the selected piece.
4. **Win** — the timer stops when all eleven pieces are down.

### The Golden Star

The two light-blue halves carry half a golden star each. Join them into a hexagon inside your solution
and you complete the **Golden Star** for a *double win*. It is a gamble: only about 58 % of the possible
rolls (97,422 of 165,888) can be solved with the Golden Star whole. *★ Golden Star?* tells you whether
the current roll allows it, if you would rather not guess.

### Other features

- **Hint** places one piece from a solution that agrees with what you have already placed.
- **Solution** shows a complete solution (the Golden Star one when it exists).
- **Enter a roll** — type in the numbers from a physical set of dice.
- **Daily star** — the same puzzle for everyone on a given day.
- **Custom blockers** — place the seven blockers yourself (not every layout is solvable; the game warns you).
- **Copy link** — every puzzle has a shareable URL such as `index.html#roll=4.10.15.18.28.33.37`,
  so two people can race on identical boards.
- Best times, solve counts and Golden Star counts are stored in your browser. An unfinished puzzle is
  restored when you come back.

Keyboard: `R` / `Shift+R` rotate, `F` flip, `H` hint, `N` new roll, `Esc` drop the held piece, `?` help.

## The real game, faithfully

- **Board** — 48 triangles in a six-pointed star, numbered 1–48 row by row from the top, exactly as printed.
- **Dice** — four six-sided and three eight-sided dice with the original face numbers
  (`1 5 15 34 44 48`, `2 4 7 8 9 11 16 17`, `10 27 31`, `12 13 23 24 32 33 41 42`, `18 22 39`,
  `19 20 21 28 29 30`, `25 26 36 37 38 40 45 47`), giving the advertised 165,888 puzzles.
- **Pieces** — the eleven original polyiamonds: blue 1-triangle, yellow diamond, pink parallelogram,
  red bar, lime hook, orange chevron, green cup, purple triangle, brown kite and the two light-blue
  Golden Star halves (41 triangles in total).
- `node tools/verify-all-rolls.js` solves every one of the 165,888 rolls (about four minutes): all are
  solvable and 97,422 admit the Golden Star, matching the published analysis of the physical game.

## Project layout

```
index.html                 page markup
css/style.css              styling (dark theme, responsive)
js/geometry.js             triangular grid, star board, rotations/reflections, outlines
js/pieces.js               the eleven pieces (shapes and colours)
js/dice.js                 the seven dice, daily seed
js/solver.js               exact-cover solver (hints, solutions, Golden Star check)
js/game.js                 UI: board rendering, drag & drop, timer, records, modals
tools/verify-all-rolls.js  exhaustive solvability check (Node)
tools/serve.js             optional local static server: node tools/serve.js
```

The Genius Star is a trademark of The Happy Puzzle Company; this is an unofficial fan project for personal use.
