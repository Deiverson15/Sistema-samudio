
import { ProductoService, ProveedorService, CompraService, escapeHtml } from '../../js/api.js';

export async function init() {
    console.log("Iniciando Módulo de Compras Actualizado...");
    
    const selectProv = document.getElementById('prov_id');
    const formMaster = document.getElementById('formMaster');

    if (!selectProv || !formMaster) return;

    // 1. Cargar datos iniciales
    try {
        const [proveedores, productos] = await Promise.all([
            ProveedorService.getAll(),
            ProductoService.getAll()
        ]);
        
        selectProv.innerHTML = '<option value="">-- Proveedor --</option>';
        proveedores.forEach(p => selectProv.innerHTML += `<option value="${p.id}">${p.empresa}</option>`);

        const dataList = document.getElementById('listaProductosDistribucion');
        if (dataList) {
            const lista = Array.isArray(productos) ? productos : (productos.data || []);
            dataList.innerHTML = lista.map(p => 
                `<option value="${p.nombre}" data-id="${p.id}">${p.categoria}</option>`
            ).join('');
        }

        // Poner fecha de hoy por defecto
        document.getElementById('fecha_compra').valueAsDate = new Date();

    } catch(e) { console.error(e); }

    // 2. Registrar Compra
    formMaster.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = formMaster.querySelector('button');
        const originalText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        const data = {
            factura: document.getElementById('factura').value,
            fecha_compra: document.getElementById('fecha_compra').value,
            fecha_reposicion: document.getElementById('fecha_reposicion').value,
            costo_total: document.getElementById('costo_total').value,
            peso_total_kg: document.getElementById('peso_total').value,
            proveedor_id: selectProv.value
        };

        const res = await CompraService.registrar(data);
        
        if (res.error) {
            Swal.fire('Error', res.error, 'error');
        } else {
            Swal.fire({ icon: 'success', title: 'Registrado', text: 'Lote creado correctamente.', timer: 1500, showConfirmButton: false });
            formMaster.reset();
            document.getElementById('fecha_compra').valueAsDate = new Date(); // Reset fecha a hoy
            cargarTabla();
        }
        btn.disabled = false; btn.innerHTML = originalText;
    });

    cargarTabla();
    window.cargarTabla = cargarTabla;
    window.abrirModalDistribuir = abrirModalDistribuir;
    window.verHistorial = verHistorial; // Nueva función global
}

