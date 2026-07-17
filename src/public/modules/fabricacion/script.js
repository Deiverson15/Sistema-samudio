import { ProductoService, FormulaService } from '../../js/api.js';

let ordenesGlobales = [];
let cantidadPlanificadaGlobal = 0;
let esenciasDelLoteEnMemoria = [];

document.getElementById('cantPlanificada').addEventListener('input', recalcularMatematicaLote);


export async function init() {

    console.log("Módulo de Fabricación Inicializado.");
    
    // Exponer funciones a la ventana (Para los botones HTML)
    window.abrirModalNuevaOrden = abrirModalNuevaOrden;
    window.cerrarModalNuevaOrden = cerrarModalNuevaOrden;
    window.abrirModalCompletar = abrirModalCompletar;
    window.cerrarModalCompletar = cerrarModalCompletar;
    window.abrirModalHistorialInsumos = abrirModalHistorialInsumos;
    window.cerrarModalHistorialInsumos = cerrarModalHistorialInsumos;

    // Listeners de Formularios
    document.getElementById('formNuevaOrden').addEventListener('submit', procesarNuevaOrden);
    document.getElementById('formCompletarOrden').addEventListener('submit', enviarCierreOrden);

    // Listener para calcular merma dinámicamente
    document.getElementById('cantCompletada').addEventListener('input', (e) => {
        const completada = parseInt(e.target.value) || 0;
        const merma = cantidadPlanificadaGlobal - completada;
        const inputMerma = document.getElementById('cantMerma');
        const divMerma = document.getElementById('divAccionMerma');
        
        inputMerma.value = Math.max(0, merma);
        
        // Si hay merma, mostrar la caja roja pidiendo explicaciones
        if (merma > 0) {
            divMerma.classList.remove('hidden');
        } else {
            divMerma.classList.add('hidden');
        }
    });

    await cargarOrdenes();
}

window.agregarEsenciaALista = function() {
    const select = document.getElementById('selectEsencia');
    const inputCant = document.getElementById('cantEsenciaFila');
    
    const id = parseInt(select.value, 10);
    const nombre = select.options[select.selectedIndex]?.text;
    const cantidad = parseInt(inputCant.value, 10);
    const metaTotal = parseInt(document.getElementById('cantPlanificada').value, 10) || 0;

    if (!id || isNaN(cantidad) || cantidad <= 0) {
        return Swal.fire('Datos Incompletos', 'Selecciona una fragancia y asigna una cantidad válida.', 'warning');
    }
    if (metaTotal <= 0) {
        return Swal.fire('Falta Meta', 'Define primero la cantidad total de perfumes del lote compuesto.', 'warning');
    }

    // Calculamos cuánto llevamos asignado actualmente
    const asignadoActual = esenciasDelLoteEnMemoria.reduce((acc, item) => acc + item.cantidad, 0);
    if ((asignadoActual + cantidad) > metaTotal) {
        return Swal.fire('Límite Superado', `No puedes agregar ${cantidad} unidades. El espacio restante es de apenas ${metaTotal - asignadoActual} perfumes.`, 'error');
    }

    // Si ya existe la esencia en la lista, sumamos la cantidad, si no, la añadimos nueva
    const existe = esenciasDelLoteEnMemoria.find(item => item.id === id);
    if (existe) {
        existe.cantidad += cantidad;
    } else {
        esenciasDelLoteEnMemoria.push({ id, nombre, cantidad });
    }

    // Limpiamos los inputs de fila para la siguiente fragancia
    select.value = "";
    inputCant.value = "";
    
    renderListaEsenciasAgregadas();
};

window.eliminarEsenciaDeLista = function(index) {
    esenciasDelLoteEnMemoria.splice(index, 1);
    renderListaEsenciasAgregadas();
};

