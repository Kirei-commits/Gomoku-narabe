import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCG, makeBoard, pad, toPlain, EMPTY_ROW as E } from './helpers.mjs';

const { Board: B } = loadCG(['board.js']);

describe('board — 勝敗判定', () => {
  test('横5連を勝ちと判定する', () => {
    const b = B.create();
    for (let i = 0; i < 5; i++) b[B.idx(3 + i, 7)] = B.P1;
    assert.equal(B.findWinLine(b, 5, 7).length, 5);
  });

  test('縦5連を勝ちと判定する', () => {
    const b = B.create();
    for (let i = 0; i < 5; i++) b[B.idx(3, 3 + i)] = B.P2;
    assert.equal(B.findWinLine(b, 3, 5).length, 5);
  });

  test('右下斜めの5連を勝ちと判定する', () => {
    const b = B.create();
    for (let i = 0; i < 5; i++) b[B.idx(2 + i, 2 + i)] = B.P1;
    assert.equal(B.findWinLine(b, 4, 4).length, 5);
  });

  test('右上斜めの5連を勝ちと判定する', () => {
    const b = B.create();
    for (let i = 0; i < 5; i++) b[B.idx(2 + i, 10 - i)] = B.P2;
    assert.equal(B.findWinLine(b, 4, 8).length, 5);
  });

  test('4連は勝ちではない', () => {
    const b = B.create();
    for (let i = 0; i < 4; i++) b[B.idx(3, 3 + i)] = B.P2;
    assert.equal(B.findWinLine(b, 3, 4), null);
  });

  test('6連(長連)も勝ちとする', () => {
    const b = B.create();
    for (let i = 0; i < 6; i++) b[B.idx(1 + i, 0)] = B.P1;
    assert.equal(B.findWinLine(b, 3, 0).length, 6);
  });

  test('相手の石で分断されていれば勝ちではない', () => {
    const b = B.create();
    for (let i = 0; i < 5; i++) b[B.idx(i, 0)] = i === 2 ? B.P2 : B.P1;
    assert.equal(B.findWinLine(b, 0, 0), null);
  });

  test('盤の端でも判定できる', () => {
    const b = B.create();
    for (let i = 0; i < 5; i++) b[B.idx(10 + i, 14)] = B.P1;
    assert.equal(B.findWinLine(b, 14, 14).length, 5);
  });
});

describe('board — 補助関数', () => {
  test('isFull は空点の有無を返す', () => {
    assert.equal(B.isFull(B.create()), false);
    const full = B.create(); full.fill(B.P1);
    assert.equal(B.isFull(full), true);
  });

  test('初手の候補は中央のみ', () => {
    assert.deepEqual(toPlain(B.candidates(B.create())), [[7, 7]]);
  });

  test('候補は既存の石の近傍に限られる', () => {
    const b = B.create();
    b[B.idx(7, 7)] = B.P1;
    const c = B.candidates(b, 1);
    assert.equal(c.length, 8);                       // 中央の8近傍
    assert.ok(c.every(([x, y]) => Math.abs(x - 7) <= 1 && Math.abs(y - 7) <= 1));
  });

  test('座標表記は A1 〜 O15', () => {
    assert.equal(B.toCoord(0, 0), 'A1');
    assert.equal(B.toCoord(7, 7), 'H8');
    assert.equal(B.toCoord(14, 14), 'O15');
  });

  test('winningPoints は五が完成する空点を返す', () => {
    const b = makeBoard(B, pad([E, E, '...xxxx.......']));
    const pts = toPlain(B.winningPoints(b, B.P1)).map((p) => B.toCoord(p[0], p[1])).sort();
    assert.deepEqual(pts, ['C3', 'H3']);
  });

  test('winningPoints は五が無ければ空', () => {
    const b = makeBoard(B, pad([E, E, '...xx.........']));
    assert.deepEqual(toPlain(B.winningPoints(b, B.P1)), []);
  });

  test('inBounds が盤外を弾く', () => {
    assert.equal(B.inBounds(0, 0), true);
    assert.equal(B.inBounds(14, 14), true);
    assert.equal(B.inBounds(-1, 0), false);
    assert.equal(B.inBounds(15, 0), false);
  });
});
