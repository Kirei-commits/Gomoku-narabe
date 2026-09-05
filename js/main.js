/**
 * main.js — ゲーム進行の統括とUIバインド
 */
(function (global) {
  'use strict';

  var B = global.CG.Board;
  var AI = global.CG.AI;
  var Sfx = global.CG.Sfx;
  var Store = global.CG.Store;

  var $ = function (id) { return global.document.getElementById(id); };

  var el = {};
  var renderer = null;
  var data = Store.load();

  var state = {
    board: B.create(),
    moves: [],
    current: B.P1,
    mode: 'ai',
    level: 'normal',
    first: 'human',
    humanPlayer: B.P1,
    over: false,
    winner: 0,
    thinking: false,
    gen: 0            // 対局世代。中断された非同期処理を無効化するために使う
  };

  var LEVEL_LABEL = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };

  /* ================= 初期化 ================= */
  function init() {
    [
      'board', 'overlay', 'overlay-kicker', 'overlay-title', 'overlay-sub',
      'btn-rematch', 'btn-close-overlay', 'status-dot', 'status-text', 'ai-options',
      'level', 'first', 'p1', 'p2', 'p1-name', 'p2-name', 'p1-tag', 'p2-tag',
      's1-label', 's2-label', 's1', 's2', 's3', 'streak', 'best-streak',
      'btn-new', 'btn-undo', 'btn-sound', 'btn-reset-score', 'move-count', 'log'
    ].forEach(function (id) { el[id] = $(id); });

    // 保存済み設定の復元
    state.mode = data.settings.mode === 'pvp' ? 'pvp' : 'ai';
    state.level = LEVEL_LABEL[data.settings.level] ? data.settings.level : 'normal';
    state.first = data.settings.first === 'ai' ? 'ai' : 'human';
    el.level.value = state.level;
    el.first.value = state.first;
    Sfx.setEnabled(data.settings.sound !== false);
    syncModeButtons();
    syncSoundButton();

    renderer = new global.CG.Renderer(el.board);
    renderer.setBoard(state.board);
    renderer.start();

    bindEvents();
    newGame(false);
  }

  function bindEvents() {
    // 盤面
    el.board.addEventListener('click', onBoardClick);
    el.board.addEventListener('pointermove', onBoardHover);
    el.board.addEventListener('pointerleave', function () { renderer.setHover(null); });

    // モード切替
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

    el['btn-new'].addEventListener('click', function () { Sfx.ui(); newGame(true); });
    el['btn-undo'].addEventListener('click', undo);
    el['btn-rematch'].addEventListener('click', function () { Sfx.ui(); newGame(true); });
    el['btn-close-overlay'].addEventListener('click', function () { Sfx.ui(); hideOverlay(); });
    el['btn-sound'].addEventListener('click', toggleSound);
    el['btn-reset-score'].addEventListener('click', resetScore);

    global.document.addEventListener('keydown', onKeyDown);
  }

  /* ================= ゲーム進行 ================= */
  function newGame(withSound) {
    state.gen++;                       // 進行中のAI思考・オーバーレイ表示を無効化
    state.board = B.create();
    state.moves = [];
    state.current = B.P1;
    state.over = false;
    state.winner = 0;
    state.thinking = false;
    state.humanPlayer = (state.mode === 'ai' && state.first === 'ai') ? B.P2 : B.P1;

    renderer.clearEffects();
    renderer.setBoard(state.board);
    el.log.innerHTML = '';
    hideOverlay();
    updateUI();
    if (withSound) Sfx.ui();

    if (isAiTurn()) scheduleAi();
  }

  function isAiTurn() {
    return state.mode === 'ai' && !state.over && state.current !== state.humanPlayer;
  }

  function onBoardClick(ev) {
    var cell = renderer.cellAt(ev.clientX, ev.clientY);
    if (!cell) return;
    el.board.focus({ preventScroll: true });
    attemptPlace(cell.x, cell.y);
  }

  function onBoardHover(ev) {
    if (state.over || state.thinking || isAiTurn()) { renderer.setHover(null); return; }
    renderer.setHover(renderer.cellAt(ev.clientX, ev.clientY), state.current);
  }

  /** 人間の着手要求。不正なら効果音で拒否。 */
  function attemptPlace(x, y) {
    if (state.over || state.thinking || isAiTurn()) { Sfx.error(); return; }
    if (!B.inBounds(x, y) || state.board[B.idx(x, y)] !== B.EMPTY) { Sfx.error(); return; }
    place(x, y, state.current);
  }

  function place(x, y, player) {
    state.board[B.idx(x, y)] = player;
    state.moves.push({ x: x, y: y, player: player });

    renderer.markPlaced(x, y, player);
    renderer.setHover(null);
    Sfx.place(player);
    appendLog(state.moves.length, x, y, player);

    var line = B.findWinLine(state.board, x, y);
    if (line) { finish(player, line); return; }
    if (B.isFull(state.board)) { finish(0, null); return; }

    state.current = B.opponent(player);
    updateUI();
    if (isAiTurn()) scheduleAi();
  }

  function scheduleAi() {
    var gen = state.gen;
    state.thinking = true;
    updateUI();
    // 「思考中」表示を確実に描画してから計算に入る
    global.requestAnimationFrame(function () {
      global.setTimeout(function () {
        if (gen !== state.gen) return;                       // 対局がリセットされた
        if (!state.thinking || state.over) { state.thinking = false; return; }
        var move;
        try {
          move = AI.chooseMove(state.board, state.current, state.level);
        } catch (err) {
          move = fallbackMove();
        }
        if (!move || state.board[B.idx(move.x, move.y)] !== B.EMPTY) move = fallbackMove();
        state.thinking = false;
        if (gen !== state.gen || state.over || !move) { updateUI(); return; }
        place(move.x, move.y, state.current);
      }, 240);
    });
  }

  /** AIが手を返せなかった場合の保険（空きマスから中央寄りを選ぶ） */
  function fallbackMove() {
    var c = (B.SIZE - 1) / 2, best = null, bestD = Infinity;
    for (var y = 0; y < B.SIZE; y++) {
      for (var x = 0; x < B.SIZE; x++) {
        if (state.board[B.idx(x, y)] !== B.EMPTY) continue;
        var d = Math.abs(x - c) + Math.abs(y - c);
        if (d < bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  }

  function finish(winner, line) {
    state.over = true;
    state.winner = winner;
    state.thinking = false;
    renderer.setHover(null);
    if (line) renderer.setWinLine(line);
    recordResult(winner);
    updateUI();

    var human = state.humanPlayer;
    if (winner === 0) Sfx.draw();
    else if (state.mode === 'pvp') Sfx.win();
    else if (winner === human) Sfx.win();
    else Sfx.lose();

    var gen = state.gen;
    global.setTimeout(function () {
      if (gen === state.gen && state.over) showOverlay(winner);
    }, line ? 900 : 300);
  }

  function undo() {
    if (state.thinking) { Sfx.error(); return; }
    if (!state.moves.length) { Sfx.error(); return; }

    var back = 1;
    if (state.mode === 'ai' && !state.over) {
      // 自分の手番に戻す（直前のAIの手も一緒に取り消す）
      back = state.moves.length >= 2 ? 2 : 1;
    } else if (state.mode === 'ai' && state.over) {
      back = Math.min(state.moves.length, 2);
    }

    state.gen++;                       // 待ったも進行中の非同期処理を無効化する
    for (var i = 0; i < back; i++) {
      var m = state.moves.pop();
      if (!m) break;
      state.board[B.idx(m.x, m.y)] = B.EMPTY;
      if (el.log.firstChild) el.log.removeChild(el.log.firstChild);
    }

    state.over = false;
    state.winner = 0;
    var last = state.moves[state.moves.length - 1];
    state.current = last ? B.opponent(last.player) : B.P1;

    renderer.clearEffects();
    if (last) renderer.lastMove = { x: last.x, y: last.y, player: last.player };
    hideOverlay();
    Sfx.undo();
    updateUI();

    if (isAiTurn()) scheduleAi();
  }

  /* ================= 戦績 ================= */
  function statKey() { return state.mode === 'pvp' ? 'pvp' : state.level; }

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
    data.settings.mode = state.mode;
    data.settings.level = state.level;
    data.settings.first = state.first;
    data.settings.sound = Sfx.enabled;
    Store.save(data);
    updateUI();
  }

  function persistSettings() {
    data.settings.mode = state.mode;
    data.settings.level = state.level;
    data.settings.first = state.first;
    data.settings.sound = Sfx.enabled;
    Store.save(data);
  }

  /* ================= UI ================= */
  function syncModeButtons() {
    Array.prototype.forEach.call(global.document.querySelectorAll('.seg-btn'), function (btn) {
      btn.classList.toggle('is-active', btn.dataset.mode === state.mode);
    });
    el['ai-options'].hidden = state.mode !== 'ai';
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
    return p === state.humanPlayer ? 'あなた' : 'CPU ' + LEVEL_LABEL[state.level];
  }

  function updateUI() {
    // プレイヤー表示
    el['p1-name'].textContent = playerName(B.P1);
    el['p2-name'].textContent = playerName(B.P2);
    el['p1-tag'].textContent = '先手';
    el['p2-tag'].textContent = '後手';
    el.p1.classList.toggle('is-turn', !state.over && state.current === B.P1);
    el.p2.classList.toggle('is-turn', !state.over && state.current === B.P2);

    // ステータス
    var dot = el['status-dot'], text = el['status-text'];
    dot.className = 'dot' + (state.current === B.P2 ? ' p2' : '');
    if (state.over) {
      dot.className = 'dot idle';
      text.textContent = state.winner === 0
        ? '引き分け — 盤面が埋まりました'
        : playerName(state.winner) + ' の勝利！';
    } else if (state.thinking) {
      text.textContent = 'CPU ' + LEVEL_LABEL[state.level] + ' が思考中…';
    } else {
      text.textContent = playerName(state.current) + ' の番です（' +
        (state.current === B.P1 ? 'CYAN' : 'MAGENTA') + '）';
    }

    // スコア
    var s = data.stats[statKey()] || { win: 0, lose: 0, draw: 0 };
    el['s1-label'].textContent = state.mode === 'pvp' ? 'P1勝ち' : '勝利';
    el['s2-label'].textContent = state.mode === 'pvp' ? 'P2勝ち' : '敗北';
    el.s1.textContent = s.win;
    el.s2.textContent = s.lose;
    el.s3.textContent = s.draw;
    el.streak.textContent = data.streak;
    el['best-streak'].textContent = data.bestStreak;

    el['move-count'].textContent = state.moves.length;
    el['btn-undo'].disabled = state.thinking || state.moves.length === 0;
    el.board.style.cursor = (state.thinking || state.over || isAiTurn()) ? 'default' : 'crosshair';
  }

  function appendLog(n, x, y, player) {
    var li = global.document.createElement('li');
    var cls = player === B.P1 ? 'p1' : 'p2';
    li.innerHTML = '<span class="n">' + n + '</span>' +
                   '<span class="who ' + cls + '">' + (player === B.P1 ? '\u25CF' : '\u25C6') + '</span>' +
                   '<span class="pos">' + B.toCoord(x, y) + '</span>';
    el.log.insertBefore(li, el.log.firstChild);
  }

  function showOverlay(winner) {
    var title = el['overlay-title'], sub = el['overlay-sub'], kicker = el['overlay-kicker'];
    title.className = 'overlay-title';

    if (winner === 0) {
      kicker.textContent = 'DRAW';
      title.textContent = 'DRAW';
      title.classList.add('draw');
      sub.textContent = '打つ場所がなくなりました。';
    } else if (state.mode === 'pvp') {
      kicker.textContent = 'RESULT';
      title.textContent = winner === B.P1 ? 'PLAYER 1 WIN' : 'PLAYER 2 WIN';
      if (winner === B.P2) title.classList.add('lose');
      sub.textContent = state.moves.length + '手で決着しました。';
    } else if (winner === state.humanPlayer) {
      kicker.textContent = 'VICTORY';
      title.textContent = 'YOU WIN';
      sub.textContent = 'CPU ' + LEVEL_LABEL[state.level] + ' に ' + state.moves.length + '手で勝利。連勝 ' + data.streak + '。';
    } else {
      kicker.textContent = 'DEFEAT';
      title.textContent = 'YOU LOSE';
      title.classList.add('lose');
      sub.textContent = 'CPU ' + LEVEL_LABEL[state.level] + ' に敗北。待ったで一手戻せます。';
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

    if (key === 'ArrowLeft')  { cursor.x = Math.max(0, cursor.x - 1); moved = true; }
    else if (key === 'ArrowRight') { cursor.x = Math.min(B.SIZE - 1, cursor.x + 1); moved = true; }
    else if (key === 'ArrowUp')    { cursor.y = Math.max(0, cursor.y - 1); moved = true; }
    else if (key === 'ArrowDown')  { cursor.y = Math.min(B.SIZE - 1, cursor.y + 1); moved = true; }
    else if (key === 'Enter' || key === ' ') {
      if (!el.overlay.hidden) { hideOverlay(); newGame(true); }
      else attemptPlace(cursor.x, cursor.y);
      ev.preventDefault();
      return;
    } else if (key === 'r' || key === 'R') { Sfx.ui(); newGame(true); return; }
    else if (key === 'u' || key === 'U') { undo(); return; }
    else if (key === 'm' || key === 'M') { toggleSound(); return; }
    else if (key === 'Escape') { hideOverlay(); return; }

    if (moved) {
      ev.preventDefault();
      if (!state.over && !state.thinking && !isAiTurn()) {
        renderer.setHover({ x: cursor.x, y: cursor.y }, state.current);
      }
    }
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.CG.game = { state: state, newGame: newGame, place: place, attemptPlace: attemptPlace };
})(window);
