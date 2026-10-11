import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createMapServer } from '../server.mjs';

test('static release server: security headers, MIME, HEAD, caching and errors', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion2-map-test-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Atlas</title>');
  fs.writeFileSync(path.join(root, 'index.html.gz'), gzipSync(fs.readFileSync(path.join(root, 'index.html'))));
  fs.writeFileSync(path.join(root, 'image.png'), 'test');
  fs.writeFileSync(path.join(root, 'font.ttf'), 'test');
  fs.writeFileSync(path.join(root, '.secret.json'), '{}');
  const server = createMapServer(root); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /Atlas/);
    assert.equal(page.headers.get('content-encoding'), 'gzip'); assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const cached = await fetch(base, { headers: { 'If-None-Match': page.headers.get('etag') } }); assert.equal(cached.status, 304);
    const head = await fetch(base, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const raw = await fetch(base, { headers: { 'Accept-Encoding': 'gzip;q=0' } }); assert.equal(raw.headers.get('content-encoding'), null);
    const image = await fetch(`${base}/image.png`); assert.equal(image.headers.get('content-type'), 'image/png');
    const font = await fetch(`${base}/font.ttf`); assert.equal(font.status, 200); assert.equal(font.headers.get('content-type'), 'font/ttf');
    for (const url of ['/missing.json', '/.secret.json', '/%00', '/%5csecret.json', '/server.mjs', '/%2e%2e/.git/config']) assert.equal((await fetch(base + url)).status, 404);
    assert.equal((await fetch(`${base}/%xx`)).status, 400);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok');
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
