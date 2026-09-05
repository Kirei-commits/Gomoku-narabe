import { test, expect } from '@playwright/test';
import { openGame, usePvp } from './fixtures.mjs';

test.describe('レイアウトと操作性', () => {
  test('横スクロールが発生しない', async ({ page }) => {
    await openGame(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  // WCAG 2.5.5(AAA) と Apple HIG が示す 44px を主要操作の下限とする
  test('主要な操作ボタンのタップ領域が44px以上ある', async ({ page }) => {
    await openGame(page);
    for (const id of ['#btn-back', '#btn-forward', '#btn-hint', '#btn-mate']) {
      const box = await page.locator(id).boundingBox();
      expect(box.height, `${id} の高さ`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${id} の幅`).toBeGreaterThanOrEqual(44);
    }
  });

  test('操作バーが盤面の直下、最初の表示範囲に収まる', async ({ page }) => {
    await openGame(page);
    const bar = await page.locator('.actionbar').boundingBox();
    const view = page.viewportSize();
    expect(bar.y + bar.height).toBeLessThanOrEqual(view.height);
  });

  test('盤面は正方形で、画面幅を超えない', async ({ page }) => {
    await openGame(page);
    const box = await page.locator('#board').boundingBox();
    const view = page.viewportSize();
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    expect(box.width).toBeLessThanOrEqual(view.width);
  });

  test('画面サイズを変えても着手位置がずれない', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    const view = page.viewportSize();
    await page.setViewportSize({ width: Math.round(view.width * 0.7), height: view.height });
    await page.waitForTimeout(400);                 // ResizeObserver の反映を待つ
    await g.click(9, 9);
    if (await g.moveCount() === 0) await g.click(9, 9);   // タップ確認ONの端末では2回必要
    await expect(page.locator('#log li').first()).toContainText('J10');
  });

  test('主要な操作に説明可能な状態が付いている', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#board')).toHaveAttribute('aria-label', /盤面/);
    await expect(page.locator('#btn-sound')).toHaveAttribute('aria-pressed', /true|false/);
    await expect(page.locator('.actionbar')).toHaveAttribute('aria-label', /操作/);
  });

  test('キーボードでフォーカスを移せる', async ({ page }) => {
    await openGame(page);
    await page.locator('#btn-hint').focus();
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('btn-hint');
  });
});
