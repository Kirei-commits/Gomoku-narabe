import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCG, makeBoard, pad, selfPlay, seededRandom, EMPTY_ROW as E } from './helpers.mjs';

const { Board: B, AI } = loadCG();
const LEVELS = ['easy', 'normal', 'hard'];

// EASY は乱数でゆらぐため、固定シードにしてテストを決定的にする
AI.setRandom(seededRandom());

describe('ai — どの難易度でも外してはいけない着手', () => {
  for (const level of LEVELS) {
    test(`${level}: 五が作れるならそこに打つ`, () => {
      const b = makeBoard(B, pad([E, E, E, '...oooo.......']));
      const m = AI.chooseMove(b, B.P2, level);
      assert.equal(m.y, 3);
      assert.ok(m.x === 2 || m.x === 7, `想定外の着手 ${B.toCoord(m.x, m.y)}`);
    });

    test(`${level}: 相手の四は必ず止める`, () => {
      const b = makeBoard(B, pad([E, E, '...xxxx.......']));
      const m = AI.chooseMove(b, B.P2, level);
      assert.equal(m.y, 2);
      assert.ok(m.x === 2 || m.x === 7, `想定外の着手 ${B.toCoord(m.x, m.y)}`);
    });

    test(`${level}: 空の盤では中央に打つ`, () => {
      const m = AI.chooseMove(B.create(), B.P1, level);
      assert.deepEqual([m.x, m.y], [7, 7]);
    });

    test(`${level}: 必ず空点を返す`, () => {
      const b = makeBoard(B, pad([E, E, '....xx........', '.....ox.......', '....o.o.......']));
      const m = AI.chooseMove(b, B.P2, level);
      assert.equal(b[B.idx(m.x, m.y)], B.EMPTY);
    });
  }

  for (const level of ['normal', 'hard']) {
    test(`${level}: 相手の活三を止める`, () => {
      const b = makeBoard(B, pad([E, E, E, '....xxx.......']));
      const m = AI.chooseMove(b, B.P2, level);
      assert.equal(m.y, 3);
      assert.ok(m.x === 3 || m.x === 7, `想定外の着手 ${B.toCoord(m.x, m.y)}`);
    });
  }
});

describe('ai — 応答速度（体感を損なわない上限を守る）', () => {
  for (const [level, limit] of [['easy', 200], ['normal', 600], ['hard', 1500]]) {
    test(`${level} は1手 ${limit}ms 未満で返す`, () => {
      const r = selfPlay(B, AI, level, level, { x: 7, y: 7 });
      assert.notEqual(r.winner, -1, '不正な着手を返した');
      assert.ok(r.worstMs < limit, `最悪 ${r.worstMs.toFixed(0)}ms（上限 ${limit}ms）`);
    });
  }
});

describe('ai — 自動対戦の整合性', () => {
  test('20局すべてが不正手なく決着する', () => {
    for (let g = 0; g < 20; g++) {
      const seed = { x: 5 + (g % 5), y: 5 + ((g / 5) | 0) };
      const p1 = LEVELS[g % 3], p2 = LEVELS[(g + 1) % 3];
      const r = selfPlay(B, AI, p1, p2, seed);
      assert.notEqual(r.winner, -1, `${p1} vs ${p2} が不正手を返した`);
      assert.ok(r.moves <= 225);
    }
  });
});

describe('ai — 難易度の序列', () => {
  // 開幕をずらして同一棋譜の繰り返しを避ける（固定開幕だと同じ対局が並ぶだけで意味がない）
  const match = (strong, weak, games) => {
    AI.setRandom(seededRandom(42));      // 対戦ごとに同じ乱数列から始める
    let strongWin = 0, weakWin = 0;
    for (let i = 0; i < games; i++) {
      const seed = { x: 5 + (i % 5), y: 6 + (i % 3) };
      const r = i % 2 === 0
        ? selfPlay(B, AI, strong, weak, seed)
        : selfPlay(B, AI, weak, strong, seed);
      const strongIs = i % 2 === 0 ? B.P1 : B.P2;
      if (r.winner === strongIs) strongWin++;
      else if (r.winner > 0) weakWin++;
    }
    return { strongWin, weakWin };
  };

  test('HARD は NORMAL より強い', () => {
    const r = match('hard', 'normal', 10);
    assert.ok(r.strongWin > r.weakWin, `HARD ${r.strongWin}勝 / NORMAL ${r.weakWin}勝`);
  });

  test('NORMAL は EASY より強い', () => {
    const r = match('normal', 'easy', 10);
    assert.ok(r.strongWin > r.weakWin, `NORMAL ${r.strongWin}勝 / EASY ${r.weakWin}勝`);
  });
});

describe('ai — ヒント', () => {
  test('相手の四に対しては受けを勧める', () => {
    const b = makeBoard(B, pad([E, E, '...xxxx.......']));
    const h = AI.suggest(b, B.P2);
    assert.equal(h.y, 2);
    assert.ok(h.x === 2 || h.x === 7);
    assert.ok(h.label.length > 0);
  });

  test('自分が五を作れるならそれを勧める', () => {
    const b = makeBoard(B, pad([E, E, '...xxxx.......']));
    const h = AI.suggest(b, B.P1);
    assert.match(h.label, /五/);
  });

  test('空の盤でも手を返す', () => {
    const h = AI.suggest(B.create(), B.P1);
    assert.deepEqual([h.x, h.y], [7, 7]);
  });

  test('推奨手は必ず空点', () => {
    const b = makeBoard(B, pad([E, E, '....xx........', '.....ox.......']));
    const h = AI.suggest(b, B.P1);
    assert.equal(b[B.idx(h.x, h.y)], B.EMPTY);
  });
});

describe('ai — 脅威度の判定', () => {
  test('四は活三より高く評価される', () => {
    const four = makeBoard(B, pad([E, '...xxx........']));
    const three = makeBoard(B, pad([E, '...xx.........']));
    assert.ok(AI.threatLevel(four, 6, 1, B.P1) > AI.threatLevel(three, 5, 1, B.P1));
  });

  test('石のあるマスは -1 を返す', () => {
    const b = makeBoard(B, pad([E, '...x..........']));
    assert.equal(AI.threatLevel(b, 3, 1, B.P1), -1);
  });
});
