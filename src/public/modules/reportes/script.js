import { formatMoney } from '../../js/api.js';

let datosCierreTemporal = null; // Variable para almacenar los datos antes de guardar

export function init() {
    console.log("Módulo Reportes Iniciado");
    window.ejecutarCalculo = ejecutarCalculo;
    window.confirmarYGuardar = confirmarYGuardar;
    window.descargarExcel = descargarExcel;
    window.descargarCierreHistorico = descargarCierreHistorico;

    window.abrirModalFacturas = abrirModalFacturas;
    window.toggleFacturaSeleccionada = toggleFacturaSeleccionada;
    window.toggleTodasFacturas = toggleTodasFacturas;
    window.enviarCierreSeleccionado = enviarCierreSeleccionado;
    window.cerrarModalFacturas = cerrarModalFacturas;

    window.ejecutarCalculoSemanal = ejecutarCalculoSemanal;
    window.descargarExcelSemanal = descargarExcelSemanal;
    window.descargarCierreDeHoyExcel = descargarCierreDeHoyExcel;

    window.abrirModalFiltroTiendas = abrirModalFiltroTiendas;
    window.cerrarModalFiltroTiendas = cerrarModalFiltroTiendas;
    window.ejecutarDescargaTiendas = ejecutarDescargaTiendas;

    // Cargar el historial lateral al entrar
    cargarHistorial();

    const inputF = document.getElementById('inputFechaSemanal');
    if (inputF) inputF.value = new Date().toISOString().slice(0, 10);
}

// Array global para acumular los productos seleccionados en la lista de trazabilidad
window.productosTrazabilidadSeleccionados = [];

