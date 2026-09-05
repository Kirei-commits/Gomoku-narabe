/**
 * 依存パッケージを増やさないための最小の静的ファイルサーバー。
 * Playwright の webServer と `npm start` の両方から使う。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // ルート外へのアクセスを防ぐ
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(String(err.code || err));
  }
});

server.listen(PORT, () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}/`));
