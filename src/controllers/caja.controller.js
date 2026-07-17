const pool = require('../config/db');

const getEstadoCaja = async (req, res) => {
    const usuario_id = req.user.id;
    // 🔥 Capturamos la tienda actual
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    try {
        // 🔒 Buscamos la sesión abierta exclusivamente en ESTA tienda
        const result = await pool.query(
            "SELECT * FROM sesiones_caja WHERE usuario_id = $1 AND tienda_id = $2 AND estado = 'ABIERTA' ORDER BY id DESC LIMIT 1",
            [usuario_id, idTiendaLocal]
        );

        if (result.rows.length === 0) {
            return res.json({ abierta: false, mensaje: 'No hay turno activo en esta sucursal.' });
        }

        const sesion = result.rows[0];

        // 🔒 Sumamos SOLO las ventas de hoy, de este usuario, y en ESTA tienda
        const ventasRes = await pool.query(`
            SELECT 
                COALESCE(SUM(total), 0) as total_vendido,
                COUNT(*) as cantidad_ventas
            FROM ventas 
            WHERE usuario_id = $1 
              AND tienda_id = $2
              AND fecha >= $3
              AND DATE(fecha) = CURRENT_DATE 
        `, [usuario_id, idTiendaLocal, sesion.fecha_apertura]);

        res.json({ 
            abierta: true, 
            sesion: sesion,
            resumen_temporal: ventasRes.rows[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error consultando caja' });
    }
};

const abrirCaja = async (req, res) => {
    const usuario_id = req.user.id;
    const { monto_inicial } = req.body;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    try {
        // 🔒 Validamos que no tenga OTRA caja abierta en la MISMA tienda
        const check = await pool.query(
            "SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND tienda_id = $2 AND estado = 'ABIERTA'", 
            [usuario_id, idTiendaLocal]
        );

        if (check.rows.length > 0) {
            return res.status(400).json({ error: 'Ya tienes una caja abierta en esta sucursal. Ciérrala primero.' });
        }

        // 🔒 Registramos la apertura amarrada a la tienda
        const result = await pool.query(
            "INSERT INTO sesiones_caja (usuario_id, monto_inicial, tienda_id) VALUES ($1, $2, $3) RETURNING *",
            [usuario_id, monto_inicial || 0, idTiendaLocal]
        );

        res.json({ mensaje: 'Caja abierta correctamente en sucursal', sesion: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al abrir caja' });
    }
};

const cerrarCaja = async (req, res) => {
    const usuario_id = req.user.id;
    const { monto_final_declarado } = req.body;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 🔒 Buscar sesión abierta en la tienda actual
        const sesionRes = await client.query(
            "SELECT * FROM sesiones_caja WHERE usuario_id = $1 AND tienda_id = $2 AND estado = 'ABIERTA' FOR UPDATE", 
            [usuario_id, idTiendaLocal]
        );

        if (sesionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No hay caja abierta para cerrar en esta sucursal.' });
        }
        
        const sesion = sesionRes.rows[0];

        // 🔒 Calcular el total esperado (Solo sumando las ventas de esta tienda)
        const ventasRes = await client.query(`
            SELECT COALESCE(SUM(total), 0) as total 
            FROM ventas 
            WHERE usuario_id = $1 
              AND tienda_id = $2
              AND fecha >= $3
              AND DATE(fecha) = CURRENT_DATE 
        `, [usuario_id, idTiendaLocal, sesion.fecha_apertura]);

        const totalVentas = parseFloat(ventasRes.rows[0].total);
        const montoInicial = parseFloat(sesion.monto_inicial);
        
        const totalEsperado = montoInicial + totalVentas;
        const diferencia = parseFloat(monto_final_declarado) - totalEsperado;

        await client.query(`
            UPDATE sesiones_caja 
            SET fecha_cierre = NOW(),
                monto_final_declarado = $1,
                monto_sistema_calculado = $2,
                diferencia = $3,
                estado = 'CERRADA'
            WHERE id = $4
        `, [monto_final_declarado, totalEsperado, diferencia, sesion.id]);

        await client.query('COMMIT');

        res.json({
            mensaje: 'Caja cerrada exitosamente',
            resultado: {
                esperado: totalEsperado,
                declarado: monto_final_declarado,
                diferencia: diferencia,
                estado: diferencia === 0 ? 'CUADRADA' : (diferencia < 0 ? 'FALTANTE' : 'SOBRANTE')
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Error cerrando caja' });
    } finally {
        client.release();
    }
};

module.exports = { getEstadoCaja, abrirCaja, cerrarCaja };