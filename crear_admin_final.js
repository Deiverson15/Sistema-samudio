const pool = require('./src/config/db'); //
const bcrypt = require('bcryptjs');

async function arreglarAdmin() {
    try {
        console.log("🛠️  Reparando acceso administrativo...");

        // 1. Generamos el hash correcto para 'admin123'
        const passwordPlana = 'admin123';
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(passwordPlana, salt); //

        // 2. Intentamos ACTUALIZAR primero (Esto evita el error de llave foránea)
        const updateQuery = `
            UPDATE usuarios 
            SET password = $1, activo = true, rol = 'admin', nombre = 'Administrador'
            WHERE email = 'admin@admin.com'
            RETURNING id;
        `;
        
        const updateRes = await pool.query(updateQuery, [passwordEncriptada]);

        if (updateRes.rowCount > 0) {
            console.log("✅ Usuario encontrado: Se actualizó la contraseña correctamente.");
        } else {
            // 3. Solo si NO existe, lo insertamos
            const insertQuery = `
                INSERT INTO usuarios (nombre, email, password, rol, activo) 
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id;
            `;
            await pool.query(insertQuery, ['Administrador', 'admin@admin.com', passwordEncriptada, 'admin', true]);
            console.log("✅ Usuario no existía: Se creó uno nuevo.");
        }

        console.log("\n---------------------------------------");
        console.log("📧 Email:    admin@admin.com");
        console.log("🔑 Password: admin123");
        console.log("---------------------------------------");
        console.log("🚀 Ya puedes iniciar sesión.");

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

arreglarAdmin();