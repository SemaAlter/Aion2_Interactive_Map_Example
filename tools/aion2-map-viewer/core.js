// Shared pure map math: also exercised by the data builder and native Node tests.
export const LAYERS = {
  gathering: { label: 'Gathering nodes', color: '#d0ba87', icon: 'gathering' },
  trace: { label: 'Empyrean Traces', color: '#d0ba87', icon: 'save' },
  monster: { label: 'Monster spawns', color: '#cf9e6b', icon: 'monster' },
  npc: { label: 'NPCs', color: '#d0ba87', icon: 'npc' },
  travel: { label: 'Travel & entrances', color: '#d0ba87', icon: 'position' },
  settlement: { label: 'Settlements', color: '#d0ba87', icon: 'home' },
  region: { label: 'Zone names', color: '#e4ddc9', icon: 'map' },
  landmark: { label: 'Landmarks & objects', color: '#d0ba87', icon: 'save' }
};
// Labels for the decoded GatherSource.SourceType enum. Unknown types stay visible.
export const GATHERING_TYPES = { Berry: 'Fruit / berries', Herb: 'Herbs', Jewelry: 'Gemstones',
  Metal: 'Ore', Od: 'Odyle', Shellfish: 'Shellfish', Tree: 'Wood', Vegetable: 'Vegetables' };
export function gatheringOptions(world) {
  const counts = new Map(), types = new Map();
  for (const marker of world.markers) {
    const entity = world.entities[marker.entityId];
    if (entity.layer !== 'gathering') continue;
    counts.set(entity.id, (counts.get(entity.id) ?? 0) + 1);
    types.set(entity.type, (types.get(entity.type) ?? 0) + 1);
  }
  return {
    types: [...types].map(([type, count]) => ({ type, label: GATHERING_TYPES[type] ?? type, count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    nodes: [...counts].map(([id, count]) => ({ ...world.entities[id], count }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  };
}
export function traceTerrainOptions(world) {
  const counts = new Map();
  for (const marker of world.markers) {
    const entity = world.entities[marker.entityId];
    if (entity.layer !== 'trace') continue;
    counts.set(entity.terrain, (counts.get(entity.terrain) ?? 0) + 1);
  }
  return [...counts].map(([terrain, count]) => ({ terrain, count })).sort((a, b) => a.terrain.localeCompare(b.terrain));
}
export const cleanText = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function worldToMap(point, settings) {
  const ratio = settings.SectorPlaneSize / settings.SectorWorldSize;
  return { x: (point.X - settings.StartWorldLocation.X) * ratio - settings.SectorSize.X * settings.SectorPlaneSize / 2,
    y: (point.Y - settings.StartWorldLocation.Y) * ratio - settings.SectorSize.Y * settings.SectorPlaneSize / 2 };
}
export function containsPoint(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function matches(marker, entity, filters, zoneName = '') {
  if (!filters.layers.has(entity.layer) || (filters.zone && marker.zoneId !== filters.zone)) return false;
  if (filters.savedOnly && !filters.saved.has(marker.id)) return false;
  if (filters.type && entity.type !== filters.type) return false;
  if (entity.layer === 'gathering') {
    if (filters.gatherTypes && !filters.gatherTypes.has(entity.type)) return false;
    if (filters.gatherNode && entity.id !== filters.gatherNode) return false;
  }
  if (entity.layer === 'trace' && filters.traceTerrains && !filters.traceTerrains.has(entity.terrain)) return false;
  if (filters.levelMin !== null && entity.layer === 'monster' && entity.level < filters.levelMin) return false;
  if (filters.levelMax !== null && entity.layer === 'monster' && entity.level > filters.levelMax) return false;
  const haystack = normalize(`${entity.name} ${(entity.aliases ?? []).join(' ')} ${entity.internalName} ${entity.dataId ?? ''} ${entity.type} ${zoneName} ${(entity.drops ?? []).map(drop => drop.name).join(' ')}`);
  return normalize(filters.query).split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}
export function tileLevel(scale, planeSize, dpr = 1) {
  const needed = scale * planeSize * dpr;
  return [256, 512, 1024, 2048].find(size => size >= needed) ?? 2048;
}
// Only co-located records share an icon. Never average nearby locations or
// regroup them using camera/screen coordinates: that makes markers drift.
export function markerGroups(markers, project) {
  const cells = new Map();
  for (const marker of markers) {
    const key = `${marker.x}:${marker.y}`;
    let cell = cells.get(key);
    if (!cell) { cell = { ...project(marker), markers: [] }; cells.set(key, cell); }
    cell.markers.push(marker);
  }
  return [...cells.values()];
}
