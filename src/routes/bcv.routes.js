const { Router } = require('express');
const router = Router();
const { getTasaBCV } = require('../controllers/bcv.controller');

router.get('/tasa-bcv', getTasaBCV); 

module.exports = router;