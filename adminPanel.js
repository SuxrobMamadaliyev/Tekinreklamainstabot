const { Markup } = require('telegraf');
const User = require('./userModel');
const Post = require('./postModel');
const Setting = require('./settingModel');
const Channel = require('./channelModel');
const IgAccount = require('./igAccountModel');
const { loginInstagram, saveIgAccount, getConnectedUsername } = require('./instagram');

const HARD_MIN_INTERVAL_HOURS = 3;

// Admin multi-step holat
const adminState = new Map();

// ─── ADMIN ASOSIY KEYBOARD ──────────────────────────────────────────────────
function adminKeyboard() {
  return Markup.keyboard([
    ['📊 Statistika',        '👥 Foydalanuvchilar'],
    ['📋 Postlar logi',      '🔍 User topish'],
    ['⏱ Interval sozlamalari', '📢 Majburiy kanal'],
    ['🔗 Instagram ulash',   '🔄 IG Session'],
    ['📣 Broadcast',         '📵 Bloklangan userlar'],
    ['🏠 Asosiy menu']
  ]).resize();
}

// ─── FOYDALANUVCHI BATAFSIL ─────────────────────────────────────────────────
async function showUserDetail(ctx, user) {
  const name = user.username ? `@${user.username}` : (user.firstName || 'Nomsiz');
  const statusIcon = user.isBlocked ? '🚫' : '✅';
  const joinDate = new Date(user.createdAt).toLocaleDateString('uz-UZ');

  let nextPostText = '✅ Hozir post qila oladi';
  if (user.lastPostAt) {
    const intervalMs = user.intervalHours * 3600000;
    const elapsed = Date.now() - new Date(user.lastPostAt).getTime();
    if (elapsed < intervalMs) {
      const remainingMin = Math.ceil((intervalMs - elapsed) / 60000);
      const h = Math.floor(remainingMin / 60);
      const m = remainingMin % 60;
      nextPostText = `⏳ ${h > 0 ? h + ' soat ' : ''}${m} daqiqadan so'ng`;
    }
  }

  const text =
    `👤 *Foydalanuvchi:* ${name}\n` +
    `🆔 ID: \`${user.telegramId}\`\n` +
    `📌 Holat: ${statusIcon} ${user.isBlocked ? 'Bloklangan' : 'Faol'}\n` +
    `📅 Qo'shilgan: ${joinDate}\n\n` +
    `⏱ Interval: *${user.intervalHours} soat*\n` +
    `🕒 Keyingi post: ${nextPostText}\n` +
    `📦 Jami: ${user.totalPosts} ta post`;

  const blockBtn = user.isBlocked
    ? { text: '✅ Blokdan chiqarish', callback_data: `unblock_${user.telegramId}` }
    : { text: '🚫 Bloklash',          callback_data: `block_${user.telegramId}` };

  const keyboard = Markup.inlineKeyboard([
    [blockBtn],
    [{ text: '✏️ Intervalni oʻzgartirish', callback_data: `setuserinterval_${user.telegramId}` }],
    [{ text: '📋 Postlarini ko\'rish',   callback_data: `userposts_${user.telegramId}` }],
    [{ text: '🗑 Postlarini tozalash',   callback_data: `clearposts_${user.telegramId}` }]
  ]);

  return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

// ─── MAJBURIY KANALLAR ROʻYXATI ─────────────────────────────────────────────
async function showChannelsList(ctx) {
  const channels = await Channel.find();

  let msg = `📢 *Majburiy obuna kanallari*\n\n`;
  msg += channels.length
    ? `Hozirgi kanallar (${channels.length} ta):`
    : `Hozircha majburiy kanal qo'shilmagan.`;

  const rows = channels.map(ch => [
    {
      text: `🗑 ${ch.title || ch.username || ch.chatId}`,
      callback_data: `removechannel_${ch.chatId}`
    }
  ]);
  rows.push([{ text: '➕ Kanal qoʻshish', callback_data: 'addchannel' }]);

  return ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

// ─── INSTAGRAM ULASHNI SINAB KO'RISH ────────────────────────────────────────
async function attemptIgConnect(ctx) {
  const msg = await ctx.reply('🔄 Instagram ga ulanmoqda... (agar Gmail orqali tasdiqlash so\'ralsa, biroz vaqt olishi mumkin)');
  try {
    await loginInstagram(true);
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      '✅ Instagram muvaffaqiyatli ulandi!'
    );
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ Ulanmadi: ${e.message}`
    );
  }
  return ctx.reply('🏠 Admin panel', adminKeyboard());
}

// ─── ASOSIY ADMIN HANDLER ───────────────────────────────────────────────────
async function handleAdmin(ctx, bot) {
  const text = ctx.message.text;
  const adminId = ctx.from.id;
  const state = adminState.get(adminId);

  // ── STATE asosidagi inputlar ──
  if (state) {
    // Broadcast xabari
    if (state.action === 'broadcast') {
      adminState.delete(adminId);
      const users = await User.find({ isBlocked: false });
      let sent = 0, failed = 0;
      const prog = await ctx.reply(`📢 Yuborilmoqda... 0/${users.length}`);

      for (const u of users) {
        try {
          await bot.telegram.sendMessage(u.telegramId, text, { parse_mode: 'Markdown' });
          sent++;
        } catch { failed++; }

        if ((sent + failed) % 10 === 0) {
          await bot.telegram.editMessageText(
            ctx.chat.id, prog.message_id, null,
            `📢 Yuborilmoqda... ${sent + failed}/${users.length}`
          ).catch(() => {});
        }
      }
      return ctx.reply(
        `✅ *Broadcast tugadi!*\n\n` +
        `✉️ Yuborildi: *${sent}*\n` +
        `❌ Xatolik: *${failed}*`,
        { parse_mode: 'Markdown', ...adminKeyboard() }
      );
    }

    // Global minimal interval o'zgartirish
    if (state.action === 'set_min_interval') {
      const hours = parseInt(text);
      if (isNaN(hours) || hours < HARD_MIN_INTERVAL_HOURS) {
        return ctx.reply(`❌ Kamida ${HARD_MIN_INTERVAL_HOURS} soat bo'lgan butun son kiriting:`);
      }
      adminState.delete(adminId);
      await Setting.set('min_interval_hours', hours);
      return ctx.reply(
        `✅ Minimal interval *${hours} soat* ga o'zgartirildi!\n` +
        `_(Yangi foydalanuvchilar shu interval bilan boshlanadi)_`,
        { parse_mode: 'Markdown', ...adminKeyboard() }
      );
    }

    // User qidirish
    if (state.action === 'search_user') {
      adminState.delete(adminId);
      let user;
      const q = text.replace('@', '').trim();
      if (!isNaN(q)) {
        user = await User.findOne({ telegramId: parseInt(q) });
      } else {
        user = await User.findOne({ username: q });
      }
      if (!user) return ctx.reply('❌ Foydalanuvchi topilmadi!');
      return showUserDetail(ctx, user);
    }

    // User uchun maxsus interval
    if (state.action === 'set_user_interval') {
      const hours = parseInt(text);
      if (isNaN(hours) || hours < 1) return ctx.reply('❌ 1 dan katta butun son kiriting:');
      const targetId = state.targetId;
      adminState.delete(adminId);
      await User.findOneAndUpdate({ telegramId: targetId }, { intervalHours: hours });
      const user = await User.findOne({ telegramId: targetId });
      await ctx.reply(`✅ Interval *${hours} soat* ga o'zgartirildi!`, { parse_mode: 'Markdown' });
      return showUserDetail(ctx, user);
    }

    // Majburiy kanal qo'shish (@username orqali)
    if (state.action === 'add_channel') {
      const username = text.trim().replace('@', '');
      try {
        const chat = await ctx.telegram.getChat(`@${username}`);
        if (!['channel', 'supergroup'].includes(chat.type)) {
          return ctx.reply('❌ Bu kanal emas. Kanal @username kiriting:');
        }

        // Bot shu kanalda admin ekanligini tekshirish
        const me = await ctx.telegram.getMe();
        const botMember = await ctx.telegram.getChatMember(chat.id, me.id);
        if (!['administrator', 'creator'].includes(botMember.status)) {
          return ctx.reply(
            `❌ Bot "${chat.title}" kanalida admin emas!\n` +
            `Avval botni kanalga admin qilib qo'shing, keyin @username qayta yuboring:`
          );
        }

        adminState.delete(adminId);
        await Channel.findOneAndUpdate(
          { chatId: chat.id },
          { chatId: chat.id, username: chat.username || '', title: chat.title || '' },
          { upsert: true }
        );
        await ctx.reply(`✅ "${chat.title}" majburiy obuna ro'yxatiga qo'shildi!`, adminKeyboard());
        return showChannelsList(ctx);
      } catch (e) {
        return ctx.reply(
          `❌ Kanal topilmadi yoki xatolik: ${e.message}\n\n` +
          `Kanal @username kiriting (masalan: @mychannel):`
        );
      }
    }

    // Instagram ulash — 1-qadam: username
    if (state.action === 'ig_connect_username') {
      const igUsername = text.trim().replace('@', '');
      adminState.set(adminId, { action: 'ig_connect_password', igUsername });
      return ctx.reply('🔑 Endi Instagram *parolini* kiriting:', { parse_mode: 'Markdown' });
    }

    // Instagram ulash — 2-qadam: parol
    if (state.action === 'ig_connect_password') {
      const igPassword = text;
      // Xavfsizlik uchun parolni chat tarixidan darhol o'chirib tashlaymiz
      await ctx.deleteMessage().catch(() => {});
      adminState.set(adminId, { action: 'ig_connect_gmail_choice', igUsername: state.igUsername, igPassword });
      return ctx.reply(
        `🔒 Parol qabul qilindi (xabar o'chirildi).\n\n` +
        `Instagram tasdiqlash kodi so'rasa, buni *Gmail orqali avtomatik* olishni xohlaysizmi?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [{ text: '✅ Ha, Gmail orqali', callback_data: 'igconnect_gmail_yes' }],
            [{ text: '❌ Yo\'q, o\'zim hal qilaman', callback_data: 'igconnect_gmail_no' }]
          ])
        }
      );
    }

    // Instagram ulash — 3-qadam: Gmail manzili
    if (state.action === 'ig_connect_gmail_address') {
      adminState.set(adminId, { ...state, action: 'ig_connect_gmail_password', gmailAddress: text.trim() });
      return ctx.reply(
        `🔑 Gmail *App Password* kiriting (16 xonali, oddiy Gmail parolingiz EMAS!)\n\n` +
        `Buni shu yerdan olasiz: https://myaccount.google.com/apppasswords\n` +
        `_(Gmail'da 2 bosqichli tasdiqlash yoqilgan bo'lishi shart)_`,
        { parse_mode: 'Markdown' }
      );
    }

    // Instagram ulash — 4-qadam: Gmail App Password
    if (state.action === 'ig_connect_gmail_password') {
      const { igUsername, igPassword, gmailAddress } = state;
      const gmailAppPassword = text.trim();
      await ctx.deleteMessage().catch(() => {});
      adminState.delete(adminId);
      await saveIgAccount({ igUsername, igPassword, gmailAddress, gmailAppPassword });
      await ctx.reply('✅ Gmail ma\'lumotlari saqlandi (xabar o\'chirildi).');
      return attemptIgConnect(ctx);
    }
  }

  // ── MENU TUGMALARI ──

  // 📊 Statistika
  if (text === '📊 Statistika') {
    const totalUsers    = await User.countDocuments();
    const blockedUsers  = await User.countDocuments({ isBlocked: true });
    const totalPosts    = await Post.countDocuments({ status: 'success' });
    const failedPosts   = await Post.countDocuments({ status: 'failed' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayPosts = await Post.countDocuments({ status: 'success', createdAt: { $gte: today } });

    const minInterval = await Setting.get('min_interval_hours', HARD_MIN_INTERVAL_HOURS);

    // Haftalik postlar
    const week = new Date(); week.setDate(week.getDate() - 7);
    const weekPosts = await Post.countDocuments({ status: 'success', createdAt: { $gte: week } });

    const igUsername = await getConnectedUsername();

    return ctx.reply(
      `📊 *BOT STATISTIKASI*\n` +
      `${'─'.repeat(28)}\n\n` +
      `👥 *Foydalanuvchilar:*\n` +
      `   Jami: *${totalUsers}*\n` +
      `   Faol: *${totalUsers - blockedUsers}*\n` +
      `   Bloklangan: *${blockedUsers}*\n\n` +
      `📸 *Postlar:*\n` +
      `   Bugun: *${todayPosts}*\n` +
      `   Hafta: *${weekPosts}*\n` +
      `   Jami: *${totalPosts}*\n` +
      `   Xatolik: *${failedPosts}*\n\n` +
      `⏱ Minimal interval: *${minInterval} soat*\n` +
      `📱 Instagram: *${igUsername ? '@' + igUsername : 'ulanmagan ⚠️'}*`,
      { parse_mode: 'Markdown' }
    );
  }

  // 👥 Foydalanuvchilar
  if (text === '👥 Foydalanuvchilar') {
    const total = await User.countDocuments();
    const users = await User.find().sort({ createdAt: -1 }).limit(15);
    if (!users.length) return ctx.reply('👥 Hali foydalanuvchi yo\'q');

    let msg = `👥 *Foydalanuvchilar* (so'nggi 15 / jami ${total}):\n\n`;
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const icon = u.isBlocked ? '🚫' : '✅';
      const name = u.username ? `@${u.username}` : (u.firstName || 'Nomsiz');
      msg += `${i + 1}. ${icon} ${name}\n`;
      msg += `   📸 ${u.totalPosts} post | ⏱ ${u.intervalHours} soat\n`;
      msg += `   \`${u.telegramId}\`\n\n`;
    }
    msg += `_Batafsil: 🔍 User topish_`;
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  }

  // 📋 Postlar logi
  if (text === '📋 Postlar logi') {
    const posts = await Post.find().sort({ createdAt: -1 }).limit(10);
    if (!posts.length) return ctx.reply('📋 Hali post yo\'q');

    let msg = `📋 *Oxirgi 10 ta post:*\n\n`;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const icon = p.status === 'success' ? '✅' : '❌';
      const who  = p.telegramUsername ? `@${p.telegramUsername}` : `ID: ${p.telegramUserId}`;
      const date = new Date(p.createdAt).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
      const typeIcon = p.type === 'video' ? '🎬' : '📸';
      msg += `${i + 1}. ${icon} ${typeIcon} ${who}\n`;
      msg += `   📅 ${date}\n`;
      if (p.caption) msg += `   📝 ${p.caption.slice(0, 35)}...\n`;
      msg += '\n';
    }
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  }

  // ⏱ Interval sozlamalari
  if (text === '⏱ Interval sozlamalari') {
    const current = await Setting.get('min_interval_hours', HARD_MIN_INTERVAL_HOURS);
    adminState.set(adminId, { action: 'set_min_interval' });
    return ctx.reply(
      `⏱ *Minimal Post Interval*\n\n` +
      `Hozirgi: *${current} soat*\n` +
      `(Tizim bo'yicha eng kichik ruxsat etilgan qiymat: ${HARD_MIN_INTERVAL_HOURS} soat)\n\n` +
      `Yangi minimal intervalni soatda kiriting:\n` +
      `_(Bu yangi foydalanuvchilar uchun standart bo'ladi)_`,
      { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
  }

  // 📢 Majburiy kanal
  if (text === '📢 Majburiy kanal') {
    return showChannelsList(ctx);
  }

  // 🔗 Instagram ulash
  if (text === '🔗 Instagram ulash') {
    const acc = await IgAccount.findOne({ key: 'main' });
    adminState.set(adminId, { action: 'ig_connect_username' });
    return ctx.reply(
      `🔗 *Instagram akkauntni ulash*\n\n` +
      (acc?.igUsername
        ? `Hozirgi ulangan: *@${acc.igUsername}*\n` +
          (acc.gmailAddress ? `Gmail: *${acc.gmailAddress}* orqali tasdiqlanadi\n` : `Gmail ulanmagan\n`) + `\n`
        : '') +
      `Yangi/o'zgartirilgan Instagram username kiriting (@ belgisisiz):`,
      { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
  }

  // 🔍 User topish
  if (text === '🔍 User topish') {
    adminState.set(adminId, { action: 'search_user' });
    return ctx.reply(
      '🔍 *User topish*\n\n@username yoki Telegram ID kiriting:',
      { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
  }

  // 📣 Broadcast
  if (text === '📣 Broadcast') {
    const count = await User.countDocuments({ isBlocked: false });
    adminState.set(adminId, { action: 'broadcast' });
    return ctx.reply(
      `📢 *Broadcast*\n\n` +
      `Qabul qiluvchilar: *${count}* ta faol user\n\n` +
      `Yuboriladigan xabarni kiriting:`,
      { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
  }

  // 📵 Bloklangan
  if (text === '📵 Bloklangan userlar') {
    const blocked = await User.find({ isBlocked: true });
    if (!blocked.length) return ctx.reply('✅ Bloklangan foydalanuvchi yo\'q');

    let msg = `🚫 *Bloklangan foydalanuvchilar (${blocked.length}):\n\n*`;
    blocked.forEach((u, i) => {
      const name = u.username ? `@${u.username}` : (u.firstName || 'Nomsiz');
      msg += `${i + 1}. ${name} — \`${u.telegramId}\`\n`;
    });
    msg += `\n_Blokdan chiqarish: 🔍 User topish_`;
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  }

  // 🔄 IG Session
  if (text === '🔄 IG Session') {
    const username = await getConnectedUsername();
    if (!username) {
      return ctx.reply(
        '❌ Hali Instagram akkaunt ulanmagan.\n"🔗 Instagram ulash" tugmasidan foydalaning.'
      );
    }
    const msg = await ctx.reply(`🔄 @${username} ga qayta ulanilmoqda...`);
    try {
      await loginInstagram(true);
      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        '✅ Instagram sessiyasi muvaffaqiyatli yangilandi!'
      );
    } catch (e) {
      await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, null,
        `❌ Xatolik: ${e.message}`
      );
    }
    return;
  }

  // ❌ Bekor qilish
  if (text === '❌ Bekor qilish') {
    adminState.delete(adminId);
    return ctx.reply('↩️ Bekor qilindi', adminKeyboard());
  }

  // 🏠 Asosiy menu
  if (text === '🏠 Asosiy menu') {
    adminState.delete(adminId);
    return ctx.reply('🏠 Admin panel', adminKeyboard());
  }

  ctx.reply('❓ Tugmadan foydalaning', adminKeyboard());
}

// ─── INLINE CALLBACK HANDLER ────────────────────────────────────────────────
async function handleAdminCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const adminId = ctx.from.id;

  // 🚫 Bloklash
  if (data.startsWith('block_')) {
    const targetId = parseInt(data.split('_')[1]);
    await User.findOneAndUpdate({ telegramId: targetId }, { isBlocked: true });
    await ctx.answerCbQuery('🚫 Bloklandi');
    const user = await User.findOne({ telegramId: targetId });
    return showUserDetail(ctx, user);
  }

  // ✅ Blokdan chiqarish
  if (data.startsWith('unblock_')) {
    const targetId = parseInt(data.split('_')[1]);
    await User.findOneAndUpdate({ telegramId: targetId }, { isBlocked: false });
    await ctx.answerCbQuery('✅ Blokdan chiqarildi');
    const user = await User.findOne({ telegramId: targetId });
    return showUserDetail(ctx, user);
  }

  // ✏️ Interval o'zgartirish (foydalanuvchi uchun)
  if (data.startsWith('setuserinterval_')) {
    const targetId = parseInt(data.split('_')[1]);
    adminState.set(adminId, { action: 'set_user_interval', targetId });
    await ctx.answerCbQuery();
    const user = await User.findOne({ telegramId: targetId });
    const name = user.username ? `@${user.username}` : `ID: ${targetId}`;
    return ctx.reply(
      `✏️ *${name}* uchun yangi intervalni soatda kiriting:`,
      { parse_mode: 'Markdown' }
    );
  }

  // 📋 User postlarini ko'rish
  if (data.startsWith('userposts_')) {
    const targetId = parseInt(data.split('_')[1]);
    await ctx.answerCbQuery();
    const posts = await Post.find({ telegramUserId: targetId }).sort({ createdAt: -1 }).limit(7);
    if (!posts.length) return ctx.reply('📭 Bu user hali post yubormagan');

    let msg = `📋 *Oxirgi 7 ta post:*\n\n`;
    posts.forEach((p, i) => {
      const icon = p.status === 'success' ? '✅' : '❌';
      const typeIcon = p.type === 'video' ? '🎬' : '📸';
      const date = new Date(p.createdAt).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
      msg += `${i + 1}. ${icon} ${typeIcon} ${date}\n`;
      if (p.caption) msg += `   📝 ${p.caption.slice(0, 40)}\n`;
    });
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  }

  // 🗑 Postlarini tozalash
  if (data.startsWith('clearposts_')) {
    const targetId = parseInt(data.split('_')[1]);
    await ctx.answerCbQuery();
    return ctx.reply(
      `⚠️ *Tasdiqlash kerak!*\n\nID ${targetId} userning barcha post loglarini o'chirasizmi?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            { text: '✅ Ha, o\'chir', callback_data: `confirmclear_${targetId}` },
            { text: '❌ Yo\'q',       callback_data: `cancelclear_${targetId}` }
          ]
        ])
      }
    );
  }

  if (data.startsWith('confirmclear_')) {
    const targetId = parseInt(data.split('_')[1]);
    const result = await Post.deleteMany({ telegramUserId: targetId });
    await User.findOneAndUpdate({ telegramId: targetId }, { totalPosts: 0 });
    await ctx.answerCbQuery('🗑 Tozalandi');
    return ctx.reply(`✅ ${result.deletedCount} ta post logi o'chirildi`);
  }

  if (data.startsWith('cancelclear_')) {
    await ctx.answerCbQuery('↩️ Bekor qilindi');
    return;
  }

  // ➕ Majburiy kanal qo'shish
  if (data === 'addchannel') {
    adminState.set(adminId, { action: 'add_channel' });
    await ctx.answerCbQuery();
    return ctx.reply(
      `➕ *Majburiy kanal qo'shish*\n\n` +
      `⚠️ Botni avval kanalga *admin* qilib qo'shing.\n\n` +
      `Kanal @username kiriting (masalan: @mychannel):`,
      { parse_mode: 'Markdown' }
    );
  }

  // 🗑 Majburiy kanalni o'chirish
  if (data.startsWith('removechannel_')) {
    const chatId = parseInt(data.split('_')[1]);
    await Channel.deleteOne({ chatId });
    await ctx.answerCbQuery('🗑 Kanal o\'chirildi');
    return showChannelsList(ctx);
  }

  // ✅ Instagram ulash — Gmail orqali tasdiqlash: HA
  if (data === 'igconnect_gmail_yes') {
    const state = adminState.get(adminId);
    await ctx.answerCbQuery();
    if (!state || state.action !== 'ig_connect_gmail_choice') {
      return ctx.reply('❌ Sessiya eskirgan. "🔗 Instagram ulash" dan qayta boshlang.');
    }
    adminState.set(adminId, { action: 'ig_connect_gmail_address', igUsername: state.igUsername, igPassword: state.igPassword });
    return ctx.reply('📧 Gmail manzilingizni kiriting:');
  }

  // ❌ Instagram ulash — Gmail orqali tasdiqlash: YO'Q
  if (data === 'igconnect_gmail_no') {
    const state = adminState.get(adminId);
    await ctx.answerCbQuery();
    if (!state || state.action !== 'ig_connect_gmail_choice') {
      return ctx.reply('❌ Sessiya eskirgan. "🔗 Instagram ulash" dan qayta boshlang.');
    }
    adminState.delete(adminId);
    await saveIgAccount({ igUsername: state.igUsername, igPassword: state.igPassword, gmailAddress: '', gmailAppPassword: '' });
    return attemptIgConnect(ctx);
  }

  ctx.answerCbQuery();
}

module.exports = { adminKeyboard, handleAdmin, handleAdminCallback, adminState };
