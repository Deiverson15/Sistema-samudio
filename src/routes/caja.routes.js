const { Router } = require('express');
const router = Router();
const { getEstadoCaja, abrirCaja, cerrarCaja } = require('../controllers/caja.controller');
const { verifyToken } = require('../middleware/auth'); // Ojo: verifica que la ruta al middleware sea correcta

// CORRECCIÓN: Quitamos "/caja" porque ya está definido en index.js
// La ruta final será /api/caja/estado
router.get('/estado', verifyToken, getEstadoCaja);

// La ruta final será /api/caja/abrir
router.post('/abrir', verifyToken, abrirCaja);

// La ruta final será /api/caja/cerrar
router.post('/cerrar', verifyToken, cerrarCaja);

module.exports = router;