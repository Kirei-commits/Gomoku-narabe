/**
 * rules.js — 禁じ手（長連・三三・四四）の判定
 *
 * 連珠では先手にのみ禁じ手が課される。ここでは実用的な近似として、
 * 「その一手が作る形」を方向ごとに数えて判定する
 * （本来の連珠は再帰的な禁点解析を伴うが、対局用途にはこの判定で足りる）。
 *
 * 五が完成する手は、たとえ他の禁じ手の形を含んでいても常に合法（五連優先）。
 */
(function (global) {
  'use strict';

  var B = global.CG.Board;
  var AI = global.CG.AI;

  /** 選べるルールセット。UIの選択肢と1対1に対応する。 */
  var PRESETS = {
    free: {
      id: 'free',
      label: '自由五目（禁じ手なし）',
      short: '自由五目',
      overline: false, doubleThree: false, doubleFour: false,
      scope: 'none',
      note: '禁じ手はありません。6連以上でも勝ちです。'
    },
    renju: {
      id: 'renju',
      label: '連珠（先手に三三・四四・長連 禁止）',
      short: '連珠',
      overline: true, doubleThree: true, doubleFour: true,
      scope: 'first',
      note: '先手のみ 三三・四四・長連 が禁じ手です。後手に制限はありません。'
    },
    overline: {
      id: 'overline',
      label: '長連禁止（両者）',
      short: '長連禁止',
      overline: true, doubleThree: false, doubleFour: false,
      scope: 'both',
      note: '両者とも6連以上は打てません。ちょうど5連で勝ちです。'
    },
    three: {
      id: 'three',
      label: '三三禁止（先手のみ）',
      short: '三三禁止',
      overline: false, doubleThree: true, doubleFour: false,
      scope: 'first',
      note: '先手は三三（活三を同時に2つ作る手）を打てません。'
    }
  };

  function get(id) { return PRESETS[id] || PRESETS.free; }

  /** そのプレイヤーに禁じ手が適用されるか */
  function applies(rules, player) {
    if (!rules || rules.scope === 'none') return false;
    if (rules.scope === 'both') return true;
    return player === B.P1;                    // 'first' = 先手のみ
  }

  /** (x,y) に player を置いたときの、方向 d の連の長さ */
  function runLength(board, x, y, d, player) {
    var dx = B.DIRS[d][0], dy = B.DIRS[d][1], n = 1;
    for (var s = -1; s <= 1; s += 2) {
      var cx = x + dx * s, cy = y + dy * s;
      while (B.get(board, cx, cy) === player) { n++; cx += dx * s; cy += dy * s; }
    }
    return n;
  }

  /** (x,y) に置いたときにできる最大の連の長さ（石は置かずに数える） */
  function maxRun(board, x, y, player) {
    var best = 0;
    for (var d = 0; d < B.DIRS.length; d++) {
      var n = runLength(board, x, y, d, player);
      if (n > best) best = n;
    }
    return best;
  }

  /**
   * 禁じ手かどうか。
   * @returns {string|null} 禁じ手なら理由（'長連' など）、合法なら null
   */
  function forbiddenReason(board, x, y, player, rules) {
    if (!applies(rules, player)) return null;
    if (!B.inBounds(x, y) || board[B.idx(x, y)] !== B.EMPTY) return null;

    // ちょうど5連ができる手は常に合法（五連優先）
    var longest = 0;
    for (var d = 0; d < B.DIRS.length; d++) {
      var n = runLength(board, x, y, d, player);
      if (n === 5) return null;
      if (n > longest) longest = n;
    }

    if (rules.overline && longest >= 6) return '長連';

    if (rules.doubleThree || rules.doubleFour) {
      var scores = AI.directionScores(board, x, y, player);
      var openThrees = 0, fours = 0;
      for (var i = 0; i < scores.length; i++) {
        if (scores[i] === AI.SCORE.OPEN3) openThrees++;
        if (scores[i] >= AI.SCORE.FOUR && scores[i] < AI.SCORE.FIVE) fours++;
      }
      if (rules.doubleFour && fours >= 2) return '四四';
      if (rules.doubleThree && openThrees >= 2) return '三三';
    }
    return null;
  }

  function isForbidden(board, x, y, player, rules) {
    return forbiddenReason(board, x, y, player, rules) !== null;
  }

  /**
   * 勝ちの並び。長連禁止のときは6連以上を勝ちとしない
   * （長連は禁じ手なのでそもそも打てないが、念のため勝ち判定側でも弾く）。
   */
  function winLine(board, x, y, rules) {
    var line = B.findWinLine(board, x, y);
    if (!line) return null;
    if (rules && rules.overline && line.length > 5) return null;
    return line;
  }

  /** 現在の手番で打てない点の一覧（盤面に×印を出すために使う） */
  function forbiddenPoints(board, player, rules) {
    if (!applies(rules, player)) return [];
    var out = [];
    var cands = B.candidates(board, 2);
    for (var i = 0; i < cands.length; i++) {
      var x = cands[i][0], y = cands[i][1];
      if (forbiddenReason(board, x, y, player, rules)) out.push([x, y]);
    }
    return out;
  }

  global.CG.Rules = {
    PRESETS: PRESETS,
    get: get,
    applies: applies,
    maxRun: maxRun,
    forbiddenReason: forbiddenReason,
    isForbidden: isForbidden,
    winLine: winLine,
    forbiddenPoints: forbiddenPoints
  };
})(window);
