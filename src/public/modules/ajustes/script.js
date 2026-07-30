import { ProductoService, AjusteService } from '../../js/api.js';

let productosCache = [];

const MOTIVOS_SALIDA = [
    "Merma (Rotura/Daño)",
    "Merma (Vencimiento)",
    "Diferencia de Inventario (Faltante)",
    "Uso Interno / Consumo",
    "Robo",
    "Salida por Donación",
    "Otro (Salida Administrativa)"
];

const MOTIVOS_ENTRADA = [
    "Compra / Reposición",
    "Devolución de Cliente",
    "Diferencia de Inventario (Sobrante)",
    "Bonificación Proveedor",
    "Inventario Inicial",
    "Otro (Entrada Administrativa)"
];

export async function init() {
    console.log("🚀 Módulo Ajustes: Iniciado (Modo Práctico)");

    // Exponer al window PRIMERO para que el HTML y el Init las reconozcan
    window.abrirModalSeleccion = abrirModalSeleccion;
    window.cerrarModalSeleccion = cerrarModalSeleccion;
    window.seleccionarProducto = seleccionarProducto;
    window.guardarTasaGlobal = guardarTasaGlobal;

    // 1. Cargar productos en segundo plano
    cargarProductosCache();

    // 2. Event listeners del Modal
    const inputFiltro = document.getElementById('inputFiltroModal');
    if(inputFiltro) {
        inputFiltro.addEventListener('input', (e) => filtrarLista(e.target.value));
    }

    // 3. Submit del Formulario
    const form = document.getElementById('formAjuste');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await procesarAjuste();
        });
    }

    // 4. Cambios de Radio Button (Entrada vs Salida)
    const radios = document.getElementsByName('tipo');
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            window.actualizarUIporTipo(); // Usamos window. para asegurar alcance
        });
    });

    // 5. Estado inicial (Ya no dará error porque la función ya existe)
    window.actualizarUIporTipo();

    await cargarTasaActual();
}

async function cargarProductosCache() {
    try {
        const res = await ProductoService.getAll(1, 2000); 
        productosCache = res.data || [];
    } catch (e) {
        console.error("Error cargando caché de productos:", e);
    }
}

// --- TASA GLOBAL ---
async function cargarTasaActual() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ajustes/tasa', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const input = document.getElementById('inputTasaGlobal');
        if(input) input.value = data.tasa;
    } catch (e) { console.error("Error tasa:", e); }
}

async function guardarTasaGlobal() {
    const inputTasa = document.getElementById('inputTasaGlobal'); // Verifica que este ID coincida con tu HTML
    if (!inputTasa) return;

    const nuevaTasa = parseFloat(inputTasa.value);
    
    if (isNaN(nuevaTasa) || nuevaTasa <= 0) {
        return Swal.fire('Error', 'Debes ingresar un valor válido para la tasa.', 'warning');
    }

    try {
        Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });
        const token = localStorage.getItem('token');
        
        // Petición a tu backend (asegúrate de que la ruta sea correcta según tu API)
        const res = await fetch('/api/ajustes/tasa', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ tasa: nuevaTasa })
        });

        if (!res.ok) throw new Error('No se pudo guardar la tasa');

        Swal.fire({
            icon: 'success',
            title: 'Tasa Actualizada',
            text: `La nueva tasa BCV es: Bs ${nuevaTasa.toFixed(2)}`,
            timer: 1500,
            showConfirmButton: false,
            customClass: { popup: 'rounded-none' }
        });

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Hubo un problema de conexión al guardar la tasa.', 'error');
    }
}