// --- FUNCIÓN CARGAR TABLA COMPLETA ---
async function cargarTabla() {
    const tbody = document.getElementById('listaLotesMaster');
    const emptyState = document.getElementById('emptyState');
    
    try {
        // 1. Obtener datos del backend
        const lotes = await CompraService.getAll();
        
        // 2. Manejo de estado vacío
        if (!lotes || lotes.length === 0) {
            tbody.innerHTML = '';
            if(emptyState) emptyState.classList.remove('hidden');
            return;
        }
        
        if(emptyState) emptyState.classList.add('hidden');

        // 3. Preparar fecha de hoy para comparaciones (sin horas)
        const hoy = new Date();
        hoy.setHours(0,0,0,0);

        // 4. Generar HTML
        tbody.innerHTML = lotes.map(l => {
            
            // Lógica de Alerta de Reposición
            let alertaHtml = '<span class="text-gray-300 text-xs">-</span>';
            
            if (l.fecha_reposicion_fmt) {
                // Crear fecha desde el string 'YYYY-MM-DD' para evitar problemas de zona horaria
                const [year, month, day] = l.fecha_reposicion_fmt.split('-').map(Number);
                const fechaRepo = new Date(year, month - 1, day); 
                
                const esUrgente = fechaRepo <= hoy; // Si la fecha ya pasó o es hoy
                
                if (esUrgente) {
                    alertaHtml = `
                        <div class="flex flex-col items-center justify-center animate-pulse">
                            <div class="bg-red-100 text-red-700 px-2 py-1 rounded-lg border border-red-200 shadow-sm flex items-center gap-1.5 mb-1">
                                <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                                <span class="font-bold text-xs">¡REPONER!</span>
                            </div>
                            <span class="text-[10px] text-red-600 font-medium">${l.fecha_reposicion_fmt}</span>
                        </div>
                    `;
                } else {
                    alertaHtml = `
                        <div class="flex flex-col items-center">
                            <span class="text-gray-600 font-medium text-xs bg-gray-100 px-2 py-1 rounded-md border border-gray-200">
                                ${l.fecha_reposicion_fmt}
                            </span>
                            <span class="text-[9px] text-gray-400 mt-0.5">Pendiente</span>
                        </div>
                    `;
                }
            }

            // Renderizado de la Fila
            return `
            <tr class="hover:bg-indigo-50/30 transition duration-150 group">
                
                <td class="px-5 py-4">
                    <div class="flex items-center gap-3">
                        <div class="bg-indigo-100 text-indigo-600 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs shadow-sm">
                            <i class="fa-solid fa-receipt"></i>
                        </div>
                        <div>
                            <div class="font-bold text-gray-800 text-sm group-hover:text-indigo-700 transition">${l.factura}</div>
                            <div class="text-xs text-gray-500 font-medium">${l.proveedor_nombre || 'Proveedor Desconocido'}</div>
                            <div class="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                                <i class="fa-regular fa-calendar"></i> ${l.fecha_compra_fmt || 'Sin fecha'}
                            </div>
                        </div>
                    </div>
                </td>

                <td class="px-5 py-4 text-center align-middle">
                    ${alertaHtml}
                </td>

                <td class="px-5 py-4 text-center">
                    <div class="font-mono text-gray-700 font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded inline-block border border-emerald-100 text-xs shadow-sm">
                        $${parseFloat(l.costo_total || 0).toFixed(2)}
                    </div>
                </td>

                <td class="px-5 py-4 text-center">
                    <span class="text-xs font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded border border-gray-200">
                        ${parseFloat(l.peso_total_kg).toFixed(3)} Kg
                    </span>
                </td>

                <td class="px-5 py-4 text-center">
                     <span class="text-sm font-bold ${parseFloat(l.peso_pendiente_kg) > 0 ? 'text-indigo-600' : 'text-gray-300'}">
                        ${parseFloat(l.peso_pendiente_kg).toFixed(3)} Kg
                     </span>
                     ${parseFloat(l.peso_pendiente_kg) > 0 ? '<div class="h-1.5 w-full bg-gray-100 rounded-full mt-1 overflow-hidden"><div class="h-full bg-indigo-500 rounded-full" style="width: ' + (l.peso_pendiente_kg / l.peso_total_kg * 100) + '%"></div></div>' : ''}
                </td>

                <td class="px-5 py-4 text-center">
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border shadow-sm flex items-center justify-center gap-1 w-fit mx-auto
                        ${l.estado === 'COMPLETADO' 
                            ? 'bg-green-50 text-green-600 border-green-200' 
                            : 'bg-yellow-50 text-yellow-600 border-yellow-200 animate-pulse-slow'}">
                        <i class="fa-solid ${l.estado === 'COMPLETADO' ? 'fa-check' : 'fa-spinner'}"></i>
                        ${l.estado}
                    </span>
                </td>

                <td class="px-5 py-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <button onclick="verHistorial(${l.id}, '${l.factura}')" 
                            class="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition shadow-sm flex items-center justify-center" 
                            title="Ver Historial de Distribución">
                            <i class="fa-solid fa-list-ol"></i>
                        </button>

                        ${l.estado !== 'COMPLETADO' ? 
                            `<button onclick="abrirModalDistribuir(${l.id}, ${l.peso_pendiente_kg})" 
                                class="bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md hover:shadow-lg transition flex items-center gap-1.5 transform hover:-translate-y-0.5">
                                <i class="fa-solid fa-dolly"></i> Distribuir
                            </button>` 
                            : 
                            `<span class="text-green-500 text-xl" title="Lote finalizado"><i class="fa-solid fa-circle-check"></i></span>`
                        }
                    </div>
                </td>
            </tr>
            `;
        }).join('');

    } catch (e) {
        console.error("Error cargando tabla:", e);
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center p-8">
                    <div class="flex flex-col items-center text-red-400 opacity-80">
                        <i class="fa-solid fa-wifi text-4xl mb-2"></i>
                        <p>No se pudo conectar con el servidor.</p>
                    </div>
                </td>
            </tr>`;
    }
}

// --- NUEVO: VER KARDEX (CORREGIDO) ---
async function verHistorial(id, factura) {
    try {
        const token = localStorage.getItem('token');
        if (!token) { Swal.fire('Error', 'Sesión expirada', 'error'); return; }

        const res = await fetch(`/api/compras/${id}/historial`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // 1. SI LA RESPUESTA NO ES OK (Ej. error 500 o 403), LANZAR ERROR
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Error del servidor al obtener historial');
        }

        const historial = await res.json();
        
        // 2. VERIFICAR QUE SEA UN ARRAY ANTES DE USAR forEach
        if (!Array.isArray(historial)) {
            throw new Error("El servidor no devolvió una lista válida");
        }

        // Construir tabla HTML...
        let htmlTabla = `
            <div class="overflow-hidden rounded-lg border border-gray-200">
                <table class="w-full text-sm text-left">
                    <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                            <th class="p-3">Producto Destino</th>
                            <th class="p-3 text-right">Peso (Kg)</th>
                            <th class="p-3 text-right">Gramos</th>
                            <th class="p-3 text-center">Fecha</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
        `;

        if (historial.length === 0) {
            htmlTabla += `<tr><td colspan="4" class="p-4 text-center text-gray-400 italic">Aún no se ha distribuido nada de este lote.</td></tr>`;
        } else {
            historial.forEach(h => {
                htmlTabla += `
                    <tr>
                        <td class="p-3 font-medium text-gray-700">${h.producto_nombre} <span class="text-xs text-gray-400">(${h.categoria})</span></td>
                        <td class="p-3 text-right font-mono text-red-500">-${h.peso_asignado_kg}</td>
                        <td class="p-3 text-right font-mono text-green-600">+${h.gramos_añadidos}g</td>
                        <td class="p-3 text-center text-xs text-gray-500">${new Date(h.fecha_distribucion).toLocaleDateString()}</td>
                    </tr>
                `;
            });
        }
        htmlTabla += `</tbody></table></div>`;

        Swal.fire({
            title: `Kardex: Factura ${factura}`,
            html: htmlTabla,
            width: '600px',
            showConfirmButton: true,
            confirmButtonText: 'Cerrar'
        });

    } catch(error) {
        console.error(error);
        Swal.fire('Error', error.message, 'error');
    }
}

async function registrarPeso() {
    const btn = document.querySelector('#formCompra button');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

    const data = {
        proveedor_id: document.getElementById('proveedor_id').value,
        producto_id: document.getElementById('producto_id').value,
        numero_factura: document.getElementById('numero_factura').value,
        peso_kg: document.getElementById('peso_kg').value
    };

    if(!data.producto_id || !data.peso_kg) {
        Swal.fire('Error', 'Debes seleccionar un producto y un peso válido.', 'warning');
        btn.disabled = false; btn.innerHTML = originalText;
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/compras/registrar', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });
        
        const result = await res.json();

        if(res.ok) {
            Swal.fire({
                icon: 'success',
                title: 'Peso Registrado',
                text: 'La mercancía está en sala de espera. Ahora pulsa "Distribuir" en la tabla para ingresarla al inventario.'
            });
            document.getElementById('formCompra').reset();
            document.getElementById('producto_id').value = '';
            cargarTabla();
        } else {
            Swal.fire('Error', result.error, 'error');
        }

    } catch (error) {
        Swal.fire('Error', 'Fallo de conexión', 'error');
    }
    
    btn.disabled = false; 
    btn.innerHTML = originalText;
}

async function distribuir(idMaster, pesoDisponible) {
    const { value: formValues } = await Swal.fire({
        title: 'Distribuir a Inventario',
        html: `
            <div class="text-left">
                <label class="text-xs font-bold">BUSCAR PRODUCTO (Esencia, Alcohol, etc.)</label>
                <input id="swal-prod" class="swal2-input" placeholder="Nombre del producto">
                <label class="text-xs font-bold mt-3 block">KG A DESCONTAR DEL LOTE (Disponible: ${pesoDisponible}kg)</label>
                <input id="swal-peso" type="number" step="0.01" class="swal2-input" placeholder="0.00">
            </div>
        `,
        focusConfirm: false,
        preConfirm: () => {
            return {
                producto_id: document.getElementById('swal-prod').getAttribute('data-id'),
                peso_kg: document.getElementById('swal-peso').value
            }
        }
    });

    if (formValues) {
        // Aquí llamas al controlador para restar del lote y sumar al producto en gramos
        const res = await CompraService.distribuir({
            lote_maestro_id: idMaster,
            producto_id: formValues.producto_id,
            peso_kg: formValues.peso_kg
        });
        
        if(res.ok) {
            Swal.fire('¡Éxito!', 'Gramos añadidos al inventario', 'success');
            cargarTabla();
        }
    }
}


// Variables globales para el "Carrito" de distribución
window.listaDistTemporal = [];
window.pesoDispActual = 0;

window.agregarItemDistribucion = function() {
    const id = document.getElementById('swal-producto-id').value;
    const nombre = document.getElementById('swal-buscador-prod').value;
    const peso = parseFloat(document.getElementById('swal-peso').value);

    if (!id || !nombre) {
        Swal.showValidationMessage('Busca y selecciona un producto.');
        return;
    }
    if (!peso || peso <= 0) {
        Swal.showValidationMessage('El peso debe ser mayor a 0.');
        return;
    }
    
    // Verificar si el peso sumado a lo que ya está en la lista excede lo disponible
    const pesoAcumulado = window.listaDistTemporal.reduce((acc, item) => acc + item.peso_kg, 0);
    if ((pesoAcumulado + peso) > window.pesoDispActual) {
        Swal.showValidationMessage(`Límite excedido. Solo quedan ${(window.pesoDispActual - pesoAcumulado).toFixed(2)} Kg.`);
        return;
    }

    // Añadir al arreglo temporal
    window.listaDistTemporal.push({ producto_id: id, nombre: nombre, peso_kg: peso });
    
    // Limpiar inputs
    document.getElementById('swal-buscador-prod').value = '';
    document.getElementById('swal-producto-id').value = '';
    document.getElementById('swal-peso').value = '';
    
    Swal.resetValidationMessage();
    window.actualizarTablaDistribucion();
};

window.eliminarItemDistribucion = function(index) {
    window.listaDistTemporal.splice(index, 1);
    window.actualizarTablaDistribucion();
};

window.actualizarTablaDistribucion = function() {
    const tbody = document.getElementById('swal-tbody-dist');
    const lblDisp = document.getElementById('lblDisponible');
    if(!tbody || !lblDisp) return;

    let html = '';
    let totalPesado = 0;
    
    window.listaDistTemporal.forEach((item, index) => {
        totalPesado += item.peso_kg;
        html += `
            <tr class="border-b border-neutral-200 hover:bg-neutral-50 transition-colors">
                <td class="p-3 text-[10px] font-black uppercase text-neutral-800">${item.nombre}</td>
                <td class="p-3 text-center text-indigo-600 font-mono font-bold">${item.peso_kg.toFixed(3)} Kg</td>
                <td class="p-3 text-center">
                    <button onclick="window.eliminarItemDistribucion(${index})" class="text-red-500 hover:bg-red-100 rounded p-1 transition-colors"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
    
    if(window.listaDistTemporal.length === 0){
        html = `<tr><td colspan="3" class="p-4 text-center text-[10px] uppercase font-bold text-neutral-400">Ningún producto añadido a la lista</td></tr>`;
    }

    tbody.innerHTML = html;
    lblDisp.innerText = (window.pesoDispActual - totalPesado).toFixed(3) + ' Kg';
};

// LA NUEVA MODAL PRINCIPAL
async function abrirModalDistribuir(loteId, disponible) {
    window.listaDistTemporal = [];
    window.pesoDispActual = parseFloat(disponible);

    const { value: proceder } = await Swal.fire({
        title: 'Distribución Masiva',
        width: '700px',
        html: `
            <div class="text-left space-y-4 bg-neutral-50 p-4 border border-neutral-300">
                <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div class="md:col-span-6 relative">
                        <label class="block text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1"><i class="fa-solid fa-magnifying-glass mr-1"></i> Buscar Esencia / Producto</label>
                        <input id="swal-buscador-prod" type="text" class="swal2-input w-full m-0 text-xs font-bold px-3 py-3 rounded-none outline-none focus:border-neutral-900 border border-neutral-300" placeholder="Ej: DIOR SAUVAGE..." autocomplete="off">
                        <div id="swal-dropdown" class="absolute left-0 right-0 top-full mt-1 bg-white border border-neutral-300 shadow-xl max-h-48 overflow-y-auto hidden z-50"></div>
                        <input type="hidden" id="swal-producto-id">
                    </div>
                    
                    <div class="md:col-span-4">
                        <label class="block text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1"><i class="fa-solid fa-weight-scale mr-1"></i> Peso (Kg)</label>
                        <input id="swal-peso" type="number" step="0.001" class="swal2-input w-full m-0 font-mono font-black text-center text-lg py-1.5 rounded-none border border-neutral-300 focus:border-neutral-900" placeholder="0.000">
                    </div>
                    
                    <div class="md:col-span-2">
                        <button onclick="window.agregarItemDistribucion()" class="bg-neutral-950 hover:bg-neutral-800 transition-colors text-white w-full py-3 text-[10px] uppercase font-black tracking-widest shadow-lg h-full"><i class="fa-solid fa-plus"></i> Añadir</button>
                    </div>
                </div>
            </div>

            <div class="flex justify-between items-center mt-6 mb-2 border-b border-neutral-300 pb-2">
                <span class="text-[10px] font-black text-neutral-900 uppercase tracking-widest">Lista de Envío Múltiple</span>
                <div class="text-right text-[10px] font-black uppercase tracking-widest text-neutral-500">
                    Restante en Tambor: <span id="lblDisponible" class="text-indigo-600 bg-indigo-50 px-2 py-1 border border-indigo-200">${disponible} Kg</span>
                </div>
            </div>
            
            <div class="border border-neutral-300 overflow-hidden bg-white max-h-56 overflow-y-auto">
                <table class="w-full text-left">
                    <thead class="bg-neutral-100 text-[9px] uppercase font-black text-neutral-500 tracking-widest border-b border-neutral-300 sticky top-0">
                        <tr>
                            <th class="p-3">Producto Destino</th>
                            <th class="p-3 text-center">Descuento</th>
                            <th class="p-3 text-center">Eliminar</th>
                        </tr>
                    </thead>
                    <tbody id="swal-tbody-dist">
                        <tr><td colspan="3" class="p-4 text-center text-[10px] uppercase font-bold text-neutral-400">Ningún producto añadido a la lista</td></tr>
                    </tbody>
                </table>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-bolt text-yellow-400"></i> ENVIAR LOTE A BASE DE DATOS',
        cancelButtonText: 'Cancelar',
        customClass: {
            confirmButton: 'bg-neutral-950 text-white rounded-none uppercase tracking-widest text-[10px] font-black hover:bg-neutral-800 px-6 py-4 w-full md:w-auto mt-4 md:mt-0',
            cancelButton: 'bg-white border border-neutral-300 text-neutral-500 rounded-none uppercase tracking-widest text-[10px] font-black hover:bg-neutral-100 px-6 py-4 w-full md:w-auto mt-2 md:mt-0',
            actions: 'flex flex-col md:flex-row gap-2 w-full mt-6',
        },
        didOpen: () => {
            // Lógica del buscador desplegable (exactamente igual a tu diseño original)
            const inputBuscador = document.getElementById('swal-buscador-prod');
            const dropdown = document.getElementById('swal-dropdown');
            const inputId = document.getElementById('swal-producto-id');
            let debounceTimer;

            document.addEventListener('click', (e) => {
                if (inputBuscador && dropdown && !inputBuscador.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.add('hidden');
            });

            inputBuscador.addEventListener('input', (e) => {
                const termino = e.target.value.trim();
                inputId.value = ''; 
                if (termino.length < 2) { dropdown.classList.add('hidden'); return; }

                dropdown.innerHTML = '<div class="p-4 text-center text-[10px] text-neutral-400 font-black uppercase tracking-widest animate-pulse">Buscando...</div>';
                dropdown.classList.remove('hidden');

                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    try {
                        const response = await ProductoService.getAll(1, 30, termino, false);
                        const filtrados = Array.isArray(response) ? response : (response.data || []);
                        dropdown.innerHTML = '';
                        
                        if (filtrados.length === 0) {
                            dropdown.innerHTML = '<div class="p-4 text-center text-[10px] text-red-500 font-black uppercase tracking-widest">No hay resultados</div>';
                            return;
                        }
                        
                        filtrados.forEach(p => {
                            const div = document.createElement('div');
                            div.className = 'p-3 border-b border-neutral-100 hover:bg-neutral-50 cursor-pointer transition-colors';
                            div.innerHTML = `<div class="font-black text-neutral-900 text-xs uppercase">${p.nombre}</div><div class="text-[9px] text-neutral-500 font-bold uppercase mt-1">${p.categoria}</div>`;
                            div.onclick = () => { inputBuscador.value = p.nombre; inputId.value = p.id; dropdown.classList.add('hidden'); };
                            dropdown.appendChild(div);
                        });
                    } catch (error) { dropdown.innerHTML = '<div class="p-4 text-center text-[10px] text-red-500 font-black">Error DB</div>'; }
                }, 400); 
            });
        },
        preConfirm: () => {
            if (window.listaDistTemporal.length === 0) {
                Swal.showValidationMessage('Añade al menos un producto a la lista inferior antes de procesar.');
                return false;
            }
            return true;
        }
    });

    if (proceder) {
        Swal.fire({ title: 'Inyectando Base de Datos...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/compras/distribuir-masivo', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    lote_maestro_id: loteId,
                    distribuciones: window.listaDistTemporal
                })
            });

            const result = await response.json();

            if (response.ok) {
                Swal.fire({ icon: 'success', title: '¡Éxito!', text: result.mensaje, confirmButtonColor: '#0a0a0a' });
                cargarTabla();
            } else {
                throw new Error(result.error || 'Fallo desconocido en servidor');
            }
        } catch (error) {
            Swal.fire('Error', error.message, 'error');
        }
    }
}