const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin, verifyGerente } = require('../middleware/auth');

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
    
    getProductosEstante,
    reponerEstante,
    crearTester,
    reponerTester,
    distribuirProducto,
    gestionarMovimientoEstante,
    eliminarBotella,
    sincronizarStock,
    
    exportarExcel,
    getUbicacionSugerida,
    obtenerProductoPorReferencia,
    moverStockEstante,
    vaciadoMasivoEstante,
    getReporteKardex, 
    descargarAuditoriaExcel,
    obtenerEstancamiento, 
    exportarEstancamientoExcel,
    getReporteListaPrecios, 
    exportarListaPreciosExcel,
    exportarKardexProductoExcel
} = require('../controllers/productos.controller');

// ==========================================
// RUTAS DE REPORTES Y CONSULTAS (SOLO TOKEN)
// ==========================================
router.get('/reportes/lista-precios', verifyToken, getReporteListaPrecios);
router.get('/reportes/lista-precios/excel', verifyToken, exportarListaPreciosExcel);
router.get('/', verifyToken, getProductos);
router.get('/referencia/:referencia', verifyToken, obtenerProductoPorReferencia);
router.get('/:id/kardex', verifyToken, getKardex);
router.get('/:id/lotes', verifyToken, getLotesProducto);
router.get('/:id/ubicacion-sugerida', verifyToken, getUbicacionSugerida);
router.get('/reportes/excel', verifyToken, exportarExcel);
router.get('/estancamiento', verifyToken, obtenerEstancamiento);
router.get('/estancamiento/excel', verifyToken, exportarEstancamientoExcel);
router.get('/estante', verifyToken, getProductosEstante);
router.get('/reporte-kardex', verifyToken, getReporteKardex);
router.get('/exportar-kardex', exportarKardexProductoExcel);

// ==========================================
// RUTAS DE GESTIÓN (REQUIEREN PERMISO GERENTE)
// ==========================================
router.post('/', verifyGerente, createProducto);
router.put('/:id', verifyGerente, updateProducto);
router.delete('/:id', verifyGerente, deleteProducto);
router.delete('/:id/fisico', verifyGerente, eliminarFisico);
router.put('/:id/reactivar', verifyGerente, reactivarProducto);

// Importaciones y Cargas
router.post('/importar', verifyGerente, importarMasivo);
router.get('/importaciones/historial', verifyGerente, getHistorialImportaciones);
router.post('/importaciones/:id/revertir', verifyGerente, revertirImportacion);
router.get('/importaciones/:id/descargar', verifyGerente, descargarAuditoriaExcel);

// Movimientos de Estante
router.post('/mover-estante', verifyGerente, moverStockEstante);
router.post('/:id/reponer', verifyToken, reponerEstante);
router.post('/estante/distribuir/:idBotellaOrigen', verifyToken, distribuirProducto);
router.post('/estante/:idProducto/tester', verifyGerente, crearTester);
router.put('/estante/:idBotella/reponer', verifyGerente, reponerTester);
router.post('/estante/:idBotella/gestion', verifyGerente, gestionarMovimientoEstante);
router.delete('/estante/:id', verifyGerente, eliminarBotella);

// Mantenimiento de Sucursales
router.post('/sincronizar-todo', verifyToken, sincronizarStock);
router.post('/vaciado-masivo', verifyToken, vaciadoMasivoEstante);
router.post('/cambiar-sucursal', verifyToken, cambiarSucursalActiva);

module.exports = router;