window.abrirModalReporte = async function(element) {
    const tipo = element.getAttribute('data-tipo');
    window.currentReport = tipo;
    const container = document.getElementById('dynamicFiltersContainer');
    
    document.getElementById('modalTitle').innerText = `Configurar: ${tipo.toUpperCase()}`;
    document.getElementById('reportModal').classList.remove('hidden');
    container.innerHTML = '<div class="text-xs font-bold text-neutral-500 py-4"><i class="fa-solid fa-spinner fa-spin"></i> Cargando opciones...</div>';
    
    // Resetear lista de selección múltiple
    window.productosTrazabilidadSeleccionados = [];

    // Consultar tiendas en vivo
    let opcionesTiendas = '<option value="todas">Todas las Sucursales (Solo Rol Dev)</option>';
    try {
        const token = localStorage.getItem('token');
        const resT = await fetch('/api/ventas/lista-tiendas', { headers: { 'Authorization': `Bearer ${token}` } });
        if (resT.ok) {
            const tiendas = await resT.json();
            tiendas.forEach(t => opcionesTiendas += `<option value="${t.id}">${t.nombre}</option>`);
        }
    } catch(e) { console.warn("Error cargando tiendas", e); }

    let htmlFiltros = `
        <div class="bg-neutral-50 p-3 border border-neutral-200 border-l-2 border-l-neutral-900">
            <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Sucursal a Auditar</label>
            <select id="filterTienda" class="w-full p-2 border border-neutral-300 font-bold text-xs outline-none bg-white text-neutral-800">
                ${opcionesTiendas}
            </select>
        </div>
    `;

    // 🎯 MODAL CLARO Y SIN CONFUSIÓN PARA TRAZABILIDAD Y KARDEX
    if (tipo === 'trazabilidad' || tipo === 'kardex') {
        htmlFiltros += `
            <!-- ALCANCE DEL REPORTE -->
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Alcance de Trazabilidad</label>
                <select id="filterModoTrazabilidad" onchange="window.cambiarModoTrazabilidadUI(this.value)" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900 bg-white">
                    <option value="especifico">🎯 Seleccionar Referencias Específicas (Buscar E001, E002...)</option>
                    <option value="categoria">📦 Filtrar por Categoría / Insumo General</option>
                </select>
            </div>

            <!-- MODO A: BUSCADOR MÚLTIPLE DE REFERENCIAS -->
            <div id="bloqueBusquedaEspecifica" class="relative space-y-2">
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">
                    Buscador de Referencias
                </label>
                <div class="relative">
                    <input type="text" id="inputBuscarTrazabilidad" 
                           placeholder="ESCRIBE CÓDIGO (EJ: E001) Y HAZ CLICK..." 
                           autocomplete="off"
                           class="w-full p-3 border border-neutral-300 font-bold text-xs uppercase outline-none focus:border-neutral-900 pr-10">
                    <i class="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-xs"></i>
                </div>
                
                <input type="hidden" id="filterProducto" value="">

                <div id="resultadosTrazabilidad" 
                     class="hidden absolute z-50 left-0 right-0 bg-white border border-neutral-300 shadow-xl max-h-48 overflow-y-auto divide-y divide-neutral-100">
                </div>

                <!-- Lista de Referencias Seleccionadas -->
                <div id="listaProductosTrazabilidad" class="space-y-1.5 pt-2">
                    <p class="text-[9px] font-bold text-amber-600 uppercase tracking-widest italic" id="textoSinSeleccion">
                        * Debes agregar al menos una referencia en la lista.
                    </p>
                </div>
            </div>

            <!-- MODO B: FILTRO POR CATEGORÍA GENERAL -->
            <div id="bloqueCategoriaGeneral" class="hidden">
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Categoría / Insumo</label>
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900 bg-white">
                    <option value="todos">Todos los Insumos y Productos</option>
                    <option value="ESENCIA">Solo Esencias</option>
                    <option value="ALCOHOL">Solo Alcohol</option>
                    <option value="FIJADOR">Solo Fijador</option>
                    <option value="FRASCOS">Solo Frascos / Envases</option>
                    <option value="INSUMOS">Toda la Materia Prima</option>
                    <option value="PT">Solo Perfumes Terminados (PT)</option>
                </select>
            </div>
        `;
    } 
    else if (tipo === 'inventario' || tipo === 'productos_creados') {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtro: Categoría / Tipo</label>
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900 bg-white">
                    <option value="todos">Catálogo Completo</option>
                    <option value="PT">PT (Perfumes Terminados / Completos)</option>
                    <option value="INSUMOS">Insumos y Materia Prima</option>
                    <option value="FRASCOS">Frascos y Envases</option>
                    <option value="ESENCIA">Solo Esencias</option>
                    <option value="ALCOHOL">Solo Alcohol</option>
                    <option value="FIJADOR">Solo Fijador</option>
                </select>
            </div>`;
    }
    else if (tipo === 'referencias') {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtrar por Tipo / Materia Prima</label>
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900 bg-white">
                    <option value="todos">Todos los Productos</option>
                    <option value="MATERIA_PRIMA">Materia Prima (Esencia, Fijador, Alcohol, Frasco)</option>
                    <option value="ESENCIA">Solo Esencias</option>
                    <option value="FIJADOR">Solo Fijador</option>
                    <option value="ALCOHOL">Solo Alcohol</option>
                    <option value="FRASCO">Solo Frascos / Envases</option>
                    <option value="TERMINADOS">Solo Perfumes Terminados</option>
                </select>
            </div>`;
    }
    else if (tipo === 'cierres') {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtro: Método de Pago (Histórico)</label>
                <select id="filterMetodo" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900 bg-white">
                    <option value="todos">Consolidado Total (Todos)</option>
                    <option value="EFECTIVO USD">Solo Efectivo USD</option>
                    <option value="EFECTIVO BS">Solo Efectivo Bs</option>
                    <option value="ZELLE">Solo Zelle</option>
                    <option value="PUNTO">Solo Punto de Venta</option>
                    <option value="MOVIL">Solo Pago Móvil</option>
                    <option value="TRANSFERENCIA">Solo Transferencia Bs</option>
                    <option value="BIO">Solo Bio Pago</option>
                    <option value="BINANCE">Solo Binance</option>
                    <option value="CASHEA">Solo Cashea</option>
                    <option value="CXC">Solo CXC (Crédito)</option>
                </select>
            </div>`;
    }
    else if (tipo === 'lista-precios') {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtro: Sección / Categoría</label>
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900 bg-white">
                    <option value="todos">Todas las Secciones</option>
                    <option value="ESENCIA">Solo Esencias</option>
                    <option value="TERMINADOS">Solo Perfumes Terminados</option>
                    <option value="ALCOHOL">Solo Alcohol</option>
                    <option value="FIJADOR">Solo Fijador</option>
                    <option value="FRASCO">Solo Frascos / Envases</option>
                    <option value="ACCESORIO">Solo Accesorios</option>
                </select>
            </div>`;
    }
    else if (tipo === 'rentabilidad') {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtrar por Tipo / Materia Prima</label>
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900 bg-white">
                    <option value="todos">Todos los Productos (Consolidado General)</option>
                    <option value="MATERIA_PRIMA">MT - Materia Prima (Esencia, Fijador, Alcohol, Frasco)</option>
                    <option value="ESENCIA">Solo Esencias</option>
                    <option value="FIJADOR">Solo Fijador</option>
                    <option value="ALCOHOL">Solo Alcohol</option>
                    <option value="FRASCO">Solo Frascos / Envases</option>
                    <option value="TERMINADOS">PT - Solo Perfumes Terminados</option>
                </select>
            </div>`;
    }

    if (['cierres', 'referencias'].includes(tipo)) {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtro: Vendedor / Cajero (Opcional)</label>
                <input type="text" id="filterVendedor" placeholder="Dejar vacío para ver todos" class="w-full p-3 border border-neutral-300 font-bold text-xs uppercase outline-none focus:border-neutral-900">
            </div>`;
    }

    container.innerHTML = htmlFiltros;

    // 🔥 EVENTO DE BÚSQUEDA EN VIVO
    if (tipo === 'trazabilidad' || tipo === 'kardex') {
        const inputBuscar = document.getElementById('inputBuscarTrazabilidad');
        const boxResultados = document.getElementById('resultadosTrazabilidad');

        inputBuscar.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            if (query.length < 1) {
                boxResultados.classList.add('hidden');
                boxResultados.innerHTML = '';
                return;
            }

            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/productos?search=${encodeURIComponent(query)}&limit=10`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!res.ok) return;
                const json = await res.json();
                const productos = json.data || [];

                if (productos.length === 0) {
                    boxResultados.innerHTML = '<div class="p-3 text-[10px] font-bold text-neutral-400 uppercase text-center">Sin coincidencias</div>';
                } else {
                    boxResultados.innerHTML = productos.map(p => `
                        <div onclick="window.agregarProductoTrazabilidad('${p.codigo || p.id}', '${p.nombre.replace(/'/g, "\\'")}', '${p.codigo || 'S/C'}')" 
                             class="p-3 hover:bg-neutral-100 cursor-pointer transition-colors flex justify-between items-center text-xs">
                            <span class="font-black text-neutral-900 uppercase">${p.nombre}</span>
                            <span class="text-[10px] font-bold bg-neutral-900 text-white px-2 py-0.5 font-mono">${p.codigo || 'S/C'}</span>
                        </div>
                    `).join('');
                }
                boxResultados.classList.remove('hidden');
            } catch (err) {
                console.error("Error buscando productos:", err);
            }
        });
    }
};


window.cambiarModoTrazabilidadUI = function(modo) {
    const bEspecifico = document.getElementById('bloqueBusquedaEspecifica');
    const bCategoria = document.getElementById('bloqueCategoriaGeneral');
    const inputOculto = document.getElementById('filterProducto');

    if (modo === 'especifico') {
        bEspecifico.classList.remove('hidden');
        bCategoria.classList.add('hidden');
        window.actualizarUIRenderTrazabilidad();
    } else {
        bEspecifico.classList.add('hidden');
        bCategoria.classList.remove('hidden');
        if (inputOculto) inputOculto.value = ''; // Limpiar referencias guardadas
    }
};

window.agregarProductoTrazabilidad = function(codigo, nombre, codigoDisplay) {
    if (window.productosTrazabilidadSeleccionados.some(item => item.codigo === codigo)) {
        document.getElementById('resultadosTrazabilidad').classList.add('hidden');
        document.getElementById('inputBuscarTrazabilidad').value = '';
        return;
    }

    window.productosTrazabilidadSeleccionados.push({ codigo, nombre, codigoDisplay });
    window.actualizarUIRenderTrazabilidad();
    
    document.getElementById('resultadosTrazabilidad').classList.add('hidden');
    document.getElementById('inputBuscarTrazabilidad').value = '';
};

window.removerProductoTrazabilidad = function(codigo) {
    window.productosTrazabilidadSeleccionados = window.productosTrazabilidadSeleccionados.filter(item => item.codigo !== codigo);
    window.actualizarUIRenderTrazabilidad();
};

window.actualizarUIRenderTrazabilidad = function() {
    const contenedorList = document.getElementById('listaProductosTrazabilidad');
    const inputOculto = document.getElementById('filterProducto');

    if (!contenedorList || !inputOculto) return;

    if (window.productosTrazabilidadSeleccionados.length === 0) {
        contenedorList.innerHTML = `
            <p class="text-[9px] font-bold text-amber-600 uppercase tracking-widest italic" id="textoSinSeleccion">
                * Debes agregar al menos una referencia en la lista.
            </p>`;
        inputOculto.value = '';
        return;
    }

    const arrayCodigos = window.productosTrazabilidadSeleccionados.map(item => item.codigo);
    inputOculto.value = arrayCodigos.join(',');

    contenedorList.innerHTML = window.productosTrazabilidadSeleccionados.map(item => `
        <div class="flex justify-between items-center bg-neutral-950 text-white p-2.5 border-l-4 border-l-purple-500 text-[10px] font-black uppercase tracking-wider">
            <div class="flex items-center gap-2">
                <span class="bg-neutral-800 text-neutral-300 font-mono px-1.5 py-0.5">${item.codigoDisplay}</span>
                <span>${item.nombre}</span>
            </div>
            <button type="button" onclick="window.removerProductoTrazabilidad('${item.codigo}')" class="text-neutral-400 hover:text-red-400 ml-2">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `).join('');
};


window.closeModal = function() {
    document.getElementById('reportModal').classList.add('hidden');
};

window.ejecutarDescarga = async function() {
    const start = document.getElementById('inputStart').value;
    const end = document.getElementById('inputEnd').value;
    const tipo = window.currentReport; 

    if (!start || !end) {
        return Swal.fire({ icon: 'warning', text: 'Debes seleccionar la fecha de inicio y fin.' });
    }

    const tiendaId = document.getElementById('filterTienda')?.value || 'todas';
    const categoria = document.getElementById('filterCategoria')?.value || 'todos';
    const producto = document.getElementById('filterProducto')?.value || '';
    const metodoPago = document.getElementById('filterMetodo')?.value || 'todos';
    const vendedor = document.getElementById('filterVendedor')?.value || '';

    // 🔥 ENRUTADOR RÁPIDO CORREGIDO
    let url = '';
    
    if (tipo === 'inventario') {
        url = `/api/productos/reportes/excel?filtro=inventario&start=${start}&end=${end}`;
    } 
    else if (tipo === 'trazabilidad' || tipo === 'kardex') {
        // Apunta al endpoint de trazabilidad en productos.controller.js
        url = `/api/productos/reportes/excel?filtro=trazabilidad&start=${start}&end=${end}`;
    }
    else if (tipo === 'productos_creados') {
        url = `/api/ventas/exportar/excel?filtro=${tipo}&start=${start}&end=${end}`;
    } 
    else if (tipo === 'lista-precios') {
        url = `/api/productos/reportes/lista-precios/excel?start=${start}&end=${end}&tienda_id=${tiendaId}&seccion=${encodeURIComponent(categoria)}`;
    } 
    else {
        url = `/api/ventas/exportar/excel?filtro=${tipo}&start=${start}&end=${end}`;
    }

    // INYECCIÓN DE PARÁMETROS OPCIONALES
    if (tiendaId !== 'todas') url += `&tienda=${tiendaId}`;
    if (categoria !== 'todos') url += `&categoria=${encodeURIComponent(categoria)}`;
    if (producto.trim() !== '') url += `&producto=${encodeURIComponent(producto)}`;
    if (metodoPago !== 'todos') url += `&metodo=${encodeURIComponent(metodoPago)}`;
    if (vendedor.trim() !== '') url += `&vendedor=${encodeURIComponent(vendedor)}`;

    await window.descargarExcel(tipo, url);
    closeModal();
};

window.descargarExcel = async function(tipoReporte, url) {
    const token = localStorage.getItem('token');
    
    try {
        Swal.fire({
            title: 'Generando Reporte...',
            text: 'Procesando datos y construyendo libro Excel...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
        
        const res = await fetch(url, { 
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => null);
            const mensajeError = errJson?.error || errJson?.detalle || `Error HTTP ${res.status}: No se pudo generar el archivo.`;
            throw new Error(mensajeError);
        }
        
        const blob = await res.blob();
        
        if (blob.size === 0) {
            throw new Error("El archivo generado está vacío (0 bytes).");
        }

        const urlBlob = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = urlBlob;
        
        const fechaHoy = new Date().toISOString().slice(0, 10);
        link.download = `Reporte_${tipoReporte.toUpperCase()}_${fechaHoy}.xlsx`;
        
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        window.URL.revokeObjectURL(urlBlob);
        
        Swal.close();

        const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
        Toast.fire({ icon: 'success', title: 'Excel generado exitosamente' });

    } catch (e) {
        console.error("❌ Error en la descarga de Excel:", e);
        Swal.fire({
            icon: 'error',
            title: 'Error en Reporte',
            text: e.message || 'No se pudo procesar el archivo Excel.',
            confirmButtonColor: '#0a0a0a'
        });
    }
};

async function ejecutarCalculo() {
    const btn = document.getElementById('btnCalcular');
    const panel = document.getElementById('panelResultadosCierre');
    const emptyState = document.getElementById('emptyStateCierre');
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ventas/cierre/previsualizar', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({})); 
            if (errorData.mensaje) throw new Error(errorData.mensaje); 
            throw new Error("Error al obtener datos del servidor.");
        }

        const data = await res.json();
        datosCierreTemporal = data;

        const totalUsd = data.totales?.usd || 0;
        const totalBs = data.totales?.bs || 0;
        const listaMetodos = data.desglose_metodos || [];

        document.getElementById('cierreTotalUSD').innerText = formatMoney(totalUsd);
        document.getElementById('cierreTotalBs').innerText = `Bs ${parseFloat(totalBs).toFixed(2)}`;

        renderizarTablaDesglose(listaMetodos);

        emptyState.classList.add('hidden');
        panel.classList.remove('hidden');
        panel.classList.add('flex');
        
        const btnGuardar = document.getElementById('btnGuardarCierre');
        if (btnGuardar) {
            btnGuardar.classList.remove('hidden');
            btnGuardar.classList.add('flex');
        }
        
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Recalcular';

    } catch (error) {
        console.warn("Aviso de Cierre:", error.message);
        
        panel.classList.add('hidden');
        emptyState.classList.remove('hidden');
        const btnGuardar = document.getElementById('btnGuardarCierre');
        if (btnGuardar) btnGuardar.classList.add('hidden');

        const esBloqueo = error.message.includes("YA FUE REALIZADO") || error.message.includes("YA CERRADO");
        
        Swal.fire({
            title: esBloqueo ? 'Cierre Ya Realizado' : 'Error',
            text: error.message,
            icon: esBloqueo ? 'warning' : 'error',
            confirmButtonColor: '#3085d6'
        });

        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-calculator"></i> Calcular Cierre de Hoy';
    }
}

async function confirmarYGuardar() {
    if (!datosCierreTemporal) return;

    try {
        const token = localStorage.getItem('token');
        const payload = {
            totales: datosCierreTemporal.totales,
            detalles: {
                desglose_pagos: datosCierreTemporal.desglose_metodos || []
            },
            notas: "Cierre de caja automático"
        };

        const res = await fetch('/api/ventas/cierre', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            Swal.fire('Éxito', 'Cierre guardado correctamente', 'success');
            cargarHistorial(); 
        }
    } catch (e) { console.error(e); }
}

function renderizarTablaDesglose(datos) {
    const tbody = document.getElementById('tablaDesgloseCierre');
    if (!tbody) return;
    
    if (!datos || datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-slate-400 italic">No hubo ventas registradas hoy</td></tr>';
        return;
    }

    tbody.innerHTML = datos.map(d => {
        const ops = parseInt(d.transacciones || d.cantidad_transacciones || 0);
        const usd = parseFloat(d.total_usd || 0);
        const bs = parseFloat(d.total_bs || d.total_bs_estimado || 0);
        const textoOps = ops === 1 ? 'Transacción' : 'Transacciones';

        return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
            <td class="px-4 py-3 text-slate-700 font-medium capitalize flex items-center gap-2">
                <i class="fa-solid fa-circle text-[8px] text-blue-400"></i> ${d.metodo || 'Otro'}
            </td>
            <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                    ${ops} ${textoOps}
                </span>
            </td>
            <td class="px-4 py-3 text-right">
                <div class="font-bold text-slate-800 text-sm">${formatMoney(usd)}</div>
                <div class="text-[11px] text-slate-500 font-medium">Bs ${bs.toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </td>
        </tr>
    `}).join('');
}

