const pool = require('../config/db');
const ExcelJS = require('exceljs');
const roundMoney = (amount) => Math.round((parseFloat(amount) || 0) * 100) / 100;
const { crearNotificacionInterna } = require('./notificaciones.controller');



const getProductos = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = (req.query.search || '').trim(); // Limpiamos espacios y códigos como "E001"
        const bajoStock = req.query.bajoStock === 'true';
        const offset = (page - 1) * limit;
        
        let idTiendaLocal = 1;
        if (req.user && req.user.tienda_id !== undefined && req.user.tienda_id !== null && req.user.tienda_id !== '') {
            idTiendaLocal = parseInt(req.user.tienda_id, 10);
        }
        
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev' || rolUsuario === 'admin' || rolUsuario === 'administrador';
        if (esUsuarioMaestro) {
            const tiendaDeteccionId = req.query.tienda_id || req.query.tienda || req.query.id_tienda || req.query.idTienda || req.query.sucursal;
            if (tiendaDeteccionId) {
                idTiendaLocal = parseInt(tiendaDeteccionId, 10);
            }
        }

        // Clausula base amarrada a tu sucursal activa
        let whereClause = 'WHERE activo = true AND tienda_id = $1';
        let params = [idTiendaLocal];

        // =========================================================================
        // FILTRADO ULTRA-RÁPIDO POR CÓDIGO (EJ: "E001") O POR NOMBRE/MARCA
        // =========================================================================
        if (search !== '') {
            // Buscamos coincidencia EXACTA en la columna 'codigo' ($2)
            // O coincidencia parcial tradicional en código, nombre o marca ($3)
            whereClause += ` AND (codigo = $2 OR codigo ILIKE $3 OR nombre ILIKE $3 OR marca ILIKE $3)`;
            params.push(search);            // $2 -> Coincidencia exacta (ej: E001 o PISETA)
            params.push(`%${search}%`);     // $3 -> Coincidencia parcial tradicional
        } else if (bajoStock) {
            whereClause += ' AND stock_unidades <= stock_minimo';
        }

        // La magia está en el ORDER BY: 
        // Si 'search' coincide exactamente con el 'codigo' (ej: E001), la condición (codigo = $2) se vuelve Verdadera (1) 
        // y DESC la empuja al principio de la lista de tu frontend automáticamente.
        const queryData = `
            SELECT id, 
                   codigo, 
                   codigo AS referencia, -- Devolvemos ambos nombres para asegurar compatibilidad con tu frontend
                   nombre, 
                   marca, 
                   categoria, 
                   precio_venta, 
                   costo,
                   stock_estante, 
                   stock_unidades AS stock_real, 
                   stock_minimo,
                   unidad_medida, 
                   contenido_gramos, 
                   genero,
                   (SELECT COUNT(*)::int FROM lotes l WHERE l.producto_id = productos.id AND l.cantidad_actual > 0) as lotes_activos
            FROM productos 
            ${whereClause}
            ORDER BY ${search !== '' ? `(codigo = $2) DESC,` : ''} nombre ASC, id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const queryParams = [...params, limit, offset];
        const dataRes = await pool.query(queryData, queryParams);
        
        const countRes = await pool.query(`SELECT COUNT(*) FROM productos ${whereClause}`, params);
        const total = parseInt(countRes.rows[0].count);
        
        res.json({ 
            data: dataRes.rows,
            pagination: { total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error("Error en getProductos:", error);
        res.status(500).json({ error: 'Error obteniendo inventario' });
    }
};

const obtenerProductoPorReferencia = async (req, res) => {
    const { referencia } = req.params;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 3; // Por defecto La Urbina o la de tu sesión

    try {
        const result = await pool.query(
            `SELECT id, codigo AS referencia, nombre, marca, categoria, costo, precio_venta, 
                    stock_unidades AS stock_almacen, stock_estante, (stock_unidades + stock_estante) AS stock_total,
                    unidad_medida, contenido_gramos
             FROM productos 
             WHERE (codigo = $1 OR codigo ILIKE $1) AND tienda_id = $2 AND activo = true`,
            [referencia.trim(), idTiendaLocal]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: `La referencia '${referencia}' no existe en esta sucursal.` });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error buscando por referencia:", error);
        res.status(500).json({ error: "Error en el servidor al buscar la referencia." });
    }
};

const getProductosEstante = async (req, res) => {
    try {
        // 🛡️ PROTECCIÓN FRONTEND: Atrapamos el error de "page=true" que está enviando tu navegador
        let rawPage = req.query.page;
        if (rawPage === 'true' || isNaN(parseInt(rawPage))) rawPage = 1;
        
        const page = parseInt(rawPage) || 1;
        const limit = parseInt(req.query.limit) || 50; 
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : 'nulo';
        const esUsuarioMaestro = rolUsuario.includes('dev') || rolUsuario.includes('admin') || rolUsuario.includes('administrador');

        // 🔥 LECTURA EN VIVO DE SUCURSAL
        let idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        
        if (esUsuarioMaestro && req.user?.id) {
            const userDb = await pool.query('SELECT tienda_id FROM usuarios WHERE id = $1', [req.user.id]);
            if (userDb.rows.length > 0 && userDb.rows[0].tienda_id !== null) {
                idTiendaLocal = parseInt(userDb.rows[0].tienda_id, 10);
            }
        }

        // 🔍 CONSTRUCCIÓN DINÁMICA DE LA CONSULTA (AHORA CON BUSCADOR)
        let whereClause = `WHERE (b.cantidad > 0 OR b.porcentaje_actual > 0) AND p.activo = true AND p.tienda_id = $1`;
        let queryParams = [idTiendaLocal];
        let paramIndex = 2;

        if (search) {
            whereClause += ` AND (p.nombre ILIKE $${paramIndex} OR p.codigo ILIKE $${paramIndex} OR p.marca ILIKE $${paramIndex} OR p.categoria ILIKE $${paramIndex})`;
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        const countQuery = `
            SELECT COUNT(*) FROM botellas_estante b 
            JOIN productos p ON b.producto_id = p.id 
            ${whereClause}
        `;
        const countRes = await pool.query(countQuery, queryParams);
        const total = parseInt(countRes.rows[0].count);

        // 📦 AÑADIMOS COLUMNAS CRÍTICAS (codigo, precio_venta) PARA QUE EL FRONTEND NO EXPLOTE
        const dataQuery = `
            SELECT b.*, 
                   p.codigo, p.nombre, p.marca, p.activo, p.contenido_gramos, 
                   p.unidad_medida, p.categoria, p.precio_venta 
            FROM botellas_estante b
            JOIN productos p ON b.producto_id = p.id
            ${whereClause}
            ORDER BY b.ubicacion ASC, p.nombre ASC, b.id DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        queryParams.push(limit, offset);
        const response = await pool.query(dataQuery, queryParams);
        
        console.log(`[ESTANTE OK] Tienda: ${idTiendaLocal} | Búsqueda: "${search}" | Botellas enviadas: ${response.rows.length}`);

        res.json({
    data: response.rows,
    pagination: { 
        totalItems: total, 
        totalPages: Math.ceil(total / limit), 
        currentPage: parseInt(page), 
        itemsPerPage: parseInt(limit) 
    }
});
    } catch (error) {
        console.error("Error en getProductosEstante:", error);
        res.status(500).json({ error: 'Error cargando estante' });
    }
};

const cambiarSucursalActiva = async (req, res) => {
    try {
        const { tienda_id } = req.body;
        const usuarioId = req.user?.id;
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev' || rolUsuario === 'admin' || rolUsuario === 'administrador';

        if (!usuarioId) {
            return res.status(401).json({ error: 'Sesión inválida o expirada.' });
        }

        if (!esUsuarioMaestro) {
            return res.status(403).json({ error: 'Acceso denegado. Solo administradores pueden alternar sucursales en caliente.' });
        }

        // 🔥 Tu Idea: Ubicamos el ID del usuario actual y le cambiamos la tienda en vivo
        await pool.query('UPDATE usuarios SET tienda_id = $1 WHERE id = $2', [tienda_id, usuarioId]);

        res.json({ mensaje: `¡Cambio aplicado! Contexto del Dev migrado a Tienda ID: ${tienda_id}` });
    } catch (error) {
        console.error("Error en cambiarSucursalActiva:", error);
        res.status(500).json({ error: error.message });
    }
};

const createProducto = async (req, res) => {
    const { 
        codigo, nombre, marca, categoria, genero, stock, stock_minimo, costo, precio_venta, 
        ubicacion, u_caja, ganancia, descripcion, unidad_medida, contenido_gramos 
    } = req.body;
    
    const usuarioId = req.user ? req.user.id : null; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const cantInitial = parseFloat(stock) || 0;
    const costoUnit = parseFloat(costo) || 0;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Insertar el Producto Base
        const insertProdText = `
            INSERT INTO productos 
             (codigo, nombre, marca, categoria, genero, stock_unidades, stock_minimo, costo, precio_venta, ubicacion, u_caja, ganancia, descripcion, unidad_medida, activo, contenido_gramos, tamano, stock_estante, tienda_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15, $16, 0, $17) 
             RETURNING *`;
             
        const prodValues = [
            codigo, nombre, marca, categoria, genero || 'UNISEX', cantInitial, parseFloat(stock_minimo) || 0, costoUnit, parseFloat(precio_venta) || 0, 
            ubicacion || 'DEPOSITO', u_caja || 1, ganancia || 30, descripcion || '', unidad_medida || 'UNIDAD',
            contenido_gramos || 0, contenido_gramos ? `${contenido_gramos}ml` : 'N/A', idTiendaLocal
        ];

        const resProd = await client.query(insertProdText, prodValues);
        const nuevoProd = resProd.rows[0];

        // 2. 🔥 SI SE INGRESÓ STOCK INICIAL, CREAR LOTE Y REGISTRAR EN HISTORIAL
        if (cantInitial > 0) {
            const codigoLoteInicial = `INI-${nuevoProd.id}-${Date.now().toString().slice(-4)}`;

            // A. Crear el Lote de Stock Inicial
            await client.query(`
                INSERT INTO lotes 
                (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
                VALUES ($1, $2, $3, $3, NOW() + INTERVAL '2 years', $4, $5)
            `, [nuevoProd.id, codigoLoteInicial, cantInitial, costoUnit, idTiendaLocal]);

            // B. Registrar en Historial de Movimientos para Kardex y Reportes
            await client.query(`
                INSERT INTO historial_movimientos 
                (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id) 
                VALUES ($1, 'ENTRADA', $2, $2, 'Carga de Stock Inicial al Crear Producto', NOW(), $3, $4)
            `, [nuevoProd.id, cantInitial, idTiendaLocal, usuarioId]);
        }

        // 3. Alertas y Auditoría
        if (parseFloat(nuevoProd.stock_unidades) <= parseFloat(nuevoProd.stock_minimo)) {
            await crearNotificacionInterna(
                `INVENTARIO: Nuevo producto ${nuevoProd.nombre} creado con stock crítico (${nuevoProd.stock_unidades}).`,
                'ALERTA',
                '/inventario',
                idTiendaLocal
            );
        }

        if (usuarioId) {
            await client.query(
                "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'CREAR_PROD', $2, NOW())",
                [usuarioId, `Tienda ${idTiendaLocal}: Creó el producto ${nuevoProd.nombre} (${codigo}) con stock inicial: ${cantInitial}`]
            );
        }

        await client.query('COMMIT');
        res.json(nuevoProd);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en createProducto:", error);
        res.status(500).json({ error: error.message });
    } finally { 
        client.release(); 
    }
};

