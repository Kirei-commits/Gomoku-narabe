import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCG, makeBoard, pad, EMPTY_ROW as E } from './helpers.mjs';

const { Board: B, Rules } = loadCG(['board.js', 'ai.js', 'rules.js']);
const renju = Rules.get('renju');
const free = Rules.get('free');
const overlineOnly = Rules.get('overline');
const threeOnly = Rules.get('three');

describe('rules — プリセット', () => {
  test('未知のIDは自由五目にフォールバックする', () => {
    assert.equal(Rules.get('存在しない').id, 'free');
  });

  test('自由五目は誰にも適用されない', () => {
    assert.equal(Rules.applies(free, B.P1), false);
    assert.equal(Rules.applies(free, B.P2), false);
  });

  test('連珠は先手にのみ適用される', () => {
    assert.equal(Rules.applies(renju, B.P1), true);
    assert.equal(Rules.applies(renju, B.P2), false);
  });

  test('長連禁止（両者）は両方に適用される', () => {
    assert.equal(Rules.applies(overlineOnly, B.P1), true);
    assert.equal(Rules.applies(overlineOnly, B.P2), true);
  });
});

describe('rules — 長連', () => {
  const board = makeBoard(B, pad([E, 'xxx.xx........']));   // D2 に打つと6連

  test('6連になる点は長連として禁じられる', () => {
    assert.equal(Rules.forbiddenReason(board, 3, 1, B.P1, renju), '長連');
    assert.equal(Rules.maxRun(board, 3, 1, B.P1), 6);
  });

  test('自由五目では禁じられない', () => {
    assert.equal(Rules.forbiddenReason(board, 3, 1, B.P1, free), null);
  });

  test('先手のみのルールでは後手は打てる', () => {
    assert.equal(Rules.forbiddenReason(board, 3, 1, B.P2, renju), null);
  });

  test('両者に適用するルールでは後手も打てない', () => {
    const b2 = makeBoard(B, pad([E, 'ooo.oo........']));
    assert.equal(Rules.forbiddenReason(b2, 3, 1, B.P2, overlineOnly), '長連');
  });

  test('長連禁止のとき6連は勝ちにならない', () => {
    const b = B.create();
    for (let i = 0; i < 6; i++) b[B.idx(1 + i, 0)] = B.P1;
    assert.equal(B.findWinLine(b, 3, 0).length, 6);                    // 素の判定では勝ち
    assert.equal(Rules.winLine(b, 3, 0, overlineOnly), null);          // ルール適用では勝ちでない
    assert.equal(Rules.winLine(b, 3, 0, free).length, 6);
  });

  test('ちょうど5連は当然勝ち', () => {
    const b = B.create();
    for (let i = 0; i < 5; i++) b[B.idx(1 + i, 0)] = B.P1;
    assert.equal(Rules.winLine(b, 3, 0, overlineOnly).length, 5);
  });
});

describe('rules — 三三 / 四四', () => {
  // 縦(G4,G5)と横(E6,F6)があり、G6 に打つと活三が2つできる
  const doubleThree = makeBoard(B, pad([E, E, E, '......x.......', '......x.......', '....xx........']));

  test('三三は禁じられる', () => {
    assert.equal(Rules.forbiddenReason(doubleThree, 6, 5, B.P1, renju), '三三');
  });

  test('三三禁止のみのルールでも禁じられる', () => {
    assert.equal(Rules.forbiddenReason(doubleThree, 6, 5, B.P1, threeOnly), '三三');
  });

  test('自由五目では打てる', () => {
    assert.equal(Rules.forbiddenReason(doubleThree, 6, 5, B.P1, free), null);
  });

  test('三が1つだけなら禁じられない', () => {
    const single = makeBoard(B, pad([E, E, E, '......x.......', '......x.......']));
    assert.equal(Rules.forbiddenReason(single, 6, 5, B.P1, renju), null);
  });
});

describe('rules — 五連優先', () => {
  test('五が完成する手は他の形に関わらず打てる', () => {
    const b = makeBoard(B, pad([E, 'xxxx..........']));
    assert.equal(Rules.forbiddenReason(b, 4, 1, B.P1, renju), null);
  });

  test('石のあるマスや盤外は判定対象外', () => {
    const b = makeBoard(B, pad([E, 'x.............']));
    assert.equal(Rules.forbiddenReason(b, 0, 1, B.P1, renju), null);
    assert.equal(Rules.forbiddenReason(b, -1, 1, B.P1, renju), null);
  });
});

describe('rules — 禁じ手の点の列挙', () => {
  test('自由五目では空を返す', () => {
    const b = makeBoard(B, pad([E, 'xxx.xx........']));
    assert.equal(Rules.forbiddenPoints(b, B.P1, free).length, 0);
  });

  test('連珠では長連の点が含まれる', () => {
    const b = makeBoard(B, pad([E, 'xxx.xx........']));
    const pts = Rules.forbiddenPoints(b, B.P1, renju).map((p) => B.toCoord(p[0], p[1]));
    assert.ok(pts.indexOf('D2') >= 0, `D2 が含まれていない: ${pts.join(',')}`);
  });

  test('後手側には禁じ手が無い（連珠）', () => {
    const b = makeBoard(B, pad([E, 'xxx.xx........']));
    assert.equal(Rules.forbiddenPoints(b, B.P2, renju).length, 0);
  });
});

describe('rules — AIが禁じ手を打たない', () => {
  const { Board: B2, AI, Rules: R2 } = loadCG(['board.js', 'ai.js', 'rules.js']);

  test('連珠の設定で先手のAIは禁じ手を選ばない', () => {
    AI.setRules(R2.get('renju'));
    // 三三ができる形を作り、AIに何度か打たせて禁じ手を選ばないことを確かめる
    const b = makeBoard(B2, pad([E, E, E, '......x.......', '......x.......', '....xx........',
                                 E, E, '...oo.........']));
    for (let i = 0; i < 5; i++) {
      const m = AI.chooseMove(b, B2.P1, 'hard');
      assert.equal(R2.forbiddenReason(b, m.x, m.y, B2.P1, R2.get('renju')), null,
        `AIが禁じ手 ${B2.toCoord(m.x, m.y)} を選んだ`);
      b[B2.idx(m.x, m.y)] = B2.P1;
      const reply = AI.chooseMove(b, B2.P2, 'easy');
      b[B2.idx(reply.x, reply.y)] = B2.P2;
    }
    AI.setRules(null);
  });
});
