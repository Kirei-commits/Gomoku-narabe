/**
 * storage.js — 戦績と設定の永続化（localStorage）
 * プライベートモード等で localStorage が使えない場合もクラッシュしないよう
 * すべて try/catch で包み、メモリ上のフォールバックに退避する。
 */
(function (global) {
  'use strict';

  var KEY = 'neuro-gomoku:v1';

  var DEFAULTS = {
    stats: {
      easy:   { win: 0, lose: 0, draw: 0 },
      normal: { win: 0, lose: 0, draw: 0 },
      hard:   { win: 0, lose: 0, draw: 0 },
      pvp:    { win: 0, lose: 0, draw: 0 } // win=先手(P1)勝ち, lose=後手(P2)勝ち
    },
    streak: 0,
    bestStreak: 0,
    settings: { mode: 'ai', level: 'normal', first: 'human', sound: true }
  };

  var memory = null; // localStorage が使えない環境のフォールバック

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** 保存データを既定値にマージして欠損キーを補う */
  function merge(base, saved) {
    var out = clone(base);
    if (!saved || typeof saved !== 'object') return out;
    Object.keys(out.stats).forEach(function (k) {
      var s = saved.stats && saved.stats[k];
      if (s) {
        out.stats[k].win  = Number(s.win)  || 0;
        out.stats[k].lose = Number(s.lose) || 0;
        out.stats[k].draw = Number(s.draw) || 0;
      }
    });
    out.streak = Number(saved.streak) || 0;
    out.bestStreak = Number(saved.bestStreak) || 0;
    if (saved.settings && typeof saved.settings === 'object') {
      Object.keys(out.settings).forEach(function (k) {
        if (saved.settings[k] !== undefined) out.settings[k] = saved.settings[k];
      });
    }
    return out;
  }

  function load() {
    if (memory) return clone(memory);
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { /* 利用不可 */ }
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    var data = merge(DEFAULTS, parsed);
    memory = clone(data);
    return data;
  }

  function save(data) {
    memory = clone(data);
    try { global.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 無視 */ }
    return data;
  }

  function reset() {
    memory = null;
    try { global.localStorage.removeItem(KEY); } catch (e) { /* 無視 */ }
    return load();
  }

  global.CG = global.CG || {};
  global.CG.Store = { load: load, save: save, reset: reset, DEFAULTS: DEFAULTS };
})(window);