function renderListaEsenciasAgregadas() {
    const tbody = document.getElementById('bodyEsenciasAgregadas');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (esenciasDelLoteEnMemoria.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-neutral-400 uppercase text-[9px] tracking-widest">Ninguna esencia añadida al lote compuesto</td></tr>';
        recalcularMatematicaLote();
        return;
    }

    esenciasDelLoteEnMemoria.forEach((item, index) => {
        tbody.innerHTML += `
            <tr class="border-b border-neutral-200 bg-white">
                <td class="p-2.5 pl-4 uppercase font-black text-neutral-900 text-xs">${item.nombre}</td>
                <td class="p-2.5 text-center font-black text-xs text-neutral-900">${item.cantidad} u.</td>
                <td class="p-2.5 text-center">
                    <button type="button" onclick="eliminarEsenciaDeLista(${index})" class="text-neutral-400 hover:text-red-600 transition-colors font-bold">✕</button>
                </td>
            </tr>
        `;
    });

    recalcularMatematicaLote();
}

function recalcularMatematicaLote() {
    const metaTotal = parseInt(document.getElementById('cantPlanificada').value, 10) || 0;
    const asignado = esenciasDelLoteEnMemoria.reduce((acc, item) => acc + item.cantidad, 0);
    const restante = metaTotal - asignado;

    document.getElementById('txtMetaControl').innerText = metaTotal;
    document.getElementById('txtAsignadoControl').innerText = asignado;
    document.getElementById('txtRestanteControl').innerText = restante >= 0 ? restante : 0;
}

async function cargarOrdenes() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/fabricacion', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error("Error leyendo órdenes");
        
        ordenesGlobales = await res.json();
        renderizarKanban();
    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Fallo de conexión', 'error');
    }
}

function renderizarKanban() {
    const listProcesando = document.getElementById('listaProcesando');
    const listCompletadas = document.getElementById('listaCompletadas');
    
    listProcesando.innerHTML = '';
    listCompletadas.innerHTML = '';
    
    let countProcesando = 0;
    let countCompletadas = 0;

    ordenesGlobales.forEach(o => {
        const isProcesando = o.estado === 'PROCESANDO';
        
        if (isProcesando) countProcesando++;
        else countCompletadas++;

        // Render Tarjeta
        const tarjeta = document.createElement('div');
        tarjeta.className = "bg-white p-4 border border-neutral-200 shadow-sm flex flex-col gap-3 rounded-none relative";
        
        // Etiqueta de Lote Superior
        const loteBadge = isProcesando 
            ? `<span class="bg-amber-100 text-amber-800 text-[9px] font-black px-2 py-0.5 border border-amber-300 uppercase tracking-widest">${o.codigo_orden}</span>`
            : `<span class="bg-neutral-100 text-neutral-600 text-[9px] font-black px-2 py-0.5 border border-neutral-300 uppercase tracking-widest">${o.lote_fabricacion || o.codigo_orden}</span>`;

        // Cuerpo de la tarjeta
        tarjeta.innerHTML = `
            <div class="flex justify-between items-start">
                ${loteBadge}
                <span class="text-[9px] font-bold text-neutral-400 uppercase">${new Date(o.fecha_creacion).toLocaleDateString()}</span>
            </div>
            
            <div>
                <p class="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Perfume Final</p>
                <p class="text-xs font-black text-neutral-950 uppercase leading-tight">${o.formula_nombre} - ${o.esencia_nombre}</p>
            </div>

            <div class="grid grid-cols-2 gap-2 border-t border-neutral-100 pt-2 mt-1">
                <div>
                    <p class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">Planificado</p>
                    <p class="text-sm font-black text-neutral-950">${o.cantidad_planificada} unds</p>
                </div>
                ${isProcesando ? `
                    <div class="text-right">
                        <p class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">Operador</p>
                        <p class="text-[10px] font-bold text-neutral-800 uppercase">${o.creador_nombre}</p>
                    </div>
                ` : `
                    <div>
                        <p class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">Rendimiento</p>
                        <p class="text-xs font-black text-green-700">${o.cantidad_completada} L | ${o.cantidad_merma} M</p>
                    </div>
                `}
            </div>
            
            ${isProcesando ? `
                <button onclick="abrirModalCompletar(${o.id}, ${o.cantidad_planificada})" class="w-full mt-2 bg-neutral-950 text-white py-2.5 text-[9px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-colors">
                    Reportar Cierre de Lote
                </button>
            ` : `
                <div class="mt-2 bg-neutral-50 border border-neutral-200 p-2 text-center text-[9px] font-black text-neutral-500 uppercase tracking-widest">
                    Costo Unit: $${parseFloat(o.costo_unitario_real).toFixed(2)}
                </div>
            `}
        `;

        if (isProcesando) listProcesando.appendChild(tarjeta);
        else listCompletadas.appendChild(tarjeta);
    });

    document.getElementById('badgeProcesando').innerText = countProcesando;
    document.getElementById('badgeCompletadas').innerText = countCompletadas;
    
    if (countProcesando === 0) listProcesando.innerHTML = '<div class="text-center p-6 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">El laboratorio está libre.</div>';
    if (countCompletadas === 0) listCompletadas.innerHTML = '<div class="text-center p-6 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">No hay historial reciente.</div>';
}

