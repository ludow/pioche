#!/usr/bin/env node
// Small dependency-free static server for the web interface.
// Usage: node web/serve.mjs [port]   (default 5173)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number.parseInt(process.argv[2], 10) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\' || rel === '') rel = '/index.html';

    let filePath = join(ROOT, rel);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

    let info = await stat(filePath).catch(() => null);
    // Serve index.html for directories, like GitHub Pages does.
    if (info && info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info || !info.isFile()) { res.writeHead(404); res.end('Not found'); return; }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(`Server error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Web interface available at http://localhost:${PORT}`);
});
