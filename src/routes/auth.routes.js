const { Router } = require('express');
const router = Router();
const { verifyToken } = require('../middleware/auth');
const { registro, login, renovarToken, establecerTiendaSesion } = require('../controllers/auth.controller');

router.post('/registro', registro); 
router.post('/login', login);

router.post('/renovar', verifyToken, renovarToken);

router.post('/establecer-tienda', verifyToken, establecerTiendaSesion);

module.exports = router;