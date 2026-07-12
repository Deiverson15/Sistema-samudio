const { Router } = require('express');
const router = Router();
const { getVencimientos, getLogs } = require('../controllers/auditoria.controller');

// Ruta Final: GET /api/auditoria/vencimientos
router.get('/vencimientos', getVencimientos);

// Ruta Final: GET /api/auditoria (Para ver los logs)
router.get('/', getLogs); 

module.exports = router;