async function cargarHistorial() {
    const tbody = document.getElementById('tablaHistorialCierres');
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ventas/cierre/historial', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const historial = await res.json();

        if (historial.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
                        <i class="fa-regular fa-folder-open text-2xl"></i>
                        <span>Sin historial</span>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = historial.map(h => `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition group">
                <td class="px-3 py-3">
                    <div class="flex flex-col">
                        <span class="font-bold text-slate-700 text-sm">${new Date(h.fecha_cierre).toLocaleDateString()}</span>
                        <span class="text-[10px] text-slate-400">${new Date(h.fecha_cierre).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                </td>
                <td class="px-3 py-3 text-right">
                    <span class="font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-sm border border-emerald-100">
                        ${formatMoney(h.total_usd)}
                    </span>
                </td>
                <td class="px-2 py-3 text-center">
                    <button onclick="descargarCierreHistorico(${h.id})" class="text-slate-400 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-full transition" title="Descargar Detalle">
                        <i class="fa-solid fa-download"></i>
                    </button>
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-red-400 text-xs p-2">Error de conexión</td></tr>';
    }
}

async function descargarCierreHistorico(id) {
    const token = localStorage.getItem('token');
    window.location.href = `/api/ventas/cierre/${id}/excel?token=${token}`; 
}

window.ejecutarCierreManualTemporal = async function() {
    const idsSeleccionados = Array.from(window.facturasSeleccionadas);
    
    if (idsSeleccionados.length === 0) {
        Swal.fire('Error', 'Debes seleccionar al menos una factura para el cierre.', 'error');
        return; 
    }

    const confirm = await Swal.fire({
        title: '¿Confirmar cierre?',
        text: `Vas a cerrar ${idsSeleccionados.length} facturas. Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, sellar cierre'
    });

    if (!confirm.isConfirmed) return;

    try {
        const token = localStorage.getItem('token');
        const respuesta = await fetch('/api/ventas/cierres/forzar-historico', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                fecha_manual: document.getElementById('inputFechaHistorica').value, 
                ids_ventas: idsSeleccionados
            })
        });

        const data = await respuesta.json();

        if (respuesta.ok) {
            Swal.fire('¡Éxito!', 'Cierre forzado correctamente', 'success');
        } else {
            throw new Error(data.error || 'Error al procesar el cierre');
        }
    } catch (error) {
        console.error("Error al enviar al servidor:", error);
        Swal.fire('Error', error.message, 'error');
    }
};

