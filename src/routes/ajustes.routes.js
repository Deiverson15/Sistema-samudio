const { Router } = require('express');
const router = Router();
const { crearAjuste, getTasaDolar, sincronizarTasaBCV, updateTasaDolar, getMensajePago, updateMensajePago } = require('../controllers/ajustes.controller');
const { verifyToken, verifyGerente } = require('../middleware/auth'); 

// Ajustes principales
router.post('/', crearAjuste);

// Tasas de dólar
router.get('/tasa', verifyToken, getTasaDolar);
router.put('/tasa', verifyGerente, updateTasaDolar);

// Mensaje de pago (SOLO ESTAS DOS, SE ELIMINÓ LA DUPLICADA)
router.get('/mensaje-pago', verifyToken, getMensajePago);
router.put('/mensaje-pago', verifyToken, updateMensajePago);
// Ruta exclusiva para el disparo automático desde el botón de la nube
router.put('/tasa/bcv-sincro', verifyToken, verifyGerente, sincronizarTasaBCV);

module.exports = router;