import { ProductoService, FormulaService } from '../../js/api.js';

let ordenesGlobales = [];
let cantidadPlanificadaGlobal = 0;
let esenciasDelLoteEnMemoria = [];
let esenciasCierreMemoria = []; 
let paginaActualCierre = 1;
const ITEMS_POR_PAGINA_CIERRE = 5;
let formulasFiltradasGlobal = [];

export async function init() {
    console.log("Módulo de Fabricación Inicializado.");

    const inputMeta = document.getElementById('cantPlanificada');
    if (inputMeta) {
        inputMeta.addEventListener('input', recalcularMatematicaLote);
    }

    const selectF = document.getElementById('selectFormula');
    if (selectF) {
        selectF.addEventListener('change', recalcularMatematicaLote);
    }

    const formNueva = document.getElementById('formNuevaOrden');
    if (formNueva) formNueva.addEventListener('submit', procesarNuevaOrden);

    const formCompletar = document.getElementById('formCompletarOrden');
    if (formCompletar) formCompletar.addEventListener('submit', enviarCierreOrden);

    // Exponer funciones necesarias al scope global (window)
    window.abrirModalNuevaOrden = abrirModalNuevaOrden;
    window.cerrarModalNuevaOrden = cerrarModalNuevaOrden;
    window.abrirModalCompletar = abrirModalCompletar;
    window.cerrarModalCompletar = cerrarModalCompletar;
    window.abrirModalHistorialInsumos = abrirModalHistorialInsumos;
    window.cerrarModalHistorialInsumos = cerrarModalHistorialInsumos;
    window.imprimirGuiaFabricacion = imprimirGuiaFabricacion;
    window.agregarEsenciaALista = agregarEsenciaALista;
    window.eliminarEsenciaDeLista = eliminarEsenciaDeLista;
    window.cambiarPaginaCierre = cambiarPaginaCierre;
    window.toggleMarcarTodasEsencias = toggleMarcarTodasEsencias;
    window.toggleCheckEsenciaCierre = toggleCheckEsenciaCierre;
    window.actualizarCantidadOkCierre = actualizarCantidadOkCierre;
    window.actualizarCantidadMermaCierre = actualizarCantidadMermaCierre;
    window.toggleDetalle = toggleDetalle;
    window.descargarExcelLotesFiltro = descargarExcelLotesFiltro;
    window.descargarExcelInsumosFiltro = descargarExcelInsumosFiltro;
    window.aplicarFiltrosOrdenes = aplicarFiltrosOrdenes;
    window.limpiarFiltrosOrdenes = limpiarFiltrosOrdenes;
    window.verDetalleLoteModal = verDetalleLoteModal;
    window.verDetalleLoteCompletado = verDetalleLoteCompletado;
    window.abrirModalExportacion = abrirModalExportacion;

    await cargarOrdenes();
}

// =======================================================
// 🟢 FASE 1: CREAR NUEVA ORDEN CON BUSCADOR
// =======================================================
async function abrirModalNuevaOrden() {
    try {
        esenciasDelLoteEnMemoria = [];
        renderListaEsenciasAgregadas();

        const resForm = await FormulaService.getAll() || [];
        const resProd = await ProductoService.getAll(1, 500, "", false);
        
        window.catalogosEsenciasGlobal = resProd.data.filter(p => p.categoria && p.categoria.toUpperCase().includes('ESENCIA'));

        // 🔥 FILTRAR SOLO LAS 3 MEDIDAS BASE (30ML, 60ML, 100ML) Y ELIMINAR REPETIDOS DE PROMOS
        const medidasDeseadas = [30, 60, 100];
        formulasFiltradasGlobal = [];

        medidasDeseadas.forEach(medida => {
            // Busca la receta cuyo volumen sea la medida exacta y que no sea promo (o toma la primera)
            const fEncontrada = resForm.find(f => parseInt(f.volumen_total, 10) === medida && (!f.cantidad_promo || parseFloat(f.cantidad_promo) <= 0))
                             || resForm.find(f => parseInt(f.volumen_total, 10) === medida);
            
            if (fEncontrada) {
                formulasFiltradasGlobal.push(fEncontrada);
            }
        });

        const selF = document.getElementById('selectFormula');
        const datalistE = document.getElementById('listaEsenciasDatalist');
        
        if (selF) {
            selF.innerHTML = '<option value="" disabled selected>-- SELECCIONAR MEDIDA --</option>' + 
                formulasFiltradasGlobal.map(f => `<option value="${f.id}">FORMATO DE PERFUME ${f.volumen_total}ML</option>`).join('');
        }
        
        if (datalistE) {
            datalistE.innerHTML = window.catalogosEsenciasGlobal.map(e => {
                const codFmt = e.codigo ? `[${e.codigo}] ` : '';
                return `<option value="${codFmt}${e.nombre.toUpperCase()}">Stock Disponible: ${parseFloat(e.stock_real || 0).toFixed(0)}g</option>`;
            }).join('');
        }

        const form = document.getElementById('formNuevaOrden');
        if (form) form.reset();
        
        const inputBusqueda = document.getElementById('inputBuscarEsencia');
        if (inputBusqueda) inputBusqueda.value = '';
        
        recalcularMatematicaLote();
        document.getElementById('modalNuevaOrden').classList.remove('hidden');
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Fallo cargando catálogos de producción.', 'error');
    }
}

