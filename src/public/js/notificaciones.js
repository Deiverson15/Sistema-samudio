// Script Global de Notificaciones
const NOTIF_API = '/api/notificaciones';

document.addEventListener('DOMContentLoaded', () => {
    inicializarCampana();
    // Consultar cada 60 segundos (Bajo impacto)
    setInterval(checkNotificaciones, 60000); 
});

async function checkNotificaciones() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const res = await fetch(NOTIF_API, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const notificaciones = await res.json();
        actualizarBadge(notificaciones);
    } catch (e) { console.error("Error check notif:", e); }
}

function actualizarBadge(lista) {
    const badge = document.getElementById('notifBadge');
    const contenedor = document.getElementById('listaNotificaciones');

    if (!badge) return;
    
    // 1. Actualizar el puntito rojo
    if (lista.length > 0) {
        badge.innerText = lista.length;
        badge.classList.remove('hidden');
        badge.classList.add('animate-bounce'); // Pequeña animación para llamar la atención
    } else {
        badge.classList.add('hidden');
    }

    // 2. Renderizar la lista
    if (contenedor) {
        contenedor.innerHTML = '';
        if (lista.length === 0) {
            contenedor.innerHTML = '<div class="p-4 text-center text-gray-400 text-xs">Sin novedades importantes</div>';
            return;
        }

        contenedor.innerHTML = `
            <div class="px-4 py-2 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <span class="text-xs font-bold text-gray-600">Notificaciones</span>
                <button onclick="marcarTodas()" class="text-[10px] text-blue-500 hover:underline">Marcar leídas</button>
            </div>
        `;

        lista.forEach(n => {
            let icono = 'fa-info-circle text-blue-400';
            let bg = 'bg-white';
            
            if(n.tipo === 'PELIGRO') { icono = 'fa-triangle-exclamation text-red-500'; bg = 'bg-red-50'; }
            if(n.tipo === 'ALERTA') { icono = 'fa-bell text-orange-400'; }

            const fecha = new Date(n.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            contenedor.innerHTML += `
                <div onclick="leerNotificacion(${n.id}, '${n.ruta}')" 
                     class="p-3 border-b border-gray-100 hover:bg-gray-100 cursor-pointer transition ${bg} group">
                    <div class="flex gap-3">
                        <div class="mt-1"><i class="fa-solid ${icono}"></i></div>
                        <div>
                            <p class="text-xs text-gray-700 font-medium leading-tight">${n.mensaje}</p>
                            <p class="text-[10px] text-gray-400 mt-1">${fecha}</p>
                        </div>
                    </div>
                </div>
            `;
        });
    }
}

// Funciones globales para el HTML
window.leerNotificacion = async (id, ruta) => {
    const token = localStorage.getItem('token');
    await fetch(`${NOTIF_API}/${id}/leer`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
    
    if (ruta && ruta !== '#') {
        window.location.href = ruta; // Redirigir si tiene link
    } else {
        checkNotificaciones(); // Recargar lista
    }
};

window.marcarTodas = async () => {
    const token = localStorage.getItem('token');
    await fetch(`${NOTIF_API}/leer-todas`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
    checkNotificaciones();
};

window.toggleNotificaciones = () => {
    const menu = document.getElementById('menuNotificaciones');
    menu.classList.toggle('hidden');
    // Si abrimos, hacemos un check fresco
    if(!menu.classList.contains('hidden')) checkNotificaciones();
};

// Click fuera para cerrar
document.addEventListener('click', (e) => {
    const menu = document.getElementById('menuNotificaciones');
    const btn = document.getElementById('btnCampana');
    if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

// Inicializar
function inicializarCampana() {
    checkNotificaciones();
}