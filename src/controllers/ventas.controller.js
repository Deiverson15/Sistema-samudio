const pool = require('../config/db');
const { crearNotificacionInterna } = require('./notificaciones.controller');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const round = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// =========================================================
// 🏢 CONFIGURACIÓN EMPRESARIAL GLOBAL
// =========================================================
const EMPRESA_NOMBRE = 'PERFUMES C.A.';
const EMPRESA_RIF = ''; 

async function validarYDescontarEstante(client, productoId, cantidadRequerida, nombreReferencia, tiendaId, confirmacionAlmacen = false, usuarioId = null) {
    const pId = parseInt(productoId, 10);
    const tId = parseInt(tiendaId, 10); 
    const cantidad = parseFloat(cantidadRequerida);

    if (isNaN(pId) || pId <= 0) throw new Error(`🚫 ERROR DE FLUJO: Se intentó procesar "${nombreReferencia}" con un ID corrupto.`);
    if (isNaN(tId) || tId <= 0) throw new Error(`🚫 ERROR DE SEGURIDAD: ID de sucursal inválido.`);

    // 1. Consultar el producto de la tienda con bloqueo de fila
    const prodRes = await client.query(`
        SELECT id, nombre, categoria, stock_estante, stock_unidades, contenido_gramos, unidad_medida 
        FROM productos 
        WHERE id = $1 AND tienda_id = $2 FOR UPDATE
    `, [pId, tId]);
    
    if (prodRes.rows.length === 0) throw new Error(`El producto ${nombreReferencia} no existe en la tienda ID ${tId}.`);
    const prod = prodRes.rows[0];

    const ES_ALMACEN = (tId === 1);
    const estanteActual = parseFloat(prod.stock_estante || 0);
    const depositoActual = parseFloat(prod.stock_unidades || 0);
    const totalDisponible = estanteActual + depositoActual;

    // Verificar si el stock total (Estante + Almacén) alcanza
    if (totalDisponible < (cantidad - 0.05)) {
        throw new Error(`🚫 SIN STOCK: "${prod.nombre}" no cuenta con suficiente existencia. Total Disponible: ${totalDisponible.toFixed(2)} (Requerido: ${cantidad.toFixed(2)}).`);
    }

    // =========================================================================
    // 🚀 CASO A: ALMACÉN PRINCIPAL (SUCURSAL 1) -> DESCUENTO DIRECTO EN DEPÓSITO
    // =========================================================================
    if (ES_ALMACEN) {
        await client.query(`
            UPDATE productos 
            SET stock_unidades = GREATEST(stock_unidades - $1, 0) 
            WHERE id = $2 AND tienda_id = $3
        `, [cantidad, pId, tId]);

        await client.query(`
            INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id)
            VALUES ($1, 'SALIDA', $2, (SELECT stock_unidades FROM productos WHERE id=$1 AND tienda_id=$3), $4, NOW(), $3, $5)
        `, [pId, cantidad, tId, `Venta Almacén: ${nombreReferencia}`, usuarioId]);

        return prod.nombre;
    }

    // =========================================================================
    // 🏬 CASO B: MOSTRADOR -> DESCUENTO INTELIGENTE EN CASCADA (ESTANTE + DEPÓSITO)
    // =========================================================================
    let aDescontarEstante = 0;
    let aDescontarDeposito = 0;

    if (estanteActual >= cantidad) {
        aDescontarEstante = cantidad;
    } else {
        aDescontarEstante = estanteActual;
        aDescontarDeposito = cantidad - estanteActual;
    }

    // Descuento principal en la tabla productos
    await client.query(`
        UPDATE productos 
        SET stock_estante = GREATEST(stock_estante - $1, 0),
            stock_unidades = GREATEST(stock_unidades - $2, 0)
        WHERE id = $3 AND tienda_id = $4
    `, [aDescontarEstante, aDescontarDeposito, pId, tId]);

    // Detectar si el artículo es realmente un LÍQUIDO/INSUMO a fraccionar por gramos
    const uni = (prod.unidad_medida || '').toUpperCase();
    const cat = (prod.categoria || '').toUpperCase();
    const esLiquidoFraccionado = (uni === 'GRAMOS' || uni === 'ML') && 
                                (cat.includes('ESENCIA') || cat.includes('ALCOHOL') || cat.includes('FIJADOR'));

    // Solo busca y descuenta botellas físicas si es materia prima/líquido fraccionado
    if (esLiquidoFraccionado) {
        try {
            let pendienteBotellas = cantidad;
            const botellasRes = await client.query(`
                SELECT id, cantidad, estado FROM botellas_estante 
                WHERE producto_id = $1 AND estado != 'TESTER'
                ORDER BY CASE WHEN estado = 'ABIERTA' THEN 1 ELSE 2 END ASC, cantidad ASC
                FOR UPDATE
            `, [pId]);

            const capacidad = parseFloat(prod.contenido_gramos) || 1000;

            for (const b of botellasRes.rows) {
                if (pendienteBotellas <= 0.001) break; 

                const dispB = parseFloat(b.cantidad);
                const aRestarB = Math.min(pendienteBotellas, dispB);
                const nuevaCantB = Math.round(dispB - aRestarB);
                const nuevoPorcB = Math.min(100, Math.round((nuevaCantB / capacidad) * 100));

                if (nuevaCantB <= 0.01) {
                    await client.query('DELETE FROM botellas_estante WHERE id = $1', [b.id]);
                } else {
                    await client.query(`
                        UPDATE botellas_estante 
                        SET cantidad = $1, porcentaje_actual = $2, estado = 'ABIERTA' 
                        WHERE id = $3
                    `, [nuevaCantB, nuevoPorcB, b.id]);
                }
                pendienteBotellas -= aRestarB;
            }
        } catch (eBotellas) {
            // Omisión silenciosa: Si no hay botellas físicas registradas, no detiene la venta.
        }
    }

    // Registrar en el historial de movimientos
    await client.query(`
        INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id)
        VALUES ($1, 'SALIDA', $2, (SELECT (stock_estante + stock_unidades) FROM productos WHERE id=$1 AND tienda_id=$3), $4, NOW(), $3, $5)
    `, [pId, cantidad, tId, `Consumo Venta: ${nombreReferencia}`, usuarioId]);

    return prod.nombre;
}


async function devolverAEstanteFisico(client, productoId, cantidadADevolver, tiendaId) {
    const pId = parseInt(productoId, 10);
    const tId = parseInt(tiendaId, 10);
    const cantidad = parseFloat(cantidadADevolver);
    if (isNaN(pId) || pId <= 0 || isNaN(tId) || tId <= 0 || isNaN(cantidad) || cantidad <= 0) return;

    // 1. Obtener la capacidad máxima filtrando estrictamente por la tienda origen de la venta
    const prodRes = await client.query('SELECT contenido_gramos, nombre FROM productos WHERE id = $1 AND tienda_id = $2', [pId, tId]);
    if (prodRes.rows.length === 0) return;
    const capacidad = parseFloat(prodRes.rows[0].contenido_gramos) || 1000;

    // 2. Devolver los gramos estrictamente a la sucursal que procesó la anulación
    await client.query('UPDATE productos SET stock_estante = stock_estante + $1 WHERE id = $2 AND tienda_id = $3', [cantidad, pId, tId]);

    // 3. Re-acomodar los porcentajes de las botellas físicas en los estantes
    const botellaRes = await client.query(`
        SELECT id, cantidad FROM botellas_estante 
        WHERE producto_id = $1 
        ORDER BY estado ASC, id DESC LIMIT 1
    `, [pId]);

    if (botellaRes.rows.length > 0) {
        const bId = botellaRes.rows[0].id;
        const nuevaCantidad = parseFloat(botellaRes.rows[0].cantidad) + cantidad;
        const nuevoPorcentaje = Math.min(100, Math.round((nuevaCantidad / capacidad) * 100));

        await client.query(`
            UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2, estado = 'ABIERTA' WHERE id = $3
        `, [nuevaCantidad, nuevoPorcentaje, bId]);
    } else {
        const nuevoPorcentaje = Math.min(100, Math.round((cantidad / capacidad) * 100));
        await client.query(`
            INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado)
            VALUES ($1, $2, $3, 'A', '1', 'ABIERTA')
        `, [pId, cantidad, nuevoPorcentaje]);
    }
}

