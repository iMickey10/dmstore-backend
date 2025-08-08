const mongoose = require('mongoose');

const pedidoSchema = new mongoose.Schema({

  orderNumber: {
    type: String,
    unique: true,
    index: true
  },
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
  pesoTotal: Number,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Pedido', pedidoSchema);