async function abrirModalExportacion() {
    const { value: formValues } = await Swal.fire({
        title: 'Exportar Reportes de Laboratorio',
        html: `
            <div class="text-left space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-black text-neutral-500 uppercase mb-1">Fecha Inicio</label>
                        <input type="date" id="modalExpStart" class="w-full bg-neutral-50 border border-neutral-300 p-2 text-xs font-bold">
                    </div>
                    <div>
                        <label class="block text-[10px] font-black text-neutral-500 uppercase mb-1">Fecha Fin</label>
                        <input type="date" id="modalExpEnd" class="w-full bg-neutral-50 border border-neutral-300 p-2 text-xs font-bold">
                    </div>
                </div>

                <div>
                    <label class="block text-[10px] font-black text-neutral-500 uppercase mb-1">Filtro Volumen Mínimo (Unidades)</label>
                    <input type="number" id="modalExpMin" placeholder="Ej: 50 o 1000" class="w-full bg-neutral-50 border border-neutral-300 p-2 text-xs font-bold">
                </div>

                <div>
                    <label class="block text-[10px] font-black text-neutral-500 uppercase mb-1">Tipo de Reporte Solicitado</label>
                    <select id="modalExpTipo" class="w-full bg-neutral-50 border border-neutral-300 p-2.5 text-xs font-bold uppercase">
                        <option value="LOTES">Reporte General de Lotes (Desglose Fragancias)</option>
                        <option value="INSUMOS">Auditoría de Insumos Descontados (Materia Prima)</option>
                    </select>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Generar Excel',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#047857',
        preConfirm: () => {
            return {
                start: document.getElementById('modalExpStart').value,
                end: document.getElementById('modalExpEnd').value,
                min: document.getElementById('modalExpMin').value,
                tipo: document.getElementById('modalExpTipo').value
            };
        }
    });

    if (formValues) {
        const { start, end, min, tipo } = formValues;
        const token = localStorage.getItem('token');
        const endpoint = tipo === 'LOTES' ? '/api/fabricacion/exportar/lotes/excel' : '/api/fabricacion/exportar/insumos/excel';
        const url = `${endpoint}?start=${start}&end=${end}&min_cantidad=${min}`;

        Swal.fire({ title: 'Generando Reporte...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(async res => {
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(errText || 'Error del servidor.');
                }
                return res.blob();
            })
            .then(blob => {
                Swal.close();
                const fileUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = fileUrl;
                const nombreArchivo = tipo === 'LOTES' ? `Lotes_Fabricados_${new Date().toISOString().slice(0, 10)}.xlsx` : `Insumos_Descontados_${new Date().toISOString().slice(0, 10)}.xlsx`;
                a.download = nombreArchivo;
                document.body.appendChild(a);
                a.click();
                a.remove();
            })
            .catch(err => Swal.fire('Error', err.message, 'error'));
    }
}



async function aplicarFiltrosOrdenes() {
    const start = document.getElementById('filtroFechaInicio')?.value || '';
    const end = document.getElementById('filtroFechaFin')?.value || '';
    const minCant = document.getElementById('filtroMinCantidad')?.value || '';

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/fabricacion?start=${start}&end=${end}&min_cantidad=${minCant}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Error aplicando filtros");

        ordenesGlobales = await res.json();
        renderizarKanban();
    } catch (e) {
        Swal.fire('Error', e.message, 'error');
    }
}

function limpiarFiltrosOrdenes() {
    if (document.getElementById('filtroFechaInicio')) document.getElementById('filtroFechaInicio').value = '';
    if (document.getElementById('filtroFechaFin')) document.getElementById('filtroFechaFin').value = '';
    if (document.getElementById('filtroMinCantidad')) document.getElementById('filtroMinCantidad').value = '';
    cargarOrdenes();
}

function descargarExcelLotesFiltro() {
    const start = document.getElementById('filtroFechaInicio')?.value || '';
    const end = document.getElementById('filtroFechaFin')?.value || '';
    const minCant = document.getElementById('filtroMinCantidad')?.value || '';

    const token = localStorage.getItem('token');
    const url = `/api/fabricacion/exportar/lotes/excel?start=${start}&end=${end}&min_cantidad=${minCant}`;

    Swal.fire({
        title: 'Generando Excel de Lotes...',
        text: 'Por favor espere un momento.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(async res => {
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || `Error del servidor (${res.status})`);
            }
            return res.blob();
        })
        .then(blob => {
            Swal.close();
            const fileUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = fileUrl;
            a.download = `Reporte_Lotes_Fabricados_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        })
        .catch(err => Swal.fire('Error al exportar', err.message || 'No se pudo generar el archivo Excel.', 'error'));
}

