const pool = require('../config/db');

const getTasaDolar = async (req, res) => {
    try {
        const result = await pool.query("SELECT valor FROM configuracion WHERE clave = 'tasa_dolar'");
        res.json({ tasa: result.rows.length > 0 ? parseFloat(result.rows[0].valor) : 0 });
    } catch (error) {
        console.error("Error BD en getTasaDolar:", error); // <-- AÑADE ESTO
        res.status(500).json({ error: 'Error obteniendo tasa' });
    }
};

const crearAjuste = async (req, res) => {
    const { producto_id, tipo, cantidad, motivo, lote_id, codigo_manual } = req.body;
    
    if (!producto_id || !cantidad || !tipo) {
        return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Seleccionamos también unidad_medida para logs precisos
        const prodRes = await client.query('SELECT nombre, stock_unidades, unidad_medida FROM productos WHERE id = $1', [producto_id]);
        if (prodRes.rows.length === 0) throw new Error("Producto no existe.");
        
        const producto = prodRes.rows[0];
        // CAMBIO CLAVE: Usamos parseFloat para permitir gramos (ej: 10.5g)
        const cant = parseFloat(cantidad); 
        const unidad = producto.unidad_medida || 'u'; // Para el historial

        let nuevoStock = 0;
        let detalleLote = "";

        // --- SALIDA ---
        if (tipo === 'SALIDA') {
            if (parseFloat(producto.stock_unidades) < cant) throw new Error("Stock insuficiente global.");

            if (lote_id) {
                const loteRes = await client.query('SELECT * FROM lotes WHERE id = $1', [lote_id]);
                if (loteRes.rows.length === 0) throw new Error("Lote no existe.");
                const lote = loteRes.rows[0];
                
                if (parseFloat(lote.cantidad_actual) < cant) throw new Error(`El lote solo tiene ${lote.cantidad_actual}${unidad}.`);

                await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [cant, lote_id]);
                detalleLote = ` (Lote: ${lote.codigo_lote})`;
            } else {
                // FIFO Automático
                let porDescontar = cant;
                const lotesRes = await client.query(`
                    SELECT id, codigo_lote, cantidad_actual 
                    FROM lotes WHERE producto_id = $1 AND cantidad_actual > 0 
                    ORDER BY fecha_vencimiento ASC FOR UPDATE
                `, [producto_id]);

                for (const lote of lotesRes.rows) {
                    if (porDescontar <= 0) break;
                    const disponible = parseFloat(lote.cantidad_actual);
                    const tomar = Math.min(porDescontar, disponible);
                    
                    await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [tomar, lote.id]);
                    porDescontar -= tomar;
                }
                detalleLote = " (Automático/FIFO)";
            }
            nuevoStock = parseFloat(producto.stock_unidades) - cant;

        // --- ENTRADA ---
        } else if (tipo === 'ENTRADA') {
            nuevoStock = parseFloat(producto.stock_unidades) + cant;
            const codigoFinal = codigo_manual ? codigo_manual.toUpperCase() : `AJUSTE-${Date.now()}`;
            const fechaVencimiento = new Date();
            fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 2); // Default 2 años

            await client.query(`
                INSERT INTO lotes (producto_id, codigo_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, costo_unitario)
                VALUES ($1, $2, $3, $4, $5, 0)
            `, [producto_id, codigoFinal, fechaVencimiento, cant, cant]);
            
            detalleLote = ` (Nuevo Lote: ${codigoFinal})`;
        }

        // Actualizar Global
        await client.query('UPDATE productos SET stock_unidades = $1 WHERE id = $2', [nuevoStock, producto_id]);

        // Historial con Unidad de Medida
        await client.query(
            `INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, motivo)
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [producto_id, `AJUSTE_${tipo}`, cant, producto.stock_unidades, nuevoStock, `${motivo} (${cant}${unidad}) ${detalleLote}`]
        );

        await client.query(
            "INSERT INTO auditoria (accion, detalle) VALUES ('AJUSTE', $1)", 
            [`${tipo} de ${cant}${unidad} - ${producto.nombre}. Motivo: ${motivo}`]
        );

        await client.query('COMMIT');
        res.json({ mensaje: 'Ajuste realizado', nuevo_stock: nuevoStock, unidad: unidad });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

const updateTasaDolar = async (req, res) => {
    const { nuevaTasa } = req.body;
    try {
        await pool.query("UPDATE configuracion SET valor = $1 WHERE clave = 'tasa_dolar'", [nuevaTasa]);
        res.json({ mensaje: 'Tasa actualizada correctamente' });
    } catch (error) {
        console.error("Error BD en updateTasaDolar:", error); // <-- AÑADE ESTO
        res.status(500).json({ error: 'Error actualizando tasa' });
    }
};

const getMensajePago = async (req, res) => {
    try {
        const result = await pool.query("SELECT valor FROM configuracion WHERE clave = 'mensaje_pago'");
        res.json({ mensaje: result.rows.length > 0 ? result.rows[0].valor : '' });
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo mensaje de pago' });
    }
};

const updateMensajePago = async (req, res) => {
    const { nuevoMensaje } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Guardar la nueva fecha
        await client.query(`
            INSERT INTO configuracion (clave, valor) 
            VALUES ('mensaje_pago', $1) 
            ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor
        `, [nuevoMensaje]);

        // 2. Reactivar el sistema en la base de datos automáticamente
        await client.query(`
            INSERT INTO configuracion (clave, valor) 
            VALUES ('sistema_activo', 'true') 
            ON CONFLICT (clave) DO UPDATE SET valor = 'true'
        `);

        await client.query('COMMIT');
        res.json({ mensaje: 'Fecha actualizada y sistema reactivado correctamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Error actualizando licencia' });
    } finally {
        client.release();
    }
};

module.exports = { crearAjuste, getTasaDolar, updateTasaDolar, getMensajePago, updateMensajePago };