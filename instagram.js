const { IgApiClient } = require('instagram-private-api');
const Session = require('./sessionModel');

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

async function postPhoto(imageBuffer, caption = '') {
  if (!isLoggedIn) await loginInstagram();
  return reloginIfNeeded(() =>
    ig.publish.photo({ file: imageBuffer, caption })
  );
}

async function postVideo(videoBuffer, coverBuffer, caption = '') {
  if (!isLoggedIn) await loginInstagram();
  return reloginIfNeeded(() =>
    ig.publish.video({ video: videoBuffer, coverImage: coverBuffer, caption })
  );
}

module.exports = { loginInstagram, postPhoto, postVideo };