// 3. DESCARGAR EXCEL DE INSUMOS
function descargarExcelInsumosFiltro() {
    const start = document.getElementById('filtroFechaInicio')?.value || '';
    const end = document.getElementById('filtroFechaFin')?.value || '';
    const minCant = document.getElementById('filtroMinCantidad')?.value || '';

    const token = localStorage.getItem('token');
    const url = `/api/fabricacion/exportar/insumos/excel?start=${start}&end=${end}&min_cantidad=${minCant}`;

    Swal.fire({
        title: 'Generando Auditoría de Insumos...',
        text: 'Por favor espere un momento.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(async res => {
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || `Error del servidor (${res.status})`);
            }
            return res.blob();
        })
        .then(blob => {
            Swal.close();
            const fileUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = fileUrl;
            a.download = `Auditoria_Insumos_Descontados_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        })
        .catch(err => Swal.fire('Error al exportar', err.message || 'No se pudo generar el Excel de insumos.', 'error'));
}

// 4. VER DETALLES COMPLETOS DE UN LOTE EN PANTALLA
function verDetalleLoteModal(id) {
    const orden = ordenesGlobales.find(o => o.id === id);
    if (!orden) return;

    const composicion = typeof orden.composicion_esencias === 'string' 
        ? JSON.parse(orden.composicion_esencias) 
        : (orden.composicion_esencias || []);

    const insumos = typeof orden.insumos_reservados === 'string' 
        ? JSON.parse(orden.insumos_reservados) 
        : (orden.insumos_reservados || []);

    let htmlFragancias = composicion.map(c => `
        <div class="flex justify-between items-center bg-white p-2 border border-neutral-200 text-xs">
            <span class="font-black uppercase">${c.nombre}</span>
            <span class="font-bold bg-neutral-100 px-2 py-0.5 border">${c.cantidad} uds</span>
        </div>
    `).join('');

    let htmlInsumos = insumos.map(i => `
        <div class="flex justify-between items-center bg-white p-2 border border-neutral-200 text-xs">
            <span class="font-bold text-neutral-700 uppercase">${i.nombre}</span>
            <span class="font-black text-emerald-700">${parseFloat(i.reservado).toFixed(0)} ${getUnidad(i.nombre)}</span>
        </div>
    `).join('');

    Swal.fire({
        title: `<span class="text-sm font-black uppercase">Detalle Lote: ${orden.codigo_orden}</span>`,
        html: `
            <div class="text-left space-y-3">
                <div class="bg-neutral-100 p-3 text-[10px] font-bold uppercase space-y-1">
                    <div>Fórmula: <span class="font-black text-neutral-900">${orden.formula_nombre}</span></div>
                    <div>Fecha: ${new Date(orden.fecha_creacion).toLocaleString()}</div>
                    <div>Costo Unitario: <span class="font-black text-neutral-900">$${parseFloat(orden.costo_unitario_real || 0).toFixed(2)}</span></div>
                </div>
                
                <div>
                    <h4 class="font-black text-[10px] uppercase text-neutral-500 mb-1">Fragancias del Lote (${orden.cantidad_planificada} uds)</h4>
                    <div class="space-y-1 max-h-36 overflow-y-auto">${htmlFragancias}</div>
                </div>

                ${htmlInsumos ? `
                <div>
                    <h4 class="font-black text-[10px] uppercase text-neutral-500 mb-1">Materia Prima Descontada</h4>
                    <div class="space-y-1 max-h-36 overflow-y-auto">${htmlInsumos}</div>
                </div>` : ''}
            </div>
        `,
        confirmButtonColor: '#0a0a0a',
        confirmButtonText: 'Cerrar'
    });
}

function cerrarModalNuevaOrden() {
    document.getElementById('modalNuevaOrden').classList.add('hidden');
}

function agregarEsenciaALista() {
    const inputBuscar = document.getElementById('inputBuscarEsencia');
    const inputCant = document.getElementById('cantEsenciaFila');
    const valIngresado = (inputBuscar.value || '').trim().toUpperCase();
    const cantidad = parseInt(inputCant.value, 10);
    const metaTotal = parseInt(document.getElementById('cantPlanificada').value, 10) || 0;
    const formulaId = document.getElementById('selectFormula').value;

    if (!formulaId) {
        return Swal.fire('Selecciona Medida', 'Debes seleccionar primero el formato (30ml, 60ml u 100ml).', 'warning');
    }
    if (!valIngresado) {
        return Swal.fire('Datos Incompletos', 'Escribe o selecciona una fragancia del buscador.', 'warning');
    }
    if (isNaN(cantidad) || cantidad <= 0) {
        return Swal.fire('Cantidad Inválida', 'Asigna la cantidad de frascos a fabricar.', 'warning');
    }
    if (metaTotal <= 0) {
        return Swal.fire('Falta Meta', 'Define primero la cantidad total de perfumes del lote.', 'warning');
    }

    const formulaSeleccionada = formulasFiltradasGlobal.find(f => f.id == formulaId);
    const volumenMl = formulaSeleccionada ? parseInt(formulaSeleccionada.volumen_total, 10) : 30;

    const esenciaEncontrada = window.catalogosEsenciasGlobal.find(e => {
        const fullTxt = `[${e.codigo}] ${e.nombre}`.toUpperCase();
        return fullTxt === valIngresado || 
               (e.codigo && e.codigo.toUpperCase() === valIngresado) || 
               (e.nombre && e.nombre.toUpperCase() === valIngresado);
    });

    if (!esenciaEncontrada) {
        return Swal.fire('Fragancia No Encontrada', 'El código o descripción no coincide con ninguna esencia.', 'error');
    }

    const id = esenciaEncontrada.id;
    const nombre = esenciaEncontrada.nombre;

    const asignadoActual = esenciasDelLoteEnMemoria.reduce((acc, item) => acc + item.cantidad, 0);
    if ((asignadoActual + cantidad) > metaTotal) {
        return Swal.fire('Límite Superado', `No puedes agregar ${cantidad} unidades. Espacio restante: ${metaTotal - asignadoActual}.`, 'error');
    }

    const existe = esenciasDelLoteEnMemoria.find(item => item.id === id && item.volumen === volumenMl);
    if (existe) {
        existe.cantidad += cantidad;
    } else {
        esenciasDelLoteEnMemoria.push({ id, nombre, cantidad, volumen: volumenMl });
    }

    inputBuscar.value = "";
    inputCant.value = "";
    inputBuscar.focus();
    
    renderListaEsenciasAgregadas();
}

function eliminarEsenciaDeLista(index) {
    esenciasDelLoteEnMemoria.splice(index, 1);
    renderListaEsenciasAgregadas();
}

// 🔥 AGRUPAMIENTO EN BLOQUES SEPARADOS POR MEDIDA (30ML, 60ML, 100ML)
function renderListaEsenciasAgregadas() {
    const tbody = document.getElementById('bodyEsenciasAgregadas');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (esenciasDelLoteEnMemoria.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-neutral-400 uppercase text-[9px] tracking-widest">Ninguna esencia añadida al lote compuesto</td></tr>';
        recalcularMatematicaLote();
        return;
    }

    // Agrupar por volumen
    const grupos = {};
    esenciasDelLoteEnMemoria.forEach((item, originalIndex) => {
        const vol = item.volumen || 30;
        if (!grupos[vol]) grupos[vol] = [];
        grupos[vol].push({ ...item, originalIndex });
    });

    // Dibujar bloques separados
    Object.keys(grupos).sort((a, b) => a - b).forEach(volumen => {
        const itemsGrupo = grupos[volumen];
        const subtotalUds = itemsGrupo.reduce((acc, i) => acc + i.cantidad, 0);

        tbody.innerHTML += `
            <tr class="bg-neutral-950 text-white font-black text-[10px] uppercase tracking-widest">
                <td colspan="3" class="p-2.5 pl-4 flex justify-between items-center">
                    <span><i class="fa-solid fa-bottle-droplet text-amber-400 mr-2"></i> BLOQUE PERFUMES ${volumen}ML</span>
                    <span class="bg-neutral-800 px-2 py-0.5 border border-neutral-700 text-amber-400">${subtotalUds} UDS</span>
                </td>
            </tr>
        `;

        itemsGrupo.forEach(item => {
            tbody.innerHTML += `
                <tr class="border-b border-neutral-200 bg-white hover:bg-neutral-50 transition-colors">
                    <td class="p-2.5 pl-6 uppercase font-black text-neutral-900 text-xs">${item.nombre}</td>
                    <td class="p-2.5 text-center font-black text-xs text-neutral-900">${item.cantidad} u.</td>
                    <td class="p-2.5 text-center">
                        <button type="button" onclick="eliminarEsenciaDeLista(${item.originalIndex})" class="text-neutral-400 hover:text-red-600 transition-colors font-bold">✕</button>
                    </td>
                </tr>
            `;
        });
    });

    recalcularMatematicaLote();
}

function recalcularMatematicaLote() {
    const metaTotal = parseInt(document.getElementById('cantPlanificada').value, 10) || 0;
    const asignado = esenciasDelLoteEnMemoria.reduce((acc, item) => acc + item.cantidad, 0);
    const restante = metaTotal - asignado;

    const elMeta = document.getElementById('txtMetaControl');
    const elAsig = document.getElementById('txtAsignadoControl');
    const elRest = document.getElementById('txtRestanteControl');

    if (elMeta) elMeta.innerText = metaTotal;
    if (elAsig) elAsig.innerText = asignado;
    if (elRest) elRest.innerText = restante >= 0 ? restante : 0;

    // 🔥 DIBUJAR DESGLOSE CORREGIDO (FILTRADO POR VOLUMEN EXACTO DE LA RECETA SELCCIONADA)
    const formulaId = document.getElementById('selectFormula')?.value;
    const formulaSel = formulasFiltradasGlobal.find(f => f.id == formulaId);
    const divInsumos = document.getElementById('divResumenInsumosPlan');

    if (divInsumos && formulaSel) {
        const volReceta = parseInt(formulaSel.volumen_total, 10);

        // 🎯 FILTRO CLAVE: Sumar únicamente la cantidad de ítems que correspondan a ESTA medida (ej. 60ml)
        const unidadesDeEstaMedida = esenciasDelLoteEnMemoria
            .filter(item => item.volumen === volReceta)
            .reduce((acc, item) => acc + item.cantidad, 0);

        // Si aún no se han agregado esencias de esta medida, calcula base sobre la meta si está alineada
        const cantParaCalculo = unidadesDeEstaMedida;

        const gEsencia = (parseFloat(formulaSel.gramos_esencia || 0) * cantParaCalculo).toFixed(0);
        const mlAlcohol = (parseFloat(formulaSel.ml_alcohol || 0) * cantParaCalculo).toFixed(0);
        const gFijador = (parseFloat(formulaSel.gramos_fijador || 0) * cantParaCalculo).toFixed(0);

        divInsumos.innerHTML = `
            <div class="grid grid-cols-4 gap-2 text-center text-[9px] font-black uppercase tracking-wider bg-neutral-100 p-2.5 border border-neutral-300">
                <div>Esencia: <span class="text-neutral-950">${gEsencia}g</span></div>
                <div>Alcohol: <span class="text-blue-700">${mlAlcohol}ml</span></div>
                <div>Fijador: <span class="text-purple-700">${gFijador}g</span></div>
                <div>Envases (${volReceta}ml): <span class="text-emerald-700">${cantParaCalculo}uds</span></div>
            </div>
        `;
    }
}

async function procesarNuevaOrden(e) {
    e.preventDefault();
    const metaTotal = parseInt(document.getElementById('cantPlanificada').value, 10) || 0;
    const asignado = esenciasDelLoteEnMemoria.reduce((acc, item) => acc + item.cantidad, 0);

    if (asignado !== metaTotal) {
        return Swal.fire('Orden Descuadrada', `La suma de la lista (${asignado} u.) debe ser exactamente igual a la meta total planificada (${metaTotal} u.). Te faltan asignar ${metaTotal - asignado} unidades.`, 'error');
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    const payload = {
        formula_id: document.getElementById('selectFormula').value,
        cantidad_planificada: metaTotal,
        notas_planificacion: document.getElementById('notasPlan').value,
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
        cerrarModalNuevaOrden();
        await cargarOrdenes();
    } catch (error) {
        Swal.fire('Atención Insumos', error.message, 'warning');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Bloquear y Fabricar';
    }
}

// =======================================================
// 🟡 FASE 2: TABLERO Y CARGA DE ÓRDENES
// =======================================================
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
    
    if (!listProcesando || !listCompletadas) return;

    listProcesando.innerHTML = '';
    listCompletadas.innerHTML = '';
    
    let countProcesando = 0;
    let countCompletadas = 0;

    ordenesGlobales.forEach(o => {
        const isProcesando = o.estado === 'PROCESANDO';
        
        if (isProcesando) countProcesando++;
        else countCompletadas++;

        const tarjeta = document.createElement('div');
        tarjeta.className = "bg-white p-4 border border-neutral-200 shadow-sm flex flex-col gap-3 rounded-none relative";
        
        const loteBadge = isProcesando 
            ? `<span class="bg-amber-100 text-amber-800 text-[9px] font-black px-2 py-0.5 border border-amber-300 uppercase tracking-widest">${o.codigo_orden}</span>`
            : `<span class="bg-neutral-100 text-neutral-600 text-[9px] font-black px-2 py-0.5 border border-neutral-300 uppercase tracking-widest">${o.lote_fabricacion || o.codigo_orden}</span>`;

        // 🔥 TARJETA CON BOTÓN "VER DETALLE" EN LOTES COMPLETADOS
        tarjeta.innerHTML = `
            <div class="flex justify-between items-start">
                ${loteBadge}
                <span class="text-[9px] font-bold text-neutral-400 uppercase">${new Date(o.fecha_creacion).toLocaleDateString()}</span>
            </div>
            
            <div>
                <p class="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Perfume Final</p>
                <p class="text-xs font-black text-neutral-950 uppercase leading-tight">${o.formula_nombre || 'Receta'}</p>
            </div>

            <div class="grid grid-cols-2 gap-2 border-t border-neutral-100 pt-2 mt-1">
                <div>
                    <p class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">Planificado</p>
                    <p class="text-sm font-black text-neutral-950">${o.cantidad_planificada} unds</p>
                </div>
                ${isProcesando ? `
                    <div class="text-right">
                        <p class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">Operador</p>
                        <p class="text-[10px] font-bold text-neutral-800 uppercase">${o.creador_nombre || 'Sistema'}</p>
                    </div>
                ` : `
                    <div>
                        <p class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">Rendimiento</p>
                        <p class="text-xs font-black text-green-700">${o.cantidad_completada} L | ${o.cantidad_merma} M</p>
                    </div>
                `}
            </div>
            
            ${isProcesando ? `
                <div class="flex gap-2 mt-2">
                    <button onclick="imprimirGuiaFabricacion(${o.id})" class="bg-white border border-neutral-300 hover:bg-neutral-100 text-neutral-950 p-2 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-1 shrink-0" title="Imprimir Guía de Laboratorio">
                        <i class="fa-solid fa-print"></i>
                    </button>
                    <button onclick="abrirModalCompletar(${o.id}, ${o.cantidad_planificada})" class="flex-1 bg-neutral-950 text-white py-2.5 text-[9px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-colors">
                        Reportar Cierre
                    </button>
                </div>
            ` : `
                <!-- 🔥 BOTÓN AGREGADO PARA VER DETALLE EN CADA LOTE COMPLETADO -->
                <div class="flex flex-col gap-2 mt-2 pt-2 border-t border-neutral-100">
                    <div class="bg-neutral-50 border border-neutral-200 p-1.5 text-center text-[9px] font-black text-neutral-600 uppercase tracking-widest">
                        Costo Unit: $${parseFloat(o.costo_unitario_real || 0).toFixed(2)}
                    </div>
                    <button onclick="verDetalleLoteCompletado(${o.id})" class="w-full bg-neutral-950 hover:bg-neutral-800 text-white py-2 text-[9px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
                        <i class="fa-solid fa-eye text-amber-400"></i> Ver Detalle
                    </button>
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

function verDetalleLoteCompletado(id) {
    const orden = ordenesGlobales.find(o => o.id === id);
    if (!orden) return Swal.fire('Error', 'No se encontró la información del lote.', 'error');

    // Parsear composición de esencias e insumos
    const composicion = typeof orden.composicion_esencias === 'string' 
        ? JSON.parse(orden.composicion_esencias) 
        : (orden.composicion_esencias || []);

    const insumos = typeof orden.insumos_reservados === 'string' 
        ? JSON.parse(orden.insumos_reservados) 
        : (orden.insumos_reservados || []);

    // 1. Armar filas de esencias procesadas
    let htmlEsencias = composicion.map(c => {
        const fueCambio = c.fue_suplementada ? `<span class="bg-amber-100 text-amber-800 border border-amber-300 text-[8px] font-black px-1.5 py-0.5 rounded ml-1">REEMPLAZADA</span>` : '';
        const nomActual = c.nombre_actual || c.nombre;
        const cantOk = c.ok !== undefined ? c.ok : c.cantidad;
        const cantMerma = c.merma || 0;

        return `
            <div class="flex justify-between items-center bg-white p-2.5 border border-neutral-200 text-xs">
                <div>
                    <div class="font-black uppercase text-neutral-900">${nomActual} ${fueCambio}</div>
                    ${c.nombre_original && c.fue_suplementada ? `<div class="text-[9px] text-neutral-400">Original: ${c.nombre_original}</div>` : ''}
                </div>
                <div class="text-right font-bold text-[10px]">
                    <span class="text-emerald-700 bg-emerald-50 px-2 py-0.5 border border-emerald-200">${cantOk} u. OK</span>
                    ${cantMerma > 0 ? `<span class="text-red-700 bg-red-50 px-2 py-0.5 border border-red-200 ml-1">${cantMerma} M</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    // 2. Armar filas de insumos generales consumidos
    let htmlInsumos = insumos.map(i => {
        const nom = i.nombre.toUpperCase();
        let unidad = 'g';
        if (nom.includes('ALCOHOL')) unidad = 'ml';
        else if (nom.includes('FRASCO') || nom.includes('ENVASE')) unidad = 'uds';

        return `
            <div class="flex justify-between items-center bg-white p-2 border border-neutral-200 text-xs">
                <span class="font-bold text-neutral-700 uppercase">${i.nombre}</span>
                <span class="font-black text-neutral-900">${parseFloat(i.reservado || 0).toFixed(0)} ${unidad}</span>
            </div>
        `;
    }).join('');

    // 3. Mostrar modal modal con toda la auditoría del lote
    Swal.fire({
        title: `<span class="text-sm font-black uppercase tracking-widest text-neutral-900">Detalle de Cierre: ${orden.lote_fabricacion || orden.codigo_orden}</span>`,
        html: `
            <div class="text-left space-y-4 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
                <!-- Ficha Técnica -->
                <div class="bg-neutral-100 p-3 border border-neutral-300 text-[10px] font-bold uppercase space-y-1">
                    <div class="flex justify-between"><span>Receta Base:</span> <strong class="text-neutral-950">${orden.formula_nombre || 'N/A'}</strong></div>
                    <div class="flex justify-between"><span>Fecha Cierre:</span> <strong>${orden.fecha_cierre ? new Date(orden.fecha_cierre).toLocaleString('es-VE') : new Date(orden.fecha_creacion).toLocaleDateString()}</strong></div>
                    <div class="flex justify-between"><span>Unidades Listas:</span> <strong class="text-emerald-700">${orden.cantidad_completada || orden.cantidad_planificada} unds</strong></div>
                    <div class="flex justify-between"><span>Costo Unitario Real:</span> <strong class="text-neutral-950">$${parseFloat(orden.costo_unitario_real || 0).toFixed(2)}</strong></div>
                </div>
                
                <!-- Desglose de Fragancias -->
                <div>
                    <h4 class="font-black text-[10px] uppercase text-neutral-500 tracking-widest mb-1.5 flex items-center justify-between">
                        <span>Fragancias Producidas</span>
                        <span class="text-neutral-900">${orden.cantidad_planificada} uds total</span>
                    </h4>
                    <div class="space-y-1">${htmlEsencias}</div>
                </div>

                <!-- Materia Prima Descontada -->
                ${htmlInsumos ? `
                <div>
                    <h4 class="font-black text-[10px] uppercase text-neutral-500 tracking-widest mb-1.5">Vehículos e Insumos Descontados</h4>
                    <div class="space-y-1">${htmlInsumos}</div>
                </div>` : ''}

                <!-- Observaciones de Laboratorio -->
                ${orden.notas_cierre || orden.notas_planificacion ? `
                <div>
                    <h4 class="font-black text-[10px] uppercase text-neutral-500 tracking-widest mb-1">Observaciones / Auditoría</h4>
                    <div class="p-3 bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-950 whitespace-pre-line">${orden.notas_cierre || orden.notas_planificacion}</div>
                </div>` : ''}
            </div>
        `,
        confirmButtonColor: '#0a0a0a',
        confirmButtonText: 'Cerrar Ventana',
        width: '32em'
    });
}


// =======================================================
// 🔴 FASE 3: CIERRE AUDITADO POR FRAGANCIA
// =======================================================
function abrirModalCompletar(id, planificada) {
    const orden = ordenesGlobales.find(o => o.id === id);
    if (!orden) return Swal.fire('Error', 'Orden no encontrada.', 'error');

    cantidadPlanificadaGlobal = planificada;
    document.getElementById('ordenIdCierre').value = id;
    document.getElementById('lblOrdenCodigoCierre').innerText = `Lote: ${orden.codigo_orden} | Receta: ${orden.formula_nombre}`;
    document.getElementById('lblPlanificado').innerText = planificada;
    document.getElementById('notasCierre').value = '';
    document.getElementById('checkMarcarTodosCierre').checked = false;

    const composicion = typeof orden.composicion_esencias === 'string' 
        ? JSON.parse(orden.composicion_esencias) 
        : (orden.composicion_esencias || []);

    // Cargar arreglo en memoria guardando tanto la esencia original como la sustituta (si aplica)
    esenciasCierreMemoria = composicion.map(item => ({
        id_original: item.id,
        nombre_original: item.nombre,
        id_actual: item.id,
        nombre_actual: item.nombre,
        volumen: item.volumen || 30,
        meta: item.cantidad,
        ok: item.cantidad,
        merma: 0,
        verificado: true,
        fue_suplementada: false
    }));

    paginaActualCierre = 1;
    recalcularTotalesCierre();
    renderizarTablaCierrePaginada();

    document.getElementById('modalCompletarOrden').classList.remove('hidden');
}

function cerrarModalCompletar() {
    document.getElementById('modalCompletarOrden').classList.add('hidden');
}

function renderizarTablaCierrePaginada() {
    const tbody = document.getElementById('bodyCierreEsencias');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    const inicio = (paginaActualCierre - 1) * ITEMS_POR_PAGINA_CIERRE;
    const fin = inicio + ITEMS_POR_PAGINA_CIERRE;
    const paginaItems = esenciasCierreMemoria.slice(inicio, fin);
    const totalPaginas = Math.ceil(esenciasCierreMemoria.length / ITEMS_POR_PAGINA_CIERRE) || 1;

    document.getElementById('txtPaginaActualCierre').innerText = `Página ${paginaActualCierre} de ${totalPaginas}`;
    document.getElementById('btnPagAntCierre').disabled = paginaActualCierre === 1;
    document.getElementById('btnPagSigCierre').disabled = paginaActualCierre >= totalPaginas;

    // Lista desplegable para cambio/suplementación con el catálogo de esencias
    const esenciasDisponibles = window.catalogosEsenciasGlobal || [];

    paginaItems.forEach((item, indexRel) => {
        const indexReal = inicio + indexRel;
        
        const badgeCambio = item.fue_suplementada 
            ? `<span class="bg-amber-100 text-amber-800 border border-amber-300 text-[8px] font-black px-1.5 py-0.5 rounded ml-1">REEMPLAZADA</span>` 
            : '';

        tbody.innerHTML += `
            <tr class="border-b border-neutral-200 bg-white hover:bg-neutral-50 transition-colors">
                <td class="p-3 text-center">
                    <input type="checkbox" ${item.verificado ? 'checked' : ''} onchange="toggleCheckEsenciaCierre(${indexReal}, this.checked)" class="w-4 h-4 accent-neutral-950 cursor-pointer">
                </td>
                <td class="p-3">
                    <div class="font-black uppercase text-neutral-900 text-xs flex items-center">
                        ${item.nombre_actual} 
                        <span class="bg-neutral-100 text-neutral-600 px-1.5 py-0.5 text-[9px] font-bold ml-1 border border-neutral-300">${item.volumen}ML</span>
                        ${badgeCambio}
                    </div>
                    
                    <!-- Botón para alternar la casilla de Cambio / Suplementación -->
                    <div class="mt-1">
                        <button type="button" onclick="window.cambiarEsenciaCierreModal(${indexReal})" class="text-[9px] font-bold text-amber-700 hover:text-amber-950 underline flex items-center gap-1">
                            <i class="fa-solid fa-arrows-rotate"></i> Sustituir Fragancia
                        </button>
                    </div>
                </td>
                <td class="p-3 text-center font-black text-xs text-neutral-500">${item.meta} u.</td>
                <td class="p-3 text-center">
                    <input type="number" value="${item.ok}" min="0" max="${item.meta}" onchange="actualizarCantidadOkCierre(${indexReal}, this.value)" class="w-20 bg-emerald-50 border border-emerald-300 p-1.5 text-center font-black text-xs text-emerald-800 outline-none focus:bg-white focus:border-emerald-600">
                </td>
                <td class="p-3 text-center">
                    <input type="number" value="${item.merma}" min="0" max="${item.meta}" onchange="actualizarCantidadMermaCierre(${indexReal}, this.value)" class="w-20 bg-red-50 border border-red-300 p-1.5 text-center font-black text-xs text-red-800 outline-none focus:bg-white focus:border-red-600">
                </td>
            </tr>
        `;
    });
}

// 🔥 BUSCADOR EN TIEMPO REAL CON DESPLEGABLE FLOTANTE PARA SUSTITUIR ESENCIAS
window.cambiarEsenciaCierreModal = async function(indexReal) {
    const item = esenciasCierreMemoria[indexReal];
    if (!item) return;

    // 1. Garantizar que el catálogo esté cargado en memoria
    if (!window.catalogosEsenciasGlobal || window.catalogosEsenciasGlobal.length === 0) {
        try {
            Swal.fire({
                title: 'Cargando catálogo de esencias...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            const resProd = await ProductoService.getAll(1, 1000, "", false);
            window.catalogosEsenciasGlobal = (resProd.data || []).filter(p => 
                p.categoria && p.categoria.toUpperCase().includes('ESENCIA')
            );
            Swal.close();
        } catch (err) {
            console.error("Error al cargar catálogo de esencias:", err);
            return Swal.fire('Error', 'No se pudo obtener la lista de esencias disponibles.', 'error');
        }
    }

    const esencias = window.catalogosEsenciasGlobal || [];

    if (esencias.length === 0) {
        return Swal.fire('Sin Esencias', 'No hay fragancias registradas en esta sucursal.', 'warning');
    }

    // 2. Abrir el modal con Input y Contenedor de Resultados Flotante
    let idSustitutaSeleccionada = null;

    const { isConfirmed } = await Swal.fire({
        title: 'Suplementar / Sustituir Esencia',
        html: `
            <div class="text-left space-y-3 relative">
                <p class="text-xs text-neutral-500 font-bold uppercase tracking-wider">
                    Fragancia Original: <strong class="text-neutral-950">${item.nombre_original || item.nombre}</strong>
                </p>
                <div>
                    <label class="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">
                        Buscar Esencia Sustituta (Código o Nombre):
                    </label>
                    <div class="relative">
                        <i class="fa-solid fa-magnifying-glass absolute left-3 top-3.5 text-neutral-400 text-xs"></i>
                        <input type="text" 
                               id="inputBuscadorSustituta" 
                               class="w-full bg-neutral-50 border border-neutral-300 pl-9 pr-3 py-3 text-xs font-bold uppercase outline-none focus:bg-white focus:border-neutral-950 text-neutral-950 rounded-none placeholder-neutral-400" 
                               placeholder="EJ: E010 O SAUVAGE..." 
                               autocomplete="off">
                    </div>
                    
                    <!-- CAJA DE RESULTADOS FLOTANTE INTERACTIVA -->
                    <div id="dropdownSustitutasModal" class="absolute z-50 w-full left-0 mt-1 bg-white border border-neutral-300 shadow-2xl max-h-48 overflow-y-auto hidden custom-scrollbar">
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Aplicar Cambio',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0a0a0a',
        focusConfirm: false,
        didOpen: () => {
            const input = document.getElementById('inputBuscadorSustituta');
            const dropdown = document.getElementById('dropdownSustitutasModal');

            if (!input) return;
            input.focus();

            // EVENTO DE BÚSQUEDA EN TIEMPO REAL
            input.addEventListener('input', (e) => {
                const query = e.target.value.trim().toUpperCase();
                idSustitutaSeleccionada = null; // Reiniciar selección si sigue escribiendo

                if (query.length === 0) {
                    dropdown.classList.add('hidden');
                    return;
                }

                const filtrados = esencias.filter(p => {
                    const cod = (p.codigo || '').toUpperCase();
                    const nom = (p.nombre || '').toUpperCase();
                    return cod.includes(query) || nom.includes(query);
                });

                if (filtrados.length === 0) {
                    dropdown.innerHTML = '<div class="p-3 text-[10px] text-neutral-400 font-bold uppercase text-center">No hay coincidencias</div>';
                } else {
                    dropdown.innerHTML = filtrados.map(p => {
                        const codTxt = p.codigo ? `[${p.codigo}] ` : '';
                        const stockDispo = parseFloat(p.stock_real || p.stock_unidades || 0).toFixed(0);

                        return `
                            <div onclick="window.seleccionarEsenciaModalSustituta(${p.id}, '${p.codigo || ''}', '${p.nombre.replace(/'/g, "\\'")}')" 
                                 class="p-2.5 border-b border-neutral-100 hover:bg-neutral-100 cursor-pointer flex justify-between items-center transition-colors">
                                <span class="text-xs font-black text-neutral-950 uppercase tracking-wider">${codTxt}${p.nombre}</span>
                                <span class="text-[9px] font-bold text-neutral-500 bg-neutral-100 border px-1.5 py-0.5">${stockDispo}g</span>
                            </div>
                        `;
                    }).join('');
                }

                dropdown.classList.remove('hidden');
            });

            // Registrar función global temporal para capturar el clic en la lista flotante
            window.seleccionarEsenciaModalSustituta = (id, codigo, nombre) => {
                idSustitutaSeleccionada = id;
                const codTxt = codigo ? `[${codigo}] ` : '';
                input.value = `${codTxt}${nombre}`.toUpperCase();
                dropdown.classList.add('hidden');
            };
        },
        preConfirm: () => {
            if (!idSustitutaSeleccionada) {
                Swal.showValidationMessage('Debes seleccionar una esencia de la lista desplegable.');
                return false;
            }
            return idSustitutaSeleccionada;
        }
    });

    // 3. Aplicar el cambio si fue confirmado
    if (isConfirmed && idSustitutaSeleccionada) {
        const esenciaSustituta = esencias.find(e => e.id == idSustitutaSeleccionada);
        if (esenciaSustituta) {
            item.id_actual = esenciaSustituta.id;
            item.nombre_actual = esenciaSustituta.nombre;
            item.fue_suplementada = (item.id_actual != (item.id_original || item.id));

            // Actualizar la justificación en las Observaciones Generales de Laboratorio
            actualizarNotasSuplementacionAutomaticas();
            // Redibujar la tabla paginada de cierre
            renderizarTablaCierrePaginada();

            const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1500 });
            Toast.fire({ icon: 'success', title: 'Fragancia sustituida correctamente' });
        }
    }

    // Limpieza de función temporal
    delete window.seleccionarEsenciaModalSustituta;
};

