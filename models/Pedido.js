// models/Pedido.js (ejemplo)
const mongoose = require('mongoose');

const pedidoSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  nombre: String,
  celular: String,
  correo: String,
  direccion: String,
  productos: [
    {
      id: String,
      nombre: String,
      cantidad: Number,
      precioUnitario: Number,
      total: Number
    }
  ],
  total: Number,
  pesoTotal: Number,
}, { timestamps: true });

module.exports = mongoose.model('Pedido', pedidoSchema);

