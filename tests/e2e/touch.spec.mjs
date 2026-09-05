import { test, expect } from '@playwright/test';
import { openGame, usePvp } from './fixtures.mjs';

// 指での操作に関する検証。mobile プロジェクト（hasTouch / pointer:coarse）でのみ動かす。
test.describe('タッチ操作', () => {
  test.skip(({ isMobile }) => !isMobile, 'タッチ端末向けの検証');

  test('タッチ端末では既定でタップ確認がON', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#btn-confirm-tap')).toContainText('ON');
    await expect(page.locator('#btn-confirm-tap')).toHaveAttribute('aria-pressed', 'true');
  });

  test('1回目のタップでは着手されず、位置が表示される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.tap(7, 7);
    expect(await g.moveCount()).toBe(0);
    await expect(page.locator('#status-text')).toContainText('H8');
    await expect(page.locator('#status-text')).toContainText('選択中');
  });

  test('同じ場所を2回タップすると着手される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.tap(7, 7);
    await g.tap(7, 7);
    expect(await g.moveCount()).toBe(1);
    await expect(page.locator('#log li').first()).toContainText('H8');
  });

  test('別のマスをタップすると選択位置が移る', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.tap(7, 7);
    await g.tap(5, 5);
    expect(await g.moveCount()).toBe(0);
    await expect(page.locator('#status-text')).toContainText('F6');
    await g.tap(5, 5);
    expect(await g.moveCount()).toBe(1);
    await expect(page.locator('#log li').first()).toContainText('F6');
  });

  // 感度の回帰防止: 交点から離れたタップでも最寄りの交点に入ること
  for (const [dx, dy, label] of [[0.42, -0.40, '右上にずれたタップ'], [-0.45, 0.45, '左下にずれたタップ']]) {
    test(`${label}でも最寄りの交点を選ぶ`, async ({ page }) => {
      const g = await openGame(page);
      await usePvp(page);
      await g.tap(9, 9, { offsetX: dx, offsetY: dy });
      await expect(page.locator('#status-text')).toContainText('J10');
      await g.tap(9, 9, { offsetX: dx, offsetY: dy });
      expect(await g.moveCount()).toBe(1);
    });
  }

  test('盤の角(A1)にも打てる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.tap(0, 0, { offsetX: -0.3, offsetY: -0.3 });
    await g.tap(0, 0, { offsetX: -0.3, offsetY: -0.3 });
    expect(await g.moveCount()).toBe(1);
    await expect(page.locator('#log li').first()).toContainText('A1');
  });

  test('盤の反対の角(O15)にも打てる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.tap(14, 14, { offsetX: 0.3, offsetY: 0.3 });
    await g.tap(14, 14, { offsetX: 0.3, offsetY: 0.3 });
    expect(await g.moveCount()).toBe(1);
    await expect(page.locator('#log li').first()).toContainText('O15');
  });

  test('タップ確認をOFFにすると1回のタップで着手する', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await page.locator('#btn-confirm-tap').click();
    await expect(page.locator('#btn-confirm-tap')).toContainText('OFF');
    await g.tap(7, 7);
    await g.tap(7, 7);
    expect(await g.moveCount()).toBe(2);          // 確認が不要なので2手入る
  });

  test('タップ確認の設定はリロード後も保持される', async ({ page }) => {
    await openGame(page);
    await page.locator('#btn-confirm-tap').click();
    await expect(page.locator('#btn-confirm-tap')).toContainText('OFF');
    await page.reload();
    await page.waitForTimeout(400);
    await expect(page.locator('#btn-confirm-tap')).toContainText('OFF');
  });
});