// 🔥 GENERADOR AUTOMÁTICO DE NOTAS DE AUDITORÍA
function actualizarNotasSuplementacionAutomaticas() {
    const txtNotas = document.getElementById('notasCierre');
    if (!txtNotas) return;

    let justificaciones = [];

    esenciasCierreMemoria.forEach(item => {
        if (item.fue_suplementada) {
            justificaciones.push(`• SUPLEMENTACIÓN: Se reemplazó "${item.nombre_original}" por "${item.nombre_actual}" (${item.meta} uds).`);
        }
    });

    let notaExistente = txtNotas.value.trim();
    // Limpiamos notas automáticas previas para no duplicar texto
    let notaLimpia = notaExistente.split('\n--- REGISTRO AUTOMÁTICO DE CAMBIOS ---')[0].trim();

    if (justificaciones.length > 0) {
        const bloqueAuto = `\n\n--- REGISTRO AUTOMÁTICO DE CAMBIOS ---\n` + justificaciones.join('\n');
        txtNotas.value = notaLimpia ? (notaLimpia + bloqueAuto) : justificaciones.join('\n');
    } else {
        txtNotas.value = notaLimpia;
    }
}




function cambiarPaginaCierre(dir) {
    const totalPaginas = Math.ceil(esenciasCierreMemoria.length / ITEMS_POR_PAGINA_CIERRE) || 1;
    paginaActualCierre += dir;
    if (paginaActualCierre < 1) paginaActualCierre = 1;
    if (paginaActualCierre > totalPaginas) paginaActualCierre = totalPaginas;
    renderizarTablaCierrePaginada();
}

