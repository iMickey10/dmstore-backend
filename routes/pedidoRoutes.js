// routes/pedidoRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

const Pedido = require('../models/Pedido');
const Product = require('../models/Product');

// ===== Log de carga (útil en Render) =====
console.log('[pedidoRoutes] Cargado');

// ===== Healthcheck rápido =====
router.get('/health', (req, res) => {
  res.json({ ok: true, scope: 'pedidos' });
});

// ===== Settings model (usa _id + mode) =====
let Setting;
try {
  Setting = require('../models/Setting'); // tu modelo: {_id:String, mode:'normal'|'promo'|'both'}
} catch {
  // Fallback por si no existe el archivo
  const settingSchema = new mongoose.Schema({
    _id: String, // p.ej. "catalog_price_display"
    mode: { type: String, enum: ['normal', 'promo', 'both'], default: 'both' }
  }, { collection: 'settings' });
  Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
}

// ===== Config / Helpers de precios =====
const SETTINGS_ID = 'catalog_price_display'; // <-- Cambia si tu _id en settings es otro

async function getCatalogPriceMode() {
  try {
    // 1) por _id (tu esquema actual)
    let doc = await Setting.findById(SETTINGS_ID).lean();
    if (doc?.mode) {
      console.log('[pedidoRoutes] mode from settings by _id:', doc.mode);
      return doc.mode;
    }

    // 2) compatibilidad si antes usabas {key:'catalog-price'}
    doc = await Setting.findOne({ key: 'catalog-price' }).lean();
    if (doc?.mode) {
      console.log('[pedidoRoutes] mode from settings by key:', doc.mode);
      return doc.mode;
    }

    // 3) ENV
    if (process.env.CATALOG_PRICE_MODE) {
      console.log('[pedidoRoutes] mode from ENV:', process.env.CATALOG_PRICE_MODE);
      return process.env.CATALOG_PRICE_MODE;
    }

    // 4) default
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

// ===== Utilidades varias =====
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

// ================== RUTAS ==================

// Listar pedidos (para listado_pedidos.php)
router.get('/', async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 });
    res.json(pedidos);
  } catch (err) {
    console.error('Error al obtener pedidos:', err);
    res.status(500).json({ error: 'Error al obtener los pedidos' });
  }
});

// Obtener un pedido por ID (Mongo) o por orderNumber (DM-XXXXXX) — para ver_pedido.php
router.get('/:id', async (req, res) => {
  try {
    const idParam = req.params.id;
    let pedido = null;

    if (mongoose.isValidObjectId(idParam)) {
      pedido = await Pedido.findById(idParam);
    } else {
      pedido = await Pedido.findOne({ orderNumber: idParam });
    }

    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    res.json(pedido);
  } catch (err) {
    console.error('Error al obtener pedido por ID/orderNumber:', err);
    res.status(500).json({ error: 'Error al obtener el pedido.' });
  }
});

