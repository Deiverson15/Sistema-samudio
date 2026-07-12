const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const logSeguridad = async (accion, detalle, usuarioId = null) => {
    try {
        await pool.query(
            "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, $2, $3, NOW())",
            [usuarioId, accion, detalle]
        );
    } catch (err) { console.error("Error guardando log seguridad:", err); }
};

const registro = async (req, res) => {
    const { nombre, email, password, rol, direccion } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        const response = await pool.query(
            'INSERT INTO usuarios (nombre, email, password, rol, direccion, activo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id, nombre, email, rol',
            [nombre, email, hash, rol || 'vendedor', direccion || null]
        );
        await logSeguridad('CREAR_USUARIO', `Se registró el usuario: ${email}`);

        res.json({ mensaje: 'Usuario creado', usuario: response.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error creando usuario (Email duplicado?)' });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!JWT_SECRET) return res.status(500).json({ error: 'Error de configuración.' });
        const response = await pool.query(
            `SELECT u.*, t.nombre as tienda_nombre 
             FROM usuarios u 
             LEFT JOIN tiendas t ON u.tienda_id = t.id 
             WHERE u.email = $1`, 
            [email]
        );
        
        const user = response.rows[0];

        if (!user || !await bcrypt.compare(password, user.password)) {
            await logSeguridad('SEGURIDAD_LOGIN_FAIL', `Credenciales erróneas: ${email}`, user?.id);
            return res.status(400).json({ error: 'Credenciales inválidas' });
        }

        if (!user.activo) return res.status(403).json({ error: 'Usuario inactivo.' });

        const token = jwt.sign(
            { 
                id: user.id, 
                rol: user.rol, 
                nombre: user.nombre, 
                tienda_id: user.tienda_id 
            }, 
            JWT_SECRET,
            { expiresIn: '48h' }
        );
        await pool.query('UPDATE usuarios SET token_sesion = $1 WHERE id = $2', [token, user.id]);

        res.json({
            message: 'Bienvenido',
            token: token,
            user: { 
                id: user.id,
                nombre: user.nombre, 
                rol: user.rol, 
                email: user.email,
                tienda_id: user.tienda_id,
                tienda_nombre: user.tienda_nombre || 'Sin tienda asignada'
            }
        });

    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
};

const renovarToken = async (req, res) => {
    try {
        const { id, rol, nombre } = req.user;

        const nuevoToken = jwt.sign(
            { id, rol, nombre }, 
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        await pool.query('UPDATE usuarios SET token_sesion = $1 WHERE id = $2', [nuevoToken, id]);

        res.json({ token: nuevoToken });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al renovar sesión' });
    }
};

module.exports = { registro, login, renovarToken };