const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

// Obtener todos los productos (con búsqueda y filtros)
router.get('/', async (req, res) => {
  try {
    const { q, category, brand } = req.query;
    let filter = {};

    if (q) {
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { name: regex },
        { description: regex }
      ];
    }

    if (category) {
      filter.category = category;
    }

    if (brand) {
      filter.brand = brand;
    }

    const products = await Product.find(filter);
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// Obtener un producto por ID
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// Crear un nuevo producto
router.post('/', async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(400).json({ error: 'Error al crear producto' });
  }
});

// Actualizar un producto existente
router.put('/:id', async (req, res) => {
  try {
    const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: 'Error al actualizar producto' });
  }
});

// Eliminar un producto
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto eliminado correctamente' });
  } catch (error) {
    res.status(400).json({ error: 'Error al eliminar producto' });
  }
});

module.exports = router;
