import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const destination = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/worlds.json'), 'utf8'));
if (manifest.schemaVersion !== 2) throw new Error('Run build-data.mjs first.');
const ui = JSON.parse(fs.readFileSync(path.join(root, 'assets/ui/sources.json'), 'utf8'));
for (const name of Object.keys(ui.sprites)) {
  if (!fs.existsSync(path.join(root, 'assets/ui', `${name}.png`))) throw new Error(`Missing UI sprite: ${name}. Run Build-UIAssets.ps1.`);
}
for (const font of ui.fonts) {
  const file = path.join(root, 'assets/ui', path.basename(font).replace(/\.ufont$/, '.ttf'));
  if (!fs.existsSync(file) || fs.readFileSync(file).readUInt32BE(0) !== 0x00010000) throw new Error(`Invalid client font: ${file}`);
}
// Refuse partial releases. All native tiles, definitions and map images are required.
for (const world of manifest.worlds) {
  for (const file of [world.file, world.texture]) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing release asset: ${file}`);
  for (const size of world.tileSizes) for (let x = 0; x < world.sectors.X; x++) for (let y = 0; y < world.sectors.Y; y++) {
    const file = path.join(root, world.tiles, String(size), `${x}_${y}.png`);
    if (!fs.existsSync(file)) throw new Error(`Missing map detail: ${file}. Run Build-MapTextures.ps1.`);
    const png = fs.readFileSync(file); if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Tile dimension mismatch: ${file}`);
  }
}
// This output directory is wholly generated, and contains no server configs,
// extracted game binaries, database credentials, AES keys or development logs.
const dist = fs.mkdtempSync(path.join(root, '.dist-build-'));
for (const file of ['index.html', 'app.js', 'core.js', 'map-renderer.js', 'styles.css']) fs.copyFileSync(path.join(root, file), path.join(dist, file));
fs.cpSync(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });
fs.cpSync(path.join(root, 'data'), path.join(dist, 'data'), { recursive: true });
const compress = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name);
  if (entry.isDirectory()) compress(file);
  else if (/\.(json|js|css|html|svg)$/.test(file)) { const buffer = fs.readFileSync(file); fs.writeFileSync(`${file}.gz`, gzipSync(buffer, { level: 9 })); fs.writeFileSync(`${file}.br`, brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })); }
} };
compress(dist);
// Swap only after validation and packaging succeed. The old release is retained
// until then; cleanup is restricted to these known generated child directories.
const previous = path.join(root, '.dist-previous');
if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true });
if (fs.existsSync(destination)) fs.renameSync(destination, previous);
try { fs.renameSync(dist, destination); }
catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, destination); throw error; }
if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true });
console.log(`Deployment ready: ${destination}\n${manifest.worlds.length} regions · ${manifest.markerCount.toLocaleString('en-US')} client-defined locations. No external runtime dependencies.`);
