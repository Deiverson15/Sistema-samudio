/* Archivo: inventario/src/controllers/compras.controller.js */
const pool = require('../config/db');

// 1. REGISTRAR LOTE (Con Fecha de Reposición)
const registrarLoteMaestro = async (req, res) => {
    const { 
        factura, 
        peso_total_kg, 
        proveedor_id, 
        fecha_compra, 
        costo_total, 
        fecha_reposicion // <--- Nuevo campo
    } = req.body;

    const tiendaId = req.user.tienda_id;

    try {
        const query = `
            INSERT INTO lotes_maestros 
            (factura, peso_total_kg, peso_pendiente_kg, proveedor_id, fecha_compra, costo_total, fecha_reposicion, tienda_id)
            VALUES ($1, $2, $2, $3, $4, $5, $6, $7) RETURNING *`;
        
        const result = await pool.query(query, [
            factura, 
            peso_total_kg, 
            proveedor_id, 
            fecha_compra || new Date(), 
            costo_total || 0,
            fecha_reposicion || null,
            tiendaId // <--- Guardamos la tienda aquí
        ]);

        res.json({ mensaje: 'Lote registrado en su sucursal.', lote: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
// - inventario/src/controllers/compras.controller.js

//
const distribuirPeso = async (req, res) => {
    const { lote_maestro_id, producto_id, peso_kg } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Validar lote maestro
        const loteRes = await client.query('SELECT * FROM lotes_maestros WHERE id = $1 FOR UPDATE', [lote_maestro_id]);
        const master = loteRes.rows[0];

        if (!master || parseFloat(master.peso_pendiente_kg) < parseFloat(peso_kg)) {
            throw new Error('El peso a distribuir supera lo que queda en el lote maestro.');
        }

        const gramos = parseFloat(peso_kg) * 1000;
        
        // Calculamos el costo por gramo para el nuevo lote
        const costoPorGramo = parseFloat(master.costo_total) / (parseFloat(master.peso_total_kg) * 1000);

        // 1. Sumar al Inventario General
        await client.query('UPDATE productos SET stock_unidades = stock_unidades + $1 WHERE id = $2', [gramos, producto_id]);

        // 2. SINCRONIZACIÓN DE LOTES: Buscar si ya existe un lote abierto para este producto
        const existeLote = await client.query(
            "SELECT id FROM lotes WHERE producto_id = $1 AND cantidad_actual > 0 LIMIT 1", 
            [producto_id]
        );

        if (existeLote.rows.length > 0) {
            // Si ya existe, le sumamos a la cantidad actual
            await client.query(
                "UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id = $2",
                [gramos, existeLote.rows[0].id]
            );
        } else {
            // SI ES NUEVO: Agregamos 'cantidad_inicial' para evitar el error de NULO
            await client.query(
                `INSERT INTO lotes 
                (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario) 
                VALUES ($1, $2, $3, $3, $4, $5)`,
                [producto_id, master.factura, gramos, master.fecha_reposicion, costoPorGramo]
            );
        }

        // 3. Restar del Lote Maestro y registrar historial
        const nuevoPendiente = parseFloat(master.peso_pendiente_kg) - parseFloat(peso_kg);
        await client.query(
            'UPDATE lotes_maestros SET peso_pendiente_kg = $1, estado = $2 WHERE id = $3',
            [nuevoPendiente, nuevoPendiente <= 0 ? 'COMPLETADO' : 'PROCESANDO', lote_maestro_id]
        );

        await client.query(
            'INSERT INTO distribuciones_lote (lote_maestro_id, producto_id, peso_asignado_kg, gramos_añadidos) VALUES ($1, $2, $3, $4)',
            [lote_maestro_id, producto_id, peso_kg, gramos]
        );

        await client.query('COMMIT');
        res.json({ mensaje: `Se asignaron ${peso_kg}kg correctamente y se sincronizaron los lotes.` });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const getLotesMaestros = async (req, res) => {
    const result = await pool.query(`
        SELECT l.*, p.empresa as proveedor_nombre,
        TO_CHAR(l.fecha_compra, 'YYYY-MM-DD') as fecha_compra_fmt,
        TO_CHAR(l.fecha_reposicion, 'YYYY-MM-DD') as fecha_reposicion_fmt
        FROM lotes_maestros l 
        LEFT JOIN proveedores p ON l.proveedor_id = p.id 
        ORDER BY l.fecha_registro DESC`);
    res.json(result.rows);
};

// 4. NUEVO: VER KARDEX (HISTORIAL DE DISTRIBUCIÓN)
const getHistorialLote = async (req, res) => {
    const { id } = req.params;
    try {
        // Verifica primero si la tabla existe o da un error claro
        const result = await pool.query(`
            SELECT d.*, p.nombre as producto_nombre, p.categoria 
            FROM distribuciones_lote d
            JOIN productos p ON d.producto_id = p.id
            WHERE d.lote_maestro_id = $1
            ORDER BY d.fecha_distribucion DESC
        `, [id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo historial:", error);
        res.status(500).json({ error: "Error al consultar historial: " + error.message });
    }
};

// NUEVO: Distribución Masiva en un solo viaje a la Base de Datos con Redondeo de Precisión
const distribuirMasivo = async (req, res) => {
    const { lote_maestro_id, distribuciones } = req.body; 
    // distribuciones es un array estructurado como: [{ producto_id, peso_kg }, ...]

    if (!distribuciones || distribuciones.length === 0) {
        return res.status(400).json({ error: "El lote de distribución está vacío." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Iniciamos una transacción blindada única

        // 1. Bloquear y leer el lote maestro una sola vez para evitar lecturas sucias
        const loteRes = await client.query('SELECT * FROM lotes_maestros WHERE id = $1 FOR UPDATE', [lote_maestro_id]);
        const master = loteRes.rows[0];

        if (!master) throw new Error('El lote maestro (tambor principal) no existe.');

        // 2. MATEMÁTICA PROTEGIDA: Calcular peso total requerido aplicando redondeo de flotantes a 3 decimales
        const pesoTotalRequerido = parseFloat(
            distribuciones.reduce((acc, item) => acc + parseFloat(item.peso_kg), 0).toFixed(3)
        );
        const pesoDisponibleMaestro = parseFloat(parseFloat(master.peso_pendiente_kg).toFixed(3));

        // Validación estricta antes de alterar stocks
        if (pesoDisponibleMaestro < pesoTotalRequerido) {
            throw new Error(`Intentas extraer un total de ${pesoTotalRequerido} Kg, pero el lote maestro solo posee ${pesoDisponibleMaestro} Kg disponibles.`);
        }

        // Costo por gramo exacto basado en el costo total cargado en la compra
        const costoPorGramo = parseFloat(master.costo_total) / (parseFloat(master.peso_total_kg) * 1000);

        // 3. Procesar cada producto de la lista secuencialmente en un solo viaje
        for (const item of distribuciones) {
            // 🔥 SOLUCIÓN AL ERROR CRÍTICO: Math.round elimina los decimales flotantes corruptos de JS 
            // convirtiendo "1014.9999999999999" en un entero exacto "1015", compatible con tus columnas INTEGER
            const gramos = Math.round(parseFloat(item.peso_kg) * 1000);

            // A) Sumar los gramos directamente al Inventario General contable
            await client.query('UPDATE productos SET stock_unidades = stock_unidades + $1 WHERE id = $2', [gramos, item.producto_id]);

            // B) SINCRONIZACIÓN DE SUB-LOTES: Buscar si ya existe un lote de materia prima abierto/activo
            const existeLote = await client.query(
                "SELECT id FROM lotes WHERE producto_id = $1 AND cantidad_actual > 0 LIMIT 1", 
                [item.producto_id]
            );

            if (existeLote.rows.length > 0) {
                // Si el sub-lote ya existe y le queda esencia/alcohol, le sumamos los gramos nuevos
                await client.query(
                    "UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id = $2",
                    [gramos, existeLote.rows[0].id]
                );
            } else {
                // Si no hay sub-lote activo, insertamos uno nuevo mapeando datos del maestro
                await client.query(
                    `INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
                     VALUES ($1, $2, $3, $3, $4, $5, $6)`,
                    [item.producto_id, master.factura, gramos, master.fecha_reposicion, costoPorGramo, master.tienda_id]
                );
            }

            // C) Registrar la trazabilidad de esta distribución en su tabla correspondiente (Kardex de Compras)
            await client.query(
                'INSERT INTO distribuciones_lote (lote_maestro_id, producto_id, peso_asignado_kg, gramos_añadidos, tienda_id) VALUES ($1, $2, $3, $4, $5)',
                [lote_maestro_id, item.producto_id, item.peso_kg, gramos, master.tienda_id]
            );
        }

        // 4. Actualizar el Lote Maestro restando el peso global acumulado y cambiando el estado si se vació
        const nuevoPendiente = parseFloat((pesoDisponibleMaestro - pesoTotalRequerido).toFixed(3));
        
        await client.query(
            'UPDATE lotes_maestros SET peso_pendiente_kg = $1, estado = $2 WHERE id = $3',
            [nuevoPendiente, nuevoPendiente <= 0.001 ? 'COMPLETADO' : 'PROCESANDO', lote_maestro_id]
        );

        await client.query('COMMIT'); // Se guardan permanentemente todas las operaciones juntas
        res.json({ OK: true, mensaje: `Se han distribuido exitosamente ${distribuciones.length} productos en un único proceso masivo.` });

    } catch (error) {
        await client.query('ROLLBACK'); // Si un solo producto falla, se cancela todo para mantener el balance intacto
        console.error("Error crítico en la transacción masiva de compras:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release(); // Liberamos la conexión de vuelta al pool
    }
};

module.exports = { registrarLoteMaestro, distribuirPeso, getLotesMaestros, getHistorialLote, distribuirMasivo };