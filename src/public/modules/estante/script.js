import { ProductoService, FormulaService } from '../../js/api.js';


let formulasMuestras = []
let intervaloRefresco = null;
let todasLasBotellas = []; // Contenedor para la lista completa de botellas
let listenersActivados = false; // Flag para evitar duplicar listeners



export async function init() {
    console.log("Cargando Estante Inteligente...");

    try {
        const todasFormulas = await FormulaService.getAll() || [];
        formulasMuestras = todasFormulas.filter(f => parseInt(f.volumen_total) <= 15);
    } catch (e) { console.error("Error cargando fórmulas", e); }
    
    // --- EXPOSICIÓN GLOBAL ---
    window.init = init; 
    window.repararInventario = repararInventario;
    window.moverBotella = moverBotella;
    window.solicitarRecambio = solicitarRecambio;
    window.prepararTesterUI = prepararTesterUI;
    window.crearMuestraUI = crearMuestraUI;
    window.abrirModalGestion = abrirModalGestion;
    window.cerrarModalGestion = cerrarModalGestion;
    window.setTipoGestion = setTipoGestion;
    window.procesarGestion = procesarGestion;
    window.toggleSeleccionarTodoPendientes = toggleSeleccionarTodoPendientes;
    window.ubicarSeleccionadosMasa = ubicarSeleccionadosMasa;
    

    await cargarEstante(1);

    // CORRECCIÓN IMPORTANTE:
    // Ejecutamos siempre los listeners porque al cambiar de pestaña el HTML se reconstruye
    setupEventListeners(); 

    // --- AUTO-REFRESCO (Corrección de Seguridad) ---
    if (intervaloRefresco) clearInterval(intervaloRefresco);
    
    intervaloRefresco = setInterval(() => {
    const modal = document.getElementById('modalGestionEstante');
    
    if (!modal) {
        clearInterval(intervaloRefresco);
        return;
    }

    if (document.body.classList.contains('swal2-shown') || !modal.classList.contains('hidden')) {
        return;
    }
    
    cargarEstante(true); // <--- CAMBIA 'cargarEstantes' POR 'cargarEstante' AQUÍ TAMBIÉN
}, 5000);
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilters = document.getElementById('categoryFilters');

    if (searchInput) {
        // Usamos oninput directo para asegurar que reemplace cualquier anterior
        searchInput.oninput = aplicarFiltrosYRenderizar;
    }

    if (categoryFilters) {
        categoryFilters.onclick = (e) => {
            if (e.target.classList.contains('filter-btn')) {
                // 1. Quitar clase activa al botón anterior
                const anterior = categoryFilters.querySelector('.active');
                if(anterior) {
                    anterior.classList.remove('active', 'bg-slate-800', 'text-white');
                }

                // 2. Activar el nuevo botón
                e.target.classList.add('active', 'bg-slate-800', 'text-white');
                
                // 3. Ejecutar filtro
                aplicarFiltrosYRenderizar();
            }
        };
    }
}

function aplicarFiltrosYRenderizar() {
    const inputSearch = document.getElementById('searchInput');
    const searchTerm = inputSearch ? inputSearch.value.trim() : '';
    
    // Al filtrar, siempre volvemos a la página 1
    paginaActual = 1;
    
    // Llamamos a cargarEstante enviando el término de búsqueda
    cargarEstante(paginaActual, searchTerm);
}

function getHTMLBotella(porcentaje, categoria) {
    const cat = (categoria || '').toUpperCase();

    // 1. Testers: Muestra elegante con una estrellita de lujo
    if (cat === 'TESTER') {
        return `<div class="relative">
                    <i class="fa-solid fa-vial text-4xl text-amber-500 drop-shadow-md"></i>
                    <i class="fa-solid fa-star absolute -top-1 -right-2 text-[10px] text-amber-300"></i>
                </div>`;
    }
    
    // 2. Frascos y Envases vacíos: Spray en color gris / cristal apagado
    if (['FRASCO', 'ENVASES', 'FRASCOS'].includes(cat)) {
        return `<i class="fa-solid fa-spray-can text-4xl text-slate-300 drop-shadow-sm"></i>`;
    }
    
    // 3. Alcohol y Fijadores: Materiales base (Gota pura y Matraz)
    if (cat === 'ALCOHOL') {
         return `<i class="fa-solid fa-tint text-4xl text-cyan-200 drop-shadow-sm"></i>`;
    }
    if (cat === 'FIJADOR') {
         return `<i class="fa-solid fa-flask text-4xl text-indigo-300 drop-shadow-sm"></i>`;
    }

    // 4. Esencias y Perfumes: Envase tipo SPRAY con colores de alta perfumería
    const p = Math.max(0, Math.min(100, Math.floor(porcentaje))); 
    
    // Paleta de colores: Rubí, Ámbar y Oro
    let colorLiquido = '#9f1239'; // Rubí intenso (Crítico < 15%)
    if (p > 60) colorLiquido = '#d97706'; // Ámbar Oscuro / Oro Viejo (Alto)
    else if (p > 30) colorLiquido = '#f59e0b'; // Oro Claro (Medio)
    else if (p > 15) colorLiquido = '#fbbf24'; // Dorado Suave (Bajo)

    // Gradiente que simula el nivel del perfume dentro del envase
    const estiloGradiente = `
        background: linear-gradient(to top, ${colorLiquido} ${p}%, #f1f5f9 ${p}%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: inline-block;
        filter: drop-shadow(0 4px 6px rgba(0,0,0,0.08));
    `;

    // ¡AQUÍ ESTÁ EL CAMBIO! Usamos fa-spray-can (Atomizador)
    return `<i class="fa-solid fa-spray-can text-5xl" style="${estiloGradiente}"></i>`;
}

