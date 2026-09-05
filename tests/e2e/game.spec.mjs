import { test, expect } from '@playwright/test';
import { openGame, usePvp } from './fixtures.mjs';

test.describe('対局の基本', () => {
  test('起動時にエラーが出ず、盤面と操作バーが表示される', async ({ page }) => {
    const g = await openGame(page);
    await expect(page).toHaveTitle(/NEURO GOMOKU/);
    await expect(page.locator('.actionbar')).toBeVisible();
    await expect(page.locator('#status')).toBeVisible();
    const box = await page.locator('#board').boundingBox();
    expect(box.width).toBeGreaterThan(200);
    expect(box.width).toBeCloseTo(box.height, 0);      // 盤は正方形
    expect(g.errors).toEqual([]);
  });

  test('5連で勝敗が確定し、結果とスコアが記録される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [0, 0], [8, 7], [0, 1], [9, 7], [0, 2], [10, 7], [0, 3]]) {
      await g.click(x, y);
    }
    expect(await g.moveCount()).toBe(8);
    await g.click(11, 7);
    await page.waitForTimeout(1200);

    await expect(page.locator('#overlay')).toBeVisible();
    await expect(page.locator('#overlay-title')).toHaveText('PLAYER 1 WIN');
    await expect(page.locator('#s1')).toHaveText('1');
    expect(g.errors).toEqual([]);
  });

  test('埋まっているマスには打てない', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.click(7, 7);
    await g.click(7, 7);
    expect(await g.moveCount()).toBe(1);
  });

  test('戦績と設定がリロード後も残る', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [0, 0], [8, 7], [0, 1], [9, 7], [0, 2], [10, 7], [0, 3], [11, 7]]) {
      await g.click(x, y);
    }
    await page.waitForTimeout(1000);

    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.locator('.seg-btn[data-mode="pvp"]')).toHaveClass(/is-active/);
    await expect(page.locator('#s1')).toHaveText('1');
  });

  test('スコアをリセットできる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [0, 0], [8, 7], [0, 1], [9, 7], [0, 2], [10, 7], [0, 3], [11, 7]]) {
      await g.click(x, y);
    }
    await page.waitForTimeout(1000);
    await page.locator('#btn-reset-score').click();
    await expect(page.locator('#s1')).toHaveText('0');
    await expect(page.locator('#s2')).toHaveText('0');
  });

  test('サウンドの切り替えが表示に反映される', async ({ page }) => {
    await openGame(page);
    const btn = page.locator('#btn-sound');
    await btn.click();
    await expect(btn).toContainText('OFF');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.click();
    await expect(btn).toContainText('ON');
  });
});

test.describe('AI対戦', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    test(`${level}: 着手するとAIが応手する`, async ({ page }) => {
      const g = await openGame(page);
      await page.selectOption('#level', level);
      await page.waitForTimeout(300);
      await g.click(7, 7);
      await expect.poll(g.moveCount, { timeout: 8000 }).toBe(2);
      await expect(page.locator('#status-text')).toContainText('あなた');
      expect(g.errors).toEqual([]);
    });
  }

  test('AIが先手の設定では、開始と同時にAIが打つ', async ({ page }) => {
    const g = await openGame(page);
    await page.selectOption('#first', 'ai');
    await expect.poll(g.moveCount, { timeout: 8000 }).toBe(1);
  });

  test('AI思考中に新規対局しても、二重に着手されない', async ({ page }) => {
    const g = await openGame(page);
    await page.selectOption('#level', 'hard');
    await page.waitForTimeout(300);
    await g.click(7, 7);
    await page.locator('#btn-new').click();          // 応手が返る前にリセット
    await page.waitForTimeout(2500);
    expect(await g.moveCount()).toBe(0);
    await expect(page.locator('#overlay')).toBeHidden();

    await g.click(7, 7);                             // その後も対局は継続できる
    await expect.poll(g.moveCount, { timeout: 8000 }).toBe(2);
  });
});
