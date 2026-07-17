const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const getUsuarios = async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.direccion, 
            t.nombre as tienda_nombre,
            (u.token_sesion IS NOT NULL) as en_linea 
            FROM usuarios u
            LEFT JOIN tiendas t ON u.tienda_id = t.id
            ORDER BY u.id ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2. Crear Usuario
const crearUsuario = async (req, res) => {
    const { nombre, email, password, rol, direccion, tienda_id} = req.body;
    
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        const result = await pool.query(
            `INSERT INTO usuarios (nombre, email, password, rol, direccion, tienda_id, activo) 
             VALUES ($1, $2, $3, $4, $5, $6, true) 
             RETURNING id, nombre, email, rol`,
            [nombre, email, hash, rol, direccion, tienda_id] // <--- Enviamos el ID
        );

        // Intentamos registrar auditoría, pero usamos try-catch interno para que no falle todo si no existe la tabla
        try {
            await pool.query(
                "INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'CREAR_USUARIO', $2)", 
                [req.user.id, `Creó al usuario: ${email} (${rol})`]
            );
        } catch (auditError) {
            console.warn("No se pudo registrar auditoría (¿tabla existe?):", auditError.message);
        }

        res.json({ mensaje: 'Usuario creado exitosamente', usuario: result.rows[0] });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
        }
        res.status(500).json({ error: error.message });
    }
};

// 3. Cambiar Estado
const toggleEstadoUsuario = async (req, res) => {
    const { id } = req.params;
    const { activo } = req.body; // true o false

    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
    }

    try {
        // Si desactivamos (activo = false), borramos el token_sesion para expulsarlo inmediatamente (Punto 4)
        // Si activamos, lo dejamos null hasta que se loguee.
        const tokenUpdate = activo ? null : null; 
        
        // Si se está activando, no tocamos el token (mantiene null), si se desactiva, forzamos null.
        // Pero para simplificar y cumplir "Punto 4": al cambiar estado, limpiamos sesión por seguridad.
        await pool.query(
            'UPDATE usuarios SET activo = $1, token_sesion = NULL WHERE id = $2', 
            [activo, id]
        );
        
        res.json({ mensaje: `Usuario ${activo ? 'activado' : 'desactivado y desconectado'} correctamente` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 4. Historial (Definida correctamente)
const getHistorialUsuario = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT * FROM auditoria 
            WHERE usuario_id = $1 
            ORDER BY fecha DESC LIMIT 100
        `, [id]);
        res.json(result.rows);
    } catch (error) {
        // Si falla (ej. no existe tabla auditoria), devolvemos lista vacía para no romper el frontend
        console.error(error);
        res.json([]); 
    }
};

const resetearPassword = async (req, res) => {
    const { email, nuevaPassword } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(nuevaPassword, salt);
        const result = await pool.query(
            'UPDATE usuarios SET password = $1 WHERE email = $2 RETURNING id, email',
            [hash, email]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ mensaje: 'Contraseña actualizada correctamente.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const eliminarUsuario = async (req, res) => {
    const { id } = req.params;
    const force = req.query.force === 'true'; // <--- Bandera para forzar eliminación

    // No permitir que el usuario logueado se elimine a sí mismo
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta mientras estás conectado.' });
    }

    const client = await pool.connect(); // Usamos transacciones seguras
    
    try {
        await client.query('BEGIN');

        // 1. Obtener nombre del usuario antes de borrarlo (para guardar el log)
        const userRes = await client.query('SELECT nombre FROM usuarios WHERE id = $1', [id]);
        if (userRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        const nombreUsuario = userRes.rows[0].nombre;

        // 2. Verificar si tiene historial (Auditoría u otras cosas)
        const checkAuditoria = await client.query('SELECT 1 FROM auditoria WHERE usuario_id = $1 LIMIT 1', [id]);
        
        // Si tiene historial Y NO hemos confirmado el forzado, devolvemos un aviso especial
        if (checkAuditoria.rowCount > 0 && !force) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'tiene_historial',
                mensaje: 'El usuario tiene historial.' 
            });
        }

        // 3. Si el usuario aceptó forzar la eliminación, desvinculamos su historial para no romper la BD
        if (force) {
            await client.query('UPDATE auditoria SET usuario_id = NULL WHERE usuario_id = $1', [id]);
            // (Opcional) Si en el futuro agregas clave foránea a ventas, descomenta esto:
            // await client.query('UPDATE ventas SET usuario_id = NULL WHERE usuario_id = $1', [id]);
        }

        // 4. Ahora sí, eliminar el usuario de raíz
        await client.query('DELETE FROM usuarios WHERE id = $1', [id]);

        // 5. Registrar el evento en el historial del admin
        await client.query(
            "INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'ELIMINAR_USUARIO', $2)",
            [req.user.id, `Eliminó permanentemente al usuario: ${nombreUsuario} (ID: ${id})`]
        );

        await client.query('COMMIT');
        res.json({ mensaje: 'Usuario destruido permanentemente de la base de datos.' });

    } catch (error) {
        await client.query('ROLLBACK');
        
        // Si sale error de bloqueo de PostgreSQL (23503) por otra tabla olvidada
        if (error.code === '23503') {
            return res.status(400).json({ 
                error: 'tiene_historial',
                mensaje: 'Tiene registros asociados.' 
            });
        }
        console.error("Error al eliminar:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

const actualizarUsuario = async (req, res) => {
    const { id } = req.params;
    const { nombre, email, rol, direccion, tienda_id, password } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 🛡️ ESCUDO DE TITANIO: Verificamos si la cuenta a editar es la del Developer
        const userQuery = await client.query('SELECT rol FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
        if (userQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        let rolFinal = rol;
        const rolActual = userQuery.rows[0].rol.toLowerCase();
        
        // Si es el developer, IGNORAMOS lo que mande el frontend y protegemos su trono
        if (rolActual === 'developer' || rolActual === 'dev') {
            rolFinal = userQuery.rows[0].rol; 
        }

        // 📝 Actualizamos los datos básicos del usuario
        await client.query(
            `UPDATE usuarios 
             SET nombre = $1, email = $2, rol = $3, direccion = $4, tienda_id = $5 
             WHERE id = $6`,
            [nombre, email, rolFinal, direccion, tienda_id || null, id]
        );

        // 🔑 ACTUALIZACIÓN OPCIONAL DE CONTRASEÑA (RESET EN CALIENTE)
        if (password && password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(password, salt);
            await client.query('UPDATE usuarios SET password = $1, token_sesion = NULL WHERE id = $2', [hash, id]);
            console.log(`[USER SECURITY] Contraseña restablecida y sesión purgada para el ID: ${id}`);
        }

        // Registro de auditoría
        await client.query(
            "INSERT INTO auditoria (usuario_id, accion, detalle, fecha) VALUES ($1, 'EDITAR_USUARIO', $2, NOW())", 
            [req.user.id, `Editó los datos y credenciales del usuario: ${email}`]
        );

        await client.query('COMMIT');
        res.json({ mensaje: 'Usuario actualizado correctamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
            return res.status(400).json({ error: 'El correo electrónico ya está en uso por otro usuario.' });
        }
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

module.exports = { getUsuarios, crearUsuario, toggleEstadoUsuario, getHistorialUsuario, resetearPassword, eliminarUsuario, actualizarUsuario };