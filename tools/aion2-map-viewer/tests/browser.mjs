// Isolated Chrome/CDP smoke tests. No user browser profile or installed npm
// package is used. Run after the native texture build on a Windows development PC.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createMapServer } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!fs.existsSync(chrome)) throw new Error('Set CHROME_PATH to a Chrome executable.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aion2-atlas-browser-'));
const server = createMapServer(process.env.MAP_TEST_RELEASE === '1' ? path.join(root, 'dist') : root); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  for (let i = 0; i < 100 && !fs.existsSync(path.join(profile, 'DevToolsActivePort')); i++) await delay(100);
  const debugPort = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let next = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => { const message = JSON.parse(event.data);
    if (message.id) { const callbacks = pending.get(message.id); if (callbacks) { pending.delete(message.id); message.error ? callbacks.reject(message.error) : callbacks.resolve(message.result); } }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  const waitFor = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); }
    const state = await evaluate('({map:document.querySelector("#map-name")?.textContent,status:document.querySelector("#map-message")?.textContent,region:document.querySelector("#world-select")?.value})');
    throw new Error(`Timed out: ${expression}. State: ${JSON.stringify(state)}. Errors: ${JSON.stringify(errors)}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Page.navigate', { url: base });
  await waitFor('document.querySelector("#map-message")?.hidden && !document.querySelector("#world-select").disabled');
  assert.equal(await evaluate('document.title'), 'AION 2 Interactive map');
  await waitFor('/^(NATIVE MAP ·|ORIGINAL)/.test(document.querySelector("#quality-label").textContent)');
  assert.ok(!(await evaluate('document.querySelector("#quality-label").textContent')).includes('UNAVAILABLE'));
  await evaluate('document.fonts.ready');
  assert.equal(await evaluate('document.fonts.check(\'14px "Aion UI"\')'), true);
  await waitFor('[...document.images].every(image => image.complete && image.naturalWidth > 0)');
  assert.equal(await evaluate('getComputedStyle(document.body).fontFamily.includes("Aion UI")'), true);
  const snapshot = async name => { const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(root, `.qa-${name}.png`), Buffer.from(screenshot.data, 'base64')); };
  const checkPanelFrame = async () => {
    assert.equal(await evaluate(`(()=>{
      const panel=document.querySelector('#sidebar'), content=panel.querySelector('.sidebar-content');
      const box=panel.getBoundingClientRect(), inner=content.getBoundingClientRect();
      const top=getComputedStyle(panel,'::before'), bottom=getComputedStyle(panel,'::after');
      return getComputedStyle(panel).overflowY==='hidden' && getComputedStyle(content).overflowY==='auto'
        && inner.top >= box.top + parseFloat(top.top) + parseFloat(top.height) + 1
        && inner.bottom <= box.bottom - parseFloat(bottom.bottom) - parseFloat(bottom.height) - 1;
    })()`), true);
  };
  await checkPanelFrame();
  await evaluate('document.querySelector(".sidebar-content").scrollTop=200');
  assert.ok(await evaluate('document.querySelector(".sidebar-content").scrollTop>0'));
  assert.equal(await evaluate('document.querySelector("#sidebar").scrollTop'), 0);
  await snapshot('frame-scrolled');
  await evaluate('document.querySelector(".sidebar-content").scrollTop=0');
  assert.ok((await evaluate('getComputedStyle(document.querySelector(".map-heading")).backgroundImage')).includes('135deg'));
  await snapshot('desktop');
  const checkFactionTabs = async () => {
    assert.equal(await evaluate(`(()=>{
      const group = document.querySelector('.faction-tabs').getBoundingClientRect();
      return [...document.querySelectorAll('[data-faction]')].every(button => {
        const box = button.getBoundingClientRect(), label = button.querySelector('span').getBoundingClientRect();
        return box.left >= group.left && box.right <= group.right + 1 && label.left >= box.left && label.right <= box.right && button.scrollWidth <= button.clientWidth;
      });
    })()`), true);
  };
  await checkFactionTabs();
  const region = JSON.parse(fs.readFileSync(path.join(root, 'data/World_L_A.json')));
  const baseline = Number((await evaluate('document.querySelector("#result-count").textContent')).replaceAll(',', ''));
  const nonGathering = baseline - region.counts.gathering;
  const ores = region.markers.filter(marker => region.entities[marker.entityId].layer === 'gathering' && region.entities[marker.entityId].type === 'Metal');
  const oreId = ores[0].entityId, oreCount = ores.filter(marker => marker.entityId === oreId).length;
  const resultCount = async () => Number((await evaluate('document.querySelector("#result-count").textContent')).replaceAll(',', ''));
  await click('.gathering-subfilters summary'); await click('#gather-none');
  assert.equal(await resultCount(), nonGathering);
  assert.equal(await evaluate('new URLSearchParams(location.hash.slice(1)).get("gatherTypes")'), '');
  await click('[data-gather-type="Metal"]');
  assert.equal(await resultCount(), nonGathering + ores.length);
  await evaluate(`(()=>{const e=document.querySelector('#gather-node');e.value=${JSON.stringify(oreId)};e.dispatchEvent(new Event('change'));})()`);
  assert.equal(await resultCount(), nonGathering + oreCount);
  const gatheringLink = await evaluate('location.href');
  await cdp('Page.navigate', { url: gatheringLink });
  await waitFor('document.querySelector("#map-message")?.hidden && !document.querySelector("#world-select").disabled');
  assert.equal(await evaluate('document.querySelector("#gather-node").value'), oreId);
  assert.equal(await evaluate('[...document.querySelectorAll("[data-gather-type]")].filter(e=>e.checked).map(e=>e.dataset.gatherType).join(",")'), 'Metal');
  assert.equal(await resultCount(), nonGathering + oreCount);
  await snapshot('gathering-filters');
  await click('[data-gather-type="Metal"]'); await click('[data-gather-type="Herb"]');
  assert.equal(await evaluate('document.querySelector("#gather-node").value'), '');
  assert.equal(await evaluate('new URLSearchParams(location.hash.slice(1)).has("gatherNode")'), false);
  await click('.layer-row input[value="gathering"]');
  assert.equal(await evaluate('document.querySelector("#gathering-controls").disabled'), true);
  assert.equal(await resultCount(), nonGathering);
  await click('.layer-row input[value="gathering"]'); await click('#gather-all');
  assert.equal(await resultCount(), baseline);
  await click('.gathering-subfilters summary');
  assert.equal(await evaluate('document.querySelector(\'.layer-row input[value="trace"]\').checked'), true);
  assert.equal(await evaluate('document.querySelector("#trace-filter input[value=trace]") !== null && document.querySelector("#layer-list input[value=trace]") === null'), true);
  assert.equal(await evaluate('document.querySelector(".trace-subfilters").open'), true);
  await click('#trace-filter input[value="trace"]');
  assert.equal(await resultCount(), baseline - region.counts.trace);
  assert.equal(await evaluate('document.querySelector("#trace-controls").disabled'), true);
  assert.equal(await evaluate('document.querySelector("#gathering-controls").disabled'), false);
  await click('#trace-filter input[value="trace"]');
  assert.equal(await resultCount(), baseline);
  assert.equal(await evaluate('document.querySelector(\'.layer-row input[value="trace"]\').closest("label").querySelector(".layer-count").textContent'), '559');
  await input('#search', 'Rastro empíreo: Verteron');
  await waitFor('document.querySelector(".result-title")?.textContent.includes("Empyrean Trace")');
  assert.equal(await resultCount(), 559);
  await click('[data-trace-terrain="Air"]'); await click('[data-trace-terrain="Water"]');
  assert.equal(await resultCount(), 389);
  const traceLink = await evaluate('location.href');
  await cdp('Page.navigate', { url: traceLink });
  await waitFor('document.querySelector("#map-message")?.hidden && !document.querySelector("#world-select").disabled');
  assert.equal(await resultCount(), 389);
  assert.equal(await evaluate('[...document.querySelectorAll("[data-trace-terrain]")].filter(e=>e.checked).map(e=>e.dataset.traceTerrain).join(",")'), 'Ground');
  await click('[data-trace-terrain="Ground"]'); assert.equal(await resultCount(), 0);
  await click('#trace-all'); assert.equal(await resultCount(), 559);
  await click('.result-row');
  assert.ok((await evaluate('document.querySelector("#detail-stats").textContent')).includes('One-time collectible'));
  await delay(250); await snapshot('empyrean-traces');
  await click('#close-detail'); await input('#search', '');
  await waitFor(`Number(document.querySelector("#result-count").textContent.replaceAll(",", ""))===${baseline}`);
  await click('.trace-subfilters summary');
  const originalZoom = Number(new URLSearchParams((await evaluate('location.hash')).slice(1)).get('zoom'));
  await click('#zoom-in'); await delay(250);
  assert.ok(Number(new URLSearchParams((await evaluate('location.hash')).slice(1)).get('zoom')) > originalZoom);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 950, y: 500, deltaX: 0, deltaY: -120 }); await delay(250);
  assert.ok(Number(new URLSearchParams((await evaluate('location.hash')).slice(1)).get('zoom')) > originalZoom * 1.5);
  const originalX = Number(new URLSearchParams((await evaluate('location.hash')).slice(1)).get('x'));
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 950, y: 500, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 550, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1100, y: 550, button: 'left', clickCount: 1 }); await delay(250);
  assert.notEqual(Number(new URLSearchParams((await evaluate('location.hash')).slice(1)).get('x')), originalX);
  await input('#search', 'Mela'); await waitFor('document.querySelector(".result-title")?.textContent.includes("Mela")');
  assert.ok(Number((await evaluate('document.querySelector("#result-count").textContent')).replaceAll(',', '')) > 0);
  await click('.result-row'); await waitFor('!document.querySelector("#detail-panel").hidden');
  assert.ok((await evaluate('document.querySelector("#detail-name").textContent')).includes('Mela'));
  await click('#save-location'); assert.equal(await evaluate('document.querySelector("#saved-count").textContent'), '1');
  const shared = await evaluate('location.href'); await cdp('Page.navigate', { url: shared });
  await waitFor('document.querySelector("#map-message")?.hidden && !document.querySelector("#detail-panel").hidden');
  assert.equal(await evaluate('document.querySelector("#saved-count").textContent'), '1');
  await click('#clear-filters'); await input('#search', 'Canyon Vine Spirit'); await waitFor('document.querySelector(".result-title")?.textContent.includes("Canyon Vine Spirit")');
  await click('.result-row'); await snapshot('monster');
  await click('#close-detail'); await input('#search', 'zzzz-no-such-location'); await waitFor('!document.querySelector("#empty-state").hidden');
  await click('#empty-reset'); await waitFor('document.querySelector("#empty-state").hidden');
  const zoneCount = await evaluate('document.querySelector("#zone-select").options.length'); assert.ok(zoneCount > 100);
  await evaluate('(()=>{const e=document.querySelector("#zone-select");e.selectedIndex=1;e.dispatchEvent(new Event("change"));})()');
  assert.ok((await evaluate('location.hash')).includes('zone='));
  await click('[data-faction="Asmodians"]'); await waitFor('document.querySelector("#map-name").textContent==="Altgard" && document.querySelector("#map-message").hidden');
  assert.equal(await evaluate('document.querySelector(\'.layer-row input[value="trace"]\').closest("label").querySelector(".layer-count").textContent'), '559');
  await click('[data-faction="Abyss"]'); await waitFor('document.querySelector("#map-name").textContent==="Chaotic Lower Reshanta" && document.querySelector("#map-message").hidden');
  await snapshot('abyss');
  for (const [faction, key, name] of [['Elyos', 'World_L_B', 'Eltnen'], ['Asmodians', 'World_D_B', 'Morheim'], ['Abyss', 'Abyss_Reshanta_C', 'Chaotic Middle Reshanta'], ['Abyss', 'Abyss_Reshanta_D', 'Chaotic Upper Reshanta']]) {
    await click(`[data-faction="${faction}"]`);
    await waitFor('!document.querySelector("#world-select").disabled');
    await evaluate(`(()=>{const e=document.querySelector('#world-select');e.value=${JSON.stringify(key)};e.dispatchEvent(new Event('change'));})()`);
    await waitFor(`document.querySelector('#map-name').textContent===${JSON.stringify(name)} && document.querySelector('#map-message').hidden`);
    if (key === 'Abyss_Reshanta_C' || key === 'Abyss_Reshanta_D') {
      assert.equal(await evaluate('document.querySelector("#gathering-controls") === null'), true);
      assert.ok((await evaluate('document.querySelector(".gathering-subfilters").textContent')).includes('No gathering placements'));
    }
    if (key === 'Abyss_Reshanta_D') assert.ok((await evaluate('document.querySelector(".trace-subfilters").textContent')).includes('No regular Empyrean Traces'));
  }
  await click('[data-faction="Abyss"]'); await waitFor('document.querySelector("#map-name").textContent==="Chaotic Lower Reshanta" && document.querySelector("#map-message").hidden');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click('#menu-toggle'); assert.equal(await evaluate('document.querySelector("#menu-toggle").getAttribute("aria-expanded")'), 'true'); await delay(350); await snapshot('mobile-filters');
  await checkPanelFrame();
  await checkFactionTabs();
  for (const width of [320, 360]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
    await delay(100); await checkFactionTabs();
    await checkPanelFrame();
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click('#menu-toggle'); await delay(350); await snapshot('mobile-map');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const width of [768, 1024, 1600]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await checkFactionTabs();
    assert.equal(await evaluate('(()=>{const a=document.querySelector(".map-heading").getBoundingClientRect(),b=document.querySelector(".map-top-actions").getBoundingClientRect();return a.right <= b.left;})()'), true);
  }
  const siteOrigin = await evaluate('location.origin');
  await cdp('Page.navigate', { url: `${siteOrigin}/#world=World_L_A&layers=trace` });
  // A fragment-only navigation does not reload this already-open application.
  await cdp('Page.reload', { ignoreCache: true });
  await waitFor('document.querySelector("#map-name")?.textContent==="Verteron" && document.querySelector("#map-message").hidden');
  assert.equal(await resultCount(), 559);
  assert.ok(!(await evaluate('document.querySelector(".map-footnote").textContent')).includes('not live server status'));
  await click('#about-open'); assert.equal(await evaluate('document.querySelector("#about-dialog").open'), true); await click('#about-close');
  assert.deepEqual(errors, []);
  console.log('Browser passed: Empyrean Traces with Spanish search and terrain filters/restoration, faction sizing, gathering subfilters, seven regions, native tiles, search/details, bookmarks, shared links, zones, empty states and responsive layouts.');
} finally {
  if (socket?.readyState === 1) { socket.send(JSON.stringify({ id: 9999, method: 'Browser.close' })); await delay(500); socket.close(); }
  child.kill(); await new Promise(resolve => server.close(resolve));
  // Fresh test profile only; never touches a user's browser directory.
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { console.log(`Chrome test profile cleanup pending: ${profile}`); }
}
