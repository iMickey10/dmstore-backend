// routes/pedidoRoutes.js
const express = require('express');
const router = express.Router();
const Pedido = require('../models/Pedido');
const Product = require('../models/Product');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');


// Genera número de pedido SIN fecha: DM-XXXXXX
function buildOrderNumber(docId) {
  const suffix = String(docId).slice(-6).toUpperCase(); // últimos 6 del ObjectId
  return `DM-${suffix}`;
}

// Tabla HTML con Total General y peso total
function buildProductsTableHTML(productos, totalGeneral, pesoTotalKg) {
  const rows = productos.map(p => {
    const unit = Number(p.precioUnitario || p.precio || 0);
    const subtotal = Number(p.total || p.subtotal || (unit * Number(p.cantidad || 0)));
    return `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${p.nombre}</td>
        <td style="padding:8px;border:1px solid #ddd; text-align:center;">${p.cantidad}</td>
        <td style="padding:8px;border:1px solid #ddd; text-align:right;">$${unit.toFixed(2)}</td>
        <td style="padding:8px;border:1px solid #ddd; text-align:right;">$${subtotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

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
          <td colspan="3" style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right;">
            Total General
          </td>
          <td style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right;">
            $${Number(totalGeneral || 0).toFixed(2)}
          </td>
        </tr>
      </tfoot>
    </table>
    <p style="font-family:Arial,sans-serif;margin-top:10px;">
      <strong>Peso total del paquete: ${Number(pesoTotalKg || 0).toFixed(2)} kg </strong>
    </p>
  `;
}

router.get('/', async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 });
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los pedidos' });
  }
});


router.post('/', async (req, res) => {
  try {
    const { nombre, celular, correo, direccion, productos, pesoTotal, total } = req.body;

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

    // 2) Calcular total en servidor por seguridad
    let totalServidor = 0;
    for (const p of productos) {
      const productoDB = await Product.findById(p.id);
      const unit = (productoDB.discountPrice && productoDB.discountPrice < productoDB.price)
        ? productoDB.discountPrice
        : productoDB.price;
      totalServidor += unit * p.cantidad;
    }

    // 3) Crear pedido con _id ya generado => podemos crear orderNumber antes de guardar
    const pedidoDoc = new Pedido({
      nombre,
      celular,
      correo,
      direccion,
      productos,       // se guarda lo que llegó del front (id, nombre, cantidad, precioUnitario/total si los mandas)
      pesoTotal,       // en kg
      total: totalServidor, // guardamos el total calculado en backend
    });

    // generar y asignar número de pedido
    const orderNumber = buildOrderNumber(pedidoDoc._id);
    pedidoDoc.orderNumber = orderNumber;

    // 4) Guardar pedido
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

    const tablaHTML = buildProductsTableHTML(productos, totalServidor, pesoTotal);

    // Correo para la tienda (sin agradecimiento)
    const adminHTML = `
      <div style="font-family:Arial,sans-serif;">
        <h2 style="color:#c08f9b;margin:0 0 8px 0;">Nuevo pedido recibido</h2>
        <p style="margin:4px 0;"><strong>Número de pedido:</strong> ${orderNumber}</p>
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

    // Correo para el cliente (con agradecimiento)
    const clienteHTML = `
      <div style="font-family:Arial,sans-serif;">
        <h2 style="color:#c08f9b;margin:0 0 8px 0;">Gracias por tu pedido</h2>
        <p style="margin:4px 0;">¡Hola ${nombre}!, hemos recibido tu pedido correctamente con los siguientes detalles:</p>
        <p style="margin:4px 0;"><strong>Número de pedido:</strong> ${orderNumber}</p>
        <p style="margin:4px 0;"><strong>Celular:</strong> ${celular}</p>
        <p style="margin:4px 0;"><strong>Dirección:</strong> ${direccion}</p>
        <h2 style="color:#c08f9b;margin:0 0 8px 0;">🛒 <strong>Productos solicitados:</h2>
        <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
        ${tablaHTML}
        <p style="margin-top:12px;">En breve nos pondremos en contacto contigo vía WhatsApp para
         coordinar el método de pago y los detalles de envío (ya sea por paquetería o presencial). </p>
      </div>
      <p style="margin-top:12px;"><strong>Gracias por realizar tu pedido con nosotros 💖 </strong></p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: correo,
      subject: `Gracias por realizar tu pedido con nosotros 💖 - ${orderNumber} - DM STORE`,
      html: clienteHTML
    });

    // 7) Responder al frontend
    res.status(200).json({
      message: 'Pedido recibido, correos enviados y stock actualizado',
      orderNumber
    });

  } catch (error) {
    console.error('Error al procesar pedido:', error);
    res.status(500).json({ error: 'Error al guardar o enviar el pedido' });
  }
});

// Al final del archivo pedidoRoutes.js
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

