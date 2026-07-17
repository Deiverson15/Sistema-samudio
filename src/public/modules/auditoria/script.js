import { ProductoService, escapeHtml } from '../../js/api.js';

let cacheLotesAuditoria = []; // Para filtrado instantáneo local de vencimientos
let timeoutBuscadorLogs = null;

export async function init() {
    console.log("Iniciando Módulo de Auditoría Corporativa Multi-Tienda...");
    
    // 1. Inicializar interface multi-tienda para roles maestros
    await verificarYMontarSelectorTiendas();
    
    // 2. Cargar datos del tablero
    cargarVencimientos();
    cargarAuditoria();

    // 3. Exponer funciones globales al ecosistema
    window.cargarAuditoria = cargarAuditoria;
    window.accionReactivar = accionReactivar;
    window.accionBorrarDB = accionBorrarDB;
    window.cambiarSucursalAuditoriaUI = cambiarSucursalAuditoriaUI;
    window.recargarFiltroLotesUI = recargarFiltroLotesUI;
    window.filtrarLogsTerminal = filtrarLogsTerminal;
}

const getHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
};

// 🔥 NUEVO: CONECTOR DE CONTROLADORES MULTI-TIENDA CORPORATIVOS
async function verificarYMontarSelectorTiendas() {
    try {
        const usuarioLocal = JSON.parse(localStorage.getItem('usuario') || '{}');
        const rol = (usuarioLocal.rol || '').toLowerCase().trim();
        const esUsuarioMaestro = ['developer', 'dev', 'admin', 'administrador', 'superadmin', 'gerente general'].includes(rol);

        if (esUsuarioMaestro) {
            const token = localStorage.getItem('token');
            // Reutilizamos tu pasarela de lista de tiendas existente en ventas
            const res = await fetch('/api/ventas/tiendas/lista', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return;

            const tiendas = await res.json();
            const select = document.getElementById('selectorTiendaAuditoria');
            
            if (select && tiendas.length > 0) {
                select.innerHTML = tiendas.map(t => `
                    <option value="${t.id}" ${t.id === parseInt(usuarioLocal.tienda_id) ? 'selected' : ''}>
                        🏢 SUCURSAL: ${t.nombre.toUpperCase()}
                    </option>`).join('');
                
                document.getElementById('containerSelectorTiendaAuditoria').classList.remove('hidden');
            }
        }
    } catch (e) { console.error("Error montando selector de red tiendas:", e); }
}

window.cambiarSucursalAuditoriaUI = function() {
    // Al cambiar la tienda en el dropdown, refrescamos ambas tablas con la query correspondiente
    cargarVencimientos();
    cargarAuditoria();
};

async function cargarVencimientos() {
    try {
        const selectTienda = document.getElementById('selectorTiendaAuditoria');
        const tiendaId = selectTienda ? selectTienda.value : '';
        
        const params = new URLSearchParams();
        if (tiendaId) params.append('tienda_id', tiendaId);

        const res = await fetch(`/api/auditoria/vencimientos?${params}`, { headers: getHeaders() });
        if (!res.ok) throw new Error('Error cargando vencimientos');

        cacheLotesAuditoria = await res.json();
        recargarFiltroLotesUI(); // Renderiza aplicando el filtro actual

    } catch (e) { console.error(e); }
}

window.recargarFiltroLotesUI = function() {
    const filtro = document.getElementById('filtroSemaforoLotes')?.value || 'TODOS';
    const tbody = document.getElementById('tablaVencimientos');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Filtrado local rápido según el estado del semáforo unificado
    const lotesFiltrados = cacheLotesAuditoria.filter(l => {
        if (filtro === 'CRITICOS') return l.estado_semaforo === 'VENCIDO' || l.estado_semaforo === 'POR_VENCER';
        return true;
    });

    if (lotesFiltrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-10 text-center font-bold text-xs uppercase tracking-widest text-neutral-400 bg-neutral-50 border-2 border-dashed m-4">Todo en orden. No se detectan alertas en este rango.</td></tr>';
        return;
    }

    tbody.innerHTML = lotesFiltrados.map(l => {
        let badgeClass = 'bg-green-50 text-green-700 border-green-200';
        let estadoLabel = 'FRESCO (OK)';
        
        if (l.estado_semaforo === 'VENCIDO') {
            badgeClass = 'bg-red-950 text-white border-red-950 font-black animate-pulse'; 
            estadoLabel = 'CADUCADO';
        } else if (l.estado_semaforo === 'POR_VENCER' || l.dias_restantes <= 30) {
            badgeClass = 'bg-red-50 text-red-600 border-red-200 font-black';
            estadoLabel = 'CRÍTICO (<30D)';
        } else if (l.estado_semaforo === 'ATENCION' || l.dias_restantes <= 90) {
            badgeClass = 'bg-amber-50 text-amber-600 border-amber-200 font-black';
            estadoLabel = 'ATENCIÓN (<90D)';
        }

        return `
            <tr class="hover:bg-neutral-50/50 transition border-b border-neutral-100">
                <td class="px-6 py-4">
                    <div class="font-black text-neutral-900 text-xs uppercase tracking-wide">${escapeHtml(l.nombre)}</div>
                    <div class="text-[10px] text-neutral-400 uppercase font-bold mt-1">${escapeHtml(l.marca)} | Disponible: <span class="text-neutral-950 font-black">${parseFloat(l.cantidad_actual).toFixed(0)} u.</span></div>
                </td>
                <td class="px-6 py-4 text-center text-[10px] font-mono font-black text-neutral-600 bg-neutral-50/50">${escapeHtml(l.codigo_lote)}</td>
                <td class="px-6 py-4 text-center">
                    <div class="font-black text-neutral-700 text-xs">${new Date(l.fecha_vencimiento).toLocaleDateString('es-VE')}</div>
                    <div class="text-[9px] font-bold text-neutral-400 mt-1 uppercase tracking-widest">${l.dias_restantes} DÍAS RESTANTES</div>
                </td>
                <td class="px-6 py-4 text-center">
                    <span class="px-3 py-1.5 text-[9px] font-black uppercase tracking-wider border ${badgeClass}">${estadoLabel}</span>
                </td>
            </tr>
        `;
    }).join('');
};

async function cargarAuditoria() {
    try {
        const selectTienda = document.getElementById('selectorTiendaAuditoria');
        const filtroTipo = document.getElementById('filtroTipoLog')?.value || 'TODOS';
        const inputBuscar = document.getElementById('buscadorLogsAuditoria')?.value || '';
        
        const params = new URLSearchParams();
        if (selectTienda && selectTienda.value) params.append('tienda_id', selectTienda.value);
        if (filtroTipo !== 'TODOS') params.append('tipo', filtroTipo);
        if (inputBuscar) params.append('search', inputBuscar);

        const res = await fetch(`/api/auditoria?${params}`, { headers: getHeaders() });
        if (!res.ok) throw new Error('Error cargando logs');

        const logs = await res.json();
        const container = document.getElementById('listaLogs');

        if (logs.length === 0) {
            container.innerHTML = '<div class="text-neutral-600 text-center mt-16 font-bold uppercase tracking-widest flex flex-col items-center gap-2"><i class="fa-solid fa-folder-open text-2xl"></i> Sin registros en la terminal</div>';
            return;
        }

        container.innerHTML = logs.map(log => {
            let icon = 'fa-terminal';
            let color = 'text-neutral-400';
            let botonesAccion = '';

            const acc = log.accion.toUpperCase();
            const det = (log.detalle || '').toUpperCase();

            // Clasificación visual de la terminal Linux
            if (acc.includes('COMPRA')) { icon = 'fa-truck-loading'; color = 'text-orange-400'; }
            else if (acc.includes('VENTA')) { icon = 'fa-cash-register'; color = 'text-emerald-400'; }
            else if (acc.includes('CREAR')) { icon = 'fa-square-plus'; color = 'text-blue-400'; }
            else if (acc.includes('ELIMINAR_PROD') || acc.includes('BORRADO_TOTAL')) { icon = 'fa-circle-exclamation'; color = 'text-red-500'; }
            else if (acc.includes('AJUSTE') || det.includes('MERMA')) { icon = 'fa-triangle-exclamation'; color = 'text-amber-500'; }

            // Destacar pérdidas financieras visualmente en color rojo/oro en la consola
            let detalleFormateado = escapeHtml(log.detalle);
            if (det.includes('IMPACTO FINANCIERO: -') || det.includes('MERMA')) {
                detalleFormateado = `<span class="text-red-400 bg-red-950/40 px-1 border border-red-900/50">${detalleFormateado}</span>`;
            } else if (det.includes('IMPACTO FINANCIERO: +')) {
                detalleFormateado = `<span class="text-emerald-400 bg-emerald-950/40 px-1 border border-emerald-900/50">${detalleFormateado}</span>`;
            }

            if (log.accion === 'ELIMINAR_PROD') {
                const match = log.detalle.match(/ID (\d+)/);
                if (match) {
                    const idProd = match[1];
                    botonesAccion = `
                        <div class="mt-3 flex gap-2 justify-end border-t border-neutral-800 pt-2 font-sans">
                            <button onclick="accionReactivar(${idProd})" class="text-[9px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 transition flex items-center gap-1 cursor-pointer">
                                <i class="fa-solid fa-rotate-left"></i> Reactivar
                            </button>
                            <button onclick="accionBorrarDB(${idProd})" class="text-[9px] font-black uppercase tracking-widest bg-red-950 hover:bg-red-800 text-white px-2 py-1 transition flex items-center gap-1 border border-red-900 cursor-pointer">
                                <i class="fa-solid fa-skull"></i> Destruir
                            </button>
                        </div>
                    `;
                }
            }

            return `
                <div class="flex gap-4 border-b border-neutral-900 pb-3 mb-2 last:border-0 group hover:bg-neutral-900/50 transition p-2 font-mono text-[10px]">
                    <div class="mt-0.5"><i class="fa-solid ${icon} ${color}"></i></div>
                    <div class="w-full">
                        <div class="text-neutral-200 font-black flex justify-between tracking-wide">
                            <span>SYSTEM_LOG // ${escapeHtml(log.accion)}</span>
                        </div>
                        <div class="text-neutral-400 leading-normal mt-1.5 lowercase select-text selection:bg-neutral-700">${detalleFormateado}</div>
                        ${botonesAccion}
                        <div class="text-neutral-600 text-[9px] mt-2.5 flex justify-between w-full border-t border-neutral-900 pt-1.5 font-sans font-bold">
                            <span><i class="fa-solid fa-user text-neutral-700"></i> OPERATOR: ${escapeHtml(log.usuario_nombre || 'AUTOMATIC_KERNEL')}</span>
                            <span>${new Date(log.fecha).toLocaleString('es-VE')}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) { 
        console.error(e); 
        document.getElementById('listaLogs').innerHTML = '<div class="text-red-500 font-mono p-4 uppercase">Error loading logs stream</div>';
    }
}

window.filtrarLogsTerminal = function(value) {
    // Implementación de Debounce táctico para no colgar PostgreSQL en redes locales
    clearTimeout(timeoutBuscadorLogs);
    timeoutBuscadorLogs = setTimeout(() => {
        cargarAuditoria();
    }, 400);
};

async function accionReactivar(id) {
    const confirm = await Swal.fire({
        title: 'RE-ACTIVAR ARTÍCULO',
        text: "El producto volverá al catálogo activo de la sucursal.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#16a34a',
        confirmButtonText: 'CONFIRMAR',
        cancelButtonText: 'CANCELAR',
        customClass: { popup: 'rounded-none border border-neutral-400', confirmButton: 'rounded-none text-[10px] uppercase tracking-widest', cancelButton: 'rounded-none text-[10px] uppercase tracking-widest' }
    });

    if (confirm.isConfirmed) {
        try {
            const res = await fetch(`/api/productos/${id}/reactivar`, { method: 'PUT', headers: getHeaders() });
            const data = await res.json();
            if (res.ok) {
                Swal.fire({ icon: 'success', title: 'REGISTRO RESTAURADO', text: data.mensaje, confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
                cargarAuditoria(); 
            } else { throw new Error(data.error); }
        } catch (e) { Swal.fire('Error', e.message, 'error'); }
    }
}

async function accionBorrarDB(id) {
    const confirm = await Swal.fire({
        title: '🔥 PURGA FÍSICA CRÍTICA',
        html: "Se intentará purgar el artículo de las tablas.<br><b style='color:#ef4444' class='uppercase text-[10px] font-black tracking-wider'>¡Esta acción NO se puede deshacer!</b>",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#7f1d1d', 
        confirmButtonText: 'DESTRUIR DATOS',
        cancelButtonText: 'CANCELAR',
        customClass: { popup: 'rounded-none border border-neutral-400', confirmButton: 'rounded-none text-[10px] uppercase tracking-widest', cancelButton: 'rounded-none text-[10px] uppercase tracking-widest' }
    });

    if (confirm.isConfirmed) {
        try {
            const res = await fetch(`/api/productos/${id}/fisico`, { method: 'DELETE', headers: getHeaders() });
            const data = await res.json();
            if (res.ok) {
                Swal.fire({ icon: 'success', title: 'PURGA COMPLETADA', text: data.mensaje, confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
                cargarAuditoria();
            } else { throw new Error(data.error); }
        } catch (e) { 
            Swal.fire({ icon: 'error', title: 'OPERACIÓN RECHAZADA', text: e.message, confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none border-t-4 border-t-red-500' } }); 
        }
    }
}