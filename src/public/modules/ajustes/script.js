import { ProductoService, AjusteService } from '../../js/api.js';

let productosCache = [];

const MOTIVOS_SALIDA = [
    "Merma (Rotura/Daño)",
    "Merma (Vencimiento)",
    "Diferencia de Inventario (Faltante)",
    "Uso Interno / Consumo",
    "Robo",
    "Salida por Donación",
    "Otro (Salida Administrativa)"
];

const MOTIVOS_ENTRADA = [
    "Compra / Reposición",
    "Devolución de Cliente",
    "Diferencia de Inventario (Sobrante)",
    "Bonificación Proveedor",
    "Inventario Inicial",
    "Otro (Entrada Administrativa)"
];

export async function init() {
    console.log("🚀 Módulo Ajustes: Iniciado (Modo Práctico)");

    // 1. Cargar productos en segundo plano
    cargarProductosCache();

    // 2. Event listeners del Modal
    const inputFiltro = document.getElementById('inputFiltroModal');
    if(inputFiltro) {
        inputFiltro.addEventListener('input', (e) => filtrarLista(e.target.value));
    }

    // 3. Submit del Formulario
    const form = document.getElementById('formAjuste');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await procesarAjuste();
        });
    }

    // 4. Cambios de Radio Button (Entrada vs Salida)
    const radios = document.getElementsByName('tipo');
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            actualizarUIporTipo();
        });
    });

    // Estado inicial
    actualizarUIporTipo();

    // Exponer al window
    window.abrirModalSeleccion = abrirModalSeleccion;
    window.cerrarModalSeleccion = cerrarModalSeleccion;
    window.seleccionarProducto = seleccionarProducto;
    window.guardarTasaGlobal = guardarTasaGlobal;

    await cargarTasaActual();
}

async function cargarProductosCache() {
    try {
        const res = await ProductoService.getAll(1, 2000); 
        productosCache = res.data || [];
    } catch (e) {
        console.error("Error cargando caché de productos:", e);
    }
}

// --- TASA GLOBAL ---
async function cargarTasaActual() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ajustes/tasa', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const input = document.getElementById('inputTasaGlobal');
        if(input) input.value = data.tasa;
    } catch (e) { console.error("Error tasa:", e); }
}

async function guardarTasaGlobal() {
    const input = document.getElementById('inputTasaGlobal');
    const nuevaTasa = input.value;
    
    if(!nuevaTasa || nuevaTasa <= 0) return Swal.fire('Error', 'Tasa inválida', 'warning');

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ajustes/tasa', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ nuevaTasa })
        });

        if (res.ok) Swal.fire('Éxito', 'Tasa Global Actualizada.', 'success');
        else Swal.fire('Error', 'No tienes permisos para cambiar la tasa.', 'error');
    } catch (e) {
        Swal.fire('Error', 'Error de conexión', 'error');
    }
}

// --- LÓGICA DE UI (ENTRADA VS SALIDA) ---
function actualizarUIporTipo() {
    const tipo = document.querySelector('input[name="tipo"]:checked').value;
    const panelLotes = document.getElementById('panelLotes');
    const containerSelect = document.getElementById('selectorLoteContainer');
    const containerInput = document.getElementById('inputLoteManualContainer');
    const btnSubmit = document.getElementById('btnSubmit');

    // 1. Colores y Estilos del Panel Lotes
    if (tipo === 'SALIDA') {
        panelLotes.className = "p-5 rounded-xl border-l-4 transition-all duration-300 bg-red-50 border-red-500";
        containerSelect.classList.remove('hidden');
        containerInput.classList.add('hidden');
        
        // Estilo Botón
        btnSubmit.classList.remove('bg-green-800', 'hover:bg-green-700');
        btnSubmit.classList.add('bg-slate-900', 'hover:bg-slate-800'); 
        btnSubmit.innerHTML = `<span>Registrar Salida / Merma</span> <i class="fa-solid fa-arrow-right-from-bracket"></i>`;
        
        cargarMotivos(MOTIVOS_SALIDA);
    } else {
        panelLotes.className = "p-5 rounded-xl border-l-4 transition-all duration-300 bg-green-50 border-green-500";
        containerSelect.classList.add('hidden');
        containerInput.classList.remove('hidden');

        // Estilo Botón
        btnSubmit.classList.remove('bg-slate-900', 'hover:bg-slate-800');
        btnSubmit.classList.add('bg-green-800', 'hover:bg-green-700');
        btnSubmit.innerHTML = `<span>Registrar Entrada</span> <i class="fa-solid fa-arrow-right-to-bracket"></i>`;

        cargarMotivos(MOTIVOS_ENTRADA);
    }

    // Mostrar el panel SOLO si hay producto seleccionado
    const hayProducto = document.getElementById('producto_id').value !== '';
    if(!hayProducto) panelLotes.classList.add('hidden');
    else panelLotes.classList.remove('hidden');
}

