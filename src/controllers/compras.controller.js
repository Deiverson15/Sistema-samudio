/* Archivo: inventario/src/controllers/compras.controller.js */
const pool = require('../config/db');

// 1. REGISTRAR LOTE MAESTRO (Tambor General)
const registrarLoteMaestro = async (req, res) => {
    const { 
        factura, 
        peso_total_kg, 
        proveedor_id, 
        fecha_compra, 
        costo_total, 
        fecha_reposicion
    } = req.body;

    // 🔥 1. LECTURA EN VIVO: Extraemos la tienda en la que el Dev está parado actualmente
    let idTiendaLocal = 1;
    const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
    const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev' || rolUsuario === 'administrador' || rolUsuario === 'admin';

    if (esUsuarioMaestro && req.user?.id) {
        const userDb = await pool.query('SELECT tienda_id FROM usuarios WHERE id = $1', [req.user.id]);
        if (userDb.rows.length > 0 && userDb.rows[0].tienda_id !== null) {
            idTiendaLocal = parseInt(userDb.rows[0].tienda_id, 10);
        }
    } else if (req.user && req.user.tienda_id) {
        idTiendaLocal = parseInt(req.user.tienda_id, 10);
    }

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
            idTiendaLocal // 🔒 El lote nace anclado a la tienda que estás visualizando
        ]);
        res.json({ mensaje: `Tambor maestro registrado en la Sucursal ${idTiendaLocal}.`, lote: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

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
        const costoPorGramo = parseFloat(master.costo_total) / (parseFloat(master.peso_total_kg) * 1000);

        // 1. Sumar al Inventario General (🔥 CANDADO: Amarrado a la tienda del Lote Maestro)
        await client.query(
            'UPDATE productos SET stock_unidades = stock_unidades + $1 WHERE id = $2 AND tienda_id = $3', 
            [gramos, producto_id, master.tienda_id]
        );

        // 2. SINCRONIZACIÓN DE LOTES (🔥 CANDADO: Buscamos lote abierto en la misma tienda)
        const existeLote = await client.query(
            "SELECT id FROM lotes WHERE producto_id = $1 AND tienda_id = $2 AND cantidad_actual > 0 LIMIT 1", 
            [producto_id, master.tienda_id]
        );

        if (existeLote.rows.length > 0) {
            await client.query(
                "UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id = $2",
                [gramos, existeLote.rows[0].id]
            );
        } else {
            // SI ES NUEVO: Agregamos tienda_id
            await client.query(
                `INSERT INTO lotes 
                 (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
                 VALUES ($1, $2, $3, $3, $4, $5, $6)`,
                [producto_id, master.factura, gramos, master.fecha_reposicion, costoPorGramo, master.tienda_id]
            );
        }

        // 3. Restar del Lote Maestro y registrar historial
        const nuevoPendiente = parseFloat(master.peso_pendiente_kg) - parseFloat(peso_kg);
        await client.query(
            'UPDATE lotes_maestros SET peso_pendiente_kg = $1, estado = $2 WHERE id = $3',
            [nuevoPendiente, nuevoPendiente <= 0 ? 'COMPLETADO' : 'PROCESANDO', lote_maestro_id]
        );
        
        await client.query(
            'INSERT INTO distribuciones_lote (lote_maestro_id, producto_id, peso_asignado_kg, gramos_añadidos, tienda_id) VALUES ($1, $2, $3, $4, $5)',
            [lote_maestro_id, producto_id, peso_kg, gramos, master.tienda_id]
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
    try {
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev' || rolUsuario === 'administrador' || rolUsuario === 'admin';

        // 🔥 2. LECTURA EN VIVO: Rompemos el token congelado para que el Dev visualice la tienda correcta
        let idTiendaLocal = 1;
        if (esUsuarioMaestro && req.user?.id) {
            const userDb = await pool.query('SELECT tienda_id FROM usuarios WHERE id = $1', [req.user.id]);
            if (userDb.rows.length > 0 && userDb.rows[0].tienda_id !== null) {
                idTiendaLocal = parseInt(userDb.rows[0].tienda_id, 10);
            }
        } else if (req.user && req.user.tienda_id) {
            idTiendaLocal = parseInt(req.user.tienda_id, 10);
        }

        console.log(`[COMPRAS AUDIT] ${rolUsuario} solicitando compras de la Tienda ID: ${idTiendaLocal}`);

        // 🔒 CANDADO ESTRICTO OBLIGATORIO: Ya seas Dev o Gerente, solo verás las de TU TIENDA ACTUAL
        let whereClause = `WHERE l.tienda_id = ${idTiendaLocal}`;

        const result = await pool.query(`
            SELECT l.*, p.empresa as proveedor_nombre,
            TO_CHAR(l.fecha_compra, 'YYYY-MM-DD') as fecha_compra_fmt,
            TO_CHAR(l.fecha_reposicion, 'YYYY-MM-DD') as fecha_reposicion_fmt
            FROM lotes_maestros l 
            LEFT JOIN proveedores p ON l.proveedor_id = p.id 
            ${whereClause}
            ORDER BY l.fecha_registro DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo Lotes Maestros:", error);
        res.status(500).json({ error: error.message });
    }
};

const getHistorialLote = async (req, res) => {
    const { id } = req.params;
    try {
        // En el historial no necesitamos filtro de tienda en la WHERE, porque solo puedes abrir
        // el historial de un Tambor que ya la consulta anterior (getLotesMaestros) te permitió ver.
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

const distribuirMasivo = async (req, res) => {
    const { lote_maestro_id, distribuciones } = req.body; 

    if (!distribuciones || distribuciones.length === 0) {
        return res.status(400).json({ error: "El lote de distribución está vacío." });
    }
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); 

        const loteRes = await client.query('SELECT * FROM lotes_maestros WHERE id = $1 FOR UPDATE', [lote_maestro_id]);
        const master = loteRes.rows[0];
        
        if (!master) throw new Error('El lote maestro (tambor principal) no existe.');

        const pesoTotalRequerido = parseFloat(
            distribuciones.reduce((acc, item) => acc + parseFloat(item.peso_kg), 0).toFixed(3)
        );
        const pesoDisponibleMaestro = parseFloat(parseFloat(master.peso_pendiente_kg).toFixed(3));

        if (pesoDisponibleMaestro < pesoTotalRequerido) {
            throw new Error(`Intentas extraer un total de ${pesoTotalRequerido} Kg, pero el lote maestro solo posee ${pesoDisponibleMaestro} Kg disponibles.`);
        }

        const costoPorGramo = parseFloat(master.costo_total) / (parseFloat(master.peso_total_kg) * 1000);

        for (const item of distribuciones) {
            const gramos = Math.round(parseFloat(item.peso_kg) * 1000);

            // A) Sumar los gramos al Inventario General contable (🔥 CANDADO: tienda_id)
            await client.query(
                'UPDATE productos SET stock_unidades = stock_unidades + $1 WHERE id = $2 AND tienda_id = $3', 
                [gramos, item.producto_id, master.tienda_id]
            );

            // B) SINCRONIZACIÓN DE SUB-LOTES (🔥 CANDADO: tienda_id)
            const existeLote = await client.query(
                "SELECT id FROM lotes WHERE producto_id = $1 AND tienda_id = $2 AND cantidad_actual > 0 LIMIT 1", 
                [item.producto_id, master.tienda_id]
            );

            if (existeLote.rows.length > 0) {
                await client.query(
                    "UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id = $2",
                    [gramos, existeLote.rows[0].id]
                );
            } else {
                await client.query(
                    `INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
                     VALUES ($1, $2, $3, $3, $4, $5, $6)`,
                    [item.producto_id, master.factura, gramos, master.fecha_reposicion, costoPorGramo, master.tienda_id]
                );
            }

            // C) Registrar la trazabilidad
            await client.query(
                'INSERT INTO distribuciones_lote (lote_maestro_id, producto_id, peso_asignado_kg, gramos_añadidos, tienda_id) VALUES ($1, $2, $3, $4, $5)',
                [lote_maestro_id, item.producto_id, item.peso_kg, gramos, master.tienda_id]
            );
        }

        const nuevoPendiente = parseFloat((pesoDisponibleMaestro - pesoTotalRequerido).toFixed(3));
        
        await client.query(
            'UPDATE lotes_maestros SET peso_pendiente_kg = $1, estado = $2 WHERE id = $3',
            [nuevoPendiente, nuevoPendiente <= 0.001 ? 'COMPLETADO' : 'PROCESANDO', lote_maestro_id]
        );

        await client.query('COMMIT'); 
        res.json({ OK: true, mensaje: `Se han distribuido exitosamente ${distribuciones.length} productos en un único proceso masivo.` });
    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error("Error crítico en la transacción masiva de compras:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release(); 
    }
};

module.exports = { registrarLoteMaestro, distribuirPeso, getLotesMaestros, getHistorialLote, distribuirMasivo };