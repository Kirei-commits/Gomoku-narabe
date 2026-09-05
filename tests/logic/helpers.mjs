/**
 * ブラウザ用のクラシックスクリプト(js/*.js)を Node 上で読み込むための補助。
 * window 名前空間だけを用意して vm で評価する。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string[]} files 読み込む js ファイル名 @param {object} extra window に足すもの */
export function loadCG(files = ['board.js', 'ai.js'], extra = {}) {
  const sandbox = {
    window: { performance, ...extra },
    performance, Date, Math, console, Int8Array, JSON, String, Number, Array, Object
  };
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.window.CG;
}

/**
 * 固定シードの擬似乱数（mulberry32）。
 * EASY のゆらぎを再現可能にして、対戦結果がテストごとに変わらないようにする。
 */
export function seededRandom(seed = 20260905) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * vm の中で作られた配列/オブジェクトは別realmのため deepStrictEqual が通らない。
 * 比較する前にこの関数でプレーンな値へ正規化する。
 */
export const toPlain = (v) => JSON.parse(JSON.stringify(v));

/** 文字列の盤面から Int8Array を作る。'.'=空 'x'=先手 'o'=後手 */
export function makeBoard(B, rows) {
  const b = B.create();
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === 'x') b[B.idx(x, y)] = B.P1;
    if (c === 'o') b[B.idx(x, y)] = B.P2;
  }));
  return b;
}

export const EMPTY_ROW = '...............';
export const pad = (rows) => [...rows, ...Array(Math.max(0, 15 - rows.length)).fill(EMPTY_ROW)];

/**
 * 詰み手順が本当に「相手の受けが強制で、最終手に五が成立する」かを検証する。
 * @returns {string|null} 問題があれば理由、無ければ null
 */
export function validateMate(B, board, attacker, moves) {
  const b = Int8Array.from(board);
  const defender = B.opponent(attacker);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (b[B.idx(m.x, m.y)] !== B.EMPTY) return `空点でないマスに打っている (${B.toCoord(m.x, m.y)})`;
    if (m.player !== (i % 2 === 0 ? attacker : defender)) return `i=${i} の手番が不正`;
    if (i % 2 === 1) {
      const wins = B.winningPoints(b, attacker).map((p) => p.join(','));
      if (!wins.includes(`${m.x},${m.y}`)) return `i=${i} の受けが強制手になっていない`;
      if (!m.forced) return `i=${i} に forced フラグが無い`;
    }
    b[B.idx(m.x, m.y)] = m.player;
    const win = B.findWinLine(b, m.x, m.y);
    if (win && i < moves.length - 1) return `最終手より前に決着している (i=${i})`;
    if (i === moves.length - 1) {
      if (!win) return '最終手で五連ができていない';
      if (m.player !== attacker) return '最終手が攻め手のものでない';
    }
  }
  return null;
}

/** 1局を自動対戦させる。@returns {{winner:number, moves:number, worstMs:number}} */
export function selfPlay(B, AI, levelP1, levelP2, seedMove) {
  const b = B.create();
  let p = B.P1, n = 0, worstMs = 0;
  const start = seedMove || { x: 7, y: 7 };
  b[B.idx(start.x, start.y)] = p; n = 1; p = B.P2;
  while (n < 225) {
    const t0 = performance.now();
    const m = AI.chooseMove(b, p, p === B.P1 ? levelP1 : levelP2);
    worstMs = Math.max(worstMs, performance.now() - t0);
    if (!m || b[B.idx(m.x, m.y)] !== B.EMPTY) return { winner: -1, moves: n, worstMs };
    b[B.idx(m.x, m.y)] = p; n++;
    if (B.findWinLine(b, m.x, m.y)) return { winner: p, moves: n, worstMs };
    p = B.opponent(p);
  }
  return { winner: 0, moves: n, worstMs };
}
