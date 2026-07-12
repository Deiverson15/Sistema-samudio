# Contexto del Proyecto: Sistema de Inventario (Perfumería)

## 1. Descripción General
Este es un sistema de gestión de inventario, ventas y facturación desarrollado en **Node.js** con **PostgreSQL**. El sistema maneja productos, proveedores, clientes, compras, ventas, reportes y usuarios con roles.

## 2. Stack Tecnológico
- **Backend:** Node.js, Express.js.
- **Base de Datos:** PostgreSQL (librería `pg`).
- **Frontend:** HTML5, CSS3, JavaScript Vanilla (Modular).
- **Seguridad:** JWT (JsonWebTokens), BcryptJS, Helmet (actualmente en modo dev).
- **Utilidades:** PDFKit (generación de facturas), ExcelJS (reportes), Dotenv.

## 3. Arquitectura del Proyecto
El proyecto sigue una arquitectura **MVC (Modelo-Vista-Controlador)** adaptada:

### Estructura de Directorios Clave
- **`/` (Raíz):** Contiene `index.js` (punto de entrada) y configuraciones.
- **`src/config/db.js`:** Configuración de la conexión a PostgreSQL (`pool`).
- **`src/controllers/`:** Lógica de negocio (ej. `ventas.controller.js`, `productos.controller.js`).
- **`src/routes/`:** Definición de endpoints de la API (ej. `ventas.routes.js`).
- **`src/middleware/`:** Middlewares como `auth.js` (verificación de token y roles).
- **`src/public/`:** Frontend servido estáticamente.
  - **`modules/`:** Carpetas por módulo (ej. `/modules/ventas/`) que contienen su propio `index.html` y `script.js`.
  - **`js/`:** Utilidades globales (`api.js`, `notificaciones.js`, `router.js`, `session.js`).

## 4. Convenciones de Código
### Backend
- **Base de Datos:** Usar siempre `pool.query()` con consultas parametrizadas ($1, $2) para evitar inyección SQL.
- **Manejo de Errores:** Usar bloques `try/catch` en los controladores y devolver respuestas JSON con códigos HTTP adecuados (200, 400, 500).
- **Rutas:** Las rutas se definen en `src/routes` y se importan en `index.js`.
- **Importaciones:** Usar `require` (CommonJS).

### Frontend
- **SPA/MPA Híbrido:** El frontend se carga por módulos.
- **Peticiones:** Usar las funciones centralizadas en `src/public/js/api.js` (si existen) o `fetch` estándar apuntando a `/api/...`.
- **Estilos:** CSS nativo o clases de utilidad (se observó Tailwind en configuraciones previas).

## 5. Estado Actual (Importante)
- **Modo Desarrollo:** Actualmente el archivo `index.js` tiene **desactivada** la verificación de tokens (`verifyToken`) y los límites de tráfico (`rateLimit`) para facilitar el desarrollo.
- **Configuración BD:** La conexión usa las variables de entorno: `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`.

## 6. Roles de Usuario
El sistema maneja los siguientes roles (definidos en `auth.js`):
1. **admin / superadmin**: Acceso total.
2. **gerente**: Acceso a gestión pero limitado en configuraciones críticas.
3. **vendedor**: Acceso limitado a ventas y clientes.

## 7. Instrucciones para la IA (Gemini)
- Al generar código nuevo para un controlador, verifica siempre si la tabla correspondiente en la BD tiene restricciones (Foreign Keys).
- Si se pide crear una nueva funcionalidad visual, genera tanto el HTML como el JS correspondiente dentro de una carpeta nueva en `src/public/modules/`.
- Mantén la consistencia: Si editas `index.js`, recuerda que hay dos bloques de código (uno comentado seguro y otro activo abierto); edita el que esté activo según el contexto o ambos si es un cambio estructural.