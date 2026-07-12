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
        // Si no es mixto, evaluamos el normal
        else if(metodoLabel.includes('ZELLE') || metodoLabel.includes('CUENTA VERDE')) {
            metodoClass = 'bg-emerald-100 text-emerald-700 border border-emerald-200';
            metodoIcono = '<i class="fa-solid fa-building-columns"></i>';
            metodoLabel = 'CUENTA VERDE'; 
        } else if(metodoLabel.includes('PAGO MÓVIL')) {
            metodoClass = 'bg-blue-100 text-blue-700 border border-blue-200';
            metodoIcono = '<i class="fa-solid fa-mobile-screen"></i>';
        } else if(metodoLabel.includes('PUNTO')) {
            metodoClass = 'bg-yellow-100 text-yellow-700 border border-yellow-200';
            metodoIcono = '<i class="fa-regular fa-credit-card"></i>';
        } else if(metodoLabel.includes('DIVISA')) {
            metodoClass = 'bg-green-50 text-green-600 border border-green-200';
            metodoIcono = '<i class="fa-solid fa-sack-dollar"></i>';
        }

        const montoBs = (parseFloat(v.total) * (parseFloat(v.tasa_cambio) || 0)).toFixed(2);
        // Leemos quién es el usuario logueado
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

        // 1. Guardamos los datos globalmente y reseteamos la vista a USD
        ventaActualDatos = data;
        monedaVista = 'USD';

        const venta = data.venta; 

        // 2. Llenar Cabecera del Modal (Esto no cambia con la moneda)
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

        const elMetodo = document.getElementById('detalleMetodo');
        let metodoTexto = venta.metodo_pago;
        if(metodoTexto.includes('ZELLE')) metodoTexto = 'CUENTA VERDE'; 
        if(metodoTexto.toUpperCase().includes('PAGO MÓVIL') && venta.referencia) {
            metodoTexto += ` (REF: ${venta.referencia})`;
        }
        if(elMetodo) elMetodo.innerText = metodoTexto;
        
        // 3. Resetear el estado visual de los botones
        const btnUSD = document.getElementById('btnVerUSD');
        const btnBS = document.getElementById('btnVerBS');
        if(btnUSD) btnUSD.className = "px-4 py-2 bg-neutral-950 text-white text-[10px] font-black uppercase tracking-widest transition-colors border border-neutral-950";
        if(btnBS) btnBS.className = "px-4 py-2 bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-100 text-[10px] font-black uppercase tracking-widest transition-colors";

        // 4. Renderizar productos y totales dinámicamente
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

    const { venta, detalles } = ventaActualDatos;
    const tasa = parseFloat(venta.tasa_cambio) || 1;
    
    // Determinar multiplicador y símbolo
    const multiplicador = monedaVista === 'BS' ? tasa : 1;
    const simbolo = monedaVista === 'BS' ? 'Bs ' : '';

    // Renderizar lista de productos
    const tbody = document.getElementById('listaProductosDetalle');
    if(tbody) {
        tbody.innerHTML = detalles.map(d => {
            const subtotal = parseFloat(d.cantidad * d.precio_unitario) * multiplicador;
            // Usamos formatMoney si es USD, si no mostramos el símbolo de Bs manualmente
            const textoSubtotal = monedaVista === 'BS' ? `${simbolo}${subtotal.toFixed(2)}` : formatMoney(subtotal);
            
            return `
                <tr class="border-b border-dashed border-slate-200 last:border-0">
                    <td class="py-2 pr-2 align-top font-bold text-gray-700">${d.cantidad}</td>
                    <td class="py-2 px-2 align-top">
                        <div class="text-slate-800 font-bold leading-tight text-sm">${escapeHtml(d.producto_nombre)}</div>
                        ${d.es_preparado ? '<span class="text-[10px] text-purple-600 bg-purple-50 px-1 rounded border border-purple-100">Preparado</span>' : ''}
                    </td>
                    <td class="py-2 pl-2 text-right font-mono text-slate-600 text-sm">${textoSubtotal}</td>
                </tr>
            `;
        }).join('');
    }

    // Renderizar totales
    const elTotal = document.getElementById('detalleTotal');
    const elTotalBs = document.getElementById('detalleTotalBs');
    
    if(elTotal) {
        const totalConvertido = parseFloat(venta.total) * multiplicador;
        elTotal.innerText = monedaVista === 'BS' ? `${simbolo}${totalConvertido.toFixed(2)}` : formatMoney(totalConvertido);
    }
    
    // Mantenemos el equivalente en Bs como referencia fija al final
    if(elTotalBs) {
         const totalBs = parseFloat(venta.total) * tasa;
         elTotalBs.innerText = `Bs ${totalBs.toFixed(2)}`;
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