const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors'); // <--- AÑADIDO

const productRoutes = require('./routes/productRoutes');
const settingsRoutes = require('./routes/settingsRoutes');  // <--- agregar esta línea
const pedidoRoutes = require('./routes/pedidoRoutes');


dotenv.config();

const app = express();
app.use(cors()); // <--- AÑADIDO
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado"))
  .catch(err => console.log("Error en conexión:", err));

app.use('/api/products', productRoutes); // Ruta activa
app.use('/api/settings', settingsRoutes);                  // ✅ NUEVA LÍNEA
app.use('/api/pedidos', pedidoRoutes);


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
