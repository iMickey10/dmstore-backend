const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: String,
  brand: String,
  price: Number,
  discountPrice: Number,
  stock: Number,
  weight_grams: Number,
  image: String,
  category: String
});

module.exports = mongoose.model('Product', productSchema, 'products'); // <-- nombre exacto de colección