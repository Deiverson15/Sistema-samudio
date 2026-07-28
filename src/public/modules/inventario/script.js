import { ProductoService, BcvService, CompraService, ProveedorService, escapeHtml } from '../../js/api.js';

// --- Variables Globales ---
let productosGlobales = [];
let paginaActual = 1;
let totalPaginas = 1;
let filtroBajoStock = false;
let busquedaActual = "";
const LIMITE_POR_PAGINA = 50;



let origenSeleccionado = 'ALMACEN'; // Estado global de la modal
let productosCargados = [];

export async function init() {
    console.log("Iniciando Inventario Automatizado...");

    window.inicializarModuloExcel();
    
    // --- 1. Configuración de Automatización (NUEVO) ---
    // Detectar cambios en categoría para mostrar selectores de ml o inputs de gramos
    const selectCat = document.getElementById('categoria');
    if (selectCat) {
        selectCat.addEventListener('change', (e) => actualizarFormularioPorCategoria(e.target.value));
    }

    // Calcular stock real en tiempo real cuando el usuario escribe la cantidad
    const inputCant = document.getElementById('input_cantidad_visual');
    if (inputCant) {
        inputCant.addEventListener('input', calcularStockRealInterno);
    }
    
    // Si hay un selector de tamaño (para perfumes), también recalcular al cambiarlo
    // (Este elemento se crea dinámicamente, así que usamos delegación o validamos existencia en la función de render)

    // --- 2. Cargar Tabla Inicial ---
    await cargarTabla();

    // --- 3. Buscador con Debounce ---
    // Nota: Corregí el ID a 'buscador' para coincidir con tu HTML (antes 'filtroNombre')
    const inputBusqueda = document.getElementById('buscador');
    let timeoutBusqueda;
    
    if (inputBusqueda) {
        const nuevoInput = inputBusqueda.cloneNode(true);
        inputBusqueda.parentNode.replaceChild(nuevoInput, inputBusqueda);

        nuevoInput.addEventListener('input', (e) => {
            clearTimeout(timeoutBusqueda);
            timeoutBusqueda = setTimeout(() => {
                busquedaActual = e.target.value.trim();
                paginaActual = 1; 
                cargarTabla();
            }, 500); 
        });
    }

    // --- 4. Importación Masiva (Excel y CSV) ---
    const inputArchivo = document.getElementById('archivoExcel');
    if(inputArchivo) {
        inputArchivo.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if(!file) return;
            
            const confirm = await Swal.fire({
                title: '¿Importar archivo?',
                text: `Se procesará "${file.name}". Asegúrate que tenga columnas: CODIGO, NOMBRE, MARCA, STOCK.`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Sí, procesar'
            });

            if(confirm.isConfirmed) {
                // Llamamos a la nueva función de procesamiento
                procesarArchivoImportacion(file);
            }
            inputArchivo.value = ''; 
        });
    }

    // --- 5. Formulario Principal (Guardar Producto) ---
    const form = document.getElementById('formProducto');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await guardarProducto();
        });
    }

    // --- 6. Exportar Funciones Globales ---
    window.imprimirEtiqueta = imprimirEtiqueta;
    window.prepararEdicion = prepararEdicion;
    window.cerrarModal = cerrarModal;
    window.abrirModalCrear = abrirModalCrear;
    window.cargarTabla = cargarTabla;
    window.eliminarProducto = eliminarProducto;
    window.agregarStockRapido = agregarStockRapido;
    window.cambiarPagina = cambiarPagina;
    window.verKardex = verKardex;
    window.abrirReponerEstante = abrirReponerEstante;
    window.abrirModalMerma = abrirModalMerma;
    window.cerrarModalMerma = cerrarModalMerma;
    window.guardarMerma = guardarMerma;
    window.abrirReponerEstante = abrirReponerEstante;

    setupTeclado();
}

function actualizarEtiquetasUnidad() {
    const unidad = document.getElementById('unidad_medida').value;
    const lblStock = document.getElementById('lblUnidadStock');
    const lblCosto = document.getElementById('lblUnidadCosto');
    const inputCosto = document.getElementById('costo');

    let sufijo = 'u.';
    let placeholderCosto = '0.00';

    if (unidad === 'GRAMOS') {
        sufijo = '(g.)';
        placeholderCosto = 'Costo por gramo';
    } else if (unidad === 'MILILITROS') {
        sufijo = '(ml.)';
        placeholderCosto = 'Costo por ml';
    } else {
        sufijo = '(unid.)';
        placeholderCosto = 'Costo por pieza';
    }

    // Cambiamos el texto visualmente para guiar al usuario
    if (lblStock) lblStock.innerText = sufijo;
    if (lblCosto) lblCosto.innerText = `($/${unidad.toLowerCase().charAt(0)})`;
    if (inputCosto) inputCosto.placeholder = placeholderCosto;
}

window.toggleBajoStock = () => {
    const check = document.getElementById('checkBajoStock');
    filtroBajoStock = check.checked;
    paginaActual = 1; // Resetear a página 1
    cargarTabla();
};

// --- TABLA Y PAGINACIÓN ---
async function cargarTabla() {
    const tbody = document.getElementById('tablaProductos');
    const checkBajoStock = document.getElementById('checkBajoStock');
    const bajoStockActivo = checkBajoStock ? checkBajoStock.checked : false; //

    try {
        // Enviamos los 4 datos clave: Pagina, Limite, Busqueda y el Filtro Bajo Stock
        const response = await ProductoService.getAll(paginaActual, LIMITE_POR_PAGINA, busquedaActual, bajoStockActivo);
        
        productosGlobales = response.data || [];
        totalPaginas = response.pagination?.totalPages || 1;

        renderTabla(productosGlobales); // Esta función ya usa 'lotes_activos'
        renderPaginacion(paginaActual, totalPaginas, response.pagination?.total || 0);

    } catch (e) { 
        console.error("Error cargando productos:", e);
    }
}

// Archivo: inventario/src/public/modules/inventario/script.js

