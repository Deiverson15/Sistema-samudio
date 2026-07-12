const { Router } = require('express');
const router = Router();
const { getProveedores, createProveedor, deleteProveedor } = require('../controllers/proveedores.controller');
// Como index.js ya define '/api/proveedores', aquí usamos '/'
router.get('/', getProveedores);
router.post('/', createProveedor);
router.delete('/:id', deleteProveedor);

module.exports = router;