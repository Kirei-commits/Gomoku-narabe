import { expect } from '@playwright/test';

/**
 * 外部フォントはテスト対象ではない。ネットワーク状況で待ち時間や結果が変わるのを避けるため、
 * 空のスタイルシートを返して即座に解決させる（abort だと読み込み失敗がコンソールに残る）。
 */
const IGNORABLE = /ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|fonts\.gstatic/;

/** ページを開き、JSエラーを収集しつつ盤面操作の補助を返す */
export async function openGame(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORABLE.test(m.text())) errors.push('console: ' + m.text());
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  await page.goto('/');
  await expect(page.locator('#board')).toBeVisible();
  await page.waitForTimeout(400);

  const hasTouch = await page.evaluate(
    () => 'ontouchstart' in window || navigator.maxTouchPoints > 0);

  /**
   * 盤面のマス(x,y)の画面座標。
   * 他のボタンを押した拍子にページがスクロールして盤が視界外に出ることがあるため、
   * 座標を取る前に必ず盤を表示範囲へ入れる。
   */
  const point = async (x, y) => {
    const board = page.locator('#board');
    await board.scrollIntoViewIfNeeded();
    const box = await board.boundingBox();
    const cell = box.width / 16;
    return { x: box.x + cell * (1 + x), y: box.y + cell * (1 + y), cell };
  };

  return {
    errors,
    point,
    hasTouch,

    /**
     * 1手打つ。押して離すだけの最短操作。
     * 指の端末ではタップ、それ以外はクリックで、どちらも押した位置に着手される。
     */
    async place(x, y, { offsetX = 0, offsetY = 0 } = {}) {
      const p = await point(x, y);
      const px = p.x + p.cell * offsetX;
      const py = p.y + p.cell * offsetY;
      if (hasTouch) await page.touchscreen.tap(px, py);
      else await page.mouse.click(px, py);
      await page.waitForTimeout(130);
    },

    /**
     * 押したまま動かして離す操作。狙いを動かせることの検証に使う。
     * @param {boolean} releaseOutside 盤の外で離して取り消すかどうか
     */
    async drag(from, to, { releaseOutside = false } = {}) {
      const a = await point(from[0], from[1]);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.waitForTimeout(60);
      if (releaseOutside) {
        await page.mouse.move(4, 4, { steps: 8 });
      } else {
        const b = await point(to[0], to[1]);
        await page.mouse.move(b.x, b.y, { steps: 8 });
      }
      await page.waitForTimeout(60);
      await page.mouse.up();
      await page.waitForTimeout(150);
    },

    text: (sel) => page.locator(sel).innerText(),
    moveCount: async () => Number(await page.locator('#move-count').innerText())
  };
}

/** 2人プレイに切り替える（AIの応手を待たずに手順を組み立てられる） */
export async function usePvp(page) {
  await page.locator('.seg-btn[data-mode="pvp"]').click();
  await page.waitForTimeout(200);
}

/** 詰め五目モードに切り替え、問題が生成されるまで待つ */
export async function usePuzzle(page, level = 'easy') {
  await page.locator('.seg-btn[data-mode="puzzle"]').click();
  await page.waitForTimeout(200);
  await page.selectOption('#puzzle-level', level);
  await expect
    .poll(async () => page.evaluate(() => window.CG.game.state.puzzleState), { timeout: 20000 })
    .toBe('solving');
  return page.evaluate(() => {
    const p = window.CG.game.state.puzzle;
    return { plies: p.plies, attacker: p.attacker, solution: p.solution.map((m) => [m.x, m.y]) };
  });
}
