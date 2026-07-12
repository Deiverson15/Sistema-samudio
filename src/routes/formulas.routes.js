const { Router } = require('express');
const router = Router();

// Importamos tus funciones originales intactas + la nueva función de consumo externo
const { getFormulas, createFormula, deleteFormula, updateFormula, consumirFormulaExterna, getHistorialImportaciones, getHistorialSincronizacion } = require('../controllers/formulas.controller');

const { verifyToken } = require('../middleware/auth'); // Asegúrate de tener el middleware

// Añade la ruta debajo de las otras
router.get('/historial-externo', verifyToken,);
// Tus rutas originales exactamente como las tenías (sin middlewares que alteren el flujo)
router.get('/', getFormulas); 
router.post('/', createFormula); 
router.put('/:id', updateFormula);
router.delete('/:id', deleteFormula);

// 🔄 Nueva opción para descontar insumos automáticamente desde tu otro sistema
router.post('/consumir-externo', consumirFormulaExterna);

router.get('/historial-externo', verifyToken, getHistorialSincronizacion);

module.exports = router;