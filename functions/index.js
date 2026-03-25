const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { onObjectFinalized } = require('firebase-functions/v2/storage');

admin.initializeApp();

/** Von ensure-ffmpeg-linux.js vor deploy nach functions/bin/ffmpeg-linux */
const _ffmpegPath = (() => {
  const p = path.join(__dirname, 'bin', 'ffmpeg-linux');
  if (fsSync.existsSync(p)) return p;
  return null;
})();

function runFfmpegArgs(args) {
  return new Promise((resolve, reject) => {
    if (!_ffmpegPath) {
      reject(new Error('FFmpeg binary nicht verfügbar'));
      return;
    }
    const ff = spawn(_ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += String(d); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-3000)}`));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ersetzt eine Storage-URL (encodeURIComponent des alten Objektpfads) in posts + replies. */
async function replaceAudioUrlInPostsOnce(db, pathNeedle, newUrl) {
  const snap = await db.collection('posts').get();
  const commits = [];
  let batch = db.batch();
  let batchSize = 0;
  let updatedDocs = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const updates = {};
    if (d.audioUrl && typeof d.audioUrl === 'string' && d.audioUrl.includes(pathNeedle)) {
      updates.audioUrl = newUrl;
    }
    if (Array.isArray(d.replies)) {
      let repChanged = false;
      const newReplies = d.replies.map((r) => {
        if (r && r.audioUrl && typeof r.audioUrl === 'string' && r.audioUrl.includes(pathNeedle)) {
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

const HOSTING_BASE = process.env.GCLOUD_PROJECT ? `https://${process.env.GCLOUD_PROJECT}.web.app` : 'https://it9an-neu.web.app';
const manifestCache = {};

async function fetchManifestForStage(stageId) {
  const id = stageId != null ? Number(stageId) : 4;
  if (manifestCache[id]) return manifestCache[id];
  try {
    const url = `${HOSTING_BASE}/assets-v${id}/manifest.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      const verses = j.versesPerLesson || (j.lessons && j.lessons.map(l => l.verses)) || [];
      const titles = j.lessonTitles || (j.lessons && j.lessons.map(l => l.title)) || [];
      manifestCache[id] = { name: j.stageName || '', versesPerLesson: Array.isArray(verses) ? verses : [], lessonTitles: Array.isArray(titles) ? titles : [] };
      return manifestCache[id];
    }
  } catch (e) { /* ignore */ }
  manifestCache[id] = { name: '', versesPerLesson: [], lessonTitles: [] };
  return manifestCache[id];
}

function getLessonVerseFromManifest(cfg, fileId) {
  const verses = cfg.versesPerLesson || [];
  if (verses.length === 0) return { lesson: 0, verse: parseInt(fileId, 10), lessonTitle: '' };
  const fid = parseInt(fileId, 10);
  let startId = 1;
  for (let i = 0; i < verses.length; i++) {
    const end = startId + verses[i] - 1;
    if (fid >= startId && fid <= end) {
      const lessonTitle = (cfg.lessonTitles && cfg.lessonTitles[i]) ? cfg.lessonTitles[i] : '';
      return { lesson: i + 1, verse: fid - startId + 1, lessonTitle };
    }
    startId += verses[i];
  }
  return { lesson: 0, verse: fid, lessonTitle: '' };
}

function stripYearFromName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

async function getNotifCountForUser(db, to, uid) {
  if (to === 'teachers') {
    const q = db.collection('notifications').where('to', '==', 'teachers');
    const snap = await q.get();
    let count = 0;
    snap.forEach((doc) => {
      const data = doc.data();
      const cleared = data.clearedBy || [];
      if (!cleared.includes(uid)) count++;
    });
    return count;
  }
  const q = db.collection('notifications').where('to', '==', uid);
  const snap = await q.get();
  return snap.size;
}

async function getFcmTokensForTo(db, to, stageId, type) {
  const tokens = [];
  if (to === 'teachers') {
    const q = db.collection('fcmTokens').where('role', '==', 'teacher');
    const snap = await q.get();
    const seen = new Set();
    const stageIdNum = stageId != null ? Number(stageId) : null;
    for (const t of snap.docs) {
      const data = t.data();
      const tok = data.token;
      const uid = data.uid || t.id;
      if (!tok || seen.has(tok)) continue;
      if (!type || type === 'admin_message' || stageIdNum == null) {
        seen.add(tok);
        tokens.push(tok);
        continue;
      }
      const userDoc = await db.collection('users').doc(uid).get();
      let notifStages = [];
      if (userDoc.exists && Array.isArray(userDoc.data().notifStages)) {
        notifStages = userDoc.data().notifStages;
      }
      if (notifStages.length === 0) {
        seen.add(tok);
        tokens.push(tok);
      } else if (notifStages.map(s => Number(s)).includes(stageIdNum)) {
        seen.add(tok);
        tokens.push(tok);
      }
    }
  } else {
    const t = await db.collection('fcmTokens').doc(to).get();
    if (t.exists && t.data().token) tokens.push(t.data().token);
  }
  return tokens;
}

async function sendDismissPush(tokens, tag) {
  if (tokens.length === 0) return;
  const body = 'تم حذف التسجيل';
  const messages = tokens.map((token) => ({
    token,
    data: { action: 'dismiss', tag, title: 'تطبيق إتقان', body },
    webpush: {
      headers: { Urgency: 'low' },
      data: { action: 'dismiss', tag, title: 'تطبيق إتقان', body },
      notification: { title: 'تطبيق إتقان', body, tag }
    }
  }));
  try {
    const res = await admin.messaging().sendEach(messages);
    if (res.failureCount > 0) {
      res.responses.forEach((r, i) => {
        if (!r.success) console.warn('Dismiss push failed:', r.error);
      });
    }
  } catch (e) {
    console.warn('sendDismissPush error:', e);
  }
}

/** Beim Löschen eines Posts: Dismiss-Push senden, dann Firestore-Benachrichtigungen löschen */
exports.onPostDelete = functions
  .region('europe-west3')
  .firestore.document('posts/{postId}')
  .onDelete(async (snap, context) => {
    const db = admin.firestore();
    const postId = context.params.postId;
    const q = db.collection('notifications').where('postId', '==', postId);
    const snapNotif = await q.get();
    for (const d of snapNotif.docs) {
      const data = d.data();
      const tag = `it9an-${data.type || ''}-${data.postId || ''}-${d.id}`;
      const tokens = await getFcmTokensForTo(db, data.to, data.stageId, data.type);
      await sendDismissPush(tokens, tag);
    }
    const batch = db.batch();
    snapNotif.docs.forEach((d) => batch.delete(d.ref));
    if (snapNotif.size > 0) await batch.commit();
  });

/** Beim Entfernen einer Antwort: Dismiss-Push senden, dann reply-Benachrichtigung löschen */
exports.onPostUpdate = functions
  .region('europe-west3')
  .firestore.document('posts/{postId}')
  .onUpdate(async (change, context) => {
    const db = admin.firestore();
    const postId = context.params.postId;
    const before = change.before.data();
    const after = change.after.data();
    const oldReplies = before.replies || [];
    const newReplies = after.replies || [];
    const oldTimestamps = new Set(oldReplies.map((r) => r.timestamp));
    const newTimestamps = new Set(newReplies.map((r) => r.timestamp));
    const removedTimestamps = [...oldTimestamps].filter((t) => t != null && !newTimestamps.has(t));
    for (const replyTs of removedTimestamps) {
      const q = db.collection('notifications').where('postId', '==', postId).where('type', '==', 'reply').where('replyTimestamp', '==', replyTs);
      const snap = await q.get();
      for (const d of snap.docs) {
        const data = d.data();
        const tag = `it9an-${data.type || ''}-${data.postId || ''}-${d.id}`;
        const tokens = await getFcmTokensForTo(db, data.to, data.stageId, data.type);
        await sendDismissPush(tokens, tag);
        await db.collection('notifications').doc(d.id).delete();
      }
    }
  });

exports.sendPushOnNotif = functions
  .region('europe-west3')
  .firestore.document('notifications/{id}')
  .onCreate(async (snap, context) => {
    const db = admin.firestore();
    const notifId = context.params.id;
    const sentRef = db.collection('pushSent').doc(notifId);
    /* Bereits erfolgreich versendet → kein zweites Mal (parallele/nachträgliche Läufe) */
    if ((await sentRef.get()).exists) return;

    const d = snap.data();
    const to = d.to;
    const recipients = [];

    if (to === 'teachers') {
      const stageIdRaw = d.stageId != null ? d.stageId : null;
      const stageIdNum = stageIdRaw != null ? Number(stageIdRaw) : null;
      const isAdminMessage = d.type === 'admin_message';
      const q = db.collection('fcmTokens').where('role', '==', 'teacher');
      const snapTeachers = await q.get();
      const seenTokens = new Set();
      for (const t of snapTeachers.docs) {
        const data = t.data();
        const tok = data.token;
        const uid = data.uid || t.id;
        if (!tok || seenTokens.has(tok)) continue;
        if (!isAdminMessage && stageIdNum != null) {
          let notifStages = [];
          const userDoc = await db.collection('users').doc(uid).get();
          if (userDoc.exists && Array.isArray(userDoc.data().notifStages)) {
            notifStages = userDoc.data().notifStages;
          }
          if (notifStages.length > 0) {
            const stagesNum = notifStages.map(s => Number(s));
            if (!stagesNum.includes(stageIdNum)) continue;
          }
        }
        seenTokens.add(tok);
        recipients.push({ token: tok, uid });
      }
    } else {
      const t = await db.collection('fcmTokens').doc(to).get();
      if (t.exists && t.data().token) recipients.push({ token: t.data().token, uid: to });
    }

    if (recipients.length === 0) return;

    let title = 'تطبيق إتقان';
    let body = 'إشعار جديد';
    const stageNum = d.stageId != null ? d.stageId : '';
    const stageName = (d.stageName || '').trim();
    const lessonNum = d.lessonNum != null ? d.lessonNum : '';
    const lessonTitle = (d.lessonTitle || '').trim();
    const verseNum = d.verseNum != null ? d.verseNum : '';
    const parts = [];
    if (stageNum) parts.push('مرحلة ' + stageNum + (stageName ? ' ' + stageName : ''));
    if (lessonNum) parts.push(lessonTitle ? 'درس ' + lessonNum + ': ' + lessonTitle : 'درس ' + lessonNum);
    if (verseNum) parts.push('مقطع ' + verseNum);
    const detailSuffix = parts.length ? ' — ' + parts.join(' • ') : '';
    if (d.type === 'reply') body = 'رد جديد من المعلم ' + (d.senderName || '') + detailSuffix;
    if (d.type === 'new_recording') body = 'تسجيل جديد من الطالب ' + (d.senderName || '') + detailSuffix;
    if (d.type === 'admin_message') body = 'رسالة من المسؤول';
    if (d.type === 'lesson_uploaded' && d.body) body = d.body;

    const baseData = {
      postId: String(d.postId || ''),
      fileId: String(d.fileId || ''),
      type: String(d.type || ''),
      notifId: String(notifId || ''),
      stageId: String(d.stageId != null ? d.stageId : ''),
      openLesson: d.type === 'lesson_uploaded' ? '1' : ''
    };
    if (d.type === 'reply' && d.replyTimestamp != null) {
      baseData.replyTimestamp = String(d.replyTimestamp);
    }

    /* Gleiches logisches Ereignis = gleicher tag → System ersetzt doppelte Banner; notifId nur bei Bedarf unterscheidbar */
    const tag = d.type === 'reply' && d.postId != null && d.replyTimestamp != null
      ? `it9an-reply-${d.postId}-${String(d.replyTimestamp)}`
      : `it9an-${d.type}-${d.postId || ''}-${notifId}`;
    const iconUrl = `${HOSTING_BASE}/icon-192.png`;
    const messages = [];
    for (const r of recipients) {
      const badgeCount = await getNotifCountForUser(db, to, r.uid);
      messages.push({
        token: r.token,
        data: {
          title,
          body,
          ...baseData,
          badge: String(badgeCount),
          tag
        },
        webpush: {
          headers: { Urgency: 'high' },
          data: {
            title,
            body,
            ...baseData,
            badge: String(badgeCount),
            tag
          },
          fcmOptions: {
            link: `${HOSTING_BASE}/`
          }
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            defaultVibrateTimings: true,
            icon: iconUrl
          },
          data: { title, body, ...baseData, badge: String(badgeCount) }
        },
        apns: {
          payload: {
            aps: { sound: 'default', contentAvailable: true, badge: badgeCount },
            title,
            body
          }
        }
      });
    }

    const res = await admin.messaging().sendEach(messages);
    if (res.failureCount > 0) {
      const deadUids = new Set();
      res.responses.forEach((resp, i) => {
        if (!resp.success) {
          const err = resp.error;
          const code = err && err.code ? String(err.code) : '';
          if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
            deadUids.add(recipients[i].uid);
          }
          console.warn('Push failed for', recipients[i].uid, err);
        }
      });
      for (const deadUid of deadUids) {
        try {
          await db.collection('fcmTokens').doc(deadUid).delete();
        } catch (e) { /* ignore */ }
      }
    }

    /* Erst nach FCM: verhindert „als gesendet markiert“, obwohl alle Tokens fehlgeschlagen sind */
    if (res.successCount > 0) {
      try {
        await sentRef.create({
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          successCount: res.successCount
        });
      } catch (e) {
        if (e.code !== 6 && !(e.message && e.message.includes('already exists'))) throw e;
      }
    } else {
      console.warn('sendPushOnNotif: keine erfolgreichen FCM-Zustellungen für', notifId);
    }
  });

/** Alle 24h: fehlende Benachrichtigungen für alle Nutzer wiederherstellen (Lehrer: new_recording, Schüler: reply) */
exports.restoreStudentRecordingNotificationsScheduled = functions
  .region('europe-west3')
  .pubsub.schedule('0 6 * * *')
  .timeZone('Europe/Berlin')
  .onRun(async (context) => {
    const db = admin.firestore();
    let created = 0;
    let updated = 0;
    try {
      const postsSnap = await db.collection('posts').get();
      for (const doc of postsSnap.docs) {
        const d = doc.data();
        const stageId = d.stageId != null ? d.stageId : 4;
        const fileId = String(d.fileId || '1');
        const manifest = await fetchManifestForStage(stageId);
        const lv = getLessonVerseFromManifest(manifest, fileId);

        /* 1) Lehrer: new_recording für Schüleraufnahmen ohne Bewertung/Antwort */
        if (d.uid !== 'admin_super' && d.role !== 'teacher') {
          const hasTeacherReply = d.replies && d.replies.some(r => r.role === 'teacher');
          const hasTeacherRating = d.teacherRating && (d.teacherRating.verdict === 'accepted' || d.teacherRating.verdict === 'needs_improvement');
          if (!hasTeacherReply || !hasTeacherRating) {
            const nq = db.collection('notifications').where('to', '==', 'teachers').where('postId', '==', doc.id).where('type', '==', 'new_recording');
            const nsnap = await nq.get();
            if (nsnap.empty) {
              await db.collection('notifications').add({
                to: 'teachers',
                senderName: stripYearFromName(d.name || 'طالب'),
                type: 'new_recording',
                fileId,
                postId: doc.id,
                stageId,
                stageName: manifest.name || '',
                lessonNum: lv.lesson,
                lessonTitle: lv.lessonTitle || '',
                verseNum: lv.verse,
                clearedBy: [],
                timestamp: admin.firestore.FieldValue.serverTimestamp()
              });
              created++;
            } else {
              for (const nd of nsnap.docs) {
                await db.collection('notifications').doc(nd.id).update({ clearedBy: [] });
                updated++;
              }
            }
          }
        }

        /* 2) Schüler: reply-Benachrichtigungen für jede Lehrer-Antwort
         *    Kein == auf replyTimestamp in Firestore: Typ-/Rundungs-Unterschiede würden zweite Docs erzeugen → doppelte Push. */
        const teacherReplies = (d.replies || []).filter(r => r.role === 'teacher');
        const postOwnerUid = d.uid;
        if (postOwnerUid && postOwnerUid !== 'admin_super' && teacherReplies.length > 0) {
          for (const r of teacherReplies) {
            const replyTs = Number(r.timestamp || 0);
            const nq = db.collection('notifications')
              .where('to', '==', postOwnerUid)
              .where('postId', '==', doc.id)
              .where('type', '==', 'reply');
            const nsnap = await nq.get();
            const matches = nsnap.docs.filter((nd) => Number((nd.data().replyTimestamp != null ? nd.data().replyTimestamp : 0)) === replyTs);
            if (matches.length === 0) {
              await db.collection('notifications').add({
                to: postOwnerUid,
                senderName: stripYearFromName(r.name || 'المعلم'),
                type: 'reply',
                listenedByStudent: false,
                fileId,
                postId: doc.id,
                replyTimestamp: replyTs,
                stageId,
                stageName: manifest.name || '',
                lessonNum: lv.lesson,
                lessonTitle: lv.lessonTitle || '',
                verseNum: lv.verse,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
              });
              created++;
            } else {
              if (matches.length > 1) {
                for (let i = 1; i < matches.length; i++) {
                  try {
                    await db.collection('notifications').doc(matches[i].id).delete();
                  } catch (e) { /* ignore */ }
                }
              }
              const nd = matches[0];
              const data = nd.data();
              if (!data.listenedByStudent && data.clearedBy && data.clearedBy.length > 0) {
                await db.collection('notifications').doc(nd.id).update({ clearedBy: [] });
                updated++;
              }
            }
          }
        }
      }
      console.log('restoreStudentRecordingNotificationsScheduled: created=' + created + ', updated=' + updated);
    } catch (e) {
      console.error('restoreStudentRecordingNotificationsScheduled error:', e);
      throw e;
    }
    return null;
  });

/** Tägliche Quran-Reminder für Schüler: 6–9h und 18–21h. Uhrzeit variiert von Tag zu Tag.
 *  Klick öffnet direkt das Stufenmenu (openStages=1). */
const QURAN_REMINDER_BODY = 'لا تنسَ اليوم أن تتعلم شيئاً من القرآن عبر التطبيق';
/* Morgens 6–9h: 6:30, 7:30, 8:30 | Abends 18–21h: 18:30, 19:30, 20:30 */
const QURAN_REMINDER_SLOTS = [
  { cron: '30 6 * * *', morning: true, idx: 0 },
  { cron: '30 7 * * *', morning: true, idx: 1 },
  { cron: '30 8 * * *', morning: true, idx: 2 },
  { cron: '30 18 * * *', morning: false, idx: 0 },
  { cron: '30 19 * * *', morning: false, idx: 1 },
  { cron: '30 20 * * *', morning: false, idx: 2 }
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h);
}

function getChosenSlotForToday(morning) {
  const now = new Date();
  const dayKey = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const h = hashString(dayKey);
  return morning ? (h % 3) : ((h + 17) % 3);
}

async function getStudentFcmTokens(db) {
  const tokens = [];
  const seenTok = new Set();
  const teacherSnap = await db.collection('fcmTokens').where('role', '==', 'teacher').get();
  const teacherUids = new Set(teacherSnap.docs.map(d => (d.data().uid || d.id)));
  const allTokensSnap = await db.collection('fcmTokens').get();
  for (const doc of allTokensSnap.docs) {
    const d = doc.data();
    const uid = d.uid || doc.id;
    if (teacherUids.has(uid) || uid === 'admin_super' || uid === 'guest') continue;
    const tok = d.token;
    if (tok && !seenTok.has(tok)) {
      seenTok.add(tok);
      tokens.push(tok);
    }
  }
  return tokens;
}

QURAN_REMINDER_SLOTS.forEach((slot, idx) => {
  const fnName = 'sendQuranReminderScheduled' + (idx + 1);
  exports[fnName] = functions
    .region('europe-west3')
    .pubsub.schedule(slot.cron)
    .timeZone('Europe/Berlin')
    .onRun(async () => {
      const chosen = getChosenSlotForToday(slot.morning);
      if (chosen !== slot.idx) return null;
      const db = admin.firestore();
      const tokens = await getStudentFcmTokens(db);
      if (tokens.length === 0) return null;
      const title = 'تطبيق إتقان';
      const tag = `it9an-quran-reminder-${Date.now()}`;
      const data = {
        title,
        body: QURAN_REMINDER_BODY,
        openStages: '1',
        tag
      };
      const messages = tokens.map((token) => ({
        token,
        data: { ...data },
        webpush: {
          headers: { Urgency: 'high' },
          notification: {
            title: data.title,
            body: data.body,
            icon: '/icon-192.png',
            tag: data.tag,
            vibrate: [200, 100, 200, 100, 200]
          },
          data: { ...data }
        },
        android: {
          priority: 'high',
          data: { ...data }
        },
        apns: {
          payload: {
            aps: { sound: 'default', contentAvailable: true },
            title,
            body: QURAN_REMINDER_BODY
          }
        }
      }));
      try {
        const res = await admin.messaging().sendEach(messages);
        if (res.failureCount > 0) {
          res.responses.forEach((r, i) => {
            if (!r.success) console.warn('Quran reminder push failed:', r.error);
          });
        }
        console.log('sendQuranReminderScheduled: sent to', tokens.length, 'students');
      } catch (e) {
        console.error('sendQuranReminderScheduled error:', e);
      }
      return null;
    });
});

/**
 * Storage: uploads/*.webm|ogg → AAC (.m4a), Firestore-URLs auf neue Datei umbiegen.
 * Original-WebM bleibt vorerst (vermeidet Race mit getDownloadURL); optional später aufräumen.
 * Deploy: npm install in functions muss das Linux-FFmpeg-Binary enthalten (CI: ubuntu, lokal: npm i --force).
 */
exports.transcodeUploadAudio = onObjectFinalized(
  {
    region: 'europe-west3',
    memory: '2GiB',
    timeoutSeconds: 300,
    bucket: 'it9an-neu.firebasestorage.app',
  },
  async (event) => {
    const filePath = event.data.name;
    if (!filePath || !filePath.startsWith('uploads/')) return;
    const lower = filePath.toLowerCase();
    if (!lower.endsWith('.webm') && !lower.endsWith('.ogg')) return;

    const bucketName = event.data.bucket;
    const bucket = admin.storage().bucket(bucketName);
    const tmpIn = path.join(os.tmpdir(), `in-${randomUUID()}${path.extname(filePath)}`);
    const tmpOut = path.join(os.tmpdir(), `out-${randomUUID()}.m4a`);
    const destPath = filePath.replace(/\.(webm|ogg)$/i, '.m4a');
    const pathNeedle = encodeURIComponent(filePath);

    try {
      await bucket.file(filePath).download({ destination: tmpIn });
      await runFfmpegArgs([
        '-y',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-i', tmpIn,
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '1',
        '-af', 'aresample=async=1',
        '-movflags', '+faststart',
        tmpOut,
      ]);

      const outBuf = await fs.readFile(tmpOut);
      const token = randomUUID();
      await bucket.file(destPath).save(outBuf, {
        metadata: {
          contentType: 'audio/mp4',
          cacheControl: 'public, max-age=31536000',
          metadata: { firebaseStorageDownloadTokens: token },
        },
        resumable: false,
      });

      const encDest = encodeURIComponent(destPath);
      const newUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encDest}?alt=media&token=${token}`;
      const db = admin.firestore();

      let patched = 0;
      for (let attempt = 0; attempt < 45; attempt++) {
        const n = await replaceAudioUrlInPostsOnce(db, pathNeedle, newUrl);
        if (n > 0) {
          patched = n;
          break;
        }
        await sleep(2000);
      }
      if (patched === 0) {
        console.warn('transcodeUploadAudio: keine Firestore-Treffer für', filePath, '(Client schreibt evtl. spät; m4a liegt unter', destPath, ')');
      } else {
        console.log('transcodeUploadAudio:', filePath, '→', destPath, 'Posts aktualisiert:', patched);
      }
    } catch (e) {
      console.error('transcodeUploadAudio Fehler', filePath, e);
    } finally {
      await fs.unlink(tmpIn).catch(() => {});
      await fs.unlink(tmpOut).catch(() => {});
    }
  }
);
