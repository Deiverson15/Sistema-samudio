import { ProductoService, FormulaService } from '../../js/api.js';

let ordenesGlobales = [];
let cantidadPlanificadaGlobal = 0;
let esenciasDelLoteEnMemoria = [];
let esenciasCierreMemoria = []; 
let paginaActualCierre = 1;
const ITEMS_POR_PAGINA_CIERRE = 5;

export async function init() {
    console.log("Módulo de Fabricación Inicializado.");

    const inputMeta = document.getElementById('cantPlanificada');
    if (inputMeta) {
        inputMeta.addEventListener('input', recalcularMatematicaLote);
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

    await cargarOrdenes();
}

// =======================================================
// 🟢 FASE 1: CREAR NUEVA ORDEN CON BUSCADOR
// =======================================================
async function abrirModalNuevaOrden() {
    try {
        esenciasDelLoteEnMemoria = [];
        renderListaEsenciasAgregadas();

        const resForm = await FormulaService.getAll();
        const resProd = await ProductoService.getAll(1, 500, "", false);
        
        window.catalogosEsenciasGlobal = resProd.data.filter(p => p.categoria && p.categoria.toUpperCase().includes('ESENCIA'));

        const selF = document.getElementById('selectFormula');
        const datalistE = document.getElementById('listaEsenciasDatalist');
        
        if (selF) {
            selF.innerHTML = '<option value="" disabled selected>-- SELECCIONAR RECETA --</option>' + 
                resForm.map(f => `<option value="${f.id}">${f.nombre} (${f.volumen_total}ml)</option>`).join('');
        }
        
        if (datalistE) {
            datalistE.innerHTML = window.catalogosEsenciasGlobal.map(e => {
                const codFmt = e.codigo ? `[${e.codigo}] ` : '';
                return `<option value="${codFmt}${e.nombre.toUpperCase()}">Stock Disponible: ${parseFloat(e.stock_real).toFixed(0)}g</option>`;
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

function cerrarModalNuevaOrden() {
    document.getElementById('modalNuevaOrden').classList.add('hidden');
}

function agregarEsenciaALista() {
    const inputBuscar = document.getElementById('inputBuscarEsencia');
    const inputCant = document.getElementById('cantEsenciaFila');
    const valIngresado = (inputBuscar.value || '').trim().toUpperCase();
    const cantidad = parseInt(inputCant.value, 10);
    const metaTotal = parseInt(document.getElementById('cantPlanificada').value, 10) || 0;

    if (!valIngresado) {
        return Swal.fire('Datos Incompletos', 'Escribe o selecciona una fragancia del buscador.', 'warning');
    }
    if (isNaN(cantidad) || cantidad <= 0) {
        return Swal.fire('Cantidad Inválida', 'Asigna la cantidad de frascos a fabricar.', 'warning');
    }
    if (metaTotal <= 0) {
        return Swal.fire('Falta Meta', 'Define primero la cantidad total de perfumes del lote.', 'warning');
    }

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

    const existe = esenciasDelLoteEnMemoria.find(item => item.id === id);
    if (existe) {
        existe.cantidad += cantidad;
    } else {
        esenciasDelLoteEnMemoria.push({ id, nombre, cantidad });
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

    const elMeta = document.getElementById('txtMetaControl');
    const elAsig = document.getElementById('txtAsignadoControl');
    const elRest = document.getElementById('txtRestanteControl');

    if (elMeta) elMeta.innerText = metaTotal;
    if (elAsig) elAsig.innerText = asignado;
    if (elRest) elRest.innerText = restante >= 0 ? restante : 0;
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
                <div class="flex gap-2 mt-2">
                    <button onclick="imprimirGuiaFabricacion(${o.id})" class="bg-white border border-neutral-300 hover:bg-neutral-100 text-neutral-950 p-2 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-1 shrink-0" title="Imprimir Guía de Laboratorio">
                        <i class="fa-solid fa-print"></i>
                    </button>
                    <button onclick="abrirModalCompletar(${o.id}, ${o.cantidad_planificada})" class="flex-1 bg-neutral-950 text-white py-2.5 text-[9px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-colors">
                        Reportar Cierre
                    </button>
                </div>
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

    esenciasCierreMemoria = composicion.map(item => ({
        id: item.id,
        nombre: item.nombre,
        meta: item.cantidad,
        ok: item.cantidad,
        merma: 0,
        verificado: true
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

    paginaItems.forEach((item, indexRel) => {
        const indexReal = inicio + indexRel;
        
        tbody.innerHTML += `
            <tr class="border-b border-neutral-200 bg-white hover:bg-neutral-50 transition-colors">
                <td class="p-3 text-center">
                    <input type="checkbox" ${item.verificado ? 'checked' : ''} onchange="toggleCheckEsenciaCierre(${indexReal}, this.checked)" class="w-4 h-4 accent-neutral-950 cursor-pointer">
                </td>
                <td class="p-3 font-black uppercase text-neutral-900 text-xs">${item.nombre}</td>
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

// =======================================================
// 🖨️ IMPRESIÓN DE HOJA DE RUTA / GUÍA DE LABORATORIO
// =======================================================
function imprimirGuiaFabricacion(ordenId) {
    const orden = ordenesGlobales.find(o => o.id === ordenId);
    if (!orden) return Swal.fire('Error', 'Orden no encontrada en memoria.', 'error');

    // Parsear únicamente la composición de fragancias
    const composicion = typeof orden.composicion_esencias === 'string' ? JSON.parse(orden.composicion_esencias) : (orden.composicion_esencias || []);

    const ventanaImpresion = window.open('', '_blank', 'width=800,height=900');

    // Generar únicamente las filas de la tabla de fragancias
    const filasEsenciasHTML = composicion.map((item, index) => `
        <tr style="border-bottom: 1px solid #e5e5e5;">
            <td style="padding: 8px; text-align: center; font-weight: bold; width: 30px;">${index + 1}</td>
            <td style="padding: 8px; font-weight: bold; text-transform: uppercase;">${item.nombre}</td>
            <td style="padding: 8px; text-align: center; font-weight: 900; font-size: 14px;">${item.cantidad} unds</td>
            <td style="padding: 8px; text-align: center; border-left: 1px dashed #ccc; width: 60px;">[ &nbsp; ]</td>
        </tr>
    `).join('');

    // Maquetación CSS/HTML sin la sección de insumos
    const htmlContenido = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>GUIA_LAB_${orden.codigo_orden}</title>
            <style>
                body { font-family: 'Courier New', Courier, monospace, sans-serif; margin: 20px; color: #000; font-size: 12px; }
                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                .header h1 { margin: 0; font-size: 18px; text-transform: uppercase; font-weight: 900; }
                .header p { margin: 2px 0; font-size: 10px; font-weight: bold; }
                .box-info { border: 1px solid #000; padding: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; }
                .box-info div { font-size: 11px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                th { background: #000; color: #fff; text-transform: uppercase; font-size: 10px; padding: 6px; text-align: left; }
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
                <p>FECHA EMISIÓN: ${new Date(orden.fecha_creacion).toLocaleString()}</p>
            </div>

            <div class="box-info">
                <div>FÓRMULA: <strong>${orden.formula_nombre.toUpperCase()}</strong></div>
                <div>META TOTAL: <strong>${orden.cantidad_planificada} BOTELLAS</strong></div>
                <div>OPERADOR: <strong>${orden.creador_nombre.toUpperCase()}</strong></div>
            </div>

            <div class="section-title">FRAGANCIAS A DOSIFICAR (LOTE SURTIDO)</div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 30px; text-align: center;">#</th>
                        <th>ESENCIA / FRAGANCIA</th>
                        <th style="text-align: center;">DOSIS (UNIDADES)</th>
                        <th style="text-align: center;">CHECK</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasEsenciasHTML}
                </tbody>
            </table>

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