// --- FASE 1: CREAR ---
async function abrirModalNuevaOrden() {
    try {
        esenciasDelLoteEnMemoria = []; // Vaciamos la lista de la sesión previa
        renderListaEsenciasAgregadas();

        const resForm = await FormulaService.getAll();
        const resProd = await ProductoService.getAll(1, 500, "", false);
        const esencias = resProd.data.filter(p => p.categoria && p.categoria.toUpperCase().includes('ESENCIA'));

        const selF = document.getElementById('selectFormula');
        const selE = document.getElementById('selectEsencia');
        
        selF.innerHTML = '<option value="" disabled selected>-- SELECCIONAR RECETA --</option>' + resForm.map(f => `<option value="${f.id}">${f.nombre} (${f.volumen_total}ml)</option>`).join('');
        selE.innerHTML = '<option value="" disabled selected>-- ASIGNAR FRAGANCIA --</option>' + esencias.map(e => `<option value="${e.id}">${e.nombre} (Dispo: ${parseFloat(e.stock_real).toFixed(0)}g)</option>`).join('');

        document.getElementById('formNuevaOrden').reset();
        recalcularMatematicaLote();
        document.getElementById('modalNuevaOrden').classList.remove('hidden');
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Fallo cargando catálogos.', 'error');
    }
}

function cerrarModalNuevaOrden() {
    document.getElementById('modalNuevaOrden').classList.add('hidden');
}

async function procesarNuevaOrden(e) {
    e.preventDefault();
    const metaTotal = parseInt(document.getElementById('cantPlanificada').value, 10) || 0;
    const asignado = esenciasDelLoteEnMemoria.reduce((acc, item) => acc + item.cantidad, 0);

    // 🔒 VALIDADOR DE CANDADO: Si no suma exactamente 500 unidades, frena de inmediato
    if (asignado !== metaTotal) {
        return Swal.fire('Orden Descuadrada', `La suma de la lista (${asignado} u.) debe ser exactamente igual a la meta total planificada (${metaTotal} u.). Te faltan asignar ${metaTotal - asignado} unidades.`, 'error');
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Congelando Almacén...';

    const payload = {
        formula_id: document.getElementById('selectFormula').value,
        cantidad_planificada: metaTotal,
        notas_planificacion: document.getElementById('notasPlan').value,
        // 🔥 ENVIAMOS LA COMPOSICIÓN VARIADA COMPLETA
        composicion: esenciasDelLoteEnMemoria 
    };

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/fabricacion/orden', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        Swal.fire({ icon: 'success', title: 'Lote Mixto Creado', text: data.mensaje, confirmButtonColor: '#0a0a0a' });
        document.getElementById('modalNuevaOrden').classList.add('hidden');
        await cargarOrdenes();
    } catch (error) {
        Swal.fire('Atención Insumos', error.message, 'warning');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Bloquear y Fabricar';
    }
}

// --- FASE 3: COMPLETAR ---
function abrirModalCompletar(id, planificada) {
    cantidadPlanificadaGlobal = planificada;
    document.getElementById('ordenIdCierre').value = id;
    document.getElementById('lblPlanificado').innerText = planificada;
    
    document.getElementById('cantCompletada').value = '';
    document.getElementById('cantCompletada').max = planificada;
    document.getElementById('cantMerma').value = '0';
    document.getElementById('notasCierre').value = '';
    document.getElementById('divAccionMerma').classList.add('hidden');

    document.getElementById('modalCompletarOrden').classList.remove('hidden');
}

