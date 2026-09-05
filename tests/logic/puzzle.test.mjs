import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCG, validateMate, seededRandom } from './helpers.mjs';

const { Board: B, AI, Puzzle } = loadCG(['board.js', 'ai.js', 'rules.js', 'puzzle.js']);
AI.setRandom(seededRandom());

/** 生成された問題の解答を実際に再生して、詰みが成立するか確かめる */
function checkSolvable(p) {
  return validateMate(B, p.board, p.attacker, p.solution);
}

describe('puzzle — 出題の生成', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    test(`${level}: 指定手数の問題が生成される`, () => {
      const cfg = Puzzle.LEVELS[level];
      const p = Puzzle.generate({ level, budget: 6000 });
      assert.ok(p, '問題を生成できなかった');
      assert.ok(p.plies >= cfg.min && p.plies <= cfg.max,
        `手数 ${p.plies} が範囲 ${cfg.min}〜${cfg.max} の外`);
      assert.equal(p.plies % 2, 1, '攻め手で終わらない手数になっている');
    });

    test(`${level}: 解答手順が実際に詰みになっている`, () => {
      const p = Puzzle.generate({ level, budget: 6000 });
      assert.ok(p);
      assert.equal(checkSolvable(p), null);
    });
  }

  test('出題局面はまだ決着していない', () => {
    const p = Puzzle.generate({ level: 'easy', budget: 6000 });
    for (let y = 0; y < B.SIZE; y++) {
      for (let x = 0; x < B.SIZE; x++) {
        if (p.board[B.idx(x, y)] === B.EMPTY) continue;
        assert.equal(B.findWinLine(p.board, x, y), null, `出題局面が既に決着している (${B.toCoord(x, y)})`);
      }
    }
  });

  test('毎回同じ問題にはならない', () => {
    const a = Puzzle.generate({ level: 'easy', budget: 6000 });
    const b = Puzzle.generate({ level: 'easy', budget: 6000 });
    assert.notEqual(JSON.stringify(a.solution), JSON.stringify(b.solution));
  });
});

describe('puzzle — 解答の判定', () => {
  test('正解手順は最後まで受理され、受けが返る', () => {
    const p = Puzzle.generate({ level: 'easy', budget: 6000 });
    const board = Int8Array.from(p.board);
    let solved = false;

    for (let i = 0; i < p.solution.length; i += 2) {
      const m = p.solution[i];
      board[B.idx(m.x, m.y)] = p.attacker;
      const r = Puzzle.respond(board, p.attacker, m.x, m.y);
      assert.notEqual(r.status, 'miss', `${i + 1}手目 ${B.toCoord(m.x, m.y)} が失着と判定された`);
      if (r.status === 'win') { solved = true; break; }
      board[B.idx(r.reply.x, r.reply.y)] = B.opponent(p.attacker);
    }
    assert.ok(solved, '正解手順で詰みに到達しなかった');
  });

  test('脅威にならない手は失着と判定される', () => {
    const p = Puzzle.generate({ level: 'easy', budget: 6000 });
    const board = Int8Array.from(p.board);
    let far = null;
    for (let y = 0; y < B.SIZE && !far; y++) {
      for (let x = 0; x < B.SIZE; x++) {
        if (board[B.idx(x, y)] !== B.EMPTY) continue;
        if (AI.threatLevel(board, x, y, p.attacker) < AI.SCORE.FOUR) { far = [x, y]; break; }
      }
    }
    assert.ok(far, '比較用の緩手が見つからない');
    board[B.idx(far[0], far[1])] = p.attacker;
    assert.equal(Puzzle.respond(board, p.attacker, far[0], far[1]).status, 'miss');
  });

  test('受け所が2つ以上なら受け無しとして勝ちになる', () => {
    // 横と縦に同時に四を作った状態を用意する
    const board = B.create();
    [[3, 7], [4, 7], [5, 7], [7, 3], [7, 4], [7, 5]].forEach(([x, y]) => { board[B.idx(x, y)] = B.P1; });
    board[B.idx(6, 7)] = B.P1;              // 横が四
    board[B.idx(7, 6)] = B.P1;              // 縦が四
    const r = Puzzle.respond(board, B.P1, 7, 6);
    assert.equal(r.status, 'win');
    assert.ok(r.finish, '仕上げの一手が返っていない');
  });
});
