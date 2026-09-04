/* lobby.js — "Play together": up to five players race on identical rolls.
 *
 * A lobby is a realtime channel named by a 5-character code. Every member publishes a small
 * presence state (nickname, status, pieces left, current round) and the host broadcasts
 * 'start' (round number + roll) events; each player broadcasts 'finish' when they solve.
 * The host is simply the longest-present member, so the lobby survives the host leaving.
 * Scoring: the fastest hint-free finisher of a round scores 1 point, or 2 with the Golden Star.
 */
(function (root) {
  'use strict';
  const GS = root.GS;
  const B = GS.backend, UI = GS.ui, D = GS.dice;
  const MAX_PLAYERS = 5;
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const KEY_MEMBER = 'geniusStar.memberKey';
  const $ = s => document.querySelector(s);
  const el = UI.el;

  const L = {
    code: null, channel: null, me: null, members: [], round: null, results: {},
    joinedAt: 0, status: 'idle', left: 0, time: null, golden: false, connecting: false,
  };
  let trackTimer = null, renderTimer = null, lastTracked = '';

  // ---------------------------------------------------------------- helpers
  function memberKey() {
    try {
      let k = sessionStorage.getItem(KEY_MEMBER);
      if (!k || !/^[0-9a-f]{16}$/.test(k)) { k = B.randomKey(); sessionStorage.setItem(KEY_MEMBER, k); }
      return k;
    } catch (_) { return B.randomKey(); }
  }
  function makeCode() {
    const a = new Uint8Array(5);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (let i = 0; i < 5; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, b => ALPHABET[b % ALPHABET.length]).join('');
  }
  function validCode(c) { return /^[A-Z0-9]{5}$/.test(c); }
  function sortedMembers() {
    return L.members.slice().sort((a, b) => (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0) || (a.key < b.key ? -1 : 1));
  }
  function hostKey() { const s = sortedMembers(); return s.length ? s[0].key : null; }
  function isHost() { return !!L.me && hostKey() === L.me.key; }
  function inLobby() { return !!L.code; }
  function myState() {
    return {
      nick: L.me.nick, joinedAt: L.joinedAt, status: L.status, left: L.left,
      round: L.round ? L.round.n : 0, roll: L.round ? L.round.roll : null, startedAt: L.round ? L.round.startedAt : null,
      time: L.time, golden: L.golden,
    };
  }
  function track() {
    if (!L.channel || !L.me) return;
    const st = myState();
    const sig = JSON.stringify(st);
    if (sig === lastTracked) return;
    lastTracked = sig;
    L.channel.track(st);
  }
  function trackSoon() { clearTimeout(trackTimer); trackTimer = setTimeout(track, 350); }
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 30); }
  function lobbyLink(code) {
    const origin = location.origin && location.origin !== 'null' ? location.origin : '';
    return origin + location.pathname + '#lobby=' + code;
  }

  // ---------------------------------------------------------------- join / leave
  async function join(code, nick, opts) {
    opts = opts || {};
    code = String(code || '').toUpperCase().trim();
    nick = B.cleanNick(nick);
    if (!validCode(code)) throw new Error('Lobby codes are 5 letters or digits.');
    if (nick.length < 2) throw new Error('Nickname must be 2–16 characters.');
    if (inLobby()) leave();
    L.connecting = true; render();
    let ch;
    try { ch = await B.lobby.open(code, { key: memberKey(), nick }); }
    catch (e) { L.connecting = false; render(); throw e; }
    L.connecting = false;
    L.code = code; L.channel = ch; L.me = { key: memberKey(), nick }; L.joinedAt = Date.now();
    L.results = {}; L.round = null; L.status = 'idle'; L.left = 0; L.time = null; L.golden = false; lastTracked = '';
    ch.onEvent(onEvent);
    ch.onMembers(onMembers);
    track();
    await new Promise(r => setTimeout(r, opts.creating ? 250 : 1200));
    if (L.code !== code) throw new Error('Lobby closed.');
    const others = L.members.filter(m => m.key !== L.me.key).length;
    if (!opts.creating && others >= MAX_PLAYERS) { leave(); throw new Error('That lobby is full (' + MAX_PLAYERS + ' players max).'); }
    GS.game.setLobbyMode(true);
    if (GS.account && !GS.account.user()) GS.account.setGuestNick(nick);
    if (location.hash !== '#lobby=' + code) history.replaceState(null, '', '#lobby=' + code);
    render();
    return code;
  }
  function leave() {
    if (L.channel) { try { L.channel.close(); } catch (_) { /* ignore */ } }
    L.code = null; L.channel = null; L.me = null; L.members = []; L.round = null; L.results = {};
    L.status = 'idle'; L.left = 0; L.time = null; L.golden = false; L.connecting = false; lastTracked = '';
    GS.game.setLobbyMode(false);
    if (/^#lobby=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    render();
  }

  // ---------------------------------------------------------------- incoming
  function onMembers(list) {
    L.members = (list || []).filter(m => m && typeof m.nick === 'string').map(m => Object.assign({}, m, { nick: B.cleanNick(m.nick) || 'Player' }));
    if (!L.me) return;
    // Late joiners (or a new host) adopt the round the host is on.
    const host = L.members.find(m => m.key === hostKey());
    if (host && host.key !== L.me.key && Number.isInteger(host.round) && host.round > 0 && Array.isArray(host.roll) && (!L.round || host.round > L.round.n)) {
      const roll = D.normalizeRoll(host.roll);
      if (roll) startRound({ n: host.round, roll, startedAt: Number(host.startedAt) || Date.now() });
    }
    // Results carried in presence (for players who joined after someone finished).
    if (L.round) {
      for (const m of L.members) {
        if (m.status === 'finished' && m.round === L.round.n && typeof m.time === 'number') {
          recordFinish(m.key, { n: m.round, nick: m.nick, time_ms: m.time, golden: !!m.golden }, true);
        }
      }
    }
    scheduleRender();
    trackSoon();
  }
  function onEvent(event, data, from) {
    if (!data || typeof data !== 'object' || !from) return;
    if (event === 'start') {
      const roll = Array.isArray(data.roll) ? D.normalizeRoll(data.roll) : null;
      const n = Number(data.n);
      if (!roll || !Number.isInteger(n) || n < 1 || n > 1000) return;
      if (from !== L.me.key && from !== hostKey()) return;            // only the host starts rounds
      startRound({ n, roll, startedAt: Number(data.startedAt) || Date.now() });
    } else if (event === 'finish') {
      recordFinish(from, data, false);
    }
  }
  function startRound(rd) {
    if (L.round && L.round.n >= rd.n) return;
    L.round = rd; L.status = 'solving'; L.left = GS.PIECES.length; L.time = null; L.golden = false;
    L.results[rd.n] = L.results[rd.n] || [];
    GS.game.startLobbyRound({ code: L.code, round: rd.n, roll: rd.roll });
    track(); render();
  }
  function recordFinish(key, data, quiet) {
    const n = Number(data.n);
    if (!Number.isInteger(n) || n < 1) return;
    const arr = L.results[n] = L.results[n] || [];
    if (arr.some(r => r.key === key)) return;
    const m = L.members.find(x => x.key === key);
    const row = {
      key, nick: B.cleanNick(data.nick || (m && m.nick)) || 'Player',
      time_ms: Math.max(0, Math.min(86399999, Number(data.time_ms) || 0)),
      golden: !!data.golden, hints: Math.max(0, Number(data.hints) || 0), revealed: !!data.revealed, at: Date.now(),
    };
    arr.push(row);
    if (!quiet && L.round && n === L.round.n && key !== L.me.key) {
      UI.toast(row.nick + ' finished round ' + n + ' in ' + UI.fmtTime(row.time_ms) + (row.golden ? ' — with the Golden Star!' : '!'), 3500);
    }
    scheduleRender();
  }

  // ---------------------------------------------------------------- outgoing
  function hostStart() {
    if (!inLobby() || !isHost()) return;
    const n = (L.round ? L.round.n : 0) + 1;
    L.channel.send('start', { n, roll: D.roll(), startedAt: Date.now() });
  }
  function finishInfo(lr) {
    if (!inLobby() || !L.round || !lr || lr.code !== L.code || lr.round !== L.round.n) return {};
    const arr = L.results[L.round.n] || [];
    return {
      lobby_code: L.code, round: L.round.n,
      rank: Math.min(MAX_PLAYERS, arr.filter(r => r.key !== L.me.key).length + 1),
      player_count: Math.min(MAX_PLAYERS, Math.max(1, L.members.length)),
    };
  }
  GS.game.on('solved', entry => {
    if (!inLobby() || !L.round || entry.lobby_code !== L.code) return;
    L.status = 'finished'; L.time = entry.time_ms; L.golden = entry.golden;
    L.channel.send('finish', { n: L.round.n, nick: L.me.nick, time_ms: entry.time_ms, golden: entry.golden, hints: entry.hints, revealed: entry.revealed });
    track();
  });
  GS.game.on('progress', p => {
    if (!inLobby() || L.status !== 'solving') return;
    L.left = p.left; trackSoon();
  });

  // ---------------------------------------------------------------- scoring
  function roundWinner(n) {
    const arr = (L.results[n] || []).filter(r => !r.revealed && !r.hints);
    if (!arr.length) return null;
    return arr.slice().sort((a, b) => a.time_ms - b.time_ms || a.at - b.at)[0];
  }
  function points() {
    const pts = new Map();
    for (const n of Object.keys(L.results)) {
      const w = roundWinner(Number(n));
      if (w) pts.set(w.key, (pts.get(w.key) || 0) + (w.golden ? 2 : 1));
    }
    return pts;
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    const body = $('#lobby-body');
    if (!body) return;
    body.textContent = '';
    const tag = $('#lobby-mode-tag');
    if (tag) tag.textContent = B.mode === 'supabase' ? 'online' : 'this device only';

    if (L.connecting) { body.appendChild(el('p', { class: 'muted', text: 'Connecting to the lobby…' })); return; }
    if (!inLobby()) {
      body.appendChild(el('p', { class: 'muted', text: 'Race up to five friends on identical rolls. First to finish wins the round; the Golden Star doubles it.' }));
      if (B.mode !== 'supabase') body.appendChild(el('p', { class: 'note', text: 'Local mode: lobbies only work between tabs of this browser. Connect the online backend for real multiplayer (README → Deploy).' }));
      body.appendChild(el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'primary', text: '➕ Create lobby', onclick: () => openCreate() }),
        el('button', { type: 'button', text: '🔗 Join with code', onclick: () => openJoin('') })));
      return;
    }

    const head = el('div', { class: 'lobby-head' },
      el('div', { class: 'lobby-code' }, 'Lobby ', el('b', { text: L.code })),
      el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'small', text: 'copy link', onclick: () => UI.copyText(lobbyLink(L.code), 'Lobby link copied — send it to your friends!') }),
        el('button', { type: 'button', class: 'small danger', text: 'Leave', onclick: () => leave() })));
    body.appendChild(head);

    const members = sortedMembers();
    const pts = points();
    const list = el('ul', { class: 'players' });
    for (const m of members) {
      const li = el('li', { class: m.key === L.me.key ? 'me' : '' });
      const name = el('span', { class: 'pname', text: m.nick });
      if (m.key === hostKey()) name.appendChild(el('span', { class: 'badge', text: 'host' }));
      if (m.key === L.me.key) name.appendChild(el('span', { class: 'badge you', text: 'you' }));
      let status = 'waiting';
      if (L.round && m.round === L.round.n) {
        if (m.status === 'finished') status = UI.fmtTime(m.time) + (m.golden ? ' ★' : '');
        else if (m.status === 'solving') status = (Number.isInteger(m.left) ? m.left : '?') + ' left';
      } else if (L.round && (m.round || 0) < L.round.n) status = 'joining…';
      li.appendChild(name);
      li.appendChild(el('span', { class: 'pstatus', text: status }));
      li.appendChild(el('span', { class: 'ppts', text: (pts.get(m.key) || 0) + ' pt' }));
      list.appendChild(li);
    }
    body.appendChild(list);
    body.appendChild(el('p', { class: 'muted small', text: members.length + ' / ' + MAX_PLAYERS + ' players' }));

    if (L.round) {
      const res = (L.results[L.round.n] || []).slice().sort((a, b) => a.time_ms - b.time_ms || a.at - b.at);
      const solving = members.filter(m => m.round === L.round.n && m.status === 'solving').length;
      body.appendChild(el('h3', { text: 'Round ' + L.round.n + (solving ? ' · ' + solving + ' still solving' : res.length ? ' · complete' : '') }));
      if (res.length) {
        const ol = el('ol', { class: 'results' });
        res.forEach((r, i) => ol.appendChild(el('li', {},
          el('span', { text: (['🥇', '🥈', '🥉'][i] || (i + 1) + '.') + ' ' + r.nick }),
          el('span', { class: 'mono', text: UI.fmtTime(r.time_ms) + (r.golden ? ' ★' : '') + (r.hints ? ' (hints)' : '') + (r.revealed ? ' (shown)' : '') }))));
        body.appendChild(ol);
      }
    } else {
      body.appendChild(el('p', { class: 'muted', text: isHost() ? 'You are the host — start the first round when everyone is in.' : 'Waiting for the host to start a round…' }));
    }
    if (isHost()) {
      body.appendChild(el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'primary', text: L.round ? '🎲 Next round' : '🎲 Start round 1', onclick: () => hostStart() })));
    }
  }

  // ---------------------------------------------------------------- dialogs
  function nickField() {
    const input = el('input', { type: 'text', maxlength: 16, placeholder: 'Nickname (2–16 characters)', autocomplete: 'nickname', value: GS.account ? (GS.account.nick() === 'Guest' ? '' : GS.account.nick()) : '' });
    return { input, label: el('label', { class: 'field' }, 'Your nickname', input) };
  }
  function openCreate() {
    const { input, label } = nickField();
    const err = el('p', { class: 'form-error' });
    UI.showModal({
      title: 'Create a lobby',
      node: el('div', {}, el('p', { text: 'You will get a 5-letter code to share. Up to five players can join.' }), label, err),
      buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async () => {
        try { const code = await join(makeCode(), input.value, { creating: true }); UI.toast('Lobby ' + code + ' created — share the code!'); }
        catch (e) { err.textContent = e.message || String(e); return false; }
      } }],
    });
  }
  function openJoin(prefill) {
    const { input, label } = nickField();
    const codeInput = el('input', { type: 'text', maxlength: 5, placeholder: 'ABCDE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', value: prefill || '', class: 'code-input' });
    const err = el('p', { class: 'form-error' });
    UI.showModal({
      title: 'Join a lobby',
      node: el('div', {}, label, el('label', { class: 'field' }, 'Lobby code', codeInput), err),
      buttons: [{ label: 'Cancel' }, { label: 'Join', primary: true, onClick: async () => {
        try { const code = await join(codeInput.value, input.value); UI.toast('Joined lobby ' + code + '.'); }
        catch (e) { err.textContent = e.message || String(e); return false; }
      } }],
    });
    if (prefill) input.focus();
  }

  // ---------------------------------------------------------------- init
  function init() {
    render();
    const m = /^#lobby=([A-Za-z0-9]{5})$/.exec(location.hash || '');
    if (m) setTimeout(() => openJoin(m[1].toUpperCase()), 400);
    window.addEventListener('hashchange', () => {
      const h = /^#lobby=([A-Za-z0-9]{5})$/.exec(location.hash || '');
      if (h && h[1].toUpperCase() !== L.code) openJoin(h[1].toUpperCase());
    });
    window.addEventListener('beforeunload', () => { if (L.channel) { try { L.channel.close(); } catch (_) { /* ignore */ } } });
  }

  GS.lobby = { join, leave, finishInfo, inLobby, isHost, openCreate, openJoin, state: L };
  document.addEventListener('DOMContentLoaded', init);
})(window);
