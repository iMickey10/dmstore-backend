// routes/pedidoRoutes.js
const express = require('express');
const router = express.Router();
const Pedido = require('../models/Pedido');
const Product = require('../models/Product');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

console.log('[pedidoRoutes] cargado');

// ===== Settings model =====
let Setting;
try {
  Setting = require('../models/Setting');
} catch {
  const settingSchema = new mongoose.Schema({
    _id: String, // por ejemplo: "catalog_price_display"
    mode: { type: String, enum: ['normal', 'promo', 'both'], default: 'normal' }
  }, { collection: 'settings' });
  Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
}

// ID del documento de configuración
const SETTINGS_ID = 'catalog_price_display';

// ===== Helpers =====
async function getCatalogPriceMode() {
  try {
    const doc = await Setting.findById(SETTINGS_ID).lean();
    if (doc?.mode) {
      console.log('[pedidoRoutes] mode from settings by _id:', doc.mode);
      return doc.mode;
    }
    if (process.env.CATALOG_PRICE_MODE) {
      console.log('[pedidoRoutes] mode from ENV:', process.env.CATALOG_PRICE_MODE);
      return process.env.CATALOG_PRICE_MODE;
    }
    console.log('[pedidoRoutes] mode default: normal');
    return 'normal';
  } catch (e) {
    console.warn('[pedidoRoutes] getCatalogPriceMode error:', e);
    return process.env.CATALOG_PRICE_MODE || 'normal';
  }
}

function pickUnitPrice(productDoc, mode = 'normal') {
  const price = Number(productDoc?.price) || 0;
  const discount = Number(productDoc?.discountPrice) || 0;
  if (mode === 'normal') return price;
  if ((mode === 'promo' || mode === 'both') && discount > 0 && discount < price) return discount;
  return price;
}

function buildOrderNumber(docId) {
  const suffix = String(docId).slice(-6).toUpperCase();
  return `DM-${suffix}`;
}

