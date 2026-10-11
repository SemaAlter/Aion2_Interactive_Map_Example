import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
export function createMapServer(root = path.join(here, 'dist')) {
  root = path.resolve(root);
  const server = http.createServer((request, response) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'" };
    const end = (status, message, extra = {}) => { response.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', ...extra }); response.end(request.method === 'HEAD' ? undefined : message); };
    if (request.method !== 'GET' && request.method !== 'HEAD') { end(405, 'Method not allowed', { Allow: 'GET, HEAD' }); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { end(400, 'Bad request'); return; }
    if (pathname === '/healthz') { end(200, 'ok', { 'Cache-Control': 'no-store' }); return; }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) { end(404, 'Not found'); return; }
    const file = path.resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) || !types[path.extname(file)]) { end(404, 'Not found'); return; }
    let stat;
    try { const real = fs.realpathSync(file); if (!real.startsWith(`${root}${path.sep}`)) { end(404, 'Not found'); return; } stat = fs.statSync(real); if (!stat.isFile()) throw new Error('Not a file'); }
    catch { end(404, 'Not found'); return; }
    let served = file, encoding;
    const accepts = String(request.headers['accept-encoding'] ?? '');
    const acceptable = format => accepts.split(',').some(item => { const [name, ...params] = item.trim().split(';'); return name === format && !params.some(param => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(param)); });
    if (acceptable('br') && fs.existsSync(`${file}.br`)) { served += '.br'; encoding = 'br'; }
    else if (acceptable('gzip') && fs.existsSync(`${file}.gz`)) { served += '.gz'; encoding = 'gzip'; }
    const servedStat = fs.statSync(served);
    const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}-${encoding ?? 'raw'}"`;
    const cache = pathname.startsWith('/assets/tiles/') ? 'public, max-age=86400' : 'public, max-age=0, must-revalidate';
    const success = { ...headers, 'Content-Type': types[path.extname(file)], 'Cache-Control': cache, ETag: etag, Vary: 'Accept-Encoding', 'Last-Modified': stat.mtime.toUTCString(), ...(encoding ? { 'Content-Encoding': encoding } : {}) };
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, success); response.end(); return; }
    response.writeHead(200, { ...success, 'Content-Length': servedStat.size });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = fs.createReadStream(served); stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(here, 'dist/index.html'))) { console.error('Build the deployment first: npm run build'); process.exit(1); }
  const port = Number(process.env.PORT ?? process.env.SEMA_MAP_PORT ?? 4179), host = process.env.HOST ?? '127.0.0.1';
  const server = createMapServer();
  server.on('error', error => { console.error(`Map server failed: ${error.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`AION 2 Interactive map: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeIdleConnections(); });
}