const reactivarProducto = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.user ? req.user.id : null; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    
    try {
        const result = await pool.query('UPDATE productos SET activo = true WHERE id = $1 AND tienda_id = $2 RETURNING id', [id, idTiendaLocal]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado en esta sucursal' });

        await pool.query("UPDATE auditoria SET accion = 'REACTIVADO' WHERE accion = 'ELIMINAR_PROD' AND detalle LIKE $1", [`%ID ${id} %`]);
        await pool.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'REACTIVAR_PROD', $2)", [usuarioId, `Tienda ${idTiendaLocal}: Producto ID ${id} restaurado`]);
        
        res.json({ mensaje: 'Producto restaurado correctamente.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const eliminarFisico = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.user ? req.user.id : null; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    
    try {
        // La restricción ON DELETE en SQL frenará esto si tiene historial, pero le inyectamos la tienda por seguridad
        const result = await pool.query('DELETE FROM productos WHERE id = $1 AND tienda_id = $2 RETURNING id', [id, idTiendaLocal]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado en esta sucursal' });

        await pool.query("DELETE FROM auditoria WHERE accion = 'ELIMINAR_PROD' AND detalle LIKE $1", [`%ID ${id} %`]);
        await pool.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'BORRADO_TOTAL', $2)", [usuarioId, `Tienda ${idTiendaLocal}: Producto ID ${id} purgado de la BD`]);
        
        res.json({ mensaje: 'Producto eliminado definitivamente de la base de datos.' });
    } catch (error) {
        if (error.code === '23503') {
            return res.status(400).json({ error: 'No se puede eliminar: El producto tiene historial de ventas o compras. Solo se puede mantener desactivado.' });
        }
        res.status(500).json({ error: error.message });
    }
};

const updateProducto = async (req, res) => {
    const { id } = req.params;
    const { codigo, nombre, marca, categoria, genero, stock, stock_minimo, costo, precio_venta, ubicacion, tamano, u_caja, peso } = req.body;      
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const oldRes = await client.query('SELECT stock_unidades FROM productos WHERE id = $1 AND tienda_id = $2', [id, idTiendaLocal]);
        if (oldRes.rows.length === 0) throw new Error('Producto no encontrado en el catálogo de esta sucursal');

        const result = await client.query(`
            UPDATE productos SET 
                codigo = COALESCE($1, codigo),
                nombre = COALESCE($2, nombre),
                marca = COALESCE($3, marca),
                categoria = COALESCE($4, categoria),
                genero = COALESCE($5, genero),
                stock_unidades = COALESCE($6, stock_unidades),
                stock_minimo = COALESCE($7, stock_minimo),
                costo = COALESCE($8, costo),
                precio_venta = COALESCE($9, precio_venta),
                ubicacion = COALESCE($10, ubicacion),
                tamano = COALESCE($11, tamano),
                u_caja = COALESCE($12, u_caja),
                peso_unitario_kg = COALESCE($13, peso_unitario_kg)
            WHERE id = $14 AND tienda_id = $15
            RETURNING *`,
            [
                codigo, nombre, marca, categoria, genero,
                isNaN(parseFloat(stock)) ? null : parseFloat(stock),
                stock_minimo, costo, precio_venta, ubicacion, tamano, u_caja, peso, id, idTiendaLocal
            ]
        );
        
        const prod = result.rows[0];
        await client.query('COMMIT');
        res.json(prod);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error updateProducto:", error);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};

const deleteProducto = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.user ? req.user.id : null; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    try {
        const result = await pool.query('UPDATE productos SET activo = false WHERE id = $1 AND tienda_id = $2 RETURNING id', [id, idTiendaLocal]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado en esta sucursal' });
        
        await pool.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'ELIMINAR_PROD', $2)", [usuarioId, `Tienda ${idTiendaLocal}: Producto ID ${id} desactivado`]);
        res.json({ mensaje: 'Producto archivado' });
    } catch (error) {
        res.status(500).json({ error: 'Error eliminando' });
    }
};

const importarMasivo = async (req, res) => {
    const { productos, nombre_archivo, proveedor, tienda_id } = req.body; 
    const usuarioId = req.user ? req.user.id : null;
    
    // 🌍 UNIVERSAL: Toma la tienda del request o del usuario logueado, con respaldo seguro
    const idTiendaLocal = tienda_id || (req.user && req.user.tienda_id) || 1; 

    const client = await pool.connect();
    
    let insertadosG = 0; let actualizadosG = 0; 
    let inversionGlobal = 0; let proyeccionGlobal = 0;

    try {
        await client.query('BEGIN');

        // 🚀 CACHÉ EN MEMORIA ADAPTADO A LA TIENDA ACTUAL
        const resCatalogo = await client.query('SELECT id, codigo, nombre, marca, genero FROM productos WHERE tienda_id = $1', [idTiendaLocal]);
        const catalogoMemoria = {};
        resCatalogo.rows.forEach(p => {
            catalogoMemoria[p.codigo.toString().trim()] = p;
        });

        let hojasAProcesar = [];
        if (Array.isArray(productos)) {
            hojasAProcesar.push({ nombre: 'Hoja_1', datos: productos });
        } else if (typeof productos === 'object' && productos !== null) {
            for (const [nombreHoja, datos] of Object.entries(productos)) {
                if (Array.isArray(datos) && datos.length > 0) hojasAProcesar.push({ nombre: nombreHoja, datos: datos });
            }
        }

        if (hojasAProcesar.length === 0) throw new Error("El archivo no contenía datos procesables.");

        for (const hoja of hojasAProcesar) {
            const nombreHoja = hoja.nombre;
            const filas = hoja.datos;
            
            let logReversionHoja = [];
            let inversionHoja = 0; let proyeccionHoja = 0; let cantidadesHoja = 0;

            let headerMap = {};
            let startIndex = 0;

            for (let h = 0; h < Math.min(filas.length, 10); h++) {
                const candidateRow = filas[h];
                let foundHeader = false;
                
                for (const key in candidateRow) {
                    const valStr = candidateRow[key] ? candidateRow[key].toString().toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
                    if (valStr === 'referencia' || valStr === 'codigo' || valStr === 'cantidad' || valStr === 'seccion') {
                        foundHeader = true; break;
                    }
                }

                if (foundHeader) {
                    for (const key in candidateRow) {
                        if (candidateRow[key]) {
                            headerMap[key] = candidateRow[key].toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                        }
                    }
                    startIndex = h + 1; 
                    break;
                }
            }
            
            for (let i = startIndex; i < filas.length; i++) {
                const row = filas[i];
                
                const p = {};
                for (const key in row) {
                    const targetKey = headerMap[key] || key.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                    p[targetKey] = row[key];
                }

                const codigoRaw = p['referencia'] || p['codigo'] || p['ref'] || p['mappin pt'];
                const cantidadRaw = parseFloat(p['cantidad']);
                
                if (!codigoRaw || codigoRaw.toString().trim() === '' || codigoRaw.toString().trim().toUpperCase() === 'REFERENCIA' || codigoRaw.toString().trim().toUpperCase() === 'MAPPIN PT') {
                    continue; 
                }

                const seccionRaw = p['seccion'];
                let nombreRaw = p['descripcion'] || p['nombre'] || p['producto'];
                let marcaRaw = p['marca'];
                let generoRaw = p['genero'];
                const presentacionRaw = p['presentacion'] || 'UND';
                
                // 📅 LECTURA Y CONVERSIÓN DE LA FECHA DE VENCIMIENTO DEL EXCEL
                const fechaRaw = p['fecha vencimiento'] || p['vencimiento'] || p['fecha_vencimiento'] || p['vence'] || p['f. venc'] || p['f_vencimiento'];
                let fechaVencimientoObj = null;

                if (fechaRaw) {
                    if (fechaRaw instanceof Date && !isNaN(fechaRaw.getTime())) {
                        fechaVencimientoObj = fechaRaw;
                    } else if (typeof fechaRaw === 'number' && fechaRaw > 25569) {
                        // Conversión de número serie numérico de Excel
                        fechaVencimientoObj = new Date((fechaRaw - 25569) * 86400 * 1000);
                    } else if (typeof fechaRaw === 'string' && fechaRaw.trim() !== '') {
                        const parsedDate = new Date(fechaRaw.trim());
                        if (!isNaN(parsedDate.getTime())) {
                            fechaVencimientoObj = parsedDate;
                        }
                    }
                }
                
                let stockOriginal = isNaN(cantidadRaw) ? 0 : cantidadRaw;
                let costoRaw = parseFloat(p['costo'] || p['costo und']);
                if (isNaN(costoRaw)) costoRaw = 0;
                let precioRaw = parseFloat(p['precio']);
                if (isNaN(precioRaw)) precioRaw = 0;

                const codigo = codigoRaw.toString().trim(); 
                const seccion = seccionRaw ? seccionRaw.toString().trim().toUpperCase() : 'GENERAL';
                const presentacion = presentacionRaw ? presentacionRaw.toString().trim().toUpperCase() : 'UND';
                
                let marca = marcaRaw ? marcaRaw.toString().trim() : 'Genérico';
                let genero = generoRaw ? generoRaw.toString().trim().toUpperCase() : 'UNISEX';

                const productoExistente = catalogoMemoria[codigo];
                let productoId;
                let esNuevo = false;

                if (productoExistente) {
                    productoId = productoExistente.id;
                    if (!nombreRaw && productoExistente.nombre) nombreRaw = productoExistente.nombre;
                    if ((!generoRaw || genero === 'UNISEX') && productoExistente.genero) genero = productoExistente.genero;
                    if ((!marcaRaw || marca === 'Genérico') && productoExistente.marca) marca = productoExistente.marca;
                } else {
                    esNuevo = true;
                }

                const nombre = nombreRaw ? nombreRaw.toString().trim() : `Perfume ${codigo}`;
                let stockAñadido = 0; let categoria = 'General'; let unidad_medida = 'UNIDAD'; let contenido_gramos = 0;

                // 🧠 MOTOR DE CONVERSIONES MATEMÁTICAS
                if (seccion.includes('PERFUME TERMINADO') || seccion.includes('PERFUMES TERMINADOS')) {
                    categoria = 'Perfumes Terminados'; unidad_medida = 'UNIDAD'; stockAñadido = Math.round(stockOriginal);
                    const extraerNumero = codigo.match(/T(\d+)/i) || codigo.match(/\d+$/);
                    contenido_gramos = extraerNumero ? parseInt(extraerNumero[1] || extraerNumero[0], 10) : 30;
                }
                else if (seccion === 'ESENCIA' || presentacion === 'GRAMOS') {
                    categoria = 'Esencias'; unidad_medida = 'GRAMOS'; stockAñadido = Math.round(stockOriginal * 1000); 
                } 
                else if (seccion === 'ALCOHOL' || (seccion === 'MATERIA PRIMA' && nombre.toUpperCase().includes('ALCOHOL'))) {
                    categoria = 'Alcohol'; unidad_medida = 'ML'; stockAñadido = Math.round(stockOriginal * 1000); 
                } 
                else if (seccion === 'FIJADOR' || (seccion === 'MATERIA PRIMA' && nombre.toUpperCase().includes('FIJADOR'))) {
                    categoria = 'Fijador'; unidad_medida = 'GRAMOS'; stockAñadido = Math.round(stockOriginal * 1000); 
                } 
                else if (seccion === 'FRASCO' || presentacion === 'UND') {
                    categoria = seccion.includes('FRASCO') ? 'Envases' : 'General'; unidad_medida = 'UNIDAD'; stockAñadido = Math.round(stockOriginal);
                    const extraerNumero = codigo.match(/\d+/) || nombre.match(/\d+/);
                    if (extraerNumero) contenido_gramos = parseInt(extraerNumero[0], 10);
                } else {
                    categoria = 'General'; unidad_medida = 'UNIDAD'; stockAñadido = Math.round(stockOriginal);
                }

                if (stockOriginal <= 0 && productoExistente) continue;

                const costo = costoRaw; const precio_venta = precioRaw; const stock_minimo = 5;

                if (!esNuevo) {
                    await client.query(`
                        UPDATE productos 
                        SET stock_unidades = stock_unidades + $1, marca = $2, genero = $3, categoria = $4, costo = $5, precio_venta = $6, unidad_medida = $7, activo = true
                        WHERE id = $8 AND tienda_id = $9
                    `, [stockAñadido, marca, genero, categoria, costo, precio_venta, unidad_medida, productoId, idTiendaLocal]);
                    actualizadosG++;
                } else {
                    const resInsert = await client.query(`
                        INSERT INTO productos (codigo, nombre, marca, categoria, stock_unidades, stock_minimo, costo, precio_venta, ubicacion, u_caja, ganancia, descripcion, unidad_medida, activo, contenido_gramos, tamano, stock_estante, peso_unitario_kg, tienda_id, genero) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DEPOSITO', 1, 30, $9, $10, true, $11, $12, 0, 0, $13, $14)
                        RETURNING id
                    `, [codigo, nombre, marca, categoria, stockAñadido, stock_minimo, costo, precio_venta, `Hoja Excel: ${nombreHoja}`, unidad_medida, contenido_gramos, contenido_gramos > 0 ? `${contenido_gramos}ml` : 'N/A', idTiendaLocal, genero]);
                    
                    productoId = resInsert.rows[0].id;
                    insertadosG++;
                    
                    catalogoMemoria[codigo] = { id: productoId, codigo, nombre, marca, genero };
                }

                if (stockAñadido > 0) {
                    cantidadesHoja += stockOriginal; inversionHoja += (costo * stockOriginal); proyeccionHoja += (precio_venta * stockOriginal);
                    inversionGlobal += (costo * stockOriginal); proyeccionGlobal += (precio_venta * stockOriginal);

                    const loteAleatorio = `LOTE-EXCEL-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000)}`;
                    
                    // 🎯 INSERCIÓN DINÁMICA DE FECHA EN LA TABLA LOTES
                    let queryLote = '';
                    let paramsLote = [];

                    if (fechaVencimientoObj) {
                        const fechaFormatted = fechaVencimientoObj.toISOString().split('T')[0];
                        queryLote = `
                            INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
                            VALUES ($1, $2, $3, $3, $4, $5, $6) 
                            RETURNING id
                        `;
                        paramsLote = [productoId, loteAleatorio, stockAñadido, fechaFormatted, costo, idTiendaLocal];
                    } else {
                        queryLote = `
                            INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
                            VALUES ($1, $2, $3, $3, NOW() + INTERVAL '3 years', $4, $5) 
                            RETURNING id
                        `;
                        paramsLote = [productoId, loteAleatorio, stockAñadido, costo, idTiendaLocal];
                    }

                    const [loteRes] = await Promise.all([
                        client.query(queryLote, paramsLote),
                        client.query(`INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id, usuario_id) VALUES ($1, 'ENTRADA', $2, (SELECT stock_unidades FROM productos WHERE id=$1 AND tienda_id=$3), $4, NOW(), $3, $5)`, [productoId, stockAñadido, idTiendaLocal, `Carga Hoja: ${nombreHoja}`, usuarioId])
                    ]);
                    
                    let loteIdCreado = loteRes.rows[0].id;
                    logReversionHoja.push({ producto_id: productoId, es_nuevo: esNuevo, stock_agregado: stockAñadido, lote_id: loteIdCreado });
                }
            } 

            if (logReversionHoja.length > 0) {
                const rentabilidadHoja = proyeccionHoja - inversionHoja;
                const nombreArchivoGuardar = nombre_archivo ? `${nombre_archivo} - [${nombreHoja}]` : `Carga - [${nombreHoja}]`;

                await client.query(`
                    INSERT INTO importaciones_excel 
                    (usuario_id, nombre_archivo, detalles_json, estado, proveedor, cantidad_articulos, inversion_total, precio_proyectado, rentabilidad_estimada, excel_crudo_json)
                    VALUES ($1, $2, $3, 'APLICADO', $4, $5, $6, $7, $8, $9)
                `, [usuarioId, nombreArchivoGuardar, JSON.stringify(logReversionHoja), proveedor || 'No Especificado', cantidadesHoja, inversionHoja, proyeccionHoja, rentabilidadHoja, JSON.stringify(filas)]);
            }
        } 

        if (usuarioId && (insertadosG > 0 || actualizadosG > 0)) {
            await client.query("INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'IMPORT_MASIVA', $2, NOW())", [usuarioId, `Carga Maestra Múltiple (Tienda ${idTiendaLocal}): ${insertadosG} creados`]);
        }
        
        await client.query('COMMIT');
        res.json({
            mensaje: `¡Carga Turbo Exitosa en Tienda ${idTiendaLocal}! Inversión: $${inversionGlobal.toFixed(2)}`,
            resumen: { insertados: insertadosG, actualizados: actualizadosG }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en carga masiva universal:", error);
        res.status(500).json({ error: `Error procesando el Excel: ${error.message}. Carga rechazada por seguridad.` });
    } finally { 
        client.release(); 
    }
};

const descargarAuditoriaExcel = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 🛡️ CONSULTA OPTIMIZADA: Extraemos relacionalmente el nombre del usuario y de su sucursal
        const result = await pool.query(`
            SELECT i.*, u.nombre as usuario_nombre, t.nombre as tienda_nombre
            FROM importaciones_excel i
            LEFT JOIN usuarios u ON i.usuario_id = u.id
            LEFT JOIN tiendas t ON u.tienda_id = t.id
            WHERE i.id = $1
        `, [id]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: "Registro no encontrado" });
        
        const carga = result.rows[0];
        
        // Extraemos la matriz original que subió el usuario
        const datosExcel = typeof carga.excel_crudo_json === 'string' 
            ? JSON.parse(carga.excel_crudo_json) 
            : (carga.excel_crudo_json || []);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Auditoría de Carga');

        // 🏪 Cabecera Corporativa Expandida (Ahora incluye Usuario y Tienda)
        sheet.addRow(['REPORTE DE AUDITORÍA DE CARGA MASIVA']);
        sheet.addRow([`ID Operación:`, carga.id, `Fecha:`, new Date(carga.fecha).toLocaleString()]);
        sheet.addRow([`Usuario Carga:`, carga.usuario_nombre || 'Sistema / Dev', `Sucursal / Tienda:`, carga.tienda_nombre || 'La Urbina']);
        sheet.addRow([`Proveedor:`, carga.proveedor, `Archivo:`, carga.nombre_archivo]);
        sheet.addRow([`Inversión Total:`, parseFloat(carga.inversion_total), `Proyección Venta:`, parseFloat(carga.precio_proyectado)]);
        sheet.addRow([`Rentabilidad Estimada:`, parseFloat(carga.rentabilidad_estimada), `Estado:`, carga.estado]);
        sheet.addRow([]);
        
        // Estilos de cabecera (Filas 1 a 6 en negrita por las líneas agregadas)
        for(let i=1; i<=6; i++) sheet.getRow(i).font = { bold: true };
        
        // 🪙 Formatos de moneda reajustados a sus nuevas posiciones de fila (Fila 5 y 6)
        sheet.getCell('B5').numFmt = '"$"#,##0.00'; 
        sheet.getCell('D5').numFmt = '"$"#,##0.00';
        sheet.getCell('B6').numFmt = '"$"#,##0.00';

        // Columnas del Reporte
        const headers = sheet.addRow([
            'Código Artículo', 'Referencia', 'Descripción', 'Stock Cargado', 'Costo Unit.', 'Precio Venta', 'Subtotal Inversión'
        ]);
        headers.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headers.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

        // Filas de datos normalizadas
        datosExcel.forEach(item => {
            const p = {};
            for (const key in item) {
                const cleanKey = key.toString().toLowerCase()
                                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                                    .trim();
                p[cleanKey] = item[key];
            }

            const codigo = p['codigo articulo'] || p['codigo'] || 'S/N';
            const referencia = p['referencia'] || 'S/N';
            const descripcion = p['descripcion'] || p['nombre'] || 'S/N';
            
            let stock = parseFloat(p['cantidad'] || p['stock'] || 0);
            if (isNaN(stock)) stock = 0;

            let costo = parseFloat(p['costo und'] || p['costo'] || 0);
            if (isNaN(costo)) costo = 0;

            let precioV = parseFloat(p['precio'] || p['precio venta'] || 0);
            if (isNaN(precioV)) precioV = 0;

            const subtotalInversion = stock * costo;

            sheet.addRow([codigo, referencia, descripcion, stock, costo, precioV, subtotalInversion]);
        });

        // Configuración estética de anchos
        sheet.getColumn(1).width = 15; sheet.getColumn(2).width = 15; sheet.getColumn(3).width = 40;
        sheet.getColumn(4).width = 15; sheet.getColumn(5).width = 15; sheet.getColumn(6).width = 15; sheet.getColumn(7).width = 20;
        
        sheet.getColumn(5).numFmt = '"$"#,##0.00'; 
        sheet.getColumn(6).numFmt = '"$"#,##0.00'; 
        sheet.getColumn(7).numFmt = '"$"#,##0.00';

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Auditoria_Carga_${id}.xlsx`);
        
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error descargando auditoría:", error);
        res.status(500).send('Error generando el archivo de auditoría');
    }
};

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
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    try {
        const result = await pool.query(`
            SELECT id, codigo_lote, cantidad_actual, fecha_vencimiento 
            FROM lotes 
            WHERE producto_id = $1 AND tienda_id = $2 AND cantidad_actual > 0
            ORDER BY fecha_vencimiento ASC
        `, [id, idTiendaLocal]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const reponerEstante = async (req, res) => {
    const { id } = req.params;
    const { cantidad, ubicacion } = req.body;      
    const valorMover = parseFloat(cantidad);
    const filaDefault = 1; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (!valorMover || valorMover <= 0) throw new Error("La cantidad a mover debe ser mayor a 0.");
        
        // 🔒 Validamos que el producto pertenezca a la tienda actual
        const prodRes = await client.query('SELECT * FROM productos WHERE id = $1 AND tienda_id = $2 FOR UPDATE', [id, idTiendaLocal]);
        if (prodRes.rows.length === 0) throw new Error('Producto no encontrado en esta sucursal');
        
        const producto = prodRes.rows[0];
        
        if (parseFloat(producto.stock_unidades) < valorMover) { 
            throw new Error(`Stock insuficiente en Almacén. Tienes ${parseFloat(producto.stock_unidades).toFixed(2)}, intentas mover ${valorMover}.`);
        }

        const resultUpdate = await client.query(`
            UPDATE productos 
            SET stock_unidades = stock_unidades - $1,
                stock_estante = stock_estante + $1 
            WHERE id = $2 AND tienda_id = $3
            RETURNING stock_unidades, stock_minimo, nombre`, 
            [valorMover, id, idTiendaLocal]
        );
        const prodActualizado = resultUpdate.rows[0];

        if (parseFloat(prodActualizado.stock_unidades) <= parseFloat(prodActualizado.stock_minimo)) {
            await crearNotificacionInterna(
                `INVENTARIO: Stock crítico en almacén para ${prodActualizado.nombre}. Quedan: ${parseFloat(prodActualizado.stock_unidades).toFixed(2)}`,
                'PELIGRO',
                '/inventario',
                idTiendaLocal
            );
        }

        await client.query(`
            INSERT INTO botellas_estante (producto_id, ubicacion, fila, cantidad, estado, porcentaje_actual)
            VALUES ($1, $2, $3, $4, 'ABIERTA', 100)
        `, [id, ubicacion, filaDefault, valorMover]);

        const unidadTexto = ['Alcohol', 'Esencias', 'Fijador'].includes(producto.categoria) ? 'g' : 'unid';
        
        // 🔒 Kardex con el ID de la tienda
        await client.query(`
            INSERT INTO historial_movimientos 
            (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id)
            VALUES ($1, 'TRASLADO', $2, $3, 'Ingreso a ' || $4 || ' (' || $2 || $5 || ')', NOW(), $6)
        `, [id, valorMover, prodActualizado.stock_unidades, ubicacion, unidadTexto, idTiendaLocal]);

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
    const { cantidadAbrir } = req.body; 
    const cantidad = parseInt(cantidadAbrir) || 1;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 🔒 Filtramos por tienda
        const grupoRes = await client.query('SELECT b.* FROM botellas_estante b JOIN productos p ON b.producto_id = p.id WHERE b.id = $1 AND p.tienda_id = $2 FOR UPDATE', [grupoId, idTiendaLocal]);
        const grupo = grupoRes.rows[0];
        if (!grupo) throw new Error('Grupo no encontrado en su sucursal');
        
        if (grupo.cantidad < cantidad) throw new Error(`Solo hay ${grupo.cantidad} unidades en esta caja.`);

        if (grupo.cantidad === cantidad) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [grupoId]);
        } else {
            await client.query('UPDATE botellas_estante SET cantidad = cantidad - $1 WHERE id = $2', [cantidad, grupoId]);
        }

        for(let i=0; i<cantidad; i++) {
            await client.query(`
                INSERT INTO botellas_estante (producto_id, ubicacion, fila, cantidad, estado, porcentaje_actual)
                VALUES ($1, $2, $3, 1, 'ABIERTA', 100)
            `, [grupo.producto_id, grupo.ubicacion, grupo.fila]);
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
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    try {
        const result = await pool.query(`
            SELECT b.ubicacion, b.fila FROM botellas_estante b
            JOIN productos p ON b.producto_id = p.id
            WHERE b.producto_id = $1 AND p.tienda_id = $2
            ORDER BY b.id DESC LIMIT 1
        `, [id, idTiendaLocal]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({ ubicacion: 'A', fila: 1 }); 
        }
    } catch (error) {
        res.json({ ubicacion: 'A', fila: 1 });
    }
};

const organizarBotella = async (req, res) => {
    const { botellaId } = req.params;
    let { destino, fila } = req.body;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 🔒 Validamos propiedad de la botella
        const botellaRes = await client.query(`
            SELECT b.* FROM botellas_estante b 
            JOIN productos p ON b.producto_id = p.id
            WHERE b.id = $1 AND p.tienda_id = $2 FOR UPDATE
        `, [botellaId, idTiendaLocal]);
        
        const botellaMoviendo = botellaRes.rows[0];
        if (!botellaMoviendo) throw new Error('Botella no encontrada en esta sucursal');

        const existeMismoProducto = await client.query(`
            SELECT id FROM botellas_estante 
            WHERE ubicacion = $1 AND fila = $2 AND producto_id = $3 AND estado = 'ABIERTA' FOR UPDATE 
        `, [destino, fila, botellaMoviendo.producto_id]);

        if (existeMismoProducto.rows.length > 0) {
            await client.query(`UPDATE botellas_estante SET cantidad = cantidad + $1 WHERE id = $2`, [botellaMoviendo.cantidad, existeMismoProducto.rows[0].id]);
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [botellaId]);
        } else {
            const estadoFinal = botellaMoviendo.estado === 'TESTER' ? 'TESTER' : 'ABIERTA';
            await client.query(
                `UPDATE botellas_estante SET ubicacion = $1, fila = $2, estado = $3 WHERE id = $4`, 
                [destino, fila, estadoFinal, botellaId]
            );
        }
        
        await client.query('COMMIT');
        res.json({ mensaje: 'Botella organizada correctamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const actualizarNivelBotella = async (req, res) => {
    const { botellaId } = req.params;
    const { nuevoNivel } = req.body; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    // 🔥 Usamos un cliente transaccional para asegurar la suma/resta
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const cant = parseFloat(nuevoNivel);
        
        const botellaRes = await client.query(`
            SELECT b.*, p.nombre, p.contenido_gramos 
            FROM botellas_estante b 
            JOIN productos p ON b.producto_id = p.id 
            WHERE b.id = $1 AND p.tienda_id = $2 FOR UPDATE`, [botellaId, idTiendaLocal]);
            
        if (botellaRes.rows.length === 0) throw new Error('Botella no encontrada en esta sucursal');
        
        const botella = botellaRes.rows[0];
        const cantidadAnterior = parseFloat(botella.cantidad); // Cuánto tenía antes
        const diferencia = cant - cantidadAnterior; // Positivo si subió, negativo si bajó

        if (cant <= 0) {
            await crearNotificacionInterna(`ESTANTE: La botella de ${botella.nombre} se ha agotado.`, 'ALERTA', '/estante', idTiendaLocal);
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [botellaId]);
        } else {
            const capacidad = parseFloat(botella.contenido_gramos) || 1000;
            const porcentaje = Math.round((cant / capacidad) * 100);

            if (porcentaje < 15) {
                await crearNotificacionInterna(`ESTANTE: Nivel bajo (${porcentaje}%) en la botella de ${botella.nombre}`, 'INFO', '/estante', idTiendaLocal);
            }

            await client.query('UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3', [cant, porcentaje, botellaId]);
        }

        // 🔥 LA MAGIA: Actualizamos el contador global del estante para que Facturación no se vuelva loca
        if (diferencia !== 0) {
            await client.query(`
                UPDATE productos 
                SET stock_estante = GREATEST(stock_estante + $1, 0) 
                WHERE id = $2 AND tienda_id = $3
            `, [diferencia, botella.producto_id, idTiendaLocal]);
        }

        await client.query('COMMIT');
        res.json({ mensaje: 'Stock de botella y estante global actualizados correctamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

const reportarMerma = async (req, res) => {
    const { id } = req.params;
    const { cantidad, motivo, observaciones, ubicacion } = req.body; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 🔒 Validar Producto y Tienda
        const prodRes = await client.query('SELECT * FROM productos WHERE id = $1 AND tienda_id = $2 FOR UPDATE', [id, idTiendaLocal]);
        if (prodRes.rows.length === 0) throw new Error('Producto no encontrado en esta sucursal');
        const producto = prodRes.rows[0];
        
        const cant = parseInt(cantidad);
        if (cant <= 0) throw new Error('La cantidad debe ser mayor a 0');

        if (ubicacion === 'ESTANTE') {
            if (parseFloat(producto.stock_estante) < cant) throw new Error(`Stock insuficiente en Estante.`);
            await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2 AND tienda_id = $3', [cant, id, idTiendaLocal]);
        } else {
            const lotesRes = await client.query(`
                SELECT id, cantidad_actual FROM lotes 
                WHERE producto_id = $1 AND tienda_id = $2 AND cantidad_actual > 0 
                ORDER BY fecha_vencimiento ASC FOR UPDATE
            `, [id, idTiendaLocal]);
            
            let pendiente = cant;
            for (const lote of lotesRes.rows) {
                if (pendiente <= 0) break;
                const disponible = parseFloat(lote.cantidad_actual);
                const aRestar = Math.min(pendiente, disponible);
                await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [aRestar, lote.id]);
                pendiente -= aRestar;
            }
            await client.query('UPDATE productos SET stock_unidades = stock_unidades - $1 WHERE id = $2 AND tienda_id = $3', [cant, id, idTiendaLocal]);
        }

        const descripcion = `MERMA (${motivo}): ${observaciones || ''}`;
        
        // 🔒 Historial de movimiento atado a la sucursal
        await client.query(`
            INSERT INTO historial_movimientos 
            (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id)
            VALUES ($1, 'SALIDA', $2, (SELECT stock_unidades FROM productos WHERE id=$1 AND tienda_id=$4), $3, NOW(), $4)
        `, [id, cant, descripcion, idTiendaLocal]);

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
    const { idProducto } = req.params; 
    const { formula_id, es_muestra, nota } = req.body;
    const isMuestra = (es_muestra === true || es_muestra === 'true');
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;           

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Obtener Fórmula Base
        const formulaRes = await client.query('SELECT * FROM formulas WHERE id = $1', [formula_id]);
        if (formulaRes.rows.length === 0) throw new Error('Fórmula no encontrada');
        const formula = formulaRes.rows[0];

        // 2. Obtener Esencia
        const esenciaRes = await client.query('SELECT * FROM productos WHERE id = $1 AND tienda_id = $2', [idProducto, idTiendaLocal]);
        if (esenciaRes.rows.length === 0) throw new Error('Producto (esencia) no encontrado en esta sucursal');
        const esencia = esenciaRes.rows[0];

        // 3. Cálculos de la Proporción Solicitada
        const cantEsencia = parseFloat(formula.gramos_esencia);
        const cantAlcohol = parseFloat(formula.ml_alcohol);
        const cantFijador = parseFloat(formula.gramos_fijador);
        const volumenTester = parseInt(formula.volumen_total, 10); // Forzado a base 10

        // --- HELPER 1: Descontar Líquidos SOLO de Botellas Abiertas del Estante ---
        const descontarDeBotellaAbierta = async (criterio, cantidad, nombreRef, esBusquedaPorId = false) => {
            if (cantidad <= 0) return;
            let query = '';
            let params = [];
            
            // 🔥 CORRECCIÓN CLAVE: Eliminamos "b.estado = 'TESTER'" de las consultas.
            // Ahora la materia prima solo se descuenta de botellas en estado 'ABIERTA'.
            if (esBusquedaPorId) {
                query = `
                    SELECT b.id, b.cantidad, b.producto_id, p.contenido_gramos 
                    FROM botellas_estante b
                    JOIN productos p ON b.producto_id = p.id
                    WHERE b.producto_id = $1 AND p.tienda_id = $3
                     AND b.estado = 'ABIERTA' 
                     AND b.cantidad >= $2
                    ORDER BY b.cantidad ASC LIMIT 1 FOR UPDATE`;
                params = [criterio, cantidad, idTiendaLocal];
            } else {
                query = `
                    SELECT b.id, b.cantidad, b.producto_id, p.contenido_gramos 
                    FROM botellas_estante b
                    JOIN productos p ON b.producto_id = p.id
                    WHERE (p.categoria ILIKE $1 OR p.nombre ILIKE $1) AND p.tienda_id = $3
                     AND b.estado = 'ABIERTA' 
                     AND b.cantidad >= $2
                    ORDER BY b.cantidad ASC LIMIT 1 FOR UPDATE`;
                params = [`%${criterio}%`, cantidad, idTiendaLocal];
            }
            
            const resQ = await client.query(query, params);
            if (resQ.rows.length === 0) { 
                throw new Error(`ESTANTE VACÍO: No hay botella abierta de '${nombreRef}' con al menos ${cantidad}g/ml en el mostrador. Baja mercancía del almacén primero.`);
            }
            
            const botella = resQ.rows[0];
            const nuevaCant = parseFloat(botella.cantidad) - parseFloat(cantidad);
            const capacidad = parseFloat(botella.contenido_gramos) || 1000;
            // Cálculo del porcentaje visual de la botella restante
            const nuevoPorc = Math.max(0, Math.round((nuevaCant / Math.max(capacidad, 1)) * 100));

            await client.query('UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3', [nuevaCant, nuevoPorc, botella.id]);
            await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2 AND tienda_id = $3', [cantidad, botella.producto_id, idTiendaLocal]);
            
            const motivoLog = isMuestra ? `MUESTRA CLIENTE: ${esencia.nombre} (${nota || ''})` : `CREACIÓN TESTER ${volumenTester}ML: ${esencia.nombre}`;
            await client.query(`
                INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id)
                VALUES ($1, 'CONSUMO_INT', $2, (SELECT stock_estante FROM productos WHERE id=$1 AND tienda_id=$3), $4, NOW(), $3)
            `, [botella.producto_id, cantidad, idTiendaLocal, motivoLog]);
        };

        // --- HELPER 2: Descontar Envase SOLO del Estante ---
        const descontarEnvase = async () => {
            const resEstante = await client.query(`
                SELECT b.id, b.cantidad, b.producto_id 
                FROM botellas_estante b
                JOIN productos p ON b.producto_id = p.id
                WHERE (p.categoria IN ('Envases', 'Frascos') OR p.nombre ILIKE '%Envase%' OR p.nombre ILIKE '%Frasco%')
                AND (p.contenido_gramos = $1 OR p.nombre ILIKE $2) AND p.tienda_id = $3
                AND b.estado = 'ABIERTA' -- 🔥 CORRECCIÓN: Los frascos vacíos deben estar abiertos, no ser testers
                AND b.cantidad >= 1 LIMIT 1 FOR UPDATE
            `, [volumenTester, `%${volumenTester}%`, idTiendaLocal]);

            if (resEstante.rows.length > 0) {
                const botella = resEstante.rows[0];
                if (parseFloat(botella.cantidad) <= 1) {
                    await client.query('DELETE FROM botellas_estante WHERE id = $1', [botella.id]);
                } else {
                    await client.query('UPDATE botellas_estante SET cantidad = cantidad - 1 WHERE id = $1', [botella.id]);
                }
                await client.query('UPDATE productos SET stock_estante = stock_estante - 1 WHERE id = $1 AND tienda_id = $2', [botella.producto_id, idTiendaLocal]);
                
                const motivoLog = isMuestra ? `Envase Muestra ${volumenTester}ml` : `Envase Tester ${volumenTester}ml`;
                await client.query(`
                    INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id)
                    VALUES ($1, 'CONSUMO_INT', 1, (SELECT stock_estante FROM productos WHERE id=$1 AND tienda_id=$2), $3, NOW(), $2)
                `, [botella.producto_id, idTiendaLocal, motivoLog]);
                return;
            }
            
            throw new Error(`ESTANTE VACÍO: No hay frascos de ${volumenTester}ml en el mostrador. Baja una caja del almacén primero.`);
        };

        // 4. EJECUTAR DESCUENTOS ESTRICTOS EN ESTANTE
        await descontarDeBotellaAbierta(idProducto, cantEsencia, esencia.nombre, true);
        await descontarDeBotellaAbierta('Alcohol', cantAlcohol, 'Alcohol', false);
        await descontarDeBotellaAbierta('Fijador', cantFijador, 'Fijador', false);
        await descontarEnvase();

        // 5. FINALIZAR
        if (isMuestra) {
            await client.query('COMMIT');
            res.json({ mensaje: `Muestra de ${volumenTester}ml registrada y descontada correctamente del estante.` });
        } else {
            await client.query(`
                INSERT INTO botellas_estante (producto_id, ubicacion, fila, cantidad, estado, porcentaje_actual)
                VALUES ($1, 'A', 7, $2, 'TESTER', 100)
            `, [idProducto, volumenTester]);
            await client.query('COMMIT');
            res.json({ mensaje: `Tester de ${volumenTester}ml creado exitosamente en la fila 7.` });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error crearTester:", error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const reponerTester = async (req, res) => {
    const { idBotella } = req.params; 
    const { idOrigen } = req.body;    
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 🔒 Verificamos que ambas botellas existan en esta sucursal mediante subconsulta con productos
        const destRes = await client.query('SELECT b.* FROM botellas_estante b JOIN productos p ON b.producto_id = p.id WHERE b.id = $1 AND p.tienda_id = $2', [idBotella, idTiendaLocal]);
        if (destRes.rows.length === 0) throw new Error('Tester no encontrado en su sucursal');
        const tester = destRes.rows[0];

        const orgRes = await client.query('SELECT b.* FROM botellas_estante b JOIN productos p ON b.producto_id = p.id WHERE b.id = $1 AND p.tienda_id = $2', [idOrigen, idTiendaLocal]);
        if (orgRes.rows.length === 0) throw new Error('Botella de origen no encontrada en su sucursal');
        const origen = orgRes.rows[0];

        if (origen.producto_id !== tester.producto_id) throw new Error('El producto de origen no coincide con el tester.');

        const cantidadDeseada = 30; 
        const cantidadDisponible = parseFloat(origen.cantidad);
        const cantidadMover = Math.min(cantidadDeseada, cantidadDisponible);

        if (cantidadMover <= 0) throw new Error('La botella de origen está vacía.');

        if (cantidadMover === cantidadDisponible) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [idOrigen]);
        } else {
            await client.query('UPDATE botellas_estante SET cantidad = cantidad - $1 WHERE id = $2', [cantidadMover, idOrigen]);
        }

        await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2 AND tienda_id = $3', [cantidadMover, tester.producto_id, idTiendaLocal]);
        await client.query('UPDATE botellas_estante SET cantidad = cantidad + $1, porcentaje_actual = 100 WHERE id = $2', [cantidadMover, idBotella]);

        await client.query(`
            INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, motivo, fecha, tienda_id) 
            VALUES ($1, 'SALIDA', $2, 'REPOSICION TESTER DESDE PENDIENTES', NOW(), $3)
        `, [tester.producto_id, cantidadMover, idTiendaLocal]);

        await client.query('COMMIT');
        res.json({ mensaje: `Se recargaron ${cantidadMover}ml al tester.` });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally { client.release(); }
};

const eliminarBotella = async (req, res) => {
    const { id } = req.params;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    try {
        // 🔒 Verificamos propiedad mediante subconsulta
        const result = await pool.query(`
            DELETE FROM botellas_estante 
            WHERE id = $1 AND producto_id IN (SELECT id FROM productos WHERE tienda_id = $2)
            RETURNING id
        `, [id, idTiendaLocal]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Botella no encontrada o no pertenece a esta sucursal' });
        
        res.json({ mensaje: 'Botella eliminada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const moverStockEstante = async (req, res) => {
    const { productoId, cantidad } = req.body; 
    const cantidadMover = parseFloat(cantidad);
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 🔒 Validamos por tienda
        const prodRes = await client.query('SELECT * FROM productos WHERE id = $1 AND tienda_id = $2 FOR UPDATE', [productoId, idTiendaLocal]);
        if (prodRes.rows.length === 0) throw new Error('Producto no encontrado en su sucursal');
        const producto = prodRes.rows[0];
        
        if (parseFloat(producto.stock_unidades) < cantidadMover) { 
            throw new Error(`Stock insuficiente en Almacén. Tienes ${parseFloat(producto.stock_unidades)}, intentas bajar ${cantidadMover}.`);
        }

        const lotesRes = await client.query(`
            SELECT id, cantidad_actual FROM lotes 
            WHERE producto_id = $1 AND tienda_id = $2 AND cantidad_actual > 0 
            ORDER BY fecha_vencimiento ASC FOR UPDATE
        `, [productoId, idTiendaLocal]);
        
        let pendiente = cantidadMover;
        for (const lote of lotesRes.rows) {
            if (pendiente <= 0.001) break; 
            const disponible = parseFloat(lote.cantidad_actual);
            const aRestar = Math.min(pendiente, disponible);
            await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [aRestar, lote.id]);
            pendiente -= aRestar;
        }

        await client.query(`
            INSERT INTO botellas_estante (producto_id, ubicacion, fila, estado, cantidad, porcentaje_actual)
            VALUES ($1, 'PENDIENTE', 0, 'CERRADA', $2, 100)
        `, [productoId, cantidadMover]); 

        await client.query(
            'UPDATE productos SET stock_unidades = stock_unidades - $1, stock_estante = stock_estante + $1 WHERE id = $2 AND tienda_id = $3', 
            [cantidadMover, productoId, idTiendaLocal]
        );

        await client.query(`
            INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id)
            VALUES ($1, 'TRASLADO', $2, (SELECT stock_unidades FROM productos WHERE id=$1 AND tienda_id=$3), 'Bajado a Recepción (Descargado de Lotes)', NOW(), $3)
        `, [productoId, cantidadMover, idTiendaLocal]);

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
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 🔒 Filtramos por tienda
        const origenRes = await client.query('SELECT b.* FROM botellas_estante b JOIN productos p ON b.producto_id = p.id WHERE b.id = $1 AND p.tienda_id = $2 FOR UPDATE', [idBotellaOrigen, idTiendaLocal]);
        const origen = origenRes.rows[0];
        if (!origen) throw new Error('Lote o botella no encontrada en su sucursal');
        
        const mover = parseFloat(cantidadMover);
        if (origen.cantidad < mover) throw new Error(`Solo tienes ${origen.cantidad} disponible en este lote.`);

        if (parseFloat(origen.cantidad) === mover) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [idBotellaOrigen]);
        } else {
            await client.query('UPDATE botellas_estante SET cantidad = cantidad - $1 WHERE id = $2', [mover, idBotellaOrigen]);
        }

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

const EMPRESA_NOMBRE = 'PERFUMES C.A.';
const EMPRESA_RIF = '';

const exportarExcel = async (req, res) => {
    console.log("--- [DEBUG] Entrando a exportarExcel de productos.controller ---");
    console.log("Filtro recibido:", req.query.filtro);

    try {
        const { filtro, start, end } = req.query; 
        
        // 🛡️ DETECCIÓN INTELIGENTE DE SUCURSAL
        let idTiendaLocal = 1;
        if (req.user && req.user.tienda_id !== undefined && req.user.tienda_id !== null && req.user.tienda_id !== '') {
            idTiendaLocal = parseInt(req.user.tienda_id, 10);
        }

        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = ['developer', 'dev', 'admin', 'administrador'].includes(rolUsuario);

        if (esUsuarioMaestro) {
            const tiendaDeteccionId = req.query.tienda_id || req.query.tienda || req.query.id_tienda || req.query.idTienda || req.query.sucursal ||
                                      req.headers['x-tienda-id'] || req.headers['tienda-id'] || req.headers['tienda_id'] || req.headers['tienda'];
            
            if (tiendaDeteccionId) {
                idTiendaLocal = parseInt(tiendaDeteccionId, 10);
            }
        }

        console.log(`[REPORTE AUDIT] Descargando Excel para la Tienda ID: ${idTiendaLocal}`);

        const client = await pool.connect();
        
        // Creamos el Libro de Excel
        const workbook = new ExcelJS.Workbook();
        workbook.creator = EMPRESA_NOMBRE;
        workbook.created = new Date();

        // Formateo visual del rango de fechas recibido
        const fechaInicioFmt = start ? new Date(start + 'T00:00:00').toLocaleDateString('es-VE') : 'N/A';
        const fechaFinFmt = end ? new Date(end + 'T00:00:00').toLocaleDateString('es-VE') : 'N/A';
        const textoFechas = (start && end) ? `Período: ${fechaInicioFmt} al ${fechaFinFmt}` : `Fecha de Emisión: ${new Date().toLocaleDateString('es-VE')}`;

        // -------------------------------------------------------------------------
        // HOJA 1: INFO. INVENTARIO CONSOLIDADO (1 FILA POR PRODUCTO - LEY ISLR 177)
        // -------------------------------------------------------------------------
        if (filtro === 'todo' || filtro === 'inventario') {
            const sheetInv = workbook.addWorksheet('Movimiento de Inventario');

            // 1. Filas de Encabezado Fijo
            sheetInv.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 12 };
            sheetInv.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheetInv.addRow([textoFechas]).font = { bold: true, size: 9 };
            sheetInv.addRow(['Libro de Movimiento de Inventarios (Art. 177 Ley de ISLR)']).font = { bold: true, size: 11 };
            sheetInv.addRow([]);

            // 2. Encabezados Agrupados (Fila 6) - 🚨 SE AGREGA 'GÉNERO'
            const rowCategorias = sheetInv.addRow([
                'Código', 'Referencia', 'Descripción', 'Departamento', 'Sección', 'Marca', 'Género', 'Costo Unitario',
                'EXISTENCIA INICIAL', '', 'ENTRADAS', '', 'SALIDAS', '', 'AUTOCONSUMO', '', 'INVENTARIO ACTUAL', ''
            ]);

            // Combinar celdas HORIZONTALES (Desplazadas 1 columna a la derecha)
            sheetInv.mergeCells('I6:J6'); sheetInv.mergeCells('K6:L6');
            sheetInv.mergeCells('M6:N6'); sheetInv.mergeCells('O6:P6'); sheetInv.mergeCells('Q6:R6');

            // 3. Encabezados Detallados (Fila 7)
            const rowDetalle = sheetInv.addRow([
                '', '', '', '', '', '', '', '',
                'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto'
            ]);

            // Combinar celdas VERTICALES (De A a H)
            const columnasVerticales = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
            columnasVerticales.forEach(col => {
                sheetInv.mergeCells(`${col}6:${col}7`);
            });

            // Aplicar estilos a los encabezados
            [rowCategorias, rowDetalle].forEach(row => {
                row.font = { bold: true };
                row.alignment = { horizontal: 'center', vertical: 'middle' };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            });

            // 4. Lógica de Consulta Agregada - 🚨 SE AGREGA p.genero
            let queryConsolidado = `
                SELECT 
                    p.id, 
                    COALESCE(p.codigo, 'S/C') as codigo, 
                    p.nombre, 
                    p.marca, 
                    COALESCE(p.genero, 'UNISEX') as genero,
                    p.costo, 
                    p.categoria, 
                    p.unidad_medida,
                    p.es_producto_terminado,
                    p.stock_unidades,
                    p.stock_estante,
                    COALESCE(SUM(CASE WHEN h.tipo_movimiento = 'ENTRADA' THEN h.cantidad ELSE 0 END), 0) as total_entradas,
                    COALESCE(SUM(CASE WHEN h.tipo_movimiento = 'SALIDA' AND (h.motivo NOT ILIKE '%MERMA%' AND h.motivo NOT ILIKE '%CONSUMO%' AND h.motivo NOT ILIKE '%ROTURA%' AND h.motivo NOT ILIKE '%TESTER%' AND h.motivo NOT ILIKE '%DAÑO%') THEN h.cantidad ELSE 0 END), 0) as total_salidas,
                    COALESCE(SUM(CASE WHEN h.tipo_movimiento IN ('CONSUMO_INT', 'MERMA', 'TRASLADO', 'AJUSTE_SALIDA') OR (h.tipo_movimiento = 'SALIDA' AND (h.motivo ILIKE '%MERMA%' OR h.motivo ILIKE '%CONSUMO%' OR h.motivo ILIKE '%ROTURA%' OR h.motivo ILIKE '%TESTER%' OR h.motivo ILIKE '%DAÑO%')) THEN h.cantidad ELSE 0 END), 0) as total_autoconsumo
                FROM productos p
                LEFT JOIN historial_movimientos h ON h.producto_id = p.id ${start && end ? 'AND h.fecha::date BETWEEN $2 AND $3' : ''}
                WHERE p.tienda_id = $1 AND p.activo = true
            `;

            let paramsConsolidado = [idTiendaLocal];
            if (start && end) {
                paramsConsolidado.push(start, end);
            }

            const catQuery = req.query.categoria;
            if (catQuery && catQuery !== 'todos') {
                const paramIdx = paramsConsolidado.length + 1;
                const catUpper = catQuery.toUpperCase();
                if (catUpper === 'PT' || catUpper === 'TERMINADOS' || catUpper === 'COMPLETO') {
                    queryConsolidado += ` AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminado%' OR p.categoria ILIKE '%perfume%')`;
                } else if (catUpper === 'INSUMOS' || catUpper === 'MATERIA_PRIMA') {
                    queryConsolidado += ` AND (p.categoria ILIKE '%esencia%' OR p.categoria ILIKE '%fijador%' OR p.categoria ILIKE '%alcohol%' OR p.categoria ILIKE '%frasco%' OR p.categoria ILIKE '%envase%')`;
                } else if (catUpper === 'FRASCOS' || catUpper === 'FRASCO') {
                    queryConsolidado += ` AND (p.categoria ILIKE '%frasco%' OR p.categoria ILIKE '%envase%')`;
                } else {
                    queryConsolidado += ` AND p.categoria ILIKE $${paramIdx}`;
                    paramsConsolidado.push(`%${catQuery.trim()}%`);
                }
            }

            queryConsolidado += ` GROUP BY p.id, p.codigo, p.nombre, p.marca, p.genero, p.costo, p.categoria, p.unidad_medida, p.es_producto_terminado, p.stock_unidades, p.stock_estante ORDER BY p.nombre ASC`;

            const resConsolidado = await client.query(queryConsolidado, paramsConsolidado);

            // 5. Rellenar con Información consolidada
            resConsolidado.rows.forEach(p => {
                const costoUnit = parseFloat(p.costo || 0);
                const uni = (p.unidad_medida || '').toUpperCase();
                const cat = (p.categoria || '').toUpperCase();
                const isLiquid = uni === 'GRAMOS' || uni === 'ML' || cat.includes('ESENCIA') || cat.includes('FIJADOR') || cat.includes('ALCOHOL');

                const divisor = isLiquid ? 1000 : 1;
                const ent = parseFloat(p.total_entradas) / divisor;
                const sal = parseFloat(p.total_salidas) / divisor;
                const auto = parseFloat(p.total_autoconsumo) / divisor;
                
                const stockActual = (parseFloat(p.stock_unidades) + parseFloat(p.stock_estante)) / divisor;
                const stockInicial = Math.max(0, stockActual - ent + sal + auto);

                let dpto = 'GENERAL', seccion = 'OTROS';
                if (cat.includes('PERFUME')) {
                    dpto = 'VENTAS';
                    seccion = 'PERFUMES TERMINADOS';
                } else if (['ESENCIA', 'ALCOHOL', 'FIJADOR', 'FRASCO', 'ENVASE'].some(term => cat.includes(term))) {
                    dpto = 'PRODUCCIÓN';
                    seccion = 'MATERIA PRIMA';
                }

                // 🚨 SE INCLUYE p.genero EN LA FILA EN LA POSICIÓN CORRECTA
                const fila = sheetInv.addRow([
                    p.id,
                    p.codigo,
                    p.nombre,
                    dpto,
                    seccion,
                    p.marca || 'N/A',
                    (p.genero || 'UNISEX').toUpperCase(),
                    costoUnit,
                    stockInicial,
                    stockInicial * costoUnit,
                    ent,
                    ent * costoUnit,
                    sal,
                    sal * costoUnit,
                    auto,
                    auto * costoUnit,
                    stockActual,
                    stockActual * costoUnit
                ]);

                // FORMATOS VISUALES PARA EXCEL (Ajustados por el desplazamiento de +1 columna)
                const fmtStock = isLiquid ? '#,##0.000' : '#,##0';
                
                fila.getCell(8).numFmt = '"$"#,##0.00'; // Costo Unitario
                
                fila.getCell(9).numFmt = fmtStock;   // Cantidad Inicial
                fila.getCell(10).numFmt = '"$"#,##0.00';
                
                fila.getCell(11).numFmt = fmtStock;  // Cantidad Entrada
                fila.getCell(12).numFmt = '"$"#,##0.00';
                
                fila.getCell(13).numFmt = fmtStock;  // Cantidad Salida
                fila.getCell(14).numFmt = '"$"#,##0.00';
                
                fila.getCell(15).numFmt = fmtStock;  // Cantidad Autoconsumo
                fila.getCell(16).numFmt = '"$"#,##0.00';
                
                fila.getCell(17).numFmt = fmtStock;  // Cantidad Actual
                fila.getCell(18).numFmt = '"$"#,##0.00';
            });

            const ultimaFilaNum = sheetInv.lastRow ? sheetInv.lastRow.number : 7;
            sheetInv.autoFilter = {
                from: { row: 6, column: 1 },
                to: { row: ultimaFilaNum, column: 18 }
            };

            sheetInv.getColumn('C').width = 35; // Descripción
            sheetInv.getColumn('G').width = 15; // Género
        }

        // -------------------------------------------------------------------------
        // HOJA ADICIONAL: TRAZABILIDAD DETALLADA / KARDEX MOVIEMIENTO A MOVIMIENTO
        // -------------------------------------------------------------------------
        if (filtro === 'todo' || filtro === 'trazabilidad' || filtro === 'kardex') {
            const sheetTraz = workbook.addWorksheet('Trazabilidad por Referencia');

            sheetTraz.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 12 };
            sheetTraz.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheetTraz.addRow([textoFechas]).font = { bold: true, size: 9 };
            sheetTraz.addRow(['Reporte de Trazabilidad y Kardex Progresivo de Movimientos']).font = { bold: true, size: 11 };
            sheetTraz.addRow([]);

            const rowCatTraz = sheetTraz.addRow([
                'Oper Nº', 'Fecha', 'Referencia', 'Descripción', 'Departamento', 'Sección', 'Marca', 'Costo Unitario',
                'EXISTENCIA INICIAL', '', 'ENTRADAS', '', 'SALIDAS', '', 'AUTOCONSUMO', '', 'INVENTARIO ACTUAL', '', 'MOTIVO / EVENTO'
            ]);

            sheetTraz.mergeCells('I6:J6'); sheetTraz.mergeCells('K6:L6');
            sheetTraz.mergeCells('M6:N6'); sheetTraz.mergeCells('O6:P6'); sheetTraz.mergeCells('Q6:R6');

            const rowDetTraz = sheetTraz.addRow([
                '', '', '', '', '', '', '', '',
                'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto', ''
            ]);

            ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'S'].forEach(col => sheetTraz.mergeCells(`${col}6:${col}7`));

            [rowCatTraz, rowDetTraz].forEach(row => {
                row.font = { bold: true };
                row.alignment = { horizontal: 'center', vertical: 'middle' };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            });

            let queryTraz = `
                SELECT h.id, h.fecha, p.codigo, p.nombre, p.marca, p.costo, h.tipo_movimiento, h.cantidad, h.motivo, p.categoria, p.unidad_medida
                FROM historial_movimientos h
                JOIN productos p ON h.producto_id = p.id
                WHERE p.tienda_id = $1
            `;
            let paramsTraz = [idTiendaLocal];
            let pIdxTraz = 2;

            if (start && end) {
                queryTraz += ` AND h.fecha::date BETWEEN $${pIdxTraz} AND $${pIdxTraz + 1}`;
                paramsTraz.push(start, end);
                pIdxTraz += 2;
            }

            const refFilter = req.query.producto || req.query.referencia;
            if (refFilter && refFilter.trim() !== '') {
                const listaRefs = refFilter.split(',').map(r => r.trim()).filter(r => r !== '');
                if (listaRefs.length > 0) {
                    queryTraz += ` AND (p.codigo = ANY($${pIdxTraz}) OR p.id::text = ANY($${pIdxTraz}) OR p.nombre ILIKE ANY($${pIdxTraz}))`;
                    paramsTraz.push(listaRefs.map(r => `%${r}%`)); 
                    pIdxTraz++;
                }
            } else {
                const catQuery = req.query.categoria;
                if (catQuery && catQuery !== 'todos') {
                    const catUpper = catQuery.toUpperCase();
                    if (catUpper === 'PT' || catUpper === 'TERMINADOS') {
                        queryTraz += ` AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminado%' OR p.categoria ILIKE '%perfume%')`;
                    } else if (catUpper === 'INSUMOS') {
                        queryTraz += ` AND (p.categoria ILIKE '%esencia%' OR p.categoria ILIKE '%fijador%' OR p.categoria ILIKE '%alcohol%' OR p.categoria ILIKE '%frasco%' OR p.categoria ILIKE '%envase%')`;
                    } else {
                        queryTraz += ` AND p.categoria ILIKE $${pIdxTraz}`;
                        paramsTraz.push(`%${catQuery.trim()}%`);
                        pIdxTraz++;
                    }
                }
            }

            queryTraz += ` ORDER BY p.codigo ASC, h.fecha ASC`;

            const resTraz = await client.query(queryTraz, paramsTraz);
            const saldoProgresivo = {};

            resTraz.rows.forEach(m => {
                let fila = new Array(19).fill(0);
                const cod = m.codigo || 'S/N';
                if (!saldoProgresivo[cod]) saldoProgresivo[cod] = { cant: 0, monto: 0 };

                const costoUnit = parseFloat(m.costo || 0);
                let cant = parseFloat(m.cantidad || 0);
                const uni = (m.unidad_medida || '').toUpperCase();
                const cat = (m.categoria || '').toUpperCase();
                const isLiquid = uni === 'GRAMOS' || uni === 'ML' || cat.includes('ESENCIA') || cat.includes('FIJADOR') || cat.includes('ALCOHOL');

                if (isLiquid) cant = cant / 1000;
                const montoMov = cant * costoUnit;

                fila[8] = saldoProgresivo[cod].cant;
                fila[9] = saldoProgresivo[cod].monto;

                fila[0] = m.id;
                fila[1] = new Date(m.fecha).toLocaleDateString('es-VE');
                fila[2] = cod;
                fila[3] = m.nombre;

                if (cat.includes('PERFUME')) { fila[4] = 'VENTAS'; fila[5] = 'PERFUMES TERMINADOS'; }
                else if (['ESENCIA', 'ALCOHOL', 'FIJADOR', 'FRASCO', 'ENVASE'].some(t => cat.includes(t))) { fila[4] = 'PRODUCCIÓN'; fila[5] = 'MATERIA PRIMA'; }
                else { fila[4] = 'GENERAL'; fila[5] = 'OTROS'; }

                fila[6] = m.marca || 'N/A';
                fila[7] = costoUnit;

                const motivoUpper = (m.motivo || '').toUpperCase();
                const esMermaOConsumo = motivoUpper.includes('MERMA') || motivoUpper.includes('CONSUMO') || motivoUpper.includes('ROTURA') || motivoUpper.includes('DAÑO') || motivoUpper.includes('TESTER');

                if (m.tipo_movimiento === 'ENTRADA') {
                    fila[10] = cant; fila[11] = montoMov;
                    saldoProgresivo[cod].cant += cant;
                } else if (m.tipo_movimiento === 'SALIDA') {
                    if (esMermaOConsumo) {
                        fila[14] = cant; fila[15] = montoMov;
                    } else {
                        fila[12] = cant; fila[13] = montoMov;
                    }
                    saldoProgresivo[cod].cant = Math.max(0, saldoProgresivo[cod].cant - cant);
                } else if (['CONSUMO_INT', 'MERMA', 'TRASLADO', 'AJUSTE_SALIDA'].includes(m.tipo_movimiento)) {
                    fila[14] = cant; fila[15] = montoMov;
                    saldoProgresivo[cod].cant = Math.max(0, saldoProgresivo[cod].cant - cant);
                }

                saldoProgresivo[cod].monto = saldoProgresivo[cod].cant * costoUnit;
                fila[16] = saldoProgresivo[cod].cant;
                fila[17] = saldoProgresivo[cod].monto;
                fila[18] = m.motivo || 'N/A';

                const rowAdded = sheetTraz.addRow(fila);
                const fmtStock = isLiquid ? '#,##0.000' : '#,##0';

                rowAdded.getCell(8).numFmt = '"$"#,##0.00';
                [9, 11, 13, 15, 17].forEach(c => rowAdded.getCell(c).numFmt = fmtStock);
                [10, 12, 14, 16, 18].forEach(c => rowAdded.getCell(c).numFmt = '"$"#,##0.00');
            });

            const ultFilaTraz = sheetTraz.lastRow ? sheetTraz.lastRow.number : 7;
            sheetTraz.autoFilter = { from: { row: 6, column: 1 }, to: { row: ultFilaTraz, column: 19 } };
            sheetTraz.getColumn('D').width = 35;
            sheetTraz.getColumn('S').width = 40;
        }

        // ---------------------------------------------------------
        // HOJA 2: ESTANTE (Tienda / Botellas Abiertas + AutoFiltro)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'estante') {
            const sheetEst = workbook.addWorksheet('Estante (Tienda)');
            
            sheetEst.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 12 };
            sheetEst.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheetEst.addRow(['INVENTARIO DE ESTANTE (MOSTRADOR)']).font = { bold: true, size: 11 };
            sheetEst.addRow([textoFechas]).font = { bold: true, size: 9 };
            sheetEst.addRow([]);

            const resEst = await client.query(`
                SELECT b.ubicacion, b.fila, p.nombre, b.cantidad, p.unidad_medida, b.porcentaje_actual
                FROM botellas_estante b JOIN productos p ON b.producto_id = p.id
                WHERE p.tienda_id = $1
                ORDER BY b.ubicacion, b.fila
            `, [idTiendaLocal]);

            const headersEst = sheetEst.addRow(['UBICACIÓN', 'FILA', 'PRODUCTO', 'CANTIDAD REAL', 'UNIDAD', '% VISUAL']);
            headersEst.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headersEst.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            const filaEncabezadoEst = headersEst.number;

            resEst.rows.forEach(b => {
                sheetEst.addRow([
                    b.ubicacion, b.fila, b.nombre, parseFloat(b.cantidad), b.unidad_medida, `${b.porcentaje_actual}%`
                ]);
            });

            const ultimaFilaEst = sheetEst.lastRow ? sheetEst.lastRow.number : filaEncabezadoEst;
            sheetEst.autoFilter = {
                from: { row: filaEncabezadoEst, column: 1 },
                to: { row: ultimaFilaEst, column: 6 }
            };

            sheetEst.getColumn(1).width = 12;
            sheetEst.getColumn(2).width = 8;
            sheetEst.getColumn(3).width = 35;
            sheetEst.getColumn(4).width = 15;
            sheetEst.getColumn(5).width = 12;
            sheetEst.getColumn(6).width = 12;
        }

        // ---------------------------------------------------------
        // HOJA 3: HISTORIAL DE VENTAS
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'ventas') {
            const sheetVentas = workbook.addWorksheet('Historial Ventas');
            
            sheetVentas.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 12 };
            sheetVentas.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheetVentas.addRow(['HISTORIAL DE VENTAS CONSOLIDADAS']).font = { bold: true, size: 11 };
            sheetVentas.addRow([textoFechas]).font = { bold: true, size: 9 };
            sheetVentas.addRow([]);

            const resVentas = await client.query(`
                SELECT 
                    v.id, v.fecha, c.nombre as cliente, v.total as total_usd,
                    COALESCE((SELECT SUM(pag.monto * pag.tasa_cambio) FROM pagos pag WHERE pag.venta_id = v.id), 0) as total_bs_calc
                FROM ventas v
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE v.tienda_id = $1
                ORDER BY v.fecha DESC
            `, [idTiendaLocal]);

            const headersVentas = sheetVentas.addRow(['ID VENTA', 'FECHA', 'CLIENTE', 'TOTAL (USD)', 'TOTAL (BS)']);
            headersVentas.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headersVentas.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
            const filaEncabezadoVentas = headersVentas.number;

            let sumUSD = 0;
            let sumBS = 0;

            resVentas.rows.forEach(v => {
                const usd = parseFloat(v.total_usd || 0);
                const bs = parseFloat(v.total_bs_calc || 0);
                sumUSD += usd;
                sumBS += bs;

                sheetVentas.addRow([
                    v.id,
                    new Date(v.fecha).toLocaleString('es-VE'),
                    v.cliente || 'Consumidor Final',
                    usd,
                    bs
                ]);
            });

            const ultimaFilaVentas = sheetVentas.lastRow ? sheetVentas.lastRow.number : filaEncabezadoVentas;
            sheetVentas.autoFilter = {
                from: { row: filaEncabezadoVentas, column: 1 },
                to: { row: ultimaFilaVentas, column: 5 }
            };

            sheetVentas.addRow(['', '', '', '', '']); 
            const rowGranTotal = sheetVentas.addRow(['', 'TOTALES GENERALES:', '', sumUSD, sumBS]);
            
            rowGranTotal.font = { bold: true, size: 12 };
            rowGranTotal.getCell(4).numFmt = '"$"#,##0.00';
            rowGranTotal.getCell(5).numFmt = '"Bs "#,##0.00';
            rowGranTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };

            sheetVentas.getColumn(1).width = 12;
            sheetVentas.getColumn(2).width = 22;
            sheetVentas.getColumn(3).width = 35;
            sheetVentas.getColumn(4).width = 18;
            sheetVentas.getColumn(5).width = 22;

            sheetVentas.getColumn(4).numFmt = '"$"#,##0.00';
            sheetVentas.getColumn(5).numFmt = '"Bs "#,##0.00';
        }

        // ---------------------------------------------------------
        // HOJA 4: LOTES Y VENCIMIENTOS
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'lotes') {
            const sheetLotes = workbook.addWorksheet('Lotes y Vencimientos');

            sheetLotes.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 12 };
            sheetLotes.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheetLotes.addRow(['CONTROL DE LOTES Y VENCIMIENTOS']).font = { bold: true, size: 11 };
            sheetLotes.addRow([textoFechas]).font = { bold: true, size: 9 };
            sheetLotes.addRow([]);

            const resLotes = await client.query(`
                SELECT l.codigo_lote, p.nombre, l.cantidad_actual, l.fecha_vencimiento
                FROM lotes l JOIN productos p ON l.producto_id = p.id
                WHERE l.cantidad_actual > 0 AND p.tienda_id = $1 
                ORDER BY l.fecha_vencimiento ASC
            `, [idTiendaLocal]);

            const headersLotes = sheetLotes.addRow(['LOTE', 'PRODUCTO', 'CANTIDAD', 'VENCE', 'ESTADO']);
            headersLotes.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headersLotes.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            const filaEncabezadoLotes = headersLotes.number;

            const hoy = new Date();
            resLotes.rows.forEach(l => {
                const vence = new Date(l.fecha_vencimiento);
                const diasRestantes = Math.ceil((vence - hoy) / (1000 * 60 * 60 * 24));
                let estado = 'OK';
                if (diasRestantes < 0) estado = 'VENCIDO';
                else if (diasRestantes < 30) estado = 'POR VENCER';

                const row = sheetLotes.addRow([
                    l.codigo_lote, l.nombre, parseFloat(l.cantidad_actual), vence.toLocaleDateString('es-VE'), estado
                ]);

                if (estado === 'VENCIDO') row.getCell(5).font = { color: { argb: 'FFFF0000' }, bold: true };
                if (estado === 'POR VENCER') row.getCell(5).font = { color: { argb: 'FFF59E0B' }, bold: true };
            });

            const ultimaFilaLotes = sheetLotes.lastRow ? sheetLotes.lastRow.number : filaEncabezadoLotes;
            sheetLotes.autoFilter = {
                from: { row: filaEncabezadoLotes, column: 1 },
                to: { row: ultimaFilaLotes, column: 5 }
            };

            sheetLotes.getColumn(1).width = 18;
            sheetLotes.getColumn(2).width = 35;
            sheetLotes.getColumn(3).width = 14;
            sheetLotes.getColumn(4).width = 16;
            sheetLotes.getColumn(5).width = 15;
        }

        // ---------------------------------------------------------
        // HOJA 5: MERMAS Y SALIDAS
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'mermas') {
            const sheetMermas = workbook.addWorksheet('Mermas y Salidas');

            sheetMermas.addRow([EMPRESA_NOMBRE]).font = { bold: true, size: 12 };
            sheetMermas.addRow([`R.I.F.: ${EMPRESA_RIF}`]).font = { bold: true, size: 10 };
            sheetMermas.addRow(['REGISTRO DE MERMAS Y SALIDAS DE INVENTARIO']).font = { bold: true, size: 11 };
            sheetMermas.addRow([textoFechas]).font = { bold: true, size: 9 };
            sheetMermas.addRow([]);

            const resMermas = await client.query(`
                SELECT h.fecha, p.nombre, h.cantidad, h.motivo, h.tipo_movimiento
                FROM historial_movimientos h JOIN productos p ON h.producto_id = p.id
                WHERE (h.tipo_movimiento IN ('MERMA', 'CONSUMO_INT') OR h.motivo ILIKE '%MERMA%' OR h.motivo ILIKE '%ROTURA%') AND p.tienda_id = $1
                ORDER BY h.fecha DESC
            `, [idTiendaLocal]);

            const headersMermas = sheetMermas.addRow(['FECHA', 'PRODUCTO', 'CANTIDAD', 'TIPO', 'MOTIVO / OBSERVACIÓN']);
            headersMermas.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headersMermas.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3342F' } };
            const filaEncabezadoMermas = headersMermas.number;

            resMermas.rows.forEach(m => {
                sheetMermas.addRow([
                    new Date(m.fecha).toLocaleString('es-VE'),
                    m.nombre,
                    parseFloat(m.cantidad),
                    m.tipo_movimiento,
                    m.motivo
                ]);
            });

            const ultimaFilaMermas = sheetMermas.lastRow ? sheetMermas.lastRow.number : filaEncabezadoMermas;
            sheetMermas.autoFilter = {
                from: { row: filaEncabezadoMermas, column: 1 },
                to: { row: ultimaFilaMermas, column: 5 }
            };

            sheetMermas.getColumn(1).width = 22;
            sheetMermas.getColumn(2).width = 35;
            sheetMermas.getColumn(3).width = 14;
            sheetMermas.getColumn(4).width = 15;
            sheetMermas.getColumn(5).width = 45;
        }

        client.release();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_Inventario_${idTiendaLocal}_${new Date().toISOString().slice(0,10)}.xlsx`);

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
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cantidadMover = Math.round(parseFloat(cantidad));
        
        // 🔒 Filtrar por tienda
        const botellaRes = await client.query(`
            SELECT b.*, p.nombre, p.contenido_gramos 
            FROM botellas_estante b 
            JOIN productos p ON b.producto_id = p.id 
            WHERE b.id = $1 AND p.tienda_id = $2 FOR UPDATE`, [idBotella, idTiendaLocal]);
                    
        if (botellaRes.rows.length === 0) throw new Error('Botella no encontrada en esta sucursal.');
        
        const botella = botellaRes.rows[0];
        const capacidadTotal = parseFloat(botella.contenido_gramos) || 1000;
        let nuevaCantidad = parseFloat(botella.cantidad);

        if (tipo === 'MERMA') {
            if (cantidadMover > nuevaCantidad) throw new Error(`Stock insuficiente.`);
            nuevaCantidad -= cantidadMover;
            await client.query('UPDATE productos SET stock_estante = stock_estante - $1 WHERE id = $2 AND tienda_id = $3', [cantidadMover, botella.producto_id, idTiendaLocal]);
        } else {
            nuevaCantidad += cantidadMover;
            await client.query('UPDATE productos SET stock_estante = stock_estante + $1 WHERE id = $2 AND tienda_id = $3', [cantidadMover, botella.producto_id, idTiendaLocal]);
        }

        const nuevoPorcentaje = Math.min(100, Math.round((nuevaCantidad / capacidadTotal) * 100));

        if (nuevaCantidad <= 0.01) {
            await client.query('DELETE FROM botellas_estante WHERE id = $1', [idBotella]);
        } else {
            await client.query(`UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3`, [nuevaCantidad, nuevoPorcentaje, idBotella]);
        }

        await client.query(`
            INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id) 
            VALUES ($1, $2, $3, $4, $5, NOW(), $6)`, 
            [botella.producto_id, tipo, cantidadMover, nuevaCantidad, `${motivo} (${esPerfumeCompleto ? 'Perfume' : 'Insumo'})`, idTiendaLocal]
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
    // 🛡️ VALIDACIÓN DE ROL (Añadido para evitar el 403)
    const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
    const esUsuarioMaestro = ['developer', 'dev', 'admin', 'administrador', 'superadmin', 'gerente general'].includes(rolUsuario);

    if (!esUsuarioMaestro) {
        return res.status(403).json({ error: 'Acceso denegado. Se requieren privilegios de administrador.' });
    }

    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const productosRes = await client.query("SELECT id, nombre, stock_estante, contenido_gramos FROM productos WHERE activo = true AND tienda_id = $1", [idTiendaLocal]);
        const productos = productosRes.rows;
        let productosCorregidos = 0;

        for (const prod of productos) {
            const stockDeberia = parseFloat(prod.stock_estante || 0);
            
            const botellasRes = await client.query(`
                SELECT id, cantidad, estado 
                FROM botellas_estante 
                WHERE producto_id = $1 
                ORDER BY CASE WHEN estado = 'ABIERTA' THEN 1 ELSE 2 END ASC, cantidad ASC
            `, [prod.id]);
            
            const botellas = botellasRes.rows;
            const stockVisual = botellas.reduce((acc, b) => acc + parseFloat(b.cantidad), 0);

            if (stockVisual > (stockDeberia + 0.05)) { 
                let diferenciaABorrar = stockVisual - stockDeberia;
                for (const b of botellas) {
                    if (diferenciaABorrar <= 0.001) break; 
                    const disponibleEnBotella = parseFloat(b.cantidad);
                    const aQuitar = Math.min(diferenciaABorrar, disponibleEnBotella);
                    
                    const nuevaCant = disponibleEnBotella - aQuitar;
                    if (nuevaCant <= 0.01) {
                        await client.query('DELETE FROM botellas_estante WHERE id = $1', [b.id]);
                    } else {
                        const capacidad = parseFloat(prod.contenido_gramos) || 1000;
                        const nuevoPorc = Math.round((nuevaCant / capacidad) * 100);
                        await client.query("UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3", [nuevaCant, nuevoPorc, b.id]);
                    }
                    diferenciaABorrar -= aQuitar;
                }
                productosCorregidos++;
            }
        }
        await client.query('COMMIT');
        res.json({ mensaje: `Corrección aplicada: Ajustados ${productosCorregidos} productos.` });
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
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let totalMovidos = 0;

        for (const id of ids) {
            // 🔒 Filtro por tienda
            const prodRes = await client.query('SELECT stock_unidades FROM productos WHERE id = $1 AND tienda_id = $2 FOR UPDATE', [id, idTiendaLocal]);
            if (prodRes.rows.length === 0) continue;
            const stock = parseFloat(prodRes.rows[0].stock_unidades);
            if (stock <= 0) continue; 

            // 🔒 Vaciamos los lotes que pertenezcan a la tienda
            await client.query('UPDATE lotes SET cantidad_actual = 0 WHERE producto_id = $1 AND tienda_id = $2', [id, idTiendaLocal]);

            await client.query(`
                INSERT INTO botellas_estante (producto_id, ubicacion, fila, estado, cantidad, porcentaje_actual)
                VALUES ($1, $2, $3, 'CERRADA', $4, 100)
            `, [id, destino, fila, stock]);

            await client.query(`
                UPDATE productos 
                SET stock_estante = stock_estante + $1, stock_unidades = 0 
                WHERE id = $2 AND tienda_id = $3
            `, [stock, id, idTiendaLocal]);

            await client.query(`
                INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id)
                VALUES ($1, 'TRASLADO', $2, (SELECT stock_unidades + stock_estante FROM productos WHERE id=$1 AND tienda_id=$3), $4, NOW(), $3)
            `, [id, stock, `Vaciado Masivo a Estante ${destino} (Nivel ${fila})`, idTiendaLocal]);
            
            totalMovidos++;
        }
        await client.query('COMMIT');
        res.json({ mensaje: `Se procesaron exitosamente ${totalMovidos} productos hacia el mostrador en su sucursal.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en Vaciado Masivo:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// Pseudo-código de lo que deberías tener en tu backend
