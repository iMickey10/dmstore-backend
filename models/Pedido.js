const mongoose = require('mongoose');

const pedidoSchema = new mongoose.Schema({
  nombre: String,
  celular: String,
  correo: String,
  direccion: String,
  productos: [
    {
      nombre: String,
      cantidad: Number,
      precioUnitario: Number,
      total: Number
    }
  ],
  pesoTotal: Number,
  fecha: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Pedido', pedidoSchema);

