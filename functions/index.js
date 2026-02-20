const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendPushOnNotif = functions.firestore
  .document('notifications/{id}')
  .onCreate(async (snap, ctx) => {
    const d = snap.data();
    const to = d.to;
    const tokens = [];

    if (to === 'teachers') {
      const q = admin.firestore().collection('fcmTokens').where('role', '==', 'teacher');
      const snapTeachers = await q.get();
      snapTeachers.forEach((t) => {
        const tok = t.data().token;
        if (tok) tokens.push(tok);
      });
    } else {
      const t = await admin.firestore().collection('fcmTokens').doc(to).get();
      if (t.exists && t.data().token) tokens.push(t.data().token);
    }

    if (tokens.length === 0) return;

    let title = 'تطبيق إتقان';
    let body = 'إشعار جديد';
    if (d.type === 'reply') body = 'رد جديد من ' + (d.senderName || '');
    if (d.type === 'new_recording') body = 'تسجيل جديد من ' + (d.senderName || '');
    if (d.type === 'admin_message') body = 'رسالة من المسؤول';

    const payload = {
      tokens,
      notification: { title, body },
      webpush: {
        notification: {
          vibrate: [200, 100, 200, 100, 200],
          requireInteraction: false,
          icon: '/icon-192.png'
        }
      },
      android: {
        priority: 'high',
        notification: { sound: 'default', defaultVibrateTimings: true }
      },
      apns: {
        payload: { aps: { sound: 'default', contentAvailable: true } }
      },
      data: {
        postId: String(d.postId || ''),
        fileId: String(d.fileId || ''),
        type: String(d.type || '')
      }
    };

    await admin.messaging().sendEachForMulticast(payload);
  });