const exportarReporteGeneral = async (req, res) => {
    // 1. CAPTURA ABSOLUTA DE FILTROS DESDE EL CONFIGURADOR MODAL
    const { filtro, start, end, tienda, metodo, vendedor, categoria, producto } = req.query;
    
    let idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
    const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev';
    
    // Formateo visual del rango de fechas recibido para las cabeceras
    const fechaInicioFmt = start ? new Date(start + 'T00:00:00').toLocaleDateString('es-VE') : 'N/A';
    const fechaFinFmt = end ? new Date(end + 'T00:00:00').toLocaleDateString('es-VE') : 'N/A';
    const textoRangoFechas = (start && end) 
        ? `Período Evaluado: ${fechaInicioFmt} al ${fechaFinFmt}` 
        : `Fecha de Generación: ${new Date().toLocaleDateString('es-VE')}`;

    // 🛡️ Filtro de Sucursal Inteligente (Contexto de tienda o bypass maestro)
    let filtroTiendaGeneral = '';
    if (esUsuarioMaestro && tienda && tienda !== 'todas') {
        idTiendaLocal = parseInt(tienda, 10);
        filtroTiendaGeneral = ` AND v.tienda_id = ${idTiendaLocal}`;
    } else if (!esUsuarioMaestro) {
        filtroTiendaGeneral = ` AND v.tienda_id = ${idTiendaLocal}`;
    }

    // 🛡️ Filtro de Vendedor por Texto (Búsqueda parcial en base de datos)
    let filtroVendedorStr = '';
    if (vendedor && vendedor.trim() !== '') {
        filtroVendedorStr = ` AND u.nombre ILIKE '%${vendedor.trim()}%'`;
    }
    
    const client = await pool.connect();
    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = EMPRESA_NOMBRE;
        const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }, alignment: { horizontal: 'center' } };
        const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

        // Helper interno para dibujar el membrete corporativo estándar en cualquier hoja
        const agregarMembreteCorporativo = (sheet, tituloReporte) => {
            sheet.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 14 };
            sheet.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheet.addRow([tituloReporte.toUpperCase()]).font = { bold: true, size: 12 };
            sheet.addRow([textoRangoFechas]).font = { bold: true, size: 10, color: { argb: 'FF475569' } };
            sheet.addRow([]);
        };

        // =========================================================
        // REPORTE A: CIERRES DE CAJAS (MULTI-SUCURSAL Y TASA DÓLAR)
        // =========================================================
        if (filtro === 'cierres') {
            const sheet = workbook.addWorksheet('Cierres de Caja');
            agregarMembreteCorporativo(sheet, 'Reporte de Cierres de Cajas');

            const rowHeaders = sheet.addRow([
                'Fecha / Hora', 'N° Cierre', 'Cajero', 'Sucursal', 'TASA DÓLAR (BS/USD)', 'MÉTODOS USADOS',
                'EFECTIVO DIVISAS', 'EFECTIVO BS', 'PUNTO DE VENTA', 'TRANSFERENCIA', 
                'PAGO MOVIL', 'CASHEA', 'ZELLE', 'BIOPAGO', 'BINANCE', 'CXC', 'OTROS', 
                'TOTAL INGRESO USD', 'TOTAL INGRESO BS.'
            ]);
            rowHeaders.font = { bold: true };
            const filaEncabezadoNum = rowHeaders.number;

            let filtroTiendaCierre = '';
            if (tienda && tienda !== 'todas') {
                filtroTiendaCierre = ` AND c.tienda_id = ${parseInt(tienda, 10)}`;
            } else if (!esUsuarioMaestro && (!tienda || tienda !== 'todas')) {
                filtroTiendaCierre = ` AND c.tienda_id = ${idTiendaLocal}`;
            }

            let filtroVendedorCierre = '';
            if (vendedor && vendedor.trim() !== '') {
                filtroVendedorCierre = ` AND u.nombre ILIKE '%${vendedor.trim()}%'`;
            }

            let querySQL = `
                SELECT 
                    c.id,
                    c.fecha_cierre,
                    c.total_usd,
                    c.total_bs,
                    c.tienda_id,
                    c.detalles_json,
                    u.nombre as usuario,
                    COALESCE(t.nombre, 'Sede Principal') as tienda_nombre
                FROM cierres_caja c
                LEFT JOIN usuarios u ON c.usuario_id = u.id
                LEFT JOIN tiendas t ON c.tienda_id = t.id
                WHERE DATE(c.fecha_cierre) BETWEEN $1 AND $2 
                  ${filtroTiendaCierre} ${filtroVendedorCierre}
                ORDER BY c.fecha_cierre ASC
            `;

            const resCierres = await client.query(querySQL, [start, end]);
            
            const totales = { divisas: 0, bs: 0, punto: 0, trans: 0, pmovil: 0, cashea: 0, zelle: 0, biopago: 0, binance: 0, cxc: 0, otros: 0, total_usd: 0, total_bs: 0 };

            resCierres.rows.forEach(cierre => {
                const fechaCierre = new Date(cierre.fecha_cierre).toLocaleString('es-VE');
                const numCierre = String(cierre.id).padStart(6, '0');
                const cajero = cierre.usuario || 'Sistema';
                const sucursalStr = (cierre.tienda_nombre || 'Sede Principal').toUpperCase();
                
                const cierreUsd = parseFloat(cierre.total_usd || 0);
                const cierreBs = parseFloat(cierre.total_bs || 0);
                const tasaDolar = cierreUsd > 0 ? (cierreBs / cierreUsd) : 0;

                const detalles = typeof cierre.detalles_json === 'string' ? JSON.parse(cierre.detalles_json) : (cierre.detalles_json || {});
                let desglose = [];
                if (Array.isArray(detalles.desglose_pagos)) desglose = detalles.desglose_pagos;
                else if (detalles.desglose_pagos && Array.isArray(detalles.desglose_pagos.desglose_pagos)) desglose = detalles.desglose_pagos.desglose_pagos;
                else if (Array.isArray(detalles.desglose_metodos)) desglose = detalles.desglose_metodos;
                else if (detalles.desglose_pagos && typeof detalles.desglose_pagos === 'object') desglose = Object.values(detalles.desglose_pagos);

                let hasMethod = false;
                const filaData = { divisas: 0, bs: 0, punto: 0, trans: 0, pmovil: 0, cashea: 0, zelle: 0, biopago: 0, binance: 0, cxc: 0, otros: 0 };
                const metodosNombres = [];

                desglose.forEach(d => {
                    const met = (d.metodo || 'OTROS').toUpperCase();
                    const montoUSD = parseFloat(d.total_usd || d.usd || 0);
                    
                    if (!metodosNombres.includes(met) && montoUSD > 0) metodosNombres.push(met);

                    if (metodo && metodo !== 'todos' && met.includes(metodo.toUpperCase())) {
                        hasMethod = true;
                    }

                    if (met.includes('EFECTIVO USD') || met.includes('DIVISA') || met.includes('DOLAR')) filaData.divisas += montoUSD;
                    else if (met.includes('EFECTIVO BS') || met === 'EFECTIVO') filaData.bs += montoUSD;
                    else if (met.includes('PUNTO')) filaData.punto += montoUSD;
                    else if (met.includes('MOVIL') || met.includes('P. MOVIL')) filaData.pmovil += montoUSD;
                    else if (met.includes('TRANS')) filaData.trans += montoUSD;
                    else if (met.includes('BIO') || met.includes('BIOPAGO')) filaData.biopago += montoUSD;
                    else if (met.includes('ZELLE')) filaData.zelle += montoUSD;
                    else if (met.includes('BINANCE')) filaData.binance += montoUSD;
                    else if (met.includes('CASHEA')) filaData.cashea += montoUSD;
                    else if (met.includes('CXC') || met.includes('CREDITO')) filaData.cxc += montoUSD;
                    else filaData.otros += montoUSD; 
                });

                if (metodo && metodo !== 'todos' && !hasMethod && desglose.length > 0) return;

                sheet.addRow([
                    fechaCierre, numCierre, cajero, sucursalStr, tasaDolar, metodosNombres.join(', '),
                    filaData.divisas, filaData.bs, filaData.punto, filaData.trans, filaData.pmovil, 
                    filaData.cashea, filaData.zelle, filaData.biopago, filaData.binance, filaData.cxc, filaData.otros,
                    cierreUsd, cierreBs
                ]);

                totales.divisas += filaData.divisas; totales.bs += filaData.bs; totales.punto += filaData.punto;
                totales.trans += filaData.trans; totales.pmovil += filaData.pmovil; totales.cashea += filaData.cashea;
                totales.zelle += filaData.zelle; totales.biopago += filaData.biopago; totales.binance += filaData.binance;
                totales.cxc += filaData.cxc; totales.otros += filaData.otros; totales.total_usd += cierreUsd; totales.total_bs += cierreBs;
            });

            const ultimaFilaDatos = sheet.lastRow ? sheet.lastRow.number : filaEncabezadoNum;
            sheet.autoFilter = {
                from: { row: filaEncabezadoNum, column: 1 },
                to: { row: ultimaFilaDatos, column: 19 }
            };

            const rowTotal = sheet.addRow([
                '', '', '', '', 'TOTALES:', '',
                totales.divisas, totales.bs, totales.punto, totales.trans, totales.pmovil,
                totales.cashea, totales.zelle, totales.biopago, totales.binance, totales.cxc, totales.otros,
                totales.total_usd, totales.total_bs
            ]);
            rowTotal.font = { bold: true };

            sheet.getColumn(1).width = 20; 
            sheet.getColumn(2).width = 12; 
            sheet.getColumn(3).width = 20; 
            sheet.getColumn(4).width = 22; 
            sheet.getColumn(5).width = 22; 
            sheet.getColumn(5).numFmt = '"Bs "#,##0.00';
            sheet.getColumn(6).width = 25; 
            
            for (let i = 7; i <= 19; i++) {
                sheet.getColumn(i).width = 15; 
                sheet.getColumn(i).numFmt = i === 19 ? '"Bs "#,##0.00' : '"$"#,##0.00';
            }
        }

        // =========================================================
        // REPORTE B: VENTAS POR REFERENCIAS (CON FILTRO DE MATERIA PRIMA)
        // =========================================================
        if (filtro === 'referencias') {
            const sheet = workbook.addWorksheet('Ventas por Referencia');
            agregarMembreteCorporativo(sheet, 'Reporte de Venta por Referencia');
            
            const labelFiltroMat = categoria && categoria !== 'todos' ? `Filtro Aplicado: ${categoria.toUpperCase()}` : 'Filtro Aplicado: Catálogo Completo';
            sheet.addRow([labelFiltroMat]).font = { bold: true, size: 9 };
            sheet.addRow([]);

            const rowHeaders = sheet.addRow([
                'Medida / Unidad', 'Género', 'Referencia', 'Descripción', 'Marca', 
                'Uds. Vendidas', 'Monto $ Precio Base Imponible'
            ]);
            rowHeaders.font = { bold: true };
            rowHeaders.alignment = { horizontal: 'center' };
            const filaEncabezadoNum = rowHeaders.number;

            let filtroCategoriaStr = '';
            if (categoria && categoria !== 'todos') {
                const catUpper = categoria.toUpperCase();
                if (catUpper === 'MATERIA_PRIMA') {
                    filtroCategoriaStr = ` AND (
                        p.categoria ILIKE '%esencia%' OR 
                        p.categoria ILIKE '%fijador%' OR 
                        p.categoria ILIKE '%alcohol%' OR 
                        p.categoria ILIKE '%frasco%' OR 
                        p.categoria ILIKE '%envase%'
                    )`;
                } else if (catUpper === 'TERMINADOS') {
                    filtroCategoriaStr = ` AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminado%' OR p.categoria ILIKE '%perfume%')`;
                } else if (catUpper === 'FRASCO') {
                    filtroCategoriaStr = ` AND (p.categoria ILIKE '%frasco%' OR p.categoria ILIKE '%envase%')`;
                } else {
                    filtroCategoriaStr = ` AND p.categoria ILIKE '%${categoria.trim()}%'`;
                }
            }

            const resReferencias = await client.query(`
                SELECT 
                    COALESCE(
                        NULLIF(dv.tamano, 'N/A'),
                        NULLIF(f.volumen_total || 'ml', 'ml'),
                        NULLIF(p.tamano, 'N/A'),
                        p.unidad_medida,
                        'N/A'
                    ) as medida,
                    COALESCE(p.genero, 'S/N') as genero,
                    p.codigo as referencia,
                    p.nombre as descripcion,
                    p.marca as marca,
                    SUM(dv.cantidad) as total_unidades,
                    SUM(dv.subtotal) as monto_total_usd 
                FROM ventas v
                JOIN detalle_ventas dv ON v.id = dv.venta_id 
                JOIN productos p ON dv.producto_id = p.id
                LEFT JOIN formulas f ON dv.formula_id = f.id
                LEFT JOIN usuarios u ON v.usuario_id = u.id
                WHERE DATE(v.fecha) BETWEEN $1 AND $2 
                  ${filtroTiendaGeneral} ${filtroVendedorStr} ${filtroCategoriaStr}
                GROUP BY 
                    COALESCE(
                        NULLIF(dv.tamano, 'N/A'),
                        NULLIF(f.volumen_total || 'ml', 'ml'),
                        NULLIF(p.tamano, 'N/A'),
                        p.unidad_medida,
                        'N/A'
                    ), 
                    p.genero, p.codigo, p.nombre, p.marca
                ORDER BY p.nombre ASC
            `, [start, end]);

            let totalAcumuladoUSD = 0;
            let totalUnidadesAcumuladas = 0;

            resReferencias.rows.forEach(r => {
                const uds = parseFloat(r.total_unidades || 0);
                const monto = parseFloat(r.monto_total_usd || 0);

                sheet.addRow([
                    r.medida, 
                    r.genero ? r.genero.toUpperCase() : 'S/N', 
                    r.referencia || 'S/N',
                    r.descripcion || 'S/N',
                    r.marca || 'S/N',
                    uds,
                    monto
                ]);

                totalUnidadesAcumuladas += uds;
                totalAcumuladoUSD += monto;
            });

            const ultimaFilaDatos = sheet.lastRow ? sheet.lastRow.number : filaEncabezadoNum;
            sheet.autoFilter = {
                from: { row: filaEncabezadoNum, column: 1 },
                to: { row: ultimaFilaDatos, column: 7 }
            };

            sheet.addRow([]);
            const rowTotalesRef = sheet.addRow([
                '', '', '', '', 'TOTALES:', 
                totalUnidadesAcumuladas, totalAcumuladoUSD
            ]);
            rowTotalesRef.font = { bold: true };
            rowTotalesRef.getCell(5).alignment = { horizontal: 'right' };

            sheet.getColumn(1).width = 18;
            sheet.getColumn(4).width = 40;
            sheet.getColumn(7).width = 30;
            sheet.getColumn(7).numFmt = '"$"#,##0.00';
        }

        // =========================================================
        // REPORTE C: VENTAS CONSOLIDADAS POR TIENDA (DYNAMIC PROMOS)
        // =========================================================
        if (filtro === 'tiendas') {
            const sheet = workbook.addWorksheet('Consolidado Tiendas');
            agregarMembreteCorporativo(sheet, 'Ventas por Tienda (Consolidado)');

            const tiendasParam = req.query.tiendas; 
            let arrTiendas = [];
            let filtroTiendaQuery = '';
            let params = [start, end];
            
            if (tiendasParam) {
                arrTiendas = tiendasParam.split(',').map(id => parseInt(id, 10));
                params.push(arrTiendas);
                filtroTiendaQuery = ` AND v.tienda_id = ANY($3::int[])`;
            }

            let queryTiendasInfo = 'SELECT id, nombre FROM tiendas';
            let paramsTiendas = [];
            if (arrTiendas.length > 0) {
                 queryTiendasInfo += ' WHERE id = ANY($1::int[])';
                 paramsTiendas.push(arrTiendas);
            }
            const resTiendas = await client.query(queryTiendasInfo, paramsTiendas);

            const report = {};
            const tarifasBase = ['PVP TIENDA DETAL', 'PVP TIENDA MAYOR 12', 'PVTIENDA MAYOR DE 100', 'PVP PROMOS'];
            const tiendasOrdenadas = resTiendas.rows.sort((a, b) => a.nombre.localeCompare(b.nombre));

            tiendasOrdenadas.forEach(t => {
                const tName = t.nombre;
                report[tName] = { codigo: `T-${t.id}`, tarifas: {} };
                
                tarifasBase.forEach(tarifa => {
                    report[tName].tarifas[tarifa] = {
                        u30: 0, c30: 0, p30: 0, r30: 0,
                        u60: 0, c60: 0, p60: 0, r60: 0,
                        u100: 0, c100: 0, p100: 0, r100: 0,
                        ue: 0, ce: 0, pe: 0, re: 0,
                        ut: 0, ct: 0, pt: 0, rt: 0
                    };
                });
            });

            // 🎯 CONSULTA SQL CORREGIDA:
            // 1. Usa COALESCE para tomar el costo histórico o el costo actual del producto (p.costo).
            // 2. Detecta si la unidad es GRAMOS/ML o categoría Esencia/Alcohol/Fijador para dividir el costo unitario entre 1000.
            const resData = await client.query(`
                SELECT 
                    t.nombre as tienda_nombre,
                    COALESCE(dv.tarifa_aplicada, 'PVP TIENDA DETAL') as tarifa,
                    dv.tamano,
                    p.nombre as producto_nombre,
                    p.categoria as producto_categoria,
                    p.unidad_medida as producto_unidad,
                    dv.descripcion as detalle_desc,
                    dv.cantidad,
                    -- Fallback inteligente de costo:
                    CASE 
                        WHEN (p.categoria ILIKE '%esencia%' OR p.categoria ILIKE '%alcohol%' OR p.categoria ILIKE '%fijador%' OR p.unidad_medida = 'GRAMOS' OR p.unidad_medida = 'ML') 
                        THEN COALESCE(NULLIF(dv.costo_unitario_historico, 0), p.costo, 0) / 1000.0
                        ELSE COALESCE(NULLIF(dv.costo_unitario_historico, 0), p.costo, 0)
                    END as costo_unitario_calculado,
                    dv.subtotal as precio_total
                FROM ventas v
                JOIN detalle_ventas dv ON v.id = dv.venta_id
                JOIN tiendas t ON v.tienda_id = t.id
                LEFT JOIN productos p ON dv.producto_id = p.id
                WHERE v.fecha::date BETWEEN $1 AND $2 ${filtroTiendaQuery}
            `, params);

            resData.rows.forEach(r => {
                const tName = r.tienda_nombre;
                if (!report[tName]) return;

                const rawTarifa = (r.tarifa || 'PVP TIENDA DETAL').toUpperCase().trim();
                let tarifaReal = rawTarifa;

                if (rawTarifa.includes('PROMO')) {
                    tarifaReal = rawTarifa.length > 5 ? `PVP ${rawTarifa}` : 'PVP PROMOS';
                } else if (rawTarifa.includes('MAYOR 12') || (rawTarifa.includes('MAYOR') && !rawTarifa.includes('100') && !rawTarifa.includes('GRAN'))) {
                    tarifaReal = 'PVP TIENDA MAYOR 12';
                } else if (rawTarifa.includes('MAYOR DE 100') || rawTarifa.includes('GRAN MAYOR') || rawTarifa.includes('100')) {
                    tarifaReal = 'PVTIENDA MAYOR DE 100';
                } else if (rawTarifa.includes('DETAL')) {
                    tarifaReal = 'PVP TIENDA DETAL';
                }

                if (!report[tName].tarifas[tarifaReal]) {
                    report[tName].tarifas[tarifaReal] = {
                        u30: 0, c30: 0, p30: 0, r30: 0, u60: 0, c60: 0, p60: 0, r60: 0,
                        u100: 0, c100: 0, p100: 0, r100: 0, ue: 0, ce: 0, pe: 0, re: 0,
                        ut: 0, ct: 0, pt: 0, rt: 0
                    };
                }

                const cat = report[tName].tarifas[tarifaReal];
                const tamStr = (r.tamano || '').toString().toUpperCase().replace(/\s/g, '');
                const textStr = ((r.producto_nombre || '') + ' ' + (r.detalle_desc || '')).toUpperCase();
                
                const cant = parseFloat(r.cantidad || 0);
                
                // 💰 CÁLCULO EXACTO DEL COSTO Y RENTABILIDAD
                const costoUnit = parseFloat(r.costo_unitario_calculado || 0);
                const costoTot = costoUnit * cant;
                const precio = parseFloat(r.precio_total || 0);
                const rentabilidad = precio - costoTot;

                if (tamStr === '30' || tamStr === '30ML' || textStr.includes('30ML') || textStr.includes('30 ML')) {
                    cat.u30 += cant; cat.c30 += costoTot; cat.p30 += precio; cat.r30 += rentabilidad;
                } else if (tamStr === '60' || tamStr === '60ML' || textStr.includes('60ML') || textStr.includes('60 ML')) {
                    cat.u60 += cant; cat.c60 += costoTot; cat.p60 += precio; cat.r60 += rentabilidad;
                } else if (tamStr === '100' || tamStr === '100ML' || textStr.includes('100ML') || textStr.includes('100 ML')) {
                    cat.u100 += cant; cat.c100 += costoTot; cat.p100 += precio; cat.r100 += rentabilidad;
                } else { 
                    cat.ue += cant; cat.ce += costoTot; cat.pe += precio; cat.re += rentabilidad;
                }
                cat.ut += cant; cat.ct += costoTot; cat.pt += precio; cat.rt += rentabilidad;
            });

            Object.keys(report).forEach(tName => {
                const tiendaData = report[tName];
                sheet.addRow([]);
                
                const headerTarjeta = sheet.addRow([`🏪 TIENDA: ${tName.toUpperCase()}   |   ID SERIAL: ${tiendaData.codigo}   |   MONEDA: DÓLARES (USD)`]);
                headerTarjeta.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
                headerTarjeta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                sheet.mergeCells(headerTarjeta.number, 1, headerTarjeta.number, 21);
                
                const rowCols = sheet.addRow([
                    'TARIFA APLICADA', 
                    'Unds 30ml', 'Costo 30ml', 'Precio 30ml', 'Rentab. 30ml',
                    'Unds 60ml', 'Costo 60ml', 'Precio 60ml', 'Rentab. 60ml',
                    'Unds 100ml', 'Costo 100ml', 'Precio 100ml', 'Rentab. 100ml',
                    'Unds Extras', 'Costo Extras', 'Precio Extras', 'Rentab. Extras',
                    'TOTAL Unds', 'TOTAL Costo', 'TOTAL Precio', 'TOTAL Rentab.'
                ]);
                rowCols.font = { bold: true, size: 10, color: { argb: 'FF334155' } };
                rowCols.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                rowCols.alignment = { horizontal: 'center' };

                let gt = { u30:0, c30:0, p30:0, r30:0, u60:0, c60:0, p60:0, r60:0, u100:0, c100:0, p100:0, r100:0, ue:0, ce:0, pe:0, re:0, ut:0, ct:0, pt:0, rt:0 };

                Object.keys(tiendaData.tarifas).forEach(tarifaName => {
                    const d = tiendaData.tarifas[tarifaName];
                    sheet.addRow([tarifaName, d.u30, d.c30, d.p30, d.r30, d.u60, d.c60, d.p60, d.r60, d.u100, d.c100, d.p100, d.r100, d.ue, d.ce, d.pe, d.re, d.ut, d.ct, d.pt, d.rt]);
                    Object.keys(gt).forEach(k => gt[k] += d[k]);
                });

                const rowTotalTienda = sheet.addRow(['TOTALES DE LA SUCURSAL:', gt.u30, gt.c30, gt.p30, gt.r30, gt.u60, gt.c60, gt.p60, gt.r60, gt.u100, gt.c100, gt.p100, gt.r100, gt.ue, gt.ce, gt.pe, gt.re, gt.ut, gt.ct, gt.pt, gt.rt]);
                rowTotalTienda.font = { bold: true, color: { argb: 'FF0F172A' } };
                rowTotalTienda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            });

            sheet.getColumn(1).width = 25;
            for(let i = 2; i <= 21; i++) sheet.getColumn(i).width = 14;

            const moneyCols = [3,4,5, 7,8,9, 11,12,13, 15,16,17, 19,20,21];
            moneyCols.forEach(colIndex => sheet.getColumn(colIndex).numFmt = '"$"#,##0.00');
        }

        // =========================================================
        // REPORTE D: VALORACIÓN DE INVENTARIO Y CAPITAL (CON AUTOFILTRO)
        // =========================================================
        if (filtro === 'inventario') {
            const sheet = workbook.addWorksheet('Valoración de Inventario');
            agregarMembreteCorporativo(sheet, 'Valoración Financiera de Inventario');

            const rowHeaders = sheet.addRow(['CÓDIGO', 'PRODUCTO', 'CATEGORÍA', 'DEPÓSITO', 'ESTANTE', 'STOCK TOTAL', 'COSTO UNIT. ($)', 'P.V.P ($)', 'VALOR ESTANCADO ($)']);
            rowHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            rowHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            const filaEncabezadoNum = rowHeaders.number;

            let qInv = `SELECT codigo, nombre, categoria, unidad_medida, stock_unidades, stock_estante, costo, precio_venta FROM productos WHERE activo = true AND tienda_id = ${idTiendaLocal}`;
            
            if (categoria && categoria !== 'todos') {
                const catUpper = categoria.toUpperCase();
                if (catUpper === 'PT' || catUpper === 'TERMINADOS' || catUpper === 'COMPLETO') {
                    qInv += ` AND (es_producto_terminado = true OR categoria ILIKE '%terminado%' OR categoria ILIKE '%perfume%')`;
                } else if (catUpper === 'INSUMOS' || catUpper === 'MATERIA_PRIMA') {
                    qInv += ` AND (categoria ILIKE '%esencia%' OR categoria ILIKE '%fijador%' OR categoria ILIKE '%alcohol%' OR categoria ILIKE '%frasco%' OR categoria ILIKE '%envase%')`;
                } else if (catUpper === 'FRASCOS' || catUpper === 'FRASCO') {
                    qInv += ` AND (categoria ILIKE '%frasco%' OR categoria ILIKE '%envase%')`;
                } else {
                    qInv += ` AND categoria ILIKE '%${categoria.trim()}%'`;
                }
            }
            qInv += ` ORDER BY categoria ASC, nombre ASC`;

            const resInv = await client.query(qInv);
            let granTotalCapital = 0;

            resInv.rows.forEach(r => {
                let su = parseFloat(r.stock_unidades || 0);
                let se = parseFloat(r.stock_estante || 0);
                const uni = (r.unidad_medida || '').toUpperCase();
                const cat = (r.categoria || '').toUpperCase();
                
                const isLiquid = uni === 'GRAMOS' || uni === 'ML' || cat.includes('ESENCIA') || cat.includes('FIJADOR') || cat.includes('ALCOHOL');

                if (isLiquid) {
                    su = su / 1000;
                    se = se / 1000;
                }

                const stockTotal = su + se;
                const costo = parseFloat(r.costo || 0);
                const capitalEstancado = stockTotal * costo;
                granTotalCapital += capitalEstancado;

                const fila = sheet.addRow([r.codigo, r.nombre, r.categoria, su, se, stockTotal, costo, parseFloat(r.precio_venta), capitalEstancado]);
                const fmtStock = isLiquid ? '#,##0.000' : '#,##0';
                fila.getCell(4).numFmt = fmtStock;
                fila.getCell(5).numFmt = fmtStock;
                fila.getCell(6).numFmt = fmtStock;
            });

            const ultimaFilaDatos = sheet.lastRow ? sheet.lastRow.number : filaEncabezadoNum;
            sheet.autoFilter = {
                from: { row: filaEncabezadoNum, column: 1 },
                to: { row: ultimaFilaDatos, column: 9 }
            };

            sheet.addRow([]);
            const filaTotal = sheet.addRow(['', '', '', '', '', '', '', 'TOTAL CAPITAL INVERTIDO:', granTotalCapital]);
            filaTotal.font = { bold: true, size: 12 };
            sheet.getColumn(2).width = 40; 
            sheet.getColumn(7).numFmt = '"$"#,##0.00'; 
            sheet.getColumn(8).numFmt = '"$"#,##0.00'; 
            sheet.getColumn(9).numFmt = '"$"#,##0.00';
        }

        // =========================================================
        // REPORTE: PRODUCTOS CREADOS (CON AUTOFILTRO)
        // =========================================================
        if (filtro === 'productos_creados') {
            const sheet = workbook.addWorksheet('Productos Creados');
            agregarMembreteCorporativo(sheet, 'Catálogo de Productos Creados');
            
            const labelFiltroMat = categoria && categoria !== 'todos' ? `Filtro Aplicado: ${categoria.toUpperCase()}` : 'Filtro Aplicado: Catálogo Completo';
            sheet.addRow([labelFiltroMat]).font = { bold: true, size: 9 };
            sheet.addRow([]);

            const rowHeaders = sheet.addRow(['CÓDIGO', 'PRODUCTO', 'CATEGORÍA', 'MARCA', 'GÉNERO', 'UND. MEDIDA', 'STOCK ACTUAL', 'COSTO UNIT. ($)', 'P.V.P ($)']);
            rowHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            rowHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } }; 
            
            const filaEncabezadoNum = rowHeaders.number;

            let qProd = `SELECT codigo, nombre, categoria, marca, genero, unidad_medida, stock_unidades, stock_estante, costo, precio_venta FROM productos WHERE activo = true AND tienda_id = ${idTiendaLocal}`;
            
            if (categoria && categoria !== 'todos') {
                const catUpper = categoria.toUpperCase();
                if (catUpper === 'PT' || catUpper === 'TERMINADOS' || catUpper === 'COMPLETO') {
                    qProd += ` AND (es_producto_terminado = true OR categoria ILIKE '%terminado%' OR categoria ILIKE '%perfume%')`;
                } else if (catUpper === 'INSUMOS' || catUpper === 'MATERIA_PRIMA') {
                    qProd += ` AND (categoria ILIKE '%esencia%' OR categoria ILIKE '%fijador%' OR categoria ILIKE '%alcohol%' OR categoria ILIKE '%frasco%' OR categoria ILIKE '%envase%')`;
                } else if (catUpper === 'FRASCOS' || catUpper === 'FRASCO') {
                    qProd += ` AND (categoria ILIKE '%frasco%' OR categoria ILIKE '%envase%')`;
                } else {
                    qProd += ` AND categoria ILIKE '%${categoria.trim()}%'`;
                }
            }
            qProd += ` ORDER BY categoria ASC, nombre ASC`;

            const resProd = await client.query(qProd);

            resProd.rows.forEach(r => {
                let su = parseFloat(r.stock_unidades || 0);
                let se = parseFloat(r.stock_estante || 0);
                const uni = (r.unidad_medida || '').toUpperCase();
                const cat = (r.categoria || '').toUpperCase();
                
                const isLiquid = uni === 'GRAMOS' || uni === 'ML' || cat.includes('ESENCIA') || cat.includes('FIJADOR') || cat.includes('ALCOHOL');

                if (isLiquid) {
                    su = su / 1000;
                    se = se / 1000;
                }
                const stockTotal = su + se;

                const fila = sheet.addRow([r.codigo, r.nombre, r.categoria, r.marca || 'S/M', r.genero || 'UNISEX', r.unidad_medida, stockTotal, parseFloat(r.costo || 0), parseFloat(r.precio_venta || 0)]);
                
                const numFmtStock = isLiquid ? '#,##0.000' : '#,##0';
                fila.getCell(7).numFmt = numFmtStock;
                fila.getCell(8).numFmt = '"$"#,##0.00';
                fila.getCell(9).numFmt = '"$"#,##0.00';
            });

            const ultimaFilaNum = sheet.lastRow ? sheet.lastRow.number : filaEncabezadoNum;

            sheet.autoFilter = {
                from: { row: filaEncabezadoNum, column: 1 },
                to: { row: ultimaFilaNum, column: 9 }
            };

            sheet.getColumn(2).width = 40; 
            sheet.getColumn(8).width = 15; 
            sheet.getColumn(9).width = 15;
        }

        // =========================================================
        // REPORTE E: CONTROL DE MERMAS Y TESTERS (OPTIMIZADO)
        // =========================================================
        if (filtro === 'mermas') {
            const sheet = workbook.addWorksheet('Mermas y Consumos');
            agregarMembreteCorporativo(sheet, 'Control de Mermas y Pérdidas Físicas');
        
            const rowHeaders = sheet.addRow(['FECHA', 'PRODUCTO', 'CANTIDAD', 'COSTO UNIT ($)', 'PÉRDIDA NETA ($)', 'MOTIVO / EVENTO', 'OPERADOR']);
            rowHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            rowHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3342F' } }; 
            const filaEncabezadoNum = rowHeaders.number;
        
            // 💡 CORRECCIÓN DE BÚSQUEDA:
            // Captura tipo_movimiento IN ('MERMA', 'CONSUMO_INT') Y TAMBIÉN búsquedas por texto en el campo motivo
            const queryMermas = `
                SELECT TO_CHAR(h.fecha, 'DD/MM/YYYY HH12:MI AM') as fecha_fmt, 
                       p.nombre as producto, 
                       p.categoria, 
                       p.unidad_medida, 
                       h.cantidad, 
                       p.costo, 
                       (h.cantidad * (
                           CASE 
                               WHEN p.categoria ILIKE '%esencia%' OR p.categoria ILIKE '%alcohol%' OR p.categoria ILIKE '%fijador%' OR p.unidad_medida = 'GRAMOS' OR p.unidad_medida = 'ML' 
                               THEN p.costo / 1000.0 
                               ELSE p.costo 
                           END
                       )) as perdida, 
                       h.motivo, 
                       u.nombre as usuario
                FROM historial_movimientos h
                JOIN productos p ON h.producto_id = p.id
                LEFT JOIN usuarios u ON h.usuario_id = u.id
                WHERE h.fecha::date BETWEEN $1 AND $2 
                  AND h.tienda_id = ${idTiendaLocal}
                  AND (
                      h.tipo_movimiento IN ('MERMA', 'CONSUMO_INT') 
                      OR h.motivo ILIKE '%MERMA%' 
                      OR h.motivo ILIKE '%TESTER%' 
                      OR h.motivo ILIKE '%DERRAME%' 
                      OR h.motivo ILIKE '%DAÑO%' 
                      OR h.motivo ILIKE '%ROTURA%'
                      OR h.motivo ILIKE '%CONSUMO%'
                      OR h.motivo ILIKE '%AJUSTE%'
                  )
                ORDER BY h.fecha DESC
            `;
            
            const resMermas = await client.query(queryMermas, [start, end]);
            
            let totalPerdida = 0;
            resMermas.rows.forEach(r => {
                let cant = parseFloat(r.cantidad || 0);
                const uni = (r.unidad_medida || '').toUpperCase();
                const cat = (r.categoria || '').toUpperCase();
                const isLiquid = uni === 'GRAMOS' || uni === 'ML' || cat.includes('ESENCIA') || cat.includes('FIJADOR') || cat.includes('ALCOHOL');
                
                if (isLiquid) {
                    cant = cant / 1000;
                }
            
                const perdida = parseFloat(r.perdida || 0);
                totalPerdida += perdida;
                const fila = sheet.addRow([r.fecha_fmt, r.producto, cant, parseFloat(r.costo), perdida, r.motivo, r.usuario || 'Sistema']);
                
                fila.getCell(3).numFmt = isLiquid ? '#,##0.000' : '#,##0';
                fila.getCell(4).numFmt = '"$"#,##0.00'; 
                fila.getCell(5).numFmt = '"$"#,##0.00';
            });
        
            const ultimaFilaDatos = sheet.lastRow ? sheet.lastRow.number : filaEncabezadoNum;
            sheet.autoFilter = {
                from: { row: filaEncabezadoNum, column: 1 },
                to: { row: ultimaFilaDatos, column: 7 }
            };
        
            sheet.addRow([]);
            const rTotalM = sheet.addRow(['', '', '', 'TOTAL PÉRDIDA OPERATIVA:', totalPerdida]);
            rTotalM.font = { bold: true, color: { argb: 'FFE3342F' } };
            sheet.getColumn(2).width = 40; 
            sheet.getColumn(4).numFmt = '"$"#,##0.00'; 
            sheet.getColumn(5).numFmt = '"$"#,##0.00'; 
            sheet.getColumn(6).width = 40;
        }

        // =========================================================
        // ⭐ REPORTE F: RENTABILIDAD Y MÁRGENES (CON AUTOFILTRO)
        // =========================================================
        if (filtro === 'rentabilidad') {
            const sheet = workbook.addWorksheet('Rentabilidad');
            agregarMembreteCorporativo(sheet, 'Análisis de Rentabilidad y Márgenes de Utilidad');
            
            const labelFiltroMat = categoria && categoria !== 'todos' ? `Filtro Tipo: ${categoria.toUpperCase()}` : 'Filtro Tipo: Consolidado General';
            sheet.addRow([labelFiltroMat]).font = { bold: true, size: 9 };
            sheet.addRow([]);
            
            const rowHeaders = sheet.addRow(['PRODUCTO', 'CATEGORÍA', 'UNIDADES VENDIDAS', 'INGRESO BRUTO ($)', 'COSTO INSUMOS ($)', 'UTILIDAD NETA ($)', 'MARGEN (%)']);
            rowHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            rowHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } }; 
            const filaEncabezadoNum = rowHeaders.number;

            let filtroCategoriaStr = '';
            if (categoria && categoria !== 'todos') {
                const catUpper = categoria.toUpperCase();
                if (catUpper === 'MATERIA_PRIMA' || catUpper === 'MT') {
                    filtroCategoriaStr = ` AND (
                        p.categoria ILIKE '%esencia%' OR 
                        p.categoria ILIKE '%fijador%' OR 
                        p.categoria ILIKE '%alcohol%' OR 
                        p.categoria ILIKE '%frasco%' OR 
                        p.categoria ILIKE '%envase%'
                    )`;
                } else if (catUpper === 'TERMINADOS' || catUpper === 'PT') {
                    filtroCategoriaStr = ` AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminado%' OR p.categoria ILIKE '%perfume%')`;
                } else if (catUpper === 'FRASCO') {
                    filtroCategoriaStr = ` AND (p.categoria ILIKE '%frasco%' OR p.categoria ILIKE '%envase%')`;
                } else {
                    filtroCategoriaStr = ` AND p.categoria ILIKE '%${categoria.trim()}%'`;
                }
            }

            const qRenta = `
                SELECT p.nombre, p.categoria, COALESCE(p.genero, 'UNISEX') as genero, SUM(dv.cantidad) as uds, SUM(dv.subtotal) as ingreso,
                       SUM(
                           dv.cantidad * (
                               CASE 
                                   WHEN p.categoria ILIKE '%esencia%' OR p.categoria ILIKE '%alcohol%' OR p.categoria ILIKE '%fijador%' OR p.unidad_medida = 'GRAMOS' OR p.unidad_medida = 'ML' 
                                   THEN COALESCE(NULLIF(dv.costo_unitario_historico, 0), p.costo) / 1000.0
                                   ELSE COALESCE(NULLIF(dv.costo_unitario_historico, 0), p.costo)
                               END
                           )
                       ) as costo
                FROM detalle_ventas dv
                JOIN ventas v ON dv.venta_id = v.id
                JOIN productos p ON dv.producto_id = p.id
                LEFT JOIN usuarios u ON v.usuario_id = u.id
                WHERE v.fecha::date BETWEEN $1 AND $2 ${filtroTiendaGeneral} ${filtroVendedorStr} ${filtroCategoriaStr}
                GROUP BY p.id, p.nombre, p.categoria, p.genero
                ORDER BY ingreso DESC
            `;
            const resRenta = await client.query(qRenta, [start, end]);

            let tIngreso = 0, tCosto = 0, tGanancia = 0;

            resRenta.rows.forEach(r => {
                const ingreso = parseFloat(r.ingreso || 0);
                const costo = parseFloat(r.costo || 0);
                const ganancia = ingreso - costo;
                const margen = ingreso > 0 ? (ganancia / ingreso) : 0;

                tIngreso += ingreso; tCosto += costo; tGanancia += ganancia;

                sheet.addRow([r.nombre, r.categoria, parseFloat(r.uds), ingreso, costo, ganancia, margen]);
            });

            const ultimaFilaDatos = sheet.lastRow ? sheet.lastRow.number : filaEncabezadoNum;
            sheet.autoFilter = {
                from: { row: filaEncabezadoNum, column: 1 },
                to: { row: ultimaFilaDatos, column: 7 }
            };

            sheet.addRow([]);
            const margenTotal = tIngreso > 0 ? (tGanancia / tIngreso) : 0;
            const rTotRenta = sheet.addRow(['TOTALES DEL PERÍODO:', '', '', tIngreso, tCosto, tGanancia, margenTotal]);
            rTotRenta.font = { bold: true };
            
            sheet.getColumn(1).width = 40; 
            sheet.getColumn(4).numFmt = '"$"#,##0.00'; 
            sheet.getColumn(5).numFmt = '"$"#,##0.0000'; 
            sheet.getColumn(6).numFmt = '"$"#,##0.00'; 
            sheet.getColumn(7).numFmt = '0.00%'; 
        }

        // =========================================================
        // REPORTE G: KARDEX (CON AUTOFILTRO)
        // =========================================================
        if (filtro === 'kardex') {
            const sheet = workbook.addWorksheet('Kardex');
            agregarMembreteCorporativo(sheet, 'Historial de Movimientos de Kardex');

            const rowHeaders = sheet.addRow(['FECHA', 'PRODUCTO', 'TIPO', 'CANTIDAD', 'MOTIVO']);
            rowHeaders.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            rowHeaders.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            const filaEncabezadoNum = rowHeaders.number;
            
            let query = `
                SELECT h.fecha, p.nombre, h.tipo_movimiento, h.cantidad, h.motivo 
                FROM historial_movimientos h 
                JOIN productos p ON h.producto_id = p.id 
                WHERE h.fecha::date BETWEEN $1 AND $2 AND h.tienda_id = ${idTiendaLocal}
            `;
            if (producto && producto.trim() !== '') {
                query += ` AND (p.codigo ILIKE '%${producto}%' OR p.nombre ILIKE '%${producto}%')`;
            }
            query += ` ORDER BY h.fecha DESC`;
            
            const result = await client.query(query, [start, end]);
            result.rows.forEach(r => { 
                sheet.addRow([new Date(r.fecha).toLocaleString('es-VE'), r.nombre, r.tipo_movimiento, parseFloat(r.cantidad), r.motivo]); 
            });

            const ultimaFilaDatos = sheet.lastRow ? sheet.lastRow.number : filaEncabezadoNum;
            sheet.autoFilter = {
                from: { row: filaEncabezadoNum, column: 1 },
                to: { row: ultimaFilaDatos, column: 5 }
            };

            sheet.getColumn(1).width = 20; 
            sheet.getColumn(2).width = 30; 
            sheet.getColumn(5).width = 40;
        }

        // =========================================================
        // REPORTE H: MAESTRO ESTRUCTURAL DE FORMULAS Y COSTOS (PLANTILLA)
        // =========================================================
        if (filtro === 'formulas') {
            const sheet = workbook.addWorksheet('Costos Perfumix');
            
            // 1. Configuramos el ancho exacto de las columnas como en tu Excel
            sheet.columns = [
                { key: 'A', width: 5 },  // Margen izquierdo
                { key: 'B', width: 18 }, // Consumo
                { key: 'C', width: 15 }, // Codigo
                { key: 'D', width: 25 }, // Detalle
                { key: 'E', width: 12 }, // Costo
                { key: 'F', width: 15 }, // 1000.0000 (Divisor)
                { key: 'G', width: 15 }, // Costo Real
                { key: 'H', width: 20 }  // Unidad de Medida
            ];

            // 2. Extraemos los costos ACTUALES de tu base de datos para que sea dinámico
            const resPrecios = await client.query(`
                SELECT codigo, categoria, costo FROM productos
                WHERE (codigo IN ('ALCOHOL', 'FIJADOR', 'F30', 'F60', 'F100') OR categoria ILIKE '%esencia%')
                AND activo = true AND tienda_id = $1
            `, [idTiendaLocal]);

            let cAlc = 1.8, cFij = 7, cEse = 37, cF30 = 0.34, cF60 = 0.60, cF100 = 0.86;
            resPrecios.rows.forEach(r => {
                const cod = r.codigo.toUpperCase();
                const cat = (r.categoria || '').toUpperCase();
                const costo = parseFloat(r.costo || 0);

                if (cod.includes('ALCOHOL')) cAlc = costo;
                else if (cod.includes('FIJADOR')) cFij = costo;
                else if (cod === 'F30') cF30 = costo;
                else if (cod === 'F60') cF60 = costo;
                else if (cod === 'F100') cF100 = costo;
                else if (cat.includes('ESENCIA')) cEse = costo; 
            });

            // 3. Estilos reutilizables
            const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } } };
            const titleStyle = { font: { bold: true, size: 12 } };
            const moneyFmt = '"$"#,##0.00';
            const moneyFmtExact = '"$"#,##0.0000';

            // Función constructora de bloques idénticos a tu plantilla
            const dibujarBloqueCosto = (tipo, ml, vAlc, vEse, vFij, fCod, fDesc, fCost) => {
                const isRecarga = tipo === 'RECARGAS';
                
                sheet.addRow([]);
                sheet.addRow(['', tipo]).font = titleStyle;
                sheet.addRow(['', `${ml} ML`]).font = titleStyle;
                
                const cabecera = sheet.addRow(['', `${ml} ML Consumo`, 'Codigo', 'Detalle', 'Costo', '1000.0000', 'Costo', 'Unidad de Medida']);
                cabecera.eachCell(cell => { cell.font = headerStyle.font; cell.fill = headerStyle.fill; });

                const divAlc = cAlc / 1000, divEse = cEse / 1000, divFij = cFij / 1000;
                const totAlc = vAlc * divAlc, totEse = vEse * divEse, totFij = vFij * divFij;

                sheet.addRow(['', vAlc / 1000, 'ALCOHOL', 'ALCOHOL', cAlc, divAlc, totAlc, 'Litros']);
                sheet.addRow(['', vEse / 1000, 'ESENCIA', 'ESENCIA', cEse, divEse, totEse, 'Kilogramos']);
                sheet.addRow(['', vFij / 1000, 'FIJADOR', 'FIJADOR', cFij, divFij, totFij, 'Kilogramos']);

                let sumBruto = cAlc + cEse + cFij;
                let sumReal = totAlc + totEse + totFij;
                let volTotal = (vAlc + vEse + vFij) / 1000;

                if (!isRecarga) {
                    sheet.addRow(['', 1, fCod, fDesc, fCost, 1.0000, fCost, 'Und']);
                    sumBruto += fCost;
                    sumReal += fCost;
                }

                const filaTotal = sheet.addRow(['', volTotal, '', '', sumBruto, '', sumReal, '']);
                filaTotal.font = titleStyle;
                filaTotal.getCell(5).numFmt = moneyFmt;
                filaTotal.getCell(7).numFmt = moneyFmtExact;
            };

            // --- RENDERIZADO DEL EXCEL ---
            
            // Membrete corporativo para la plantilla de costos
            sheet.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 14 };
            sheet.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheet.addRow(['MATRIZ DE COSTOS Y FORMULACIÓN']).font = { bold: true, size: 12 };
            sheet.addRow([`Fecha de Generación: ${new Date().toLocaleDateString('es-VE')}`]).font = { bold: true, size: 10, color: { argb: 'FF475569' } };
            sheet.addRow([]);

            sheet.addRow(['', 'Formula de Producto Terminado']).font = { bold: true, size: 14 };

            // PERFUMES TERMINADOS
            dibujarBloqueCosto('PERFUME', 30, 19, 7, 4, 'F30', 'FRASCO 30ML', cF30);
            dibujarBloqueCosto('PERFUME', 60, 32, 12, 6, 'F60', 'FRASCO 60ML', cF60);
            dibujarBloqueCosto('PERFUME', 100, 62, 25, 13, 'F100', 'FRASCO 100ML', cF100);

            // RECARGAS ECOLÓGICAS
            sheet.addRow([]);
            sheet.addRow([]);
            sheet.addRow(['', 'RECARGAS']).font = { bold: true, size: 14 };

            dibujarBloqueCosto('RECARGAS', 30, 19, 7, 4, null, null, 0);
            dibujarBloqueCosto('RECARGAS', 60, 32, 12, 6, null, null, 0);
            dibujarBloqueCosto('RECARGAS', 100, 62, 25, 13, null, null, 0);

            // EXTRAS DE DOSIFICACIÓN
            sheet.addRow([]);
            const extraHeader = sheet.addRow(['', 'EXTRAS DE DOSIFICACIÓN']);
            extraHeader.font = titleStyle;
            
            sheet.addRow(['', 0.002, 'FIJ-EXT', 'Extra de Fijador', cFij, '', cFij * 0.002, 'Kilogramos']);
            sheet.addRow(['', 0.002, 'ESE-EXT', 'Extra de Esencia', cEse, '', cEse * 0.002, 'Kilogramos']);

            // RESUMEN MATERIA PRIMA (Tabla inferior de tu Excel)
            sheet.addRow([]);
            sheet.addRow([]);
            sheet.addRow(['', 'Costos de Materia Prima:']).font = titleStyle;
            const mpHeader = sheet.addRow(['', 'Und de Medida', 'Código', 'Articulo', 'Costo']);
            mpHeader.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });

            sheet.addRow(['', 'Und', 'F30', 'Frasco Tubular R 30 ML', cF30]);
            sheet.addRow(['', 'Und', 'F60', 'Frasco Tubular R 60 ML', cF60]);
            sheet.addRow(['', 'Und', 'F100', 'Frasco Tubular R 100 ML', cF100]);
            sheet.addRow(['', 'Kilogramos', 'FIJADOR', 'Fijador', cFij]);
            sheet.addRow(['', 'Kilogramos', 'ESENCIA', 'Esencia Surtida Mix', cEse]);
            sheet.addRow(['', 'Litros', 'ALCOHOL', 'Alcohol Absoluto', cAlc]);

            // Formatear las columnas de moneda en todo el Excel
            sheet.getColumn('E').numFmt = moneyFmt;
            sheet.getColumn('G').numFmt = moneyFmtExact;
        }

        // 4. RETORNO DE STREAM BINARIO DIRECTO HACIA EL NAVEGADOR
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_Audit_${filtro}_${new Date().toISOString().slice(0,10)}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Fallo crítico en matriz de reportes generales:", error);
        res.status(500).send("Error generando matriz.");
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
        const { fecha } = req.query; 
        
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev';

        // Modificamos el check inicial para que busque el arqueo de esta sucursal específica
        const checkQuery = fecha 
            ? "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = $1::date AND detalles_json->>'tienda_origen' = $2"
            : "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = CURRENT_DATE AND detalles_json->>'tienda_origen' = $1";
        
        const paramCheck = fecha ? [fecha, String(idTiendaLocal)] : [String(idTiendaLocal)];

        const client = await pool.connect();
        try {
            const checkRes = await client.query(checkQuery, paramCheck);
            if (checkRes.rows.length > 0 && !fecha) {
                return res.status(400).json({ 
                    error: 'YA CERRADO', 
                    mensaje: `⛔ EL CIERRE DE HOY PARA ESTA SUCURSAL YA FUE REALIZADO.` 
                });
            }

            // 🔥 CORRECCIÓN: Filtramos las ventas estrictamente por la tienda del operador
            let whereFecha = fecha ? "1=1" : "DATE(v.fecha) = CURRENT_DATE";
            whereFecha += ` AND v.tienda_id = ${idTiendaLocal}`;

            const queryRaw = `
                SELECT p.metodo, p.moneda, COALESCE(p.monto::numeric, 0) as monto, 
                       COALESCE(p.tasa_cambio::numeric, 0) as tasa, p.id as pago_id, v.id as venta_id
                FROM pagos p 
                JOIN ventas v ON p.venta_id = v.id
                WHERE ${whereFecha}
                  AND NOT EXISTS (
                      SELECT 1 FROM cierres_caja cc,
                      jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                      WHERE cc.detalles_json->'ids_ventas_origen_hoy' IS NOT NULL AND elem::int = v.id
                  )
            `;
            
            const resRaw = await client.query(queryRaw);
            
            if (resRaw.rows.length === 0) {
                return res.json({
                    totales: { usd: "0.00", bs: "0.00", transacciones: 0 },
                    desglose_metodos: [],
                    historial_pagos: [],
                    fecha_referencia: fecha || null,
                    mensaje: "💡 No quedan ventas pendientes de cierre en esta sucursal."
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

            const queryDetalle = `
                SELECT v.id as venta_id, v.fecha as fecha_venta, p.metodo, p.moneda,
                       COALESCE(p.monto::numeric, 0) as monto, COALESCE(p.tasa_cambio::numeric, 0) as tasa, c.nombre as cliente
                FROM pagos p 
                JOIN ventas v ON p.venta_id = v.id
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE ${whereFecha} 
                  AND NOT EXISTS (
                      SELECT 1 FROM cierres_caja cc,
                      jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                      WHERE cc.detalles_json->'ids_ventas_origen_hoy' IS NOT NULL AND elem::int = v.id
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

                return { ...d, moneda, monto_bs, monto_usd };
            });

            res.json({
                totales: { usd: granTotalUSD.toFixed(2), bs: granTotalBs.toFixed(2), transacciones: resRaw.rows.length },
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
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

        if (!fecha_manual) {
            return res.status(400).json({ error: 'La fecha histórica es obligatoria.' });
        }
        
        const vIds = Array.isArray(ids_ventas) ? ids_ventas : [];
        await client.query('BEGIN');

        // 🔒 CANDADO: Máximo 7 cierres por fecha, pero separados por sucursal
        const checkCount = await client.query(`
            SELECT COUNT(*) FROM cierres_caja 
            WHERE DATE(fecha_cierre) = DATE($1) AND tienda_id = $2
        `, [fecha_manual, idTiendaLocal]);
        
        const totalCierresEseDia = parseInt(checkCount.rows[0].count, 10);
        if (totalCierresEseDia >= 7) {
            throw new Error(`LÍMITE DIARIO SUPERADO: Ya existen ${totalCierresEseDia} cierres guardados para la fecha ${fecha_manual} en esta sucursal.`);
        }

        const resumenMap = {};
        let granTotalUSD = 0; let granTotalBs = 0;
        const ventasContadas = new Set();

        if (vIds.length > 0) {
            // 🔒 Validamos que las facturas pertenezcan a esta tienda
            const queryRaw = `
                SELECT p.metodo, p.moneda, COALESCE(p.monto::numeric, 0) as monto, COALESCE(p.tasa_cambio::numeric, 0) as tasa, v.id as venta_id
                FROM pagos p JOIN ventas v ON p.venta_id = v.id
                WHERE v.id = ANY($1::int[]) AND v.tienda_id = $2
                  AND NOT EXISTS (
                      SELECT 1 FROM cierres_caja cc, jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                      WHERE cc.detalles_json->'ids_ventas_origen_hoy' IS NOT NULL AND elem::int = v.id
                  )
            `;
            const resRaw = await client.query(queryRaw, [vIds, idTiendaLocal]);
            if (resRaw.rows.length === 0) throw new Error(`TODO CERRADO: Las facturas ya fueron procesadas o no pertenecen a esta sucursal.`);

            resRaw.rows.forEach(row => {
                const monto = parseFloat(row.monto); const tasa = parseFloat(row.tasa);
                const moneda = (row.moneda || 'USD').toUpperCase();
                let montoUsdConvertido = 0; let montoBsConvertido = 0;
                if (moneda === 'BS' || moneda === 'BSS' || moneda === 'VES') {
                    montoBsConvertido = monto; montoUsdConvertido = tasa > 0 ? (monto / tasa) : 0;
                } else {
                    montoUsdConvertido = monto; montoBsConvertido = monto * tasa;
                }
                granTotalUSD += montoUsdConvertido; granTotalBs += montoBsConvertido;
                ventasContadas.add(row.venta_id);
                const metodo = row.metodo || 'Otros';
                if (!resumenMap[metodo]) resumenMap[metodo] = { metodo, transacciones: 0, total_usd: 0, total_bs: 0 };
                resumenMap[metodo].transacciones += 1;
                resumenMap[metodo].total_usd += montoUsdConvertido;
                resumenMap[metodo].total_bs += montoBsConvertido;
            });
        }

        const notaFinal = vIds.length === 0
            ? (observaciones || `ARQUEO MANUAL EN CERO - DÍA SIN FACTURACIÓN (${fecha_manual})`)
            : (observaciones || `CIERRE MANUAL SELECCIONADO EN FECHA (${fecha_manual})`);

        // 🔒 Insertamos la tienda al historial
        const insertCierre = await client.query(`
            INSERT INTO cierres_caja 
            (usuario_id, total_usd, total_bs, cantidad_ventas, detalles_json, notas, fecha_cierre, tienda_id) 
            VALUES ($1, $2, $3, $4, $5, $6, ($7::date + NOW()::time), $8) RETURNING id
        `, [
            usuarioOperadorId, granTotalUSD.toFixed(2), granTotalBs.toFixed(2), ventasContadas.size,
            JSON.stringify({ desglose_pagos: Object.values(resumenMap), ids_ventas_origen_hoy: Array.from(ventasContadas) }),
            notaFinal, fecha_manual, idTiendaLocal
        ]);

        await client.query('COMMIT');
        res.json({ mensaje: 'Arqueo histórico guardado con éxito.', id_cierre: insertCierre.rows[0].id, ventas_procesadas: ventasContadas.size, total_usd_registrado: granTotalUSD.toFixed(2) });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally { client.release(); }
};

const guardarCierre = async (req, res) => {
    try {
        const { totales, detalles, notas, fecha_referencia } = req.body;
        const usuario_id = req.user?.id;
        
        // 🔥 CANDADO: Identificamos la tienda que está cerrando la caja
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
                
        // 🔒 Filtramos para buscar cierres de HOY, pero SOLO de ESTA tienda
        const paramCheck = fecha_referencia ? [fecha_referencia, idTiendaLocal] : [idTiendaLocal];
        const checkSql = fecha_referencia 
            ? "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = $1 AND tienda_id = $2"
            : "SELECT id FROM cierres_caja WHERE DATE(fecha_cierre) = CURRENT_DATE AND tienda_id = $1";
        
        const check = await pool.query(checkSql, paramCheck);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: 'DUPLICADO', mensaje: 'ERROR CRÍTICO: Ya existe un cierre registrado para esta fecha en su sucursal.' });
        }

        let idsVentas = [];
        if (detalles && detalles.historial_pagos) {
            idsVentas = detalles.historial_pagos.map(p => p.venta_id);
        } else {
            // 🔒 Aseguramos que solo bloquee las ventas de esta sucursal
            const ventasHoyRes = await pool.query("SELECT id FROM ventas WHERE DATE(fecha) = CURRENT_DATE AND tienda_id = $1", [idTiendaLocal]);
            idsVentas = ventasHoyRes.rows.map(v => v.id);
        }

        const estructuraDetalles = {
            desglose_pagos: detalles.desglose_metodos || detalles,
            ids_ventas_origen_hoy: idsVentas 
        };

        // 🔒 Inyectamos el tienda_id en la base de datos
        const insertSql = `
            INSERT INTO cierres_caja 
            (usuario_id, total_usd, total_bs, cantidad_ventas, detalles_json, notas, fecha_cierre, tienda_id) 
            VALUES ($1, $2, $3, $4, $5, $6, ${fecha_referencia ? "($7::date + NOW()::time)" : "NOW()"}, $${fecha_referencia ? '8' : '7'}) 
            RETURNING id
        `;
        
        const params = [usuario_id, totales.usd, totales.bs, totales.transacciones, JSON.stringify(estructuraDetalles), notas];
        if (fecha_referencia) {
            params.push(fecha_referencia, idTiendaLocal);
        } else {
            params.push(idTiendaLocal);
        }

        const result = await pool.query(insertSql, params);
        res.json({ mensaje: 'Cierre de sucursal guardado exitosamente', id: result.rows[0].id });
    } catch (error) { 
        console.error("Error guardando cierre:", error);
        res.status(500).json({ error: 'Error interno al guardar cierre' }); 
    }
};

const getHistorialCierres = async (req, res) => {
    try {
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev';

        let query = `
            SELECT c.*, u.nombre as usuario 
            FROM cierres_caja c 
            LEFT JOIN usuarios u ON c.usuario_id = u.id 
            WHERE 1=1
        `;
        
        // 🔒 Filtramos por tienda si no es Developer
        if (!esUsuarioMaestro) {
            query += ` AND c.tienda_id = ${idTiendaLocal}`;
        }
        
        query += ` ORDER BY c.fecha_cierre DESC LIMIT 30`;

        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
};

const descargarCierreExcel = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    
    try {
        const result = await client.query(`
            SELECT c.*, u.nombre as usuario 
            FROM cierres_caja c 
            LEFT JOIN usuarios u ON c.usuario_id = u.id 
            WHERE c.id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            client.release();
            return res.status(404).send("Cierre no encontrado");
        }
        
        const cierre = result.rows[0];
        
        // Parsear los detalles guardados
        const detalles = typeof cierre.detalles_json === 'string' ? JSON.parse(cierre.detalles_json) : (cierre.detalles_json || {});
        
        // 🔥 CORRECCIÓN CRÍTICA: Normalización robusta del array de pagos
        let desglose = [];
        if (Array.isArray(detalles.desglose_pagos)) desglose = detalles.desglose_pagos;
        else if (detalles.desglose_pagos && Array.isArray(detalles.desglose_pagos.desglose_pagos)) desglose = detalles.desglose_pagos.desglose_pagos;
        else if (Array.isArray(detalles.desglose_metodos)) desglose = detalles.desglose_metodos;
        else if (detalles.desglose_pagos && typeof detalles.desglose_pagos === 'object') desglose = Object.values(detalles.desglose_pagos);
        
        const idsVentas = detalles.ids_ventas_origen_hoy || [];

        const totalUsd = parseFloat(cierre.total_usd) || 0;
        const totalBs = parseFloat(cierre.total_bs) || 0;
        const tasaPromedio = totalUsd > 0 ? (totalBs / totalUsd) : 0;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema Corporativo';

        // ==========================================
        // HOJA 1: RESUMEN GENERAL Y MATRIZ DE MÉTODOS
        // ==========================================
        const sheet = workbook.addWorksheet('Balance de Cierre');
        
        sheet.mergeCells('A1:D1');
        const titleCell = sheet.getCell('A1');
        titleCell.value = `REPORTE CONSOLIDADO DE CIERRE DE CAJA N° ${String(cierre.id).padStart(6, '0')}`;
        titleCell.font = { size: 14, bold: true, color: { argb: 'FF1E293B' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 25;

        sheet.addRow(['Fecha de Operación:', new Date(cierre.fecha_cierre).toLocaleString('es-VE'), 'ID Sucursal:', cierre.tienda_id || 'Principal']);
        sheet.addRow(['Usuario Responsable:', cierre.usuario || 'Sistema', 'Cant. Transacciones:', parseInt(cierre.cantidad_ventas) || 0]);
        sheet.addRow(['Tasa Cambio Promedio:', tasaPromedio, 'Notas:', cierre.notas || 'Sin notas registradas']);
        sheet.addRow([]);

        for (let i = 1; i <= 4; i++) sheet.getRow(i).font = { bold: true };

        const metodosEstandar = {
            'EFECTIVO USD': { usd: 0, bs: 0, trx: 0 },
            'EFECTIVO BS': { usd: 0, bs: 0, trx: 0 },
            'PUNTO DE VENTA': { usd: 0, bs: 0, trx: 0 },
            'TRANSFERENCIA': { usd: 0, bs: 0, trx: 0 },
            'PAGO MOVIL': { usd: 0, bs: 0, trx: 0 },
            'CASHEA': { usd: 0, bs: 0, trx: 0 },
            'ZELLE': { usd: 0, bs: 0, trx: 0 },
            'BIOPAGO': { usd: 0, bs: 0, trx: 0 },
            'BINANCE': { usd: 0, bs: 0, trx: 0 },
            'CXC (CRÉDITO)': { usd: 0, bs: 0, trx: 0 },
            'OTROS': { usd: 0, bs: 0, trx: 0 }
        };

        // Ya no lanzará error porque garantizamos que desglose sea un Array
        desglose.forEach(d => {
            let m = (d.metodo || 'OTROS').toUpperCase();
            let key = 'OTROS';
            if (m.includes('EFECTIVO USD') || m.includes('DIVISA') || m.includes('DOLAR')) key = 'EFECTIVO USD';
            else if (m.includes('EFECTIVO BS') || m === 'EFECTIVO') key = 'EFECTIVO BS';
            else if (m.includes('PUNTO')) key = 'PUNTO DE VENTA';
            else if (m.includes('MOVIL') || m.includes('P. MOVIL')) key = 'PAGO MOVIL';
            else if (m.includes('TRANS')) key = 'TRANSFERENCIA';
            else if (m.includes('ZELLE')) key = 'ZELLE';
            else if (m.includes('BIO') || m.includes('BIOPAGO')) key = 'BIOPAGO';
            else if (m.includes('BINANCE')) key = 'BINANCE';
            else if (m.includes('CASHEA')) key = 'CASHEA';
            else if (m.includes('CXC') || m.includes('CREDITO')) key = 'CXC (CRÉDITO)';

            metodosEstandar[key].usd += parseFloat(d.total_usd || d.usd || 0);
            metodosEstandar[key].bs += parseFloat(d.total_bs || d.bs || 0);
            metodosEstandar[key].trx += parseInt(d.transacciones || d.cantidad_transacciones || 0);
        });

        const rowHead = sheet.addRow(['MÉTODO DE PAGO', 'CANT. OPERACIONES', 'TOTAL INGRESOS (USD)', 'TOTAL INGRESOS (BS)']);
        rowHead.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        rowHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; 
        rowHead.alignment = { horizontal: 'center' };

        Object.keys(metodosEstandar).forEach(key => {
            const fila = sheet.addRow([
                key, 
                metodosEstandar[key].trx, 
                metodosEstandar[key].usd, 
                metodosEstandar[key].bs
            ]);
            fila.getCell(1).font = { bold: true };
        });

        sheet.addRow([]);
        const rowData = sheet.addRow(['BALANCE GENERAL DE CAJA', parseInt(cierre.cantidad_ventas) || 0, totalUsd, totalBs]);
        rowData.font = { bold: true, size: 12 };
        rowData.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; 

        sheet.getColumn(1).width = 30;
        sheet.getColumn(2).width = 20;
        sheet.getColumn(3).width = 25;
        sheet.getColumn(4).width = 25;
        
        sheet.getColumn(2).alignment = { horizontal: 'center' };
        sheet.getColumn(3).numFmt = '"$"#,##0.00'; 
        sheet.getColumn(4).numFmt = '"Bs "#,##0.00';

        // ==========================================
        // HOJA 2: DETALLE DE FACTURAS (TRANSACCIONES)
        // ==========================================
        if (idsVentas.length > 0) {
            const sheetDetalle = workbook.addWorksheet('Desglose de Facturas');
            
            sheetDetalle.addRow(['LISTADO DE FACTURAS INCLUIDAS EN EL CIERRE']);
            sheetDetalle.addRow([]);
            sheetDetalle.getRow(1).font = { bold: true, size: 12 };

            const headerDetalle = sheetDetalle.addRow(['ID VENTA', 'FECHA/HORA', 'CLIENTE', 'MÉTODO PAGO (BRUTO)', 'MONEDA', 'MONTO ORIGINAL', 'TASA', 'MONTO USD']);
            headerDetalle.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerDetalle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; 

            const trxRes = await client.query(`
                SELECT p.metodo, p.moneda, COALESCE(p.monto::numeric, 0) as monto, 
                       COALESCE(p.tasa_cambio::numeric, 0) as tasa, v.id as venta_id,
                       c.nombre as cliente_nombre, v.fecha
                FROM pagos p 
                JOIN ventas v ON p.venta_id = v.id
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE v.id = ANY($1::int[])
                ORDER BY v.fecha ASC
            `, [idsVentas]);

            trxRes.rows.forEach(pago => {
                const monto = parseFloat(pago.monto);
                const tasa = parseFloat(pago.tasa);
                const moneda = (pago.moneda || 'USD').toUpperCase();
                
                let montoUSD = 0;
                if (moneda === 'BS' || moneda === 'VES' || moneda === 'BSS') {
                    montoUSD = tasa > 0 ? (monto / tasa) : 0;
                } else {
                    montoUSD = monto;
                }

                sheetDetalle.addRow([
                    pago.venta_id,
                    new Date(pago.fecha).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }),
                    pago.cliente_nombre || 'Consumidor Final',
                    pago.metodo,
                    moneda,
                    monto,
                    tasa,
                    montoUSD
                ]);
            });

            sheetDetalle.getColumn(1).width = 12;
            sheetDetalle.getColumn(2).width = 15;
            sheetDetalle.getColumn(3).width = 30;
            sheetDetalle.getColumn(4).width = 25;
            sheetDetalle.getColumn(5).width = 10;
            sheetDetalle.getColumn(6).width = 18;
            sheetDetalle.getColumn(7).width = 12;
            sheetDetalle.getColumn(8).width = 18;

            sheetDetalle.getColumn(6).numFmt = '#,##0.00';
            sheetDetalle.getColumn(8).numFmt = '"$"#,##0.00';
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Cierre_Caja_${id}_Historial.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) { 
        console.error("Error Excel Cierre Histórico:", error);
        if (!res.headersSent) res.status(500).send("Error generando Excel de Cierre Histórico"); 
    } finally {
        client.release();
    }
};

const crearVenta = async (req, res) => {
    const client = await pool.connect();
    try {
        const { items, total, cliente_id, pagos, usuario_id, es_externa, descripcion_externa, confirmacion_almacen } = req.body;
        const vendedorFinalId = usuario_id ? usuario_id : (req.user ? req.user.id : null);
        
        // Identificar la tienda local de la transacción
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        
        if (!es_externa && (!items || items.length === 0)) {
            return res.status(400).json({ error: 'El carrito está vacío.' });
        }

        await client.query('BEGIN'); 

        // 1. SEGURIDAD ANTI-FRAUDE (Validación de referencias únicas)
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

        // 2. PROCESAR DEDUCCIONES DE INVENTARIO
        if (!es_externa) {
            for (const item of items) {
                const cant = parseFloat(item.cantidad);
                const cleanItemId = parseInt(item.id, 10);

                const prodActualRes = await client.query('SELECT id, codigo, nombre FROM productos WHERE id = $1', [cleanItemId]);
                if (prodActualRes.rows.length === 0) throw new Error(`Producto ID ${cleanItemId} no existe en el catálogo.`);
                const prodActual = prodActualRes.rows[0];
                const codigoProd = (prodActual.codigo || '').trim().toUpperCase();

                const esCodigoPT = codigoProd.includes('-T');

                // Si viene formula_id Y NO está marcado como PT explícito -> Desglosar Insumos
                if (item.formula_id && !item.es_pt && !esCodigoPT) {
                    // =========================================================================
                    // 🧪 PREPARACIÓN POR FÓRMULA: DESCUENTA ESENCIA, ALCOHOL, FIJADOR Y ENVASE
                    // =========================================================================
                    const formulaRes = await client.query('SELECT * FROM formulas WHERE id = $1', [parseInt(item.formula_id, 10)]);
                    if (formulaRes.rows.length === 0) throw new Error(`Fórmula ID ${item.formula_id} no encontrada.`);
                    const f = formulaRes.rows[0];
                    const volumen = parseInt(f.volumen_total, 10);

                    // A. Esencia Base (Gramos según fórmula * Cantidad de perfumes)
                    const gramosExtra = parseFloat(item.gramos_extra) || 0;
                    const gramosEsenciaBase = parseFloat(f.gramos_esencia) || 0;
                    const totalEsencia = (gramosEsenciaBase + gramosExtra) * cant;
                    
                    await validarYDescontarEstante(
                        client, 
                        cleanItemId, 
                        totalEsencia, 
                        `Esencia Base (${prodActual.nombre})`, 
                        idTiendaLocal, 
                        confirmacion_almacen,
                        vendedorFinalId
                    );
                    
                    // B. Alcohol (mL según fórmula * Cantidad de perfumes)
                    if (parseFloat(f.ml_alcohol) > 0) {
                        const alcoholUnitario = item.ml_alcohol_override !== undefined && item.ml_alcohol_override !== null 
                                                ? parseFloat(item.ml_alcohol_override) 
                                                : parseFloat(f.ml_alcohol);
                                                
                        const totalAlcohol = alcoholUnitario * cant;
                        
                        if (totalAlcohol > 0) {
                            const alcoholRes = await client.query(`
                                SELECT id, nombre FROM productos 
                                WHERE (nombre ILIKE '%ALCOHOL%' OR categoria = 'Alcohol') 
                                  AND activo = true 
                                  AND (stock_estante + stock_unidades) >= $1 
                                  AND tienda_id = $2
                                ORDER BY (stock_estante + stock_unidades) DESC LIMIT 1 FOR UPDATE
                            `, [totalAlcohol, idTiendaLocal]); 
                            
                            if (alcoholRes.rows.length === 0) throw new Error(`🚫 FALTA ALCOHOL: Se requieren ${totalAlcohol.toFixed(2)}ml en esta sucursal.`);
                            await validarYDescontarEstante(client, alcoholRes.rows[0].id, totalAlcohol, "Alcohol", idTiendaLocal, confirmacion_almacen, vendedorFinalId);
                        }
                    }

                    // C. Fijador (Gramos según fórmula * Cantidad de perfumes)
                    const gramosFijadorExtra = parseFloat(item.gramos_fijador_extra) || 0;
                    const gramosFijadorFormula = parseFloat(f.gramos_fijador) || 0;
                    const totalFijador = (gramosFijadorFormula + gramosFijadorExtra) * cant;

                    if (totalFijador > 0) {
                        const fijadorRes = await client.query(`
                            SELECT id, nombre FROM productos 
                            WHERE (nombre ILIKE '%FIJADOR%' OR categoria = 'Fijador') 
                              AND activo = true 
                              AND (stock_estante + stock_unidades) >= $1 
                              AND tienda_id = $2
                            ORDER BY (stock_estante + stock_unidades) DESC LIMIT 1 FOR UPDATE
                        `, [totalFijador, idTiendaLocal]); 
                        
                        if (fijadorRes.rows.length === 0) throw new Error(`🚫 FALTA FIJADOR: Se necesitan ${totalFijador.toFixed(2)}g en esta sucursal.`);
                        await validarYDescontarEstante(client, fijadorRes.rows[0].id, totalFijador, "Fijador", idTiendaLocal, confirmacion_almacen, vendedorFinalId);
                    }

                    // D. Envase / Frasco
                    if (!item.es_recarga) {
                        const envaseRes = await client.query(`
                            SELECT id, nombre FROM productos 
                            WHERE (categoria = 'Envases' OR categoria = 'Frascos' OR nombre ILIKE '%ENVASE%' OR nombre ILIKE '%FRASCO%')
                              AND (nombre ILIKE $1 OR contenido_gramos = $2)
                              AND activo = true 
                              AND (stock_estante + stock_unidades) >= $3 
                              AND tienda_id = $4
                            ORDER BY (stock_estante + stock_unidades) DESC LIMIT 1 FOR UPDATE
                        `, [`%${volumen}%`, volumen, cant, idTiendaLocal]);

                        if (envaseRes.rows.length === 0) throw new Error(`🚫 FALTA FRASCO: No hay envases de ${volumen}ml disponibles en esta sucursal.`);
                        await validarYDescontarEstante(client, envaseRes.rows[0].id, cant, `Frasco ${volumen}ml`, idTiendaLocal, confirmacion_almacen, vendedorFinalId);
                    }

                } else {
                    // =========================================================================
                    // 📦 VENTA DIRECTA O PERFUME TERMINADO (PT)
                    // =========================================================================
                    await validarYDescontarEstante(
                        client, 
                        cleanItemId, 
                        cant, 
                        item.descripcion || prodActual.nombre, 
                        idTiendaLocal, 
                        confirmacion_almacen,
                        vendedorFinalId
                    );
                }
            }
        }

        // 3. INSERTAR CABECERA DE VENTA
        const ventaRes = await client.query(
            'INSERT INTO ventas (total, cliente_id, fecha, usuario_id, tienda_id) VALUES ($1, $2, NOW(), $3, $4) RETURNING id', 
            [total, cliente_id || 1, vendedorFinalId, idTiendaLocal]
        );

        const ventaId = ventaRes.rows[0].id;

        // 4. INSERTAR DETALLES
        if (!es_externa && items && items.length > 0) {
            const values = [];
            const placeholders = items.map((item, i) => {
                const offset = i * 10;
                values.push(
                    ventaId, 
                    parseInt(item.id, 10), 
                    item.cantidad, 
                    item.precio, 
                    item.subtotal, 
                    item.descripcion || 'Producto', 
                    item.formula_id || null,
                    item.costo || 0, 
                    item.tarifa || 'DETAL',
                    item.tamano || 'N/A'
                );
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`;
            }).join(', ');

            const queryDetalles = `
                INSERT INTO detalle_ventas 
                (venta_id, producto_id, cantidad, precio_unitario, subtotal, descripcion, formula_id, costo_unitario_historico, tarifa_aplicada, tamano)
                VALUES ${placeholders}
            `;

            await client.query(queryDetalles, values);
            
        } else if (es_externa) {
            await client.query(`
                INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, descripcion, tamano)
                VALUES ($1, NULL, 1, $2, $3, $4, $5)
            `, [ventaId, total, total, descripcion_externa || 'Venta Externa Registrada', 'N/A']); 
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
        console.error("Error en procesamiento de venta:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const getReportes = async (req, res) => {
    try {
        const { rango, start, end } = req.query;
        
        // 🔥 1. LECTURA EN VIVO: Extraemos la tienda real para los Gráficos
        let idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        if (req.user?.id) {
            const userDb = await pool.query('SELECT tienda_id FROM usuarios WHERE id = $1', [req.user.id]);
            if (userDb.rows.length > 0 && userDb.rows[0].tienda_id !== null) {
                idTiendaLocal = parseInt(userDb.rows[0].tienda_id, 10);
            }
        }
        
        let dondeFiltrar = "";
        let queryParams = [];
        let agruparPor = "to_char(v.fecha, 'DD/MM')";

        if (start && end) {
            dondeFiltrar = "WHERE v.fecha::date BETWEEN $1 AND $2";
            queryParams = [start, end];
        } else {
            let intervalo = "INTERVAL '7 days'";
            if (rango === '30d') {
                intervalo = "INTERVAL '30 days'";
            } else if (rango === '1y') {
                intervalo = "INTERVAL '1 year'";
                agruparPor = "to_char(v.fecha, 'MM/YY')";
            }
            dondeFiltrar = `WHERE v.fecha >= CURRENT_DATE - ${intervalo}`;
        }

        // 🔥 2. CANDADO OBLIGATORIO: Aislar gráficos para la sucursal actual
        dondeFiltrar += ` AND v.tienda_id = ${idTiendaLocal}`;

        // 1. Historial Financiero Localizado con Extracción Inteligente de Medidas
        const historialQuery = `
            SELECT 
                ${agruparPor} as dia,
                SUM(d.subtotal) as venta_bruta,
                SUM(d.cantidad) as total_unidades,
                SUM(d.cantidad * (
                    CASE 
                        WHEN p.costo >= d.precio_unitario THEN d.precio_unitario * 0.8
                        ELSE p.costo
                    END
                )) as costo_estimado,

                -- 🚨 EXTRACCIÓN DE BOTELLAS DE 30ML, 60ML Y 100ML (DESECHANDO 'N/A')
                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '30' THEN d.cantidad ELSE 0 END) as u30,
                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '60' THEN d.cantidad ELSE 0 END) as u60,
                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '100' THEN d.cantidad ELSE 0 END) as u100,

                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '30' THEN d.subtotal ELSE 0 END) as p30,
                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '60' THEN d.subtotal ELSE 0 END) as p60,
                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '100' THEN d.subtotal ELSE 0 END) as p100,

                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '30' THEN d.cantidad * (
                    CASE 
                        WHEN p.costo >= d.precio_unitario THEN d.precio_unitario * 0.8
                        ELSE p.costo
                    END) ELSE 0 END) as c30,
                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '60' THEN d.cantidad * (
                    CASE 
                        WHEN p.costo >= d.precio_unitario THEN d.precio_unitario * 0.8
                        ELSE p.costo
                    END) ELSE 0 END) as c60,
                SUM(CASE WHEN REGEXP_REPLACE(COALESCE(NULLIF(NULLIF(UPPER(d.tamano), 'N/A'), ''), f.volumen_total::text, p.unidad_medida, ''), '[^0-9]', '', 'g') = '100' THEN d.cantidad * (
                    CASE 
                        WHEN p.costo >= d.precio_unitario THEN d.precio_unitario * 0.8
                        ELSE p.costo
                    END) ELSE 0 END) as c100

            FROM ventas v
            JOIN detalle_ventas d ON v.id = d.venta_id
            LEFT JOIN formulas f ON d.formula_id = f.id
            JOIN productos p ON d.producto_id = p.id
            ${dondeFiltrar}
            GROUP BY dia
            ORDER BY MAX(v.fecha) ASC
        `;
        const historialRes = await pool.query(historialQuery, queryParams);
        
       const financiero = historialRes.rows.map(row => {
            const ingreso = parseFloat(row.venta_bruta || 0);
            const costo = parseFloat(row.costo_estimado || 0);
            const utilidad = Math.max(0, ingreso - costo);
            const totalUnidades = parseFloat(row.total_unidades || 0);

            const u30 = parseFloat(row.u30 || 0);
            const u60 = parseFloat(row.u60 || 0);
            const u100 = parseFloat(row.u100 || 0);

            // 🚨 CALCULA AUTOMÁTICAMENTE LAS UNIDADES RESTANTES (PT / OTROS)
            // Para que 53 (30ml) + 1 (100ml) + 10 (Otros) = 64 Totales
            const upt = Math.max(0, totalUnidades - (u30 + u60 + u100));

            return {
                dia: row.dia,
                ingreso: ingreso,
                costo: costo,
                utilidad: utilidad,
                total_unidades: totalUnidades,

                // DESGLOSE COMPLETO DE UNIDADES
                u30: u30,
                u60: u60,
                u100: u100,
                upt: upt, // <--- AQUÍ SE CAPTURAN LAS 10 UNIDADES FALTANTES

                // INGRESOS Y COSTOS DESGLOSADOS
                p30: parseFloat(row.p30 || 0),
                p60: parseFloat(row.p60 || 0),
                p100: parseFloat(row.p100 || 0),
                c30: parseFloat(row.c30 || 0),
                c60: parseFloat(row.c60 || 0),
                c100: parseFloat(row.c100 || 0)
            };
        });

        // 2. Categorías Locales
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

        // 3. Top Productos de la Sucursal
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

        // 4. Productos Hueso Específicos de esta Tienda
        const huesosQuery = `
            SELECT p.nombre, p.stock_unidades, p.precio_venta, p.categoria
            FROM productos p
            WHERE p.stock_unidades > 0 
              AND p.activo = true
              AND p.tienda_id = ${idTiendaLocal}
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
        console.error("Error en getReportes:", error);
        res.status(500).json({ error: 'Error interno en reportes' });
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
        const { rango, start, end } = req.query;
        
        // 🔥 1. LECTURA EN VIVO: Rompemos el token congelado para leer la sucursal actual de la BD
        let idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        if (req.user?.id) {
            const userDb = await pool.query('SELECT tienda_id FROM usuarios WHERE id = $1', [req.user.id]);
            if (userDb.rows.length > 0 && userDb.rows[0].tienda_id !== null) {
                idTiendaLocal = parseInt(userDb.rows[0].tienda_id, 10);
            }
        }
        
        let whereClause = "";
        let prevWhereClause = "";
        let queryParams = [];

        // 2. Manejo del Rango Personalizado
        if (rango === 'custom' && start && end) {
            whereClause = "fecha::date BETWEEN $1::date AND $2::date";
            prevWhereClause = "fecha::date BETWEEN $1::date - ($2::date - $1::date + 1) AND $1::date - 1";
            queryParams = [start, end];
        } else {
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
                whereClause = "DATE(fecha) = CURRENT_DATE";
                prevWhereClause = "DATE(fecha) = CURRENT_DATE - 1";
            }
        }

        // 🔥 3. CANDADO OBLIGATORIO: Forzamos a que TODOS vean solo los KPIs de la tienda en la que están
        whereClause += ` AND tienda_id = ${idTiendaLocal}`;
        prevWhereClause += ` AND tienda_id = ${idTiendaLocal}`;

        // Resumen de Inventario enfocado en la sucursal activa
        let inventoryQuery = `
            SELECT 
                (SELECT COUNT(*) FROM productos WHERE activo = true AND tienda_id = ${idTiendaLocal}) AS total_productos,
                (SELECT COALESCE(SUM(stock_unidades * costo), 0) FROM productos WHERE activo = true AND tienda_id = ${idTiendaLocal}) AS valor_total_venta,
                (SELECT COALESCE(SUM(stock_unidades * costo), 0) FROM productos 
                WHERE activo = true AND tienda_id = ${idTiendaLocal} 
                AND id NOT IN (
                    SELECT DISTINCT d.producto_id 
                    FROM detalle_ventas d 
                    JOIN ventas v ON d.venta_id = v.id 
                    WHERE v.fecha >= CURRENT_DATE - INTERVAL '30 days' AND v.tienda_id = ${idTiendaLocal}
                )) AS capital_estancado
        `;
        const inventorySummary = await pool.query(inventoryQuery);

        // Ventas Comparativas segregadas
        const salesQuery = `
            SELECT 
                (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE ${whereClause}) as ventas_hoy,
                (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE ${prevWhereClause}) as ventas_ayer,
                (SELECT COUNT(*) FROM ventas WHERE ${whereClause}) as transacciones_hoy
        `;
        const salesData = await pool.query(salesQuery, queryParams);

        // Alertas de Stock Mínimo locales
        const lowStockCount = await pool.query(`
            SELECT COUNT(id) AS low_stock_count FROM productos 
            WHERE stock_unidades <= stock_minimo AND activo = true AND tienda_id = ${idTiendaLocal}
        `);

        // 🔥 MOTOR DE AUDITORÍA LOGÍSTICA DE UNIFICACIÓN CRONOLÓGICA (Inmune a zonas horarias)
        const distQuery = `
            SELECT 
                COALESCE(SUM(CASE WHEN TO_CHAR(fecha, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD') THEN cantidad ELSE 0 END), 0) AS dist_hoy,
                COALESCE(SUM(CASE WHEN TO_CHAR(fecha, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD') THEN cantidad ELSE 0 END), 0) AS despachos_hoy,
                COALESCE(SUM(CASE WHEN TO_CHAR(fecha, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD') THEN cantidad ELSE 0 END), 0) AS movimientos_hoy,
                
                COALESCE(SUM(CASE WHEN DATE_TRUNC('week', fecha) = DATE_TRUNC('week', NOW()) THEN cantidad ELSE 0 END), 0) AS dist_semana,
                COALESCE(SUM(CASE WHEN DATE_TRUNC('week', fecha) = DATE_TRUNC('week', NOW()) THEN cantidad ELSE 0 END), 0) AS carga_semana,
                COALESCE(SUM(CASE WHEN DATE_TRUNC('week', fecha) = DATE_TRUNC('week', NOW()) THEN cantidad ELSE 0 END), 0) AS traslados_semana,
                
                COALESCE(SUM(CASE WHEN DATE_TRUNC('month', fecha) = DATE_TRUNC('month', NOW()) THEN cantidad ELSE 0 END), 0) AS dist_mes,
                COALESCE(SUM(CASE WHEN DATE_TRUNC('month', fecha) = DATE_TRUNC('month', NOW()) THEN cantidad ELSE 0 END), 0) AS volumen_mes,
                COALESCE(SUM(CASE WHEN DATE_TRUNC('month', fecha) = DATE_TRUNC('month', NOW()) THEN cantidad ELSE 0 END), 0) AS volumen_consolidado_mes
            FROM historial_movimientos
            WHERE tipo_movimiento = 'TRASLADO' AND tienda_id = $1
        `;
        const distData = await pool.query(distQuery, [idTiendaLocal]);

        const whereRanking = whereClause.replace(/fecha/g, 'v.fecha').replace(/tienda_id/g, 'v.tienda_id');
        
        const rankingQuery = `
            SELECT 
                p.nombre, 
                p.categoria, 
                COALESCE(p.genero, 'UNISEX') as genero,
                COALESCE(SUM(d.cantidad), 0) as cantidad_vendida, 
                COALESCE(SUM(d.subtotal), 0) as total_generado
            FROM ventas v
            JOIN detalle_ventas d ON d.venta_id = v.id
            JOIN productos p ON d.producto_id = p.id
            WHERE ${whereRanking}
            GROUP BY p.id, p.nombre, p.categoria, p.genero
            ORDER BY cantidad_vendida DESC
        `;
        const rankingData = await pool.query(rankingQuery, queryParams);

        const distributionData = distData.rows[0] || { dist_hoy: 0, despachos_hoy: 0, movimientos_hoy: 0, dist_semana: 0, carga_semana: 0, traslados_semana: 0, dist_mes: 0, volumen_mes: 0, volumen_consolidado_mes: 0 };

        // 🛡️ CARGA DE RESPUESTA SHOTGUN (Satura todas las combinaciones posibles de variables del Frontend)
        res.json({
            inventory: inventorySummary.rows[0],
            sales: {
                ...salesData.rows[0],
                dist_hoy: distributionData.dist_hoy,
                despachos_hoy: distributionData.despachos_hoy,
                movimientos_hoy: distributionData.movimientos_hoy,
                dist_semana: distributionData.dist_semana,
                para_semana: distributionData.carga_semana,
                traslados_semana: distributionData.traslados_semana,
                dist_mes: distributionData.dist_mes,
                volumen_mes: distributionData.volumen_mes,
                volumen_consolidado_mes: distributionData.volumen_consolidado_mes
            },
            lowStock: lowStockCount.rows[0],
            distribution: distributionData,
            ranking: rankingData.rows,
            
            // Inyecciones directas en la raíz del objeto de respuesta
            dist_hoy: distributionData.dist_hoy,
            despachos_hoy: distributionData.despachos_hoy,
            movimientos_hoy: distributionData.movimientos_hoy,
            dist_semana: distributionData.dist_semana,
            carga_semana: distributionData.carga_semana,
            traslados_semana: distributionData.traslados_semana,
            dist_mes: distributionData.dist_mes,
            volumen_mes: distributionData.volumen_mes,
            volumen_consolidado_mes: distributionData.volumen_consolidado_mes
        });
    } catch (error) {
        console.error("Error KPIs:", error);
        res.status(500).json({ error: 'Error KPIs' });
    }
};

