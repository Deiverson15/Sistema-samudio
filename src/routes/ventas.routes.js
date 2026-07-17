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
    getReportesConsolidadosRed,
    getListaTiendas,
    getVentasAnuladas, // 🔥 SOLUCIÓN: Agregada la importación faltante
    exportarCierreDeHoyExcel
} = require('../controllers/ventas.controller');

const { verifyToken } = require('../middleware/auth');

// Importaciones del controlador de reportes semanales
const { getResumenSemanal, exportarExcelSemanal } = require('../controllers/reporteSemanal.controller');

// =======================================================================
// 1. REPORTES Y ESTADÍSTICAS (Rutas fijas)
// =======================================================================
router.get('/', verifyToken, getVentas);
router.get('/dashboard-kpis', verifyToken, getDashboardKPIs);
router.get('/reportes', verifyToken, getReportes); 
router.get('/reportes-red', verifyToken, getReportesConsolidadosRed);
router.get('/reportes/consolidado-red', verifyToken, getReportesConsolidadosRed); 
router.get('/anuladas', verifyToken, getVentasAnuladas);
router.get('/exportar/excel', verifyToken, exportarReporteGeneral);
router.get('/lista-tiendas', verifyToken, getListaTiendas);

// =======================================================================
// 2. GESTIÓN DE CIERRES Y ARQUEOS
// =======================================================================
router.get('/cierre/previsualizar', verifyToken, previsualizarCierre); 
router.get('/cierre/previsualizar/excel', verifyToken, exportarCierreDeHoyExcel);
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
router.post('/anular-venta/:id', verifyToken, anularVentaDefinitiva);

// =======================================================================
// 6. RUTAS DINÁMICAS / COMODINES (ESTRICTAMENTE AL FINAL)
// =======================================================================
router.get('/:id/pdf', verifyToken, getFacturaPDF);
router.get('/:id/excel', verifyToken, getFacturaExcel);
router.get('/:id', verifyToken, getVentaById);

// Alias para rutas de facturas (Aseguradas con verifyToken para evitar filtraciones)
router.get('/:id/factura/pdf', verifyToken, getFacturaPDF); 
router.get('/:id/factura/excel', verifyToken, getFacturaExcel); 



module.exports = router;