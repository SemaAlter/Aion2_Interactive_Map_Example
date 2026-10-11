import { LAYERS, markerGroups, tileLevel } from './core.js';

// Only visible tiles are requested. A bounded decoded-image cache prevents a
// 16k map (or switching regions repeatedly) from retaining gigabytes of pixels.
export class MapRenderer {
  constructor(canvas, { onSelect, onViewChange, onQuality, onCoordinates }) {
    Object.assign(this, { canvas, onSelect, onViewChange, onQuality, onCoordinates });
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.view = { x: 0, y: 0, scale: 1 };
    this.cache = new Map(); this.queue = []; this.pending = 0; this.wanted = new Set(); this.pixels = 0;
    this.visible = []; this.hits = []; this.pointers = new Map(); this.selected = null;
    this.icons = new Map();
    for (const name of new Set(Object.values(LAYERS).map(layer => layer.icon))) {
      const image = new Image(); image.src = `./assets/ui/${name}.png`;
      image.decode().then(() => { this.icons.set(name, image); this.invalidate(); }).catch(() => {});
    }
    document.fonts.ready.then(() => this.invalidate());
    this.labels = true; this.boundaries = false; this.disposed = false;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    this.bind(); this.resize();
  }
  resize() {
    this.width = this.canvas.clientWidth; this.height = this.canvas.clientHeight;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.invalidate();
  }
  async setWorld(world) {
    this.world = world; this.selected = null; this.queue = []; this.wanted.clear();
    this.overview = null;
    const image = new Image(); image.src = world.texture;
    try { await image.decode(); if (this.world === world) { this.overview = image; this.invalidate(); } }
    catch { if (this.world === world) this.onQuality('Map artwork failed to load'); }
  }
  project(point) { return { x: this.width / 2 + (point.x - this.view.x) * this.view.scale, y: this.height / 2 + (point.y - this.view.y) * this.view.scale }; }
  unproject(x, y) { return { x: this.view.x + (x - this.width / 2) / this.view.scale, y: this.view.y + (y - this.height / 2) / this.view.scale }; }
  fit(points) {
    const b = this.world.bounds;
    const xs = points?.map(p => p.x), ys = points?.map(p => p.y);
    const minX = xs?.length ? Math.min(...xs) : b.x, maxX = xs?.length ? Math.max(...xs) : b.x + b.width;
    const minY = ys?.length ? Math.min(...ys) : b.y, maxY = ys?.length ? Math.max(...ys) : b.y + b.height;
    this.view = { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
      scale: Math.min(this.width / Math.max(maxX - minX + 600, 1000), this.height / Math.max(maxY - minY + 600, 1000)) * .85 };
    this.constrain(); this.invalidate(); this.onViewChange();
  }
  focus(marker, scale = 1.1) { this.view = { x: marker.x, y: marker.y, scale: Math.max(this.view.scale, scale) }; this.constrain(); this.invalidate(); this.onViewChange(); }
  zoom(factor, x = this.width / 2, y = this.height / 2) {
    if (!this.world) return;
    const anchor = this.unproject(x, y);
    this.view.scale = Math.min(4, Math.max(this.minScale(), this.view.scale * factor));
    this.view.x = anchor.x - (x - this.width / 2) / this.view.scale;
    this.view.y = anchor.y - (y - this.height / 2) / this.view.scale;
    this.constrain(); this.invalidate(); this.onViewChange();
  }
  minScale() { return Math.min(this.width / this.world.bounds.width, this.height / this.world.bounds.height) * .45; }
  constrain() {
    if (!this.world) return;
    const b = this.world.bounds;
    this.view.scale = Math.min(4, Math.max(this.minScale(), this.view.scale));
    this.view.x = Math.max(b.x, Math.min(b.x + b.width, this.view.x));
    this.view.y = Math.max(b.y, Math.min(b.y + b.height, this.view.y));
  }
  invalidate() {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); });
  }
  getTile(url, size) {
    const cached = this.cache.get(url);
    if (cached) { cached.used = performance.now(); return cached.image; }
    if (!this.queue.some(item => item.url === url)) this.queue.push({ url, size });
    return null;
  }
  pump() {
    while (this.pending < 4 && this.queue.length) {
      const item = this.queue.shift();
      if (!this.wanted.has(item.url) || this.cache.has(item.url)) continue;
      const record = { image: null, used: performance.now(), loading: true, size: item.size };
      this.cache.set(item.url, record); this.pending++;
      const image = new Image();
      image.onload = () => {
        record.image = image; record.loading = false; this.pending--; this.pixels += item.size ** 2;
        this.evict(); this.pump(); this.invalidate();
      };
      image.onerror = () => { record.loading = false; record.failed = true; this.pending--; this.pump(); this.invalidate(); };
      image.src = item.url;
    }
  }
  evict() {
    const candidates = [...this.cache].filter(([, record]) => !record.loading).sort((a, b) => a[1].used - b[1].used);
    for (const [url, record] of candidates) {
      if (this.pixels <= 16 * 1024 * 1024 && this.cache.size <= 160) break;
      if (this.wanted.has(url)) continue;
      if (record.image) this.pixels -= record.size ** 2;
      record.image = null; this.cache.delete(url);
    }
  }
  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#10191e'; ctx.fillRect(0, 0, this.width, this.height);
    if (!this.world) return;
    const b = this.world.bounds, origin = this.project(b);
    if (this.overview) ctx.drawImage(this.overview, origin.x, origin.y, b.width * this.view.scale, b.height * this.view.scale);
    const plane = b.width / this.world.sectors.X;
    const size = Math.min(tileLevel(this.view.scale, plane, this.dpr), this.world.tileSizes.at(-1));
    const top = this.unproject(0, 0), bottom = this.unproject(this.width, this.height);
    const minX = Math.max(0, Math.floor((top.x - b.x) / plane)), maxX = Math.min(this.world.sectors.X - 1, Math.floor((bottom.x - b.x) / plane));
    const minY = Math.max(0, Math.floor((top.y - b.y) / plane)), maxY = Math.min(this.world.sectors.Y - 1, Math.floor((bottom.y - b.y) / plane));
    this.wanted.clear(); let missing = 0, failed = 0;
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const url = `${this.world.tiles}/${size}/${x}_${y}.png`; this.wanted.add(url);
      const image = this.getTile(url, size);
      if (this.cache.get(url)?.failed) failed++;
      if (!image) { missing++; continue; }
      const p = this.project({ x: b.x + x * plane, y: b.y + y * plane });
      ctx.drawImage(image, p.x, p.y, plane * this.view.scale + .35, plane * this.view.scale + .35);
    }
    this.evict(); this.pump();
    this.onQuality(failed ? 'OVERVIEW ONLY · TILE UNAVAILABLE' : missing ? 'LOADING MAP DETAIL…' : size === this.world.tileSizes.at(-1) ? `ORIGINAL ${size} PX TILES` : `NATIVE MAP · ${size} PX DETAIL`);
    if (this.boundaries || this.zone) for (const zone of this.world.zones) {
      if (!this.boundaries && zone.id !== this.zone) continue;
      ctx.beginPath(); zone.points.forEach((point, i) => { const p = this.project(point); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath();
      ctx.strokeStyle = zone.id === this.zone ? '#e3c283aa' : '#cdb58833'; ctx.lineWidth = zone.id === this.zone ? 2 : .6;
      if (zone.id === this.zone) { ctx.fillStyle = '#e3c2830d'; ctx.fill(); } ctx.stroke();
    }
    const onScreen = this.visible.filter(marker => { const p = this.project(marker); return p.x >= -40 && p.y >= -40 && p.x <= this.width + 40 && p.y <= this.height + 40; });
    const labels = onScreen.filter(marker => this.world.entities[marker.entityId].layer === 'region');
    const nodes = onScreen.filter(marker => this.world.entities[marker.entityId].layer !== 'region');
    this.hits = [];
    const cells = markerGroups(nodes, marker => this.project(marker));
    const iconSize = Math.min(28, Math.max(10, 28 * Math.sqrt(this.view.scale)));
    for (const cell of cells) {
      const marker = cell.markers[0], entity = this.world.entities[marker.entityId];
      const mixed = cell.markers.some(m => this.world.entities[m.entityId].layer !== entity.layer);
      const many = cell.markers.length > 1;
      const image = this.icons.get(mixed ? 'map' : LAYERS[entity.layer].icon);
      if (image) {
        ctx.drawImage(image, cell.x - iconSize / 2, cell.y - iconSize / 2, iconSize, iconSize);
      }
      if (many) {
        const count = cell.markers.length > 999 ? `${(cell.markers.length / 1000).toFixed(1)}k` : String(cell.markers.length);
        ctx.font = '11px "Aion UI", "Segoe UI", sans-serif';
        const width = ctx.measureText(count).width + 6;
        ctx.fillStyle = '#101b29ee'; ctx.fillRect(cell.x - width / 2, cell.y + 6, width, 14);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f0dab0'; ctx.fillText(count, cell.x, cell.y + 13);
      }
      if (!many && this.labels && this.view.scale > .75) this.text(entity.name, cell.x + 17, cell.y, '#edf0f5', '12px "Aion UI", "Segoe UI", sans-serif', 'left');
      this.hits.push({ ...cell, radius: Math.max(8, iconSize / 2) });
    }
    if (this.labels) {
      const boxes = [];
      for (const marker of labels) {
        const p = this.project(marker), text = this.world.entities[marker.entityId].name;
        ctx.font = `${this.view.scale > .4 ? 14 : 12}px "Aion UI", "Segoe UI", sans-serif`;
        const width = ctx.measureText(text).width + 12, box = { x: p.x - width / 2, y: p.y - 10, width, height: 20 };
        if (boxes.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y)) continue;
        boxes.push(box); this.text(text, p.x, p.y, '#f0e9d5', ctx.font, 'center'); this.hits.push({ x: p.x, y: p.y, radius: 17, markers: [marker] });
      }
    }
    if (this.selected) {
      const p = this.project(this.selected); ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.strokeStyle = '#f4d693'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.strokeStyle = '#f4d69344'; ctx.lineWidth = 1; ctx.stroke();
    }
    // Scale is derived from the map's world/plane transform, not an arbitrary ruler.
    const unitsPerPlane = this.world.unitsPerPlane;
    const metresPerPx = unitsPerPlane / this.view.scale / 100;
    const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const distance = candidates.find(m => m / metresPerPx >= 65) ?? 5000;
    document.querySelector('#scale-bar').style.width = `${Math.min(150, distance / metresPerPx)}px`;
    document.querySelector('#scale-label').textContent = distance >= 1000 ? `${distance / 1000} km` : `${distance} m`;
  }
  text(text, x, y, color, font, align) { const c = this.ctx; c.font = font; c.textAlign = align; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = 3.5; c.strokeStyle = '#11191fe6'; c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y); }
  hit(x, y) {
    let nearest, distance = Infinity;
    for (const cell of this.hits) {
      const current = Math.hypot(x - cell.x, y - cell.y);
      if (current < cell.radius && current <= distance) { nearest = cell; distance = current; }
    }
    return nearest;
  }
  bind() {
    const point = event => { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    this.canvas.addEventListener('wheel', event => { event.preventDefault(); const p = point(event); this.zoom(Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * .002), p.x, p.y); }, { passive: false });
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.world || event.button > 0) return;
      const p = point(event); this.pointers.set(event.pointerId, p); this.start = p; this.moved = false;
      this.canvas.setPointerCapture(event.pointerId); this.canvas.classList.add('dragging'); this.canvas.focus({ preventScroll: true });
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!this.world) return;
      const p = point(event), previous = this.pointers.get(event.pointerId);
      const mapPoint = this.unproject(p.x, p.y); this.onCoordinates(mapPoint);
      if (previous) {
        if (Math.hypot(p.x - this.start.x, p.y - this.start.y) > 5) this.moved = true;
        if (this.pointers.size === 2) {
          const other = [...this.pointers].find(([id]) => id !== event.pointerId)[1];
          const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
          const newDistance = Math.hypot(p.x - other.x, p.y - other.y);
          if (oldDistance > 1) this.zoom(newDistance / oldDistance, (p.x + other.x) / 2, (p.y + other.y) / 2);
        } else { this.view.x -= (p.x - previous.x) / this.view.scale; this.view.y -= (p.y - previous.y) / this.view.scale; this.constrain(); this.invalidate(); }
        this.pointers.set(event.pointerId, p);
      } else {
        const cell = this.hit(p.x, p.y), tip = document.querySelector('#tooltip');
        tip.hidden = !cell;
        if (cell) { tip.textContent = cell.markers.length > 1 ? `${cell.markers.length} placements · click to explore` : this.world.entities[cell.markers[0].entityId].name; tip.style.left = `${Math.min(p.x + 16, this.width - 255)}px`; tip.style.top = `${Math.min(p.y + 16, this.height - 50)}px`; }
        this.canvas.style.cursor = cell ? 'pointer' : 'grab';
      }
    });
    const release = event => {
      if (!this.pointers.has(event.pointerId)) return;
      const p = point(event); this.pointers.delete(event.pointerId);
      if (event.type === 'pointerup' && !this.moved && !this.pointers.size) {
        const cell = this.hit(p.x, p.y);
        this.onSelect(cell?.markers[0] ?? null);
      }
      if (!this.pointers.size) this.canvas.classList.remove('dragging');
      this.onViewChange();
    };
    this.canvas.addEventListener('pointerup', release); this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('pointerleave', () => { document.querySelector('#tooltip').hidden = true; });
    this.canvas.addEventListener('dblclick', event => { const p = point(event); this.zoom(1.7, p.x, p.y); });
    this.canvas.addEventListener('keydown', event => {
      if (!this.world) return;
      const pan = 80 / this.view.scale;
      if (event.key === '+' || event.key === '=') this.zoom(1.4);
      else if (event.key === '-') this.zoom(1 / 1.4);
      else if (event.key === 'Home') this.fit();
      else if (event.key === 'ArrowLeft') this.view.x -= pan;
      else if (event.key === 'ArrowRight') this.view.x += pan;
      else if (event.key === 'ArrowUp') this.view.y -= pan;
      else if (event.key === 'ArrowDown') this.view.y += pan;
      else return;
      event.preventDefault(); this.constrain(); this.invalidate(); this.onViewChange();
    });
  }
}