const getVentas = async (req, res) => {
    try {
        const { page = 1, limit = 15, fecha, busqueda } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        let paramIndex = 1;

        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : 'nulo';
        const userId = req.user ? req.user.id : 'nulo';

        console.log(`[DEBUG ROL] Usuario ID: ${userId} | Rol detectado: "${rolUsuario}"`);

        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev' || rolUsuario === 'administrador' || rolUsuario === 'admin';

       let idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

        if (esUsuarioMaestro && req.user?.id) {
            const userDb = await pool.query('SELECT tienda_id FROM usuarios WHERE id = $1', [req.user.id]);
            if (userDb.rows.length > 0 && userDb.rows[0].tienda_id !== null) {
                idTiendaLocal = parseInt(userDb.rows[0].tienda_id, 10);
                console.log(`[DEBUG TIENDA] Encontrado en DB: ${idTiendaLocal}`);
            }
        }

        console.log(`[DEBUG FINAL] idTiendaLocal a usar: ${idTiendaLocal}`);
        
        let whereClause = "WHERE 1=1";
        whereClause += ` AND v.tienda_id = ${idTiendaLocal}`;

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

        // 🚨 AQUÍ ESTÁ LA MAGIA AGREGADA:
        const query = `
            SELECT 
                v.id, 
                v.fecha, 
                v.total, 
                v.tienda_id, 
                c.nombre as cliente_nombre,
                (SELECT COUNT(id) FROM pagos p WHERE p.venta_id = v.id) as cant_pagos,
                COALESCE((SELECT p.metodo FROM pagos p WHERE p.venta_id = v.id ORDER BY p.monto DESC LIMIT 1), 'Sin Pago') as metodo_pago,
                COALESCE((SELECT p.tasa_cambio FROM pagos p WHERE p.venta_id = v.id ORDER BY p.monto DESC LIMIT 1), 0) as tasa_cambio,
                
                -- ESTO LE AVISA AL FRONTEND SI ESTÁ CERRADA ✅ O PENDIENTE ❌
                EXISTS (
                    SELECT 1 FROM cierres_caja cc,
                    jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                    WHERE elem::int = v.id
                ) as esta_cerrada,

                COUNT(*) OVER() as total_count 
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            ${whereClause}
            ORDER BY v.fecha DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        // 🔥 DEBUG FINAL: Imprimir la query exacta
        console.log(`[SQL VENTAS] Query: ${query}`);
        console.log(`[SQL VENTAS] Params:`, [...params, limit, offset]);

        params.push(limit, offset);
        const response = await pool.query(query, params);
        
        const totalItems = response.rows.length > 0 ? parseInt(response.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalItems / limit);

        res.json({
            data: response.rows,
            pagination: { totalItems, totalPages, currentPage: parseInt(page), itemsPerPage: parseInt(limit) }
        });

    } catch (error) {
        console.error("Error getVentas:", error);
        res.status(500).json({ error: error.message });
    }
};

const getVentaById = async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Cabecera de la venta
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

        // 2. Detalles de los productos
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

        // 🔥 3. CONSULTA CLAVE: Traer TODOS los pagos de la transacción
        const pagosQuery = `
            SELECT metodo, moneda, monto, tasa_cambio, referencia 
            FROM pagos 
            WHERE venta_id = $1
        `;
        const pagosRes = await pool.query(pagosQuery, [id]);

        res.json({
            venta: ventaRes.rows[0],
            detalles: detallesRes.rows,
            pagos: pagosRes.rows // <-- Enviamos la lista completa de pagos al frontend
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
        const query = `
            SELECT id, nombre_identificador, formula_id, items_json, 
                   TO_CHAR(fecha_creacion, 'DD/MM/YYYY HH12:MI AM') as fecha
            FROM pedidos_borradores 
            ORDER BY fecha_creacion DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo borradores:", error);
        res.status(500).json({ error: 'Error al buscar pedidos guardados.' });
    }
};

