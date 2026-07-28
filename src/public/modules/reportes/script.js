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
    if(inputF) inputF.value = new Date().toISOString().slice(0, 10);
}


window.abrirModalReporte = async function(element) {
    const tipo = element.getAttribute('data-tipo');
    window.currentReport = tipo;
    const container = document.getElementById('dynamicFiltersContainer');
    
    document.getElementById('modalTitle').innerText = `Configurar: ${tipo.toUpperCase()}`;
    document.getElementById('reportModal').classList.remove('hidden');
    container.innerHTML = '<div class="text-xs font-bold text-neutral-500 py-4"><i class="fa-solid fa-spinner fa-spin"></i> Cargando opciones...</div>';
    
    // Consultar tiendas en vivo para el SuperAdmin
    let opcionesTiendas = '<option value="todas">Todas las Sucursales (Solo Rol Dev)</option>';
    try {
        const token = localStorage.getItem('token');
        const resT = await fetch('/api/ventas/lista-tiendas', { headers: { 'Authorization': `Bearer ${token}` } });
        if (resT.ok) {
            const tiendas = await resT.json();
            tiendas.forEach(t => opcionesTiendas += `<option value="${t.id}">${t.nombre}</option>`);
        }
    } catch(e) { console.warn("Error cargando tiendas", e); }

    // Construir estructura base de filtros (El de tienda siempre sale)
    let htmlFiltros = `
        <div class="bg-neutral-50 p-3 border border-neutral-200 border-l-2 border-l-neutral-900">
            <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Sucursal a Auditar</label>
            <select id="filterTienda" class="w-full p-2 border border-neutral-300 font-bold text-xs outline-none bg-white text-neutral-800">
                ${opcionesTiendas}
            </select>
        </div>
    `;

    // Filtros específicos según la tarjeta que tocó el usuario
    if (tipo === 'kardex') {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtro: Producto / Referencia</label>
                <input type="text" id="filterProducto" placeholder="Ej: E176" class="w-full p-3 border border-neutral-300 font-bold text-xs uppercase outline-none focus:border-neutral-900">
            </div>`;
    } 
    else if (tipo === 'inventario' || tipo === 'productos_creados') {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtro: Categoría / Tipo</label>
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900">
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
        // 🔥 AGREGADO: Selector dinámico para Ventas por Referencia
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtrar por Tipo / Materia Prima</label>
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900">
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
                <select id="filterMetodo" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900">
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
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900">
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
                <select id="filterCategoria" class="w-full p-3 border border-neutral-300 font-bold text-xs outline-none uppercase focus:border-neutral-900">
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

    // El filtro de cajero sirve para facturación y reportes de desempeño
    if (['cierres', 'referencias'].includes(tipo)) {
        htmlFiltros += `
            <div>
                <label class="text-[10px] font-black uppercase text-neutral-500 block mb-1">Filtro: Vendedor / Cajero (Opcional)</label>
                <input type="text" id="filterVendedor" placeholder="Dejar vacío para ver todos" class="w-full p-3 border border-neutral-300 font-bold text-xs uppercase outline-none focus:border-neutral-900">
            </div>`;
    }

    container.innerHTML = htmlFiltros;
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

    // Capturamos los valores de los filtros (con el operador ? por si no existen en pantalla)
    const tiendaId = document.getElementById('filterTienda')?.value || 'todas';
    const categoria = document.getElementById('filterCategoria')?.value || 'todos';
    const producto = document.getElementById('filterProducto')?.value || '';
    const metodoPago = document.getElementById('filterMetodo')?.value || 'todos';
    const vendedor = document.getElementById('filterVendedor')?.value || '';

    // Enrutador base corregido
    let url = '';
    
    // "Info. Inventario" (Movimiento ISLR) debe ir a productos.controller
    if (tipo === 'inventario') {
        url = `/api/productos/reportes/excel?filtro=inventario&start=${start}&end=${end}`;
    } 
    // El nuevo reporte "Productos Creados" va a ventas.controller
    else if (tipo === 'productos_creados') {
        url = `/api/ventas/exportar/excel?filtro=${tipo}&start=${start}&end=${end}`;
    } 
    else if (tipo === 'kardex') {
        url = `/api/productos/reporte-kardex?inicio=${start}&fin=${end}`;
    } 
    else if (tipo === 'lista-precios') {
        url = `/api/productos/reportes/lista-precios/excel?start=${start}&end=${end}&tienda_id=${tiendaId}&seccion=${encodeURIComponent(categoria)}`;
    } 
    else {
        url = `/api/ventas/exportar/excel?filtro=${tipo}&start=${start}&end=${end}`;
    }

    // 🚀 INYECCIÓN DE PARÁMETROS EN LA URL
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
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
        
        // Ejecutamos la descarga usando la URL completa
        const res = await fetch(url, { 
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // Verificamos si el servidor devolvió un error (500, 400, etc.)
        if (!res.ok) {
            const err = await res.json().catch(() => ({error: 'Error desconocido al generar el archivo'}));
            throw new Error(err.error);
        }
        
        // Procesamos y descargamos el Excel
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        
        // Nombre de descarga genérico según el reporte
        link.download = `Reporte_${tipoReporte.toUpperCase()}.xlsx`;
        link.click();
        
        Swal.close();
    } catch (e) {
        console.error("Error en la descarga:", e);
        Swal.fire('Error', e.message, 'error');
    }
}

async function ejecutarCalculo() {
    const btn = document.getElementById('btnCalcular');
    const panel = document.getElementById('panelResultadosCierre');
    const emptyState = document.getElementById('emptyStateCierre');
    
    // Bloquear botón visualmente
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ventas/cierre/previsualizar', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        // --- AQUÍ ESTÁ LA SOLUCIÓN DEL ERROR 400 ---
        if (!res.ok) {
            // Intentamos leer el mensaje JSON que envía el backend (ej: "YA CERRADO")
            const errorData = await res.json().catch(() => ({})); 
            
            // Si el backend nos dio una razón específica, lanzamos ese error para mostrarlo
            if (errorData.mensaje) {
                throw new Error(errorData.mensaje); 
            }
            
            throw new Error("Error al obtener datos del servidor.");
        }
        // -------------------------------------------

        const data = await res.json();
        datosCierreTemporal = data;

        // Recuperar datos con seguridad
        const totalUsd = data.totales?.usd || 0;
        const totalBs = data.totales?.bs || 0;
        const listaMetodos = data.desglose_metodos || [];

        // 1. Renderizar Totales
        document.getElementById('cierreTotalUSD').innerText = formatMoney(totalUsd);
        document.getElementById('cierreTotalBs').innerText = `Bs ${parseFloat(totalBs).toFixed(2)}`;

        // 2. Renderizar Tabla
        renderizarTablaDesglose(listaMetodos);

        // 3. Mostrar Panel
        emptyState.classList.add('hidden');
        panel.classList.remove('hidden');
        panel.classList.add('flex');
        
        // Mostrar botón de guardar solo si se calculó correctamente
        const btnGuardar = document.getElementById('btnGuardarCierre');
        if(btnGuardar) {
            btnGuardar.classList.remove('hidden');
            btnGuardar.classList.add('flex');
        }
        
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Recalcular';

    } catch (error) {
        console.warn("Aviso de Cierre:", error.message);
        
        // Ocultar panel de resultados si hubo error (para no mostrar datos viejos)
        panel.classList.add('hidden');
        emptyState.classList.remove('hidden');
        const btnGuardar = document.getElementById('btnGuardarCierre');
        if(btnGuardar) btnGuardar.classList.add('hidden');

        // MOSTRAR LA ALERTA CON EL MENSAJE DEL BACKEND
        // Si el mensaje incluye "YA FUE REALIZADO", usamos un ícono de advertencia/info
        const esBloqueo = error.message.includes("YA FUE REALIZADO") || error.message.includes("YA CERRADO");
        
        Swal.fire({
            title: esBloqueo ? 'Cierre Ya Realizado' : 'Error',
            text: error.message,
            icon: esBloqueo ? 'warning' : 'error',
            confirmButtonColor: '#3085d6'
        });

        // Restaurar el botón
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-calculator"></i> Calcular Cierre de Hoy';
    }
}

async function confirmarYGuardar() {
    if (!datosCierreTemporal) return;

    try {
        const token = localStorage.getItem('token');
        const payload = {
            totales: datosCierreTemporal.totales, // Enviamos el objeto de totales directo
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
        // Aseguramos que los números sean números
        const ops = parseInt(d.transacciones || d.cantidad_transacciones || 0);
        const usd = parseFloat(d.total_usd || 0);
        const bs = parseFloat(d.total_bs || d.total_bs_estimado || 0);
        
        // Texto inteligente: "1 Transacción" vs "2 Transacciones"
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

// Descarga individual del historial
async function descargarCierreHistorico(id) {
    const token = localStorage.getItem('token');
    // Usamos window.location para forzar la descarga del navegador
    // Asumiendo que tu ruta backend soporta GET para descargar
    window.location.href = `/api/ventas/cierre/${id}/excel?token=${token}`; 
    
    // NOTA: Si tu backend requiere Header Authorization en lugar de query param token,
    // tendrías que usar el metodo fetch + blob similar a descargarExcel()
}

window.ejecutarCierreManualTemporal = async function() {
    // 1. Convertimos el Set a Array para poder enviarlo
    const idsSeleccionados = Array.from(window.facturasSeleccionadas);
    
    // 🔥 DEBUG: Mira la consola (F12) al hacer clic. ¿Qué sale aquí?
    console.log("IDs que voy a enviar al servidor:", idsSeleccionados);

    // 2. Validación de seguridad
    if (idsSeleccionados.length === 0) {
        Swal.fire('Error', 'Debes seleccionar al menos una factura para el cierre.', 'error');
        return; // Detenemos aquí, no intentamos llamar al servidor
    }

    // 3. Confirmación
    const confirm = await Swal.fire({
        title: '¿Confirmar cierre?',
        text: `Vas a cerrar ${idsSeleccionados.length} facturas. Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, sellar cierre'
    });

    if (!confirm.isConfirmed) return;

    // 4. Envío al Servidor
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
                ids_ventas: idsSeleccionados // ✅ El backend espera esto
            })
        });

        const data = await respuesta.json();

        if (respuesta.ok) {
            Swal.fire('¡Éxito!', 'Cierre forzado correctamente', 'success');
            // Aquí puedes cerrar la modal o recargar la página
        } else {
            // Si el servidor responde 400, aquí capturamos el mensaje real del servidor
            throw new Error(data.error || 'Error al procesar el cierre');
        }
    } catch (error) {
        console.error("Error al enviar al servidor:", error);
        Swal.fire('Error', error.message, 'error');
    }
};

