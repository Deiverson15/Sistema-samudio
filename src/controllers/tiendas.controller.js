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
    // 🔥 ADICIÓN: Capturamos 'codigo_serie' desde el cuerpo de la petición
    const { nombre, direccion, telefono, es_principal, url, codigo_serie } = req.body;

    if (!nombre || !codigo_serie) {
        return res.status(400).json({ error: 'El identificador y el código de serie son obligatorios.' });
    }

    try {
        if (es_principal) {
            await pool.query('UPDATE tiendas SET es_principal = false');
        }

        // Inyección limpia en la tabla de PostgreSQL incluyendo el código de serie forzado a mayúsculas
        const response = await pool.query(
            `INSERT INTO tiendas (nombre, direccion, telefono, es_principal, url, codigo_serie) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombre, direccion, telefono, es_principal || false, url, codigo_serie.toUpperCase().trim()]
        );

        res.json({ mensaje: 'Sucursal registrada exitosamente en el núcleo central.', tienda: response.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe una sucursal registrada con ese nombre o código de serie.' });
        }
        res.status(500).json({ error: error.message });
    }
};

const crearTienda = async (req, res) => {
    // 🔥 ADICIÓN: Capturamos 'codigo_serie' desde el cuerpo de la petición
    const { nombre, direccion, telefono, es_principal, url, codigo_serie } = req.body;

    if (!nombre || !codigo_serie) {
        return res.status(400).json({ error: 'El identificador y el código de serie son obligatorios.' });
    }

    try {
        if (es_principal) {
            await pool.query('UPDATE tiendas SET es_principal = false');
        }

        // Inyección limpia en la tabla de PostgreSQL incluyendo el código de serie forzado a mayúsculas
        const response = await pool.query(
            `INSERT INTO tiendas (nombre, direccion, telefono, es_principal, url, codigo_serie) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombre, direccion, telefono, es_principal || false, url, codigo_serie.toUpperCase().trim()]
        );

        res.json({ mensaje: 'Sucursal registrada exitosamente en el núcleo central.', tienda: response.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe una sucursal registrada con ese nombre o código de serie.' });
        }
        res.status(500).json({ error: error.message });
    }
};


module.exports = { getTiendas, crearTienda, actualizarTienda };