function cargarMotivos(lista) {
    const select = document.getElementById('motivo');
    select.innerHTML = '';
    lista.forEach(m => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = m;
        select.appendChild(option);
    });
}

// --- BUSCADOR Y SELECCIÓN ---
function abrirModalSeleccion() {
    document.getElementById('modalBusqueda').classList.remove('hidden');
    const input = document.getElementById('inputFiltroModal');
    input.value = '';
    input.focus();
    filtrarLista('');
}

window.cerrarModalSeleccion = function() {
    document.getElementById('modalBusqueda').classList.add('hidden');
}

function filtrarLista(texto) {
    const contenedor = document.getElementById('listaResultadosModal');
    contenedor.innerHTML = '';
    
    const busqueda = texto.toLowerCase();
    const filtrados = productosCache.filter(p => 
        p.nombre.toLowerCase().includes(busqueda) || 
        (p.codigo && p.codigo.toLowerCase().includes(busqueda))
    ).slice(0, 50);

    if (filtrados.length === 0) {
        contenedor.innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-slate-400">
                <i class="fa-solid fa-box-open text-4xl mb-3 opacity-20"></i>
                <p>No se encontraron productos.</p>
            </div>`;
        return;
    }

    filtrados.forEach(p => {
        // Formateo visual para decimales (si es 50.00 -> 50, si es 50.50 -> 50.50)
        const stockFmt = parseFloat(p.stock_real).toFixed(2).replace(/\.00$/, ''); 
        const unidad = p.unidad_medida || 'u'; 
        const nombreSafe = p.nombre.replace(/'/g, "\\'");
        const unidadCorta = p.unidad_medida === 'GRAMOS' ? 'g' : (p.unidad_medida === 'MILILITROS' ? 'ml' : 'u');

        contenedor.innerHTML += `
            <div onclick="seleccionarProducto(${p.id}, '${nombreSafe}', ${p.stock_real}, '${unidad}')" 
                 class="flex justify-between items-center p-4 bg-white border border-slate-100 rounded-xl cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition mb-2">
                <div>
                    <div class="font-bold text-slate-700">${p.nombre}</div>
                    <div class="text-xs text-slate-400 flex gap-2">
                         <span class="bg-slate-100 px-2 rounded">${p.codigo || 'S/N'}</span>
                         <span>${p.marca || ''}</span>
                    </div>
                </div>
                <div class="text-right">
                    <span class="font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-full text-xs border border-slate-200">
                        ${stockFmt} ${unidadCorta}
                    </span>
                </div>
            </div>
        `;
    });
}

// --- SELECCIÓN INTELIGENTE DE LOTES (LÓGICA PRÁCTICA) ---
window.seleccionarProducto = async function(id, nombre, stock, unidad) {
    // 1. Setear datos básicos
    document.getElementById('producto_id').value = id;
    document.getElementById('nombreProductoDisplay').value = nombre;
    
    // 2. Actualizar etiquetas de UI (Unidad y Stock)
    const mapUnidades = {
        'GRAMOS': 'g',
        'MILILITROS': 'ml',
        'UNIDAD': 'u'
    };
    const unidadFmt = mapUnidades[unidad] || 'u';
    document.getElementById('labelUnidad').innerText = unidadFmt; 
    document.getElementById('stockUnitBadge').innerText = unidadFmt; 
    document.getElementById('stockValue').innerText = parseFloat(stock).toFixed(2).replace(/\.00$/, '');
    document.getElementById('stockBadge').classList.remove('hidden');
    
    cerrarModalSeleccion();
    actualizarUIporTipo(); 

    // 3. Cargar Lotes para Salida
    const selectLotes = document.getElementById('loteSeleccion');
    selectLotes.innerHTML = '<option>Consultando lotes...</option>';

    try {
        const res = await fetch(`/api/productos/${id}/lotes`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
        const lotes = await res.json();
        
        selectLotes.innerHTML = ''; // Limpiar

        if(!lotes || lotes.length === 0) {
            selectLotes.innerHTML = '<option value="">⚠️ No hay lotes con stock</option>';
        } 
        
        // --- AQUÍ ESTÁ LA LÓGICA PEDIDA ---
        // CASO 1: UN SOLO LOTE (AUTO-SELECCIÓN)
        else if(lotes.length === 1) {
            const l = lotes[0];
            const cantFmt = parseFloat(l.cantidad_actual).toFixed(2).replace(/\.00$/, '');
            const fecha = new Date(l.fecha_vencimiento).toLocaleDateString();
            
            // Lo marcamos como selected automáticamente
            selectLotes.innerHTML = `
                <option value="${l.id}" selected>
                    ✅ LOTE ÚNICO: ${l.codigo_lote} (Disp: ${cantFmt} ${unidadFmt})
                </option>`;
            
            // Toast discreto para confirmar que se eligió solo
            const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
            Toast.fire({ icon: 'info', title: 'Lote único seleccionado automáticamente' });
            
            // Saltamos directo al campo cantidad para ser rápidos
            document.getElementById('cantidad').focus();
        } 
        
        // CASO 2: MÚLTIPLES LOTES (MOSTRAR PARA ELEGIR)
        else {
            selectLotes.innerHTML = `<option value="">👇 -- EXISTEN ${lotes.length} LOTES. ELIGE UNO --</option>`;
            
            // Opción extra por si quiere FIFO
            selectLotes.innerHTML += `<option value="">⚡ Automático (Más Antiguo Primero)</option>`;

            lotes.forEach(l => {
                const cantFmt = parseFloat(l.cantidad_actual).toFixed(2).replace(/\.00$/, '');
                const fecha = new Date(l.fecha_vencimiento).toLocaleDateString();
                // Marcamos visualmente si está vencido
                const esVencido = new Date(l.fecha_vencimiento) < new Date();
                
                selectLotes.innerHTML += `
                    <option value="${l.id}">
                        ${esVencido ? '⚠️' : '📦'} ${l.codigo_lote} | Disp: ${cantFmt} | Vence: ${fecha}
                    </option>
                `;
            });
            
            // Enfocamos el selector para obligar a ver
            selectLotes.focus();
        }
    } catch(e) {
        console.error(e);
        selectLotes.innerHTML = '<option value="">Error cargando lotes</option>';
    }
};

// --- ENVIAR ---
async function procesarAjuste() {
    const data = {
        producto_id: document.getElementById('producto_id').value,
        tipo: document.querySelector('input[name="tipo"]:checked').value,
        cantidad: document.getElementById('cantidad').value,
        motivo: document.getElementById('motivo').value,
        lote_id: document.getElementById('loteSeleccion').value,         
        codigo_manual: document.getElementById('codigoLoteManual').value 
    };

    if(!data.producto_id) return Swal.fire('Atención', "Selecciona un producto.", 'warning');
    if(!data.cantidad || data.cantidad <= 0) return Swal.fire('Atención', "Ingresa una cantidad válida.", 'warning');

    const colorBtn = data.tipo === 'SALIDA' ? '#ef4444' : '#22c55e'; 
    // Texto informativo para la confirmación
    const textoLote = (data.tipo === 'SALIDA' && data.lote_id) ? 'Lote Específico Seleccionado' : 'Automático (FIFO)';

    const result = await Swal.fire({
        title: `Confirmar ${data.tipo}`,
        html: `
            <div class="text-left text-sm bg-slate-50 p-4 rounded-lg border border-slate-200">
                <p><b>Producto:</b> ${document.getElementById('nombreProductoDisplay').value}</p>
                <p><b>Cantidad:</b> <span class="text-lg font-bold">${data.cantidad}</span></p>
                ${data.tipo === 'SALIDA' ? `<p class='text-xs text-gray-500 mt-1'><b>Origen:</b> ${textoLote}</p>` : ''}
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: colorBtn,
        confirmButtonText: 'Sí, Ejecutar'
    });

    if(result.isConfirmed) {
        const res = await AjusteService.create(data);
        
        if(res.error) {
            Swal.fire('Error', res.error, 'error');
        } else {
            await Swal.fire({
                icon: 'success',
                title: 'Ajuste Exitoso',
                text: `Nuevo Stock: ${res.nuevo_stock} ${res.unidad || ''}`,
                timer: 2000,
                showConfirmButton: false
            });
            
            // Reset
            document.getElementById('formAjuste').reset();
            document.getElementById('producto_id').value = '';
            document.getElementById('nombreProductoDisplay').value = '';
            document.getElementById('panelLotes').classList.add('hidden');
            document.getElementById('stockBadge').classList.add('hidden');
            
            cargarProductosCache();
        }
    }
}