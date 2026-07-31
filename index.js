require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const axios = require('axios');
const sharp = require('sharp');

const { loginInstagram, postPhoto, postVideo, queueSize } = require('./instagram');
const User = require('./userModel');
const Post = require('./postModel');
const Setting = require('./settingModel');
const { getUnsubscribedChannels, subscriptionKeyboard } = require('./subscription');
const { adminKeyboard, handleAdmin, handleAdminCallback } = require('./adminPanel');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Har qanday holatda ham intervalni bundan pastga tushirib bo'lmaydi (soat)
const HARD_MIN_INTERVAL_HOURS = 3;
const INTERVAL_OPTIONS = [3, 6, 12, 24];

// Admin uchun alohida, ancha qisqa interval (daqiqa)
const ADMIN_INTERVAL_MINUTES = 5;

// ─── HELPERS ────────────────────────────────────────────────────────────────

function isAdmin(userId) {
  return String(userId) === String(process.env.ADMIN_ID);
}

function userKeyboard() {
  return Markup.keyboard([
    ['📸 Rasm yuborish', '🎬 Video yuborish'],
    ['⏱ Interval sozlash', '📊 Statistikam'],
    ['☎️ Admin bilan bogʻlanish', '📖 Qanday foydalanish']
  ]).resize();
}

async function ensureUser(from) {
  const defaultInterval = await Setting.get('min_interval_hours', HARD_MIN_INTERVAL_HOURS);
  return User.findOneAndUpdate(
    { telegramId: from.id },
    {
      $setOnInsert: {
        telegramId:    from.id,
        username:      from.username || '',
        firstName:     from.first_name || '',
        isBlocked:     false,
        intervalHours: Math.max(defaultInterval, HARD_MIN_INTERVAL_HOURS),
        lastPostAt:    null,
        totalPosts:    0
      }
    },
    { upsert: true, new: true }
  );
}

// Foydalanuvchi hozir post qila oladimi, tekshiradi
function canPostNow(user) {
  if (!user.lastPostAt) return { allowed: true };
  const intervalMs = user.intervalHours * 3600000;
  const elapsed = Date.now() - new Date(user.lastPostAt).getTime();
  if (elapsed >= intervalMs) return { allowed: true };
  return { allowed: false, remainingMs: intervalMs - elapsed };
}

function formatRemaining(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} soat ${m} daqiqa`;
  if (h > 0) return `${h} soat`;
  return `${m} daqiqa`;
}

// Admin hozir post qila oladimi, tekshiradi (5 daqiqalik alohida interval)
async function canAdminPostNow() {
  const lastPostAt = await Setting.get('admin_last_post_at', null);
  if (!lastPostAt) return { allowed: true };
  const intervalMs = ADMIN_INTERVAL_MINUTES * 60000;
  const elapsed = Date.now() - new Date(lastPostAt).getTime();
  if (elapsed >= intervalMs) return { allowed: true };
  return { allowed: false, remainingMs: intervalMs - elapsed };
}

async function sendIntervalWaitMessage(ctx, remainingMs) {
  return ctx.reply(
    `⏳ *Hali vaqt boʻlmadi!*\n\n` +
    `🕒 Keyingi post uchun: *${formatRemaining(remainingMs)}* qoldi\n\n` +
    `_Intervalni oʻzgartirish uchun "⏱ Interval sozlash" tugmasidan foydalaning._`,
    { parse_mode: 'Markdown' }
  );
}

// Majburiy obuna tekshiruvi. true = davom etsa boʻladi, false = obuna soʻraldi
async function requireSubscription(ctx) {
  const unsub = await getUnsubscribedChannels(ctx.telegram, ctx.from.id);
  if (!unsub.length) return true;

  await ctx.reply(
    `🔒 *Botdan foydalanish uchun quyidagi kanal(lar)ga obuna boʻling:*`,
    { parse_mode: 'Markdown', ...subscriptionKeyboard(unsub) }
  );
  return false;
}

// Faylni buffer sifatida yuklab olish
async function downloadFile(fileId) {
  const link = await bot.telegram.getFileLink(fileId);
  const res = await axios.get(link.href, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// Rasmni Instagram uchun tayyorlash
async function prepareImage(buf) {
  return sharp(buf)
    .resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ─── MONGODB ─────────────────────────────────────────────────────────────────

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB ulandi');
    const exists = await Setting.findOne({ key: 'min_interval_hours' });
    if (!exists) await Setting.set('min_interval_hours', HARD_MIN_INTERVAL_HOURS);
  })
  .catch(err => {
    console.error('❌ MongoDB xatosi:', err.message);
    process.exit(1);
  });

// Instagram login xatosi alohida ushlanadi — muvaffaqiyatsiz bo'lsa ham
// bot Telegram orqali ishlayveradi (admin "🔄 IG Session" orqali qayta urinishi mumkin)
loginInstagram()
  .then(() => console.log('✅ Instagram ga ulandi'))
  .catch(err => {
    console.error('⚠️ Instagram ga ulanishda xatolik:', err.message);
  });

// ─── /START ──────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  const user = await ensureUser(ctx.from);

  if (isAdmin(ctx.from.id)) {
    return ctx.reply(
      `👑 *Admin paneliga xush kelibsiz!*\n\n` +
      `📱 Instagram: @${process.env.IG_USERNAME}`,
      { parse_mode: 'Markdown', ...adminKeyboard() }
    );
  }

  if (user.isBlocked) {
    return ctx.reply('🚫 Siz bloklandingiz. Admin bilan bog\'laning.');
  }

  if (!(await requireSubscription(ctx))) return;

  const check = canPostNow(user);

  return ctx.reply(
    `👋 Salom, *${ctx.from.first_name}*!\n\n` +
    `📸 Rasm yoki video yuboring — men Instagram'ga post qilaman!\n\n` +
    `⏱ Sizning intervalingiz: *${user.intervalHours} soat*\n` +
    (check.allowed
      ? `✅ Hozir post qilishingiz mumkin`
      : `⏳ Keyingi post: *${formatRemaining(check.remainingMs)}* dan so'ng`),
    { parse_mode: 'Markdown', ...userKeyboard() }
  );
});

