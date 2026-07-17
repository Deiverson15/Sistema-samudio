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

// Fase 1: Crear la orden y reservar el stock
router.post('/orden', verifyToken, verifyGerente, crearOrden);

// Fase 3 y 4: Reportar producción, calcular mermas y liberar stock real
router.post('/orden/:id/completar', verifyToken, verifyGerente, completarOrden);

module.exports = router;