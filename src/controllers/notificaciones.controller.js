const pool = require('../config/db');

// --- HELPER INTERNO (Para usar desde otros controladores) ---
const crearNotificacionInterna = async (mensaje, tipo = 'INFO', ruta = '#') => {
    try {
        await pool.query(
            'INSERT INTO notificaciones (mensaje, tipo, ruta, fecha) VALUES ($1, $2, $3, NOW())',
            [mensaje, tipo, ruta]
        );
    } catch (e) { console.error("Error creando notificación:", e.message); }
};

// --- API PÚBLICA (Para el Frontend) ---

const getNoLeidas = async (req, res) => {
    try {
        // Traemos solo las últimas 10 no leídas para no saturar
        const response = await pool.query(
            "SELECT * FROM notificaciones WHERE leido = false ORDER BY fecha DESC LIMIT 10"
        );
        res.json(response.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const marcarLeida = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE notificaciones SET leido = true WHERE id = $1', [id]);
        res.json({ mensaje: 'Leída' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const marcarTodasLeidas = async (req, res) => {
    try {
        await pool.query('UPDATE notificaciones SET leido = true WHERE leido = false');
        res.json({ mensaje: 'Todas leídas' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

module.exports = { 
    getNoLeidas, 
    marcarLeida, 
    marcarTodasLeidas,
    crearNotificacionInterna // Exportamos esto para usarlo en Ventas/Inventario
};