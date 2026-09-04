/* backend.js — storage, accounts and lobby transport for The Genius Star.
 *
 * Two modes, same interface (GS.backend):
 *   'supabase' — when window.GS_CONFIG has a Supabase URL + anon key: email/password accounts,
 *                per-profile game history in Postgres, online lobbies over Realtime.
 *   'local'    — no backend configured: guest play, history in localStorage, and lobbies that
 *                work between tabs of this browser (BroadcastChannel) for testing/demo.
 * Guests in 'supabase' mode behave like 'local' for history (nothing leaves the device).
 */
(function (root) {
  'use strict';
  const GS = root.GS = root.GS || {};
  const KEY_HISTORY = 'geniusStar.history.v1';
  const HISTORY_CAP = 500;
  const cfg = root.GS_CONFIG || {};
  const lib = root.supabase;
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && lib && typeof lib.createClient === 'function');

  // ------------------------------------------------------------ helpers
  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  function cleanNick(n) {
    return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  }
  const GAME_FIELDS = ['nick', 'blocked', 'roll', 'custom', 'time_ms', 'golden', 'hints', 'revealed', 'lobby_code', 'round', 'rank', 'player_count'];
  function normalizeEntry(entry) {
    const e = {};
    for (const k of GAME_FIELDS) e[k] = entry[k] === undefined ? null : entry[k];
    e.nick = cleanNick(e.nick) || 'Guest';
    e.custom = !!e.custom; e.golden = !!e.golden; e.revealed = !!e.revealed;
    e.hints = Math.max(0, Math.min(50, Number(e.hints) || 0));
    e.time_ms = Math.max(0, Math.min(86399999, Math.round(Number(e.time_ms) || 0)));
    return e;
  }

  // ------------------------------------------------------------ local history (guests / local mode)
  function localList() {
    try { const a = JSON.parse(localStorage.getItem(KEY_HISTORY)); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  function localSave(list) {
    try { localStorage.setItem(KEY_HISTORY, JSON.stringify(list.slice(0, HISTORY_CAP))); } catch (_) { /* storage unavailable */ }
  }
  function localLog(entry) {
    const list = localList();
    const row = Object.assign({ id: 'local-' + Date.now() + '-' + randomHex(3), created_at: new Date().toISOString() }, normalizeEntry(entry));
    list.unshift(row);
    localSave(list);
    return Promise.resolve(row);
  }

  // ------------------------------------------------------------ lobby transport: local (BroadcastChannel)
  class LocalChannel {
    constructor(code, member) {
      if (typeof BroadcastChannel === 'undefined') throw new Error('This browser cannot host local lobbies.');
      this.key = member.key;
      this.state = null;
      this.members = new Map();
      this.membersCb = null;
      this.eventCb = null;
      this.bc = new BroadcastChannel('genius-star-lobby-' + code);
      this.bc.onmessage = e => this.handle(e.data || {});
      this.timer = setInterval(() => this.heartbeat(), 1500);
      this.bc.postMessage({ type: 'hello', from: this.key });
    }
    handle(msg) {
      if (!msg || msg.from === this.key) return;
      if (msg.type === 'state' && msg.state && typeof msg.state === 'object') {
        this.members.set(msg.from, { state: msg.state, seen: Date.now() });
        this.emitMembers();
      } else if (msg.type === 'leave') {
        this.members.delete(msg.from);
        this.emitMembers();
      } else if (msg.type === 'hello') {
        if (this.state) this.bc.postMessage({ type: 'state', from: this.key, state: this.state });
      } else if (msg.type === 'event' && typeof msg.event === 'string') {
        if (this.eventCb) this.eventCb(msg.event, msg.data, msg.from);
      }
    }
    heartbeat() {
      if (this.state) this.bc.postMessage({ type: 'state', from: this.key, state: this.state });
      let changed = false;
      for (const [k, m] of this.members) if (Date.now() - m.seen > 5000) { this.members.delete(k); changed = true; }
      if (changed) this.emitMembers();
    }
    subscribe() { return Promise.resolve(); }
    onMembers(cb) { this.membersCb = cb; this.emitMembers(); }
    onEvent(cb) { this.eventCb = cb; }
    emitMembers() {
      const list = [];
      for (const [key, m] of this.members) list.push(Object.assign({ key }, m.state));
      if (this.state) list.push(Object.assign({ key: this.key }, this.state));
      if (this.membersCb) this.membersCb(list);
    }
    track(state) {
      this.state = state;
      this.bc.postMessage({ type: 'state', from: this.key, state });
      this.emitMembers();
    }
    send(event, data) {
      this.bc.postMessage({ type: 'event', from: this.key, event, data });
      if (this.eventCb) this.eventCb(event, data, this.key);
      return Promise.resolve('ok');
    }
    close() {
      try { this.bc.postMessage({ type: 'leave', from: this.key }); } catch (_) { /* closed */ }
      clearInterval(this.timer);
      this.bc.close();
    }
  }

  // ------------------------------------------------------------ lobby transport: Supabase Realtime
  class SupabaseChannel {
    constructor(client, code, member) {
      this.client = client;
      this.key = member.key;
      this.state = null;
      this.subscribed = false;
      this.membersCb = null;
      this.eventCb = null;
      this.ch = client.channel('lobby:' + code, { config: { presence: { key: member.key }, broadcast: { self: false } } });
      this.ch
        .on('presence', { event: 'sync' }, () => this.emitMembers())
        .on('broadcast', { event: '*' }, msg => {
          const p = (msg && msg.payload) || {};
          if (!p.from || p.from === this.key || typeof msg.event !== 'string') return;
          if (this.eventCb) this.eventCb(msg.event, p.data, p.from);
        });
    }
    subscribe() {
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (err) => { if (done) return; done = true; err ? reject(err) : resolve(); };
        this.ch.subscribe(status => {
          if (status === 'SUBSCRIBED') {
            this.subscribed = true;
            if (this.state) this.ch.track(this.state);
            finish();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            finish(new Error('Could not connect to the lobby (' + status.toLowerCase() + ').'));
          }
        });
        setTimeout(() => finish(new Error('Lobby connection timed out.')), 12000);
      });
    }
    onMembers(cb) { this.membersCb = cb; }
    onEvent(cb) { this.eventCb = cb; }
    emitMembers() {
      const st = this.ch.presenceState();
      const list = Object.keys(st).map(key => {
        const arr = st[key];
        return Object.assign({ key }, arr[arr.length - 1]);
      });
      if (this.membersCb) this.membersCb(list);
    }
    track(state) {
      this.state = state;
      if (this.subscribed) this.ch.track(state);
    }
    send(event, data) {
      if (this.eventCb) this.eventCb(event, data, this.key);
      return this.ch.send({ type: 'broadcast', event, payload: { from: this.key, data } });
    }
    close() {
      try { this.ch.untrack(); } catch (_) { /* ignore */ }
      try { this.client.removeChannel(this.ch); } catch (_) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------ the backend object
  const auth = { user: null, listeners: [] };
  auth.onChange = cb => auth.listeners.push(cb);
  auth.emit = () => auth.listeners.forEach(cb => { try { cb(auth.user); } catch (e) { console.error(e); } });

  const backend = {
    mode: configured ? 'supabase' : 'local',
    client: null,
    auth,
    randomKey: () => randomHex(8),
    cleanNick,
    games: {},
    lobby: {},
  };

  function notAvailable() {
    return Promise.reject(new Error('Accounts need the online backend. This copy runs in local mode — you can still play as a guest.'));
  }

  if (!configured) {
    backend.init = () => Promise.resolve();
    auth.signUp = notAvailable; auth.signIn = notAvailable; auth.signOut = () => Promise.resolve(); auth.updateNick = notAvailable;
    backend.games.log = localLog;
    backend.games.list = opts => Promise.resolve(localList().slice(0, (opts && opts.limit) || 200));
    backend.games.clearLocal = () => localSave([]);
    backend.lobby.open = async (code, member) => { const ch = new LocalChannel(code, member); await ch.subscribe(); return ch; };
  } else {
    const client = lib.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    backend.client = client;

    async function loadProfile(session) {
      if (!session || !session.user) { auth.user = null; return; }
      const u = session.user;
      let nick = cleanNick(u.user_metadata && u.user_metadata.nick);
      try {
        const { data } = await client.from('profiles').select('nick').eq('id', u.id).maybeSingle();
        if (data && data.nick) nick = cleanNick(data.nick);
      } catch (_) { /* profile row may not exist yet */ }
      auth.user = { id: u.id, email: u.email || '', nick: nick || 'Player' };
    }

    backend.init = async () => {
      try {
        const { data } = await client.auth.getSession();
        await loadProfile(data && data.session);
      } catch (e) { console.warn('Session check failed', e); auth.user = null; }
      client.auth.onAuthStateChange((event, session) => {
        loadProfile(session).then(() => auth.emit());
      });
    };
    auth.signUp = async ({ email, password, nick }) => {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { nick: cleanNick(nick) } } });
      if (error) throw error;
      // Supabase deliberately answers an already-registered email like a fresh sign-up (no session,
      // empty identities) so that the form cannot be used to enumerate accounts; keep it that way.
      return { confirmationRequired: !(data && data.session) };
    };
    auth.signIn = async ({ email, password }) => {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    };
    auth.signOut = async () => { await client.auth.signOut(); };
    auth.updateNick = async nick => {
      nick = cleanNick(nick);
      if (!auth.user) throw new Error('Not signed in.');
      if (nick.length < 2) throw new Error('Nickname must be 2–16 characters.');
      const { error } = await client.from('profiles').upsert({ id: auth.user.id, nick });
      if (error) throw error;
      client.auth.updateUser({ data: { nick } }).catch(() => { /* metadata is a convenience only */ });
      auth.user.nick = nick;
      auth.emit();
    };
    backend.games.log = async entry => {
      if (!auth.user) return localLog(entry);
      const row = normalizeEntry(entry);
      const { data, error } = await client.from('games').insert(row).select().single();
      if (error) { console.warn('Could not save the game online, keeping it locally.', error); return localLog(entry); }
      return data;
    };
    backend.games.list = async opts => {
      const limit = (opts && opts.limit) || 200;
      if (!auth.user) return localList().slice(0, limit);
      const { data, error } = await client.from('games').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    };
    backend.games.clearLocal = () => localSave([]);
    backend.lobby.open = async (code, member) => { const ch = new SupabaseChannel(client, code, member); await ch.subscribe(); return ch; };
  }

  GS.backend = backend;
})(typeof window !== 'undefined' ? window : globalThis);
