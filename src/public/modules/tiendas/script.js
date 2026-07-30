let tiendasGlobales = [];
let idTiendaEditando = null;

export async function init() {
    console.log("Módulo de Tiendas (SuperAdmin Red Hub) cargado.");
    await cargarTiendas();

    // Exportación explícita al ecosistema de window
    window.abrirModalTienda = abrirModalTienda;
    window.cerrarModalTienda = cerrarModalTienda;
    window.guardarTienda = guardarTienda;
    window.eliminarTienda = eliminarTienda;
    window.prepararEdicion = prepararEdicion;
    window.abrirTiendaURL = abrirTiendaURL;
}

// Helper interno para obtener headers con Token
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// ==========================================
// 1. EXTRAER Y RENDERIZAR SUCURSALES
// ==========================================
async function cargarTiendas() {
    try {
        // 🔥 CORREGIDO: Se inyecta la cabecera de autorización Bearer Token
        const res = await fetch('/api/tiendas', {
            headers: getAuthHeaders()
        });
        
        if (!res.ok) throw new Error(`Error ${res.status}: No autorizado o consulta fallida.`);
        
        tiendasGlobales = await res.json();
        renderTiendas();
    } catch (error) {
        console.error("Error al cargar tiendas:", error);
        Swal.fire({ 
            icon: 'error', 
            title: 'ACCESO O CONEXIÓN RECHAZADA', 
            text: error.message || 'No se pudo mapear la red de tiendas.', 
            confirmButtonColor: '#0a0a0a', 
            customClass: { popup: 'rounded-none' } 
        });
    }
}

