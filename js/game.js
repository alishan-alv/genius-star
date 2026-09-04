/* game.js — user interface for The Genius Star (web edition).
 * Drag pieces from the tray onto the star, rotate with R / flip with F, race the clock,
 * and try to complete the puzzle with the Golden Star whole.
 * Exposes GS.ui (shared widgets) and GS.game (events + lobby hooks) for account.js / lobby.js.
 */
(function (root) {
  'use strict';
  const GS = root.GS;
  const G = GS.geom, D = GS.dice, S = GS.solver;
  const PIECES = GS.PIECES, SHAPES = GS.SHAPES, PIECE_BY_ID = GS.PIECE_BY_ID;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SNAP_DIST = G.SIDE * 0.8;
  const KEY_GAME = 'geniusStar.game.v1';
  const $ = s => document.querySelector(s);
  const phoneQuery = root.matchMedia ? root.matchMedia('(max-width: 560px)') : { matches: false, addEventListener() {} };

  const state = {
    roll: null,          // seven numbers in dice order (null for custom puzzles)
    custom: false,
    editing: false,
    blocked: [],         // blocked cell indices (0..47)
    placed: {},          // pieceId -> { orient, r, c, cells }
    trayOrient: {},      // pieceId -> orientation index shown in the tray
    selected: null,
    drag: null,
    elapsed: 0, startedAt: null, running: false,
    solved: false, golden: false, hints: 0, revealed: false, starPossible: null,
    lobbyMode: false,    // inside a lobby: rounds are started by the host, no hints
    lobbyRound: null,    // { code, round } while a lobby round is being played
  };
  const els = {};
  const listeners = {};
  let uid = 0, timerHandle = null, busy = false, lastSave = 0, recordsSeq = 0;

  // ------------------------------------------------------------------ tiny event bus
  function on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); }
  function emit(evt, data) { (listeners[evt] || []).forEach(cb => { try { cb(data); } catch (e) { console.error(e); } }); }

  // ------------------------------------------------------------------ shared UI helpers (GS.ui)
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function el(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;            // trusted static markup only
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }
  function svgEl(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }
  function fmtTime(ms) {
    const t = Math.max(0, Number(ms) || 0);
    const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), d = Math.floor((t % 1000) / 100);
    return m + ':' + String(s).padStart(2, '0') + '.' + d;
  }
  let toastTimer = null;
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms || 2600);
  }
  // showModal({ title, html | node, buttons: [{ label, primary, onClick(box) }], locked })
  // A button's onClick may return false (or a promise of false) to keep the modal open.
  function showModal(opts) {
    els.modal.innerHTML = '';
    const back = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    box.appendChild(el('h2', { text: opts.title }));
    const body = el('div', { class: 'modal-body' });
    if (opts.node) body.appendChild(opts.node); else if (opts.html) body.innerHTML = opts.html;
    box.appendChild(body);
    const buttons = opts.buttons || [{ label: 'Close' }];
    const row = el('div', { class: 'btn-row modal-buttons' });
    const btnEls = buttons.map(b => {
      const btn = el('button', { type: 'button', text: b.label, class: b.primary ? 'primary' : '' });
      btn.addEventListener('click', async () => {
        if (!b.onClick) { closeModal(); return; }
        btnEls.forEach(x => { x.disabled = true; });
        let keep = false;
        try { keep = (await b.onClick(box)) === false; } catch (e) { console.error(e); keep = true; }
        btnEls.forEach(x => { x.disabled = false; });
        if (!keep) closeModal();
      });
      row.appendChild(btn);
      return btn;
    });
    box.appendChild(row);
    box.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.closest('form')) return;
      const idx = buttons.findIndex(b => b.primary);
      if (idx >= 0) { e.preventDefault(); btnEls[idx].click(); }
    });
    back.appendChild(box);
    back.addEventListener('click', e => { if (e.target === back && !opts.locked) closeModal(); });
    els.modal.appendChild(back);
    els.modal.classList.remove('hidden');
    const first = box.querySelector('input, select, button.primary, button');
    if (first) first.focus();
    return box;
  }
  function closeModal() { els.modal.classList.add('hidden'); els.modal.innerHTML = ''; }
  function modalOpen() { return !els.modal.classList.contains('hidden'); }

  // Side-panel tabs (Play / Lobby / Records).
  function showPane(name) {
    document.querySelectorAll('.tabs .tab').forEach(t => {
      const on = t.dataset.pane === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('hidden', p.id !== 'pane-' + name));
  }
  function setTabBadge(name, text) {
    const b = document.getElementById(name + '-badge');
    if (!b) return;
    b.textContent = text || '';
    b.classList.toggle('hidden', !text);
  }

  GS.ui = { esc, el, fmtTime, toast, showModal, closeModal, modalOpen, showPane, setTabBadge };

  // ------------------------------------------------------------------ helpers
  function clientToSvg(svg, x, y) {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  function boardScale() { const m = els.board.getScreenCTM(); return m ? m.a : 1; }
  function trayScale() { return phoneQuery.matches ? 0.33 : 0.4; }
  function translated(cellsRC, dr, dc) { return cellsRC.map(([r, c]) => [r + dr, c + dc]); }
  function absCells(id, p) { return translated(SHAPES[PIECE_BY_ID[id].shape].orients[p.orient].cells, p.r, p.c); }
  function occupancy(excludeId) {
    const occ = new Array(48).fill(null);
    for (const i of state.blocked) occ[i] = 'blocked';
    for (const id in state.placed) {
      if (id === excludeId) continue;
      for (const i of state.placed[id].cells) occ[i] = id;
    }
    return occ;
  }
  function hasPuzzle() { return state.blocked.length === 7 && !state.editing; }
  function piecesLeft() { return PIECES.length - Object.keys(state.placed).length; }
  function fixedList() {
    return Object.entries(state.placed).map(([id, p]) => ({ shape: PIECE_BY_ID[id].shape, cells: p.cells }));
  }
  function setDisabled(sel, flag) { const b = $(sel); if (b) b.disabled = !!flag; }
  function updateButtons() {
    const lobby = state.lobbyMode, has = hasPuzzle();
    ['#btn-roll', '#btn-enter', '#btn-daily', '#btn-custom'].forEach(s => setDisabled(s, busy || lobby || state.editing));
    setDisabled('#btn-hint', lobby || !has || state.solved || busy);
    setDisabled('#btn-solution', lobby || !has || state.solved || busy);
    setDisabled('#btn-golden', lobby || !has);
    setDisabled('#btn-clear', !has || state.solved);
  }

  // ------------------------------------------------------------------ board
  function buildBoard() {
    const svg = els.board;
    svg.setAttribute('viewBox', '0 0 ' + G.WIDTH + ' ' + G.HEIGHT);
    svg.innerHTML = '';
    const all = G.cells.map(c => [c.r, c.c]);
    const starPath = G.outlinePath(all);
    svgEl('path', { d: starPath, class: 'board-rim' }, svg);
    svgEl('path', { d: starPath, class: 'board-face' }, svg);
    const gCells = svgEl('g', { class: 'cells' }, svg);
    for (const cell of G.cells) {
      const g = svgEl('g', { class: 'cell', 'data-i': cell.i }, gCells);
      svgEl('polygon', { points: G.pointsAttr(G.cellPolygon(cell.r, cell.c)) }, g);
      const [cx, cy] = G.cellCentroid(cell.r, cell.c);
      const t = svgEl('text', { x: cx.toFixed(2), y: (cy + 1).toFixed(2), class: 'cell-num' }, g);
      t.textContent = cell.n;
      g.addEventListener('click', () => onCellClick(cell.i));
    }
    const brand = svgEl('text', { x: G.WIDTH - 6, y: G.HEIGHT - 8, class: 'board-brand' }, svg);
    brand.textContent = 'GENIUS STAR';
    els.gBlockers = svgEl('g', { class: 'blockers' }, svg);
    els.gPieces = svgEl('g', { class: 'pieces' }, svg);
    els.gGhost = svgEl('g', { class: 'ghost' }, svg);
  }

  function renderBlockers(animate) {
    els.gBlockers.innerHTML = '';
    state.blocked.forEach((i, k) => {
      const cell = G.cells[i];
      const g = svgEl('g', { class: 'blocker' }, els.gBlockers);
      if (animate) g.style.animationDelay = (k * 70) + 'ms'; else g.style.animation = 'none';
      svgEl('polygon', { points: G.pointsAttr(G.shrinkPolygon(G.cellPolygon(cell.r, cell.c), 0.86)) }, g);
      const [cx, cy] = G.cellCentroid(cell.r, cell.c);
      svgEl('polygon', { points: G.pointsAttr(G.starPoints(cx, cy, 11, 4.6, 5, -Math.PI / 2)), class: 'blocker-star' }, g);
    });
    els.board.querySelectorAll('.cell').forEach(c => c.classList.toggle('blocked', state.blocked.includes(+c.dataset.i)));
  }

  // Draw a piece (absolute or normalized cells) into an SVG parent.
  function drawPiece(parent, piece, cellsRC) {
    const g = svgEl('g', { class: 'piece piece-' + piece.id }, parent);
    const d = G.outlinePath(cellsRC);
    const clipId = 'clip' + (++uid);
    const cp = svgEl('clipPath', { id: clipId }, g);
    svgEl('path', { d }, cp);
    svgEl('path', { d, class: 'piece-shadow', transform: 'translate(3,3)' }, g);
    svgEl('path', { d, fill: piece.color, stroke: piece.edge, class: 'piece-body' }, g);
    if (piece.star) {
      const v = G.commonVertex(cellsRC);
      if (v) {
        const sg = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' }, g);
        const R = G.SIDE * 0.84;
        svgEl('polygon', { points: G.pointsAttr(G.starPoints(v.x, v.y, R, R / Math.sqrt(3), 6, 0)), class: 'gold-star' }, sg);
      }
    }
    return g;
  }

  function renderPieces(animateIds) {
    els.gPieces.innerHTML = '';
    for (const piece of PIECES) {
      const p = state.placed[piece.id];
      if (!p) continue;
      const g = drawPiece(els.gPieces, piece, absCells(piece.id, p));
      g.classList.add('placed');
      g.dataset.id = piece.id;
      if (state.golden && piece.star) g.classList.add('golden');
      if (state.solved) g.classList.add('locked');
      if (state.drag && state.drag.from === 'board' && state.drag.id === piece.id) g.classList.add('hidden');
      if (animateIds && animateIds.includes(piece.id)) g.classList.add('pop');
      g.addEventListener('pointerdown', e => onBoardPiecePointerDown(e, piece.id));
    }
  }
  function refreshGoldenClasses() {
    els.gPieces.querySelectorAll('.piece').forEach(g => {
      const piece = PIECE_BY_ID[g.dataset.id];
      g.classList.toggle('golden', !!(state.golden && piece && piece.star));
    });
  }

  // ------------------------------------------------------------------ tray
  function renderTray() {
    els.tray.innerHTML = '';
    for (const piece of PIECES) els.tray.appendChild(makeSlot(piece));
    updatePiecesLeft();
  }
  function makeSlot(piece) {
    const slot = el('div', { class: 'slot', 'data-id': piece.id, title: piece.name });
    const orient = state.trayOrient[piece.id] || 0;
    const cellsRC = SHAPES[piece.shape].orients[orient].cells;
    const bb = G.cellsBBox(cellsRC), m = 6, k = trayScale();
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', (bb.x - m) + ' ' + (bb.y - m) + ' ' + (bb.w + 2 * m) + ' ' + (bb.h + 2 * m));
    svg.style.width = ((bb.w + 2 * m) * k) + 'px';
    svg.style.height = ((bb.h + 2 * m) * k) + 'px';
    drawPiece(svg, piece, cellsRC);
    slot.appendChild(svg);
    if (state.placed[piece.id]) slot.classList.add('placed');
    if (state.selected === piece.id) slot.classList.add('selected');
    slot.addEventListener('pointerdown', e => onTrayPointerDown(e, piece.id));
    slot.addEventListener('wheel', e => {
      if (state.placed[piece.id] || state.drag) return;
      e.preventDefault();
      state.selected = piece.id;
      rotateActive(e.deltaY > 0 ? 'cw' : 'ccw');
    }, { passive: false });
    return slot;
  }
  function renderSlot(id) {
    const old = els.tray.querySelector('.slot[data-id="' + id + '"]');
    if (old) old.replaceWith(makeSlot(PIECE_BY_ID[id]));
  }
  function highlightSelected() {
    els.tray.querySelectorAll('.slot').forEach(s => s.classList.toggle('selected', s.dataset.id === state.selected));
  }
  function updatePiecesLeft() {
    els.left.textContent = hasPuzzle() ? piecesLeft() + ' left' : '';
  }

  // ------------------------------------------------------------------ drag & drop
  function onTrayPointerDown(e, id) {
    if (busy || state.editing || state.solved || state.drag || state.placed[id] || e.button > 0 || !hasPuzzle()) {
      if (!state.drag && !state.placed[id]) { state.selected = id; highlightSelected(); }
      return;
    }
    e.preventDefault();
    const svg = e.currentTarget.querySelector('svg');
    const grab = clientToSvg(svg, e.clientX, e.clientY);
    const wasSelected = state.selected === id;
    state.selected = id;
    highlightSelected();
    e.currentTarget.classList.add('lifted');
    startDrag(id, state.trayOrient[id] || 0, grab, e, { from: 'tray', wasSelected });
  }
  function onBoardPiecePointerDown(e, id) {
    if (busy || state.editing || state.solved || state.drag || e.button > 0) return;
    e.preventDefault();
    const p = state.placed[id];
    const bp = clientToSvg(els.board, e.clientX, e.clientY);
    const grab = [bp[0] - p.c * G.SIDE / 2, bp[1] - p.r * G.H];
    state.selected = id;
    highlightSelected();
    startDrag(id, p.orient, grab, e, { from: 'board' });
    e.currentTarget.classList.add('hidden');
    state.golden = computeGolden(id);
    refreshGoldenClasses();
    updateStatus();
  }
  function startDrag(id, orient, grab, e, extra) {
    state.drag = Object.assign({
      id, orient, grab, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY, moved: false, snap: null,
      lift: e.pointerType === 'touch' ? 56 : 0,   // keep the piece visible above a finger
    }, extra);
    try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    document.body.classList.add('dragging');
    updateDragVisual();
  }
  function onDragMove(e) {
    const d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX; d.y = e.clientY;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) d.moved = true;
    updateDragVisual();
  }
  function updateDragVisual() {
    const d = state.drag;
    if (!d) return;
    const piece = PIECE_BY_ID[d.id];
    const cellsRC = SHAPES[piece.shape].orients[d.orient].cells;
    const k = boardScale();
    const lift = d.moved ? d.lift : 0;
    els.dragLayer.innerHTML = '';
    const g = svgEl('g', { transform: 'translate(' + (d.x - k * d.grab[0]) + ',' + (d.y - lift - k * d.grab[1]) + ') scale(' + k + ')' }, els.dragLayer);
    drawPiece(g, piece, cellsRC).classList.add('lifted');
    d.snap = computeSnap(d);
    els.gGhost.innerHTML = '';
    if (d.snap) svgEl('path', { d: G.outlinePath(d.snap.cellsRC), class: 'ghost-path ' + (d.snap.valid ? 'valid' : 'invalid') }, els.gGhost);
  }
  function computeSnap(d) {
    const [bx, by] = clientToSvg(els.board, d.x, d.y - (d.moved ? d.lift : 0));
    const ox = bx - d.grab[0], oy = by - d.grab[1];
    const cellsRC = SHAPES[PIECE_BY_ID[d.id].shape].orients[d.orient].cells;
    const [r0, c0] = cellsRC[0];
    const up0 = G.isUp(r0, c0);
    const [cx0, cy0] = G.cellCentroid(r0, c0);
    const px = cx0 + ox, py = cy0 + oy;
    let best = null, bestD = Infinity;
    for (const cell of G.cells) {
      if (cell.up !== up0) continue;
      const [x, y] = G.cellCentroid(cell.r, cell.c);
      const dist = Math.hypot(x - px, y - py);
      if (dist < bestD) { bestD = dist; best = cell; }
    }
    if (!best || bestD > SNAP_DIST) return null;
    const dr = best.r - r0, dc = best.c - c0;
    const occ = occupancy(d.id);
    const abs = translated(cellsRC, dr, dc);
    const idx = [];
    let valid = true;
    for (const [r, c] of abs) {
      const i = G.cellIndex(r, c);
      if (i < 0 || occ[i]) valid = false;
      idx.push(i);
    }
    return { dr, dc, cellsRC: abs, cellIdx: idx, valid };
  }
  function onDragEnd(e) {
    const d = state.drag;
    if (!d || (e && e.pointerId !== undefined && e.pointerId !== d.pointerId)) return;
    if (e && e.type === 'pointercancel') d.snap = null;
    else if (e && typeof e.clientX === 'number') {
      d.x = e.clientX; d.y = e.clientY;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) d.moved = true;
      d.snap = d.moved ? computeSnap(d) : null;
    }
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    state.drag = null;
    document.body.classList.remove('dragging');
    els.dragLayer.innerHTML = '';
    els.gGhost.innerHTML = '';
    if (d.from === 'board') delete state.placed[d.id];
    state.trayOrient[d.id] = d.orient;
    let placedNow = false;
    if (d.moved && d.snap && d.snap.valid) {
      state.placed[d.id] = { orient: d.orient, r: d.snap.dr, c: d.snap.dc, cells: d.snap.cellIdx };
      placedNow = true;
    } else if (!d.moved && d.from === 'tray' && d.wasSelected) {
      // Tapping an already selected tray piece rotates it (handy on touch screens).
      state.trayOrient[d.id] = SHAPES[PIECE_BY_ID[d.id].shape].orients[d.orient].cw;
    }
    renderPieces(placedNow ? [d.id] : null);
    renderTray();
    afterChange();
  }
  function cancelDrag() {
    const d = state.drag;
    if (!d) return;
    d.snap = null;
    onDragEnd(null);
  }
  function rotateActive(dir) {
    const d = state.drag;
    if (d) {
      const orients = SHAPES[PIECE_BY_ID[d.id].shape].orients;
      const oldC = G.cellsCentroid(orients[d.orient].cells);
      d.orient = orients[d.orient][dir];
      const newC = G.cellsCentroid(orients[d.orient].cells);
      d.grab = [d.grab[0] - oldC[0] + newC[0], d.grab[1] - oldC[1] + newC[1]];
      updateDragVisual();
      return;
    }
    const id = state.selected;
    if (!id) { toast('Select a piece in the tray first (or rotate while dragging).'); return; }
    if (state.placed[id]) { toast('That piece is on the board — pick it up to rotate it.'); return; }
    const orients = SHAPES[PIECE_BY_ID[id].shape].orients;
    state.trayOrient[id] = orients[state.trayOrient[id] || 0][dir];
    renderSlot(id);
    saveGame();
  }

  // ------------------------------------------------------------------ game state
  function computeGolden(excludeId) {
    const a = state.placed.sky1, b = state.placed.sky2;
    if (!a || !b || excludeId === 'sky1' || excludeId === 'sky2') return false;
    return !!G.commonVertex(absCells('sky1', a).concat(absCells('sky2', b)));
  }
  function afterChange() {
    state.golden = computeGolden();
    refreshGoldenClasses();
    updatePiecesLeft();
    if (!state.solved && hasPuzzle() && piecesLeft() === 0) onSolved();
    else emit('progress', { left: piecesLeft() });
    updateStatus();
    updateButtons();
    saveGame();
  }
  function onSolved() {
    state.solved = true;
    stopTimer();
    els.gPieces.querySelectorAll('.piece').forEach(g => g.classList.add('locked'));
    const entry = {
      nick: GS.account ? GS.account.nick() : 'Guest',
      blocked: state.blocked.map(i => i + 1),
      roll: state.roll ? state.roll.slice() : null,
      custom: state.custom,
      time_ms: Math.round(state.elapsed),
      golden: state.golden,
      hints: state.hints,
      revealed: state.revealed,
      lobby_code: null, round: null, rank: null, player_count: null,
    };
    if (state.lobbyRound && GS.lobby) Object.assign(entry, GS.lobby.finishInfo(state.lobbyRound));
    GS.backend.games.log(entry).then(refreshRecords).catch(e => console.warn('Could not log the game', e));
    emit('solved', entry);
    confetti(state.golden);
    setTimeout(showResultModal, 450);
  }
  function showResultModal() {
    if (state.starPossible === null) state.starPossible = !!S.solve({ blocked: state.blocked, star: true });
    let html = '';
    if (state.golden) html += '<div class="golden-banner">★ GOLDEN STAR — DOUBLE WIN ★</div>';
    html += '<div class="big-time">' + fmtTime(state.elapsed) + '</div>';
    if (state.revealed) html += '<p class="muted">Solution shown — this one does not count towards your records.</p>';
    else if (state.hints) html += '<p class="muted">Solved with ' + state.hints + ' hint' + (state.hints > 1 ? 's' : '') + ' — best times only count hint-free solves.</p>';
    else html += '<p>Nice work — every triangle is filled.</p>';
    if (!state.golden) html += '<p class="muted">' + (state.starPossible ? 'The Golden Star was possible on this roll — try again for the double win!' : 'The Golden Star was not possible on this roll.') + '</p>';
    if (state.lobbyRound) {
      html += '<p class="muted">Your result is in the lobby scoreboard. Waiting for the other players… the host starts the next round.</p>';
      showModal({ title: 'Round ' + state.lobbyRound.round + (state.golden ? ' — Genius! ✨' : ' complete!'), html });
      return;
    }
    if (state.roll) html += '<p class="muted">Puzzle ' + esc(puzzleLabel()) + '</p>';
    showModal({
      title: state.golden ? 'Genius! ✨' : 'Star complete!',
      html,
      buttons: [
        { label: 'Play again (same roll)', onClick: () => restartSameRoll() },
        { label: '🎲 New roll', primary: true, onClick: () => newRoll() },
      ],
    });
  }
  function restartSameRoll() {
    if (!hasPuzzle()) return;
    const blocked = state.blocked.slice(), roll = state.roll, custom = state.custom;
    resetPuzzleState();
    state.blocked = blocked; state.roll = roll; state.custom = custom;
    renderBlockers(false); renderPieces(); renderTray();
    startTimer(); updateStatus(); updateButtons(); saveGame();
  }
  function resetPuzzleState() {
    if (state.drag) cancelDrag();
    stopTimer();
    state.placed = {}; state.selected = null; state.solved = false; state.golden = false;
    state.hints = 0; state.revealed = false; state.starPossible = null; state.elapsed = 0; state.running = false;
    state.editing = false; state.lobbyRound = null;
    els.editBar.classList.add('hidden');
    document.body.classList.remove('editing');
    els.gGhost.innerHTML = '';
    els.dragLayer.innerHTML = '';
    closeModal();
    tickTimer();
  }

  // ------------------------------------------------------------------ timer
  function startTimer() {
    state.startedAt = performance.now() - state.elapsed;
    state.running = true;
    if (!timerHandle) timerHandle = setInterval(tickTimer, 100);
    tickTimer();
  }
  function stopTimer() {
    if (state.running) { state.elapsed = performance.now() - state.startedAt; state.running = false; }
    tickTimer();
  }
  function tickTimer() {
    if (state.running) {
      state.elapsed = performance.now() - state.startedAt;
      if (performance.now() - lastSave > 5000) saveGame();
    }
    els.timer.textContent = fmtTime(state.elapsed);
  }

  // ------------------------------------------------------------------ rolls
  // opts: { animate, external (lobby-driven), lobbyRound: {code, round} }
  function newRoll(numbers, opts) {
    opts = opts || {};
    if (busy || state.drag) return Promise.resolve(false);
    if (state.lobbyMode && !opts.external) { toast('In a lobby the host starts each round.'); return Promise.resolve(false); }
    const roll = numbers ? D.normalizeRoll(numbers) : D.roll();
    if (!roll) { toast('That is not a possible roll of the seven dice.'); return Promise.resolve(false); }
    resetPuzzleState();
    state.roll = roll; state.custom = false;
    state.blocked = roll.map(n => n - 1).sort((a, b) => a - b);
    state.lobbyRound = opts.lobbyRound || null;
    els.gBlockers.innerHTML = '';
    els.board.querySelectorAll('.cell').forEach(c => c.classList.remove('blocked'));
    renderPieces(); renderTray();
    updateStatus('Rolling…');
    const finish = () => {
      renderDice(roll);
      renderBlockers(opts.animate !== false);
      startTimer();
      updateStatus(); updateButtons(); updateHash(); saveGame();
      emit('roll', { roll: roll.slice(), blocked: state.blocked.slice(), lobbyRound: state.lobbyRound });
    };
    if (opts.animate === false) { finish(); return Promise.resolve(true); }
    busy = true; updateButtons();
    return animateDice(roll).then(() => { busy = false; finish(); return true; });
  }
  function renderDice(values) {
    els.dice.innerHTML = '';
    D.DICE.forEach((die, i) => {
      const d = el('div', { class: 'die d' + die.sides },
        el('div', { class: 'face' },
          el('span', { class: 'num', text: values ? String(values[i]) : '–' }),
          el('span', { class: 'kind', text: 'd' + die.sides })));
      els.dice.appendChild(d);
    });
  }
  function animateDice(finalRoll) {
    return new Promise(resolve => {
      renderDice(finalRoll);
      const dieEls = [...els.dice.children];
      dieEls.forEach(d => d.classList.add('rolling'));
      const t0 = performance.now();
      const iv = setInterval(() => {
        dieEls.forEach((d, i) => {
          const vals = D.DICE[i].values;
          d.querySelector('.num').textContent = vals[Math.floor(Math.random() * vals.length)];
        });
        if (performance.now() - t0 > 850) {
          clearInterval(iv);
          dieEls.forEach((d, i) => { d.classList.remove('rolling'); d.querySelector('.num').textContent = finalRoll[i]; });
          resolve();
        }
      }, 70);
    });
  }
  function puzzleLabel() {
    if (state.custom) return 'custom ' + state.blocked.map(i => i + 1).join('·');
    return state.roll ? state.roll.slice().sort((a, b) => a - b).join(' · ') : '';
  }

  // ------------------------------------------------------------------ custom blockers
  function startEditing() {
    if (busy || state.drag || state.lobbyMode) return;
    resetPuzzleState();
    state.editing = true; state.custom = true; state.roll = null; state.blocked = [];
    renderDice(null); renderBlockers(false); renderPieces(); renderTray();
    els.editCount.textContent = '0/7';
    els.editBar.classList.remove('hidden');
    document.body.classList.add('editing');
    updateStatus(); updateButtons();
  }
  function onCellClick(i) {
    if (!state.editing) return;
    const k = state.blocked.indexOf(i);
    if (k >= 0) state.blocked.splice(k, 1);
    else if (state.blocked.length < 7) state.blocked.push(i);
    else toast('Seven blockers only — remove one first.');
    renderBlockers(false);
    els.editCount.textContent = state.blocked.length + '/7';
  }
  function finishEditing() {
    if (state.blocked.length !== 7) { toast('Place exactly seven blockers first.'); return; }
    state.editing = false;
    els.editBar.classList.add('hidden');
    document.body.classList.remove('editing');
    state.blocked.sort((a, b) => a - b);
    const sol = S.solveAny({ blocked: state.blocked });
    state.starPossible = sol ? sol.star : false;
    if (!sol) toast('Heads up: this blocker layout has no solution at all!', 4500);
    renderTray(); startTimer(); updateStatus(); updateButtons(); updateHash(); saveGame();
  }
  function cancelEditing() {
    state.editing = false;
    els.editBar.classList.add('hidden');
    document.body.classList.remove('editing');
    state.blocked = []; state.custom = false;
    renderBlockers(false); updateStatus(); updateButtons();
    newRoll();
  }

  // ------------------------------------------------------------------ hints & solutions
  function expandPlacements(placements) {
    const skyIds = ['sky1', 'sky2'].filter(id => !state.placed[id]);
    const out = [];
    for (const p of placements) {
      if (p.shape === 'hex') {
        const rc = p.cells.map(i => [G.cells[i].r, G.cells[i].c]);
        const v = G.commonVertex(rc);
        const ang = i => { const [x, y] = G.cellCentroid(G.cells[i].r, G.cells[i].c); return Math.atan2(y - v.y, x - v.x); };
        const sorted = p.cells.slice().sort((a, b) => ang(a) - ang(b));
        for (const group of [sorted.slice(0, 3), sorted.slice(3)]) {
          const pl = S.findPlacement('sky', group);
          out.push({ id: skyIds.shift(), orient: pl.orient, r: pl.r, c: pl.c, cells: pl.cells.slice() });
        }
      } else if (p.shape === 'sky') {
        out.push({ id: skyIds.shift(), orient: p.orient, r: p.r, c: p.c, cells: p.cells });
      } else {
        out.push({ id: p.shape, orient: p.orient, r: p.r, c: p.c, cells: p.cells });
      }
    }
    return out;
  }
  function solveFromHere() {
    const fixed = fixedList();
    const anySky = state.placed.sky1 || state.placed.sky2;
    let sol = anySky ? null : S.solve({ blocked: state.blocked, star: true, fixed });
    if (!sol) sol = S.solve({ blocked: state.blocked, star: false, fixed });
    return sol;
  }
  function hint() {
    if (!hasPuzzle() || state.solved || busy || state.drag) return;
    if (state.lobbyMode) { toast('No hints during lobby rounds — fair play!'); return; }
    const sol = solveFromHere();
    if (!sol) { toast('No solution is possible with the pieces where they are — try moving some.', 3500); return; }
    const todo = expandPlacements(sol.placements).sort((a, b) => b.cells.length - a.cells.length);
    let pick = [todo[0]];
    if (todo[0].id.startsWith('sky') && sol.star) pick = todo.filter(t => t.id.startsWith('sky'));
    for (const t of pick) {
      state.placed[t.id] = { orient: t.orient, r: t.r, c: t.c, cells: t.cells };
      state.trayOrient[t.id] = t.orient;
    }
    state.hints++;
    renderPieces(pick.map(t => t.id));
    renderTray();
    afterChange();
  }
  function showSolution() {
    if (!hasPuzzle() || state.solved || busy || state.drag) return;
    if (state.lobbyMode) { toast('Solutions are hidden during lobby rounds.'); return; }
    let sol = solveFromHere();
    if (!sol) {
      state.placed = {};
      sol = S.solveAny({ blocked: state.blocked });
    }
    if (!sol) { toast('This blocker layout has no solution.'); return; }
    state.revealed = true;
    const todo = expandPlacements(sol.placements);
    for (const t of todo) {
      state.placed[t.id] = { orient: t.orient, r: t.r, c: t.c, cells: t.cells };
      state.trayOrient[t.id] = t.orient;
    }
    renderPieces(todo.map(t => t.id));
    renderTray();
    afterChange();
  }
  function checkGoldenPossible() {
    if (!hasPuzzle()) return;
    if (state.lobbyMode) { toast('The Golden Star check is off during lobby rounds.'); return; }
    if (state.starPossible === null) state.starPossible = !!S.solve({ blocked: state.blocked, star: true });
    showModal({
      title: state.starPossible ? '★ Golden Star possible' : 'No Golden Star this time',
      html: state.starPossible
        ? '<p>This roll <b>can</b> be solved with the two light-blue halves joined into the Golden Star hexagon. Go for the double win!</p>'
        : '<p>This roll has <b>no</b> solution with the Golden Star whole — the two light-blue pieces must be placed separately.</p>'
          + '<p class="muted">Only about 58% of rolls allow the Golden Star.</p>',
    });
  }
  function clearPieces() {
    if (!hasPuzzle() || state.solved || busy || state.drag) return;
    if (!Object.keys(state.placed).length) return;
    state.placed = {};
    renderPieces(); renderTray(); afterChange();
  }

  // ------------------------------------------------------------------ status, records, storage
  function updateStatus(text) {
    const st = els.status;
    st.classList.toggle('golden', !!state.golden && !state.solved);
    if (text) { st.textContent = text; return; }
    if (state.editing) st.textContent = 'Custom puzzle — tap seven cells to place the blockers.';
    else if (!hasPuzzle()) st.textContent = state.lobbyMode ? 'Waiting for the host to start a round.' : 'Roll the dice to start.';
    else if (state.solved) st.textContent = state.golden ? '★ Golden Star! Solved in ' + fmtTime(state.elapsed) : 'Solved in ' + fmtTime(state.elapsed) + '.';
    else {
      const left = piecesLeft();
      let s = left === PIECES.length ? 'Fill every empty triangle with the eleven pieces.' : left + ' piece' + (left > 1 ? 's' : '') + ' to go.';
      if (state.golden) s = '★ Golden Star formed! ' + s;
      if (state.hints) s += ' (' + state.hints + ' hint' + (state.hints > 1 ? 's' : '') + ')';
      if (state.lobbyRound) s = 'Round ' + state.lobbyRound.round + ' · ' + s;
      st.textContent = s;
    }
    els.code.innerHTML = '';
    if (hasPuzzle()) {
      els.code.appendChild(el('span', { text: state.custom ? 'Custom puzzle' : 'Puzzle ' + puzzleLabel() }));
      if (!state.lobbyMode) {
        els.code.appendChild(el('button', { class: 'link', type: 'button', text: 'copy link', title: 'Copy a link to this exact puzzle', onclick: copyLink }));
      }
    }
  }
  function computeStats(list) {
    let solved = 0, golden = 0, bestTime = null, bestGolden = null, lobbyWins = 0;
    for (const g of list) {
      if (g.revealed) continue;
      solved++;
      if (g.golden) golden++;
      if (!g.hints) {
        if (bestTime === null || g.time_ms < bestTime) bestTime = g.time_ms;
        if (g.golden && (bestGolden === null || g.time_ms < bestGolden)) bestGolden = g.time_ms;
      }
      if (g.lobby_code && g.rank === 1 && g.player_count > 1) lobbyWins++;
    }
    return { solved, golden, bestTime, bestGolden, lobbyWins, total: list.length };
  }
  function renderRecords(st) {
    const rec = (label, value) => el('div', { class: 'rec' }, el('b', { text: value }), el('span', { text: label }));
    els.records.innerHTML = '';
    els.records.appendChild(rec('Best time', st.bestTime === null ? '–' : fmtTime(st.bestTime)));
    els.records.appendChild(rec('Best Golden Star', st.bestGolden === null ? '–' : fmtTime(st.bestGolden)));
    els.records.appendChild(rec('Solved', String(st.solved)));
    els.records.appendChild(rec('Golden Stars', String(st.golden)));
    els.records.appendChild(rec('Lobby wins', String(st.lobbyWins)));
    els.records.appendChild(rec('Games logged', String(st.total)));
  }
  function refreshRecords() {
    const seq = ++recordsSeq;
    return GS.backend.games.list({ limit: 500 })
      .then(list => { if (seq === recordsSeq) renderRecords(computeStats(list)); })
      .catch(e => { console.warn('Could not load records', e); if (seq === recordsSeq) renderRecords(computeStats([])); });
  }
  function saveGame() {
    lastSave = performance.now();
    try {
      if (!hasPuzzle() || state.lobbyMode) { localStorage.removeItem(KEY_GAME); return; }
      localStorage.setItem(KEY_GAME, JSON.stringify({
        roll: state.roll, custom: state.custom, blocked: state.blocked, placed: state.placed, trayOrient: state.trayOrient,
        elapsed: state.elapsed, solved: state.solved, hints: state.hints, revealed: state.revealed,
      }));
    } catch (_) { /* storage unavailable */ }
  }
  function restoreGame(wanted) {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY_GAME)); } catch (_) { return false; }
    if (!s || !Array.isArray(s.blocked) || s.blocked.length !== 7 || s.solved) return false;
    if (!s.blocked.every(i => Number.isInteger(i) && i >= 0 && i < 48)) return false;
    if (wanted && wanted.join(',') !== s.blocked.slice().sort((a, b) => a - b).join(',')) return false;
    resetPuzzleState();
    state.roll = s.roll; state.custom = !!s.custom; state.blocked = s.blocked.slice().sort((a, b) => a - b);
    state.placed = {}; state.trayOrient = {};
    // Validate placements against the pre-computed placement table before trusting them.
    const occ = occupancy();
    for (const id in (s.placed || {})) {
      const p = s.placed[id];
      if (!PIECE_BY_ID[id] || !p || !Array.isArray(p.cells)) continue;
      const pl = S.findPlacement(PIECE_BY_ID[id].shape, p.cells);
      if (!pl || pl.cells.some(i => occ[i])) continue;
      state.placed[id] = { orient: pl.orient, r: pl.r, c: pl.c, cells: pl.cells.slice() };
      pl.cells.forEach(i => { occ[i] = id; });
    }
    for (const id in (s.trayOrient || {})) {
      const o = s.trayOrient[id];
      if (PIECE_BY_ID[id] && Number.isInteger(o) && o >= 0 && o < SHAPES[PIECE_BY_ID[id].shape].orients.length) state.trayOrient[id] = o;
    }
    state.elapsed = Math.max(0, Number(s.elapsed) || 0); state.hints = Math.max(0, Number(s.hints) || 0); state.revealed = !!s.revealed;
    renderDice(state.roll); renderBlockers(false); renderPieces(); renderTray();
    state.golden = computeGolden(); refreshGoldenClasses();
    startTimer(); updateStatus(); updateButtons(); updateHash();
    return true;
  }

  // ------------------------------------------------------------------ links
  function updateHash() {
    if (!hasPuzzle() || state.lobbyMode) return;
    const h = state.custom ? '#custom=' + state.blocked.map(i => i + 1).join('.') : '#roll=' + state.roll.slice().sort((a, b) => a - b).join('.');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function parseHash() {
    const m = /^#(roll|custom)=([\d.]+)$/.exec(location.hash || '');
    if (!m) return null;
    const nums = m[2].split('.').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 48);
    if (new Set(nums).size !== 7 || nums.length !== 7) return null;
    return { kind: m[1], nums };
  }
  function applyHashPuzzle(h) {
    if (state.lobbyMode) return false;
    const cells = h.nums.map(n => n - 1).sort((a, b) => a - b);
    if (restoreGame(cells)) return true;
    if (h.kind === 'roll') {
      if (!D.normalizeRoll(h.nums)) { toast('The puzzle in the link is not a valid dice roll.'); return false; }
      newRoll(h.nums, { animate: false });
      return true;
    }
    resetPuzzleState();
    state.custom = true; state.roll = null; state.blocked = cells;
    renderDice(null); renderBlockers(true); renderPieces(); renderTray();
    startTimer(); updateStatus(); updateButtons(); saveGame();
    return true;
  }
  function copyLink() {
    updateHash();
    copyText(location.href, 'Link copied — send it to a friend and race on the same puzzle!');
  }
  function copyText(text, doneMsg) {
    const done = () => toast(doneMsg);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy this link:', text));
    else prompt('Copy this link:', text);
  }
  GS.ui.copyText = copyText;

  // ------------------------------------------------------------------ modals
  function showEnterRoll() {
    if (busy || state.drag || state.lobbyMode) return;
    const grid = el('div', { class: 'roll-grid' });
    D.DICE.forEach((die, i) => {
      const sel = el('select', { 'data-die': i, 'aria-label': 'Die ' + (i + 1) });
      die.values.forEach(v => sel.appendChild(el('option', { value: v, text: String(v), selected: state.roll && state.roll[i] === v })));
      grid.appendChild(el('label', {}, 'd' + die.sides, sel));
    });
    const node = el('div', {}, el('p', { text: 'Pick the number showing on each of your seven dice.' }), grid,
      el('p', { class: 'muted', text: 'Every combination the dice can produce is solvable.' }));
    showModal({
      title: 'Enter a roll',
      node,
      buttons: [{ label: 'Cancel' }, { label: 'Start puzzle', primary: true, onClick: box => {
        newRoll([...box.querySelectorAll('select')].map(s => Number(s.value)), { animate: false });
      } }],
    });
  }
  function showHelp() {
    showModal({
      title: 'How to play',
      html:
        '<p><b>Roll</b> the seven dice. A white star blocker is placed on each numbered triangle.</p>' +
        '<p><b>Fill</b> every remaining triangle with the eleven coloured pieces. Drag a piece from the tray onto the star; ' +
        'it snaps into place when it fits. Drag a piece off the board (or tap it) to return it to the tray.</p>' +
        '<ul><li><b>R</b> / ⟳ rotates, <b>Shift+R</b> / ⟲ rotates the other way, <b>F</b> / ⇅ flips a piece. The scroll wheel rotates too — even mid-drag. ' +
        'On a phone, tap a selected piece to rotate it.</li>' +
        '<li><b>H</b> gives a hint, <b>N</b> rolls a new puzzle, <b>Esc</b> drops the piece you are holding.</li></ul>' +
        '<p><b>The Golden Star:</b> the two light-blue halves join into a hexagon that shows a golden star. Finish the puzzle with the ' +
        'Golden Star whole for a <b>double win</b> — but only about 58% of rolls allow it, so it is a gamble!</p>' +
        '<p><b>Play together:</b> create a lobby, share the code, and up to five players race on identical rolls. ' +
        'The first to finish wins the round (two points with the Golden Star). Hints are off in lobbies.</p>' +
        '<p><b>Accounts:</b> sign in to keep your records and game history on your profile; guests keep them in this browser.</p>' +
        '<p class="muted">The Genius Star is a game by The Happy Puzzle Company. This is an unofficial fan-made web version.</p>',
    });
  }

  // ------------------------------------------------------------------ effects
  function confetti(golden) {
    const colors = golden ? ['#ffd54a', '#fff3b0', '#f5a623', '#ffffff', '#f8cf4a']
      : ['#e3403c', '#f9c62a', '#93d13a', '#3b63d6', '#f29ab9', '#8146b5', '#7cc8ef', '#f58b2b'];
    for (let i = 0; i < 110; i++) {
      const p = el('div', { class: 'confetti' });
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.9) + 's';
      p.style.animationDuration = (2 + Math.random() * 1.6) + 's';
      p.style.width = (6 + Math.random() * 6) + 'px';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 4500);
    }
  }

  // ------------------------------------------------------------------ lobby hooks
  function setLobbyMode(active) {
    state.lobbyMode = !!active;
    if (!active) state.lobbyRound = null;
    document.body.classList.toggle('in-lobby', state.lobbyMode);
    updateStatus(); updateButtons(); saveGame();
  }
  function startLobbyRound(info) {
    return newRoll(info.roll, { animate: true, external: true, lobbyRound: { code: info.code, round: info.round } });
  }

  // ------------------------------------------------------------------ wiring
  function requestNewRoll() {
    if (busy || state.drag) return;
    if (state.lobbyMode) { toast('In a lobby the host starts each round.'); return; }
    if (hasPuzzle() && !state.solved && Object.keys(state.placed).length) {
      showModal({ title: 'Roll again?', html: '<p>Your current puzzle will be abandoned.</p>',
        buttons: [{ label: 'Keep playing' }, { label: 'Roll the dice', primary: true, onClick: () => newRoll() }] });
    } else newRoll();
  }
  function bindButtons() {
    $('#btn-roll').addEventListener('click', requestNewRoll);
    $('#btn-enter').addEventListener('click', showEnterRoll);
    $('#btn-daily').addEventListener('click', () => newRoll(D.dailyRoll()));
    $('#btn-custom').addEventListener('click', startEditing);
    $('#btn-edit-done').addEventListener('click', finishEditing);
    $('#btn-edit-cancel').addEventListener('click', cancelEditing);
    $('#btn-cw').addEventListener('click', () => rotateActive('cw'));
    $('#btn-ccw').addEventListener('click', () => rotateActive('ccw'));
    $('#btn-flip').addEventListener('click', () => rotateActive('flip'));
    $('#btn-hint').addEventListener('click', hint);
    $('#btn-golden').addEventListener('click', checkGoldenPossible);
    $('#btn-solution').addEventListener('click', showSolution);
    $('#btn-clear').addEventListener('click', clearPieces);
    $('#btn-help').addEventListener('click', showHelp);
    document.querySelectorAll('.tabs .tab').forEach(t => t.addEventListener('click', () => showPane(t.dataset.pane)));
    window.addEventListener('wheel', e => {
      if (!state.drag) return;
      e.preventDefault();
      rotateActive(e.deltaY > 0 ? 'cw' : 'ccw');
    }, { passive: false });
    window.addEventListener('resize', () => { if (state.drag) updateDragVisual(); });
    if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', () => renderTray());
    window.addEventListener('hashchange', () => {
      const h = parseHash();
      if (h) applyHashPuzzle(h);
    });
  }
  function bindKeys() {
    window.addEventListener('keydown', e => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(tag || '')) return;
      if (modalOpen()) { if (e.key === 'Escape') closeModal(); return; }
      switch (e.key) {
        case 'r': rotateActive('cw'); break;
        case 'R': case 'e': case 'E': rotateActive('ccw'); break;
        case 'f': case 'F': rotateActive('flip'); break;
        case 'Escape': cancelDrag(); break;
        case 'h': case 'H': hint(); break;
        case 'n': case 'N': requestNewRoll(); break;
        case '?': showHelp(); break;
        default: return;
      }
      e.preventDefault();
    });
  }

  function init() {
    els.board = $('#board'); els.tray = $('#tray'); els.dice = $('#dice'); els.dragLayer = $('#drag-layer');
    els.timer = $('#timer'); els.status = $('#status'); els.code = $('#puzzle-code'); els.left = $('#pieces-left');
    els.records = $('#records'); els.editBar = $('#edit-bar'); els.editCount = $('#edit-count');
    els.toast = $('#toast'); els.modal = $('#modal-root');
    buildBoard();
    renderRecords(computeStats([]));
    renderDice(null); renderTray();
    bindButtons(); bindKeys();
    S.build();
    const h = parseHash();
    if (h && applyHashPuzzle(h)) return;
    if (!restoreGame()) newRoll();
  }

  GS.game = {
    state, on, newRoll, hint, showSolution, refreshRecords, computeStats, hasPuzzle,
    setLobbyMode, startLobbyRound, showHelp, init,
  };
  document.addEventListener('DOMContentLoaded', init);
})(window);
