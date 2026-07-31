const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  telegramUserId:   { type: Number, required: true },
  telegramUsername: { type: String, default: '' },
  caption:          { type: String, default: '' },
  type:             { type: String, enum: ['photo', 'video'], default: 'photo' },
  instagramMediaId: { type: String, default: '' },
  status:           { type: String, enum: ['success', 'failed'], default: 'success' },
  error:            { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Post', postSchema);
