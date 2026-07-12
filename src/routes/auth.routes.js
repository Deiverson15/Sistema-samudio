const { Router } = require('express');
const router = Router();
const { verifyToken } = require('../middleware/auth');
const { registro, login, renovarToken } = require('../controllers/auth.controller');

router.post('/registro', registro); 
router.post('/login', login);

router.post('/renovar', verifyToken, renovarToken);

module.exports = router;