const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin, verifyGerente } = require('../middleware/auth');

// 1. IMPORTAMOS TODOS LOS CONTROLADORES (Asegúrate de tenerlos todos)
const { 
    getProductos, 
    createProducto, 
    updateProducto, 
    deleteProducto, 
    importarMasivo,
    getHistorialImportaciones,
    revertirImportacion, 
    getKardex, 
    getLotesProducto, 
    eliminarFisico, 
    reactivarProducto,
    cambiarSucursalActiva,
    
    // --- NUEVAS FUNCIONES DE ESTANTE ---
    getProductosEstante,        // Cargar el estante
    reponerEstante,            // Traer del almacén (Solicitar Recambio)
    crearTester,               // Crear tester (y descontar insumos)
    reponerTester,             // Rellenar tester existente
    distribuirProducto,        // Mover botella (Apartamento/Organizar)
    gestionarMovimientoEstante,// Merma o Devolución
    eliminarBotella,           // Borrar botella (Tester o vacía)
    sincronizarStock,          // El botón "Reparar Inventario"
    
    exportarExcel,
    getUbicacionSugerida,
    obtenerProductoPorReferencia,
    moverStockEstante,vaciadoMasivoEstante,getReporteKardex, descargarAuditoriaExcel
} = require('../controllers/productos.controller');




// ==========================================
// RUTAS DE PRODUCTOS (INVENTARIO GENERAL)
// ==========================================

// Leer


router.get('/', verifyToken, getProductos);
router.get('/referencia/:referencia', verifyToken, obtenerProductoPorReferencia);
router.get('/:id/kardex', verifyToken, getKardex);
router.get('/:id/lotes', verifyToken, getLotesProducto);
router.get('/:id/ubicacion-sugerida', verifyToken, getUbicacionSugerida);

// Crear / Editar / Eliminar (Solo Admin/Gerente)
router.post('/', verifyToken, verifyGerente, createProducto);
router.put('/:id', verifyToken, verifyGerente, updateProducto);
router.delete('/:id', verifyToken, verifyAdmin, deleteProducto); // Borrado lógico (Archivar)
router.delete('/:id/fisico', verifyToken, verifyAdmin, eliminarFisico); // Borrado total
router.put('/:id/reactivar', verifyToken, verifyAdmin, reactivarProducto);

// Importación y Exportación
router.post('/importar', verifyToken, verifyGerente, importarMasivo);
router.get('/reportes/excel', verifyToken, exportarExcel); // ?filtro=todo|inventario|estante


// ==========================================
// RUTAS DEL ESTANTE (TIENDA / BOTELLAS)
// ==========================================

// 1. Cargar datos del estante
router.get('/estante', verifyToken, getProductosEstante);

// 2. Mover del Almacén General -> A "Pendientes" (Caja cerrada)
router.post('/mover-estante', verifyToken, verifyGerente, moverStockEstante);

// 3. Solicitar Recambio (Botón "Traer del Almacén" directo a una fila)
router.post('/:id/reponer', verifyToken, reponerEstante); 

// 4. Organizar / Mover Botella (De Pendiente a A1, o de A1 a B2, etc.)
router.post('/estante/distribuir/:idBotellaOrigen', verifyToken, distribuirProducto);

// 5. TESTERS Y MUESTRAS
// Crear Tester nuevo (o Muestra) - Descuenta insumos
router.post('/estante/:idProducto/tester', verifyToken, verifyGerente, crearTester);
// Rellenar un Tester existente (usando una botella de "Pendientes")
router.put('/estante/:idBotella/reponer', verifyToken, verifyGerente, reponerTester);

// 6. GESTIÓN (Merma, Devolución, Ajuste Manual)
router.post('/estante/:idBotella/gestion', verifyToken, verifyGerente, gestionarMovimientoEstante);

// 7. ELIMINAR BOTELLA (Botón de basura en Tester o botella vacía)
router.delete('/estante/:id', verifyToken, verifyGerente, eliminarBotella);

// 8. MANTENIMIENTO
// El botón mágico "Reparar Inventario" (Sincroniza tablas)
router.post('/sincronizar-todo', verifyToken, sincronizarStock);
router.post('/vaciado-masivo', verifyToken, vaciadoMasivoEstante);

router.post('/importar', verifyToken, verifyGerente, importarMasivo);

// NUEVAS RUTAS DE CONTROL DE EXCEL
router.get('/importaciones/historial', verifyToken, verifyGerente, getHistorialImportaciones);
router.post('/importaciones/:id/revertir', verifyToken, verifyAdmin, revertirImportacion);
router.get('/importaciones/:id/descargar', verifyToken, verifyGerente, descargarAuditoriaExcel); // 🔥 LA NUEVA RUTA

router.post('/cambiar-sucursal', verifyToken, cambiarSucursalActiva);

// Agrega esta línea en la sección de rutas de inventario
router.get('/reporte-kardex', verifyToken, getReporteKardex);

module.exports = router;