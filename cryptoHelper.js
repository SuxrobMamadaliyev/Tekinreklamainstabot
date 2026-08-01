const crypto = require('crypto');

// Maxfiy kalit .env dagi ENCRYPTION_KEY dan olinadi (istalgan matn bo'lishi mumkin,
// lekin uzoq va tasodifiy bo'lgani ma'qul). Agar berilmasa, standart qiymat ishlatiladi
// — LEKIN productionda albatta o'zingizning ENCRYPTION_KEY qiymatingizni .env ga yozing.
const ALGORITHM = 'aes-256-gcm';
const SECRET = String(process.env.ENCRYPTION_KEY || 'change_me_please_set_env_key');
const KEY = crypto.createHash('sha256').update(SECRET).digest();

// Matnni shifrlaydi (parollarni bazaga ochiq holda saqlamaslik uchun)
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

// Shifrlangan matnni asl holiga qaytaradi
function decrypt(data) {
  if (!data) return '';
  try {
    const buf = Buffer.from(data, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { encrypt, decrypt };