window.facturasSeleccionadas = new Set(); 
window.facturasDisponibles = [];
let fechaActualSeleccionada = '';

window.abrirModalFacturas = async function() {
    const inputFecha = document.getElementById('fechaCierreManualTemporal');
    if (!inputFecha || !inputFecha.value) {
        return Swal.fire('Falta Fecha', 'Por favor, selecciona en el calendario la fecha histórica que deseas cerrar.', 'warning');
    }

    Swal.fire({ title: 'Buscando facturas...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/ventas/cierre/previsualizar?fecha=${inputFecha.value}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        Swal.close();

        window.facturasDisponibles = data.historial_pagos || [];
        window.facturasSeleccionadas.clear();
        document.getElementById('checkAll').checked = false;

        const tbody = document.getElementById('tablaFacturasBody');
        
        if (window.facturasDisponibles.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="p-8 text-center text-slate-400 italic bg-slate-50">
                        <i class="fa-solid fa-calendar-day mr-2 text-slate-300 text-lg"></i> No hay ventas facturadas este día. 
                        <br><span class="text-[10px] text-neutral-500 font-black uppercase tracking-wider block mt-1">Puedes sellar el cierre en $0.00 para auditar el historial de la fecha.</span>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = window.facturasDisponibles.map(f => {
                const moneda = (f.moneda || 'USD').toUpperCase();
                const esBs = moneda === 'BS' || moneda === 'BSS' || moneda === 'VES';
                const signoMoneda = esBs ? 'Bs ' : '$';

                return `
                    <tr class="hover:bg-slate-100 transition cursor-pointer" onclick="window.toggleFacturaSeleccionada(${f.venta_id})">
                        <td class="p-4 text-center">
                            <input type="checkbox" id="chk_${f.venta_id}" value="${f.venta_id}" class="w-4 h-4 accent-slate-900" onclick="event.stopPropagation(); window.toggleFacturaSeleccionada(${f.venta_id})">
                        </td>
                        <td class="p-4 font-bold">#${String(f.venta_id).padStart(6, '0')}</td>
                        <td class="p-4 text-slate-600">${f.cliente || 'Consumidor Final'}</td>
                        <td class="p-4"><span class="bg-slate-200 px-2 py-1 rounded text-xs font-bold">${f.metodo}</span></td>
                        <td class="p-4 text-right font-black">${signoMoneda}${parseFloat(f.monto).toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }

        calcularTotalesModal();
        document.getElementById('modalSeleccionFacturas').classList.remove('hidden');

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudieron procesar las facturas de esa fecha.', 'error');
    }
};

function pintarTablaFacturas() {
    const tbody = document.getElementById('tablaFacturasBody');
    tbody.innerHTML = '';

    facturasDisponibles.forEach(fac => {
        const moneda = (fac.moneda || 'USD').toUpperCase();
        let textoMonto = moneda === 'BS' || moneda === 'VES' 
            ? `Bs ${parseFloat(fac.monto).toFixed(2)}` 
            : `$${parseFloat(fac.monto).toFixed(2)}`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-100 transition cursor-pointer";
        tr.onclick = (e) => { 
            if(e.target.type !== 'checkbox') toggleFacturaSeleccionada(fac.venta_id); 
        };

        tr.innerHTML = `
            <td class="p-4 text-center">
                <input type="checkbox" id="chk_${fac.venta_id}" class="w-4 h-4 accent-slate-900" 
                ${facturasSeleccionadas.has(fac.venta_id) ? 'checked' : ''}
                onchange="toggleFacturaSeleccionada(${fac.venta_id})">
            </td>
            <td class="p-4 font-bold">#${String(fac.venta_id).padStart(6, '0')}</td>
            <td class="p-4 text-slate-600">${fac.cliente || 'General'}</td>
            <td class="p-4"><span class="bg-slate-200 px-2 py-1 rounded text-xs font-bold">${fac.metodo}</span></td>
            <td class="p-4 text-right font-black text-slate-800">${textoMonto}</td>
        `;
        tbody.appendChild(tr);
    });
}

window.toggleFacturaSeleccionada = function(id) {
    const idNum = parseInt(id);
    if (window.facturasSeleccionadas.has(idNum)) window.facturasSeleccionadas.delete(idNum);
    else window.facturasSeleccionadas.add(idNum);
    
    const chk = document.getElementById(`chk_${idNum}`);
    if (chk) chk.checked = window.facturasSeleccionadas.has(idNum);
    
    calcularTotalesModal();
};

function toggleTodasFacturas(checkbox) {
    if (checkbox.checked) {
        facturasDisponibles.forEach(f => facturasSeleccionadas.add(f.venta_id));
    } else {
        facturasSeleccionadas.clear();
    }
    pintarTablaFacturas();
    calcularTotalesModal();
}

function calcularTotalesModal() {
    let usd = 0;
    let bs = 0;
    window.facturasDisponibles.forEach(f => {
        if (window.facturasSeleccionadas.has(f.venta_id)) {
            usd += parseFloat(f.monto_usd || 0);
            bs += parseFloat(f.monto_bs || 0);
        }
    });
    document.getElementById('modalTotalUSD').innerText = usd.toFixed(2);
    document.getElementById('modalTotalBS').innerText = bs.toFixed(2);
}

window.enviarCierreSeleccionado = async function() {
    const inputFecha = document.getElementById('fechaCierreManualTemporal').value;
    const arrayIds = Array.from(window.facturasSeleccionadas);

    if (window.facturasDisponibles.length > 0 && arrayIds.length === 0) {
        return Swal.fire('Falta Selección', 'Por favor, selecciona al menos una factura para procesar el arqueo de esta fecha.', 'warning');
    }

    try {
        Swal.fire({ title: 'Asentando registros...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const token = localStorage.getItem('token');
        
        const res = await fetch('/api/ventas/cierres/forzar-historico', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ 
                fecha_manual: inputFecha, 
                ids_ventas: arrayIds 
            })
        });

        const data = await res.json();
        Swal.close();

        if (res.ok) {
            Swal.fire('¡Arqueo Sellado!', `El balance para el día ${inputFecha} ha sido registrado exitosamente.`, 'success');
            window.cerrarModalFacturas();
            cargarHistorial(); 
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire('Error en Cierre', e.message, 'error');
    }
};

window.cerrarModalFacturas = function() {
    document.getElementById('modalSeleccionFacturas').classList.add('hidden');
};

function cerrarModalFacturas() {
    document.getElementById('modalSeleccionFacturas').classList.add('hidden');
}

let limitesSemanaActual = { inicio: '', fin: '' };

async function ejecutarCalculoSemanal() {
    const inputFecha = document.getElementById('inputFechaSemanal').value;
    const btn = document.getElementById('btnCalcularSemanal');
    const panel = document.getElementById('panelResultadosSemanal');
    const emptyState = document.getElementById('emptyStateSemanal');
    const boxStatus = document.getElementById('statusValidacionSemanal');

    if (!inputFecha) {
        return Swal.fire('Atención', 'Por favor, introduce una fecha de referencia.', 'warning');
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Indexando...';

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/ventas/cierre/semanal?fecha_referencia=${inputFecha}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Error en la respuesta consolidada del servidor.");
        const data = await res.json();

        limitesSemanaActual.inicio = data.rango.inicio;
        limitesSemanaActual.fin = data.rango.fin;

        boxStatus.classList.remove('hidden', 'bg-amber-50', 'border-amber-300', 'text-amber-800', 'bg-emerald-50', 'border-emerald-300', 'text-emerald-800');
        boxStatus.classList.add('flex');

        if (data.cumple_seis_dias) {
            boxStatus.classList.add('bg-emerald-50', 'border-emerald-300', 'text-emerald-800');
            boxStatus.innerHTML = `<i class="fa-solid fa-shield-check text-base"></i> <span>Métrica Completa: Se detectaron los 6 días hábiles de la semana comercial (${data.rango.inicio} al ${data.rango.fin}) cerrados en el sistema.</span>`;
        } else {
            boxStatus.classList.add('bg-amber-50', 'border-amber-300', 'text-amber-800');
            boxStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-base"></i> <span>Atención: Semana incompleta. El rango (${data.rango.inicio} al ${data.rango.fin}) registra únicamente ${data.cantidad_dias} de los 6 días requeridos. El consolidado se calculará de forma parcial.</span>`;
        }

        document.getElementById('semanalTotalUSD').innerText = formatMoney(parseFloat(data.totales.total_usd || 0));
        document.getElementById('semanalTotalBs').innerText = `Bs ${parseFloat(data.totales.total_bs || 0).toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        const tbody = document.getElementById('tablaDesgloseSemanal');
        if (data.desglose_metodos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-400 italic">No existen asientos de ventas consolidados para este rango de fechas.</td></tr>';
        } else {
            tbody.innerHTML = data.desglose_metodos.map(m => {
                const ops = parseInt(m.transacciones || 0);
                const textoOps = ops === 1 ? 'Transacción' : 'Transacciones';
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td class="px-6 py-4 font-bold text-slate-900 uppercase text-xs flex items-center gap-2">
                            <i class="fa-solid fa-cash-register text-slate-400"></i> ${m.metodo || 'No Definido'}
                        </td>
                        <td class="px-6 py-4 text-center">
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-neutral-100 text-neutral-800 uppercase tracking-wide border border-neutral-300">
                                ${ops} ${textoOps}
                            </span>
                        </td>
                        <td class="px-6 py-4 text-right font-black text-slate-900">${formatMoney(parseFloat(m.total_usd))}</td>
                        <td class="px-6 py-4 text-right font-bold text-slate-500">Bs ${parseFloat(m.total_bs).toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    </tr>
                `;
            }).join('');
        }

        emptyState.classList.add('hidden');
        panel.classList.remove('hidden');
        panel.classList.add('flex');

    } catch (err) {
        console.error(err);
        Swal.fire('Error de Consulta', 'No se ha podido procesar el consolidado semanal.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-layer-group"></i> Analizar Semana';
    }
}

async function descargarExcelSemanal() {
    if (!limitesSemanaActual.inicio || !limitesSemanaActual.fin) return;
    
    const token = localStorage.getItem('token');
    const url = `/api/ventas/cierre/semanal/excel?fecha_inicio=${limitesSemanaActual.inicio}&fecha_fin=${limitesSemanaActual.fin}`;

    try {
        Swal.fire({
            title: 'Generando Reporte...',
            text: 'Preparando la matriz de datos de la semana comercial seleccionada.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error("Error bajando el binario del Excel");

        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = `Cierre_Semanal_Consolidado_${limitesSemanaActual.inicio}_al_${limitesSemanaActual.fin}.xlsx`;
        link.click();

        Swal.close();
        
        const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
        Toast.fire({ icon: 'success', title: 'Matriz semanal descargada' });
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudo generar el archivo Excel de la semana.', 'error');
    }
}

window.abrirModalFiltroTiendas = async function() {
    document.getElementById('modalFiltroTiendas').classList.remove('hidden');
    const container = document.getElementById('listaTiendasFiltro');
    container.innerHTML = '<div class="text-xs text-neutral-400 font-bold text-center py-4">Cargando tiendas...</div>';
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ventas/lista-tiendas', {
            headers: { 'Authorization': `Bearer ${token}` }
        }); 
        
        if (!res.ok) throw new Error('Error al conectar con el servidor');
        
        const tiendas = await res.json();
        
        if (tiendas.length === 0) {
            container.innerHTML = '<div class="text-xs text-amber-500 font-bold text-center py-4">No hay tiendas registradas.</div>';
            return;
        }

        container.innerHTML = tiendas.map(t => `
            <label class="flex items-center gap-3 cursor-pointer p-2 hover:bg-neutral-100 transition-colors border border-transparent hover:border-neutral-200">
                <input type="checkbox" class="tienda-checkbox accent-neutral-950 w-4 h-4" value="${t.id}" checked>
                <span class="text-xs font-bold uppercase tracking-wider text-neutral-700">${t.nombre}</span>
            </label>
        `).join('');
    } catch (error) {
        console.error('Error cargando tiendas:', error);
        container.innerHTML = `<div class="text-red-500 text-xs font-bold text-center py-4 border border-red-100 bg-red-50">Error al cargar tiendas.</div>`;
    }
};

