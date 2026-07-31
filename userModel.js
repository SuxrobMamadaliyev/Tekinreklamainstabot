const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId:    { type: Number, unique: true, required: true },
  username:      { type: String, default: '' },
  firstName:     { type: String, default: '' },
  isBlocked:     { type: Boolean, default: false },
  intervalHours: { type: Number, default: 3 },   // foydalanuvchining post interval (soat)
  lastPostAt:    { type: Date, default: null },  // oxirgi muvaffaqiyatli post vaqti
  totalPosts:    { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
