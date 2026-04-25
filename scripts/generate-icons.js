#!/usr/bin/env node
// Renders ../icon.svg into the icon PNG set used by the PWA + native
// shells. Uses @resvg/resvg-js which is a pure-Rust SVG rasteriser
// bundled with native bindings — no browser, no fonts download, fast.
//
// Install (once, from repo root):
//   cd scripts && npm install
//
// Usage:
//   node scripts/generate-icons.js <src.svg> <outDir>

const fs = require('fs');
const path = require('path');

function loadResvg() {
  const here = __dirname;
  const candidates = [
    path.join(here, 'node_modules', '@resvg', 'resvg-js'),
    path.join(here, '..', 'tests', 'node_modules', '@resvg', 'resvg-js'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* continue */ }
  }
  try { return require('@resvg/resvg-js'); } catch (_) {}
  console.error('Could not load @resvg/resvg-js.');
  console.error('Install it with: cd scripts && npm install');
  process.exit(1);
}

(async () => {
  const srcArg = process.argv[2];
  const outArg = process.argv[3];
  if (!srcArg || !outArg) {
    console.error('Usage: node generate-icons.js <src.svg> <outDir>');
    process.exit(1);
  }

  const src = path.resolve(srcArg);
  const outDir = path.resolve(outArg);
  if (!fs.existsSync(src)) {
    console.error('SVG not found:', src);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const { Resvg } = loadResvg();
  const svgText = fs.readFileSync(src, 'utf8');

  // Maskable variant: Android crops up to the outer 20% of the icon.
  // We keep the brand background edge-to-edge and shrink the inner art
  // so that nothing essential is lost when masked. Original SVG uses a
  // 512x512 viewBox with rounded rect at (0,0,512,512). For maskable we
  // swap the rounded rect for a solid fill and re-scale the glyph group.
  function makeMaskableSvg(original) {
    // Replace the first `<rect ... rx="112" ... />` with a full-bleed
    // square fill, and wrap the glyph group in a transform that insets
    // the art by ~12% on each side.
    let out = original.replace(
      /<rect[^/]*?rx="112"[^/]*?\/>/,
      '<rect width="512" height="512" fill="url(#g)"/>'
    );
    out = out.replace(
      /<g fill="none" stroke="#ffffff"/,
      '<g transform="translate(61 0) scale(0.76 0.76)" fill="none" stroke="#ffffff"'
    );
    // Hide the PayBox text on maskable so it isn't cropped mid-letter.
    out = out.replace(/<text[\s\S]*?<\/text>/, '');
    return out;
  }

  const targets = [
    { size: 192, name: 'icon-192.png', svg: svgText },
    { size: 512, name: 'icon-512.png', svg: svgText },
    { size: 512, name: 'icon-maskable-512.png', svg: makeMaskableSvg(svgText) },
    { size: 180, name: 'apple-touch-icon-180.png', svg: svgText },
  ];

  for (const target of targets) {
    const resvg = new Resvg(target.svg, {
      fitTo: { mode: 'width', value: target.size },
      background: 'rgba(0,0,0,0)',
      font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
    });
    const pngBuf = resvg.render().asPng();
    const outPath = path.join(outDir, target.name);
    fs.writeFileSync(outPath, pngBuf);
    console.log('  wrote', outPath, `(${target.size}x${target.size})`);
  }
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
