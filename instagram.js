const { IgApiClient } = require('instagram-private-api');
const Session = require('./sessionModel');
const IgAccount = require('./igAccountModel');
const queue = require('./queue');
const { encrypt, decrypt } = require('./cryptoHelper');
const { fetchInstagramCodeFromGmail } = require('./gmailChallenge');

const ig = new IgApiClient();
let isLoggedIn = false;

// ─── AKKAUNT MA'LUMOTLARI (bazadan) ─────────────────────────────────────────

async function getIgAccount() {
  return IgAccount.findOne({ key: 'main' });
}

// Admin panel shu funksiyani chaqirib akkaunt/gmail ma'lumotlarini saqlaydi
async function saveIgAccount({ igUsername, igPassword, gmailAddress, gmailAppPassword }) {
  const update = {};
  if (igUsername !== undefined) update.igUsername = igUsername;
  if (igPassword !== undefined) update.igPasswordEnc = encrypt(igPassword);
  if (gmailAddress !== undefined) update.gmailAddress = gmailAddress;
  if (gmailAppPassword !== undefined) update.gmailAppPassEnc = encrypt(gmailAppPassword);

  return IgAccount.findOneAndUpdate(
    { key: 'main' },
    { key: 'main', ...update },
    { upsert: true, new: true }
  );
}

// Hozir ulangan Instagram username'ni qaytaradi (ko'rsatish uchun)
async function getConnectedUsername() {
  const acc = await getIgAccount();
  return acc?.igUsername || null;
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────

async function loginInstagram(forceRelogin = false) {
  if (isLoggedIn && !forceRelogin) return;
  isLoggedIn = false;

  const acc = await getIgAccount();
  if (!acc || !acc.igUsername || !acc.igPasswordEnc) {
    throw new Error('Instagram akkaunt ulanmagan. Admin panelda "🔗 Instagram ulash" tugmasi orqali ulang.');
  }

  const igUsername = acc.igUsername;
  const igPassword = decrypt(acc.igPasswordEnc);

  ig.state.generateDevice(igUsername);

  // Saqlangan sessionni yuklash (force bo'lmasa)
  if (!forceRelogin) {
    const saved = await Session.findOne({ key: 'ig_session' });
    if (saved && saved.data) {
      try {
        await ig.state.deserialize(saved.data);
        await ig.account.currentUser();
        isLoggedIn = true;
        console.log('✅ Instagram session yuklandi');
        return;
      } catch {
        console.log('⚠️ Session eskirgan, qayta login...');
      }
    }
  }

  // Yangi login
  try {
    await ig.account.login(igUsername, igPassword);
  } catch (err) {
    // Instagram xavfsizlik tekshiruvi (checkpoint) so'rasa
    if (err.name === 'IgCheckpointError') {
      console.log('🔒 Instagram xavfsizlik tekshiruvi (checkpoint) so\'ralmoqda...');

      const gmailAddress     = acc.gmailAddress;
      const gmailAppPassword = decrypt(acc.gmailAppPassEnc);

      if (!gmailAddress || !gmailAppPassword) {
        throw new Error(
          'Instagram tasdiqlash kodi so\'ramoqda, lekin Gmail ulanmagan. ' +
          'Admin panelda "🔗 Instagram ulash" orqali Gmail ma\'lumotlarini kiriting.'
        );
      }

      // Tasdiqlash kodini email (Gmail) orqali yuborishni so'raymiz
      await ig.challenge.auto(true);

      console.log('📩 Gmail orqali tasdiqlash kodi kutilmoqda...');
      const code = await fetchInstagramCodeFromGmail(gmailAddress, gmailAppPassword);

      await ig.challenge.sendSecurityCode(code);
      console.log('✅ Tasdiqlash kodi qabul qilindi');
    } else {
      throw err;
    }
  }

  const sessionData = await ig.state.serialize();
  delete sessionData.constants;
  await Session.findOneAndUpdate(
    { key: 'ig_session' },
    { key: 'ig_session', data: sessionData },
    { upsert: true }
  );
  isLoggedIn = true;
  console.log('✅ Instagram ga login qilindi');
}

async function reloginIfNeeded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.name?.includes('IgLogin') || err.name?.includes('IgNotLoggedIn')) {
      isLoggedIn = false;
      await loginInstagram();
      return await fn();
    }
    throw err;
  }
}

// Postlash amallari navbat orqali ketma-ket bajariladi — bir vaqtda
// koʻplab foydalanuvchi yuborsa ham Instagram sessiyasi buzilmaydi.

function postPhoto(imageBuffer, caption = '') {
  return queue.push(async () => {
    if (!isLoggedIn) await loginInstagram();
    return reloginIfNeeded(() =>
      ig.publish.photo({ file: imageBuffer, caption })
    );
  });
}

function postVideo(videoBuffer, coverBuffer, caption = '') {
  return queue.push(async () => {
    if (!isLoggedIn) await loginInstagram();
    return reloginIfNeeded(() =>
      ig.publish.video({ video: videoBuffer, coverImage: coverBuffer, caption })
    );
  });
}

// Navbatda hozircha nechta post kutayotganini bilish uchun (UX xabari uchun)
function queueSize() {
  return queue.size();
}

module.exports = {
  loginInstagram,
  postPhoto,
  postVideo,
  queueSize,
  saveIgAccount,
  getConnectedUsername
};