function renderTiendas() {
    const grid = document.getElementById('gridTiendas');
    if (!grid) return;

    grid.innerHTML = '';

    if (tiendasGlobales.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center text-neutral-400 py-16 font-bold text-xs uppercase tracking-widest bg-white border border-neutral-300">No hay tiendas afiliadas en la red central.</div>`;
        return;
    }

    tiendasGlobales.forEach(tienda => {
        const urlDisplay = tienda.url 
            ? `<span class="text-neutral-950 text-[10px] font-black bg-neutral-100 border border-neutral-300 px-2 py-1 rounded-none"><i class="fa-solid fa-link mr-1"></i> NODE: ${tienda.url}</span>` 
            : `<span class="text-neutral-400 text-[10px] font-bold uppercase tracking-widest"><i class="fa-solid fa-link-slash mr-1"></i> Sin enlace perimetral</span>`;

        grid.innerHTML += `
            <div onclick="abrirTiendaURL('${tienda.url}')" class="bg-white p-6 rounded-none border border-neutral-300 relative group transition-all duration-200 cursor-pointer flex flex-col justify-between hover:border-neutral-950 selection:bg-neutral-800">
                <div>
                    <div class="flex justify-between items-start mb-4 border-b border-neutral-200 pb-3">
                        <h3 class="font-black text-sm text-neutral-950 uppercase tracking-wider truncate w-40">
                            <i class="fa-solid fa-store mr-2 text-neutral-400"></i> ${tienda.nombre}
                        </h3>
                        <span class="bg-neutral-950 text-white font-mono font-black text-[10px] px-2.5 py-1 uppercase tracking-widest shadow-sm">
                            SERIE: ${tienda.codigo_serie || 'S/S'}
                        </span>
                    </div>
                    <p class="text-[11px] font-bold text-neutral-500 uppercase tracking-wide mb-1.5"><i class="fa-solid fa-location-dot w-4 text-neutral-400"></i> ${tienda.direccion || 'Sin dirección'}</p>
                    <p class="text-[11px] font-bold text-neutral-500 uppercase tracking-wide mb-5"><i class="fa-solid fa-phone w-4 text-neutral-400"></i> ${tienda.telefono || 'Sin teléfono'}</p>
                    <div class="mt-2">${urlDisplay}</div>
                </div>

                <div class="absolute bottom-5 right-6 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 font-sans">
                    <button onclick="prepararEdicion(event, ${tienda.id})" class="bg-neutral-100 text-neutral-800 hover:bg-neutral-950 hover:text-white p-2 text-xs transition border border-neutral-300" title="Editar">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="eliminarTienda(event, ${tienda.id})" class="bg-neutral-100 text-red-600 hover:bg-red-700 hover:text-white p-2 text-xs transition border border-neutral-300" title="Remover">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    });
}

function abrirTiendaURL(url) {
    if (url && url !== 'null' && url.trim() !== '') {
        let link = url.trim();
        if (!link.startsWith('http://') && !link.startsWith('https://')) {
            link = 'http://' + link;
        }
        window.open(link, '_blank'); 
    } else {
        Swal.fire({ title: 'NODO AISLADO', text: 'Esta sucursal no posee un enlace de sistema de red activo.', icon: 'info', confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
    }
}

function abrirModalTienda() {
    const modal = document.getElementById('modalTienda');
    if(modal) modal.classList.remove('hidden');
}

function cerrarModalTienda() {
    const modal = document.getElementById('modalTienda');
    if(modal) modal.classList.add('hidden');
    
    const form = document.getElementById('formTienda');
    if(form) form.reset();
    idTiendaEditando = null;
    document.getElementById('modalTiendaTitulo').innerText = 'Altas de Sucursal';
}

function prepararEdicion(event, id) {
    event.stopPropagation();

    const tienda = tiendasGlobales.find(t => t.id === id);
    if (!tienda) return;

    idTiendaEditando = tienda.id;
    document.getElementById('modalTiendaTitulo').innerText = 'Modificación de Sucursal';
    
    document.getElementById('nombreTienda').value = tienda.nombre;
    document.getElementById('serieTienda').value = tienda.codigo_serie || '';
    document.getElementById('direccionTienda').value = tienda.direccion || '';
    document.getElementById('telefonoTienda').value = tienda.telefono || '';
    document.getElementById('urlTienda').value = tienda.url || '';

    abrirModalTienda();
}

// ==========================================
// 3. ENVIAR CAMBIOS A POSTGRESQL
// ==========================================
async function guardarTienda(event) {
    event.preventDefault();

    const nombre = document.getElementById('nombreTienda').value;
    const codigo_serie = document.getElementById('serieTienda').value;
    const direccion = document.getElementById('direccionTienda').value;
    const telefono = document.getElementById('telefonoTienda').value;
    const url = document.getElementById('urlTienda').value;

    const data = { nombre, codigo_serie, direccion, telefono, url };
    
    const method = idTiendaEditando ? 'PUT' : 'POST';
    const endpoint = idTiendaEditando ? `/api/tiendas/${idTiendaEditando}` : '/api/tiendas';

    try {
        Swal.fire({ title: 'Sincronizando con el servidor central...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        
        // 🔥 CORREGIDO: Se envían los headers autenticados
        const res = await fetch(endpoint, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || 'Error de pasarela.');

        Swal.fire({ icon: 'success', title: 'REGISTRO GUARDADO', text: 'Los datos de la sede fueron consolidados correctamente.', timer: 1500, showConfirmButton: false, confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
        
        cerrarModalTienda();
        await cargarTiendas();

    } catch (error) {
        console.error(error);
        Swal.fire({ icon: 'error', title: 'OPERACIÓN RECHAZADA', text: error.message, confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
    }
}

async function eliminarTienda(event, id) {
    event.stopPropagation(); 

    const result = await Swal.fire({
        title: '¿REMOVER SUCURSAL?',
        text: "Esta acción purgará el enlace operativo de la red central corporativa.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#0a0a0a',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'ELIMINAR ENLACE',
        cancelButtonText: 'CANCELAR',
        customClass: { popup: 'rounded-none', confirmButton: 'rounded-none text-[10px]', cancelButton: 'rounded-none text-[10px]' }
    });

    if (result.isConfirmed) {
        try {
            // 🔥 CORREGIDO: Se inyecta la autorización al borrar
            const res = await fetch(`/api/tiendas/${id}`, { 
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            
            if (!res.ok) throw new Error();
            
            Swal.fire({ icon: 'success', title: 'NODO REMOVIDO', text: 'La sucursal ha sido purgada del mapa de red.', confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
            await cargarTiendas();
        } catch (error) {
            Swal.fire('Error', 'No se pudo eliminar la sucursal de las tablas.', 'error');
        }
    }
}