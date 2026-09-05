import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCG, makeBoard, pad, validateMate, seededRandom, EMPTY_ROW as E } from './helpers.mjs';

const { Board: B, AI } = loadCG();
AI.setRandom(seededRandom());

describe('詰み筋(VCF) — 基本', () => {
  test('四が出来ていれば1手詰めを返す', () => {
    const b = makeBoard(B, pad([E, E, '...xxxx.......']));
    const r = AI.findMate(b, B.P1);
    assert.ok(r, '詰み筋を見つけられなかった');
    assert.equal(r.moves.length, 1);
    assert.equal(validateMate(B, b, B.P1, r.moves), null);
  });

  test('空の盤では詰み筋なし', () => {
    assert.equal(AI.findMate(B.create(), B.P1), null);
  });

  test('二連だけでは詰み筋なし', () => {
    const b = makeBoard(B, pad([E, E, '.....xx.......']));
    assert.equal(AI.findMate(b, B.P1), null);
  });

  test('相手に受けられない五があり自分に何も無ければ null', () => {
    const b = makeBoard(B, pad([E, E, '...xxx........', '....oooo......']));
    assert.equal(AI.findMate(b, B.P1), null);
  });

  // 回帰: 自分が即五を作れるのに、相手も四を持っていると詰みを見落としていた
  test('相手も四を持っていても、自分の即詰みを見落とさない', () => {
    const b = makeBoard(B, pad(['x..............', 'x..............', 'x..............',
                                'x..............', E, E, E, '...oooo.......']));
    const forP2 = AI.findMate(b, B.P2);
    assert.ok(forP2, 'P2 の1手詰めを見落とした');
    assert.equal(forP2.moves.length, 1);

    const forP1 = AI.findMate(b, B.P1);
    assert.ok(forP1, 'P1 の1手詰めを見落とした');
    assert.equal(forP1.moves.length, 1);
  });

  test('手順の各手は空点で、手番が交互になっている', () => {
    const b = makeBoard(B, pad([E, E, '...xxxx.......']));
    const r = AI.findMate(b, B.P1);
    r.moves.forEach((m, i) => {
      assert.equal(b[B.idx(m.x, m.y)], B.EMPTY);
      assert.equal(m.player, i % 2 === 0 ? B.P1 : B.P2);
    });
  });
});

describe('詰み筋(VCF) — 探索の深さ', () => {
  test('maxAttacks を増やすと、より多く・より長い詰みが見つかる', () => {
    AI.setRandom(seededRandom(7));
    let shallow = 0, deep = 0, longest = 0;

    for (let g = 0; g < 10; g++) {
      const b = B.create();
      let p = B.P1;
      b[B.idx(6 + (g % 3), 7)] = p;
      p = B.P2;
      for (let n = 1; n < 40; n++) {
        if (AI.findMate(b, p, { maxAttacks: 2, budget: 800 })) shallow++;
        const r = AI.findMate(b, p, { maxAttacks: 10, budget: 2500 });
        if (r) { deep++; longest = Math.max(longest, r.moves.length); }
        const m = AI.chooseMove(b, p, p === B.P1 ? 'normal' : 'easy');
        if (!m) break;
        b[B.idx(m.x, m.y)] = p;
        if (B.findWinLine(b, m.x, m.y)) break;
        p = B.opponent(p);
      }
    }
    assert.ok(deep > shallow, `深く読んでも増えていない (浅い ${shallow} / 深い ${deep})`);
    assert.ok(longest >= 7, `長い手順が見つかっていない (最長 ${longest}手)`);
  });
});

describe('詰み筋(VCF) — 実戦局面での正当性', () => {
  test('自動対戦中に見つけた手順がすべて強制手順として成立する', () => {
    let found = 0, longest = 0, worstMs = 0;

    for (let g = 0; g < 12; g++) {
      const b = B.create();
      let p = B.P1;
      b[B.idx(6 + (g % 3), 6 + ((g / 3) | 0))] = p;
      p = B.P2;

      for (let n = 1; n < 50; n++) {
        const t0 = performance.now();
        const r = AI.findMate(b, p, { maxAttacks: 6, budget: 1500 });
        worstMs = Math.max(worstMs, performance.now() - t0);

        if (r) {
          found++;
          longest = Math.max(longest, r.moves.length);
          const err = validateMate(B, b, p, r.moves);
          assert.equal(err, null, `不正な詰み筋: ${err}`);
        }

        const m = AI.chooseMove(b, p, p === B.P1 ? 'normal' : 'easy');
        if (!m) break;
        b[B.idx(m.x, m.y)] = p;
        if (B.findWinLine(b, m.x, m.y)) break;
        p = B.opponent(p);
      }
    }

    assert.ok(found > 0, '詰み筋が1件も見つからず、検証になっていない');
    assert.ok(worstMs < 2500, `探索が遅すぎる: 最悪 ${worstMs.toFixed(0)}ms`);
    assert.ok(longest >= 1 && longest % 2 === 1, `手順長が奇数でない: ${longest}`);
  });
});
