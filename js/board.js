/**
 * board.js — 盤面の状態と勝敗判定（副作用のない純粋ロジック）
 * 盤は Int8Array(SIZE*SIZE)、値は EMPTY / P1 / P2。
 */
(function (global) {
  'use strict';

  var SIZE = 15;
  var EMPTY = 0, P1 = 1, P2 = 2;
  var WIN_LEN = 5;

  /** 4方向（右, 下, 右下, 右上）。逆方向は探索時に符号反転で扱う。 */
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function idx(x, y) { return y * SIZE + x; }
  function inBounds(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }
  function opponent(p) { return p === P1 ? P2 : P1; }

  function create() { return new Int8Array(SIZE * SIZE); }

  function get(board, x, y) {
    return inBounds(x, y) ? board[idx(x, y)] : -1; // 盤外は -1
  }

  /**
   * (x,y) に置かれた石を起点に WIN_LEN 連が成立しているか調べる。
   * @returns {Array<[number,number]>|null} 勝ち筋のマス列（長連の場合は全体）
   */
  function findWinLine(board, x, y) {
    var player = get(board, x, y);
    if (player !== P1 && player !== P2) return null;

    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var cells = [[x, y]];

      for (var s = -1; s <= 1; s += 2) {
        var cx = x + dx * s, cy = y + dy * s;
        while (get(board, cx, cy) === player) {
          if (s < 0) cells.unshift([cx, cy]); else cells.push([cx, cy]);
          cx += dx * s; cy += dy * s;
        }
      }
      if (cells.length >= WIN_LEN) return cells;
    }
    return null;
  }

  /** 空きマスが無ければ true（引き分け判定用） */
  function isFull(board) {
    for (var i = 0; i < board.length; i++) if (board[i] === EMPTY) return false;
    return true;
  }

  /** 既存の石から距離 range 以内の空きマス一覧（探索の候補手） */
  function candidates(board, range) {
    var r = range || 2;
    var out = [];
    var hasStone = false;

    for (var i = 0; i < board.length; i++) {
      if (board[i] !== EMPTY) { hasStone = true; break; }
    }
    if (!hasStone) return [[(SIZE - 1) >> 1, (SIZE - 1) >> 1]];

    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        if (board[idx(x, y)] !== EMPTY) continue;
        var near = false;
        for (var dy = -r; dy <= r && !near; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            var v = get(board, x + dx, y + dy);
            if (v === P1 || v === P2) { near = true; break; }
          }
        }
        if (near) out.push([x, y]);
      }
    }
    return out;
  }

  /** 座標の表記（例: H8）。列は A..O、行は 1..15。 */
  function toCoord(x, y) {
    return String.fromCharCode(65 + x) + (y + 1);
  }

  global.CG = global.CG || {};
  global.CG.Board = {
    SIZE: SIZE, EMPTY: EMPTY, P1: P1, P2: P2, WIN_LEN: WIN_LEN, DIRS: DIRS,
    idx: idx, inBounds: inBounds, opponent: opponent, create: create, get: get,
    findWinLine: findWinLine, isFull: isFull, candidates: candidates, toCoord: toCoord
  };
})(window);
