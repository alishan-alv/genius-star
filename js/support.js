/* support.js — a quiet "buy me a coffee" ask.
 *
 * Rules of the ask (deliberately conservative, so the game never nags):
 *   - never before the player has solved MIN_SOLVES puzzles cleanly;
 *   - never during a lobby round — people are racing;
 *   - never on top of the win modal: it waits until that modal is closed;
 *   - at most once a week, and after each ✕ the wait grows (10 days, then 45);
 *   - after the third ✕, or after the player opens the page, it stops asking.
 * Permanent links (header, Records tab, help dialog) are always available.
 */
(function (root) {
  'use strict';
  const GS = root.GS;
  const UI = GS.ui;
  const el = UI.el;

  const LINK = 'https://buymeacoffee.com/al1shan';
  const KEY = 'geniusStar.support.v1';
  const DAY = 86400000;
  const MIN_SOLVES = 3;
  const MIN_GAP = 7 * DAY;          // never twice in the same week
  const BACKOFF = [10 * DAY, 45 * DAY];  // wait after the 1st and the 2nd dismissal
  const AFTER_OPEN = 180 * DAY;     // they already visited the page — leave them alone

  const state = { solves: 0, shown: 0, lastShown: 0, dismissed: 0, opened: 0, never: false };
  let armed = false, card = null;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') for (const k in state) if (typeof s[k] === typeof state[k]) state[k] = s[k];
    } catch (_) { /* storage unavailable */ }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* ignore */ } }

  function due() {
    if (state.never || card) return false;
    if (state.solves < MIN_SOLVES) return false;
    if (state.dismissed > BACKOFF.length) return false;
    const now = Date.now();
    if (state.opened && now - state.opened < AFTER_OPEN) return false;
    const wait = state.dismissed ? BACKOFF[state.dismissed - 1] : 0;
    if (state.lastShown && now - state.lastShown < Math.max(wait, MIN_GAP)) return false;
    return true;
  }

  function markOpened() { state.opened = Date.now(); save(); }
  function hide() {
    if (!card) return;
    const c = card;
    card = null;
    c.classList.remove('in');
    setTimeout(() => c.remove(), 220);
  }
  function dismiss() { state.dismissed++; save(); hide(); }

  function cta(label) {
    const a = el('a', { class: 'btn coffee', href: LINK, target: '_blank', rel: 'noopener noreferrer' }, label);
    a.addEventListener('click', () => { markOpened(); setTimeout(hide, 200); });
    return a;
  }

  function showCard(force) {
    if (card || (!force && !due())) return;
    const host = document.getElementById('support-root');
    if (!host) return;
    state.lastShown = Date.now(); state.shown++; save();
    const n = Math.max(1, state.solves);
    card = el('div', { class: 'support-card', role: 'dialog', 'aria-label': 'Support this project' },
      el('button', { type: 'button', class: 'support-x', 'aria-label': 'Close', text: '✕', onclick: dismiss }),
      el('div', { class: 'support-title', text: '☕ Enjoying the star?' }),
      el('p', { class: 'support-text', text: 'You have solved ' + n + ' star' + (n === 1 ? '' : 's') + ' here. This game is free, has no ads and no trackers, and one person builds it in his spare time. If it brightened a break, you can buy me a coffee back.' }),
      cta('☕ Buy me a coffee'),
      el('p', { class: 'support-foot', text: 'Shown once in a blue moon. Press ✕ and it will leave you alone.' }));
    host.appendChild(card);
    // setTimeout rather than requestAnimationFrame: rAF never fires in a hidden tab,
    // which would leave the card stuck at opacity 0.
    setTimeout(() => { if (card) card.classList.add('in'); }, 20);
  }

  function open() { markOpened(); root.open(LINK, '_blank', 'noopener'); }

  function init() {
    load();
    document.querySelectorAll('.support-link').forEach(a => a.addEventListener('click', markOpened));
    GS.game.on('solved', entry => {
      if (entry.revealed) return;
      state.solves++; save();
      if (entry.lobby_code) return;          // never interrupt a race
      if (due()) armed = true;               // wait for the win modal to close
    });
    GS.game.on('modal-closed', () => {
      if (!armed) return;
      armed = false;
      setTimeout(() => showCard(false), 900);
    });
  }

  GS.support = { LINK, open, showCard, dismiss, state };
  document.addEventListener('DOMContentLoaded', init);
})(window);
