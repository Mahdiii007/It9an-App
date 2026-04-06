#!/usr/bin/env node
/**
 * Einmalige Angleichung historischer تسجيل متزامن-Clips: uploads/echo_*.m4a
 * (früher ohne loudnorm) → erneut encodieren mit derselben Pipeline wie transcodeUploadAudio
 * (EBU R128, gleiches I wie transcodeUploadAudio) und Firestore audioUrl in posts + replies aktualisieren.
 *
 * Ausführung (Ordner Github/functions):
 *   npm run normalize-echo-m4a -- --dry-run
 *   npm run normalize-echo-m4a -- --yes --credential=/pfad/service-account.json
 *   npm run normalize-echo-m4a -- --yes --limit=20
 *   npm run normalize-echo-m4a -- --yes --file=uploads/echo_123_user.m4a
 *
 * FFmpeg:
 *   Lokal (macOS): brew install ffmpeg, optional FFMPEG=/opt/homebrew/bin/ffmpeg
 *   Oder: nach `npm run gcp-build` existiert functions/bin/ffmpeg-linux (nur Linux/x64).
 */
'use strict';

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const admin = require('firebase-admin');

const PROJECT_ID = 'it9an-neu';
const STORAGE_BUCKET = 'it9an-neu.firebasestorage.app';

/** Muss mit functions/index.js (transcodeUploadAudio) übereinstimmen. */
const LOUDNORM_I = -13;
const LOUDNORM_TP = -1.5;
const LOUDNORM_LRA = 11;

function loudnormFilterBase() {
  return `I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}`;
}

function parseLoudnormMeasureJson(stderr) {
  if (!stderr || typeof stderr !== 'string') {
    throw new Error('loudnorm: leeres stderr');
  }
  const keyIdx = stderr.indexOf('"input_i"');
  if (keyIdx < 0) throw new Error('loudnorm: kein input_i im stderr');
  let start = keyIdx;
  while (start > 0 && stderr[start] !== '{') start -= 1;
  if (stderr[start] !== '{') throw new Error('loudnorm: JSON-{ nicht gefunden');
  let depth = 0;
  for (let j = start; j < stderr.length; j += 1) {
    const c = stderr[j];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        const raw = stderr.slice(start, j + 1);
        try {
          return JSON.parse(raw);
        } catch (e) {
          throw new Error(`loudnorm: JSON.parse: ${e.message || e}`);
        }
      }
    }
  }
  throw new Error('loudnorm: JSON abgeschnitten');
}

function loudnormAfChainAnalyze() {
  return `aresample=44100:async=1,loudnorm=${loudnormFilterBase()}:print_format=json`;
}

function loudnormAfChainEncode(metrics) {
  const {
    input_i: measuredI,
    input_lra: measuredLra,
    input_tp: measuredTp,
    input_thresh: measuredThresh,
    target_offset: offset,
  } = metrics;
  if ([measuredI, measuredLra, measuredTp, measuredThresh, offset].some((v) => v === undefined || v === null)) {
    throw new Error('loudnorm: unvollständige Messwerte');
  }
  return (
    'aresample=44100:async=1,'
    + `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:linear=true:`
    + `measured_I=${measuredI}:measured_LRA=${measuredLra}:measured_TP=${measuredTp}:`
    + `measured_thresh=${measuredThresh}:offset=${offset}:print_format=summary`
  );
}

function resolveFfmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const linux = path.join(__dirname, '..', 'bin', 'ffmpeg-linux');
  if (fs.existsSync(linux)) return linux;
  return 'ffmpeg';
}

function runFfmpegCollectStderr(args) {
  return new Promise((resolve, reject) => {
    const ffPath = resolveFfmpegPath();
    const proc = spawn(ffPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-3000)}`));
    });
  });
}

function runFfmpegArgs(args) {
  return new Promise((resolve, reject) => {
    const ffPath = resolveFfmpegPath();
    const proc = spawn(ffPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-3000)}`));
    });
  });
}

function pathNeedlesForFirestoreUrlReplace(filePath) {
  const needles = new Set();
  if (!filePath || typeof filePath !== 'string') return [];
  needles.add(encodeURIComponent(filePath));
  try {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length >= 2) {
      needles.add(parts.map((p) => encodeURIComponent(p)).join('%2F'));
    }
  } catch (e) { /* ignore */ }
  if (filePath.includes('%')) {
    try {
      needles.add(encodeURIComponent(decodeURIComponent(filePath)));
    } catch (e) { /* ignore */ }
  }
  return [...needles].filter(Boolean);
}

function audioUrlMatchesAnyNeedle(url, needles) {
  if (!url || typeof url !== 'string' || !needles.length) return false;
  return needles.some((n) => url.includes(n));
}

