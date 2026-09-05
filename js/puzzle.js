/**
 * puzzle.js — 詰め五目（詰将棋のような「必ず詰む問題」）の自動生成
 *
 * 生成の考え方:
 *   1. 中央付近から適当に対局を進める
 *   2. 各手番で「四追い（VCF）で詰むか」を調べる
 *   3. 詰み手数が指定範囲に入ったら、その局面を問題として採用する
 *
 * 四追いは相手の受けが一意に定まるため、解答が一本道になり問題として成立する。
 */
(function (global) {
  'use strict';

  var B = global.CG.Board;
  var AI = global.CG.AI;

  /** 難易度の目安（詰みまでの手数。相手の受けも1手と数える） */
  var LEVELS = {
    easy:   { min: 5,  max: 7,  label: 'やさしい',   hint: '5〜7手' },
    normal: { min: 7,  max: 11, label: 'ふつう',     hint: '7〜11手' },
    hard:   { min: 11, max: 15, label: 'むずかしい', hint: '11〜15手' }
  };

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  /**
   * 問題を1つ生成する。
   * @param {{level?:string, budget?:number}} opts
   * @returns {{board:Int8Array, attacker:number, solution:Array, plies:number, moves:number}|null}
   */
  function generate(opts) {
    var o = opts || {};
    var cfg = LEVELS[o.level] || LEVELS.normal;
    var deadline = now() + (o.budget || 4000);

    // 生成中は禁じ手なし（自由五目）で扱う。問題の解答が禁じ手で崩れないようにする。
    var savedRules = null;
    if (AI.setRules) { AI.setRules(null); }

    var best = null;                       // 範囲外でも「詰む問題」は保険として覚えておく

    while (now() < deadline) {
      var trial = playout(cfg, deadline);
      if (!trial) continue;
      if (trial.plies >= cfg.min && trial.plies <= cfg.max) { best = trial; break; }
      if (!best || Math.abs(trial.plies - cfg.min) < Math.abs(best.plies - cfg.min)) best = trial;
    }

    void savedRules;
    return best;
  }

  /** 1局分ランダムに進めながら、条件に合う詰み局面を探す */
  function playout(cfg, deadline) {
    var board = B.create();
    var c = (B.SIZE - 1) >> 1;
    // 開幕位置をばらして、毎回同じ問題にならないようにする
    var sx = c + Math.floor(Math.random() * 5) - 2;
    var sy = c + Math.floor(Math.random() * 5) - 2;
    board[B.idx(sx, sy)] = B.P1;

    var player = B.P2;
    var maxPly = 14 + Math.floor(Math.random() * 16);   // 問題の見た目が単調にならないよう可変

    for (var n = 1; n < maxPly; n++) {
      if (now() > deadline) return null;

      // その手番の側が詰ませられるなら、それを問題にする
      var mate = AI.findMate(board, player, { maxAttacks: 8, budget: 400 });
      if (mate && mate.moves.length >= cfg.min) {
        return {
          board: Int8Array.from(board),
          attacker: player,
          solution: mate.moves,
          plies: mate.moves.length,
          moves: n
        };
      }

      var move = pickMove(board, player);
      if (!move) return null;
      board[B.idx(move.x, move.y)] = player;
      if (B.findWinLine(board, move.x, move.y)) return null;   // 決着してしまったらやり直し
      player = B.opponent(player);
    }
    return null;
  }

  /**
   * 適度にばらけた着手を選ぶ。
   * 強すぎると詰みが生まれず、弱すぎると不自然な問題になるため、
   * 「守りは堅いが攻めは緩い」EASY を基準に、時々ゆらぎを入れる。
   */
  function pickMove(board, player) {
    if (Math.random() < 0.25) {
      var cands = B.candidates(board, 1);
      if (cands.length) {
        var pick = cands[Math.floor(Math.random() * cands.length)];
        return { x: pick[0], y: pick[1] };
      }
    }
    return AI.chooseMove(board, player, 'easy');
  }

  /**
   * 攻め手が打った1手を検証し、相手の受けを返す。
   * @returns {{status:'win'|'continue'|'miss', reply?:{x:number,y:number}, mate?:object}}
   */
  function respond(board, attacker, x, y) {
    if (AI.winAt ? AI.winAt(board, x, y) : B.findWinLine(board, x, y)) {
      return { status: 'win' };
    }

    // 四になっていない手は相手に自由な手を与えるので、詰みは崩れている
    var wins = AI.winningPoints ? AI.winningPoints(board, attacker) : B.winningPoints(board, attacker);
    if (!wins.length) return { status: 'miss' };
    // 受け所が2つ以上あれば相手は止められない。最後の五を実際に打って見せる。
    if (wins.length >= 2) return { status: 'win', finish: { x: wins[0][0], y: wins[0][1] } };

    var defender = B.opponent(attacker);
    var bx = wins[0][0], by = wins[0][1];
    board[B.idx(bx, by)] = defender;
    var stillMate = AI.findMate(board, attacker, { maxAttacks: 8, budget: 800 });
    board[B.idx(bx, by)] = B.EMPTY;

    if (!stillMate) return { status: 'miss', reply: { x: bx, y: by } };
    return { status: 'continue', reply: { x: bx, y: by }, mate: stillMate };
  }

  global.CG.Puzzle = { LEVELS: LEVELS, generate: generate, respond: respond };
})(window);