const bajarInventarioAEstanteMasa = async (req, res) => {
    const client = await pool.connect();
    try {
        const { producto_id, cantidad_botellas, destino, fila } = req.body;
        const pId = parseInt(producto_id, 10);
        const cantBotellas = parseInt(cantidad_botellas, 10);
        
        // 🔥 CANDADO: Identificamos la tienda
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

        if (isNaN(pId) || isNaN(cantBotellas) || cantBotellas <= 0 || !destino || !fila) {
            return res.status(400).json({ error: 'Información incompleta para mover mercancía.' });
        }
        
        await client.query('BEGIN');
        
        // 🔒 Validamos que el producto esté en esta sucursal
        const prodRes = await client.query(
            'SELECT id, nombre, stock_unidades, stock_estante, contenido_gramos FROM productos WHERE id = $1 AND tienda_id = $2 FOR UPDATE',
            [pId, idTiendaLocal]
        );
        
        if (prodRes.rows.length === 0) {
            throw new Error('El producto seleccionado no existe en esta sucursal.');
        }
        
        const prod = prodRes.rows[0];
        const stockDepositoActual = parseFloat(prod.stock_unidades || 0);
        
        if (stockDepositoActual < cantBotellas) {
            throw new Error(`Stock insuficiente en Depósito. Solo quedan ${stockDepositoActual} unidades disponibles.`);
        }
        
        const capacidadBotella = parseFloat(prod.contenido_gramos) || 1000;
        const gramosAIncrementar = cantBotellas * capacidadBotella;
        
        // 🔒 Descontamos del depósito de esta tienda
        await client.query(`
            UPDATE productos 
            SET stock_unidades = stock_unidades - $1,
                stock_estante = stock_estante + $2
            WHERE id = $3 AND tienda_id = $4
        `, [cantBotellas, gramosAIncrementar, pId, idTiendaLocal]);
        
        for (let i = 0; i < cantBotellas; i++) {
            await client.query(`
                INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado)
                VALUES ($1, $2, 100, $3, $4, 'ABIERTA')
            `, [pId, capacidadBotella, destino, fila]);
        }
        
        // 🔒 Guardamos el historial amarrado a la tienda
        const usuarioId = req.user && req.user.id ? req.user.id : null;

        // 🔒 Guardamos el historial amarrado a la tienda Y AL USUARIO
        await client.query(`
            INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id)
            VALUES ($1, 'TRASLADO', $2, (SELECT stock_estante FROM productos WHERE id=$1 AND tienda_id=$3), $4, NOW(), $3, $5)
        `, [pId, cantBotellas, idTiendaLocal, `Vaciado Masivo a Estante ${destino} (Nivel ${fila})`, usuarioId]);

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
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

        if (!ids || ids.length === 0) {
            return res.status(400).json({ error: 'No seleccionaste ningún artículo.' });
        }
        
        await client.query('BEGIN');
        
        // 🔒 Buscamos los productos seleccionados SOLO en esta sucursal
        const prodsRes = await client.query(
            `SELECT id, nombre, stock_unidades, contenido_gramos
             FROM productos
             WHERE id = ANY($1) AND stock_unidades > 0 AND tienda_id = $2 FOR UPDATE`,
            [ids, idTiendaLocal]
        );
        
        if (prodsRes.rows.length === 0) {
            throw new Error('Ninguno de los artículos seleccionados tiene stock en el depósito de esta sucursal.');
        }
        
        let totalBotellasCreadas = 0;
        const BATCH_SIZE = 200; 

        for (const prod of prodsRes.rows) {
            const pId = prod.id;
            const totalStock = parseFloat(prod.stock_unidades) || 0;
            const capacidadBotella = parseFloat(prod.contenido_gramos) || 1000; 
            
            if (capacidadBotella <= 0) continue; 
            
            const cantBotellas = Math.floor(totalStock / capacidadBotella);
            if (cantBotellas <= 0) continue; 
            
            const gramosAIncrementar = cantBotellas * capacidadBotella;
            
            await client.query(`
                UPDATE productos 
                SET stock_unidades = stock_unidades - $1,
                    stock_estante = stock_estante + $2
                WHERE id = $3 AND tienda_id = $4
            `, [gramosAIncrementar, gramosAIncrementar, pId, idTiendaLocal]);
            
            for (let i = 0; i < cantBotellas; i += BATCH_SIZE) {
                const end = Math.min(i + BATCH_SIZE, cantBotellas);
                const batchValues = [];
                const placeholders = [];
                let paramIndex = 1;
                
                for (let j = i; j < end; j++) {
                    // 🔥 CORREGIDO: Mapeo ordenado de datos 1 a 1 con el INSERT inferior
                    // Columnas: producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado, tienda_id
                    batchValues.push(
                        pId,               // producto_id
                        capacidadBotella,  // cantidad (gramos reales de la botella, ej: 30)
                        100,               // porcentaje_actual (comienza llena)
                        'A',               // ubicacion (Mostrador por defecto)
                        1,                 // fila (Nivel del estante)
                        'CERRADA',         // estado (botella lista para ser abierta)
                        idTiendaLocal      // tienda_id (seguridad multitienda)
                    );

                    placeholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5}, $${paramIndex+6})`);
                    paramIndex += 7;
                }
                
                // 🔥 CORREGIDO: Declaración exacta de columnas ordenadas para evitar cruces
                await client.query(`
                    INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado, tienda_id)
                    VALUES ${placeholders.join(', ')}
                `, batchValues);
            }
            
            totalBotellasCreadas += cantBotellas;
            
            const usuarioId = req.user && req.user.id ? req.user.id : null;

            await client.query(`
                INSERT INTO historial_movimientos 
                  (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id)
                VALUES ($1, 'TRASLADO', $2, 0, 'Vaciado Masivo a Recepción', NOW(), $3, $4)
            `, [pId, gramosAIncrementar, idTiendaLocal, usuarioId]);
        }
        
        await client.query('COMMIT');
        res.json({ mensaje: `¡Procesado! Se enviaron ${totalBotellasCreadas} unidades a RECEPCIÓN como CERRADAS.` });
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
        
        const ventaRes = await client.query('SELECT v.*, c.nombre as cliente_nombre FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id WHERE v.id = $1', [id]);
        if (ventaRes.rows.length === 0) throw new Error('La factura seleccionada no existe en el sistema.');
        const venta = ventaRes.rows[0];
        
        // 🔒 Capturamos la tienda donde ocurrió la venta original
        const idTiendaFactura = parseInt(venta.tienda_id, 10);
        
        const detallesRes = await client.query('SELECT * FROM detalle_ventas WHERE venta_id = $1', [id]);
        const pagosRes = await client.query('SELECT * FROM pagos WHERE venta_id = $1', [id]);
        
        for (const item of detallesRes.rows) {
            const cant = parseFloat(item.cantidad);
            const desc = item.descripcion || '';
            
            if (item.formula_id) {
                const fRes = await client.query('SELECT * FROM formulas WHERE id = $1', [item.formula_id]);
                if (fRes.rows.length === 0) continue;
                const f = fRes.rows[0];
                const esRecarga = desc.includes('REC');
                let gramosExtra = 0;
                
                const extraMatch = desc.match(/\(\+(\d+(?:\.\d+)?)g Ext\)/);
                if (extraMatch) gramosExtra = parseFloat(extraMatch[1]);
                const totalEsencia = (parseFloat(f.gramos_esencia) + gramosExtra) * cant;
                
                await devolverAEstanteFisico(client, item.producto_id, totalEsencia, idTiendaFactura);
                
                if (f.ml_alcohol > 0) {
                    const totalAlcohol = Math.max(0, parseFloat(f.ml_alcohol) - gramosExtra) * cant;
                    if (totalAlcohol > 0) {
                        const alcRes = await client.query(`
                            SELECT id FROM productos 
                            WHERE (nombre ILIKE '%ALCOHOL%' OR categoria = 'Alcohol') 
                              AND activo = true AND tienda_id = $1
                            ORDER BY stock_estante DESC LIMIT 1
                        `, [idTiendaFactura]);
                        
                        if (alcRes.rows.length > 0) {
                            await devolverAEstanteFisico(client, alcRes.rows[0].id, totalAlcohol, idTiendaFactura);
                        }
                    }
                }
                
                if (f.gramos_fijador > 0) {
                    const totalFijador = parseFloat(f.gramos_fijador) * cant;
                    const fijRes = await client.query(`
                        SELECT id FROM productos 
                        WHERE (nombre ILIKE '%FIJADOR%' OR categoria = 'Fijador') 
                          AND activo = true AND tienda_id = $1
                        ORDER BY stock_estante DESC LIMIT 1
                    `, [idTiendaFactura]);
                    
                    if (fijRes.rows.length > 0) {
                        await devolverAEstanteFisico(client, fijRes.rows[0].id, totalFijador, idTiendaFactura);
                    }
                }
                
                if (!esRecarga) {
                    const envRes = await client.query(`
                        SELECT id FROM productos 
                        WHERE (categoria = 'Envases' OR categoria = 'Frascos') 
                          AND (nombre ILIKE $1 OR contenido_gramos = $2) 
                          AND activo = true AND tienda_id = $3
                        ORDER BY stock_estante DESC LIMIT 1
                    `, [`%${f.volumen_total}%`, f.volumen_total, idTiendaFactura]);
                    
                    if (envRes.rows.length > 0) {
                        await devolverAEstanteFisico(client, envRes.rows[0].id, cant, idTiendaFactura);
                    }
                }
            } else if (item.producto_id) {
                await devolverAEstanteFisico(client, item.producto_id, cant, idTiendaFactura);
            }
        }
        
        await client.query(`
            INSERT INTO ventas_anuladas (venta_original_id, fecha_venta, usuario_anula_id, cliente_nombre, total_venta, detalles_json, pagos_json, motivo, venta_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [venta.id, venta.fecha, req.user.id, venta.cliente_nombre, venta.total, JSON.stringify(detallesRes.rows), JSON.stringify(pagosRes.rows), motivo, JSON.stringify(venta)]);
        
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

async function devolverAEstanteFisico(client, productoId, cantidadADevolver, tiendaId) {
    const pId = parseInt(productoId, 10);
    const tId = parseInt(tiendaId, 10);
    const cantidad = parseFloat(cantidadADevolver);
    if (isNaN(pId) || pId <= 0 || isNaN(tId) || tId <= 0 || isNaN(cantidad) || cantidad <= 0) return;

    // 1. Obtener la capacidad máxima filtrando estrictamente por la tienda origen de la venta
    const prodRes = await client.query('SELECT contenido_gramos, nombre FROM productos WHERE id = $1 AND tienda_id = $2', [pId, tId]);
    if (prodRes.rows.length === 0) return;
    const capacidad = parseFloat(prodRes.rows[0].contenido_gramos) || 1000;

    // 2. Devolver los gramos estrictamente a la sucursal que procesó la anulación
    await client.query('UPDATE productos SET stock_estante = stock_estante + $1 WHERE id = $2 AND tienda_id = $3', [cantidad, pId, tId]);

    // 3. Re-acomodar los porcentajes de las botellas físicas en los estantes
    const botellaRes = await client.query(`
        SELECT id, cantidad FROM botellas_estante 
        WHERE producto_id = $1 
        ORDER BY estado ASC, id DESC LIMIT 1
    `, [pId]);

    if (botellaRes.rows.length > 0) {
        const bId = botellaRes.rows[0].id;
        const nuevaCantidad = parseFloat(botellaRes.rows[0].cantidad) + cantidad;
        const nuevoPorcentaje = Math.min(100, Math.round((nuevaCantidad / capacidad) * 100));

        await client.query(`
            UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2, estado = 'ABIERTA' WHERE id = $3
        `, [nuevaCantidad, nuevoPorcentaje, bId]);
    } else {
        const nuevoPorcentaje = Math.min(100, Math.round((cantidad / capacidad) * 100));
        await client.query(`
            INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado)
            VALUES ($1, $2, $3, 'A', '1', 'ABIERTA')
        `, [pId, cantidad, nuevoPorcentaje]);
    }
}

const restaurarVentaAnulada = async (req, res) => {
    const { idBoveda } = req.params;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const vaultRes = await client.query('SELECT * FROM ventas_anuladas WHERE id = $1', [idBoveda]);
        if (vaultRes.rows.length === 0) throw new Error('El registro especificado no existe en la bóveda de respaldo.');
        
        const vault = vaultRes.rows[0];
        const ventaData = typeof vault.venta_json === 'string' ? JSON.parse(vault.venta_json) : vault.venta_json;
        const detalles = typeof vault.detalles_json === 'string' ? JSON.parse(vault.detalles_json) : vault.detalles_json;
        const pagos = typeof vault.pagos_json === 'string' ? JSON.parse(vault.pagos_json) : vault.pagos_json;
        
        // 🔒 Capturamos la tienda origen de la factura guardada en el JSON
        const idTiendaFactura = parseInt(ventaData.tienda_id, 10) || 1;

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
                
                const stockCheck = await client.query('SELECT stock_estante, nombre FROM productos WHERE id = $1 AND tienda_id = $2', [item.producto_id, idTiendaFactura]);
                if (stockCheck.rows.length === 0 || parseFloat(stockCheck.rows[0].stock_estante) < totalEsencia) {
                    throw new Error(`CANDADO DE SEGURIDAD: Insumos insuficientes para restaurar. El producto "${stockCheck.rows[0]?.nombre || 'Esencia'}" no cuenta con los gramos necesarios en estante.`);
                }
            }
        }
        
        await client.query(`
            INSERT INTO ventas (id, total, cliente_id, fecha, usuario_id, tienda_id) 
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [vault.venta_original_id, vault.total_venta, ventaData.cliente_id || 1, vault.fecha_venta, ventaData.usuario_id || 1, idTiendaFactura]);
        
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
                
                // 🔥 CORRECCIÓN DEL BUG: Ahora pasamos idTiendaFactura como 5to parámetro
                await validarYDescontarEstante(client, item.producto_id, (parseFloat(f.gramos_esencia) + gramosExtra) * cant, "Esencia", idTiendaFactura);
                
                if (f.ml_alcohol > 0) {
                    const alc = Math.max(0, parseFloat(f.ml_alcohol) - gramosExtra) * cant;
                    if (alc > 0) {
                        const alcRes = await client.query(`SELECT id FROM productos WHERE (categoria = 'Alcohol' OR nombre ILIKE '%ALCOHOL%') AND activo = true AND tienda_id = $1 ORDER BY stock_estante DESC LIMIT 1`, [idTiendaFactura]);
                        await validarYDescontarEstante(client, alcRes.rows[0].id, alc, "Alcohol", idTiendaFactura);
                    }
                }
                
                if (f.gramos_fijador > 0) {
                    const fijRes = await client.query(`SELECT id FROM productos WHERE (categoria = 'Fijador' OR nombre ILIKE '%FIJADOR%') AND activo = true AND tienda_id = $1 ORDER BY stock_estante DESC LIMIT 1`, [idTiendaFactura]);
                    await validarYDescontarEstante(client, fijRes.rows[0].id, parseFloat(f.gramos_fijador) * cant, "Fijador", idTiendaFactura);
                }
                
                if (!esRecarga) {
                    const envRes = await client.query(`SELECT id FROM productos WHERE (categoria IN ('Envases', 'Frascos') OR categoria ILIKE '%Envase%') AND (nombre ILIKE $1 OR contenido_gramos = $2) AND activo = true AND tienda_id = $3 ORDER BY stock_estante DESC LIMIT 1`, [`%${f.volumen_total}%`, f.volumen_total, idTiendaFactura]);
                    await validarYDescontarEstante(client, envRes.rows[0].id, cant, "Envase", idTiendaFactura);
                }
            } else if (item.producto_id) {
                // 🔥 CORRECCIÓN DEL BUG
                await validarYDescontarEstante(client, item.producto_id, cant, "Producto", idTiendaFactura);
            }
            
            await client.query(`INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, descripcion, formula_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
                 [vault.venta_original_id, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal, desc, item.formula_id]);
        }
        
        for (const p of pagos) {
            await client.query(`INSERT INTO pagos (venta_id, metodo, moneda, monto, tasa_cambio, referencia) VALUES ($1, $2, $3, $4, $5, $6)`, 
                 [vault.venta_original_id, p.metodo, p.moneda, p.monto, p.tasa_cambio, p.referencia]);
        }
        
        await client.query('DELETE FROM ventas_anuladas WHERE id = $1', [idBoveda]);
        
        await client.query('COMMIT');
        res.json({ mensaje: 'Operación revertida. La factura vuelve a estar en el libro diario y se re-descontaron los insumos de su sucursal.' });
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
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev';

        let query = 'SELECT * FROM ventas_anuladas WHERE 1=1';
        
        // 🔒 Filtramos extrayendo la tienda directamente del JSON de respaldo de la venta original
        if (!esUsuarioMaestro) {
            query += ` AND venta_json->>'tienda_id' = '${idTiendaLocal}'`;
        }
        
        query += ' ORDER BY fecha_anulacion DESC LIMIT 50';

        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
};

