/**
 * main.js — ゲーム進行の統括とUIバインド
 *
 * 棋譜は history に全て保持し、cursor が「盤に反映されている手数」を指す。
 * cursor < history.length の間は「巻き戻し中(レビュー)」で、AIは動かず勝敗も確定しない。
 *
 * 着手は「押す → 動かして狙いを決める → 離す」のドラッグ操作に統一している。
 * 指で盤が隠れても十字線で位置が分かり、盤の外へ動かして離せば取り消せる。
 */
(function (global) {
  'use strict';

  var B = global.CG.Board;
  var AI = global.CG.AI;
  var Rules = global.CG.Rules;
  var Puzzle = global.CG.Puzzle;
  var Sfx = global.CG.Sfx;
  var Store = global.CG.Store;

  var $ = function (id) { return global.document.getElementById(id); };

  var el = {};
  var renderer = null;
  var data = Store.load();

  var state = {
    board: B.create(),
    history: [],
    cursor: 0,
    mode: 'ai',              // 'ai' | 'pvp' | 'puzzle'
    level: 'normal',
    first: 'human',
    ruleset: 'free',
    rules: null,
    humanPlayer: B.P1,
    over: false,
    winner: 0,
    winLine: null,
    thinking: false,
    busy: false,
    recorded: false,
    pending: null,           // ドラッグ中の狙い {x, y}
    dragging: false,
    mate: null,
    mateStep: 0,
    puzzle: null,            // {board, attacker, solution, plies}
    puzzleState: 'idle',     // 'idle' | 'solving' | 'solved' | 'failed'
    gen: 0
  };

  var LEVEL_LABEL = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };
  var IDS = [
    'board', 'overlay', 'overlay-kicker', 'overlay-title', 'overlay-sub',
    'btn-rematch', 'btn-close-overlay', 'status-dot', 'status-text',
    'ai-options', 'rule-field', 'rule-note', 'ruleset', 'puzzle-options', 'puzzle-level',
    'level', 'first', 'p1', 'p2', 'p1-name', 'p2-name', 'p1-tag', 'p2-tag',
    's1-label', 's2-label', 's3-label', 's1', 's2', 's3', 'streak', 'best-streak',
    'btn-new', 'btn-latest', 'btn-sound', 'btn-reset-score',
    'move-count', 'log', 'review-badge',
    'btn-back', 'btn-forward', 'btn-hint', 'btn-mate', 'btn-restart', 'btn-restart-label',
    'advice', 'advice-kind', 'advice-text', 'advice-close',
    'mate-nav', 'mate-prev', 'mate-next', 'mate-pos', 'mate-list'
  ];

  /* ================= 初期化 ================= */
  function init() {
    IDS.forEach(function (id) { el[id] = $(id); });

    state.mode = ['ai', 'pvp', 'puzzle'].indexOf(data.settings.mode) >= 0 ? data.settings.mode : 'ai';
    state.level = LEVEL_LABEL[data.settings.level] ? data.settings.level : 'normal';
    state.first = data.settings.first === 'ai' ? 'ai' : 'human';
    state.ruleset = Rules.PRESETS[data.settings.ruleset] ? data.settings.ruleset : 'free';

    el.level.value = state.level;
    el.first.value = state.first;
    el.ruleset.value = state.ruleset;
    el['puzzle-level'].value = Puzzle.LEVELS[data.settings.puzzleLevel] ? data.settings.puzzleLevel : 'normal';
    Sfx.setEnabled(data.settings.sound !== false);
    syncModeButtons();
    syncSoundButton();
    syncRuleNote();

    renderer = new global.CG.Renderer(el.board);
    renderer.setBoard(state.board);
    renderer.start();

    bindEvents();
    newGame(false);
  }

  function bindEvents() {
    el.board.addEventListener('pointerdown', onPointerDown);
    el.board.addEventListener('pointermove', onPointerMove);
    el.board.addEventListener('pointerup', onPointerUp);
    el.board.addEventListener('pointercancel', onPointerCancel);
    el.board.addEventListener('pointerleave', function () {
      if (!state.dragging) renderer.setHover(null);
    });
    el.board.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    Array.prototype.forEach.call(global.document.querySelectorAll('.seg-btn'), function (btn) {
      btn.addEventListener('click', function () {
        if (state.mode === btn.dataset.mode) return;
        state.mode = btn.dataset.mode;
        Sfx.ui();
        syncModeButtons();
        persistSettings();
        newGame(false);
      });
    });

    el.level.addEventListener('change', function () {
      state.level = el.level.value; Sfx.ui(); persistSettings(); newGame(false);
    });
    el.first.addEventListener('change', function () {
      state.first = el.first.value; Sfx.ui(); persistSettings(); newGame(false);
    });
    el.ruleset.addEventListener('change', function () {
      state.ruleset = el.ruleset.value; Sfx.ui(); syncRuleNote(); persistSettings(); newGame(false);
    });
    el['puzzle-level'].addEventListener('change', function () {
      Sfx.ui(); persistSettings(); newGame(false);
    });

    el['btn-new'].addEventListener('click', function () { Sfx.ui(); newGame(true); });
    el['btn-restart'].addEventListener('click', function () { Sfx.ui(); newGame(true); });
    el['btn-rematch'].addEventListener('click', function () { Sfx.ui(); newGame(true); });
    el['btn-close-overlay'].addEventListener('click', function () { Sfx.ui(); hideOverlay(); updateUI(); });
    el['btn-sound'].addEventListener('click', toggleSound);
    el['btn-reset-score'].addEventListener('click', resetScore);

    el['btn-back'].addEventListener('click', function () { step(-1); });
    el['btn-forward'].addEventListener('click', function () { step(1); });
    el['btn-latest'].addEventListener('click', toLatest);
    el['btn-hint'].addEventListener('click', doHint);
    el['btn-mate'].addEventListener('click', doMate);
    el['advice-close'].addEventListener('click', function () { Sfx.ui(); clearAdvice(); });
    el['mate-prev'].addEventListener('click', function () { stepMate(-1); });
    el['mate-next'].addEventListener('click', function () { stepMate(1); });

    global.document.addEventListener('keydown', onKeyDown);
  }

  /* ================= 局面の導出 ================= */
  function atTip() { return state.cursor === state.history.length; }

  function currentPlayer() {
    var last = state.history[state.cursor - 1];
    if (last) return B.opponent(last.player);
    if (state.mode === 'puzzle' && state.puzzle) return state.puzzle.attacker;
    return B.P1;
  }

  function isAiSide(player) {
    if (state.mode === 'ai') return player !== state.humanPlayer;
    return false;                       // 詰め五目の受けは place() の中で自動的に返す
  }

  function canHumanPlay() {
    if (state.over || state.thinking || state.busy) return false;
    if (state.mode === 'puzzle' && state.puzzleState !== 'solving') return false;
    return !isAiSide(currentPlayer());
  }

  function aiShouldMove() {
    return atTip() && !state.over && state.mode === 'ai' && isAiSide(currentPlayer());
  }

  /** その局面の勝ち筋（長連禁止なら6連以上は勝ちにしない） */
  function winLineAt(board, x, y) {
    return Rules.winLine(board, x, y, state.rules);
  }

  /** history[0..cursor) から盤面と勝敗を作り直す */
  function rebuild() {
    state.board = (state.mode === 'puzzle' && state.puzzle)
      ? Int8Array.from(state.puzzle.board)
      : B.create();
    state.winLine = null;
    state.over = false;
    state.winner = 0;

    for (var i = 0; i < state.cursor; i++) {
      var m = state.history[i];
      state.board[B.idx(m.x, m.y)] = m.player;
    }
    var last = state.history[state.cursor - 1];
    if (last) {
      var line = winLineAt(state.board, last.x, last.y);
      if (line) { state.over = true; state.winner = last.player; state.winLine = line; }
    }
    if (!state.over && state.cursor > 0 && B.isFull(state.board)) {
      state.over = true; state.winner = 0;
    }
    renderer.setBoard(state.board);
    refreshForbidden();
  }

  /** 現在の手番で打てない点を盤に反映する */
  function refreshForbidden() {
    if (!renderer) return;
    if (state.over || !state.rules || state.rules.scope === 'none') {
      renderer.setForbidden(null);
      return;
    }
    renderer.setForbidden(Rules.forbiddenPoints(state.board, currentPlayer(), state.rules));
  }

  /* ================= ゲーム進行 ================= */
  function newGame(withSound) {
    state.gen++;
    state.history = [];
    state.cursor = 0;
    state.thinking = false;
    state.busy = false;
    state.recorded = false;
    state.pending = null;
    state.dragging = false;
    state.humanPlayer = (state.mode === 'ai' && state.first === 'ai') ? B.P2 : B.P1;

    // 詰め五目は禁じ手なしで出題する（解答が禁じ手で崩れないようにする）
    state.rules = Rules.get(state.mode === 'puzzle' ? 'free' : state.ruleset);
    AI.setRules(state.rules.scope === 'none' ? null : state.rules);

    renderer.clearEffects();
    clearAdvice();
    hideOverlay();
    if (withSound) Sfx.ui();

    if (state.mode === 'puzzle') {
      state.puzzle = null;
      state.puzzleState = 'idle';
      rebuild();
      renderLog();
      updateUI();
      loadPuzzle();
      return;
    }

    state.puzzle = null;
    state.puzzleState = 'idle';
    rebuild();
    renderLog();
    updateUI();
    if (aiShouldMove()) scheduleAi();
  }

  /** 人間の着手要求 */
  function attemptPlace(x, y) {
    if (state.over) {
      Sfx.error();
      flash('この対局は終了しています。「新規」で次の対局を始められます。');
      return;
    }
    if (state.thinking || state.busy) { Sfx.error(); return; }
    if (state.mode === 'puzzle' && state.puzzleState !== 'solving') { Sfx.error(); return; }
    if (isAiSide(currentPlayer())) {
      Sfx.error();
      flash('いまはCPUの手番です。「戻る」でもう一手戻すとあなたの手番になります。');
      return;
    }
    if (!B.inBounds(x, y) || state.board[B.idx(x, y)] !== B.EMPTY) { Sfx.error(); return; }

    var reason = Rules.forbiddenReason(state.board, x, y, currentPlayer(), state.rules);
    if (reason) {
      Sfx.error();
      flash(B.toCoord(x, y) + ' は禁じ手（' + reason + '）です。別の場所に打ってください。');
      return;
    }
    place(x, y, currentPlayer());
  }

  function place(x, y, player) {
    if (!atTip()) state.history.length = state.cursor;

    state.history.push({ x: x, y: y, player: player });
    state.cursor++;
    state.board[B.idx(x, y)] = player;

    state.pending = null;
    renderer.setPending(null);
    renderer.setHover(null);
    renderer.markPlaced(x, y, player);
    clearAdvice();
    Sfx.place(player);

    var line = winLineAt(state.board, x, y);
    if (line) { finish(player, line); return; }
    if (B.isFull(state.board)) { finish(0, null); return; }

    if (state.mode === 'puzzle') { handlePuzzleReply(x, y); return; }

    refreshForbidden();
    renderLog();
    updateUI();
    if (aiShouldMove()) scheduleAi();
  }

  function scheduleAi() {
    var gen = state.gen;
    state.thinking = true;
    updateUI();
    global.requestAnimationFrame(function () {
      global.setTimeout(function () {
        if (gen !== state.gen) return;
        if (!state.thinking || state.over) { state.thinking = false; return; }
        var player = currentPlayer();
        var move;
        try {
          move = AI.chooseMove(state.board, player, state.level);
        } catch (err) {
          move = fallbackMove(player);
        }
        if (!move || state.board[B.idx(move.x, move.y)] !== B.EMPTY) move = fallbackMove(player);
        state.thinking = false;
        if (gen !== state.gen || state.over || !move) { updateUI(); return; }
        place(move.x, move.y, player);
      }, 240);
    });
  }

  /** AIが手を返せなかった場合の保険（禁じ手も避ける） */
  function fallbackMove(player) {
    var c = (B.SIZE - 1) / 2, best = null, bestD = Infinity;
    for (var y = 0; y < B.SIZE; y++) {
      for (var x = 0; x < B.SIZE; x++) {
        if (state.board[B.idx(x, y)] !== B.EMPTY) continue;
        if (Rules.forbiddenReason(state.board, x, y, player, state.rules)) continue;
        var d = Math.abs(x - c) + Math.abs(y - c);
        if (d < bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  }

  function finish(winner, line) {
    state.over = true;
    state.winner = winner;
    state.winLine = line;
    state.thinking = false;
    state.pending = null;
    state.dragging = false;
    renderer.setPending(null);
    renderer.setHover(null);
    renderer.setForbidden(null);
    if (line) renderer.setWinLine(line);

    if (state.mode === 'puzzle') {
      state.puzzleState = 'solved';
      if (!state.recorded) { recordPuzzle(true); state.recorded = true; }
    } else if (!state.recorded) {
      recordResult(winner); state.recorded = true;
    }

    renderLog();
    updateUI();

    if (winner === 0) Sfx.draw();
    else if (state.mode === 'pvp') Sfx.win();
    else if (state.mode === 'puzzle') Sfx.win();
    else if (winner === state.humanPlayer) Sfx.win();
    else Sfx.lose();

    var gen = state.gen;
    global.setTimeout(function () {
      if (gen === state.gen && state.over && atTip()) showOverlay(winner);
    }, line ? 900 : 300);
  }

  /* ================= 詰め五目 ================= */
  function loadPuzzle() {
    var gen = state.gen;
    var level = el['puzzle-level'].value;
    state.busy = true;
    el['btn-restart'].classList.add('is-busy');
    flash('問題を生成しています…');
    updateUI();

    global.requestAnimationFrame(function () {
      global.setTimeout(function () {
        var puzzle = null;
        try {
          puzzle = Puzzle.generate({ level: level, budget: 4000 });
        } catch (err) { puzzle = null; }

        state.busy = false;
        el['btn-restart'].classList.remove('is-busy');
        if (gen !== state.gen) return;

        if (!puzzle) {
          state.puzzleState = 'idle';
          updateUI();
          flash('問題を作れませんでした。「新規」でもう一度お試しください。');
          return;
        }
        state.puzzle = puzzle;
        state.puzzleState = 'solving';
        state.history = [];
        state.cursor = 0;
        state.recorded = false;
        rebuild();
        renderLog();
        updateUI();
        Sfx.ui();
      }, 30);
    });
  }

  /** 詰め五目で攻め手が打った後、受けを自動で返す */
  function handlePuzzleReply(x, y) {
    var attacker = state.puzzle.attacker;
    var result;
    try {
      result = Puzzle.respond(state.board, attacker, x, y);
    } catch (err) {
      result = { status: 'miss' };
    }

    if (result.status === 'win') {
      // 受け無し。最後の五を自動で打ち、盤上に勝ち筋を見せてから終局する。
      var winGen = state.gen;
      renderLog();
      updateUI();
      flash('受け無し！ このまま五が作れます。');
      if (result.finish) {
        global.setTimeout(function () {
          if (winGen === state.gen && !state.over) place(result.finish.x, result.finish.y, attacker);
        }, 420);
      }
      return;
    }

    if (result.status === 'miss') {
      state.puzzleState = 'failed';
      if (!state.recorded) { recordPuzzle(false); state.recorded = true; }
      renderLog();
      updateUI();
      Sfx.lose();
      showAdvice('MISS', 'その手では詰みません。「戻る」で打ち直すか、'
        + '「詰み筋」で正解の手順を確認できます。');
      return;
    }

    // 受けは一意なので自動で打つ
    var defender = B.opponent(attacker);
    var gen = state.gen;
    global.setTimeout(function () {
      if (gen !== state.gen) return;
      state.history.push({ x: result.reply.x, y: result.reply.y, player: defender });
      state.cursor++;
      state.board[B.idx(result.reply.x, result.reply.y)] = defender;
      renderer.markPlaced(result.reply.x, result.reply.y, defender);
      Sfx.place(defender);
      renderLog();
      updateUI();
    }, 260);

    renderLog();
    updateUI();
  }

  function recordPuzzle(solved) {
    var s = data.stats.puzzle;
    if (!s) return;
    if (solved) {
      s.win++;
      data.streak++;
      if (data.streak > data.bestStreak) data.bestStreak = data.streak;
    } else {
      s.lose++;
      data.streak = 0;
    }
    Store.save(data);
  }

  /* ================= 巻き戻し / 早送り ================= */
  function step(delta) {
    var next = Math.max(0, Math.min(state.history.length, state.cursor + delta));
    if (next === state.cursor) { Sfx.error(); return; }

    state.gen++;
    state.thinking = false;
    state.cursor = next;
    state.pending = null;
    state.dragging = false;

    if (state.mode === 'puzzle' && state.puzzleState !== 'idle') {
      // 失敗からやり直せるようにする。成績はその問題で最初に確定した結果のみを数える
      // （やり直しで正解数を水増しできないようにするため recorded は戻さない）。
      state.puzzleState = 'solving';
    }

    renderer.clearEffects();
    rebuild();
    var last = state.history[state.cursor - 1];
    if (last) renderer.lastMove = { x: last.x, y: last.y, player: last.player };
    if (state.winLine) renderer.setWinLine(state.winLine);

    hideOverlay();
    clearAdvice();
    renderLog();
    Sfx.undo();
    updateUI();
  }

  function toLatest() {
    if (atTip()) { Sfx.error(); return; }
    state.gen++;
    state.cursor = state.history.length;
    state.pending = null;
    renderer.clearEffects();
    rebuild();
    var last = state.history[state.cursor - 1];
    if (last) renderer.lastMove = { x: last.x, y: last.y, player: last.player };
    if (state.winLine) renderer.setWinLine(state.winLine);
    hideOverlay();
    clearAdvice();
    renderLog();
    Sfx.ui();
    updateUI();
    if (aiShouldMove()) scheduleAi();
  }

  /* ================= ヒント ================= */
  function doHint() {
    if (state.over || state.thinking || state.busy) { Sfx.error(); return; }
    Sfx.ui();
    runAsync(el['btn-hint'], function () {
      var player = currentPlayer();
      var s = AI.suggest(state.board, player);
      if (!s) { showAdvice('HINT', '打てる場所がありません。'); return; }
      renderer.setHint({ x: s.x, y: s.y });
      showAdvice('HINT', '<b>' + B.toCoord(s.x, s.y) + '</b> がおすすめです — ' + s.label);
    });
  }

  /* ================= 詰み筋（四追い / VCF） ================= */
  function doMate() {
    if (state.thinking || state.busy) { Sfx.error(); return; }
    if (state.over && state.mode !== 'puzzle') { Sfx.error(); return; }
    Sfx.ui();
    runAsync(el['btn-mate'], function () {
      var player = state.mode === 'puzzle' && state.puzzle ? state.puzzle.attacker : currentPlayer();
      var found = AI.findMate(state.board, player, { maxAttacks: 10, budget: 3500 });
      if (!found) {
        renderer.setMate(null);
        state.mate = null;
        showAdvice('MATE', '現時点では、四を打ち続けて詰ませる手順（四追い）は見つかりませんでした。'
          + 'まず三を作って狙いを増やしてみてください。');
        return;
      }
      state.mate = found.moves;
      state.mateStep = 0;
      renderer.setMate(state.mate, 0);
      var attacks = state.mate.filter(function (m) { return !m.forced; }).length;
      showAdvice('MATE',
        '<b>' + state.mate.length + '手</b>で詰みます（うち自分の着手は ' + attacks + '手）。'
        + '盤上の番号が手順です。相手の手は受けが1つしかない強制手を表します。');
      renderMateList();
    });
  }

  function stepMate(delta) {
    if (!state.mate) return;
    var next = Math.max(0, Math.min(state.mate.length - 1, state.mateStep + delta));
    if (next === state.mateStep) { Sfx.error(); return; }
    state.mateStep = next;
    renderer.setMate(state.mate, state.mateStep);
    Sfx.ui();
    renderMateList();
  }

  function renderMateList() {
    if (!state.mate) { el['mate-nav'].hidden = true; return; }
    el['mate-nav'].hidden = false;
    el['mate-pos'].textContent = (state.mateStep + 1) + ' / ' + state.mate.length;
    el['mate-prev'].disabled = state.mateStep === 0;
    el['mate-next'].disabled = state.mateStep === state.mate.length - 1;

    var html = '';
    for (var i = 0; i < state.mate.length; i++) {
      var m = state.mate[i];
      var cls = (m.forced ? 'def' : 'atk') + (i === state.mateStep ? ' is-current' : '');
      html += '<li class="' + cls + '">' + (i + 1) + '. ' + B.toCoord(m.x, m.y)
            + ' ' + (m.forced ? '相手(受け)' : '自分') + '</li>';
    }
    el['mate-list'].innerHTML = html;
  }

  function runAsync(button, fn) {
    state.busy = true;
    if (button) button.classList.add('is-busy');
    updateUI();
    var gen = state.gen;
    global.requestAnimationFrame(function () {
      global.setTimeout(function () {
        try {
          if (gen === state.gen) fn();
        } finally {
          state.busy = false;
          if (button) button.classList.remove('is-busy');
          updateUI();
        }
      }, 30);
    });
  }

  function showAdvice(kind, html) {
    el['advice-kind'].textContent = kind;
    el['advice-text'].innerHTML = html;
    el.advice.hidden = false;
    if (kind !== 'MATE') el['mate-nav'].hidden = true;
    if (el.advice.scrollIntoView) {
      try { el.advice.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* 無視 */ }
    }
  }

  function clearAdvice() {
    el.advice.hidden = true;
    el['mate-nav'].hidden = true;
    state.mate = null;
    state.mateStep = 0;
    if (renderer) { renderer.setHint(null); renderer.setMate(null); }
  }

  var flashTimer = null;
  function flash(text) {
    el['status-text'].textContent = text;
    if (flashTimer) global.clearTimeout(flashTimer);
    flashTimer = global.setTimeout(function () { flashTimer = null; updateUI(); }, 2800);
  }

  /* ================= 入力（押す → 動かす → 離す） ================= */

  /** 指では大きめの許容範囲を取る（マス幅とほぼ同じ） */
  function hitTolerance(ev) {
    return (ev.pointerType === 'touch' || ev.pointerType === 'pen') ? 1.0 : 0.75;
  }

  function onPointerDown(ev) {
    if (!canHumanPlay()) return;
    var cell = renderer.cellAt(ev.clientX, ev.clientY, hitTolerance(ev));
    if (!cell) return;

    ev.preventDefault();
    state.dragging = true;
    state.pending = cell;
    renderer.setPending(cell, currentPlayer());
    renderer.setHover(null);
    // 盤の外に指が出ても追跡できるようにする
    if (el.board.setPointerCapture) {
      try { el.board.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
    }
    updateUI();
  }

  function onPointerMove(ev) {
    if (state.dragging) {
      ev.preventDefault();
      var cell = renderer.cellAt(ev.clientX, ev.clientY, hitTolerance(ev));
      state.pending = cell;                       // 盤の外に出たら null になり、離しても打たれない
      renderer.setPending(cell, currentPlayer());
      updateUI();
      return;
    }
    if (!canHumanPlay()) { renderer.setHover(null); return; }
    if (ev.pointerType === 'mouse') {
      renderer.setHover(renderer.cellAt(ev.clientX, ev.clientY, 0.62), currentPlayer());
    }
  }

  function onPointerUp(ev) {
    if (!state.dragging) return;
    state.dragging = false;
    if (el.board.releasePointerCapture) {
      try { el.board.releasePointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
    }

    var target = state.pending;
    state.pending = null;
    renderer.setPending(null);

    if (!target) {                                 // 盤の外で離した = 取り消し
      Sfx.undo();
      flash('着手を取り消しました。');
      return;
    }
    attemptPlace(target.x, target.y);
  }

  function onPointerCancel() {
    state.dragging = false;
    state.pending = null;
    renderer.setPending(null);
    updateUI();
  }

  /* ================= 戦績 ================= */
  function statKey() {
    if (state.mode === 'pvp') return 'pvp';
    if (state.mode === 'puzzle') return 'puzzle';
    return state.level;
  }

  function recordResult(winner) {
    var s = data.stats[statKey()];
    if (!s) return;
    if (winner === 0) {
      s.draw++;
      if (state.mode === 'ai') data.streak = 0;
    } else if (state.mode === 'pvp') {
      if (winner === B.P1) s.win++; else s.lose++;
    } else if (winner === state.humanPlayer) {
      s.win++;
      data.streak++;
      if (data.streak > data.bestStreak) data.bestStreak = data.streak;
    } else {
      s.lose++;
      data.streak = 0;
    }
    Store.save(data);
  }

  function resetScore() {
    Sfx.ui();
    data = Store.reset();
    persistSettings();
    updateUI();
  }

  function persistSettings() {
    data.settings.mode = state.mode;
    data.settings.level = state.level;
    data.settings.first = state.first;
    data.settings.ruleset = state.ruleset;
    data.settings.puzzleLevel = el['puzzle-level'].value;
    data.settings.sound = Sfx.enabled;
    Store.save(data);
  }

  /* ================= UI ================= */
  function syncModeButtons() {
    Array.prototype.forEach.call(global.document.querySelectorAll('.seg-btn'), function (btn) {
      btn.classList.toggle('is-active', btn.dataset.mode === state.mode);
    });
    el['ai-options'].hidden = state.mode !== 'ai';
    el['rule-field'].hidden = state.mode === 'puzzle';
    el['puzzle-options'].hidden = state.mode !== 'puzzle';
    el['btn-restart-label'].textContent = state.mode === 'puzzle' ? '次の問題' : '新規';
  }

  function syncRuleNote() {
    el['rule-note'].textContent = Rules.get(state.ruleset).note;
  }

  function syncSoundButton() {
    var on = Sfx.enabled;
    el['btn-sound'].innerHTML = (on ? '♪ SOUND ON' : '✕ SOUND OFF') + ' <kbd>M</kbd>';
    el['btn-sound'].setAttribute('aria-pressed', String(on));
  }

  function toggleSound() {
    Sfx.setEnabled(!Sfx.enabled);
    syncSoundButton();
    persistSettings();
    if (Sfx.enabled) Sfx.ui();
  }

  function playerName(p) {
    if (state.mode === 'pvp') return p === B.P1 ? 'PLAYER 1' : 'PLAYER 2';
    if (state.mode === 'puzzle') {
      if (!state.puzzle) return p === B.P1 ? 'CYAN' : 'MAGENTA';
      return p === state.puzzle.attacker ? 'あなた（攻め）' : '相手（受け）';
    }
    return p === state.humanPlayer ? 'あなた' : 'CPU ' + LEVEL_LABEL[state.level];
  }

  function statusMessage() {
    var cur = currentPlayer();
    if (!atTip()) {
      return state.cursor + ' / ' + state.history.length + '手目を表示中 — '
        + (isAiSide(cur) ? 'この局面はCPUの手番です' : 'ここから打ち直せます');
    }
    if (state.busy) return '計算中…';
    if (state.mode === 'puzzle') {
      if (!state.puzzle) return '問題を準備しています…';
      if (state.puzzleState === 'solved') return '正解！ 「次の問題」へ進めます';
      if (state.puzzleState === 'failed') return 'その手では詰みません — 「戻る」で打ち直せます';
      return state.puzzle.plies + '手で詰ませてください（四を打ち続けます）';
    }
    if (state.over) {
      return state.winner === 0
        ? '引き分け — 盤面が埋まりました'
        : playerName(state.winner) + ' の勝利！';
    }
    if (state.thinking) return 'CPU ' + LEVEL_LABEL[state.level] + ' が思考中…';
    if (state.pending) return B.toCoord(state.pending.x, state.pending.y) + ' — 離すとここに置きます';
    if (state.dragging) return '盤の外で離すと取り消せます';
    return playerName(cur) + ' の番です（' + (cur === B.P1 ? 'CYAN' : 'MAGENTA') + '）';
  }

  function updateUI() {
    var cur = currentPlayer();
    var reviewing = !atTip();

    el['p1-name'].textContent = playerName(B.P1);
    el['p2-name'].textContent = playerName(B.P2);
    if (state.mode === 'puzzle' && state.puzzle) {
      el['p1-tag'].textContent = state.puzzle.attacker === B.P1 ? '攻め' : '受け';
      el['p2-tag'].textContent = state.puzzle.attacker === B.P2 ? '攻め' : '受け';
    } else {
      el['p1-tag'].textContent = '先手';
      el['p2-tag'].textContent = '後手';
    }
    el.p1.classList.toggle('is-turn', !state.over && cur === B.P1);
    el.p2.classList.toggle('is-turn', !state.over && cur === B.P2);

    el['review-badge'].hidden = !reviewing;
    var frame = el.board.parentElement;
    if (frame) frame.classList.toggle('is-review', reviewing);

    if (!flashTimer) {
      var dot = el['status-dot'];
      dot.className = 'dot' + (cur === B.P2 ? ' p2' : '');
      if (reviewing || state.over || state.busy) dot.className = 'dot idle';
      el['status-text'].textContent = statusMessage();
    }

    var s = data.stats[statKey()] || { win: 0, lose: 0, draw: 0 };
    if (state.mode === 'puzzle') {
      el['s1-label'].textContent = '正解';
      el['s2-label'].textContent = '失敗';
      el['s3-label'].textContent = '出題';
      el.s1.textContent = s.win;
      el.s2.textContent = s.lose;
      el.s3.textContent = s.win + s.lose;
    } else {
      el['s1-label'].textContent = state.mode === 'pvp' ? 'P1勝ち' : '勝利';
      el['s2-label'].textContent = state.mode === 'pvp' ? 'P2勝ち' : '敗北';
      el['s3-label'].textContent = '引分';
      el.s1.textContent = s.win;
      el.s2.textContent = s.lose;
      el.s3.textContent = s.draw;
    }
    el.streak.textContent = data.streak;
    el['best-streak'].textContent = data.bestStreak;
    el['move-count'].textContent = state.cursor;

    var locked = state.thinking || state.busy;
    var finished = state.over || (state.mode === 'puzzle' && state.puzzleState === 'solved');
    el['btn-back'].disabled = locked || state.cursor === 0;
    el['btn-forward'].disabled = locked || atTip();
    el['btn-latest'].disabled = locked || atTip();
    el['btn-hint'].disabled = locked || finished;
    el['btn-mate'].disabled = locked || (finished && state.mode !== 'puzzle');
    el['btn-restart'].disabled = locked;
    // 決着後は「新規」を目立たせ、盤の直下から次に進めるようにする
    el['btn-restart'].classList.toggle('is-primary', finished);
    el.board.style.cursor = canHumanPlay() ? 'crosshair' : 'default';
  }

  function renderLog() {
    var html = '';
    for (var i = state.history.length - 1; i >= 0; i--) {
      var m = state.history[i];
      var cls = m.player === B.P1 ? 'p1' : 'p2';
      var future = i >= state.cursor ? 'future' : '';
      html += '<li class="' + future + '">'
            + '<span class="n">' + (i + 1) + '</span>'
            + '<span class="who ' + cls + '">' + (m.player === B.P1 ? '●' : '◆') + '</span>'
            + '<span class="pos">' + B.toCoord(m.x, m.y) + '</span></li>';
    }
    el.log.innerHTML = html;
  }

  function showOverlay(winner) {
    var title = el['overlay-title'], sub = el['overlay-sub'], kicker = el['overlay-kicker'];
    title.className = 'overlay-title';
    el['btn-rematch'].textContent = state.mode === 'puzzle' ? '次の問題' : 'もう一局';

    if (state.mode === 'puzzle') {
      kicker.textContent = 'SOLVED';
      title.textContent = '正解！';
      sub.textContent = state.puzzle
        ? state.puzzle.plies + '手詰めを解きました。連続正解 ' + data.streak + '。'
        : '詰みました。';
    } else if (winner === 0) {
      kicker.textContent = 'DRAW';
      title.textContent = 'DRAW';
      title.classList.add('draw');
      sub.textContent = '打つ場所がなくなりました。';
    } else if (state.mode === 'pvp') {
      kicker.textContent = 'RESULT';
      title.textContent = winner === B.P1 ? 'PLAYER 1 WIN' : 'PLAYER 2 WIN';
      if (winner === B.P2) title.classList.add('lose');
      sub.textContent = state.history.length + '手で決着しました。';
    } else if (winner === state.humanPlayer) {
      kicker.textContent = 'VICTORY';
      title.textContent = 'YOU WIN';
      sub.textContent = 'CPU ' + LEVEL_LABEL[state.level] + ' に ' + state.history.length
        + '手で勝利。連勝 ' + data.streak + '。';
    } else {
      kicker.textContent = 'DEFEAT';
      title.textContent = 'YOU LOSE';
      title.classList.add('lose');
      sub.textContent = 'CPU ' + LEVEL_LABEL[state.level] + ' に敗北。「戻る」で打ち直せます。';
    }
    el.overlay.hidden = false;
  }

  function hideOverlay() { el.overlay.hidden = true; }

  /* ================= キーボード操作 ================= */
  var cursor = { x: 7, y: 7 };

  function onKeyDown(ev) {
    var tag = ev.target && ev.target.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;

    var key = ev.key;
    var moved = false;

    if (key === 'ArrowLeft') { cursor.x = Math.max(0, cursor.x - 1); moved = true; }
    else if (key === 'ArrowRight') { cursor.x = Math.min(B.SIZE - 1, cursor.x + 1); moved = true; }
    else if (key === 'ArrowUp') { cursor.y = Math.max(0, cursor.y - 1); moved = true; }
    else if (key === 'ArrowDown') { cursor.y = Math.min(B.SIZE - 1, cursor.y + 1); moved = true; }
    else if (key === 'Enter' || key === ' ') {
      if (!el.overlay.hidden) { hideOverlay(); newGame(true); }
      else attemptPlace(cursor.x, cursor.y);
      ev.preventDefault();
      return;
    } else if (key === 'r' || key === 'R') { Sfx.ui(); newGame(true); return; }
    else if (key === 'u' || key === 'U') { step(-1); return; }
    else if (key === 'i' || key === 'I') { step(1); return; }
    else if (key === 'h' || key === 'H') { doHint(); return; }
    else if (key === 't' || key === 'T') { doMate(); return; }
    else if (key === 'm' || key === 'M') { toggleSound(); return; }
    else if (key === 'Escape') { hideOverlay(); clearAdvice(); return; }

    if (moved) {
      ev.preventDefault();
      if (canHumanPlay()) {
        state.pending = { x: cursor.x, y: cursor.y };
        renderer.setPending({ x: cursor.x, y: cursor.y }, currentPlayer());
        updateUI();
      }
    }
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.CG.game = {
    state: state, newGame: newGame, place: place, attemptPlace: attemptPlace,
    step: step, toLatest: toLatest, doHint: doHint, doMate: doMate
  };
})(window);
