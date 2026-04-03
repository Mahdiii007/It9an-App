#!/usr/bin/env node
/**
 * Einmalige Bereinigung: Firestore + Storage für den entfernten Gastmodus (uid / role "guest").
 *
 * Ausführung (im Ordner Github/functions):
 *   npm run cleanup-guest -- --yes
 *
 * Authentifizierung (eine der Varianten):
 *   A) Service-Account-JSON (empfohlen lokal):
 *      npm run cleanup-guest -- --yes --credential=/pfad/zu/it9an-neu-xxxxx.json
 *      oder: export GOOGLE_APPLICATION_CREDENTIALS=/pfad/zur.json && npm run cleanup-guest -- --yes
 *   B) Application Default Credentials:
 *      gcloud auth application-default login
 *      (Google-Konto mit Zugriff auf Projekt it9an-neu)
 *
 * Ohne --yes wird nur eine Kurzinfo ausgegeben (Dry-Run).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const GUEST_UID = 'guest';
const PROJECT_ID = 'it9an-neu';
const STORAGE_BUCKET = 'it9an-neu.firebasestorage.app';

let db;
let bucket;

function parseCredentialArg() {
  const prefix = '--credential=';
  for (const a of process.argv) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return null;
}

function initAdmin() {
  if (admin.apps.length) {
    db = admin.firestore();
    bucket = admin.storage().bucket();
    return;
  }
  const credArg = parseCredentialArg();
  if (credArg) {
    const abs = path.isAbsolute(credArg) ? credArg : path.resolve(process.cwd(), credArg);
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
  db = admin.firestore();
  bucket = admin.storage().bucket();
}

function printCredentialHelp(err) {
  console.error('\n❌ Keine gültigen Google-Credentials für Firestore/Storage.');
  if (err && err.message) console.error('   (' + err.message + ')\n');
  console.error('So geht’s weiter:\n');
  console.error('  1) Firebase Console → Projekteinstellungen → Dienstkonten → „Neuen privaten Schlüssel“');
  console.error('     JSON speichern, dann z. B.:');
  console.error(`     npm run cleanup-guest -- --yes --credential="$HOME/Downloads/it9an-neu-….json"\n`);
  console.error('  2) Oder Application Default Credentials (ohne JSON-Datei im Befehl):');
  console.error('     gcloud auth application-default login');
  console.error('     Danach erneut: npm run cleanup-guest -- --yes\n');
  console.error('Hinweis: `firebase login` allein reicht für dieses Skript nicht — es braucht Admin SDK-Zugriff.\n');
}

async function deleteStorageFromUrl(url) {
  if (!url || typeof url !== 'string') return;
  try {
    const marker = '/o/';
    const i = url.indexOf(marker);
    if (i === -1) return;
    const pathPart = url.slice(i + 3).split('?')[0];
    const filePath = decodeURIComponent(pathPart);
    await bucket.file(filePath).delete({ ignoreNotFound: true });
  } catch (e) {
    console.warn('  [storage]', (url || '').slice(0, 96), e.message);
  }
}

async function runCleanup() {
  let removedPosts = 0;
  let patchedPosts = 0;

  const postsSnap = await db.collection('posts').get();
  for (const docSnap of postsSnap.docs) {
    const data = docSnap.data();
    const uid = GUEST_UID;

    if (data.uid === uid) {
      if (data.replies) {
        for (const r of data.replies) {
          if (r.uid && r.uid !== uid) {
            try {
              await db.collection('users').doc(r.uid).update({
                totalRepliesCount: admin.firestore.FieldValue.increment(-1),
                totalLikes: admin.firestore.FieldValue.increment(-((r.likes && r.likes.length) || 0)),
              });
            } catch (e) {
              console.warn('  reply author decrement', r.uid, e.message);
            }
          }
        }
      }
      const notifQ = await db.collection('notifications').where('postId', '==', docSnap.id).get();
      for (const nd of notifQ.docs) {
        await nd.ref.delete();
      }
      const savedQ = await db.collection('savedRecordings').where('postId', '==', docSnap.id).get();
      for (const sd of savedQ.docs) {
        await sd.ref.delete();
      }
      if (data.audioUrl) await deleteStorageFromUrl(data.audioUrl);
      if (data.echoMixAudioUrl) await deleteStorageFromUrl(data.echoMixAudioUrl);
      if (data.replies) {
        for (const r of data.replies) {
          if (r.audioUrl) await deleteStorageFromUrl(r.audioUrl);
        }
      }
      await docSnap.ref.delete();
      removedPosts++;
    } else {
      const likedMain = data.likes && data.likes.some((l) => (typeof l === 'object' ? l.uid : l) === uid);
      let likedReplies = 0;
      if (data.replies) {
        data.replies.forEach((r) => {
          if (r.likes && r.likes.some((l) => (typeof l === 'object' ? l.uid : l) === uid)) likedReplies++;
        });
      }
      if (likedMain && data.uid) {
        try {
          await db.collection('users').doc(data.uid).update({ totalLikes: admin.firestore.FieldValue.increment(-1) });
        } catch (e) {
          console.warn('  main like dec', data.uid, e.message);
        }
      }
      if (likedReplies > 0 && data.replies) {
        const authorsToDec = {};
        data.replies.forEach((r) => {
          if (r.likes && r.likes.some((l) => (typeof l === 'object' ? l.uid : l) === uid) && r.uid) {
            authorsToDec[r.uid] = (authorsToDec[r.uid] || 0) + 1;
          }
        });
        for (const [au, c] of Object.entries(authorsToDec)) {
          try {
            await db.collection('users').doc(au).update({ totalLikes: admin.firestore.FieldValue.increment(-c) });
          } catch (e) {
            console.warn('  reply like dec', au, e.message);
          }
        }
      }
      const newLikes = (data.likes || []).filter((l) => (typeof l === 'object' ? l.uid : l) !== uid);
      const newReplies = (data.replies || []).map((r) => {
        if (!r.likes) return r;
        const rNewLikes = r.likes.filter((l) => (typeof l === 'object' ? l.uid : l) !== uid);
        return rNewLikes.length !== r.likes.length ? { ...r, likes: rNewLikes } : r;
      });
      const updates = {};
      if (newLikes.length !== (data.likes || []).length) updates.likes = newLikes;
      const hasRepliesLikeChange = newReplies.some(
        (r, i) => (r.likes || []).length !== ((data.replies || [])[i]?.likes || []).length
      );
      if (hasRepliesLikeChange) updates.replies = newReplies;
      if (Object.keys(updates).length > 0) {
        await docSnap.ref.update(updates);
        patchedPosts++;
      }
    }
  }

  const statsSnap = await db.collection('stats').get();
  for (const sDoc of statsSnap.docs) {
    const sData = sDoc.data();
    const viewers =
      sData.viewers && typeof sData.viewers === 'object' && !Array.isArray(sData.viewers) ? sData.viewers : {};
    if (viewers[GUEST_UID]) {
      const userCount = viewers[GUEST_UID].count || 0;
      await sDoc.ref.update({
        [`viewers.${GUEST_UID}`]: admin.firestore.FieldValue.delete(),
        totalRepetitions: admin.firestore.FieldValue.increment(-userCount),
        verseViewCount: admin.firestore.FieldValue.increment(-1),
      });
    }
  }

  const savedSnap = await db.collection('savedRecordings').where('uid', '==', GUEST_UID).get();
  for (const d of savedSnap.docs) {
    await d.ref.delete();
  }

  const notifToGuest = await db.collection('notifications').where('to', '==', GUEST_UID).get();
  for (const nd of notifToGuest.docs) {
    await nd.ref.delete();
  }

  try {
    await db.collection('fcmTokens').doc(GUEST_UID).delete();
  } catch (e) {
    /* ignore */
  }
  const fcmSnap = await db.collection('fcmTokens').where('uid', '==', GUEST_UID).get();
  for (const fd of fcmSnap.docs) {
    await fd.ref.delete();
  }

  try {
    await db.collection('users').doc(GUEST_UID).delete();
  } catch (e) {
    console.warn('  users/guest', e.message);
  }
  const roleGuestSnap = await db.collection('users').where('role', '==', 'guest').get();
  for (const udoc of roleGuestSnap.docs) {
    await udoc.ref.delete();
  }

  console.log('Fertig. Gelöschte Gast-Posts:', removedPosts, '| Posts mit entfernten Gast-Likes:', patchedPosts);
}

async function main() {
  const yes = process.argv.includes('--yes');
  if (!yes) {
    console.log('Dry-Run: keine Änderungen.');
    console.log('Zum Ausführen: npm run cleanup-guest -- --yes');
    console.log('Mit Service-Account-JSON: npm run cleanup-guest -- --yes --credential=/pfad/zur.json');
    console.log('Oder: gcloud auth application-default login');
    console.log(`Projekt: ${PROJECT_ID} | Storage: ${STORAGE_BUCKET}`);
    return;
  }
  try {
    initAdmin();
  } catch (e) {
    printCredentialHelp(e);
    process.exit(1);
  }
  console.log('cleanup-guest-data: start …');
  try {
    await runCleanup();
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/default credentials|Could not load/i.test(msg)) {
      printCredentialHelp(e);
      process.exit(1);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
