const pool = require('../config/db');
const ExcelJS = require('exceljs');
const roundMoney = (amount) => Math.round((parseFloat(amount) || 0) * 100) / 100;
const { crearNotificacionInterna } = require('./notificaciones.controller');


// - inventario/src/controllers/productos.controller.js

const getProductos = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || '';
        const bajoStock = req.query.bajoStock === 'true'; // Captura el filtro del frontend
        const offset = (page - 1) * limit;

        // Construcción dinámica de filtros
        let whereClause = 'WHERE activo = true';
        let params = [`%${search}%`];

        // 1. Buscador mejorado (Nombre, Código o Marca)
        whereClause += ` AND (nombre ILIKE $1 OR codigo ILIKE $1 OR marca ILIKE $1)`;

        // 2. Filtro de Bajo Stock (Solo muestra lo crítico si está activo)
        if (bajoStock) {
            whereClause += ' AND stock_unidades <= stock_minimo';
        }

        const queryData = `
            SELECT id, codigo, nombre, marca, categoria, precio_venta, 
                   stock_estante, stock_unidades AS stock_real, stock_minimo, 
                   unidad_medida, contenido_gramos, -- Soluciona el "undefinedml"
                   (SELECT COUNT(*)::int FROM lotes l WHERE l.producto_id = productos.id AND l.cantidad_actual > 0) as lotes_activos
            FROM productos 
            ${whereClause}
            ORDER BY id DESC 
            LIMIT $2 OFFSET $3
        `;

        const dataRes = await pool.query(queryData, [params[0], limit, offset]);
        
        // Consulta para metadatos de paginación
        const countRes = await pool.query(`SELECT COUNT(*) FROM productos ${whereClause}`, [params[0]]);
        const total = parseInt(countRes.rows[0].count);

        res.json({ 
            data: dataRes.rows,
            pagination: {
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Error en getProductos:", error);
        res.status(500).json({ error: 'Error obteniendo inventario' });
    }
};
// 2. CREAR PRODUCTO 
const createProducto = async (req, res) => {
    const { 
        codigo, nombre, marca, categoria, stock, stock_minimo, costo, precio_venta, 
        ubicacion, u_caja, ganancia, descripcion, unidad_medida, contenido_gramos 
    } = req.body;
    
    const usuarioId = req.user ? req.user.id : null; 
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const insertProdText = `
            INSERT INTO productos 
            (codigo, nombre, marca, categoria, stock_unidades, stock_minimo, costo, precio_venta, ubicacion, u_caja, ganancia, descripcion, unidad_medida, activo, contenido_gramos, tamano, stock_estante) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, $15, 0) 
            RETURNING *`;
        
        const prodValues = [
            codigo, nombre, marca, categoria, stock || 0, stock_minimo || 0, costo, precio_venta, 
            ubicacion, u_caja || 1, ganancia, descripcion, unidad_medida || 'UNIDAD',
            contenido_gramos || 0, contenido_gramos ? `${contenido_gramos}ml` : 'N/A'
        ];

        const resProd = await client.query(insertProdText, prodValues);
        const nuevoProd = resProd.rows[0];

        // --- NOTIFICACIÓN INTELIGENTE: STOCK INICIAL BAJO ---
        if (parseFloat(nuevoProd.stock_unidades) <= parseFloat(nuevoProd.stock_minimo)) {
            await crearNotificacionInterna(
                `INVENTARIO: Nuevo producto ${nuevoProd.nombre} creado con stock crítico (${nuevoProd.stock_unidades}).`,
                'ALERTA',
                '/inventario'
            );
        }

        // Auditoría
        if (usuarioId) {
            await client.query(
                "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'CREAR_PROD', $2, NOW())",
                [usuarioId, `Creó el producto: ${nuevoProd.nombre} (${codigo})`]
            );
        }

        await client.query('COMMIT');
        res.json(nuevoProd);
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};


const reactivarProducto = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.user ? req.user.id : null; // 🔥 Capturamos al usuario
    
    try {
        await pool.query('UPDATE productos SET activo = true WHERE id = $1', [id]);
        
        // 🔥 TRUCO MÁGICO: Cambiamos la acción del log viejo para que desaparezcan los botones
        await pool.query("UPDATE auditoria SET accion = 'REACTIVADO' WHERE accion = 'ELIMINAR_PROD' AND detalle LIKE $1", [`%ID ${id} %`]);
        
        // Guardar nuevo log de restauración con usuario real
        await pool.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'REACTIVAR_PROD', $2)", [usuarioId, `Producto ID ${id} restaurado`]);
        
        res.json({ mensaje: 'Producto restaurado correctamente.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const eliminarFisico = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.user ? req.user.id : null; // 🔥 Capturamos al usuario
    
    try {
        // Intentamos borrar de raíz
        await pool.query('DELETE FROM productos WHERE id = $1', [id]);
        
        // 🔥 TRUCO MÁGICO: Borramos el registro viejo que tenía los botones para limpiar la pantalla
        await pool.query("DELETE FROM auditoria WHERE accion = 'ELIMINAR_PROD' AND detalle LIKE $1", [`%ID ${id} %`]);

        // Guardamos el log final de la purga con su usuario
        await pool.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'BORRADO_TOTAL', $2)", [usuarioId, `Producto ID ${id} purgado de la BD`]);
        
        res.json({ mensaje: 'Producto eliminado definitivamente de la base de datos.' });
    } catch (error) {
        if (error.code === '23503') {
            return res.status(400).json({ error: 'No se puede eliminar: El producto tiene historial de ventas o compras. Solo se puede mantener desactivado.' });
        }
        res.status(500).json({ error: error.message });
    }
};

//
const updateProducto = async (req, res) => {
    const { id } = req.params;
    const { codigo, nombre, marca, categoria, stock, stock_minimo, costo, precio_venta, ubicacion, tamano, u_caja, peso } = req.body; 
    
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        // 1. Obtener stock anterior
        const oldRes = await client.query('SELECT stock_unidades FROM productos WHERE id = $1', [id]);
        if (oldRes.rows.length === 0) throw new Error('Producto no encontrado');
        
        const oldStock = parseFloat(oldRes.rows[0].stock_unidades || 0);
        const newStock = parseFloat(stock);
        const diff = isNaN(newStock) ? 0 : newStock - oldStock;

        // 2. Actualización del Producto
        const result = await client.query(`
            UPDATE productos SET 
                codigo = COALESCE($1, codigo),
                nombre = COALESCE($2, nombre),
                marca = COALESCE($3, marca),
                categoria = COALESCE($4, categoria),
                stock_unidades = COALESCE($5, stock_unidades),
                stock_minimo = COALESCE($6, stock_minimo),
                costo = COALESCE($7, costo),
                precio_venta = COALESCE($8, precio_venta),
                ubicacion = COALESCE($9, ubicacion),
                tamano = COALESCE($10, tamano),
                u_caja = COALESCE($11, u_caja),
                peso_unitario_kg = COALESCE($12, peso_unitario_kg)
            WHERE id = $13 
            RETURNING *`,
            [
                codigo, nombre, marca, categoria, 
                isNaN(newStock) ? null : newStock,
                stock_minimo, costo, precio_venta, ubicacion, tamano, u_caja, peso, id
            ]
        );
        
        const prod = result.rows[0];

        // --- 3. GESTIÓN DE LOTES (CORREGIDO: AGREGADO cantidad_inicial) ---
        if (diff > 0) {
            const esFrasco = ['Frasco', 'Envases', 'Frascos', 'Envase'].includes(prod.categoria) || prod.nombre.toUpperCase().includes('FRASCO');

            if (esFrasco) {
                // EXCEPCIÓN FRASCOS: Lote Nuevo Automático
                await client.query(
                    "INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario) VALUES ($1, $2, $3, $3, NOW() + interval '5 years', $4)",
                    [id, `AUTO-${Date.now()}`, diff, prod.costo || 0]
                );
            } else {
                // NORMAL: Sumar a existente o crear nuevo
                const existeLote = await client.query("SELECT id FROM lotes WHERE producto_id = $1 AND cantidad_actual > 0 LIMIT 1", [id]);
                
                if (existeLote.rows.length > 0) {
                    await client.query("UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id = $2", [diff, existeLote.rows[0].id]);
                } else {
                    // Lote Genérico
                    await client.query(
                        "INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario) VALUES ($1, $2, $3, $3, NOW() + interval '1 year', $4)",
                        [id, 'STOCK-RAPIDO', diff, prod.costo || 0]
                    );
                }
            }
        }

        await client.query('COMMIT');
        res.json(prod);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error updateProducto:", error);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};


// 4. ELIMINAR (Igual que antes)
const deleteProducto = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.user ? req.user.id : null; // 🔥 1. Capturamos al usuario real
    
    try {
        const result = await pool.query('UPDATE productos SET activo = false WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
        
        // 🔥 2. Insertamos la acción junto con el ID del usuario
        await pool.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'ELIMINAR_PROD', $2)", [usuarioId, `Producto ID ${id} desactivado`]);
        res.json({ mensaje: 'Producto archivado' });
    } catch (error) {
        res.status(500).json({ error: 'Error eliminando' });
    }
};


const importarMasivo = async (req, res) => {
    // NUEVO: Ahora esperamos 'nombre_archivo' desde el frontend
    const { productos, nombre_archivo } = req.body; 
    const usuarioId = req.user ? req.user.id : null;
    const client = await pool.connect();
    
    let insertados = 0; let actualizados = 0; let errores = 0; let detallesError = [];
    let logReversion = []; // Memoria fotográfica de los cambios para la reversión

    try {
        await client.query('BEGIN');
        
        for (const p of productos) {
            if (!p.codigo || !p.nombre) { errores++; continue; }
            try {
                const codigo = p.codigo.toString().trim();
                const nombre = p.nombre.toString().trim();
                const stockAñadido = parseFloat(p.stock) || 0;
                
                // Mapeo del nuevo formato
                const marca = p.marca || 'Genérico';
                const descripcion = p.descripcion || 'Carga Masiva Excel';
                const categoria = p.categoria || 'General';
                const costo = parseFloat(p.costo) || 0;
                const precio_venta = parseFloat(p.precio_venta) || 0;
                const stock_minimo = parseFloat(p.stock_minimo) || 5;
                const unidad_medida = p.unidad_medida || 'UNIDAD';
                const contenido_gramos = parseFloat(p.contenido_gramos) || 0;

                // NUEVO: Lógica para capturar y vincular el proveedor desde la celda del Excel
                const proveedorTexto = p.proveedor ? p.proveedor.toString().trim() : '';
                let proveedorId = null;
                
                if (proveedorTexto !== '') {
                    // Buscamos si existe un proveedor en la BD que coincida con el texto
                    const provRes = await client.query('SELECT id FROM proveedores WHERE empresa ILIKE $1 LIMIT 1', [`%${proveedorTexto}%`]);
                    if (provRes.rows.length > 0) {
                        proveedorId = provRes.rows[0].id;
                    }
                }

                let productoId;
                let esNuevo = false;

                const checkRes = await client.query('SELECT id FROM productos WHERE codigo = $1', [codigo]);
                if (checkRes.rows.length > 0) {
                    // SI EXISTE: Actualiza
                    productoId = checkRes.rows[0].id;
                    await client.query(`
                        UPDATE productos 
                        SET stock_unidades = stock_unidades + $1,
                            descripcion = $2
                        WHERE id = $3
                    `, [stockAñadido, descripcion, productoId]);
                    actualizados++;
                } else {
                    // SI ES NUEVO: Crea el producto
                    esNuevo = true;
                    const insertQuery = `
                        INSERT INTO productos 
                        (codigo, nombre, marca, categoria, stock_unidades, stock_minimo, costo, precio_venta,
                         ubicacion, u_caja, ganancia, descripcion, unidad_medida, activo, contenido_gramos,
                         tamano, stock_estante, peso_unitario_kg)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ALMACEN', 1, 30, $9, $10, true, $11, 'N/A', 0, 0)
                        RETURNING id`;
                    const resInsert = await client.query(insertQuery, [
                        codigo, nombre, marca, categoria, stockAñadido, stock_minimo, costo, precio_venta,
                        descripcion, unidad_medida, contenido_gramos
                    ]);
                    productoId = resInsert.rows[0].id;
                    insertados++;
                }

                let loteIdCreado = null;
                // LOTES MAESTROS EN ALMACÉN
                if (stockAñadido > 0) {
                    const loteAleatorio = `LOTE-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 100)}`;
                    const fechaVencimiento = new Date();
                    fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 2);
                    
                    // NUEVO: Guardamos el proveedor_id directamente en el lote
                    const loteRes = await client.query(`
                        INSERT INTO lotes 
                        (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, proveedor_id) 
                        VALUES ($1, $2, $3, $3, $4, $5, $6) RETURNING id
                    `, [productoId, loteAleatorio, stockAñadido, fechaVencimiento, costo, proveedorId]);
                    
                    loteIdCreado = loteRes.rows[0].id;

                    await client.query(`
                        INSERT INTO historial_movimientos 
                        (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
                        VALUES ($1, 'ENTRADA', $2, (SELECT stock_unidades FROM productos WHERE id=$1), 'Ingreso Auto-Excel a Almacén', NOW())
                    `, [productoId, stockAñadido]);
                }

                // Guardamos el rastro individual para el sistema de reversión
                logReversion.push({
                    producto_id: productoId,
                    es_nuevo: esNuevo,
                    stock_agregado: stockAñadido,
                    lote_id: loteIdCreado
                });

            } catch (err) {
                errores++;
                detallesError.push(`Fila ${p.codigo}: ${err.message}`);
            }
        }

        // GUARDADO DEL REGISTRO DE IMPORTACIÓN EN LA BÓVEDA
        if (logReversion.length > 0) {
            await client.query(`
                INSERT INTO importaciones_excel (usuario_id, nombre_archivo, detalles_json, estado)
                VALUES ($1, $2, $3, 'APLICADO')
            `, [usuarioId, nombre_archivo || `Carga_${new Date().toISOString().slice(0,10)}`, JSON.stringify(logReversion)]);
        }

        if (usuarioId && (insertados > 0 || actualizados > 0)) {
            await client.query(
                "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'IMPORT_MASIVA', $2, NOW())",
                [usuarioId, `Excel procesado: ${insertados} nuevos, ${actualizados} sumados.`]
            );
        }
        
        await client.query('COMMIT');
        res.json({
            mensaje: 'Completado: Stock y Lotes cargados directamente al Almacén.',
            resumen: { insertados, actualizados, errores, detalles: detallesError }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error Importacion:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// 2. NUEVO: VER HISTORIAL DE CARGAS EXCEL
const getHistorialImportaciones = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, u.nombre as usuario_nombre
            FROM importaciones_excel i
            LEFT JOIN usuarios u ON i.usuario_id = u.id
            ORDER BY i.fecha DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 3. NUEVO: FUNCIÓN PARA REVERTIR (BOTÓN DE PÁNICO)
const revertirImportacion = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.user ? req.user.id : null;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Buscar el archivo original
        const impRes = await client.query('SELECT * FROM importaciones_excel WHERE id = $1 FOR UPDATE', [id]);
        if (impRes.rows.length === 0) throw new Error('Registro de importación no encontrado.');

        const importacion = impRes.rows[0];
        if (importacion.estado === 'REVERTIDO') throw new Error('Esta importación ya fue revertida previamente.');

        const detalles = typeof importacion.detalles_json === 'string' 
            ? JSON.parse(importacion.detalles_json) 
            : importacion.detalles_json;

        // Deshacemos todo paso por paso
        for (const item of detalles) {
            // A. Restar el stock agregado exactamente
            if (item.stock_agregado > 0) {
                // GREATEST asegura que no queden números negativos si ya vendieron parte del stock
                await client.query(
                    'UPDATE productos SET stock_unidades = GREATEST(stock_unidades - $1, 0) WHERE id = $2',
                    [item.stock_agregado, item.producto_id]
                );

                await client.query(`
                    INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
                    VALUES ($1, 'SALIDA', $2, (SELECT stock_unidades FROM productos WHERE id=$1), 'Reversión de Carga Excel', NOW())
                `, [item.producto_id, item.stock_agregado]);
            }

            // B. Anular y vaciar el lote que se creó
            if (item.lote_id) {
                await client.query('UPDATE lotes SET cantidad_actual = 0 WHERE id = $1', [item.lote_id]);
            }

            // C. Si el producto se creó desde cero en este excel, lo desactivamos para limpiar el catálogo
            if (item.es_nuevo) {
                await client.query('UPDATE productos SET activo = false WHERE id = $1', [item.producto_id]);
            }
        }

        // Marcar archivo como revertido
        await client.query("UPDATE importaciones_excel SET estado = 'REVERTIDO' WHERE id = $1", [id]);

        if (usuarioId) {
            await client.query(
                "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'REVERTIR_EXCEL', $2, NOW())",
                [usuarioId, `Revirtió la carga del archivo: ${importacion.nombre_archivo}`]
            );
        }

        await client.query('COMMIT');
        res.json({ mensaje: '¡Operación Exitosa! El Excel ha sido revertido y el inventario descontado.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en reversión:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const getKardex = async (req, res) => {
    const { id } = req.params;
    try {
        // Unimos el historial de movimientos normal con las ventas del mostrador en tiempo real
        const query = `
            SELECT fecha, tipo_movimiento, cantidad, stock_nuevo, motivo
            FROM (
                SELECT fecha, tipo_movimiento, cantidad, stock_nuevo, motivo 
                FROM historial_movimientos 
                WHERE producto_id = $1
                
                UNION ALL
                
                SELECT v.fecha, 'VENTA' as tipo_movimiento, d.cantidad, 0 as stock_nuevo, 
                'Factura/Ticket #' || v.id || ' - ' || COALESCE(d.descripcion, '') as motivo
                FROM detalle_ventas d
                JOIN ventas v ON d.venta_id = v.id
                WHERE d.producto_id = $1
            ) as movimientos_combinados
            ORDER BY fecha DESC
            LIMIT 100
        `;
        const response = await pool.query(query, [id]);
        res.json(response.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getLotesProducto = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT id, codigo_lote, cantidad_actual, fecha_vencimiento 
            FROM lotes 
            WHERE producto_id = $1 AND cantidad_actual > 0
            ORDER BY fecha_vencimiento ASC
        `, [id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// MODIFICACIÓN: Lógica de separación de lotes (Gramos/Unidades individuales)
const reponerEstante = async (req, res) => {
    const { id } = req.params;
    const { cantidad, ubicacion } = req.body; 
    
    const valorMover = parseFloat(cantidad);
    const filaDefault = 1; 

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!valorMover || valorMover <= 0) throw new Error("La cantidad a mover debe ser mayor a 0.");

        const prodRes = await client.query('SELECT * FROM productos WHERE id = $1 FOR UPDATE', [id]);
        const producto = prodRes.rows[0];
        
        if (!producto) throw new Error('Producto no encontrado');

        if (parseFloat(producto.stock_unidades) < valorMover) {
             throw new Error(`Stock insuficiente en Almacén. Tienes ${parseFloat(producto.stock_unidades).toFixed(2)}, intentas mover ${valorMover}.`);
        }

        // Actualizar Almacén y contador de Estante
        const resultUpdate = await client.query(`
            UPDATE productos 
            SET stock_unidades = stock_unidades - $1, 
                stock_estante = stock_estante + $1 
            WHERE id = $2
            RETURNING stock_unidades, stock_minimo, nombre`, 
            [valorMover, id]
        );

        const prodActualizado = resultUpdate.rows[0];

        // --- NOTIFICACIÓN DE STOCK CRÍTICO EN ALMACÉN ---
        if (parseFloat(prodActualizado.stock_unidades) <= parseFloat(prodActualizado.stock_minimo)) {
            await crearNotificacionInterna(
                `INVENTARIO: Stock crítico en almacén para ${prodActualizado.nombre}. Quedan: ${parseFloat(prodActualizado.stock_unidades).toFixed(2)}`,
                'PELIGRO',
                '/inventario'
            );
        }

        // Insertar en Estante (Lote individual)
        await client.query(`
            INSERT INTO botellas_estante 
            (producto_id, ubicacion, fila, cantidad, estado, porcentaje_actual)
            VALUES ($1, $2, $3, $4, 'ABIERTA', 100)
        `, [id, ubicacion, filaDefault, valorMover]);

        // Historial
        const unidadTexto = ['Alcohol', 'Esencias', 'Fijador'].includes(producto.categoria) ? 'g' : 'unid';
        await client.query(`
            INSERT INTO historial_movimientos 
            (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
            VALUES ($1, 'TRASLADO', $2, $3, 'Ingreso a ' || $4 || ' (' || $2 || $5 || ')', NOW())
        `, [id, valorMover, prodActualizado.stock_unidades, ubicacion, unidadTexto]);

        await client.query('COMMIT');
        res.json({ mensaje: `Se agregaron ${valorMover}${unidadTexto} al ${ubicacion}.` });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const abrirBotellaGrupo = async (req, res) => {
    const { grupoId } = req.params; 
    const { cantidadAbrir } = req.body; // <--- Ahora recibimos cuánto abrir
    const cantidad = parseInt(cantidadAbrir) || 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Buscar grupo
        const grupoRes = await client.query('SELECT * FROM botellas_estante WHERE id = $1 FOR UPDATE', [grupoId]);
        const grupo = grupoRes.rows[0];

        if (!grupo) throw new Error('Grupo no encontrado');
        if (grupo.cantidad < cantidad) throw new Error(`Solo hay ${grupo.cantidad} unidades en esta caja.`);

        // 2. Restar cajas
        if (grupo.cantidad === cantidad) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [grupoId]);
        } else {
            await client.query('UPDATE botellas_estante SET cantidad = cantidad - $1 WHERE id = $2', [cantidad, grupoId]);
        }

        // 3. Crear botellas ABIERTAS (Llenas al 100%)
        // Si abres 5 frascos, creamos 5 registros o 1 registro con cantidad 5? 
        // Para visualización mejor creamos 1 registro que representa esas botellas abiertas en esa fila.
        
        // Verificamos si ya hay abiertas en esa fila para sumar
        const abiertaExistente = await client.query(
            "SELECT id FROM botellas_estante WHERE producto_id=$1 AND ubicacion=$2 AND fila=$3 AND estado='ABIERTA'",
            [grupo.producto_id, grupo.ubicacion, grupo.fila]
        );

        if (abiertaExistente.rows.length > 0) {
             // Si ya hay una botella abierta ahí, solo "reseteamos" el nivel visual o sumamos stock visual?
             // Simplificación: Insertamos nuevas botellas abiertas independientes para que se vean
             for(let i=0; i<cantidad; i++) {
                await client.query(`
                    INSERT INTO botellas_estante (producto_id, ubicacion, fila, cantidad, estado, porcentaje_actual)
                    VALUES ($1, $2, $3, 1, 'ABIERTA', 100)
                `, [grupo.producto_id, grupo.ubicacion, grupo.fila]);
             }
        } else {
             for(let i=0; i<cantidad; i++) {
                await client.query(`
                    INSERT INTO botellas_estante (producto_id, ubicacion, fila, cantidad, estado, porcentaje_actual)
                    VALUES ($1, $2, $3, 1, 'ABIERTA', 100)
                `, [grupo.producto_id, grupo.ubicacion, grupo.fila]);
             }
        }

        await client.query('COMMIT');
        res.json({ mensaje: `Se abrieron ${cantidad} unidades.` });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const getUbicacionSugerida = async (req, res) => {
    const { id } = req.params;
    try {
        // Busca dónde se guardó este producto la última vez
        const result = await pool.query(`
            SELECT ubicacion, fila FROM botellas_estante 
            WHERE producto_id = $1 
            ORDER BY id DESC LIMIT 1
        `, [id]);

        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({ ubicacion: 'A', fila: 1 }); // Default
        }
    } catch (error) {
        res.json({ ubicacion: 'A', fila: 1 });
    }
};

const getProductosEstante = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20; // Tu límite solicitado
        const offset = (page - 1) * limit;

        // 1. Obtener total para la paginación
        const countRes = await pool.query(`
            SELECT COUNT(*) FROM botellas_estante b 
            JOIN productos p ON b.producto_id = p.id 
            WHERE (b.cantidad > 0 OR b.porcentaje_actual > 0) AND p.activo = true
        `);
        const total = parseInt(countRes.rows[0].count);

        // 2. Obtener datos con LIMIT y OFFSET
        const query = `
            SELECT b.*, p.nombre, p.marca, p.activo, p.contenido_gramos, p.unidad_medida, p.categoria
            FROM botellas_estante b
            JOIN productos p ON b.producto_id = p.id
            WHERE (b.cantidad > 0 OR b.porcentaje_actual > 0)
            AND p.activo = true 
            ORDER BY b.ubicacion ASC, p.nombre ASC, b.id DESC
            LIMIT $1 OFFSET $2
        `;
        const response = await pool.query(query, [limit, offset]);

        res.json({
            data: response.rows,
            pagination: { total, totalPages: Math.ceil(total / limit), currentPage: page }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error cargando estante' });
    }
};

const organizarBotella = async (req, res) => {
    const { botellaId } = req.params;
    let { destino, fila } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const botellaRes = await client.query('SELECT * FROM botellas_estante WHERE id = $1 FOR UPDATE', [botellaId]);
        const botellaMoviendo = botellaRes.rows[0];
        
        if (!botellaMoviendo) throw new Error('Producto no encontrado');

        // Buscamos si ya existe el mismo producto en el destino para UNIRLOS
        const existeMismoProducto = await client.query(`
            SELECT id FROM botellas_estante 
            WHERE ubicacion = $1 AND fila = $2 
              AND producto_id = $3 AND estado = 'ABIERTA'
            FOR UPDATE 
        `, [destino, fila, botellaMoviendo.producto_id]);

       if (existeMismoProducto.rows.length > 0) {
            // UNIÓN: Sumamos cantidades y borramos la vieja
            await client.query(`UPDATE botellas_estante SET cantidad = cantidad + $1 WHERE id = $2`, 
                [botellaMoviendo.cantidad, existeMismoProducto.rows[0].id]);
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [botellaId]);
        } else {
            // MOVIMIENTO: Detectamos si es Tester o Normal para no quitarle la etiqueta
            const estadoFinal = botellaMoviendo.estado === 'TESTER' ? 'TESTER' : 'ABIERTA';

            await client.query(
                `UPDATE botellas_estante SET ubicacion = $1, fila = $2, estado = $3 WHERE id = $4`, 
                [destino, fila, estadoFinal, botellaId]
            );
        } await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

/* */
const actualizarNivelBotella = async (req, res) => {
    const { botellaId } = req.params;
    const { nuevoNivel } = req.body; 

    try {
        const cant = parseFloat(nuevoNivel);

        // Obtener datos de la botella antes de procesar
        const botellaRes = await pool.query(`
            SELECT b.*, p.nombre, p.contenido_gramos 
            FROM botellas_estante b 
            JOIN productos p ON b.producto_id = p.id 
            WHERE b.id = $1`, [botellaId]);
        
        if (botellaRes.rows.length === 0) return res.status(404).json({ error: 'Botella no encontrada' });
        const botella = botellaRes.rows[0];

        if (cant <= 0) {
            // --- NOTIFICACIÓN: BOTELLA VACÍA EN ESTANTE ---
            await crearNotificacionInterna(`ESTANTE: La botella de ${botella.nombre} se ha agotado.`, 'ALERTA', '/estante');
            
            await pool.query('DELETE FROM botellas_estante WHERE id = $1', [botellaId]);
            return res.json({ mensaje: 'Botella retirada por estar vacía.' });
        }

        const capacidad = parseFloat(botella.contenido_gramos) || 1000;
        const porcentaje = Math.round((cant / capacidad) * 100);

        // --- NOTIFICACIÓN: NIVEL BAJO EN ESTANTE (MENOS DEL 15%) ---
        if (porcentaje < 15) {
            await crearNotificacionInterna(
                `ESTANTE: Nivel bajo (${porcentaje}%) en la botella de ${botella.nombre}`,
                'INFO',
                '/estante'
            );
        }

        await pool.query(`
            UPDATE botellas_estante 
            SET cantidad = $1, porcentaje_actual = $2 
            WHERE id = $3
        `, [cant, porcentaje, botellaId]);

        res.json({ mensaje: 'Stock de botella actualizado correctamente.', porcentaje });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const reportarMerma = async (req, res) => {
    const { id } = req.params;
    const { cantidad, motivo, observaciones, ubicacion } = req.body; 

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Validar Producto
        const prodRes = await client.query('SELECT * FROM productos WHERE id = $1 FOR UPDATE', [id]);
        if (prodRes.rows.length === 0) throw new Error('Producto no encontrado');
        const producto = prodRes.rows[0];

        const cant = parseInt(cantidad);
        if (cant <= 0) throw new Error('La cantidad debe ser mayor a 0');

        // 2. Descontar Stock
        if (ubicacion === 'ESTANTE') {
            if (parseFloat(producto.stock_estante) < cant) throw new Error(`Stock insuficiente en Estante.`);
            await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2', [cant, id]);
        } else {
            // Descontar de Almacén (Lotes)
            const lotesRes = await client.query(`
                SELECT id, cantidad_actual FROM lotes 
                WHERE producto_id = $1 AND cantidad_actual > 0 
                ORDER BY fecha_vencimiento ASC FOR UPDATE
            `, [id]);

            let pendiente = cant;
            for (const lote of lotesRes.rows) {
                if (pendiente <= 0) break;
                const disponible = parseFloat(lote.cantidad_actual);
                const aRestar = Math.min(pendiente, disponible);
                await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [aRestar, lote.id]);
                pendiente -= aRestar;
            }
            await client.query('UPDATE productos SET stock_unidades = stock_unidades - $1 WHERE id = $2', [cant, id]);
        }

        // 3. Registrar Historial (SIN usuario_id)
        const descripcion = `MERMA (${motivo}): ${observaciones || ''}`;
        await client.query(`
            INSERT INTO historial_movimientos 
            (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
            VALUES ($1, 'SALIDA', $2, (SELECT stock_unidades FROM productos WHERE id=$1), $3, NOW())
        `, [id, cant, descripcion]);

        await client.query('COMMIT');
        res.json({ mensaje: 'Merma registrada correctamente.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en reportarMerma:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};


const crearTester = async (req, res) => {
    const { idProducto } = req.params; // ID de la esencia base
    // Capturamos es_muestra y nota que envía tu frontend
    const { formula_id, es_muestra, nota } = req.body; 
    
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Obtener datos de Fórmula y Esencia
        const formulaRes = await client.query('SELECT * FROM formulas WHERE id = $1', [formula_id]);
        if (formulaRes.rows.length === 0) throw new Error('Fórmula no encontrada');
        const formula = formulaRes.rows[0];

        const esenciaRes = await client.query('SELECT * FROM productos WHERE id = $1', [idProducto]);
        if (esenciaRes.rows.length === 0) throw new Error('Producto (esencia) no encontrado');
        const esencia = esenciaRes.rows[0];

        // Cantidades a descontar
        const cantEsencia = parseFloat(formula.gramos_esencia);
        const cantAlcohol = Math.round(parseFloat(formula.ml_alcohol));
        const cantFijador = parseFloat(formula.gramos_fijador);
        const volumenTester = parseInt(formula.volumen_total);

        // --- HELPER MEJORADO: Busca Botella ABIERTA específica y descuenta ---
        // Esto soluciona que el stock no baje realmente.
        const descontarDeBotellaAbierta = async (criterio, cantidad, nombreRef, esBusquedaPorId = false) => {
            if (cantidad <= 0) return;

            let query = '';
            let params = [];

            if (esBusquedaPorId) {
                // Buscar por ID exacto (Para la Esencia)
                query = `
                    SELECT b.id, b.cantidad, b.producto_id, p.contenido_gramos 
                    FROM botellas_estante b
                    JOIN productos p ON b.producto_id = p.id
                    WHERE b.producto_id = $1 
                    AND (b.estado = 'ABIERTA' OR b.estado = 'TESTER') 
                    AND b.cantidad >= $2
                    ORDER BY b.cantidad ASC 
                    LIMIT 1 FOR UPDATE`;
                params = [criterio, cantidad];
            } else {
                // Buscar por Texto (Alcohol, Fijador)
                query = `
                    SELECT b.id, b.cantidad, b.producto_id, p.contenido_gramos 
                    FROM botellas_estante b
                    JOIN productos p ON b.producto_id = p.id
                    WHERE (p.categoria ILIKE $1 OR p.nombre ILIKE $1) 
                    AND (b.estado = 'ABIERTA' OR b.estado = 'TESTER') 
                    AND b.cantidad >= $2
                    ORDER BY b.cantidad ASC 
                    LIMIT 1 FOR UPDATE`;
                params = [`%${criterio}%`, cantidad];
            }

            const res = await client.query(query, params);

            if (res.rows.length === 0) {
                 throw new Error(`No hay una botella ABIERTA de '${nombreRef}' con suficiente contenido (Req: ${cantidad}). Abre una caja nueva primero.`);
            }

            const botella = res.rows[0];
            const nuevaCant = parseFloat(botella.cantidad) - parseFloat(cantidad);
            
            // Calculamos nuevo porcentaje visual
            const capacidad = parseFloat(botella.contenido_gramos) || 1000;
            const nuevoPorc = Math.round((nuevaCant / capacidad) * 100);

            // 1. Actualizar la botella específica (FÍSICO)
            await client.query(
                'UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3', 
                [nuevaCant, nuevoPorc, botella.id]
            );

            // 2. Actualizar el contador Global (CONTABLE) para que cuadren los números
            await client.query(
                'UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2', 
                [cantidad, botella.producto_id]
            );

            // 3. Registrar Historial
            const motivoLog = es_muestra 
                ? `Muestra Cliente: ${esencia.nombre} (${nota || ''})` 
                : `Prep. Tester: ${esencia.nombre}`;

            await client.query(`
                INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
                VALUES ($1, 'CONSUMO_INT', $2, (SELECT stock_estante FROM productos WHERE id=$1), $3, NOW())
            `, [botella.producto_id, cantidad, motivoLog]);
        };

        // --- HELPER: Descontar Envase (Stock seco, no líquido) ---
        const descontarEnvase = async () => {
            // 1. Intentar buscar en ESTANTE primero
            const resEstante = await client.query(`
                SELECT b.id, b.cantidad, b.producto_id 
                FROM botellas_estante b
                JOIN productos p ON b.producto_id = p.id
                WHERE (p.categoria IN ('Envases', 'Frascos') OR p.nombre ILIKE '%Envase%' OR p.nombre ILIKE '%Frasco%')
                AND (p.contenido_gramos = $1 OR p.nombre ILIKE $2)
                AND b.cantidad >= 1
                LIMIT 1 FOR UPDATE
            `, [volumenTester, `%${volumenTester}%`]);

            if (resEstante.rows.length > 0) {
                // ¡ENCONTRADO EN PANTALLA!
                const botella = resEstante.rows[0];
                
                // A. Restar de la cajita visual (botellas_estante)
                if (parseFloat(botella.cantidad) <= 1) {
                    await client.query('DELETE FROM botellas_estante WHERE id = $1', [botella.id]);
                } else {
                    await client.query('UPDATE botellas_estante SET cantidad = cantidad - 1 WHERE id = $1', [botella.id]);
                }

                // B. Sincronizar el contable global (productos)
                await client.query('UPDATE productos SET stock_estante = stock_estante - 1 WHERE id = $1', [botella.producto_id]);
                
                // C. Log
                await client.query(`
                    INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
                    VALUES ($1, 'CONSUMO_INT', 1, (SELECT stock_estante FROM productos WHERE id=$1), $2, NOW())
                `, [botella.producto_id, es_muestra ? 'Envase Muestra (Estante)' : 'Envase Tester (Estante)']);

                return; // Trabajo terminado, salimos.
            }

            // 2. SI NO ESTÁ EN PANTALLA, BUSCAR EN ALMACÉN (stock_unidades)
            const resAlmacen = await client.query(`
                SELECT id, stock_unidades 
                FROM productos 
                WHERE (categoria IN ('Envases', 'Frascos') OR nombre ILIKE '%Envase%' OR nombre ILIKE '%Frasco%')
                AND (contenido_gramos = $1 OR nombre ILIKE $2)
                AND stock_unidades >= 1
                AND activo = true
                LIMIT 1 FOR UPDATE
            `, [volumenTester, `%${volumenTester}%`]);

            if (resAlmacen.rows.length > 0) {
                const prod = resAlmacen.rows[0];
                // Restamos solo del almacén
                await client.query('UPDATE productos SET stock_unidades = stock_unidades - 1 WHERE id = $1', [prod.id]);
                
                await client.query(`
                    INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
                    VALUES ($1, 'CONSUMO_INT', 1, (SELECT stock_unidades FROM productos WHERE id=$1), $2, NOW())
                `, [prod.id, es_muestra ? 'Envase Muestra (Almacén)' : 'Envase Tester (Almacén)']);
                
                return;
            }

            throw new Error(`No hay envases de ${volumenTester}ml disponibles (ni en Estante ni en Almacén).`);
        };
        // 2. EJECUTAR DESCUENTOS REALES
        
        // A. Esencia (Usamos ID directo)
        await descontarDeBotellaAbierta(idProducto, cantEsencia, esencia.nombre, true);
        
        // B. Alcohol (Buscamos botella abierta de alcohol)
        await descontarDeBotellaAbierta('Alcohol', cantAlcohol, 'Alcohol', false);
        
        // C. Fijador (Buscamos botella abierta de fijador)
        await descontarDeBotellaAbierta('Fijador', cantFijador, 'Fijador', false);
        
        // D. Envase
        await descontarEnvase();


        // 3. FINALIZAR SEGÚN TIPO
        if (es_muestra) {
            // SI ES MUESTRA: NO creamos botella en estante. 
            // El cliente se la lleva, así que solo consumimos insumos y listo.
            await client.query('COMMIT');
            res.json({ mensaje: `Muestra de ${volumenTester}ml registrada y descontada correctamente.` });

        } else {
            // SI ES TESTER: Creamos la botella física en la tienda (Fila 7)
            await client.query(`
                INSERT INTO botellas_estante 
                (producto_id, ubicacion, fila, cantidad, estado, porcentaje_actual)
                VALUES ($1, 'A', 7, $2, 'TESTER', 100)
            `, [idProducto, volumenTester]); 
    
            await client.query('COMMIT');
            res.json({ mensaje: `Tester creado exitosamente en la fila 7.` });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error crearTester:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// REEMPLAZAR ESTA FUNCIÓN COMPLETA
const reponerTester = async (req, res) => {
    const { idBotella } = req.params; // ID del Tester (Destino)
    const { idOrigen } = req.body;    // ID de la botella en "Sin Organizar" (Origen)
    
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Validar Tester (Destino)
        const destRes = await client.query('SELECT * FROM botellas_estante WHERE id = $1', [idBotella]);
        if (destRes.rows.length === 0) throw new Error('Tester no encontrado');
        const tester = destRes.rows[0];

        // 2. Validar Origen (Botella en Pendientes)
        const orgRes = await client.query('SELECT * FROM botellas_estante WHERE id = $1', [idOrigen]);
        if (orgRes.rows.length === 0) throw new Error('Botella de origen no encontrada');
        const origen = orgRes.rows[0];

        // Verificar compatibilidad
        if (origen.producto_id !== tester.producto_id) throw new Error('El producto de origen no coincide con el tester.');

        // 3. Calcular cuánto reponer
        // Intentamos llenar 30ml, o lo que le quede a la botella de origen si es menos.
        const cantidadDeseada = 30; 
        const cantidadDisponible = parseFloat(origen.cantidad);
        const cantidadMover = Math.min(cantidadDeseada, cantidadDisponible);

        if (cantidadMover <= 0) throw new Error('La botella de origen está vacía.');

        // 4. RESTAR DEL ORIGEN (Sin Organizar)
        if (cantidadMover === cantidadDisponible) {
            // Se vació la botella origen, la borramos
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [idOrigen]);
        } else {
            await client.query('UPDATE botellas_estante SET cantidad = cantidad - $1 WHERE id = $2', [cantidadMover, idOrigen]);
        }

        // 5. RESTAR DEL STOCK GLOBAL (Porque pasa de "Venta" a "Gasto/Tester")
        // Como el líquido sale de una botella vendible y entra a un tester (gasto), se descuenta del inventario valorizado.
        await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2', [cantidadMover, tester.producto_id]);

        // 6. SUMAR AL TESTER
        // Asumimos que el tester se llena al 100% visualmente con esta recarga
        await client.query('UPDATE botellas_estante SET cantidad = cantidad + $1, porcentaje_actual = 100 WHERE id = $2', [cantidadMover, idBotella]);

        // 7. Historial
        await client.query(`
            INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, motivo, fecha) 
            VALUES ($1, 'SALIDA', $2, 'REPOSICION TESTER DESDE PENDIENTES', NOW())
        `, [tester.producto_id, cantidadMover]);

        await client.query('COMMIT');
        res.json({ mensaje: `Se recargaron ${cantidadMover}ml al tester.` });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally { client.release(); }
};


const eliminarBotella = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM botellas_estante WHERE id = $1', [id]);
        res.json({ mensaje: 'Botella eliminada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const moverStockEstante = async (req, res) => {
    const { productoId, cantidad } = req.body; 
    const cantidadMover = parseFloat(cantidad);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Validar Producto y Stock Global
        const prodRes = await client.query('SELECT * FROM productos WHERE id = $1 FOR UPDATE', [productoId]);
        if (prodRes.rows.length === 0) throw new Error('Producto no encontrado');
        const producto = prodRes.rows[0];

        if (parseFloat(producto.stock_unidades) < cantidadMover) {
             throw new Error(`Stock insuficiente en Almacén. Tienes ${parseFloat(producto.stock_unidades)}, intentas bajar ${cantidadMover}.`);
        }

        // 2. DESCONTAR DE LOS LOTES (FIFO: Primero vence, primero sale) - [NUEVO]
        // Esto soluciona que el lote se "regenere" o quede lleno.
        const lotesRes = await client.query(`
            SELECT id, cantidad_actual FROM lotes 
            WHERE producto_id = $1 AND cantidad_actual > 0 
            ORDER BY fecha_vencimiento ASC 
            FOR UPDATE
        `, [productoId]);

        let pendiente = cantidadMover;

        for (const lote of lotesRes.rows) {
            if (pendiente <= 0.001) break; 

            const disponible = parseFloat(lote.cantidad_actual);
            const aRestar = Math.min(pendiente, disponible);
            
            // Restamos del lote específico
            await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [aRestar, lote.id]);
            
            pendiente -= aRestar;
        }

        // Si después de recorrer lotes sigue habiendo pendiente, es porque los números globales no coincidían con los lotes
        // (Pero permitimos continuar para no trancar la operación, confiando en el stock global)

        // 3. Crear la caja en "PENDIENTE" (Estante)
        await client.query(`
            INSERT INTO botellas_estante 
            (producto_id, ubicacion, fila, estado, cantidad, porcentaje_actual)
            VALUES ($1, 'PENDIENTE', 0, 'CERRADA', $2, 100)
        `, [productoId, cantidadMover]); 

        // 4. Actualizar Stock Global (Contable)
        await client.query(
            'UPDATE productos SET stock_unidades = stock_unidades - $1, stock_estante = stock_estante + $1 WHERE id = $2', 
            [cantidadMover, productoId]
        );

        // 5. Historial
        await client.query(`
            INSERT INTO historial_movimientos 
            (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
            VALUES ($1, 'TRASLADO', $2, (SELECT stock_unidades FROM productos WHERE id=$1), 'Bajado a Recepción (Descargado de Lotes)', NOW())
        `, [productoId, cantidadMover]);

        await client.query('COMMIT');
        res.json({ mensaje: `Se bajaron ${cantidadMover} al área de pendientes y se descontaron de los lotes.` });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};

const distribuirProducto = async (req, res) => {
    const { idBotellaOrigen } = req.params;
    const { cantidadMover, destino, fila } = req.body; 

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Buscar lote origen
        const origenRes = await client.query('SELECT * FROM botellas_estante WHERE id = $1 FOR UPDATE', [idBotellaOrigen]);
        const origen = origenRes.rows[0];

        if (!origen) throw new Error('Lote no encontrado');
        
        // Validar cantidad
        const mover = parseFloat(cantidadMover);
        if (origen.cantidad < mover) throw new Error(`Solo tienes ${origen.cantidad} disponible en este lote.`);

        // 1. Restar del origen (o borrar si queda vacío)
        if (parseFloat(origen.cantidad) === mover) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [idBotellaOrigen]);
        } else {
            await client.query('UPDATE botellas_estante SET cantidad = cantidad - $1 WHERE id = $2', [mover, idBotellaOrigen]);
        }

        // 2. CREAR NUEVO EN DESTINO (Sin buscar si existe, para no unir)
        // Estado pasa a 'ABIERTA' automáticamente al colocar en estante
        await client.query(`
            INSERT INTO botellas_estante (producto_id, ubicacion, fila, estado, cantidad, porcentaje_actual)
            VALUES ($1, $2, $3, 'ABIERTA', $4, 100)
        `, [origen.producto_id, destino, fila, mover]);

        await client.query('COMMIT');
        res.json({ mensaje: 'Lote movido y separado correctamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally { client.release(); }
};

const exportarExcel = async (req, res) => {
    try {
        const { filtro } = req.query;
        const client = await pool.connect();
        
        // Creamos el Libro de Excel
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema Inventario';
        workbook.created = new Date();

        // ---------------------------------------------------------
        // HOJA 1: INVENTARIO GENERAL (Almacén)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'inventario') {
            const sheetInv = workbook.addWorksheet('Almacén General');
            const resInv = await client.query(`
                SELECT codigo, nombre, marca, categoria, stock_unidades, costo, precio_venta 
                FROM productos WHERE activo = true ORDER BY nombre ASC
            `);
            
            sheetInv.columns = [
                { header: 'CÓDIGO', key: 'codigo', width: 15 },
                { header: 'PRODUCTO', key: 'nombre', width: 35 },
                { header: 'MARCA', key: 'marca', width: 15 },
                { header: 'CATEGORÍA', key: 'categoria', width: 15 },
                { header: 'STOCK ALMACÉN', key: 'stock', width: 15 },
                { header: 'COSTO ($)', key: 'costo', width: 12 },
                { header: 'PRECIO ($)', key: 'precio', width: 12 },
                { header: 'VALOR TOTAL ($)', key: 'total', width: 15 },
            ];

            let granTotalInv = 0;
            resInv.rows.forEach(p => {
                const totalVal = parseFloat(p.stock_unidades) * parseFloat(p.precio_venta);
                granTotalInv += totalVal;
                sheetInv.addRow({
                    codigo: p.codigo, nombre: p.nombre, marca: p.marca, categoria: p.categoria,
                    stock: parseFloat(p.stock_unidades), costo: parseFloat(p.costo), precio: parseFloat(p.precio_venta),
                    total: totalVal
                });
            });
            // Fila de Total
            const rowTotal = sheetInv.addRow(['', '', '', '', '', '', 'TOTAL VALOR:', granTotalInv]);
            rowTotal.font = { bold: true };
            sheetInv.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheetInv.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
        }

        // ---------------------------------------------------------
        // HOJA 2: ESTANTE (Tienda / Botellas Abiertas)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'estante') {
            const sheetEst = workbook.addWorksheet('Estante (Tienda)');
            const resEst = await client.query(`
                SELECT b.ubicacion, b.fila, p.nombre, b.cantidad, p.unidad_medida, b.porcentaje_actual
                FROM botellas_estante b JOIN productos p ON b.producto_id = p.id
                ORDER BY b.ubicacion, b.fila
            `);

            sheetEst.columns = [
                { header: 'UBICACIÓN', key: 'ubi', width: 10 },
                { header: 'FILA', key: 'fila', width: 8 },
                { header: 'PRODUCTO', key: 'prod', width: 30 },
                { header: 'CANTIDAD REAL', key: 'cant', width: 15 },
                { header: 'UNIDAD', key: 'uni', width: 10 },
                { header: '% VISUAL', key: 'pct', width: 10 },
            ];

            resEst.rows.forEach(b => {
                sheetEst.addRow({
                    ubi: b.ubicacion, fila: b.fila, prod: b.nombre,
                    cant: parseFloat(b.cantidad), uni: b.unidad_medida, pct: `${b.porcentaje_actual}%`
                });
            });
            sheetEst.getRow(1).font = { bold: true };
        }

        // ---------------------------------------------------------
        // HOJA 3: HISTORIAL DE VENTAS (Con Totales Bs y USD)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'ventas') {
            const sheetVentas = workbook.addWorksheet('Historial Ventas');
            
            // Consulta compleja para obtener el total en Bs real basado en los pagos
            const resVentas = await client.query(`
                SELECT 
                    v.id, v.fecha, c.nombre as cliente, v.total as total_usd,
                    COALESCE((SELECT SUM(p.monto * p.tasa_cambio) FROM pagos p WHERE p.venta_id = v.id), 0) as total_bs_calc
                FROM ventas v
                LEFT JOIN clientes c ON v.cliente_id = c.id
                ORDER BY v.fecha DESC
            `);

            sheetVentas.columns = [
                { header: 'ID VENTA', key: 'id', width: 10 },
                { header: 'FECHA', key: 'fecha', width: 20 },
                { header: 'CLIENTE', key: 'cliente', width: 30 },
                { header: 'TOTAL (USD)', key: 'usd', width: 15 },
                { header: 'TOTAL (BS)', key: 'bs', width: 20 },
            ];

            let sumUSD = 0;
            let sumBS = 0;

            resVentas.rows.forEach(v => {
                const usd = parseFloat(v.total_usd || 0);
                const bs = parseFloat(v.total_bs_calc || 0);
                sumUSD += usd;
                sumBS += bs;

                sheetVentas.addRow({
                    id: v.id,
                    fecha: new Date(v.fecha).toLocaleString('es-VE'),
                    cliente: v.cliente || 'Consumidor Final',
                    usd: usd,
                    bs: bs
                });
            });

            // --- FILA DE TOTALES (SOLICITUD PRINCIPAL) ---
            sheetVentas.addRow(['', '', '', '', '']); // Espacio
            const rowGranTotal = sheetVentas.addRow(['', 'TOTALES GENERALES:', '', sumUSD, sumBS]);
            
            // Estilos para la fila de totales
            rowGranTotal.font = { bold: true, size: 12 };
            rowGranTotal.getCell(4).numFmt = '"$"#,##0.00';
            rowGranTotal.getCell(5).numFmt = '"Bs"#,##0.00';
            rowGranTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; // Verde claro

            sheetVentas.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheetVentas.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }; // Azul
        }

        // ---------------------------------------------------------
        // HOJA 4: LOTES (Vencimientos)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'lotes') {
            const sheetLotes = workbook.addWorksheet('Lotes y Vencimientos');
            const resLotes = await client.query(`
                SELECT l.codigo_lote, p.nombre, l.cantidad_actual, l.fecha_vencimiento
                FROM lotes l JOIN productos p ON l.producto_id = p.id
                WHERE l.cantidad_actual > 0 ORDER BY l.fecha_vencimiento ASC
            `);

            sheetLotes.columns = [
                { header: 'LOTE', key: 'lote', width: 15 },
                { header: 'PRODUCTO', key: 'prod', width: 30 },
                { header: 'CANTIDAD', key: 'cant', width: 12 },
                { header: 'VENCE', key: 'vence', width: 15 },
                { header: 'ESTADO', key: 'estado', width: 12 },
            ];

            const hoy = new Date();
            resLotes.rows.forEach(l => {
                const vence = new Date(l.fecha_vencimiento);
                const diasRestantes = Math.ceil((vence - hoy) / (1000 * 60 * 60 * 24));
                let estado = 'OK';
                if (diasRestantes < 0) estado = 'VENCIDO';
                else if (diasRestantes < 30) estado = 'POR VENCER';

                const row = sheetLotes.addRow({
                    lote: l.codigo_lote, prod: l.nombre, cant: parseFloat(l.cantidad_actual),
                    vence: vence.toLocaleDateString(), estado: estado
                });

                if (estado === 'VENCIDO') row.getCell(5).font = { color: { argb: 'FFFF0000' }, bold: true };
                if (estado === 'POR VENCER') row.getCell(5).font = { color: { argb: 'FFF59E0B' }, bold: true };
            });
            sheetLotes.getRow(1).font = { bold: true };
        }

        // ---------------------------------------------------------
        // HOJA 5: MERMAS Y MOVIMIENTOS
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'mermas') {
            const sheetMermas = workbook.addWorksheet('Mermas y Salidas');
            const resMermas = await client.query(`
                SELECT h.fecha, p.nombre, h.cantidad, h.motivo, h.tipo_movimiento
                FROM historial_movimientos h JOIN productos p ON h.producto_id = p.id
                WHERE h.tipo_movimiento = 'SALIDA' OR h.motivo ILIKE '%MERMA%'
                ORDER BY h.fecha DESC
            `);

            sheetMermas.columns = [
                { header: 'FECHA', key: 'fecha', width: 18 },
                { header: 'PRODUCTO', key: 'prod', width: 30 },
                { header: 'CANTIDAD', key: 'cant', width: 12 },
                { header: 'TIPO', key: 'tipo', width: 12 },
                { header: 'MOTIVO / OBSERVACIÓN', key: 'motivo', width: 40 },
            ];

            resMermas.rows.forEach(m => {
                sheetMermas.addRow({
                    fecha: new Date(m.fecha).toLocaleString(),
                    prod: m.nombre,
                    cant: parseFloat(m.cantidad),
                    tipo: m.tipo_movimiento,
                    motivo: m.motivo
                });
            });
            sheetMermas.getRow(1).font = { bold: true };
        }

        client.release();

        // ---------------------------------------------------------
        // GENERAR ARCHIVO
        // ---------------------------------------------------------
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_${filtro.toUpperCase()}_${new Date().toISOString().slice(0,10)}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error Exportar Excel:", error);
        res.status(500).send('Error generando el reporte Excel.');
    }
};

const gestionarMovimientoEstante = async (req, res) => {
    const { idBotella } = req.params;
    const { tipo, cantidad, motivo, esPerfumeCompleto } = req.body; 
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const cantidadMover = Math.round(parseFloat(cantidad));

        const botellaRes = await client.query(`
            SELECT b.*, p.nombre, p.contenido_gramos 
            FROM botellas_estante b 
            JOIN productos p ON b.producto_id = p.id 
            WHERE b.id = $1 FOR UPDATE`, [idBotella]);
            
        if (botellaRes.rows.length === 0) throw new Error('Botella no encontrada.');
        
        const botella = botellaRes.rows[0];
        const capacidadTotal = parseFloat(botella.contenido_gramos) || 1000;
        let nuevaCantidad = parseFloat(botella.cantidad);

        if (tipo === 'MERMA') {
            if (cantidadMover > nuevaCantidad) throw new Error(`Stock insuficiente.`);
            nuevaCantidad -= cantidadMover;

            // <--- LÍNEA CLAVE QUE FALTABA --->
            // Restamos del stock global para que Facturación se entere
            await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2', [cantidadMover, botella.producto_id]);

        } else {
            nuevaCantidad += cantidadMover;
            // Opcional: Si es devolución, sumamos al global
            await client.query('UPDATE productos SET stock_estante = stock_estante + $1 WHERE id = $2', [cantidadMover, botella.producto_id]);
        }

        const nuevoPorcentaje = Math.min(100, Math.round((nuevaCantidad / capacidadTotal) * 100));

        if (nuevaCantidad <= 0.01) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [idBotella]);
        } else {
            await client.query(`UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3`, [nuevaCantidad, nuevoPorcentaje, idBotella]);
        }

        await client.query(`
            INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha) 
            VALUES ($1, $2, $3, $4, $5, NOW())`, 
            [botella.producto_id, tipo, cantidadMover, nuevaCantidad, `${motivo} (${esPerfumeCompleto ? 'Perfume' : 'Insumo'})`]
        );

        await client.query('COMMIT');
        res.json({ mensaje: 'Movimiento registrado correctamente.' });

    } catch (error) { 
        await client.query('ROLLBACK'); 
        res.status(400).json({ error: error.message }); 
    } finally { 
        client.release(); 
    }
};


const sincronizarStock = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Traemos todos los productos
        const productosRes = await client.query("SELECT id, nombre, stock_estante, contenido_gramos FROM productos WHERE activo = true");
        const productos = productosRes.rows;

        let productosCorregidos = 0;

        for (const prod of productos) {
            // A. VERDAD CONTABLE (Lo que dice Facturación que debe haber)
            const stockDeberia = parseFloat(prod.stock_estante || 0);

            // B. VERDAD VISUAL (Lo que hay actualmente pintado en el estante)
            // Traemos las botellas ordenadas para empezar a recortar por las abiertas o más vacías
            const botellasRes = await client.query(`
                SELECT id, cantidad, estado 
                FROM botellas_estante 
                WHERE producto_id = $1 
                ORDER BY CASE WHEN estado = 'ABIERTA' THEN 1 ELSE 2 END ASC, cantidad ASC
            `, [prod.id]);
            
            const botellas = botellasRes.rows;
            
            // Sumamos cuánto hay visualmente
            const stockVisual = botellas.reduce((acc, b) => acc + parseFloat(b.cantidad), 0);

            // C. COMPARACIÓN INTELIGENTE
            // Si en pantalla hay MÁS de lo que debería (ej: Hay 100g visuales pero Facturación dice que quedan 40g),
            // significa que se vendió y no se borró la botella. Hay que borrar la diferencia (60g).
            if (stockVisual > (stockDeberia + 0.05)) { // Margen 0.05 por decimales
                
                let diferenciaABorrar = stockVisual - stockDeberia;
                
                // D. CORRECCIÓN AUTOMÁTICA
                for (const b of botellas) {
                    if (diferenciaABorrar <= 0.001) break; // Ya ajustamos

                    const disponibleEnBotella = parseFloat(b.cantidad);
                    const aQuitar = Math.min(diferenciaABorrar, disponibleEnBotella);
                    
                    const nuevaCant = disponibleEnBotella - aQuitar;

                    if (nuevaCant <= 0.01) {
                        // Si la botella era fantasma completa, la eliminamos
                        await client.query('DELETE FROM botellas_estante WHERE id = $1', [b.id]);
                    } else {
                        // Si solo era una parte, la actualizamos
                        const capacidad = parseFloat(prod.contenido_gramos) || 1000;
                        const nuevoPorc = Math.round((nuevaCant / capacidad) * 100);
                        await client.query(
                            "UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3", 
                            [nuevaCant, nuevoPorc, b.id]
                        );
                    }
                    diferenciaABorrar -= aQuitar;
                }
                productosCorregidos++;
            }
            // Si stockVisual <= stockDeberia, no hacemos nada (Todo bien)
        }

        await client.query('COMMIT');

        if (productosCorregidos > 0) {
            res.json({ mensaje: `Corrección aplicada: Se ajustaron las botellas de ${productosCorregidos} productos para coincidir con lo facturado.` });
        } else {
            res.json({ mensaje: 'Todo bien. El estante ya coincide con la facturación.' });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: "Error sincronizando: " + error.message });
    } finally {
        client.release();
    }
};

const vaciadoMasivoEstante = async (req, res) => {
    const { ids, destino, fila } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        let totalMovidos = 0;

        for (const id of ids) {
            // 1. Consultar cuánto hay en almacén para este producto
            const prodRes = await client.query('SELECT stock_unidades FROM productos WHERE id = $1 FOR UPDATE', [id]);
            if (prodRes.rows.length === 0) continue;

            const stock = parseFloat(prodRes.rows[0].stock_unidades);
            if (stock <= 0) continue; // Si no hay nada, saltamos al siguiente

            // 2. Descontar y vaciar todos los lotes de almacén de este producto
            await client.query('UPDATE lotes SET cantidad_actual = 0 WHERE producto_id = $1', [id]);

            // 3. Crear la caja/botella en el Estante (Llega como CERRADA)
            await client.query(`
                INSERT INTO botellas_estante 
                (producto_id, ubicacion, fila, estado, cantidad, porcentaje_actual)
                VALUES ($1, $2, $3, 'CERRADA', $4, 100)
            `, [id, destino, fila, stock]);

            // 4. Actualizar contadores globales: Vaciamos almacén y sumamos a estante
            await client.query(`
                UPDATE productos 
                SET stock_estante = stock_estante + $1, stock_unidades = 0 
                WHERE id = $2
            `, [stock, id]);

            // 5. Dejar registro en el historial (Kardex)
            await client.query(`
                INSERT INTO historial_movimientos 
                (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha)
                VALUES ($1, 'TRASLADO', $2, (SELECT stock_unidades + stock_estante FROM productos WHERE id=$1), $3, NOW())
            `, [id, stock, `Vaciado Masivo a Estante ${destino} (Nivel ${fila})`]);

            totalMovidos++;
        }

        await client.query('COMMIT');
        res.json({ mensaje: `Se procesaron exitosamente ${totalMovidos} productos hacia el mostrador.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en Vaciado Masivo:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

module.exports = { getProductos, createProducto, updateProducto, deleteProducto, importarMasivo, getHistorialImportaciones, revertirImportacion, getKardex, getLotesProducto, eliminarFisico, reactivarProducto, reponerEstante, getProductosEstante,
    reportarMerma, organizarBotella, actualizarNivelBotella, getUbicacionSugerida, abrirBotellaGrupo, crearTester,
    moverStockEstante, distribuirProducto, exportarExcel, gestionarMovimientoEstante, sincronizarStock, eliminarBotella, reponerTester, vaciadoMasivoEstante};