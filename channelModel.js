const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  chatId:     { type: Number, required: true, unique: true },
  username:   { type: String, default: '' },   // @kanal (public boʻlsa)
  title:      { type: String, default: '' },
  inviteLink: { type: String, default: '' }    // private kanal uchun taklif linki
}, { timestamps: true });

module.exports = mongoose.model('Channel', channelSchema);