function cerrarModalCompletar() {
    document.getElementById('modalCompletarOrden').classList.add('hidden');
}

async function enviarCierreOrden(e) {
    e.preventDefault();
    const id = document.getElementById('ordenIdCierre').value;
    const completada = parseInt(document.getElementById('cantCompletada').value) || 0;
    const merma = parseInt(document.getElementById('cantMerma').value) || 0;
    
    if ((completada + merma) !== cantidadPlanificadaGlobal) {
        return Swal.fire('Error Matemático', `La suma de listas (${completada}) y mermas (${merma}) debe ser exactamente igual a lo planificado (${cantidadPlanificadaGlobal}).`, 'warning');
    }

    const payload = {
        cantidad_completada: completada,
        cantidad_merma: merma,
        accion_merma: document.getElementById('accionMerma').value,
        notas_cierre: document.getElementById('notasCierre').value
    };

    try {
        Swal.fire({ title: 'Costeando y Registrando Lote...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/fabricacion/orden/${id}/completar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        Swal.fire({ icon: 'success', title: 'Lote Terminado', text: data.mensaje, confirmButtonColor: '#0a0a0a' });
        cerrarModalCompletar();
        await cargarOrdenes();
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
}

// --- MODAL HISTORIAL ACORDEÓN ---
window.abrirModalHistorialInsumos = () => {
    const tbody = document.getElementById('bodyHistorialInsumos');
    if (!tbody) return;

    tbody.innerHTML = '';
    // Filtramos solo los lotes completados
    const lotesCerrados = ordenesGlobales.filter(o => o.estado === 'COMPLETADA');

    if (lotesCerrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-neutral-400 uppercase text-[10px]">Sin registros.</td></tr>`;
    } else {
        lotesCerrados.forEach(o => {
            const insumos = typeof o.insumos_reservados === 'string' ? JSON.parse(o.insumos_reservados) : o.insumos_reservados;
            const fechaFmt = o.fecha_cierre ? new Date(o.fecha_cierre).toLocaleDateString() : 'N/A';
            
            tbody.innerHTML += `
                <tr onclick="toggleDetalle('det-${o.id}')" class="cursor-pointer hover:bg-neutral-100 border-b transition-colors">
                    <td class="p-3 text-[10px] font-black text-neutral-500">${fechaFmt}</td>
                    <td class="p-3 text-[10px] font-black text-neutral-950">${o.codigo_orden}</td>
                    <td class="p-3 text-[10px] text-neutral-600 italic">Clic para ver ${insumos.length} insumos...</td>
                    <td class="p-3 text-right"><i class="fa-solid fa-chevron-down text-neutral-400"></i></td>
                </tr>
                <tr id="det-${o.id}" class="hidden bg-neutral-50">
                    <td colspan="4" class="p-4 border-b border-neutral-200">
                        <table class="w-full text-[10px] text-neutral-700">
                            ${insumos.map(ins => `
                                <tr>
                                    <td class="py-1 uppercase font-bold">${ins.nombre}</td>
                                    <td class="py-1 text-right font-black">${parseFloat(ins.reservado).toFixed(0)} ${getUnidad(ins.nombre)}</td>
                                </tr>
                            `).join('')}
                        </table>
                    </td>
                </tr>
            `;
        });
    }
    document.getElementById('modalHistorialInsumos').classList.remove('hidden');
};

// --- FUNCIONES AUXILIARES DEL HISTORIAL ---
window.toggleDetalle = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
};

function getUnidad(n) { 
    const nombre = n.toUpperCase();
    if (nombre.includes('ALCOHOL')) return 'ml';
    if (nombre.includes('FRASCO') || nombre.includes('ENVASE')) return 'unds';
    return 'g';
}

function cerrarModalHistorialInsumos() { 
    document.getElementById('modalHistorialInsumos').classList.add('hidden'); 
}