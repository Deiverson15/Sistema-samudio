const pool = require('../config/db');

// Obtener todos
const getProveedores = async (req, res) => {
    try {
        const response = await pool.query('SELECT * FROM proveedores ORDER BY id DESC');
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createProveedor = async (req, res) => {
    // Añadimos 'documento' que es requerido por la DB
    const { documento, empresa, contacto, telefono, email, direccion } = req.body;
    try {
        const query = `
            INSERT INTO proveedores (documento, empresa, contacto, telefono, email, direccion)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
        const response = await pool.query(query, [documento, empresa, contacto, telefono, email, direccion]);
        
        await pool.query("INSERT INTO auditoria (accion, detalle) VALUES ('CREAR_PROVEEDOR', $1)", [`Se registró: ${empresa}`]);

        res.json(response.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Eliminar
const deleteProveedor = async (req, res) => {
    try {
        await pool.query('DELETE FROM proveedores WHERE id = $1', [req.params.id]);
        res.json({ mensaje: 'Proveedor eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'No se puede eliminar si tiene lotes asociados' });
    }
};

module.exports = { getProveedores, createProveedor, deleteProveedor };