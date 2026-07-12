const { Router } = require('express');
const router = Router();
const { buscarClientes, crearCliente } = require('../controllers/clientes.controller');

// Rutas de Clientes (Ventas)
// GET /api/clientes?q=nombre (Buscador)
router.get('/', buscarClientes); 

// POST /api/clientes (Crear nuevo)
router.post('/', crearCliente);

module.exports = router;