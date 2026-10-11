import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MapRenderer } from '../map-renderer.js';
import { LAYERS, containsPoint, worldToMap, matches, gatheringOptions, traceTerrainOptions, markerGroups, tileLevel, cleanText } from '../core.js';

test('world coordinates preserve map origins, axes and scale', () => {
  const settings = { StartWorldLocation: { X: -408000, Y: -408000 }, SectorWorldSize: 102000, SectorPlaneSize: 1024, SectorSize: { X: 8, Y: 8 } };
  assert.deepEqual(worldToMap({ X: 0, Y: 0 }, settings), { x: 0, y: 0 });
  assert.deepEqual(worldToMap({ X: 102000, Y: -102000 }, settings), { x: 1024, y: -1024 });
  assert.deepEqual(worldToMap({ X: -408000, Y: -408000 }, settings), { x: -4096, y: -4096 });
});
test('zone filtering uses real polygons, including concave outlines', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
  assert.equal(containsPoint({ x: 2, y: 8 }, polygon), true);
  assert.equal(containsPoint({ x: 8, y: 8 }, polygon), false);
  assert.equal(containsPoint({ x: 20, y: 2 }, polygon), false);
});
test('all filters combine, including accents, drops, bookmarks and levels', () => {
  const marker = { id: 'point', zoneId: 17 };
  const entity = { name: 'Élite Spider', layer: 'monster', internalName: 'M_Spider', type: 'EliteMonster', dataId: 123, level: 20, drops: [{ name: 'Ruby' }] };
  const filters = { layers: new Set(['monster']), query: 'elite ruby', zone: 17, type: '', savedOnly: true, saved: new Set(['point']), levelMin: 10, levelMax: 30 };
  assert.equal(matches(marker, entity, filters, 'Forest'), true);
  for (const patch of [{ query: 'no match' }, { zone: 9 }, { type: 'NormalMonster' }, { levelMin: 21 }, { levelMax: 19 }, { saved: new Set() }, { layers: new Set() }]) assert.equal(matches(marker, entity, { ...filters, ...patch }), false);
});
test('tile levels honor display density; groups retain exact locations', () => {
  assert.equal(tileLevel(.1, 1024, 2), 256);
  assert.equal(tileLevel(.7, 1024, 2), 2048);
  const markers = [{ x: 5, y: 5 }, { x: 10, y: 10 }, { x: 100, y: 100 }, { x: 5, y: 5 }];
  const grouped = markerGroups(markers, point => point);
  assert.equal(grouped.length, 3); assert.equal(grouped.flatMap(group => group.markers).length, 4);
  assert.equal(cleanText('<b>Monster</b>\\n name'), 'Monster name');
});

test('marker positions and grouping do not drift during pan or zoom', () => {
  const markers = [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 10, y: 10 }, { id: 'c', x: 5, y: 5 }];
  for (const scale of [.05, .1, .49, .5, 1, 4]) for (const pan of [-1000, -17, 0, 34, 999]) {
    const groups = markerGroups(markers, marker => ({ x: marker.x * scale + pan, y: marker.y * scale - pan }));
    assert.deepEqual(groups.map(group => group.markers.map(marker => marker.id)), [['a', 'c'], ['b']]);
    for (const group of groups) for (const marker of group.markers) {
      assert.ok(Math.abs((group.x - pan) / scale - marker.x) < 1e-9);
      assert.ok(Math.abs((group.y + pan) / scale - marker.y) < 1e-9);
    }
  }
});

test('overlapping icons select the nearest actual coordinate', () => {
  const renderer = Object.create(MapRenderer.prototype);
  const first = { x: 10, y: 10, radius: 17 }, last = { x: 20, y: 10, radius: 17 };
  renderer.hits = [first, last];
  assert.equal(renderer.hit(11, 10), first);
  assert.equal(renderer.hit(19, 10), last);
  assert.equal(renderer.hit(200, 200), undefined);
});

