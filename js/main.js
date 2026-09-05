/**
 * main.js — ゲーム進行の統括とUIバインド
 *
 * 棋譜は history に全て保持し、cursor が「盤に反映されている手数」を指す。
 * cursor < history.length の間は「巻き戻し中(レビュー)」で、AIは動かず勝敗も確定しない。
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
    history: [],        // [{x, y, player}] 打たれた手の全て
    cursor: 0,          // 盤に反映されている手数
    mode: 'ai',
    level: 'normal',
    first: 'human',
    humanPlayer: B.P1,
    over: false,
    winner: 0,
    winLine: null,
    thinking: false,
    busy: false,        // ヒント/詰み筋の計算中
    recorded: false,    // この対局の戦績を記録済みか
    confirmTap: true,   // タップ確認モード
    pending: null,      // 確認待ちのマス {x, y}
    mate: null,         // 詰み筋 [{x, y, player, forced}]
    mateStep: 0,
    gen: 0              // 対局世代。中断された非同期処理を無効化する
  };

  var LEVEL_LABEL = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };
  var IDS = [
    'board', 'overlay', 'overlay-kicker', 'overlay-title', 'overlay-sub',
    'btn-rematch', 'btn-close-overlay', 'status-dot', 'status-text', 'ai-options',
    'level', 'first', 'p1', 'p2', 'p1-name', 'p2-name', 'p1-tag', 'p2-tag',
    's1-label', 's2-label', 's1', 's2', 's3', 'streak', 'best-streak',
    'btn-new', 'btn-latest', 'btn-confirm-tap', 'btn-sound', 'btn-reset-score',
    'move-count', 'log', 'review-badge',
    'btn-back', 'btn-forward', 'btn-hint', 'btn-mate',
    'advice', 'advice-kind', 'advice-text', 'advice-close',
    'mate-nav', 'mate-prev', 'mate-next', 'mate-pos', 'mate-list'
  ];

  /* ================= 初期化 ================= */
  function init() {
    IDS.forEach(function (id) { el[id] = $(id); });

    state.mode = data.settings.mode === 'pvp' ? 'pvp' : 'ai';
    state.level = LEVEL_LABEL[data.settings.level] ? data.settings.level : 'normal';
    state.first = data.settings.first === 'ai' ? 'ai' : 'human';
    // 未設定(null/undefined)なら、指での操作かどうかで既定値を決める
    var savedConfirm = data.settings.confirmTap;
    state.confirmTap = (savedConfirm === undefined || savedConfirm === null)
      ? isCoarsePointer()
      : !!savedConfirm;

    el.level.value = state.level;
    el.first.value = state.first;
    Sfx.setEnabled(data.settings.sound !== false);
    syncModeButtons();
    syncSoundButton();
    syncConfirmButton();

    renderer = new global.CG.Renderer(el.board);
    renderer.setBoard(state.board);
    renderer.start();

    bindEvents();
    newGame(false);
  }

  function isCoarsePointer() {
    return !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
  }

  function bindEvents() {
    el.board.addEventListener('pointerdown', onPointerDown);
    el.board.addEventListener('pointermove', onPointerMove);
    el.board.addEventListener('pointerup', onPointerUp);
    el.board.addEventListener('pointercancel', onPointerCancel);
    el.board.addEventListener('pointerleave', function () {
      if (!state.confirmTap) renderer.setHover(null);
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

    el['btn-new'].addEventListener('click', function () { Sfx.ui(); newGame(true); });
    el['btn-rematch'].addEventListener('click', function () { Sfx.ui(); newGame(true); });
    el['btn-close-overlay'].addEventListener('click', function () { Sfx.ui(); hideOverlay(); });
    el['btn-sound'].addEventListener('click', toggleSound);
    el['btn-confirm-tap'].addEventListener('click', toggleConfirmTap);
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

  /** 最新の局面を見ているか（巻き戻し中でないか） */
  function atTip() { return state.cursor === state.history.length; }

  /** 現在の手番 */
  function currentPlayer() {
    var last = state.history[state.cursor - 1];
    return last ? B.opponent(last.player) : B.P1;
  }

  function isAiSide(player) {
    return state.mode === 'ai' && player !== state.humanPlayer;
  }

  /** 人間が今この局面で着手できるか */
  function canHumanPlay() {
    return !state.over && !state.thinking && !state.busy && !isAiSide(currentPlayer());
  }

  function aiShouldMove() {
    return atTip() && !state.over && isAiSide(currentPlayer());
  }

  /** history[0..cursor) から盤面と勝敗を作り直す */
  function rebuild() {
    state.board = B.create();
    state.winLine = null;
    state.over = false;
    state.winner = 0;

    for (var i = 0; i < state.cursor; i++) {
      var m = state.history[i];
      state.board[B.idx(m.x, m.y)] = m.player;
    }
    var last = state.history[state.cursor - 1];
    if (last) {
      var line = B.findWinLine(state.board, last.x, last.y);
      if (line) { state.over = true; state.winner = last.player; state.winLine = line; }
    }
    if (!state.over && state.cursor > 0 && B.isFull(state.board)) {
      state.over = true; state.winner = 0;
    }
    renderer.setBoard(state.board);
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
    state.humanPlayer = (state.mode === 'ai' && state.first === 'ai') ? B.P2 : B.P1;

    renderer.clearEffects();
    rebuild();
    clearAdvice();
    hideOverlay();
    renderLog();
    updateUI();
    if (withSound) Sfx.ui();

    if (aiShouldMove()) scheduleAi();
  }

  /** 人間の着手要求 */
  function attemptPlace(x, y) {
    if (state.over) {
      Sfx.error();
      flash('この対局は終了しています。「新規対局」または「戻る」で続けられます。');
      return;
    }
    if (state.thinking || state.busy) { Sfx.error(); return; }
    if (isAiSide(currentPlayer())) {
      Sfx.error();
      flash('いまはCPUの手番です。「戻る」でもう一手戻すとあなたの手番になります。');
      return;
    }
    if (!B.inBounds(x, y) || state.board[B.idx(x, y)] !== B.EMPTY) { Sfx.error(); return; }
    place(x, y, currentPlayer());
  }

  function place(x, y, player) {
    // 巻き戻した位置から打った場合は、その先の手を破棄する
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

    var line = B.findWinLine(state.board, x, y);
    if (line) { finish(player, line); return; }
    if (B.isFull(state.board)) { finish(0, null); return; }

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
          move = fallbackMove();
        }
        if (!move || state.board[B.idx(move.x, move.y)] !== B.EMPTY) move = fallbackMove();
        state.thinking = false;
        if (gen !== state.gen || state.over || !move) { updateUI(); return; }
        place(move.x, move.y, player);
      }, 240);
    });
  }

  /** AIが手を返せなかった場合の保険 */
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
    state.winLine = line;
    state.thinking = false;
    state.pending = null;
    renderer.setPending(null);
    renderer.setHover(null);
    if (line) renderer.setWinLine(line);

    if (!state.recorded) { recordResult(winner); state.recorded = true; }
    renderLog();
    updateUI();

    if (winner === 0) Sfx.draw();
    else if (state.mode === 'pvp') Sfx.win();
    else if (winner === state.humanPlayer) Sfx.win();
    else Sfx.lose();

    var gen = state.gen;
    global.setTimeout(function () {
      if (gen === state.gen && state.over && atTip()) showOverlay(winner);
    }, line ? 900 : 300);
  }

  /* ================= 巻き戻し / 早送り ================= */
  function step(delta) {
    var next = Math.max(0, Math.min(state.history.length, state.cursor + delta));
    if (next === state.cursor) { Sfx.error(); return; }

    state.gen++;                 // 進行中のAI思考を無効化する
    state.thinking = false;
    state.cursor = next;
    state.pending = null;

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

  /** 最新の局面まで進めて対局を再開する */
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
    if (state.over || state.thinking || state.busy) { Sfx.error(); return; }
    Sfx.ui();
    runAsync(el['btn-mate'], function () {
      var player = currentPlayer();
      var found = AI.findMate(state.board, player, { maxAttacks: 6, budget: 1600 });
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

  /** 重い計算を、描画を1フレーム挟んでから実行する */
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
    // 盤が大きい画面では画面外に出ることがあるので、必要なときだけ見える位置へ寄せる
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

  /** 一時的なメッセージをステータス行に出す */
  var flashTimer = null;
  function flash(text) {
    el['status-text'].textContent = text;
    if (flashTimer) global.clearTimeout(flashTimer);
    flashTimer = global.setTimeout(function () { flashTimer = null; updateUI(); }, 2800);
  }

  /* ================= 入力（マウス / 指） ================= */
  var pointerDown = false;

  function hitTolerance(ev) {
    // 指では大きめの許容範囲を取る（マス幅とほぼ同じ）
    return (ev.pointerType === 'touch' || ev.pointerType === 'pen') ? 1.0 : 0.62;
  }

  /**
   * タップ確認を使うかどうか。設定だけで決める。
   * 以前はここで pointerType === 'touch' を無条件にORしていたため、
   * 設定をOFFにしてもタッチ端末では効かなかった（既定値の自動判定は init 側の役目）。
   */
  function useConfirmFor() {
    return state.confirmTap;
  }

  function onPointerDown(ev) {
    pointerDown = true;
    if (!canHumanPlay()) return;
    var cell = renderer.cellAt(ev.clientX, ev.clientY, hitTolerance(ev));
    if (!cell) return;
    if (useConfirmFor()) {
      // 押した時点で候補位置を表示する（指で隠れても十字線で位置が分かる）
      renderer.setPending(cell, currentPlayer());
      renderer.setHover(null);
    } else {
      renderer.setHover(cell, currentPlayer());
    }
  }

  function onPointerMove(ev) {
    if (!canHumanPlay()) { renderer.setHover(null); return; }
    var cell = renderer.cellAt(ev.clientX, ev.clientY, hitTolerance(ev));
    if (pointerDown && useConfirmFor()) {
      if (cell) renderer.setPending(cell, currentPlayer());   // 指をずらして微調整できる
    } else if (!useConfirmFor()) {
      renderer.setHover(cell, currentPlayer());
    }
  }

  function onPointerUp(ev) {
    pointerDown = false;
    if (!canHumanPlay()) return;
    var cell = renderer.cellAt(ev.clientX, ev.clientY, hitTolerance(ev));

    if (!useConfirmFor()) {
      if (cell) attemptPlace(cell.x, cell.y);
      // 指では離した後にカーソルが残らないようにする
      if (ev.pointerType !== 'mouse') renderer.setHover(null);
      return;
    }

    var target = renderer.pending || cell;
    if (!target) return;

    if (state.pending && state.pending.x === target.x && state.pending.y === target.y) {
      state.pending = null;                      // 2回目のタップ = 確定
      attemptPlace(target.x, target.y);
    } else {
      state.pending = { x: target.x, y: target.y };   // 1回目のタップ = 位置決め
      renderer.setPending(target, currentPlayer());
      Sfx.ui();
      updateUI();
    }
  }

  function onPointerCancel() {
    // スクロールなどで操作が取り消されたとき
    pointerDown = false;
    state.pending = null;
    renderer.setPending(null);
    updateUI();
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
    persistSettings();
    updateUI();
  }

  function persistSettings() {
    data.settings.mode = state.mode;
    data.settings.level = state.level;
    data.settings.first = state.first;
    data.settings.sound = Sfx.enabled;
    data.settings.confirmTap = state.confirmTap;
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

  function syncConfirmButton() {
    el['btn-confirm-tap'].innerHTML = 'タップ確認 ' + (state.confirmTap ? 'ON' : 'OFF') + ' <kbd>C</kbd>';
    el['btn-confirm-tap'].setAttribute('aria-pressed', String(state.confirmTap));
  }

  function toggleConfirmTap() {
    state.confirmTap = !state.confirmTap;
    state.pending = null;
    renderer.setPending(null);
    syncConfirmButton();
    persistSettings();
    Sfx.ui();
    flash(state.confirmTap
      ? 'タップ確認 ON — 位置を決めてから、同じ場所をもう一度タップで着手します。'
      : 'タップ確認 OFF — 1回のタップですぐ着手します。');
  }

  function playerName(p) {
    if (state.mode === 'pvp') return p === B.P1 ? 'PLAYER 1' : 'PLAYER 2';
    return p === state.humanPlayer ? 'あなた' : 'CPU ' + LEVEL_LABEL[state.level];
  }

  function updateUI() {
    var cur = currentPlayer();
    var reviewing = !atTip();

    el['p1-name'].textContent = playerName(B.P1);
    el['p2-name'].textContent = playerName(B.P2);
    el['p1-tag'].textContent = '先手';
    el['p2-tag'].textContent = '後手';
    el.p1.classList.toggle('is-turn', !state.over && cur === B.P1);
    el.p2.classList.toggle('is-turn', !state.over && cur === B.P2);

    el['review-badge'].hidden = !reviewing;
    var frame = el.board.parentElement;
    if (frame) frame.classList.toggle('is-review', reviewing);

    if (!flashTimer) {
      var dot = el['status-dot'], text = el['status-text'];
      dot.className = 'dot' + (cur === B.P2 ? ' p2' : '');
      if (reviewing) {
        dot.className = 'dot idle';
        text.textContent = state.cursor + ' / ' + state.history.length + '手目を表示中 — '
          + (isAiSide(cur) ? 'この局面はCPUの手番です' : 'ここから打ち直せます');
      } else if (state.over) {
        dot.className = 'dot idle';
        text.textContent = state.winner === 0
          ? '引き分け — 盤面が埋まりました'
          : playerName(state.winner) + ' の勝利！';
      } else if (state.thinking) {
        text.textContent = 'CPU ' + LEVEL_LABEL[state.level] + ' が思考中…';
      } else if (state.busy) {
        text.textContent = '読み筋を計算中…';
      } else if (state.pending) {
        text.textContent = B.toCoord(state.pending.x, state.pending.y)
          + ' を選択中 — もう一度タップで着手します';
      } else {
        text.textContent = playerName(cur) + ' の番です（'
          + (cur === B.P1 ? 'CYAN' : 'MAGENTA') + '）';
      }
    }

    var s = data.stats[statKey()] || { win: 0, lose: 0, draw: 0 };
    el['s1-label'].textContent = state.mode === 'pvp' ? 'P1勝ち' : '勝利';
    el['s2-label'].textContent = state.mode === 'pvp' ? 'P2勝ち' : '敗北';
    el.s1.textContent = s.win;
    el.s2.textContent = s.lose;
    el.s3.textContent = s.draw;
    el.streak.textContent = data.streak;
    el['best-streak'].textContent = data.bestStreak;
    el['move-count'].textContent = state.cursor;

    var locked = state.thinking || state.busy;
    el['btn-back'].disabled = locked || state.cursor === 0;
    el['btn-forward'].disabled = locked || atTip();
    el['btn-latest'].disabled = locked || atTip();
    el['btn-hint'].disabled = locked || state.over;
    el['btn-mate'].disabled = locked || state.over;
    el.board.style.cursor = (canHumanPlay() && !state.confirmTap) ? 'crosshair' : 'default';
  }

  /** 棋譜ログ。巻き戻した先の手は薄く残し、「進む」で戻せることを示す。 */
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

    if (winner === 0) {
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
    else if (key === 'c' || key === 'C') { toggleConfirmTap(); return; }
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
