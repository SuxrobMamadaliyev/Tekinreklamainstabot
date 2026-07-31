const { IgApiClient } = require('instagram-private-api');
const Session = require('./sessionModel');

const ig = new IgApiClient();
let isLoggedIn = false;

async function loginInstagram() {
  ig.state.generateDevice(process.env.IG_USERNAME);

  // MongoDB dan session yuklash
  const saved = await Session.findOne({ key: 'ig_session' });

  if (saved && saved.data) {
    try {
      await ig.state.deserialize(saved.data);
      await ig.account.currentUser(); // session hali amal qiladimi tekshirish
      isLoggedIn = true;
      console.log('✅ Instagram session qayta tiklandi');
      return;
    } catch (e) {
      console.log('⚠️ Session eskirgan, qayta login qilinmoqda...');
      isLoggedIn = false;
    }
  }

  // Yangi login
  await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);

  // Sessionni MongoDB ga saqlash
  const sessionData = await ig.state.serialize();
  delete sessionData.constants; // keraksiz maydon
  await Session.findOneAndUpdate(
    { key: 'ig_session' },
    { key: 'ig_session', data: sessionData },
    { upsert: true, new: true }
  );

  isLoggedIn = true;
  console.log('✅ Instagram ga muvaffaqiyatli login qilindi');
}

async function postPhoto(imageBuffer, caption = '') {
  if (!isLoggedIn) {
    await loginInstagram();
  }

  try {
    const result = await ig.publish.photo({
      file: imageBuffer,
      caption: caption
    });
    return result;
  } catch (e) {
    // Session muammosi bo'lsa, qayta login qilib urinish
    if (e.name === 'IgLoginRequiredError' || e.name === 'IgNotLoggedInError') {
      isLoggedIn = false;
      await loginInstagram();
      const result = await ig.publish.photo({
        file: imageBuffer,
        caption: caption
      });
      return result;
    }
    throw e;
  }
}

async function postVideo(videoBuffer, coverBuffer, caption = '') {
  if (!isLoggedIn) {
    await loginInstagram();
  }

  try {
    const result = await ig.publish.video({
      video: videoBuffer,
      coverImage: coverBuffer,
      caption: caption
    });
    return result;
  } catch (e) {
    if (e.name === 'IgLoginRequiredError' || e.name === 'IgNotLoggedInError') {
      isLoggedIn = false;
      await loginInstagram();
      const result = await ig.publish.video({
        video: videoBuffer,
        coverImage: coverBuffer,
        caption: caption
      });
      return result;
    }
    throw e;
  }
}

module.exports = { loginInstagram, postPhoto, postVideo };
