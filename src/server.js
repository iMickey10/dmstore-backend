const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const productRoutes = require('./routes/productRoutes');
const settingsRoutes = require('./routes/settingsRoutes');


dotenv.config();

const app = express();
app.use(express.json());

const cors = require('cors');
app.use(cors());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado"))
  .catch(err => console.log("Error en conexión:", err));

app.use('/api/products', productRoutes);

app.use('/api/settings', settingsRoutes);


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});