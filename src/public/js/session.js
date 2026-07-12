/* Crea este archivo: inventario/src/public/js/session.js */
import { AuthService } from './api.js';

const CONFIG = {
    INACTIVIDAD_MAXIMA: 24 * 60 * 60 * 1000, 
    TIEMPO_RENOVACION: 50 * 60 * 1000,  
    CHECK_INTERVAL: 60 * 1000
};

let ultimaActividad = Date.now();
let tokenInicio = Date.now();

function actualizarActividad() {
    ultimaActividad = Date.now();
}

function logoutPorInactividad() {
    console.warn("💤 Cerrando sesión por inactividad...");
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html?motivo=inactividad';
}

async function gestionarSesion() {
    const ahora = Date.now();
    const tiempoInactivo = ahora - ultimaActividad;
    const antiguedadToken = ahora - tokenInicio;

    // 1. Verificar Inactividad
    if (tiempoInactivo > CONFIG.INACTIVIDAD_MAXIMA) {
        logoutPorInactividad();
        return;
    }

    // 2. Verificar Renovación (Solo si está activo)
    // Si el token tiene más de 50 mins y el usuario sigue moviéndose...
    if (antiguedadToken > CONFIG.TIEMPO_RENOVACION) {
        const exito = await AuthService.renovar();
        if (exito) {
            tokenInicio = Date.now(); // Reiniciamos contador del token
        } else {
            // Si falla la renovación (ej. servidor caído o token revocado), sacamos al usuario
            window.location.href = '/login.html'; 
        }
    }
}

export function initSessionManager() {
    if (!localStorage.getItem('token')) return;

    // --- NUEVO: Conexión al Socket ---
    const user = JSON.parse(localStorage.getItem('user'));
    if (user && user.id) {
        // Conectamos pasando el ID del usuario actual
        window.socket = io({
            query: { userId: user.id }
        });
        console.log("🔌 Socket conectado para el usuario:", user.id);
    }
    // ---------------------------------

    ['mousemove', 'keydown', 'click', 'scroll'].forEach(evento => {
        window.addEventListener(evento, actualizarActividad);
    });

    setInterval(gestionarSesion, CONFIG.CHECK_INTERVAL);
}

async function cargarAvisoGlobal() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const response = await fetch('/api/ajustes/mensaje-pago', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        const banner = document.getElementById('bannerMensajePago');
        const texto = document.getElementById('textoMensajePago');
        
        // Si hay una fecha guardada
        if (banner && texto && data.mensaje && data.mensaje.trim() !== '') {
            
            // 1. Calculamos la diferencia de días
            const fechaLimite = new Date(data.mensaje);
            fechaLimite.setHours(23, 59, 59, 999); // Que venza al final del día
            
            const hoy = new Date();
            const diferenciaMs = fechaLimite - hoy;
            const diasRestantes = Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24));

            // 2. Mostramos el mensaje correcto según los días
            banner.classList.remove('hidden');

            if (diasRestantes > 0) {
                texto.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> Aviso: Quedan <b>${diasRestantes} días</b> para realizar el pago del sistema.`;
                // Banner amarillo
                banner.className = "bg-yellow-500 text-neutral-950 text-center py-2 px-4 text-[10px] font-black uppercase tracking-widest"; 
            
            } else if (diasRestantes === 0) {
                texto.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> <b>¡EL PAGO DEL SISTEMA ES HOY!</b>`;
                // Banner rojo
                banner.className = "bg-red-600 text-white text-center py-2 px-4 text-[10px] font-black uppercase tracking-widest"; 
            
            } else {
                texto.innerHTML = `<i class="fa-solid fa-ban mr-2"></i> <b>SISTEMA VENCIDO HACE ${Math.abs(diasRestantes)} DÍAS.</b> Por favor, contacte al desarrollador.`;
                // Banner rojo oscuro
                banner.className = "bg-red-900 text-white text-center py-2 px-4 text-[10px] font-black uppercase tracking-widest";
            }
        }
    } catch (error) {
        console.error("Error cargando el aviso global:", error);
    }
}

// Ejecutar cuando cargue la pantalla
document.addEventListener('DOMContentLoaded', cargarAvisoGlobal);