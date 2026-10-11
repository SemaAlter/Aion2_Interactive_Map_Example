import { LAYERS, gatheringOptions, traceTerrainOptions, matches } from './core.js';
import { MapRenderer } from './map-renderer.js';

const $ = selector => document.querySelector(selector);
const number = value => Number(value).toLocaleString('en-US');
let manifest, world, selected, loadController, searchTimer, urlTimer, toastTimer, worldToken = 0;
let groups = [], resultLimit = 30, visible = [], gatherChoices = { types: [], nodes: [] }, gatheringExpanded = false;
let traceChoices = [], tracesExpanded = true;
const initial = new URLSearchParams(location.hash.slice(1));
let saved;
try { const stored = JSON.parse(localStorage.getItem('aion2-map:saved') ?? '[]'); saved = new Set(Array.isArray(stored) ? stored.filter(v => typeof v === 'string') : []); }
catch { saved = new Set(); }
const filters = { layers: new Set(['gathering', 'trace', 'monster', 'travel', 'settlement', 'region']), query: initial.get('q') ?? '',
  zone: Number(initial.get('zone')) || 0, type: initial.get('type') ?? '', savedOnly: initial.get('saved') === '1', saved,
  gatherTypes: initial.has('gatherTypes') ? new Set(initial.get('gatherTypes').split(',').filter(Boolean)) : null,
  gatherNode: initial.get('gatherNode') ?? '',
  traceTerrains: initial.has('traceTerrains') ? new Set(initial.get('traceTerrains').split(',').filter(Boolean)) : null,
  levelMin: initial.has('min') ? Number(initial.get('min')) : null, levelMax: initial.has('max') ? Number(initial.get('max')) : null };
if (initial.has('layers')) filters.layers = new Set(initial.get('layers').split(',').filter(key => LAYERS[key]));

const renderer = new MapRenderer($('#map'), {
  onSelect: marker => openDetail(marker),
  onViewChange: () => { clearTimeout(urlTimer); urlTimer = setTimeout(updateUrl, 180); },
  onQuality: text => { $('#quality-label').textContent = text; },
  onCoordinates: point => { $('#coordinates').textContent = `X ${Math.round(point.x)} · Y ${Math.round(point.y)}`; }
});

