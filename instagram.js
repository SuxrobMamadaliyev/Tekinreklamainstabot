const { IgApiClient } = require('instagram-private-api');
const Session = require('./sessionModel');
const queue = require('./queue');

const ig = new IgApiClient();
let isLoggedIn = false;

async function loginInstagram(forceRelogin = false) {
  if (isLoggedIn && !forceRelogin) return;
  isLoggedIn = false;

  ig.state.generateDevice(process.env.IG_USERNAME);

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
  await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
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

module.exports = { loginInstagram, postPhoto, postVideo, queueSize };
