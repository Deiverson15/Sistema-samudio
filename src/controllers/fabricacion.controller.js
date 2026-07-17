const pool = require('../config/db');

// --- 1. LEER ÓRDENES (PARA LA VISTA KABAN) ---
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

// --- 2. FASE 1: CREAR ORDEN Y RESERVAR INSUMOS ---
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

        // Helpers de búsqueda de insumos globales
        const buscarInsumoGenerico = async (criterio, tipo) => {
            let q = `SELECT id, nombre, stock_unidades, stock_reservado FROM productos WHERE tienda_id = $1 AND activo = true `;
            if (tipo === 'CATEGORIA') q += `AND (categoria ILIKE $2 OR nombre ILIKE $2) `;
            if (tipo === 'ENVASE') q += `AND (categoria ILIKE '%envase%' OR categoria ILIKE '%frasco%') AND (nombre ILIKE $2 OR contenido_gramos = $3) `;
            q += `ORDER BY stock_unidades DESC LIMIT 1 FOR UPDATE`;
            const params = tipo === 'ENVASE' ? [idTiendaLocal, `%${criterio}%`, criterio] : [idTiendaLocal, `%${criterio}%`];
            const resQ = await client.query(q, params);
            return resQ.rows.length > 0 ? resQ.rows[0] : null;
        };

        const alcohol = await buscarInsumoGenerico('ALCOHOL', 'CATEGORIA');
        const fijador = await buscarInsumoGenerico('FIJADOR', 'CATEGORIA');
        
        // 🔥 CORREGIDO: Cambiado de buscarInsumo a buscarInsumoGenerico para evitar el desplome 400
        const envase = await buscarInsumoGenerico(f.volumen_total, 'ENVASE');

        const insumosReservados = [];

        // Helper interno de reserva de stock
        const ejecutarReserva = async (prodId, cantReq, nombreLog) => {
            const prodRes = await client.query('SELECT id, nombre, stock_unidades, stock_reservado FROM productos WHERE id = $1 FOR UPDATE', [prodId]);
            if (prodRes.rows.length === 0) throw new Error(`Insumo no encontrado: ${nombreLog}`);
            const p = prodRes.rows[0];

            const dispo = parseFloat(p.stock_unidades) - parseFloat(p.stock_reservado || 0);
            if (dispo < cantReq) {
                throw new Error(`Quiebre en reserva de "${p.nombre}". Disponible: ${dispo.toFixed(0)}g, Requerido: ${cantReq.toFixed(0)}g.`);
            }

            await client.query('UPDATE productos SET stock_reservado = COALESCE(stock_reservado, 0) + $1 WHERE id = $2', [cantReq, p.id]);
            insumosReservados.push({ id: p.id, nombre: p.nombre, reservado: cantReq });
        };

        // A) RESERVA DE FRAGANCIAS DINÁMICAS (Multi-esencia variada)
        for (const item of composicion) {
            const gramosEsenciaRequeridos = parseFloat(f.gramos_esencia) * parseInt(item.cantidad, 10);
            await ejecutarReserva(item.id, gramosEsenciaRequeridos, item.nombre);
        }

        // B) RESERVA DE INSUMOS VEHÍCULOS GLOBALIZADOS (Suma total del lote)
        const reqAlcohol = parseFloat(f.ml_alcohol) * plan;
        const reqFijador = parseFloat(f.gramos_fijador) * plan;
        const reqEnvase = 1 * plan;

        if (alcohol) await ejecutarReserva(alcohol.id, reqAlcohol, "Alcohol");
        if (fijador) await ejecutarReserva(fijador.id, reqFijador, "Fijador");
        if (envase) await ejecutarReserva(envase.id, reqEnvase, "Frascos");

        // 4. Registrar la Orden con la composición JSONB incrustada
        const codOrden = `FAB-${Date.now().toString().slice(-6)}`;
        await client.query(`
            INSERT INTO ordenes_produccion 
            (codigo_orden, tienda_id, usuario_creador_id, formula_id, cantidad_planificada, notas_planificacion, estado, insumos_reservados, composicion_esencias)
            VALUES ($1, $2, $3, $4, $5, $6, 'PROCESANDO', $7, $8)
        `, [codOrden, idTiendaLocal, usuarioId, formula_id, plan, notas_planificacion, JSON.stringify(insumosReservados), JSON.stringify(composicion)]);

        await client.query('COMMIT');
        res.json({ mensaje: `Orden mixta ${codOrden} procesada. Todas las fragancias del lote fueron congeladas.` });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const completarOrden = async (req, res) => {
    const { id } = req.params;
    const { cantidad_completada, cantidad_merma, accion_merma, notas_cierre } = req.body;

    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const usuarioId = req.user.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        const completada = parseInt(cantidad_completada, 10);
        const merma = parseInt(cantidad_merma, 10);

        // 1. Validar la orden
        const ordRes = await client.query('SELECT * FROM ordenes_produccion WHERE id = $1 AND tienda_id = $2 FOR UPDATE', [id, idTiendaLocal]);
        if (ordRes.rows.length === 0) throw new Error("Orden no encontrada.");
        const orden = ordRes.rows[0];

        if (orden.estado !== 'PROCESANDO') throw new Error("La orden ya fue cerrada o cancelada.");
        if ((completada + merma) !== orden.cantidad_planificada) {
            throw new Error(`Los valores no cuadran. Planificado: ${orden.cantidad_planificada}. Informado: ${completada + merma}`);
        }

        const insumos = typeof orden.insumos_reservados === 'string' ? JSON.parse(orden.insumos_reservados) : orden.insumos_reservados;
        const composicion = typeof orden.composicion_esencias === 'string' ? JSON.parse(orden.composicion_esencias) : orden.composicion_esencias;
        
        let costoTotalProduccion = 0;

        // 2. Liberar reservas y aplicar consumo real
        for (const insumo of insumos) {
            await client.query('UPDATE productos SET stock_reservado = GREATEST(stock_reservado - $1, 0) WHERE id = $2', [insumo.reservado, insumo.id]);

            const consumoPorUnidad = parseFloat(insumo.reservado) / orden.cantidad_planificada;
            let consumoReal = consumoPorUnidad * completada;
            
            if (merma > 0 && accion_merma === 'PERDIDA') {
                consumoReal += (consumoPorUnidad * merma); 
            }

            const prodAct = await client.query('UPDATE productos SET stock_unidades = GREATEST(stock_unidades - $1, 0) WHERE id = $2 RETURNING costo', [consumoReal, insumo.id]);
            costoTotalProduccion += (consumoReal * parseFloat(prodAct.rows[0].costo || 0));

            await client.query(`
                INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, motivo, fecha, tienda_id, usuario_id)
                VALUES ($1, 'SALIDA', $2, $3, NOW(), $4, $5)
            `, [insumo.id, consumoReal, `Consumo Producción. Orden: ${orden.codigo_orden}`, idTiendaLocal, usuarioId]);
        }

        const costoUnitarioFinal = completada > 0 ? (costoTotalProduccion / completada) : 0;

        // 3. Crear o actualizar el Producto Terminado
        let productoFinalId = null;
        if (completada > 0) {
            const formRes = await client.query('SELECT nombre FROM formulas WHERE id = $1', [orden.formula_id]);
            const nombreFormula = formRes.rows.length > 0 ? formRes.rows[0].nombre : "Fórmula";

            // Datos base del producto (Usamos la primera esencia para heredar código/género)
            const firstEsencia = composicion[0];
            const essRes = await client.query('SELECT codigo, nombre, marca, genero FROM productos WHERE id = $1', [firstEsencia.id]);
            const base = essRes.rows.length > 0 ? essRes.rows[0] : { codigo: `FAB-${id}`, nombre: "LOTE MIXTO", marca: "VARIA", genero: "UNISEX" };
            
            // 🔥 Nombre limpio (quitamos palabra ESENCIA)
            let nombreLimpio = base.nombre.toUpperCase().replace(/ESENCIA/gi, '').trim();
            const nombrePerfume = `PERFUME ${nombreLimpio} ${nombreFormula}`.toUpperCase();
            
            // 🔥 Generación de código único (agregando -T para evitar duplicidad de llave primaria)
            const codigoFinal = `${base.codigo}-T`; 
            const codigoLote = `LOT-${Date.now().toString().slice(-4)}`;

            // Buscar si ya existe este perfume en el catálogo
            const checkPerf = await client.query('SELECT id FROM productos WHERE nombre = $1 AND tienda_id = $2 AND es_producto_terminado = true', [nombrePerfume, idTiendaLocal]);

            if (checkPerf.rows.length > 0) {
                productoFinalId = checkPerf.rows[0].id;
                await client.query(`UPDATE productos SET stock_unidades = stock_unidades + $1, costo = $2 WHERE id = $3`, [completada, costoUnitarioFinal, productoFinalId]);
            } else {
                const insertPerf = await client.query(`
                    INSERT INTO productos (codigo, nombre, marca, categoria, stock_unidades, costo, precio_venta, es_producto_terminado, tienda_id, activo, genero)
                    VALUES ($1, $2, $3, 'Perfumes Terminados', $4, $5, 0, true, $6, true, $7) RETURNING id
                `, [codigoFinal, nombrePerfume, base.marca, completada, costoUnitarioFinal, idTiendaLocal, base.genero]);
                productoFinalId = insertPerf.rows[0].id;
            }

            // Registrar lote
            await client.query(`
                INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id)
                VALUES ($1, $2, $3, $3, NOW() + interval '2 years', $4, $5)
            `, [productoFinalId, codigoLote, completada, costoUnitarioFinal, idTiendaLocal]);

            // Registrar ingreso
            await client.query(`
                INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, motivo, fecha, tienda_id, usuario_id)
                VALUES ($1, 'ENTRADA', $2, $3, NOW(), $4, $5)
            `, [productoFinalId, completada, `Ingreso Producción. Lote: ${codigoLote}`, idTiendaLocal, usuarioId]);
        }

        // 4. Cerrar la Orden
        await client.query(`
            UPDATE ordenes_produccion 
            SET estado = 'COMPLETADA', cantidad_completada = $1, cantidad_merma = $2,
                costo_unitario_real = $3, inversion_total = $4, notas_cierre = $5, 
                usuario_cierre_id = $6, fecha_cierre = NOW(), producto_final_id = $7, lote_fabricacion = $8
            WHERE id = $9
        `, [completada, merma, costoUnitarioFinal, costoTotalProduccion, notas_cierre, usuarioId, productoFinalId, `LOTE-${id}`, id]);

        await client.query('COMMIT');
        res.json({ mensaje: `Orden completada. ${completada} perfumes enviados al almacén.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error crítico en completarOrden:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

module.exports = { getOrdenes, crearOrden, completarOrden };