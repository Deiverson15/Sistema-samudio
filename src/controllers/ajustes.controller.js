const pool = require('../config/db'); 

// 1. OBTENER TASA DEL DÓLAR (Global)
const getTasaDolar = async (req, res) => {     
    try {         
        const result = await pool.query("SELECT valor FROM configuracion WHERE clave = 'tasa_dolar'");         
        res.json({ tasa: result.rows.length > 0 ? parseFloat(result.rows[0].valor) : 0 });     
    } catch (error) {         
        console.error("Error BD en getTasaDolar:", error); 
        res.status(500).json({ error: 'Error obteniendo tasa' });     
    } 
};

// 2. CREAR AJUSTE DE INVENTARIO (Blindado por Sucursal)
const crearAjuste = async (req, res) => {     
    // Recibimos la nueva variable 'ubicacion' (DEPOSITO o ESTANTE) y 'foto_evidencia'
    const { producto_id, tipo, cantidad, motivo, lote_id, codigo_manual, ubicacion, foto_evidencia } = req.body;          
    
    if (!producto_id || !cantidad || !tipo || !ubicacion) {         
        return res.status(400).json({ error: "Faltan datos obligatorios (Producto, Cantidad, Tipo o Ubicación)." });     
    }     

    // 🔒 CANDADO DE SUCURSAL y USUARIO
    const tiendaId = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    const usuarioId = req.user ? req.user.id : null;

    const client = await pool.connect();          
    
    try {         
        await client.query('BEGIN');         
        
        // 🔒 Seleccionamos el producto confirmando que pertenezca a la sucursal activa
        const prodRes = await client.query('SELECT nombre, stock_unidades, stock_estante, unidad_medida, contenido_gramos, costo FROM productos WHERE id = $1 AND tienda_id = $2 FOR UPDATE', [producto_id, tiendaId]);         
        if (prodRes.rows.length === 0) throw new Error("Producto no existe o no pertenece a su sucursal.");                  
        
        const producto = prodRes.rows[0];         
        const cant = parseFloat(cantidad);          
        const unidad = producto.unidad_medida || 'u'; 
        const capacidad = parseFloat(producto.contenido_gramos) || 1000;
        const costoUnitarioHistorico = parseFloat(producto.costo) || 0;
        
        let nuevoStockGlobal = parseFloat(producto.stock_unidades);
        let nuevoStockEstante = parseFloat(producto.stock_estante);
        let detalleLote = "";         
        let costoImpactado = 0; // Para la valoración financiera
        
        // =========================================================
        // ESCENARIO A: EL AJUSTE SE EJECUTA EN EL DEPÓSITO (ALMACÉN)
        // =========================================================
        if (ubicacion === 'DEPOSITO') {
            costoImpactado = cant * costoUnitarioHistorico;

            if (tipo === 'SALIDA') {             
                if (parseFloat(producto.stock_unidades) < cant) throw new Error("Stock insuficiente en el Depósito de la sucursal.");             
                
                if (lote_id) {                 
                    // Descontamos de un lote específico, pero asegurando que es de la tienda
                    const loteRes = await client.query('SELECT * FROM lotes WHERE id = $1 AND tienda_id = $2 FOR UPDATE', [lote_id, tiendaId]);                 
                    if (loteRes.rows.length === 0) throw new Error("Lote no existe en esta sucursal.");                 
                    const lote = loteRes.rows[0];                                  
                    
                    if (parseFloat(lote.cantidad_actual) < cant) throw new Error(`El lote solo tiene ${lote.cantidad_actual}${unidad}.`);                 
                    
                    // Extracción del costo real del lote si varía del base
                    if (parseFloat(lote.costo_unitario) > 0) costoImpactado = cant * parseFloat(lote.costo_unitario);

                    await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [cant, lote_id]);                 
                    detalleLote = ` (Depósito - Lote: ${lote.codigo_lote})`;             
                } else {                 
                    // FIFO Automático en Depósito
                    let porDescontar = cant;                 
                    const lotesRes = await client.query(`                     
                        SELECT id, codigo_lote, cantidad_actual, costo_unitario                      
                        FROM lotes 
                        WHERE producto_id = $1 AND tienda_id = $2 AND cantidad_actual > 0                      
                        ORDER BY fecha_vencimiento ASC FOR UPDATE                 
                    `, [producto_id, tiendaId]);                 
                    
                    for (const lote of lotesRes.rows) {                     
                        if (porDescontar <= 0) break;                     
                        const disponible = parseFloat(lote.cantidad_actual);                     
                        const tomar = Math.min(porDescontar, disponible);                                          
                        
                        await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2', [tomar, lote.id]);                     
                        porDescontar -= tomar;                 
                    }                 
                    detalleLote = " (Depósito - Automático/FIFO)";             
                }             
                nuevoStockGlobal = parseFloat(producto.stock_unidades) - cant;         
                
            } else if (tipo === 'ENTRADA') {             
                nuevoStockGlobal = parseFloat(producto.stock_unidades) + cant;             
                const codigoFinal = codigo_manual ? codigo_manual.toUpperCase() : `AJUSTE-DEP-T${tiendaId}-${Date.now()}`;             
                const fechaVencimiento = new Date();             
                fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 2); 
                
                await client.query(`                 
                    INSERT INTO lotes (producto_id, codigo_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, costo_unitario, tienda_id)                 
                    VALUES ($1, $2, $3, $4, $5, $6, $7)             
                `, [producto_id, codigoFinal, fechaVencimiento, cant, cant, costoUnitarioHistorico, tiendaId]);                          
                
                detalleLote = ` (Depósito - Nuevo Lote: ${codigoFinal})`;         
            }         
            
            // Actualizar inventario de depósito
            await client.query('UPDATE productos SET stock_unidades = $1 WHERE id = $2 AND tienda_id = $3', [nuevoStockGlobal, producto_id, tiendaId]);         
        
        // =========================================================
        // ESCENARIO B: EL AJUSTE SE EJECUTA EN EL ESTANTE (MOSTRADOR)
        // =========================================================
        } else if (ubicacion === 'ESTANTE') {
            // Valoración para mostrador: Si son esencias/materia prima calculamos el costo por gramo/ml real
            const esMateriaPrima = ['ALCOHOL', 'ESENCIAS', 'FIJADOR'].includes((producto.categoria || '').toUpperCase()) || capacidad > 1;
            const costoPorGramoUnidad = esMateriaPrima ? (costoUnitarioHistorico / capacidad) : costoUnitarioHistorico;
            costoImpactado = cant * costoPorGramoUnidad;

            if (tipo === 'SALIDA') {
                if (parseFloat(producto.stock_estante) < cant) throw new Error("Stock insuficiente en el Estante de mostrador.");

                let pendiente = cant;
                // Barremos las botellas abiertas en piso de venta
                const botellasRes = await client.query(`
                    SELECT id, cantidad FROM botellas_estante 
                    WHERE producto_id = $1 AND (estado = 'ABIERTA' OR estado = 'TESTER')
                    ORDER BY id ASC FOR UPDATE
                `, [producto_id]);

                for (const b of botellasRes.rows) {
                    if (pendiente <= 0.001) break;
                    const disponibleBotella = parseFloat(b.cantidad);
                    const tomar = Math.min(pendiente, disponibleBotella);

                    const nuevaCantBotella = disponibleBotella - tomar;
                    if (nuevaCantBotella <= 0.01) {
                        await client.query('DELETE FROM botellas_estante WHERE id = $1', [b.id]);
                    } else {
                        const nuevoPorc = Math.min(100, Math.round((nuevaCantBotella / capacidad) * 100));
                        await client.query('UPDATE botellas_estante SET cantidad = $1, porcentaje_actual = $2 WHERE id = $3', [nuevaCantBotella, nuevoPorc, b.id]);
                    }
                    pendiente -= tomar;
                }
                nuevoStockEstante = Math.max(0, parseFloat(producto.stock_estante) - cant);
                detalleLote = " (Estante - Vaciado de Botellas)";

            } else if (tipo === 'ENTRADA') {
                nuevoStockEstante = parseFloat(producto.stock_estante) + cant;
                const nuevoPorcentaje = Math.min(100, Math.round((cant / capacidad) * 100));
                
                // Creamos una nueva botella abierta en el estante en el Piso 1 por defecto
                await client.query(`
                    INSERT INTO botellas_estante (producto_id, cantidad, porcentaje_actual, ubicacion, fila, estado)
                    VALUES ($1, $2, $3, 'A', '1', 'ABIERTA')
                `, [producto_id, cant, nuevoPorcentaje]);
                detalleLote = " (Estante - Inyección de Botella Abierta)";
            }

            // Actualizar inventario de estante
            await client.query('UPDATE productos SET stock_estante = $1 WHERE id = $2 AND tienda_id = $3', [nuevoStockEstante, producto_id, tiendaId]);         
        }
        
        const valorFinancieroTexto = `${tipo === 'SALIDA' ? '-' : '+'}$${costoImpactado.toFixed(2)} USD`;
        const fotoTextoLog = foto_evidencia ? ` | Evidencia: ${foto_evidencia}` : '';

        // 🔒 Historial de Movimientos Unificado
        await client.query(             
            `INSERT INTO historial_movimientos (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, motivo, tienda_id, fecha)             
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,             
            [
                producto_id, 
                `AJUSTE_${tipo}`, 
                cant, 
                ubicacion === 'DEPOSITO' ? producto.stock_unidades : producto.stock_estante, 
                ubicacion === 'DEPOSITO' ? nuevoStockGlobal : nuevoStockEstante, 
                `AJUSTE ${ubicacion} (${motivo}). Impacto Financiero: ${valorFinancieroTexto}${detalleLote}${fotoTextoLog}`, 
                tiendaId
            ]
        );         
        
        // 🔒 Auditoría General Corporativa con Valoración Financiera
        await client.query(             
            "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'AJUSTE', $2, NOW())",              
            [usuarioId, `Tienda ${tiendaId} - Ajuste de ${tipo} en ${ubicacion} para ${producto.nombre}. Cantidad: ${cant}${unidad}. Costo Impactado: ${valorFinancieroTexto}.${fotoTextoLog}`]         
        );         
        
        await client.query('COMMIT');         
        res.json({ 
            mensaje: 'Ajuste procesado con éxito', 
            nuevo_stock: ubicacion === 'DEPOSITO' ? nuevoStockGlobal : nuevoStockEstante, 
            unidad: unidad,
            impacto: valorFinancieroTexto 
        });     
    } catch (error) {         
        await client.query('ROLLBACK');         
        res.status(500).json({ error: error.message });     
    } finally {         
        client.release();     
    } 
};

// 3. ACTUALIZAR TASA DEL DÓLAR (Global)
const updateTasaDolar = async (req, res) => {     
    const { nuevaTasa } = req.body;     
    try {         
        await pool.query("UPDATE configuracion SET valor = $1 WHERE clave = 'tasa_dolar'", [nuevaTasa]);         
        res.json({ mensaje: 'Tasa actualizada correctamente' });     
    } catch (error) {         
        console.error("Error BD en updateTasaDolar:", error); 
        res.status(500).json({ error: 'Error actualizando tasa' });     
    } 
};

// 4. OBTENER MENSAJE DE PAGO (Global)
const getMensajePago = async (req, res) => {     
    try {         
        const result = await pool.query("SELECT valor FROM configuracion WHERE clave = 'mensaje_pago'");         
        res.json({ mensaje: result.rows.length > 0 ? result.rows[0].valor : '' });     
    } catch (error) {         
        res.status(500).json({ error: 'Error obteniendo mensaje de pago' });     
    } 
};

// 5. ACTUALIZAR MENSAJE DE PAGO Y REACTIVAR SISTEMA (Global)
const updateMensajePago = async (req, res) => {     
    const { nuevoMensaje } = req.body;     
    const client = await pool.connect();     
    try {         
        await client.query('BEGIN');                  
        // 1. Guardar la nueva fecha         
        await client.query(`             
            INSERT INTO configuracion (clave, valor)              
            VALUES ('mensaje_pago', $1)              
            ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor         
        `, [nuevoMensaje]);         
        
        // 2. Reactivar el sistema en la base de datos automáticamente         
        await client.query(`             
            INSERT INTO configuracion (clave, valor)              
            VALUES ('sistema_activo', 'true')              
            ON CONFLICT (clave) DO UPDATE SET valor = 'true'         
        `);         
        
        await client.query('COMMIT');         
        res.json({ mensaje: 'Fecha actualizada y sistema reactivado correctamente' });     
    } catch (error) {         
        await client.query('ROLLBACK');         
        res.status(500).json({ error: 'Error actualizando licencia' });     
    } finally {         
        client.release();     
    } 
};


// 🔥 NUEVO: OBTENER Y SINCRONIZAR LA TASA DEL BCV DESDE API EXTERNA
const sincronizarTasaBCV = async (req, res) => {
    // 🛡️ PASARELAS POR IP DIRECTA (Para servidores locales sin resolución de nombres DNS)
    // Usamos endpoints directos en servidores espejo estables que devuelven la tasa oficial limpia
    const PASARELAS_IP = [
        'https://104.21.75.122/api/bcv',      // IP Espejo Directa A (Sanitizada)
        'https://172.67.184.145/api/v1/bcv',  // IP Espejo Directa B (Sanitizada)
        'https://104.26.12.32/exchange-rate'  // IP Espejo Directa C (Respaldo)
    ];
    
    let tasaNumerica = null;
    let apiExitosa = null;
    let ultimoError = null;

    // Ejecutamos el barrido en cascada por IPs directas
    for (const urlIp of PASARELAS_IP) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 segundos por intento

            console.log(`[PERFUMIX PROXY] Conectando a IP de contingencia fiscal: ${urlIp}`);
            
            const response = await fetch(urlIp, { 
                method: 'GET',
                signal: controller.signal,
                headers: { 
                    'Host': 've.disweb.top', // Inyectamos el Host virtual para que el servidor remoto acepte la IP
                    'Accept': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);
            if (!response.ok) continue;
            
            const data = await response.json();
            const tasaRecibida = data.bcv || data.precio || data.rate || data.price; 

            const numeroAux = parseFloat(tasaRecibida);
            if (numeroAux && !isNaN(numeroAux) && numeroAux > 0) {
                tasaNumerica = numeroAux;
                apiExitosa = urlIp;
                break; // ¡Éxito contable! Conseguimos la tasa oficial, rompemos la cascada
            }
        } catch (err) {
            ultimoError = err.message;
            console.warn(`[PERFUMIX PROXY WARNING] Falla en pasarela IP ${urlIp}: ${err.message}`);
        }
    }

    // --- EVALUACIÓN Y PERSISTENCIA EN POSTGRESQL ---
    try {
        if (!tasaNumerica) {
            throw new Error(`Los canales de contingencia por IP fallaron. Reporte: ${ultimoError}`);
        }

        // 💾 Guardamos físicamente en tu tabla de configuración en PostgreSQL
        await pool.query("UPDATE configuracion SET valor = $1 WHERE clave = 'tasa_dolar'", [tasaNumerica]);         
        console.log(`[PERFUMIX BACKEND OK] Tasa grabada con éxito por túnel IP: ${tasaNumerica} Bs.`);

        res.json({ 
            mensaje: 'Sincronización automatizada por proxy IP completada.',
            tasa: tasaNumerica,
            origen: 'Proxy Interno Fiscal'
        });

    } catch (error) {
        console.error("❌ [API BCV PROXY CRITICAL FAILURE]:", error.message);
        res.status(503).json({ 
            error: 'Servidor local desconectado de los nodos cambiarios.',
            detalle: error.message,
            requiere_manual: true
        });
    }
};

module.exports = { crearAjuste, getTasaDolar, updateTasaDolar, getMensajePago, updateMensajePago, sincronizarTasaBCV };