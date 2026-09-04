/* serve.js — tiny dependency-free static server for local play and development.
 *
 * Usage: node tools/serve.js [port]        (default 8765) → http://localhost:8765/
 *
 * Also serves /api/config exactly like the Vercel function, reading SUPABASE_URL and
 * SUPABASE_ANON_KEY from the environment or from an optional config.local.json file
 * in the project root:  { "SUPABASE_URL": "...", "SUPABASE_ANON_KEY": "..." }
 * The game also works by simply opening index.html (local mode, no accounts or online lobbies).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const port = Number(process.argv[2]) || 8765;

try {
  const local = JSON.parse(fs.readFileSync(path.join(root, 'config.local.json'), 'utf8'));
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) if (local[k] && !process.env[k]) process.env[k] = local[k];
} catch (_) { /* no local config */ }

const configHandler = require(path.join(root, 'api', 'config.js'));

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.sql': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/api/config') return configHandler(req, res);
  if (url.endsWith('/')) url += 'index.html';
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root + path.sep) || file.includes(path.sep + '.') || file.startsWith(path.join(root, 'node_modules'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}).listen(port, () => {
  const cfg = configHandler.publicConfig();
  console.log('The Genius Star: http://localhost:' + port + '/  (' + (cfg.supabaseUrl ? 'online backend: ' + cfg.supabaseUrl : 'local mode, no backend configured') + ')');
});
