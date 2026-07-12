const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 1. OBTENER TODAS LAS TIENDAS (Incluyendo la URL)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre, direccion, telefono, url FROM tiendas ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. CREAR NUEVA TIENDA (Guardando la URL)
router.post('/', async (req, res) => {
    const { nombre, direccion, telefono, url } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO tiendas (nombre, direccion, telefono, url) VALUES ($1, $2, $3, $4) RETURNING *',
            [nombre, direccion, telefono, url]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. ACTUALIZAR TIENDA (Actualizando la URL)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, direccion, telefono, url } = req.body;
    try {
        const result = await pool.query(
            'UPDATE tiendas SET nombre = $1, direccion = $2, telefono = $3, url = $4 WHERE id = $5 RETURNING *',
            [nombre, direccion, telefono, url, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Tienda no encontrada" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. ELIMINAR TIENDA
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM tiendas WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Tienda no encontrada" });
        }
        res.json({ message: "Tienda eliminada con éxito" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;