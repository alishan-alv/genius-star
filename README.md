# The Genius Star — web edition

A browser recreation of **The Genius Star**, the star-shaped tiling puzzle by The Happy Puzzle Company.
Roll seven dice, place the seven star blockers on the numbered triangles they show, then race to fill every
remaining triangle with the eleven coloured pieces — alone against the clock or against up to four friends in a lobby.

- **Plain HTML/CSS/JS**, no build step: open `index.html` or run `npm start`.
- **Accounts** (email + password) keep your records and full game history on your profile; **guests** keep them in the browser.
- **Lobbies**: 1–5 players race on identical rolls with live progress and a scoreboard.
- Works on phones (drag with a finger, tap a selected piece to rotate).

## How to play

1. **Roll** — press *Roll the dice*. Blockers appear on the seven numbered triangles.
2. **Fill** — drag pieces from the tray onto the star. A piece snaps into place when every triangle
   under it is free. Drag a piece off the board, or tap it, to send it back to the tray.
3. **Rotate / flip** — `R` rotates clockwise, `Shift+R` anticlockwise, `F` flips; the scroll wheel rotates too,
   even while holding a piece. On touch screens tap a selected tray piece to rotate it, or use ⟲ ⟳ ⇅.
4. **Win** — the timer stops when all eleven pieces are down.

### The Golden Star

The two light-blue halves carry half a golden star each. Join them into a hexagon inside your solution to complete
the **Golden Star** for a *double win*. Only about 58 % of rolls (97,422 of 165,888) allow it. *★ Golden Star?*
tells you whether the current roll can, if you would rather not gamble.

### Playing together

*Play together → Create lobby* gives you a 5-letter code (and a link). Up to five players join with a nickname.
The host presses *Start round*: everyone gets the same roll at the same moment and solves on their own board while
the lobby shows who is still solving and who has finished. The fastest hint-free finisher wins the round — one point,
or two with the Golden Star. Hints and solutions are switched off inside lobbies. If the host leaves, the longest-present
player becomes host automatically. Lobby results are written to each player's history with their finishing position.

### Other features

- **Hint** places one piece from a solution that agrees with what you have already placed; **Solution** shows a full one.
- **Enter a roll** (numbers from real dice), **Daily star** (same puzzle for everyone each day), **Custom blockers**.
- **Copy link** — every solo puzzle has a URL such as `#roll=4.10.15.18.28.33.37`; lobbies use `#lobby=ABCDE`.
- An unfinished solo puzzle is restored when you come back.

Keyboard: `R` / `Shift+R` rotate, `F` flip, `H` hint, `N` new roll, `Esc` drop the held piece, `?` help.

## Deploying (Vercel + Supabase)

The site is static; accounts, history and online lobbies use a free [Supabase](https://supabase.com) project.
Without the two environment variables below the deployed site still works in **local mode** (guest play; lobbies
only between tabs of one browser).

1. **Supabase**
   1. Create a project, open *SQL Editor*, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
   2. *Authentication → Providers → Email*: keep "Confirm email" on (or turn it off for a quick demo).
      *Authentication → URL configuration*: set the Site URL to your Vercel URL.
   3. *Project Settings → API*: copy the **Project URL** and the **anon / publishable key**.
2. **Vercel**
   1. Import this GitHub repository (Framework preset: *Other*; no build command, output directory `.`).
   2. Add the environment variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Production + Preview), then deploy.
   3. The `/api/config` function hands those public values to the page; `vercel.json` adds the security headers.

Local development with the online backend: copy `config.local.example.json` to `config.local.json`, fill in the two
values (this file is git-ignored) and run `npm start`.

## The real game, faithfully

- **Board** — 48 triangles in a six-pointed star, numbered 1–48 row by row from the top, exactly as printed.
- **Dice** — four six-sided and three eight-sided dice with the original face numbers
  (`1 5 15 34 44 48`, `2 4 7 8 9 11 16 17`, `10 27 31`, `12 13 23 24 32 33 41 42`, `18 22 39`,
  `19 20 21 28 29 30`, `25 26 36 37 38 40 45 47`), giving the advertised 165,888 puzzles.
- **Pieces** — the eleven original polyiamonds: blue 1-triangle, yellow diamond, pink parallelogram,
  red bar, lime hook, orange chevron, green cup, purple triangle, brown kite and the two light-blue
  Golden Star halves (41 triangles in total).
- `npm run verify` solves every one of the 165,888 rolls (about four minutes): all are solvable and 97,422 admit
  the Golden Star, matching the published analysis of the physical game.

## Project layout

```
index.html                 page markup (strict Content-Security-Policy)
css/style.css              styling (dark theme, phone layout)
js/geometry.js             triangular grid, star board, rotations/reflections, outlines
js/pieces.js               the eleven pieces (shapes and colours)
js/dice.js                 the seven dice, daily seed
js/solver.js               exact-cover solver (hints, solutions, Golden Star check)
js/backend.js              Supabase adapter + local mode (history, auth, lobby transport)
js/game.js                 board rendering, drag & drop, timer, records, shared widgets
js/account.js              sign in / sign up, nickname, profile & history
js/lobby.js                multiplayer lobbies (presence, rounds, scoreboard)
api/config.js              Vercel function exposing the public Supabase config
supabase/schema.sql        tables, row-level security, sign-up trigger
vendor/supabase.js         supabase-js 2.115.0 (UMD, self-hosted)
tools/serve.js             local static server (npm start)
tools/verify-all-rolls.js  exhaustive solvability check (npm run verify)
vercel.json                security headers and caching
AUDIT.md                   security & code audit notes
```

The Genius Star is a trademark of The Happy Puzzle Company; this is an unofficial fan project.