async function repararInventario() {
    const confirm = await Swal.fire({
        title: '¿Sincronizar Inventario?',
        html: `
            <p class="text-sm text-gray-600 mb-2">Esto realizará las siguientes acciones:</p>
            <ul class="text-left text-xs list-disc pl-5 text-gray-500">
                <li>Recalculará el stock global basado en las botellas visibles.</li>
                <li>Corregirá números negativos o inconsistencias.</li>
                <li>Actualizará la base de datos.</li>
            </ul>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, Sincronizar',
        confirmButtonColor: '#4f46e5' // Indigo
    });

    if (confirm.isConfirmed) {
        try {
            Swal.fire({ title: 'Procesando...', didOpen: () => Swal.showLoading() });
            
            const token = localStorage.getItem('token');
            const res = await fetch('/api/productos/sincronizar-todo', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                await Swal.fire('¡Sincronizado!', 'La base de datos se ha actualizado correctamente.', 'success');
                init(); // Recargar la pantalla
            } else {
                Swal.fire('Error', 'No se pudo sincronizar.', 'error');
            }
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
}



function renderizarPendientes(contenedor, botellas) {
    if (document.getElementById('badgePendientes')) {
        document.getElementById('badgePendientes').innerText = botellas.length;
    }
    
    // Muestra u oculta el panel de selección en lote según si hay registros
    const panelMasa = document.getElementById('panelMasaPendientes');
    if (panelMasa) {
        if (botellas.length > 0) panelMasa.classList.remove('hidden');
        else panelMasa.classList.add('hidden');
    }
    
    contenedor.innerHTML = '';
    
    if(botellas.length === 0) {
        contenedor.innerHTML = `<div class="text-center text-xs text-gray-400 mt-10 p-4 border border-dashed rounded">Zona de recepción vacía</div>`;
        return;
    }

    const usuarioLogueado = JSON.parse(localStorage.getItem('usuario')) || {};
    const esAdminOGerente = ['admin', 'gerente', 'administrador'].includes((usuarioLogueado.rol || '').toLowerCase());

    botellas.forEach(botella => {
        const idBotella = botella.botella_id || botella.id;

        // Cajita Checkbox amarrada al ID de la botella
        const checkboxHTML = esAdminOGerente ? `
            <input type="checkbox" data-id="${idBotella}" data-cant="${botella.cantidad}" class="check-item-pendiente accent-neutral-950 w-4 h-4 cursor-pointer mt-1">
        ` : '';

        const botonesAccion = esAdminOGerente ? `
            <div class="flex gap-1 mt-3">
                <button onclick="moverBotella(${idBotella}, 'A', ${botella.cantidad})" class="flex-1 bg-blue-50 text-blue-700 text-[10px] py-1.5 rounded hover:bg-blue-100 border border-blue-200 transition font-bold">
                    <i class="fa-solid fa-arrow-right"></i> A Estante A
                </button>
                <button onclick="moverBotella(${idBotella}, 'B', ${botella.cantidad})" class="flex-1 bg-purple-50 text-purple-700 text-[10px] py-1.5 rounded hover:bg-purple-100 border border-purple-200 transition font-bold">
                    <i class="fa-solid fa-arrow-right"></i> A Estante B
                </button>
            </div>
        ` : `
            <div class="mt-3 py-1.5 text-center text-[9px] text-gray-400 italic border border-dashed border-gray-100 rounded">
                LLAMAR A SU SUPERIOR! requerido para ubicar
            </div>
        `;

        contenedor.innerHTML += `
            <div class="bg-white p-3 rounded shadow-sm border-l-4 border-orange-500 group mb-2 animate-fade-in flex gap-3 items-start relative">
                <div class="pt-1">${checkboxHTML}</div>
                <div class="flex-1">
                    <div class="absolute top-2 right-2 flex flex-col items-end">
                        <span class="bg-orange-100 text-orange-800 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-200 mb-1">
                            <i class="fa-solid fa-box"></i> CERRADA
                        </span>
                        <span class="text-xs font-bold text-gray-600">x${parseFloat(botella.cantidad).toFixed(2)}</span>
                    </div>
                    <p class="font-bold text-gray-700 text-sm pr-20 uppercase leading-tight">${botella.nombre}</p>
                    <p class="text-[10px] text-gray-400 mb-2 uppercase">${botella.marca || 'SIN MARCA'}</p>
                    ${botonesAccion}
                </div>
            </div>
        `;
    });
}

function toggleSeleccionarTodoPendientes(checked) {
    const checkboxes = document.querySelectorAll('.check-item-pendiente');
    checkboxes.forEach(cb => cb.checked = checked);
}

let pisosVisibles = 7; 

function renderizarFilas(contenedor, botellas, nombreEstante) {
    contenedor.innerHTML = '';
    const usuarioLogueado = JSON.parse(localStorage.getItem('usuario')) || {};
    const rol = (usuarioLogueado.rol || '').toLowerCase(); 
    const esAdminOGerente = ['admin', 'gerente', 'administrador'].includes(rol);

    // --- ZONA DE RECEPCIÓN ---
    const sinOrganizar = botellas.filter(b => b.fila == 0 || b.fila === 'SIN_ORGANIZAR');
    if (sinOrganizar.length > 0) {
        const zonaRecepcion = document.createElement('div');
        zonaRecepcion.className = "mb-8 p-5 bg-amber-50 border-2 border-dashed border-amber-200 rounded-2xl shadow-sm";
        zonaRecepcion.innerHTML = `<div class="flex items-center gap-2 mb-4"><span class="bg-amber-500 text-white text-[10px] font-black px-2 py-1 rounded shadow-sm">POR UBICAR EN PISO</span></div><div class="flex gap-4 overflow-x-auto pb-2 scrollbar-thin" id="gridRecepcion_${nombreEstante}"></div>`;
        contenedor.appendChild(zonaRecepcion);
        const grid = zonaRecepcion.querySelector(`#gridRecepcion_${nombreEstante}`);
        sinOrganizar.forEach(b => {
             const btnUbicar = esAdminOGerente ? `<button onclick="moverBotella(${b.botella_id || b.id}, '${nombreEstante}', ${b.cantidad})" class="mt-3 w-full bg-slate-900 text-white text-[9px] font-bold py-1.5 rounded-lg hover:bg-slate-700 transition">UBICAR</button>` : '';
             grid.innerHTML += `<div class="min-w-[100px] w-28 bg-white border border-amber-100 rounded-xl p-3 flex flex-col items-center shadow-sm relative"><i class="fa-solid fa-box text-3xl text-amber-400 mb-2"></i><p class="text-[9px] font-black text-slate-700 text-center leading-tight line-clamp-2 uppercase h-6">${b.nombre}</p>${btnUbicar}</div>`;
        });
    }

    // --- RENDERIZADO OPTIMIZADO POR PISOS ---
    const inventarioPorPiso = {};
    botellas.forEach(b => {
        if(!inventarioPorPiso[b.fila]) inventarioPorPiso[b.fila] = [];
        inventarioPorPiso[b.fila].push(b);
    });

    // Usamos un bucle estándar pero controlado
    for (let numPiso = 1; numPiso <= 7; numPiso++) {        
        const botellasDelPiso = inventarioPorPiso[numPiso] || [];
        
        // Si el piso está vacío, lo saltamos visualmente pero mantenemos la estructura
        if (botellasDelPiso.length === 0) continue; 

        const pisoDiv = document.createElement('div');
        pisoDiv.className = "mb-8 border-b border-slate-100 pb-6 last:border-0 animate-fade-in"; 
        
        const esPisoTester = numPiso === 7;
        const tituloPiso = esPisoTester ? 'PISO DE TESTERS' : `Nivel ${numPiso}`;
        const colorPiso = esPisoTester ? 'bg-purple-600' : 'bg-slate-900';
        
        pisoDiv.innerHTML = `<div class="flex items-center gap-3 mb-5"><div class="${colorPiso} text-white w-8 h-8 flex items-center justify-center rounded-lg font-black text-sm shadow-lg">${numPiso}</div><span class="text-[10px] text-slate-400 font-black tracking-[0.2em] uppercase italic">${tituloPiso}</span></div>`;
        
        const pasilloDiv = document.createElement('div');
        pasilloDiv.className = "flex flex-wrap gap-4"; 
        
        // AQUI ESTÁ EL CAMBIO: Renderizado eficiente de cada botella
        botellasDelPiso.forEach(botella => {
        const ID_REAL = botella.botella_id || botella.id;
        const nombreSeguro = botella.nombre.replace(/'/g, "\\'"); // Escapar comillas
        const htmlIcono = getHTMLBotella(botella.porcentaje_actual, botella.categoria);
        
        const divBotella = document.createElement('div');
        divBotella.className = "w-32 bg-white border border-slate-200 rounded-2xl p-3 shadow-sm hover:shadow-lg transition-all relative flex flex-col group items-center";
        divBotella.innerHTML = `
            <div class="mt-4 mb-2 h-14 flex items-end justify-center">${htmlIcono}</div>
            <p class="text-[10px] font-black text-slate-800 text-center leading-tight line-clamp-2 h-7 uppercase mb-1 w-full">${botella.nombre}</p>
            <div class="mb-3 px-2 py-1 bg-slate-50 rounded text-[10px] font-bold text-slate-600">${parseFloat(botella.cantidad).toFixed(0)} u.</div>
            
            <!-- BOTONES DE GESTIÓN -->
            <div class="flex gap-2 w-full justify-center mt-2 border-t pt-2">
                <button onclick="abrirModalMerma(${ID_REAL}, '${nombreSeguro}')" class="text-neutral-500 hover:text-red-600 p-1" title="Merma">
                    <i class="fa-solid fa-trash text-[10px]"></i>
                </button>
                <button onclick="abrirModalTester(${botella.producto_id}, '${nombreSeguro}')" class="text-neutral-500 hover:text-amber-600 p-1" title="Tester">
                    <i class="fa-solid fa-spray-can text-[10px]"></i>
                </button>
            </div>
        `;
        pasilloDiv.appendChild(divBotella);
    });
        
        pisoDiv.appendChild(pasilloDiv);
        contenedor.appendChild(pisoDiv);
    }
}

async function ubicarSeleccionadosMasa() {
    const checkboxes = document.querySelectorAll('.check-item-pendiente:checked');
    if (checkboxes.length === 0) {
        return Swal.fire('Atención', 'No has seleccionado ninguna esencia para mover.', 'warning');
    }

    const loteMovimientos = [];
    checkboxes.forEach(cb => {
        loteMovimientos.push({
            id: parseInt(cb.dataset.id, 10),
            cantidad: parseFloat(cb.dataset.cant)
        });
    });

    // 1. Elegir a qué Estante mandar el bloque completo
    const { value: destinoNombre } = await Swal.fire({
        title: '📦 Ubicación Masiva',
        text: `Vas a distribuir ${loteMovimientos.length} productos seleccionados de una vez. ¿Hacia qué estante van?`,
        input: 'select',
        inputOptions: {
            'A': 'Estante A (Piso Principal)',
            'B': 'Estante B (Reserva)'
        },
        inputPlaceholder: 'Selecciona destino...',
        showCancelButton: true,
        confirmButtonText: 'Siguiente >',
        confirmButtonColor: '#0a0a0a'
    });

    if (!destinoNombre) return;

    // 2. Elegir el Piso/Nivel del estante
    const { value: fila } = await Swal.fire({
        title: 'Selecciona el Piso',
        text: `¿En qué nivel del Estante ${destinoNombre} colocarás este lote de mercancía?`,
        input: 'select',
        inputOptions: {
            '1': 'Piso 1 (Arriba)',
            '2': 'Piso 2',
            '3': 'Piso 3',
            '4': 'Piso 4',
            '5': 'Piso 5',
            '6': 'Piso 6 (Abajo)'
        },
        inputPlaceholder: 'Elige un piso...',
        showCancelButton: true,
        confirmButtonText: '⚡ Procesar Traslado',
        confirmButtonColor: '#10b981'
    });

    if (!fila) return;

    try {
        Swal.fire({ title: 'Sincronizando estantes...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        const token = localStorage.getItem('token');
        
        // Ejecutamos la ruta en lote que creamos en Express
        const res = await fetch('/api/ventas/estante/distribuir-lote', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ 
                lote: loteMovimientos, 
                destino: destinoNombre, 
                fila: fila 
            })
        });
        
        if(res.ok) {
            const checkGeneral = document.getElementById('checkSeleccionarTodoPendientes');
            if (checkGeneral) checkGeneral.checked = false;

            Swal.fire({ icon: 'success', title: '¡Operación Completada!', text: `Se movieron ${loteMovimientos.length} productos con éxito.`, timer: 2000, showConfirmButton: false });
            cargarEstantes(); // Actualiza los estantes
        } else {
            const data = await res.json();
            Swal.fire('Error', data.error || 'No se pudo procesar el lote.', 'warning'); 
        }
    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Fallo de conexión con el servidor', 'error');
    }
}


async function solicitarRecambio(productoId, nombre, ubicacion, fila) {
    const btnId = `btn-reponer-${productoId}`;
    const btn = document.getElementById(btnId);
    
    // 2. Confirmación de seguridad
    const confirm = await Swal.fire({
        title: '¿Traer del Almacén?',
        text: `Se bajará 1 botella de "${nombre}" a esta misma posición.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444', // Rojo alerta
        confirmButtonText: 'Sí, reponer ahora',
        cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
        if(btn) btn.disabled = true; // Bloquear botón visualmente

        try {
            // Mostrar spinner de carga
            Swal.fire({ 
                title: 'Buscando en almacén...', 
                text: 'Por favor espere',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading() 
            });

            const token = localStorage.getItem('token');
            
            // 3. Petición al Backend "Inteligente"
            const res = await fetch(`/api/productos/${productoId}/reponer`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({
                    cantidad: 1,          // Solo 1 unidad para reponer la que se acaba
                    ubicacion: ubicacion, // 'A' o 'B' (Donde está la actual)
                    fila: fila            // La misma fila para mantener el orden
                })
            });

            const data = await res.json();

            if (res.ok) {
                // ÉXITO:
                // Cierra la alerta de carga
                Swal.close(); 

                // Notificación pequeña (Toast)
                const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
                Toast.fire({ 
                    icon: 'success', 
                    title: '¡Repuesto!', 
                    text: 'La nueva botella está lista para abrir.' 
                });
                
                // Recargar para ver la nueva caja cerrada
                cargarEstantes(); 
            } else {
                // ERROR (Ej: No hay stock o error de conexión)
                if(btn) btn.disabled = false; // Reactivar botón si falló
                Swal.fire('No se pudo reponer', data.error || 'Verifica el stock en el Almacén General.', 'error');
            }

        } catch (error) {
            console.error(error);
            if(btn) btn.disabled = false; // Reactivar botón
            Swal.fire('Error', 'Fallo de conexión con el servidor', 'error');
        }
    }
}

async function moverBotella(id, destinoNombre, cantidadDisponible) { 
    const { value: cantidad } = await Swal.fire({
        title: `Mover a Estante ${destinoNombre}`,
        text: `Tienes ${cantidadDisponible} unidades en esta caja. ¿Cuántas quieres mover?`,
        input: 'number',
        inputValue: cantidadDisponible, // Por defecto pone todas
        inputAttributes: {
            min: 1,
            max: cantidadDisponible,
            step: 1
        },
        showCancelButton: true,
        confirmButtonText: 'Siguiente >',
        confirmButtonColor: '#3b82f6'
    });

    if (!cantidad) return; // Cancelado

    // PASO 2: PREGUNTAR PISO (FILA)
    const { value: fila } = await Swal.fire({
        title: 'Selecciona el Piso',
        text: `¿En qué piso del Estante ${destinoNombre} colocarás estas ${cantidad} unidades?`,
        input: 'select',
        inputOptions: {
            '1': 'Piso 1 (Arriba)',
            '2': 'Piso 2',
            '3': 'Piso 3',
            '4': 'Piso 4',
            '5': 'Piso 5',       // <--- AGREGADO
            '6': 'Piso 6 (Abajo)'
        },
        inputPlaceholder: 'Elige un piso...',
        showCancelButton: true,
        confirmButtonText: 'Mover Ahora',
        confirmButtonColor: '#10b981' // Verde
    });

    if (fila) {
        try {
            const token = localStorage.getItem('token');
            
            // Llamada al Backend Nuevo
            const res = await fetch(`/api/productos/estante/distribuir/${id}`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ 
                    cantidadMover: cantidad, 
                    destino: destinoNombre, 
                    fila: fila 
                })
            });
            
            const data = await res.json();
            
            if(res.ok) {
                const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
                Toast.fire({ icon: 'success', title: '¡Ubicado en apartamento!' });
                cargarEstantes(); // Recargar para ver los cambios
            } else {
                Swal.fire('No se pudo mover', data.error, 'warning'); 
            }
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
}

window.reponerTesterFrontend = async (idBotella) => {
    const confirm = await Swal.fire({
        title: '¿Rellenar Tester?',
        text: 'Se descontarán 30ml de stock global y se llenará esta botella.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#22c55e',
        confirmButtonText: 'Sí, Rellenar'
    });

    if(confirm.isConfirmed) {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/productos/estante/${idBotella}/reponer`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if(res.ok) {
                Swal.fire('Listo', 'Tester rellenado', 'success');
                init();
            } else {
                Swal.fire('Error', 'No hay stock suficiente', 'error');
            }
        } catch(e) { console.error(e); }
    }
};

window.eliminarBotellaFrontend = async (idBotella) => {
    const confirm = await Swal.fire({
        title: '¿Eliminar Tester?',
        text: 'Esta botella desaparecerá del estante permanentemente.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if(confirm.isConfirmed) {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/productos/estante/${idBotella}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if(res.ok) {
                Swal.fire({
                    icon: 'success', 
                    title: 'Eliminado', 
                    showConfirmButton: false, 
                    timer: 1000
                });
                init(); // Recargar estante
            } else {
                // Ahora sí te dirá qué pasó si falla
                const data = await res.json();
                Swal.fire('Error', data.error || 'No se pudo eliminar.', 'error');
            }
        } catch(e) { 
            console.error(e); 
            Swal.fire('Error', 'Fallo de conexión.', 'error');
        }
    }
};

