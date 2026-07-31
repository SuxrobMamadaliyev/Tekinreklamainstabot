const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  key:  { type: String, unique: true },
  data: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('Session', sessionSchema);
