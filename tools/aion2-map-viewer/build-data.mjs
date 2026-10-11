import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsPoint, worldToMap, cleanText } from './core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const source = path.join(repo, 'artifacts/AION2_Server_Data/structured-october/AION2/Content/Data');
const current = path.join(repo, 'artifacts/AION2_Server_Data/structured-current/AION2/Content/Data');
const output = path.join(here, 'data');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const data = (name) => read(fs.existsSync(path.join(source, name)) ? path.join(source, name) : path.join(current, name)).Properties.Data;
const value = id => Number(id?.Value ?? id ?? 0);
const short = text => String(text ?? '').split('::').pop();
const words = text => cleanText(String(text ?? '').replace(/^(worldMap_Name_|STR_(Map_|Subzone_)?)/, '').replace(/_Subzone\d*$/, '').replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
const entries = read(path.join(repo, 'artifacts/AION2_Server_Data/decoded/decrypted-all/AION2/Content/L10N/Text/en-US/L10NString.json')).Entries;
const spanish = read(path.join(repo, 'artifacts/AION2_Server_Data/decoded/decrypted-all/AION2/Content/L10N/Text/es-ES/L10NString.json')).Entries;
const name = (reference, fallback) => cleanText(entries[reference?.Key] ?? entries[`String_${reference?.Key}_body`] ?? words(fallback));
const index = rows => new Map(rows.map(row => [value(row.ID), row]));
const maps = data('Table/Map.json');
const npcs = index(data('Table/NpcData.json'));
const envs = index(data('Table/EnvObjData.json'));
const subzones = index(data('Table/Subzone.json'));
const gathers = new Map(data('Table/GatherSource.json').map(row => [row.Name, row]));
const materials = data('Table/GatherSourceMaterial.json');
const items = new Map(data('Table/Item.json').map(row => [row.Name, row]));
const uiRegions = data('Table/WorldMapUIRegion.json');
const keys = ['World_L_A', 'World_L_B', 'World_D_A', 'World_D_B', 'Abyss_Reshanta_A', 'Abyss_Reshanta_C', 'Abyss_Reshanta_D'];
fs.mkdirSync(output, { recursive: true });
const manifest = { schemaVersion: 2, title: 'AION 2 Interactive map', snapshot: 'October 2026 client', worlds: [] };

for (const key of keys) {
  const map = maps.find(row => row.GroupName === key);
  if (!map) throw new Error(`Missing map definition: ${key}`);
  const settings = data(`WorldMap/${key}.json`);
  const sourceFile = `Map/${map.BaseDir}/${key}/MapData.json`;
  const layout = data(sourceFile);
  if (layout.MapId !== value(map.ID)) throw new Error(`Mismatched map identity: ${key}`);
  const bounds = { x: -settings.SectorSize.X * settings.SectorPlaneSize / 2, y: -settings.SectorSize.Y * settings.SectorPlaneSize / 2,
    width: settings.SectorSize.X * settings.SectorPlaneSize, height: settings.SectorSize.Y * settings.SectorPlaneSize };
  const toMap = location => worldToMap(location, settings);
  const zones = (layout.SubzoneVolumeInfoMap ?? []).map(({ Key, Value: zone }) => {
    const definition = subzones.get(zone.SubzoneTableId);
    const points = zone.Points.map(toMap);
    return { id: zone.SubzoneTableId, name: name(definition?.DisplayName, Key), priority: definition?.Priority ?? 0,
      type: short(definition?.SubzoneType), points, worldPoints: zone.Points,
      area: Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2) };
  }).filter(zone => zone.points.length >= 3).sort((a, b) => b.priority - a.priority || a.area - b.area);
  const locateZone = location => zones.find(zone => containsPoint({ x: location.X, y: location.Y }, zone.worldPoints.map(p => ({ x: p.X, y: p.Y }))))?.id ?? 0;
  const entities = {};
  const markers = [];
  const stats = { unlinkedDefinitions: 0, outsideMap: 0, spawnGroups: layout.SpawnInfoList.length };
  const add = (id, entityId, location, zoneId, extra = {}) => {
    const point = toMap(location);
    if (![point.x, point.y, location.Z].every(Number.isFinite)) throw new Error(`Invalid position: ${id}`);
    if (point.x < bounds.x || point.y < bounds.y || point.x > bounds.x + bounds.width || point.y > bounds.y + bounds.height) { stats.outsideMap++; return; }
    markers.push({ id, entityId, x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100,
      world: [Math.round(location.X), Math.round(location.Y), Math.round(location.Z)], zoneId, ...extra });
  };
  for (const spawn of layout.SpawnInfoList) {
    // Repeated IDs express group composition, not distinct coordinates.
    // Do not duplicate the same candidate position in the public atlas.
    const definitions = [ ...[...new Set((spawn.NpcIdList ?? []).map(value))].map(id => ['npc', id, npcs.get(id)]),
      ...[...new Set((spawn.EnvObjIdList ?? []).map(value))].map(id => ['env', id, envs.get(id)]) ];
    for (const [kind, id, definition] of definitions) {
      if (!definition) { stats.unlinkedDefinitions++; continue; }
      const usage = short(definition.Usage);
      const displayName = name(definition.Desc, definition.Name);
      // Regular, one-time feather collectibles. Quest-specific copies stay in landmarks.
      const isTrace = usage === 'Normal' && /^GodFragment_/.test(definition.ResourceKey ?? '') && displayName.startsWith('Empyrean Trace:');
      const isGather = usage === 'GatherSource';
      const isTravel = /Teleport|EnterDungeon|Rift|MoveMap|PartyDungeon|EnterFieldEvent/.test(usage);
      const layer = kind === 'npc' ? (short(definition.NpcType) === 'Monster' ? 'monster' : 'npc') : isTrace ? 'trace' : isGather ? 'gathering' : isTravel ? 'travel' : usage === 'Quest' || usage === 'OdEnergyCube' || usage === 'Monolith' ? 'landmark' : null;
      if (!layer) continue;
      const entityId = `${kind}-${id}`;
      if (!entities[entityId]) {
        const gather = gathers.get(definition.UsageValue);
        const drops = gather ? materials.filter(row => row.MaterialGroup === gather.MaterialGroup).map(row => {
          const item = items.get(row.MaterialName);
          return { name: name(item?.Desc, row.MaterialName), count: row.MaterialCount, itemId: value(item?.ID) };
        }) : [];
        entities[entityId] = { id: entityId, dataId: id, name: displayName, internalName: definition.Name,
          layer, type: isTrace ? 'EmpyreanTrace' : isGather ? short(gather?.SourceType ?? 'Gathering') : short(definition.NpcSubType ?? definition.FunctionType ?? usage),
          ...(isTrace ? { terrain: short(definition.ObjectTerrainType), collectOnce: Boolean(definition.bGetRewardOnce),
            aliases: [spanish[definition.Desc?.Key]].filter(Boolean).map(cleanText) } : {}),
          level: definition.Level ?? null, mastery: gather?.MasteryLevel ?? null, grade: short(gather?.SourceGrade ?? ''), drops,
          disposition: short(definition.RelationshipEntity), attackable: Boolean(definition.bCanBeAttacked),
          source: kind === 'npc' ? 'NpcData.dat' : 'EnvObjData.dat' };
      }
      spawn.Positions.forEach((position, i) => add(`${key}:${spawn.UniqueKey}:${entityId}:${i}`, entityId, position.Location, locateZone(position.Location),
        { spawnGroup: spawn.Name, conditional: spawn.MaintainingTag !== 'None' && !!spawn.MaintainingTag, source: sourceFile.replace(/\.json$/, '.dat') }));
    }
  }
  for (const [i, label] of (settings.LabelMap ?? []).entries()) {
    const region = uiRegions.find(row => value(row.MapId) === value(map.ID) && row.WorldMapNameActor?.toLowerCase() === label.Key.toLowerCase());
    const type = short(region?.IconType ?? 'NamedLocation');
    const layer = /Village|City|Base|Outpost|Camp|Guard/i.test(type) ? 'settlement' : /Battle|Field|Region/i.test(type) ? 'region' : 'landmark';
    const entityId = `label-${i}`;
    entities[entityId] = { id: entityId, name: name(region?.Desc, label.Key), internalName: label.Key, layer, type, source: 'WorldMapUIRegion.dat' };
    markers.push({ id: `${key}:label:${i}`, entityId, x: label.Value.Location.X, y: label.Value.Location.Y,
      zoneId: value(region?.SubzoneId), source: `WorldMap/${key}.dat` });
  }
  const counts = {};
  for (const marker of markers) { const layer = entities[marker.entityId].layer; counts[layer] = (counts[layer] ?? 0) + 1; }
  const nativeTile = path.join(repo, `artifacts/AION2_Server_Data/structured-current/AION2/Content/UI/Map/WorldMap/${key}/Res/${key}_00_00.png`);
  if (!fs.existsSync(nativeTile)) throw new Error(`Export native map tiles before building the dataset: ${key}`);
  const tileSize = fs.readFileSync(nativeTile).readUInt32BE(16);
  const world = { key, name: name(map.Desc, key), faction: key.startsWith('World_L') ? 'Elyos' : key.startsWith('World_D') ? 'Asmodians' : 'Abyss',
    mapId: value(map.ID), bounds, sectors: settings.SectorSize, unitsPerPlane: settings.SectorWorldSize / settings.SectorPlaneSize,
    nativeSize: [settings.SectorSize.X * tileSize, settings.SectorSize.Y * tileSize],
    texture: `assets/maps/${key}.png`, tiles: `assets/tiles/${key}`, tileSizes: [256, 512, 1024, 2048].filter(size => size <= tileSize),
    file: `data/${key}.json`, markerCount: markers.length, counts, zoneCount: zones.length, stats };
  const payload = { schemaVersion: 2, ...world, entities, markers, zones: zones.map(({ worldPoints, area, ...zone }) => zone),
    provenance: { snapshot: manifest.snapshot, sources: [sourceFile, `WorldMap/${key}.json`, 'Table/NpcData.json', 'Table/EnvObjData.json', 'Table/GatherSource.json', 'Table/Subzone.json',
      'L10N/Text/en-US/L10NString.json', 'L10N/Text/es-ES/L10NString.json'],
      notes: 'Client-authored candidate placements, not live server state. Conditional and alternative spawn definitions may not be simultaneously active. Zones use decoded 2D polygons; elevation is available in placement details.' } };
  fs.writeFileSync(path.join(output, `${key}.json`), `${JSON.stringify(payload)}\n`);
  manifest.worlds.push(world);
  console.log(`${world.name}: ${markers.length} locations; ${counts.gathering ?? 0} gathering; ${counts.trace ?? 0} Empyrean Traces; ${counts.monster ?? 0} monsters; ${zones.length} zones.`);
}
manifest.markerCount = manifest.worlds.reduce((sum, world) => sum + world.markerCount, 0);
fs.writeFileSync(path.join(output, 'worlds.json'), `${JSON.stringify(manifest)}\n`);