async function abrirBotellaGrupo(grupoId, cantidadDisponible) {
    
    // Si solo hay 1, la abrimos directo sin preguntar
    if (cantidadDisponible === 1) {
        enviarApertura(grupoId, 1);
        return;
    }

    // Si hay más de 1, preguntamos
    const { value: cantidad } = await Swal.fire({
        title: 'Abrir Caja',
        text: `Hay ${cantidadDisponible} unidades cerradas. ¿Cuántas quieres abrir?`,
        input: 'number',
        inputValue: 1,
        inputAttributes: {
            min: 1,
            max: cantidadDisponible,
            step: 1
        },
        showCancelButton: true,
        confirmButtonText: 'Abrir',
        confirmButtonColor: '#ea580c' // Naranja
    });

    if (cantidad) {
        enviarApertura(grupoId, cantidad);
    }
}

let estaProcesando = false;

function enviarApertura(idEstante) {
    // 1. OBTENER EL TOKEN
    // Importante: Asegúrate de que 'token' es el nombre exacto con el que guardaste la sesión al hacer login.
    const token = localStorage.getItem('token'); 

    if (!token) {
        alert("No has iniciado sesión o tu sesión expiró.");
        window.location.href = 'index.html'; // O redirige a tu login
        return;
    }

    // 2. BLOQUEO DE DOBLE CLICK
    if (estaProcesando) {
        console.warn("Petición en curso. Click ignorado.");
        return; 
    }

    estaProcesando = true;
    document.body.style.cursor = 'wait';

    console.log(`Enviando petición para ID: ${idEstante} con Token...`);

    fetch(`http://localhost:3000/api/productos/estante/abrir/${idEstante}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // 3. AGREGAMOS LA AUTENTICACIÓN AQUÍ
            'Authorization': `Bearer ${token}` 
        }
    })
    .then(async response => {
        const text = await response.text();
        
        // Intentamos parsear la respuesta
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            // Si no es JSON, usamos el texto plano
            data = { msg: text };
        }

        if (!response.ok) {
            // Si el token expiró (401 o 403), redirigir al login
            if (response.status === 401 || response.status === 403) {
                alert("Tu sesión ha expirado. Por favor ingresa nuevamente.");
                localStorage.removeItem('token');
                window.location.href = 'index.html'; // Cambia esto por tu ruta de login
                throw new Error("Sesión expirada");
            }
            throw new Error(data.msg || data.error || data.message || 'Error del servidor');
        }

        return data;
    })
    .then(data => {
        console.log("✅ Caja abierta:", data);
        
        // Refrescar la tabla
        if (typeof cargarEstantes === 'function') {
            cargarEstantes(); 
        } else if (typeof cargarEstantes === 'function') {
            cargarEstantes();
        }
    })
    .catch(error => {
        console.error("❌ Error:", error);
        // Solo mostramos alerta si no fue error de redirección
        if (error.message !== "Sesión expirada") {
            alert(`No se pudo abrir la caja: ${error.message}`);
        }
    })
    .finally(() => {
        estaProcesando = false;
        document.body.style.cursor = 'default';
    });
}

// --- NUEVA FUNCIÓN: UI PARA CREAR TESTER ---
async function prepararTesterUI(idEsencia, nombreEsencia) {

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/formulas', { headers: { 'Authorization': `Bearer ${token}` } });
        const formulas = await res.json();

        if (formulas.length === 0) return Swal.fire('Error', 'No hay fórmulas configuradas', 'warning');

        // 2. Crear opciones para el SweetAlert (Ej: "30ml", "60ml")
        const opciones = {};
        formulas.forEach(f => {
            opciones[f.id] = `Tester ${f.volumen_total}ml`;
        });

        // 3. Mostrar Popup
        const { value: idFormula } = await Swal.fire({
            title: '🎁 Crear Tester',
            text: `Vas a preparar una muestra de ${nombreEsencia}. ¿De qué tamaño?`,
            input: 'select',
            inputOptions: opciones,
            inputPlaceholder: 'Selecciona tamaño',
            showCancelButton: true,
            confirmButtonText: 'Preparar',
            confirmButtonColor: '#9333ea', // Morado
            cancelButtonText: 'Cancelar'
        });

        if (idFormula) {
            // 4. Enviar al Backend
            const resTester = await fetch(`/api/productos/estante/${idEsencia}/tester`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formula_id: idFormula })
            });

            const data = await resTester.json();

            if (resTester.ok) {
                Swal.fire('¡Listo!', `Tester creado. Se descontaron los materiales.\n(Esencia, Alcohol, Fijador y Frasco)`, 'success');
                cargarEstantes(); // Refrescar para ver como baja la esencia
            } else {
                Swal.fire('Error', data.error || 'No se pudo crear el tester', 'error');
            }
        }

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Fallo de conexión', 'error');
    }
}

// --- LÓGICA DE MUESTRAS RÁPIDAS ---
async function crearMuestraUI(idEsencia, nombreEsencia) {
    if (formulasMuestras.length === 0) {
        return Swal.fire('Aviso', 'No hay fórmulas pequeñas (≤15ml) configuradas.', 'warning');
    }

    // Generar opciones para el popup
    const opciones = {};
    formulasMuestras.forEach(f => {
        opciones[f.id] = `Muestra ${f.volumen_total}ml`;
    });

    const { value: idFormula } = await Swal.fire({
        title: '🧪 Muestra Gratis',
        text: `Crear muestra de ${nombreEsencia}. Se descontará Alcohol, Frasco y Esencia.`,
        input: 'select',
        inputOptions: opciones,
        inputPlaceholder: 'Selecciona tamaño',
        showCancelButton: true,
        confirmButtonText: 'Procesar',
        confirmButtonColor: '#9333ea',
        cancelButtonText: 'Cancelar'
    });

    if (idFormula) {
        try {
            const token = localStorage.getItem('token');
            const formula = formulasMuestras.find(f => f.id == idFormula);

            // Usamos la ruta de preparación pero indicando que es muestra
            // NOTA: Reutilizamos el endpoint de "Tester" o "Preparación" si tu backend lo permite.
            // Si creaste la ruta específica 'preparacion-rapida' úsala, si no, usaremos una lógica genérica:
            
            const res = await fetch(`/api/productos/estante/${idEsencia}/tester`, { // Reusamos endpoint de tester/consumo interno
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    formula_id: idFormula,
                    es_muestra: true, // Flag informativo
                    nota: 'Muestra Gratis Cliente'
                })
            });

            const data = await res.json();

            if (res.ok) {
                const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
                Toast.fire({ 
                    icon: 'success', 
                    title: 'Muestra Descontada', 
                    text: `Se descontaron los insumos para ${formula.volumen_total}ml` 
                });
                cargarEstantes(); // Actualizar niveles visualmente
            } else {
                Swal.fire('Error', data.error || 'Faltan insumos (Alcohol/Frascos) en el sistema', 'error');
            }
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
}

// --- GESTIÓN ADMINISTRATIVA: MERMA Y DEVOLUCIÓN ---
function abrirModalGestion(id, nombre) {
    document.getElementById('idBotellaGestion').value = id;
    document.getElementById('lblProductoGestion').innerText = nombre;
    
    // DETECTAR SI ES ALCOHOL POR EL NOMBRE (Lógica simple pero efectiva en frontend)
    const esAlcohol = nombre.toUpperCase().includes('ALCOHOL');
    document.getElementById('modalGestionEstante').dataset.esAlcohol = esAlcohol ? 'true' : 'false';
    
    // Cambiar placeholder para guiar al usuario
    const inputCant = document.getElementById('cantGestion');
    if (esAlcohol) {
        inputCant.placeholder = "Cantidad en ML";
        document.getElementById('lblUnidadGestion').innerText = "ML"; // Asumiendo que tengas un label, si no, ignora esta línea
    } else {
        inputCant.placeholder = "Cantidad";
    }

    setTipoGestion('MERMA');
    document.getElementById('cantGestion').value = '';
    document.getElementById('motivoGestion').value = '';
    document.getElementById('checkPerfumeCompleto').checked = false;
    
    document.getElementById('modalGestionEstante').classList.remove('hidden');
}

function cerrarModalGestion() {
    document.getElementById('modalGestionEstante').classList.add('hidden');
}

function setTipoGestion(tipo) {
    document.getElementById('tipoGestion').value = tipo;
    const btnMerma = document.getElementById('btnMerma');
    const btnDev = document.getElementById('btnDevolucion');
    const divCheck = document.getElementById('divCheckPerfume');

    if (tipo === 'MERMA') {
        btnMerma.className = "flex-1 py-2 rounded-md text-xs font-bold transition bg-white text-red-600 shadow-sm border border-gray-200";
        btnDev.className = "flex-1 py-2 rounded-md text-xs font-bold transition text-gray-500 hover:bg-white";
        divCheck.classList.add('hidden'); 
    } else {
        btnDev.className = "flex-1 py-2 rounded-md text-xs font-bold transition bg-white text-green-600 shadow-sm border border-gray-200";
        btnMerma.className = "flex-1 py-2 rounded-md text-xs font-bold transition text-gray-500 hover:bg-white";
        divCheck.classList.remove('hidden'); 
    }
}

async function procesarGestion(e) {
    e.preventDefault();
    
    const id = document.getElementById('idBotellaGestion').value;
    const tipo = document.getElementById('tipoGestion').value;
    let cantidad = parseFloat(document.getElementById('cantGestion').value);
    const motivo = document.getElementById('motivoGestion').value;
    const esPerfume = document.getElementById('checkPerfumeCompleto').checked;
    const esAlcohol = document.getElementById('modalGestionEstante').dataset.esAlcohol === 'true';

    // CONVERSIÓN CRÍTICA: Si el usuario ve ML y escribe ML, convertimos a Gramos para la BD

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/productos/estante/${id}/gestion`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ tipo, cantidad, motivo, esPerfumeCompleto: esPerfume })
        });

        if (res.ok) {
            cerrarModalGestion();
            Swal.fire({ icon: 'success', title: 'Movimiento Registrado', showConfirmButton: false, timer: 1500 });
            cargarEstantes(true); 
        } else {
            const data = await res.json();
            Swal.fire('Error', data.error, 'error');
        }
    } catch (error) {
        Swal.fire('Error', 'Fallo de conexión', 'error');
    }
}

