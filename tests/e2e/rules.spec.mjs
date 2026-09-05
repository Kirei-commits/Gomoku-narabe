import { test, expect } from '@playwright/test';
import { openGame, usePvp } from './fixtures.mjs';

test.describe('禁じ手ルール', () => {
  test('既定は自由五目で、説明が表示される', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#ruleset')).toHaveValue('free');
    await expect(page.locator('#rule-note')).toContainText('禁じ手はありません');
  });

  test('ルールを選ぶと説明が切り替わり、リロード後も保持される', async ({ page }) => {
    await openGame(page);
    await page.selectOption('#ruleset', 'renju');
    await expect(page.locator('#rule-note')).toContainText('先手のみ');
    await page.reload();
    await page.waitForTimeout(400);
    await expect(page.locator('#ruleset')).toHaveValue('renju');
    await expect(page.locator('#rule-note')).toContainText('先手のみ');
  });

  test('連珠では先手の三三が拒否される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await page.selectOption('#ruleset', 'renju');
    await page.waitForTimeout(300);

    // 先手に縦(G4,G5)と横(E6,F6)を作らせる。G6 が三三になる。
    for (const [x, y] of [[6, 3], [0, 0], [6, 4], [0, 1], [4, 5], [0, 2], [5, 5], [0, 3]]) {
      await g.place(x, y);
    }
    expect(await g.moveCount()).toBe(8);

    await g.place(6, 5);
    expect(await g.moveCount()).toBe(8);                     // 打てていない
    await expect(page.locator('#status-text')).toContainText('禁じ手');
    await expect(page.locator('#status-text')).toContainText('三三');
  });

  test('自由五目では同じ手が打てる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await page.selectOption('#ruleset', 'free');
    await page.waitForTimeout(300);
    for (const [x, y] of [[6, 3], [0, 0], [6, 4], [0, 1], [4, 5], [0, 2], [5, 5], [0, 3]]) {
      await g.place(x, y);
    }
    await g.place(6, 5);
    expect(await g.moveCount()).toBe(9);
  });

  test('長連禁止では6連が勝ちにならず、その手自体が打てない', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await page.selectOption('#ruleset', 'overline');
    await page.waitForTimeout(300);

    // 先手: C2,D2,E2 と G2,H2 → F2 に打つと6連（長連）になる。
    // 後手の埋め手は、それ自体が5連にならないよう散らして置く。
    for (const [x, y] of [[2, 1], [0, 10], [3, 1], [2, 12], [4, 1], [4, 10], [6, 1], [6, 12], [7, 1], [8, 10]]) {
      await g.place(x, y);
    }
    expect(await g.moveCount()).toBe(10);
    await g.place(5, 1);
    expect(await g.moveCount()).toBe(10);
    await expect(page.locator('#status-text')).toContainText('長連');
  });

  test('禁じ手の点が盤上に印として出る', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await page.selectOption('#ruleset', 'renju');
    await page.waitForTimeout(300);
    for (const [x, y] of [[6, 3], [0, 0], [6, 4], [0, 1], [4, 5], [0, 2], [5, 5], [0, 3]]) {
      await g.place(x, y);
    }
    const marks = await page.evaluate(() => {
      const st = window.CG.game.state;
      return window.CG.Rules.forbiddenPoints(st.board, 1, st.rules).length;
    });
    expect(marks).toBeGreaterThan(0);
  });
});