async function replaceAudioUrlInPostsOnce(db, filePath, newUrl) {
  const needles = pathNeedlesForFirestoreUrlReplace(filePath);
  if (needles.length === 0) return 0;
  const snap = await db.collection('posts').get();
  const commits = [];
  let batch = db.batch();
  let batchSize = 0;
  let updatedDocs = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const updates = {};
    if (d.audioUrl && typeof d.audioUrl === 'string' && audioUrlMatchesAnyNeedle(d.audioUrl, needles)) {
      updates.audioUrl = newUrl;
    }
    if (Array.isArray(d.replies)) {
      let repChanged = false;
      const newReplies = d.replies.map((r) => {
        if (r && r.audioUrl && typeof r.audioUrl === 'string' && audioUrlMatchesAnyNeedle(r.audioUrl, needles)) {
          repChanged = true;
          return { ...r, audioUrl: newUrl };
        }
        return r;
      });
      if (repChanged) updates.replies = newReplies;
    }
    if (Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);
      batchSize++;
      updatedDocs++;
      if (batchSize >= 400) {
        commits.push(batch.commit());
        batch = db.batch();
        batchSize = 0;
      }
    }
  }
  if (batchSize > 0) commits.push(batch.commit());
  await Promise.all(commits);
  return updatedDocs;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    credential: (() => {
      const p = argv.find((a) => a.startsWith('--credential='));
      return p ? p.slice('--credential='.length) : null;
    })(),
    limit: (() => {
      const p = argv.find((a) => a.startsWith('--limit='));
      if (!p) return null;
      const n = parseInt(p.slice('--limit='.length), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    file: (() => {
      const p = argv.find((a) => a.startsWith('--file='));
      return p ? p.slice('--file='.length).trim() : null;
    })(),
  };
}

function initAdmin(credentialPath) {
  if (admin.apps.length) return;
  if (credentialPath) {
    const abs = path.isAbsolute(credentialPath) ? credentialPath : path.resolve(process.cwd(), credentialPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Service-Account-Datei nicht gefunden: ${abs}`);
    }
    const sa = JSON.parse(fs.readFileSync(abs, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id || PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    });
  } else {
    admin.initializeApp({
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    });
  }
}

async function listEchoM4aFiles(bucket, singleFile) {
  if (singleFile) {
    const f = bucket.file(singleFile);
    const [exists] = await f.exists();
    if (!exists) throw new Error(`Datei nicht im Bucket: ${singleFile}`);
    return [singleFile];
  }
  const [files] = await bucket.getFiles({ prefix: 'uploads/echo_' });
  return files
    .map((f) => f.name)
    .filter((name) => name.toLowerCase().endsWith('.m4a'));
}

async function normalizeOneM4a(bucket, db, filePath) {
  const bucketName = bucket.name;
  const tmpIn = path.join(os.tmpdir(), `echo-norm-in-${randomUUID()}.m4a`);
  const tmpOut = path.join(os.tmpdir(), `echo-norm-out-${randomUUID()}.m4a`);
  try {
    await bucket.file(filePath).download({ destination: tmpIn });
    let afEncode = 'aresample=44100:async=1';
    try {
      const pass1Stderr = await runFfmpegCollectStderr([
        '-y',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-i', tmpIn,
        '-vn',
        '-af', loudnormAfChainAnalyze(),
        '-f', 'null',
        '-',
      ]);
      const metrics = parseLoudnormMeasureJson(pass1Stderr);
      afEncode = loudnormAfChainEncode(metrics);
      console.log(`  loudnorm input_i=${metrics.input_i} → target ${LOUDNORM_I} LUFS`);
    } catch (lnErr) {
      console.warn('  loudnorm übersprungen (nur Resample):', lnErr.message || lnErr);
    }
    await runFfmpegArgs([
      '-y',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-i', tmpIn,
      '-vn',
      '-af', afEncode,
      '-c:a', 'aac',
      '-profile:a', 'aac_low',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      tmpOut,
    ]);

    const outBuf = await fsPromises.readFile(tmpOut);
    const token = randomUUID();
    await bucket.file(filePath).save(outBuf, {
      metadata: {
        contentType: 'audio/mp4',
        cacheControl: 'public, max-age=31536000',
        metadata: { firebaseStorageDownloadTokens: token },
      },
      resumable: false,
    });

    const encDest = encodeURIComponent(filePath);
    const newUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encDest}?alt=media&token=${token}`;
    const patched = await replaceAudioUrlInPostsOnce(db, filePath, newUrl);
    return { patched, newUrl };
  } finally {
    await fsPromises.unlink(tmpIn).catch(() => {});
    await fsPromises.unlink(tmpOut).catch(() => {});
  }
}

async function main() {
  const args = parseArgs();

  if (!args.yes && !args.dryRun) {
    console.log(`
normalize-historical-echo-m4a — historische uploads/echo_*.m4a mit loudnorm angleichen.

  Vorschau (nur Liste):
    npm run normalize-echo-m4a -- --dry-run

  Ausführen:
    npm run normalize-echo-m4a -- --yes --credential=/pfad/zu.json

  Optionen: --limit=N  --file=uploads/echo_….m4a  FFMPEG=/pfad/zu/ffmpeg
`);
    process.exit(0);
  }

  console.log('FFmpeg:', resolveFfmpegPath());

  try {
    initAdmin(args.credential);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const bucket = admin.storage().bucket();
  const db = admin.firestore();

  let names;
  try {
    names = await listEchoM4aFiles(bucket, args.file);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  if (args.limit) {
    names = names.slice(0, args.limit);
  }

  console.log(`Gefundene echo-M4A-Dateien: ${names.length}${args.file ? ' (--file)' : ''}`);
  if (names.length === 0) {
    process.exit(0);
  }

  if (args.dryRun || !args.yes) {
    names.forEach((n) => console.log('  ', n));
    if (!args.dryRun) {
      console.log('\nHinweis: Mit --yes ausführen, um zu encodieren und Firestore zu patchen.');
    }
    process.exit(0);
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < names.length; i += 1) {
    const fp = names[i];
    console.log(`[${i + 1}/${names.length}] ${fp}`);
    try {
      const { patched } = await normalizeOneM4a(bucket, db, fp);
      console.log(`  OK — Firestore-Dokumente aktualisiert: ${patched}`);
      ok += 1;
    } catch (e) {
      console.error(`  FEHLER: ${e.message || e}`);
      fail += 1;
    }
  }
  console.log(`\nFertig. OK: ${ok}, Fehler: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
