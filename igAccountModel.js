const mongoose = require('mongoose');

// Bitta hujjat sifatida saqlanadi (key='main'), instagram akkaunt va Gmail
// ma'lumotlarini o'zida jamlaydi. Parollar shifrlangan holda saqlanadi
// (cryptoHelper.js orqali) — instagram.js va adminPanel.js shu yerdan
// o'qiydi/yozadi.
const igAccountSchema = new mongoose.Schema({
  key:              { type: String, unique: true, default: 'main' },
  igUsername:       { type: String, default: '' },
  igPasswordEnc:    { type: String, default: '' },  // shifrlangan IG paroli
  gmailAddress:     { type: String, default: '' },
  gmailAppPassEnc:  { type: String, default: '' }   // shifrlangan Gmail App Password
}, { timestamps: true });

module.exports = mongoose.model('IgAccount', igAccountSchema);