async function registrarMovimiento(id, tipo, cantidad, usuarioId) {
    // Dentro de tu función de registrarMovimiento
console.log("Intentando registrar en historial:", { producto_id, tipo, cantidad }); 

const result = await db.query(
    "INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, fecha, usuario_id) VALUES ($1, $2, $3, NOW(), $4)",
    [id, tipo, cantidad, usuarioId]
);
console.log("¡Registro exitoso!");
}

const getReporteKardex = async (req, res) => {
    const { inicio, fin } = req.query;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    try {
        // 🛡️ CORREGIDO: p.precio_costo corregido por p.costo
        const queryDetalle = `
            SELECT h.id as oper_nro, h.fecha, p.codigo as referencia, p.nombre as descripcion,
                   'ARTICULOS DE VENTAS' as departamento, 'MATERIA PRIMA' as seccion, p.marca,
                   p.costo as costo_unitario, h.tipo_movimiento, h.cantidad
            FROM historial_movimientos h
            JOIN productos p ON h.producto_id = p.id
            WHERE h.fecha BETWEEN $1 AND $2 AND p.tienda_id = $3
            ORDER BY h.fecha ASC;
        `;
        const resultDetalle = await pool.query(queryDetalle, [inicio, fin, idTiendaLocal]);

        // 2. Crear Excel usando ExcelJS
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Kardex');
        
        sheet.columns = [
            { header: 'Oper Nº', key: 'oper_nro', width: 10 },
            { header: 'Fecha', key: 'fecha', width: 15 },
            { header: 'Referencia', key: 'referencia', width: 15 },
            { header: 'Descripción', key: 'descripcion', width: 30 },
            { header: 'Marca', key: 'marca', width: 15 },
            { header: 'Costo', key: 'costo', width: 12 },
            { header: 'Tipo', key: 'tipo', width: 15 },
            { header: 'Cantidad', key: 'cantidad', width: 10 }
        ];

        resultDetalle.rows.forEach(item => {
            sheet.addRow({
                oper_nro: item.oper_nro,
                fecha: new Date(item.fecha).toLocaleDateString(),
                referencia: item.referencia,
                descripcion: item.descripcion,
                marca: item.marca,
                costo: parseFloat(item.costo_unitario || 0),
                tipo: item.tipo_movimiento,
                cantidad: parseFloat(item.cantidad)
            });
        });

        // 3. Enviar el archivo
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Kardex_${inicio}_${fin}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error en getReporteKardex:", error);
        res.status(500).json({ error: "Error al generar el reporte" });
    }
};