function buildProductsTableHTML(productos, _totalGeneralNoUsado, pesoTotalKg) {
  const filas = (productos || []).map(p => {
    const unit = Number(p.precioUnitario ?? p.precio ?? 0);
    const qty  = Number(p.cantidad ?? 0);
    const subtotal = Number(p.total ?? p.subtotal ?? (unit * qty));
    return { nombre: p.nombre, cantidad: qty, unit, subtotal };
  });
  const sumSubtotales = filas.reduce((acc, f) => acc + (Number.isFinite(f.subtotal) ? f.subtotal : 0), 0);
  const rows = filas.map(f => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${f.nombre}</td>
      <td style="padding:8px;border:1px solid #ddd; text-align:center;">${f.cantidad}</td>
      <td style="padding:8px;border:1px solid #ddd; text-align:right;">$${Number(f.unit).toFixed(2)}</td>
      <td style="padding:8px;border:1px solid #ddd; text-align:right;">$${Number(f.subtotal).toFixed(2)}</td>
    </tr>
  `).join('');
  return `
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Producto</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:center;">Cantidad</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:right;">Precio Unitario</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right;">Total General</td>
          <td style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right;">$${Number(sumSubtotales).toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    <p style="font-family:Arial,sans-serif;margin-top:10px;">
      <strong>Peso total del paquete: ${Number(pesoTotalKg || 0).toFixed(2)} kg</strong>
    </p>
  `;
}

// ===== Rutas =====

// GET por id u orderNumber
router.get('/:id', async (req, res) => {
  try {
    const idParam = req.params.id;
    let pedido = null;
    if (mongoose.isValidObjectId(idParam)) {
      pedido = await Pedido.findById(idParam);
    } else {
      pedido = await Pedido.findOne({ orderNumber: idParam });
    }
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json(pedido);
  } catch (err) {
    console.error('Error al obtener pedido:', err);
    res.status(500).json({ error: 'Error al obtener el pedido.' });
  }
});

// POST crear pedido
router.post('/', async (req, res) => {
  try {
    const { nombre, celular, correo, direccion, productos, pesoTotal } = req.body;
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: 'No se enviaron productos en el pedido.' });
    }

    // stock check
    for (const p of productos) {
      const productoDB = await Product.findById(p.id);
      if (!productoDB) return res.status(404).json({ error: `Producto con ID ${p.id} no encontrado.` });
      if (productoDB.stock < p.cantidad) {
        return res.status(400).json({ error: `No hay suficiente stock para "${productoDB.name}".` });
      }
    }

    const mode = await getCatalogPriceMode();
    let totalServidor = 0;
    let anyPromoUsed = false;

    for (const p of productos) {
      const productoDB = await Product.findById(p.id);
      const unit = pickUnitPrice(productoDB, mode);
      const qty = Number(p.cantidad || 0);
      const lineTotal = unit * qty;

      const base = Number(productoDB.price) || 0;
      const disc = Number(productoDB.discountPrice) || 0;
      if ((mode === 'promo' || mode === 'both') && disc > 0 && disc < base && unit === disc) {
        anyPromoUsed = true;
      }

      p.precioUnitario = unit;
      p.total = lineTotal;
      totalServidor += lineTotal;
    }

    const pedidoDoc = new Pedido({
      nombre,
      celular,
      correo,
      direccion,
      productos,
      pesoTotal,
      total: Number(totalServidor.toFixed(2)),
      priceMode: mode,
      tipoPrecio: anyPromoUsed ? 'Promo' : 'Normal'
    });

    const orderNumber = buildOrderNumber(pedidoDoc._id);
    pedidoDoc.orderNumber = orderNumber;
    await pedidoDoc.save();

    for (const p of productos) {
      await Product.findByIdAndUpdate(p.id, { $inc: { stock: -p.cantidad } });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const tablaHTML = buildProductsTableHTML(productos, totalServidor, pesoTotal);

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `Nuevo pedido recibido - ${orderNumber} - DM STORE`,
      html: tablaHTML
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: correo,
      subject: `Gracias por tu pedido 💖 - ${orderNumber} - DM STORE`,
      html: tablaHTML
    });

    res.status(200).json({ message: 'Pedido creado', orderNumber });
  } catch (error) {
    console.error('Error al procesar pedido:', error);
    res.status(500).json({ error: 'Error al guardar o enviar el pedido' });
  }
});

// PUT actualizar pedido
router.put('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const pedidoId = req.params.id;
    const { nombre, celular, correo, direccion, productos: productosEditados } = req.body;

    const pedidoActual = await Pedido.findById(pedidoId).session(session);
    if (!pedidoActual) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const oldMap = new Map(pedidoActual.productos.map(l => [String(l.id), l.cantidad]));
    const newMap = new Map(productosEditados.map(l => [String(l.id), Number(l.cantidad) || 0]));

    const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const productId of allIds) {
      const delta = (newMap.get(productId) || 0) - (oldMap.get(productId) || 0);
      if (delta > 0) {
        const productoDB = await Product.findById(productId).session(session);
        if (!productoDB || productoDB.stock < delta) {
          await session.abortTransaction();
          return res.status(400).json({ error: 'Stock insuficiente' });
        }
      }
    }

    for (const productId of allIds) {
      const delta = (newMap.get(productId) || 0) - (oldMap.get(productId) || 0);
      if (delta !== 0) {
        await Product.findByIdAndUpdate(productId, { $inc: { stock: -delta } }, { session });
      }
    }

    const mode = await getCatalogPriceMode();
    const nuevasLineas = [];
    let totalGeneral = 0;
    let pesoTotalKg = 0;
    let anyPromoUsed = false;

    for (const [productId, cantidad] of newMap) {
      if (cantidad === 0) continue;
      const productoDB = await Product.findById(productId).session(session);
      const unit = pickUnitPrice(productoDB, mode);
      const lineTotal = unit * cantidad;

      const base = Number(productoDB.price) || 0;
      const disc = Number(productoDB.discountPrice) || 0;
      if ((mode === 'promo' || mode === 'both') && disc > 0 && disc < base && unit === disc) {
        anyPromoUsed = true;
      }

      pesoTotalKg += ((Number(productoDB.weight_grams) || 0) / 1000) * cantidad;

      nuevasLineas.push({
        id: String(productoDB._id),
        nombre: productoDB.name,
        cantidad,
        precioUnitario: unit,
        total: lineTotal
      });

      totalGeneral += lineTotal;
    }

    pedidoActual.nombre = nombre ?? pedidoActual.nombre;
    pedidoActual.celular = celular ?? pedidoActual.celular;
    pedidoActual.correo = correo ?? pedidoActual.correo;
    pedidoActual.direccion = direccion ?? pedidoActual.direccion;
    pedidoActual.productos = nuevasLineas;
    pedidoActual.total = Number(totalGeneral.toFixed(2));
    pedidoActual.pesoTotal = Number(pesoTotalKg.toFixed(2));
    pedidoActual.priceMode = mode;
    pedidoActual.tipoPrecio = anyPromoUsed ? 'Promo' : 'Normal';

    await pedidoActual.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Pedido actualizado', pedido: pedidoActual });
  } catch (err) {
    console.error('Error en PUT /api/pedidos/:id', err);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: 'Error al actualizar el pedido' });
  }
});

module.exports = router;