function renderTabla(lista) {
    const tbody = document.getElementById('tablaProductos');

    if (lista.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center p-12 text-gray-400 bg-gray-50 border-2 border-dashed rounded-lg">
                    <i class="fa-solid fa-box-open text-3xl mb-2 block"></i>
                    No se encontraron productos en el inventario.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = lista.map(p => {
        const nombreSeguro = escapeHtml(p.nombre);
        const marcaSegura = escapeHtml(p.marca || 'N/A');
        const categoriaSegura = escapeHtml(p.categoria);
        const codigoSeguro = escapeHtml(p.codigo); // Sigue leyendo la propiedad interna 'codigo'
        const stockReal = parseFloat(p.stock_real) || 0;
        const lotesActivos = parseInt(p.lotes_activos) || 0;

        // 🎨 BADGE DE GÉNERO INTELIGENTE
        let generoHtml = '';
if (p.genero) {
    const genTexto = p.genero.toUpperCase().trim();
    
    if (genTexto === 'DAMA') {
        generoHtml = `<span class="text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider bg-pink-50 text-pink-700 border-pink-200">DAMA</span>`;
    } 
    else if (genTexto === 'CABALLERO' || genTexto === 'HM') {
        generoHtml = `<span class="text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider bg-slate-900 text-white border-slate-950">CABALLERO</span>`;
    } 
    else if (genTexto === 'UNISEX' || genTexto === 'UNX') {
        // Normaliza tanto UNX como UNISEX a una etiqueta gris corporativa limpia
        generoHtml = `<span class="text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider bg-neutral-100 text-neutral-800 border-neutral-300">UNISEX</span>`;
    }
}

        // 💰 COLUMNA DE PRECIOS DETALLADA (NUEVA)
        const precioVenta = parseFloat(p.precio_venta) || 0;
        const costoUnitario = parseFloat(p.costo) || 0;
        const preciosHtml = `
            <div class="text-center flex flex-col justify-center items-center h-full">
                <div class="font-black text-neutral-950 text-sm">$${precioVenta.toFixed(2)}</div>
                <div class="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">Costo: $${costoUnitario.toFixed(2)}</div>
            </div>
        `;

        let stockHtml = '';
        if (['Alcohol', 'Esencias', 'Fijador'].includes(p.categoria)) {
            const unidad = p.categoria === 'Alcohol' ? 'ml' : 'g';
            const esCriticoMP = stockReal < 500; 
            const colorMP = esCriticoMP ? 'bg-red-100 text-red-700 border-red-200 animate-pulse' : 'bg-indigo-50 text-indigo-700 border-indigo-100';
            
            stockHtml = `
                <div class="flex flex-col gap-1 text-xs justify-center items-center h-full">
                    <span class="${colorMP} px-2 py-1 rounded border font-bold flex items-center gap-1 w-fit">
                        <i class="fa-solid fa-flask"></i> 
                        ${stockReal.toLocaleString()} ${unidad}
                    </span>
                    ${esCriticoMP ? '<span class="text-[10px] text-red-600 font-bold">¡REPONER!</span>' : ''}
                </div>
            `;
        } else {
            const stockMinimo = p.stock_minimo || 5;
            const esCero = stockReal === 0;
            const esBajo = stockReal <= stockMinimo;

            if (esCero) {
                stockHtml = `
                    <div class="flex items-center justify-center h-full">
                        <span class="bg-red-600 text-white border border-red-700 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm animate-pulse flex items-center gap-2">
                            <i class="fa-solid fa-triangle-exclamation text-yellow-300"></i> AGOTADO
                        </span>
                    </div>
                `;
            } else if (esBajo) {
                stockHtml = `
                    <div class="flex flex-col justify-center items-center h-full">
                        <span class="bg-yellow-50 text-yellow-700 border border-yellow-200 px-2 py-1 rounded text-xs font-bold w-fit flex items-center gap-1">
                            <i class="fa-solid fa-circle-exclamation"></i> ${stockReal} Unid.
                        </span>
                        <span class="text-[10px] text-yellow-600 font-medium mt-0.5">Mínimo: ${stockMinimo}</span>
                    </div>
                `;
            } else {
                stockHtml = `
                    <div class="flex items-center justify-center h-full">
                        <span class="bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded text-xs font-bold w-fit">
                            ${stockReal} Unid.
                        </span>
                    </div>
                `;
            }

            if (['Frasco', 'Frascos', 'Envases'].includes(p.categoria)) {
                stockHtml += `<span class="text-[9px] text-gray-400 font-bold uppercase block mt-1 text-center">${p.contenido_gramos}ml</span>`;
            }
        }

        let lotesHtml = '';
        if (lotesActivos > 0) {
            lotesHtml = `
                <div class="flex justify-center items-center h-full">
                    <button onclick="verLotes(${p.id}, '${nombreSeguro.replace(/'/g, "\\'")}')" class="group flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-purple-300 hover:shadow-sm transition">
                        <div class="bg-purple-100 text-purple-600 w-6 h-6 rounded flex items-center justify-center text-xs font-bold group-hover:bg-purple-600 group-hover:text-white transition">
                            ${lotesActivos}
                        </div>
                        <span class="text-xs text-gray-500 font-medium group-hover:text-purple-600">Lotes</span>
                    </button>
                </div>
            `;
        } else {
            lotesHtml = `
                <div class="flex justify-center items-center h-full">
                    <span class="text-xs text-gray-300 font-medium italic px-2">Sin lotes</span>
                </div>
            `;
        }

        return `
            <tr class="hover:bg-blue-50/30 transition border-b border-gray-100 group">
                <td class="px-6 py-4 font-mono text-xs text-gray-400 group-hover:text-blue-500 transition-colors">
                    ${codigoSeguro}
                </td>
                
                <td class="px-6 py-4">
                    <div class="font-bold text-gray-800 text-sm leading-tight">${nombreSeguro}</div>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <span class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">${marcaSegura}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500 font-bold uppercase">${categoriaSegura}</span>
                        ${generoHtml}
                    </div>
                </td>
                
                <td class="px-6 py-4">
                    ${preciosHtml}
                </td>

                <td class="px-6 py-4">
                    ${stockHtml}
                </td>

                <td class="px-6 py-4">
                    ${lotesHtml}
                </td>
                
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-end items-center gap-2">
                        <button onclick="agregarStockRapido(${p.id})" class="bg-green-50 text-green-600 hover:bg-green-600 hover:text-white w-8 h-8 rounded-lg transition-all border border-green-100 shadow-sm flex items-center justify-center active:scale-95" title="Agregar existencias"><i class="fa-solid fa-plus text-xs"></i></button>
                        <button onclick="bajarAlEstante(${p.id})" class="bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white w-8 h-8 rounded-lg transition-all border border-orange-100 shadow-sm flex items-center justify-center active:scale-95" title="Bajar a Tienda"><i class="fa-solid fa-dolly text-xs"></i></button>
                        <div class="w-px h-5 bg-gray-200 mx-1"></div>
                        <button onclick="verKardex(${p.id})" class="text-purple-400 hover:text-purple-600 hover:bg-purple-50 w-8 h-8 rounded-full transition flex items-center justify-center" title="Ver Historial"><i class="fa-solid fa-clock-rotate-left"></i></button>
                        <button onclick="prepararEdicion(${p.id})" class="text-blue-400 hover:text-blue-600 hover:bg-blue-50 w-8 h-8 rounded-full transition flex items-center justify-center" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="eliminarProducto(${p.id})" class="text-red-300 hover:text-red-600 hover:bg-red-50 w-8 h-8 rounded-full transition flex items-center justify-center" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPaginacion(actual, total, totalItems) {
    let pagContainer = document.getElementById('paginacionContainer');
    if (!pagContainer) {
        const tableContainer = document.querySelector('.overflow-x-auto');
        if(tableContainer && tableContainer.parentNode) {
            pagContainer = document.createElement('div');
            pagContainer.id = 'paginacionContainer';
            pagContainer.className = "flex justify-between items-center p-4 bg-white border-t border-gray-200 text-sm";
            tableContainer.parentNode.appendChild(pagContainer);
        }
    }
    if (!pagContainer) return;

    const btnPrevClass = actual === 1 ? "text-gray-300 cursor-not-allowed border-gray-100" : "text-blue-600 hover:bg-blue-50 border-gray-300 cursor-pointer";
    const btnNextClass = actual === total || total === 0 ? "text-gray-300 cursor-not-allowed border-gray-100" : "text-blue-600 hover:bg-blue-50 border-gray-300 cursor-pointer";

    pagContainer.innerHTML = `
        <div class="text-gray-500">Mostrando <b>${productosGlobales.length}</b> de <b>${totalItems}</b> productos</div>
        <div class="flex gap-2">
            <button onclick="cambiarPagina(${actual - 1})" class="px-3 py-1 rounded border ${btnPrevClass}" ${actual === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Anterior</button>
            <span class="px-3 py-1 font-bold text-gray-700 bg-gray-50 rounded">Pág ${actual} de ${total || 1}</span>
            <button onclick="cambiarPagina(${actual + 1})" class="px-3 py-1 rounded border ${btnNextClass}" ${actual === total || total === 0 ? 'disabled' : ''}>Siguiente <i class="fa-solid fa-chevron-right"></i></button>
        </div>
    `;
}

function cambiarPagina(nuevaPagina) {
    if (nuevaPagina < 1 || nuevaPagina > totalPaginas) return;
    paginaActual = nuevaPagina;
    cargarTabla();
}

function abrirModalCrear() {
    const modal = document.getElementById('modalProducto');
    const panel = document.getElementById('modalPanel');
    const titulo = document.getElementById('modalTitulo');
    
    document.getElementById('formProducto').reset();
    document.getElementById('producto_id_edicion').value = '';
    
    titulo.innerHTML = '<i class="fa-solid fa-box-open"></i> Nuevo Producto';
    document.getElementById('codigo').value = 'PROD-' + Math.floor(Math.random() * 10000);
    
    const btn = document.getElementById('btnGuardar');
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-save"></i> <span>Guardar Producto</span>';
        btn.disabled = false;
    }

    const selectCat = document.getElementById('categoria');
    if(selectCat) selectCat.value = "";
    
    // 🔥 RESETEO DEL GÉNERO
    const selectGen = document.getElementById('genero');
    if(selectGen) selectGen.value = "UNISEX";
    
    const divDinamico = document.getElementById('dynamicControls');
    if(divDinamico) divDinamico.innerHTML = "";
    
    const inputVisual = document.getElementById('input_cantidad_visual');
    if(inputVisual) {
        inputVisual.value = "";
        inputVisual.disabled = false;
    }
    
    const lblStock = document.getElementById('lblStockInput');
    if(lblStock) lblStock.innerText = "Stock Actual";

    modal.classList.remove('hidden');
    setTimeout(() => { panel.classList.remove('translate-x-full'); }, 10);
    setTimeout(() => { document.getElementById('codigo').focus(); }, 100);
}

function cerrarModal() {
    const modal = document.getElementById('modalProducto');
    const panel = document.getElementById('modalPanel');
    panel.classList.add('translate-x-full');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

window.prepararEdicion = (id) => {
    const prod = productosGlobales.find(p => p.id === id);
    if(!prod) return;

    abrirModalCrear(); 

    document.getElementById('modalTitulo').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Producto';
    const btn = document.getElementById('btnGuardar');
    if(btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i> <span>Actualizar Datos</span>';

    // Llenar datos básicos
    document.getElementById('producto_id_edicion').value = prod.id;
    document.getElementById('codigo').value = prod.codigo;
    document.getElementById('nombre').value = prod.nombre;
    document.getElementById('marca').value = prod.marca;
    
    document.getElementById('costo').value = prod.costo || '';
    document.getElementById('precio_venta').value = prod.precio_venta || '';
    document.getElementById('stock_minimo').value = prod.stock_minimo || 5;

    const selectCat = document.getElementById('categoria');
    selectCat.value = prod.categoria || 'Otros';
    
    if (typeof actualizarFormularioPorCategoria === 'function') {
        actualizarFormularioPorCategoria(prod.categoria);
    }

    // Llenar datos visuales
    const inputVisual = document.getElementById('input_cantidad_visual');
    const contenido = parseFloat(prod.contenido_gramos) || 0;
    const stockReal = parseFloat(prod.stock_real) || 0;

    if (['Alcohol', 'Esencias', 'Fijador'].includes(prod.categoria)) {
        if (contenido > 0) {
            inputVisual.value = (stockReal / contenido).toFixed(1);
            const inputGramos = document.getElementById('contenido_gramos_input');
            if(inputGramos) inputGramos.value = contenido;
        } else {
            inputVisual.value = stockReal;
        }
    } else {
        inputVisual.value = stockReal;
        if(prod.categoria === 'Perfumes' || prod.categoria === 'Envases') {
            const selector = document.getElementById('tamanio_selector');
            if(selector) selector.value = contenido;
        }
    }
    
    if (typeof calcularStockRealInterno === 'function') {
        calcularStockRealInterno();
    }
};

// --- GUARDAR PRODUCTO ---
// Archivo: inventario/src/public/modules/inventario/script.js

async function guardarProducto() {
    const btn = document.getElementById('btnGuardar');
    btn.disabled = true;

    calcularStockRealInterno();

    const cat = document.getElementById('categoria').value;
    let contenidoFinal = 1;
    
    if(cat === 'Frasco' || cat === 'Frascos' || cat === 'Envases') {
        const selector = document.getElementById('tamanio_selector');
        contenidoFinal = selector ? selector.value : 30;
    }

    const data = {
        codigo: document.getElementById('codigo').value,
        nombre: document.getElementById('nombre').value,
        marca: document.getElementById('marca').value,
        categoria: cat,
        genero: document.getElementById('genero').value, // 🔥 ENVIAMOS EL NUEVO CAMPO
        unidad_medida: document.getElementById('unidad_medida').value,
        stock: document.getElementById('stock_real_calculado').value,
        contenido_gramos: contenidoFinal, 
        stock_minimo: document.getElementById('stock_minimo').value,
        costo: document.getElementById('costo').value,
        precio_venta: document.getElementById('precio_venta').value
    };

    const idEdicion = document.getElementById('producto_id_edicion').value;

    try {
        let res = idEdicion ? await ProductoService.update(idEdicion, data) : await ProductoService.create(data);
        if(res.error) throw new Error(res.error);
        
        Swal.fire({ icon: 'success', title: '¡Guardado!', timer: 1000, showConfirmButton: false });
        cerrarModal();
        cargarTabla();
    } catch (e) {
        Swal.fire('Error', e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// Archivo: inventario/src/public/modules/inventario/script.js

window.agregarStockRapido = async (id) => {
    const prod = productosGlobales.find(p => p.id === id);
    if (!prod) return;

    // Categorías que se manejan por peso y requieren Lote Maestro
    const esMateriaPrima = ['Alcohol', 'Esencias', 'Fijador'].includes(prod.categoria);

    if (esMateriaPrima) {
        // --- LÓGICA PARA MATERIA PRIMA (Kilos -> Gramos) ---
        try {
            const lotes = await CompraService.getAll();
            const lotesActivos = lotes.filter(l => l.estado !== 'COMPLETADO' && parseFloat(l.peso_pendiente_kg) > 0);

            if (lotesActivos.length === 0) {
                return Swal.fire('Atención', 'No hay facturas (Lotes Maestros) con peso disponible. Registra una compra primero.', 'warning');
            }

            const { value: formValues } = await Swal.fire({
                title: `Distribuir: ${escapeHtml(prod.nombre)}`,
                html: `
                    <div class="text-left space-y-3">
                        <label class="block text-xs font-bold text-gray-500 uppercase">Seleccionar Factura/Lote</label>
                        <select id="swal-lote-id" class="swal2-input m-0 w-full text-sm">
                            ${lotesActivos.map(l => `<option value="${l.id}">${l.factura} (${l.peso_pendiente_kg}kg disp.)</option>`).join('')}
                        </select>
                        <label class="block text-xs font-bold text-gray-500 uppercase">Kilogramos a descontar</label>
                        <input id="swal-peso-kg" type="number" step="0.01" class="swal2-input m-0 w-full font-bold text-indigo-600">
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: 'Confirmar Distribución',
                preConfirm: () => {
                    const loteId = document.getElementById('swal-lote-id').value;
                    const peso = document.getElementById('swal-peso-kg').value;
                    const loteSel = lotesActivos.find(l => l.id == loteId);

                    if (!peso || peso <= 0) return Swal.showValidationMessage('Ingresa un peso válido');
                    if (parseFloat(peso) > parseFloat(loteSel.peso_pendiente_kg)) {
                        return Swal.showValidationMessage(`Solo quedan ${loteSel.peso_pendiente_kg}kg disponibles`);
                    }
                    return { lote_maestro_id: loteId, producto_id: id, peso_kg: peso };
                }
            });

            if (formValues) {
                const res = await CompraService.distribuir(formValues);
                if (res.error) throw new Error(res.error);
                Swal.fire({ icon: 'success', title: 'Inventario Actualizado', timer: 1500, showConfirmButton: false });
                cargarTabla();
            }
        } catch (e) {
            Swal.fire('Error', e.message, 'error');
        }

    } else {
        // --- LÓGICA PARA FRASCOS / ENVASES (UNIDADES DIRECTAS) ---
        const { value: cantidad } = await Swal.fire({
            title: `Agregar Unidades: ${escapeHtml(prod.nombre)}`,
            html: `
                <div class="text-left">
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cantidad de Frascos/Unidades</label>
                    <input id="swal-cant" type="number" class="swal2-input m-0 w-full" step="1">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Añadir al Stock',
            preConfirm: () => {
                const val = document.getElementById('swal-cant').value;
                if (!val || val <= 0) return Swal.showValidationMessage('Ingresa una cantidad válida');
                return parseInt(val);
            }
        });

        if (cantidad) {
            try {
                // Para frascos, sumamos directamente al stock actual
                const nuevoStock = (parseFloat(prod.stock_real) || 0) + cantidad;
                
                // Usamos el servicio de productos para actualizar
                const res = await ProductoService.update(id, { 
                    ...prod, // Mantenemos los datos actuales
                    stock: nuevoStock 
                });

                if (res.error) throw new Error(res.error);
                Swal.fire({ icon: 'success', title: 'Frascos añadidos', timer: 1500, showConfirmButton: false });
                cargarTabla();
            } catch (e) {
                Swal.fire('Error', 'No se pudo actualizar el stock del frasco.', 'error');
            }
        }
    }
};

// --- ELIMINAR (DOBLE OPCIÓN: LÓGICA Y FÍSICA) ---
window.eliminarProducto = async (id) => {
    // 1. Buscamos el producto
    const prod = productosGlobales.find(p => p.id === id);
    if (!prod) return;

    // 2. Mostramos el panel de opciones
    const result = await Swal.fire({
        title: 'Gestión de Eliminación',
        html: `
            <div class="text-left text-sm mt-2 space-y-3">
                <p>Estás gestionando: <b>${escapeHtml(prod.nombre)}</b></p>
                <div class="bg-blue-50 p-3 rounded border border-blue-100">
                    <b class="text-blue-700"><i class="fa-solid fa-box-archive"></i> Archivar:</b> Lo oculta del sistema, pero mantiene las ventas antiguas intactas en auditoría.
                </div>
                <div class="bg-red-50 p-3 rounded border border-red-100">
                    <b class="text-red-700"><i class="fa-solid fa-skull"></i> Permanente:</b> Destruye el registro de la base de datos (Solo si no tiene ventas ni lotes activos).
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonColor: '#3b82f6', // Azul para archivar
        denyButtonColor: '#dc2626',    // Rojo para borrar definitivo
        cancelButtonColor: '#cbd5e1',
        confirmButtonText: 'Archivar (Auditoría)',
        denyButtonText: 'Eliminar Permanente',
        cancelButtonText: 'Cancelar',
        customClass: {
            actions: 'flex flex-col md:flex-row gap-2', // Para que los botones se vean bien
            confirmButton: 'order-1',
            denyButton: 'order-2',
            cancelButton: 'order-3'
        }
    });

    // 3. Evaluar la decisión del administrador
    if (result.isConfirmed) {
        
        // OPCIÓN 1: ARCHIVAR (Soft Delete)
        try {
            await ProductoService.delete(id);
            cargarTabla();
            Swal.fire('Archivado', 'El producto se ocultó del inventario.', 'success');
        } catch(e) { Swal.fire('Error', e.message, 'error'); }

    } else if (result.isDenied) {
        
        // OPCIÓN 2: ELIMINAR PERMANENTE (Hard Delete)
        const confirm2 = await Swal.fire({
            title: '⚠️ MODO DESTRUCTIVO',
            text: 'Esta acción purgará el registro de la base de datos y no se puede deshacer. ¿Proceder?',
            icon: 'error',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            confirmButtonText: 'Sí, Destruir Todo',
            cancelButtonText: 'Cancelar'
        });

        if (confirm2.isConfirmed) {
            try {
                Swal.fire({ title: 'Destruyendo...', didOpen: () => Swal.showLoading() });
                const token = localStorage.getItem('token');
                
                // Llamamos a la ruta secreta "/fisico" de tu backend
                const res = await fetch(`/api/productos/${id}/fisico`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                const data = await res.json();
                
                if (res.ok) {
                    cargarTabla();
                    Swal.fire('Purga Completada', data.mensaje, 'success');
                } else {
                    throw new Error(data.error);
                }
            } catch(e) {
                // Si el backend da el error 23503 (tiene ventas), mostramos esta alerta especial
                Swal.fire('Acción Bloqueada', e.message, 'warning');
            }
        }
    }
};

function procesarArchivoImportacion(file) {
    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // 🧠 EXTRAER TODAS LAS HOJAS DINÁMICAMENTE
            const todasLasHojas = {};
            workbook.SheetNames.forEach(nombreHoja => {
                // Quitamos el 'range' para que el backend detecte los títulos sin importar la fila
                const jsonSheet = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { defval: "" });
                if (jsonSheet.length > 0) {
                    todasLasHojas[nombreHoja] = jsonSheet;
                }
            });

            if (Object.keys(todasLasHojas).length === 0) {
                return Swal.fire('Error', 'El archivo Excel está vacío o no se pudo leer.', 'error');
            }

            Swal.fire({ title: 'Clasificando inventario multi-hoja...', didOpen: () => Swal.showLoading() });

            const token = localStorage.getItem('token');
            const res = await fetch('/api/productos/importar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    productos: todasLasHojas, 
                    nombre_archivo: file.name,
                    proveedor: "Carga Múltiple (Archivo Rápido)"
                })
            });
            
            const resultado = await res.json();
            
            if (res.ok) {
                await Swal.fire('¡Importación Exitosa!', `<b>${resultado.resumen.insertados}</b> creados nuevos.<br><b>${resultado.resumen.actualizados}</b> actualizados.<br><br><span class="text-xs">Hojas procesadas: ${Object.keys(todasLasHojas).join(', ')}</span>`, 'success');
                cargarTabla();
            } else {
                throw new Error(resultado.error);
            }
        } catch (error) {
            Swal.fire('Error', error.message, 'error');
        }
    };

    reader.readAsArrayBuffer(file);
}


