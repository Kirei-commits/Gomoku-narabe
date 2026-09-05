/**
 * ai.js — 五目並べAI
 *
 * 判断は次の階層で行う（上位で決まればそこで確定）:
 *   1. 自分が即勝ちできる手
 *   2. 相手の即勝ちを止める手
 *   3. 自分の四/両三など決定的な脅威を作る手
 *   4. 相手の決定的な脅威を潰す手
 *   5. αβ枝刈り付きネガマックス探索（HARD）／評価値グリーディ（NORMAL・EASY）
 */
(function (global) {
  'use strict';

  var B = global.CG.Board;
  var SIZE = B.SIZE, EMPTY = B.EMPTY;

  /* --- パターン評価 ------------------------------------------------ */
  var SCORE = {
    FIVE:  1000000,
    OPEN4:  100000,
    FOUR:    10000,
    OPEN3:    8000,
    THREE:     800,
    OPEN2:     100,
    TWO:        10,
    ONE:         1
  };

  /* 自石='1' / 空='0' / 相手石・壁='2' で表した並びに対するスコア表 */
  var PATTERNS = [
    { s: SCORE.FIVE,  n: 5, p: ['11111'] },
    { s: SCORE.OPEN4, n: 4, p: ['011110'] },
    { s: SCORE.FOUR,  n: 4, p: ['011112', '211110', '11011', '10111', '11101'] },
    { s: SCORE.OPEN3, n: 3, p: ['011100', '001110', '011010', '010110'] },
    { s: SCORE.THREE, n: 3, p: ['001112', '211100', '011012', '210110', '10011', '11001', '10101'] },
    { s: SCORE.OPEN2, n: 2, p: ['001100', '011000', '000110', '010100', '001010'] },
    { s: SCORE.TWO,   n: 2, p: ['001102', '201100', '10001', '01001', '10010'] }
  ];

  var LINE_RADIUS = 4; // 中心 ±4 の 9 マスを見る

  /**
   * (x,y) に player を置いたと仮定したときの手の強さ。
   * 4方向それぞれで最大パターンを取り、合計する（両三などの複合脅威は合算で評価される）。
   */
  function evalPoint(board, x, y, player) {
    return scanPoint(board, x, y, player).total;
  }

  /**
   * 単一方向での最大パターンスコア。
   * evalPoint は4方向の合計なので「両三」も四と同等の値になるが、
   * 四追い（VCF）の判定では「本当に四以上か」を見る必要があるためこちらを使う。
   */
  function threatLevel(board, x, y, player) {
    return scanPoint(board, x, y, player).best;
  }

  /** 方向ごとのパターンスコア（禁じ手判定で三三・四四を数えるのに使う） */
  function directionScores(board, x, y, player) {
    return scanPoint(board, x, y, player).dirs;
  }

  /** (x,y) に player を置いた場合の、4方向の合計スコア・最大スコア・方向別スコア */
  function scanPoint(board, x, y, player) {
    if (board[B.idx(x, y)] !== EMPTY) return { total: -1, best: -1, dirs: [-1, -1, -1, -1] };
    var total = 0, best = 0, dirs = [];

    for (var d = 0; d < B.DIRS.length; d++) {
      var dx = B.DIRS[d][0], dy = B.DIRS[d][1];
      var line = '', ones = 1;
      for (var k = -LINE_RADIUS; k <= LINE_RADIUS; k++) {
        if (k === 0) { line += '1'; continue; }
        var v = B.get(board, x + dx * k, y + dy * k);
        if (v === player) { line += '1'; ones++; }
        else { line += (v === EMPTY ? '0' : '2'); } // 盤外(-1)と相手石はどちらも '2'
      }
      var sc = matchLine(line, ones);
      dirs.push(sc);
      total += sc;
      if (sc > best) best = sc;
    }
    // 中央に近いほうがわずかに有利（同点時の指し手を安定させる）
    var c = (SIZE - 1) / 2;
    total += Math.max(0, 6 - (Math.abs(x - c) + Math.abs(y - c)) * 0.4);
    return { total: total, best: best, dirs: dirs };
  }

  /** 並び文字列に最も高く合致するパターンのスコア（自石数で候補を絞り高速化） */
  function matchLine(line, ones) {
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].n > ones) continue; // 石数が足りないパターン群は照合不要
      var list = PATTERNS[i].p;
      for (var j = 0; j < list.length; j++) {
        if (line.indexOf(list[j]) !== -1) return PATTERNS[i].s;
      }
    }
    return SCORE.ONE;
  }

  /* --- 局面全体の静的評価（探索の葉で使用） ------------------------ */
  var W = [0, 1, 14, 180, 3200, 1000000]; // 窓内の自石数 → 得点

  function windowScore(a, b) {
    if (a > 0 && b > 0) return 0;      // 両者混在の窓は死んでいる
    if (a > 0) return W[a];
    if (b > 0) return -W[b] * 1.15;    // 守りをわずかに重く見る
    return 0;
  }

  function evalBoard(board, me) {
    var opp = B.opponent(me);
    var total = 0, x, y, k, a, b, v;

    for (y = 0; y < SIZE; y++) {
      for (x = 0; x < SIZE; x++) {
        for (var d = 0; d < B.DIRS.length; d++) {
          var dx = B.DIRS[d][0], dy = B.DIRS[d][1];
          var ex = x + dx * 4, ey = y + dy * 4;
          if (!B.inBounds(ex, ey)) continue;
          a = 0; b = 0;
          for (k = 0; k < 5; k++) {
            v = board[B.idx(x + dx * k, y + dy * k)];
            if (v === me) a++; else if (v === opp) b++;
          }
          total += windowScore(a, b);
        }
      }
    }
    return total;
  }

  /* --- 候補手の生成と並べ替え -------------------------------------- */
  function rankedMoves(board, player, limit, defense, range) {
    var opp = B.opponent(player);
    var cands = B.candidates(board, range || 2);
    var scored = [];

    for (var i = 0; i < cands.length; i++) {
      var x = cands[i][0], y = cands[i][1];
      if (forbidden(board, x, y, player)) continue;     // 禁じ手は選ばない
      var mine = evalPoint(board, x, y, player);
      var theirs = evalPoint(board, x, y, opp);
      scored.push({ x: x, y: y, mine: mine, theirs: theirs, score: mine + theirs * defense });
    }
    scored.sort(function (p, q) { return q.score - p.score; });
    return limit ? scored.slice(0, limit) : scored;
  }

  /* --- 探索 --------------------------------------------------------- */
  var WIN_VALUE = 5000000;

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  /**
   * EASY のゆらぎに使う乱数。テストから固定シードの関数を差し込めるようにして、
   * 対戦結果を再現可能にする（乱数任せだとテストがフレーキーになるため）。
   */
  var rng = function () { return Math.random(); };
  function setRandom(fn) { rng = (typeof fn === 'function') ? fn : function () { return Math.random(); }; }

  /**
   * 適用中のルール。禁じ手のある設定では AI もそれを守る必要がある。
   * rules.js は ai.js より後に読み込まれるため、参照は呼び出し時に解決する。
   */
  var currentRules = null;
  function setRules(rules) { currentRules = rules || null; }

  function rulesApi() { return global.CG.Rules; }

  /** その手が禁じ手か（ルール未設定なら常に false） */
  function forbidden(board, x, y, player) {
    var R = rulesApi();
    if (!currentRules || !R) return false;
    return R.isForbidden(board, x, y, player, currentRules);
  }

  /** ルールを考慮した勝ち判定（長連禁止なら6連以上は勝ちにしない） */
  function winAt(board, x, y) {
    var R = rulesApi();
    if (currentRules && R) return R.winLine(board, x, y, currentRules);
    return B.findWinLine(board, x, y);
  }

  /** ルールを考慮した「置けば五になる点」 */
  function winningPoints(board, player) {
    var pts = B.winningPoints(board, player);
    if (!currentRules || !rulesApi()) return pts;
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1], id = B.idx(x, y);
      if (forbidden(board, x, y, player)) continue;
      board[id] = player;
      var ok = !!winAt(board, x, y);
      board[id] = EMPTY;
      if (ok) out.push(pts[i]);
    }
    return out;
  }

  function negamax(board, player, depth, alpha, beta, branch, deadline) {
    if (depth === 0) return evalBoard(board, player);

    // 深い階層ほど候補を絞る（探索範囲も隣接1マスに限定してコストを抑える）
    var width = depth >= 3 ? branch : Math.max(4, branch - 2 * (3 - depth));
    var moves = rankedMoves(board, player, width, 1.0, 1);
    if (!moves.length) return evalBoard(board, player);

    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], id = B.idx(m.x, m.y);
      board[id] = player;
      var value;
      if (winAt(board, m.x, m.y)) {
        value = WIN_VALUE + depth;                       // 早く勝てるほど高評価
      } else {
        value = -negamax(board, B.opponent(player), depth - 1, -beta, -alpha, branch, deadline);
      }
      board[id] = EMPTY;

      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                          // βカット
      if (now() > deadline) break;                       // 時間切れは打ち切り
    }
    return best;
  }

  /* --- 手の決定 ----------------------------------------------------- */
  var LEVELS = {
    easy:   { depth: 0, branch: 6,  defense: 0.55, noise: 0.9,  budget: 120, vcf: false },
    normal: { depth: 2, branch: 8,  defense: 0.95, noise: 0.12, budget: 400, vcf: false },
    hard:   { depth: 4, branch: 10, defense: 1.05, noise: 0,    budget: 900, vcf: true }
  };

  /**
   * @param {Int8Array} board 盤面（この関数は盤面を書き換えない）
   * @param {number} player   AIの石
   * @param {string} level    'easy' | 'normal' | 'hard'
   * @returns {{x:number, y:number}}
   */
  function chooseMove(board, player, level) {
    var cfg = LEVELS[level] || LEVELS.normal;
    var work = Int8Array.from(board);
    var moves = rankedMoves(work, player, 0, cfg.defense);

    if (!moves.length) {
      var c = (SIZE - 1) >> 1;
      return { x: c, y: c };
    }

    // 1. 自分の即勝ち
    var win = pickBy(moves, function (m) { return m.mine >= SCORE.FIVE; }, 'mine');
    if (win) return xy(win);

    // 2. 相手の即勝ちを阻止
    var block = pickBy(moves, function (m) { return m.theirs >= SCORE.FIVE; }, 'mine');
    if (block) return xy(block);

    if (level !== 'easy') {
      // 3. 自分の決定的な脅威（四・両三）
      var threat = pickBy(moves, function (m) { return m.mine >= SCORE.OPEN4; }, 'mine');
      if (threat) return xy(threat);

      // 4. 相手の決定的な脅威を先に潰す
      var counter = pickBy(moves, function (m) { return m.theirs >= SCORE.OPEN4; }, 'mine');
      if (counter) return xy(counter);
    }

    // 5. HARDのみ: 四追いで詰む筋があればそれを選ぶ
    if (cfg.vcf) {
      var mate = findMate(work, player, { maxAttacks: 5, budget: 350 });
      if (mate && mate.moves.length) return { x: mate.moves[0].x, y: mate.moves[0].y };
    }

    // 6. 探索 or グリーディ
    if (cfg.depth > 0) {
      var deadline = now() + cfg.budget;
      var top = moves.slice(0, cfg.branch);
      var bestMove = top[0], bestValue = -Infinity, alpha = -Infinity;

      for (var i = 0; i < top.length; i++) {
        var m = top[i], id = B.idx(m.x, m.y);
        work[id] = player;
        var value = winAt(work, m.x, m.y)
          ? WIN_VALUE + cfg.depth
          : -negamax(work, B.opponent(player), cfg.depth - 1, -Infinity, -alpha, cfg.branch, deadline);
        work[id] = EMPTY;

        if (value > bestValue) { bestValue = value; bestMove = m; }
        if (value > alpha) alpha = value;
        if (now() > deadline) break;
      }
      return xy(bestMove);
    }

    // EASY: 上位候補からゆらぎ付きで選ぶ
    var pool = moves.slice(0, cfg.branch);
    var top1 = pool[0].score;
    var picked = pool[0];
    var bestNoisy = -Infinity;
    for (var k = 0; k < pool.length; k++) {
      var noisy = pool[k].score + rng() * top1 * cfg.noise;
      if (noisy > bestNoisy) { bestNoisy = noisy; picked = pool[k]; }
    }
    return xy(picked);
  }

  /* --- 四追い（VCF）による詰み筋探索 -------------------------------- */

  /**
   * 「四を作り続けて相手の応手を強制し、五を作る」手順を探す。
   * 相手の受けは一意（五になる点）に限定されるため、探索は非常に狭い。
   *
   * @returns {{moves: Array, plies: number}|null}
   *          moves は [{x, y, player, forced}] の並び。forced は相手の強制受け。
   */
  function findMate(board, attacker, options) {
    var opt = options || {};
    var maxAttacks = opt.maxAttacks || 6;                 // 自分が打つ手の上限
    var deadline = now() + (opt.budget || 1500);
    var work = Int8Array.from(board);

    // 自分が今すぐ五を作れるなら、相手の脅威に関係なくそこで勝ち
    var immediate = winningPoints(work, attacker);
    if (immediate.length) {
      return {
        moves: [{ x: immediate[0][0], y: immediate[0][1], player: attacker, forced: false }],
        plies: 1
      };
    }
    // そうでなく相手が既に五を作れる状態なら、四追いは間に合わない
    if (winningPoints(work, B.opponent(attacker)).length > 0) return null;

    var line = vcf(work, attacker, maxAttacks, deadline);
    if (!line) return null;
    return { moves: line, plies: line.length };
  }

  function vcf(board, attacker, depth, deadline) {
    if (depth <= 0 || now() > deadline) return null;
    var defender = B.opponent(attacker);

    // 五が作れるならそれで終わり
    var immediate = winningPoints(board, attacker);
    if (immediate.length) {
      return [{ x: immediate[0][0], y: immediate[0][1], player: attacker, forced: false }];
    }

    var moves = forcingMoves(board, attacker);
    for (var i = 0; i < moves.length; i++) {
      if (now() > deadline) return null;
      var m = moves[i], id = B.idx(m.x, m.y);
      board[id] = attacker;

      var result = null;
      // 相手が先に五を作れてしまう筋は失敗
      if (winningPoints(board, defender).length === 0) {
        var wins = winningPoints(board, attacker);
        if (wins.length >= 2) {
          // 受け所が2つ以上 = 両方は止められないので詰み
          result = [
            { x: m.x, y: m.y, player: attacker, forced: false },
            { x: wins[0][0], y: wins[0][1], player: defender, forced: true },
            { x: wins[1][0], y: wins[1][1], player: attacker, forced: false }
          ];
        } else if (wins.length === 1) {
          var bx = wins[0][0], by = wins[0][1], bid = B.idx(bx, by);
          board[bid] = defender;
          if (!winAt(board, bx, by)) {
            var sub = vcf(board, attacker, depth - 1, deadline);
            if (sub) {
              result = [
                { x: m.x, y: m.y, player: attacker, forced: false },
                { x: bx, y: by, player: defender, forced: true }
              ].concat(sub);
            }
          }
          board[bid] = EMPTY;
        }
      }

      board[id] = EMPTY;
      if (result) return result;
    }
    return null;
  }

  /** 四（以上）を作る手だけを列挙する。相手に応手を強制できる手。 */
  function forcingMoves(board, attacker) {
    var cands = B.candidates(board, 1);
    var out = [];
    for (var i = 0; i < cands.length; i++) {
      var x = cands[i][0], y = cands[i][1];
      if (forbidden(board, x, y, attacker)) continue;    // 禁じ手では追えない
      var best = threatLevel(board, x, y, attacker);
      if (best >= SCORE.FOUR) out.push({ x: x, y: y, s: best });
    }
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, 12);
  }

  /* --- ヒント -------------------------------------------------------- */

  /**
   * 現局面での推奨手と、その理由のラベルを返す。
   * 手の選択は難易度に依らず常に最強設定で行う。
   */
  function suggest(board, player) {
    var move = chooseMove(board, player, 'hard');
    if (!move) return null;
    var opp = B.opponent(player);
    var mine = threatLevel(board, move.x, move.y, player);
    var theirs = threatLevel(board, move.x, move.y, opp);
    var oppWins = B.winningPoints(board, opp).length > 0;

    var label;
    if (mine >= SCORE.FIVE) label = '五が完成して勝ちになります';
    else if (oppWins && theirs >= SCORE.FIVE) label = '相手の五を止める、受けなければ負ける一手';
    else if (mine >= SCORE.OPEN4) label = '四を作って相手に応手を強制できます';
    else if (theirs >= SCORE.OPEN4) label = '相手の四を防ぐ受けの一手';
    else if (theirs >= SCORE.OPEN3) label = '相手の三を止めて攻めを遅らせます';
    else if (mine >= SCORE.OPEN3) label = '三を作って攻めを組み立てます';
    else if (mine >= SCORE.OPEN2) label = '石を繋いで次の狙いを作ります';
    else label = '形を整える一手です';

    return { x: move.x, y: move.y, label: label };
  }

  /** 条件に合う手のうち tie は key の大きいものを選ぶ */
  function pickBy(moves, test, key) {
    var best = null;
    for (var i = 0; i < moves.length; i++) {
      if (!test(moves[i])) continue;
      if (!best || moves[i][key] > best[key]) best = moves[i];
    }
    return best;
  }

  function xy(m) { return { x: m.x, y: m.y }; }

  global.CG.AI = {
    chooseMove: chooseMove,
    findMate: findMate,
    suggest: suggest,
    threatLevel: threatLevel,
    directionScores: directionScores,
    setRandom: setRandom,
    setRules: setRules,
    winningPoints: winningPoints,
    winAt: winAt,
    evalPoint: evalPoint,
    evalBoard: evalBoard,
    SCORE: SCORE,
    LEVELS: LEVELS
  };
})(window);
