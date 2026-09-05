import { test, expect } from '@playwright/test';
import { openGame, usePvp } from './fixtures.mjs';

test.describe('巻き戻し / 早送り', () => {
  test('1手ずつ戻って進める', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [8, 8], [6, 6], [9, 9]]) await g.click(x, y);
    expect(await g.moveCount()).toBe(4);

    await page.locator('#btn-back').click();
    await page.locator('#btn-back').click();
    expect(await g.moveCount()).toBe(2);
    await expect(page.locator('#review-badge')).toBeVisible();
    await expect(page.locator('#status-text')).toContainText('2 / 4');

    await page.locator('#btn-forward').click();
    expect(await g.moveCount()).toBe(3);

    await page.locator('#btn-latest').click();
    expect(await g.moveCount()).toBe(4);
    await expect(page.locator('#review-badge')).toBeHidden();
  });

  test('巻き戻した先の手はログに薄く残る', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [8, 8], [6, 6]]) await g.click(x, y);
    await page.locator('#btn-back').click();
    await expect(page.locator('#log li.future')).toHaveCount(1);
    await page.locator('#btn-latest').click();
    await expect(page.locator('#log li.future')).toHaveCount(0);
  });

  test('巻き戻した局面から打つと、その先の手は破棄される', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [8, 8], [6, 6], [9, 9]]) await g.click(x, y);
    await page.locator('#btn-back').click();
    await page.locator('#btn-back').click();
    await g.click(2, 2);
    expect(await g.moveCount()).toBe(3);
    await expect(page.locator('#log li.future')).toHaveCount(0);
    await expect(page.locator('#btn-forward')).toBeDisabled();
  });

  test('最初の局面では「戻る」が無効', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#btn-back')).toBeDisabled();
    await expect(page.locator('#btn-forward')).toBeDisabled();
  });

  test('AI戦: 巻き戻し中はAIが動かず、打ち直すと再開する', async ({ page }) => {
    const g = await openGame(page);
    await page.selectOption('#level', 'normal');
    await page.waitForTimeout(300);
    await g.click(7, 7);
    await expect.poll(g.moveCount, { timeout: 8000 }).toBe(2);

    await page.locator('#btn-back').click();
    await expect(page.locator('#status-text')).toContainText('CPU');
    await page.waitForTimeout(1500);
    expect(await g.moveCount()).toBe(1);          // 巻き戻し中はAIが打たない

    await page.locator('#btn-back').click();
    await g.click(8, 8);
    await expect.poll(g.moveCount, { timeout: 8000 }).toBe(2);
  });

  test('キーボードの U / I でも前後できる', async ({ page }) => {
    const g = await openGame(page);
    await usePvp(page);
    for (const [x, y] of [[7, 7], [8, 8]]) await g.click(x, y);
    await page.keyboard.press('u');
    expect(await g.moveCount()).toBe(1);
    await page.keyboard.press('i');
    expect(await g.moveCount()).toBe(2);
  });
});
