const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    ssl:{
        rejectUnauthorized: false
    }
});

pool.on('connect', () => {
    console.log('Conectado a la Base de Datos PostgreSQL correctamente');
});

pool.on('error', (err) => {
    console.error('Error inesperado en el cliente de PG', err);
    process.exit(-1);
});

module.exports = pool;