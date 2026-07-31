require('dotenv').config();
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const axios = require('axios');
const sharp = require('sharp');
const { loginInstagram, postPhoto, postVideo } = require('./instagram');
const Post = require('./postModel');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Foydalanuvchi holati (caption kutish uchun)
const userState = new Map();

// MongoDB ulanish
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB ulandi');
    await loginInstagram(); // bot ishga tushganda login
  })
  .catch(err => {
    console.error('❌ MongoDB ulanmadi:', err.message);
    process.exit(1);
  });

// Telegram faylni buffer sifatida yuklab olish
async function downloadFile(fileId) {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

// Rasmni Instagram uchun tayyorlash (min 320px, max 1080px, JPEG)
async function prepareImage(buffer) {
  return await sharp(buffer)
    .resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// /start
bot.start((ctx) => {
  ctx.reply(
    `👋 Salom, ${ctx.from.first_name}!\n\n` +
    `📸 Menga rasm yoki video yuboring — men uni Instagram'ga post qilaman.\n\n` +
    `📝 *Qanday ishlaydi?*\n` +
    `1. Rasm yoki video yuboring\n` +
    `2. Caption (ixtiyoriy) yozing\n` +
    `3. ✅ Post ketadi!\n\n` +
    `🔧 Admin buyruqlari:\n` +
    `/status - Bot holati\n` +
    `/logs - Oxirgi postlar`,
    { parse_mode: 'Markdown' }
  );
});

// /status
bot.command('status', async (ctx) => {
  const totalPosts = await Post.countDocuments({ status: 'success' });
  const failedPosts = await Post.countDocuments({ status: 'failed' });
  ctx.reply(
    `📊 *Bot holati:*\n\n` +
    `✅ Muvaffaqiyatli postlar: ${totalPosts}\n` +
    `❌ Xatoliklar: ${failedPosts}\n` +
    `📱 Instagram: @${process.env.IG_USERNAME}`,
    { parse_mode: 'Markdown' }
  );
});

// /logs - oxirgi 5 ta post
bot.command('logs', async (ctx) => {
  const posts = await Post.find().sort({ createdAt: -1 }).limit(5);
  if (!posts.length) return ctx.reply('📭 Hali hech qanday post yo\'q');

  let text = '📋 *Oxirgi postlar:*\n\n';
  posts.forEach((p, i) => {
    const date = new Date(p.createdAt).toLocaleString('uz-UZ');
    const user = p.telegramUsername ? `@${p.telegramUsername}` : `ID: ${p.telegramUserId}`;
    const status = p.status === 'success' ? '✅' : '❌';
    text += `${i + 1}. ${status} ${user}\n`;
    text += `   📅 ${date}\n`;
    if (p.caption) text += `   📝 ${p.caption.slice(0, 30)}...\n`;
    text += '\n';
  });

  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Rasm qabul qilish
bot.on('photo', async (ctx) => {
  const msg = await ctx.reply('⏳ Rasm yuklanmoqda...');

  try {
    // Eng yuqori sifatli rasm
    const photo = ctx.message.photo.at(-1);
    const caption = ctx.message.caption || '';

    const rawBuffer = await downloadFile(photo.file_id);
    const imageBuffer = await prepareImage(rawBuffer);

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      '📤 Instagram ga yuklanmoqda...'
    );

    const result = await postPhoto(imageBuffer, caption);

    // Log saqlash
    await Post.create({
      telegramUserId: ctx.from.id,
      telegramUsername: ctx.from.username,
      caption: caption,
      instagramMediaId: result.media?.id || '',
      status: 'success'
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `✅ Post muvaffaqiyatli yuklandi!\n📱 Instagram: @${process.env.IG_USERNAME}`
    );

  } catch (err) {
    console.error('❌ Post xatosi:', err.message);

    await Post.create({
      telegramUserId: ctx.from.id,
      telegramUsername: ctx.from.username,
      status: 'failed',
      error: err.message
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ Xatolik yuz berdi: ${err.message}\n\nQayta urinib ko'ring.`
    );
  }
});

// Video qabul qilish
bot.on('video', async (ctx) => {
  const msg = await ctx.reply('⏳ Video yuklanmoqda...');

  try {
    const video = ctx.message.video;
    const caption = ctx.message.caption || '';

    // Video hajmi tekshirish (Instagram max 100MB)
    if (video.file_size > 100 * 1024 * 1024) {
      return ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        '❌ Video hajmi 100MB dan oshmasligi kerak!'
      );
    }

    const videoBuffer = await downloadFile(video.file_id);

    // Cover rasm (thumb bo'lsa, uni ishlatamiz)
    let coverBuffer;
    if (ctx.message.video.thumb) {
      const rawCover = await downloadFile(ctx.message.video.thumb.file_id);
      coverBuffer = await prepareImage(rawCover);
    } else {
      // Default qora cover
      coverBuffer = await sharp({
        create: { width: 640, height: 640, channels: 3, background: { r: 0, g: 0, b: 0 } }
      }).jpeg().toBuffer();
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      '📤 Instagram ga yuklanmoqda... (bu biroz vaqt oladi)'
    );

    const result = await postVideo(videoBuffer, coverBuffer, caption);

    await Post.create({
      telegramUserId: ctx.from.id,
      telegramUsername: ctx.from.username,
      caption: caption,
      instagramMediaId: result.media?.id || '',
      status: 'success'
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `✅ Video muvaffaqiyatli yuklandi!\n📱 Instagram: @${process.env.IG_USERNAME}`
    );

  } catch (err) {
    console.error('❌ Video xatosi:', err.message);

    await Post.create({
      telegramUserId: ctx.from.id,
      telegramUsername: ctx.from.username,
      status: 'failed',
      error: err.message
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ Xatolik: ${err.message}`
    );
  }
});

// Boshqa xabarlar
bot.on('message', (ctx) => {
  ctx.reply('📸 Iltimos, rasm yoki video yuboring.');
});

// Webhook (Render uchun)
if (process.env.WEBHOOK_URL) {
  bot.launch({
    webhook: {
      domain: process.env.WEBHOOK_URL,
      port: process.env.PORT || 3000
    }
  });
  console.log('🚀 Bot webhook orqali ishga tushdi');
} else {
  bot.launch();
  console.log('🚀 Bot polling orqali ishga tushdi');
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
