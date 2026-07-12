const pool = require('../config/db'); // Corregido: Subir un nivel para encontrar config
const bcrypt = require('bcryptjs');

const crearSuperUsuario = async () => {
    console.log("⏳ Limpiando base de datos y creando Super Admin...");

    try {
        const salt = await bcrypt.genSalt(10);
        const passwordReal = await bcrypt.hash('admin123', salt); // Contraseña segura

        // 1. Limpiar la tabla por completo (Quita lo anterior)
        await pool.query('TRUNCATE TABLE usuarios RESTART IDENTITY CASCADE');

        // 2. Insertar el Super Administrador con todos los permisos
        await pool.query(`
            INSERT INTO usuarios (nombre, email, password, rol, activo) 
            VALUES ($1, $2, $3, $4, $5)`, 
            ['Super Admin', 'admin@sistema.com', passwordReal, 'admin', true]
        );

        console.log("✅ ¡Sistema reseteado con éxito!");
        console.log("------------------------------------------------");
        console.log("🔑 TUS NUEVAS CREDENCIALES:");
        console.log("   Email:      admin@sistema.com");
        console.log("   Password:   admin123");
        console.log("   Rol:        admin (Acceso Total)");
        console.log("------------------------------------------------");

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await pool.end();
    }
};

crearSuperUsuario();