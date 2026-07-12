const { Router } = require('express');
const router = Router();
const { 
    crearVenta, 
    getReportes, 
    getFacturaPDF, 
    getFacturaExcel, 
    getDashboardKPIs,
    getVentas,
    getVentaById,      
    guardarCierre,        
    getHistorialCierres,
    previsualizarCierre,  
    descargarCierreExcel, 
    exportarReporteGeneral, 
    anularVentaDefinitiva,
    forzarCierreManualHistorico,
    guardarBorradorCombo,
    obtenerBorradoresPorFormula,
    eliminarBorradorCombo,
    distribuirLoteEstante,
    bajarInventarioAEstanteMasa,
    bajarInventarioLoteCompleto,
    getReportesConsolidadosRed
} = require('../controllers/ventas.controller');

const { verifyToken } = require('../middleware/auth');

// Importaciones del controlador de reportes semanales
const { getResumenSemanal, exportarExcelSemanal } = require('../controllers/reporteSemanal.controller');

// =======================================================================
// 1. REPORTES Y ESTADÍSTICAS (Rutas fijas)
// =======================================================================
router.get('/exportar/excel', verifyToken, exportarReporteGeneral); 
router.get('/dashboard-kpis', getDashboardKPIs);
router.get('/reportes', getReportes);

// =======================================================================
// 2. GESTIÓN DE CIERRES Y ARQUEOS
// =======================================================================
router.get('/cierre/previsualizar', verifyToken, previsualizarCierre); 

// UBICACIÓN CORRECTA: Rutas fijas semanales ANTES de cualquier parámetro ":id"
router.get('/cierre/semanal', verifyToken, getResumenSemanal);
router.get('/cierre/semanal/excel', verifyToken, exportarExcelSemanal);

router.post('/cierre', verifyToken, guardarCierre);                 
router.get('/cierre/historial', verifyToken, getHistorialCierres);  
router.post('/cierres/forzar-historico', verifyToken, forzarCierreManualHistorico);
router.get('/cierre/:id/excel', verifyToken, descargarCierreExcel);

// =======================================================================
// 3. SISTEMA DE BORRADORES / COMBOS TEMPORALES
// =======================================================================
router.post('/borradores', verifyToken, guardarBorradorCombo);
router.get('/borradores/formula/:formulaId', verifyToken, obtenerBorradoresPorFormula);
router.delete('/borradores/:id', verifyToken, eliminarBorradorCombo);

// =======================================================================
// 4. ACCIONES DE INVENTARIO EN ESTANTE
// =======================================================================
router.post('/estante/distribuir-lote', verifyToken, distribuirLoteEstante);
router.post('/inventario/bajar-estante-lote', verifyToken, bajarInventarioAEstanteMasa);
router.post('/inventario/bajar-estante-vaciado', verifyToken, bajarInventarioLoteCompleto);

// =======================================================================
// 5. OPERACIONES BASE DE MATRIZ VENTAS
// =======================================================================
router.post('/', verifyToken, crearVenta);
router.get('/', getVentas);

// =======================================================================
// 6. RUTAS DINÁMICAS / COMODINES (ESTRICTAMENTE AL FINAL)
// =======================================================================
router.get('/:id/factura/pdf', getFacturaPDF); 
router.get('/:id/factura/excel', getFacturaExcel); 
router.get('/:id', getVentaById);

router.post('/anular-venta/:id', verifyToken, anularVentaDefinitiva);

router.get('/reportes/consolidado-red', verifyToken, getReportesConsolidadosRed);


module.exports = router;