// =====================================================================
// MOTOR DE LA INTERFAZ DE AJUSTES (ENTRADAS / SALIDAS / LOTES)
// =====================================================================
window.actualizarUIporTipo = function() {
    // 1. Leemos qué botones están seleccionados en el HTML
    const tipoActivo = document.querySelector('input[name="tipo"]:checked')?.value || 'SALIDA';
    const ubicacionActiva = document.querySelector('input[name="ubicacion_ajuste"]:checked')?.value || 'DEPOSITO';

    // 2. Cambiamos el Título Principal
    const titulo = document.getElementById('tituloAccion');
    if (titulo) titulo.innerText = `Ajuste de ${tipoActivo}`;

    // 3. Cargamos la lista de motivos correctos (Entrada vs Salida)
    const selectMotivo = document.getElementById('motivo');
    if (selectMotivo) {
        selectMotivo.innerHTML = '';
        const listaMotivos = tipoActivo === 'SALIDA' ? MOTIVOS_SALIDA : MOTIVOS_ENTRADA;
        
        listaMotivos.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            selectMotivo.appendChild(option);
        });
    }

    // 4. Lógica Inteligente para el Panel de Lotes
    const panelLotes = document.getElementById('panelLotes');
    const selectLoteContainer = document.getElementById('selectorLoteContainer');
    const inputLoteManualContainer = document.getElementById('inputLoteManualContainer');

    if (panelLotes && selectLoteContainer && inputLoteManualContainer) {
        if (ubicacionActiva === 'DEPOSITO') {
            // Si tocamos el Almacén, se enciende el panel de Lotes
            panelLotes.classList.remove('hidden');
            
            if (tipoActivo === 'SALIDA') {
                // Si sacamos mercancía, debemos ELEGIR un lote existente
                selectLoteContainer.classList.remove('hidden');
                inputLoteManualContainer.classList.add('hidden');
            } else {
                // Si metemos mercancía, podemos CREAR un lote nuevo
                selectLoteContainer.classList.add('hidden');
                inputLoteManualContainer.classList.remove('hidden');
            }
        } else {
            // Si tocamos el Estante (Mostrador), los lotes no existen allí
            panelLotes.classList.add('hidden');
        }
    }
};

// =====================================================================
// RENDERING ACTUALIZADO DEL DASHBOARD PERFUMIX
// =====================================================================
function actualizarUIdashboard(data) {
    if (!data) return;

    // 1. Mapeo de indicadores de ventas y stock mínimos (Existentes)
    if(document.getElementById('salesHoy')) {
        document.getElementById('salesHoy').innerText = `$${parseFloat(data.sales?.ventas_hoy || 0).toFixed(2)}`;
    }
    if(document.getElementById('transaccionesHoy')) {
        document.getElementById('transaccionesHoy').innerText = data.sales?.transacciones_hoy || 0;
    }
    if(document.getElementById('lowStockCount Badge')) {
        document.getElementById('lowStockCount Badge').innerText = data.lowStock?.low_stock_count || 0;
    }

    // 📦 2. REINYECCIÓN: Distribución Antigua (Llenado de datos desde backend)
    // El backend envía las propiedades: dist_hoy, dist_semana y dist_mes
    if(document.getElementById('distHoy')) {
        document.getElementById('distHoy').innerText = parseFloat(data.inventory?.dist_hoy || 0).toFixed(0);
    }
    if(document.getElementById('distSemana')) {
        document.getElementById('distSemana').innerText = parseFloat(data.inventory?.dist_semana || 0).toFixed(0);
    }
    if(document.getElementById('distMes')) {
        document.getElementById('distMes').innerText = parseFloat(data.inventory?.dist_mes || 0).toFixed(0);
    }

    // 🏆 3. Renderizado del Listado Top de Perfumes (Ocupa el bloque izquierdo inferior ahora)
    const containerRanking = document.getElementById('containerRankingDashboard');
    if (containerRanking) {
        const ranking = data.ranking || [];
        if (ranking.length === 0) {
            containerRanking.innerHTML = `<div class="text-center text-neutral-400 py-10 font-bold uppercase text-[10px] tracking-widest">Sin transacciones registradas en este período.</div>`;
        } else {
            // Pintamos el Top 5 con barras limpias de proporción
            containerRanking.innerHTML = ranking.slice(0, 5).map((item, index) => `
                <div class="flex justify-between items-center py-3 last:pb-0">
                    <div class="flex items-center gap-4">
                        <span class="font-mono font-black text-neutral-900 bg-neutral-100 w-6 h-6 flex items-center justify-center text-[10px]">#${index + 1}</span>
                        <div>
                            <div class="font-black text-neutral-950 text-xs uppercase tracking-wide">${escapeHtml(item.nombre)}</div>
                            <div class="text-[9px] text-neutral-400 font-bold uppercase tracking-widest mt-0.5">${escapeHtml(item.categoria)}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="font-black text-neutral-950 text-xs tracking-tight">${parseFloat(item.cantidad_vendida).toFixed(0)} UDS.</div>
                        <div class="text-[9px] text-emerald-600 font-bold font-mono mt-0.5">+$${parseFloat(item.total_generado).toFixed(2)}</div>
                    </div>
                </div>
            `).join('');
        }
    }
}

window.cambiarUbicacionAjusteUI = function() {
    actualizarUIporTipo();
};

function cargarMotivos(lista) {
    const select = document.getElementById('motivo');
    select.innerHTML = '';
    lista.forEach(m => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = m;
        select.appendChild(option);
    });
}

// --- BUSCADOR Y SELECCIÓN ---
function abrirModalSeleccion() {
    document.getElementById('modalBusqueda').classList.remove('hidden');
    const input = document.getElementById('inputFiltroModal');
    input.value = '';
    input.focus();
    filtrarLista('');
}

