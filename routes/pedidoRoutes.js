const express = require('express');
const router = express.Router();
const Pedido = require('../models/Pedido');
const Product = require('../models/Product');
const nodemailer = require('nodemailer');

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

    // Crear nuevo pedido
    const nuevoPedido = new Pedido({
      nombre,
      celular,
      correo,
      direccion,
      productos,
      pesoTotal
    });

    await nuevoPedido.save();

    // Descontar stock de cada producto
    for (const p of productos) {
      await Product.findByIdAndUpdate(p.id, {
        $inc: { stock: -p.cantidad }
      });
    }

    // Calcular total general
    const totalGeneral = productos.reduce((acc, p) => acc + p.total, 0);

    // Construir la tabla HTML
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

    const mensajeHTML = `
      <h2>📦 Nuevo pedido recibido</h2>
      <p><strong>Nombre:</strong> ${nombre}</p>
      <p><strong>Celular:</strong> ${celular}</p>
      <p><strong>Correo:</strong> ${correo}</p>
      <p><strong>Dirección:</strong> ${direccion}</p>

      <h3>🛒 Productos:</h3>
      ${tablaHTML}

      <p><strong>⚖️ Peso total del paquete:</strong> ${pesoTotal.toFixed(2)} kg</p>
    `;

    const mensajeClienteHTML = `
      <h2>Gracias por tu pedido - DM STORE 💖</h2>
      <p>Hola ${nombre}, hemos recibido tu pedido con los siguientes detalles:</p>
      <p><strong>Dirección:</strong> ${direccion}</p>
      <p><strong>Celular:</strong> ${celular}</p>

      <h3>🛍️ Productos solicitados:</h3>
      ${tablaHTML}

      <p><strong>⚖️ Peso total del paquete:</strong> ${pesoTotal.toFixed(2)} kg</p>

      <p>En breve nos pondremos en contacto contigo vía WhatsApp para coordinar los detalles de envío (ya sea presencial o por paquetería) y coordinar el método de pago.</p>
      <p style="margin-top:20px;">Gracias por comprar con nosotros. 💕</p>
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
      subject: 'Nuevo pedido recibido - DM STORE',
      html: mensajeHTML
    });

    // Enviar copia al cliente
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: correo,
      subject: 'Gracias por tu pedido - DM STORE',
      html: mensajeClienteHTML
    });

    res.status(200).json({ message: 'Pedido recibido, correos enviados y stock actualizado' });

  } catch (error) {
    console.error('Error al procesar pedido:', error);
    res.status(500).json({ error: 'Error al guardar o enviar el pedido' });
  }
});

module.exports = router;
