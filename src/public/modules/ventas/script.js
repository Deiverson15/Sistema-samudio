import { escapeHtml, formatMoney } from '../../js/api.js';

// Variables de estado global para paginación
let currentPage = 1;
let itemsPerPage = 15;
let totalPages = 1;
let searchTimeout = null;
let ventaActualDatos = null; 
let monedaVista = 'USD';

export async function init() {
    console.log("Módulo de Ventas Cargado (Paginado)");
    
    // Configurar fecha de hoy por defecto al cargar
    const fechaInput = document.getElementById('filtroFecha');
    if (fechaInput) {
        // No forzamos la fecha hoy para permitir ver todo, pero si el usuario quiere filtrar, ahí está.
        // Si prefieres que inicie con hoy: fechaInput.valueAsDate = new Date();
    }
    
    // Carga inicial
    await cargarVentas();

    // Evento de búsqueda en servidor (Debounce)
    const buscador = document.getElementById('buscadorVentas');
    if (buscador) {
        buscador.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentPage = 1; // Reset a página 1 al buscar
                cargarVentas();
            }, 500); // Espera 500ms antes de buscar
        });
    }

    // Exponer funciones globales
    window.verDetalleVenta = verDetalleVenta;
    window.cargarVentas = cargarVentas; // Recarga actual
    window.filtrarPorFecha = () => { currentPage = 1; cargarVentas(); };
    window.limpiarFiltros = limpiarFiltros;
    window.cambiarPagina = cambiarPagina;
    window.cambiarMonedaDetalle = cambiarMonedaDetalle;
}

function limpiarFiltros() {
    const fechaInput = document.getElementById('filtroFecha');
    const buscador = document.getElementById('buscadorVentas');
    if(fechaInput) fechaInput.value = '';
    if(buscador) buscador.value = '';
    currentPage = 1;
    cargarVentas();
}

async function cambiarPagina(delta) {
    const nuevaPagina = currentPage + delta;
    if (nuevaPagina >= 1 && nuevaPagina <= totalPages) {
        currentPage = nuevaPagina;
        await cargarVentas();
    }
}