const obtenerEstancamiento = async (req, res) => {
    const { dias, categoria, start, end, busqueda } = req.query;
    let idTiendaLocal = 1;
    if (req.user && req.user.tienda_id !== undefined && req.user.tienda_id !== null && req.user.tienda_id !== '') {
        idTiendaLocal = parseInt(req.user.tienda_id, 10);
    }

    const client = await pool.connect();

    try {
        let filterCat = "";
        if (categoria === 'ESENCIAS') {
            filterCat = "AND p.categoria ILIKE '%esencia%'";
        } else if (categoria === 'TERMINADOS') {
            filterCat = "AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminados%' OR p.categoria ILIKE '%perfume%')";
        } else if (categoria === 'INSUMOS') {
            filterCat = "AND p.categoria NOT ILIKE '%esencia%' AND p.categoria NOT ILIKE '%terminados%' AND p.categoria NOT ILIKE '%perfume%'";
        }

        let filterBusqueda = "";
        let params = [idTiendaLocal];
        let paramIdx = 2;

        if (busqueda && busqueda.trim() !== '') {
            filterBusqueda = ` AND (p.nombre ILIKE $${paramIdx} OR p.codigo ILIKE $${paramIdx} OR p.categoria ILIKE $${paramIdx})`;
            params.push(`%${busqueda.trim()}%`);
            paramIdx++;
        }

        let filterInactividad = "";
        if (dias === 'CUSTOM' && start && end) {
            filterInactividad = `HAVING (MAX(v_fechas.fecha_movimiento)::date NOT BETWEEN $${paramIdx}::date AND $${paramIdx + 1}::date OR MAX(v_fechas.fecha_movimiento) IS NULL) AND (p.stock_unidades + p.stock_estante) > 0`;
            params.push(start, end);
        } else if (dias === 'LOTES_NUEVOS') {
            filterInactividad = "HAVING MAX(v_fechas.fecha_movimiento) IS NULL AND (p.stock_unidades + p.stock_estante) > 0";
        } else {
            const numDias = parseInt(dias, 10) || 30;
            filterInactividad = `HAVING (MAX(v_fechas.fecha_movimiento) < NOW() - INTERVAL '${numDias} days' OR MAX(v_fechas.fecha_movimiento) IS NULL) AND (p.stock_unidades + p.stock_estante) > 0`;
        }

        const query = `
            WITH movimientos_ventas AS (
                SELECT dv.producto_id, v.fecha as fecha_movimiento
                FROM detalle_ventas dv
                JOIN ventas v ON dv.venta_id = v.id
                WHERE v.tienda_id = $1 AND dv.producto_id IS NOT NULL
            )
            SELECT 
                p.id, 
                p.codigo, 
                p.nombre, 
                p.categoria, 
                p.stock_unidades,
                p.stock_estante,
                (COALESCE(p.stock_unidades, 0) + COALESCE(p.stock_estante, 0)) as stock_total_real,
                p.costo, 
                p.unidad_medida,
                MAX(v_fechas.fecha_movimiento) as ultima_venta,
                CASE 
                    WHEN MAX(v_fechas.fecha_movimiento) IS NULL THEN -1
                    ELSE DATE_PART('day', NOW() - MAX(v_fechas.fecha_movimiento))::integer
                END as dias_inactivo
            FROM productos p
            LEFT JOIN movimientos_ventas v_fechas ON p.id = v_fechas.producto_id
            WHERE p.tienda_id = $1 AND p.activo = true ${filterCat} ${filterBusqueda}
            GROUP BY p.id, p.codigo, p.nombre, p.categoria, p.stock_unidades, p.stock_estante, p.costo, p.unidad_medida
            ${filterInactividad}
            ORDER BY ((COALESCE(p.stock_unidades, 0) + COALESCE(p.stock_estante, 0)) * 
                CASE 
                    WHEN p.categoria ILIKE '%esencia%' OR p.categoria ILIKE '%alcohol%' OR p.categoria ILIKE '%fijador%' OR p.unidad_medida = 'GRAMOS' OR p.unidad_medida = 'ML' 
                    THEN p.costo / 1000.0 ELSE p.costo 
                END
            ) DESC
        `;

        const result = await client.query(query, params);
        
        let totalCapitalAtrapado = 0;
        const items = result.rows.map(r => {
            const stockTotal = parseFloat(r.stock_total_real || 0);
            let costoUnit = parseFloat(r.costo || 0);
            const catUpper = (r.categoria || '').toUpperCase();
            const uniUpper = (r.unidad_medida || '').toUpperCase();

            if (catUpper.includes('ESENCIA') || catUpper.includes('ALCOHOL') || catUpper.includes('FIJADOR') || uniUpper === 'GRAMOS' || uniUpper === 'ML') {
                costoUnit = costoUnit / 1000.0;
            }

            const costoTotal = stockTotal * costoUnit;
            totalCapitalAtrapado += costoTotal;

            return {
                id: r.id,
                codigo: r.codigo,
                nombre: r.nombre,
                categoria: r.categoria,
                stock_unidades: stockTotal,
                costo_unitario: costoUnit,
                costo_estancado: costoTotal,
                dias_inactivo: r.dias_inactivo,
                ultima_venta: r.ultima_venta
            };
        });

        res.json({
            total_capital: totalCapitalAtrapado,
            items: items
        });

    } catch (error) {
        console.error("Error en Auditoría Estancamiento:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

const exportarEstancamientoExcel = async (req, res) => {
    const { dias, categoria } = req.query;
    const client = await pool.connect();

    try {
        // Ejecutamos la consulta contable
        let filterCat = "";
        if (categoria === 'ESENCIAS') filterCat = "AND p.categoria ILIKE '%esencia%'";
        else if (categoria === 'TERMINADOS') filterCat = "AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminados%')";

        const numDias = parseInt(dias, 10) || 30;
        const query = `
            SELECT p.codigo, p.nombre, p.categoria, p.stock_unidades, p.costo, p.unidad_medida, MAX(v.fecha) as ultima_venta
            FROM productos p
            LEFT JOIN detalle_ventas dv ON p.id = dv.producto_id
            LEFT JOIN ventas v ON dv.venta_id = v.id
            WHERE p.activo = true ${filterCat}
            GROUP BY p.id, p.codigo, p.nombre, p.categoria, p.stock_unidades, p.costo, p.unidad_medida
            HAVING (MAX(v.fecha) < NOW() - INTERVAL '${numDias} days' OR MAX(v.fecha) IS NULL) AND p.stock_unidades > 0
            ORDER BY p.stock_unidades DESC
        `;

        const result = await client.query(query);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Auditoría Estancamiento');

        const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } } };

        sheet.addRow(['INFORME CONTABLE DE INVENTARIO INMOVILIZADO (HUESOS)']).font = { bold: true, size: 14 };
        sheet.addRow([`Parámetro: Inactividad mayor o igual a ${dias} días`]);
        sheet.addRow([`Fecha de Auditoría: ${new Date().toLocaleDateString()}`]);
        sheet.addRow([]);

        const headers = sheet.addRow(['CÓDIGO', 'PRODUCTO / INSUMO', 'CATEGORÍA', 'STOCK ATRAPADO', 'COSTO UNITARIO ($)', 'CAPITAL INMOVILIZADO ($)', 'ÚLTIMA SALIDA']);
        headers.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });

        let totalGeneral = 0;

        result.rows.forEach(r => {
            const stock = parseFloat(r.stock_unidades || 0);
            let costoUnit = parseFloat(r.costo || 0);
            const catUpper = (r.categoria || '').toUpperCase();
            const uniUpper = (r.unidad_medida || '').toUpperCase();

            if (catUpper.includes('ESENCIA') || catUpper.includes('ALCOHOL') || catUpper.includes('FIJADOR') || uniUpper === 'GRAMOS' || uniUpper === 'ML') {
                costoUnit = costoUnit / 1000.0;
            }

            const capitalAtrapado = stock * costoUnit;
            totalGeneral += capitalAtrapado;

            sheet.addRow([
                r.codigo || 'N/A',
                r.nombre,
                r.categoria,
                stock,
                costoUnit,
                capitalAtrapado,
                r.ultima_venta ? new Date(r.ultima_venta).toLocaleDateString() : 'SIN VENTAS'
            ]);
        });

        sheet.addRow([]);
        const rowTotal = sheet.addRow(['TOTAL CAPITAL INMOVILIZADO EN TIENDA:', '', '', '', '', totalGeneral, '']);
        rowTotal.font = { bold: true };

        sheet.getColumn(5).numFmt = '"$"#,##0.0000';
        sheet.getColumn(6).numFmt = '"$"#,##0.00';
        sheet.columns.forEach(c => { c.width = 22; });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Auditoria_Estancamiento_${dias}_dias.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error Exportando Auditoría:", error);
        res.status(500).send("Error generando el Excel");
    } finally {
        client.release();
    }
};


