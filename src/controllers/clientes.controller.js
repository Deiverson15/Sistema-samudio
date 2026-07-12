const pool = require('../config/db');

// Buscar clientes (por nombre o documento)
const buscarClientes = async (req, res) => {
    const { q } = req.query; // q = término de búsqueda
    try {
        const query = `
            SELECT * FROM clientes 
            WHERE documento ILIKE $1 OR nombre ILIKE $1 
            ORDER BY nombre ASC LIMIT 10`;
        const response = await pool.query(query, [`%${q}%`]);
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Crear cliente rápido
const crearCliente = async (req, res) => {
    const { documento, nombre, direccion, telefono, email } = req.body;
    try {
        const query = `
            INSERT INTO clientes (documento, nombre, direccion, telefono, email) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *`;
        const response = await pool.query(query, [documento, nombre, direccion, telefono, email]);
        res.json(response.rows[0]);
    } catch (error) {
        if(error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe un cliente con ese documento.' });
        }
        res.status(500).json({ error: error.message });
    }
};

module.exports = { buscarClientes, crearCliente };