async function cargarVentas() {
    const tbody = document.getElementById('tablaVentas');
    if (!tbody) return; 
    
    // Loader
    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="text-center p-10">
                <div class="flex flex-col items-center justify-center text-blue-500">
                    <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-2"></i>
                    <span class="text-sm font-medium text-gray-500">Buscando ventas...</span>
                </div>
            </td>
        </tr>
    `;

    try {
        const token = localStorage.getItem('token');
        
        // Recoger filtros
        const fecha = document.getElementById('filtroFecha')?.value || '';
        const busqueda = document.getElementById('buscadorVentas')?.value || '';
        
        // Construir URL con parámetros
        const params = new URLSearchParams({
            page: currentPage,
            limit: itemsPerPage,
            fecha: fecha,
            busqueda: busqueda
        });

        const res = await fetch(`/api/ventas?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Error al consultar ventas");
        
        const respuesta = await res.json();
        const ventas = respuesta.data;
        const paginacion = respuesta.pagination;

        // Actualizar variables globales de paginación
        totalPages = paginacion.totalPages;
        currentPage = paginacion.currentPage;

        renderTabla(ventas);
        actualizarControlesPaginacion(paginacion);
        
        // Calculamos estadisticas LOCALES de la vista actual (o del día si se filtró)
        calcularEstadisticas(ventas); 

    } catch (error) {
        console.error(error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center p-8 text-red-500">
                        Error: ${escapeHtml(error.message)}
                        <br>
                        <button onclick="cargarVentas()" class="mt-2 text-blue-600 underline">Reintentar</button>
                    </td>
                </tr>
            `;
        }
    }
}

function actualizarControlesPaginacion(paginacion) {
    const info = document.getElementById('infoPaginacion');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');

    if (info) {
        const inicio = (paginacion.currentPage - 1) * paginacion.itemsPerPage + 1;
        const fin = Math.min(inicio + paginacion.itemsPerPage - 1, paginacion.totalItems);
        info.innerText = `Mostrando ${paginacion.totalItems === 0 ? 0 : inicio} - ${fin} de ${paginacion.totalItems}`;
    }

    if (btnPrev) btnPrev.disabled = paginacion.currentPage <= 1;
    if (btnNext) btnNext.disabled = paginacion.currentPage >= paginacion.totalPages;
}

function renderTabla(lista) {
    const tbody = document.getElementById('tablaVentas');
    if (!tbody) return; 

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center p-8 text-slate-400 bg-slate-50 border-2 border-dashed rounded-lg m-4">No se encontraron ventas con estos filtros.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(v => {
        const fechaObj = new Date(v.fecha);
        const fecha = fechaObj.toLocaleDateString();
        const hora = fechaObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let metodoClass = 'bg-gray-100 text-gray-600 border-gray-200';
        let metodoIcono = '<i class="fa-solid fa-money-bill"></i>';
        
        // Obtenemos el método mayor y verificamos si hay más de 1 pago
        let metodoLabel = (v.metodo_pago || 'SIN PAGO').toUpperCase();
        const esMixto = parseInt(v.cant_pagos) > 1;

        if (esMixto) {
            metodoClass = 'bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-300';
            metodoIcono = '<i class="fa-solid fa-arrows-split-up-and-left"></i>';
            metodoLabel = 'PAGO MIXTO';
        } 
        // 🎨 CLASIFICACIÓN DE LOS MÉTODOS DE PAGO
        else if (metodoLabel.includes('ZELLE') || metodoLabel.includes('CUENTA VERDE')) {
            metodoClass = 'bg-emerald-100 text-emerald-700 border border-emerald-200';
            metodoIcono = '<i class="fa-solid fa-building-columns"></i>';
            metodoLabel = 'ZELLE / VERDE'; 
        } else if (metodoLabel.includes('PAGO MÓVIL') || metodoLabel.includes('MOVIL')) {
            metodoClass = 'bg-blue-100 text-blue-700 border border-blue-200';
            metodoIcono = '<i class="fa-solid fa-mobile-screen"></i>';
        } else if (metodoLabel.includes('PUNTO')) {
            metodoClass = 'bg-yellow-100 text-yellow-700 border border-yellow-200';
            metodoIcono = '<i class="fa-regular fa-credit-card"></i>';
        } else if (metodoLabel.includes('EFECTIVO USD') || metodoLabel.includes('DIVISA') || metodoLabel === 'EFECTIVO') {
            metodoClass = 'bg-green-50 text-green-600 border border-green-200';
            metodoIcono = '<i class="fa-solid fa-sack-dollar"></i>';
            metodoLabel = 'EFECTIVO USD';
        } else if (metodoLabel.includes('EFECTIVO BS')) {
            metodoClass = 'bg-indigo-100 text-indigo-700 border border-indigo-200';
            metodoIcono = '<i class="fa-solid fa-money-bill-wave"></i>';
        } else if (metodoLabel.includes('CASHEA')) {
            metodoClass = 'bg-pink-100 text-pink-700 border border-pink-200';
            metodoIcono = '<i class="fa-solid fa-mobile-button"></i>';
        } else if (metodoLabel.includes('BINANCE')) {
            metodoClass = 'bg-amber-100 text-amber-700 border border-amber-200';
            metodoIcono = '<i class="fa-brands fa-bitcoin"></i>';
        } else if (metodoLabel.includes('BIOPAGO')) {
            metodoClass = 'bg-cyan-100 text-cyan-700 border border-cyan-200';
            metodoIcono = '<i class="fa-solid fa-fingerprint"></i>';
        } else if (metodoLabel.includes('TRANSF')) {
            metodoClass = 'bg-teal-100 text-teal-700 border border-teal-200';
            metodoIcono = '<i class="fa-solid fa-money-bill-transfer"></i>';
        } else if (metodoLabel.includes('CXC') || metodoLabel.includes('CREDITO')) {
            metodoClass = 'bg-red-100 text-red-700 border border-red-200';
            metodoIcono = '<i class="fa-solid fa-hand-holding-dollar"></i>';
        }

        const montoBs = (parseFloat(v.total) * (parseFloat(v.tasa_cambio) || 0)).toFixed(2);
        
        const usuarioLocal = JSON.parse(localStorage.getItem('usuario') || '{}');
        const esDev = usuarioLocal.rol === 'developer' || usuarioLocal.rol === 'dev';

        return `
            <tr class="hover:bg-blue-50/50 transition border-b border-slate-100 group">
                <td class="p-4 font-mono font-bold text-slate-500 text-xs">#${v.id}</td>
                <td class="p-4">
                    <div class="font-bold text-slate-700 text-sm">${fecha}</div>
                    <div class="text-xs text-slate-400">${hora}</div>
                </td>
                <td class="p-4 font-bold text-slate-800 text-sm">${escapeHtml(v.cliente_nombre || 'Cliente General')}</td>
                <td class="p-4 text-center">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide ${metodoClass}">
                        ${metodoIcono} ${escapeHtml(metodoLabel)}
                    </span>
                </td>
                <td class="p-4 text-right font-bold text-slate-800">${formatMoney(v.total)}</td>
                <td class="p-4 text-right text-slate-500 font-mono text-xs">Bs ${montoBs}</td>
                <td class="p-4 text-center">
                    <div class="flex justify-center items-center gap-2">
                        <button onclick="verDetalleVenta(${v.id})" 
                            class="text-blue-600 hover:text-white hover:bg-blue-600 w-8 h-8 rounded-full transition flex items-center justify-center shadow-sm border border-transparent hover:border-blue-200" 
                            title="Ver Ticket #${v.id}">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        
                        <button onclick="window.imprimirFacturaOriginalDirecta(${v.id})" 
                            class="text-neutral-500 hover:text-white hover:bg-neutral-950 w-8 h-8 rounded-full transition flex items-center justify-center shadow-sm border border-transparent hover:border-neutral-400" 
                            title="Imprimir Factura Original Directa">
                            <i class="fa-solid fa-print"></i>
                        </button>
                        
                        ${esDev ? `
                        <button onclick="eliminarVentaPrueba(${v.id})" 
                            class="text-red-500 hover:text-white hover:bg-red-600 w-8 h-8 rounded-full transition flex items-center justify-center shadow-sm border border-transparent hover:border-red-200" 
                            title="Purga de Desarrollo">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function calcularEstadisticas(ventas) {
    const elTotal = document.getElementById('statTotalVentas');
    const elIngresos = document.getElementById('statIngresos');
    const elBs = document.getElementById('statTotalBs');

    if (!elTotal || !elIngresos) return; 

    // Sumatoria de la VISTA ACTUAL
    const totalUSD = ventas.reduce((sum, v) => sum + parseFloat(v.total), 0);
    const totalBs = ventas.reduce((sum, v) => sum + (parseFloat(v.total) * (parseFloat(v.tasa_cambio) || 0)), 0);
    
    elTotal.innerText = ventas.length;
    elIngresos.innerText = formatMoney(totalUSD);
    if(elBs) elBs.innerText = `Bs ${totalBs.toFixed(2)}`;
}

async function verDetalleVenta(id) {
    Swal.fire({ title: 'Cargando ticket...', didOpen: () => Swal.showLoading() });

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/ventas/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if(!res.ok) throw new Error("No se pudo cargar el detalle");

        const data = await res.json();
        Swal.close();

        // Guardamos los datos recibidos globalmente
        ventaActualDatos = data;
        monedaVista = 'USD'; // Inicia en USD por defecto

        const venta = data.venta; 

        // Rellenar cabecera del modal
        const elId = document.getElementById('detalleIdVenta');
        const elFecha = document.getElementById('detalleFecha');
        const elCliente = document.getElementById('detalleCliente');
        const elVendedor = document.getElementById('detalleVendedor');
        const elTasa = document.getElementById('detalleTasaHistorica'); 
        
        if(elId) elId.innerText = `TICKET #${String(venta.id).padStart(5, '0')}`;
        if(elFecha) elFecha.innerText = new Date(venta.fecha).toLocaleString();
        if(elCliente) elCliente.innerText = `Cliente: ${escapeHtml(venta.cliente_nombre || 'General')}`;
        if(elVendedor) elVendedor.innerText = `Atendido por: ${escapeHtml(venta.usuario_nombre || 'Sistema')}`;
        
        if(elTasa) {
            const tasaHist = parseFloat(venta.tasa_cambio || 0);
            elTasa.innerText = `Tasa del día: Bs ${tasaHist.toFixed(2)}`;
        }

        // Resetear estilos iniciales de los botones USD / BS
        const btnUSD = document.getElementById('btnVerUSD');
        const btnBS = document.getElementById('btnVerBS');
        if(btnUSD) btnUSD.className = "px-4 py-2 bg-neutral-950 text-white text-[10px] font-black uppercase tracking-widest transition-colors border border-neutral-950";
        if(btnBS) btnBS.className = "px-4 py-2 bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-100 text-[10px] font-black uppercase tracking-widest transition-colors";

        // Renderizar dinámicamente tanto la tabla de productos como las formas de pago
        renderizarDetallesModal();
        
        const modal = document.getElementById('modalDetalleVenta');
        if(modal) modal.classList.remove('hidden');

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudieron cargar los detalles.', 'error');
    }
}


function cambiarMonedaDetalle(moneda) {
    monedaVista = moneda;
    
    // Cambiar estilos visuales de los botones activo/inactivo
    const btnUSD = document.getElementById('btnVerUSD');
    const btnBS = document.getElementById('btnVerBS');
    
    if (moneda === 'USD') {
        btnUSD.className = "px-4 py-2 bg-neutral-950 text-white text-[10px] font-black uppercase tracking-widest transition-colors border border-neutral-950";
        btnBS.className = "px-4 py-2 bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-100 text-[10px] font-black uppercase tracking-widest transition-colors";
    } else {
        btnBS.className = "px-4 py-2 bg-neutral-950 text-white text-[10px] font-black uppercase tracking-widest transition-colors border border-neutral-950";
        btnUSD.className = "px-4 py-2 bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-100 text-[10px] font-black uppercase tracking-widest transition-colors";
    }

    // Actualizar tabla con la nueva moneda
    renderizarDetallesModal();
}

function renderizarDetallesModal() {
    if (!ventaActualDatos) return;

    const { venta, detalles, pagos } = ventaActualDatos;
    const tasa = parseFloat(venta.tasa_cambio) || 1;
    
    const esBolivares = monedaVista === 'BS';
    const multiplicador = esBolivares ? tasa : 1;
    const simbolo = esBolivares ? 'Bs ' : '$';

    const tbody = document.getElementById('listaProductosDetalle');
    if (tbody) {
        tbody.innerHTML = detalles.map(d => {
            const subtotal = parseFloat(d.cantidad * d.precio_unitario) * multiplicador;
            const textoSubtotal = `${simbolo}${subtotal.toFixed(2)}`;
            
            // 🔥 Usamos la función de clasificación fiscal para mostrar PERFUME o PT en el modal
            const nombreFiscal = determinarNombreFiscal(d);
            
            return `
                <tr class="border-b border-dashed border-slate-200 last:border-0">
                    <td class="py-2 pr-2 align-top font-bold text-gray-700">${d.cantidad}</td>
                    <td class="py-2 px-2 align-top">
                        <div class="text-slate-800 font-bold leading-tight text-sm">${nombreFiscal}</div>
                        ${d.es_preparado ? '<span class="text-[10px] text-purple-600 bg-purple-50 px-1 rounded border border-purple-100">Preparado</span>' : ''}
                    </td>
                    <td class="py-2 pl-2 text-right font-mono text-slate-600 text-sm">${textoSubtotal}</td>
                </tr>
            `;
        }).join('');
    }

    const elTotal = document.getElementById('detalleTotal');
    const elTotalBs = document.getElementById('detalleTotalBs');
    
    if (elTotal) elTotal.innerText = `${simbolo}${(parseFloat(venta.total) * multiplicador).toFixed(2)}`;
    if (elTotalBs) elTotalBs.innerText = `Bs ${(parseFloat(venta.total) * tasa).toFixed(2)}`;

    const elMetodo = document.getElementById('detalleMetodo');
    if (elMetodo) {
        if (pagos && pagos.length > 0) {
            const desgloseMetodos = pagos.map(p => {
                const met = p.metodo.toUpperCase();
                const refStr = (p.referencia && p.referencia !== 'S/N') ? ` (REF: ${p.referencia})` : '';
                const montoCalculado = esBolivares 
                    ? (p.moneda === 'USD' ? (parseFloat(p.monto) * tasa) : parseFloat(p.monto))
                    : (p.moneda === 'BS' ? (parseFloat(p.monto) / tasa) : parseFloat(p.monto));
                
                return `• ${met}${refStr}: ${simbolo}${montoCalculado.toFixed(2)}`;
            }).join('<br>');

            elMetodo.innerHTML = `<div class="text-left font-mono text-[10px] leading-relaxed">${desgloseMetodos}</div>`;
            elMetodo.className = "text-xs font-black uppercase tracking-widest bg-neutral-950 text-white p-3 rounded-none border border-neutral-800";
        } else {
            elMetodo.innerText = (venta.metodo_pago || 'SIN PAGO').toUpperCase();
        }
    }
}


window.imprimirTicket = function() {
    const area = document.getElementById('areaImpresion');
    if (!area) return;
    
    const contenido = area.innerHTML;
    const ventana = window.open('', 'PRINT', 'height=600,width=400');
    
    ventana.document.write(`
        <html>
            <head>
                <title>Ticket de Venta</title>
                <style>
                    body { font-family: 'Courier New', monospace; padding: 20px; color: black; }
                    h2 { text-align: center; margin: 0; font-size: 18px; }
                    .ticket-header { text-align: center; margin-bottom: 10px; }
                    .info-box { border: 1px dashed #ccc; padding: 5px; margin: 10px 0; font-size: 11px; }
                    p { text-align: center; margin: 2px 0; font-size: 12px; }
                    table { width: 100%; margin-top: 10px; border-collapse: collapse; }
                    th, td { font-size: 11px; text-align: left; padding: 4px 0; }
                    .text-right { text-align: right; }
                    .text-center { text-align: center; }
                    .total-box { margin-top: 15px; border-top: 1px dashed black; pt: 5px; }
                    @page { margin: 0; }

                    /* =======================================================
                       🛡️ BLOQUE DE INVISIBILIDAD TÉRMICA COLEGIAL
                       ======================================================= */
                    @media print {
                        /* Forzamos la desaparición total de los botones en el papel físico */
                        button, 
                        #btnVerUSD, 
                        #btnVerBS,
                        .px-4.py-2 { 
                            display: none !important; 
                        }
                    }
                </style>
            </head>
            <body>
                ${contenido}
                <div style="text-align: center; margin-top: 30px; font-size: 10px;">
                    *** GRACIAS POR SU COMPRA ***
                </div>
            </body>
        </html>
    `);
    ventana.document.close(); 
    ventana.focus(); 
    setTimeout(() => {
        ventana.print();
        ventana.close();
    }, 250);
};

window.abrirModalExterna = () => {
    document.getElementById('modalVentaExterna').classList.remove('hidden');
    document.getElementById('extTotal').value = '';
    document.getElementById('extRef').value = '';
    document.getElementById('extDesc').value = '';
    document.getElementById('extTasa').value = '';
    
    // Reseteamos el nuevo selector a la opción por defecto
    const extOrigen = document.getElementById('extOrigen');
    if(extOrigen) extOrigen.value = 'EXTERNA';
};

window.cerrarModalExterna = () => {
    document.getElementById('modalVentaExterna').classList.add('hidden');
};

window.guardarVentaExterna = async () => {
    const total = parseFloat(document.getElementById('extTotal').value);
    const metodo = document.getElementById('extMetodo').value;
    const tasa = parseFloat(document.getElementById('extTasa').value) || 0;
    const referenciaBase = document.getElementById('extRef').value;
    
    // 1. Leemos los nuevos campos
    const origen = document.getElementById('extOrigen').value;
    const descripcionBase = document.getElementById('extDesc').value || 'Venta externa';

    if (!total || total <= 0) return Swal.fire('Atención', 'Debe ingresar un monto total válido', 'warning');

    const moneda = (metodo.includes('BS') || metodo.includes('MÓVIL') || metodo.includes('PUNTO')) ? 'BS' : 'USD';

    // 2. Lógica de blindaje para no confundir las ventas
    const esFiscal = (origen === 'FISCAL');
    
    // Agregamos una etiqueta gigante a la descripción para el ticket y BD
    const descripcionFinal = esFiscal ? `[SISTEMA FISCAL] ${descripcionBase}` : `[EXTERNA] ${descripcionBase}`;
    
    // Marcamos la referencia también para que salga en los reportes de Excel
    const referenciaFinal = esFiscal ? `FISCAL-${referenciaBase || 'S/N'}` : referenciaBase;

    const payload = {
        es_externa: true,
        descripcion_externa: descripcionFinal,
        total: total,
        pagos: [{
            metodo: metodo,
            moneda: moneda,
            monto: total,
            tasa: tasa,
            referencia: referenciaFinal
        }]
    };

    try {
        Swal.fire({ title: 'Procesando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const token = localStorage.getItem('token');
        
        const res = await fetch('/api/ventas', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error registrando la venta externa');

        Swal.fire('¡Cargada!', 'La venta se ha registrado en el libro de caja.', 'success');
        cerrarModalExterna();
        cargarVentas(); // Recargamos la tabla para que se refleje inmediatamente
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
};

window.eliminarVentaPrueba = async (id) => {
    const confirm = await Swal.fire({
        title: '⚠️ PURGA DE NÚCLEO',
        text: `Estás a punto de destruir la venta #${id}. Se borrará de la contabilidad y el stock descontado volverá al estante. ¿Ejecutar orden?`,
        icon: 'error',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sí, Destruir Venta',
        cancelButtonText: 'Cancelar',
        background: '#0f172a',
        color: '#fff',
        customClass: { title: 'font-mono uppercase tracking-widest' }
    });

    if (confirm.isConfirmed) {
        try {
            Swal.fire({ title: 'Limpiando Base de Datos...', didOpen: () => Swal.showLoading() });
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/ventas/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await res.json();
            
            if (res.ok) {
                Swal.fire({
                    title: 'VENTA ELIMINADA', 
                    text: data.mensaje, 
                    icon: 'success',
                    background: '#0f172a',
                    color: '#fff',
                });
                cargarVentas(); // Recargamos la tabla
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            Swal.fire('Error de Protocolo', error.message, 'error');
        }
    }
};

// =====================================================================
// 🔥 REIMPRESIÓN DIRECTA DE FACTURA CON FORMAS DE PAGO ORIGINALES
// =====================================================================
window.imprimirFacturaOriginalDirecta = async function(idVenta) {
    Swal.fire({
        title: 'Preparando Impresión',
        text: 'Generando desglose con nombres fiscales ajustados...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/ventas/${idVenta}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error("No se pudo recuperar los datos del ticket.");
        const data = await res.json();
        Swal.close();

        const venta = data.venta;
        const detalles = data.detalles;
        const pagos = data.pagos || [];
        const tasa = parseFloat(venta.tasa_cambio) || 1;

        const formatVE = (valor) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);

        let totalGlobalBs = 0;
        const itemsHTML = detalles.map(d => {
            const precioFinalBs = parseFloat(d.precio_unitario) * tasa;
            const subtotalFinalBs = precioFinalBs * parseFloat(d.cantidad);
            const subtotalBaseBs = subtotalFinalBs / 1.16;
            
            totalGlobalBs += subtotalFinalBs;
            
            // 🔥 Aplicación de la misma función helper para la impresión
            const descripcionFinal = determinarNombreFiscal(d);
            
            return `
            <tr>
                <td width="12%" style="vertical-align: top; text-align: center;">${parseFloat(d.cantidad).toFixed(0)}</td>
                <td width="58%" style="vertical-align: top; padding-right: 4px;">${descripcionFinal}</td>
                <td width="30%" class="text-right" style="vertical-align: top;">${formatVE(subtotalBaseBs)}</td>
            </tr>`;
        }).join('');

        const baseImponibleBs = totalGlobalBs / 1.16;
        const ivaBs = totalGlobalBs - baseImponibleBs;

        let formasPagoHTML = '';
        if (pagos && pagos.length > 0) {
            formasPagoHTML = pagos.map(p => {
                const met = p.metodo.toUpperCase();
                const refStr = (p.referencia && p.referencia !== 'S/N' && p.referencia !== '0000') ? ` (REF: ${p.referencia})` : '';
                const montoBs = p.moneda === 'USD' ? (parseFloat(p.monto) * tasa) : parseFloat(p.monto);
                
                return `
                <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px;">
                    <span>• ${met}${refStr}:</span>
                    <span>Bs ${formatVE(montoBs)}</span>
                </div>`;
            }).join('');
        } else {
            const metGeneral = (venta.metodo_pago || 'EFECTIVO').toUpperCase();
            formasPagoHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px;">
                <span>• FORMA DE PAGO (${metGeneral}):</span>
                <span>Bs ${formatVE(totalGlobalBs)}</span>
            </div>`;
        }

        const ventana = window.open('', 'PRINT', 'height=600,width=400');
        if (!ventana) {
            return Swal.fire('Pop-ups Bloqueados', 'Permite las ventanas emergentes para imprimir la factura.', 'warning');
        }

        ventana.document.write(`
            <html>
                <head>
                    <title>Factura Original #${idVenta}</title>
                    <style>
                        body { margin: 0; padding: 4px; font-family: 'Courier New', monospace; font-size: 11px; color: #000; text-transform: uppercase; width: 72mm; }
                        .text-center { text-align: center; }
                        .text-right { text-align: right; }
                        .font-bold { font-weight: bold; }
                        .divider-solid { border-bottom: 1px solid #000; margin: 5px 0; }
                        table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                        td, th { vertical-align: top; padding: 2px 0; font-size: 10px; }
                        @page { margin: 0; size: auto; }
                    </style>
                </head>
                <body onload="window.print(); window.close();">
                    <div class="text-center">
                        <div class="font-bold" style="font-size: 13px;">PERFUMIX C.A.</div>
                        <div>RIF: J-50000000-0</div>
                        <div style="font-size: 9px; line-height: 1.2;">CARACAS - VENEZUELA</div>
                    </div>
                    <div class="divider-solid"></div>
                    <div style="display: flex; justify-content: space-between;"><span>FACTURA ORIGINAL</span><span class="font-bold">NRO: ${String(venta.id).padStart(8, '0')}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>FECHA: ${new Date(venta.fecha).toLocaleDateString('es-VE')}</span><span>HORA: ${new Date(venta.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span></div>
                    <div>CLIENTE: <span class="font-bold">${(venta.cliente_nombre || 'CONSUMIDOR FINAL').toUpperCase()}</span></div>
                    <div>RIF/CI: ${venta.referencia || '00000000'}</div>
                    <div class="divider-solid"></div>
                    <table>
                        <thead>
                            <tr><th class="text-center" width="12%">CANT</th><th class="text-left" width="58%">DESCRIPCIÓN</th><th class="text-right" width="30%">TOTAL</th></tr>
                        </thead>
                        <tbody>${itemsHTML}</tbody>
                    </table>
                    <div class="divider-solid"></div>
                    <div style="display: flex; justify-content: space-between;"><span>BI G (16%):</span><span>${formatVE(baseImponibleBs)}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>IVA G (16%):</span><span>${formatVE(ivaBs)}</span></div>
                    <div class="divider-solid"></div>
                    <div style="display: flex; justify-content: space-between; font-size: 12px;" class="font-bold"><span>TOTAL COMPRA:</span><span>Bs ${formatVE(totalGlobalBs)}</span></div>
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: #333;"><span>REF EFECTIVO:</span><span>$${parseFloat(venta.total).toFixed(2)}</span></div>
                    
                    <div class="divider-solid"></div>
                    <div class="font-bold" style="font-size: 10px; margin-bottom: 2px;">FORMA(S) DE PAGO:</div>
                    ${formasPagoHTML}

                    <div class="divider-solid" style="margin-top: 10px;"></div>
                    <div class="text-center" style="font-size: 9px; font-weight: bold;">*** COPIA FIEL DEL REGISTRO ORIGINAL ***</div>
                </body>
            </html>
        `);
        ventana.document.close();

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'No se pudo procesar la impresión: ' + error.message, 'error');
    }
};

// =====================================================================
// 🛡️ HELPER DE CLASIFICACIÓN FISCAL BLINDADO (PERFUME vs PT)
// =====================================================================
function determinarNombreFiscal(d) {
    let nombreLimpio = (d.producto_nombre || d.nombre || '').toUpperCase().trim();
    
    // Inspección profunda de todas las posibles claves donde pueda venir el código o categoría
    const codigoUpper = (d.codigo || d.producto_codigo || d.codigo_producto || d.prod_codigo || '').toUpperCase();
    const catUpper = (d.categoria || d.producto_categoria || d.categoria_nombre || '').toUpperCase();

    // 1. Limpiar prefijos duplicados/previos del nombre
    nombreLimpio = nombreLimpio
        .replace(/^ESENCIA\s+/i, '')
        .replace(/^PERFUME\s+/i, '')
        .replace(/^PT\s+/i, '')
        .trim();

    // 2. Extraer o determinar la medida/presentación
    let medidaStr = '';
    
    // Buscar si el código o el nombre trae el patrón -T30, -T60, T30, 30ML, etc.
    const matchTamanoCodigo = codigoUpper.match(/-?T(\d+)/) || nombreLimpio.match(/(\d+)\s*ML/);
    
    if (matchTamanoCodigo && matchTamanoCodigo[1]) {
        medidaStr = `${matchTamanoCodigo[1]}ML`;
    } else if (d.tamano && d.tamano !== 'N/A') {
        medidaStr = d.tamano.toUpperCase();
    } else if (d.contenido_gramos && parseFloat(d.contenido_gramos) > 0) {
        medidaStr = `${d.contenido_gramos}ML`;
    } else if (d.unidad_medida && d.unidad_medida !== 'UNIDAD') {
        medidaStr = d.unidad_medida.toUpperCase();
    }

    // 3. DETECCION MULTI-CRITERIO DE PERFUME TERMINADO (PT)
    const esPT = 
        codigoUpper.includes('-T') || 
        codigoUpper.includes('PT') ||
        catUpper.includes('TERMINADO') || 
        catUpper.includes('PREPARADO') ||
        d.es_preparado === true ||
        d.es_preparado === 'true' ||
        d.es_terminado === true ||
        /(\d+)\s*ML/.test(nombreLimpio) || 
        /-T\d+/.test(nombreLimpio);

    if (esPT) {
        return `PT ${nombreLimpio} ${medidaStr}`.trim();
    } else {
        // Si es una esencia pura o venta general
        return `PERFUME ${nombreLimpio} ${medidaStr}`.trim();
    }
}