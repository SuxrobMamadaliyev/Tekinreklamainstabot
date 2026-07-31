require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const axios = require('axios');
const sharp = require('sharp');

const { loginInstagram, postPhoto, postVideo } = require('./instagram');
const User = require('./userModel');
const Post = require('./postModel');
const Setting = require('./settingModel');
const { adminKeyboard, handleAdmin, handleAdminCallback } = require('./adminPanel');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── HELPERS ────────────────────────────────────────────────────────────────

function isAdmin(userId) {
  return String(userId) === String(process.env.ADMIN_ID);
}

function userKeyboard() {
  return Markup.keyboard([
    ['📸 Rasm yuborish', '🎬 Video yuborish'],
    ['📊 Statistikam',   'ℹ️ Yordam']
  ]).resize();
}

async function ensureUser(from) {
  return User.findOneAndUpdate(
    { telegramId: from.id },
    {
      $setOnInsert: {
        telegramId: from.id,
        username:   from.username || '',
        firstName:  from.first_name || '',
        isBlocked:  false,
        dailyLimit: 1,
        totalPosts: 0
      }
    },
    { upsert: true, new: true }
  );
}

// Bugungi post sonini qaytaradi
async function todayPostCount(telegramId) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return Post.countDocuments({
    telegramUserId: telegramId,
    status: 'success',
    createdAt: { $gte: from }
  });
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

// Limit xabarini yuborish
async function sendLimitMessage(ctx, todayCount, limit) {
  const reset = new Date();
  reset.setDate(reset.getDate() + 1);
  reset.setHours(0, 0, 0, 0);
  const hours = Math.ceil((reset - Date.now()) / 3600000);

  return ctx.reply(
    `⏳ *Kunlik limitingiz tugadi!*\n\n` +
    `📸 Bugun: ${todayCount}/${limit} post\n` +
    `🕛 Yangilanadi: *${hours} soatdan so'ng*\n\n` +
    `_Limitni oshirish uchun adminga murojaat qiling._`,
    { parse_mode: 'Markdown' }
  );
}

// ─── MONGODB ─────────────────────────────────────────────────────────────────

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB ulandi');
    // Global limit mavjud emasligini tekshirish
    const exists = await Setting.findOne({ key: 'daily_limit' });
    if (!exists) await Setting.set('daily_limit', 1);
    await loginInstagram();
  })
  .catch(err => {
    console.error('❌ MongoDB xatosi:', err.message);
    process.exit(1);
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

  const todayCount = await todayPostCount(user.telegramId);
  const remaining  = Math.max(0, user.dailyLimit - todayCount);

  return ctx.reply(
    `👋 Salom, *${ctx.from.first_name}*!\n\n` +
    `📸 Rasmingizni yuboring — men Instagram'ga post qilaman!\n\n` +
    `⚙️ Kunlik limit: *${user.dailyLimit} ta*\n` +
    `⏳ Bugun qoldi: *${remaining} ta*`,
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
    const todayCount = await todayPostCount(user.telegramId);
    if (todayCount >= user.dailyLimit) return sendLimitMessage(ctx, todayCount, user.dailyLimit);
    return ctx.reply(
      `📸 *Rasmni yuboring*\n\n` +
      `Caption (izoh) qo'shmoqchi bo'lsangiz, rasm bilan birga yozing.\n\n` +
      `⏳ Bugun qolgan: *${user.dailyLimit - todayCount} ta*`,
      { parse_mode: 'Markdown' }
    );
  }

  // 🎬 Video yuborish
  if (text === '🎬 Video yuborish') {
    const todayCount = await todayPostCount(user.telegramId);
    if (todayCount >= user.dailyLimit) return sendLimitMessage(ctx, todayCount, user.dailyLimit);
    return ctx.reply(
      `🎬 *Videoni yuboring*\n\n` +
      `Max hajm: *100 MB*\n` +
      `Caption qo'shmoqchi bo'lsangiz, video bilan birga yozing.\n\n` +
      `⏳ Bugun qolgan: *${user.dailyLimit - todayCount} ta*`,
      { parse_mode: 'Markdown' }
    );
  }

  // 📊 Statistikam
  if (text === '📊 Statistikam') {
    const todayCount = await todayPostCount(user.telegramId);
    const remaining  = Math.max(0, user.dailyLimit - todayCount);
    const joinDate   = new Date(user.createdAt).toLocaleDateString('uz-UZ');

    return ctx.reply(
      `📊 *Sizning statistikangiz:*\n\n` +
      `📸 Bugun: *${todayCount}/${user.dailyLimit}* post\n` +
      `⏳ Qoldi: *${remaining} ta*\n` +
      `📦 Jami postlar: *${user.totalPosts} ta*\n` +
      `📅 Bot'ga qo'shilgan: *${joinDate}*`,
      { parse_mode: 'Markdown' }
    );
  }

  // ℹ️ Yordam
  if (text === 'ℹ️ Yordam') {
    const globalLimit = await Setting.get('daily_limit', 1);
    return ctx.reply(
      `ℹ️ *Yordam*\n\n` +
      `📸 *Rasm:* Rasmni to'g'ridan-to'g'ri yoki tugma orqali yuboring\n` +
      `🎬 *Video:* Videoni yuboring (max 100 MB)\n` +
      `📝 *Caption:* Media bilan birga matn yozing\n\n` +
      `⚙️ Kunlik limit: *${user.dailyLimit} ta post*\n` +
      `📱 Instagram: *@${process.env.IG_USERNAME}*\n\n` +
      `❓ Muammo bo'lsa: @${process.env.ADMIN_USERNAME || 'admin'}`,
      { parse_mode: 'Markdown' }
    );
  }

  // Boshqa matn
  ctx.reply('📸 Iltimos, rasm yoki video yuboring.', userKeyboard());
});

