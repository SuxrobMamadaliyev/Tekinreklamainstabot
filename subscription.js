const { Markup } = require('telegraf');
const Channel = require('./channelModel');

// Foydalanuvchi obuna boʻlmagan majburiy kanallar roʻyxatini qaytaradi
async function getUnsubscribedChannels(telegram, userId) {
  const channels = await Channel.find();
  if (!channels.length) return [];

  const unsubscribed = [];

  for (const ch of channels) {
    try {
      const member = await telegram.getChatMember(ch.chatId, userId);
      if (['left', 'kicked'].includes(member.status)) {
        unsubscribed.push(ch);
      }
    } catch {
      // Foydalanuvchi haqida maʼlumot olinmasa ham obuna boʻlmagan deb hisoblaymiz
      unsubscribed.push(ch);
    }
  }

  return unsubscribed;
}

// Obuna boʻlish uchun tugmali klaviatura
function subscriptionKeyboard(channels) {
  const rows = channels.map(ch => {
    const url = ch.username
      ? `https://t.me/${ch.username.replace('@', '')}`
      : (ch.inviteLink || null);

    if (url) {
      return [Markup.button.url(`📢 ${ch.title || ch.username || 'Kanal'}`, url)];
    }
    return [Markup.button.callback(`📢 ${ch.title || 'Kanal'}`, 'noop')];
  });

  rows.push([Markup.button.callback('✅ Tekshirdim / Obuna boʻldim', 'check_subscription')]);
  return Markup.inlineKeyboard(rows);
}

module.exports = { getUnsubscribedChannels, subscriptionKeyboard };