function cerrarModalFiltroTiendas() {
    document.getElementById('modalFiltroTiendas').classList.add('hidden');
}

window.ejecutarDescargaTiendas = function() {
    const inicio = document.getElementById('filtroInicioTiendas').value;
    const fin = document.getElementById('filtroFinTiendas').value;
    
    const checkboxes = document.querySelectorAll('.tienda-checkbox:checked');
    const tiendasIds = Array.from(checkboxes).map(cb => cb.value).join(',');
    
    if (!inicio || !fin) return Swal.fire({ icon: 'warning', text: 'Por favor, selecciona el rango de fechas.' });
    if (!tiendasIds) return Swal.fire({ icon: 'warning', text: 'Debes seleccionar al menos una tienda.' });

    const url = `/api/ventas/exportar/excel?filtro=tiendas&start=${inicio}&end=${fin}&tiendas=${tiendasIds}`;
    window.descargarExcel('consolidadotiendas', url);
    cerrarModalFiltroTiendas();
};

window.descargarCierreDeHoyExcel = async function() {
    const token = localStorage.getItem('token');
    
    try {
        Swal.fire({
            title: 'Preparando Cierre del Día...',
            text: 'Generando desglose de ventas, cantidades y totales en USD y Bs...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await fetch('/api/ventas/cierre/previsualizar/excel', { 
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("No se pudo generar el reporte de hoy. ¿Verificaste si hay ventas procesadas hoy?");

        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = `Cierre_Caja_Previo_Hoy_${new Date().toISOString().slice(0, 10)}.xlsx`;
        link.click();

        Swal.close();
    } catch (error) {
        console.error(error);
        Swal.fire('Error', error.message, 'error');
    }
};