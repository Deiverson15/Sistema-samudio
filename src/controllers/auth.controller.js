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

// 🔐 REGISTRO: Ahora acepta y guarda la tienda del nuevo empleado
const registro = async (req, res) => {
    // 🔥 MODIFICADO: Extraemos tienda_id del cuerpo de la petición
    const { nombre, email, password, rol, direccion, tienda_id } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        // 🔥 MODIFICADO: Insertamos el tienda_id en la base de datos (por defecto tienda 1 si viene vacío)
        const response = await pool.query(
            'INSERT INTO usuarios (nombre, email, password, rol, direccion, tienda_id, activo) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id, nombre, email, rol, tienda_id',
            [nombre, email, hash, rol || 'vendedor', direccion || null, tienda_id || 1]
        );
        await logSeguridad('CREAR_USUARIO', `Se registró el usuario: ${email}`);

        res.json({ mensaje: 'Usuario creado con éxito', usuario: response.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error creando usuario (Email duplicado?)' });
    }
};


const login = async (req, res) => {
    const { email, password, tienda_id } = req.body;

    try {
        if (!JWT_SECRET) return res.status(500).json({ error: 'Error de configuración.' });
        
        // Buscamos el usuario y su tienda base
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

        const rolUsuario = user.rol ? user.rol.toLowerCase().trim() : '';
        const esUsuarioMaestro = rolUsuario === 'developer' || 
                                 rolUsuario === 'dev' || 
                                 rolUsuario === 'súper administrador' || 
                                 rolUsuario === 'super administrador' ||
                                 rolUsuario === 'administrador' ||
                                 rolUsuario === 'admin';

        // 🔀 ACCIÓN INTERCEPTORA PARA ROLES MAESTROS
        if (esUsuarioMaestro) {
            
            // 🔥 ESCENARIO 1 (El salto directo): El frontend mandó el tienda_id en la pantalla de login
            if (tienda_id) {
                // Actualizamos la base de datos físicamente al instante
                await pool.query('UPDATE usuarios SET tienda_id = $1 WHERE id = $2', [tienda_id, user.id]);
                user.tienda_id = tienda_id; // Sincronizamos en memoria para generar el token
                
                // Consultamos el nombre real de la tienda para el frontend
                const nomTienda = await pool.query('SELECT nombre FROM tiendas WHERE id = $1', [tienda_id]);
                user.tienda_nombre = nomTienda.rows.length > 0 ? nomTienda.rows[0].nombre : 'Desconocida';
                
                console.log(`[LOGIN MAESTRO] ${user.rol} aterrizó directo en Tienda ID: ${tienda_id}`);
                // Si entra aquí, ignora el paso de abajo y cae en el "FLUJO NORMAL" para generar su token final.
            } 
            // 🛡️ ESCENARIO 2 (Seguridad 2 Pasos): No mandaron tienda, emitimos token provisional
            else {
                const tiendasRes = await pool.query('SELECT id, nombre, direccion FROM tiendas WHERE activo = true ORDER BY id ASC');
                
                const tokenProvisional = jwt.sign(
                    { id: user.id, rol: user.rol, nombre: user.nombre, provisional: true }, 
                    JWT_SECRET,
                    { expiresIn: '15m' }
                );

                await pool.query('UPDATE usuarios SET token_sesion = $1 WHERE id = $2', [tokenProvisional, user.id]);

                return res.json({
                    message: 'Requiere selección de sucursal',
                    seleccionar_tienda: true, 
                    token: tokenProvisional,
                    tiendas: tiendasRes.rows, 
                    user: {
                        id: user.id,
                        nombre: user.nombre,
                        rol: user.rol,
                        email: user.email
                    }
                });
            }
        }

        // 🛒 FLUJO NORMAL (Vendedores, Gerentes fijos, o Maestros que pasaron el Escenario 1)
        const token = jwt.sign(
            { id: user.id, rol: user.rol, nombre: user.nombre, tienda_id: user.tienda_id }, 
            JWT_SECRET,
            { expiresIn: '48h' }
        );
        
        await pool.query('UPDATE usuarios SET token_sesion = $1 WHERE id = $2', [token, user.id]);

        res.json({
            message: 'Bienvenido',
            seleccionar_tienda: false,
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
        // 🔥 MODIFICADO: Extraemos también el tienda_id que emitió el middleware verifyToken
        const { id, rol, nombre, tienda_id } = req.user;

        // 🔥 MODIFICADO: Añadimos tienda_id al payload para que no se pierda al refrescar
        const nuevoToken = jwt.sign(
            { id, rol, nombre, tienda_id }, 
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

const establecerTiendaSesion = async (req, res) => {
    const { tienda_id } = req.body;
    const { id, rol, nombre, email } = req.user; 

    try {
        if (!tienda_id) return res.status(400).json({ error: 'Debe seleccionar una tienda válida.' });

        const tiendaRes = await pool.query('SELECT nombre FROM tiendas WHERE id = $1', [tienda_id]);
        if (tiendaRes.rowCount === 0) return res.status(404).json({ error: 'La tienda seleccionada no existe.' });

        const tokenDefinitivo = jwt.sign(
            { id, rol, nombre, tienda_id: parseInt(tienda_id) }, 
            JWT_SECRET,
            { expiresIn: '48h' }
        );

        // 🔥 CORRECCIÓN CRÍTICA: Aquí grabamos la tienda seleccionada FÍSICAMENTE en la base de datos
        await pool.query(
            'UPDATE usuarios SET token_sesion = $1, tienda_id = $2 WHERE id = $3', 
            [tokenDefinitivo, tienda_id, id]
        );

        console.log(`[SESIÓN MAESTRA] ${rol} seleccionó la Tienda ID: ${tienda_id}`);

        res.json({
            message: 'Conexión a sucursal establecida con éxito',
            token: tokenDefinitivo,
            user: {
                id,
                nombre,
                rol,
                email,
                tienda_id: parseInt(tienda_id),
                tienda_nombre: tiendaRes.rows[0].nombre
            }
        });

    } catch (error) {
        console.error("Error estableciendo tienda:", error);
        res.status(500).json({ error: 'Error al procesar la selección de sucursal.' });
    }
};

module.exports = { registro, login, renovarToken, establecerTiendaSesion };