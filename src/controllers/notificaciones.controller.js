const pool = require('../config/db');

// --- HELPER INTERNO ---
// 🔥 Le añadimos "tiendaId" como 4to parámetro para que los controladores sepan a quién avisarle
const crearNotificacionInterna = async (mensaje, tipo = 'INFO', ruta = '#', tiendaId = null) => {
    try {
        await pool.query(
            'INSERT INTO notificaciones (mensaje, tipo, ruta, fecha, tienda_id) VALUES ($1, $2, $3, NOW(), $4)',
            [mensaje, tipo, ruta, tiendaId]
        );
    } catch (e) { console.error("Error creando notificación:", e.message); }
};

// --- API PÚBLICA (Para el Frontend) ---
const getNoLeidas = async (req, res) => {
    try {
        // 🔥 Buscamos solo las notificaciones de su tienda (o las globales del sistema)
        const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
        const response = await pool.query(
            "SELECT * FROM notificaciones WHERE leido = false AND (tienda_id = $1 OR tienda_id IS NULL) ORDER BY fecha DESC LIMIT 10",
            [idTiendaLocal]
        );
        res.json(response.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const marcarLeida = async (req, res) => {
    const { id } = req.params;
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    try {
        await pool.query('UPDATE notificaciones SET leido = true WHERE id = $1 AND (tienda_id = $2 OR tienda_id IS NULL)', [id, idTiendaLocal]);
        res.json({ mensaje: 'Leída' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const marcarTodasLeidas = async (req, res) => {
    const idTiendaLocal = req.user && req.user.tienda_id ? parseInt(req.user.tienda_id, 10) : 1;
    try {
        await pool.query('UPDATE notificaciones SET leido = true WHERE leido = false AND (tienda_id = $1 OR tienda_id IS NULL)', [idTiendaLocal]);
        res.json({ mensaje: 'Todas leídas' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

module.exports = { 
    getNoLeidas, 
    marcarLeida, 
    marcarTodasLeidas,
    crearNotificacionInterna 
};