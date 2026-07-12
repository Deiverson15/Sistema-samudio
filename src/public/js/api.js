// Archivo: inventario/src/public/js/api.js

const API_URL = '/api/productos';
const VENTAS_URL = '/api/ventas';

// --- UTILIDADES ---

export const escapeHtml = (unsafe) => {
    if (unsafe === null || unsafe === undefined) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

export const formatMoney = (amount) => {
    return parseFloat(amount || 0).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 2
    });
};

const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
};

const request = async (url, options = {}) => {
    const token = localStorage.getItem('token');
    
    // Headers por defecto
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };

    const config = {
        ...options,
        headers: { ...headers, ...options.headers }
    };

    try {
        const res = await fetch(url, config);
        
        // ==========================================
        // 🔥 LÓGICA DE ERRORES CORREGIDA 
        // ==========================================

        // 1. ERROR 401 (Token vencido o inválido) -> SÍ TE SACA
        if (res.status === 401) {
            console.warn("Sesión expirada o token inválido.");
            localStorage.removeItem('token'); 
            localStorage.removeItem('usuario');
            window.location.href = '/login.html'; 
            return null; 
        }

        // 2. ERROR 403 (No tienes permisos) -> SOLO AVISA, NO TE SACA
        if (res.status === 403) {
            console.warn("Intento de acceso denegado por falta de permisos.");
            
            // Intentamos extraer el mensaje exacto que manda el backend, o usamos uno genérico
            let mensajeError = 'Tu rol actual no tiene privilegios para realizar esta acción.';
            try {
                const errorData = await res.json();
                if (errorData.error) mensajeError = errorData.error;
            } catch (e) {} // Si no hay JSON, ignoramos y usamos el genérico

            // Disparamos la alerta visual
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Acceso Restringido',
                    text: mensajeError,
                    confirmButtonColor: '#0f172a' // Color corporativo oscuro
                });
            } else {
                alert("Acceso Restringido: " + mensajeError);
            }

            // Cortamos la ejecución para que no siga procesando cosas en el frontend
            throw new Error(mensajeError);
        }

        // 3. Flujo Normal (Si todo sale bien)
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || `Error del servidor (${res.status})`);
        }

        return data;

    } catch (error) {
        console.error(`Error en petición a ${url}:`, error);
        throw error;
    }
};

// --- SERVICIOS ---


export const AuthService = {
    /**
     * Realiza el login y guarda el token inicial
     */
    login: async (credentials) => {
        const data = await request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials)
        });
        
        if (data && data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('usuario', JSON.stringify(data.user));
        }
        return data;
    },

    /**
     * Intenta renovar el token actual. 
     * Si el token ya expiró, la función 'request' te redirigirá automáticamente al login.
     */
    renovar: async () => {
        try {
            const data = await request('/api/auth/renovar', { method: 'POST' });
            
            if (data && data.token) {
                localStorage.setItem('token', data.token);
                console.log("🔄 Sesión renovada automáticamente.");
                return true;
            }
        } catch (error) {
            console.error("Error en renovación silenciosa:", error);
        }
        return false;
    },

    /**
     * Limpia los datos locales y sale del sistema
     */
    logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
        window.location.href = '/login.html';
    }
};


export const ProductoService = {
    // ACTUALIZADO: Acepta el parámetro bajoStock
    getAll: (page = 1, limit = 50, search = '', bajoStock = false) => 
        request(`${API_URL}?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&bajoStock=${bajoStock}`),
    
    getKardex: (id) => request(`${API_URL}/${id}/kardex`),
    
    create: (data) => request(API_URL, { method: 'POST', body: JSON.stringify(data) }),
    
    update: (id, data) => request(`${API_URL}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    
    delete: (id) => request(`${API_URL}/${id}`, { method: 'DELETE' }),
    
    reportarMerma: (id, data) => request(`${API_URL}/${id}/merma`, { method: 'POST', body: JSON.stringify(data) })
};

export const VentaService = {
    getKPIs: (rango = 'hoy') => request(`${VENTAS_URL}/dashboard-kpis?rango=${rango}`),
    
    getReportes: (rango = '7d') => request(`${VENTAS_URL}/reportes?rango=${rango}`)
};

export const ProveedorService = {
    getAll: () => request('/api/proveedores'),
    
    create: (data) => request('/api/proveedores', { method: 'POST', body: JSON.stringify(data) }),
    
    delete: (id) => request(`/api/proveedores/${id}`, { method: 'DELETE' })
};

export const CompraService = {
    // Paso 1: Registrar el lote de peso total (Factura de 100kg)
    registrar: (data) => request('/api/compras/registrar', { method: 'POST', body: JSON.stringify(data) }),
    
    // Paso 2: Distribuir (Lo que usaremos para Esencias/Alcohol)
    distribuir: (data) => request('/api/compras/distribuir', { method: 'POST', body: JSON.stringify(data) }),
    
    // Nuevo: Para productos que no vienen de lotes maestros (Frascos, Envases)
    comprarDirecto: (data) => request('/api/compras/directa', { method: 'POST', body: JSON.stringify(data) }),

    getAll: () => request('/api/compras')
};

export const FormulaService = {
    getAll: () => request('/api/formulas'),
    save: (data) => request('/api/formulas', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id) => request(`/api/formulas/${id}`, { method: 'DELETE' })
};

export const AjusteService = {
    create: (data) => request('/api/ajustes', { method: 'POST', body: JSON.stringify(data) })
};

export const BcvService = {
    getTasa: async () => {
        try {
            return await request('/api/bcv');
        } catch (e) {
            return { error: 'Error conexión BCV', tasa: 0 }; 
        }
    }
};

export const ClienteService = {
    buscar: (query) => request(`/api/clientes?q=${query}`),
    crear: (data) => request('/api/clientes', { method: 'POST', body: JSON.stringify(data) })
};

export const UsuarioService = {
    getAll: () => request('/api/usuarios'),
    create: (data) => request('/api/usuarios', { method: 'POST', body: JSON.stringify(data) }),
    toggleEstado: (id, estadoActual) => request(`/api/usuarios/${id}/estado`, { 
        method: 'PUT', body: JSON.stringify({ activo: !estadoActual }) 
    }),
    getActividad: (id) => request(`/api/usuarios/${id}/actividad`)
};

export const CajaService = {
    getEstado: () => request('/api/caja/estado'),
    abrir: (monto) => request('/api/caja/abrir', { method: 'POST', body: JSON.stringify({ monto_inicial: monto }) }),
    cerrar: (monto) => request('/api/caja/cerrar', { method: 'POST', body: JSON.stringify({ monto_final_declarado: monto }) })
};

window.addEventListener('unhandledrejection', event => {
    if (event.reason && event.reason.message && event.reason.message.includes('401')) {
        Swal.fire('Sesión Expirada', 'Por seguridad, inicia sesión nuevamente.', 'warning')
            .then(() => window.location.href = '/login.html');
    }
});