// =======================================================
// 📊 REPORTE DE LISTA DE PRECIOS Y CATÁLOGO POR SUCURSAL
// =======================================================
const getReporteListaPrecios = async (req, res) => {
    try {
        const { start, end, tienda_id, seccion, search } = req.query;

        let idTienda = tienda_id && tienda_id !== '' && tienda_id !== 'todas' ? parseInt(tienda_id, 10) : null;
        if (!idTienda && req.user && req.user.tienda_id) {
            idTienda = parseInt(req.user.tienda_id, 10);
        }

        let whereClause = "WHERE p.activo = true";
        let params = [];
        let paramIdx = 1;

        if (idTienda) {
            whereClause += ` AND p.tienda_id = $${paramIdx}`;
            params.push(idTienda);
            paramIdx++;
        }

        if (seccion && seccion !== 'todos' && seccion !== 'TODOS') {
            if (seccion === 'TERMINADOS') {
                whereClause += ` AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminado%' OR p.categoria ILIKE '%perfume%')`;
            } else {
                whereClause += ` AND p.categoria ILIKE $${paramIdx}`;
                params.push(`%${seccion}%`);
                paramIdx++;
            }
        }

        if (search && search.trim() !== '') {
            whereClause += ` AND (p.codigo ILIKE $${paramIdx} OR p.nombre ILIKE $${paramIdx} OR p.marca ILIKE $${paramIdx})`;
            params.push(`%${search.trim()}%`);
            paramIdx++;
        }

        const query = `
            SELECT 
                p.id,
                COALESCE(p.codigo, 'S/C') as referencia,
                p.nombre as descripcion,
                COALESCE(p.genero, 'UNISEX') as genero,
                COALESCE(p.categoria, 'GENERAL') as seccion,
                COALESCE(p.marca, 'N/A') as marca,
                COALESCE(p.unidad_medida, 'GRAMOS') as presentacion,
                p.precio_venta as precio,
                p.stock_unidades,
                p.stock_estante,
                (COALESCE(p.stock_unidades, 0) + COALESCE(p.stock_estante, 0)) as stock_total,
                COALESCE(t.nombre, 'SUCURSAL GENERAL') as tienda_nombre
            FROM productos p
            LEFT JOIN tiendas t ON p.tienda_id = t.id
            ${whereClause}
            ORDER BY p.categoria ASC, p.nombre ASC
        `;

        const response = await pool.query(query, params);
        res.json({
            total_articulos: response.rows.length,
            data: response.rows
        });

    } catch (error) {
        console.error("Error en getReporteListaPrecios:", error);
        res.status(500).json({ error: "Error al consultar la lista de precios." });
    }
};

