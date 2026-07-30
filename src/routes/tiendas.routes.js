const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, verifyGerente } = require('../middleware/auth');

// 1. OBTENER TODAS LAS TIENDAS (Protegido por Token, compatible con o sin columna codigo_serie)
router.get('/', verifyToken, async (req, res) => {
    try {
        // Consultamos la tabla verificando dinámicamente o haciendo fallback
        const result = await pool.query(`
            SELECT id, nombre, 
                   COALESCE(direccion, '') as direccion, 
                   COALESCE(telefono, '') as telefono, 
                   COALESCE(url, '') as url
            FROM tiendas 
            ORDER BY id ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Error en GET /api/tiendas:", error.message);
        res.status(500).json({ error: "Error interno en base de datos al consultar tiendas: " + error.message });
    }
});

// 2. CREAR NUEVA TIENDA
router.post('/', verifyGerente, async (req, res) => {
    const { nombre, direccion, telefono, url } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO tiendas (nombre, direccion, telefono, url) VALUES ($1, $2, $3, $4) RETURNING *',
            [nombre, direccion, telefono, url]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error("❌ Error en POST /api/tiendas:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// 3. ACTUALIZAR TIENDA
router.put('/:id', verifyGerente, async (req, res) => {
    const { id } = req.params;
    const { nombre, direccion, telefono, url } = req.body;
    try {
        const result = await pool.query(
            'UPDATE tiendas SET nombre = $1, direccion = $2, telefono = $3, url = $4 WHERE id = $5 RETURNING *',
            [nombre, direccion, telefono, url, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Tienda no encontrada" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("❌ Error en PUT /api/tiendas:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// 4. ELIMINAR TIENDA
router.delete('/:id', verifyGerente, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM tiendas WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Tienda no encontrada" });
        }
        res.json({ mensaje: "Tienda eliminada con éxito" });
    } catch (error) {
        console.error("❌ Error en DELETE /api/tiendas:", error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;