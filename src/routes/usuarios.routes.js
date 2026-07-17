const { Router } = require('express');
const router = Router();
const { verifyAdmin, verifyToken } = require('../middleware/auth');
const { 
    getUsuarios, 
    crearUsuario, 
    toggleEstadoUsuario, 
    getHistorialUsuario,
    eliminarUsuario,
    actualizarUsuario
} = require('../controllers/usuarios.controller');

const productosController = require('../controllers/productos.controller');

// GET /api/usuarios (Lista de usuarios)
router.get('/', verifyAdmin, getUsuarios); 

// POST /api/usuarios (Crear usuario)
router.post('/', verifyAdmin, crearUsuario); 

// PUT /api/usuarios/:id/estado (Activar/Desactivar)
router.put('/:id/estado', verifyAdmin, toggleEstadoUsuario);

// GET /api/usuarios/:id/actividad (Ver Historial del usuario)
router.get('/:id/actividad', verifyAdmin, getHistorialUsuario);

// DELETE /api/usuarios/:id (Eliminar permanentemente)
router.delete('/:id', verifyAdmin, eliminarUsuario);

// PUT /api/usuarios/:id (Editar información general del usuario)
router.put('/:id', verifyAdmin, actualizarUsuario);



module.exports = router;