let paginaActual = 1;

// Muestra el overlay de carga "pegado" al HTML
function mostrarCargando(estado) {
    const overlay = document.getElementById('loadingOverlay'); // Crea este div en tu HTML
    if (overlay) overlay.style.display = estado ? 'flex' : 'none';
}

async function cargarEstante(page = 1, busqueda = "") {
    mostrarCargando(true);
    try {
        const token = localStorage.getItem('token'); // Recuperamos el token
        
        const res = await fetch(`/api/productos/estante?page=${page}&search=${encodeURIComponent(busqueda)}`, {
            headers: { 
                'Authorization': `Bearer ${token}` // <--- ESTO ES LO QUE FALTABA
            }
        });
        
        // Verificamos si la petición fue exitosa
        if (!res.ok) {
            if (res.status === 403 || res.status === 401) {
                throw new Error("Sesión expirada o sin permisos");
            }
            throw new Error("Error en el servidor");
        }

        const result = await res.json();
        
        todasLasBotellas = result.data || [];
        
        // Renderizamos
        renderizarFilas(document.getElementById('estanteA'), todasLasBotellas.filter(b=>b.ubicacion==='A'), 'A');
        renderizarFilas(document.getElementById('estanteB'), todasLasBotellas.filter(b=>b.ubicacion==='B'), 'B');
        
        renderizarPaginacion(result.pagination);
    } catch (e) {
        console.error(e);
        Swal.fire('Error', e.message, 'error');
    } finally {
        mostrarCargando(false);
    }
}

