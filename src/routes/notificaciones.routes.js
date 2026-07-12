const { Router } = require('express');
const router = Router();
const { getNoLeidas, marcarLeida, marcarTodasLeidas } = require('../controllers/notificaciones.controller');
const { verifyToken } = require('../middleware/auth');

router.get('/', verifyToken, getNoLeidas);
router.put('/:id/leer', verifyToken, marcarLeida);
router.put('/leer-todas', verifyToken, marcarTodasLeidas);

module.exports = router;