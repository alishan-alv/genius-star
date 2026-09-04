# Security & code audit — The Genius Star web edition

Date: 2026-09-05 · Scope: everything in this repository (game, accounts, history, lobbies, deployment config).
Method: manual review of every source file, a dedicated security review pass over the branch diff with an
independent false-positive check, exhaustive solver verification, and behavioural tests in the browser
(desktop and 375 px phone viewport, two-tab lobby sessions).

## 1. Architecture and trust boundaries

| Component | Trust | Notes |
|---|---|---|
| Browser code (`js/*.js`) | Untrusted | Anyone can modify it; it never holds secrets. |
| `/api/config` (Vercel function) | Trusted | Exposes only the Supabase URL and the *anon/publishable* key, both public by design. |
| Supabase Auth | Trusted | Email/password accounts, hashed passwords, sessions and refresh tokens are handled by Supabase. |
| Postgres + Row Level Security (`supabase/schema.sql`) | **The security boundary** | Every row of `profiles` and `games` is readable/writable only by its owner (`auth.uid()`). |
| Realtime lobby channels | Untrusted peers | Presence/broadcast messages come from other players' browsers and are treated as display data. |
| Local mode (no backend) | Same-origin only | `localStorage` history and `BroadcastChannel` lobbies never leave the browser. |

## 2. Findings

### Security review (branch diff)

No finding reached the reporting threshold (>80 % confidence of real exploitability). What was checked:

- **XSS** — all user, peer, URL and database strings are rendered with `textContent`/DOM builders; `innerHTML` is only used
  with static markup or `esc()`-escaped values. The page runs under a strict Content-Security-Policy
  (`script-src 'self'`, no inline scripts or styles, `object-src 'none'`, `frame-ancestors 'none'`).
- **Authorization** — RLS policies: `profiles` select/update own; `games` select/insert/delete own with
  `user_id default auth.uid()` and an insert `WITH CHECK`; no update policy (a logged game is immutable).
  The sign-up trigger (`security definer`) only writes the new user's own profile row.
- **Injection / traversal** — no SQL is built from strings (PostgREST parameterises); `tools/serve.js` refuses paths
  outside the project root, dotfiles and `node_modules`; `/api/config` validates the URL shape and escapes `<`.
- **Secrets** — none in the repository; `config.local.json` is git-ignored; only public values reach the browser.
- **Data exposure** — the history query returns only the caller's rows; emails are shown only to their owner.

### Fixed during the audit

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | Low | The sign-up form turned Supabase's anti-enumeration response into an explicit "account already exists" message, revealing which emails are registered. | Neutral message in both cases (`js/backend.js`, `js/account.js`). |
| 2 | Low | A `finish` event for a past round or from a key not present in the lobby was still recorded. | Ignored unless it is for the current round and from a present member (`js/lobby.js`). |
| 3 | Info | Inline `style="…"` attributes would have violated the CSP. | Replaced with CSSOM writes; CSP verified clean in the browser console. |
| 4 | Info | Saved solo games were restored without validation. | Placements are re-validated against the pre-computed placement table before use. |

### Known limitations (accepted, documented)

- **Lobby results are peer-attested.** Rounds, finishes and the host role are coordinated by the players' browsers
  over a public Realtime channel named by the lobby code. Anyone who has the code can join, and a modified client
  could claim the host role, start rounds, or report a fake time. Nothing on the server trusts these messages: the
  only persistent write is each player's *own* `games` row, so cheating can only mislead the friends in that lobby.
  Making lobbies tamper-proof would need server-authoritative rounds (an RLS-protected `rounds`/`results` table or
  private Realtime channels with authorization policies) — recommended if the game ever gets public ladders.
- **Game records are self-attested.** A player can insert any result into their own history with the public API
  (this is true of every client-only game). There is no cross-user leaderboard, so the impact is limited to one's own
  statistics. Server-side solution verification (a Postgres function checking the tiling) is possible later.
- **Lobby codes are the only secret of a lobby** (5 characters from a 32-symbol alphabet ≈ 33 million codes;
  generated with `crypto.getRandomValues`). Share them only with the people you want to play with.
- **Guest data lives in the browser.** Clearing site data erases guest history; this is by design.

## 3. Deployment hardening checklist

- [x] Strict CSP in both `index.html` (meta) and `vercel.json` (header, plus `frame-ancestors 'none'`).
- [x] `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.
- [x] Third-party JS self-hosted and version-pinned (`vendor/supabase.js`, supabase-js 2.115.0) — no CDN dependency at runtime.
- [x] No build step, no npm dependencies → no supply-chain surface beyond the vendored library.
- [ ] In Supabase: keep **Confirm email** on, set the **Site URL**/redirect URLs to the Vercel domain, keep the default
      Auth rate limits, and consider enabling **leaked-password protection** and a minimum password length of 8+.
- [ ] Rotate the anon key from the Supabase dashboard if it is ever pasted somewhere it should not be (it is public,
      but rotating limits abuse of Realtime quotas).

## 4. Correctness verification

- `npm run verify`: all 165,888 dice rolls solvable, 24,192 unique under the board's 12 symmetries,
  97,422 (58.7 %) solvable with the Golden Star — identical to the published analysis of the physical game.
- Browser tests: drag/drop and snapping, rotation/flip (keys, wheel, tap), hints, solution reveal, Golden Star detection,
  custom blockers, daily puzzle, shareable links, resume after reload, records/history, lobby create/join via link,
  identical rolls in two tabs, live progress and finish events, late join adopting the running round, host hand-over
  when the host leaves, phone layout at 375 px (header, board, tray, modals).

## 5. Code-quality notes

- Modules communicate through small explicit interfaces (`GS.backend`, `GS.ui`, `GS.game.on(...)`), so the Supabase
  adapter can be swapped for another provider by re-implementing `js/backend.js` only.
- All network failures degrade gracefully: a failed online insert is kept locally; a failed lobby connection shows
  the error in the dialog; the app is fully playable offline.
- Every user-facing string built from data uses `el({ text })`; keep that pattern when adding features.
