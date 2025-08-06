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

    // Configurar transporte de correo
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Construir resumen de productos
    const resumenProductos = productos.map(p => `
- ${p.nombre}
  Cantidad: ${p.cantidad}
  Precio Unitario: $${p.precioUnitario.toFixed(2)}
  Total: $${p.total.toFixed(2)}
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

    res.status(200).json({ message: 'Pedido recibido, correo enviado y stock actualizado' });

  } catch (error) {
    console.error('Error al procesar pedido:', error);
    res.status(500).json({ error: 'Error al guardar o enviar el pedido' });
  }
});

module.exports = router;