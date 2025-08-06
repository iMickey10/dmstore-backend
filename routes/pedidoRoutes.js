const express = require('express');
const router = express.Router();
const Pedido = require('../models/Pedido');
const nodemailer = require('nodemailer');

// Ruta para recibir el pedido
router.post('/', async (req, res) => {
  try {
    const { nombre, celular, correo, direccion, productos, pesoTotal } = req.body;

    const nuevoPedido = new Pedido({
      nombre,
      celular,
      correo,
      direccion,
      productos,
      pesoTotal
    });

    await nuevoPedido.save();

    // Configura el transporte de correo
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const resumenProductos = productos.map(p => `
      - ${p.nombre} | Cantidad: ${p.cantidad} | Precio Unitario: $${p.precioUnitario.toFixed(2)} | Total: $${p.total.toFixed(2)}
    `).join('\n');

    const mensaje = `
      🧾 Nuevo pedido recibido:

      👤 Nombre: ${nombre}
      📱 Celular: ${celular}
      📧 Correo: ${correo}
      🏠 Dirección: ${direccion}

      📦 Productos:
      ${resumenProductos}

      ⚖️ Peso total del paquete: ${pesoTotal.toFixed(2)} kg
    `;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: `${process.env.EMAIL_USER}, ${correo}`,
      subject: 'Nuevo pedido recibido - DM STORE',
      text: mensaje
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: 'Pedido recibido y correo enviado' });
  } catch (error) {
    console.error('Error al procesar pedido:', error);
    res.status(500).json({ error: 'Error al guardar o enviar el pedido' });
  }
});

module.exports = router;