// Variables globales de la modal
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

        // Guardamos las facturas (si el día está en cero, el array vendrá vacío [])
        window.facturasDisponibles = data.historial_pagos || [];
        window.facturasSeleccionadas.clear();
        document.getElementById('checkAll').checked = false;

        const tbody = document.getElementById('tablaFacturasBody');
        
        // ✨ COMPORTAMIENTO ABIERTO: Si no hay ventas, mostramos un diseño limpio de auditoría en cero
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
            // Pintar filas con la moneda real
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

// 2. Pintar la tabla
function pintarTablaFacturas() {
    const tbody = document.getElementById('tablaFacturasBody');
    tbody.innerHTML = '';

    facturasDisponibles.forEach(fac => {
        // Conversión rápida para mostrar en la tabla (dependiendo de la moneda original)
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

// 3. Lógica de Checkboxes
window.toggleFacturaSeleccionada = function(id) {
    const idNum = parseInt(id);
    if (window.facturasSeleccionadas.has(idNum)) window.facturasSeleccionadas.delete(idNum);
    else window.facturasSeleccionadas.add(idNum);
    
    // Sincronizar checkbox visual
    const chk = document.getElementById(`chk_${idNum}`);
    if(chk) chk.checked = window.facturasSeleccionadas.has(idNum);
    
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

// 4. Calcular Totales en tiempo real
function calcularTotalesModal() {
    let usd = 0;
    let bs = 0;
    window.facturasDisponibles.forEach(f => {
        if(window.facturasSeleccionadas.has(f.venta_id)) {
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

    // Si el día sí tiene facturas pero el cajero no marcó ninguna, le advertimos
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
                ids_ventas: arrayIds // Enviará [] si el día fue de $0.00
            })
        });

        const data = await res.json();
        Swal.close();

        if (res.ok) {
            Swal.fire('¡Arqueo Sellado!', `El balance para el día ${inputFecha} ha sido registrado exitosamente.`, 'success');
            window.cerrarModalFacturas();
            cargarHistorial(); // Refrescar la tabla lateral
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

window.cerrarModalFacturas = function() {
    document.getElementById('modalSeleccionFacturas').classList.add('hidden');
};

function cerrarModalFacturas() {
    document.getElementById('modalSeleccionFacturas').classList.add('hidden');
}

// Variable temporal para guardar las fechas calculadas en el frontend
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

        // Guardar límites para la descarga de Excel posterior
        limitesSemanaActual.inicio = data.rango.inicio;
        limitesSemanaActual.fin = data.rango.fin;

        // 1. Renderizar Bloque de Alerta de Validación de los 6 Días
        boxStatus.classList.remove('hidden', 'bg-amber-50', 'border-amber-300', 'text-amber-800', 'bg-emerald-50', 'border-emerald-300', 'text-emerald-800');
        boxStatus.classList.add('flex');

        if (data.cumple_seis_dias) {
            boxStatus.classList.add('bg-emerald-50', 'border-emerald-300', 'text-emerald-800');
            boxStatus.innerHTML = `<i class="fa-solid fa-shield-check text-base"></i> <span>Métrica Completa: Se detectaron los 6 días hábiles de la semana comercial (${data.rango.inicio} al ${data.rango.fin}) cerrados en el sistema.</span>`;
        } else {
            boxStatus.classList.add('bg-amber-50', 'border-amber-300', 'text-amber-800');
            boxStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-base"></i> <span>Atención: Semana incompleta. El rango (${data.rango.inicio} al ${data.rango.fin}) registra únicamente ${data.cantidad_dias} de los 6 días requeridos. El consolidado se calculará de forma parcial.</span>`;
        }

        // 2. Renderizar Tarjetas de Montos Totales
        document.getElementById('semanalTotalUSD').innerText = formatMoney(parseFloat(data.totales.total_usd || 0));
        document.getElementById('semanalTotalBs').innerText = `Bs ${parseFloat(data.totales.total_bs || 0).toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        // 3. Renderizar Tabla Desglosada por Método de Pago
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

        // 4. Alternar visibilidad de contenedores
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
        const token = localStorage.getItem('token'); // Recuperamos tu token de sesión
        
        // Usamos una ruta específica para ventas/tiendas
        const res = await fetch('/api/ventas/lista-tiendas', {
            headers: { 'Authorization': `Bearer ${token}` }
        }); 
        
        if (!res.ok) throw new Error('Error al conectar con el servidor');
        
        const tiendas = await res.json();
        
        if(tiendas.length === 0) {
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
}

function cerrarModalFiltroTiendas() {
    document.getElementById('modalFiltroTiendas').classList.add('hidden');
}

// Recolectar datos y descargar de forma segura con Token
window.ejecutarDescargaTiendas = function() {
    const inicio = document.getElementById('filtroInicioTiendas').value;
    const fin = document.getElementById('filtroFinTiendas').value;
    
    // Obtener los IDs de las tiendas marcadas
    const checkboxes = document.querySelectorAll('.tienda-checkbox:checked');
    const tiendasIds = Array.from(checkboxes).map(cb => cb.value).join(',');
    
    if (!inicio || !fin) return Swal.fire({ icon: 'warning', text: 'Por favor, selecciona el rango de fechas.' });
    if (!tiendasIds) return Swal.fire({ icon: 'warning', text: 'Debes seleccionar al menos una tienda.' });

    // Construir la URL con el filtro de tiendas
    const url = `/api/ventas/exportar/excel?filtro=tiendas&start=${inicio}&end=${fin}&tiendas=${tiendasIds}`;
    
    // 🔥 EL CAMBIO ESTÁ AQUÍ: Usamos la función nativa que inyecta el Token
    window.descargarExcel('consolidadotiendas', url);
    
    // Cerramos el modal
    cerrarModalFiltroTiendas();
}

// Descarga directa del Cierre de Hoy sin archivar (A nivel de Frontend)
window.descargarCierreDeHoyExcel = async function() {
    const token = localStorage.getItem('token');
    // Le pasamos el token por la URL para que la descarga directa del navegador lo autorice
    const url = `/api/ventas/cierre/previsualizar/excel?token=${token}`; 
    
    try {
        Swal.fire({
            title: 'Preparando Cierre del Día...',
            text: 'Mapeando las formas de pago procesadas hasta el momento.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        // Hacemos el fetch de la nueva ruta del backend
        const res = await fetch('/api/ventas/cierre/previsualizar/excel', { 
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("No se pudo generar el reporte de hoy. ¿Hay ventas?");

        // Convertimos la respuesta en un archivo binario descargable
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
}