const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  telegramUserId: { type: Number, required: true },
  telegramUsername: { type: String },
  caption: { type: String, default: '' },
  instagramMediaId: { type: String },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  error: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Post', postSchema);