window.cerrarModalSeleccion = function() {
    document.getElementById('modalBusqueda').classList.add('hidden');
}

function filtrarLista(texto) {
    const contenedor = document.getElementById('listaResultadosModal');
    contenedor.innerHTML = '';
    
    const busqueda = texto.toLowerCase();
    const filtrados = productosCache.filter(p => 
        p.nombre.toLowerCase().includes(busqueda) || 
        (p.codigo && p.codigo.toLowerCase().includes(busqueda))
    ).slice(0, 50);

    if (filtrados.length === 0) {
        contenedor.innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-slate-400">
                <i class="fa-solid fa-box-open text-4xl mb-3 opacity-20"></i>
                <p>No se encontraron productos.</p>
            </div>`;
        return;
    }

    filtrados.forEach(p => {
        // Formateo visual para decimales (si es 50.00 -> 50, si es 50.50 -> 50.50)
        const stockFmt = parseFloat(p.stock_real).toFixed(2).replace(/\.00$/, ''); 
        const unidad = p.unidad_medida || 'u'; 
        const nombreSafe = p.nombre.replace(/'/g, "\\'");
        const unidadCorta = p.unidad_medida === 'GRAMOS' ? 'g' : (p.unidad_medida === 'MILILITROS' ? 'ml' : 'u');

        contenedor.innerHTML += `
            <div onclick="seleccionarProducto(${p.id}, '${nombreSafe}', ${p.stock_real}, '${unidad}')" 
                 class="flex justify-between items-center p-4 bg-white border border-slate-100 rounded-xl cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition mb-2">
                <div>
                    <div class="font-bold text-slate-700">${p.nombre}</div>
                    <div class="text-xs text-slate-400 flex gap-2">
                         <span class="bg-slate-100 px-2 rounded">${p.codigo || 'S/N'}</span>
                         <span>${p.marca || ''}</span>
                    </div>
                </div>
                <div class="text-right">
                    <span class="font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-full text-xs border border-slate-200">
                        ${stockFmt} ${unidadCorta}
                    </span>
                </div>
            </div>
        `;
    });
}

window.seleccionarProducto = async function(id, nombre, stock, unidad) {
    // 1. Setear datos básicos
    document.getElementById('producto_id').value = id;
    document.getElementById('nombreProductoDisplay').value = nombre;
    
    // Buscar datos completos del producto en la caché local
    const productoObj = productosCache.find(p => p.id === id) || {};
    const categoria = (productoObj.categoria || '').toUpperCase();
    const nombreUpper = nombre.toUpperCase();

    // 2. Configurar las opciones de magnitudes dinámicas según la categoría/producto
    const selectUnidades = document.getElementById('unidadSeleccion');
    selectUnidades.innerHTML = ''; // Limpiar opciones anteriores

    if (categoria.includes('ALCOHOL') || nombreUpper.includes('ALCOHOL')) {
        // Para Alcohol: Mililitros y Litros
        selectUnidades.innerHTML = `
            <option value="ML">ML</option>
            <option value="L">L</option>
        `;
    } else if (categoria.includes('ESENCIA') || nombreUpper.includes('ESENCIA')) {
        // Para Esencias: Gramos y Kilogramos
        selectUnidades.innerHTML = `
            <option value="G">G</option>
            <option value="KG">K</option>
        `;
    } else {
        // Para cualquier otro producto: Unidades por defecto
        selectUnidades.innerHTML = `
            <option value="UNIDAD">UNIDADES</option>
        `;
    }

    // 3. Actualizar etiquetas de UI para visualizar el stock registrado
    const mapUnidadesBadge = {
        'GRAMOS': 'g',
        'MILILITROS': 'ml',
        'UNIDAD': 'u'
    };
    const unidadFmt = mapUnidadesBadge[unidad] || 'u';
    document.getElementById('stockUnitBadge').innerText = unidadFmt; 
    document.getElementById('stockValue').innerText = parseFloat(stock).toFixed(2).replace(/\.00$/, '');
    document.getElementById('stockBadge').classList.remove('hidden');
    
    cerrarModalSeleccion();
    actualizarUIporTipo(); 

    // 4. Cargar Lotes para Salida (Si aplica)
    const selectLotes = document.getElementById('loteSeleccion');
    if (selectLotes) {
        selectLotes.innerHTML = '<option>Consultando lotes...</option>';

        try {
            const res = await fetch(`/api/productos/${id}/lotes`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
            const lotes = await res.json();
            
            selectLotes.innerHTML = ''; 

            if(!lotes || lotes.length === 0) {
                selectLotes.innerHTML = '<option value="">⚠️ No hay lotes con stock</option>';
            } 
            else if(lotes.length === 1) {
                const l = lotes[0];
                const cantFmt = parseFloat(l.cantidad_actual).toFixed(2).replace(/\.00$/, '');
                selectLotes.innerHTML = `
                    <option value="${l.id}" selected>
                        ✅ LOTE ÚNICO: ${l.codigo_lote} (Disp: ${cantFmt} ${unidadFmt})
                    </option>`;
                
                const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
                Toast.fire({ icon: 'info', title: 'Lote único seleccionado automáticamente' });
                
                document.getElementById('cantidad').focus();
            } 
            else {
                selectLotes.innerHTML = `<option value="">👇 -- EXISTEN ${lotes.length} LOTES. ELIGE UNO --</option>`;
                selectLotes.innerHTML += `<option value="">⚡ Automático (Más Antiguo Primero)</option>`;

                lotes.forEach(l => {
                    const cantFmt = parseFloat(l.cantidad_actual).toFixed(2).replace(/\.00$/, '');
                    const fecha = new Date(l.fecha_vencimiento).toLocaleDateString();
                    const esVencido = new Date(l.fecha_vencimiento) < new Date();
                    
                    selectLotes.innerHTML += `
                        <option value="${l.id}">
                            ${esVencido ? '⚠️' : '📦'} ${l.codigo_lote} | Disp: ${cantFmt} | Vence: ${fecha}
                        </option>
                    `;
                });
                
                selectLotes.focus();
            }
        } catch(e) {
            console.error(e);
            selectLotes.innerHTML = '<option value="">Error cargando lotes</option>';
        }
    }
};

async function procesarAjuste() {
    const ubicacionActiva = document.querySelector('input[name="ubicacion_ajuste"]:checked').value;
    const tipoActivo = document.querySelector('input[name="tipo"]:checked').value;
    
    const fileInput = document.getElementById('fotoEvidencia');
    let nombreFoto = "";
    if (fileInput && fileInput.files.length > 0) {
        nombreFoto = fileInput.files[0].name;
    }

    const cantidadInput = parseFloat(document.getElementById('cantidad').value) || 0;
    const unidadMedidaElegida = document.getElementById('unidadSeleccion')?.value || 'UNIDAD';
    
    // Convertir Kilogramos a Gramos o Litros a ML si la persona seleccionó K o L
    let cantidadFinal = cantidadInput;
    if (unidadMedidaElegida === 'L' || unidadMedidaElegida === 'KG') {
        cantidadFinal = cantidadInput * 1000;
    }

    const data = {
        producto_id: document.getElementById('producto_id').value,
        tipo: tipoActivo,
        ubicacion: ubicacionActiva,
        cantidad: cantidadFinal,
        unidad_medida_movimiento: unidadMedidaElegida,
        motivo: document.getElementById('motivo').value,
        lote_id: document.getElementById('loteSeleccion')?.value || null,         
        codigo_manual: document.getElementById('codigoLoteManual')?.value || null,
        foto_evidencia: nombreFoto
    };

    if (!data.producto_id) return Swal.fire('Atención', "Por favor selecciona un producto.", 'warning');
    if (!cantidadInput || cantidadInput <= 0) return Swal.fire('Atención', "Ingresa una cantidad válida mayor a cero.", 'warning');

    const result = await Swal.fire({
        title: `Confirmar Ajuste Manual`,
        html: `
            <div class="text-left text-xs bg-neutral-50 p-4 border border-neutral-300 font-mono uppercase">
                <p class="mb-1"><b>Producto:</b> ${document.getElementById('nombreProductoDisplay').value}</p>
                <p class="mb-1"><b>Área Afectada:</b> <span class="text-neutral-950 font-black">${data.ubicacion}</span></p>
                <p class="mb-1"><b>Tipo:</b> <span class="font-black">${data.tipo}</span></p>
                <p class="mb-1"><b>Cantidad Ingresada:</b> <span class="text-sm font-black text-red-600">${cantidadInput} ${unidadMedidaElegida}</span> ${unidadMedidaElegida === 'L' || unidadMedidaElegida === 'KG' ? `(${cantidadFinal} equivalentes)` : ''}</p>
                <p class="mb-1"><b>Motivo:</b> ${data.motivo}</p>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: data.tipo === 'SALIDA' ? '#0a0a0a' : '#16a34a',
        confirmButtonText: 'EJECUTAR AJUSTE',
        cancelButtonText: 'CANCELAR'
    });

    if (result.isConfirmed) {
        Swal.fire({ title: 'Procesando...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        const res = await AjusteService.create(data);
        
        if (res.error) {
            Swal.fire('ERROR', res.error, 'error');
        } else {
            await Swal.fire({
                icon: 'success',
                title: 'AJUSTE PROCESADO',
                html: `Movimiento registrado exitosamente.<br><b>Impacto:</b> ${res.impacto}`,
                confirmButtonColor: '#0a0a0a'
            });
            
            document.getElementById('formAjuste').reset();
            document.getElementById('producto_id').value = '';
            document.getElementById('nombreProductoDisplay').value = '';
            document.getElementById('stockBadge').classList.add('hidden');
            window.actualizarUIporTipo();
        }
    }
}


// =====================================================================
// AUTOMATIZACIÓN DE TASA BCV - INYECCIÓN INDESTRUCTIBLE POR SCRIPT
// =====================================================================
window.obtenerTasaBCVAutomatica = function() {
    const btn = document.getElementById('btnSincroBCV');
    const inputTasa = document.getElementById('inputTasaGlobal');
    
    if(!btn || !inputTasa) return;

    // Efecto visual de carga
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;
    inputTasa.disabled = true;

    // 1. Creamos una función puente temporal en la ventana global del navegador
    // Esta función recibirá la tasa directamente desde internet saltándose el CORS y los DNS locales
    window.procesarTasaInyectadaBCV = async function(data) {
        try {
            // Buscamos el valor numérico según la respuesta del servidor espejo
            const tasaRecibida = data.bcv || data.precio || data.rate || data.price;
            const tasaNumerica = parseFloat(tasaRecibida);

            if (!tasaNumerica || isNaN(tasaNumerica) || tasaNumerica <= 0) {
                throw new Error("Formato no numérico recibido.");
            }

            // Pintamos el valor visualmente en la caja de texto para la cajera
            inputTasa.value = tasaNumerica.toFixed(2);
            const token = localStorage.getItem('token');

            // 💾 Guardamos en tu base de datos local enviando la tasa al backend
            const resBackend = await fetch('/api/ajustes/tasa', {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ nuevaTasa: tasaNumerica })
            });

            if (resBackend.ok) {
                Swal.fire({
                    icon: 'success',
                    title: 'BCV ACTUALIZADO',
                    text: `Tasa oficial del BCV fijada con éxito: ${tasaNumerica.toFixed(2)} Bs.`,
                    confirmButtonColor: '#0a0a0a',
                    customClass: { popup: 'rounded-none', confirmButton: 'rounded-none text-[10px] uppercase tracking-widest' }
                });
            } else {
                throw new Error();
            }

        } catch (error) {
            Swal.fire('Error de Núcleo', 'Se obtuvo la tasa de internet, pero tu base de datos local rechazó el guardado.', 'error');
        } finally {
            // Limpieza de memoria y liberación de controles
            limpiarPasarelaScript();
        }
    };

    // 2. Crear dinámicamente el túnel <script> en tu HTML
    // Consumimos un CDN con redundancia que emite la tasa oficial empaquetada
    const scriptTúnel = document.createElement('script');
    scriptTúnel.id = 'tunel-bcv-script';
    scriptTúnel.src = 'https://ve.disweb.top/api/bcv?callback=procesarTasaInyectadaBCV';
    
    // Si la PC de plano no tiene internet o el servidor externo tarda más de 4 segundos, se rinde limpiamente
    const timeoutContingencia = setTimeout(() => {
        console.error("Timeout: La red externa no respondió al script.");
        Swal.fire({
            icon: 'warning',
            title: 'SISTEMA DE CONTINGENCIA',
            text: 'Las pasarelas automáticas están fuera de línea o esta PC no tiene internet. Registra el valor del dólar manualmente con tu teclado.',
            confirmButtonColor: '#0a0a0a',
            customClass: { popup: 'rounded-none border-t-4 border-t-amber-500', confirmButton: 'rounded-none text-[10px] uppercase tracking-widest' }
        });
        inputTasa.disabled = false;
        inputTasa.focus();
        limpiarPasarelaScript();
    }, 4000);

    // Función auxiliar para restablecer los botones y limpiar el HTML
    function limpiarPasarelaScript() {
        clearTimeout(timeoutContingencia);
        const scriptViejo = document.getElementById('tunel-bcv-script');
        if (scriptViejo) scriptViejo.remove();
        delete window.procesarTasaInyectadaBCV;
        
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i>`;
        inputTasa.disabled = false;
    }

    // Disparar el túnel inyectándolo en el documento
    document.body.appendChild(scriptTúnel);
};


