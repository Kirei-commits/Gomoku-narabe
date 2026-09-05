import { test, expect } from '@playwright/test';
import { openGame, usePuzzle } from './fixtures.mjs';

test.describe('詰め五目', () => {
  test('問題が生成され、手数と役割が表示される', async ({ page }) => {
    const g = await openGame(page);
    const puzzle = await usePuzzle(page, 'easy');
    expect(puzzle.plies).toBeGreaterThanOrEqual(5);
    expect(puzzle.plies % 2).toBe(1);                       // 攻めで終わるので奇数手
    await expect(page.locator('#status-text')).toContainText('詰ませてください');
    await expect(page.locator('#p1-name')).toContainText(puzzle.attacker === 1 ? '攻め' : '受け');
    await expect(page.locator('#btn-restart-label')).toHaveText('次の問題');
    expect(g.errors).toEqual([]);
  });

  test('正解手順を打つと正解になり、受けは自動で返る', async ({ page }) => {
    const g = await openGame(page);
    const puzzle = await usePuzzle(page, 'easy');

    for (let i = 0; i < puzzle.solution.length; i += 2) {
      const solved = await page.evaluate(() => window.CG.game.state.puzzleState === 'solved');
      if (solved) break;
      const next = await page.evaluate((idx) => {
        const s = window.CG.game.state.puzzle.solution[idx];
        return s ? [s.x, s.y] : null;
      }, i);
      if (!next) break;
      await g.place(next[0], next[1]);
      await page.waitForTimeout(700);
    }

    await expect.poll(() => page.evaluate(() => window.CG.game.state.puzzleState), { timeout: 10000 })
      .toBe('solved');
    await expect(page.locator('#s1')).not.toHaveText('0');   // 正解数が増える
    expect(g.errors).toEqual([]);
  });

  test('詰まない手を打つと失敗として知らされ、戻ってやり直せる', async ({ page }) => {
    const g = await openGame(page);
    await usePuzzle(page, 'easy');

    // 石から遠い、脅威にならない点を選ぶ
    const far = await page.evaluate(() => {
      const st = window.CG.game.state, B = window.CG.Board, AI = window.CG.AI;
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 15; x++) {
          if (st.board[B.idx(x, y)] !== 0) continue;
          if (AI.threatLevel(st.board, x, y, st.puzzle.attacker) < AI.SCORE.FOUR) return [x, y];
        }
      }
      return null;
    });
    await g.place(far[0], far[1]);
    await page.waitForTimeout(600);

    await expect(page.locator('#advice-kind')).toHaveText('MISS');
    await expect(page.locator('#advice-text')).toContainText('詰みません');
    await expect(page.locator('#s2')).not.toHaveText('0');

    await page.locator('#btn-back').click();
    await page.waitForTimeout(300);
    expect(await g.moveCount()).toBe(0);
    await expect.poll(() => page.evaluate(() => window.CG.game.state.puzzleState)).toBe('solving');
  });

  test('詰み筋ボタンで答えの手順を確認できる', async ({ page }) => {
    await openGame(page);
    const puzzle = await usePuzzle(page, 'easy');
    await page.locator('#btn-mate').click();
    await expect(page.locator('#advice-kind')).toHaveText('MATE', { timeout: 15000 });
    await expect(page.locator('#mate-list li')).toHaveCount(puzzle.plies);
  });

  test('「次の問題」で別の問題に切り替わる', async ({ page }) => {
    await openGame(page);
    const first = await usePuzzle(page, 'easy');
    await page.locator('#btn-restart').click();
    await expect.poll(() => page.evaluate(() => window.CG.game.state.puzzleState), { timeout: 20000 })
      .toBe('solving');
    const second = await page.evaluate(() => {
      const p = window.CG.game.state.puzzle;
      return p.solution.map((m) => [m.x, m.y]);
    });
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first.solution));
  });
});