// --- FUNCIÓN DE RENDERIZADO DE PAGINACIÓN ---
function renderizarPaginacion(pagination) {
    const container = document.getElementById('paginacionContainer');
    if (!container) {
        console.warn("No se encontró el elemento #paginacionContainer en el HTML");
        return;
    }

    const { currentPage, totalPages } = pagination;

    // Si solo hay 1 página, ocultamos los botones
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const prevDisabled = currentPage <= 1 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-neutral-800';
    const nextDisabled = currentPage >= totalPages ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-neutral-800';

    container.innerHTML = `
        <div class="flex items-center gap-2 mt-6 justify-center">
            <button onclick="cambiarPagina(${currentPage - 1})" 
                class="px-4 py-2 bg-neutral-950 text-white text-[10px] font-black uppercase tracking-widest ${prevDisabled}" 
                ${currentPage <= 1 ? 'disabled' : ''}>Anterior</button>
            
            <span class="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-4">
                Pág ${currentPage} de ${totalPages}
            </span>
            
            <button onclick="cambiarPagina(${currentPage + 1})" 
                class="px-4 py-2 bg-neutral-950 text-white text-[10px] font-black uppercase tracking-widest ${nextDisabled}" 
                ${currentPage >= totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>
    `;
}

window.cambiarPagina = function(nuevaPagina) {
    const inputSearch = document.getElementById('searchInput');
    const searchTerm = inputSearch ? inputSearch.value.trim() : '';
    
    paginaActual = nuevaPagina;
    
    // Recargamos los datos manteniendo la búsqueda activa
    cargarEstante(paginaActual, searchTerm);
}