function imprimirEtiqueta(codigo, nombre) { // Se quitó parámetro precio
    const ventana = window.open('', 'PRINT', 'height=400,width=600');
    if(!ventana) { Swal.fire('Error', 'Desbloquea los pop-ups', 'error'); return; }
    
    // HTML sin precio ($${precio})
    ventana.document.write(`<html><head><title>${nombre}</title><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script></head><body onload="JsBarcode('#b','${codigo}',{displayValue:true});setTimeout(()=>{window.print();window.close()},500)"><div style="text-align:center;font-family:sans-serif"><h3>${nombre}</h3><svg id="b"></svg></div></body></html>`);
    
    ventana.document.close();
}

window.verKardex = async (id) => {
    const prod = productosGlobales.find(p => p.id === id);
    const nombreSeguro = prod ? escapeHtml(prod.nombre) : 'Producto';

    const modal = document.getElementById('modalKardex');
    const title = document.getElementById('kardexProductoTitle');
    const tbody = document.getElementById('tablaKardex');

    title.innerHTML = nombreSeguro; // Usamos innerHTML seguro porque pasamos por escapeHtml
    modal.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-gray-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i><br>Consultando historial...</td></tr>';

    try {
        const movimientos = await ProductoService.getKardex(id);
        tbody.innerHTML = '';

        if(movimientos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-400 italic">Este producto no tiene movimientos registrados aún.</td></tr>';
            return;
        }

        // Renderizado optimizado con map+join
        tbody.innerHTML = movimientos.map(m => {
            const fecha = new Date(m.fecha || Date.now()).toLocaleString();
            let badgeColor = 'bg-gray-100 text-gray-600';
            if(m.tipo_movimiento === 'ENTRADA') badgeColor = 'bg-green-100 text-green-700 font-bold';
            if(m.tipo_movimiento === 'SALIDA') badgeColor = 'bg-red-100 text-red-700 font-bold';
            
            return `
                <tr class="hover:bg-gray-50 transition">
                    <td class="p-4 text-xs text-gray-500 font-mono">${fecha}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded text-xs border border-transparent ${badgeColor}">${m.tipo_movimiento}</span></td>
                    <td class="p-4 text-center font-bold text-gray-700 text-lg">${m.cantidad}</td>
                    <td class="p-4 text-center text-gray-500 font-mono">${m.stock_nuevo}</td>
                    <td class="p-4 text-xs text-gray-600 italic max-w-xs truncate" title="${escapeHtml(m.motivo)}">${escapeHtml(m.motivo)}</td>
                </tr>
            `;
        }).join('');

    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-400">Error al cargar historial.</td></tr>';
    }
};

