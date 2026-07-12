const pool = require('../config/db');

// Obtener todas las tiendas
const getTiendas = async (req, res) => {
    try {
        const response = await pool.query('SELECT * FROM tiendas ORDER BY id ASC');
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Crear nueva tienda
const crearTienda = async (req, res) => {
    // AGREGADO: Extraer el campo url
    const { nombre, direccion, telefono, es_principal, url } = req.body;

    try {
        if (es_principal) {
            await pool.query('UPDATE tiendas SET es_principal = false');
        }

        const response = await pool.query(
            `INSERT INTO tiendas (nombre, direccion, telefono, es_principal, url) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [nombre, direccion, telefono, es_principal || false, url]
        );

        res.json({ mensaje: 'Tienda creada exitosamente', tienda: response.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe una tienda con ese nombre.' });
        }
        res.status(500).json({ error: error.message });
    }
};

const actualizarTienda = async (req, res) => {
    const { id } = req.params;
    // AGREGADO: Extraer el campo url
    const { nombre, direccion, telefono, es_principal, activo, url } = req.body;

    try {
        if (es_principal) {
            await pool.query('UPDATE tiendas SET es_principal = false');
        }

        await pool.query(
            `UPDATE tiendas SET nombre = $1, direccion = $2, telefono = $3, es_principal = $4, activo = $5, url = $6 
             WHERE id = $7`,
            [nombre, direccion, telefono, es_principal, activo, url, id]
        );

        res.json({ mensaje: 'Tienda actualizada correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


module.exports = { getTiendas, crearTienda, actualizarTienda };