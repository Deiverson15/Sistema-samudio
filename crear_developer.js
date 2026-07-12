const pool = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function crearDeveloper() {
    try {
        const passwordPlana = 'devdios123'; // Cambia esto por una contraseña segura para ti
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(passwordPlana, salt);
        const emailDev = 'dev@developer.com'; // Tu correo

        const insertQuery = `
            INSERT INTO usuarios (nombre, email, password, rol, activo) 
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (email) DO UPDATE SET password = $3, rol = $4
            RETURNING id;
        `;
        await pool.query(insertQuery, ['Developer', emailDev, passwordEncriptada, 'developer', true]);
        console.log("✅ Usuario Developer (Nivel Dios) creado/actualizado exitosamente.");

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

crearDeveloper();