// Borra cualquier otra función con este nombre y deja solo esta:

// Función corregida para calcular botellas enteras
window.abrirReponerEstante = async function(id, nombre, contenido, stockTotalGramos) {
    if (!contenido || contenido <= 0) {
        Swal.fire('Error', 'Configura el contenido (g/ml) primero.', 'warning');
        return;
    }

    const botellasDisponibles = Math.floor(stockTotalGramos / contenido);
    if (botellasDisponibles <= 0) return Swal.fire('Sin Stock', 'No alcanza para una botella completa.', 'error');

    // 1. CONSULTAR UBICACIÓN SUGERIDA (IA básica)
    let ubicacionDefault = 'A';
    let filaDefault = 1;
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`/api/productos/${id}/ubicacion`, { headers: {'Authorization': `Bearer ${token}`} });
        const data = await resp.json();
        if(data.ubicacion) {
            ubicacionDefault = data.ubicacion;
            filaDefault = data.fila;
        }
    } catch(e) {}

    // 2. MODAL CON SELECTOR DE UBICACIÓN
    const { value: formValues } = await Swal.fire({
        title: 'Organizar Inventario',
        html: `
            <div class="text-left text-sm mb-4 bg-gray-50 p-3 rounded border border-gray-200">
                <p>Producto: <b>${nombre}</b></p>
                <p>Disponibles: <b class="text-green-600">${botellasDisponibles} botellas</b></p>
            </div>
            
            <label class="block text-left text-xs font-bold text-gray-500 uppercase">Cantidad a Bajar</label>
            <input id="swal-qty" type="number" class="swal2-input mb-4" placeholder="Ej: 10" min="1" max="${botellasDisponibles}">

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-left text-xs font-bold text-gray-500 uppercase">Estante</label>
                    <select id="swal-ubicacion" class="swal2-input w-full">
                        <option value="A" ${ubicacionDefault==='A'?'selected':''}>Estante A</option>
                        <option value="B" ${ubicacionDefault==='B'?'selected':''}>Estante B</option>
                    </select>
                </div>
                <div>
                    <label class="block text-left text-xs font-bold text-gray-500 uppercase">Fila</label>
                    <select id="swal-fila" class="swal2-input w-full">
                        <option value="1" ${filaDefault===1?'selected':''}>Fila 1 (Superior)</option>
                        <option value="2" ${filaDefault===2?'selected':''}>Fila 2</option>
                        <option value="3" ${filaDefault===3?'selected':''}>Fila 3</option>
                        <option value="4" ${filaDefault===4?'selected':''}>Fila 4 (Inferior)</option>
                    </select>
                </div>
            </div>
            <p class="text-xs text-blue-500 mt-2"><i class="fa-solid fa-circle-info"></i> Sugerencia basada en tu historial.</p>
        `,
        showCancelButton: true,
        confirmButtonText: 'Guardar Ubicación',
        confirmButtonColor: '#2563eb',
        preConfirm: () => {
            const qty = document.getElementById('swal-qty').value;
            const ubi = document.getElementById('swal-ubicacion').value;
            const fil = document.getElementById('swal-fila').value;
            
            if (!qty || qty <= 0) Swal.showValidationMessage('Indica la cantidad');
            if (qty > botellasDisponibles) Swal.showValidationMessage('Excedes el stock disponible');
            
            return { cantidad: qty, ubicacion: ubi, fila: fil };
        }
    });

    if (formValues) {
        // ENVIAR AL BACKEND
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/productos/${id}/reponer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(formValues)
            });
            
            if(res.ok) {
                Swal.fire('Organizado', 'Las botellas se han agrupado en el estante.', 'success');
                cargarTabla();
            } else {
                Swal.fire('Error', 'No se pudo guardar', 'error');
            }
        } catch(e) { Swal.fire('Error', 'Fallo de conexión', 'error'); }
    }
};

function actualizarFormularioPorCategoria(categoria) {
    const container = document.getElementById('dynamicControls');
    const lblStock = document.getElementById('lblStockInput');
    const inputCant = document.getElementById('input_cantidad_visual');
    const unidadHidden = document.getElementById('unidad_medida');
    
    container.innerHTML = ''; 
    let htmlDinamico = '';
    let placeholderStock = '0';
    let unidadFinal = 'UNIDAD';

    // --- CORRECCIÓN AQUÍ: Agregamos "Envases" a la condición ---
    if (categoria === 'Frasco' || categoria === 'Frascos' || categoria === 'Envases') {
        lblStock.innerText = 'Cantidad de Frascos (Unidades)';
        placeholderStock = 'Ej: 100';
        unidadFinal = 'UNIDAD';
        
        // Aquí están tus tamaños de 30, 60, 100 y 120 ml
        htmlDinamico = `
            <div>
                <label class="block text-xs font-bold text-blue-700 uppercase mb-1">Capacidad del Frasco</label>
                <select id="tamanio_selector" class="w-full border-2 border-blue-200 p-2.5 rounded-lg outline-none font-bold text-blue-800" onchange="calcularStockRealInterno()">
                    <option value="30">30 ml</option>
                    <option value="60">60 ml</option>
                    <option value="100">100 ml</option>
                    <option value="120">120 ml</option>
                </select>
                <input type="hidden" id="contenido_gramos_input" value="1"> 
            </div>
        `;
    } 
    // ... resto de la lógica para Alcohol, Esencias, etc ...
    else if (['Alcohol', 'Esencias', 'Fijador'].includes(categoria)) {
        const esAlcohol = categoria === 'Alcohol';
        lblStock.innerText = `Total ${esAlcohol ? 'Mililitros (ml)' : 'Gramos (g)'} completos`;
        placeholderStock = `Ej: 1000`;
        unidadFinal = esAlcohol ? 'MILILITROS' : 'GRAMOS';
        htmlDinamico = `<input type="hidden" id="contenido_gramos_input" value="1">`;
    } 
    else {
        lblStock.innerText = 'Stock Actual (Unidades)';
        placeholderStock = '0';
        unidadFinal = 'UNIDAD';
        htmlDinamico = `<input type="hidden" id="contenido_gramos_input" value="1">`;
    }

    container.innerHTML = htmlDinamico;
    unidadHidden.value = unidadFinal;
    inputCant.placeholder = placeholderStock;
    
    calcularStockRealInterno();
}


// CÁLCULO AUTOMÁTICO DE STOCK TOTAL
function calcularStockRealInterno() {
    const cat = document.getElementById('categoria').value;
    const inputVisual = document.getElementById('input_cantidad_visual');
    const cantVisual = parseFloat(inputVisual ? inputVisual.value : 0) || 0;
    const stockCalculado = document.getElementById('stock_real_calculado');
    
    if (!stockCalculado) return;

    if (cat === 'Frasco' || cat === 'Frascos') {
        const selector = document.getElementById('tamanio_selector');
        const tamano = parseFloat(selector ? selector.value : 30);
        
        stockCalculado.value = cantVisual; // Guardamos cantidad de frascos
        // Guardamos el tamaño en el campo oculto para que el backend sepa de cuánto es
        const contInput = document.getElementById('contenido_gramos_input');
        if (contInput) contInput.value = tamano;
    } else {
        // Para todo lo demás, el stock real es exactamente lo que escribes (gramos/unidades directas)
        stockCalculado.value = cantVisual;
        const contInput = document.getElementById('contenido_gramos_input');
        if (contInput) contInput.value = 1;
    }
}

window.abrirModalMerma = (id, nombre) => {
    // 1. CORREGIDO: Ahora busca el ID exacto que tienes en tu HTML (merma_productos_id)
    const idInput = document.getElementById('merma_productos_id');
    if (idInput) {
        idInput.value = id;
    } else {
        console.error("ERROR: No se encontró 'merma_productos_id' en el HTML. Revisa el ID.");
    }

    // 2. Asignar nombre
    const nombreSpan = document.getElementById('mermaNombre');
    if (nombreSpan) nombreSpan.innerText = nombre;

    // 3. Limpiar y asignar otros campos
    const cantInput = document.getElementById('merma_cantidad');
    if (cantInput) {
        cantInput.value = '';
        cantInput.focus();
    }

    const obsInput = document.getElementById('merma_observaciones');
    if (obsInput) obsInput.value = '';
    
    // 4. Mostrar modal
    const modal = document.getElementById('modalMerma');
    if (modal) {
        modal.classList.remove('hidden');
    }
};

function cerrarModalMerma() {
    document.getElementById('modalMerma').classList.add('hidden');
}

async function guardarMerma() {
    const id = document.getElementById('merma_producto_id').value;
    const cantidad = document.getElementById('merma_cantidad').value;
    const ubicacion = document.getElementById('merma_ubicacion').value;
    const motivo = document.getElementById('merma_motivo').value;
    const observaciones = document.getElementById('merma_observaciones').value;

    if (!cantidad || cantidad <= 0) return Swal.fire('Error', 'Ingresa una cantidad válida', 'warning');
    if (!observaciones) return Swal.fire('Error', 'Por favor describe qué pasó en observaciones', 'warning');

    try {
        const res = await ProductoService.reportarMerma(id, {
            cantidad, ubicacion, motivo, observaciones
        });

        if (res.error) throw new Error(res.error);

        Swal.fire({
            icon: 'success',
            title: 'Merma Registrada',
            text: 'El inventario ha sido actualizado.',
            timer: 2000
        });

        cerrarModalMerma();
        cargarProductos(); // Recargar tabla para ver el nuevo stock
    } catch (error) {
        console.error(error);
        Swal.fire('Error', error.message || 'No se pudo registrar la merma', 'error');
    }
}

function setupTeclado() {
    document.addEventListener('keydown', (e) => {
        // Ignorar si estamos dentro de un input (excepto ESC)
        const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
        
        // 1. ESCAPE: Cierra todo
        if (e.key === 'Escape') {
            cerrarModal();
            cerrarModalMerma();
            const modalKardex = document.getElementById('modalKardex');
            if (modalKardex) modalKardex.classList.add('hidden');
            return;
        }

        if (isInput) return; // Si está escribiendo, no disparamos atajos de letras

        // 2. Alt + N: Nuevo Producto
        if (e.altKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            abrirModalCrear();
        }

        // 3. Alt + F o Barra (/): Ir al Buscador
        if ((e.altKey && e.key.toLowerCase() === 'f') || e.key === '/') {
            e.preventDefault();
            const search = document.getElementById('buscador');
            if (search) {
                search.focus();
                search.select();
            }
        }
    });
}


