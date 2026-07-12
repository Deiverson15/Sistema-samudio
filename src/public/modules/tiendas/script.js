let tiendasGlobales = [];
let idTiendaEditando = null;

export async function init() {
    console.log("Módulo de Tiendas (SuperAdmin Hub) cargado.");
    await cargarTiendas();

    // Exportar funciones globales para que funcionen los onclick del HTML
    window.abrirModalTienda = abrirModalTienda;
    window.cerrarModalTienda = cerrarModalTienda;
    window.guardarTienda = guardarTienda;
    window.eliminarTienda = eliminarTienda;
    window.prepararEdicion = prepararEdicion;
    window.abrirTiendaURL = abrirTiendaURL;
}

// ==========================================
// 1. CARGAR Y DIBUJAR TIENDAS
// ==========================================
async function cargarTiendas() {
    try {
        const res = await fetch('/api/tiendas');
        if (!res.ok) throw new Error('Error al cargar la lista de tiendas');
        tiendasGlobales = await res.json();
        renderTiendas();
    } catch (error) {
        console.error("Error:", error);
        Swal.fire('Error', 'No se pudieron cargar las tiendas. Verifica tu conexión.', 'error');
    }
}

function renderTiendas() {
    // Asegúrate de que en tu HTML haya un <div id="gridTiendas" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div>
    const grid = document.getElementById('gridTiendas');
    if (!grid) return;

    grid.innerHTML = '';

    if (tiendasGlobales.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-10 font-bold">No hay tiendas registradas en el sistema.</div>`;
        return;
    }

    tiendasGlobales.forEach(tienda => {
        // Renderizado visual de la URL
        const urlDisplay = tienda.url 
            ? `<span class="text-blue-600 text-xs font-bold bg-blue-50 px-2 py-1 rounded"><i class="fa-solid fa-link"></i> ${tienda.url}</span>` 
            : `<span class="text-gray-400 text-xs"><i class="fa-solid fa-link-slash"></i> Sin sistema enlazado</span>`;

        // DIBUJAMOS LA TARJETA (Toda la tarjeta es clickeable)
        grid.innerHTML += `
            <div onclick="abrirTiendaURL('${tienda.url}')" class="bg-white p-5 rounded-2xl border-2 border-transparent shadow hover:shadow-xl hover:border-blue-500 transition-all cursor-pointer flex flex-col justify-between relative group transform hover:-translate-y-1">
                
                <div>
                    <div class="flex justify-between items-start mb-2">
                        <h3 class="font-black text-xl text-slate-800 uppercase tracking-wide">
                            <i class="fa-solid fa-store text-blue-500 mr-2"></i>${tienda.nombre}
                        </h3>
                    </div>
                    <p class="text-sm text-gray-500 mb-1"><i class="fa-solid fa-location-dot w-4 text-gray-400"></i> ${tienda.direccion || 'Sin dirección'}</p>
                    <p class="text-sm text-gray-500 mb-4"><i class="fa-solid fa-phone w-4 text-gray-400"></i> ${tienda.telefono || 'Sin teléfono'}</p>
                    ${urlDisplay}
                </div>

                <div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                    <button onclick="prepararEdicion(event, ${tienda.id})" class="bg-amber-100 text-amber-600 hover:bg-amber-500 hover:text-white p-2.5 rounded-lg shadow transition">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="eliminarTienda(event, ${tienda.id})" class="bg-red-100 text-red-600 hover:bg-red-500 hover:text-white p-2.5 rounded-lg shadow transition">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                
            </div>
        `;
    });
}

// ==========================================
// 2. LÓGICA DEL CLIC PARA IR A LA SUCURSAL
// ==========================================
function abrirTiendaURL(url) {
    if (url && url !== 'null' && url.trim() !== '') {
        let link = url.trim();
        // Le inyectamos http:// internamente para que la IP funcione en el navegador
        if (!link.startsWith('http://') && !link.startsWith('https://')) {
            link = 'http://' + link;
        }
        window.open(link, '_blank'); 
    } else {
        Swal.fire({
            title: 'Tienda sin IP/Sistema',
            text: 'No se ha configurado una dirección para esta sucursal.',
            icon: 'info',
            confirmButtonColor: '#3085d6'
        });
    }
}

// ==========================================
// 3. GESTIÓN DEL MODAL (CREAR / EDITAR)
// ==========================================
function abrirModalTienda() {
    const modal = document.getElementById('modalTienda');
    if(modal) modal.classList.remove('hidden');
}

function cerrarModalTienda() {
    const modal = document.getElementById('modalTienda');
    if(modal) modal.classList.add('hidden');
    
    // Limpiamos todo al cerrar
    const form = document.getElementById('formTienda');
    if(form) form.reset();
    idTiendaEditando = null;
    document.getElementById('modalTiendaTitulo').innerText = 'Registrar Nueva Tienda';
}

function prepararEdicion(event, id) {
    event.stopPropagation(); // 🛑 Evita que se ejecute abrirTiendaURL() al dar click en editar

    const tienda = tiendasGlobales.find(t => t.id === id);
    if (!tienda) return;

    idTiendaEditando = tienda.id;
    document.getElementById('modalTiendaTitulo').innerText = 'Editar Datos de Sucursal';
    
    // Rellenamos los inputs (Asegúrate que tu HTML tenga estos IDs exactos)
    document.getElementById('nombreTienda').value = tienda.nombre;
    document.getElementById('direccionTienda').value = tienda.direccion || '';
    document.getElementById('telefonoTienda').value = tienda.telefono || '';
    document.getElementById('urlTienda').value = tienda.url || ''; // NUEVO CAMPO

    abrirModalTienda();
}

// ==========================================
// 4. GUARDAR EN BASE DE DATOS
// ==========================================
async function guardarTienda(event) {
    event.preventDefault(); // Evita que la página se recargue

    const nombre = document.getElementById('nombreTienda').value;
    const direccion = document.getElementById('direccionTienda').value;
    const telefono = document.getElementById('telefonoTienda').value;
    const url = document.getElementById('urlTienda').value; // Capturamos la URL

    const data = { nombre, direccion, telefono, url };
    
    // Decidimos si es un INSERT (POST) o un UPDATE (PUT)
    const method = idTiendaEditando ? 'PUT' : 'POST';
    const endpoint = idTiendaEditando ? `/api/tiendas/${idTiendaEditando}` : '/api/tiendas';

    try {
        const res = await fetch(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) throw new Error('Error al guardar en el servidor');

        Swal.fire({
            title: '¡Excelente!',
            text: 'Los datos de la sucursal se guardaron correctamente.',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });
        
        cerrarModalTienda();
        cargarTiendas(); // Refrescamos la lista

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Hubo un problema de conexión al guardar la tienda.', 'error');
    }
}

// ==========================================
// 5. ELIMINAR TIENDA
// ==========================================
async function eliminarTienda(event, id) {
    event.stopPropagation(); // 🛑 Evita que se ejecute abrirTiendaURL() al dar click en eliminar

    const result = await Swal.fire({
        title: '¿Eliminar Sucursal?',
        text: "Esta acción borrará el enlace de tu panel principal.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            const res = await fetch(`/api/tiendas/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al borrar');
            
            Swal.fire('Eliminada', 'La sucursal ha sido removida de la lista.', 'success');
            cargarTiendas();
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudo eliminar la tienda', 'error');
        }
    }
}