const pool = require('../config/db');
const { crearNotificacionInterna } = require('./notificaciones.controller');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const round = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

async function validarYDescontarEstante(client, productoId, cantidadRequerida, nombreReferencia) {
    // 🔍 FORZADO DE ENTERO: Corta cualquier decimal o string flotante (Ej: "9390.03" -> 9390)
    const pId = parseInt(productoId, 10);
    const cantidad = parseFloat(cantidadRequerida);

    if (isNaN(pId) || pId <= 0) {
        throw new Error(`🚫 ERROR DE FLUJO: Se intentó procesar "${nombreReferencia}" con un ID corrupto o cruzado (${productoId}). Revisa el mapeo del carrito.`);
    }

    // 1. Validar Stock Global y Bloquear Producto (Usa estrictamente pId)
    const prodRes = await client.query(
        'SELECT id, nombre, stock_estante, contenido_gramos FROM productos WHERE id = $1 FOR UPDATE', 
        [pId]
    );
    if (prodRes.rows.length === 0) throw new Error(`El producto ${nombreReferencia} (ID: ${pId}) no existe en el catálogo.`);
    const prod = prodRes.rows[0];

    // Margin de error mínimo por tolerancia de redondeo (0.05)
    if (parseFloat(prod.stock_estante) < (cantidad - 0.05)) {
        throw new Error(`🚫 STOCK INSUFICIENTE: "${prod.nombre}" solo tiene ${parseFloat(prod.stock_estante).toFixed(2)}g en estante (Req: ${cantidad.toFixed(2)}g).`);
    }

    // 2. LÓGICA DE BARRIDO DE BOTELLAS INDIVIDUALES (Usa estrictamente pId)
    let pendiente = cantidad;

    const botellasRes = await client.query(`
        SELECT id, cantidad, estado FROM botellas_estante 
        WHERE producto_id = $1 
        ORDER BY 
            CASE WHEN estado = 'ABIERTA' THEN 1 ELSE 2 END ASC, 
            cantidad ASC
        FOR UPDATE
    `, [pId]);

    const botellas = botellasRes.rows;

    for (const b of botellas) {
        if (pendiente <= 0.001) break; 

        const disponible = parseFloat(b.cantidad);
        const aRestar = Math.min(pendiente, disponible);
        
        // Redondeamos para que la base de datos no arroje error por los decimales
        const nuevaCant = Math.round(disponible - aRestar);
        const capacidad = parseFloat(prod.contenido_gramos) || 1000;
        const nuevoPorc = Math.min(100, Math.round((nuevaCant / capacidad) * 100));

        if (nuevaCant <= 0.01) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [b.id]);
        } else {
            await client.query(
                "UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2, estado = 'ABIERTA' WHERE id = $3", 
                [nuevaCant, nuevoPorc, b.id]
            );
        }

        pendiente -= aRestar;
    }

    // 3. ACTUALIZAR EL CONTADOR GLOBAL DE LA TABLA PRODUCTOS (Usa estrictamente pId)
    await client.query(
        'UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2', 
        [cantidad, pId]
    );

    return prod.nombre;
}

async function devolverAEstanteFisico(client, productoId, cantidadADevolver) {
    const pId = parseInt(productoId, 10);
    const cantidad = parseFloat(cantidadADevolver);
    if (isNaN(pId) || pId <= 0 || isNaN(cantidad) || cantidad <= 0) return;

    // 1. Obtener la capacidad máxima del producto para calcular el porcentaje real
    const prodRes = await client.query('SELECT contenido_gramos, nombre FROM productos WHERE id = $1', [pId]);
    if (prodRes.rows.length === 0) return;
    const capacidad = parseFloat(prodRes.rows[0].contenido_gramos) || 1000;

    // 2. Devolver los gramos al inventario global de mostrador (stock_estante)
    await client.query('UPDATE productos SET stock_estante = stock_estante + $1 WHERE id = $2', [cantidad, pId]);

    // 3. Buscar la última botella que esté asociada a este producto en el estante
    const botellaRes = await client.query(`
        SELECT id, cantidad FROM botellas_estante 
        WHERE producto_id = $1 
        ORDER BY estado ASC, id DESC LIMIT 1
    `, [pId]);

    if (botellaRes.rows.length > 0) {
        const bId = botellaRes.rows[0].id;
        const nuevaCantidad = parseFloat(botellaRes.rows[0].cantidad) + cantidad;
        
        // Recalcular el porcentaje exacto sin pasarse de 100%
        const nuevoPorcentaje = Math.min(100, Math.round((nuevaCantidad / capacidad) * 100));

        // Forzar la actualización física con estado ABIERTA para que el módulo de estantes la renderice
        await client.query(`
            UPDATE botellas_estante 
            SET cantidad = $1, porcentaje_actual = $2, estado = 'ABIERTA' 
            WHERE id = $3
        `, [nuevaCantidad, nuevoPorcentaje, bId]);
    } else {
        // Si por alguna razón la botella fue eliminada, creamos una de respaldo en el estante para no perder el rastro
        const nuevoPorcentaje = Math.min(100, Math.round((cantidad / capacidad) * 100));
        await client.query(`
            INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado)
            VALUES ($1, $2, $3, 'A', '1', 'ABIERTA')
        `, [pId, cantidad, nuevoPorcentaje]);
    }
}