const eliminarBorradorCombo = async (req, res) => {
    try {
        const { id } = req.params;
        // Eliminamos el borrador (pedido guardado) usando su ID único
        await pool.query('DELETE FROM pedidos_borradores WHERE id = $1', [id]);
        
        res.json({ mensaje: 'Borrador eliminado' });
    } catch (error) {
        console.error("Error al eliminar borrador:", error);
        res.status(500).json({ error: 'Error al eliminar el pedido.' });
    }
};

// =========================================================
// OBTENER LISTA DE TIENDAS PARA LOS FILTROS
// =========================================================
const getListaTiendas = async (req, res) => {
    try {
        // Opción A: Si tu conexión global a la base de datos se llama 'pool' 
        // (es el estándar en Node.js con pg-pool)
        const result = await pool.query('SELECT id, nombre FROM tiendas ORDER BY nombre ASC');
        res.json(result.rows);
    } catch (error) {
        // Opción B de emergencia: Si tu sistema usa 'db' en lugar de 'pool'
        if (error.name === 'ReferenceError' && error.message.includes('pool is not defined')) {
            try {
                const result = await db.query('SELECT id, nombre FROM tiendas ORDER BY nombre ASC');
                return res.json(result.rows);
            } catch (errDb) {
                console.error("Error al usar db:", errDb);
            }
        }
        console.error("Error al obtener lista de tiendas:", error);
        res.status(500).json({ error: 'Error interno al cargar las tiendas' });
    }
};

