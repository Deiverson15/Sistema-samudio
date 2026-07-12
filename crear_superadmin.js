const pool = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function crearSuperAdmin() {
    try {
        console.log("🛠️  Creando acceso de Súper Administrador...");

        // 1. Contraseña por defecto para el superadmin
        const passwordPlana = 'jimmy123';
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(passwordPlana, salt);
        const emailSuper = 'jimmyadmin@gmail.com';

        // 2. Intentamos ACTUALIZAR primero por si ya existe el correo
        const updateQuery = `
            UPDATE usuarios 
            SET password = $1, activo = true, rol = 'superadmin', nombre = 'Súper Administrador'
            WHERE email = $2
            RETURNING id;
        `;
        
        const updateRes = await pool.query(updateQuery, [passwordEncriptada, emailSuper]);

        if (updateRes.rowCount > 0) {
            console.log("✅ Usuario encontrado: Se actualizó la contraseña y el rol correctamente.");
        } else {
            // 3. Solo si NO existe, lo insertamos con el rol 'superadmin'
            const insertQuery = `
                INSERT INTO usuarios (nombre, email, password, rol, activo) 
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id;
            `;
            await pool.query(insertQuery, ['Súper Administrador', emailSuper, passwordEncriptada, 'superadmin', true]);
            console.log("✅ Se creó un nuevo usuario Súper Administrador.");
        }

        console.log("\n---------------------------------------");
        console.log("📧 Email:    super@admin.com");
        console.log("🔑 Password: super123");
        console.log("---------------------------------------");
        console.log("🚀 Ya puedes iniciar sesión con acceso total.");

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

crearSuperAdmin();