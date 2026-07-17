const pool = require('../config/db');
const { getHistorialImportaciones } = require('./productos.controller');

const createFormula = async (req, res) => {
    const { 
        nombre, volumen_total, precio, precio_bs, 
        gramos_esencia, ml_alcohol, gramos_fijador,
        precio_mayor, precio_mayor_bs, cantidad_mayor,
        precio_gran_mayor, precio_gran_mayor_bs, cantidad_gran_mayor,
        precio_promo, cantidad_promo,
        // 🔥 NUEVOS PARÁMETROS CAPTURADOS
        precio_gramo_extra, precio_fijador_extra, precio_recarga 
    } = req.body;

    try {
        const query = `
            INSERT INTO formulas 
            (nombre, volumen_total, precio, precio_bs, gramos_esencia, ml_alcohol, gramos_fijador, 
             precio_mayor, precio_mayor_bs, cantidad_mayor, precio_gran_mayor, precio_gran_mayor_bs, cantidad_gran_mayor,
             precio_promo, cantidad_promo, precio_gramo_extra, precio_fijador_extra, precio_recarga) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) 
            RETURNING *
        `;
        
        const values = [
            nombre, volumen_total, precio || 0, precio_bs || 0, gramos_esencia, ml_alcohol, gramos_fijador || 0,
            precio_mayor || 0, precio_mayor_bs || 0, cantidad_mayor || 6,
            precio_gran_mayor || 0, precio_gran_mayor_bs || 0, cantidad_gran_mayor || 50,
            precio_promo || 0, cantidad_promo || 0,
            // 🔥 ADICIÓN DE VALORES MAPEADOS EN EL ARRAY
            precio_gramo_extra || 0, precio_fijador_extra || 0, precio_recarga || 0     
        ];

        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error creando la regla comercial' });
    }
};

const updateFormula = async (req, res) => {
    const { id } = req.params;
    const { 
        nombre, volumen_total, precio, precio_bs, 
        gramos_esencia, ml_alcohol, gramos_fijador,
        precio_mayor, precio_mayor_bs, cantidad_mayor,
        precio_gran_mayor, precio_gran_mayor_bs, cantidad_gran_mayor,
        precio_promo, cantidad_promo,
        // 🔥 NUEVOS PARÁMETROS CAPTURADOS
        precio_gramo_extra, precio_fijador_extra, precio_recarga
    } = req.body;

    try {
        // 🔥 CONSULTA CORREGIDA: Se inyectan las 3 columnas y el parámetro del ID pasa a ser $19
        const query = `
            UPDATE formulas SET 
                nombre = $1, volumen_total = $2, precio = $3, precio_bs = $4, gramos_esencia = $5, ml_alcohol = $6, gramos_fijador = $7,
                precio_mayor = $8, precio_mayor_bs = $9, cantidad_mayor = $10, precio_gran_mayor = $11, precio_gran_mayor_bs = $12, cantidad_gran_mayor = $13,
                precio_promo = $14, cantidad_promo = $15,
                precio_gramo_extra = $16, precio_fijador_extra = $17, precio_recarga = $18
            WHERE id = $19 
            RETURNING *
        `;
        const values = [
            nombre, volumen_total, precio || 0, precio_bs || 0, gramos_esencia, ml_alcohol, gramos_fijador || 0, 
            precio_mayor || 0, precio_mayor_bs || 0, cantidad_mayor || 6,
            precio_gran_mayor || 0, precio_gran_mayor_bs || 0, cantidad_gran_mayor || 50,
            precio_promo || 0, cantidad_promo || 0,
            // 🔥 AGREGAMOS LOS PARÁMETROS FINANCIEROS Y CORREMOS EL ID AL FINAL
            precio_gramo_extra || 0, precio_fijador_extra || 0, precio_recarga || 0,
            id
        ];

        const result = await pool.query(query, values);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Fórmula no encontrada' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error actualizando la regla comercial' });
    }
};