const exportarCierreDeHoyExcel = async (req, res) => {
    try {
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        const client = await pool.connect();

        // Consulta detallada que extrae cliente, montos, tasa, método y la suma de unidades de la venta
        const queryRaw = `
            SELECT 
                p.metodo, 
                p.moneda, 
                COALESCE(p.monto::numeric, 0) as monto, 
                COALESCE(p.tasa_cambio::numeric, 0) as tasa, 
                v.id as venta_id,
                c.nombre as cliente_nombre, 
                v.fecha,
                COALESCE((SELECT SUM(dv.cantidad) FROM detalle_ventas dv WHERE dv.venta_id = v.id), 0) as cantidad_items
            FROM pagos p 
            JOIN ventas v ON p.venta_id = v.id
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE DATE(v.fecha) = CURRENT_DATE AND v.tienda_id = $1
              AND NOT EXISTS (
                  SELECT 1 FROM cierres_caja cc,
                  jsonb_array_elements_text(cc.detalles_json->'ids_ventas_origen_hoy') as elem
                  WHERE cc.detalles_json->'ids_ventas_origen_hoy' IS NOT NULL AND elem::int = v.id
              )
            ORDER BY v.fecha DESC
        `;
        const resRaw = await client.query(queryRaw, [idTiendaLocal]);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Cierre Previo de Hoy');

        // Encabezado del Documento
        sheet.addRow(['PREVISUALIZACIÓN DE CIERRE DE CAJA DIARIO DETALLADO']).font = { bold: true, size: 14 };
        sheet.addRow([`Fecha de Consulta:`, new Date().toLocaleDateString('es-VE'), `Sucursal ID:`, idTiendaLocal]);
        sheet.addRow([`Estado:`, 'TEMPORAL - SIN ARCHIVAR EN HISTÓRICO']);
        sheet.addRow([]);

        for (let i = 1; i <= 3; i++) sheet.getRow(i).font = { bold: true };

        // Encabezados de la Tabla Detallada
        const headers = sheet.addRow([
            'ID VENTA', 'FECHA/HORA', 'CLIENTE', 'MÉTODO DE PAGO', 'CANT. ÍTEMS', 'MONEDA', 'MONTO ORIGINAL', 'TASA BCV / CAMBIO', 'MONTO EN USD', 'MONTO EN BS'
        ]);
        headers.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headers.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        headers.alignment = { horizontal: 'center', vertical: 'middle' };

        let totalGeneralUSD = 0;
        let totalGeneralBs = 0;
        let totalUnidadesVendidas = 0;

        resRaw.rows.forEach(pago => {
            const monto = parseFloat(pago.monto);
            const tasa = parseFloat(pago.tasa);
            const moneda = (pago.moneda || 'USD').toUpperCase();
            const cantItems = parseFloat(pago.cantidad_items || 0);

            let montoUSD = 0;
            let montoBS = 0;

            if (moneda === 'BS' || moneda === 'VES' || moneda === 'BSS') {
                montoBS = monto;
                montoUSD = tasa > 0 ? (monto / tasa) : 0;
            } else {
                montoUSD = monto;
                montoBS = monto * tasa;
            }

            totalGeneralUSD += montoUSD;
            totalGeneralBs += montoBS;
            totalUnidadesVendidas += cantItems;

            sheet.addRow([
                pago.venta_id,
                new Date(pago.fecha).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }),
                pago.cliente_nombre || 'Consumidor Final',
                pago.metodo,
                cantItems,
                moneda,
                monto,
                tasa,
                montoUSD,
                montoBS
            ]);
        });

        // Fila de Separación
        sheet.addRow([]);

        // Fila de Totales Consolidados (Dólares y Bolívares)
        const rowTotal = sheet.addRow([
            'TOTALES GENERALES:', '', '', '', totalUnidadesVendidas, '', '', '', totalGeneralUSD, totalGeneralBs
        ]);
        rowTotal.font = { bold: true, size: 11 };
        rowTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; // Fondo verde suave de total

        // Estilos y Formatos de Celda
        sheet.getColumn(1).width = 12; // ID Venta
        sheet.getColumn(2).width = 15; // Fecha
        sheet.getColumn(3).width = 30; // Cliente
        sheet.getColumn(4).width = 22; // Método
        sheet.getColumn(5).width = 14; // Cant. Ítems
        sheet.getColumn(6).width = 10; // Moneda
        sheet.getColumn(7).width = 18; // Monto Original
        sheet.getColumn(8).width = 18; // Tasa
        sheet.getColumn(9).width = 20; // Monto USD
        sheet.getColumn(10).width = 22; // Monto BS

        // Formatos Numéricos
        sheet.getColumn(7).numFmt = '#,##0.00';
        sheet.getColumn(8).numFmt = '"Bs "#,##0.00';
        sheet.getColumn(9).numFmt = '"$"#,##0.00';
        sheet.getColumn(10).numFmt = '"Bs "#,##0.00';

        client.release();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Pre_Cierre_Hoy_Sucursal_${idTiendaLocal}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error pre-cierre Excel:", error);
        res.status(500).send("Error generando el archivo de pre-cierre.");
    }
};