function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3300); }
function option(value, text) { const node = document.createElement('option'); node.value = value; node.textContent = text; return node; }
function icon(layer) {
  const node = document.createElement('span'); node.className = 'layer-icon'; node.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img'); image.src = `./assets/ui/${LAYERS[layer].icon}.png`; image.alt = ''; node.append(image); return node;
}
function stat(label, text) { const node = document.createElement('div'); node.className = 'stat'; const key = document.createElement('label'), value = document.createElement('span'); key.textContent = label; value.textContent = text; node.append(key, value); return node; }
function bookmarkState() {
  $('#saved-count').textContent = number(saved.size); $('#bookmarks').setAttribute('aria-pressed', String(filters.savedOnly));
  $('#saved-only').checked = filters.savedOnly;
  if (selected) $('#save-location').textContent = saved.has(selected.id) ? 'Saved location' : 'Save location';
}
function renderWorldOptions(faction, key) {
  const worlds = manifest.worlds.filter(map => map.faction === faction);
  $('#world-select').replaceChildren(...worlds.map(map => option(map.key, map.name)));
  $('#world-select').value = worlds.some(map => map.key === key) ? key : worlds[0].key;
  document.querySelectorAll('[data-faction]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.faction === faction)));
}
function renderLayers() {
  $('#layer-list').replaceChildren();
  $('#trace-filter-options').replaceChildren();
  for (const [key, layer] of Object.entries(LAYERS)) {
    const row = document.createElement('label'); row.className = 'layer-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = filters.layers.has(key); input.value = key;
    input.addEventListener('change', () => { input.checked ? filters.layers.add(key) : filters.layers.delete(key); syncGatheringFilters(); syncTraceFilters(); applyFilters(); });
    const text = document.createElement('span'); text.textContent = key === 'trace' ? 'Show traces' : layer.label;
    const count = document.createElement('span'); count.className = 'layer-count'; count.textContent = number(world.counts[key] ?? 0);
    row.append(input, icon(key), text, count); $(key === 'trace' ? '#trace-filter-options' : '#layer-list').append(row);
    if (key === 'gathering') renderGatheringFilters();
    if (key === 'trace') renderTraceFilters();
  }
}
function renderGatheringFilters() {
  const details = document.createElement('details'); details.className = 'layer-subfilters gathering-subfilters';
  details.open = gatheringExpanded || filters.gatherTypes !== null || Boolean(filters.gatherNode);
  details.addEventListener('toggle', () => { gatheringExpanded = details.open; });
  const summary = document.createElement('summary'); summary.textContent = 'Gathering options';
  const arrow = document.createElement('img'); arrow.src = './assets/ui/arrow-down.png'; arrow.alt = ''; summary.append(arrow);
  details.append(summary);
  if (!gatherChoices.nodes.length) {
    const message = document.createElement('p'); message.className = 'gathering-empty';
    message.textContent = 'No gathering placements in this region.'; details.append(message);
  } else {
    const fieldset = document.createElement('fieldset'); fieldset.id = 'gathering-controls'; fieldset.setAttribute('aria-label', 'Gathering subfilters');
    const actions = document.createElement('div'); actions.className = 'gathering-actions';
    for (const [id, text, all] of [['gather-all', 'Select all', true], ['gather-none', 'Clear all', false]]) {
      const button = document.createElement('button'); button.id = id; button.textContent = text;
      button.addEventListener('click', () => { filters.gatherTypes = all ? null : new Set(); filters.gatherNode = ''; syncGatheringFilters(); applyFilters(); });
      actions.append(button);
    }
    fieldset.append(actions);
    for (const choice of gatherChoices.types) {
      const row = document.createElement('label'); row.className = 'simple-check'; row.title = `Game resource type: ${choice.type}`;
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.gatherType = choice.type;
      input.addEventListener('change', () => {
        if (filters.gatherTypes === null) filters.gatherTypes = new Set(gatherChoices.types.map(choice => choice.type));
        input.checked ? filters.gatherTypes.add(choice.type) : filters.gatherTypes.delete(choice.type);
        syncGatheringFilters(); applyFilters();
      });
      const label = document.createElement('span'); label.textContent = choice.label;
      const count = document.createElement('span'); count.className = 'layer-count'; count.textContent = number(choice.count);
      row.append(input, label, count); fieldset.append(row);
    }
    const label = document.createElement('label'); label.className = 'field-label'; label.htmlFor = 'gather-node'; label.textContent = 'Specific node';
    const select = document.createElement('select'); select.id = 'gather-node';
    select.addEventListener('change', () => { filters.gatherNode = select.value; applyFilters(); });
    fieldset.append(label, select); details.append(fieldset);
  }
  $('#layer-list').append(details); syncGatheringFilters();
}
function syncGatheringFilters() {
  const fieldset = $('#gathering-controls'); if (!fieldset) return;
  fieldset.disabled = !filters.layers.has('gathering');
  fieldset.querySelectorAll('[data-gather-type]').forEach(input => { input.checked = filters.gatherTypes === null || filters.gatherTypes.has(input.dataset.gatherType); });
  const nodes = gatherChoices.nodes.filter(node => filters.gatherTypes === null || filters.gatherTypes.has(node.type));
  if (!nodes.some(node => node.id === filters.gatherNode)) filters.gatherNode = '';
  $('#gather-node').replaceChildren(option('', 'All nodes'), ...nodes.map(node => option(node.id, `${node.name} (${number(node.count)})`)));
  $('#gather-node').value = filters.gatherNode;
}
function renderTraceFilters() {
  const details = document.createElement('details'); details.className = 'layer-subfilters trace-subfilters';
  details.open = tracesExpanded || filters.traceTerrains !== null;
  details.addEventListener('toggle', () => { tracesExpanded = details.open; });
  const summary = document.createElement('summary'); summary.textContent = 'Trace locations';
  const arrow = document.createElement('img'); arrow.src = './assets/ui/arrow-down.png'; arrow.alt = ''; summary.append(arrow); details.append(summary);
  if (!traceChoices.length) {
    const message = document.createElement('p'); message.className = 'gathering-empty'; message.textContent = 'No regular Empyrean Traces in this region.'; details.append(message);
  } else {
    const fieldset = document.createElement('fieldset'); fieldset.id = 'trace-controls'; fieldset.setAttribute('aria-label', 'Empyrean Trace terrain filters');
    const reset = document.createElement('button'); reset.id = 'trace-all'; reset.className = 'trace-all'; reset.textContent = 'Show all terrains';
    reset.addEventListener('click', () => { filters.traceTerrains = null; syncTraceFilters(); applyFilters(); }); fieldset.append(reset);
    for (const choice of traceChoices) {
      const row = document.createElement('label'); row.className = 'simple-check';
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.traceTerrain = choice.terrain;
      input.addEventListener('change', () => {
        if (filters.traceTerrains === null) filters.traceTerrains = new Set(traceChoices.map(choice => choice.terrain));
        input.checked ? filters.traceTerrains.add(choice.terrain) : filters.traceTerrains.delete(choice.terrain);
        syncTraceFilters(); applyFilters();
      });
      const label = document.createElement('span'); label.textContent = choice.terrain;
      const count = document.createElement('span'); count.className = 'layer-count'; count.textContent = number(choice.count);
      row.append(input, label, count); fieldset.append(row);
    }
    details.append(fieldset);
  }
  $('#trace-filter-options').append(details); syncTraceFilters();
}
function syncTraceFilters() {
  const fieldset = $('#trace-controls'); if (!fieldset) return;
  fieldset.disabled = !filters.layers.has('trace');
  fieldset.querySelectorAll('[data-trace-terrain]').forEach(input => { input.checked = filters.traceTerrains === null || filters.traceTerrains.has(input.dataset.traceTerrain); });
}
function updateUrl() {
  if (!world) return;
  const params = new URLSearchParams({ world: world.key, x: renderer.view.x.toFixed(1), y: renderer.view.y.toFixed(1), zoom: renderer.view.scale.toFixed(4), layers: [...filters.layers].join(',') });
  if (filters.query) params.set('q', filters.query);
  if (filters.zone) params.set('zone', filters.zone);
  if (filters.type) params.set('type', filters.type);
  if (filters.gatherTypes !== null) params.set('gatherTypes', [...filters.gatherTypes].sort().join(','));
  if (filters.gatherNode) params.set('gatherNode', filters.gatherNode);
  if (filters.traceTerrains !== null) params.set('traceTerrains', [...filters.traceTerrains].sort().join(','));
  if (filters.savedOnly) params.set('saved', '1');
  if (filters.levelMin !== null) params.set('min', filters.levelMin);
  if (filters.levelMax !== null) params.set('max', filters.levelMax);
  if (selected) params.set('marker', selected.id);
  history.replaceState(null, '', `#${params}`);
}
async function share() {
  updateUrl();
  try { await navigator.clipboard.writeText(location.href); toast('Map link copied. Ready to share.'); }
  catch { const input = document.createElement('input'); input.value = location.href; document.body.append(input); input.select(); const copied = document.execCommand('copy'); input.remove(); toast(copied ? 'Map link copied.' : 'Copy the map link from your address bar.'); }
}
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); }
async function loadWorld(key, restore = false) {
  const descriptor = manifest.worlds.find(map => map.key === key);
  if (!descriptor) return;
  loadController?.abort(); loadController = new AbortController(); const token = ++worldToken;
  $('#world-select').disabled = true; $('#zone-select').disabled = true;
  $('#map-message').hidden = false; $('#map-message').textContent = `Loading ${descriptor.name}…`;
  openDetail(null);
  try {
    const response = await fetch(descriptor.file, { signal: loadController.signal });
    if (!response.ok) throw new Error(`Location data returned HTTP ${response.status}`);
    const loaded = await response.json(); if (token !== worldToken) return;
    if (loaded.schemaVersion && loaded.schemaVersion !== 2) throw new Error('Unsupported map data version');
    world = loaded;
    gatherChoices = gatheringOptions(world);
    traceChoices = traceTerrainOptions(world);
    if (!gatherChoices.nodes.some(node => node.id === filters.gatherNode)) filters.gatherNode = '';
    world.zoneLookup = new Map(world.zones.map(zone => [zone.id, zone]));
    if (!restore || !world.zoneLookup.has(filters.zone)) filters.zone = 0;
    const types = [...new Set(Object.values(world.entities).map(entity => entity.type).filter(Boolean))].sort();
    if (!restore || !types.includes(filters.type)) filters.type = '';
    $('#zone-select').replaceChildren(option(0, 'All zones'), ...[...world.zoneLookup.values()].sort((a, b) => a.name.localeCompare(b.name)).map(zone => option(zone.id, zone.name)));
    $('#zone-select').value = filters.zone;
    $('#type-select').replaceChildren(option('', 'All types'), ...types.map(type => option(type, type.replace(/([a-z])([A-Z])/g, '$1 $2')))); $('#type-select').value = filters.type;
    $('#map-name').textContent = world.name; $('#map-faction').textContent = world.faction.toUpperCase();
    $('#map-summary').textContent = `${number(world.zoneCount)} zones · ${number(world.counts.gathering ?? 0)} gathering nodes · ${number(world.counts.monster ?? 0)} monster placements`;
    const artwork = renderer.setWorld(world);
    renderer.fit(world.markers.filter(marker => world.entities[marker.entityId].layer === 'region'));
    if (restore) {
      const x = Number(initial.get('x')), y = Number(initial.get('y')), scale = Number(initial.get('zoom'));
      if (initial.has('x') && initial.has('y') && Number.isFinite(x) && Number.isFinite(y) && scale > 0 && Number.isFinite(scale)) { renderer.view = { x, y, scale }; renderer.constrain(); }
    }
    renderLayers(); applyFilters();
    if (restore && initial.has('marker')) { const marker = world.markers.find(marker => marker.id === initial.get('marker')); if (marker && visible.includes(marker)) openDetail(marker); }
    await artwork; if (token !== worldToken) return;
    $('#map-message').hidden = true; $('#world-select').disabled = false; $('#zone-select').disabled = false;
    renderer.invalidate(); updateUrl();
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('#map-message').textContent = `Couldn't load this map. ${error.message}. Reload to try again.`;
    $('#world-select').disabled = false; console.error(error);
  }
}
function applyFilters() {
  if (!world) return;
  visible = world.markers.filter(marker => matches(marker, world.entities[marker.entityId], filters, world.zoneLookup.get(marker.zoneId)?.name));
  renderer.visible = visible; renderer.zone = filters.zone; renderer.invalidate();
  if (selected && !visible.includes(selected)) openDetail(null);
  const grouped = new Map();
  for (const marker of visible) {
    let group = grouped.get(marker.entityId); if (!group) { group = { entity: world.entities[marker.entityId], markers: [] }; grouped.set(marker.entityId, group); } group.markers.push(marker);
  }
  const order = { settlement: 0, region: 1, trace: 2, gathering: 3, travel: 4, monster: 5, npc: 6, landmark: 7 };
  groups = [...grouped.values()].sort((a, b) => (filters.query ? 0 : order[a.entity.layer] - order[b.entity.layer]) || a.entity.name.localeCompare(b.entity.name));
  resultLimit = 30; renderResults(); $('#result-count').textContent = `${number(visible.length)}`;
  $('#empty-state').hidden = visible.length !== 0; bookmarkState(); updateUrl();
}
function renderResults() {
  $('#results').replaceChildren();
  if (!groups.length) { const message = document.createElement('p'); message.className = 'result-empty'; message.textContent = filters.savedOnly ? 'No saved locations match this region. Save a location from its detail card, or switch regions.' : 'No matches. Try a different name, zone or layer.'; $('#results').append(message); }
  for (const group of groups.slice(0, resultLimit)) {
    const row = document.createElement('button'); row.className = 'result-row'; row.dataset.entity = group.entity.id;
    if (group.markers.some(marker => saved.has(marker.id))) row.classList.add('saved');
    if (group.entity.id === selected?.entityId) row.classList.add('selected');
    const info = document.createElement('span'), title = document.createElement('span'), subtitle = document.createElement('span');
    title.className = 'result-title'; title.textContent = group.entity.name;
    subtitle.className = 'result-sub'; subtitle.textContent = `${LAYERS[group.entity.layer].label}${group.entity.terrain ? ` · ${group.entity.terrain}` : group.entity.level != null ? ` · Lv. ${group.entity.level}` : group.entity.mastery != null ? ` · Mastery ${group.entity.mastery}` : ''}`;
    info.append(title, subtitle);
    const count = document.createElement('span'); count.className = 'result-count'; count.textContent = number(group.markers.length);
    row.append(icon(group.entity.layer), info, count);
    row.addEventListener('click', () => { closeSidebar(); const marker = group.markers[0]; group.markers.length > 1 ? renderer.fit(group.markers) : renderer.focus(marker); openDetail(marker); $('#close-detail').focus({ preventScroll: true }); });
    $('#results').append(row);
  }
  $('#more-results').hidden = groups.length <= resultLimit;
}
function openDetail(marker) {
  selected = marker; renderer.selected = marker; renderer.invalidate();
  $('#detail-panel').hidden = !marker;
  if (!marker || !world) { if (world) updateUrl(); return; }
  const entity = world.entities[marker.entityId];
  $('#detail-category').textContent = LAYERS[entity.layer].label;
  $('#detail-name').textContent = entity.name;
  $('#detail-zone').textContent = `${world.name} · ${world.zoneLookup.get(marker.zoneId)?.name ?? 'Zone not linked'}`;
  const placements = world.markers.filter(point => point.entityId === marker.entityId).length;
  $('#detail-stats').replaceChildren(stat('Type', entity.type.replace(/([a-z])([A-Z])/g, '$1 $2') || LAYERS[entity.layer].label), stat(entity.layer === 'trace' ? 'Locations in region' : 'Placements in region', number(placements)));
  if (entity.level != null) $('#detail-stats').append(stat('Monster level', entity.level), stat('Disposition', entity.disposition || 'Not available'));
  if (entity.mastery != null) $('#detail-stats').append(stat('Gathering mastery', entity.mastery), stat('Grade', entity.grade));
  if (entity.layer === 'trace') $('#detail-stats').append(stat('Terrain', entity.terrain), stat('Collection', entity.collectOnce ? 'One-time collectible' : 'Not specified'));
  $('#detail-drops').replaceChildren(); $('#detail-drops').className = 'detail-drops';
  if (entity.drops?.length) {
    const heading = document.createElement('h3'); heading.textContent = 'Possible gathering materials'; const list = document.createElement('ul');
    for (const drop of entity.drops) { const item = document.createElement('li'); item.textContent = `${drop.name} × ${drop.count}`; list.append(item); } $('#detail-drops').append(heading, list);
  }
  const siblings = visible.filter(point => point.entityId === marker.entityId);
  if (siblings.length > 1) {
    const next = document.createElement('button'); next.textContent = `Next placement (${siblings.indexOf(marker) + 1} / ${siblings.length})`; next.className = 'more-results';
    next.addEventListener('click', () => { const point = siblings[(siblings.indexOf(marker) + 1) % siblings.length]; renderer.focus(point); openDetail(point); }); $('#detail-drops').append(next);
  }
  $('#detail-coordinates').textContent = marker.world ? `World X ${number(marker.world[0])} · Y ${number(marker.world[1])} · altitude ${number(marker.world[2])} cm` : `Map X ${marker.x} · Y ${marker.y}`;
  $('#detail-source').textContent = `${marker.source} → ${entity.source}${entity.dataId ? ` · ID ${entity.dataId}` : ''}`;
  $('#detail-note').textContent = entity.layer === 'trace' ? 'Decoded client collectible location. This map does not receive your collected status from the game.' : marker.conditional ? 'Conditional placement. The server decides when this spawn group is active.' : 'Client-authored spawn position. Spawn alternatives and server conditions may change what appears here.';
  bookmarkState(); renderResults(); updateUrl();
}
function resetFilters() {
  filters.layers = new Set(Object.keys(LAYERS)); filters.query = ''; filters.zone = 0; filters.type = ''; filters.savedOnly = false; filters.levelMin = null; filters.levelMax = null;
  filters.gatherTypes = null; filters.gatherNode = '';
  filters.traceTerrains = null;
  $('#search').value = ''; $('#zone-select').value = 0; $('#type-select').value = ''; $('#level-min').value = ''; $('#level-max').value = ''; renderLayers(); applyFilters();
}
$('#search').value = filters.query; $('#level-min').value = filters.levelMin ?? ''; $('#level-max').value = filters.levelMax ?? '';
$('#search').addEventListener('input', event => { filters.query = event.target.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 120); });
$('#world-select').addEventListener('change', () => loadWorld($('#world-select').value));
document.querySelectorAll('[data-faction]').forEach(button => button.addEventListener('click', () => { renderWorldOptions(button.dataset.faction); loadWorld($('#world-select').value); }));
$('#zone-select').addEventListener('change', () => { filters.zone = Number($('#zone-select').value); applyFilters(); const zone = world.zoneLookup.get(filters.zone); if (zone) renderer.fit(zone.points); });
$('#type-select').addEventListener('change', () => { filters.type = $('#type-select').value; applyFilters(); });
for (const [id, key] of [['#level-min', 'levelMin'], ['#level-max', 'levelMax']]) $(id).addEventListener('input', () => { filters[key] = $(id).value === '' ? null : Number($(id).value); applyFilters(); });
$('#zone-boundaries').addEventListener('change', () => { renderer.boundaries = $('#zone-boundaries').checked; renderer.invalidate(); });
$('#show-labels').addEventListener('change', () => { renderer.labels = $('#show-labels').checked; renderer.invalidate(); });
$('#all-layers').addEventListener('click', () => { filters.layers = new Set(Object.keys(LAYERS)); renderLayers(); applyFilters(); });
$('#clear-filters').addEventListener('click', resetFilters); $('#empty-reset').addEventListener('click', resetFilters);
$('#more-results').addEventListener('click', () => { resultLimit += 30; renderResults(); });
$('#bookmarks').addEventListener('click', () => { filters.savedOnly = !filters.savedOnly; applyFilters(); });
$('#saved-only').addEventListener('change', () => { filters.savedOnly = $('#saved-only').checked; applyFilters(); });
$('#save-location').addEventListener('click', () => {
  if (!selected) return;
  const id = selected.id; saved.has(id) ? saved.delete(id) : saved.add(id);
  try { localStorage.setItem('aion2-map:saved', JSON.stringify([...saved])); } catch { toast('Browser storage is unavailable. This save lasts for this session.'); }
  applyFilters(); bookmarkState();
});
$('#close-detail').addEventListener('click', () => { openDetail(null); $('#map').focus({ preventScroll: true }); });
$('#share-view').addEventListener('click', share); $('#share-location').addEventListener('click', share);
$('#zoom-in').addEventListener('click', () => renderer.zoom(1.45)); $('#zoom-out').addEventListener('click', () => renderer.zoom(1 / 1.45));
$('#fit-map').addEventListener('click', () => { if (world) renderer.fit(); });
$('#fullscreen').addEventListener('click', async () => { try { document.fullscreenElement ? await document.exitFullscreen() : await $('.map-stage').requestFullscreen(); } catch { toast('Fullscreen is not available in this browser.'); } });
$('#menu-toggle').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#menu-toggle').setAttribute('aria-expanded', String(open)); });
for (const id of ['#about-open', '#data-open']) $(id).addEventListener('click', () => $('#about-dialog').showModal());
$('#about-close').addEventListener('click', () => $('#about-dialog').close());
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#sidebar').classList.add('open'); $('#menu-toggle').setAttribute('aria-expanded', 'true'); $('#search').focus(); } if (event.key === 'Escape') { openDetail(null); closeSidebar(); } });
bookmarkState();
try {
  const response = await fetch('./data/worlds.json'); if (!response.ok) throw new Error(`HTTP ${response.status}`);
  manifest = await response.json(); if (manifest.schemaVersion !== 2) throw new Error('Rebuild the atlas data to schema version 2');
  const descriptor = manifest.worlds.find(map => map.key === initial.get('world')) ?? manifest.worlds[0];
  $('#snapshot').textContent = manifest.snapshot;
  $('#coverage-text').textContent = `${manifest.worlds.length} regions, ${number(manifest.markerCount)} client-defined locations. Maps stream their original tiles, up to 16,384 × 16,384 pixels. Only the region you open is loaded.`;
  renderWorldOptions(descriptor.faction, descriptor.key); await loadWorld(descriptor.key, true);
} catch (error) { $('#map-message').textContent = `The atlas couldn't start: ${error.message}. Reload to try again.`; console.error(error); }
