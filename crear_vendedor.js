const pool = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function crearVendedor() {
    try {
        console.log("🛠️  Creando acceso para el Vendedor...");

        // 1. Contraseña por defecto
        const passwordPlana = 'ventas123';
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(passwordPlana, salt);
        
        // Correo de ejemplo, puedes ajustarlo a tu dominio
        const emailVendedor = 'vendedor@perfumes.com'; 

        // 2. Intentamos ACTUALIZAR primero para evitar problemas de llaves
        const updateQuery = `
            UPDATE usuarios 
            SET password = $1, activo = true, rol = 'vendedor', nombre = 'Vendedor Mostrador'
            WHERE email = $2
            RETURNING id;
        `;
        
        const updateRes = await pool.query(updateQuery, [passwordEncriptada, emailVendedor]);

        if (updateRes.rowCount > 0) {
            console.log("✅ Usuario encontrado: Se actualizó la contraseña y el rol a 'vendedor' correctamente.");
        } else {
            // 3. Solo si NO existe, lo insertamos con el rol 'vendedor'
            const insertQuery = `
                INSERT INTO usuarios (nombre, email, password, rol, activo) 
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id;
            `;
            await pool.query(insertQuery, ['Vendedor Mostrador', emailVendedor, passwordEncriptada, 'vendedor', true]);
            console.log("✅ Se creó un nuevo usuario con rol de Vendedor.");
        }

        console.log("\n---------------------------------------");
        console.log(`📧 Email:    ${emailVendedor}`);
        console.log(`🔑 Password: ${passwordPlana}`);
        console.log("---------------------------------------");
        console.log("🚀 El vendedor ya puede acceder al sistema para registrar ventas y consultar el stock.");

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit(); // Cierra la conexión
    }
}

crearVendedor();