import { ProductoService, escapeHtml } from '../../js/api.js';

export async function init() {
    console.log("Iniciando Módulo de Auditoría...");
    cargarVencimientos();
    cargarAuditoria();

    window.cargarAuditoria = cargarAuditoria;
    window.accionReactivar = accionReactivar;
    window.accionBorrarDB = accionBorrarDB;
}

// Función auxiliar para obtener Headers con Token
const getHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
};

async function cargarVencimientos() {
    try {
        // CORRECCIÓN DE RUTA Y AGREGADO DE HEADERS
        const res = await fetch('/api/auditoria/vencimientos', { 
            headers: getHeaders() 
        });
        
        if (!res.ok) throw new Error('Error cargando vencimientos');

        const lotes = await res.json();
        const tbody = document.getElementById('tablaVencimientos');
        tbody.innerHTML = '';

        if(lotes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400">Todo fresco. No hay lotes por vencer.</td></tr>';
            return;
        }

        lotes.forEach(l => {
            let badgeClass = 'bg-green-100 text-green-800 border-green-200';
            let estado = 'Fresco';
            
            if (l.dias_restantes < 0) {
                badgeClass = 'bg-red-900 text-white border-red-900 animate-pulse'; 
                estado = 'VENCIDO';
            } else if (l.dias_restantes < 30) {
                badgeClass = 'bg-red-100 text-red-800 border-red-200';
                estado = 'Crítico';
            } else if (l.dias_restantes < 90) {
                badgeClass = 'bg-yellow-100 text-yellow-800 border-yellow-200';
                estado = 'Atención';
            }

            tbody.innerHTML += `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3">
                        <div class="font-bold text-gray-800">${l.nombre}</div>
                        <div class="text-xs text-gray-500">${l.cantidad_actual} Unid.</div>
                    </td>
                    <td class="px-4 py-3 text-center text-xs font-mono bg-gray-50 rounded">${l.codigo_lote}</td>
                    <td class="px-4 py-3 text-center">
                        <div class="font-bold text-gray-700">${new Date(l.fecha_vencimiento).toLocaleDateString()}</div>
                        <div class="text-[10px] text-gray-400">${l.dias_restantes} días</div>
                    </td>
                    <td class="px-4 py-3 text-center">
                        <span class="px-2 py-1 rounded text-[10px] font-bold border ${badgeClass}">${estado}</span>
                    </td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

async function cargarAuditoria() {
    try {
        const res = await fetch('/api/auditoria', { headers: getHeaders() });
        if (!res.ok) throw new Error('Error cargando logs');

        const logs = await res.json();
        const container = document.getElementById('listaLogs');

        // RENDIMIENTO: Si no hay logs, mostramos mensaje y salimos.
        if (logs.length === 0) {
            container.innerHTML = '<div class="p-4 text-center text-gray-500">Sin registros recientes.</div>';
            return;
        }

        // RENDIMIENTO EXTREMO: Usamos map + join para generar el HTML en memoria
        // Un solo "golpe" al DOM al final.
        container.innerHTML = logs.map(log => {
            let icon = 'fa-info-circle';
            let color = 'text-blue-400';
            let botonesAccion = '';

            // Lógica visual
            if(log.accion.includes('COMPRA')) { icon = 'fa-truck'; color = 'text-orange-400'; }
            if(log.accion.includes('VENTA')) { icon = 'fa-cash-register'; color = 'text-green-400'; }
            if(log.accion.includes('CREAR')) { icon = 'fa-plus'; color = 'text-purple-400'; }
            if(log.accion.includes('ELIMINAR_PROD')) { icon = 'fa-trash-can'; color = 'text-red-500'; }

            // Lógica de recuperación de datos eliminados
            if (log.accion === 'ELIMINAR_PROD') {
                const match = log.detalle.match(/ID (\d+)/);
                if (match) {
                    const idProd = match[1];
                    botonesAccion = `
                        <div class="mt-2 flex gap-2 justify-end border-t border-slate-700 pt-2">
                            <button onclick="accionReactivar(${idProd})" class="text-[10px] bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded transition flex items-center gap-1">
                                <i class="fa-solid fa-rotate-left"></i> Reactivar
                            </button>
                            <button onclick="accionBorrarDB(${idProd})" class="text-[10px] bg-red-900 hover:bg-red-700 text-white px-2 py-1 rounded transition flex items-center gap-1 border border-red-700">
                                <i class="fa-solid fa-skull"></i> Borrar BD
                            </button>
                        </div>
                    `;
                }
            }

            const fecha = new Date(log.fecha).toLocaleString();
            
            // SEGURIDAD: Sanitizamos los textos dinámicos
            const accionSegura = escapeHtml(log.accion);
            const detalleSeguro = escapeHtml(log.detalle);
            const usuarioSeguro = escapeHtml(log.usuario_nombre || 'Sistema Automático');

            return `
                <div class="flex gap-3 border-b border-slate-700 pb-2 mb-2 last:border-0 group hover:bg-slate-800/50 transition p-2 rounded">
                    <div class="mt-1"><i class="fa-solid ${icon} ${color}"></i></div>
                    <div class="w-full">
                        <div class="text-slate-300 font-bold flex justify-between">
                            <span>${accionSegura}</span>
                        </div>
                        <div class="text-slate-400 leading-tight text-sm font-mono mt-1">${detalleSeguro}</div>
                        ${botonesAccion}
                        <div class="text-slate-600 text-[10px] mt-2 flex justify-between w-full border-t border-slate-800 pt-1">
                            <span><i class="fa-solid fa-user"></i> ${usuarioSeguro}</span>
                            <span>${fecha}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join(''); // <--- AQUÍ OCURRE LA MAGIA (Unimos todo en un solo string)

    } catch (e) { 
        console.error(e); 
        document.getElementById('listaLogs').innerHTML = '<div class="text-red-400 p-4">Error cargando auditoría</div>';
    }
}

async function accionReactivar(id) {
    const confirm = await Swal.fire({
        title: '¿Reactivar Producto?',
        text: "Volverá a aparecer en el inventario y ventas.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'Sí, reactivar'
    });

    if (confirm.isConfirmed) {
        try {
            // CORRECCIÓN: Agregar headers
            const res = await fetch(`/api/productos/${id}/reactivar`, { 
                method: 'PUT',
                headers: getHeaders()
            });
            const data = await res.json();
            
            if (res.ok) {
                Swal.fire('Activado', data.mensaje, 'success');
                cargarAuditoria(); 
            } else {
                Swal.fire('Error', data.error, 'error');
            }
        } catch (e) { console.error(e); }
    }
}

async function accionBorrarDB(id) {
    const confirm = await Swal.fire({
        title: '¿BORRADO DEFINITIVO?',
        html: "Se intentará borrar de la base de datos.<br><b style='color:red'>¡Esta acción NO se puede deshacer!</b>",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#7f1d1d', 
        confirmButtonText: 'Sí, destruir datos'
    });

    if (confirm.isConfirmed) {
        try {
            // CORRECCIÓN: Agregar headers
            const res = await fetch(`/api/productos/${id}/fisico`, { 
                method: 'DELETE',
                headers: getHeaders()
            });
            const data = await res.json();
            
            if (res.ok) {
                Swal.fire('Eliminado', data.mensaje, 'success');
                cargarAuditoria();
            } else {
                Swal.fire('Operación Bloqueada', data.error, 'error');
            }
        } catch (e) { console.error(e); }
    }
}