const exportarListaPreciosExcel = async (req, res) => {
    try {
        const { start, end, tienda_id, seccion } = req.query;

        let idTienda = tienda_id && tienda_id !== '' && tienda_id !== 'todas' ? parseInt(tienda_id, 10) : null;
        if (!idTienda && req.user && req.user.tienda_id) {
            idTienda = parseInt(req.user.tienda_id, 10);
        }

        let whereClause = "WHERE p.activo = true";
        let params = [];
        let paramIdx = 1;

        if (idTienda) {
            whereClause += ` AND p.tienda_id = $${paramIdx}`;
            params.push(idTienda);
            paramIdx++;
        }

        if (seccion && seccion !== 'todos' && seccion !== 'TODOS') {
            if (seccion === 'TERMINADOS') {
                whereClause += ` AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminado%' OR p.categoria ILIKE '%perfume%')`;
            } else {
                whereClause += ` AND p.categoria ILIKE $${paramIdx}`;
                params.push(`%${seccion}%`);
                paramIdx++;
            }
        }

        const query = `
            SELECT 
                COALESCE(p.codigo, 'S/C') as referencia,
                p.nombre as descripcion,
                COALESCE(p.genero, 'UNISEX') as genero,
                COALESCE(p.categoria, 'GENERAL') as seccion,
                COALESCE(p.marca, 'N/A') as marca,
                COALESCE(p.unidad_medida, 'GRAMOS') as presentacion,
                p.precio_venta as precio,
                (COALESCE(p.stock_unidades, 0) + COALESCE(p.stock_estante, 0)) as stock_total,
                COALESCE(t.nombre, 'SUCURSAL GENERAL') as tienda_nombre
            FROM productos p
            LEFT JOIN tiendas t ON p.tienda_id = t.id
            ${whereClause}
            ORDER BY p.categoria ASC, p.nombre ASC
        `;

        const result = await pool.query(query, params);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Inventario y Lista Precios');

        sheet.addRow(['PERFUMIX C.A. - INVENTARIO Y CATÁLOGO DE PRECIOS']).font = { bold: true, size: 14 };
        sheet.addRow([`Sucursal: ${result.rows[0]?.tienda_nombre || 'Todas las Sucursales'}`]);
        sheet.addRow([`Fecha de Generación: ${new Date().toLocaleDateString('es-VE')}`]);
        sheet.addRow([]);

        // Encabezados ajustados solo a Referencia, Descripción, Género, Inventario/Precios
        const headerRow = sheet.addRow([
            'REFERENCIA', 
            'DESCRIPCIÓN', 
            'GÉNERO', 
            'INVENTARIO TOTAL', 
            'SECCIÓN / CATEGORÍA', 
            'MARCA', 
            'PRECIO ($)'
        ]);

        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        result.rows.forEach(r => {
            sheet.addRow([
                r.referencia.toUpperCase(),
                r.descripcion.toUpperCase(),
                r.genero.toUpperCase(),
                parseFloat(r.stock_total || 0),
                r.seccion.toUpperCase(),
                r.marca.toUpperCase(),
                parseFloat(r.precio || 0)
            ]);
        });

        sheet.getColumn(7).numFmt = '"$"#,##0.00';
        sheet.getColumn(4).numFmt = '#,##0.00';
        
        sheet.getColumn(1).width = 16;
        sheet.getColumn(2).width = 45;
        sheet.getColumn(3).width = 16;
        sheet.getColumn(4).width = 18;
        sheet.getColumn(5).width = 22;
        sheet.getColumn(6).width = 20;
        sheet.getColumn(7).width = 16;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Inventario_Lista_Precios_${new Date().toISOString().slice(0,10)}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error Exportando Excel Lista Precios:", error);
        res.status(500).send("Error generando el archivo Excel.");
    }
};