// ─── RASM HANDLER ────────────────────────────────────────────────────────────

bot.on('photo', async (ctx) => {
  if (isAdmin(ctx.from.id)) {
    return ctx.reply('👑 Admin sifatida post yuborish uchun oddiy user sifatida kiriting.');
  }

  const user = await ensureUser(ctx.from);
  if (user.isBlocked) return ctx.reply('🚫 Siz bloklandingiz.');

  const todayCount = await todayPostCount(user.telegramId);
  if (todayCount >= user.dailyLimit) {
    return sendLimitMessage(ctx, todayCount, user.dailyLimit);
  }

  const msg = await ctx.reply('⏳ Rasm yuklanmoqda...');

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
      { $inc: { totalPosts: 1 } }
    );

    const newCount = todayCount + 1;
    const remaining = Math.max(0, user.dailyLimit - newCount);

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `✅ *Post muvaffaqiyatli yuklandi!*\n\n` +
      `📸 Bugun: ${newCount}/${user.dailyLimit}\n` +
      `⏳ Qoldi: ${remaining} ta\n` +
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
  if (isAdmin(ctx.from.id)) return;

  const user = await ensureUser(ctx.from);
  if (user.isBlocked) return ctx.reply('🚫 Siz bloklandingiz.');

  const todayCount = await todayPostCount(user.telegramId);
  if (todayCount >= user.dailyLimit) {
    return sendLimitMessage(ctx, todayCount, user.dailyLimit);
  }

  const video = ctx.message.video;
  if (video.file_size > 100 * 1024 * 1024) {
    return ctx.reply('❌ Video hajmi 100 MB dan oshmasligi kerak!');
  }

  const msg = await ctx.reply('⏳ Video yuklanmoqda... (biroz vaqt olishi mumkin)');

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
      { $inc: { totalPosts: 1 } }
    );

    const newCount  = todayCount + 1;
    const remaining = Math.max(0, user.dailyLimit - newCount);

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `✅ *Video muvaffaqiyatli yuklandi!*\n\n` +
      `🎬 Bugun: ${newCount}/${user.dailyLimit}\n` +
      `⏳ Qoldi: ${remaining} ta\n` +
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
  if (isAdmin(ctx.from.id)) return handleAdminCallback(ctx);
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
