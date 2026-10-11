import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('Linux deployment: first start, restart, PID safety, port conflict and build recovery',
  { skip: process.platform !== 'linux', timeout: 120_000 }, async () => {
    // Small packaging fixture, never the user's real release or asset tree.
    // A path with spaces exercises launcher path quoting on an actual Linux host.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion2 linux deploy '));
    const tool = path.join(root, 'tools/aion2-map-viewer');
    fs.mkdirSync(path.join(tool, 'tests'), { recursive: true });
    for (const file of ['build-site.mjs', 'server.mjs', 'index.html', 'app.js', 'core.js', 'map-renderer.js', 'styles.css']) fs.copyFileSync(path.join(source, file), path.join(tool, file));
    const launcher = path.join(root, 'Build-Deploy-Website.sh');
    fs.copyFileSync(path.resolve(source, '../../Build-Deploy-Website.sh'), launcher);
    fs.cpSync(path.join(source, 'assets/ui'), path.join(tool, 'assets/ui'), { recursive: true });
    const png = fs.readFileSync(path.join(source, 'assets/ui/save.png'));
    for (const folder of ['data', 'assets/maps', `assets/tiles/test/${png.readUInt32BE(16)}`]) fs.mkdirSync(path.join(tool, folder), { recursive: true });
    const texture = path.join(tool, 'assets/maps/test.png');
    fs.writeFileSync(texture, png);
    fs.writeFileSync(path.join(tool, `assets/tiles/test/${png.readUInt32BE(16)}/0_0.png`), png);
    fs.writeFileSync(path.join(tool, 'data/test.json'), '{}');
    fs.writeFileSync(path.join(tool, 'data/worlds.json'), JSON.stringify({ schemaVersion: 2, markerCount: 0,
      worlds: [{ file: 'data/test.json', texture: 'assets/maps/test.png', tiles: 'assets/tiles/test', tileSizes: [png.readUInt32BE(16)], sectors: { X: 1, Y: 1 } }] }));
    const unit = path.join(tool, 'tests/smoke.test.mjs');
    fs.writeFileSync(unit, 'import test from "node:test"; test("fixture", () => {});');
    const reserve = net.createServer();
    await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const pidFile = path.join(root, `development_logs/map-viewer-${port}.pid`);
    const url = `http://127.0.0.1:${port}/`;
    const pids = new Set();
    // Run like a normal terminal, not as an inherited Node test-worker process.
    const launchEnv = { ...process.env }; delete launchEnv.NODE_TEST_CONTEXT;
    const record = () => {
      const text = fs.readFileSync(pidFile, 'utf8');
      const pid = Number(text.split(' ')[0]); pids.add(pid); return { text, pid };
    };
    const run = () => new Promise((resolve, reject) => {
      const child = spawn('bash', [launcher, '--no-browser', '--port', String(port)], { cwd: os.tmpdir(), env: launchEnv });
      let output = '';
      child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
      child.on('error', reject); child.on('close', code => resolve({ code, output }));
    });
    const deploy = async () => { const result = await run(); assert.equal(result.code, 0, result.output); return record(); };
    const healthy = async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          assert.equal(await (await fetch(`${url}healthz`, { signal: AbortSignal.timeout(2000) })).text(), 'ok');
          return;
        } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      assert.fail('Fixture server did not become healthy.');
    };
    let foreign;
    try {
      const first = await deploy(); await healthy();
      const second = await deploy(); assert.notEqual(second.pid, first.pid); await healthy();

      fs.writeFileSync(pidFile, `${second.pid} invalid-start-time\n`);
      let refused = await run(); assert.notEqual(refused.code, 0); await healthy();
      fs.writeFileSync(pidFile, second.text);

      fs.writeFileSync(unit, 'import test from "node:test"; test("failure", () => { throw new Error("expected fixture failure"); });');
      refused = await run(); assert.notEqual(refused.code, 0, refused.output); assert.equal(record().pid, second.pid); await healthy();
      fs.writeFileSync(unit, 'import test from "node:test"; test("fixture", () => {});');

      fs.renameSync(texture, `${texture}.saved`);
      refused = await run(); assert.notEqual(refused.code, 0); assert.match(refused.output, /Restarted the retained release/);
      const recovered = record(); assert.notEqual(recovered.pid, second.pid); await healthy();
      fs.renameSync(`${texture}.saved`, texture);

      foreign = http.createServer((request, response) => response.end('unrelated listener'));
      await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
      const foreignPort = foreign.address().port;
      const foreignPidFile = path.join(root, `development_logs/map-viewer-${foreignPort}.pid`);
      const stat = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8');
      fs.writeFileSync(foreignPidFile, `${process.pid} ${stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]}\n`);
      const child = spawn('bash', [launcher, '--no-browser', '--port', String(foreignPort)], { env: launchEnv });
      const code = await new Promise(resolve => child.on('close', resolve));
      assert.notEqual(code, 0);
      assert.equal(await (await fetch(`http://127.0.0.1:${foreignPort}/`)).text(), 'unrelated listener');
    } finally {
      if (foreign?.listening) await new Promise(resolve => foreign.close(resolve));
      for (const pid of pids) {
        try {
          const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
          if (args[1] === path.join(tool, 'server.mjs')) process.kill(pid, 'SIGTERM');
        } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
