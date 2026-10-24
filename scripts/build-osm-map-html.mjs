#!/usr/bin/env node
/**
 * Builds a self-contained HTML map document and writes it to a TypeScript
 * module. The HTML has no CDN dependency: Leaflet's CSS and JS are inlined and
 * the only network requests are the visible OpenStreetMap raster tiles.
 *
 * Run with: npm run map:html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

const leafletDir = dirname(require.resolve('leaflet/package.json'));
const leafletCss = readFileSync(join(leafletDir, 'dist/leaflet.css'), 'utf8');
const leafletJs = readFileSync(join(leafletDir, 'dist/leaflet.js'), 'utf8');
const runtimeJs = readFileSync(join(here, 'osm-map-runtime.js'), 'utf8');

const customCss = String.raw`
  html,
  body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #e9e7e1;
    -webkit-tap-highlight-color: transparent;
  }

  #map {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #e9e7e1;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  #map:focus {
    outline: none;
  }

  .leaflet-container {
    background: #e9e7e1;
    font-family: inherit;
  }

  .resq-marker-icon {
    background: transparent;
    border: 0;
  }

  .resq-marker {
    width: 30px;
    height: 30px;
    border-radius: 15px;
    border: 3px solid #ffffff;
    box-sizing: border-box;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    line-height: 24px;
    text-align: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
  }

  .resq-marker--pickup {
    background: #10b981;
  }

  .resq-marker--destination {
    background: #e53935;
  }

  .resq-marker--current {
    background: #2563eb;
    font-size: 11px;
    line-height: 24px;
  }

  .resq-marker--ambulance {
    background: #1d4ed8;
  }

  .resq-marker--hospital {
    background: #7C3AED;
  }

  .resq-zoom {
    position: absolute;
    bottom: 34px;
    right: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  .resq-zoom[hidden] {
    display: none;
  }

  .resq-zoom button {
    width: 40px;
    height: 40px;
    margin: 0;
    padding: 0;
    border: 0;
    background: rgba(255, 255, 255, 0.97);
    color: #1a1a2e;
    font-family: inherit;
    font-size: 24px;
    font-weight: 500;
    line-height: 40px;
    text-align: center;
    cursor: pointer;
  }

  .resq-zoom button + button {
    border-top: 1px solid #e5e7eb;
  }

  .resq-zoom button:active {
    background: #f3f4f6;
  }
`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
  />
  <meta name="color-scheme" content="light" />
  <title>RESQ Nepal OpenStreetMap</title>
  <!-- Leaflet 1.9.4, BSD-2-Clause. Map data © OpenStreetMap contributors, ODbL. -->
  <style>${leafletCss}</style>
  <style>${customCss}</style>
</head>
<body>
  <div id="map" role="application" aria-label="Interactive OpenStreetMap map"></div>
  <div class="resq-zoom" id="zoomControls" hidden aria-hidden="true">
    <button id="zoomIn" type="button" aria-label="Zoom in">+</button>
    <button id="zoomOut" type="button" aria-label="Zoom out">−</button>
  </div>
  <noscript>OpenStreetMap requires JavaScript to display map tiles.</noscript>
  <script>${leafletJs}</script>
  <script>${runtimeJs}</script>
</body>
</html>
`;

const generated = `/* prettier-ignore */
// GENERATED FILE — run \`npm run map:html\` after editing scripts/osm-map-runtime.js.
// Leaflet 1.9.4 (BSD-2-Clause) is inlined from node_modules/leaflet/dist.
// Map data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
export const OSM_MAP_HTML = ${JSON.stringify(html)};
`;

const outputPath = join(projectRoot, 'src/components/map/osmMapHtml.generated.ts');
writeFileSync(outputPath, generated, 'utf8');
console.log(
  `Wrote ${outputPath} (${(Buffer.byteLength(generated) / 1024).toFixed(1)} KiB)`,
);
