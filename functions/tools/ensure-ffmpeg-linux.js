#!/usr/bin/env node
/**
 * Lädt Linux-amd64-FFmpeg nach functions/bin/ffmpeg-linux.
 * Liegt unter tools/ (nicht scripts/) — manche Packager ignorieren Ordner „scripts“ fälschlich.
 * Läuft in der Cloud als npm „gcp-build“ nach npm ci.
 * Lokal/Emulator: node tools/ensure-ffmpeg-linux.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'ffmpeg-linux');
const TARBALL_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function main() {
  if (fs.existsSync(BIN)) {
    try {
      fs.accessSync(BIN, fs.constants.X_OK);
      console.log('ensure-ffmpeg-linux: OK', BIN);
      return;
    } catch (e) {
      /* neu laden */
    }
  }
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  const tmpXz = path.join(os.tmpdir(), `ffmpeg-amd64-${Date.now()}.tar.xz`);
  const tmpDir = path.join(os.tmpdir(), `ffmpeg-extract-${Date.now()}`);
  console.log('ensure-ffmpeg-linux: Download…', TARBALL_URL);
  await download(TARBALL_URL, tmpXz);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    execFileSync('tar', ['-xJf', tmpXz, '-C', tmpDir], { stdio: 'inherit' });
    const entries = fs.readdirSync(tmpDir);
    if (entries.length !== 1) throw new Error('Unerwartetes Tar-Layout: ' + entries.join(', '));
    const inner = path.join(tmpDir, entries[0], 'ffmpeg');
    if (!fs.existsSync(inner)) throw new Error('ffmpeg fehlt im Archiv');
    fs.copyFileSync(inner, BIN);
    fs.chmodSync(BIN, 0o755);
    console.log('ensure-ffmpeg-linux: installiert', BIN);
  } finally {
    try { fs.rmSync(tmpXz, { force: true }); } catch (e) { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('ensure-ffmpeg-linux:', e);
  process.exit(1);
});
