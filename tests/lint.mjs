/**
 * ビルドを持たないプロジェクトのための最小の静的検査。
 *  1. 全JSファイルの構文チェック
 *  2. index.html が参照する css/js が実在するか
 *     （ファイル移動やリポジトリ移設で壊れやすく、実行するまで気づけないため）
 *  3. 読み込み順の検証（依存の後ろに依存元が来ていないか）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

// 1. 構文チェック
const jsDir = path.join(ROOT, 'js');
for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', path.join(jsDir, f)], { stdio: 'pipe' });
  } catch (e) {
    problems.push(`構文エラー js/${f}: ${e.stderr?.toString().split('\n')[0]}`);
  }
}

// 2. 参照の実在確認
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:)([^"]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  if (!fs.existsSync(path.join(ROOT, ref))) problems.push(`参照先が存在しない: ${ref}`);
}
if (!refs.includes('css/style.css')) problems.push('index.html が css/style.css を読み込んでいない');

// 3. 読み込み順（board は ai/render/main より前）
const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const need = [['board.js', 'ai.js'], ['board.js', 'render.js'], ['ai.js', 'main.js'],
              ['render.js', 'main.js'], ['storage.js', 'main.js'], ['audio.js', 'main.js']];
for (const [before, after] of need) {
  const i = order.indexOf(before), j = order.indexOf(after);
  if (i === -1 || j === -1 || i > j) problems.push(`読み込み順が不正: ${before} は ${after} より前に必要`);
}

if (problems.length) {
  console.error('lint 失敗:');
  for (const p of problems) console.error('  ✘ ' + p);
  process.exit(1);
}
console.log(`lint OK — JS ${fs.readdirSync(jsDir).length}件 / 参照 ${refs.length}件 / 読み込み順 ${order.length}件`);