window.bajarAlEstante = async (id) => {
    // 1. Buscar datos del producto
    const prod = productosGlobales.find(p => p.id === id);
    if (!prod) return;

    const nombre = escapeHtml(prod.nombre);
    const stockActual = parseFloat(prod.stock_real) || 0;
    
    // 2. Determinar si pedimos Gramos o Unidades
    // Si es materia prima, el stock se maneja en gramos/ml
    const esMateriaPrima = ['Alcohol', 'Esencias', 'Fijador'].includes(prod.categoria);
    const etiqueta = esMateriaPrima ? 'Gramos / Mililitros a Bajar' : 'Cantidad de Unidades / Cajas';
    const placeholder = esMateriaPrima ? 'Ej: 500 (gramos)' : 'Ej: 12 (unidades)';

    // 3. Mostrar Popup
    const { value: cantidad } = await Swal.fire({
        title: 'Bajar a Tienda',
        html: `
            <div class="text-left mb-4">
                <p class="font-bold text-gray-700 text-lg">${nombre}</p>
                <p class="text-sm text-gray-500">Disponible en Almacén: <b>${stockActual}</b></p>
                <div class="bg-yellow-50 text-yellow-800 p-2 rounded text-xs mt-2 border border-yellow-100">
                    <i class="fa-solid fa-triangle-exclamation"></i> La mercancía llegará como <b>"SIN ORGANIZAR"</b> al estante.
                </div>
            </div>
            <label class="block text-left text-xs font-bold text-gray-500 uppercase mb-1">${etiqueta}</label>
            <input id="swal-input-bajar" type="number" class="swal2-input m-0 w-full" placeholder="${placeholder}">
        `,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-dolly"></i> Bajar Mercancía',
        confirmButtonColor: '#f97316', // Naranja
        preConfirm: () => {
            const val = document.getElementById('swal-input-bajar').value;
            if (!val || val <= 0) return Swal.showValidationMessage('Ingresa una cantidad válida');
            if (parseFloat(val) > stockActual) return Swal.showValidationMessage('No tienes suficiente stock en el almacén');
            return val;
        }
    });

    if (cantidad) {
        try {
            // Mostrar carga
            Swal.fire({ title: 'Procesando...', didOpen: () => Swal.showLoading() });

            const token = localStorage.getItem('token');
            const res = await fetch('/api/productos/mover-estante', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ 
                    productoId: id, 
                    cantidad: parseFloat(cantidad) // Enviamos el número (sea gramos o unidades)
                })
            });

            const data = await res.json();
            
            if (res.ok) {
                await Swal.fire({ 
                    icon: 'success', 
                    title: '¡Enviado a Recepción!', 
                    text: 'El producto ahora aparece como "PENDIENTE" en el módulo de Estante.',
                    timer: 2500 
                });
                cargarTabla(); // Recargar para ver el descuento en almacén
            } else {
                throw new Error(data.error || 'No se pudo mover la mercancía');
            }
        } catch (error) { 
            Swal.fire('Error', error.message, 'error'); 
        }
    }
};

// =========================================================================
// 🧴 CONTROLADORES DE LA MODAL DE DESCARGA DIRECTA POR LOTES (CORREGIDO)
// =========================================================================

let grupoDescargaExterna = []; 
let origenDescuentoActual = 'ALMACEN';
let todosLosProductosSincro = []; // Caché local para filtrado sin 403

window.cambiarOrigenDescarga = function(tipo) {
    origenDescuentoActual = tipo;
    const btnAlmacen = document.getElementById('btnOrigenAlmacen');
    const btnEstante = document.getElementById('btnOrigenEstante');

    if (!btnAlmacen || !btnEstante) return;

    if (tipo === 'ALMACEN') {
        btnAlmacen.className = "px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-white text-neutral-950 transition-all duration-200";
        btnEstante.className = "px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white sm:text-neutral-400 hover:text-white transition-all duration-200";
    } else {
        btnEstante.className = "px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-white text-neutral-950 transition-all duration-200";
        btnAlmacen.className = "px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white sm:text-neutral-400 hover:text-white transition-all duration-200";
    }

    actualizarDatalistEsencias();
};

window.abrirModalHistorialSincro = function() {
    const modal = document.getElementById('modalHistorialSincro');
    if (modal) {
        modal.classList.remove('hidden');
        cargarHistorialSincro(); // Carga la data al abrir
    }
};


