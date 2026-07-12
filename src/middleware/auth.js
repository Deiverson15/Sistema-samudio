const jwt = require('jsonwebtoken');
const pool = require('../config/db'); 
require('dotenv').config();


const logAccesoDenegado = async (req, motivo, usuarioId = null) => {
    try {
        const ruta = req.originalUrl || req.url;
        await pool.query(
            "INSERT INTO auditoria (accion, detalle, fecha, usuario_id) VALUES ('SEGURIDAD_ACCESO_DENEGADO', $1, NOW(), $2)",
            [`Intento: ${req.method} ${ruta}. Motivo: ${motivo}`, usuarioId]
        );
    } catch (err) { console.error("Error log auditoria:", err); }
};

const verifyToken = async (req, res, next) => {
    // 1. Obtener el token
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; 
    if (!token && req.query.token) token = req.query.token;

    if (!token) return res.status(403).json({ error: 'Token requerido' });

    try {
        // 2. Verificar firma del token
        const secret = process.env.JWT_SECRET;
        const decoded = jwt.verify(token, secret);

        // 3. VERIFICACIÓN ESTRICTA EN BASE DE DATOS
        const userResult = await pool.query(
            'SELECT id, rol, nombre, activo, token_sesion, tienda_id FROM usuarios WHERE id = $1', 
            [decoded.id]
        );
        const user = userResult.rows[0];

        if (!user) return res.status(401).json({ error: 'Usuario no encontrado.' });

        if (!user.activo) {
            await logAccesoDenegado(req, 'Usuario Bloqueado intentó acceder', user.id);
            return res.status(401).json({ error: 'Su cuenta ha sido desactivada. Contacte al administrador.' });
        }

        // 4. LÓGICA DE AUTO-BLOQUEO DEL SISTEMA
        const configRes = await pool.query("SELECT clave, valor FROM configuracion WHERE clave IN ('sistema_activo', 'mensaje_pago')");
        
        let sistemaActivo = true;
        let fechaLimite = null;

        configRes.rows.forEach(row => {
            if (row.clave === 'sistema_activo') sistemaActivo = (row.valor === 'true' || row.valor === true || row.valor === '1');
            if (row.clave === 'mensaje_pago' && row.valor) fechaLimite = row.valor;
        });

        if (sistemaActivo && fechaLimite) {
            const fechaVencimiento = new Date(fechaLimite);
            fechaVencimiento.setHours(23, 59, 59, 999);
            
            if (new Date() > fechaVencimiento) {
                sistemaActivo = false;
                await pool.query("UPDATE configuracion SET valor = 'false' WHERE clave = 'sistema_activo'");
            }
        }

        const rolUsuario = user.rol ? user.rol.toLowerCase() : '';

        if (!sistemaActivo && rolUsuario !== 'developer' && rolUsuario !== 'dev') {
            return res.status(402).json({ 
                error: 'SISTEMA_SUSPENDIDO',
                message: 'El sistema se encuentra temporalmente suspendido. Contacte al desarrollador.' 
            });
        }

        if (user.token_sesion !== token) {
            return res.status(401).json({ error: 'Sesión inválida. Se ha iniciado sesión en otro dispositivo.' });
        }

        req.user = user; 
        next();

    } catch (error) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

const checkRol = (rolesPermitidos) => {
    return (req, res, next) => {
        // Pasamos el rol a minúsculas para que no importen las mayúsculas en la BD
        const rolUsuario = req.user && req.user.rol ? req.user.rol.toLowerCase() : '';
        
        // Si el usuario es developer o dev, SIEMPRE tiene acceso (Modo Dios)
        if (req.user && (rolesPermitidos.includes(rolUsuario) || rolUsuario === 'developer' || rolUsuario === 'dev')) {
            next();
        } else {
            res.status(403).json({ error: 'No tienes permisos para realizar esta acción.' });
        }
    };
};

const verifyAdmin = [verifyToken, checkRol(['admin', 'superadmin'])];
const verifyGerente = [verifyToken, checkRol(['admin', 'superadmin', 'gerente'])];
const verifyVendedor = [verifyToken, checkRol(['admin', 'superadmin', 'gerente', 'vendedor'])];

module.exports = { verifyToken, verifyAdmin, verifyGerente, verifyVendedor };