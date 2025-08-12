// models/Pedido.js
const mongoose = require('mongoose');

const lineaSchema = new mongoose.Schema({
  id: { type: String, required: true },         // _id del Product
  nombre: { type: String, required: true },
  cantidad: { type: Number, required: true, min: 1 },
  precioUnitario: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 }
}, { _id: false });

const pedidoSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },

  // Datos del cliente
  nombre: String,
  celular: String,
  correo: String,
  direccion: String,

  // Líneas
  productos: { type: [lineaSchema], default: [] },

  // Totales
  total: { type: Number, default: 0 },
  pesoTotal: { type: Number, default: 0 },

  // Modo configurado y tipo de precio usado
  priceMode: {
    type: String,
    enum: ['normal', 'promo', 'both'],
    default: 'normal',
    index: true
  },
  tipoPrecio: {
    type: String,
    enum: ['Normal', 'Promo'],
    default: 'Normal',
    index: true
  },

  // ⬇️ NUEVO: estado del pedido (para distinguir nuevos vs despachados)
  estado: {
    type: String,
    enum: ['nuevo', 'despachado'],
    default: 'nuevo',
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Pedido', pedidoSchema);