const exportarReporteGeneral = async (req, res) => {
    const { filtro, start, end } = req.query;
    const client = await pool.connect();

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Perfumix C.A.';
        
        // Estilos Corporativos
        const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }, alignment: { horizontal: 'center' } };
        const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

        // 1. CIERRES DE CAJA
        if (filtro === 'maestro' || filtro === 'cierres') {
            const sheet = workbook.addWorksheet('Cierres');
            sheet.columns = [
                { header: 'FECHA', key: 'fecha', width: 20 },
                { header: 'TOTAL USD', key: 'usd', width: 15 },
                { header: 'TOTAL BS', key: 'bs', width: 15 },
                { header: 'OPERACIONES', key: 'ops', width: 15 }
            ];
            sheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
            
            const query = `SELECT fecha_cierre, total_usd, total_bs, cantidad_ventas FROM cierres_caja WHERE fecha_cierre::date BETWEEN $1 AND $2 ORDER BY fecha_cierre DESC`;
            const result = await pool.query(query, [start, end]);
            result.rows.forEach(r => {
                const row = sheet.addRow({ fecha: r.fecha_cierre, usd: r.total_usd, bs: r.total_bs, ops: r.cantidad_ventas });
                row.eachCell(c => c.border = borderStyle);
            });
        }

        // 2. VENTAS REFERENCIAS
        if (filtro === 'maestro' || filtro === 'referencias') {
            const sheet = workbook.addWorksheet('Ventas por Referencias');
            sheet.columns = [
                { header: 'CÓDIGO', key: 'codigo', width: 15 },
                { header: 'PRODUCTO', key: 'nombre', width: 30 },
                { header: 'GENERO', key: 'genero', width: 15 },
                { header: 'UDS', key: 'uds', width: 10 },
                { header: 'TOTAL $', key: 'monto', width: 15 }
            ];
            sheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));

            const query = `
                SELECT p.codigo, p.nombre, p.genero, SUM(d.cantidad) as uds, SUM(d.subtotal) as monto
                FROM detalle_ventas d
                JOIN productos p ON d.producto_id = p.id
                JOIN ventas v ON d.venta_id = v.id
                WHERE v.fecha::date BETWEEN $1 AND $2
                GROUP BY p.codigo, p.nombre, p.genero
            `;
            const result = await pool.query(query, [start, end]);
            result.rows.forEach(r => {
                const row = sheet.addRow({ codigo: r.codigo, nombre: r.nombre, genero: r.genero, uds: r.uds, monto: r.monto });
                row.eachCell(c => c.border = borderStyle);
                row.getCell(5).numFmt = '#,##0.00';
            });
        }

        // 3. VENTAS X TIENDA
        if (filtro === 'maestro' || filtro === 'tiendas') {
            const sheet = workbook.addWorksheet('Ventas por Tienda');
            sheet.columns = [
                { header: 'TIENDA', key: 'tienda', width: 25 },
                { header: 'PRODUCTO', key: 'producto', width: 30 },
                { header: 'UDS', key: 'uds', width: 10 },
                { header: 'TOTAL $', key: 'total', width: 15 }
            ];
            sheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));

            const query = `
                SELECT t.nombre as tienda, p.nombre as producto, SUM(d.cantidad) as uds, SUM(d.subtotal) as total
                FROM ventas v
                JOIN detalle_ventas d ON v.id = d.venta_id
                JOIN productos p ON d.producto_id = p.id
                JOIN tiendas t ON v.tienda_id = t.id
                WHERE v.fecha::date BETWEEN $1 AND $2
                GROUP BY t.nombre, p.nombre
            `;
            const result = await pool.query(query, [start, end]);
            result.rows.forEach(r => {
                const row = sheet.addRow({ tienda: r.tienda, producto: r.producto, uds: r.uds, total: r.total });
                row.eachCell(c => c.border = borderStyle);
                row.getCell(4).numFmt = '#,##0.00';
            });
        }

        // 4. INVENTARIO (Sin filtro fecha)
        if (filtro === 'maestro' || filtro === 'inventario') {
            const sheet = workbook.addWorksheet('Inventario');
            sheet.columns = [
                { header: 'CÓDIGO', key: 'codigo', width: 15 },
                { header: 'PRODUCTO', key: 'nombre', width: 30 },
                { header: 'CATEGORÍA', key: 'cat', width: 20 },
                { header: 'STOCK', key: 'stock', width: 15 }
            ];
            sheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));

            const query = `SELECT codigo, nombre, categoria, stock_unidades FROM productos WHERE activo = true`;
            const result = await pool.query(query);
            result.rows.forEach(r => {
                const row = sheet.addRow({ codigo: r.codigo, nombre: r.nombre, cat: r.categoria, stock: r.stock_unidades });
                row.eachCell(c => c.border = borderStyle);
            });
        }

        // 5. MOVIMIENTO KARDEX
        if (filtro === 'maestro' || filtro === 'kardex') {
            const sheet = workbook.addWorksheet('Kardex');
            sheet.columns = [
                { header: 'FECHA', key: 'fecha', width: 20 },
                { header: 'TIPO', key: 'tipo', width: 15 },
                { header: 'CANTIDAD', key: 'cant', width: 15 },
                { header: 'MOTIVO', key: 'motivo', width: 40 }
            ];
            sheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));

            const query = `SELECT fecha, tipo_movimiento, cantidad, motivo FROM historial_movimientos WHERE fecha::date BETWEEN $1 AND $2 ORDER BY fecha DESC`;
            const result = await pool.query(query, [start, end]);
            result.rows.forEach(r => {
                const row = sheet.addRow({ fecha: r.fecha, tipo: r.tipo_movimiento, cant: r.cantidad, motivo: r.motivo });
                row.eachCell(c => c.border = borderStyle);
            });
        }

        // 6. FÓRMULAS
        if (filtro === 'maestro' || filtro === 'formulas') {
            const sheet = workbook.addWorksheet('Fórmulas');
            sheet.columns = [
                { header: 'NOMBRE', key: 'nombre', width: 30 },
                { header: 'VOLUMEN', key: 'vol', width: 10 },
                { header: 'PRECIO $', key: 'precio', width: 15 }
            ];
            sheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
            
            const result = await pool.query(`SELECT nombre, volumen_total, precio FROM formulas`);
            result.rows.forEach(r => {
                const row = sheet.addRow({ nombre: r.nombre, vol: r.volumen_total, precio: r.precio });
                row.eachCell(c => c.border = borderStyle);
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_Completo_${filtro}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error(error);
        res.status(500).send("Error");
    } finally {
        client.release();
    }
};

const descontarEstante = async (client, productoId, cantidad) => {
    // Función legacy para compatibilidad
    await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2', [cantidad, productoId]);
};

const previsualizarCierre = async (req, res) => {
    try {
        const { fecha } = req.query; // Formato YYYY-MM-DD
        
        // El check del candado de hoy se mantiene igual
        const checkQuery = fecha 
            ? "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = $1::date"
            : "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = CURRENT_DATE";
        
        const paramCheck = fecha ? [fecha] : [];

        const client = await pool.connect();
        try {
            // A. VERIFICACIÓN DE SEGURIDAD (Solo bloquea el día de hoy si ya se cerró estándar)
            const checkRes = await client.query(checkQuery, paramCheck);
            if (checkRes.rows.length > 0 && !fecha) {
                return res.status(400).json({ 
                    error: 'YA CERRADO', 
                    mensaje: `⛔ EL CIERRE DE HOY YA FUE REALIZADO.` 
                });
            }

            // ✨ LA MAGIA ESTÁ AQUÍ: Si es cierre histórico forzado (tiene fecha), 
            // seteamos "1=1" para eliminar el filtro de fecha de creación de la venta.
            // ¡Traerá TODAS las ventas que sigan sueltas en el sistema!
            const whereFecha = fecha ? "1=1" : "DATE(v.fecha) = CURRENT_DATE";

            const queryRaw = `
                SELECT 
                    p.metodo, 
                    p.moneda,
                    COALESCE(p.monto::numeric, 0) as monto, 
                    COALESCE(p.tasa_cambio::numeric, 0) as tasa,
                    p.id as pago_id,
                    v.id as venta_id
                FROM pagos p 
                JOIN ventas v ON p.venta_id = v.id
                WHERE ${whereFecha}
                  AND NOT EXISTS (
                      SELECT 1 
                      FROM cierres_caja cc,
                      jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                      WHERE cc.detalles_json->'ids_ventas_origen_hoy' IS NOT NULL
                        AND elem::int = v.id
                  )
            `;
            
            const resRaw = await client.query(queryRaw);
            
            if (resRaw.rows.length === 0) {
                return res.json({
                    totales: { usd: "0.00", bs: "0.00", transacciones: 0 },
                    desglose_metodos: [],
                    historial_pagos: [],
                    fecha_referencia: fecha || null,
                    mensaje: "💡 No quedan ventas pendientes de cierre en todo el sistema."
                });
            }

            const resumenMap = {};
            let granTotalUSD = 0;
            let granTotalBs = 0;

            resRaw.rows.forEach(row => {
                const monto = parseFloat(row.monto);
                const tasa = parseFloat(row.tasa);
                const moneda = (row.moneda || 'USD').toUpperCase();

                let montoUsdConvertido = 0;
                let montoBsConvertido = 0;

                if (moneda === 'BS' || moneda === 'BSS' || moneda === 'VES') {
                    montoBsConvertido = monto;
                    montoUsdConvertido = tasa > 0 ? (monto / tasa) : 0;
                } else {
                    montoUsdConvertido = monto;
                    montoBsConvertido = monto * tasa;
                }

                granTotalUSD += montoUsdConvertido;
                granTotalBs += montoBsConvertido;

                const metodo = row.metodo || 'Otros';
                if (!resumenMap[metodo]) {
                    resumenMap[metodo] = { metodo, transacciones: 0, total_usd: 0, total_bs: 0 };
                }
                resumenMap[metodo].transacciones += 1;
                resumenMap[metodo].total_usd += montoUsdConvertido;
                resumenMap[metodo].total_bs += montoBsConvertido;
            });

            // Historial detallado para alimentar las filas de la ventana modal sin restricciones de fecha origen
            const queryDetalle = `
                SELECT 
                    v.id as venta_id,
                    v.fecha as fecha_venta, 
                    p.metodo, 
                    p.moneda,
                    COALESCE(p.monto::numeric, 0) as monto, 
                    COALESCE(p.tasa_cambio::numeric, 0) as tasa,
                    c.nombre as cliente
                FROM pagos p 
                JOIN ventas v ON p.venta_id = v.id
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE ${whereFecha} 
                  AND NOT EXISTS (
                      SELECT 1 
                      FROM cierres_caja cc,
                      jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                      WHERE cc.detalles_json->'ids_ventas_origen_hoy' IS NOT NULL
                        AND elem::int = v.id
                  )
                ORDER BY v.fecha DESC
            `;
            const resDetalles = await client.query(queryDetalle);

            const historialLimpio = resDetalles.rows.map(d => {
                const monto = parseFloat(d.monto);
                const tasa = parseFloat(d.tasa);
                const moneda = (d.moneda || 'USD').toUpperCase();
                
                let monto_bs = 0;
                let monto_usd = 0;

                if (moneda === 'BS' || moneda === 'BSS' || moneda === 'VES') {
                    monto_bs = monto;
                    monto_usd = tasa > 0 ? (monto / tasa) : 0;
                } else {
                    monto_usd = monto;
                    monto_bs = monto * tasa;
                }

                return {
                    ...d,
                    moneda: moneda,
                    monto_bs: monto_bs,
                    monto_usd: monto_usd
                };
            });

            res.json({
                totales: { 
                    usd: granTotalUSD.toFixed(2), 
                    bs: granTotalBs.toFixed(2), 
                    transacciones: resRaw.rows.length 
                },
                desglose_metodos: Object.values(resumenMap),
                historial_pagos: historialLimpio,
                fecha_referencia: fecha || null 
            });

        } finally { client.release(); }
    } catch (error) { 
        console.error("Error calculando cierre:", error); 
        res.status(500).json({ error: 'Error calculando cierre: ' + error.message }); 
    }
};

const forzarCierreManualHistorico = async (req, res) => {
    const client = await pool.connect();
    try {
        const { fecha_manual, observaciones, ids_ventas } = req.body;
        const usuarioOperadorId = req.user ? req.user.id : 1; 

        if (!fecha_manual) {
            return res.status(400).json({ error: 'La fecha histórica es obligatoria.' });
        }

        // ✨ LIBERADO: Si no se seleccionan facturas, creamos un array vacío seguro
        const vIds = Array.isArray(ids_ventas) ? ids_ventas : [];

        await client.query('BEGIN');

        // 1. CANDADO DE RESGUARDO (Máximo 7 cierres por fecha)
        const checkCount = await client.query(`
            SELECT COUNT(*) FROM cierres_caja 
            WHERE DATE(fecha_cierre) = DATE($1)
        `, [fecha_manual]);

        const totalCierresEseDia = parseInt(checkCount.rows[0].count, 10);
        if (totalCierresEseDia >= 7) {
            throw new Error(`🚫 LÍMITE DIARIO SUPERADO: Ya existen ${totalCierresEseDia} cierres guardados para la fecha ${fecha_manual}.`);
        }

        const resumenMap = {};
        let granTotalUSD = 0;
        let granTotalBs = 0;
        const ventasContadas = new Set();

        // ✨ LIBERADO: Solo escaneamos la base de datos si el usuario seleccionó facturas
        if (vIds.length > 0) {
            const queryRaw = `
                SELECT 
                    p.metodo, 
                    p.moneda,
                    COALESCE(p.monto::numeric, 0) as monto, 
                    COALESCE(p.tasa_cambio::numeric, 0) as tasa,
                    v.id as venta_id
                FROM pagos p 
                JOIN ventas v ON p.venta_id = v.id
                WHERE v.id = ANY($1::int[])
                  AND NOT EXISTS (
                      SELECT 1 
                      FROM cierres_caja cc,
                      jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                      WHERE cc.detalles_json->'ids_ventas_origen_hoy' IS NOT NULL
                        AND elem::int = v.id
                  )
            `;
            
            const resRaw = await client.query(queryRaw, [vIds]);
            
            if (resRaw.rows.length === 0) {
                throw new Error(`💡 TODO CERRADO: Las facturas seleccionadas ya fueron procesadas en arqueos anteriores.`);
            }

            resRaw.rows.forEach(row => {
                const monto = parseFloat(row.monto);
                const tasa = parseFloat(row.tasa);
                const moneda = (row.moneda || 'USD').toUpperCase();

                let montoUsdConvertido = 0;
                let montoBsConvertido = 0;

                if (moneda === 'BS' || moneda === 'BSS' || moneda === 'VES') {
                    montoBsConvertido = monto;
                    montoUsdConvertido = tasa > 0 ? (monto / tasa) : 0;
                } else {
                    montoUsdConvertido = monto;
                    montoBsConvertido = monto * tasa;
                }

                granTotalUSD += montoUsdConvertido;
                granTotalBs += montoBsConvertido;
                ventasContadas.add(row.venta_id);

                const metodo = row.metodo || 'Otros';
                if (!resumenMap[metodo]) {
                    resumenMap[metodo] = { metodo, transacciones: 0, total_usd: 0, total_bs: 0 };
                }
                resumenMap[metodo].transacciones += 1;
                resumenMap[metodo].total_usd += montoUsdConvertido;
                resumenMap[metodo].total_bs += montoBsConvertido;
            });
        }

        // Nota inteligente en caso de auditoría en cero
        const notaFinal = vIds.length === 0
            ? (observaciones || `ARQUEO MANUAL EN CERO - DÍA SIN FACTURACIÓN O TIENDA CERRADA (${fecha_manual})`)
            : (observaciones || `CIERRE MANUAL SELECCIONADO EN FECHA (${fecha_manual})`);

        // 3. INSERCIÓN CONTABLE CON LA FECHA HISTÓRICA INDICADA (Soporta $0.00 perfectamente)
        const insertCierre = await client.query(`
            INSERT INTO cierres_caja 
            (usuario_id, total_usd, total_bs, cantidad_ventas, detalles_json, notas, fecha_cierre) 
            VALUES ($1, $2, $3, $4, $5, $6, ($7::date + NOW()::time)) 
            RETURNING id
        `, [
            usuarioOperadorId,
            granTotalUSD.toFixed(2),
            granTotalBs.toFixed(2),
            ventasContadas.size,
            JSON.stringify({ 
                desglose_pagos: Object.values(resumenMap),
                ids_ventas_origen_hoy: Array.from(ventasContadas)
            }),
            notaFinal,
            fecha_manual
        ]);

        await client.query('COMMIT');
        
        res.json({ 
            mensaje: 'Arqueo histórico guardado con éxito y ventas bloqueadas.', 
            id_cierre: insertCierre.rows[0].id,
            ventas_procesadas: ventasContadas.size,
            total_usd_registrado: granTotalUSD.toFixed(2)
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en cierre histórico forzado:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const guardarCierre = async (req, res) => {
    try {
        const { totales, detalles, notas, fecha_referencia } = req.body; 
        const usuario_id = req.user?.id;
        
        const paramCheck = fecha_referencia ? [fecha_referencia] : [];
        const checkSql = fecha_referencia 
            ? "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = $1"
            : "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = CURRENT_DATE";

        // 1. CANDADO DE DUPLICADOS
        const check = await pool.query(checkSql, paramCheck);
        if (check.rows.length > 0) {
            return res.status(400).json({ 
                error: 'DUPLICADO', 
                mensaje: '⛔ ERROR CRÍTICO: Ya existe un cierre registrado para esta fecha.' 
            });
        }

        // Extraemos las IDs de las ventas que el frontend tenía cargadas en el desglose para bloquearlas
        // Si tu frontend no los envía, el sistema buscará las ventas de hoy automáticamente para resguardar la consistencia
        let idsVentas = [];
        if (detalles && detalles.historial_pagos) {
            idsVentas = detalles.historial_pagos.map(p => p.venta_id);
        } else {
            const ventasHoyRes = await pool.query("SELECT id FROM ventas WHERE DATE(fecha) = CURRENT_DATE");
            idsVentas = ventasHoyRes.rows.map(v => v.id);
        }

        const estructuraDetalles = {
            desglose_pagos: detalles.desglose_metodos || detalles,
            ids_ventas_origen_hoy: idsVentas // ✅ Bloqueo integrado en el cierre estándar
        };

        // 2. INSERTAR EL CIERRE ESTÁNDAR
        const insertSql = `
            INSERT INTO cierres_caja 
            (usuario_id, total_usd, total_bs, cantidad_ventas, detalles_json, notas, fecha_cierre) 
            VALUES ($1, $2, $3, $4, $5, $6, ${fecha_referencia ? "($7::date + NOW()::time)" : "NOW()"}) 
            RETURNING id
        `;
        
        const params = [
            usuario_id, totales.usd, totales.bs, totales.transacciones, JSON.stringify(estructuraDetalles), notas
        ];
        
        if (fecha_referencia) params.push(fecha_referencia);

        const result = await pool.query(insertSql, params);
        res.json({ mensaje: 'Cierre guardado exitosamente', id: result.rows[0].id });

    } catch (error) { 
        console.error("Error guardando cierre:", error);
        res.status(500).json({ error: 'Error interno al guardar cierre' }); 
    }
};

const getHistorialCierres = async (req, res) => {
    try {
        const result = await pool.query(`SELECT c.*, u.nombre as usuario FROM cierres_caja c LEFT JOIN usuarios u ON c.usuario_id = u.id ORDER BY c.fecha_cierre DESC LIMIT 30`);
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const descargarCierreExcel = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT c.*, u.nombre as usuario 
            FROM cierres_caja c 
            LEFT JOIN usuarios u ON c.usuario_id = u.id 
            WHERE c.id = $1
        `, [id]);
        
        if (result.rows.length === 0) return res.status(404).send("Cierre no encontrado");
        const cierre = result.rows[0];

        const detalles = cierre.detalles_json || {};
        const desglose = detalles.desglose_pagos || [];

        const totalUsd = parseFloat(cierre.total_usd) || 0;
        const totalBs = parseFloat(cierre.total_bs) || 0;
        const tasaPromedio = totalUsd > 0 ? (totalBs / totalUsd) : 0;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema Corporativo';
        workbook.created = new Date();
        
        // ==========================================
        // HOJA 1: RESUMEN GENERAL
        // ==========================================
        const sheet = workbook.addWorksheet('Resumen de Cierre');
        
        sheet.mergeCells('A1:C1');
        const titleCell = sheet.getCell('A1');
        titleCell.value = `REPORTE DE CIERRE CAJA N° ${String(cierre.id).padStart(6, '0')}`;
        titleCell.font = { size: 14, bold: true, color: { argb: 'FF1E293B' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 25;

        sheet.addRow(['Fecha de Operación:', new Date(cierre.fecha_cierre).toLocaleString()]);
        sheet.addRow(['Usuario Responsable:', cierre.usuario || 'Sistema']);
        sheet.addRow(['Cantidad de Transacciones:', parseInt(cierre.cantidad_ventas) || 0]); 
        sheet.addRow(['Tasa de Cambio Promedio:', tasaPromedio]);
        sheet.addRow(['Observaciones de Cierre:', cierre.notas || 'Sin notas registradas']);
        sheet.addRow([]); 

        sheet.getCell('A2').font = { bold: true }; sheet.getCell('A3').font = { bold: true };
        sheet.getCell('A4').font = { bold: true }; sheet.getCell('A5').font = { bold: true };
        sheet.getCell('A6').font = { bold: true };

        sheet.getCell('B5').numFmt = '#,##0.00'; 

        const rowHead = sheet.addRow(['CONCEPTO FINANCIERO', 'TOTAL INGRESOS (USD)', 'TOTAL INGRESOS (BS)']);
        rowHead.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        rowHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Azul/Gris oscuro
        rowHead.alignment = { horizontal: 'center' };

        const rowData = sheet.addRow(['BALANCE GENERAL DE CAJA', totalUsd, totalBs]);
        rowData.font = { bold: true, size: 12 };
        
        sheet.getColumn(1).width = 35;
        sheet.getColumn(2).width = 25;
        sheet.getColumn(3).width = 25;
        
        sheet.getColumn(2).numFmt = '#,##0.00'; 
        sheet.getColumn(3).numFmt = '#,##0.00';
        sheet.getColumn(2).alignment = { horizontal: 'center' };
        sheet.getColumn(3).alignment = { horizontal: 'center' };

        // ==========================================
        // HOJA 2: DESGLOSE DETALLADO (POR MÉTODO)
        // ==========================================
        if (desglose.length > 0) {
            const sheetDetalle = workbook.addWorksheet('Desglose Transaccional');
            
            sheetDetalle.mergeCells('A1:D1');
            const titleDetalle = sheetDetalle.getCell('A1');
            titleDetalle.value = "DESGLOSE DE TRANSACCIONES POR MÉTODO DE PAGO";
            titleDetalle.font = { size: 12, bold: true, color: { argb: 'FF1E293B' } };
            titleDetalle.alignment = { horizontal: 'center', vertical: 'middle' };
            sheetDetalle.getRow(1).height = 25;

            const headerDetalle = sheetDetalle.addRow(['MÉTODO DE PAGO', 'CANTIDAD DE TRANSACCIONES', 'INGRESO TOTAL (BS)', 'INGRESO TOTAL (USD)']);
            headerDetalle.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerDetalle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; // Gris Azulado
            headerDetalle.alignment = { horizontal: 'center' };

            let countTotal = 0;
            let bsTotal = 0;
            let usdTotal = 0;

            desglose.forEach(d => {
                const qty = parseInt(d.transacciones || d.cantidad_transacciones);
                const bs = parseFloat(d.total_bs || d.bs);
                const usd = parseFloat(d.total_usd || d.usd);

                countTotal += qty; bsTotal += bs; usdTotal += usd;

                const r = sheetDetalle.addRow([
                    d.metodo.toUpperCase(),                     
                    qty,
                    bs,             
                    usd            
                ]);
                r.getCell(1).font = { bold: true };
            });

            // Fila de Totalizador Final en Hoja 2
            const rTotal = sheetDetalle.addRow(['TOTALES GENERALES', countTotal, bsTotal, usdTotal]);
            rTotal.font = { bold: true };
            rTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

            sheetDetalle.columns = [
                { width: 35 }, 
                { width: 30 }, 
                { width: 25 }, 
                { width: 25 }  
            ];
            
            sheetDetalle.getColumn(2).alignment = { horizontal: 'center' };
            sheetDetalle.getColumn(3).numFmt = '#,##0.00';
            sheetDetalle.getColumn(4).numFmt = '#,##0.00';
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Cierre_Corporativo_${id}_${new Date().toISOString().slice(0,10)}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) { 
        console.error("Error Excel Cierre:", error);
        res.status(500).send("Error generando Excel de Cierre"); 
    }
};

const crearVenta = async (req, res) => {
    const client = await pool.connect();
    try {
        const { items, total, cliente_id, pagos, usuario_id, es_externa, descripcion_externa } = req.body;
        const vendedorFinalId = usuario_id ? usuario_id : (req.user ? req.user.id : null);
        
        if (!es_externa && (!items || items.length === 0)) {
            return res.status(400).json({ error: 'El carrito está vacío.' });
        }

        await client.query('BEGIN'); 

        // 1. SEGURIDAD ANTI-FRAUDE
        if (pagos && pagos.length > 0) {
            for (const pago of pagos) {
                const metodo = (pago.metodo || '').toUpperCase();
                const ref = (pago.referencia || '').trim();

                if ((metodo.includes('PAGO') || metodo.includes('TRANSF') || metodo.includes('ZELLE')) && ref.length > 4) {
                    const checkRef = await client.query('SELECT id FROM pagos WHERE referencia = $1 LIMIT 1', [ref]);
                    if (checkRef.rows.length > 0) {
                        throw new Error(`⛔ ALERTA DE FRAUDE: La referencia "${ref}" YA EXISTE.`);
                    }
                }
            }
        }

        // 🔥 2. PROCESAR DESCUENTOS Y VALIDACIONES DE INVENTARIO PRIMERO
        // Si cualquiera de estos lanza un error, el ROLLBACK se ejecutará ANTES de haber creado el ID de venta.
        if (!es_externa) {
            for (const item of items) {
                const cant = parseFloat(item.cantidad);
                const cleanItemId = parseInt(item.id, 10);

                if (item.formula_id) {
                    const formulaRes = await client.query('SELECT * FROM formulas WHERE id = $1', [parseInt(item.formula_id, 10)]);
                    if (formulaRes.rows.length === 0) throw new Error(`Fórmula ID ${item.formula_id} no encontrada.`);
                    const f = formulaRes.rows[0];

                    // A. Esencia
                    const gramosExtra = parseFloat(item.gramos_extra) || 0;
                    const totalEsencia = (parseFloat(f.gramos_esencia) + gramosExtra) * cant;
                    await validarYDescontarEstante(client, cleanItemId, totalEsencia, "Esencia Base");
                    
                    // B. Alcohol
                    if (f.ml_alcohol > 0) {
                        const alcoholUnitario = item.ml_alcohol_override !== undefined && item.ml_alcohol_override !== null 
                                                ? parseFloat(item.ml_alcohol_override) 
                                                : parseFloat(f.ml_alcohol);
                                                
                        const totalAlcohol = alcoholUnitario * cant;
                        
                        if (totalAlcohol > 0) {
                            const alcoholRes = await client.query(`
                                SELECT id, nombre FROM productos 
                                WHERE (nombre ILIKE '%ALCOHOL%' OR categoria = 'Alcohol') 
                                AND activo = true 
                                AND stock_estante >= $1 
                                ORDER BY stock_estante DESC LIMIT 1 FOR UPDATE
                            `, [totalAlcohol]); 
                            
                            if (alcoholRes.rows.length === 0) throw new Error(`🚫 FALTA ALCOHOL: Se requieren ${totalAlcohol.toFixed(2)}ml.`);
                            await validarYDescontarEstante(client, alcoholRes.rows[0].id, totalAlcohol, "Alcohol");
                        }
                    }

                    // C. Fijador
                    if (f.gramos_fijador > 0) {
                        const totalFijador = f.gramos_fijador * cant;
                        const fijadorRes = await client.query(`
                            SELECT id, nombre FROM productos 
                            WHERE (nombre ILIKE '%FIJADOR%' OR categoria = 'Fijador') 
                            AND activo = true 
                            AND stock_estante >= $1 
                            ORDER BY stock_estante DESC LIMIT 1 FOR UPDATE
                        `, [totalFijador]); 

                        if (fijadorRes.rows.length === 0) throw new Error(`🚫 FALTA FIJADOR: Se necesitan ${totalFijador.toFixed(2)}g.`);
                        await validarYDescontarEstante(client, fijadorRes.rows[0].id, totalFijador, "Fijador");
                    }

                    // D. Envase
                    if (!item.es_recarga) {
                        const volumen = parseInt(f.volumen_total);
                        const envaseRes = await client.query(`
                            SELECT id, nombre FROM productos 
                            WHERE (categoria = 'Envases' OR categoria = 'Frascos')
                            AND (nombre ILIKE $1 OR contenido_gramos = $2)
                            AND activo = true 
                            AND stock_estante >= $3 
                            ORDER BY stock_estante DESC LIMIT 1 FOR UPDATE
                        `, [`%${volumen}%`, volumen, cant]);

                        if (envaseRes.rows.length === 0) throw new Error(`🚫 FALTA FRASCO: No hay envases de ${volumen}ml en stock estante.`);
                        await validarYDescontarEstante(client, envaseRes.rows[0].id, cant, `Frasco ${volumen}ml`);
                    } else {
                        console.log(`♻️ RECARGA DETECTADA: Omitiendo descuento de envase para formato de ${f.volumen_total}ml.`);
                    }

                } else {
                    // --- VENTA DIRECTA / MANUAL ---
                    await validarYDescontarEstante(client, cleanItemId, cant, item.descripcion || "Producto");
                }
            }
        }

        // 🔥 3. INSERTAR CABECERA DE VENTA (Solo se ejecuta si TODO el inventario anterior fue exitoso)
        const idTiendaLocal = parseInt(process.env.TIENDA_ID, 10) || 1;

            const ventaRes = await client.query(
                'INSERT INTO ventas (total, cliente_id, fecha, usuario_id, tienda_id) VALUES ($1, $2, NOW(), $3, $4) RETURNING id', 
                [total, cliente_id || 1, vendedorFinalId, idTiendaLocal]
            );

        const ventaId = ventaRes.rows[0].id;

        // 4. INSERTAR DETALLES
        if (!es_externa && items && items.length > 0) {
            const values = [];
            const placeholders = items.map((item, i) => {
                const offset = i * 9; // Ahora son 9 parámetros
                values.push(
                    ventaId, 
                    parseInt(item.id, 10), 
                    item.cantidad, 
                    item.precio, 
                    item.subtotal, 
                    item.descripcion || 'Producto', 
                    item.formula_id || null,
                    item.costo || 0, // <-- NUEVO: Costo histórico
                    item.tarifa || 'DETAL' // <-- NUEVO: Tarifa aplicada
                );
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
            }).join(', ');

            // NOTA: Para no hacer otra query aquí, asegúrate que desde el frontend
            // mandes item.costo (puedes sacarlo de la tabla productos al armar el carrito)
            const queryDetalles = `
                INSERT INTO detalle_ventas 
                 (venta_id, producto_id, cantidad, precio_unitario, subtotal, descripcion, formula_id, costo_unitario_historico, tarifa_aplicada)
                VALUES ${placeholders}
            `;
            
            await client.query(queryDetalles, values);
            
        } else if (es_externa) {
            await client.query(`
                INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, descripcion)
                VALUES ($1, NULL, 1, $2, $3, $4)
            `, [ventaId, total, total, descripcion_externa || 'Venta Externa Registrada']);
        }

        // 5. REGISTRAR PAGOS
        if (pagos && pagos.length > 0) {
            for (const pago of pagos) {
                await client.query(
                    `INSERT INTO pagos (venta_id, metodo, moneda, monto, tasa_cambio, referencia)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [ventaId, pago.metodo, pago.moneda, pago.monto, pago.tasa, pago.referencia]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ mensaje: 'Venta exitosa.', id_venta: ventaId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error venta:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const getReportes = async (req, res) => {

    const tokenNetbird = req.headers['x-mesh-secret'];
    const llaveMaestra = process.env.MESH_SECRET_KEY || 'ZamudioPerfumeriaMesh2026Secret';

    if (tokenNetbird && tokenNetbird === llaveMaestra) {
        console.log("🔒 Consulta autorizada mediante Nodo Seguro NetBird Mesh.");
    } else {
        // Si no viene de la red interna, el sistema sigue su flujo normal de seguridad
        console.log("ℹ️ Consulta de reportes estándar detectada.");
    }


    try {
        const { rango, start, end } = req.query;
        
        let dondeFiltrar = "";
        let queryParams = [];
        let agruparPor = "to_char(v.fecha, 'DD/MM')";

        // Si vienen parámetros de rango personalizado, ejecutamos el filtro estricto
        if (start && end) {
            dondeFiltrar = "WHERE v.fecha::date BETWEEN $1 AND $2";
            queryParams = [start, end];
        } else {
            // Mantenemos intactas tus sentencias e intervalos previos
            let intervalo = "INTERVAL '7 days'";
            if (rango === '30d') {
                intervalo = "INTERVAL '30 days'";
            } else if (rango === '1y') {
                intervalo = "INTERVAL '1 year'";
                agruparPor = "to_char(v.fecha, 'MM/YY')";
            }
            dondeFiltrar = `WHERE v.fecha >= CURRENT_DATE - ${intervalo}`;
        }

        // 1. Historial Financiero
        const historialQuery = `
            SELECT 
                ${agruparPor} as dia,
                SUM(d.subtotal) as venta_bruta,
                SUM(d.cantidad * (
                    CASE 
                        WHEN p.costo >= d.precio_unitario THEN d.precio_unitario * 0.8
                        ELSE p.costo
                    END
                )) as costo_estimado
            FROM ventas v
            JOIN detalle_ventas d ON v.id = d.venta_id
            JOIN productos p ON d.producto_id = p.id
            ${dondeFiltrar}
            GROUP BY dia
            ORDER BY MAX(v.fecha) ASC
        `;
        const historialRes = await pool.query(historialQuery, queryParams);
        
        const financiero = historialRes.rows.map(row => ({
            dia: row.dia,
            ingreso: parseFloat(row.venta_bruta || 0),
            costo: parseFloat(row.costo_estimado || 0),
            utilidad: Math.max(0, parseFloat(row.venta_bruta || 0) - parseFloat(row.costo_estimado || 0))
        }));

        // 2. Categorías
        const categoriasQuery = `
            SELECT p.categoria, SUM(d.subtotal) as total_vendido
            FROM detalle_ventas d
            JOIN productos p ON d.producto_id = p.id
            JOIN ventas v ON d.venta_id = v.id
            ${dondeFiltrar}
            GROUP BY p.categoria
            ORDER BY total_vendido DESC
        `;
        const categoriasRes = await pool.query(categoriasQuery, queryParams);

        // 3. Top Productos
        const topProductos = await pool.query(`
            SELECT p.nombre, SUM(d.cantidad) as total_vendido
            FROM detalle_ventas d 
            JOIN productos p ON p.id = d.producto_id
            JOIN ventas v ON d.venta_id = v.id
            ${dondeFiltrar}
            GROUP BY p.nombre 
            ORDER BY total_vendido DESC 
            LIMIT 5
        `, queryParams);

        // 4. Productos Hueso
        const huesosQuery = `
            SELECT p.nombre, p.stock_unidades, p.precio_venta, p.categoria
            FROM productos p
            WHERE p.stock_unidades > 0 
              AND p.activo = true
              AND p.id NOT IN (
                  SELECT DISTINCT d.producto_id 
                  FROM detalle_ventas d
                  JOIN ventas v ON d.venta_id = v.id
                  ${dondeFiltrar}
              )
            ORDER BY p.stock_unidades DESC
            LIMIT 5
        `;
        const huesosRes = await pool.query(huesosQuery, queryParams);

        res.json({ 
            financiero: financiero, 
            categorias: categoriasRes.rows,
            top_productos: topProductos.rows,
            huesos: huesosRes.rows 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error reportes' });
    }
};

const getReportesConsolidadosRed = async (req, res) => {
    try {
        const { rango, start, end, tiendas } = req.query; // 'tiendas' puede ser un array de IDs, ej: [1,2]
        
        // 1. Mapa de IPs fijas que NetBird le da a cada una de tus computadoras
        // NOTA: Modifica estas IPs con las reales que te arroje tu panel de NetBird
        const mapaTiendasNetBird = {
            '1': { nombre: 'Sucursal Centro (T1)', url: 'http://localhost:3010' }, // Tu PC actual (Local)
            '2': { nombre: 'Sucursal Norte (T2)', url: 'http://10.241.0.5:3010' }, // IP NetBird de la Tienda 2
            '3': { nombre: 'Sucursal Reserva (T3)', url: 'http://10.241.0.9:3010' }  // IP NetBird de la Tienda 3
        };

        // Si el usuario no mandó tiendas específicas, consultamos todo el mapa disponible
        const idsAConsultar = tiendas ? (Array.isArray(tiendas) ? tiendas : [tiendas]) : Object.keys(mapaTiendasNetBird);
        
        // Replicamos los filtros de fechas para enviárselos a las otras tiendas
        const queryParams = new URLSearchParams({ rango, start, end }).toString();
        const llaveMaestra = process.env.MESH_SECRET_KEY || 'ZamudioPerfumeriaMesh2026Secret';

        // 2. Disparar consultas en paralelo a todas las PCs a través del túnel de NetBird
        const promesasConsultas = idsAConsultar.map(async (id) => {
            const tiendaConfig = mapaTiendasNetBird[id];
            if (!tiendaConfig) return { id, nombre: 'Desconocida', error: 'No configurada' };

            // Ponemos un temporizador de 4 segundos. Si la PC está apagada, no se queda colgado el sistema
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            try {
                const respuesta = await fetch(`${tiendaConfig.url}/api/ventas/reportes?${queryParams}`, {
                    signal: controller.signal,
                    headers: {
                        'x-mesh-secret': llaveMaestra // Enviamos la llave para pasar la seguridad
                    }
                });

                clearTimeout(timeoutId);
                if (!respuesta.ok) throw new Error(`HTTP Error ${respuesta.status}`);
                
                const datosReporte = await respuesta.json();
                return { id, nombre: tiendaConfig.nombre, disponible: true, data: datosReporte };

            } catch (err) {
                clearTimeout(timeoutId);
                return { id, nombre: tiendaConfig.nombre, disponible: false, error: 'Fuera de línea (Timeout)' };
            }
        });

        // Esperamos que terminen todas las consultas (las que respondieron y las que dieron timeout)
        const resultadosNodos = await Promise.all(promesasConsultas);

        // 3. Estructura base para unir toda la información de la red
        const consolidadoFinal = {
            financiero: {},    // Uniremos los días (ingreso, costo, utilidad)
            categorias: {},    // Sumaremos totales por categoría
            top_productos: {}, // Sumaremos el top de perfumes más vendidos
            estado_red: []     // Lista para saber en el frontend qué tiendas respondieron y cuáles no
        };

        // 4. Procesar y fusionar los datos que llegaron vivos
        resultadosNodos.forEach(nodo => {
            consolidadoFinal.estado_red.push({ 
                id: nodo.id, 
                nombre: nodo.nombre, 
                disponible: nodo.disponible, 
                error: nodo.error || null 
            });

            if (!nodo.disponible) return; // Si la tienda estaba apagada, la saltamos

            const { financiero, categorias, top_productos } = nodo.data;

            // Fusión del gráfico financiero diario
            if (Array.isArray(financiero)) {
                financiero.forEach(item => {
                    if (!consolidadoFinal.financiero[item.dia]) {
                        consolidadoFinal.financiero[item.dia] = { dia: item.dia, ingreso: 0, costo: 0, utilidad: 0 };
                    }
                    consolidadoFinal.financiero[item.dia].ingreso += item.ingreso;
                    consolidadoFinal.financiero[item.dia].costo += item.costo;
                    consolidadoFinal.financiero[item.dia].utilidad += item.utilidad;
                });
            }

            // Acumulación de ventas por categorías de productos
            if (Array.isArray(categorias)) {
                categorias.forEach(cat => {
                    const nombreCat = cat.categoria || 'Sin Categoría';
                    if (!consolidadoFinal.categorias[nombreCat]) {
                        consolidadoFinal.categorias[nombreCat] = { categoria: nombreCat, total_vendido: 0 };
                    }
                    consolidadoFinal.categorias[nombreCat].total_vendido += parseFloat(cat.total_vendido || 0);
                });
            }

            // Acumulación de unidades en el Top de productos
            if (Array.isArray(top_productos)) {
                top_productos.forEach(prod => {
                    if (!consolidadoFinal.top_productos[prod.nombre]) {
                        consolidadoFinal.top_productos[prod.nombre] = { nombre: prod.nombre, total_vendido: 0 };
                    }
                    consolidadoFinal.top_productos[prod.nombre].total_vendido += parseInt(prod.total_vendido || 0);
                });
            }
        });

        // Convertimos los mapas ordenados a los arrays estándar que espera recibir tu frontend
        res.json({
            financiero: Object.values(consolidadoFinal.financiero),
            categorias: Object.values(consolidadoFinal.categorias).sort((a,b) => b.total_vendido - a.total_vendido),
            top_productos: Object.values(consolidadoFinal.top_productos).sort((a,b) => b.total_vendido - a.total_vendido).slice(0, 5),
            estado_red: consolidadoFinal.estado_red
        });

    } catch (error) {
        console.error("Error consolidando red:", error);
        res.status(500).json({ error: 'Error unificando reportes de red mesh: ' + error.message });
    }
};

const distribuirLoteEstante = async (req, res) => {
    const client = await pool.connect();
    try {
        const { lote, destino, fila } = req.body; // lote: [{id, cantidad}, ...]
        
        if (!lote || lote.length === 0 || !destino || !fila) {
            return res.status(400).json({ error: 'Datos del lote incompletos.' });
        }

        await client.query('BEGIN');

        for (const item of lote) {
            const { id, cantidad } = item;

            // Cambiamos el estado, la ubicación y el piso de cada botella en el estante
            await client.query(`
                UPDATE botellas_estante 
                SET ubicacion = $1, fila = $2, estado = 'ABIERTA'
                WHERE id = $3
            `, [destino, fila, id]);
        }

        await client.query('COMMIT');
        res.json({ mensaje: 'Lote distribuido con éxito en los estantes.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error distribuyendo lote de estantes:", error);
        res.status(500).json({ error: 'Error interno en servidor: ' + error.message });
    } finally {
        client.release();
    }
};

const getDashboardKPIs = async (req, res) => {
    try {
        const { rango, start, end } = req.query; // Capturamos start y end para el rango personalizado
        
        let whereClause = "";
        let prevWhereClause = "";
        let queryParams = [];

        // 1. Manejo del Rango Personalizado
        if (rango === 'custom' && start && end) {
            whereClause = "fecha::date BETWEEN $1::date AND $2::date";
            // Matemática pura en SQL: Restamos la duración del rango actual para obtener el período anterior equivalente
            prevWhereClause = "fecha::date BETWEEN $1::date - ($2::date - $1::date + 1) AND $1::date - 1";
            queryParams = [start, end];
        } else {
            // 2. Tu lógica original intacta para rangos fijos
            let intervaloActual = "CURRENT_DATE"; 
            let intervaloPrevio = "CURRENT_DATE - INTERVAL '1 day'";
            let usarFiltroRango = false;
            
            if (rango === '7d') {
                intervaloActual = "INTERVAL '7 days'";
                intervaloPrevio = "INTERVAL '14 days'";
                usarFiltroRango = true;
            } else if (rango === '30d') {
                intervaloActual = "INTERVAL '30 days'";
                intervaloPrevio = "INTERVAL '60 days'";
                usarFiltroRango = true;
            } else if (rango === '1y') {
                intervaloActual = "INTERVAL '1 year'";
                intervaloPrevio = "INTERVAL '2 years'";
                usarFiltroRango = true;
            }

            if (usarFiltroRango) {
                whereClause = `fecha >= CURRENT_DATE - ${intervaloActual}`;
                prevWhereClause = `fecha >= CURRENT_DATE - ${intervaloPrevio} AND fecha < CURRENT_DATE - ${intervaloActual}`;
            } else {
                // Default: Hoy / Ventas de las últimas 24 horas
                whereClause = "DATE(fecha) = CURRENT_DATE";
                prevWhereClause = "DATE(fecha) = CURRENT_DATE - 1";
            }
        }

        // Resumen de Inventario (Estático, no depende del tiempo)
        const inventoryQuery = `
            SELECT 
                (SELECT COUNT(*) FROM productos WHERE activo = true) AS total_productos,
                (SELECT COALESCE(SUM(stock_unidades * costo), 0) FROM productos WHERE activo = true) AS valor_total_venta
        `;
        const inventorySummary = await pool.query(inventoryQuery);

        // Ventas Comparativas (Inyectando los parámetros de forma segura si existen)
        const salesQuery = `
            SELECT 
                (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE ${whereClause}) as ventas_hoy,
                (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE ${prevWhereClause}) as ventas_ayer,
                (SELECT COUNT(*) FROM ventas WHERE ${whereClause}) as transacciones_hoy
        `;
        const salesData = await pool.query(salesQuery, queryParams);

        // Alertas de Stock Mínimo
        const lowStockCount = await pool.query(`
            SELECT COUNT(id) AS low_stock_count FROM productos WHERE stock_unidades <= stock_minimo AND activo = true
        `);

        res.json({
            inventory: inventorySummary.rows[0],
            sales: salesData.rows[0],
            lowStock: lowStockCount.rows[0]
        });
    } catch (error) {
        console.error("Error KPIs:", error);
        res.status(500).json({ error: 'Error KPIs' });
    }
};

const getFacturaPDF = async (req, res) => {
    const { id } = req.params;
    try {
        // Datos Venta y Cliente
        const ventaRes = await pool.query(`
            SELECT v.*, c.nombre as c_nombre, c.documento as c_doc, c.direccion as c_dir, c.telefono as c_tel
            FROM ventas v JOIN clientes c ON v.cliente_id = c.id WHERE v.id = $1
        `, [id]);
        if (ventaRes.rows.length === 0) return res.status(404).send('Venta no encontrada');
        const venta = ventaRes.rows[0];

        // Datos Items
        const itemsRes = await pool.query(`
            SELECT d.* FROM detalle_ventas d WHERE d.venta_id = $1
        `, [id]);
        const items = itemsRes.rows;

        // Configuración PDF
        const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Nota_Entrega_${id}.pdf`);
        doc.pipe(res);

        // --- ENCABEZADO ---
        doc.font('Helvetica-Bold').fontSize(16).text('TU EMPRESA C.A.', 40, 40);
        doc.fontSize(10).font('Helvetica').text('RIF: J-12345678-9', 40, 60);
        doc.text('Dirección: Av. Principal, Local 1, Ciudad.', 40, 72);
        doc.text('Teléfono: 0412-1234567', 40, 84);

        // --- CAJA NOTA DE ENTREGA ---
        doc.rect(400, 40, 170, 50).stroke();
        doc.font('Helvetica-Bold').fontSize(12).text('NOTA DE ENTREGA', 400, 50, { width: 170, align: 'center' });
        doc.fillColor('red').text(`N° ${String(venta.id).padStart(6, '0')}`, 400, 65, { width: 170, align: 'center' });
        doc.fillColor('black').fontSize(9).text(`FECHA: ${new Date(venta.fecha).toLocaleDateString('es-VE')}`, 400, 80, { width: 170, align: 'center' });

        // --- DATOS DEL CLIENTE ---
        doc.moveDown(4);
        const yCliente = 120;
        doc.rect(40, yCliente, 530, 45).stroke();
        
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('RAZÓN SOCIAL:', 45, yCliente + 10);
        doc.text('CI / RIF:', 350, yCliente + 10);
        doc.text('DIRECCIÓN:', 45, yCliente + 25);
        
        doc.font('Helvetica');
        doc.text(venta.c_nombre.toUpperCase(), 125, yCliente + 10);
        doc.text(venta.c_doc, 400, yCliente + 10);
        doc.text(venta.c_dir || 'No especificada', 125, yCliente + 25);

        // --- TABLA DE PRODUCTOS ---
        const yTabla = 180;
        doc.rect(40, yTabla, 530, 20).fill('#f0f0f0').stroke();
        doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
        doc.text('CANT', 50, yTabla + 6);
        doc.text('DESCRIPCIÓN DEL PRODUCTO', 100, yTabla + 6);
        doc.text('P. UNIT (BASE)', 400, yTabla + 6, { width: 60, align: 'right' }); // Cambié etiqueta a Base
        doc.text('TOTAL (BASE)', 480, yTabla + 6, { width: 50, align: 'right' });

        let y = yTabla + 25;
        doc.font('Helvetica').fontSize(10);

        items.forEach(item => {
            // AQUÍ ESTÁ LA SOLUCIÓN: 
            // Tu precio guardado ($6) es el final. 
            // Dividimos entre 1.16 para mostrar la base ($5.17) en la tabla.
            
            const precioFinalUnitario = parseFloat(item.precio_unitario);
            const precioBaseUnitario = precioFinalUnitario / 1.16; 

            const subtotalFinal = parseFloat(item.subtotal);
            const subtotalBase = subtotalFinal / 1.16;

            doc.text(item.cantidad, 50, y);
            doc.text(item.descripcion, 100, y, { width: 280 }); 
            
            // Mostramos el precio DESGLOSADO (sin IVA)
            doc.text(precioBaseUnitario.toFixed(2), 400, y, { width: 60, align: 'right' });
            doc.text(subtotalBase.toFixed(2), 480, y, { width: 50, align: 'right' });
            
            y += 15;
        });

        doc.moveTo(40, y).lineTo(570, y).stroke();

        // --- CÁLCULO DE TOTALES (INVERSO) ---
        y += 10;
        
        // 1. Tomamos el total que el cliente pagó (ej: $6.00)
        const totalPagar = parseFloat(venta.total);

        // 2. Desglosamos hacia atrás
        const baseImponible = totalPagar / 1.16; // $6.00 / 1.16 = $5.17
        const iva = totalPagar - baseImponible;  // $6.00 - $5.17 = $0.83

        // 3. Mostramos los datos
        doc.font('Helvetica-Bold');
        doc.text('BASE IMPONIBLE:', 350, y, { width: 100, align: 'right' });
        doc.font('Helvetica').text(baseImponible.toFixed(2), 460, y, { width: 70, align: 'right' });
        
        y += 15;
        doc.font('Helvetica-Bold');
        doc.text('I.V.A (16%):', 350, y, { width: 100, align: 'right' });
        doc.font('Helvetica').text(iva.toFixed(2), 460, y, { width: 70, align: 'right' });

        y += 15;
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('TOTAL A PAGAR:', 350, y, { width: 100, align: 'right' });
        // Aquí mostramos el precio original de tu fórmula (ej: $6.00)
        doc.text(totalPagar.toFixed(2), 460, y, { width: 70, align: 'right' });

        // Pie de página
        doc.fontSize(8).font('Helvetica-Oblique');
        doc.text('Sin derecho a crédito fiscal.', 40, 700, { align: 'center', width: 530 });

        doc.end();

    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).send('Error generando PDF');
    }
};

const getFacturaExcel = async (req, res) => {
    const { id } = req.params;
    try {
        // A. Obtener datos de la venta y detalles (incluye el lote para la trazabilidad)
        const ventaRes = await pool.query('SELECT * FROM ventas WHERE id = $1', [id]);
        if (ventaRes.rows.length === 0) return res.status(404).send('Venta no encontrada');
        const venta = ventaRes.rows[0];

        const itemsRes = await pool.query(`
            SELECT 
                d.cantidad, 
                p.codigo, 
                p.nombre, 
                p.marca, 
                p.tamano,
                p.categoria,
                d.precio_unitario, 
                d.subtotal,
                l.codigo_lote,
                l.fecha_vencimiento
            FROM detalle_ventas d
            JOIN productos p ON d.producto_id = p.id
            JOIN lotes l ON d.lote_id = l.id
            WHERE d.venta_id = $1
        `, [id]);
        const items = itemsRes.rows;

        // B. Crear el contenido CSV
        let csvContent = `Factura ID,${venta.id}\n`;
        csvContent += `Fecha,${new Date(venta.fecha).toLocaleString('es-ES')}\n`;
        csvContent += `Total,$${parseFloat(venta.total).toFixed(2)}\n\n`;
        
        // Cabeceras de la tabla
        const headers = [
            'Cantidad', 'Codigo Producto', 'Nombre', 'Marca', 'Tamaño', 'Categoría',
            'Precio Unitario ($)', 'Subtotal ($)', 'Lote Venta', 'Fecha Vencimiento Lote'
        ];
        csvContent += headers.join(',') + '\n';
        
        // Filas de datos
        items.forEach(item => {
            const row = [
                item.cantidad,
                item.codigo,
                `"${item.nombre.replace(/"/g, '""')}"`, // Escapar comillas para nombres
                item.marca,
                item.tamano,
                item.categoria,
                parseFloat(item.precio_unitario).toFixed(2),
                parseFloat(item.subtotal).toFixed(2),
                item.codigo_lote,
                item.fecha_vencimiento ? new Date(item.fecha_vencimiento).toLocaleDateString('es-ES') : ''
            ];
            csvContent += row.join(',') + '\n';
        });

        // C. Configurar headers para la descarga como Excel/CSV
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=factura_detalle_${id}.csv`);
        res.send(csvContent);

    } catch (error) {
        console.error("Error generando Factura Excel (CSV):", error);
        res.status(500).send('Error generando Factura Excel/CSV');
    }
};

const getVentas = async (req, res) => {
    try {
        // Obtenemos los parámetros de la URL
        const { page = 1, limit = 15, fecha, busqueda } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        let paramIndex = 1;

        // Construcción dinámica del WHERE
        let whereClause = "WHERE 1=1";

        if (fecha) {
            whereClause += ` AND DATE(v.fecha) = $${paramIndex}`;
            params.push(fecha);
            paramIndex++;
        }

        if (busqueda) {
            whereClause += ` AND (c.nombre ILIKE $${paramIndex} OR CAST(v.id AS TEXT) ILIKE $${paramIndex})`;
            params.push(`%${busqueda}%`);
            paramIndex++;
        }

        // Consulta Principal con Paginación
        const query = `
            SELECT 
                v.id, 
                v.fecha, 
                v.total, 
                c.nombre as cliente_nombre,
                (SELECT COUNT(id) FROM pagos p WHERE p.venta_id = v.id) as cant_pagos,
                COALESCE((SELECT p.metodo FROM pagos p WHERE p.venta_id = v.id ORDER BY p.monto DESC LIMIT 1), 'Sin Pago') as metodo_pago,
                COALESCE((SELECT p.tasa_cambio FROM pagos p WHERE p.venta_id = v.id ORDER BY p.monto DESC LIMIT 1), 0) as tasa_cambio,
                COUNT(*) OVER() as total_count 
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            ${whereClause}
            ORDER BY v.fecha DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        params.push(limit, offset);

        const response = await pool.query(query, params);
        
        // Calcular total de páginas
        const totalItems = response.rows.length > 0 ? parseInt(response.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalItems / limit);

        res.json({
            data: response.rows,
            pagination: {
                totalItems,
                totalPages,
                currentPage: parseInt(page),
                itemsPerPage: parseInt(limit)
            }
        });

    } catch (error) {
        console.error("Error obteniendo ventas:", error);
        res.status(500).json({ error: error.message });
    }
};

const getVentaById = async (req, res) => {
    const { id } = req.params;
    try {
        // Buscamos la cabecera de la venta
        // SE AGREGÓ: La línea que busca 'p.referencia'
        const ventaQuery = `
            SELECT 
                v.id, 
                v.fecha, 
                v.total, 
                c.nombre as cliente_nombre, 
                u.nombre as usuario_nombre,
                (SELECT COUNT(id) FROM pagos p WHERE p.venta_id = v.id) as cant_pagos,
                COALESCE((SELECT p.metodo FROM pagos p WHERE p.venta_id = v.id ORDER BY p.monto DESC LIMIT 1), 'Sin Pago') as metodo_pago,
                COALESCE((SELECT p.tasa_cambio FROM pagos p WHERE p.venta_id = v.id ORDER BY p.monto DESC LIMIT 1), 0) as tasa_cambio,
                COALESCE((SELECT p.referencia FROM pagos p WHERE p.venta_id = v.id ORDER BY p.monto DESC LIMIT 1), '') as referencia
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN usuarios u ON v.usuario_id = u.id
            WHERE v.id = $1
        `;
        const ventaRes = await pool.query(ventaQuery, [id]);

        if (ventaRes.rows.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const detallesQuery = `
            SELECT 
                d.cantidad, 
                d.precio_unitario, 
                d.subtotal,
                p.nombre as producto_nombre,
                CASE WHEN d.formula_id IS NOT NULL THEN true ELSE false END as es_preparado
            FROM detalle_ventas d
            JOIN productos p ON d.producto_id = p.id
            WHERE d.venta_id = $1
        `;
        const detallesRes = await pool.query(detallesQuery, [id]);

        res.json({
            venta: ventaRes.rows[0],
            detalles: detallesRes.rows
        });

    } catch (error) {
        console.error("Error buscando detalle venta:", error);
        res.status(500).json({ error: error.message });
    }
};

const guardarBorradorCombo = async (req, res) => {
    try {
        const { nombre_identificador, formula_id, items } = req.body;
        
        if (!nombre_identificador || !formula_id || !items || items.length === 0) {
            return res.status(400).json({ error: 'Datos incompletos para guardar el pedido.' });
        }

        const query = `
            INSERT INTO pedidos_borradores (nombre_identificador, formula_id, items_json) 
            VALUES ($1, $2, $3) RETURNING id
        `;
        const result = await pool.query(query, [nombre_identificador.toUpperCase(), formula_id, JSON.stringify(items)]);
        
        res.json({ mensaje: 'Pedido guardado con éxito', id: result.rows[0].id });
    } catch (error) {
        console.error("Error guardando borrador:", error);
        res.status(500).json({ error: 'Error del servidor al guardar pedido.' });
    }
};

const obtenerBorradoresPorFormula = async (req, res) => {
    try {
        const { formulaId } = req.params;
        const query = `
            SELECT id, nombre_identificador, items_json, TO_CHAR(fecha_creacion, 'DD/MM/YYYY HH12:MI AM') as fecha
            FROM pedidos_borradores 
            WHERE formula_id = $1 
            ORDER BY fecha_creacion DESC
        `;
        const result = await pool.query(query, [formulaId]);
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo borradores:", error);
        res.status(500).json({ error: 'Error al buscar pedidos guardados.' });
    }
};

const eliminarBorradorCombo = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM pedidos_borradores WHERE id = $1', [id]);
        res.json({ mensaje: 'Borrador eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar el pedido.' });
    }
};

const bajarInventarioAEstanteMasa = async (req, res) => {
    const client = await pool.connect();
    try {
        const { producto_id, cantidad_botellas, destino, fila } = req.body;
        
        const pId = parseInt(producto_id, 10);
        const cantBotellas = parseInt(cantidad_botellas, 10);

        if (isNaN(pId) || isNaN(cantBotellas) || cantBotellas <= 0 || !destino || !fila) {
            return res.status(400).json({ error: 'Información incompleta para mover mercancía.' });
        }

        await client.query('BEGIN');

        // 1. Obtener los datos del producto y bloquear la fila para evitar inconsistencias
        const prodRes = await client.query(
            'SELECT id, nombre, stock_unidades, stock_estante, contenido_gramos FROM productos WHERE id = $1 FOR UPDATE',
            [pId]
        );

        if (prodRes.rows.length === 0) {
            throw new Error('El producto seleccionado no existe.');
        }

        const prod = prodRes.rows[0];
        const stockDepositoActual = parseFloat(prod.stock_unidades || 0);

        // Validar si hay suficientes cajas/unidades en el depósito general
        if (stockDepositoActual < cantBotellas) {
            throw new Error(`Stock insuficiente en Depósito. Solo quedan ${stockDepositoActual} unidades disponibles.`);
        }

        const capacidadBotella = parseFloat(prod.contenido_gramos) || 1000;
        const gramosAIncrementar = cantBotellas * capacidadBotella;

        // 2. Descontar del depósito e incrementar en el estante de mostrador
        await client.query(`
            UPDATE productos 
            SET stock_unidades = stock_unidades - $1,
                stock_estante = stock_estante + $2
            WHERE id = $3
        `, [cantBotellas, gramosAIncrementar, pId]);

        // 3. Sembrar de forma masiva las N botellas en la tabla física de estantes
        for (let i = 0; i < cantBotellas; i++) {
            await client.query(`
                INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado)
                VALUES ($1, $2, 100, $3, $4, 'ABIERTA')
            `, [pId, capacidadBotella, destino, fila]);
        }

        await client.query('COMMIT');
        res.json({ mensaje: `¡Éxito! Se movieron ${cantBotellas} botellas de ${prod.nombre} al Estante ${destino} (Nivel ${fila}).` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error bajando mercancía a estante:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const bajarInventarioLoteCompleto = async (req, res) => {
    const client = await pool.connect();
    try {
        const { ids } = req.body;
        
        if (!ids || ids.length === 0) {
            return res.status(400).json({ error: 'No seleccionaste ningún artículo.' });
        }

        await client.query('BEGIN');

        const prodsRes = await client.query(
            `SELECT id, nombre, stock_unidades, contenido_gramos 
              FROM productos 
              WHERE id = ANY($1) AND stock_unidades > 0 FOR UPDATE`,
            [ids]
        );

        if (prodsRes.rows.length === 0) {
            throw new Error('Ninguno de los artículos seleccionados tiene stock en el depósito.');
        }

        let totalBotellasCreadas = 0;
        const BATCH_SIZE = 200; 

        for (const prod of prodsRes.rows) {
    const pId = prod.id;
    
    // --- CORRECCIÓN AQUÍ: Cálculo basado en gramos ---
    const totalStock = parseFloat(prod.stock_unidades) || 0;
    const capacidadBotella = parseFloat(prod.contenido_gramos) || 1000; // Por defecto 1000 si no hay dato
    
    // Si no hay capacidad definida, el sistema no puede saber cuántas botellas salen
    if (capacidadBotella <= 0) continue; 
    
    const cantBotellas = Math.floor(totalStock / capacidadBotella);
    
    if (cantBotellas <= 0) continue; // Si no alcanza ni para una, salta al siguiente

    const gramosAIncrementar = cantBotellas * capacidadBotella;

    // Vaciar depósito (lo que sobró se queda en stock_unidades, 
    // pero aquí vaciamos todo lo usado para las botellas)
    await client.query(`
        UPDATE productos 
        SET stock_unidades = stock_unidades - $1,
            stock_estante = stock_estante + $2
        WHERE id = $3
    `, [gramosAIncrementar, gramosAIncrementar, pId]);

            // INSERCIÓN POR LOTES (BATCHING)
            for (let i = 0; i < cantBotellas; i += BATCH_SIZE) {
                const end = Math.min(i + BATCH_SIZE, cantBotellas);
                const batchValues = [];
                const placeholders = [];
                
                let paramIndex = 1;
                for (let j = i; j < end; j++) {
                    batchValues.push(pId, capacidadBotella, 100, 'PENDIENTE', 0, 'CERRADA');
                    placeholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5})`);
                    paramIndex += 6;
                }

                await client.query(`
                    INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado)
                    VALUES ${placeholders.join(', ')}
                `, batchValues);
            }

            totalBotellasCreadas += cantBotellas;
            
            // Historial (Ahora usa gramosAIncrementar correctamente)
            await client.query(`
                INSERT INTO historial_movimientos 
                 (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
                VALUES ($1, 'TRASLADO', $2, 0, 'Vaciado Masivo a Recepción', NOW())
            `, [pId, gramosAIncrementar]);
        }

        await client.query('COMMIT');
        res.json({ mensaje: `¡Procesado! Se enviaron ${totalBotellasCreadas} unidades a PENDIENTES.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en vaciado masivo:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const anularVentaDefinitiva = async (req, res) => {
    const { id } = req.params;
    const { motivo } = req.body;
    
    const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase() : '';
    if (rolUsuario !== 'developer' && rolUsuario !== 'dev') {
        return res.status(403).json({ error: 'Acceso Denegado. Solo privilegios Dev.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener la cabecera de la venta original
        const ventaRes = await client.query('SELECT v.*, c.nombre as cliente_nombre FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id WHERE v.id = $1', [id]);
        if (ventaRes.rows.length === 0) throw new Error('La factura seleccionada no existe en el sistema.');
        const venta = ventaRes.rows[0];

        // 2. Traer los detalles y los pagos asociados
        const detallesRes = await client.query('SELECT * FROM detalle_ventas WHERE venta_id = $1', [id]);
        const pagosRes = await client.query('SELECT * FROM pagos WHERE venta_id = $1', [id]);

        // 3. Procesar ítem por ítem para devolver los insumos exactos
        for (const item of detallesRes.rows) {
            const cant = parseFloat(item.cantidad);
            const desc = item.descripcion || '';

            if (item.formula_id) {
                // Es un perfume preparado: leemos su fórmula exacta
                const fRes = await client.query('SELECT * FROM formulas WHERE id = $1', [item.formula_id]);
                if (fRes.rows.length === 0) continue;
                const f = fRes.rows[0];

                const esRecarga = desc.includes('REC');
                let gramosExtra = 0;
                
                // Capturar gramos extra de la descripción de forma segura
                const extraMatch = desc.match(/\(\+(\d+(?:\.\d+)?)g Ext\)/);
                if (extraMatch) gramosExtra = parseFloat(extraMatch[1]);

                // A. REVERSIÓN DE LA ESENCIA (Usa el producto_id directo de la venta: ID 35)
                const totalEsencia = (parseFloat(f.gramos_esencia) + gramosExtra) * cant;
                await devolverAEstanteFisico(client, item.producto_id, totalEsencia);

                // B. REVERSIÓN DEL ALCOHOL (Busca el alcohol que está asignado en piso/mostrador)
                if (f.ml_alcohol > 0) {
                    const totalAlcohol = Math.max(0, parseFloat(f.ml_alcohol) - gramosExtra) * cant;
                    if (totalAlcohol > 0) {
                        // Buscamos cualquier producto que en su nombre tenga 'ALCOHOL' sin importar la categoría
                        const alcRes = await client.query(`SELECT id FROM productos WHERE nombre ILIKE '%ALCOHOL%' AND activo = true ORDER BY stock_estante DESC LIMIT 1`);
                        if (alcRes.rows.length > 0) {
                            await devolverAEstanteFisico(client, alcRes.rows[0].id, totalAlcohol);
                        }
                    }
                }

                // C. REVERSIÓN DEL FIJADOR
                if (f.gramos_fijador > 0) {
                    const totalFijador = parseFloat(f.gramos_fijador) * cant;
                    const fijRes = await client.query(`SELECT id FROM productos WHERE nombre ILIKE '%FIJADOR%' AND activo = true ORDER BY stock_estante DESC LIMIT 1`);
                    if (fijRes.rows.length > 0) {
                        await devolverAEstanteFisico(client, fijRes.rows[0].id, totalFijador);
                    }
                }

                // D. REVERSIÓN DEL ENVASE / FRASCO (Solo si no fue marcado como recarga limpia)
                if (!esRecarga) {
                    // Buscamos el envase que coincida con los mililitros de la fórmula (Ej: 30ml)
                    const envRes = await client.query(`
                        SELECT id FROM productos 
                        WHERE (nombre ILIKE $1 OR contenido_gramos = $2) 
                          AND activo = true 
                        ORDER BY stock_estante DESC LIMIT 1
                    `, [`%${f.volumen_total}%`, f.volumen_total]);
                    
                    if (envRes.rows.length > 0) {
                        await devolverAEstanteFisico(client, envRes.rows[0].id, cant);
                    }
                }
            } else if (item.producto_id) {
                // Es un producto de venta directa manual
                await devolverAEstanteFisico(client, item.producto_id, cant);
            }
        }

        // 4. Registrar en la Bóveda de Auditoría de Anulaciones
        await client.query(`
            INSERT INTO ventas_anuladas (venta_original_id, fecha_venta, usuario_anula_id, cliente_nombre, total_venta, detalles_json, pagos_json, motivo, venta_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [venta.id, venta.fecha, req.user.id, venta.cliente_nombre, venta.total, JSON.stringify(detallesRes.rows), JSON.stringify(pagosRes.rows), motivo, JSON.stringify(venta)]);

        // 5. Eliminar el registro original de la base de datos activa
        await client.query('DELETE FROM pagos WHERE venta_id = $1', [id]);
        await client.query('DELETE FROM detalle_ventas WHERE venta_id = $1', [id]);
        await client.query('DELETE FROM ventas WHERE id = $1', [id]);

        await client.query('COMMIT');
        res.json({ mensaje: 'Protocolo completado. Factura purgada e insumos restablecidos visualmente en los estantes.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Fallo crítico en anulación:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

const restaurarVentaAnulada = async (req, res) => {
    const { idBoveda } = req.params;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. Obtener la información desde la bóveda de seguridad
        const vaultRes = await client.query('SELECT * FROM ventas_anuladas WHERE id = $1', [idBoveda]);
        if (vaultRes.rows.length === 0) throw new Error('El registro especificado no existe en la bóveda de respaldo.');
        const vault = vaultRes.rows[0];

        const ventaData = typeof vault.venta_json === 'string' ? JSON.parse(vault.venta_json) : vault.venta_json;
        const detalles = typeof vault.detalles_json === 'string' ? JSON.parse(vault.detalles_json) : vault.detalles_json;
        const pagos = typeof vault.pagos_json === 'string' ? JSON.parse(vault.pagos_json) : vault.pagos_json;

        // 🛡️ MEDIDA DE SEGURIDAD INTERNA: Verificar existencias antes de re-descontar
        for (const item of detalles) {
            const cant = parseFloat(item.cantidad);
            if (item.formula_id) {
                const fRes = await client.query('SELECT * FROM formulas WHERE id = $1', [item.formula_id]);
                if (fRes.rows.length === 0) throw new Error(`Fórmula base descontinuada o eliminada.`);
                const f = fRes.rows[0];
                
                let gramosExtra = 0;
                const extraMatch = item.descripcion.match(/\(\+(\d+(?:\.\d+)?)g Ext\)/);
                if (extraMatch) gramosExtra = parseFloat(extraMatch[1]);

                const totalEsencia = (parseFloat(f.gramos_esencia) + gramosExtra) * cant;

                // Validar si hay stock en estante para volver a cobrar
                const stockCheck = await client.query('SELECT stock_estante, nombre FROM productos WHERE id = $1', [item.producto_id]);
                if (stockCheck.rows.length === 0 || parseFloat(stockCheck.rows[0].stock_estante) < totalEsencia) {
                    throw new Error(`🚫 CANDADO DE SEGURIDAD: Insumos insuficientes para restaurar. El producto "${stockCheck.rows[0]?.nombre || 'Esencia'}" no cuenta con los gramos necesarios en estante.`);
                }
            }
        }

        // 2. Volver a crear la cabecera con su ID original
        await client.query(`
            INSERT INTO ventas (id, total, cliente_id, fecha, usuario_id) 
            VALUES ($1, $2, $3, $4, $5)
        `, [vault.venta_original_id, vault.total_venta, ventaData.cliente_id || 1, vault.fecha_venta, ventaData.usuario_id || 1]);

        // 3. Re-descontar del estante físicamente y re-crear los detalles
        for (const item of detalles) {
            const cant = parseFloat(item.cantidad);
            const desc = item.descripcion || '';
            
            if (item.formula_id) {
                const fRes = await client.query('SELECT * FROM formulas WHERE id = $1', [item.formula_id]);
                const f = fRes.rows[0];
                const esRecarga = desc.includes('REC');
                let gramosExtra = 0;
                const extraMatch = desc.match(/\(\+(\d+(?:\.\d+)?)g Ext\)/);
                if (extraMatch) gramosExtra = parseFloat(extraMatch[1]);

                await validarYDescontarEstante(client, item.producto_id, (parseFloat(f.gramos_esencia) + gramosExtra) * cant, "Esencia");
                
                if (f.ml_alcohol > 0) {
                    const alc = Math.max(0, parseFloat(f.ml_alcohol) - gramosExtra) * cant;
                    if (alc > 0) {
                        const alcRes = await client.query(`SELECT id FROM productos WHERE (categoria ILIKE '%Alcohol%' OR nombre ILIKE '%ALCOHOL%') AND activo = true ORDER BY stock_estante DESC LIMIT 1`);
                        await validarYDescontarEstante(client, alcRes.rows[0].id, alc, "Alcohol");
                    }
                }
                if (f.gramos_fijador > 0) {
                    const fijRes = await client.query(`SELECT id FROM productos WHERE (categoria ILIKE '%Fijador%' OR nombre ILIKE '%FIJADOR%') AND activo = true ORDER BY stock_estante DESC LIMIT 1`);
                    await validarYDescontarEstante(client, fijRes.rows[0].id, parseFloat(f.gramos_fijador) * cant, "Fijador");
                }
                if (!esRecarga) {
                    const envRes = await client.query(`SELECT id FROM productos WHERE (categoria IN ('Envases', 'Frascos') OR categoria ILIKE '%Envase%') AND (nombre ILIKE $1 OR contenido_gramos = $2) AND activo = true ORDER BY stock_estante DESC LIMIT 1`, [`%${f.volumen_total}%`, f.volumen_total]);
                    await validarYDescontarEstante(client, envRes.rows[0].id, cant, "Envase");
                }
            } else if (item.producto_id) {
                await validarYDescontarEstante(client, item.producto_id, cant, "Producto");
            }
            
            await client.query(`INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, descripcion, formula_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
                [vault.venta_original_id, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal, desc, item.formula_id]);
        }

        // 4. Restaurar los pagos de la transacción
        for (const p of pagos) {
            await client.query(`INSERT INTO pagos (venta_id, metodo, moneda, monto, tasa_cambio, referencia) VALUES ($1, $2, $3, $4, $5, $6)`, 
                [vault.venta_original_id, p.metodo, p.moneda, p.monto, p.tasa_cambio, p.referencia]);
        }

        // 5. Quitar de la bóveda para evitar duplicados
        await client.query('DELETE FROM ventas_anuladas WHERE id = $1', [idBoveda]);

        await client.query('COMMIT');
        res.json({ mensaje: 'Operación revertida. La factura vuelve a estar en el libro diario y se re-descontaron los insumos.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error restaurando venta:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const getVentasAnuladas = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ventas_anuladas ORDER BY fecha_anulacion DESC LIMIT 50');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

module.exports = { crearVenta, getReportes, getReportesConsolidadosRed, getFacturaPDF, getFacturaExcel, getDashboardKPIs, getVentas, getVentaById, descontarEstante,
    previsualizarCierre, 
    guardarCierre, 
    getHistorialCierres, 
    descargarCierreExcel,
    exportarReporteGeneral,
    anularVentaDefinitiva,
    forzarCierreManualHistorico,
    guardarBorradorCombo,
    obtenerBorradoresPorFormula,
    eliminarBorradorCombo,
    guardarBorradorCombo,
    obtenerBorradoresPorFormula,
    eliminarBorradorCombo,
    distribuirLoteEstante,
    bajarInventarioAEstanteMasa,
    bajarInventarioLoteCompleto,
    devolverAEstanteFisico,
    getVentasAnuladas,
    restaurarVentaAnulada
};