function toggleMarcarTodasEsencias(checked) {
    esenciasCierreMemoria.forEach(item => {
        item.verificado = checked;
        if (checked) {
            item.ok = item.meta;
            item.merma = 0;
        } else {
            item.ok = 0;
            item.merma = item.meta;
        }
    });
    recalcularTotalesCierre();
    renderizarTablaCierrePaginada();
}

function toggleCheckEsenciaCierre(indexReal, checked) {
    const item = esenciasCierreMemoria[indexReal];
    item.verificado = checked;
    if (checked) {
        item.ok = item.meta;
        item.merma = 0;
    } else {
        item.ok = 0;
        item.merma = item.meta;
    }
    recalcularTotalesCierre();
    renderizarTablaCierrePaginada();
}

function actualizarCantidadOkCierre(indexReal, valor) {
    const item = esenciasCierreMemoria[indexReal];
    let ok = parseInt(valor, 10);
    if (isNaN(ok) || ok < 0) ok = 0;
    if (ok > item.meta) ok = item.meta;

    item.ok = ok;
    item.merma = item.meta - ok;
    item.verificado = (ok === item.meta);

    recalcularTotalesCierre();
    renderizarTablaCierrePaginada();
}

function actualizarCantidadMermaCierre(indexReal, valor) {
    const item = esenciasCierreMemoria[indexReal];
    let merma = parseInt(valor, 10);
    if (isNaN(merma) || merma < 0) merma = 0;
    if (merma > item.meta) merma = item.meta;

    item.merma = merma;
    item.ok = item.meta - merma;
    item.verificado = (item.ok === item.meta);

    recalcularTotalesCierre();
    renderizarTablaCierrePaginada();
}

