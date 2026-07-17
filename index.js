// const express = require('express');
// const morgan = require('morgan');
// const cors = require('cors');
// // const helmet = require('helmet');
// // const rateLimit = require('express-rate-limit');
// const path = require('path');
// const pool = require('./src/config/db');
// // const { verifyToken } = require('./src/middleware/auth');

// require('dotenv').config();


// if (!process.env.JWT_SECRET) {
//     console.error("PELIGRO CRÍTICO: No se ha definido JWT_SECRET en el archivo .env");
//     process.exit(1);
// }

// const app = express();
// const PORT = process.env.PORT || 3000;

// // 2. MIDDLEWARES DE SEGURIDAD Y UTILIDAD

// app.use(
//   helmet({
//     contentSecurityPolicy: {
//       directives: {
//         "default-src": ["'self'"],
//         "script-src": [
//             "'self'", 
//             "'unsafe-inline'", 
//             "https://cdn.tailwindcss.com", 
//             "https://cdn.jsdelivr.net"
//         ],
//         "script-src-attr": ["'unsafe-inline'"],
//         "style-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
//         "img-src": ["'self'", "data:", "https:"],
//         "connect-src": ["'self'", "https://cdn.jsdelivr.net"], 
//         "font-src": ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
//         "media-src": ["'self'", "https://actions.google.com"],
//       },
//     },
//   })
// );

// app.use(morgan('dev')); // Log de peticiones en consola
// app.use(cors()); // Permite peticiones cruzadas
// app.use(express.json({ limit: '100kb' })); 
// app.use(express.urlencoded({ extended: true, limit: '100kb' }));


// // const loginLimiter = rateLimit({
// //     windowMs: 15 * 60 * 1000, 
// //     max: 5,
// //     message: { error: "Demasiados intentos fallidos. Intente de nuevo en 15 minutos." },
// //     standardHeaders: true,
// //     legacyHeaders: false,
// // });

// // const globalLimiter = rateLimit({
// //     windowMs: 15 * 60 * 1000,
// //     max: 300, 
// //     message: { error: "Has excedido el límite de peticiones. Calma." },
// //     standardHeaders: true,
// //     legacyHeaders: false,
// // });

// app.use('/api/', globalLimiter); 
// app.use('/api/auth', loginLimiter);

// app.use(express.static(path.join(__dirname, 'src/public')));


// app.use('/api/auth', loginLimiter, require('./src/routes/auth.routes'));



// app.use('/api/productos', verifyToken, require('./src/routes/productos.routes'));
// app.use('/api/ventas', verifyToken, require('./src/routes/ventas.routes'));
// app.use('/api/proveedores', verifyToken, require('./src/routes/proveedores.routes'));
// app.use('/api/compras', verifyToken, require('./src/routes/compras.routes'));
// app.use('/api/usuarios', verifyToken, require('./src/routes/usuarios.routes'));
// app.use('/api/clientes', verifyToken, require('./src/routes/clientes.routes'));
// app.use('/api/auditoria', verifyToken, require('./src/routes/auditoria.routes'));
// app.use('/api/ajustes', verifyToken, require('./src/routes/ajustes.routes'));
// app.use('/api/formulas', verifyToken, require('./src/routes/formulas.routes'));
// app.use('/api/caja', verifyToken, require('./src/routes/caja.routes'));
// app.use('/api/bcv', verifyToken, require('./src/routes/bcv.routes'));
// app.use('/api/notificaciones', require('./src/routes/notificaciones.routes'));


// // 7. RUTA DE PRUEBA DE BASE DE DATOS (Opcional, útil para desarrollo)
// app.get('/test-db', async (req, res) => {
//     try {
//         const resultado = await pool.query('SELECT NOW() as hora_servidor');
//         res.json({ mensaje: "Conexión Exitosa", hora: resultado.rows[0].hora_servidor });
//     } catch (error) {
//         res.status(500).json({ error: "Error conectando a la BD" });
//     }
// });

