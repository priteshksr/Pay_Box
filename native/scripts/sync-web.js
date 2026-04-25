#!/usr/bin/env node
// Copies the web PWA (index.html, sw.js, manifest.json, icon.svg,
// icons/, plus .well-known/) from the parent My_Box/ folder into
// native/www/ so Capacitor can bundle it. Run via `npm run build`
// before `npx cap sync`.
//
// The service worker is included but is a no-op on native because
// index.html checks `Native.on` before registering it.

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const NATIVE_ROOT = path.resolve(HERE, '..');
const WEB_ROOT = path.resolve(NATIVE_ROOT, '..');
const OUT = path.join(NATIVE_ROOT, 'www');

const COPY = [
  { src: 'index.html', type: 'file', required: true },
  { src: 'sw.js', type: 'file', required: true },
  { src: 'manifest.json', type: 'file', required: true },
  { src: 'icon.svg', type: 'file', required: true },
  { src: 'icons', type: 'dir', required: false },
  { src: '.well-known', type: 'dir', required: false },
];

// Files inside the web root that should NEVER end up in the native
// bundle (tests, node_modules, docs, git metadata).
const DENY = new Set([
  'tests', 'native', 'scripts', 'node_modules',
  'NATIVE.md', 'CLOUD_SYNC.md', 'TESTING.md', 'README.md',
  '.git', '.github', '.DS_Store',
]);

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const child of fs.readdirSync(p)) rimraf(path.join(p, child));
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (DENY.has(name)) continue;
    const s = path.join(from, name);
    const d = path.join(to, name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Wipe www/ so stale assets don't linger.
rimraf(OUT);
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
for (const entry of COPY) {
  const from = path.join(WEB_ROOT, entry.src);
  const to = path.join(OUT, entry.src);
  if (!fs.existsSync(from)) {
    if (entry.required) {
      console.error(`[sync-web] missing required asset: ${from}`);
      process.exit(1);
    }
    continue;
  }
  if (entry.type === 'dir') copyDir(from, to);
  else copyFile(from, to);
  copied += 1;
  console.log(`  sync ${entry.src}`);
}

// Post-process: flag the bundle as native so the app can optimise its
// behaviour (skip SW registration, hide install prompt, etc). We also
// inject a tiny bootstrap that hints Capacitor is about to run. The
// real Capacitor runtime will overwrite window.Capacitor when the
// WebView loads, so this is purely a hint for lighthouse-style audits
// of the bundle in isolation.
try {
  const indexPath = path.join(OUT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const marker = '<!-- capacitor-bundled -->';
  if (!html.includes(marker)) {
    html = html.replace(
      '<head>',
      `<head>\n  ${marker}\n  <meta name="app-mode" content="capacitor" />`
    );
    fs.writeFileSync(indexPath, html);
  }
} catch (err) {
  console.warn('[sync-web] index.html post-process skipped:', err && err.message);
}

console.log(`[sync-web] copied ${copied} entries into ${OUT}`);
