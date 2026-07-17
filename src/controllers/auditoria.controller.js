const pool = require('../config/db');

const getVencimientos = async (req, res) => {
    try {
        // 1. Identificación dinámica de la sucursal activa
        let idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = ['developer', 'dev', 'admin', 'administrador', 'superadmin', 'gerente general'].includes(rolUsuario);

        // RADAR DE SÚPER_USUARIO: Permite al Dev filtrar cualquier tienda desde el frontend
        if (esUsuarioMaestro && req.query.tienda_id) {
            idTiendaLocal = parseInt(req.query.tienda_id, 10);
        }

        // 2. Ejecución del semáforo unificado (Sincronizado a los 90 días del Frontend)
        const response = await pool.query(`
            SELECT l.codigo_lote, l.fecha_vencimiento, l.cantidad_actual,
                    p.nombre, p.marca, pr.empresa as proveedor,
                   (l.fecha_vencimiento - CURRENT_DATE) as dias_restantes,
                   CASE 
                        WHEN (l.fecha_vencimiento - CURRENT_DATE) <= 0 THEN 'VENCIDO'
                        WHEN (l.fecha_vencimiento - CURRENT_DATE) <= 30 THEN 'POR_VENCER'
                        WHEN (l.fecha_vencimiento - CURRENT_DATE) <= 90 THEN 'ATENCION'
                        ELSE 'OK'
                   END as estado_semaforo
            FROM lotes l
            JOIN productos p ON l.producto_id = p.id
            LEFT JOIN proveedores pr ON l.proveedor_id = pr.id
            WHERE l.cantidad_actual > 0 AND l.tienda_id = $1
            ORDER BY l.fecha_vencimiento ASC
            LIMIT 100
        `, [idTiendaLocal]);
        
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getLogs = async (req, res) => {
    try {
        const { tipo, tienda_id, search } = req.query;
        
        // 1. Identificación base de tienda
        let idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = ['developer', 'dev', 'admin', 'administrador', 'superadmin', 'gerente general'].includes(rolUsuario);

        // Si es administrador maestro, lee la tienda que seleccionó en pantalla
        if (esUsuarioMaestro && tienda_id) {
            idTiendaLocal = parseInt(tienda_id, 10);
        }
        
        let query = `
            SELECT a.*, u.nombre as usuario_nombre 
            FROM auditoria a
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            WHERE 1=1
        `;
        
        let params = [];
        let paramIndex = 1;

        // 🔥 CORRECCIÓN DEL FALLO DE AISLAMIENTO:
        // Filtramos buscando de forma híbrida: si el log tiene tienda asignada o a través de la tienda del usuario
        query += ` AND (a.detalle LIKE 'Tienda ${idTiendaLocal}%' OR u.tienda_id = $${paramIndex} OR (a.usuario_id IS NULL AND $${paramIndex} = 1))`;
        params.push(idTiendaLocal);
        paramIndex++;

        // Filtro por tipo o acciones críticas
        if (tipo === 'seguridad') {
            query += ` AND (a.accion LIKE 'SEGURIDAD_%' OR a.accion = 'BORRADO_TOTAL') `;
        }

        // Filtro buscador superior avanzado
        if (search) {
            query += ` AND (a.accion ILIKE $${paramIndex} OR a.detalle ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        query += ` ORDER BY a.fecha DESC LIMIT 100`;
        const response = await pool.query(query, params);
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getVencimientos, getLogs };