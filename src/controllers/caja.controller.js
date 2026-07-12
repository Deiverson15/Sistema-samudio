const pool = require('../config/db');


const getEstadoCaja = async (req, res) => {
    const usuario_id = req.user.id; 

    try {
        const result = await pool.query(
            "SELECT * FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'ABIERTA' ORDER BY id DESC LIMIT 1",
            [usuario_id]
        );

        if (result.rows.length === 0) {
            return res.json({ abierta: false, mensaje: 'No hay turno activo.' });
        }

        const sesion = result.rows[0];

        // CORRECCIÓN: Agregamos "AND DATE(fecha) = CURRENT_DATE" para que solo sume lo de HOY
        const ventasRes = await pool.query(`
            SELECT 
                COALESCE(SUM(total), 0) as total_vendido,
                COUNT(*) as cantidad_ventas
            FROM ventas 
            WHERE usuario_id = $1 
            AND fecha >= $2
            AND DATE(fecha) = CURRENT_DATE 
        `, [usuario_id, sesion.fecha_apertura]);

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

    try {
        const check = await pool.query("SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'ABIERTA'", [usuario_id]);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: 'Ya tienes una caja abierta. Ciérrala primero.' });
        }

        const result = await pool.query(
            "INSERT INTO sesiones_caja (usuario_id, monto_inicial) VALUES ($1, $2) RETURNING *",
            [usuario_id, monto_inicial || 0]
        );

        res.json({ mensaje: 'Caja abierta correctamente', sesion: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al abrir caja' });
    }
};

// 3. CERRAR CAJA (ARQUEO) - AQUÍ ESTABA EL ERROR PRINCIPAL
const cerrarCaja = async (req, res) => {
    const usuario_id = req.user.id;
    const { monto_final_declarado } = req.body; 

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Buscar sesión abierta
        const sesionRes = await client.query(
            "SELECT * FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'ABIERTA' FOR UPDATE", 
            [usuario_id]
        );

        if (sesionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No hay caja abierta para cerrar.' });
        }
        
        const sesion = sesionRes.rows[0];

        // CORRECCIÓN CRÍTICA:
        // Antes: Sumaba todo desde fecha_apertura (que podía ser hace meses).
        // Ahora: Suma desde la apertura PERO solo registros donde la fecha sea HOY (CURRENT_DATE).
        const ventasRes = await client.query(`
            SELECT COALESCE(SUM(total), 0) as total 
            FROM ventas 
            WHERE usuario_id = $1 
            AND fecha >= $2
            AND DATE(fecha) = CURRENT_DATE 
        `, [usuario_id, sesion.fecha_apertura]);

        const totalVentas = parseFloat(ventasRes.rows[0].total);
        const montoInicial = parseFloat(sesion.monto_inicial);
        
        // TOTAL ESPERADO = Fondo Inicial + Ventas de HOY
        const totalEsperado = montoInicial + totalVentas;
        
        const diferencia = parseFloat(monto_final_declarado) - totalEsperado;

        // Cerrar sesión
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