const getFormulas = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM formulas ORDER BY volumen_total ASC');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const deleteFormula = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM formulas WHERE id = $1', [id]);
        res.json({ mensaje: 'Fórmula eliminada' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const consumirFormulaExterna = async (req, res) => {
    const { lotes, origen } = req.body;
    const usuarioId = req.user ? req.user.id : null;
    
    // 🔥 CANDADO: Identificamos la tienda del usuario activo
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const consolidado = {};
        const reporteMovimientos = [];

        // Función inteligente para agrupar insumos y etiquetas para el Kardex
        const acumularInsumo = (id, nombre, categoria, cantidad, etiqueta = '') => {
            if (!consolidado[id]) {
                consolidado[id] = { id, nombre, categoria, requerido: 0, etiquetas: new Set() };
            }
            consolidado[id].requerido += cantidad;
            if (etiqueta) consolidado[id].etiquetas.add(etiqueta);
        };

        for (const lote of lotes) {
            const { formulaId, productoId, cantidad } = lote;
            
            // FORZAMOS LA LECTURA DE LOS EXTRAS
            const gramosExtra = parseFloat(lote.gramosExtra) || 0;
            const fijadorExtra = parseFloat(lote.fijadorExtra) || 0; 
            const esRecarga = lote.esRecarga === true || String(lote.esRecarga) === 'true';
            
            const cantVendida = Math.abs(parseInt(cantidad) || 1); 

            const formulaRes = await client.query(`SELECT nombre, volumen_total, gramos_esencia, gramos_fijador, ml_alcohol FROM formulas WHERE id = $1`, [formulaId]);
            if (formulaRes.rows.length === 0) throw new Error("La medida seleccionada no existe.");
            const f = formulaRes.rows[0];

            // 🔒 CANDADO 1: Aseguramos que la esencia pertenece a la sucursal activa
            const esenciaRes = await client.query(`SELECT nombre, categoria FROM productos WHERE id = $1 AND tienda_id = $2`, [productoId, idTiendaLocal]);
            if (esenciaRes.rows.length === 0) throw new Error("La esencia seleccionada no existe en el inventario de esta sucursal.");
            const e = esenciaRes.rows[0];

            // ETIQUETAS DINÁMICAS PARA EL KARDEX
            let extrasTexto = [];
            if (gramosExtra > 0) extrasTexto.push(`+${gramosExtra}g Ese`);
            if (fijadorExtra > 0) extrasTexto.push(`+${fijadorExtra}g Fij`);
            if (esRecarga) extrasTexto.push(`RECARGA`);
            
            let tipoOp = extrasTexto.length > 0 ? extrasTexto.join(' | ') : 'NORMAL';

            // 1. DESCONTAR ESENCIA (Fórmula Base + Esencia Extra)
            const esenciaTotal = (parseFloat(f.gramos_esencia) + gramosExtra) * cantVendida;
            acumularInsumo(productoId, e.nombre, e.categoria, esenciaTotal, `(${f.nombre}): ${tipoOp}`);

            // 🔒 CANDADO 2: Búsqueda de Alcohol blindada por tienda
            const alcoholRes = await client.query(`SELECT id, nombre, categoria FROM productos WHERE categoria ILIKE '%alcohol%' AND activo=true AND tienda_id = $1 LIMIT 1`, [idTiendaLocal]);
            
            // 🔒 CANDADO 3: Búsqueda de Fijador blindada por tienda
            const fijadorRes = await client.query(`SELECT id, nombre, categoria FROM productos WHERE categoria ILIKE '%fijador%' AND activo=true AND tienda_id = $1 LIMIT 1`, [idTiendaLocal]);

            // 2. DESCONTAR ALCOHOL 
            const cantAlcohol = parseFloat(f.ml_alcohol) || 0;
            if (cantAlcohol > 0) {
                if (alcoholRes.rows.length > 0) {
                    acumularInsumo(alcoholRes.rows[0].id, alcoholRes.rows[0].nombre, alcoholRes.rows[0].categoria, cantAlcohol * cantVendida, `Prep. ${tipoOp}`);
                } else {
                    throw new Error(`Falta Alcohol: La receta requiere ${cantAlcohol}ml, pero no se encontró en esta sucursal.`);
                }
            }

            // 3. DESCONTAR FIJADOR
            const cantFijador = parseFloat(f.gramos_fijador) || 0;
            const fijadorTotal = (cantFijador + fijadorExtra) * cantVendida; 
            
            if (fijadorTotal > 0) {
                if (fijadorRes.rows.length > 0) {
                    acumularInsumo(fijadorRes.rows[0].id, fijadorRes.rows[0].nombre, fijadorRes.rows[0].categoria, fijadorTotal, `Prep. ${tipoOp}`);
                } else {
                    throw new Error(`Falta Fijador: La receta requiere ${fijadorTotal}g, pero no se encontró en esta sucursal.`);
                }
            }

            // 4. DESCONTAR ENVASE (SOLO SI NO ES RECARGA)
            if (!esRecarga) {
                const volumen = parseInt(f.volumen_total) || 0;
                // 🔒 CANDADO 4: Búsqueda de Envases/Frascos blindada por tienda
                const frascoRes = await client.query(`
                    SELECT id, nombre, categoria 
                    FROM productos 
                    WHERE (categoria ILIKE '%envase%' OR categoria ILIKE '%frasco%') 
                    AND (nombre ILIKE $1 OR contenido_gramos = $2) 
                    AND activo = true 
                    AND tienda_id = $3
                    LIMIT 1
                `, [`%${volumen}%`, volumen, idTiendaLocal]);
                
                if (frascoRes.rows.length > 0) {
                    acumularInsumo(frascoRes.rows[0].id, frascoRes.rows[0].nombre, frascoRes.rows[0].categoria, cantVendida, 'Envase Nuevo');
                } else {
                    throw new Error(`No se encontró stock de frascos de ${volumen}ml en esta sucursal.`);
                }
            }
        }

        const alertasAutoComposicion = [];

        // =========================================================================
        // 🔒 MOTOR DE VALIDACIÓN DE STOCK AMARRADO A LA SUCURSAL
        // =========================================================================
        for (const id in consolidado) {
            const item = consolidado[id];
            
            // Leemos el stock específicamente de esta tienda
            const stockRes = await client.query(`SELECT stock_unidades, stock_estante FROM productos WHERE id = $1 AND tienda_id = $2`, [id, idTiendaLocal]);
            if (stockRes.rows.length === 0) throw new Error(`El producto con ID ${id} no existe en esta sucursal.`);
            
            const almacen = parseFloat(stockRes.rows[0].stock_unidades) || 0;
            const estante = parseFloat(stockRes.rows[0].stock_estante) || 0;
            const totalGlobal = almacen + estante;

            if (totalGlobal < item.requerido) {
                throw new Error(`Quiebre de existencias absoluto: "${item.nombre}" requiere ${item.requerido} en total, pero solo hay ${totalGlobal} en la sucursal. Operación rechazada.`);
            }

            if (origen === 'ESTANTE' && estante < item.requerido) {
                const faltante = item.requerido - estante;
                alertasAutoComposicion.push({
                    productoId: id,
                    nombre: item.nombre,
                    requerido: item.requerido,
                    faltanteEstante: faltante,
                    tomarAlmacen: faltante
                });
            }
        }

        // =========================================================================
        // 🔒 EJECUCIÓN DEL DESCUENTO CON AISLAMIENTO DE TIENDA
        // =========================================================================
        for (const id in consolidado) {
            const item = consolidado[id];
            let restante = item.requerido;
            let restadoAlmacen = 0;
            let restadoEstante = 0;
            let fueAutoCompuesto = false;

            const descontarDeBotellasEstante = async (productoId, cantDeducir) => {
                let pdte = cantDeducir;
                const botellas = await client.query(`
                    SELECT id, cantidad FROM botellas_estante 
                    WHERE producto_id = $1 
                    ORDER BY CASE WHEN estado = 'ABIERTA' THEN 1 ELSE 2 END ASC, cantidad ASC 
                    FOR UPDATE
                `, [productoId]);

                for (const b of botellas.rows) {
                    if (pdte <= 0.001) break;
                    const disp = parseFloat(b.cantidad);
                    const aRestar = Math.min(pdte, disp);
                    const nuevaCant = disp - aRestar;
                    
                    if (nuevaCant <= 0.01) {
                        await client.query('DELETE FROM botellas_estante WHERE id = $1', [b.id]);
                    } else {
                        await client.query('UPDATE botellas_estante SET cantidad = $1 WHERE id = $2', [nuevaCant, b.id]);
                    }
                    pdte -= aRestar;
                }
            };

            const autoCompo = alertasAutoComposicion.find(a => a.productoId === id);
            
            if (autoCompo) {
                fueAutoCompuesto = true;
                const stockRes = await client.query(`SELECT stock_estante FROM productos WHERE id = $1 AND tienda_id = $2`, [id, idTiendaLocal]);
                const estanteActual = parseFloat(stockRes.rows[0].stock_estante) || 0;
                
                if (estanteActual > 0) {
                    restadoEstante = estanteActual;
                    await client.query(`UPDATE productos SET stock_estante = 0 WHERE id = $1 AND tienda_id = $2`, [id, idTiendaLocal]);
                    await descontarDeBotellasEstante(id, estanteActual);
                }
                
                restadoAlmacen = autoCompo.tomarAlmacen;
                await client.query(`UPDATE productos SET stock_unidades = stock_unidades - $1 WHERE id = $2 AND tienda_id = $3`, [autoCompo.tomarAlmacen, id, idTiendaLocal]);
                
                const notaComposicion = `Auto-composición de emergencia: Faltaban ${autoCompo.faltanteEstante}g/ml en estante. Compensado tomando del Almacén General de forma directa.`;
                await client.query(`
                    INSERT INTO historial_auto_composicion (producto_id, cantidad_requerida, cantidad_faltante_estante, cantidad_tomada_almacen, nota)
                    VALUES ($1, $2, $3, $4, $5)
                `, [id, item.requerido, autoCompo.faltanteEstante, autoCompo.tomarAlmacen, notaComposicion]);
            } else {
                if (origen === 'ESTANTE') {
                    restadoEstante = restante;
                    await client.query(`UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2 AND tienda_id = $3`, [restante, id, idTiendaLocal]);
                    await descontarDeBotellasEstante(id, restante);
                } else {
                    const stockRes = await client.query(`SELECT stock_unidades FROM productos WHERE id = $1 AND tienda_id = $2`, [id, idTiendaLocal]);
                    let almacenActual = parseFloat(stockRes.rows[0].stock_unidades) || 0;
                    
                    if (almacenActual > 0) {
                        if (almacenActual >= restante) {
                            await client.query(`UPDATE productos SET stock_unidades = stock_unidades - $1 WHERE id = $2 AND tienda_id = $3`, [restante, id, idTiendaLocal]);
                            restadoAlmacen = restante;
                            restante = 0;
                        } else {
                            restante -= almacenActual;
                            restadoAlmacen = almacenActual;
                            await client.query(`UPDATE productos SET stock_unidades = 0 WHERE id = $1 AND tienda_id = $2`, [id, idTiendaLocal]);
                        }
                    }
                    if (restante > 0) {
                        restadoEstante = restante;
                        await client.query(`UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2 AND tienda_id = $3`, [restante, id, idTiendaLocal]);
                        await descontarDeBotellasEstante(id, restante);
                    }
                }
            }

            const etiquetasTexto = Array.from(item.etiquetas).join(' | ');
            const motivoDetallado = `Venta Externa - [${etiquetasTexto}] ${fueAutoCompuesto ? '(AUTO-COMPOSICIÓN)' : ''}`;
            const sufijoUnidad = item.categoria.toUpperCase().includes('ENVASE') ? ' unds' : 'ml/g';
            
            reporteMovimientos.push({
                nombre: item.nombre,
                etiquetas: etiquetasTexto,
                restadoAlmacen: restadoAlmacen + sufijoUnidad,
                restadoEstante: restadoEstante + sufijoUnidad,
                autoCompuesto: fueAutoCompuesto ? 'SÍ' : 'NO'
            });
            
            // 🔒 Kardex blindado con el ID de la tienda para que no se vea en otras sucursales
            await client.query(`
                INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id) 
                VALUES ($1, 'SALIDA', $2, (SELECT stock_unidades + stock_estante FROM productos WHERE id=$1 AND tienda_id=$4), $3, NOW(), $4)
            `, [id, item.requerido, motivoDetallado, idTiendaLocal]);
        }

        // 🔒 Guardamos el historial de sincronización mapeado a la tienda local
        await client.query(`
            INSERT INTO historial_sincronizacion (usuario_id, cantidad_items, detalles_json, tienda_id)
            VALUES ($1, $2, $3, $4)
        `, [usuarioId, lotes.length, JSON.stringify(reporteMovimientos), idTiendaLocal]);

        await client.query('COMMIT');
        res.json({ OK: true, reporteMovimientos });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};


const getHistorialSincronizacion = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT h.*, u.nombre as operador 
            FROM historial_sincronizacion h
            LEFT JOIN usuarios u ON h.usuario_id = u.id
            ORDER BY h.fecha DESC LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo historial externo:", error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getFormulas, createFormula, updateFormula, deleteFormula, consumirFormulaExterna,getHistorialImportaciones, getHistorialSincronizacion };