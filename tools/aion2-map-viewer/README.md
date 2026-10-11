# AION 2 Interactive map

Standalone, responsive map atlas using the actual client artwork and decoded
placements. It does not connect to the game, database or redirector. No npm
dependencies, third-party CDN scripts, accounts or analytics are required.

The interface uses original AION2 UI sprites and the client English UI font:
rectangular floating windows, faction tabs, silver trim, cyan selection lines
and gold actions. Map and filter icons, checkboxes and standard buttons come
from the cooked client atlases, not generated illustrations or Unicode symbols.
Exact source packages and crop rectangles are recorded in `assets/ui/sources.json`.

## Open the prepared website

Requires Node.js 22 or newer. From the repository root:

Double-click `Build-Deploy-Website.bat` to test, rebuild `dist`, restart only
the local map server and open the website. Errors stay visible in the batch
window. Server output goes into timestamped `development_logs/map-viewer-*.log`
files. Existing exported map assets and generated datasets are reused; this
does not re-extract the client or regenerate game data.

For deployment without opening a browser, or on another local port:

```bat
Build-Deploy-Website.bat -NoBrowser -Port 4180
```

On Linux, use the Bash launcher with Node.js 22 or newer, without PowerShell:

```bash
bash Build-Deploy-Website.sh --no-browser
# Optional alternate local port:
bash Build-Deploy-Website.sh --no-browser --port 4180
```

The Linux launcher runs the same tests and packaging, starts the server in the
background, verifies its health, and keeps timestamped logs in `development_logs`.
Repeat the command to rebuild and restart a server it previously launched.
It verifies the saved PID, process start time and exact script path before
stopping a process. An unrelated listener, or a manually launched server,
must be stopped separately or avoided with `--port`. No root access or firewall
changes are required. On a Linux desktop, omit `--no-browser` to open the map.

A Git clone includes the native tiles in `assets/tiles/`, so it can be built
and served directly. The Node build and runtime are cross-platform; the client
asset extraction scripts are Windows-only.
Alternatively, copy the complete generated `dist/` folder and run
`node tools/aion2-map-viewer/server.mjs` to serve that release without rebuilding.
GitHub Actions runs the website tests on Linux with Node 22 and 24, including
an isolated deployment fixture for first launch, restart, stale/foreign PIDs,
port conflicts, failed tests and recovery after a packaging failure. The fixture
does not require or publish the ignored native map tiles.

This deploys locally, not to a public hosting provider. To open an already built
release without rebuilding:

```powershell
.\tools\aion2-map-viewer\Start-Aion2MapViewer.ps1
```

Open http://127.0.0.1:4179/. The launcher uses the generated release in `dist/`.
The listener is loopback-only unless you explicitly configure `HOST`.

Choose Elyos, Asmodians or Abyss, then a region. Search by localized creature,
resource or place name, item yield, definition ID, creature type or zone name.
The zone dropdown uses decoded polygons, not nearest-label approximations.
Advanced filters include gathering/creature type, monster level, saved locations,
zone boundaries and label visibility. Counts mean client-authored locations,
not currently active spawns.

Expand **Gathering options** beneath the gathering layer to select multiple
resource categories or one specific node. Categories are the decoded
`GatherSource.SourceType` values: fruit/berries, herbs, gemstones, ore, Odyle,
shellfish, wood and vegetables, where present in the selected region. Counts
are region totals. These subfilters affect gathering markers only; monsters
and other layers remain visible. Selections are included in shared links.

**Empyrean Traces** has its own filter section above the other map layers,
separate from gathering nodes. Use **Show traces** to toggle all collectibles;
**Trace locations** opens by default with ground, air and water filters.
Search accepts the English names and
the decoded Spanish aliases, including `Rastro empíreo: Verteron`.
Verteron has 559 regular locations: 389 ground, 120 air and 50 water.
The one quest-specific copy stays in landmarks and is not counted again.
Terrain filters are included in shared links. Collection status is not received
from the game; bookmarks are browser-local, not proof of collection.

Drag or use arrow keys to pan. Scroll, pinch, press `+`/`-`, or use the zoom
buttons. `Home` fits the whole map; `/` focuses search. Icons stay at their exact
decoded coordinates while panning or zooming. Only records at the same XY
location share a count badge; nearby positions are never averaged into clusters.
Click a marker or a result to inspect its positions. The detail card can step through placements.
Bookmarks remain in your browser. Share links preserve the region, camera,
selection and filters; they do not upload your bookmarks.

## Current coverage

| Region | Gathering positions | Empyrean Traces | Monster positions | Zones |
| --- | ---: | ---: | ---: | ---: |
| Verteron | 2,733 | 559 | 10,422 | 134 |
| Eltnen | 1,435 | 140 | 4,895 | 43 |
| Altgard | 2,692 | 559 | 12,390 | 132 |
| Morheim | 1,345 | 140 | 3,222 | 44 |
| Chaotic Lower Reshanta | 240 | 200 | 1,969 | 23 |
| Chaotic Middle Reshanta | 0 | 100 | 2,937 | 12 |
| Chaotic Upper Reshanta | 0 | 0 | 1,576 | 8 |

58,202 total client-authored locations, including NPCs, travel entrances, settlements,
zone labels and selected interactive objects. Zero unlinked placement definitions
in these seven datasets. This release covers the main world/Abyss regions,
not every instanced dungeon or tutorial map.