// ─── MATN XABARLARI ──────────────────────────────────────────────────────────

bot.on('text', async (ctx) => {
  // Admin
  if (isAdmin(ctx.from.id)) return handleAdmin(ctx, bot);

  const user = await ensureUser(ctx.from);
  if (user.isBlocked) return ctx.reply('🚫 Siz bloklandingiz.');

  const text = ctx.message.text;

  // 📸 Rasm yuborish
  if (text === '📸 Rasm yuborish') {
    if (!(await requireSubscription(ctx))) return;
    const check = canPostNow(user);
    if (!check.allowed) return sendIntervalWaitMessage(ctx, check.remainingMs);
    return ctx.reply(
      `📸 *Rasmni yuboring*\n\n` +
      `Caption (izoh) qo'shmoqchi bo'lsangiz, rasm bilan birga yozing.`,
      { parse_mode: 'Markdown' }
    );
  }

  // 🎬 Video yuborish
  if (text === '🎬 Video yuborish') {
    if (!(await requireSubscription(ctx))) return;
    const check = canPostNow(user);
    if (!check.allowed) return sendIntervalWaitMessage(ctx, check.remainingMs);
    return ctx.reply(
      `🎬 *Videoni yuboring*\n\n` +
      `Max hajm: *100 MB*\n` +
      `Caption qo'shmoqchi bo'lsangiz, video bilan birga yozing.`,
      { parse_mode: 'Markdown' }
    );
  }

  // ⏱ Interval sozlash
  if (text === '⏱ Interval sozlash') {
    const minAllowed = Math.max(
      await Setting.get('min_interval_hours', HARD_MIN_INTERVAL_HOURS),
      HARD_MIN_INTERVAL_HOURS
    );
    const options = INTERVAL_OPTIONS.filter(h => h >= minAllowed);
    const buttons = options.map(h => [
      Markup.button.callback(
        `${h} soat${h === user.intervalHours ? ' ✅' : ''}`,
        `setinterval_${h}`
      )
    ]);
    return ctx.reply(
      `⏱ *Post intervalini tanlang*\n\n` +
      `Hozirgi interval: *${user.intervalHours} soat*\n` +
      `Minimal interval: *${minAllowed} soat*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
  }

  // 📊 Statistikam
  if (text === '📊 Statistikam') {
    const joinDate = new Date(user.createdAt).toLocaleDateString('uz-UZ');
    const check = canPostNow(user);

    return ctx.reply(
      `📊 *Sizning statistikangiz:*\n\n` +
      `⏱ Interval: *${user.intervalHours} soat*\n` +
      (check.allowed
        ? `✅ Holat: *Post qilishingiz mumkin*\n`
        : `⏳ Keyingi post: *${formatRemaining(check.remainingMs)}* dan so'ng\n`) +
      `📦 Jami postlar: *${user.totalPosts} ta*\n` +
      `📅 Bot'ga qo'shilgan: *${joinDate}*`,
      { parse_mode: 'Markdown' }
    );
  }

  // ☎️ Admin bilan bogʻlanish
  if (text === '☎️ Admin bilan bogʻlanish') {
    return ctx.reply(
      `☎️ *Admin bilan bogʻlanish*\n\n` +
      `Savol yoki muammo yuzasidan quyidagi admin bilan bogʻlaning:\n` +
      `👤 @${process.env.ADMIN_USERNAME || 'admin'}`,
      { parse_mode: 'Markdown' }
    );
  }

  // 📖 Qanday foydalanish
  if (text === '📖 Qanday foydalanish') {
    const minAllowed = Math.max(
      await Setting.get('min_interval_hours', HARD_MIN_INTERVAL_HOURS),
      HARD_MIN_INTERVAL_HOURS
    );
    return ctx.reply(
      `📖 *Bot qanday ishlaydi?*\n\n` +
      `1️⃣ "📸 Rasm yuborish" yoki "🎬 Video yuborish" tugmasini bosing\n` +
      `2️⃣ Rasm yoki videoni (xohlasangiz caption bilan) yuboring\n` +
      `3️⃣ Bot avtomatik ravishda Instagram'ga post qiladi\n` +
      `4️⃣ Keyingi postgacha kamida *${minAllowed} soat* kutish kerak\n` +
      `5️⃣ Intervalni "⏱ Interval sozlash" orqali oʻzgartirishingiz mumkin\n\n` +
      `📱 Instagram: *@${process.env.IG_USERNAME}*\n` +
      `❓ Muammo bo'lsa: @${process.env.ADMIN_USERNAME || 'admin'}`,
      { parse_mode: 'Markdown' }
    );
  }

  // Boshqa matn
  ctx.reply('📸 Iltimos, rasm yoki video yuboring.', userKeyboard());
});

