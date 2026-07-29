require('dotenv').config(); // Cargar variables de entorno al principio

const express = require('express');
const http = require('http');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const pool = require('./src/config/db');
const { verifyToken } = require('./src/middleware/auth'); // Middleware de autenticación

// Validar variables de entorno críticas
if (!process.env.JWT_SECRET) {
  console.error("PELIGRO CRÍTICO: No se ha definido JWT_SECRET en el archivo .env");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Crear servidor HTTP e integrar Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Guardar 'io' globalmente para usarlo en los controladores/rutas
app.set('io', io);

// Manejo de conexiones con Socket.io
const usuariosConectados = {};

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;

  if (userId && userId !== 'undefined') {
    usuariosConectados[socket.id] = userId;
    console.log(`Usuario ${userId} conectado. Socket: ${socket.id}`);
    io.emit('usuarios-online', Object.values(usuariosConectados));
  }

  socket.on('disconnect', () => {
    const idDesconectado = usuariosConectados[socket.id];
    delete usuariosConectados[socket.id];
    console.log(`Usuario ${idDesconectado} desconectado.`);
    io.emit('usuarios-online', Object.values(usuariosConectados));
  });
});

// 1. Middlewares de Seguridad y Utilidad
app.use(helmet({ contentSecurityPolicy: false })); // Desactiva CSP estricto si cargas recursos externos desde el frontend
app.use(morgan('dev'));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Limitador global de peticiones (Opcional - Seguridad)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: "Demasiadas peticiones desde esta IP, intente de nuevo en 15 minutos." }
});
app.use('/api/', globalLimiter);

// 2. Archivos Estáticos
app.use(express.static(path.join(__dirname, 'src/public')));

// 3. Rutas de la API
app.use('/api/auth', require('./src/routes/auth.routes')); // Pública (Login/Register)

// Rutas protegidas con token JWT
app.use('/api/productos', verifyToken, require('./src/routes/productos.routes'));
app.use('/api/ventas', verifyToken, require('./src/routes/ventas.routes'));
app.use('/api/proveedores', verifyToken, require('./src/routes/proveedores.routes'));
app.use('/api/compras', verifyToken, require('./src/routes/compras.routes'));
app.use('/api/usuarios', verifyToken, require('./src/routes/usuarios.routes'));
app.use('/api/clientes', verifyToken, require('./src/routes/clientes.routes'));
app.use('/api/auditoria', verifyToken, require('./src/routes/auditoria.routes'));
app.use('/api/ajustes', verifyToken, require('./src/routes/ajustes.routes'));
app.use('/api/formulas', verifyToken, require('./src/routes/formulas.routes'));
app.use('/api/fabricacion', verifyToken, require('./src/routes/fabricacion.routes.js'));
app.use('/api/caja', verifyToken, require('./src/routes/caja.routes'));
app.use('/api/bcv', verifyToken, require('./src/routes/bcv.routes'));
app.use('/api/notificaciones', verifyToken, require('./src/routes/notificaciones.routes'));
app.use('/api/tiendas', verifyToken, require('./src/routes/tiendas.routes'));
app.use('/api/developer', require('./src/routes/developer.routes'));

// Test de conexión a la Base de Datos
app.get('/test-db', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW() as hora_servidor');
    res.json({ mensaje: "Conexión Exitosa", hora: resultado.rows[0].hora_servidor });
  } catch (error) {
    res.status(500).json({ error: "Error conectando a la BD" });
  }
});

// Manejo de rutas 404
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// 4. Iniciar Servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});