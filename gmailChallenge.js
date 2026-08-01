const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

// Instagram tomonidan Gmail'ga yuborilgan tasdiqlash kodini avtomatik topadi.
// Gmail'da IMAP yoqilgan va "App Password" (oddiy parol emas!) berilgan bo'lishi shart:
// https://myaccount.google.com/apppasswords
async function fetchInstagramCodeFromGmail(gmailAddress, appPassword, opts = {}) {
  const timeoutMs      = opts.timeoutMs || 90000;
  const pollIntervalMs = opts.pollIntervalMs || 5000;

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: gmailAddress, pass: appPassword },
    logger: false
  });

  await client.connect();
  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Avval Instagram xavfsizlik manzilidan kelgan xatlarni qidiramiz
        let uids = await client.search({ from: 'security@mail.instagram.com' }, { uid: true });

        // Topilmasa, mavzusida "confirm"/"security code" bor xatlarni qidiramiz
        if (!uids || !uids.length) {
          uids = await client.search({ subject: 'Instagram' }, { uid: true });
        }

        if (uids && uids.length) {
          // Eng oxirgi (yangi) xatdan boshlab tekshiramiz
          for (const uid of uids.slice(-5).reverse()) {
            const message = await client.download(uid, undefined, { uid: true });
            const parsed = await simpleParser(message.content);
            const text = (parsed.text || '') + ' ' + (parsed.html || '');
            const match = text.match(/\b(\d{6})\b/);
            if (match) return match[1];
          }
        }
      } finally {
        lock.release();
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    throw new Error('Gmail ichidan Instagram tasdiqlash kodi topilmadi (vaqt tugadi)');
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = { fetchInstagramCodeFromGmail };
