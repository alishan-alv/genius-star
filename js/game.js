/* game.js — user interface for The Genius Star (web edition).
 * Drag pieces from the tray onto the star, rotate with R / flip with F, race the clock,
 * and try to complete the puzzle with the Golden Star whole.
 */
(function (root) {
  'use strict';
  const GS = root.GS;
  const G = GS.geom, D = GS.dice, S = GS.solver;
  const PIECES = GS.PIECES, SHAPES = GS.SHAPES, PIECE_BY_ID = GS.PIECE_BY_ID;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TRAY_SCALE = 0.4;
  const SNAP_DIST = G.SIDE * 0.8;
  const KEY_GAME = 'geniusStar.game.v1';
  const KEY_RECORDS = 'geniusStar.records.v1';
  const $ = s => document.querySelector(s);

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
  };
  let records = { played: 0, solved: 0, golden: 0, bestTime: null, bestGolden: null };
  const els = {};
  let uid = 0, timerHandle = null, busy = false, lastSave = 0;

  // ------------------------------------------------------------------ helpers
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function clientToSvg(svg, x, y) {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  function boardScale() { const m = els.board.getScreenCTM(); return m ? m.a : 1; }
  function fmtTime(ms) {
    const t = Math.max(0, ms);
    const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), d = Math.floor((t % 1000) / 100);
    return m + ':' + String(s).padStart(2, '0') + '.' + d;
  }
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
  function placedIds(excludeId) { return Object.keys(state.placed).filter(id => id !== excludeId); }
  function hasPuzzle() { return state.blocked.length === 7 && !state.editing; }
  function fixedList() {
    return Object.entries(state.placed).map(([id, p]) => ({ shape: PIECE_BY_ID[id].shape, cells: p.cells }));
  }

  let toastTimer = null;
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms || 2400);
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
      const g = svgEl('g', { class: 'blocker', style: animate ? 'animation-delay:' + (k * 70) + 'ms' : 'animation:none' }, els.gBlockers);
      svgEl('polygon', { points: G.pointsAttr(G.shrinkPolygon(G.cellPolygon(cell.r, cell.c), 0.86)) }, g);
      const [cx, cy] = G.cellCentroid(cell.r, cell.c);
      svgEl('polygon', { points: G.pointsAttr(G.starPoints(cx, cy, 11, 4.6, 5, -Math.PI / 2)), class: 'blocker-star' }, g);
    });
    els.board.querySelectorAll('.cell').forEach(c => c.classList.toggle('blocked', state.blocked.includes(+c.dataset.i)));
  }

  // Draw a piece (any set of absolute or normalized cells) into an SVG parent.
  function drawPiece(parent, piece, cellsRC) {
    const g = svgEl('g', { class: 'piece piece-' + piece.id }, parent);
    const d = G.outlinePath(cellsRC);
    const clipId = 'clip' + (++uid);
    const cp = svgEl('clipPath', { id: clipId }, g);
    svgEl('path', { d }, cp);
    svgEl('path', { d, class: 'piece-shadow', transform: 'translate(0,2.5)' }, g);
    svgEl('path', { d, fill: piece.color, stroke: piece.edge, class: 'piece-body' }, g);
    if (piece.star) {
      const v = G.commonVertex(cellsRC);
      if (v) {
        const sg = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' }, g);
        const R = G.SIDE * 0.84;
        svgEl('polygon', { points: G.pointsAttr(G.starPoints(v.x, v.y, R, R / Math.sqrt(3), 6, 0)), class: 'gold-star' }, sg);
      }
    }
    svgEl('path', { d, class: 'piece-gloss', 'clip-path': 'url(#' + clipId + ')' }, g);
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
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.id = piece.id;
    slot.title = piece.name;
    const orient = state.trayOrient[piece.id] || 0;
    const cellsRC = SHAPES[piece.shape].orients[orient].cells;
    const bb = G.cellsBBox(cellsRC), m = 6;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', (bb.x - m) + ' ' + (bb.y - m) + ' ' + (bb.w + 2 * m) + ' ' + (bb.h + 2 * m));
    svg.style.width = ((bb.w + 2 * m) * TRAY_SCALE) + 'px';
    svg.style.height = ((bb.h + 2 * m) * TRAY_SCALE) + 'px';
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
    const left = PIECES.length - Object.keys(state.placed).length;
    els.left.textContent = hasPuzzle() ? left + ' left' : '';
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
      // Use the release position too, in case no intermediate move events arrived.
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
    const cellsRC = absCells('sky1', a).concat(absCells('sky2', b));
    return !!G.commonVertex(cellsRC);
  }
  function afterChange() {
    state.golden = computeGolden();
    refreshGoldenClasses();
    updatePiecesLeft();
    if (!state.solved && hasPuzzle() && Object.keys(state.placed).length === PIECES.length) onSolved();
    updateStatus();
    saveGame();
  }
  function onSolved() {
    state.solved = true;
    stopTimer();
    els.gPieces.querySelectorAll('.piece').forEach(g => g.classList.add('locked'));
    if (!state.revealed) {
      records.solved++;
      if (state.golden) records.golden++;
      if (state.hints === 0) {
        if (records.bestTime === null || state.elapsed < records.bestTime) records.bestTime = state.elapsed;
        if (state.golden && (records.bestGolden === null || state.elapsed < records.bestGolden)) records.bestGolden = state.elapsed;
      }
      saveRecords();
      renderRecords();
    }
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
    if (state.roll) html += '<p class="muted">Puzzle ' + puzzleLabel() + '</p>';
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
    startTimer(); updateStatus(); saveGame();
  }
  function resetPuzzleState() {
    if (state.drag) cancelDrag();
    stopTimer();
    state.placed = {}; state.selected = null; state.solved = false; state.golden = false;
    state.hints = 0; state.revealed = false; state.starPossible = null; state.elapsed = 0; state.running = false;
    state.editing = false;
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
  function newRoll(numbers, opts) {
    opts = opts || {};
    if (busy || state.drag) return Promise.resolve();
    const roll = numbers ? D.normalizeRoll(numbers) : D.roll();
    if (!roll) { toast('That is not a possible roll of the seven dice.'); return Promise.resolve(); }
    resetPuzzleState();
    state.roll = roll; state.custom = false;
    state.blocked = roll.map(n => n - 1).sort((a, b) => a - b);
    renderBlockers(false);
    els.gBlockers.innerHTML = '';
    renderPieces(); renderTray();
    records.played++; saveRecords(); renderRecords();
    updateStatus('Rolling…');
    const finish = () => {
      renderDice(roll);
      renderBlockers(opts.animate !== false);
      startTimer();
      updateStatus();
      updateHash();
      saveGame();
    };
    if (opts.animate === false) { finish(); return Promise.resolve(); }
    busy = true;
    return animateDice(roll).then(() => { busy = false; finish(); });
  }
  function renderDice(values) {
    els.dice.innerHTML = '';
    D.DICE.forEach((die, i) => {
      const d = document.createElement('div');
      d.className = 'die d' + die.sides;
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = values ? values[i] : '–';
      const k = document.createElement('span');
      k.className = 'kind';
      k.textContent = 'd' + die.sides;
      d.appendChild(n); d.appendChild(k);
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
    if (busy || state.drag) return;
    resetPuzzleState();
    state.editing = true; state.custom = true; state.roll = null; state.blocked = [];
    renderDice(null); renderBlockers(false); renderPieces(); renderTray();
    els.editCount.textContent = '0/7';
    els.editBar.classList.remove('hidden');
    document.body.classList.add('editing');
    updateStatus();
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
    records.played++; saveRecords(); renderRecords();
    renderTray(); startTimer(); updateStatus(); updateHash(); saveGame();
  }
  function cancelEditing() {
    state.editing = false;
    els.editBar.classList.add('hidden');
    document.body.classList.remove('editing');
    state.blocked = []; state.custom = false;
    renderBlockers(false); updateStatus();
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
    else if (!hasPuzzle()) st.textContent = 'Roll the dice to start.';
    else if (state.solved) st.textContent = state.golden ? '★ Golden Star! Solved in ' + fmtTime(state.elapsed) : 'Solved in ' + fmtTime(state.elapsed) + '.';
    else {
      const left = PIECES.length - Object.keys(state.placed).length;
      let s = left === PIECES.length ? 'Fill every empty triangle with the eleven pieces.' : left + ' piece' + (left > 1 ? 's' : '') + ' to go.';
      if (state.golden) s = '★ Golden Star formed! ' + s;
      if (state.hints) s += ' (' + state.hints + ' hint' + (state.hints > 1 ? 's' : '') + ')';
      st.textContent = s;
    }
    els.code.innerHTML = '';
    if (hasPuzzle()) {
      const span = document.createElement('span');
      span.textContent = (state.custom ? 'Custom puzzle' : 'Puzzle ' + puzzleLabel());
      els.code.appendChild(span);
      const btn = document.createElement('button');
      btn.className = 'link';
      btn.textContent = 'copy link';
      btn.title = 'Copy a link to this exact puzzle';
      btn.addEventListener('click', copyLink);
      els.code.appendChild(btn);
    }
  }
  function renderRecords() {
    const r = records;
    const rec = (label, value) => '<div class="rec"><b>' + value + '</b><span>' + label + '</span></div>';
    els.records.innerHTML =
      rec('Best time', r.bestTime === null ? '–' : fmtTime(r.bestTime)) +
      rec('Best Golden Star', r.bestGolden === null ? '–' : fmtTime(r.bestGolden)) +
      rec('Solved', r.solved + ' / ' + r.played) +
      rec('Golden Stars', r.golden);
  }
  function loadRecords() {
    try { const s = JSON.parse(localStorage.getItem(KEY_RECORDS)); if (s) records = Object.assign(records, s); } catch (_) { /* ignore */ }
  }
  function saveRecords() { try { localStorage.setItem(KEY_RECORDS, JSON.stringify(records)); } catch (_) { /* ignore */ } }
  function resetRecords() {
    showModal({
      title: 'Reset records?',
      html: '<p>This clears your best times and counters on this device.</p>',
      buttons: [{ label: 'Cancel' }, { label: 'Reset', primary: true, onClick: () => { records = { played: 0, solved: 0, golden: 0, bestTime: null, bestGolden: null }; saveRecords(); renderRecords(); } }],
    });
  }
  function saveGame() {
    lastSave = performance.now();
    try {
      if (!hasPuzzle()) { localStorage.removeItem(KEY_GAME); return; }
      localStorage.setItem(KEY_GAME, JSON.stringify({
        roll: state.roll, custom: state.custom, blocked: state.blocked, placed: state.placed, trayOrient: state.trayOrient,
        elapsed: state.elapsed, solved: state.solved, hints: state.hints, revealed: state.revealed,
      }));
    } catch (_) { /* ignore */ }
  }
  function restoreGame(wanted) {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY_GAME)); } catch (_) { return false; }
    if (!s || !Array.isArray(s.blocked) || s.blocked.length !== 7 || s.solved) return false;
    if (wanted && wanted.join(',') !== s.blocked.slice().sort((a, b) => a - b).join(',')) return false;
    resetPuzzleState();
    state.roll = s.roll; state.custom = !!s.custom; state.blocked = s.blocked.slice().sort((a, b) => a - b);
    state.placed = s.placed || {}; state.trayOrient = s.trayOrient || {};
    state.elapsed = s.elapsed || 0; state.hints = s.hints || 0; state.revealed = !!s.revealed;
    renderDice(state.roll); renderBlockers(false); renderPieces(); renderTray();
    state.golden = computeGolden(); refreshGoldenClasses();
    startTimer(); updateStatus(); updateHash();
    return true;
  }

  // ------------------------------------------------------------------ links
  function updateHash() {
    if (!hasPuzzle()) return;
    const h = state.custom ? '#custom=' + state.blocked.map(i => i + 1).join('.') : '#roll=' + state.roll.slice().sort((a, b) => a - b).join('.');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function parseHash() {
    const m = /^#(roll|custom)=([\d.]+)$/.exec(location.hash || '');
    if (!m) return null;
    const nums = m[2].split('.').map(Number).filter(n => n >= 1 && n <= 48);
    if (new Set(nums).size !== 7) return null;
    return { kind: m[1], nums };
  }
  function applyHashPuzzle(h) {
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
    records.played++; saveRecords(); renderRecords();
    startTimer(); updateStatus(); saveGame();
    return true;
  }
  function copyLink() {
    updateHash();
    const url = location.href;
    const done = () => toast('Link copied — send it to a friend and race on the same puzzle!');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
    else prompt('Copy this link:', url);
  }

  // ------------------------------------------------------------------ modals
  function showModal(opts) {
    els.modal.innerHTML = '';
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = '<h2>' + opts.title + '</h2><div class="modal-body">' + opts.html + '</div>';
    const row = document.createElement('div');
    row.className = 'btn-row modal-buttons';
    (opts.buttons || [{ label: 'Close' }]).forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.addEventListener('click', () => { closeModal(); if (b.onClick) b.onClick(box); });
      row.appendChild(btn);
    });
    box.appendChild(row);
    back.appendChild(box);
    back.addEventListener('click', e => { if (e.target === back) closeModal(); });
    els.modal.appendChild(back);
    els.modal.classList.remove('hidden');
    const first = box.querySelector('select, button.primary, button');
    if (first) first.focus();
  }
  function closeModal() { els.modal.classList.add('hidden'); els.modal.innerHTML = ''; }
  function modalOpen() { return !els.modal.classList.contains('hidden'); }

  function showEnterRoll() {
    if (busy || state.drag) return;
    let html = '<p>Pick the number showing on each of your seven dice.</p><div class="roll-grid">';
    D.DICE.forEach((die, i) => {
      html += '<label>d' + die.sides + '<select data-die="' + i + '">' +
        die.values.map(v => '<option value="' + v + '"' + (state.roll && state.roll[i] === v ? ' selected' : '') + '>' + v + '</option>').join('') +
        '</select></label>';
    });
    html += '</div><p class="muted">Every combination the dice can produce is solvable.</p>';
    showModal({
      title: 'Enter a roll',
      html,
      buttons: [{ label: 'Cancel' }, { label: 'Start puzzle', primary: true, onClick: box => {
        const nums = [...box.querySelectorAll('select')].map(s => Number(s.value));
        newRoll(nums, { animate: false });
      } }],
    });
  }
  function showHelp() {
    showModal({
      title: 'How to play',
      html:
        '<p><b>Roll</b> the seven dice. A white star blocker is placed on each numbered triangle.</p>' +
        '<p><b>Fill</b> every remaining triangle with the eleven coloured pieces. Drag a piece from the tray onto the star; ' +
        'it snaps into place when it fits. Drag a piece off the board (or click it) to return it to the tray.</p>' +
        '<ul><li><b>R</b> / ⟳ rotates, <b>Shift+R</b> / ⟲ rotates the other way, <b>F</b> / ⇅ flips a piece. The scroll wheel rotates too — even mid-drag.</li>' +
        '<li><b>H</b> gives a hint, <b>N</b> rolls a new puzzle, <b>Esc</b> drops the piece you are holding.</li></ul>' +
        '<p><b>The Golden Star:</b> the two light-blue halves join into a hexagon that shows a golden star. Finish the puzzle with the ' +
        'Golden Star whole for a <b>double win</b> — but only about 58% of rolls allow it, so it is a gamble!</p>' +
        '<p><b>Race a friend:</b> use <i>copy link</i> to share the exact puzzle, or play the <i>Daily star</i>. Every roll the dice can produce has a solution.</p>' +
        '<p class="muted">The Genius Star is a game by The Happy Puzzle Company. This is an unofficial fan-made web version.</p>',
    });
  }

  // ------------------------------------------------------------------ effects
  function confetti(golden) {
    const colors = golden ? ['#ffd54a', '#fff3b0', '#f5a623', '#ffffff', '#f8cf4a']
      : ['#e3403c', '#f9c62a', '#93d13a', '#3b63d6', '#f29ab9', '#8146b5', '#7cc8ef', '#f58b2b'];
    for (let i = 0; i < 110; i++) {
      const p = document.createElement('div');
      p.className = 'confetti';
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.9) + 's';
      p.style.animationDuration = (2 + Math.random() * 1.6) + 's';
      p.style.width = (6 + Math.random() * 6) + 'px';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 4500);
    }
  }

  // ------------------------------------------------------------------ wiring
  function requestNewRoll() {
    if (busy || state.drag) return;
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
    $('#btn-reset-records').addEventListener('click', resetRecords);
    window.addEventListener('wheel', e => {
      if (!state.drag) return;
      e.preventDefault();
      rotateActive(e.deltaY > 0 ? 'cw' : 'ccw');
    }, { passive: false });
    window.addEventListener('resize', () => { if (state.drag) updateDragVisual(); });
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
    loadRecords(); renderRecords();
    renderDice(null); renderTray();
    bindButtons(); bindKeys();
    S.build();
    const h = parseHash();
    if (h && applyHashPuzzle(h)) return;
    if (!restoreGame()) newRoll();
  }

  GS.game = { state, newRoll, hint, showSolution, init };
  document.addEventListener('DOMContentLoaded', init);
})(window);