window.abrirModalDescargaExterna = async function() {
    try {
        const token = localStorage.getItem('token');
        
        // 1. Cargar Fórmulas
        const resFormulas = await fetch('/api/formulas', { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        if (!resFormulas.ok) throw new Error("Error al obtener las fórmulas base");
        const formulas = await resFormulas.json();
        
        const selectForm = document.getElementById('selectFormulaExterna');
        if (selectForm) {
            selectForm.innerHTML = '<option value="" disabled selected>-- SELECCIONE MEDIDA --</option>';
            formulas.forEach(f => {
                selectForm.innerHTML += `<option value="${f.id}">${f.nombre} (Alc: ${f.ml_alcohol}ml | Fij: ${f.gramos_fijador}g)</option>`;
            });
        }

        // 2. Traer productos y preparar buscador
        const resProds = await ProductoService.getAll(1, 1000, "", false);
        todosLosProductosSincro = resProds.data || [];

        actualizarDatalistEsencias();
        
        document.getElementById('inputEsenciaBuscador').value = '';
        document.getElementById('cantidadFormulaExterna').value = 1;
        document.getElementById('inputGramosExtraExterna').value = ''; 
        if (document.getElementById('inputFijadorExtraExterna')) document.getElementById('inputFijadorExtraExterna').value = ''; 
        document.getElementById('checkRecargaExterna').checked = false;
        
        grupoDescargaExterna = [];
        actualizarTablaGrupo();

        const inputBuscador = document.getElementById('inputEsenciaBuscador');
        inputBuscador.removeEventListener('input', filtrarDatalistEnTiempoReal);
        inputBuscador.addEventListener('input', filtrarDatalistEnTiempoReal);

        const modal = document.getElementById('modalDescargaExterna');
        if (modal) modal.classList.remove('hidden');

    } catch (error) {
        console.error("Error al inicializar la modal:", error);
        Swal.fire('Error de Acceso', 'No posees permisos o expiró tu sesión.', 'error');
    }
};

function actualizarDatalistEsencias() {
    const datalist = document.getElementById('esenciasDatalist');
    if (!datalist) return;
    datalist.innerHTML = ''; 

    const buscadorTexto = document.getElementById('inputEsenciaBuscador').value.toLowerCase().trim();

    todosLosProductosSincro.forEach(p => {
        const esEsencia = p.categoria && p.categoria.toUpperCase().includes('ESENCIA');
        if (!esEsencia) return;

        const stockAsignado = origenDescuentoActual === 'ALMACEN' ? parseFloat(p.stock_real || 0) : parseFloat(p.stock_estante || 0);
        if (stockAsignado <= 0) return;
        if (buscadorTexto && !p.nombre.toLowerCase().includes(buscadorTexto)) return;

        datalist.innerHTML += `<option value="${p.nombre}" data-id="${p.id}">Disponible: ${stockAsignado.toLocaleString()}g</option>`;
    });
}

function filtrarDatalistEnTiempoReal() {
    actualizarDatalistEsencias();
}

window.agregarAlGrupoDescarga = function() {
    const selectForm = document.getElementById('selectFormulaExterna');
    const inputBuscador = document.getElementById('inputEsenciaBuscador');
    const datalist = document.getElementById('esenciasDatalist');
    
    const cantidad = parseInt(document.getElementById('cantidadFormulaExterna').value) || 1;
    const gramosExtra = parseFloat(document.getElementById('inputGramosExtraExterna').value) || 0;
    const fijadorExtra = parseFloat(document.getElementById('inputFijadorExtraExterna').value) || 0; // NUEVO DATO
    const esRecarga = document.getElementById('checkRecargaExterna').checked;

    if (!selectForm.value || !inputBuscador.value || cantidad <= 0) {
        return Swal.fire('Campos vacíos', 'Completa la medida, busca una fragancia y asigna la cantidad.', 'warning');
    }

    const opcionSeleccionada = Array.from(datalist.options).find(opt => opt.value.toUpperCase() === inputBuscador.value.toUpperCase());
    
    if (!opcionSeleccionada) {
        return Swal.fire('Fragancia Inválida', 'La esencia escrita no está en el catálogo.', 'warning');
    }

    const productoId = opcionSeleccionada.getAttribute('data-id');

    grupoDescargaExterna.push({
        formulaId: selectForm.value,
        formulaTexto: selectForm.options[selectForm.selectedIndex].text.split('(')[0].trim(),
        productoId: productoId,
        esenciaTexto: inputBuscador.value,
        cantidad: cantidad,
        gramosExtra: gramosExtra,
        fijadorExtra: fijadorExtra, // GUARDADO SEGURO
        esRecarga: esRecarga
    });

    // Limpieza
    inputBuscador.value = '';
    document.getElementById('cantidadFormulaExterna').value = 1;
    document.getElementById('inputGramosExtraExterna').value = '';
    document.getElementById('inputFijadorExtraExterna').value = ''; // LIMPIA EL FIJADOR
    document.getElementById('checkRecargaExterna').checked = false;
    
    actualizarTablaGrupo();
    actualizarDatalistEsencias(); 
};

function actualizarTablaGrupo() {
    const tbody = document.getElementById('tbodyListaDescarga');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (grupoDescargaExterna.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-neutral-400 font-bold uppercase tracking-widest text-[10px]">Ningún perfume añadido al lote actual de vaciado.</td></tr>`;
        return;
    }

    grupoDescargaExterna.forEach((item, index) => {
        // Armamos un badge inteligente que muestra todos los extras
        let extras = [];
        if (item.gramosExtra > 0) extras.push(`+${item.gramosExtra}g Esencia`);
        if (item.fijadorExtra > 0) extras.push(`+${item.fijadorExtra}g Fijador`);
        if (item.esRecarga) extras.push(`RECARGA`);
        let badgeExtras = extras.length > 0 ? extras.join(' | ') : 'NORMAL';

        tbody.innerHTML += `
            <tr class="hover:bg-neutral-50 transition-colors">
                <td class="py-4 px-6 font-black text-neutral-950">${item.formulaTexto}</td>
                <td class="py-4 px-6 font-black text-neutral-700">${item.esenciaTexto}</td>
                <td class="py-4 px-6 text-center font-bold text-blue-600 text-[10px] uppercase">${badgeExtras}</td>
                <td class="py-4 px-6 text-center font-black text-neutral-950">${item.cantidad} Unds</td>
                <td class="py-4 px-6 text-center">
                    <button onclick="eliminarItemGrupo(${index})" class="text-neutral-400 hover:text-red-600 font-bold px-3 py-1 transition-colors text-sm">✕</button>
                </td>
            </tr>
        `;
    });
}

window.eliminarItemGrupo = function(index) {
    grupoDescargaExterna.splice(index, 1);
    actualizarTablaGrupo();
    actualizarDatalistEsencias();
};

window.cerrarModalHistorialSincro = function() {
    const modal = document.getElementById('modalHistorialSincro');
    if (modal) modal.classList.add('hidden');
};

async function cargarHistorialSincro() {
    const contenedor = document.getElementById('contenedorHistorialSincro');
    if (!contenedor) return;

    contenedor.innerHTML = '<div class="text-center py-8 text-neutral-500 text-xs font-bold uppercase tracking-widest"><i class="fa-solid fa-circle-notch fa-spin text-xl mb-2 block"></i> Cargando...</div>';

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/formulas/historial-externo', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();

        if (res.ok) {
            if (data.length === 0) {
                contenedor.innerHTML = `<div class="text-center py-8 border-2 border-dashed border-neutral-300 text-neutral-500 text-[10px] font-bold uppercase tracking-widest bg-white">Aún no hay descargas externas registradas en el historial.</div>`;
                return;
            }

            contenedor.innerHTML = data.map(lote => {
                const detalles = typeof lote.detalles_json === 'string' ? JSON.parse(lote.detalles_json) : lote.detalles_json;
                
                // Filas internas de productos
                const filasProductos = detalles.map(item => `
                    <div class="flex justify-between items-center py-3 border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                        <div class="flex flex-col">
                            <span class="text-xs font-black text-neutral-900">${item.nombre}</span>
                            <span class="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">${item.etiquetas || 'EXTERNO'}</span>
                        </div>
                        <div class="text-right flex flex-col">
                            <span class="text-[10px] font-black text-neutral-950 bg-neutral-200 px-2 py-0.5">${item.restadoEstante || item.restadoAlmacen || 'Descontado'}</span>
                        </div>
                    </div>
                `).join('');

                return `
                    <div class="bg-white border border-neutral-300 rounded-none overflow-hidden group shadow-sm hover:border-neutral-950 transition-colors">
                        <div class="bg-neutral-100 px-6 py-4 border-b border-neutral-300 flex justify-between items-center">
                            <div>
                                <span class="text-[10px] font-black bg-neutral-950 text-white px-2 py-1 uppercase tracking-widest mr-2">
                                    LOTE #${lote.id}
                                </span>
                                <span class="text-xs font-bold text-neutral-600 uppercase tracking-wider">
                                    ${new Date(lote.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                            </div>
                            <div class="text-[10px] font-black text-neutral-500 uppercase tracking-widest">
                                <i class="fa-solid fa-user mr-1"></i> ${lote.operador || 'Sistema'}
                            </div>
                        </div>
                        <div class="px-6 py-2">
                            ${filasProductos}
                        </div>
                        <div class="bg-neutral-50 px-6 py-3 border-t border-neutral-200 text-right">
                            <span class="text-[10px] font-black text-neutral-900 uppercase tracking-widest">
                                Total Descargado: ${lote.cantidad_items} artículos
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error("Error cargando historial de sincronización:", error);
        contenedor.innerHTML = `<div class="text-center py-8 text-red-600 text-xs font-bold uppercase tracking-widest">Error al cargar el historial.</div>`;
    }
}

window.procesarDescargaExterna = async function() {
    if (grupoDescargaExterna.length === 0) {
        return Swal.fire('Grupo vacío', 'Agrega al menos una preparación antes de procesar.', 'warning');
    }

    Swal.fire({ 
        title: 'Analizando existencias en almacén y estantes...', 
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading() 
    });

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/formulas/consumir-externo', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ lotes: grupoDescargaExterna, origen: origenDescuentoActual })
        });

        const resultado = await res.json();

        if (res.ok) {
            cerrarModalDescargaExterna();
            
            let reporteAlertas = `<div class="text-left text-xs font-mono space-y-1.5 max-h-48 overflow-y-auto bg-neutral-900 text-neutral-200 p-4 rounded-none border border-neutral-700 mt-2">`;
            resultado.reporteMovimientos.forEach(m => {
                reporteAlertas += `<p class="border-b border-neutral-800 pb-1">
                    • <span class="text-amber-400 font-bold">${m.nombre}</span><br>
                    <span class="text-[10px] text-neutral-400">Tipo: ${m.etiquetas}</span><br>
                    [Almacén: ${m.restadoAlmacen} | Estante: ${m.restadoEstante}]
                </p>`;
            });
            reporteAlertas += `</div>`;

            await Swal.fire({
                icon: 'success',
                title: '¡Sincronización Exitosa!',
                html: `<span class="text-xs text-neutral-500 font-bold uppercase tracking-wide">Rebajas físicas aplicadas de forma directa.</span><br>${reporteAlertas}`,
                confirmButtonColor: '#0a0a0a'
            });

            await cargarTabla(); // Recarga la tabla de inventario general principal
        } else {
            throw new Error(resultado.error);
        }
    } catch (error) {
        Swal.fire('Quiebre de Inventario', error.message, 'error');
    }
};

window.cerrarModalDescargaExterna = function() {
    const modal = document.getElementById('modalDescargaExterna');
    if (modal) modal.classList.add('hidden');
};

let timeoutProdsMasa;

window.abrirModalBajarMasa = function() {
    document.getElementById('idProdMasaSeleccionado').value = '';
    document.getElementById('inputBuscarProdMasa').value = '';
    document.getElementById('cantBotellasMasa').value = '';
    document.getElementById('dropdownProdsMasa').classList.add('hidden');
    document.getElementById('modalBajarInventarioMasa').classList.remove('hidden');
};

window.filtrarProductosMasaPOS = function(texto) {
    clearTimeout(timeoutProdsMasa);
    const dropdown = document.getElementById('dropdownProdsMasa');
    const inputOculto = document.getElementById('idProdMasaSeleccionado');
    texto = texto.trim().toUpperCase();

    if (texto.length === 0) {
        dropdown.classList.add('hidden');
        inputOculto.value = '';
        return;
    }

    timeoutProdsMasa = setTimeout(async () => {
        try {
            const token = localStorage.getItem('token');
            // Buscamos directamente en la base de datos de productos usando tu endpoint existente
            const res = await fetch(`/api/productos?buscar=${texto}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const productos = await res.json();
            const lista = Array.isArray(productos) ? productos : (productos.data || productos.productos || []);

            if (lista.length === 0) {
                dropdown.innerHTML = '<div class="p-3 text-[10px] text-neutral-400 font-bold uppercase text-center">No se encontraron productos</div>';
            } else {
                dropdown.innerHTML = lista.slice(0, 10).map(p => `
                    <div onclick="seleccionarProdMasaDropdown(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${p.stock_unidades})" class="p-3 border-b border-neutral-100 hover:bg-neutral-100 cursor-pointer flex justify-between items-center transition-colors">
                        <span class="text-xs font-black text-neutral-950 uppercase tracking-wider">${p.nombre}</span>
                        <span class="text-[9px] font-mono bg-neutral-100 border text-neutral-600 px-2 py-0.5 rounded">Depósito: ${parseFloat(p.stock_unidades).toFixed(0)} u.</span>
                    </div>
                `).join('');
            }
            dropdown.classList.remove('hidden');
        } catch (err) {
            console.error("Error al filtrar fragancias:", err);
        }
    }, 250);
};

// =========================================================================
// NUEVA LÓGICA: HISTORIAL DE SINCRONIZACIÓN EXTERNA
// =========================================================================

window.abrirModalHistorialSincro = function() {
    const modal = document.getElementById('modalHistorialSincro');
    if (modal) {
        modal.classList.remove('hidden');
        cargarHistorialSincro(); 
    }
};

window.cerrarModalHistorialSincro = function() {
    const modal = document.getElementById('modalHistorialSincro');
    if (modal) modal.classList.add('hidden');
};



window.seleccionarProdMasaDropdown = function(id, nombre, stockUnidades) {
    document.getElementById('idProdMasaSeleccionado').value = id;
    document.getElementById('inputBuscarProdMasa').value = nombre;
    document.getElementById('dropdownProdsMasa').classList.add('hidden');
    document.getElementById('cantBotellasMasa').placeholder = `Disponible: ${stockUnidades}`;
    document.getElementById('cantBotellasMasa').focus();
};

window.abrirModalVaciadoTotal = async function() {
    const modal = document.getElementById('modalVaciadoInventario');
    const checklistContainer = document.getElementById('listaChecklistVaciado');
    const checkTodo = document.getElementById('checkTodoVaciado');
    const contador = document.getElementById('contadorSeleccionadosVaciado');
    
    if (checkTodo) checkTodo.checked = false;
    if (contador) contador.innerText = "0 Sel.";
    checklistContainer.innerHTML = '<div class="text-center py-12 font-bold text-xs uppercase text-neutral-400 animate-pulse">Verificando seguridad y extrayendo cantidades...</div>';
    modal.classList.remove('hidden');

    try {
        const token = localStorage.getItem('token');
        
        if (!token) {
            checklistContainer.innerHTML = '<div class="text-center py-14 font-black text-sm uppercase text-red-500"><i class="fa-solid fa-lock text-2xl mb-2 block"></i>ERROR: SESIÓN EXPIRADA. <br><span class="text-[10px] text-neutral-500">Cierra sesión y vuelve a ingresar.</span></div>';
            return;
        }

        const res = await fetch('/api/productos?limit=5000', {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const datos = await res.json();

        if (!res.ok) {
            checklistContainer.innerHTML = `<div class="text-center py-14 font-black text-xs uppercase text-red-500">ACCESO DENEGADO: ${datos.error || 'Token Inválido'}</div>`;
            return;
        }
        
        let lista = Array.isArray(datos) ? datos : (datos.productos || datos.rows || datos.data || []);
        
        if (lista.length === 0 && datos && typeof datos === 'object') {
            for (const prop in datos) {
                if (Array.isArray(datos[prop])) { lista = datos[prop]; break; }
            }
        }

        if (!lista || lista.length === 0) {
            checklistContainer.innerHTML = '<div class="text-center py-14 font-black text-xs uppercase text-neutral-400">El inventario está vacío.</div>';
            return;
        }

        checklistContainer.innerHTML = lista.map(p => {
            const nombreReal = p.nombre || p.name || p.descripcion || 'ARTÍCULO SIN NOMBRE';
            const categoriaReal = p.categoria || p.category || 'Materia Prima';
            
            // 👉 AQUÍ ESTÁ LA SOLUCIÓN: Agregamos p.stock_real de primero
            let stockRaw = p.stock_real ?? p.stock_unidades ?? p.stock_general ?? p.stock ?? p.cantidad ?? p.stock_actual ?? p.unidades ?? 0;
            const stockDeposito = parseFloat(stockRaw) || 0;
            
            const tieneStock = stockDeposito > 0;
            
            const inputHTML = tieneStock 
                ? `<input type="checkbox" value="${p.id}" class="check-item-vaciado accent-neutral-950 w-4 h-4 cursor-pointer" onchange="actualizarContadorVaciado()">`
                : `<input type="checkbox" class="w-4 h-4 opacity-20 cursor-not-allowed" disabled title="Sin stock en depósito general">`;

            const opacidadClase = tieneStock ? '' : 'opacity-40 bg-neutral-50';

            return `
                <label class="flex items-center justify-between py-3.5 px-2 hover:bg-neutral-50 cursor-pointer select-none transition-colors border-b border-neutral-100 last:border-0 ${opacidadClase}">
                    <div class="flex items-center gap-4">
                        ${inputHTML}
                        <div class="flex flex-col">
                            <span class="text-xs font-black text-neutral-950 uppercase tracking-wide leading-tight">${nombreReal}</span>
                            <span class="text-[9px] font-bold text-neutral-400 uppercase mt-0.5">${categoriaReal}</span>
                        </div>
                    </div>
                    <span class="text-[10px] font-mono font-black bg-neutral-100 border px-2 py-0.5 ${tieneStock ? 'text-neutral-700 border-neutral-300' : 'text-neutral-400 border-neutral-200'}">
                        Depósito: ${stockDeposito.toFixed(0)} u.
                    </span>
                </label>
            `;
        }).join('');

    } catch (error) {
        console.error("❌ Error leyendo stock:", error);
        checklistContainer.innerHTML = '<div class="text-center py-14 font-black text-xs uppercase text-red-500">Error de conexión al leer el stock.</div>';
    }
};

// Amarra la función para que el botón negro la detecte
window.abrirModalVaciTotal = window.abrirModalVaciadoTotal;

window.toggleSeleccionarTodoVaciado = function(checked) {
    const checkboxes = document.querySelectorAll('.check-item-vaciado');
    checkboxes.forEach(cb => cb.checked = checked);
    actualizarContadorVaciado();
};

window.actualizarContadorVaciado = function() {
    const seleccionados = document.querySelectorAll('.check-item-vaciado:checked').length;
    document.getElementById('contadorSeleccionadosVaciado').innerText = `${seleccionados} Sel.`;
};

window.procesarVaciadoTotalAbajo = async function() {
    const checkboxes = document.querySelectorAll('.check-item-vaciado:checked');
    const destino = document.getElementById('destinoVaciado').value;
    const fila = document.getElementById('pisoVaciado').value;

    if (checkboxes.length === 0) {
        return Swal.fire('Atención', 'Por favor, marca al menos una casilla de la lista para procesar.', 'warning');
    }

    const idsSeleccionados = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

    const confirmacion = await Swal.fire({
        title: '💥 ¿Confirmar Operación en Masa?',
        text: `Vas a retirar TODAS las unidades disponibles en depósito de los ${idsSeleccionados.length} artículos marcados para transformarlos en botellas de mostrador en el Estante ${destino} (Nivel ${fila}).`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '¡Sí, mover todo abajo!',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0a0a0a',
        cancelButtonColor: '#d33'
    });

    if (!confirmacion.isConfirmed) return;

    try {
        Swal.fire({ title: 'Vaciando almacén y sembrando estantes...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        const token = localStorage.getItem('token');

        const res = await fetch('/api/productos/vaciado-masivo', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ ids: idsSeleccionados, destino, fila })
        });

        const data = await res.json();

        if (res.ok) {
            document.getElementById('modalVaciadoInventario').classList.add('hidden');
            await Swal.fire({ icon: 'success', title: '¡Traslado Consolidado!', text: data.mensaje, confirmButtonColor: '#0a0a0a' });
            
            // Refrescar tu tabla de inventario principal
            if (typeof init === 'function') init();
            else if (typeof cargarInventario === 'function') cargarInventario();
        } else {
            Swal.fire('Error en Lote', data.error, 'error');
        }
    } catch (e) {
        Swal.fire('Error', 'Fallo de comunicación con el servidor', 'error');
    }
};


(function () {
    // Referencias a los elementos del DOM
    const btnTabCargar = document.getElementById('btnTabCargar');
    const btnTabMovimientos = document.getElementById('btnTabMovimientos');
    const tabCargarExcel = document.getElementById('tabCargarExcel');
    const tabMovimientosExcel = document.getElementById('tabMovimientosExcel');
    
    const inputExcelFile = document.getElementById('inputExcelFile');
    const excelFileName = document.getElementById('excelFileName');
    const btnProcesarExcel = document.getElementById('btnProcesarExcel');
    const tablaHistorialExcel = document.getElementById('tablaHistorialExcel');

    let archivoSeleccionado = null;

    if (!btnTabCargar) return; // Failsafe

    // 1. NAVEGACIÓN ENTRE PESTAÑAS (Estilos Corporativos)
    const claseTabActiva = "px-6 py-4 text-xs font-black text-white bg-neutral-950 uppercase tracking-widest transition-colors border-r border-neutral-300";
    const claseTabInactiva = "px-6 py-4 text-xs font-bold text-neutral-500 hover:text-neutral-900 bg-transparent uppercase tracking-widest transition-colors";

    btnTabCargar.addEventListener('click', () => {
        btnTabCargar.className = claseTabActiva;
        btnTabMovimientos.className = claseTabInactiva;
        tabCargarExcel.classList.remove('hidden');
        tabMovimientosExcel.classList.add('hidden');
    });

    btnTabMovimientos.addEventListener('click', () => {
        btnTabMovimientos.className = claseTabActiva;
        btnTabCargar.className = claseTabInactiva;
        tabMovimientosExcel.classList.remove('hidden');
        tabCargarExcel.classList.add('hidden');
        cargarHistorialImportaciones(); // Recarga la tabla al abrir la pestaña
    });

    // 2. CAPTURA DEL ARCHIVO EXCEL
    inputExcelFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            archivoSeleccionado = file;
            excelFileName.innerHTML = `<i class="fa-solid fa-file-check text-green-600 mr-2"></i> ${file.name}`;
            btnProcesarExcel.classList.remove('hidden');
        }
    });

    // 3. PROCESAR Y ENVIAR AL BACKEND


window.inicializarModuloExcel = function () {
    const btnTabCargar = document.getElementById('btnTabCargar');
    const btnTabMovimientos = document.getElementById('btnTabMovimientos');
    const tabCargarExcel = document.getElementById('tabCargarExcel');
    const tabMovimientosExcel = document.getElementById('tabMovimientosExcel');
    
    const inputExcelFile = document.getElementById('inputExcelFile');
    const excelFileName = document.getElementById('excelFileName');
    const btnProcesarExcel = document.getElementById('btnProcesarExcel');

    let archivoSeleccionado = null;

    if (!btnTabCargar) return; // Seguro contra fallos

    const claseTabActiva = "flex-1 py-4 text-[10px] font-black text-white bg-neutral-950 uppercase tracking-widest transition-colors border-r border-neutral-300";
    const claseTabInactiva = "flex-1 py-4 text-[10px] font-bold text-neutral-500 hover:text-neutral-900 bg-transparent uppercase tracking-widest transition-colors border-r border-neutral-300";

    btnTabCargar.addEventListener('click', () => {
        btnTabCargar.className = claseTabActiva;
        btnTabMovimientos.className = claseTabInactiva;
        tabCargarExcel.classList.remove('hidden');
        tabMovimientosExcel.classList.add('hidden');
    });

    btnTabMovimientos.addEventListener('click', () => {
        btnTabMovimientos.className = claseTabActiva;
        btnTabCargar.className = claseTabInactiva;
        tabMovimientosExcel.classList.remove('hidden');
        tabCargarExcel.classList.add('hidden');
        window.cargarHistorialImportaciones(); 
    });

    inputExcelFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            archivoSeleccionado = file;
            excelFileName.innerHTML = `<i class="fa-solid fa-file-check text-green-600 mr-2"></i> ${file.name}`;
            btnProcesarExcel.classList.remove('hidden');
        }
    });

    btnProcesarExcel.addEventListener('click', async () => {
        if (!archivoSeleccionado) return;

        Swal.fire({
            title: 'ANALIZANDO EXCEL MULTI-HOJA',
            text: 'Extrayendo todas las pestañas y vinculando al backend inteligente...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // 🧠 NUEVO: Recopilar todas las hojas del Excel
                const todasLasHojas = {};
                workbook.SheetNames.forEach(nombreHoja => {
                    const jsonSheet = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { defval: "" });
                    if (jsonSheet.length > 0) {
                        todasLasHojas[nombreHoja] = jsonSheet;
                    }
                });

                if (Object.keys(todasLasHojas).length === 0) throw new Error("El archivo Excel está vacío.");

                const inputProv = document.getElementById('inputProveedorExcel');
                const proveedorFinal = inputProv && inputProv.value.trim() !== '' ? inputProv.value.trim().toUpperCase() : 'No Especificado';

                const token = localStorage.getItem('token');
                
                // Enviamos el objeto con TODAS las hojas al backend
                const res = await fetch('/api/productos/importar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ 
                        productos: todasLasHojas, 
                        nombre_archivo: archivoSeleccionado.name, 
                        proveedor: proveedorFinal 
                    })
                });

                const respuesta = await res.json();

                if (res.ok) {
                    Swal.fire({ 
                        icon: 'success', 
                        title: 'CARGA COMPLETADA', 
                        html: `${respuesta.mensaje}<br><br><span class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Hojas: ${Object.keys(todasLasHojas).join(', ')}</span>`, 
                        confirmButtonColor: '#0f172a', 
                        customClass: { popup: 'rounded-none', confirmButton: 'rounded-none uppercase tracking-widest text-xs' } 
                    });
                    
                    archivoSeleccionado = null;
                    excelFileName.innerHTML = 'Arrastra o haz clic para subir (.xlsx)';
                    btnProcesarExcel.classList.add('hidden');
                    inputExcelFile.value = '';
                    if (inputProv) inputProv.value = '';
                    
                    if(typeof cargarTabla === 'function') cargarTabla();
                    if(typeof window.cargarHistorialImportaciones === 'function') window.cargarHistorialImportaciones();
                } else {
                    throw new Error(respuesta.error || 'Error desconocido al cargar.');
                }
            } catch (error) {
                Swal.fire({ icon: 'error', title: 'ERROR DE FORMATO', text: error.message, confirmButtonColor: '#0f172a', customClass: { popup: 'rounded-none', confirmButton: 'rounded-none uppercase tracking-widest text-xs' } });
            }
        };
        reader.readAsArrayBuffer(archivoSeleccionado);
    });
};

    // 4. CARGAR HISTORIAL DE MOVIMIENTOS
    window.cargarHistorialImportaciones = async function() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/productos/importaciones/historial', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();

        if (res.ok) {
            window.renderizarTablaHistorial(data);
            window.renderizarRentabilidadSimulada(data);
        }
    } catch (error) {
        console.error("Error cargando historial:", error);
    }
};




    // 5. PINTAR LA TABLA DE HISTORIAL
    window.renderizarTablaHistorial = function(historial) {
    const tabla = document.getElementById('tablaHistorialExcel');
    if (!tabla) return;

    if (!historial || historial.length === 0) {
        tabla.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-neutral-500 text-xs font-bold uppercase tracking-widest">No hay registros de importación.</td></tr>`;
        return;
    }

    tabla.innerHTML = historial.map(h => {
        const esRevertido = h.estado === 'REVERTIDO';
        const estadoHtml = esRevertido 
            ? `<span class="px-2 py-1 bg-red-100 text-red-800 text-[9px] font-black uppercase tracking-widest border border-red-200">Revertido</span>`
            : `<span class="px-2 py-1 bg-green-100 text-green-800 text-[9px] font-black uppercase tracking-widest border border-green-200">Aplicado</span>`;
        
        let accionHtml = `<button onclick="window.descargarExcelAuditoria(${h.id})" class="bg-emerald-50 hover:bg-emerald-600 text-emerald-600 hover:text-white border border-emerald-200 px-3 py-1.5 font-bold uppercase tracking-widest text-[9px] transition-colors rounded-none mr-2" title="Descargar Fotografía del Excel Original"><i class="fa-solid fa-download"></i></button>`;

        if (esRevertido) {
            accionHtml += `<span class="text-neutral-400 text-[10px] font-bold uppercase tracking-widest px-2"><i class="fa-solid fa-ban"></i> Anulado</span>`;
        } else {
            accionHtml += `<button onclick="window.revertirCargaExcel(${h.id}, '${h.nombre_archivo}')" class="text-red-600 hover:text-white hover:bg-red-600 border border-transparent hover:border-red-700 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-colors rounded-none" title="Anular y descontar del inventario"><i class="fa-solid fa-rotate-left"></i> Revertir</button>`;
        }

        return `
            <tr class="hover:bg-neutral-50 border-b border-neutral-100 transition-colors">
                <td class="px-4 py-4">
                    <p class="text-xs font-black text-neutral-900">${new Date(h.fecha).toLocaleDateString('es-ES')}</p>
                    <p class="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">${h.usuario_nombre || 'Sistema'}</p>
                </td>
                <td class="px-4 py-4">
                    <p class="text-xs font-black text-neutral-950">${h.nombre_archivo}</p>
                    <p class="text-[9px] font-bold text-blue-600 uppercase tracking-widest"><i class="fa-solid fa-truck-field"></i> ${h.proveedor || 'No especificado'}</p>
                </td>
                <td class="px-4 py-4 text-center">${estadoHtml}</td>
                <td class="px-4 py-4 text-right flex justify-end items-center h-full">${accionHtml}</td>
            </tr>
        `;
    }).join('');
};

    // 6. FUNCIÓN DE REVERSIÓN (Botón de Pánico)
    window.revertirCargaExcel = async function(id, nombreArchivo) {
    Swal.fire({
        title: '¿REVERTIR CARGA?',
        html: `<p class="text-sm text-neutral-600 mb-2">Estás a punto de anular el archivo:</p><p class="font-black text-neutral-950">${nombreArchivo}</p><p class="text-xs text-red-600 font-bold mt-4">⚠️ Se restará el stock añadido y se eliminaran los lotes generados.</p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'SÍ, REVERTIR AHORA',
        cancelButtonText: 'CANCELAR',
        customClass: { popup: 'rounded-none border border-neutral-400', confirmButton: 'rounded-none text-xs font-bold tracking-widest uppercase py-3 px-6', cancelButton: 'rounded-none text-xs font-bold tracking-widest uppercase py-3 px-6' }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'Anulando Lotes...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/productos/importaciones/${id}/revertir`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
                const data = await res.json();
                if (res.ok) {
                    Swal.fire({ icon: 'success', title: 'REVERTIDO', text: data.mensaje, confirmButtonColor: '#0f172a', customClass: { popup: 'rounded-none', confirmButton: 'rounded-none' } });
                    window.cargarHistorialImportaciones();
                    if(typeof cargarTabla === 'function') cargarTabla();
                } else { throw new Error(data.error); }
            } catch (error) { Swal.fire({ icon: 'error', title: 'ERROR CRÍTICO', text: error.message, confirmButtonColor: '#0f172a', customClass: { popup: 'rounded-none', confirmButton: 'rounded-none' } }); }
        }
    });
};

    // 7. RENTABILIDAD POR PROVEEDOR (Resumen Visual Rápido)
