const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  _id: String, // Por ejemplo: "catalog_price_display"
  mode: {
    type: String,
    enum: ['normal', 'promo', 'both'],
    default: 'both'
  }
});

module.exports = mongoose.model('Setting', settingSchema);