// Crear pedido
router.post('/', async (req, res) => {
  try {
    const { nombre, celular, correo, direccion, productos, pesoTotal } = req.body;

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: 'No se enviaron productos en el pedido.' });
    }

    // 1) Verificar stock
    for (const p of productos) {
      if (!p.id || typeof p.cantidad !== 'number') {
        return res.status(400).json({ error: 'Formato de producto inválido.' });
      }
      const productoDB = await Product.findById(p.id);
      if (!productoDB) {
        return res.status(404).json({ error: `Producto con ID ${p.id} no encontrado.` });
      }
      if (productoDB.stock < p.cantidad) {
        return res.status(400).json({ error: `No hay suficiente stock para "${productoDB.name}". Solo quedan ${productoDB.stock} unidades.` });
      }
    }

    // 2) Calcular total respetando el modo + tipoPrecio
    const mode = await getCatalogPriceMode();
    let totalServidor = 0;
    let anyPromoUsed = false;

    for (const p of productos) {
      const productoDB = await Product.findById(p.id);
      const unit = pickUnitPrice(productoDB, mode);
      const qty = Number(p.cantidad || 0);
      const lineTotal = unit * qty;

      // marcar si la línea usó promo
      const base = Number(productoDB.price) || 0;
      const disc = Number(productoDB.discountPrice) || 0;
      if ((mode === 'promo' || mode === 'both') && disc > 0 && disc < base && unit === disc) {
        anyPromoUsed = true;
      }

      // normaliza lo que guardas
      p.precioUnitario = unit;
      p.total = lineTotal;

      totalServidor += lineTotal;
    }

    // 3) Crear pedido (id ya generado => podemos crear orderNumber)
    const pedidoDoc = new Pedido({
      nombre,
      celular,
      correo,
      direccion,
      productos,
      pesoTotal,
      total: Number(totalServidor.toFixed(2)),
      priceMode: mode,                          // guardamos modo vigente
      tipoPrecio: anyPromoUsed ? 'Promo' : 'Normal' // para listado
    });

    const orderNumber = buildOrderNumber(pedidoDoc._id);
    pedidoDoc.orderNumber = orderNumber;

    // 4) Guardar
    await pedidoDoc.save();

    // 5) Descontar stock
    for (const p of productos) {
      await Product.findByIdAndUpdate(p.id, { $inc: { stock: -p.cantidad } });
    }

    // 6) Enviar correos
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const tablaHTML = buildProductsTableHTML(productos, pedidoDoc.total, pesoTotal);

    // Admin
    const adminHTML = `
      <div style="font-family:Arial,sans-serif;">
        <h2 style="color:#c08f9b;margin:0 0 8px 0;">Nuevo pedido recibido</h2>
        <p style="margin:4px 0;"><strong>Número de pedido:</strong> ${orderNumber}</p>
        <p style="margin:4px 0;"><strong>Modo:</strong> ${mode} — <strong>Tipo:</strong> ${pedidoDoc.tipoPrecio}</p>
        <p style="margin:4px 0;"><strong>Nombre:</strong> ${nombre}</p>
        <p style="margin:4px 0;"><strong>Celular:</strong> ${celular}</p>
        <p style="margin:4px 0;"><strong>Correo:</strong> ${correo}</p>
        <p style="margin:4px 0;"><strong>Dirección:</strong> ${direccion}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
        ${tablaHTML}
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `Nuevo pedido recibido - ${orderNumber} - DM STORE`,
      html: adminHTML
    });

    // Cliente
    const clienteHTML = `
      <div style="font-family:Arial,sans-serif;">
        <h2 style="color:#c08f9b;margin:0 0 8px 0;">Gracias por tu pedido</h2>
        <p style="margin:4px 0;">¡Hola ${nombre}!, hemos recibido tu pedido correctamente:</p>
        <p style="margin:4px 0;"><strong>Número de pedido:</strong> ${orderNumber}</p>
        <p style="margin:4px 0;"><strong>Celular:</strong> ${celular}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
        ${tablaHTML}
        <p style="margin-top:12px;">En breve nos pondremos en contacto contigo vía WhatsApp para coordinar el método de pago
        y los detalles de envio (ya sea por paquetería o presencial).</p>
      </div>
      <p style="margin-top:12px;"><strong>Gracias por realizar tu pedido con nosotros 💖</strong></p>
    `;

    if (correo) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: correo,
        subject: `Gracias por realizar tu pedido con nosotros 💖 - ${orderNumber} - DM STORE`,
        html: clienteHTML
      });
    }

    // 7) Respuesta
    res.status(200).json({
      message: 'Pedido recibido, correos enviados y stock actualizado',
      orderNumber
    });

  } catch (error) {
    console.error('Error al procesar pedido (POST /api/pedidos):', error);
    res.status(500).json({ error: 'Error al guardar o enviar el pedido' });
  }
});

// Eliminar pedido
router.delete('/:id', async (req, res) => {
  try {
    const pedidoId = req.params.id;
    const eliminado = await Pedido.findByIdAndDelete(pedidoId);
    if (!eliminado) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    res.status(200).json({ message: 'Pedido eliminado correctamente.' });
  } catch (err) {
    console.error('Error al eliminar pedido:', err);
    res.status(500).json({ error: 'Error al eliminar el pedido.' });
  }
});

// PUT actualizar pedido (vuelve a enviar correo de actualización)
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

    // Mapas de cantidades
    const oldMap = new Map(pedidoActual.productos.map(l => [String(l.id), l.cantidad]));
    const newMap = new Map((productosEditados || []).map(l => [String(l.id), Number(l.cantidad) || 0]));

    // Validar stock para incrementos
    const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const productId of allIds) {
      const delta = (newMap.get(productId) || 0) - (oldMap.get(productId) || 0);
      if (delta > 0) {
        const productoDB = await Product.findById(productId).session(session);
        if (!productoDB) {
          await session.abortTransaction();
          return res.status(404).json({ error: `Producto con ID ${productId} no encontrado.` });
        }
        if (productoDB.stock < delta) {
          await session.abortTransaction();
          return res.status(400).json({ error: `Stock insuficiente para "${productoDB.name}". Disponibles: ${productoDB.stock}.` });
        }
      }
    }

    // Ajustes de stock (devoluciones primero)
    for (const productId of allIds) {
      const delta = (newMap.get(productId) || 0) - (oldMap.get(productId) || 0);
      if (delta < 0) {
        await Product.findByIdAndUpdate(productId, { $inc: { stock: Math.abs(delta) } }, { session });
      }
    }
    // Descuentos
    for (const productId of allIds) {
      const delta = (newMap.get(productId) || 0) - (oldMap.get(productId) || 0);
      if (delta > 0) {
        await Product.findByIdAndUpdate(productId, { $inc: { stock: -delta } }, { session });
      }
    }

    // Recalcular líneas y totales (respetando modo)
    const mode = await getCatalogPriceMode();
    const nuevasLineas = [];
    let totalGeneral = 0;
    let pesoTotalKg = 0;
    let anyPromoUsed = false;

    for (const [productId, cantidad] of newMap) {
      if (!cantidad) continue;
      const productoDB = await Product.findById(productId).session(session);
      if (!productoDB) {
        await session.abortTransaction();
        return res.status(404).json({ error: `Producto con ID ${productId} no encontrado.` });
      }

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

    // Actualizar documento
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

    // ===== Enviar correos de actualización =====
    // Volvemos a leer el pedido ya persistido (fuera de la sesión) por seguridad
    const actualizado = await Pedido.findById(pedidoId);
    if (!actualizado) {
      // No debería ocurrir, pero respondemos igual
      return res.json({ message: 'Pedido actualizado (sin correo por verificación fallida)', pedido: pedidoActual });
    }

    // Transporter (Gmail)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    // Reutilizamos tu generador de tabla (ya suma desde filas)
    const tablaHtml = buildProductsTableHTML(
      actualizado.productos,
      actualizado.total,
      actualizado.pesoTotal
    );

    // Email para el cliente
    const htmlCliente = `
      <div style="font-family:Arial, sans-serif;">
        <h2 style="color:#c08f9b;margin-bottom:8px;">Actualización de tu pedido</h2>
        <p style="margin:0 0 8px 0;">Hola <strong>${actualizado.nombre}</strong>, tu pedido <strong>#${actualizado.orderNumber}</strong> fue actualizado.</p>
        ${tablaHtml}
        <p style="margin:0;">Si tienes dudas, responde a este correo.</p>
        <p style="margin:16px 0 0 0;"><strong>DM STORE</strong></p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: actualizado.correo,
      subject: `Actualización de tu pedido #${actualizado.orderNumber} - DM STORE`,
      html: htmlCliente
    });

    // (Opcional) Email para la tienda
    const htmlTienda = `
      <div style="font-family:Arial, sans-serif;">
        <h2 style="color:#c08f9b;margin-bottom:8px;">Pedido actualizado</h2>
        <p style="margin:0 0 8px 0;">Pedido <strong>#${actualizado.orderNumber}</strong> actualizado por el admin.</p>
        <p style="margin:0 0 4px 0;"><strong>Cliente:</strong> ${actualizado.nombre} (${actualizado.correo})</p>
        ${tablaHtml}
        <p style="margin:16px 0 0 0;"><strong>Peso:</strong> ${Number(actualizado.pesoTotal || 0).toFixed(2)} kg</p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `Pedido actualizado #${actualizado.orderNumber} - DM STORE`,
      html: htmlTienda
    });

    // Respuesta final
    res.json({ message: 'Pedido actualizado y correos enviados', pedido: pedidoActual });

  } catch (err) {
    console.error('Error en PUT /api/pedidos/:id', err);
    try { await session.abortTransaction(); } catch {}
    session.endSession();
    res.status(500).json({ error: 'Error al actualizar el pedido' });
  }
});


module.exports = router;

