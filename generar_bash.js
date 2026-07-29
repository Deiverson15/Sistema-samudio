const bcrypt = require('bcryptjs');

// ✏️ Coloca aquí la clave que quieras encriptar:
const claveEnTextoPlano = 'samudio244';

const generarHash = async () => {
    try {
        const salt = await bcrypt.genSalt(10);
        const hashResultante = await bcrypt.hash(claveEnTextoPlano, salt);

        console.log('\n==================================================');
        console.log(`🔑 Clave ingresada:  ${claveEnTextoPlano}`);
        console.log(`🛡️  Hash para tu DB: ${hashResultante}`);
        console.log('==================================================\n');
    } catch (error) {
        console.error('Error generando el hash:', error);
    }
};

generarHash();