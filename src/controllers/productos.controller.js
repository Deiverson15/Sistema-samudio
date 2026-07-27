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
        codigo, nombre, marca, categoria, stock, stock_minimo, costo, precio_venta, 
        ubicacion, u_caja, ganancia, descripcion, unidad_medida, contenido_gramos 
    } = req.body;
    
    const usuarioId = req.user ? req.user.id : null; 
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 🔥 Agregamos tienda_id ($16) al insert
        const insertProdText = `
            INSERT INTO productos 
             (codigo, nombre, marca, categoria, stock_unidades, stock_minimo, costo, precio_venta, ubicacion, u_caja, ganancia, descripcion, unidad_medida, activo, contenido_gramos, tamano, stock_estante, tienda_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, $15, 0, $16) 
             RETURNING *`;
             
        const prodValues = [
            codigo, nombre, marca, categoria, stock || 0, stock_minimo || 0, costo, precio_venta, 
            ubicacion, u_caja || 1, ganancia, descripcion, unidad_medida || 'UNIDAD',
            contenido_gramos || 0, contenido_gramos ? `${contenido_gramos}ml` : 'N/A', idTiendaLocal
        ];

        const resProd = await client.query(insertProdText, prodValues);
        const nuevoProd = resProd.rows[0];

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
                [usuarioId, `Tienda ${idTiendaLocal}: Creó el producto: ${nuevoProd.nombre} (${codigo})`]
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
    const { codigo, nombre, marca, categoria, stock, stock_minimo, costo, precio_venta, ubicacion, tamano, u_caja, peso } = req.body;      
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 🔒 Verificamos que el producto exista EN ESTA SUCURSAL
        const oldRes = await client.query('SELECT stock_unidades FROM productos WHERE id = $1 AND tienda_id = $2', [id, idTiendaLocal]);
        if (oldRes.rows.length === 0) throw new Error('Producto no encontrado en el catálogo de esta sucursal');
        
        const oldStock = parseFloat(oldRes.rows[0].stock_unidades || 0);
        const newStock = parseFloat(stock);
        const diff = isNaN(newStock) ? 0 : newStock - oldStock;

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
            WHERE id = $13 AND tienda_id = $14
            RETURNING *`,
            [
                codigo, nombre, marca, categoria, 
                isNaN(newStock) ? null : newStock,
                stock_minimo, costo, precio_venta, ubicacion, tamano, u_caja, peso, id, idTiendaLocal
            ]
        );
        
        const prod = result.rows[0];

        if (diff > 0) {
            const esFrasco = ['Frasco', 'Envases', 'Frascos', 'Envase'].includes(prod.categoria) || prod.nombre.toUpperCase().includes('FRASCO');
            if (esFrasco) {
                await client.query(
                    "INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) VALUES ($1, $2, $3, $3, NOW() + interval '5 years', $4, $5)",
                    [id, `AUTO-${Date.now()}`, diff, prod.costo || 0, idTiendaLocal]
                );
            } else {
                const existeLote = await client.query("SELECT id FROM lotes WHERE producto_id = $1 AND tienda_id = $2 AND cantidad_actual > 0 LIMIT 1", [id, idTiendaLocal]);
                
                if (existeLote.rows.length > 0) {
                    await client.query("UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id = $2", [diff, existeLote.rows[0].id]);
                } else {
                    await client.query(
                        "INSERT INTO lotes (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) VALUES ($1, $2, $3, $3, NOW() + interval '1 year', $4, $5)",
                        [id, 'STOCK-RAPIDO', diff, prod.costo || 0, idTiendaLocal]
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
    const { productos, nombre_archivo, proveedor } = req.body; 
    const usuarioId = req.user ? req.user.id : null;
    
    // SUCURSAL ENFORCED: La Urbina (ID: 3)
    const idTiendaLocal = 3; 

    const client = await pool.connect();
    
    let insertados = 0; let actualizados = 0; let errores = 0; let detallesError = [];
    let logReversion = []; 

    let totalInversion = 0;
    let totalProyeccion = 0;
    let totalCantidades = 0;

    try {
        await client.query('BEGIN');

        // 🧠 DETECTOR AUTOMÁTICO DE ENCABEZADOS Y MAPEADOR DE COLUMNAS
        let headerMap = {};
        let startIndex = 0;

        // Escanea las primeras 10 filas buscando los títulos reales
        for (let h = 0; h < Math.min(productos.length, 10); h++) {
            const candidateRow = productos[h];
            let foundHeader = false;
            
            for (const key in candidateRow) {
                const valStr = candidateRow[key] ? candidateRow[key].toString().toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
                if (valStr === 'referencia' || valStr === 'codigo' || valStr === 'cantidad' || valStr === 'seccion') {
                    foundHeader = true;
                    break;
                }
            }

            if (foundHeader) {
                // Mapear la llave rara (ej. "__EMPTY_6") al nombre real de la columna ("cantidad")
                for (const key in candidateRow) {
                    if (candidateRow[key]) {
                        const cleanHeader = candidateRow[key].toString().toLowerCase()
                                                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                                                .trim();
                        headerMap[key] = cleanHeader;
                    }
                }
                startIndex = h + 1; // Inicia la lectura real en la siguiente fila
                break;
            }
        }
        
        for (let i = startIndex; i < productos.length; i++) {
            const row = productos[i];
            
            const p = {};
            // Forzamos el mapeo usando el headerMap irrompible
            for (const key in row) {
                const targetKey = headerMap[key] || key.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                p[targetKey] = row[key];
            }

            // 🧲 EXTRACCIÓN PROTEGIDA
            const codigoRaw = p['referencia'] || p['codigo'] || p['ref'] || p['mappin pt'];
            
            // Si no hay código o es la fila de totalización final (ej. 1028), la saltamos
            if (!codigoRaw || codigoRaw.toString().trim() === '' || codigoRaw.toString().trim().toUpperCase() === 'REFERENCIA') { 
                continue; 
            }

            const seccionRaw = p['seccion'];
            let nombreRaw = p['descripcion'] || p['nombre'] || p['producto'];
            const marcaRaw = p['marca'];
            const generoRaw = p['genero'];
            const presentacionRaw = p['presentacion'] || 'UND';
            
            // 🛡️ PARSEO SEGURO DE MONTOS NUMÉRICOS
            let stockOriginal = parseFloat(p['cantidad']);
            if (isNaN(stockOriginal)) stockOriginal = 0;

            let costoRaw = parseFloat(p['costo'] || p['costo und']);
            if (isNaN(costoRaw)) costoRaw = 0;

            let precioRaw = parseFloat(p['precio']);
            if (isNaN(precioRaw)) precioRaw = 0;

            const spName = `fila_${i}`;
            await client.query(`SAVEPOINT ${spName}`);
            
            try {
                const codigo = codigoRaw.toString().trim(); 
                const seccion = seccionRaw ? seccionRaw.toString().trim().toUpperCase() : 'GENERAL';
                const presentacion = presentacionRaw ? presentacionRaw.toString().trim().toUpperCase() : 'UND';
                
                let marca = marcaRaw ? marcaRaw.toString().trim() : 'Genérico';
                let genero = generoRaw ? generoRaw.toString().trim().toUpperCase() : 'UNISEX';

                // 🔍 BÚSQUEDA PREVIA EN BD PARA EXTRAER DATOS DE LA ESENCIA BASE
                const busquedaEsencia = await client.query(
                    'SELECT nombre, marca, genero FROM productos WHERE codigo = $1 AND tienda_id = $2 LIMIT 1',
                    [codigo, idTiendaLocal]
                );

                if (busquedaEsencia.rows.length > 0) {
                    const eb = busquedaEsencia.rows[0];
                    if (!nombreRaw && eb.nombre) nombreRaw = eb.nombre;
                    if ((!generoRaw || genero === 'UNISEX') && eb.genero) genero = eb.genero;
                    if ((!marcaRaw || marca === 'Genérico') && eb.marca) marca = eb.marca;
                }

                const nombre = nombreRaw ? nombreRaw.toString().trim() : `Perfume ${codigo}`;

                let stockAñadido = 0;
                let categoria = 'General';
                let unidad_medida = 'UNIDAD';
                let contenido_gramos = 0;

                // 🧠 MOTOR MATEMÁTICO DE CONVERSIONES (Perfumes Terminados / Esencias / Insumos)
                if (seccion.includes('PERFUME TERMINADO') || seccion.includes('PERFUMES TERMINADOS')) {
                    categoria = 'Perfumes';
                    unidad_medida = 'UNIDAD';
                    stockAñadido = Math.round(stockOriginal);

                    const extraerNumero = codigo.match(/\d+/) || nombre.match(/\d+/);
                    if (extraerNumero) {
                        contenido_gramos = parseInt(extraerNumero[0], 10);
                    }
                }
                else if (seccion === 'ESENCIA' || presentacion === 'GRAMOS') {
                    categoria = 'Esencias';
                    unidad_medida = 'GRAMOS';
                    stockAñadido = Math.round(stockOriginal * 1000); 
                } 
                else if (seccion === 'ALCOHOL' || (seccion === 'MATERIA PRIMA' && nombre.toUpperCase().includes('ALCOHOL'))) {
                    categoria = 'Alcohol';
                    unidad_medida = 'ML';
                    stockAñadido = Math.round(stockOriginal * 1000); 
                } 
                else if (seccion === 'FIJADOR' || (seccion === 'MATERIA PRIMA' && nombre.toUpperCase().includes('FIJADOR'))) {
                    categoria = 'Fijador';
                    unidad_medida = 'GRAMOS';
                    stockAñadido = Math.round(stockOriginal * 1000); 
                } 
                else if (seccion === 'FRASCO' || presentacion === 'UND') {
                    categoria = seccion.includes('FRASCO') ? 'Envases' : 'General';
                    unidad_medida = 'UNIDAD';
                    stockAñadido = Math.round(stockOriginal);
                    
                    const extraerNumero = codigo.match(/\d+/) || nombre.match(/\d+/);
                    if (extraerNumero) {
                        contenido_gramos = parseInt(extraerNumero[0], 10);
                    }
                } else {
                    categoria = 'General';
                    unidad_medida = 'UNIDAD';
                    stockAñadido = Math.round(stockOriginal);
                }

                const costo = costoRaw;
                const precio_venta = precioRaw;
                const stock_minimo = 5;

                let productoId;
                let esNuevo = false;

                // Verificamos si ya existe el registro exacto en esta tienda
                const checkRes = await client.query('SELECT id FROM productos WHERE codigo = $1 AND tienda_id = $2', [codigo, idTiendaLocal]);
                
                if (checkRes.rows.length > 0) {
                    productoId = checkRes.rows[0].id;
                    
                    // Si trae stock físico para registrar (14, 10, etc.)
                    if (stockOriginal > 0) {
                        await client.query(`
                            UPDATE productos 
                            SET stock_unidades = stock_unidades + $1,
                                marca = $2,
                                genero = $3,
                                categoria = $4,
                                costo = $5,
                                precio_venta = $6,
                                unidad_medida = $7,
                                activo = true
                            WHERE id = $8 AND tienda_id = $9
                        `, [stockAñadido, marca, genero, categoria, costo, precio_venta, unidad_medida, productoId, idTiendaLocal]);
                        actualizados++;
                        
                        totalCantidades += stockOriginal;
                        totalInversion += (costo * stockOriginal);
                        totalProyeccion += (precio_venta * stockOriginal);
                    } else {
                        await client.query(`RELEASE SAVEPOINT ${spName}`);
                        continue; 
                    }
                } else {
                    esNuevo = true;
                    
                    if (stockOriginal > 0) {
                        totalCantidades += stockOriginal;
                        totalInversion += (costo * stockOriginal);
                        totalProyeccion += (precio_venta * stockOriginal);
                    }
                    
                    const insertQuery = `
                        INSERT INTO productos 
                        (codigo, nombre, marca, categoria, stock_unidades, stock_minimo, costo, precio_venta,
                         ubicacion, u_caja, ganancia, descripcion, unidad_medida, activo, contenido_gramos,
                         tamano, stock_estante, peso_unitario_kg, tienda_id, genero) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DEPOSITO', 1, 30, $9, $10, true, $11, $12, 0, 0, $13, $14)
                        RETURNING id`;
                        
                    const valuesInsert = [
                        codigo, nombre, marca, categoria, stockAñadido, stock_minimo, costo, precio_venta, 
                        `Carga Inteligente Excel - Sección: ${seccion}`, unidad_medida, contenido_gramos, 
                        contenido_gramos > 0 ? `${contenido_gramos}ml` : 'N/A', idTiendaLocal, genero
                    ];
                        
                    const resInsert = await client.query(insertQuery, valuesInsert);
                    productoId = resInsert.rows[0].id;
                    insertados++;
                }

                // Sembramos los lotes de trazabilidad FIFO solo si ingresó stock real
                let loteIdCreado = null;
                if (stockAñadido > 0) {
                    const loteAleatorio = `LOTE-EXCEL-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 100)}`;
                    const fechaVencimiento = new Date();
                    fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 3); 
                    
                    const loteRes = await client.query(`
                        INSERT INTO lotes 
                        (producto_id, codigo_lote, cantidad_inicial, cantidad_actual, fecha_vencimiento, costo_unitario, tienda_id) 
                        VALUES ($1, $2, $3, $3, $4, $5, $6) RETURNING id
                    `, [productoId, loteAleatorio, stockAñadido, fechaVencimiento, costo, idTiendaLocal]);
                    
                    loteIdCreado = loteRes.rows[0].id;

                    await client.query(`
                        INSERT INTO historial_movimientos 
                        (producto_id, tipo_movimiento, cantidad, stock_nuevo, motivo, fecha, tienda_id)
                        VALUES ($1, 'ENTRADA', $2, (SELECT stock_unidades FROM productos WHERE id=$1 AND tienda_id=$3), 'Carga Masiva Nuevo Excel', NOW(), $3)
                    `, [productoId, stockAñadido, idTiendaLocal]);
                    
                    logReversion.push({ producto_id: productoId, es_nuevo: esNuevo, stock_agregado: stockAñadido, lote_id: loteIdCreado });
                }

                await client.query(`RELEASE SAVEPOINT ${spName}`);

            } catch (err) {
                await client.query(`ROLLBACK TO SAVEPOINT ${spName}`);
                errores++;
                detallesError.push(`Referencia ${codigoRaw || 'Indefinida'}: ${err.message}`);
            }
        } 

        if (logReversion.length > 0) {
            const rentabilidadCalculada = totalProyeccion - totalInversion;
            const provFijo = proveedor || 'No Especificado';

            await client.query(`
                INSERT INTO importaciones_excel 
                (usuario_id, nombre_archivo, detalles_json, estado, proveedor, cantidad_articulos, inversion_total, precio_proyectado, rentabilidad_estimada, excel_crudo_json)
                VALUES ($1, $2, $3, 'APLICADO', $4, $5, $6, $7, $8, $9)
            `, [
                usuarioId, nombre_archivo || `Carga_Urbina_${new Date().toISOString().slice(0,10)}`, 
                JSON.stringify(logReversion), provFijo, totalCantidades, totalInversion, 
                totalProyeccion, rentabilidadCalculada, JSON.stringify(productos)
            ]);
        }

        if (usuarioId && (insertados > 0 || actualizados > 0)) {
            await client.query(
                "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'IMPORT_MASIVA', $2, NOW())",
                [usuarioId, `Carga Maestra: ${insertados} creados, Inv: $${totalInversion.toFixed(2)}`]
            );
        }
        
        await client.query('COMMIT');
        res.json({
            mensaje: `¡Éxito! Inversión detectada: $${totalInversion.toFixed(2)} | Proyección: $${totalProyeccion.toFixed(2)}`,
            resumen: { insertados, actualizados, errores, detalles: detallesError.slice(0, 10) }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
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

const exportarExcel = async (req, res) => {

    console.log("--- [DEBUG] Entrando a exportarExcel de productos.controller ---");
    console.log("Filtro recibido:", req.query.filtro);

    try {
        const { filtro, start, end } = req.query; // Extraemos start y end de la URL
        
        // 🛡️ DETECCIÓN INTELIGENTE DE SUCURSAL (Sincronizado con tu pantalla)
        let idTiendaLocal = 1;
        if (req.user && req.user.tienda_id !== undefined && req.user.tienda_id !== null && req.user.tienda_id !== '') {
            idTiendaLocal = parseInt(req.user.tienda_id, 10);
        }

        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || rolUsuario === 'dev' || rolUsuario === 'admin' || rolUsuario === 'administrador';

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
        workbook.creator = 'Sistema Inventario';
        workbook.created = new Date();

        // ---------------------------------------------------------
        // HOJA 1: HISTORIAL DE MOVIMIENTOS (Diseño Ley ISLR)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'inventario') {
            const sheetInv = workbook.addWorksheet('Movimiento de Inventario');

            // 1. Filas de Encabezado Fijo
            sheetInv.addRow(['Nombre de La Empresa']);
            sheetInv.addRow(['R.I.F.: J-XXXXXXXXX']);
            sheetInv.addRow([]);
            sheetInv.addRow(['Libro de Movimiento de inventarios (Art. 177 Ley de ISLR)']);
            sheetInv.addRow([]);

            // 2. Encabezados Agrupados (Fila 6)
            const rowCategorias = sheetInv.addRow([
                'Oper Nº', 'Fecha', 'Referencia', 'Descripción', 'Departamento', 'Sección', 'Marca', 'Costo Unitario',
                'EXISTENCIA INICIAL', '', 'ENTRADAS', '', 'SALIDAS', '', 'AUTOCONSUMO', '', 'INVENTARIO ACTUAL', ''
            ]);

            // Combinar celdas HORIZONTALES (Para Cantidad y Monto)
            sheetInv.mergeCells('I6:J6'); sheetInv.mergeCells('K6:L6');
            sheetInv.mergeCells('M6:N6'); sheetInv.mergeCells('O6:P6'); sheetInv.mergeCells('Q6:R6');

            // 3. Encabezados Detallados (Fila 7)
            const rowDetalle = sheetInv.addRow([
                '', '', '', '', '', '', '', '',
                'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto', 'Cant', 'Monto'
            ]);

            // Combinar celdas VERTICALES
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

            // 4. Lógica de Consulta: Sincronizada con p.costo e idTiendaLocal dinámico
            let querySQL = `
                SELECT h.id, h.fecha, p.codigo, p.nombre, p.marca, p.costo, h.tipo_movimiento, h.cantidad
                FROM historial_movimientos h
                JOIN productos p ON h.producto_id = p.id
                WHERE p.tienda_id = $1
            `;
            let paramsSQL = [idTiendaLocal];

            // 🔥 CORREGIDO: Aplicamos cast ::date para que las horas del timestamp no rompan el rango
            if (start && end) {
                querySQL += ` AND h.fecha::date BETWEEN $2 AND $3`;
                paramsSQL.push(start, end);
            }
            
            querySQL += ` ORDER BY h.fecha ASC`;

            const resInv = await client.query(querySQL, paramsSQL);

            // ⚡ Cardex progresivo en memoria por producto
            const saldoProductos = {};

            // 5. Rellenar con Información real
            resInv.rows.forEach(m => {
                let fila = new Array(18).fill(0);
                
                const prodCodigo = m.codigo || 'S/N';
                if (!saldoProductos[prodCodigo]) {
                    saldoProductos[prodCodigo] = { cant: 0, monto: 0 };
                }

                const costoUnit = parseFloat(m.costo || 0);
                const cant = parseFloat(m.cantidad || 0);
                const montoMovimiento = cant * costoUnit;

                // Existencia Inicial (Antes de procesar la fila actual)
                fila[8] = saldoProductos[prodCodigo].cant;
                fila[9] = saldoProductos[prodCodigo].monto;

                fila[0] = m.id;
                fila[1] = new Date(m.fecha).toLocaleDateString();
                fila[2] = prodCodigo;
                fila[3] = m.nombre;
                
                // 🔥 LÓGICA DE CLASIFICACIÓN INTELIGENTE
                // Asegúrate de que 'm.categoria' sea la propiedad que contiene la categoría en tu consulta SQL
                const cat = (m.categoria || '').toUpperCase();
                
                if (cat.includes('PERFUME')) {
                    fila[4] = 'VENTAS';
                    fila[5] = 'PERFUMES TERMINADOS';
                } 
                // 2. Identificar Materia Prima (Esencia, Fijador, Alcohol, Frascos/Envases)
                else if (['ESENCIA', 'ALCOHOL', 'FIJADOR', 'FRASCO', 'ENVASE'].some(term => cat.includes(term))) {
                    fila[4] = 'PRODUCCIÓN';
                    fila[5] = 'MATERIA PRIMA';
                } 
                // 3. Cualquier otra cosa
                else {
                    fila[4] = 'GENERAL';
                    fila[5] = 'OTROS';
                }
                
                fila[6] = m.marca || 'N/A';
                fila[7] = costoUnit;
                
                // Procesamos la variación del Kardex según el tipo de movimiento
                if (m.tipo_movimiento === 'ENTRADA') { 
                    fila[10] = cant; 
                    fila[11] = montoMovimiento;
                    saldoProductos[prodCodigo].cant += cant;
                }
                else if (m.tipo_movimiento === 'SALIDA') { 
                    fila[12] = cant; 
                    fila[13] = montoMovimiento;
                    saldoProductos[prodCodigo].cant = Math.max(0, saldoProductos[prodCodigo].cant - cant);
                }
                else if (m.tipo_movimiento === 'CONSUMO_INT' || m.tipo_movimiento === 'TRASLADO') { 
                    fila[14] = cant; 
                    fila[15] = montoMovimiento;
                    saldoProductos[prodCodigo].cant = Math.max(0, saldoProductos[prodCodigo].cant - cant);
                }

                saldoProductos[prodCodigo].monto = saldoProductos[prodCodigo].cant * costoUnit;

                // Inventario Actual Resultante
                fila[16] = saldoProductos[prodCodigo].cant;
                fila[17] = saldoProductos[prodCodigo].monto;

                sheetInv.addRow(fila);
            });

            sheetInv.getColumn('D').width = 35; 
        }

        // ---------------------------------------------------------
        // HOJA 2: ESTANTE (Tienda / Botellas Abiertas)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'estante') {
            const sheetEst = workbook.addWorksheet('Estante (Tienda)');
            const resEst = await client.query(`
                SELECT b.ubicacion, b.fila, p.nombre, b.cantidad, p.unidad_medida, b.porcentaje_actual
                FROM botellas_estante b JOIN productos p ON b.producto_id = p.id
                WHERE p.tienda_id = $1
                ORDER BY b.ubicacion, b.fila
            `, [idTiendaLocal]);

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
            
            const resVentas = await client.query(`
                SELECT 
                    v.id, v.fecha, c.nombre as cliente, v.total as total_usd,
                    COALESCE((SELECT SUM(pag.monto * pag.tasa_cambio) FROM pagos pag WHERE pag.venta_id = v.id), 0) as total_bs_calc
                FROM ventas v
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE v.tienda_id = $1
                ORDER BY v.fecha DESC
            `, [idTiendaLocal]);

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

            sheetVentas.addRow(['', '', '', '', '']); 
            const rowGranTotal = sheetVentas.addRow(['', 'TOTALES GENERALES:', '', sumUSD, sumBS]);
            
            rowGranTotal.font = { bold: true, size: 12 };
            rowGranTotal.getCell(4).numFmt = '"$"#,##0.00';
            rowGranTotal.getCell(5).numFmt = '"Bs"#,##0.00';
            rowGranTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };

            sheetVentas.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheetVentas.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
        }

        // ---------------------------------------------------------
        // HOJA 4: LOTES (Vencimientos)
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'lotes') {
            const sheetLotes = workbook.addWorksheet('Lotes y Vencimientos');
            const resLotes = await client.query(`
                SELECT l.codigo_lote, p.nombre, l.cantidad_actual, l.fecha_vencimiento
                FROM lotes l JOIN productos p ON l.producto_id = p.id
                WHERE l.cantidad_actual > 0 AND p.tienda_id = $1 
                ORDER BY l.fecha_vencimiento ASC
            `, [idTiendaLocal]);

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
        // HOJA 5: MERMAS Y SALIDAS
        // ---------------------------------------------------------
        if (filtro === 'todo' || filtro === 'mermas') {
            const sheetMermas = workbook.addWorksheet('Mermas y Salidas');
            const resMermas = await client.query(`
                SELECT h.fecha, p.nombre, h.cantidad, h.motivo, h.tipo_movimiento
                FROM historial_movimientos h JOIN productos p ON h.producto_id = p.id
                WHERE (h.tipo_movimiento = 'SALIDA' OR h.motivo ILIKE '%MERMA%') AND p.tienda_id = $1
                ORDER BY h.fecha DESC
            `, [idTiendaLocal]);

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

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte.xlsx`);

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
    const { dias, categoria, start, end } = req.query;
    let idTiendaLocal = 1;
    if (req.user && req.user.tienda_id !== undefined && req.user.tienda_id !== null && req.user.tienda_id !== '') {
        idTiendaLocal = parseInt(req.user.tienda_id, 10);
    }

    const client = await pool.connect();

    try {
        let filterCat = "";
        if (categoria === 'ESENCIAS') filterCat = "AND p.categoria ILIKE '%esencia%'";
        else if (categoria === 'TERMINADOS') filterCat = "AND (p.es_producto_terminado = true OR p.categoria ILIKE '%terminados%')";
        else if (categoria === 'INSUMOS') filterCat = "AND p.categoria NOT ILIKE '%esencia%' AND p.categoria NOT ILIKE '%terminados%'";

        let filterInactividad = "";
        let params = [idTiendaLocal];

        // LÓGICA DE FILTRADO POR FECHA PERSONALIZADA O DÍAS ESTÁNDAR
        if (dias === 'CUSTOM' && start && end) {
            filterInactividad = `HAVING (MAX(v.fecha)::date NOT BETWEEN $2 AND $3 OR MAX(v.fecha) IS NULL) AND p.stock_unidades > 0`;
            params.push(start, end);
        } else if (dias === 'LOTES_NUEVOS') {
            filterInactividad = "HAVING MAX(v.fecha) IS NULL AND p.stock_unidades > 0";
        } else {
            const numDias = parseInt(dias, 10) || 30;
            filterInactividad = `HAVING (MAX(v.fecha) < NOW() - INTERVAL '${numDias} days' OR MAX(v.fecha) IS NULL) AND p.stock_unidades > 0`;
        }

        const query = `
            SELECT 
                p.id, 
                p.codigo, 
                p.nombre, 
                p.categoria, 
                p.stock_unidades, 
                p.costo, 
                p.unidad_medida,
                MAX(v.fecha) as ultima_venta,
                CASE 
                    WHEN MAX(v.fecha) IS NULL THEN -1
                    ELSE DATE_PART('day', NOW() - MAX(v.fecha))::integer
                END as dias_inactivo
            FROM productos p
            LEFT JOIN detalle_ventas dv ON p.id = dv.producto_id
            LEFT JOIN ventas v ON dv.venta_id = v.id
            WHERE p.tienda_id = $1 AND p.activo = true ${filterCat}
            GROUP BY p.id, p.codigo, p.nombre, p.categoria, p.stock_unidades, p.costo, p.unidad_medida
            ${filterInactividad}
            ORDER BY (p.stock_unidades * 
                CASE 
                    WHEN p.categoria ILIKE '%esencia%' OR p.categoria ILIKE '%alcohol%' OR p.categoria ILIKE '%fijador%' OR p.unidad_medida = 'GRAMOS' OR p.unidad_medida = 'ML' 
                    THEN p.costo / 1000.0 ELSE p.costo 
                END
            ) DESC
        `;

        const result = await client.query(query, params);
        
        let totalCapitalAtrapado = 0;
        const items = result.rows.map(r => {
            const stock = parseFloat(r.stock_unidades || 0);
            let costoUnit = parseFloat(r.costo || 0);
            const catUpper = (r.categoria || '').toUpperCase();
            const uniUpper = (r.unidad_medida || '').toUpperCase();

            if (catUpper.includes('ESENCIA') || catUpper.includes('ALCOHOL') || catUpper.includes('FIJADOR') || uniUpper === 'GRAMOS' || uniUpper === 'ML') {
                costoUnit = costoUnit / 1000.0;
            }

            const costoTotal = stock * costoUnit;
            totalCapitalAtrapado += costoTotal;

            return {
                id: r.id,
                codigo: r.codigo,
                nombre: r.nombre,
                categoria: r.categoria,
                stock_unidades: stock,
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

        // Filtro por sección/categoría (incluyendo la corrección de Perfumes Terminados)
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
                COALESCE(p.categoria, 'GENERAL') as seccion,
                p.nombre as descripcion,
                COALESCE(p.marca, 'N/A') as marca,
                COALESCE(p.genero, 'UNISEX') as genero,
                COALESCE(p.unidad_medida, 'GRAMOS') as presentacion,
                p.precio_venta as precio,
                p.stock_unidades,
                p.stock_estante,
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

        // Filtro por sección/categoría
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
                COALESCE(p.categoria, 'GENERAL') as seccion,
                p.nombre as descripcion,
                COALESCE(p.marca, 'N/A') as marca,
                COALESCE(p.genero, 'UNISEX') as genero,
                COALESCE(p.unidad_medida, 'GRAMOS') as presentacion,
                p.precio_venta as precio,
                COALESCE(t.nombre, 'SUCURSAL GENERAL') as tienda_nombre
            FROM productos p
            LEFT JOIN tiendas t ON p.tienda_id = t.id
            ${whereClause}
            ORDER BY p.categoria ASC, p.nombre ASC
        `;

        const result = await pool.query(query, params);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Lista de Precios');

        sheet.addRow(['PERFUMIX C.A. - LISTA DE PRECIOS OFICIAL']).font = { bold: true, size: 14 };
        sheet.addRow([`Sucursal: ${result.rows[0]?.tienda_nombre || 'Todas las Sucursales'}`]);
        sheet.addRow([`Fecha de Generación: ${new Date().toLocaleDateString('es-VE')}`]);
        sheet.addRow([]);

        const headerRow = sheet.addRow(['REFERENCIA', 'SECCIÓN', 'DESCRIPCIÓN', 'MARCA', 'GÉNERO', 'PRESENTACIÓN', 'PRECIO DE VENTA ($)']);
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        result.rows.forEach(r => {
            sheet.addRow([
                r.referencia,
                r.seccion.toUpperCase(),
                r.descripcion.toUpperCase(),
                r.marca.toUpperCase(),
                r.genero.toUpperCase(),
                r.presentacion.toUpperCase(),
                parseFloat(r.precio || 0)
            ]);
        });

        sheet.getColumn(7).numFmt = '"$"#,##0.00';
        
        sheet.getColumn(1).width = 16;
        sheet.getColumn(2).width = 18;
        sheet.getColumn(3).width = 45;
        sheet.getColumn(4).width = 22;
        sheet.getColumn(5).width = 16;
        sheet.getColumn(6).width = 18;
        sheet.getColumn(7).width = 20;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Lista_Precios_${new Date().toISOString().slice(0,10)}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error Exportando Excel Lista Precios:", error);
        res.status(500).send("Error generando el archivo Excel.");
    }
};
module.exports = { getProductos, createProducto, descargarAuditoriaExcel, cambiarSucursalActiva, updateProducto, deleteProducto, importarMasivo, getHistorialImportaciones, revertirImportacion, getKardex, getLotesProducto, eliminarFisico, reactivarProducto, reponerEstante, getProductosEstante,
    reportarMerma, getReporteKardex, organizarBotella, actualizarNivelBotella, getUbicacionSugerida, abrirBotellaGrupo, crearTester,
    moverStockEstante,
    distribuirProducto, obtenerProductoPorReferencia, exportarExcel, gestionarMovimientoEstante, sincronizarStock, eliminarBotella, reponerTester, vaciadoMasivoEstante, registrarMovimiento,
    obtenerEstancamiento,
    exportarEstancamientoExcel,
    getReporteListaPrecios,
    exportarListaPreciosExcel 
};