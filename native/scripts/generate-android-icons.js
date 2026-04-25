#!/usr/bin/env node
// Regenerates Android launcher icons from ../../icon.svg using the
// @resvg/resvg-js rasteriser installed in ../../scripts/node_modules.
// This is a lightweight alternative to @capacitor/assets (which needs
// sharp + native deps) and covers the minimum set Android asks for.
//
// Usage:  node scripts/generate-android-icons.js

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const NATIVE_ROOT = path.resolve(HERE, '..');
const WEB_ROOT = path.resolve(NATIVE_ROOT, '..');
const SVG_PATH = path.join(WEB_ROOT, 'icon.svg');
const ANDROID_RES = path.join(NATIVE_ROOT, 'android', 'app', 'src', 'main', 'res');

function loadResvg() {
  const candidates = [
    path.join(WEB_ROOT, 'scripts', 'node_modules', '@resvg', 'resvg-js'),
    path.join(NATIVE_ROOT, 'node_modules', '@resvg', 'resvg-js'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) {}
  }
  try { return require('@resvg/resvg-js'); } catch (_) {}
  console.error('Could not load @resvg/resvg-js.');
  console.error('Run: cd ../scripts && npm install');
  process.exit(1);
}

const { Resvg } = loadResvg();
const svgText = fs.readFileSync(SVG_PATH, 'utf8');

// Android asks for the same launcher icon at five densities.
// mdpi=48px, hdpi=72, xhdpi=96, xxhdpi=144, xxxhdpi=192.
const densities = [
  { bucket: 'mipmap-mdpi',    size: 48 },
  { bucket: 'mipmap-hdpi',    size: 72 },
  { bucket: 'mipmap-xhdpi',   size: 96 },
  { bucket: 'mipmap-xxhdpi',  size: 144 },
  { bucket: 'mipmap-xxxhdpi', size: 192 },
];

function maskableSvg(original) {
  return original
    .replace(
      /<rect[^/]*?rx="112"[^/]*?\/>/,
      '<rect width="512" height="512" fill="url(#g)"/>'
    )
    .replace(
      /<g fill="none" stroke="#ffffff"/,
      '<g transform="translate(61 0) scale(0.76 0.76)" fill="none" stroke="#ffffff"'
    )
    .replace(/<text[\s\S]*?<\/text>/, '');
}

function roundSvg(original) {
  // Android "round" variant — make the outer rect a full circle.
  return original.replace(
    /<rect[^/]*?rx="112"[^/]*?\/>/,
    '<circle cx="256" cy="256" r="256" fill="url(#g)"/>'
  );
}

function render(svg, size, background) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: background || 'rgba(0,0,0,0)',
  });
  return r.render().asPng();
}

const masked = maskableSvg(svgText);
const round = roundSvg(svgText);

for (const { bucket, size } of densities) {
  const dir = path.join(ANDROID_RES, bucket);
  if (!fs.existsSync(dir)) continue;
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), render(svgText, size));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), render(round, size));
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), render(masked, size, 'rgba(43,67,236,1)'));
  console.log('  wrote', bucket, size + 'px');
}

// Play Store requires a 512x512 high-res icon as well (used on listings).
fs.mkdirSync(path.join(ANDROID_RES, 'drawable'), { recursive: true });
fs.writeFileSync(path.join(ANDROID_RES, 'drawable', 'ic_launcher_store.png'), render(svgText, 512));
console.log('  wrote drawable/ic_launcher_store.png 512px');

// Splash screen PNGs — a simple full-bleed solid at each bucket.
const splashPath = path.join(ANDROID_RES, 'drawable', 'splash.png');
fs.writeFileSync(splashPath, render(svgText, 1024, 'rgba(43,67,236,1)'));
console.log('  wrote drawable/splash.png 1024px');

console.log('[icons] android done');