test('gathering subfilters combine without hiding monsters or other layers', () => {
  const marker = { id: 'node', zoneId: 17 };
  const herb = { id: 'env-1', name: 'Aria', layer: 'gathering', type: 'Herb', mastery: 1 };
  const ore = { id: 'env-2', name: 'Ore', layer: 'gathering', type: 'Metal' };
  const monster = { id: 'npc-1', name: 'Spider', layer: 'monster', type: 'NormalMonster', level: 10 };
  const filters = { layers: new Set(['gathering', 'monster']), query: '', zone: 0, type: '', savedOnly: false,
    levelMin: null, levelMax: null, gatherTypes: null, gatherNode: '' };
  assert.equal(matches(marker, herb, filters), true);
  assert.equal(matches(marker, herb, { ...filters, gatherTypes: new Set() }), false);
  assert.equal(matches(marker, monster, { ...filters, gatherTypes: new Set(), gatherNode: herb.id }), true);
  assert.equal(matches(marker, herb, { ...filters, gatherTypes: new Set(['Herb']), gatherNode: herb.id }), true);
  for (const patch of [{ gatherTypes: new Set(['Metal']) }, { gatherNode: ore.id }, { query: 'ore' }, { zone: 9 }]) {
    assert.equal(matches(marker, herb, { ...filters, ...patch }), false);
  }
  const world = { entities: { [herb.id]: herb, [ore.id]: ore, [monster.id]: monster },
    markers: [herb, herb, ore, monster].map(entity => ({ entityId: entity.id })) };
  assert.deepEqual(gatheringOptions(world).types, [
    { type: 'Herb', label: 'Herbs', count: 2 }, { type: 'Metal', label: 'Ore', count: 1 }
  ]);
  assert.deepEqual(gatheringOptions(world).nodes.map(node => [node.id, node.count]), [[herb.id, 2], [ore.id, 1]]);
  assert.deepEqual(gatheringOptions({ entities: {}, markers: [] }), { types: [], nodes: [] });
  herb.type = 'NewClientType';
  assert.ok(gatheringOptions(world).types.some(choice => choice.label === 'NewClientType'));
});
test('Empyrean Trace terrain filters and Spanish search preserve other layers', () => {
  const marker = { id: 'trace1', zoneId: 1 };
  const trace = { id: 'env-1', name: 'Empyrean Trace: Verteron', aliases: ['Rastro empíreo: Verteron'],
    layer: 'trace', type: 'EmpyreanTrace', terrain: 'Ground' };
  const monster = { id: 'npc-1', name: 'Spider', layer: 'monster', level: 10 };
  const filters = { layers: new Set(['trace', 'monster']), query: '', zone: 0, type: '', levelMin: null, levelMax: null, traceTerrains: null };
  assert.equal(matches(marker, trace, filters), true);
  assert.equal(matches(marker, trace, { ...filters, traceTerrains: new Set(['Ground']), query: 'rastro empireo verteron' }), true);
  for (const patch of [{ traceTerrains: new Set(['Air', 'Water']) }, { traceTerrains: new Set() }, { layers: new Set(['gathering']) }, { query: 'Eltnen' }]) {
    assert.equal(matches(marker, trace, { ...filters, ...patch }), false);
  }
  assert.equal(matches(marker, monster, { ...filters, traceTerrains: new Set() }), true);
  assert.deepEqual(traceTerrainOptions({ entities: { [trace.id]: trace, [monster.id]: monster },
    markers: [trace, trace, monster].map(entity => ({ entityId: entity.id })) }), [{ terrain: 'Ground', count: 2 }]);
});

test('Verteron contains the regular 559 traces, with quest copies kept separate', () => {
  const world = JSON.parse(fs.readFileSync(new URL('../data/World_L_A.json', import.meta.url)));
  assert.equal(world.counts.trace, 559);
  assert.deepEqual(traceTerrainOptions(world), [
    { terrain: 'Air', count: 120 }, { terrain: 'Ground', count: 389 }, { terrain: 'Water', count: 50 }
  ]);
  for (const id of ['env-1200860', 'env-1200865', 'env-1200868']) {
    const entity = world.entities[id]; assert.equal(entity.layer, 'trace'); assert.equal(entity.collectOnce, true);
    assert.ok(entity.aliases.includes('Rastro empíreo: Verteron'));
    assert.ok(world.markers.filter(marker => marker.entityId === id).every(marker => marker.world?.length === 3));
  }
  assert.equal(world.entities['env-1201290'].layer, 'landmark');
  assert.equal(world.markers.filter(marker => marker.entityId === 'env-1201290').length, 1);
});

test('all generated regions have joined definitions, unique placements and valid coordinates', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/worlds.json', import.meta.url)));
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.worlds.length, 7);
  let total = 0;
  for (const descriptor of manifest.worlds) {
    const data = JSON.parse(fs.readFileSync(new URL(`../${descriptor.file}`, import.meta.url)));
    assert.equal(data.markerCount, data.markers.length); assert.equal(data.stats.unlinkedDefinitions, 0);
    assert.equal(new Set(data.markers.map(marker => marker.id)).size, data.markerCount);
    const counts = {};
    for (const marker of data.markers) {
      const entity = data.entities[marker.entityId]; assert.ok(entity, marker.id); assert.ok(LAYERS[entity.layer]);
      assert.ok(Number.isFinite(marker.x) && Number.isFinite(marker.y)); assert.ok(entity.name);
      counts[entity.layer] = (counts[entity.layer] ?? 0) + 1;
      if (entity.layer === 'gathering') assert.ok(entity.mastery !== null);
    }
    assert.deepEqual(counts, data.counts); total += data.markerCount;
    assert.ok(data.zones.every(zone => zone.points.length >= 3));
  }
  assert.equal(total, manifest.markerCount);
});
