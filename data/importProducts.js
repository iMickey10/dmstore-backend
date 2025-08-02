const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');
const products = require('./sampleProducts');

dotenv.config();

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(async () => {
  console.log("Conectado a MongoDB");

  await Product.deleteMany();
  console.log("Productos anteriores eliminados");

  await Product.insertMany(products);
  console.log("Productos de ejemplo importados");

  process.exit();
})
.catch((err) => {
  console.error("Error al importar productos:", err);
  process.exit(1);
});