// Obtener un pedido por ID
router.get('/:id', async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    res.json(pedido);
  } catch (err) {
    console.error('Error al obtener pedido por ID:', err);
    res.status(500).json({ error: 'Error al obtener el pedido.' });
  }
});

// PUT /api/pedidos/:id  — Editar pedido, validar y ajustar stock, recalcular totales y peso
router.put('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const pedidoId = req.params.id;
    const { nombre, celular, correo, direccion, productos: productosEditados } = req.body;

    // 1) Traer pedido actual
    const pedidoActual = await Pedido.findById(pedidoId).session(session);
    if (!pedidoActual) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // 2) Mapas para comparar cantidades
    // oldMap: { productId -> qtyAnterior }
    const oldMap = new Map();
    for (const linea of pedidoActual.productos) {
      // Asegúrate que id sea el campo con el _id del producto
      oldMap.set(String(linea.id), linea.cantidad);
    }

    // newMap: { productId -> qtyNueva }
    const newMap = new Map();
    for (const linea of productosEditados || []) {
      if (!linea.id) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Cada producto debe incluir su "id".' });
      }
      const qty = Number(linea.cantidad) || 0;
      if (qty < 0) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'La cantidad no puede ser negativa.' });
      }
      newMap.set(String(linea.id), qty);
    }

    // 3) Construir conjunto de todos los productIds involucrados (agregados, removidos o sin cambios)
    const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);

    // 4) Primero validar stock para todos los incrementos (delta > 0)
    for (const productId of allIds) {
      const qtyOld = oldMap.get(productId) || 0;
      const qtyNew = newMap.get(productId) || 0;
      const delta = qtyNew - qtyOld;

      if (delta > 0) {
        const productoDB = await Product.findById(productId).session(session);
        if (!productoDB) {
          await session.abortTransaction();
          return res.status(404).json({ error: `Producto con ID ${productId} no encontrado.` });
        }
        if (productoDB.stock < delta) {
          await session.abortTransaction();
          return res.status(400).json({
            error: `Stock insuficiente para "${productoDB.name}". Disponibles: ${productoDB.stock}.`
          });
        }
      }
    }

    // 5) Aplicar ajustes de stock (primero devoluciones por reducciones/remociones, luego descuentes por incrementos)
    // (a) devoluciones (delta < 0) → $inc: +abs(delta)
    for (const productId of allIds) {
      const qtyOld = oldMap.get(productId) || 0;
      const qtyNew = newMap.get(productId) || 0;
      const delta = qtyNew - qtyOld;

      if (delta < 0) {
        await Product.findByIdAndUpdate(
          productId,
          { $inc: { stock: Math.abs(delta) } },
          { session }
        );
      }
    }

    // (b) descuentos (delta > 0) → $inc: -delta
    for (const productId of allIds) {
      const qtyOld = oldMap.get(productId) || 0;
      const qtyNew = newMap.get(productId) || 0;
      const delta = qtyNew - qtyOld;

      if (delta > 0) {
        await Product.findByIdAndUpdate(
          productId,
          { $inc: { stock: -delta } },
          { session }
        );
      }
    }

    // 6) Recalcular líneas (precio unitario, total) y totales del pedido
    const nuevasLineas = [];
    let totalGeneral = 0;
    let pesoTotalKg = 0;

    for (const productId of newMap.keys()) {
      const cantidad = newMap.get(productId) || 0;
      if (cantidad === 0) continue; // si quedó en 0, no incluir en el pedido

      const productoDB = await Product.findById(productId).session(session);
      if (!productoDB) {
        await session.abortTransaction();
        return res.status(404).json({ error: `Producto con ID ${productId} no encontrado.` });
      }

      const precioUnitario = (productoDB.discountPrice && productoDB.discountPrice < productoDB.price)
        ? productoDB.discountPrice
        : productoDB.price;

      const totalLinea = precioUnitario * cantidad;

      const weightGr = Number(productoDB.weight_grams) || 0;
      pesoTotalKg += (weightGr / 1000) * cantidad;

      nuevasLineas.push({
        id: String(productoDB._id),
        nombre: productoDB.name,
        cantidad,
        precioUnitario,
        total: totalLinea
      });

      totalGeneral += totalLinea;
    }

    // 7) Actualizar el pedido
    pedidoActual.nombre = nombre ?? pedidoActual.nombre;
    pedidoActual.celular = celular ?? pedidoActual.celular;
    pedidoActual.correo = correo ?? pedidoActual.correo;
    pedidoActual.direccion = direccion ?? pedidoActual.direccion;
    pedidoActual.productos = nuevasLineas;
    pedidoActual.total = Number(totalGeneral.toFixed(2));
    pedidoActual.pesoTotal = Number(pesoTotalKg.toFixed(2));

    await pedidoActual.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: 'Pedido actualizado correctamente',
      pedido: pedidoActual
    });
  } catch (err) {
    console.error('Error en PUT /api/pedidos/:id', err);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: 'Error al actualizar el pedido' });
  }
});



module.exports = router;

