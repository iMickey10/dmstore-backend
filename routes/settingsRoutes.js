const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');

// Obtener el modo actual de visualización de precios
router.get('/catalog-price', async (req, res) => {
  try {
    const setting = await Setting.findById('catalog_price_display');
    res.json(setting || { mode: 'both' });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// Actualizar el modo de visualización de precios
router.put('/catalog-price', async (req, res) => {
  try {
    const updated = await Setting.findByIdAndUpdate(
      'catalog_price_display',
      { mode: req.body.mode },
      { new: true, upsert: true } // crea si no existe
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

module.exports = router;
