const { Router } = require('express');
const router = Router();
const { verifyToken, verifyGerente } = require('../middleware/auth');
const { 
    getOrdenes, 
    crearOrden, 
    completarOrden 
} = require('../controllers/fabricacion.controller');

// Obtener todas las órdenes (El Kanban)
router.get('/', verifyToken, getOrdenes);

// Fase 1: Crear la orden (verifyGerente ya incluye verifyToken)
router.post('/orden', verifyGerente, crearOrden);

// Fase 3 y 4: Reportar producción y cerrar orden
router.post('/orden/:id/completar', verifyGerente, completarOrden);

module.exports = router;