// --- LÓGICA MERMA ---
window.abrirModalMerma = (id, nombre) => {
    document.getElementById('merma_id_botella').value = id;
    document.getElementById('mermaNombre').innerText = nombre;
    document.getElementById('modalMerma').classList.remove('hidden');
};

window.cerrarModalMerma = () => document.getElementById('modalMerma').classList.add('hidden');

window.enviarMerma = async () => {
    const id = document.getElementById('merma_id_botella').value;
    const data = {
        cantidad: document.getElementById('merma_cantidad').value,
        motivo: 'MERMA_ESTANTE',
        observaciones: document.getElementById('merma_observaciones').value,
        ubicacion: 'ESTANTE'
    };
    
    // Llamada al controller de productos.controller.js -> reportarMerma
    const res = await fetch(`/api/productos/estante/${id}/gestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({...data, tipo: 'MERMA'})
    });
    
    if(res.ok) { 
        Swal.fire('¡Merma Registrada!', '', 'success'); 
        cerrarModalMerma(); 
        cargarEstante(); 
    }
};

// --- LÓGICA TESTER ---
window.abrirModalTester = async (prodId, nombre) => {
    document.getElementById('tester_id_prod').value = prodId;
    document.getElementById('testerNombre').innerText = nombre;
    
    // Cargar fórmulas dinámicamente
    const res = await fetch('/api/formulas', { headers: {'Authorization': `Bearer ${localStorage.getItem('token')}`} });
    const formulas = await res.json();
    const select = document.getElementById('select_formula_tester');
    select.innerHTML = formulas.map(f => `<option value="${f.id}">${f.nombre}</option>`).join('');
    
    document.getElementById('modalTester').classList.remove('hidden');
};

window.cerrarModalTester = () => document.getElementById('modalTester').classList.add('hidden');

window.enviarTester = async () => {
    const id = document.getElementById('tester_id_prod').value;
    const formula_id = document.getElementById('select_formula_tester').value;
    const es_muestra = document.getElementById('es_muestra_check').checked;

    const res = await fetch(`/api/productos/estante/${id}/tester`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ formula_id, es_muestra, nota: 'Generado desde Estante' })
    });

    if(res.ok) {
        Swal.fire('Tester Creado', '', 'success');
        cerrarModalTester();
        cargarEstante();
    }
};