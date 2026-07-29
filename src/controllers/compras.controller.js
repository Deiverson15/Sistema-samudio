/* Archivo: src/controllers/compras.controller.js */
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
            idTiendaLocal
        ]);
        res.json({ mensaje: `Tambor maestro registrado en la Sucursal ${idTiendaLocal}.`, lote: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};



const getLotesMaestros = async (req, res) => {
    try {
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev' || rolUsuario === 'administrador' || rolUsuario === 'admin';

        let idTiendaLocal = 1;
        if (esUsuarioMaestro && req.user?.id) {
            const userDb = await pool.query('SELECT tienda_id FROM usuarios WHERE id = $1', [req.user.id]);
            if (userDb.rows.length > 0 && userDb.rows[0].tienda_id !== null) {
                idTiendaLocal = parseInt(userDb.rows[0].tienda_id, 10);
            }
        } else if (req.user && req.user.tienda_id) {
            idTiendaLocal = parseInt(req.user.tienda_id, 10);
        }

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

const distribuirPeso = async (req, res) => {
    const { lote_maestro_id, producto_id, peso_kg } = req.body;
    const usuarioId = req.user ? req.user.id : null;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. Validar lote maestro
        const loteRes = await client.query('SELECT * FROM lotes_maestros WHERE id = $1 FOR UPDATE', [lote_maestro_id]);
        const master = loteRes.rows[0];
        
        if (!master || parseFloat(master.peso_pendiente_kg) < parseFloat(peso_kg)) {
            throw new Error('El peso a distribuir supera lo que queda en el lote maestro.');
        }
        
        const gramos = parseFloat(peso_kg) * 1000;
        const costoPorGramo = parseFloat(master.costo_total) / (parseFloat(master.peso_total_kg) * 1000);

        // 2. Sumar al Inventario General (Total de existencias en productos)
        const prodUpd = await client.query(
            'UPDATE productos SET stock_unidades = stock_unidades + $1 WHERE id = $2 AND tienda_id = $3 RETURNING stock_unidades', 
            [gramos, producto_id, master.tienda_id]
        );
        const stockNuevo = prodUpd.rows[0] ? prodUpd.rows[0].stock_unidades : gramos;

        // 🔥 3. SIEMPRE CREAR UN NUEVO LOTE INDEPENDIENTE PARA ESTA COMPRA/FACTURA
        // Generamos un código de lote único combinando la Factura y el ID del lote maestro
        const codigoLoteNuevo = `FAC-${master.factura}-${Date.now().toString().slice(-4)}`;

        await client.query(
            `INSERT INTO lotes 
             (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
             VALUES ($1, $2, $3, $3, $4, $5, $6)`,
            [
                producto_id, 
                codigoLoteNuevo, 
                gramos, 
                master.fecha_reposicion || new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // 2 años por defecto
                costoPorGramo, 
                master.tienda_id
            ]
        );

        // 4. Restar del Lote Maestro
        const nuevoPendiente = parseFloat(master.peso_pendiente_kg) - parseFloat(peso_kg);
        await client.query(
            'UPDATE lotes_maestros SET peso_pendiente_kg = $1, estado = $2 WHERE id = $3',
            [nuevoPendiente, nuevoPendiente <= 0 ? 'COMPLETADO' : 'PROCESANDO', lote_maestro_id]
        );
        
        // 5. Historial de distribución
        await client.query(
            'INSERT INTO distribuciones_lote (lote_maestro_id, producto_id, peso_asignado_kg, gramos_añadidos, tienda_id) VALUES ($1, $2, $3, $4, $5)',
            [lote_maestro_id, producto_id, peso_kg, gramos, master.tienda_id]
        );

        // 6. Registro en Historial de Movimientos (Kardex e ISLR)
        const motivoDetalle = `Distribución de Compra - Factura: ${master.factura} (${peso_kg} Kg / ${gramos}g)`;
        await client.query(
            `INSERT INTO historial_movimientos 
             (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id) 
             VALUES ($1, 'ENTRADA', $2, $3, $4, NOW(), $5, $6)`,
            [producto_id, gramos, stockNuevo, motivoDetalle, master.tienda_id, usuarioId]
        );

        await client.query('COMMIT');
        res.json({ mensaje: `Se creó un nuevo lote independiente (${codigoLoteNuevo}) con ${gramos}g y se registró la trazabilidad.` });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const distribuirMasivo = async (req, res) => {
    const { lote_maestro_id, distribuciones } = req.body; 
    const usuarioId = req.user ? req.user.id : null;

    if (!distribuciones || distribuciones.length === 0) {
        return res.status(400).json({ error: "El lote de distribución está vacío." });
    }
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); 

        // 1. Obtener Lote Maestro (Tambor Principal)
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

            // A) Sumar gramos al producto en la tienda correspondiente
            const prodUpd = await client.query(
                'UPDATE productos SET stock_unidades = stock_unidades + $1 WHERE id = $2 AND tienda_id = $3 RETURNING stock_unidades', 
                [gramos, item.producto_id, master.tienda_id]
            );
            const stockNuevo = prodUpd.rows[0] ? prodUpd.rows[0].stock_unidades : gramos;

            // 🔥 B) CÓDIGO DE LOTE CORTO (< 30 CARACTERES) + CAMPOS DE NATIVE TABLE
            // Formato: L-[ID_PRODUCTO]-[TIMESTAMP_CORTO]
            const codigoLoteGarantizado = `L-${item.producto_id}-${Date.now()}`;
            const numFacturaClean = master.factura ? String(master.factura).slice(0, 50) : 'S/F';

            await client.query(
                `INSERT INTO lotes 
                 (producto_id, proveedor_id, codigo_lote, numero_factura, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id, observaciones, estado) 
                 VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, 'ACTIVO')`,
                [
                    item.producto_id,
                    master.proveedor_id || null,
                    codigoLoteGarantizado,
                    numFacturaClean,
                    gramos,
                    master.fecha_reposicion || new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), 
                    costoPorGramo, 
                    master.tienda_id,
                    `Distribución desde Tambor Maestro #${master.id}`
                ]
            );

            // C) Trazabilidad interna
            await client.query(
                'INSERT INTO distribuciones_lote (lote_maestro_id, producto_id, peso_asignado_kg, gramos_añadidos, tienda_id) VALUES ($1, $2, $3, $4, $5)',
                [lote_maestro_id, item.producto_id, item.peso_kg, gramos, master.tienda_id]
            );

            // D) Registro en Historial de Movimientos (Kardex)
            const motivoDetalle = `Distribución Masiva - Factura: ${master.factura} (${item.peso_kg} Kg / ${gramos}g)`;
            await client.query(
                `INSERT INTO historial_movimientos 
                 (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id) 
                 VALUES ($1, 'ENTRADA', $2, $3, $4, NOW(), $5, $6)`,
                [item.producto_id, gramos, stockNuevo, motivoDetalle, master.tienda_id, usuarioId]
            );
        }

        const nuevoPendiente = parseFloat((pesoDisponibleMaestro - pesoTotalRequerido).toFixed(3));
        
        await client.query(
            'UPDATE lotes_maestros SET peso_pendiente_kg = $1, estado = $2 WHERE id = $3',
            [nuevoPendiente, nuevoPendiente <= 0.001 ? 'COMPLETADO' : 'PROCESANDO', lote_maestro_id]
        );

        await client.query('COMMIT'); 
        res.json({ OK: true, mensaje: `Se registraron los sub-lotes individuales de la Factura ${master.factura} en la tabla de lotes y se actualizó la tienda.` });
    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error("Error crítico en la transacción masiva de compras:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release(); 
    }
};

module.exports = { registrarLoteMaestro, distribuirPeso, getLotesMaestros, getHistorialLote, distribuirMasivo };