const obtenerPodioDinamico = async (req, res) => {
    const { tipo, rango, start, end } = req.query;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const client = await pool.connect();

    try {
        let filterFecha = "";
        let valores = [idTiendaLocal];
        let paramCount = 2;

        if (rango === 'CUSTOM' && start && end) {
            filterFecha = `AND v.fecha::date BETWEEN $${paramCount} AND $${paramCount + 1}`;
            valores.push(start, end);
            paramCount += 2;
        } else if (rango === '1') {
            filterFecha = `AND v.fecha >= CURRENT_DATE`;
        } else if (rango === '7') {
            filterFecha = `AND v.fecha >= NOW() - INTERVAL '7 days'`;
        } else if (rango === '30') {
            filterFecha = `AND v.fecha >= NOW() - INTERVAL '30 days'`;
        }

        let filterTipo = "";
        if (tipo === 'TERMINADOS') {
            filterTipo = `AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminad%' OR p.categoria ILIKE '%perfume%')`;
        } else if (tipo === 'ESENCIAS') {
            filterTipo = `AND (p.categoria ILIKE '%esencia%')`;
        }

        // 🚨 SE AGREGA p.genero AL SELECT Y AL GROUP BY
        const query = `
            SELECT 
                COALESCE(p.nombre, dv.descripcion, 'Producto General') as nombre, 
                COALESCE(p.categoria, 'General') as categoria, 
                COALESCE(p.genero, 'UNISEX') as genero,
                SUM(dv.cantidad) as total_unidades, 
                SUM(dv.subtotal) as total_ingresos
            FROM detalle_ventas dv
            JOIN ventas v ON dv.venta_id = v.id
            LEFT JOIN productos p ON dv.producto_id = p.id
            WHERE v.tienda_id = $1
            ${filterFecha}
            ${filterTipo}
            GROUP BY COALESCE(p.id, dv.producto_id), p.nombre, dv.descripcion, p.categoria, p.genero
            ORDER BY total_unidades DESC
            LIMIT 30
        `;

        const resultado = await client.query(query, valores);
        res.json(resultado.rows);

    } catch (error) {
        console.error("Error en Podio:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

const exportarPodioExcel = async (req, res) => {
    const { tipo, rango, start, end } = req.query;
    const client = await pool.connect();

    try {
        let filterFecha = "", filterTipo = "";
        let valores = [];
        let paramCount = 1;

        if (rango === 'CUSTOM' && start && end) {
            filterFecha = `AND v.fecha::date BETWEEN $${paramCount} AND $${paramCount + 1}`;
            valores.push(start, end);
            paramCount += 2;
        } else if (rango === '1') { filterFecha = `AND v.fecha >= NOW() - INTERVAL '1 day'`;
        } else if (rango === '7') { filterFecha = `AND v.fecha >= NOW() - INTERVAL '7 days'`;
        } else if (rango === '30') { filterFecha = `AND v.fecha >= NOW() - INTERVAL '30 days'`; }

        if (tipo === 'TERMINADOS') filterTipo = `AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminados%')`;
        else if (tipo === 'ESENCIAS') filterTipo = `AND p.categoria ILIKE '%esencia%'`;

        // 🚨 SE AGREGA p.genero AL SELECT Y AL GROUP BY
        const query = `
            SELECT p.nombre, p.categoria, COALESCE(p.genero, 'UNISEX') as genero, SUM(dv.cantidad) as total_unidades, SUM(dv.subtotal) as total_ingresos
            FROM detalle_ventas dv
            JOIN ventas v ON dv.venta_id = v.id
            JOIN productos p ON dv.producto_id = p.id
            WHERE 1=1 ${filterFecha} ${filterTipo}
            GROUP BY p.id, p.nombre, p.categoria, p.genero
            ORDER BY total_unidades DESC LIMIT 50
        `;
        
        const resultado = await client.query(query, valores);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Top Ventas');

        const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } } };

        sheet.addRow(['REPORTE DE TOP VENTAS (PODIO)']).font = { bold: true, size: 14 };
        sheet.addRow([`Filtro de Producto: ${tipo}`]);
        sheet.addRow([`Período: ${rango === 'CUSTOM' ? `${start} al ${end}` : `Últimos ${rango} días`}`]);
        sheet.addRow([]);

        // 🚨 SE INCLUYE LA COLUMNA GÉNERO
        const headers = sheet.addRow(['RANGO', 'PRODUCTO', 'CATEGORÍA', 'GÉNERO', 'UNIDADES VENDIDAS', 'INGRESOS TOTALES ($)']);
        headers.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });

        resultado.rows.forEach((r, idx) => {
            sheet.addRow([
                `#${idx + 1}`,
                r.nombre,
                r.categoria,
                r.genero,
                parseFloat(r.total_unidades),
                parseFloat(r.total_ingresos)
            ]);
        });

        sheet.getColumn(6).numFmt = '"$"#,##0.00';
        sheet.columns.forEach(column => { column.width = 22; });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Podio_Ventas_${tipo}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error Exportando Podio:", error);
        res.status(500).send("Error generando el Excel");
    } finally {
        client.release();
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
        doc.text('P. UNIT (BASE)', 400, yTabla + 6, { width: 60, align: 'right' }); 
        doc.text('TOTAL (BASE)', 480, yTabla + 6, { width: 50, align: 'right' });

        let y = yTabla + 25;
        doc.font('Helvetica').fontSize(10);

        items.forEach(item => {
            const precioFinalUnitario = parseFloat(item.precio_unitario);
            const precioBaseUnitario = precioFinalUnitario / 1.16; 

            const subtotalFinal = parseFloat(item.subtotal);
            const subtotalBase = subtotalFinal / 1.16;

            doc.text(item.cantidad, 50, y);
            doc.text(item.descripcion, 100, y, { width: 280 }); 
            
            doc.text(precioBaseUnitario.toFixed(2), 400, y, { width: 60, align: 'right' });
            doc.text(subtotalBase.toFixed(2), 480, y, { width: 50, align: 'right' });
            
            y += 15;
        });

        doc.moveTo(40, y).lineTo(570, y).stroke();

        // --- CÁLCULO DE TOTALES (INVERSO) ---
        y += 10;
        
        const totalPagar = parseFloat(venta.total);
        const baseImponible = totalPagar / 1.16; 
        const iva = totalPagar - baseImponible;  

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
        doc.text(totalPagar.toFixed(2), 460, y, { width: 70, align: 'right' });

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

        let csvContent = `Factura ID,${venta.id}\n`;
        csvContent += `Fecha,${new Date(venta.fecha).toLocaleString('es-ES')}\n`;
        csvContent += `Total,$${parseFloat(venta.total).toFixed(2)}\n\n`;
        
        const headers = [
            'Cantidad', 'Codigo Producto', 'Nombre', 'Marca', 'Tamaño', 'Categoría',
            'Precio Unitario ($)', 'Subtotal ($)', 'Lote Venta', 'Fecha Vencimiento Lote'
        ];
        csvContent += headers.join(',') + '\n';
        
        items.forEach(item => {
            const row = [
                item.cantidad,
                item.codigo,
                `"${item.nombre.replace(/"/g, '""')}"`,
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

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=factura_detalle_${id}.csv`);
        res.send(csvContent);

    } catch (error) {
        console.error("Error generando Factura Excel (CSV):", error);
        res.status(500).send('Error generando Factura Excel/CSV');
    }
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
    restaurarVentaAnulada,
    getListaTiendas,
    exportarCierreDeHoyExcel,
    obtenerPodioDinamico,
    exportarPodioExcel,
};