// ─── RASM HANDLER ────────────────────────────────────────────────────────────

bot.on('photo', async (ctx) => {
  // ─── ADMIN: majburiy obuna va oddiy interval'ga qaramay, faqat 5 daqiqalik interval bilan post qiladi
  if (isAdmin(ctx.from.id)) {
    const check = await canAdminPostNow();
    if (!check.allowed) {
      return ctx.reply(
        `⏳ *Admin interval hali tugamadi!*\n\n` +
        `🕒 Keyingi post uchun: *${formatRemaining(check.remainingMs)}* qoldi`,
        { parse_mode: 'Markdown' }
      );
    }

    const waitingInQueue = queueSize();
    const msg = await ctx.reply(
      waitingInQueue > 0
        ? `⏳ Navbatda kutilmoqda... (${waitingInQueue}-oʻrin)`
        : '⏳ Rasm yuklanmoqda...'
    );

    try {
      const photo   = ctx.message.photo.at(-1);
      const caption = ctx.message.caption || '';

      const rawBuf = await downloadFile(photo.file_id);
      const imgBuf = await prepareImage(rawBuf);

      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        '📤 Instagram ga yuklanmoqda...'
      );

      const result = await postPhoto(imgBuf, caption);

      await Post.create({
        telegramUserId:   ctx.from.id,
        telegramUsername: ctx.from.username || '',
        caption,
        type:             'photo',
        instagramMediaId: result.media?.id || '',
        status:           'success'
      });
      await Setting.set('admin_last_post_at', new Date());

      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        `✅ *Post muvaffaqiyatli yuklandi!*\n\n` +
        `⏱ Keyingi post: *${ADMIN_INTERVAL_MINUTES} daqiqa* dan so'ng\n` +
        `📱 @${process.env.IG_USERNAME}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('❌ Admin rasm xatosi:', err.message);
      await Post.create({
        telegramUserId:   ctx.from.id,
        telegramUsername: ctx.from.username || '',
        type:             'photo',
        status:           'failed',
        error:            err.message
      });
      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        `❌ *Xatolik yuz berdi!*\n\n\`${err.message}\`\n\nQayta urinib ko'ring.`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  const user = await ensureUser(ctx.from);
  if (user.isBlocked) return ctx.reply('🚫 Siz bloklandingiz.');
  if (!(await requireSubscription(ctx))) return;

  const check = canPostNow(user);
  if (!check.allowed) return sendIntervalWaitMessage(ctx, check.remainingMs);

  const waitingInQueue = queueSize();
  const msg = await ctx.reply(
    waitingInQueue > 0
      ? `⏳ Navbatda kutilmoqda... (${waitingInQueue}-oʻrin)`
      : '⏳ Rasm yuklanmoqda...'
  );

  try {
    const photo   = ctx.message.photo.at(-1);
    const caption = ctx.message.caption || '';

    const rawBuf = await downloadFile(photo.file_id);
    const imgBuf = await prepareImage(rawBuf);

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      '📤 Instagram ga yuklanmoqda...'
    );

    const result = await postPhoto(imgBuf, caption);

    // DB ga saqlash
    await Post.create({
      telegramUserId:   user.telegramId,
      telegramUsername: user.username,
      caption,
      type:             'photo',
      instagramMediaId: result.media?.id || '',
      status:           'success'
    });
    await User.findOneAndUpdate(
      { telegramId: user.telegramId },
      { $inc: { totalPosts: 1 }, lastPostAt: new Date() }
    );

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `✅ *Post muvaffaqiyatli yuklandi!*\n\n` +
      `⏱ Keyingi post: *${user.intervalHours} soat* dan so'ng\n` +
      `📱 @${process.env.IG_USERNAME}`,
      { parse_mode: 'Markdown' }
    );

  } catch (err) {
    console.error('❌ Rasm xatosi:', err.message);
    await Post.create({
      telegramUserId:   user.telegramId,
      telegramUsername: user.username,
      type:             'photo',
      status:           'failed',
      error:            err.message
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Xatolik yuz berdi!*\n\n\`${err.message}\`\n\nQayta urinib ko'ring.`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ─── VIDEO HANDLER ───────────────────────────────────────────────────────────

bot.on('video', async (ctx) => {
  // ─── ADMIN: majburiy obuna va oddiy interval'ga qaramay, faqat 5 daqiqalik interval bilan post qiladi
  if (isAdmin(ctx.from.id)) {
    const check = await canAdminPostNow();
    if (!check.allowed) {
      return ctx.reply(
        `⏳ *Admin interval hali tugamadi!*\n\n` +
        `🕒 Keyingi post uchun: *${formatRemaining(check.remainingMs)}* qoldi`,
        { parse_mode: 'Markdown' }
      );
    }

    const video = ctx.message.video;
    if (video.file_size > 100 * 1024 * 1024) {
      return ctx.reply('❌ Video hajmi 100 MB dan oshmasligi kerak!');
    }

    const waitingInQueue = queueSize();
    const msg = await ctx.reply(
      waitingInQueue > 0
        ? `⏳ Navbatda kutilmoqda... (${waitingInQueue}-oʻrin)`
        : '⏳ Video yuklanmoqda... (biroz vaqt olishi mumkin)'
    );

    try {
      const caption   = ctx.message.caption || '';
      const videoBuf  = await downloadFile(video.file_id);

      let coverBuf;
      if (video.thumb) {
        const raw = await downloadFile(video.thumb.file_id);
        coverBuf  = await prepareImage(raw);
      } else {
        coverBuf = await sharp({
          create: { width: 640, height: 640, channels: 3, background: { r: 0, g: 0, b: 0 } }
        }).jpeg().toBuffer();
      }

      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        '📤 Instagram ga yuklanmoqda...'
      );

      const result = await postVideo(videoBuf, coverBuf, caption);

      await Post.create({
        telegramUserId:   ctx.from.id,
        telegramUsername: ctx.from.username || '',
        caption,
        type:             'video',
        instagramMediaId: result.media?.id || '',
        status:           'success'
      });
      await Setting.set('admin_last_post_at', new Date());

      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        `✅ *Video muvaffaqiyatli yuklandi!*\n\n` +
        `⏱ Keyingi post: *${ADMIN_INTERVAL_MINUTES} daqiqa* dan so'ng\n` +
        `📱 @${process.env.IG_USERNAME}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('❌ Admin video xatosi:', err.message);
      await Post.create({
        telegramUserId:   ctx.from.id,
        telegramUsername: ctx.from.username || '',
        type:             'video',
        status:           'failed',
        error:            err.message
      });
      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        `❌ *Xatolik:* \`${err.message}\``,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  const user = await ensureUser(ctx.from);
  if (user.isBlocked) return ctx.reply('🚫 Siz bloklandingiz.');
  if (!(await requireSubscription(ctx))) return;

  const check = canPostNow(user);
  if (!check.allowed) return sendIntervalWaitMessage(ctx, check.remainingMs);

  const video = ctx.message.video;
  if (video.file_size > 100 * 1024 * 1024) {
    return ctx.reply('❌ Video hajmi 100 MB dan oshmasligi kerak!');
  }

  const waitingInQueue = queueSize();
  const msg = await ctx.reply(
    waitingInQueue > 0
      ? `⏳ Navbatda kutilmoqda... (${waitingInQueue}-oʻrin)`
      : '⏳ Video yuklanmoqda... (biroz vaqt olishi mumkin)'
  );

  try {
    const caption   = ctx.message.caption || '';
    const videoBuf  = await downloadFile(video.file_id);

    // Cover rasm
    let coverBuf;
    if (video.thumb) {
      const raw = await downloadFile(video.thumb.file_id);
      coverBuf  = await prepareImage(raw);
    } else {
      coverBuf = await sharp({
        create: { width: 640, height: 640, channels: 3, background: { r: 0, g: 0, b: 0 } }
      }).jpeg().toBuffer();
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      '📤 Instagram ga yuklanmoqda...'
    );

    const result = await postVideo(videoBuf, coverBuf, caption);

    await Post.create({
      telegramUserId:   user.telegramId,
      telegramUsername: user.username,
      caption,
      type:             'video',
      instagramMediaId: result.media?.id || '',
      status:           'success'
    });
    await User.findOneAndUpdate(
      { telegramId: user.telegramId },
      { $inc: { totalPosts: 1 }, lastPostAt: new Date() }
    );

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `✅ *Video muvaffaqiyatli yuklandi!*\n\n` +
      `⏱ Keyingi post: *${user.intervalHours} soat* dan so'ng\n` +
      `📱 @${process.env.IG_USERNAME}`,
      { parse_mode: 'Markdown' }
    );

  } catch (err) {
    console.error('❌ Video xatosi:', err.message);
    await Post.create({
      telegramUserId:   user.telegramId,
      telegramUsername: user.username,
      type:             'video',
      status:           'failed',
      error:            err.message
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Xatolik:* \`${err.message}\``,
      { parse_mode: 'Markdown' }
    );
  }
});

// ─── CALLBACK QUERIES ────────────────────────────────────────────────────────

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (isAdmin(ctx.from.id)) return handleAdminCallback(ctx);

  // ✅ Obunani tekshirish
  if (data === 'check_subscription') {
    const unsub = await getUnsubscribedChannels(ctx.telegram, ctx.from.id);
    if (unsub.length) {
      return ctx.answerCbQuery('❌ Hali barcha kanallarga obuna bo\'lmagansiz!', { show_alert: true });
    }
    await ctx.answerCbQuery('✅ Obuna tasdiqlandi!');
    await ctx.deleteMessage().catch(() => {});
    const user = await ensureUser(ctx.from);
    const check = canPostNow(user);
    return ctx.reply(
      `✅ *Obuna tasdiqlandi!*\n\n` +
      (check.allowed
        ? `Endi post yuborishingiz mumkin.`
        : `⏳ Keyingi post: *${formatRemaining(check.remainingMs)}* dan so'ng`),
      { parse_mode: 'Markdown', ...userKeyboard() }
    );
  }

  // ⏱ Intervalni o'rnatish
  if (data.startsWith('setinterval_')) {
    const hours = parseInt(data.split('_')[1]);
    const minAllowed = Math.max(
      await Setting.get('min_interval_hours', HARD_MIN_INTERVAL_HOURS),
      HARD_MIN_INTERVAL_HOURS
    );
    if (isNaN(hours) || hours < minAllowed) {
      return ctx.answerCbQuery('❌ Ruxsat etilmagan interval', { show_alert: true });
    }
    await User.findOneAndUpdate({ telegramId: ctx.from.id }, { intervalHours: hours });
    await ctx.answerCbQuery(`✅ Interval ${hours} soatga o'zgartirildi`);
    return ctx.editMessageText(
      `⏱ *Interval yangilandi:* ${hours} soat`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  if (data === 'noop') return ctx.answerCbQuery();

  ctx.answerCbQuery('❌ Ruxsat yo\'q');
});

// ─── BOSHQA MEDIA ────────────────────────────────────────────────────────────

bot.on('document', (ctx) => ctx.reply('❌ Fayl qabul qilinmaydi. Rasm yoki video yuboring.'));
bot.on('sticker',  (ctx) => ctx.reply('📸 Rasm yoki video yuboring.'));

// ─── LAUNCH ──────────────────────────────────────────────────────────────────

if (process.env.WEBHOOK_URL) {
  bot.launch({
    webhook: {
      domain: process.env.WEBHOOK_URL,
      port:   process.env.PORT || 3000
    }
  });
  console.log('🚀 Bot webhook orqali ishga tushdi');
} else {
  bot.launch();
  console.log('🚀 Bot polling orqali ishga tushdi');
}

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