window.renderizarRentabilidadSimulada = function(historial) {
    const grid = document.getElementById('gridRentabilidad');
    if (!grid) return;

    const aplicados = historial.filter(h => h.estado === 'APLICADO');
    let totalCosto = 0; let totalProyeccion = 0;
    
    aplicados.forEach(h => {
        totalCosto += parseFloat(h.inversion_total || 0);
        totalProyeccion += parseFloat(h.precio_proyectado || 0);
    });

    const rentabilidad = totalProyeccion - totalCosto;

    grid.innerHTML = `
        <div class="bg-neutral-950 p-6 border border-neutral-950 text-white rounded-none shadow-sm">
            <p class="text-[10px] text-neutral-400 font-bold tracking-widest uppercase mb-1">Inversión Costo</p>
            <h4 class="text-2xl font-black text-amber-400">$${totalCosto.toFixed(2)}</h4>
        </div>
        <div class="bg-white p-6 border border-neutral-300 rounded-none shadow-sm">
            <p class="text-[10px] text-neutral-500 font-bold tracking-widest uppercase mb-1">Proyección de Venta</p>
            <h4 class="text-2xl font-black text-neutral-950 mt-1">$${totalProyeccion.toFixed(2)}</h4>
        </div>
        <div class="bg-emerald-50 p-6 border border-emerald-200 rounded-none shadow-sm">
            <p class="text-[10px] text-emerald-700 font-bold tracking-widest uppercase mb-1">Rentabilidad Bruta</p>
            <h4 class="text-2xl font-black text-emerald-600 mt-1">+$${rentabilidad.toFixed(2)}</h4>
        </div>
    `;
};

})();