**Not live spawn tracking.** `SpawnInfoList` can contain alternative NPC IDs,
multiple candidate positions and conditional groups. Not every marker is active
simultaneously. Repeated IDs within a group are deduplicated rather than inflating
map counts. Geometry links zones in 2D; overlapping cave floors may need altitude
inspection. Monster HP, damage, respawn timing and drop probabilities are not
fabricated from missing server-side data. Material yields are possible outcomes.
These are actual decoded coordinate records, not estimated map points. They are
still a client snapshot, not a subscription to official server state.

## Rebuild from the local extracted client

The rebuild scripts expect a local extraction under `artifacts/` (decoded client
tables from [Aion2_Client_Decoding](https://github.com/SemaAlter/Aion2_Client_Decoding)
and a Uex texture exporter). The prebuilt assets in this repository make this
step optional. Run in this order, from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/aion2-map-viewer/Build-MapTextures.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/aion2-map-viewer/Build-UIAssets.ps1 -Export
node tools/aion2-map-viewer/build-data.mjs
node --test tools/aion2-map-viewer/tests/*.test.mjs
node tools/aion2-map-viewer/build-site.mjs
node tools/aion2-map-viewer/server.mjs
```

Texture generation reuses previously exported PNG tiles. Missing regions are
exported with the repository's existing Uex profile. Use `-ForceExport` after a
client update. Requires the installed client, .NET/Uex and the decoded October
snapshot already present locally. No executable unpacking is involved.

The builder reads `MapData`, `WorldMap`, `Map`, `Subzone`, `NpcData`, `EnvObjData`,
`GatherSource`, `GatherSourceMaterial`, `Item`, `WorldMapUIRegion`, and English
localization. Generated JSON contains normalized public map data and provenance,
not entire extracted packages. Runtime requests load only the selected region.

The first native tile index is **X**, the second **Y**; positive map Y points
downward. World XY is converted using `StartWorldLocation`, `SectorWorldSize`,
`SectorSize`, and `SectorPlaneSize`. Label positions are already in map-plane
units. No guessed scale factor or coordinate rotation is applied.

Native detail streams from `assets/tiles/<region>/<size>/<x>_<y>.png` at
256/512/1024 pixels, and 2048 where the exported native texture supports it.
Verteron reaches 16,384 × 16,384 map pixels; other regions use their actual
exported resolutions rather than being upscaled and called full quality.
Original highest-resolution PNG tiles are copied byte-for-byte. Overview PNGs
provide an immediate background while visible higher-detail tiles load.
Decoded tile caching and four concurrent image requests limit memory/network use.

`dist/` is ignored by Git. The native tiles, overview images, normalized
datasets, source and tests are versioned, so a fresh checkout can build the
full-resolution release.

## Public deployment

`npm run build` creates a standalone **`dist/`** directory after validating every
required tile. Packaging finishes before swapping the existing release.
Only deploy that directory, not the repository or extracted client files.
It contains no database passwords, AES keys, server configs or captures.

Two supported deployment forms:

1. Upload `dist/` to a static host/object-storage CDN with HTTPS. No SPA rewrite
   is necessary; share state uses URL fragments. Serve PNGs as `image/png` and
   JSON as `application/json`. Revalidate HTML/JS/JSON; map tiles may cache for
   a day. Gzip/Brotli sidecars are provided if the host supports negotiation.
2. Use the included read-only Node server behind an HTTPS reverse proxy, or
   build the container **after generating `dist/`**:

```powershell
Set-Location tools/aion2-map-viewer
docker build -t aion2-interactive-map .
docker run --rm -p 127.0.0.1:4179:4179 aion2-interactive-map
```

The container runs as a non-root user. Configure your reverse proxy/domain/TLS
and forward to port 4179. The server supports `PORT`, `HOST`, `/healthz`, HEAD,
ETag revalidation, compression and security headers; it refuses writes, hidden
files, malformed paths and escapes outside the static root. Do not expose the
game database or redirector just to serve this website. No network settings or
firewall rules are changed by the viewer.

Public hosting/domain setup is not performed automatically. Confirm your rights
to distribute the artwork before making a public mirror. This is an independent,
unofficial atlas; AION 2 names and artwork belong to their respective owners.

## Verification

```powershell
Set-Location tools/aion2-map-viewer
npm test
npm run test:browser
$env:MAP_TEST_RELEASE = '1'
npm run test:browser
```

Browser tests use a fresh temporary Chrome profile, never your personal one.
Set `CHROME_PATH` if Chrome is installed elsewhere. They exercise seven regions,
native tiles, wheel/button zoom, dragging, search, gathering/monster detail cards,
bookmarks, link restoration, zone filters, empty states, mobile layouts and the
coverage dialog. Screenshots are ignored QA artifacts. Unit/integration tests
cover coordinate transforms, polygon membership, filter combinations, stable marker groups,
generated-data integrity and HTTP security/cache behavior.

## Structure

`core.js`: pure geometry/filtering helpers and layer definitions.
`map-renderer.js`: canvas camera, tiles, exact-location markers, hit testing and touch/keyboard input.
`app.js`: region loading, filters, search results, details, links and bookmarks.
`build-data.mjs`: decoded client joins and region datasets.
`Build-MapTextures.ps1`: authentic map texture export/detail levels.
`Build-UIAssets.ps1`: original client UI atlas crops and TrueType font export.
`build-site.mjs`: validated static deployment/compression.
`server.mjs`: read-only release serving; no game-server dependency.
