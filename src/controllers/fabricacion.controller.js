const ExcelJS = require('exceljs');
const pool = require('../config/db');

// Helper para parsear de forma ultra segura estructuras JSON de PostgreSQL
const parseSafeJSON = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'object') return [val];
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        } catch (e) {
            return [];
        }
    }
    return [];
};

const exportarLotesFabricadosExcel = async (req, res) => {
    try {
        const { start, end, min_cantidad, estado } = req.query;
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

        let whereClause = "WHERE o.tienda_id = $1";
        let params = [idTiendaLocal];
        let paramIdx = 2;

        if (start && end && start.trim() !== '' && end.trim() !== '') {
            whereClause += ` AND o.fecha_creacion::date BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
            params.push(start, end);
            paramIdx += 2;
        }

        if (min_cantidad && !isNaN(parseInt(min_cantidad, 10))) {
            whereClause += ` AND o.cantidad_planificada >= $${paramIdx}`;
            params.push(parseInt(min_cantidad, 10));
            paramIdx++;
        }

        if (estado && estado.trim() !== '') {
            whereClause += ` AND o.estado = $${paramIdx}`;
            params.push(estado.toUpperCase());
            paramIdx++;
        }

        const query = `
            SELECT o.id, o.codigo_orden, o.lote_fabricacion, o.fecha_creacion, o.fecha_cierre,
                   f.nombre as formula_nombre, o.cantidad_planificada, o.cantidad_completada, 
                   o.cantidad_merma, o.costo_unitario_real, o.estado, o.composicion_esencias,
                   u.nombre as creador_nombre
            FROM ordenes_produccion o
            LEFT JOIN formulas f ON o.formula_id = f.id
            LEFT JOIN usuarios u ON o.usuario_creador_id = u.id
            ${whereClause}
            ORDER BY o.fecha_creacion DESC
        `;

        const result = await pool.query(query, params);
        const workbook = new ExcelJS.Workbook();

        if (result.rows.length === 0) {
            const sheetVacia = workbook.addWorksheet('Sin Datos');
            sheetVacia.addRow(['No se encontraron órdenes de producción para el rango seleccionado.']);
        } else {
            // Agrupar filas por Fecha (YYYY-MM-DD) para crear hojas por día
            const ordenesPorDia = {};
            
            result.rows.forEach(r => {
                const fechaClave = r.fecha_creacion ? new Date(r.fecha_creacion).toISOString().slice(0, 10) : 'SIN_FECHA';
                if (!ordenesPorDia[fechaClave]) {
                    ordenesPorDia[fechaClave] = [];
                }
                ordenesPorDia[fechaClave].push(r);
            });

            // Recorrer cada día y crear su respectiva hoja en Excel
            Object.keys(ordenesPorDia).forEach(fechaKey => {
                const sheet = workbook.addWorksheet(`Día ${fechaKey}`);

                sheet.addRow([`AUDITORÍA DETALLADA DE FABRICACIÓN - FECHA: ${fechaKey}`]).font = { bold: true, size: 14 };
                sheet.addRow([`Filtro Cantidad Mínima: ${min_cantidad || 'Todas'} | Estado: ${estado || 'TODOS'}`]);
                sheet.addRow([]);

                const headers = sheet.addRow([
                    'HORA', 'CÓDIGO ORDEN', 'LOTE', 'RECETA BASE', 'FRAGANCIA / ESENCIA', 
                    'UNIDADES FABRICADAS (OK)', 'MERMA', 'COSTO UNIT. ($)', 'COSTO TOTAL ($)', 
                    'ESTADO', 'OPERADOR'
                ]);

                headers.eachCell((c) => {
                    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                });

                const ordenesDelDia = ordenesPorDia[fechaKey];

                ordenesDelDia.forEach(r => {
                    const composicion = parseSafeJSON(r.composicion_esencias);
                    const horaFmt = r.fecha_creacion ? new Date(r.fecha_creacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
                    const costoUnit = parseFloat(r.costo_unitario_real || 0);

                    // Si no hay arreglo de composición, dibuja la fila base
                    if (composicion.length === 0) {
                        const cantOk = parseInt(r.cantidad_completada || r.cantidad_planificada || 0, 10);
                        sheet.addRow([
                            horaFmt, r.codigo_orden || 'S/N', r.lote_fabricacion || 'PENDIENTE',
                            r.formula_nombre || 'N/A', 'SIN FRAGANCIA DETALLADA',
                            cantOk, parseInt(r.cantidad_merma || 0, 10),
                            costoUnit, (cantOk * costoUnit), r.estado || 'PROCESANDO',
                            r.creador_nombre || 'Sistema'
                        ]);
                    } else {
                        // DESGLOSE FILA POR FILA PARA CADA ESENCIA DEL LOTE
                        composicion.forEach(item => {
                            const nomFragancia = item.nombre_actual || item.nombre || 'ESENCIA';
                            const cantOk = parseInt(item.ok !== undefined ? item.ok : item.cantidad || 0, 10);
                            const cantMerma = parseInt(item.merma || 0, 10);
                            const subtotalCosto = cantOk * costoUnit;

                            sheet.addRow([
                                horaFmt,
                                r.codigo_orden || 'S/N',
                                r.lote_fabricacion || 'PENDIENTE',
                                r.formula_nombre || 'N/A',
                                nomFragancia.toUpperCase(),
                                cantOk,
                                cantMerma,
                                costoUnit,
                                subtotalCosto,
                                r.estado || 'PROCESANDO',
                                r.creador_nombre || 'Sistema'
                            ]);
                        });
                    }
                });

                sheet.getColumn(8).numFmt = '"$"#,##0.00';
                sheet.getColumn(9).numFmt = '"$"#,##0.00';
                sheet.columns.forEach(col => { col.width = 22; });
                sheet.getColumn(5).width = 40;
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Reporte_Lotes_Fabricados_${new Date().toISOString().slice(0,10)}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Fallo crítico exportando lotes Excel:", error);
        if (!res.headersSent) {
            res.status(500).send("Error generando el archivo Excel de lotes.");
        }
    }
};

// 2. EXPORTAR AUDITORÍA DETALLADA DE INSUMOS DESCONTADOS (HOJAS POR DÍA)
const exportarHistorialInsumosExcel = async (req, res) => {
    try {
        const { start, end, min_cantidad } = req.query;
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

        let whereClause = "WHERE o.tienda_id = $1 AND o.estado = 'COMPLETADA'";
        let params = [idTiendaLocal];
        let paramIdx = 2;

        if (start && end && start.trim() !== '' && end.trim() !== '') {
            whereClause += ` AND o.fecha_cierre::date BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
            params.push(start, end);
            paramIdx += 2;
        }

        if (min_cantidad && !isNaN(parseInt(min_cantidad, 10))) {
            whereClause += ` AND o.cantidad_planificada >= $${paramIdx}`;
            params.push(parseInt(min_cantidad, 10));
            paramIdx++;
        }

        const query = `
            SELECT o.codigo_orden, o.lote_fabricacion, o.fecha_cierre, f.nombre as formula_nombre, 
                   o.insumos_reservados, u.nombre as operador
            FROM ordenes_produccion o
            LEFT JOIN formulas f ON o.formula_id = f.id
            LEFT JOIN usuarios u ON COALESCE(o.usuario_cierre_id, o.usuario_creador_id) = u.id
            ${whereClause}
            ORDER BY o.fecha_cierre DESC
        `;

        const result = await pool.query(query, params);
        const workbook = new ExcelJS.Workbook();

        if (result.rows.length === 0) {
            const sheetVacia = workbook.addWorksheet('Sin Registros');
            sheetVacia.addRow(['No se encontraron consumos de materia prima en el período evaluado.']);
        } else {
            // Agrupar insumos por Fecha de Cierre (YYYY-MM-DD)
            const insumosPorDia = {};

            result.rows.forEach(r => {
                const fechaKey = r.fecha_cierre ? new Date(r.fecha_cierre).toISOString().slice(0, 10) : 'SIN_FECHA';
                if (!insumosPorDia[fechaKey]) {
                    insumosPorDia[fechaKey] = [];
                }
                insumosPorDia[fechaKey].push(r);
            });

            // Generar una pestaña de Excel por cada fecha de cierre
            Object.keys(insumosPorDia).forEach(fechaKey => {
                const sheet = workbook.addWorksheet(`Insumos ${fechaKey}`);

                sheet.addRow([`AUDITORÍA DE INSUMOS DESCONTADOS - FECHA: ${fechaKey}`]).font = { bold: true, size: 14 };
                sheet.addRow([`Fecha de Generación: ${new Date().toLocaleDateString('es-VE')}`]);
                sheet.addRow([]);

                const headers = sheet.addRow([
                    'HORA CIERRE', 'ORDEN N°', 'LOTE', 'RECETA BASE', 'MATERIA PRIMA / INSUMO', 'CANTIDAD DESCONTADA', 'UNIDAD', 'RESPONSABLE'
                ]);

                headers.eachCell((c) => {
                    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
                });

                const registrosDia = insumosPorDia[fechaKey];

                registrosDia.forEach(r => {
                    const horaFmt = r.fecha_cierre ? new Date(r.fecha_cierre).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
                    const insumos = parseSafeJSON(r.insumos_reservados);

                    insumos.forEach(ins => {
                        const nombreInsumo = ins && ins.nombre ? ins.nombre : 'MATERIA PRIMA';
                        const nombreUpper = nombreInsumo.toUpperCase();
                        let unidad = 'g';
                        if (nombreUpper.includes('ALCOHOL')) unidad = 'ml';
                        else if (nombreUpper.includes('FRASCO') || nombreUpper.includes('ENVASE')) unidad = 'uds';

                        const cantDescontada = parseFloat(ins.reservado || ins.cantidad || ins.descontado || 0);

                        sheet.addRow([
                            horaFmt,
                            r.codigo_orden || 'S/N',
                            r.lote_fabricacion || 'N/A',
                            r.formula_nombre || 'N/A',
                            nombreUpper,
                            cantDescontada,
                            unidad,
                            r.operador || 'Sistema'
                        ]);
                    });
                });

                sheet.columns.forEach(col => { col.width = 22; });
                sheet.getColumn(5).width = 35;
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Auditoria_Insumos_Descontados_${new Date().toISOString().slice(0,10)}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Fallo crítico exportando insumos Excel:", error);
        if (!res.headersSent) {
            res.status(500).send("Error generando el archivo Excel de insumos.");
        }
    }
};

// --- LEER ÓRDENES ---
const getOrdenes = async (req, res) => {
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    
    try {
        const query = `
            SELECT o.*, 
                   f.nombre as formula_nombre, f.volumen_total,
                   p.nombre as esencia_nombre,
                   uc.nombre as creador_nombre,
                   ucl.nombre as cerrador_nombre
            FROM ordenes_produccion o
            JOIN formulas f ON o.formula_id = f.id
            LEFT JOIN productos p ON o.producto_base_id = p.id
            LEFT JOIN usuarios uc ON o.usuario_creador_id = uc.id
            LEFT JOIN usuarios ucl ON o.usuario_cierre_id = ucl.id
            WHERE o.tienda_id = $1
            ORDER BY o.fecha_creacion DESC
        `;
        const result = await pool.query(query, [idTiendaLocal]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- CREAR ORDEN ---
const crearOrden = async (req, res) => {
    const { formula_id, cantidad_planificada, notas_planificacion, composicion } = req.body;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const usuarioId = req.user.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const plan = parseInt(cantidad_planificada, 10);
        
        if (!composicion || composicion.length === 0) throw new Error("La lista de esencias está vacía.");
        if (plan <= 0) throw new Error("La cantidad debe ser mayor a 0.");

        // 1. Leer receta base
        const formRes = await client.query('SELECT * FROM formulas WHERE id = $1', [formula_id]);
        if (formRes.rows.length === 0) throw new Error("Fórmula no encontrada.");
        const f = formRes.rows[0];

        // 🔥 Helper de búsqueda: Suma (stock_unidades + stock_estante) para garantizar disponibilidad total
        const buscarInsumoGenerico = async (criterio, tipo) => {
            let q = `
                SELECT id, nombre, 
                       COALESCE(stock_unidades, 0) as stock_unidades, 
                       COALESCE(stock_estante, 0) as stock_estante,
                       (COALESCE(stock_unidades, 0) + COALESCE(stock_estante, 0)) as stock_total,
                       COALESCE(stock_reservado, 0) as stock_reservado
                FROM productos 
                WHERE tienda_id = $1 AND activo = true `;
            
            if (tipo === 'CATEGORIA') q += `AND (categoria ILIKE $2 OR nombre ILIKE $2) `;
            if (tipo === 'ENVASE') q += `AND (categoria ILIKE '%envase%' OR categoria ILIKE '%frasco%') AND (nombre ILIKE $2 OR contenido_gramos = $3) `;
            
            q += `ORDER BY (COALESCE(stock_unidades, 0) + COALESCE(stock_estante, 0)) DESC LIMIT 1 FOR UPDATE`;
            const params = tipo === 'ENVASE' ? [idTiendaLocal, `%${criterio}%`, criterio] : [idTiendaLocal, `%${criterio}%`];
            const resQ = await client.query(q, params);
            return resQ.rows.length > 0 ? resQ.rows[0] : null;
        };

        const alcohol = await buscarInsumoGenerico('ALCOHOL', 'CATEGORIA');
        const fijador = await buscarInsumoGenerico('FIJADOR', 'CATEGORIA');
        const envase = await buscarInsumoGenerico(f.volumen_total, 'ENVASE');

        const insumosReservados = [];

        // 🔥 Helper interno de reserva: Valida contra la suma combinada y formatea la unidad adecuada ('u', 'ml', 'g')
        const ejecutarReserva = async (prodId, cantReq, nombreLog) => {
            const prodRes = await client.query(`
                SELECT id, nombre, categoria, unidad_medida,
                       COALESCE(stock_unidades, 0) as stock_unidades, 
                       COALESCE(stock_estante, 0) as stock_estante,
                       (COALESCE(stock_unidades, 0) + COALESCE(stock_estante, 0)) as stock_total,
                       COALESCE(stock_reservado, 0) as stock_reservado 
                FROM productos 
                WHERE id = $1 FOR UPDATE
            `, [prodId]);

            if (prodRes.rows.length === 0) throw new Error(`Insumo no encontrado: ${nombreLog}`);
            const p = prodRes.rows[0];

            // Cálculo de disponibilidad real combinada
            const dispoTotal = parseFloat(p.stock_total) - parseFloat(p.stock_reservado);

            // Determinación dinámica de la unidad de medida visual ('u', 'ml' o 'g')
            const catUpper = (p.categoria || '').toUpperCase();
            const nomUpper = (p.nombre || '').toUpperCase();
            let unidadTexto = 'g';

            if (catUpper.includes('ENVASE') || catUpper.includes('FRASCO') || nomUpper.includes('FRASCO') || nomUpper.includes('ENVASE')) {
                unidadTexto = 'u';
            } else if (catUpper.includes('ALCOHOL') || nomUpper.includes('ALCOHOL')) {
                unidadTexto = 'ml';
            }

            if (dispoTotal < cantReq) {
                throw new Error(`Quiebre en reserva de "${p.nombre}". Disponible: ${dispoTotal.toFixed(0)}${unidadTexto}, Requerido: ${cantReq.toFixed(0)}${unidadTexto}.`);
            }

            // Registrar reserva
            await client.query('UPDATE productos SET stock_reservado = COALESCE(stock_reservado, 0) + $1 WHERE id = $2', [cantReq, p.id]);
            insumosReservados.push({ id: p.id, nombre: p.nombre, reservado: cantReq });
        };

        // A) RESERVA DE FRAGANCIAS DINÁMICAS (Multi-esencia variada)
        for (const item of composicion) {
            const gramosEsenciaRequeridos = parseFloat(f.gramos_esencia) * parseInt(item.cantidad, 10);
            await ejecutarReserva(item.id, gramosEsenciaRequeridos, item.nombre);
        }

        // B) RESERVA DE INSUMOS VEHÍCULOS GLOBALIZADOS (Alcohol, Fijador y Frascos)
        const reqAlcohol = parseFloat(f.ml_alcohol) * plan;
        const reqFijador = parseFloat(f.gramos_fijador) * plan;
        const reqEnvase = 1 * plan;

        if (alcohol) await ejecutarReserva(alcohol.id, reqAlcohol, "Alcohol");
        if (fijador) await ejecutarReserva(fijador.id, reqFijador, "Fijador");
        if (envase) await ejecutarReserva(envase.id, reqEnvase, "Frascos");

        // 4. Registrar la Orden
        const codOrden = `FAB-${Date.now().toString().slice(-6)}`;
        await client.query(`
            INSERT INTO ordenes_produccion 
            (codigo_orden, tienda_id, usuario_creador_id, formula_id, cantidad_planificada, notas_planificacion, estado, insumos_reservados, composicion_esencias)
            VALUES ($1, $2, $3, $4, $5, $6, 'PROCESANDO', $7, $8)
        `, [codOrden, idTiendaLocal, usuarioId, formula_id, plan, notas_planificacion, JSON.stringify(insumosReservados), JSON.stringify(composicion)]);

        await client.query('COMMIT');
        res.json({ mensaje: `Orden mixta ${codOrden} procesada. Todas las fragancias e insumos del lote fueron congelados.` });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// --- COMPLETAR ORDEN ---
const completarOrden = async (req, res) => {
    const { id } = req.params;
    const { cantidad_completada, cantidad_merma, accion_merma, notas_cierre, desglose_cierre } = req.body;

    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const usuarioId = req.user ? req.user.id : null;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        const completada = parseInt(cantidad_completada, 10) || 0;
        const merma = parseInt(cantidad_merma, 10) || 0;

        // 1. Validar existencia y estado de la orden
        const ordRes = await client.query(
            'SELECT * FROM ordenes_produccion WHERE id = $1 AND tienda_id = $2 FOR UPDATE', 
            [id, idTiendaLocal]
        );
        if (ordRes.rows.length === 0) throw new Error("Orden no encontrada.");
        const orden = ordRes.rows[0];

        if (orden.estado !== 'PROCESANDO') throw new Error("La orden ya fue cerrada o cancelada.");
        if ((completada + merma) !== parseInt(orden.cantidad_planificada, 10)) {
            throw new Error(`Los valores no cuadran. Planificado: ${orden.cantidad_planificada}. Informado: ${completada + merma}`);
        }

        // 2. Liberar de forma segura todas las reservas congeladas originalmente
        const insumosReservados = parseSafeJSON(orden.insumos_reservados);
        for (const ins of insumosReservados) {
            await client.query(
                'UPDATE productos SET stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0) WHERE id = $2', 
                [ins.reservado, ins.id]
            );
        }

        let costoTotalProduccion = 0;

        // 3. Procesar consumo de vehículos e insumos globales (Alcohol, Fijador, Envases)
        const insumosGlobales = insumosReservados.filter(ins => {
            const nom = (ins.nombre || '').toUpperCase();
            return nom.includes('ALCOHOL') || nom.includes('FIJADOR') || nom.includes('FRASCO') || nom.includes('ENVASE');
        });

        for (const insumo of insumosGlobales) {
            const consumoPorUnidad = parseFloat(insumo.reservado || 0) / parseFloat(orden.cantidad_planificada);
            let consumoReal = consumoPorUnidad * completada;
            
            if (merma > 0 && accion_merma === 'PERDIDA') {
                consumoReal += (consumoPorUnidad * merma); 
            }

            if (consumoReal > 0) {
                const prodAct = await client.query(`
                    UPDATE productos 
                    SET stock_unidades = GREATEST(stock_unidades - $1, 0) 
                    WHERE id = $2 
                    RETURNING stock_unidades, costo, unidad_medida, categoria, nombre
                `, [consumoReal, insumo.id]);

                if (prodAct.rows.length > 0) {
                    const rowInsumo = prodAct.rows[0];
                    const stockNuevo = parseFloat(rowInsumo.stock_unidades || 0);
                    const stockAnterior = stockNuevo + consumoReal;
                    
                    let costoUnitarioInsumo = parseFloat(rowInsumo.costo || 0);
                    const uniUpper = (rowInsumo.unidad_medida || '').toUpperCase();
                    const catUpper = (rowInsumo.categoria || '').toUpperCase();

                    if (uniUpper === 'GRAMOS' || uniUpper === 'ML' || catUpper === 'ESENCIAS' || catUpper === 'ALCOHOL' || catUpper === 'FIJADOR') {
                        costoUnitarioInsumo = costoUnitarioInsumo / 1000;
                    }

                    costoTotalProduccion += (consumoReal * costoUnitarioInsumo);

                    await client.query(`
                        INSERT INTO historial_movimientos (
                            producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, tienda_id
                        )
                        VALUES ($1, 'SALIDA', $2, $3, $4, $5, $6, $7)
                    `, [
                        insumo.id, 'SALIDA', consumoReal, stockAnterior, stockNuevo,
                        `Consumo Insumo General por Orden #${orden.codigo_orden}`, usuarioId, idTiendaLocal
                    ]);
                }
            }
        }

        // 4. Procesar descuento real de Esencias (considerando suplementación/cambios)
        const desgloseFinal = Array.isArray(desglose_cierre) && desglose_cierre.length > 0 
            ? desglose_cierre 
            : parseSafeJSON(orden.composicion_esencias);

        // Obtener la dosis de esencia por unidad desde la fórmula
        const formRes = await client.query('SELECT nombre, volumen_total, gramos_esencia FROM formulas WHERE id = $1', [orden.formula_id]);
        const formulaData = formRes.rows.length > 0 ? formRes.rows[0] : { nombre: "Fórmula", volumen_total: 30, gramos_esencia: 0 };
        const gramosEsenciaPorUnidad = parseFloat(formulaData.gramos_esencia || 0);

        for (const item of desgloseFinal) {
            const cantOk = parseInt(item.ok || item.cantidad || 0, 10);
            const cantMermaItem = parseInt(item.merma || 0, 10);
            
            let unidadesADescontar = cantOk;
            if (cantMermaItem > 0 && accion_merma === 'PERDIDA') {
                unidadesADescontar += cantMermaItem;
            }

            if (unidadesADescontar <= 0) continue;

            // Identificar la esencia real utilizada (si fue suplementada usa id_actual, de lo contrario id)
            const esenciaIdAUsar = item.id_actual || item.id;
            const gramosADescontar = unidadesADescontar * gramosEsenciaPorUnidad;

            const prodAct = await client.query(`
                UPDATE productos 
                SET stock_unidades = GREATEST(stock_unidades - $1, 0) 
                WHERE id = $2 
                RETURNING stock_unidades, costo, unidad_medida, categoria, nombre
            `, [gramosADescontar, esenciaIdAUsar]);

            if (prodAct.rows.length > 0) {
                const rowEsencia = prodAct.rows[0];
                const stockNuevo = parseFloat(rowEsencia.stock_unidades || 0);
                const stockAnterior = stockNuevo + gramosADescontar;
                
                const costoUnitarioGramo = parseFloat(rowEsencia.costo || 0) / 1000;
                costoTotalProduccion += (gramosADescontar * costoUnitarioGramo);

                const etiquetaSuplemento = item.fue_suplementada ? ` (Suplementado: reemplazó a ${item.nombre_original || 'original'})` : '';

                await client.query(`
                    INSERT INTO historial_movimientos (
                        producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id, tienda_id
                    )
                    VALUES ($1, 'SALIDA', $2, $3, $4, $5, $6, $7)
                `, [
                    esenciaIdAUsar, 'SALIDA', gramosADescontar, stockAnterior, stockNuevo,
                    `Consumo Esencia por Orden #${orden.codigo_orden}${etiquetaSuplemento}`, usuarioId, idTiendaLocal
                ]);
            }
        }

        const costoUnitarioFinal = completada > 0 ? (costoTotalProduccion / completada) : 0;

        // 5. Crear o actualizar los Productos Terminados resultantes
        let primerProductoFinalId = null;

        if (completada > 0) {
            const nombreFormula = formulaData.nombre;
            const volumenMl = parseInt(formulaData.volumen_total, 10) || 30;

            for (const item of desgloseFinal) {
                const cantItemOk = parseInt(item.ok || item.cantidad || 0, 10);
                if (cantItemOk <= 0) continue;

                const esenciaIdFinal = item.id_actual || item.id;
                const essRes = await client.query('SELECT codigo, nombre, marca, genero FROM productos WHERE id = $1', [esenciaIdFinal]);
                const base = essRes.rows.length > 0 ? essRes.rows[0] : { codigo: `FAB-${id}`, nombre: item.nombre_actual || "LOTE MIXTO", marca: "VARIA", genero: "UNISEX" };
                
                let nombreLimpio = base.nombre.toUpperCase().replace(/ESENCIA/gi, '').trim();
                const nombrePerfume = `PERFUME ${nombreLimpio} ${nombreFormula}`.toUpperCase();
                
                const codigoFinal = `${base.codigo}-T${volumenMl}`; 
                const codigoLote = `LOT-${Date.now().toString().slice(-4)}`;

                const checkPerf = await client.query(
                    'SELECT id FROM productos WHERE nombre = $1 AND tienda_id = $2 AND es_producto_terminado = true', 
                    [nombrePerfume, idTiendaLocal]
                );

                let productoFinalId = null;

                if (checkPerf.rows.length > 0) {
                    productoFinalId = checkPerf.rows[0].id;
                    await client.query(`
                        UPDATE productos 
                        SET stock_unidades = stock_unidades + $1, costo = $2, codigo = $3, tamano = $4, contenido_gramos = $5 
                        WHERE id = $6
                    `, [cantItemOk, costoUnitarioFinal, codigoFinal, `${volumenMl}ml`, volumenMl, productoFinalId]);
                } else {
                    const insertPerf = await client.query(`
                        INSERT INTO productos (codigo, nombre, marca, categoria, stock_unidades, costo, precio_venta, es_producto_terminado, tienda_id, activo, genero, tamano, contenido_gramos)
                        VALUES ($1, $2, $3, 'Perfumes Terminados', $4, $5, 0, true, $6, true, $7, $8, $9) 
                        RETURNING id
                    `, [codigoFinal, nombrePerfume, base.marca, cantItemOk, costoUnitarioFinal, idTiendaLocal, base.genero, `${volumenMl}ml`, volumenMl]);
                    
                    productoFinalId = insertPerf.rows[0].id;
                }

                if (!primerProductoFinalId) primerProductoFinalId = productoFinalId;

                // Crear lote e historial de entrada para cada fragancia producida
                await client.query(`
                    INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id)
                    VALUES ($1, $2, $3, $3, NOW() + interval '2 years', $4, $5)
                `, [productoFinalId, codigoLote, cantItemOk, costoUnitarioFinal, idTiendaLocal]);

                await client.query(`
                    INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, motivo, fecha, tienda_id, usuario_id)
                    VALUES ($1, 'ENTRADA', $2, $3, NOW(), $4, $5)
                `, [productoFinalId, cantItemOk, `Ingreso Producción. Lote: ${codigoLote}`, idTiendaLocal, usuarioId]);
            }
        }

        // 6. Cerrar la Orden de Producción
        await client.query(`
            UPDATE ordenes_produccion 
            SET estado = 'COMPLETADA', 
                cantidad_completada = $1, 
                cantidad_merma = $2,
                costo_unitario_real = $3, 
                inversion_total = $4, 
                notas_cierre = $5, 
                usuario_cierre_id = $6, 
                fecha_cierre = NOW(), 
                producto_final_id = $7, 
                lote_fabricacion = $8,
                composicion_esencias = $9
            WHERE id = $10
        `, [
            completada, merma, costoUnitarioFinal, costoTotalProduccion, 
            notas_cierre, usuarioId, primerProductoFinalId, `LOTE-${id}`, 
            JSON.stringify(desgloseFinal), id
        ]);

        await client.query('COMMIT');
        res.json({ mensaje: `Orden #${orden.codigo_orden} completada. ${completada} perfumes procesados e ingresados al almacén.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error crítico en completarOrden:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

module.exports = { 
    getOrdenes, 
    crearOrden, 
    completarOrden, 
    exportarLotesFabricadosExcel,
    exportarHistorialInsumosExcel
};