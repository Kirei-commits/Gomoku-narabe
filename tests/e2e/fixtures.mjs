import { expect } from '@playwright/test';

/**
 * 外部フォントCDNへ到達できない環境（オフラインのCIやサンドボックス）では
 * 読み込み失敗のログが出るが、アプリの不具合ではないので除外する。
 */
const IGNORABLE = /ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|fonts\.gstatic/;

/** ページを開き、JSエラーを収集しつつ盤面操作の補助を返す */
export async function openGame(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORABLE.test(m.text())) errors.push('console: ' + m.text());
  });

  // 外部フォントはテスト対象ではない。ネットワーク状況で待ち時間や結果が変わるのを避けるため、
  // 空のスタイルシートを返して即座に解決させる（abort だと読み込み失敗がコンソールに残る）。
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  await page.goto('/');
  await expect(page.locator('#board')).toBeVisible();
  await page.waitForTimeout(400);          // Canvas の初期化とレイアウト確定を待つ

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
    /** マウスで着手（タップ確認OFF時は1クリックで着手される） */
    async click(x, y) {
      const p = await point(x, y);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(110);
    },
    /** 指で着手（タップ確認ONなら2回タップが必要） */
    async tap(x, y, { offsetX = 0, offsetY = 0 } = {}) {
      const p = await point(x, y);
      await page.touchscreen.tap(p.x + p.cell * offsetX, p.y + p.cell * offsetY);
      await page.waitForTimeout(160);
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
