#!/usr/bin/env node
/**
 * Erhöht appSettings/forceLogout.version — gleiche Wirkung wie Admin-Button „تسجيل خروج الجميع“.
 * Benötigt Application Default Credentials (z. B. GOOGLE_APPLICATION_CREDENTIALS oder google-github-actions/auth).
 */
'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const ref = db.doc('appSettings/forceLogout');

ref
  .set(
    {
      version: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
  .then(() => ref.get())
  .then((snap) => {
    const v = snap.exists ? snap.data().version : '?';
    console.log('forceLogout.version →', v);
    process.exit(0);
  })
  .catch((err) => {
    console.error('bump-force-logout-on-deploy:', err.message || err);
    process.exit(1);
  });