// // 8. MANEJO DE RUTAS NO ENCONTRADAS (404)
// app.use((req, res) => {
//     res.status(404).json({ error: "Ruta no encontrada" });
// });

// app.listen(PORT, () => {
//     console.log(` Servidor protegido corriendo en http://localhost:${PORT}`);
// });


const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
// const helmet = require('helm∆et'); // Desactivado para evitar bloqueos de cabeceras
// const rateLimit = require('express-rate-limit'); // Desactivado para eliminar límites de tráfico
const path = require('path');
const pool = require('./src/config/db');
const http = require('http'); // <-- NUEVO: Importar http para los Sockets
const { Server } = require('socket.io'); // <-- NUEVO: Importar Socket.io
// const { verifyToken } = require('./src/middleware/auth'); // Desactivado para permitir acceso sin token

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;


const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permite conexiones en tiempo real de cualquier origen
        methods: ["GET", "POST", "PUT"]
    }
});

// Guardamos 'io' globalmente para poder usarlo desde el archivo developer.routes.js
app.set('io', io);


const usuariosConectados = {};


io.on('connection', (socket) => {
    // El cliente debe enviar su ID de usuario al conectar (ej: query: { userId: 1 })
    const userId = socket.handshake.query.userId;

    if (userId && userId !== 'undefined') {
        usuariosConectados[socket.id] = userId;
        console.log(`Usuario ${userId} conectado. Socket: ${socket.id}`);
        
        // Notificar a todos los clientes la lista actualizada de IDs en línea
        io.emit('usuarios-online', Object.values(usuariosConectados));
    }

    socket.on('disconnect', () => {
        const idDesconectado = usuariosConectados[socket.id];
        delete usuariosConectados[socket.id];
        console.log(`Usuario ${idDesconectado} desconectado.`);
        
        // Actualizar la lista para todos
        io.emit('usuarios-online', Object.values(usuariosConectados));
    });
});


// ==========================================

// 1. MIDDLEWARES BÁSICOS
app.use(morgan('dev')); 
app.use(cors()); // Permite peticiones desde cualquier origen
app.use(express.json({ limit: '50mb' })); // Aumentado el límite de carga
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 2. ARCHIVOS ESTÁTICOS
app.use(express.static(path.join(__dirname, 'src/public')));

// 3. RUTAS SIN RESTRICCIONES (Se eliminó verifyToken y Limiters)
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/productos', require('./src/routes/productos.routes'));
app.use('/api/ventas', require('./src/routes/ventas.routes'));
app.use('/api/proveedores', require('./src/routes/proveedores.routes'));
app.use('/api/compras', require('./src/routes/compras.routes'));
app.use('/api/usuarios', require('./src/routes/usuarios.routes'));
app.use('/api/clientes', require('./src/routes/clientes.routes'));
app.use('/api/auditoria', require('./src/routes/auditoria.routes'));
app.use('/api/ajustes', require('./src/routes/ajustes.routes'));
app.use('/api/formulas', require('./src/routes/formulas.routes'));
app.use('/api/fabricacion', require('./src/routes/fabricacion.routes.js'));
app.use('/api/caja', require('./src/routes/caja.routes'));
app.use('/api/bcv', require('./src/routes/bcv.routes'));
app.use('/api/notificaciones', require('./src/routes/notificaciones.routes'));
app.use('/api/tiendas', require('./src/routes/tiendas.routes'));


app.use('/api/developer', require('./src/routes/developer.routes')); 


app.get('/test-db', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT NOW() as hora_servidor');
        res.json({ mensaje: "Conexión Abierta y Exitosa", hora: resultado.rows[0].hora_servidor });
    } catch (error) {
        res.status(500).json({ error: "Error conectando a la BD" });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// ==========================================
// INICIO DEL SERVIDOR (MODIFICADO)
// Cambio de app.listen por server.listen para que funcionen los Sockets
// ==========================================
server.listen(PORT, '0.0.0.0', () => { 
    console.log(` Servidor TOTALMENTE ABIERTO y con SOCKETS en http://localhost:${PORT}`);
});