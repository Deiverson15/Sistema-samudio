const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken } = require('../middleware/auth');

const { anularVentaDefinitiva, getVentasAnuladas, restaurarVentaAnulada } = require('../controllers/ventas.controller');

// Middleware exclusivo para asegurar que SOLAMENTE el developer pase
const verifyDeveloper = (req, res, next) => {
    if (req.user && req.user.rol === 'developer') {
        next();
    } else {
        res.status(403).json({ error: 'Acceso denegado. Solo Nivel Dios.' });
    }
};

// GET: Leer el estado actual del sistema
router.get('/estado', verifyToken, verifyDeveloper, async (req, res) => {
    try {
        const result = await pool.query("SELECT valor FROM configuracion WHERE clave = 'sistema_activo'");
        const activo = result.rows.length > 0 ? result.rows[0].valor : true;
        res.json({ activo });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/estado', verifyToken, verifyDeveloper, async (req, res) => {
    const { activo } = req.body;
    try {
        await pool.query(
            "UPDATE configuracion SET valor = $1 WHERE clave = 'sistema_activo'",
            [activo]
        );
        
        // ============================================
        // NUEVO: Emitir evento Socket.io a todos los clientes
        // ============================================
        const io = req.app.get('io');
        io.emit('cambio_estado_sistema', { activo });

        res.json({ message: 'Estado del sistema actualizado', activo });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================================
// SUPER CRUD: GESTOR DINÁMICO DE BASE DE DATOS
// ========================================================

// Lista Blanca (Whitelist) de tablas seguras para consultar/editar
const tablasPermitidas = [
    'ventas',
    'productos',
    'lotes',
    'cierres_caja',
    'usuarios',
    'clientes'
];

// GET: Obtener todos los registros de una tabla específica
router.get('/db/:tabla', verifyToken, verifyDeveloper, async (req, res) => {
    const tablaSolicitada = req.params.tabla;

    // 1. Validar la tabla solicitada contra la Lista Blanca
    if (!tablasPermitidas.includes(tablaSolicitada)) {
        return res.status(403).json({ 
            error: `Acceso denegado. La tabla '${tablaSolicitada}' no está permitida para gestión dinámica.` 
        });
    }

    try {
        // 2. Consulta SQL. 
        // Es seguro usar ${tablaSolicitada} aquí porque ya garantizamos que es un valor de nuestro propio array.
        const query = `SELECT * FROM ${tablaSolicitada} ORDER BY id DESC LIMIT 150`; 
        const result = await pool.query(query);
        
        res.json(result.rows);
    } catch (error) {
        console.error(`Error al consultar la tabla ${tablaSolicitada}:`, error);
        res.status(500).json({ error: 'Error interno del servidor al consultar la tabla.' });
    }
});

// PUT: Actualizar dinámicamente un registro (Super CRUD)
router.put('/db/:tabla/:id', verifyToken, verifyDeveloper, async (req, res) => {
    const { tabla, id } = req.params;
    const datosModificados = req.body;

    // 1. Validar la Lista Blanca
    if (!tablasPermitidas.includes(tabla)) {
        return res.status(403).json({ error: 'Tabla no permitida.' });
    }

    try {
        // 2. Extraer dinámicamente las claves y valores
        const keys = Object.keys(datosModificados);
        
        // ¡LA SOLUCIÓN AQUÍ!: Convertimos los strings vacíos ('') a null
        const values = Object.values(datosModificados).map(val => val === '' ? null : val);

        if (keys.length === 0) return res.status(400).json({ error: 'No hay datos para actualizar.' });

        // 3. Construir el comando SET dinámico (Ej: "col1" = $1, "col2" = $2)
        const setClause = keys.map((key, index) => `"${key}" = $${index + 1}`).join(', ');
        
        // 4. Armar la consulta final
        const query = `UPDATE ${tabla} SET ${setClause} WHERE id = $${keys.length + 1}`;
        
        // 5. Ejecutar pasando todos los valores (ahora con nulls) + el ID al final
        await pool.query(query, [...values, id]);
        
        res.json({ message: 'Registro actualizado correctamente en el núcleo.' });
    } catch (error) {
        console.error(`[DEV] Error al actualizar ${tabla}:`, error);
        res.status(500).json({ error: 'Error al ejecutar UPDATE en base de datos.' });
    }
});

// DELETE: Eliminar dinámicamente un registro (Super CRUD)
router.delete('/db/:tabla/:id', verifyToken, verifyDeveloper, async (req, res) => {
    const { tabla, id } = req.params;

    // 1. Validar la Lista Blanca
    if (!tablasPermitidas.includes(tabla)) {
        return res.status(403).json({ error: 'Tabla no permitida.' });
    }

    try {
        // Ejecutar eliminación
        await pool.query(`DELETE FROM ${tabla} WHERE id = $1`, [id]);
        res.json({ message: 'Registro eliminado correctamente.' });
    } catch (error) {
        console.error(`[DEV] Error al eliminar en ${tabla}:`, error);
        // Error común 23503: Violación de clave foránea (Foreign Key)
        if (error.code === '23503') {
            return res.status(409).json({ error: 'Conflicto: El registro está siendo usado en otra tabla.' });
        }
        res.status(500).json({ error: 'Error al ejecutar DELETE en base de datos.' });
    }
});

router.post('/anular-venta/:id', verifyToken, anularVentaDefinitiva);
router.get('/boveda-anuladas', verifyToken, getVentasAnuladas);
router.post('/restaurar-venta/:idBoveda', verifyToken, restaurarVentaAnulada);

module.exports = router;