function recalcularTotalesCierre() {
    const totalOk = esenciasCierreMemoria.reduce((acc, item) => acc + item.ok, 0);
    const totalMerma = esenciasCierreMemoria.reduce((acc, item) => acc + item.merma, 0);

    const elOk = document.getElementById('lblTotalAuditadoOk');
    const elMerma = document.getElementById('lblTotalMerma');
    const divMerma = document.getElementById('divAccionMerma');

    if (elOk) elOk.innerText = totalOk;
    if (elMerma) elMerma.innerText = totalMerma;

    if (divMerma) {
        if (totalMerma > 0) divMerma.classList.remove('hidden');
        else divMerma.classList.add('hidden');
    }
}

async function enviarCierreOrden(e) {
    e.preventDefault();
    const id = document.getElementById('ordenIdCierre').value;
    
    const totalOk = esenciasCierreMemoria.reduce((acc, item) => acc + item.ok, 0);
    const totalMerma = esenciasCierreMemoria.reduce((acc, item) => acc + item.merma, 0);

    if ((totalOk + totalMerma) !== cantidadPlanificadaGlobal) {
        return Swal.fire('Error Matemático', `La suma total de unidades listas (${totalOk}) y mermas (${totalMerma}) debe ser exactamente igual a lo planificado (${cantidadPlanificadaGlobal}).`, 'warning');
    }

    const payload = {
        cantidad_completada: totalOk,
        cantidad_merma: totalMerma,
        accion_merma: document.getElementById('accionMerma').value,
        notas_cierre: document.getElementById('notasCierre').value,
        desglose_cierre: esenciasCierreMemoria
    };

    try {
        Swal.fire({ title: 'Costeando y Consolidando Lote...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/fabricacion/orden/${id}/completar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        Swal.fire({ icon: 'success', title: 'Lote Terminado y Auditado', text: data.mensaje, confirmButtonColor: '#0a0a0a' });
        cerrarModalCompletar();
        await cargarOrdenes();
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
}

function imprimirGuiaFabricacion(ordenId) {
    const orden = ordenesGlobales.find(o => o.id === ordenId);
    if (!orden) return Swal.fire('Error', 'Orden no encontrada.', 'error');

    const composicion = typeof orden.composicion_esencias === 'string' ? JSON.parse(orden.composicion_esencias) : (orden.composicion_esencias || []);
    const fechaActual = new Date().toISOString().slice(0, 10);
    const tituloDocumento = `GUIA_LAB_${orden.codigo_orden}_${fechaActual}`;

    const ventanaImpresion = window.open('', '_blank', 'width=800,height=900');

    // AGRUPAR POR MEDIDA
    const grupos = {};
    composicion.forEach(item => {
        const vol = item.volumen || 30;
        if (!grupos[vol]) grupos[vol] = [];
        grupos[vol].push(item);
    });

    let htmlBloquesImpresion = '';
    
    Object.keys(grupos).sort((a, b) => a - b).forEach(volumen => {
        const itemsGrupo = grupos[volumen];
        const subtotal = itemsGrupo.reduce((acc, i) => acc + i.cantidad, 0);

        const filasEsenciasHTML = itemsGrupo.map((item, index) => `
            <tr style="border-bottom: 1px solid #e5e5e5;">
                <td style="padding: 6px; text-align: center; font-weight: bold; width: 30px;">${index + 1}</td>
                <td style="padding: 6px; font-weight: bold; text-transform: uppercase;">${item.nombre}</td>
                <td style="padding: 6px; text-align: center; font-weight: 900; font-size: 13px;">${item.cantidad} unds</td>
                <td style="padding: 6px; text-align: center; border-left: 1px dashed #ccc; width: 60px;">[ &nbsp; ]</td>
            </tr>
        `).join('');

        htmlBloquesImpresion += `
            <div style="background: #000; color: #fff; padding: 6px 10px; font-weight: 900; font-size: 12px; margin-top: 15px; display: flex; justify-content: space-between;">
                <span>BLOQUE PERFUMES DE ${volumen}ML</span>
                <span>SUBTOTAL: ${subtotal} BOTELLAS</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
                <thead>
                    <tr style="background: #f0f0f0; color: #000;">
                        <th style="width: 30px; text-align: center;">#</th>
                        <th style="text-align: left;">FRAGANCIA / ESENCIA</th>
                        <th style="text-align: center;">DOSIS (UNIDADES)</th>
                        <th style="text-align: center;">CHECK</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasEsenciasHTML}
                </tbody>
            </table>
        `;
    });

    const htmlContenido = `
        <!DOCTYPE html>
        <html>
        <head>
            <!-- 🔥 TÍTULO DINÁMICO QUE ASIGNA EL NOMBRE AL GUARDAR EN PDF -->
            <title>${tituloDocumento}</title>
            <style>
                body { font-family: 'Courier New', Courier, monospace, sans-serif; margin: 20px; color: #000; font-size: 12px; }
                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                .header h1 { margin: 0; font-size: 18px; text-transform: uppercase; font-weight: 900; }
                .header p { margin: 2px 0; font-size: 10px; font-weight: bold; }
                .box-info { border: 1px solid #000; padding: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; }
                .box-info div { font-size: 11px; font-weight: bold; }
                th { text-transform: uppercase; font-size: 10px; padding: 6px; }
                .section-title { font-weight: 900; text-transform: uppercase; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 4px; margin-top: 15px; margin-bottom: 8px; }
                .notes { border: 1px solid #000; padding: 8px; font-style: italic; min-height: 40px; margin-bottom: 20px; font-size: 10px; }
                .signatures { display: flex; justify-content: space-between; margin-top: 40px; text-align: center; }
                .sig-box { width: 45%; border-top: 1px solid #000; padding-top: 2px; font-weight: bold; font-size: 10px; }
                @media print {
                    @page { margin: 10mm; }
                    body { margin: 0; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>HOJA DE RUTA / GUÍA DE LABORATORIO</h1>
                <p>ORDEN DE PRODUCCIÓN N°: <strong>${orden.codigo_orden}</strong></p>
                <p>FECHA EMISIÓN: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString('es-VE')}</p>
            </div>

            <div class="box-info">
                <div>RECETA BASE: <strong>${orden.formula_nombre.toUpperCase()}</strong></div>
                <div>META TOTAL: <strong>${orden.cantidad_planificada} BOTELLAS</strong></div>
                <div>OPERADOR: <strong>${orden.creador_nombre.toUpperCase()}</strong></div>
            </div>

            <div class="section-title">DETALLE DE FRAGANCIAS POR MEDIDA (SURTIDO)</div>
            ${htmlBloquesImpresion}

            ${orden.notas_planificacion ? `
                <div class="section-title">OBSERVACIONES Y NOTAS:</div>
                <div class="notes">${orden.notas_planificacion}</div>
            ` : ''}

            <div class="signatures">
                <div class="sig-box">PREPARADO POR (LABORATORIO)</div>
                <div class="sig-box">SUPERVISADO / CONTROL CALIDAD</div>
            </div>

            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                };
            </script>
        </body>
        </html>
    `;

    ventanaImpresion.document.write(htmlContenido);
    ventanaImpresion.document.close();
}

// =======================================================
// 📖 HISTORIAL Y AUXILIARES
// =======================================================
function abrirModalHistorialInsumos() {
    const tbody = document.getElementById('bodyHistorialInsumos');
    if (!tbody) return;

    tbody.innerHTML = '';
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
}

function cerrarModalHistorialInsumos() { 
    document.getElementById('modalHistorialInsumos').classList.add('hidden'); 
}

function toggleDetalle(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
}

function getUnidad(n) { 
    const nombre = n.toUpperCase();
    if (nombre.includes('ALCOHOL')) return 'ml';
    if (nombre.includes('FRASCO') || nombre.includes('ENVASE')) return 'unds';
    return 'g';
}