window.abrirModalExcel = function() {
    const modal = document.getElementById('modalExcel');
    if (modal) {
        modal.classList.remove('hidden');
        
        // Simular clic en la pestaña de cargar para limpiar vistas
        const btnTabCargar = document.getElementById('btnTabCargar');
        if (btnTabCargar) btnTabCargar.click();

        const excelFileName = document.getElementById('excelFileName');
        if (excelFileName) excelFileName.innerHTML = 'Arrastra o haz clic para subir (.xlsx)';
        
        const btnProcesarExcel = document.getElementById('btnProcesarExcel');
        if (btnProcesarExcel) btnProcesarExcel.classList.add('hidden');
        
        const inputExcelFile = document.getElementById('inputExcelFile');
        if (inputExcelFile) inputExcelFile.value = '';
    }
};

window.cerrarModalExcel = function() {
    const modal = document.getElementById('modalExcel');
    if (modal) modal.classList.add('hidden');
};


// =========================================================================
// LÓGICA PARA VER LOS LOTES DE UN PRODUCTO
// =========================================================================

window.verLotes = async (id, nombre) => {
    const modal = document.getElementById('modalLotes');
    const title = document.getElementById('lotesProductoTitle');
    const tbody = document.getElementById('tablaLotes');

    title.innerHTML = nombre; 
    modal.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="3" class="p-10 text-center text-neutral-400 font-bold uppercase tracking-widest text-[10px]"><i class="fa-solid fa-circle-notch fa-spin text-xl mb-2 block"></i>Consultando bóveda de lotes...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/productos/${id}/lotes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const lotes = await response.json();
        
        if (!response.ok) throw new Error("Error obteniendo lotes");

        if(lotes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-neutral-400 font-bold uppercase tracking-widest text-[10px]">No hay lotes activos para este producto.</td></tr>';
            return;
        }

        tbody.innerHTML = lotes.map(l => {
            const fecha = l.fecha_vencimiento ? new Date(l.fecha_vencimiento).toLocaleDateString('es-ES') : 'N/A';
            return `
                <tr class="hover:bg-neutral-50 transition-colors border-b border-neutral-100">
                    <td class="p-4 text-xs font-black text-neutral-950">${l.codigo_lote}</td>
                    <td class="p-4 text-center font-bold text-neutral-600">${parseFloat(l.cantidad_actual).toLocaleString()}</td>
                    <td class="p-4 text-center text-[10px] font-bold text-neutral-500 uppercase tracking-widest">${fecha}</td>
                </tr>
            `;
        }).join('');

    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-600 font-bold uppercase tracking-widest text-[10px]">Error de conexión al cargar lotes.</td></tr>';
    }
};

window.cerrarModalLotes = () => {
    const modal = document.getElementById('modalLotes');
    if (modal) modal.classList.add('hidden');
};

window.descargarExcelAuditoria = async function(idCarga) {
    try {
        const token = localStorage.getItem('token');
        const url = `/api/productos/importaciones/${idCarga}/descargar`;

        // Mostramos alerta de carga mientras el servidor reconstruye el Excel
        Swal.fire({
            title: 'Recuperando Archivo...',
            text: 'Extrayendo el documento original de la bóveda de auditoría.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || 'No se pudo descargar el archivo.');
        }

        // Convertimos la respuesta en un archivo binario (Blob)
        const blob = await res.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        
        // Creamos un enlace invisible y forzamos el clic para descargar
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `Auditoria_Carga_Masiva_${idCarga}.xlsx`; // Nombre del archivo
        document.body.appendChild(link);
        link.click();
        
        // Limpiamos la memoria
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);

        Swal.close(); // Cerramos la alerta de carga

    } catch (error) {
        console.error("Error al descargar auditoría:", error);
        Swal.fire('Error', error.message, 'error');
    }
};