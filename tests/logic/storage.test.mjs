import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCG, toPlain } from './helpers.mjs';

/** localStorage を模したもの。throws=true で常に例外を投げる（プライベートモード相当） */
function fakeStorage({ throws = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => { if (throws) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error('denied'); map.set(k, String(v)); },
    removeItem: (k) => { if (throws) throw new Error('denied'); map.delete(k); },
    _map: map
  };
}

describe('storage — 保存と復元', () => {
  test('保存した設定と戦績を読み戻せる', () => {
    const ls = fakeStorage();
    const { Store } = loadCG(['storage.js'], { localStorage: ls });
    const d = Store.load();
    d.stats.hard.win = 3;
    d.settings.level = 'hard';
    d.bestStreak = 5;
    Store.save(d);

    const { Store: Store2 } = loadCG(['storage.js'], { localStorage: ls });
    const again = Store2.load();
    assert.equal(again.stats.hard.win, 3);
    assert.equal(again.settings.level, 'hard');
    assert.equal(again.bestStreak, 5);
  });

  // 回帰: DEFAULTS.settings に無いキーは merge() で捨てられ、保存しても復元されなかった
  test('設定キーはすべて保存して読み戻せる', () => {
    const ls = fakeStorage();
    const { Store } = loadCG(['storage.js'], { localStorage: ls });
    const d = Store.load();
    for (const key of ['mode', 'level', 'first', 'sound', 'ruleset', 'puzzleLevel']) {
      assert.ok(key in d.settings, `${key} が既定値に定義されていない`);
    }

    d.settings.first = 'ai';
    d.settings.sound = false;
    d.settings.ruleset = 'renju';
    d.settings.puzzleLevel = 'hard';
    Store.save(d);

    const { Store: Store2 } = loadCG(['storage.js'], { localStorage: ls });
    const again = Store2.load();
    assert.equal(again.settings.first, 'ai');
    assert.equal(again.settings.sound, false);
    assert.equal(again.settings.ruleset, 'renju');
    assert.equal(again.settings.puzzleLevel, 'hard');
  });

  test('詰め五目の成績も保存できる', () => {
    const ls = fakeStorage();
    const { Store } = loadCG(['storage.js'], { localStorage: ls });
    const d = Store.load();
    assert.ok(d.stats.puzzle, 'puzzle の成績枠が無い');
    d.stats.puzzle.win = 4;
    d.stats.puzzle.lose = 1;
    Store.save(d);
    const again = loadCG(['storage.js'], { localStorage: ls }).Store.load();
    assert.equal(again.stats.puzzle.win, 4);
    assert.equal(again.stats.puzzle.lose, 1);
  });

  test('reset で初期値に戻る', () => {
    const ls = fakeStorage();
    const { Store } = loadCG(['storage.js'], { localStorage: ls });
    const d = Store.load();
    d.stats.easy.win = 9;
    Store.save(d);
    const fresh = Store.reset();
    assert.equal(fresh.stats.easy.win, 0);
  });
});

describe('storage — 壊れた入力や利用不可の環境でも落ちない', () => {
  test('localStorage が例外を投げても既定値で動く', () => {
    const { Store } = loadCG(['storage.js'], { localStorage: fakeStorage({ throws: true }) });
    const d = Store.load();
    assert.equal(d.settings.level, 'normal');
    assert.doesNotThrow(() => Store.save(d));
  });

  test('localStorage が存在しなくても落ちない', () => {
    const { Store } = loadCG(['storage.js'], {});
    assert.doesNotThrow(() => {
      const d = Store.load();
      Store.save(d);
    });
  });

  test('壊れたJSONが入っていても既定値に戻す', () => {
    const ls = fakeStorage();
    ls.setItem('neuro-gomoku:v1', '{壊れている');
    const { Store } = loadCG(['storage.js'], { localStorage: ls });
    const d = Store.load();
    assert.equal(d.streak, 0);
    assert.equal(d.settings.mode, 'ai');
  });

  test('キーが欠けた保存データを既定値で補完する', () => {
    const ls = fakeStorage();
    ls.setItem('neuro-gomoku:v1', JSON.stringify({ stats: { hard: { win: 2 } } }));
    const { Store } = loadCG(['storage.js'], { localStorage: ls });
    const d = toPlain(Store.load());
    assert.equal(d.stats.hard.win, 2);
    assert.equal(d.stats.hard.lose, 0);       // 欠けていたキーが補完される
    assert.equal(d.stats.normal.win, 0);
    assert.equal(d.settings.sound, true);
  });
});
