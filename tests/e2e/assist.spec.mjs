import { test, expect } from '@playwright/test';
import { openGame, usePvp } from './fixtures.mjs';

test.describe('ヒント', () => {
  test('推奨手の座標と理由が表示される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.click(7, 7);
    await g.click(3, 3);

    await page.locator('#btn-hint').click();
    await expect(page.locator('#advice')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#advice-kind')).toHaveText('HINT');
    await expect(page.locator('#advice-text')).toContainText(/[A-O]\d+/);
    expect(g.errors).toEqual([]);
  });

  test('閉じるとヒント表示が消える', async ({ page }) => {
    await openGame(page);
    await page.locator('#btn-hint').click();
    await expect(page.locator('#advice')).toBeVisible({ timeout: 5000 });
    await page.locator('#advice-close').click();
    await expect(page.locator('#advice')).toBeHidden();
  });

  test('着手するとヒント表示は消える', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await page.locator('#btn-hint').click();
    await expect(page.locator('#advice')).toBeVisible({ timeout: 5000 });
    await g.click(7, 7);
    await expect(page.locator('#advice')).toBeHidden();
  });
});

test.describe('詰み筋(VCF)', () => {
  test('四が出来ている局面では手順を提示する', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    // 先手に四を作らせ、先手の手番で探索させる
    for (const [x, y] of [[3, 7], [0, 0], [4, 7], [0, 1], [5, 7], [0, 2], [6, 7], [0, 3]]) {
      await g.click(x, y);
    }
    await page.locator('#btn-mate').click();
    await expect(page.locator('#advice-kind')).toHaveText('MATE', { timeout: 8000 });
    await expect(page.locator('#advice-text')).toContainText('詰み');
    await expect(page.locator('#mate-nav')).toBeVisible();
    await expect(page.locator('#mate-list li')).toHaveCount(1);
    await expect(page.locator('#mate-pos')).toHaveText('1 / 1');
    await expect(page.locator('#mate-prev')).toBeDisabled();
    await expect(page.locator('#mate-next')).toBeDisabled();
    expect(g.errors).toEqual([]);
  });

  test('詰み筋が無ければ、その旨を伝える', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.click(7, 7);
    await g.click(3, 3);
    await page.locator('#btn-mate').click();
    await expect(page.locator('#advice-text')).toContainText('見つかりませんでした', { timeout: 8000 });
    await expect(page.locator('#mate-nav')).toBeHidden();
  });

  test('対局が終わるとヒント/詰み筋は無効になる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [0, 0], [8, 7], [0, 1], [9, 7], [0, 2], [10, 7], [0, 3], [11, 7]]) {
      await g.click(x, y);
    }
    await page.waitForTimeout(1200);
    await expect(page.locator('#btn-hint')).toBeDisabled();
    await expect(page.locator('#btn-mate')).toBeDisabled();
  });
});