const exportarKardexProductoExcel = async (req, res) => {
    try {
        const { producto } = req.query;
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

        if (!producto) {
            return res.status(400).json({ error: "Debe especificar el ID del producto" });
        }

        // Obtener información del producto
        const prodRes = await pool.query('SELECT * FROM productos WHERE id = $1 AND tienda_id = $2', [producto, idTiendaLocal]);
        if (prodRes.rows.length === 0) {
            return res.status(404).json({ error: "Producto no encontrado en esta sucursal" });
        }
        const prod = prodRes.rows[0];

        // Obtener historial unificado (movimientos + ventas)
        const queryMovimientos = `
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
            ORDER BY fecha DESC;
        `;
        const resMov = await pool.query(queryMovimientos, [producto]);

        // Construir Excel usando ExcelJS
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Historial de Movimientos');

        sheet.addRow(['REPORTE DE KARDEX / HISTORIAL DE MOVIMIENTOS']).font = { bold: true, size: 14 };
        sheet.addRow([`Producto:`, `${prod.nombre} (${prod.codigo})`]).font = { bold: true };
        sheet.addRow([`Categoría:`, prod.categoria, `Marca:`, prod.marca || 'N/A']);
        sheet.addRow([`Fecha Generación:`, new Date().toLocaleString('es-VE')]);
        sheet.addRow([]);

        const headers = sheet.addRow(['FECHA', 'TIPO MOVIMIENTO', 'CANTIDAD', 'STOCK RESULTANTE', 'MOTIVO / DETALLE']);
        headers.eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        resMov.rows.forEach(m => {
            sheet.addRow([
                new Date(m.fecha).toLocaleString('es-VE'),
                m.tipo_movimiento,
                parseFloat(m.cantidad || 0),
                parseFloat(m.stock_nuevo || 0),
                m.motivo || 'N/A'
            ]);
        });

        sheet.getColumn(1).width = 22;
        sheet.getColumn(2).width = 18;
        sheet.getColumn(3).width = 14;
        sheet.getColumn(4).width = 18;
        sheet.getColumn(5).width = 45;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Kardex_${prod.codigo}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error exportando Kardex Excel:", error);
        res.status(500).send("Error al generar el reporte Excel.");
    }
};

module.exports = { getProductos, createProducto, descargarAuditoriaExcel, cambiarSucursalActiva, updateProducto, deleteProducto, importarMasivo, getHistorialImportaciones, revertirImportacion, getKardex, getLotesProducto, eliminarFisico, reactivarProducto, reponerEstante, getProductosEstante,
    reportarMerma, getReporteKardex, organizarBotella, actualizarNivelBotella, getUbicacionSugerida, abrirBotellaGrupo, crearTester,
    moverStockEstante,
    distribuirProducto, obtenerProductoPorReferencia, exportarExcel, gestionarMovimientoEstante, sincronizarStock, eliminarBotella, reponerTester, vaciadoMasivoEstante, registrarMovimiento,
    obtenerEstancamiento,
    exportarEstancamientoExcel,
    getReporteListaPrecios,
    exportarListaPreciosExcel,
    exportarKardexProductoExcel 
};