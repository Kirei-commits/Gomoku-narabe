import { test, expect } from '@playwright/test';
import { openGame, usePvp } from './fixtures.mjs';

test.describe('着手操作（押す→動かす→離す）', () => {
  test('押して離すだけで着手できる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.place(7, 7);
    expect(await g.moveCount()).toBe(1);
    await expect(page.locator('#log li').first()).toContainText('H8');
  });

  test('押したまま動かすと狙いが移り、離した位置に置かれる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.drag([7, 7], [9, 9]);
    expect(await g.moveCount()).toBe(1);
    await expect(page.locator('#log li').first()).toContainText('J10');
  });

  test('押している間は「離すとここに置きます」と表示される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    const p = await g.point(7, 7);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await expect(page.locator('#status-text')).toContainText('H8');
    await expect(page.locator('#status-text')).toContainText('離すと');
    expect(await g.moveCount()).toBe(0);         // 離すまでは置かれない
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await g.moveCount()).toBe(1);
  });

  test('盤の外まで動かして離すと取り消される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.drag([7, 7], null, { releaseOutside: true });
    expect(await g.moveCount()).toBe(0);
    await expect(page.locator('#status-text')).toContainText('取り消');
  });

  // 感度の回帰防止: 交点から離れた位置を押しても最寄りの交点に入ること
  for (const [dx, dy, label] of [[0.42, -0.40, '右上にずれた位置'], [-0.45, 0.45, '左下にずれた位置']]) {
    test(`${label}を押しても最寄りの交点に置かれる`, async ({ page }) => {
      const g = await openGame(page);
      await usePvp(page);
      await g.place(9, 9, { offsetX: dx, offsetY: dy });
      expect(await g.moveCount()).toBe(1);
      await expect(page.locator('#log li').first()).toContainText('J10');
    });
  }

  test('盤の四隅にも置ける', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    await g.place(0, 0, { offsetX: -0.3, offsetY: -0.3 });
    await expect(page.locator('#log li').first()).toContainText('A1');
    await g.place(14, 14, { offsetX: 0.3, offsetY: 0.3 });
    await expect(page.locator('#log li').first()).toContainText('O15');
    expect(await g.moveCount()).toBe(2);
  });

  test('盤の上ではページがスクロールしない', async ({ page }) => {
    await openGame(page);
    const style = await page.evaluate(
      () => getComputedStyle(document.getElementById('board')).touchAction);
    expect(style).toBe('none');
  });
});
