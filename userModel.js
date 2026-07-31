const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId:  { type: Number, unique: true, required: true },
  username:    { type: String, default: '' },
  firstName:   { type: String, default: '' },
  isBlocked:   { type: Boolean, default: false },
  dailyLimit:  { type: Number, default: 1 },   // foydalanuvchiga maxsus limit
  totalPosts:  { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
