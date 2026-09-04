/* account.js — accounts, nicknames, profile & game history for The Genius Star.
 * Signed-in players (Supabase email/password) keep their history on their profile;
 * guests keep it in this browser. Everything user-provided is rendered as text nodes.
 */
(function (root) {
  'use strict';
  const GS = root.GS;
  const B = GS.backend, UI = GS.ui;
  const KEY_NICK = 'geniusStar.nick';
  const $ = s => document.querySelector(s);
  const el = UI.el;

  function guestNick() { try { return B.cleanNick(localStorage.getItem(KEY_NICK)); } catch (_) { return ''; } }
  function setGuestNick(n) { n = B.cleanNick(n); try { localStorage.setItem(KEY_NICK, n); } catch (_) { /* ignore */ } renderChip(); }
  function user() { return B.auth.user; }
  function nick() { const u = user(); return (u && u.nick) || guestNick() || 'Guest'; }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
  function errorText(e) {
    const msg = (e && e.message) || String(e);
    if (/rate limit/i.test(msg)) return 'Too many attempts — please wait a minute and try again.';
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email address first (check your inbox).';
    return msg;
  }

  function renderChip() {
    const chip = $('#user-chip');
    if (!chip) return;
    const u = user();
    chip.textContent = '';
    chip.appendChild(el('span', { class: 'chip-icon', text: u ? '★' : '👤' }));
    chip.appendChild(el('span', { class: 'chip-name', text: nick() }));
    chip.appendChild(el('span', { class: 'chip-tag', text: u ? 'signed in' : 'guest' }));
    chip.title = u ? u.email : 'Playing as a guest';
    const owner = $('#records-owner');
    if (owner) owner.textContent = u ? nick() : 'this browser';
  }

  // ---------------------------------------------------------------- menu
  function openMenu() {
    const u = user();
    const node = el('div', { class: 'btn-stack' });
    node.appendChild(el('p', { class: 'muted', text: u ? 'Signed in as ' + u.email : 'Playing as a guest — records stay in this browser.' }));
    node.appendChild(el('button', { type: 'button', class: 'primary', text: '📜 Profile & history', onclick: () => { UI.closeModal(); openProfile(); } }));
    node.appendChild(el('button', { type: 'button', text: '✏️ Change nickname', onclick: () => { UI.closeModal(); openNick(); } }));
    if (u) node.appendChild(el('button', { type: 'button', text: 'Sign out', onclick: async () => { UI.closeModal(); try { await B.auth.signOut(); UI.toast('Signed out.'); } catch (e) { UI.toast(errorText(e)); } } }));
    else node.appendChild(el('button', { type: 'button', text: '🔑 Sign in / Create account', onclick: () => { UI.closeModal(); openAuth('signin'); } }));
    UI.showModal({ title: nick(), node, buttons: [{ label: 'Close' }] });
  }

  function openNick() {
    const input = el('input', { type: 'text', maxlength: 16, value: nick() === 'Guest' ? '' : nick(), placeholder: 'Nickname (2–16 characters)', autocomplete: 'nickname' });
    const err = el('p', { class: 'form-error' });
    const node = el('div', {}, el('label', { class: 'field' }, 'Nickname', input), err);
    UI.showModal({
      title: 'Change nickname', node,
      buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
        const n = B.cleanNick(input.value);
        if (n.length < 2) { err.textContent = 'Nickname must be 2–16 characters.'; return false; }
        try {
          if (user()) await B.auth.updateNick(n); else setGuestNick(n);
          renderChip(); UI.toast('Nickname saved.');
        } catch (e) { err.textContent = errorText(e); return false; }
      } }],
    });
  }

  // ---------------------------------------------------------------- sign in / sign up
  function openAuth(tab) {
    if (B.mode !== 'supabase') {
      const input = el('input', { type: 'text', maxlength: 16, value: guestNick(), placeholder: 'Nickname (2–16 characters)' });
      const err = el('p', { class: 'form-error' });
      const node = el('div', {},
        el('p', { text: 'This copy runs in local mode: accounts need the online backend (see README → Deploy). You can still play as a guest — records and history stay in this browser.' }),
        el('label', { class: 'field' }, 'Guest nickname', input), err);
      UI.showModal({ title: 'Accounts unavailable', node, buttons: [{ label: 'Close' }, { label: 'Save nickname', primary: true, onClick: () => {
        const n = B.cleanNick(input.value);
        if (n.length < 2) { err.textContent = 'Nickname must be 2–16 characters.'; return false; }
        setGuestNick(n); UI.toast('Playing as ' + n + '.');
      } }] });
      return;
    }
    const node = el('div', { class: 'auth' });
    const tabs = el('div', { class: 'tabs' });
    const btnIn = el('button', { type: 'button', class: 'tab', text: 'Sign in' });
    const btnUp = el('button', { type: 'button', class: 'tab', text: 'Create account' });
    tabs.appendChild(btnIn); tabs.appendChild(btnUp);
    node.appendChild(tabs);

    const err = el('p', { class: 'form-error' });
    const info = el('p', { class: 'form-info' });

    // sign in form
    const inEmail = el('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com', required: true, maxlength: 254 });
    const inPass = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true, maxlength: 128 });
    const inSubmit = el('button', { type: 'submit', class: 'primary', text: 'Sign in' });
    const formIn = el('form', { class: 'auth-form', novalidate: true },
      el('label', { class: 'field' }, 'Email', inEmail),
      el('label', { class: 'field' }, 'Password', inPass),
      inSubmit);

    // sign up form
    const upNick = el('input', { type: 'text', autocomplete: 'nickname', placeholder: 'Nickname (2–16 characters)', maxlength: 16, value: guestNick() });
    const upEmail = el('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com', maxlength: 254 });
    const upPass = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Password (8+ characters)', maxlength: 128 });
    const upSubmit = el('button', { type: 'submit', class: 'primary', text: 'Create account' });
    const formUp = el('form', { class: 'auth-form', novalidate: true },
      el('label', { class: 'field' }, 'Nickname', upNick),
      el('label', { class: 'field' }, 'Email', upEmail),
      el('label', { class: 'field' }, 'Password', upPass),
      upSubmit);

    node.appendChild(formIn); node.appendChild(formUp); node.appendChild(err); node.appendChild(info);

    function show(which) {
      formIn.classList.toggle('hidden', which !== 'signin');
      formUp.classList.toggle('hidden', which !== 'signup');
      btnIn.classList.toggle('active', which === 'signin');
      btnUp.classList.toggle('active', which === 'signup');
      err.textContent = ''; info.textContent = '';
      (which === 'signin' ? inEmail : upNick).focus();
    }
    btnIn.addEventListener('click', () => show('signin'));
    btnUp.addEventListener('click', () => show('signup'));

    formIn.addEventListener('submit', async e => {
      e.preventDefault();
      err.textContent = ''; info.textContent = '';
      const email = inEmail.value.trim().toLowerCase(), password = inPass.value;
      if (!validEmail(email)) { err.textContent = 'Enter a valid email address.'; return; }
      if (!password) { err.textContent = 'Enter your password.'; return; }
      inSubmit.disabled = true;
      try {
        await B.auth.signIn({ email, password });
        UI.closeModal();
        UI.toast('Welcome back!');
      } catch (ex) { err.textContent = errorText(ex); }
      inSubmit.disabled = false;
    });
    formUp.addEventListener('submit', async e => {
      e.preventDefault();
      err.textContent = ''; info.textContent = '';
      const n = B.cleanNick(upNick.value), email = upEmail.value.trim().toLowerCase(), password = upPass.value;
      if (n.length < 2) { err.textContent = 'Nickname must be 2–16 characters.'; return; }
      if (!validEmail(email)) { err.textContent = 'Enter a valid email address.'; return; }
      if (password.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
      upSubmit.disabled = true;
      try {
        const res = await B.auth.signUp({ email, password, nick: n });
        setGuestNick(n);
        if (res.confirmationRequired) {
          show('signin'); inEmail.value = email;
          info.textContent = 'If this email is new, a confirmation link is on its way — open it, then sign in here. Already registered? Just sign in.';
        } else { UI.closeModal(); UI.toast('Account created — welcome, ' + n + '!'); }
      } catch (ex) { err.textContent = errorText(ex); }
      upSubmit.disabled = false;
    });

    UI.showModal({ title: 'Your account', node, buttons: [{ label: 'Close' }] });
    show(tab === 'signup' ? 'signup' : 'signin');
  }

  // ---------------------------------------------------------------- profile & history
  function puzzleText(g) {
    if (g.custom || !Array.isArray(g.roll)) return 'custom ' + (Array.isArray(g.blocked) ? g.blocked.join('·') : '');
    return g.roll.slice().sort((a, b) => a - b).join('·');
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  async function openProfile() {
    const u = user();
    const node = el('div', { class: 'profile' });
    node.appendChild(el('p', { class: 'muted', text: 'Loading…' }));
    const box = UI.showModal({ title: nick() + (u ? '' : ' (guest)'), node, buttons: u ? [{ label: 'Close' }] : [
      { label: 'Clear local history', onClick: () => {
        if (!confirm('Delete the game history stored in this browser?')) return false;
        B.games.clearLocal(); GS.game.refreshRecords(); UI.toast('Local history cleared.');
      } },
      { label: 'Create account', primary: true, onClick: () => openAuth('signup') },
    ] });
    let list = [];
    try { list = await B.games.list({ limit: 200 }); } catch (e) { node.textContent = ''; node.appendChild(el('p', { class: 'form-error', text: 'Could not load history: ' + errorText(e) })); return; }
    if (!box.isConnected) return;
    const st = GS.game.computeStats(list);
    node.textContent = '';
    node.appendChild(el('p', { class: 'muted', text: u ? 'Signed in as ' + u.email + '. Records and history live on your profile.' : 'Guest history is stored in this browser only. Create an account to keep it across devices.' }));
    const grid = el('div', { class: 'records' });
    const rec = (label, value) => el('div', { class: 'rec' }, el('b', { text: value }), el('span', { text: label }));
    grid.appendChild(rec('Best time', st.bestTime === null ? '–' : UI.fmtTime(st.bestTime)));
    grid.appendChild(rec('Best Golden Star', st.bestGolden === null ? '–' : UI.fmtTime(st.bestGolden)));
    grid.appendChild(rec('Solved', String(st.solved)));
    grid.appendChild(rec('Golden Stars', String(st.golden)));
    grid.appendChild(rec('Lobby wins', String(st.lobbyWins)));
    grid.appendChild(rec('Games logged', String(st.total)));
    node.appendChild(grid);
    node.appendChild(el('h3', { text: 'History' }));
    if (!list.length) { node.appendChild(el('p', { class: 'muted', text: 'No finished games yet — solve a star!' })); return; }
    const table = el('table', { class: 'history' });
    table.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'When' }), el('th', { text: 'Puzzle' }), el('th', { text: 'Time' }), el('th', { text: '★' }), el('th', { text: 'Notes' }))));
    const tbody = el('tbody');
    for (const g of list) {
      const notes = [];
      if (g.lobby_code) notes.push('lobby ' + g.lobby_code + ' · round ' + g.round + (g.rank ? ' · ' + ordinal(g.rank) + (g.player_count ? ' of ' + g.player_count : '') : ''));
      if (g.hints) notes.push(g.hints + ' hint' + (g.hints > 1 ? 's' : ''));
      if (g.revealed) notes.push('solution shown');
      tbody.appendChild(el('tr', { class: g.revealed ? 'dim' : '' },
        el('td', { text: fmtDate(g.created_at) }),
        el('td', { class: 'mono', text: puzzleText(g) }),
        el('td', { class: 'mono', text: UI.fmtTime(g.time_ms) }),
        el('td', { text: g.golden ? '★' : '' }),
        el('td', { class: 'muted', text: notes.join(' · ') })));
    }
    table.appendChild(tbody);
    node.appendChild(el('div', { class: 'table-wrap' }, table));
  }
  function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th'); }

  // ---------------------------------------------------------------- init
  async function init() {
    const chip = $('#user-chip');
    if (chip) chip.addEventListener('click', openMenu);
    const profileBtn = $('#btn-profile');
    if (profileBtn) profileBtn.addEventListener('click', openProfile);
    const accountBtn = $('#btn-account');
    if (accountBtn) accountBtn.addEventListener('click', openMenu);
    const tag = $('#backend-tag');
    if (tag) tag.textContent = B.mode === 'supabase' ? 'online' : 'local mode';
    try { await B.init(); } catch (e) { console.warn('Backend init failed', e); }
    renderChip();
    GS.game.refreshRecords();
    B.auth.onChange(() => { renderChip(); GS.game.refreshRecords(); });
  }

  GS.account = { nick, user, guestNick, setGuestNick, openAuth, openProfile, openMenu, errorText };
  document.addEventListener('DOMContentLoaded', init);
})(window);
