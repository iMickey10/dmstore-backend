const express = require('express');
const router = express.Router();
const Pedido = require('../models/Pedido');
const Product = require('../models/Product');
const nodemailer = require('nodemailer');

// Utilidad para armar el número de pedido
function buildOrderNumber(docId) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const suffix = String(docId).slice(-6).toUpperCase();
  return `DM-${y}${m}${day}-${suffix}`;
}

// Ruta para recibir el pedido
router.post('/', async (req, res) => {
  try {
    const { nombre, celular, correo, direccion, productos, pesoTotal } = req.body;

    // Verificar stock disponible antes de continuar
    for (const p of productos) {
      const productoDB = await Product.findById(p.id);
      if (!productoDB) {
        return res.status(404).json({ error: `Producto con ID ${p.id} no encontrado.` });
      }
      if (productoDB.stock < p.cantidad) {
        return res.status(400).json({ error: `No hay suficiente stock para "${productoDB.name}". Solo quedan ${productoDB.stock} unidades.` });
      }
    }

    // Crear el pedido (sin orderNumber aún)
    const nuevoPedido = new Pedido({
      nombre,
      celular,
      correo,
      direccion,
      productos,
      pesoTotal
    });

    // Generar y asignar número de pedido basado en el _id
    nuevoPedido.orderNumber = buildOrderNumber(nuevoPedido._id);

    // Guardar
    await nuevoPedido.save();

    // Descontar stock de cada producto
    for (const p of productos) {
      await Product.findByIdAndUpdate(p.id, {
        $inc: { stock: -p.cantidad }
      });
    }

    // Calcular total general
    const totalGeneral = productos.reduce((acc, p) => acc + p.total, 0);

    // Construir la tabla HTML con total general
    const tablaHTML = `
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: sans-serif;">
        <thead style="background-color: #f2f2f2;">
          <tr>
            <th>Producto</th>
            <th>Cantidad</th>
            <th>Precio Unitario</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${productos.map(p => `
            <tr>
              <td>${p.nombre}</td>
              <td>${p.cantidad}</td>
              <td>$${p.precioUnitario.toFixed(2)}</td>
              <td>$${p.total.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3"><strong>Total general</strong></td>
            <td><strong>$${totalGeneral.toFixed(2)}</strong></td>
          </tr>
        </tfoot>
      </table>
    `;

    // HTML para la tienda (sin mensaje de agradecimiento)
    const mensajeHTMLAdmin = `
      <h2>📦 Nuevo pedido recibido</h2>
      <p><strong>Número de pedido:</strong> ${nuevoPedido.orderNumber}</p>
      <p><strong>Nombre:</strong> ${nombre}</p>
      <p><strong>Celular:</strong> ${celular}</p>
      <p><strong>Correo:</strong> ${correo}</p>
      <p><strong>Dirección:</strong> ${direccion}</p>

      <h3>🛒 Productos:</h3>
      ${tablaHTML}

      <p><strong>⚖️ Peso total del paquete:</strong> ${Number(pesoTotal).toFixed(2)} kg</p>
      <p><small>Fecha: ${new Date(nuevoPedido.createdAt).toLocaleString()}</small></p>
    `;

    // HTML para el cliente (con agradecimiento)
    const mensajeClienteHTML = `
      <h2>Gracias por tu pedido - DM STORE 💖</h2>
      <p><strong>Número de pedido:</strong> ${nuevoPedido.orderNumber}</p>
      <p>Hola ${nombre}, hemos recibido tu pedido con los siguientes detalles:</p>
      <p><strong>Dirección:</strong> ${direccion}</p>
      <p><strong>Celular:</strong> ${celular}</p>

      <h3>🛍️ Productos solicitados:</h3>
      ${tablaHTML}

      <p><strong>⚖️ Peso total del paquete:</strong> ${Number(pesoTotal).toFixed(2)} kg</p>
      <p>En breve nos pondremos en contacto contigo vía WhatsApp o correo para coordinar el envío.</p>
      <p style="margin-top:20px;">Gracias por comprar con nosotros. 💕</p>
      <p><small>Fecha: ${new Date(nuevoPedido.createdAt).toLocaleString()}</small></p>
    `;

    // Configurar transporte
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Enviar a admin
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `Nuevo pedido ${nuevoPedido.orderNumber} - DM STORE`,
      html: mensajeHTMLAdmin
    });

    // Enviar al cliente
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: correo,
      subject: `Gracias por tu pedido ${nuevoPedido.orderNumber} - DM STORE`,
      html: mensajeClienteHTML
    });

    res.status(200).json({
      message: 'Pedido recibido, correos enviados y stock actualizado',
      orderNumber: nuevoPedido.orderNumber
    });

  } catch (error) {
    console.error('Error al procesar pedido:', error);
    res.status(500).json({ error: 'Error al guardar o enviar el pedido' });
  }
});

module.exports = router;
