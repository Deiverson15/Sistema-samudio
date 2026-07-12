const pool = require('../config/db');

const getVencimientos = async (req, res) => {
    try {
        const response = await pool.query(`
            SELECT l.codigo_lote, l.fecha_vencimiento, l.cantidad_actual, 
                   p.nombre, p.marca, pr.empresa as proveedor,
                   (l.fecha_vencimiento - CURRENT_DATE) as dias_restantes,
                   CASE 
                       WHEN (l.fecha_vencimiento - CURRENT_DATE) <= 0 THEN 'VENCIDO'
                       WHEN (l.fecha_vencimiento - CURRENT_DATE) <= 30 THEN 'POR_VENCER'
                       ELSE 'OK'
                   END as estado_semaforo
            FROM lotes l
            JOIN productos p ON l.producto_id = p.id
            JOIN proveedores pr ON l.proveedor_id = pr.id
            WHERE l.cantidad_actual > 0
            ORDER BY l.fecha_vencimiento ASC
            LIMIT 100
        `);
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


const getLogs = async (req, res) => {
    try {
        const { tipo } = req.query; 
        let query = `
            SELECT a.*, u.nombre as usuario_nombre 
            FROM auditoria a
            LEFT JOIN usuarios u ON a.usuario_id = u.id
        `;
        if (tipo === 'seguridad') {
            query += ` WHERE a.accion LIKE 'SEGURIDAD_%' `;
        }

        query += ` ORDER BY a.fecha DESC LIMIT 100`;

        const response = await pool.query(query);
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getVencimientos, getLogs };