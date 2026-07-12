const { Router } = require('express');
const router = Router();
const { verifyGerente } = require('../middleware/auth'); 

// IMPORTANTE: Estos nombres deben ser los mismos que en el compras.controller.js
const { 
    registrarLoteMaestro, 
    distribuirPeso, 
    getLotesMaestros,
    getHistorialLote,
    distribuirMasivo
} = require('../controllers/compras.controller');

// GET /api/compras -> Ver los lotes globales y su saldo
router.get('/', verifyGerente, getLotesMaestros);      

// POST /api/compras/registrar -> Paso 1: Crear el lote de 100kg
router.post('/registrar', verifyGerente, registrarLoteMaestro); 

// POST /api/compras/distribuir -> Paso 2: Repartir kg a esencias
router.post('/distribuir', verifyGerente, distribuirPeso);

router.get('/:id/historial', verifyGerente, getHistorialLote);// Ruta para distribuir masivamente
router.post('/distribuir-masivo',verifyGerente,  distribuirMasivo);

module.exports = router;