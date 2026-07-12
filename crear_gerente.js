const pool = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function crearGerente() {
    try {
        console.log("🛠️  Creando acceso para el Gerente...");

        // 1. Contraseña por defecto
        const passwordPlana = 'gerente123';
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(passwordPlana, salt);
        const emailGerente = 'gerente@empresa.com'; // Cámbialo por el correo real si lo tienes

        // 2. Intentamos ACTUALIZAR primero
        const updateQuery = `
            UPDATE usuarios 
            SET password = $1, activo = true, rol = 'gerente', nombre = 'Gerente General'
            WHERE email = $2
            RETURNING id;
        `;
        
        const updateRes = await pool.query(updateQuery, [passwordEncriptada, emailGerente]);

        if (updateRes.rowCount > 0) {
            console.log("✅ Usuario encontrado: Se actualizó la contraseña y el rol a 'gerente' correctamente.");
        } else {
            // 3. Solo si NO existe, lo insertamos con el rol 'gerente'
            const insertQuery = `
                INSERT INTO usuarios (nombre, email, password, rol, activo) 
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id;
            `;
            await pool.query(insertQuery, ['Gerente General', emailGerente, passwordEncriptada, 'gerente', true]);
            console.log("✅ Se creó un nuevo usuario con rol de Gerente.");
        }

        console.log("\n---------------------------------------");
        console.log(`📧 Email:    ${emailGerente}`);
        console.log(`🔑 Password: ${passwordPlana}`);
        console.log("---------------------------------------");
        console.log("🚀 El gerente ya puede iniciar sesión.");

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit(); // Cierra la conexión
    }
}

crearGerente();