import { ProductoService, ClienteService, FormulaService, CajaService, UsuarioService } from '../../js/api.js';

let todosLosProductos = []; 
let inventario = []; 

let carrito = JSON.parse(localStorage.getItem('carrito_pos_respaldo')) || [];

let formulasGlobales = [];
let productoPendiente = null;
let modoVista = 'productos'; 
let clienteActual = { id: 1, nombre: 'Consumidor Final', documento: '00000000' };

let productoAlcohol = null;
let productoFijador = null;
let inventarioEnvases = [];
let modoRecargaActual = false;

let promoMaxPerfumes = 0;
let esModoLoteEstandar = false;
let estandarDataActual = null;
let promoPerfumesAgregados = 0;
let loteEsenciasPromo = [];
let promoDataActual = null;
let timeoutBuscadorLote;

let busquedaActual = "";

let pagosRealizados = [];
let monedaPagoActual = 'USD'; 
let tasaCambio = 325.38;

let estadoCaja = false;

let listaUsuarios = [];

const beepOk = new Audio('https://actions.google.com/sounds/v1/cartoon/pop.ogg');
const beepError = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');


export async function init() {
    console.log("Facturación Unificada - Iniciada");

    const borrador = recuperarBorradorGeneral();
    if (borrador) {
        const result = await Swal.fire({
            title: '¿Pedido pendiente encontrado?',
            text: `Tienes un pedido de ${borrador.carrito.length} items guardado el ${new Date(borrador.fecha_guardado).toLocaleTimeString()}. ¿Deseas recuperarlo?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, recuperar',
            cancelButtonText: 'No, iniciar nuevo'
        });

        if (result.isConfirmed) {
            carrito = borrador.carrito;
            clienteActual = borrador.cliente;
            pagosRealizados = borrador.pagos;
            modoVista = borrador.modo;
            // Restaurar visuales
            renderCarrito();
            // Restaurar cliente visualmente
            document.getElementById('infoCliente').innerText = clienteActual.nombre;
            document.getElementById('docCliente').innerText = clienteActual.documento;
        } else {
            localStorage.removeItem('pos_state_draft');
        }
    }

    try {
        const token = localStorage.getItem('token');
        
        // Cargar Tasa
        const resTasa = await fetch('/api/ajustes/tasa', { headers: { 'Authorization': `Bearer ${token}` } });
        if(resTasa.ok) {
            const dataTasa = await resTasa.json();
            tasaCambio = parseFloat(dataTasa.tasa) || 0;
            const inputTasa = document.getElementById('tasaCobro');
            if(inputTasa) inputTasa.value = tasaCambio.toFixed(2);
        }


        configurarBuscador();
        configurarBuscadorClientes();

        // Cargar Fórmulas y Productos
        formulasGlobales = await FormulaService.getAll() || [];
        await cargarCatalogo(); // Ahora carga todo de una vez

    } catch(e) { console.error("Error inicial:", e); }

    if (carrito.length > 0) {
        renderCarrito();
    }
}

function configurarBuscadorClientes() {
    const input = document.getElementById('inputBuscarCliente');
    if(!input) return;

    let timeoutCliente; // Variable para controlar el tiempo de espera

    input.addEventListener('input', (e) => {
        const texto = e.target.value.trim();

        // Limpiamos el temporizador anterior
        clearTimeout(timeoutCliente);

        // Si el campo está vacío, limpiamos la lista visual
        if(texto.length === 0) {
            renderClientes([]);
            return;
        }

        // Esperamos 500ms antes de llamar a la API (Para que no busque por cada letra)
        timeoutCliente = setTimeout(async () => {
            try {
                // Llamada al servicio
                const res = await ClienteService.buscar(texto);
                
                const lista = Array.isArray(res) ? res : (res.data || []);
                
                renderClientes(lista);
                
            } catch(err) {
                console.error("Error buscando clientes:", err);
            }
        }, 500); 
    });
}

window.cambiarModo = function(modo) {
    modoVista = modo;
    console.log("Cambiando modo a:", modo);

    const tabP = document.getElementById('tabProductos');
    const tabE = document.getElementById('tabEsencias');
    const tabR = document.getElementById('tabRecargas');
    const tabI = document.getElementById('btn-modo-insumos'); // 🔥 Tu nuevo botón HTML

    // 1. Resetear estilos visuales de las pestañas
    const estiloInactivo = "pb-3 border-b-2 border-transparent text-gray-400 font-bold text-sm transition flex items-center gap-2 px-2 select-none cursor-pointer hover:text-blue-500";
    if(tabP) tabP.className = estiloInactivo;
    if(tabE) tabE.className = "pb-3 border-b-2 border-transparent text-gray-400 font-bold text-sm transition flex items-center gap-2 px-2 select-none cursor-pointer hover:text-purple-600";
    if(tabR) tabR.className = "pb-3 border-b-2 border-transparent text-gray-400 font-bold text-sm transition flex items-center gap-2 px-2 select-none cursor-pointer hover:text-green-600";
    if(tabI) tabI.className = "px-6 py-3 rounded-lg font-bold text-xs uppercase tracking-wider transition-all text-slate-500 bg-slate-100 hover:bg-slate-200 cursor-pointer";

    // 2. Aplicar filtros de inventario según el modo seleccionado
    if (modo === 'productos') {
        if(tabP) tabP.className = "pb-3 border-b-2 border-blue-600 font-bold text-blue-600 text-sm transition flex items-center gap-2 hover:bg-blue-50/50 px-2 rounded-t-lg select-none cursor-pointer";
        inventario = [...todosLosProductos]; 
    } 
    else if (modo === 'esencias') {
        if(tabE) tabE.className = "pb-3 border-b-2 border-purple-600 font-bold text-purple-600 text-sm transition flex items-center gap-2 px-2 select-none cursor-pointer";
        inventario = todosLosProductos.filter(p => {
            const cat = (p.categoria || '').toUpperCase();
            return !['ALCOHOL', 'FIJADOR', 'ENVASES', 'ENVASE', 'FRASCO', 'TESTER'].some(x => cat.includes(x));
        });
    }
    else if (modo === 'recargas') {
        if(tabR) tabR.className = "pb-3 border-b-2 border-green-600 font-bold text-green-600 text-sm transition flex items-center gap-2 px-2 select-none cursor-pointer";
        inventario = todosLosProductos.filter(p => {
            const cat = (p.categoria || '').toUpperCase();
            return !['ALCOHOL', 'FIJADOR', 'ENVASES', 'ENVASE', 'FRASCO', 'TESTER'].some(x => cat.includes(x));
        });
    }
    else if (modo === 'insumos') {
        // 🔥 NUEVA VISTA: Muestra Perfumes 1.1 e Insumos
        if(tabI) tabI.className = "px-6 py-3 rounded-lg font-bold text-xs uppercase tracking-wider transition-all text-white bg-slate-900 shadow-md cursor-pointer";
        inventario = todosLosProductos.filter(p => {
            const cat = (p.categoria || '').toUpperCase();
            const nom = (p.nombre || '').toUpperCase();
            // Mostrará todo lo que tenga "1.1", "Envase", o "Insumo" en el nombre o categoría
            return nom.includes('1.1') || cat.includes('INSUMO') || cat.includes('ENVASE') || nom.includes('FRASCO');
        });
    }

    // 3. Renderizar el catálogo
    renderCatalogo(inventario);
};

function cargarInsumosEstrategicos() {
    // 🔥 SOLUCIÓN DEFINITIVA: Ordenamos para que priorice el insumo que SÍ tiene stock en la sucursal (estante + almacén)
    productoAlcohol = todosLosProductos
        .filter(p => p.nombre.toUpperCase().includes("ALCOHOL") || p.categoria === 'Alcohol')
        .sort((a, b) => {
            const stockA = parseFloat(a.stock_estante || 0) + parseFloat(a.stock_unidades || 0);
            const stockB = parseFloat(b.stock_estante || 0) + parseFloat(b.stock_unidades || 0);
            return stockB - stockA; // Coloca el que tiene más stock de primero
        })[0] || null; // Tomamos el mejor o null si no existe

    productoFijador = todosLosProductos
        .filter(p => p.nombre.toUpperCase().includes("FIJADOR") || p.categoria === 'Fijador')
        .sort((a, b) => {
            const stockA = parseFloat(a.stock_estante || 0) + parseFloat(a.stock_unidades || 0);
            const stockB = parseFloat(b.stock_estante || 0) + parseFloat(b.stock_unidades || 0);
            return stockB - stockA;
        })[0] || null;

    // Hacemos lo mismo con los envases para que mapee todo el inventario de frascos
    inventarioEnvases = todosLosProductos.filter(p => 
        (p.categoria === 'Envases' || p.nombre.toUpperCase().includes("ENVASE") || p.nombre.toUpperCase().includes("FRASCO"))
    );
    
    console.log("[AUDITORÍA INSUMOS] Mapeado Alcohol Activo:", productoAlcohol?.nombre, "Disp:", (parseFloat(productoAlcohol?.stock_estante || 0) + parseFloat(productoAlcohol?.stock_unidades || 0)));
    console.log("[AUDITORÍA INSUMOS] Mapeado Fijador Activo:", productoFijador?.nombre, "Disp:", (parseFloat(productoFijador?.stock_estante || 0) + parseFloat(productoFijador?.stock_unidades || 0)));
}

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

function esGerenteOAdmin() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            console.warn("No hay token disponible.");
            return false;
        }

        const payload = parseJwt(token);
        if (!payload) return false;

        // Buscamos el rol en el token decodificado
        // (A veces se guarda como 'rol', 'role', 'tipo_usuario', etc.)
        const rol = (payload.rol || payload.role || payload.tipo || '').toUpperCase();

        console.log("Rol en Token:", rol); // <--- Para depurar

        const permitidos = ['ADMINISTRADOR', 'GERENTE', 'ADMIN', 'ROOT', 'SUPERUSER'];
        return permitidos.includes(rol);

    } catch (e) {
        console.error("Error leyendo token:", e);
        return false;
    }
}

window.ventaManualGranel = async function(idProducto) {
    // 1. Verificación
    if (!esGerenteOAdmin()) {
        if(window.beepError) window.beepError.play().catch(()=>{});
        return Swal.fire({
            icon: 'error',
            title: 'Acceso Denegado',
            text: 'Tu token no tiene permisos de Administrador o Gerente.',
            footer: '<span class="text-xs text-gray-400">Verifica la consola para ver el rol detectado</span>'
        });
    }
    const prod = todosLosProductos.find(p => p.id === idProducto);
    if(!prod) return;

    // --- LÓGICA DE UNIDADES ---
    let etiquetaUnidad = "Gramos (g)";
    let stepInput = "any"; // Permite decimales para gramos
    let icono = '<i class="fa-solid fa-weight-hanging"></i>';

    const nombre = prod.nombre.toUpperCase();
    const cat = (prod.categoria || '').toUpperCase();

    // Si es FRASCO o ENVASE -> Se vende por UNIDAD
    if (cat.includes('ENVASE') || cat.includes('FRASCO') || nombre.includes('FRASCO') || nombre.includes('ENVASE') || nombre.includes('1.1') || cat.includes('INSUMO')) {
        etiquetaUnidad = "Unidades (U)";
        stepInput = "1"; // Solo enteros para frascos o perfumes 1.1
        icono = '<i class="fa-solid fa-box-open"></i>';
    }

    // 2. Mostrar Modal Configurado
    const { value: formValues } = await Swal.fire({
        title: `<span class="text-lg font-bold text-slate-800">${prod.nombre}</span>`,
        html: `
            <div class="bg-blue-50 p-3 rounded-lg text-xs text-blue-800 mb-5 border border-blue-100 flex justify-between items-center">
                <span>Stock Disponible:</span>
                <span class="font-bold text-sm">${parseFloat(prod.stock_estante).toFixed(2)}</span>
            </div>
            
            <div class="space-y-4">
                <div>
                    <label class="block text-left text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                        ${icono} Cantidad en ${etiquetaUnidad}
                    </label>
                    <div class="relative">
                        <input id="swal-cant" type="number" class="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-slate-800 font-bold text-gray-800" placeholder="0" step="${stepInput}">
                    </div>
                </div>

                <div>
                    <label class="block text-left text-xs font-bold text-gray-500 uppercase mb-1">Precio Total a Cobrar</label>
                    <div class="relative">
                        <span class="absolute left-3 top-3 text-gray-400 font-bold">$</span>
                        <input id="swal-precio" type="number" class="w-full pl-8 p-3 bg-gray-50 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-slate-800 font-bold text-gray-800" placeholder="0.00" step="0.01">
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#0f172a',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Procesar Venta',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            const cant = document.getElementById('swal-cant').value;
            const precio = document.getElementById('swal-precio').value;
            
            if (!cant || !precio) {
                Swal.showValidationMessage('Por favor completa ambos campos');
                return false;
            }
            return [parseFloat(cant), parseFloat(precio)];
        }
    });

    if (formValues) {
        const [cantidad, precioTotal] = formValues;

        // Validación de Stock
        if (cantidad > parseFloat(prod.stock_estante)) {
            if(window.beepError) window.beepError.play().catch(()=>{});
            return Swal.fire({
                icon: 'warning',
                title: 'Stock Insuficiente',
                text: `Solo tienes ${parseFloat(prod.stock_estante).toFixed(2)} disponibles.`
            });
        }

        // Cálculo del precio unitario interno
        const precioUnitario = precioTotal / cantidad;

        // Agregar al carrito con la etiqueta correcta visualmente
        const nombreDisplay = stepInput === "1" 
            ? `${prod.nombre} (x${cantidad})` // Si son unidades
            : `${prod.nombre} (${cantidad}g)`; // Si son gramos

        carrito.push({
            id: prod.id,
            unique_id: `MANUAL_${prod.id}_${Date.now()}`,
            nombre: nombreDisplay,
            cantidad: cantidad,
            precio: precioUnitario,
            stock_real: prod.stock_estante,
            formula_id: null,
            es_manual: true,
            tipoPrecio: 'MANUAL',
            badgeColor: 'bg-slate-100 text-slate-700 border-slate-200'
        });

        renderCarrito();
        
        const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1500 });
        Toast.fire({ icon: 'success', title: 'Agregado' });
    }
};

window.repararStockFacturacion = async function() {
    try {
        const token = localStorage.getItem('token');
        
        // CORRECCIÓN AQUÍ: La ruta correcta es /sincronizar-todo
        const res = await fetch('/api/productos/sincronizar-todo', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();

        if (res.ok) {
            await cargarCatalogo(); 
            
            Swal.fire({
                icon: 'success',
                title: 'Stock Sincronizado',
                text: 'Se han recalculado las botellas reales en el estante.',
                timer: 2000,
                showConfirmButton: false
            });
        } else {
            throw new Error(data.error || 'Error desconocido del servidor');
        }
    } catch (error) {
        console.error("Error sincronizando:", error);
        Swal.fire('Error', 'No se pudo sincronizar: ' + error.message, 'error');
    }
};

async function cargarCatalogo() {
    try {
        const res = await ProductoService.getAll(1, 1000000); // Traemos todo sin paginar
        todosLosProductos = res.data || [];
        
        cargarInsumosEstrategicos(); 

        // 🔥 LA SOLUCIÓN AL BUG: 
        // En lugar de forzar la lista completa ciegamente, 
        // obligamos al sistema a re-aplicar los filtros y botones 
        // de la pestaña exacta en la que estás actualmente.
        cambiarModo(modoVista); 

    } catch(e) { console.error(e); }
}

window.itemsRenderizados = 0;

function renderCatalogo(lista, cargarMas = false) {
    const grid = document.getElementById('gridProductos');
    if (!grid) return;

    const inputBuscador = document.getElementById('buscadorVenta');
    const busqueda = inputBuscador ? inputBuscador.value.toLowerCase() : "";

    // 1. Filtramos la lista completa en memoria (Esto es ultra rápido)
    const listaFiltrada = lista.filter(p => 
        p.nombre.toLowerCase().includes(busqueda) || 
        (p.codigo && p.codigo.toLowerCase().includes(busqueda))
    );

    // 2. Si es una carga nueva (cambio de pestaña o búsqueda), limpiamos la pantalla
    if (!cargarMas) {
        grid.innerHTML = '';
        window.itemsRenderizados = 0;
    } else {
        // Si le dimos a "Cargar Más", borramos el botón viejo para meter los nuevos productos
        const btnAnterior = document.getElementById('btn-cargar-mas');
        if (btnAnterior) btnAnterior.remove();
    }

    // 🔥 LA MAGIA: Dibujamos en la pantalla estricatamente de 50 en 50
    const LIMITE = 50; 
    const porcion = listaFiltrada.slice(window.itemsRenderizados, window.itemsRenderizados + LIMITE);

    let htmlNuevo = '';

    // 4. Armamos el HTML solo de esa pequeña porción de 50
    porcion.forEach(p => {
        const tieneStock = p.stock_estante > 0;
        const opacity = tieneStock ? '' : 'opacity-60 grayscale';
        
        let botonesHTML = '';

        if (modoVista === 'esencias') {
            botonesHTML = `
                <button onclick="verificarProducto(${p.id}, false)" 
                        class="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-3 rounded-lg transition flex items-center justify-center gap-2 shadow-sm">
                    <i class="fa-solid fa-flask"></i> PREPARAR PERFUME
                </button>
            `;
        } else if (modoVista === 'recargas') {
            botonesHTML = `
                <button onclick="verificarProducto(${p.id}, true)" 
                        class="w-full bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-3 rounded-lg transition flex items-center justify-center gap-2 shadow-sm">
                    <i class="fa-solid fa-recycle"></i> RECARGAR FRASCO
                </button>
            `;
        } else if (modoVista === 'insumos') {
            botonesHTML = `
                <button onclick="ventaManualGranel(${p.id})" 
                        class="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-3 rounded-lg transition flex items-center justify-center gap-2 shadow-lg transform active:scale-95">
                    <i class="fa-solid fa-box-open text-gray-300"></i> VENDER UNIDAD
                </button>
            `;
        } else {
            botonesHTML = `
                <button onclick="ventaManualGranel(${p.id})" 
                        class="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 rounded mb-2 transition flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transform active:scale-95">
                    VENTA DIRECTA
                </button>
            `;
        }

        htmlNuevo += `
            <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between h-full ${opacity} hover:border-blue-200 transition">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-[10px] bg-gray-100 px-2 py-0.5 rounded font-mono text-gray-500">${p.codigo || 'S/C'}</span>
                    <span class="text-[10px] font-bold ${tieneStock ? 'text-green-600' : 'text-red-500'}">
                        ${parseFloat(p.stock_estante).toFixed(2)} disp.
                    </span>
                </div>
                <div class="font-bold text-slate-800 text-sm mb-4 uppercase leading-tight">
                    ${p.nombre}
                </div>
                <div class="mt-auto">
                    ${botonesHTML}
                </div>
            </div>
        `;
    });

    // 5. Inyectamos el HTML de forma ultra-rápida sin borrar lo que ya estaba
    grid.insertAdjacentHTML('beforeend', htmlNuevo);
    window.itemsRenderizados += porcion.length;

    // 6. Si aún quedan productos por renderizar de los 100,000, mostramos el botón inteligente de "Cargar más"
    if (window.itemsRenderizados < listaFiltrada.length) {
        const btnHTML = `
            <div id="btn-cargar-mas" class="col-span-full flex justify-center mt-6 mb-4 w-full">
                <button onclick="renderCatalogo(inventario, true)" class="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-3 px-8 rounded-full transition shadow-lg flex items-center gap-2">
                    <i class="fa-solid fa-arrow-down"></i> VER 50 MÁS (${listaFiltrada.length - window.itemsRenderizados} restantes)
                </button>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', btnHTML);
    }
}

function verificarOfertaGrupo(formulaId) {
    // 1. Calcular total ABIERTO de esta fórmula
    let itemsAbiertos = carrito.filter(i => i.formula_id === formulaId && !i.isLocked);
    let totalAbierto = itemsAbiertos.reduce((acc, i) => acc + i.cantidad, 0);

    const f = formulasGlobales.find(form => form.id == formulaId);
    if (!f) return;

    // 2. Verificar si cumple condiciones para BLOQUEAR (Promo o Gran Mayor masivo)
    const cumplePromo = parseFloat(f.precio_promo) > 0 && totalAbierto >= parseInt(f.cantidad_promo);
    const cumpleGranMayor = parseFloat(f.precio_gran_mayor) > 0 && totalAbierto >= parseInt(f.cantidad_gran_mayor);

    // Si llega al tope (ej: 100), preguntamos para cerrar el grupo
    if (cumplePromo || cumpleGranMayor) {
        
        // Preparamos los textos de la alerta
        const txtPromo = cumplePromo ? `🔥 Promo ($${f.precio_promo} el lote)` : null;
        const txtGM = cumpleGranMayor ? `💎 Gran Mayor ($${f.precio_gran_mayor} c/u)` : null;

        // Si solo hay una opción, la aplicamos o mostramos alerta simple. 
        // Si hay conflicto (las dos), mostramos el selector.
        
        let pregunta = {
            title: `¡Completaste un lote de ${totalAbierto}!`,
            text: `¿Deseas cerrar este grupo y aplicar la oferta? Los siguientes productos contarán como un grupo nuevo.`,
            icon: 'success',
            showCancelButton: true,
            confirmButtonText: txtPromo || txtGM,
            // Si hay dos opciones, usamos el botón de cancelar para la segunda
            cancelButtonText: (txtPromo && txtGM) ? txtGM : 'Seguir Agregando (No cerrar)',
            reverseButtons: true
        };

        Swal.fire(pregunta).then((result) => {
            let aplicar = false;
            let modo = '';
            let precio = 0;
            let etiqueta = '';
            let color = '';

            if (result.isConfirmed && txtPromo) {
                // Eligió PROMO
                aplicar = true;
                modo = 'PROMO';
                precio = parseFloat(f.precio_promo) / parseInt(f.cantidad_promo);
                etiqueta = `🔥 PROMO PACK (${totalAbierto})`;
                color = 'bg-red-100 text-red-700 border-red-200';

            } else if ((result.isConfirmed && !txtPromo) || (result.dismiss === Swal.DismissReason.cancel && txtPromo && txtGM)) {
                // Eligió GRAN MAYOR (Ya sea porque era la única opción en confirm, o la segunda en cancel)
                aplicar = true;
                modo = 'GRAN_MAYOR';
                precio = parseFloat(f.precio_gran_mayor);
                etiqueta = `💎 PACK MAYOR (${totalAbierto})`;
                color = 'bg-purple-100 text-purple-700 border-purple-200';
            }

            if (aplicar) {
                // --- BLOQUEAMOS LOS ÍTEMS ---
                itemsAbiertos.forEach(i => {
                    i.isLocked = true;        // <--- ESTO ES LO QUE HACE QUE EL SIGUIENTE SEA NUEVO
                    i.modoPrecio = modo;
                    i.precio = precio;
                    i.tipoPrecio = etiqueta;
                    i.badgeColor = color;
                });
                renderCarrito();
                Swal.fire({
                    toast: true, title: 'Grupo Cerrado', icon: 'success', 
                    text: 'Los próximos productos iniciarán un conteo nuevo.', 
                    timer: 2000, position: 'bottom-end', showConfirmButton: false
                });
            }
        });
    }
}

window.verificarProducto = function(id, isRecarga = false) {
    const prod = todosLosProductos.find(p => p.id === id);
    if (!prod) return;
    
    productoPendiente = prod;
    modoRecargaActual = isRecarga; // Ahora sí sabe de dónde viene esta variable
    
    abrirModalFormula(prod.nombre); 
};

window.agregarAlCarrito = function(id) {
    let prod = inventario.find(p => p.id === id);
    if (!prod) prod = todosLosProductos.find(p => p.id === id); 
    if (!prod) return; 

    // Alerta visual si no hay stock (pero permite vender)
    if (prod.stock_estante <= 0) {
        const Toast = Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 1000 });
        Toast.fire({ icon: 'warning', title: 'Stock en 0 o negativo' });
    }

    // Buscamos si ya existe el item (que no sea fórmula ni manual)
    const item = carrito.find(i => i.id === id && !i.formula_id && !i.es_manual); 
    
    if(item) {
        item.cantidad++;
    } else {
        // --- AQUÍ ESTABA EL ERROR ---
        // Debemos mapear explícitamente 'precio_venta' a 'precio'
        carrito.push({ 
            ...prod, 
            cantidad: 1, 
            formula_id: null,
            precio: parseFloat(prod.precio_venta) || 0 // <--- ESTO SOLUCIONA EL ERROR
        });
    }
    renderCarrito();
};

function configurarBuscador() {
    const input = document.getElementById('buscadorVenta');
    if(!input) return;

    let timeout; // Variable para el Modo Anti-Lag

    // A. TECLADO (Búsqueda Instantánea Local con DEBOUNCE)
    input.addEventListener('input', (e) => {
        clearTimeout(timeout); 

        timeout = setTimeout(() => {
            if (todosLosProductos.length > 0) {
                renderCatalogo(inventario); 
            } else {
                cargarCatalogo();
            }
        }, 300); // Espera 300ms antes de buscar
    });

    // B. ESCÁNER DE CÓDIGO (Tecla Enter)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = input.value.trim().toUpperCase();
            if(!val) return;
            
            buscarProductoDirecto(val);
            input.value = ''; 
        }
    });
}

async function buscarProductoDirecto(codigo) {
    // 1. Chequeo local rápido
    const local = inventario.find(p => p.codigo && p.codigo.toUpperCase() === codigo);
    if(local) {
        verificarProducto(local.id);
        return;
    }

    // 2. Consulta al server
    try {
        const res = await ProductoService.getAll(1, 1, codigo);
        const prod = res.data && res.data.length > 0 ? res.data[0] : null;

        if (prod && prod.codigo.toUpperCase() === codigo) {
            // CAMBIO: Forzamos la actualización del inventario local y verificamos
            inventario = [prod]; 
            renderCatalogo(inventario);
            verificarProducto(prod.id); // <--- ESTO ABRE EL MODAL DE TAMAÑOS
        } else {
            beepError.currentTime = 0; beepError.play().catch(()=>{});
            Swal.fire({ toast: true, icon: 'error', title: 'Producto no encontrado', position: 'top-end', showConfirmButton: false, timer: 1200 });
        }
    } catch(e) { console.error(e); }
}

function recalcularPreciosDinamicos() {
    const totalesAbiertos = {};

    // 1. Calcular totales sólo de ítems abiertos
    carrito.forEach(item => {
        if (item.formula_id && !item.isLocked && !item.es_recarga) {
            totalesAbiertos[item.formula_id] = (totalesAbiertos[item.formula_id] || 0) + item.cantidad;
        }
    });

    // 2. Aplicar precios en base a la moneda elegida por escala
    carrito.forEach(item => {
        if (!item.formula_id || item.isLocked || item.es_recarga) return; 

        const f = formulasGlobales.find(form => form.id == item.formula_id);
        if (!f) return;

        const cantidadActiva = totalesAbiertos[item.formula_id] || 0;
        const usaBs = item.monedaElegida === 'BS';

        // Determinar el precio base inicial según la moneda acordada
        let precioBase = usaBs ? (parseFloat(f.precio_bs) / tasaCambio) : parseFloat(f.precio);
        let etiqueta = usaBs ? 'DETAL (Bs)' : 'DETAL';
        let colorBadge = usaBs ? 'bg-amber-100 text-amber-700 border-amber-200' : null;

        // Lógica automática para Escalas Mayoristas combinadas
        if (parseFloat(f.precio_mayor) > 0 && cantidadActiva >= parseInt(f.cantidad_mayor)) {
            if (usaBs && parseFloat(f.precio_mayor_bs) > 0) {
                precioBase = parseFloat(f.precio_mayor_bs) / tasaCambio;
                etiqueta = 'MAYOR (Bs)';
            } else {
                precioBase = parseFloat(f.precio_mayor);
                etiqueta = 'MAYOR';
            }
            colorBadge = 'bg-blue-100 text-blue-700 border-blue-200';
        }
        
        if (parseFloat(f.precio_gran_mayor) > 0 && cantidadActiva >= parseInt(f.cantidad_gran_mayor)) {
            if (usaBs && parseFloat(f.precio_gran_mayor_bs) > 0) {
                precioBase = parseFloat(f.precio_gran_mayor_bs) / tasaCambio;
                etiqueta = '💎 GRAN MAYOR (Bs)';
            } else {
                precioBase = parseFloat(f.precio_gran_mayor);
                etiqueta = '💎 GRAN MAYOR';
            }
            colorBadge = 'bg-purple-100 text-purple-700 border-purple-200';
        }

        let costoGramosExtra = 0;
        if (item.gramos_extra && item.precio_gramo_extra) {
            costoGramosExtra = parseFloat(item.gramos_extra) * parseFloat(item.precio_gramo_extra);
        }

        item.precio = precioBase + costoGramosExtra;
        item.tipoPrecio = etiqueta;
        item.badgeColor = colorBadge;
    });
}

function renderCarrito() {

    localStorage.setItem('carrito_pos_respaldo', JSON.stringify(carrito));

    if (typeof window.guardarBorradorGeneral === 'function') {
        window.guardarBorradorGeneral();
    }
    
    guardarBorradorGeneral();

    recalcularPreciosDinamicos(); // <--- ESTA ES LA CLAVE

    const lista = document.getElementById('listaCarrito');
    const totalEl = document.getElementById('totalMonto');
    const itemsEl = document.getElementById('totalItems');
    const bsEl = document.getElementById('totalBs'); 

    lista.innerHTML = '';
    let total = 0;
    let cantidadTotal = 0;

    carrito.forEach((item, index) => {
        const subtotal = item.precio * item.cantidad;
        total += subtotal;
        cantidadTotal += item.cantidad;

        // Visual: Badge de precio
        const badge = item.tipoPrecio && item.tipoPrecio !== 'DETAL' ? 
            `<span class="text-[9px] px-1.5 py-0.5 rounded border ${item.badgeColor} font-bold ml-2 shadow-sm">${item.tipoPrecio}</span>` 
            : '';

        lista.innerHTML += `
            <div class="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100 mb-2 hover:shadow-sm transition">
                <div class="flex-1">
                    <div class="font-bold text-slate-700 text-sm flex items-center flex-wrap gap-1">
                        ${item.nombre}
                        ${badge}
                    </div>
                    <div class="text-xs text-slate-400 mt-0.5">$${item.precio.toFixed(4)} c/u</div>
                </div>

                <div class="flex items-center gap-3">
                    <div class="flex items-center border border-gray-300 rounded bg-white overflow-hidden shadow-sm w-16 h-8">
                        <input type="number" 
                               value="${item.cantidad}" 
                               min="1"
                               onchange="actualizarCantidadCarrito(${index}, this.value)"
                               class="w-full h-full text-center text-sm font-bold outline-none border-none bg-transparent text-slate-800 focus:bg-blue-50">
                    </div>

                    <div class="font-bold text-slate-800 w-16 text-right">$${subtotal.toFixed(2)}</div>

                    <button onclick="eliminarDelCarrito(${index})" class="text-red-400 hover:text-red-600 w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-50 transition ml-1">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    });

    totalEl.innerText = `$${total.toFixed(2)}`;
    itemsEl.innerText = `${cantidadTotal} Items`;
    bsEl.innerText = `Bs ${(total * tasaCambio).toFixed(2)}`;

    if(document.getElementById('modalCobro') && !document.getElementById('modalCobro').classList.contains('hidden')){
        actualizarResumenCobro();
    }
}

function cambiarCantidad(idx, delta) {
    const item = carrito[idx];
    const nuevo = item.cantidad + delta;

    if (nuevo <= 0) {
        eliminarDelCarrito(idx);
        return;
    }

    if (delta > 0) {
        let consumoUnitario = 1;
        if (item.formula_id) {
            const f = formulasGlobales.find(f => f.id === item.formula_id);
            consumoUnitario = f ? parseFloat(f.gramos_esencia || 0) : 0;
            consumoUnitario += (item.gramos_extra || 0); // Considerar lo extra
        }

        let consumoOtros = 0;
        carrito.forEach((c, i) => {
            if (i !== idx && c.id === item.id) { 
                 let cUnit = 1;
                 if (c.formula_id) {
                     const f2 = formulasGlobales.find(f => f.id === c.formula_id);
                     cUnit = f2 ? parseFloat(f2.gramos_esencia || 0) : 0;
                     cUnit += (c.gramos_extra || 0); // Considerar lo extra de otros items
                 }
                 consumoOtros += (c.cantidad * cUnit);
            }
        });

        const consumoTotal = consumoOtros + (nuevo * consumoUnitario);
        
        if (consumoTotal > item.stock_real) {
            if(window.beepError) window.beepError.play().catch(()=>{});
            return Swal.fire({ 
                toast: true, position: 'top', icon: 'warning', 
                title: 'Cantidad Agotada', text: 'No hay suficiente esencia para agregar más.',
                timer: 2000, showConfirmButton: false
            });
        }
    }

    item.cantidad = nuevo;
    renderCarrito();
}

window.eliminarDelCarrito = function(idx) {
    carrito.splice(idx, 1);
    renderCarrito();
};

function limpiarCarrito() {
    if(carrito.length === 0) return;

    // Vaciar arreglo
    carrito = [];
    localStorage.removeItem('carrito_pos_respaldo');
    // Renderizar para que los totales (Monto y Bs) vuelvan a cero
    renderCarrito();

    // Feedback visual (opcional)
    const Toast = Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 1000 });
    Toast.fire({ icon: 'info', title: 'Carrito limpio' });
}

window.switchTab = function(tab) {
    if(tab === 'buscar') {
        document.getElementById('viewBuscar').classList.remove('hidden');
        document.getElementById('viewCrear').classList.add('hidden');
        document.getElementById('tabBuscar').className = "flex-1 pb-3 border-b-2 border-blue-600 font-bold text-blue-600 text-sm";
        document.getElementById('tabCrear').className = "flex-1 pb-3 border-b-2 border-transparent text-gray-400 hover:text-blue-500 text-sm font-medium";
    } else {
        document.getElementById('viewBuscar').classList.add('hidden');
        document.getElementById('viewCrear').classList.remove('hidden');
        document.getElementById('tabCrear').className = "flex-1 pb-3 border-b-2 border-blue-600 font-bold text-blue-600 text-sm";
        document.getElementById('tabBuscar').className = "flex-1 pb-3 border-b-2 border-transparent text-gray-400 hover:text-blue-500 text-sm font-medium";
    }
};

function renderClientes(lista) {
    const div = document.getElementById('listaResultadosClientes');
    div.innerHTML = '';
    if(lista.length === 0) {
        div.innerHTML = '<div class="text-xs text-gray-400 text-center p-4">No encontrado</div>';
        return;
    }
    lista.forEach(c => {
        div.innerHTML += `
            <div onclick="seleccionarCliente(${c.id}, '${c.nombre}', '${c.documento}')" class="p-3 border rounded-lg hover:bg-blue-50 cursor-pointer flex justify-between items-center transition mb-2">
                <div><div class="font-bold text-sm text-gray-800">${c.nombre}</div><div class="text-xs text-gray-500 font-mono">${c.documento}</div></div>
                <i class="fa-solid fa-check text-blue-500"></i>
            </div>
        `;
    });
}

window.seleccionarCliente = function(id, nombre, doc) {
    clienteActual = { id, nombre, documento: doc };
    document.getElementById('infoCliente').innerText = nombre;
    document.getElementById('docCliente').innerText = doc;
    window.cerrarModalCliente(); // Usamos window.cerrarModalCliente que ya definimos antes
};

window.seleccionarCliente = function(id, nombre, doc) {
    clienteActual = { id, nombre, documento: doc };
    document.getElementById('infoCliente').innerText = nombre;
    document.getElementById('docCliente').innerText = doc;
    window.cerrarModalCliente(); // Usamos window.cerrarModalCliente que ya definimos antes
};

window.guardarNuevoCliente = async function() {
    const data = {
        documento: document.getElementById('newDoc').value,
        nombre: document.getElementById('newNombre').value,
        telefono: document.getElementById('newTel').value,
        direccion: document.getElementById('newDir').value,
    };
    if(!data.documento || !data.nombre) return Swal.fire('Faltan Datos', 'Campos obligatorios', 'warning');

    const res = await ClienteService.crear(data);
    if(res.error) Swal.fire('Error', res.error, 'error');
    else {
        // Al crear, seleccionamos automáticamente
        window.seleccionarCliente(res.id, res.nombre, res.documento);
        
        // Limpiamos campos
        document.getElementById('newDoc').value = '';
        document.getElementById('newNombre').value = '';
        document.getElementById('newTel').value = '';
        document.getElementById('newDir').value = '';
        
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'Cliente Creado', timer: 1500, showConfirmButton: false});
    }
};

window.abrirModalCobro = async function() {
    if(carrito.length === 0) return Swal.fire('Carrito vacío', 'Agrega productos antes de cobrar.', 'warning');

    // 1. OBTENER LA TASA MÁS FRESCA JUSTO ANTES DE COBRAR
    try {
        const token = localStorage.getItem('token');
        const resTasa = await fetch('/api/ajustes/tasa', { headers: { 'Authorization': `Bearer ${token}` } });
        
        if(resTasa.ok) {
            const dataTasa = await resTasa.json();
            tasaCambio = parseFloat(dataTasa.tasa) || tasaCambio; 
            
            // 🔥 Actualizar visualmente la tasa en la pantalla (Sea Input o Texto)
            const tagTasa = document.getElementById('tasaCobro');
            if(tagTasa) {
                if (tagTasa.tagName === 'INPUT') tagTasa.value = tasaCambio.toFixed(2);
                else tagTasa.innerText = tasaCambio.toFixed(2);
            }

            // Actualizar el carrito en el fondo para que calcule los Bolívares de inmediato
            renderCarrito();
        }
    } catch (e) { 
        console.warn("No se pudo refrescar la tasa desde el servidor, usando la de memoria."); 
    }

    // 2. PREPARAR Y ABRIR EL MODAL
    pagosRealizados = [];
    const modal = document.getElementById('modalCobro');
    if(modal) modal.classList.remove('hidden');
    
    // Limpiar cajitas
    const inputMonto = document.getElementById('montoPago');
    if(inputMonto) inputMonto.value = '';
    
    const lista = document.getElementById('listaPagos');
    if(lista) lista.innerHTML = '';
    
    // Por defecto marcar "Nota de Entrega"
    const radioNota = document.getElementById('radioNota');
    if(radioNota) radioNota.checked = true;

    // 3. CALCULAR LOS TOTALES CON LA NUEVA TASA
    actualizarResumenCobro();
};

window.procesarVenta = window.abrirModalCobro;

window.toggleEditarTasa = function() {
    Swal.fire({
        title: 'Opción Bloqueada',
        text: 'La tasa se maneja de forma automática desde el módulo de Ajustes Globales.',
        icon: 'info'
    });
};

function validarInsumosSuficientes() {
    console.log("Verificando insumos para", carrito.length, "items...");

    let alcoholNecesario = 0;
    let fijadorNecesario = 0;
    let envasesNecesarios = {}; 

    carrito.forEach(item => {
        if (item.formula_id) { 
            const formula = formulasGlobales.find(f => f.id === item.formula_id);
            if (formula) {
                // Leer el alcohol sustituido si existe
                const ml_alc = item.ml_alcohol_override !== undefined ? item.ml_alcohol_override : parseFloat(formula.ml_alcohol || 0);
                alcoholNecesario += (ml_alc * item.cantidad);
                
                fijadorNecesario += (parseFloat(formula.gramos_fijador || 0) * item.cantidad);

                const tamano = formula.volumen_total; 
                if (!envasesNecesarios[tamano]) envasesNecesarios[tamano] = 0;
                
                // Ignorar el descuento de envase si el cliente trajo el suyo
                if (!item.es_recarga) {
                    envasesNecesarios[tamano] += item.cantidad;
                }
            }
        }
    });

    if (productoAlcohol) {
        if (productoAlcohol.stock_real < alcoholNecesario) {
            if(window.beepError) window.beepError.play().catch(()=>{});
            Swal.fire({
                title: '¡Falta Alcohol!',
                html: `Necesitas: <b>${alcoholNecesario.toFixed(2)} ml</b>.<br>
                       Disponible: <span class="text-red-600 font-bold">${productoAlcohol.stock_real.toFixed(2)} ml</span>`,
                icon: 'error'
            });
            return false;
        }
    } else if (alcoholNecesario > 0) {
        Swal.fire('Error Crítico', 'No se ha definido un producto "Alcohol".', 'error');
        return false;
    }

    if (productoFijador) {
        if (productoFijador.stock_real < fijadorNecesario) {
            if(window.beepError) window.beepError.play().catch(()=>{});
            Swal.fire({
                title: '¡Falta Fijador!',
                html: `Necesitas: <b>${fijadorNecesario.toFixed(2)} g</b>.<br>
                       Disponible: <span class="text-red-600 font-bold">${productoFijador.stock_real.toFixed(2)} g</span>`,
                icon: 'error'
            });
            return false;
        }
    }

    for (const [tamano, cantidad] of Object.entries(envasesNecesarios)) {
        if (cantidad <= 0) continue; 
        
        const envaseEncontrado = inventarioEnvases.find(e => {
            const nombre = e.nombre.toLowerCase();
            const categoria = (e.categoria || '').toLowerCase();
            const tamanoStr = tamano.toString();
            const tieneNumero = nombre.includes(tamanoStr);
            const esTipoEnvase = nombre.includes("envase") || nombre.includes("frasco") || categoria.includes("envase");
            return tieneNumero && esTipoEnvase;
        });

        if (!envaseEncontrado) {
            Swal.fire({
                title: 'Envase No Encontrado',
                html: `El sistema busca un envase de <b>${tamano}ml</b>.<br>
                       Asegúrate de tener un producto llamado <b>"Envase ${tamano}"</b>.`,
                icon: 'warning'
            });
            return false;
        }

        if (envaseEncontrado.stock_real < cantidad) {
            if(window.beepError) window.beepError.play().catch(()=>{});
            Swal.fire({
                title: `¡Faltan Envases de ${tamano}ml!`,
                html: `Necesitas <b>${cantidad}</b> unidades.<br>
                       Disponible: <span class="text-red-600 font-bold">${envaseEncontrado.stock_real} u.</span>`,
                icon: 'error'
            });
            return false;
        }
    }

    return true;
}

function cerrarModalCobro() { document.getElementById('modalCobro').classList.add('hidden'); }

function setMoneda(moneda) {
    monedaPagoActual = moneda;
    const btnUSD = document.getElementById('btnUSD');
    const btnBS = document.getElementById('btnBS');
    const simbolo = document.getElementById('simboloMoneda');
    
    if(moneda === 'USD') {
        btnUSD.className = "flex-1 py-2 rounded-lg border border-green-600 bg-green-600 text-white font-bold transition";
        btnBS.className = "flex-1 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 font-bold hover:bg-gray-100 transition";
        simbolo.innerText = '$';
        simbolo.classList.remove('text-blue-600');
        simbolo.classList.add('text-green-600');
    } else {
        btnBS.className = "flex-1 py-2 rounded-lg border border-blue-600 bg-blue-600 text-white font-bold transition";
        btnUSD.className = "flex-1 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 font-bold hover:bg-gray-100 transition";
        simbolo.innerText = 'Bs';
        simbolo.classList.remove('text-green-600');
        simbolo.classList.add('text-blue-600');
    }
    
    // Sugerir monto restante
    const totalUSD = carrito.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);
    const abonadoUSD = pagosRealizados.reduce((acc, p) => acc + (p.moneda === 'USD' ? p.monto : p.monto / p.tasa), 0);
    const restanteUSD = Math.max(0, totalUSD - abonadoUSD);
    
    const inputMonto = document.getElementById('montoPago');
    if(moneda === 'USD') {
        inputMonto.value = restanteUSD.toFixed(2);
    } else {
        inputMonto.value = (restanteUSD * tasaCambio).toFixed(2);
    }
    actualizarEquivalencia();
}

function actualizarEquivalencia() {
    const monto = parseFloat(document.getElementById('montoPago').value) || 0;
    const label = document.getElementById('equiPago');
    
    if(monedaPagoActual === 'USD') {
        label.innerText = `≈ Bs ${(monto * tasaCambio).toFixed(2)}`;
    } else {
        label.innerText = `≈ $ ${(monto / tasaCambio).toFixed(2)}`;
    }
}

window.agregarPago = function(metodo) {
    const refInput = document.getElementById('refPago');
    const referencia = refInput.value.trim();

    // 1. LEER LO QUE ESCRIBIÓ EL CAJERO EN EL INPUT (¡Esta era la pieza faltante!)
    const inputMontoValor = parseFloat(document.getElementById('montoPago').value);
    
    if (!inputMontoValor || inputMontoValor <= 0) {
        return Swal.fire({ icon: 'warning', title: 'Monto Inválido', text: 'Ingresa un monto mayor a cero.' });
    }

    // 2. VALIDACIONES PREVIAS
    if (metodo === 'Pago Móvil') {
        if (!referencia) return Swal.fire({ icon: 'warning', title: 'Falta Referencia', text: 'Obligatorio para Pago Móvil.' });
        if (!/^\d{8}$/.test(referencia)) return Swal.fire({ icon: 'error', title: 'Referencia Incorrecta', text: 'Debe tener 8 dígitos.' });
    }

    // 3. CÁLCULOS MATEMÁTICOS
    const totalConIvaUSD = carrito.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);

    let abonadoAnterior = 0;
    pagosRealizados.forEach(p => {
        const equi = p.moneda === 'USD' ? p.monto : (p.monto / p.tasa);
        abonadoAnterior += equi;
    });

    let deudaActual = totalConIvaUSD - abonadoAnterior;

    if (deudaActual <= 0.001) {
        return Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Pago Completo', showConfirmButton: false, timer: 1500 });
    }

    // Convertir lo que el cajero ingresó a USD (por si lo ingresó teniendo el botón de Bs activado)
    let montoIngresadoUSD = (monedaPagoActual === 'USD') ? inputMontoValor : (inputMontoValor / tasaCambio);

    // Validar que no pague más de lo que debe (con 5 centavos de tolerancia por los decimales)
    if (montoIngresadoUSD > (deudaActual + 0.05)) {
        if(window.beepError) window.beepError.play().catch(()=>{});
        return Swal.fire({ icon: 'error', title: 'Monto Excedido', text: 'Estás intentando cobrar más de lo que falta para cerrar la factura.'});
    }

    // 4. DEFINICIÓN DE MONEDA Y MONTO FINAL PARA EL ARRAY
    let monedaFinal = 'USD';
    let montoFinal = inputMontoValor; 

    // Ajuste inteligente: Forzamos la moneda según el método de pago seleccionado
    if (metodo === 'Pago Móvil' || metodo === 'Punto Venta') {
        monedaFinal = 'BS';
        // Si el cajero lo escribió en USD, lo convertimos a Bs para guardarlo bien en la BD
        montoFinal = (monedaPagoActual === 'USD') ? (inputMontoValor * tasaCambio) : inputMontoValor;
    } 
    else if (metodo === 'Zelle' || metodo === 'Efectivo') {
        monedaFinal = 'USD';
        // Si el cajero lo escribió en Bs, lo convertimos a USD
        montoFinal = (monedaPagoActual === 'BS') ? (inputMontoValor / tasaCambio) : inputMontoValor;
    }

    // 5. REGISTRAR PAGO (El pedacito de la factura)
    pagosRealizados.push({
        metodo: metodo,
        moneda: monedaFinal,
        monto: parseFloat(montoFinal.toFixed(2)),
        tasa: tasaCambio,
        referencia: referencia || 'S/N'
    });

    // 6. LIMPIEZA
    document.getElementById('refPago').value = '';
    
    // Esto hace que el input baje automáticamente a lo que falta por cobrar
    actualizarResumenCobro(); 
    
    const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1000 });
    Toast.fire({ icon: 'success', title: `Pago de $${montoIngresadoUSD.toFixed(2)} agregado` });
};

window.borrarPago = function(index) {
    pagosRealizados.splice(index, 1); // Elimina el pago equivocado
    actualizarResumenCobro(); // El sistema "recuerda" la deuda original automáticamente
};

function actualizarResumenCobro() {
    // 1. Calcular TOTAL A PAGAR (Suma directa del carrito, porque tus precios YA incluyen IVA)
    const totalFinalUSD = carrito.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);
    
    // 2. Desglosamos hacia atrás
    const baseImponibleUSD = totalFinalUSD / 1.16;
    const ivaUSD = totalFinalUSD - baseImponibleUSD;

    // --- Lógica de Pagos (Se mantiene igual) ---
    let abonadoUSD = 0;
    const listaPagosDiv = document.getElementById('listaPagos');
    
    if (pagosRealizados.length === 0) {
        listaPagosDiv.innerHTML = '<div class="text-center text-gray-400 text-xs py-10">Esperando registro de pago...</div>';
    } else {
        listaPagosDiv.innerHTML = pagosRealizados.map((p, idx) => {
            const montoDisplay = p.moneda === 'USD' ? `$${p.monto.toFixed(2)}` : `Bs ${p.monto.toFixed(2)}`;
            
            // Calculamos cuánto representa este pago en USD para la barra de progreso
            const valorEnUSD = p.moneda === 'USD' ? p.monto : (p.monto / p.tasa);
            abonadoUSD += valorEnUSD;

            return `
                <div class="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-xl shadow-sm mb-2">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs">
                            <i class="fa-solid fa-check"></i>
                        </div>
                        <div>
                            <div class="font-bold text-slate-700 text-[10px] uppercase">${p.metodo}</div>
                            <div class="text-[9px] text-slate-400 font-mono">${p.moneda}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-right font-bold text-slate-800 text-sm">${montoDisplay}</div>
                        <button onclick="borrarPago(${idx})" class="text-red-400 hover:text-red-600">
                            <i class="fa-solid fa-circle-xmark text-lg"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    const totalAbonadoUSD = Math.round(abonadoUSD * 100) / 100;
    
    // Calculamos restante con tolerancia a decimales ínfimos
    let restanteUSD = totalFinalUSD - totalAbonadoUSD;
    if (Math.abs(restanteUSD) < 0.01) restanteUSD = 0; 

    // 4. Actualizar etiquetas visuales (AHORA MUESTRAN EL DESGLOSE INVERSO)
    document.getElementById('resumenBase').innerText = `$${baseImponibleUSD.toFixed(2)}`;
    document.getElementById('resumenIVA').innerText = `$${ivaUSD.toFixed(2)}`;
    
    // IGTF Oculto o Cero
    const lblIGTF = document.getElementById('resumenIGTF');
    if(lblIGTF) lblIGTF.innerText = "$0.00"; 

    // El total definitivo es la suma directa (ej: $6.00)
    document.getElementById('resumenTotalDefinitivo').innerText = `$${totalFinalUSD.toFixed(2)}`;
    document.getElementById('resumenTotalDefinitivoBs').innerText = `Bs ${(totalFinalUSD * tasaCambio).toFixed(2)}`;
    document.getElementById('cobroTotalUSD').innerText = `$${totalFinalUSD.toFixed(2)}`;
    
    document.getElementById('resumenAbonado').innerText = `$${totalAbonadoUSD.toFixed(2)}`;
    document.getElementById('resumenRestante').innerText = `$${restanteUSD.toFixed(2)}`;
    document.getElementById('resumenRestanteBs').innerText = `Bs ${(restanteUSD * tasaCambio).toFixed(2)}`;

    // 5. Input de monto inteligente
    const inputMonto = document.getElementById('montoPago');
    if (inputMonto) {
        inputMonto.value = (monedaPagoActual === 'USD') ? restanteUSD.toFixed(2) : (restanteUSD * tasaCambio).toFixed(2);
        actualizarEquivalencia(); // Aseguramos que se actualice la equivalencia visual también
    }

    // 6. Botón de Finalizar
    const btn = document.getElementById('btnFinalizarVenta');
    if (restanteUSD <= 0.01 && totalFinalUSD > 0) {
        btn.disabled = false;
        btn.className = "w-full mt-4 bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-slate-800 transition transform hover:scale-[1.02] flex justify-center items-center gap-2";
        btn.innerHTML = '<i class="fa-solid fa-check-circle"></i> FINALIZAR VENTA';
    } else {
        btn.disabled = true;
        btn.className = "w-full mt-4 bg-gray-300 text-white font-bold py-4 rounded-xl cursor-not-allowed";
        btn.innerHTML = 'FALTA PAGO...';
    }
}

// 🔥 1. AGREGAMOS EL PARÁMETRO DE CONFIRMACIÓN (POR DEFECTO FALSE)
window.finalizarVentaBackend = async function(confirmacionAlmacen = false) {
    const btn = document.getElementById('btnFinalizarVenta');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';
    btn.disabled = true;

    const inputVendedor = document.getElementById('inputVendedorCobro');
    const nombreVendedor = inputVendedor && inputVendedor.value.trim() ? inputVendedor.value.trim() : "Vendedor de Turno";

    let usuarioLogueadoId = null;
    try {
        const token = localStorage.getItem('token');
        if (token) {
            const payload = parseJwt(token); 
            if (payload && payload.id) usuarioLogueadoId = parseInt(payload.id);
        }
    } catch (err) { console.error("Error leyendo ID del token", err); }

    if (!usuarioLogueadoId) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        return Swal.fire({ title: 'Sesión Inválida', text: 'Por favor cierra sesión y vuelve a entrar.', icon: 'error' });
    }

    const tipoDoc = document.querySelector('input[name="tipoDocumento"]:checked')?.value || 'NOTA';
    const totalVentaCalculado = carrito.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);
    const totalVentaFinal = Math.round((totalVentaCalculado + Number.EPSILON) * 100) / 100;

    const itemsLimpios = carrito.map(i => {
        const precioUnitarioLimpio = Math.round((parseFloat(i.precio) + Number.EPSILON) * 100) / 100;
        const subtotalLimpio = Math.round((precioUnitarioLimpio * parseFloat(i.cantidad) + Number.EPSILON) * 100) / 100;

        return { 
            id: parseInt(i.id, 10),               
            cantidad: parseFloat(i.cantidad), 
            precio: precioUnitarioLimpio,        
            subtotal: subtotalLimpio,            
            formula_id: i.formula_id ? parseInt(i.formula_id, 10) : null,
            descripcion: i.nombre ? i.nombre.toUpperCase() : 'PRODUCTO FRAGANZA',
            gramos_extra: parseFloat(i.gramos_extra || 0),
            ml_alcohol_override: i.ml_alcohol_override !== undefined ? parseFloat(i.ml_alcohol_override) : null,
            es_recarga: i.es_recarga || false
        };
    });

    const pagosLimpios = pagosRealizados.map(p => ({
        metodo: p.metodo,
        moneda: p.moneda.toUpperCase(),
        monto: Math.round((parseFloat(p.monto) + Number.EPSILON) * 100) / 100,
        tasa: parseFloat(p.tasa || tasaCambio),
        referencia: p.referencia || 'S/N'
    }));

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ventas', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ 
                items: itemsLimpios, 
                total: totalVentaFinal, 
                cliente_id: parseInt(clienteActual.id || 1, 10), 
                pagos: pagosLimpios,
                tipo_documento: tipoDoc,
                usuario_id: usuarioLogueadoId,
                confirmacion_almacen: confirmacionAlmacen // 🔥 2. ENVIAMOS LA BANDERA AL BACKEND
            })
        });

        const data = await res.json();

        // 🔥 3. ATRAPAMOS LA ALERTA DE STOCK ANTES DE QUE FALLE
        if (res.status === 409 && data.error === 'ALERTA_ALMACEN') {
            btn.innerHTML = originalText;
            btn.disabled = false;

            const result = await Swal.fire({
                title: 'Mostrador Insuficiente',
                html: data.mensaje, // Aquí se muestra el mensaje de cuántos gramos faltan
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#0a0a0a',
                cancelButtonColor: '#94a3b8',
                confirmButtonText: 'Sí, tomar del almacén',
                cancelButtonText: 'Cancelar Venta',
                customClass: { popup: 'rounded-none' }
            });

            if (result.isConfirmed) {
                // Si la cajera dice que SÍ, volvemos a lanzar la venta pero con permiso activado
                return window.finalizarVentaBackend(true); 
            } else {
                return; // Si dice que NO, la venta se aborta de forma segura
            }
        }

        if(res.ok) {
            cerrarModalCobro();
            carrito = []; 
            pagosRealizados = [];
            localStorage.removeItem('carrito_pos_respaldo');
            localStorage.removeItem('pos_state_draft');
            renderCarrito();
            Swal.fire({ icon: 'success', title: '¡Venta Exitosa!', text: `Ticket #${data.id_venta} generado.`, timer: 1500, showConfirmButton: false })
            .then(() => {
                imprimirTicketFactura({
                    id_venta: data.id_venta, fecha: new Date(), cliente: clienteActual,
                    items: itemsLimpios, total: totalVentaFinal, pagos: pagosLimpios, 
                    tipoDocumento: tipoDoc, tasa: tasaCambio, nombreVendedor: nombreVendedor 
                });
            });
            cargarCatalogo(); 
            btn.innerHTML = originalText;
            btn.disabled = false;
        } else { 
            throw new Error(data.error || 'Error al procesar la venta.'); 
        }
    } catch (e) {
        console.error(e);
        Swal.fire('Error en Facturación', e.message, 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
    } 
};


let tabModalActual = 'ESTANDAR'; 
let comboFormulaActiva = null;

window.setMoneda = setMoneda;
window.agregarPago = agregarPago;
window.borrarPago = borrarPago;
window.toggleEditarTasa = toggleEditarTasa;


function agregarDirecto(prod, formulaId = null, nombreExtra = "") {
    const itemExistente = carrito.find(i => i.id === prod.id && i.formula_id === formulaId);

    if (itemExistente) {
        if(itemExistente.cantidad < prod.stock_real) {
            itemExistente.cantidad++;
        } else {
            Swal.fire({ toast: true, position: 'top', icon: 'warning', title: 'Tope de stock', timer: 1000, showConfirmButton: false});
        }
    } else {
        carrito.push({
            ...prod,
            nombre: prod.nombre + nombreExtra, // Ej: "Sauvage (30ml)"
            cantidad: 1,
            formula_id: formulaId // <--- IMPORTANTE: Aquí guardamos el ID para el descuento
        });
    }
    renderCarrito();
}

function abrirModalFormula(nombreProducto) {
    const modal = document.getElementById('modalSeleccionFormula');
    if (!modal) return;

    // Limpiar campos extra al abrir el modal
    const inputExtraG = document.getElementById('extraGramosEsencia');
    const inputExtraP = document.getElementById('precioGramoExtra');
    if(inputExtraG) inputExtraG.value = '';
    if(inputExtraP) inputExtraP.value = '';

    const label = document.getElementById('lblNombreProducto');
    if(label) label.innerText = modoRecargaActual ? `Recarga activa: ${nombreProducto}` : nombreProducto;

    comboFormulaActiva = null;
    cambiarTabModal('ESTANDAR');
    modal.classList.remove('hidden');
}

// ⚡ VENTANA INTERNA: Slots de búsqueda con memoria intermedia para combos
window.abrirAsignacionEsenciasComboPOS = function(idFormula, monedaElegida, precioBaseCalculado) {
    const formula = formulasGlobales.find(f => f.id === idFormula);
    if (!formula) return;

    comboFormulaActiva = formula;
    window.monedaComboElegidaTemp = monedaElegida;         
    window.precioComboCalculadoTemp = precioBaseCalculado; 

    // Ocultar controles principales de la modal para aislar el flujo del combo
    const tabsContainer = document.getElementById('tabModalEstandar')?.parentElement;
    if (tabsContainer) tabsContainer.classList.add('hidden');

    const wrapperBuscador = document.getElementById('wrapperBuscadorModalPromo');
    if (wrapperBuscador) wrapperBuscador.classList.add('hidden');

    const label = document.getElementById('lblNombreProducto');
    if (label) label.innerText = `Dosificar Combo: ${formula.nombre}`;

    const container = document.getElementById('contenedorFormulas');
    if (!container) return;

    const totalBotellas = parseInt(formula.cantidad_promo) || 4;
    const esencias = todosLosProductos.filter(p => p.categoria && p.categoria.toUpperCase().includes('ESENCIA'));

    // Verificar si existe un borrador guardado localmente para ESTA fórmula específica
    const borradorGuardado = localStorage.getItem(`borrador_combo_F${idFormula}`);
    let fraganciasBorrador = [];
    if (borradorGuardado) {
        try { fraganciasBorrador = JSON.parse(borradorGuardado); } catch(e) { console.error(e); }
    }

    let htmlSlots = `
        <div class="bg-neutral-900 p-3.5 text-[10px] font-black text-amber-400 border border-neutral-800 uppercase tracking-widest text-center mb-3 flex justify-between items-center">
            <span><i class="fa-solid fa-bolt mr-1.5"></i> Filtrado activo sobre ${esencias.length} esencias</span>
            ${fraganciasBorrador.length > 0 ? `
                <button type="button" onclick="window.recuperarBorradorComboPOS(${idFormula})" class="bg-amber-500 hover:bg-amber-600 text-neutral-950 px-2 py-1 text-[9px] font-black uppercase tracking-wider transition-colors">
                    <i class="fa-solid fa-folder-open mr-1"></i> Recuperar Borrador (${fraganciasBorrador.length})
                </button>
            ` : ''}
        </div>
        
        <datalist id="datalistEsenciasComboPOS">
            ${esencias.map(e => `<option value="${e.nombre}">Stock en Mostrador: ${parseFloat(e.stock_estante).toFixed(0)}g</option>`).join('')}
        </datalist>
        
        <div class="space-y-2.5 my-4 max-h-[260px] overflow-y-auto pr-1">
    `;

    for (let i = 0; i < totalBotellas; i++) {
        // Si hay borrador, precarga el valor, si no, usa el de productoPendiente por defecto
        const valorPredeterminado = fraganciasBorrador[i] || productoPendiente.nombre;

        htmlSlots += `
            <div class="p-3 border border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-none">
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 bg-neutral-950 text-white flex items-center justify-center font-black text-xs">${i + 1}</div>
                    <span class="text-[10px] font-black uppercase tracking-widest text-neutral-800">Perfume #${i + 1}</span>
                </div>
                <div class="relative window-input w-full sm:w-72">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400 text-[10px]"></i>
                    <input type="text" list="datalistEsenciasComboPOS" value="${valorPredeterminado}" class="input-esencia-combo-pos w-full pl-9 pr-3 py-2.5 border border-neutral-300 font-black uppercase text-[11px] bg-white outline-none focus:border-neutral-950 transition-colors" placeholder="ESCRIBE PARA BUSCAR FRAGANCIA..." required>
                </div>
            </div>
        `;
    }

    htmlSlots += `
        </div>
        
        <div class="pb-3 text-right">
            <button type="button" onclick="window.guardarBorradorComboPOS(${idFormula})" class="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-[9px] uppercase tracking-widest transition-colors rounded-none shadow-sm">
                <i class="fa-solid fa-floppy-disk mr-1.5 text-amber-400"></i> Guardar Borrador Temporal
            </button>
        </div>

        <div class="flex gap-2 pt-3 border-t border-neutral-200">
            <button type="button" onclick="window.cambiarTabModal('PROMO')" class="flex-1 py-3.5 border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-600 font-bold text-[10px] uppercase tracking-widest transition-colors rounded-none">
                Volver
            </button>
            <button type="button" onclick="confirmarEsenciasComboPOS()" class="flex-1 py-3.5 bg-neutral-950 hover:bg-neutral-800 text-white font-black text-[10px] uppercase tracking-widest transition-colors rounded-none">
                ⚡ Cargar Combo Variado
            </button>
        </div>
    `;

    container.innerHTML = htmlSlots;
};

// --- CORRECCIÓN: Definición Global de Funciones de Borrador ---
window.guardarBorradorGeneral = function() {
    const estado = {
        carrito: carrito,
        cliente: clienteActual,
        pagos: pagosRealizados,
        modo: modoVista,
        fecha_guardado: new Date().toISOString()
    };
    localStorage.setItem('pos_state_draft', JSON.stringify(estado));
};

window.recuperarBorradorGeneral = function() {
    const data = localStorage.getItem('pos_state_draft');
    return data ? JSON.parse(data) : null;
};


// 💾 ACCIÓN: Guarda el texto escrito en los inputs en el localStorage del navegador
window.guardarBorradorComboPOS = function(idFormula) {
    const inputs = document.querySelectorAll('.input-esencia-combo-pos');
    const fragancias = [];
    
    inputs.forEach(input => {
        fragancias.push(input.value.trim());
    });

    localStorage.setItem(`borrador_combo_F${idFormula}`, JSON.stringify(fragancias));
    
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Borrador guardado correctamente',
        showConfirmButton: false,
        timer: 1500
    });
};

// 📂 ACCIÓN: Recupera e inyecta las fragancias guardadas en los inputs visuales
window.recuperarBorradorComboPOS = function(idFormula) {
    const borrador = localStorage.getItem(`borrador_combo_F${idFormula}`);
    if (!borrador) return;

    try {
        const fragancias = JSON.parse(borrador);
        const inputs = document.querySelectorAll('.input-esencia-combo-pos');
        
        inputs.forEach((input, index) => {
            if (fragancias[index] !== undefined) {
                input.value = fragancias[index];
            }
        });

        Swal.fire({ toast: true, position: 'bottom-end', icon: 'info', title: 'Fragancias del borrador aplicadas', showConfirmButton: false, timer: 1500 });
    } catch(e) {
        console.error("Error al recuperar borrador", e);
    }
};

window.iniciarSeleccionPromoEnLote = function(cantidadMaximaPromo, datosDeLaPromo) {
    promoMaxPerfumes = parseInt(cantidadMaximaPromo, 10);
    promoPerfumesAgregados = 0;
    loteEsenciasPromo = [];
    promoDataActual = datosDeLaPromo;

    document.getElementById('contenedorFormulas').classList.add('hidden');
    document.getElementById('wrapperBuscadorModalPromo').classList.add('hidden');
    
    const panelLote = document.getElementById('contenedorSeleccionEsenciasPromo');
    panelLote.classList.remove('hidden');
    panelLote.classList.add('flex');

    document.getElementById('promoContadorMaximo').innerText = promoMaxPerfumes;
    
    // Limpiar el buscador visual cada vez que se abre la promo
    document.getElementById('inputBusquedaEsenciaPromo').value = '';
    document.getElementById('selectEsenciaPromo').value = '';
    document.getElementById('dropdownResultadosEsencia').classList.add('hidden');

    // 🔥 LA SOLUCIÓN UX: Inyectar automáticamente la esencia que seleccionaste en el panel
    if (productoPendiente) {
        loteEsenciasPromo.push({
            id: productoPendiente.id,
            nombre: productoPendiente.nombre,
            cantidad: 1,
            gramos_extra: 0,
            precio_gramo_extra: 0
        });
        promoPerfumesAgregados = 1;
    }

    document.getElementById('promoContadorActual').innerText = promoPerfumesAgregados;
    renderizarListaEsenciasLote();
};

window.agregarEsenciaEnLote = function() {
    const idInput = document.getElementById('selectEsenciaPromo');
    const nombreInput = document.getElementById('inputBusquedaEsenciaPromo');
    const inputCantidad = document.getElementById('cantidadEsenciaPromo');
    
    // NUEVO: Capturar los campos de gramos extra de la pantalla
    const inputGramosExtra = document.getElementById('extraGramosEsencia');
    const inputPrecioExtra = document.getElementById('precioGramoExtra');
    
    const esenciaId = idInput.value;
    const esenciaNombre = nombreInput.value;
    const cantidadAAgregar = parseInt(inputCantidad.value, 10);
    
    // NUEVO: Procesar los valores de gramos (por defecto 0 si están vacíos)
    const gramosExtra = parseFloat(inputGramosExtra.value) || 0;
    const precioExtra = parseFloat(inputPrecioExtra.value) || 0;

    if (!esenciaId) return Swal.fire('Atención', 'Por favor busca y selecciona una esencia de la lista inferior.', 'warning');
    if (isNaN(cantidadAAgregar) || cantidadAAgregar <= 0) return Swal.fire('Error', 'Cantidad inválida.', 'error');

    if (!esModoLoteEstandar && (promoPerfumesAgregados + cantidadAAgregar > promoMaxPerfumes)) {
        const disponibles = promoMaxPerfumes - promoPerfumesAgregados;
        return Swal.fire({
            icon: 'error',
            title: 'Límite Superado',
            text: `Solo puedes agregar ${disponibles} perfumes más a esta promoción. (Llevas ${promoPerfumesAgregados}/${promoMaxPerfumes})`,
            confirmButtonColor: '#0a0a0a'
        });
    }

    // NUEVO: Guardar los gramos extra directamente en este registro
    loteEsenciasPromo.push({
        id: esenciaId,
        nombre: esenciaNombre,
        cantidad: cantidadAAgregar,
        gramos_extra: gramosExtra,
        precio_gramo_extra: precioExtra
    });

    promoPerfumesAgregados += cantidadAAgregar;
    inputCantidad.value = 1; 
    
    // Limpiamos la casilla de "Gramos Extra" por si el siguiente perfume no lleva
    inputGramosExtra.value = ''; 

    // Limpiar el buscador para la siguiente esencia
    idInput.value = '';
    nombreInput.value = '';

    renderizarListaEsenciasLote();
};

function renderizarListaEsenciasLote() {
    document.getElementById('promoContadorActual').innerText = promoPerfumesAgregados;
    
    const container = document.getElementById('listaEsenciasPromoAcumuladas');
    const btnConfirmar = document.getElementById('btnConfirmarPromoLote');

    if (loteEsenciasPromo.length === 0) {
        container.innerHTML = `<div class="text-center text-neutral-400 font-bold text-[10px] uppercase tracking-widest py-8">Aún no has agregado esencias a este lote</div>`;
        btnConfirmar.disabled = true;
        btnConfirmar.classList.add('opacity-50', 'cursor-not-allowed');
        return;
    }

    // Pintar la lista (Ahora mostrando la etiqueta de Gramos Extra si tiene)
    container.innerHTML = loteEsenciasPromo.map((item, index) => {
        const tagExtra = item.gramos_extra > 0 
            ? `<span class="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[9px] ml-2 font-bold">(+${item.gramos_extra}g a $${item.precio_gramo_extra})</span>` 
            : '';

        return `
        <div class="flex justify-between items-center bg-white border border-neutral-200 p-3 shadow-sm mb-1">
            <span class="text-xs font-black text-neutral-950 uppercase tracking-widest flex items-center gap-2">
                <span class="bg-neutral-950 text-white px-2 py-1">${item.cantidad}x</span> 
                ${item.nombre} ${tagExtra}
            </span>
            <button type="button" onclick="eliminarLote(${index})" class="text-neutral-400 hover:text-red-600 transition-colors" title="Borrar">
                <i class="fa-solid fa-trash-can text-lg"></i>
            </button>
        </div>
        `;
    }).join('');

    // Candado del botón final
    if (esModoLoteEstandar) {
        document.getElementById('promoContadorMaximo').innerText = '∞';
        if (loteEsenciasPromo.length > 0) {
            btnConfirmar.disabled = false;
            btnConfirmar.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            btnConfirmar.disabled = true;
            btnConfirmar.classList.add('opacity-50', 'cursor-not-allowed');
        }
    } else {
        if (promoPerfumesAgregados === promoMaxPerfumes) {
            btnConfirmar.disabled = false;
            btnConfirmar.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            btnConfirmar.disabled = true;
            btnConfirmar.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

window.eliminarLote = function(index) {
    promoPerfumesAgregados -= loteEsenciasPromo[index].cantidad;
    loteEsenciasPromo.splice(index, 1);
    renderizarListaEsenciasLote();
};

window.cancelarSeleccionPromo = function() {
    esModoLoteEstandar = false; // 🔥 Liberamos la bandera al volver o cerrar
    const panelLote = document.getElementById('contenedorSeleccionEsenciasPromo');
    
    // 🔥 AQUÍ ESTÁ LA CORRECCIÓN: Era classList.add, no solo add
    panelLote.classList.add('hidden'); 
    panelLote.classList.remove('flex');
    
    document.getElementById('contenedorFormulas').classList.remove('hidden');
    document.getElementById('wrapperBuscadorModalPromo').classList.remove('hidden');
};

window.confirmarPromoLote = function() {
    if (!productoPendiente) return;
    if (!promoDataActual && !estandarDataActual) return;

    // Determinar origen dinámico de datos
    const dataActiva = esModoLoteEstandar ? estandarDataActual : promoDataActual;
    const { idFormula, monedaElegida, precioBase, formula } = dataActiva;
    const vol = formula.volumen_total;

    // 🛡️ Verificar stock en estante + depósito de CADA esencia
    for (const item of loteEsenciasPromo) {
        const prodEsencia = todosLosProductos.find(p => p.id == item.id);
        if (!prodEsencia) continue;
        
        const gEsenciaNecesariaItem = parseFloat(formula.gramos_esencia) + (item.gramos_extra || 0);
        const esenciaNecesariaParaEsteItem = gEsenciaNecesariaItem * item.cantidad;
        
        // Sumamos ambas cantidades
        const totalDisp = parseFloat(prodEsencia.stock_estante || 0) + parseFloat(prodEsencia.stock_real || 0);
        
        if (totalDisp < esenciaNecesariaParaEsteItem) {
            return Swal.fire('Existencias Insuficientes', `La fragancia "${prodEsencia.nombre}" no tiene gramos suficientes (${esenciaNecesariaParaEsteItem}g) sumando estante y almacén para este lote.`, 'warning');
        }
    }

    const itemsParaAgregar = [];

    loteEsenciasPromo.forEach((item, index) => {
        const prodEsencia = todosLosProductos.find(p => p.id == item.id);
        if (!prodEsencia) return;

        const gramosExtraItem = item.gramos_extra || 0;
        const precioGramoExtraItem = item.precio_gramo_extra || 0;

        // Si es Estándar, el precio base corre libre. Si es promo, se calcula la fracción fija.
        const precioFinalUnitario = esModoLoteEstandar 
            ? precioBase + (gramosExtraItem * precioGramoExtraItem)
            : (precioBase / promoMaxPerfumes) + (gramosExtraItem * precioGramoExtraItem);

        const mlAlcoholPorBotella = Math.max(0, parseFloat(formula.ml_alcohol) - gramosExtraItem);

        const tagExtra = gramosExtraItem > 0 ? ` (+${gramosExtraItem}g Ext)` : '';
        const tagModo = esModoLoteEstandar ? '' : ' (PROMO)';
        const tipoPrecioInicial = esModoLoteEstandar ? 'DETAL' : 'PROMO';
        const colorBadgeInicial = esModoLoteEstandar ? null : 'bg-amber-100 text-amber-700 border-amber-200';

        const nombreFactura = modoRecargaActual 
            ? `♻️ REC ${vol}ml ${prodEsencia.nombre}${tagExtra}${tagModo}` 
            : `${vol}ml ${prodEsencia.nombre}${tagExtra}${tagModo}`;

        itemsParaAgregar.push({
            id: prodEsencia.id, 
            unique_id: `${prodEsencia.id}_F${formula.id}_LOTE${index}_${Date.now()}`, 
            nombre: nombreFactura, 
            precio: precioFinalUnitario, 
            cantidad: item.cantidad, 
            formula_id: formula.id,
            es_recarga: modoRecargaActual,
            gramos_extra: gramosExtraItem,
            precio_gramo_extra: precioGramoExtraItem,
            ml_alcohol_override: mlAlcoholPorBotella,
            monedaElegida: monedaElegida,
            isLocked: esModoLoteEstandar ? false : true, // 🔥 FALSE para activar escalas mayoristas en lote estándar
            tipoPrecio: tipoPrecioInicial,
            badgeColor: colorBadgeInicial
        });
    });

    // Inyectar el lote limpio al carrito general
    itemsParaAgregar.forEach(item => carrito.push(item));
    renderCarrito();
    cerrarModalFormula();
    cancelarSeleccionPromo();
    
    if(document.getElementById('extraGramosEsencia')) document.getElementById('extraGramosEsencia').value = '';
    
    Swal.fire({ toast: true, position: 'bottom-end', icon: 'success', title: 'Lote inyectado al ticket', showConfirmButton: false, timer: 1500 });
};

window.confirmarEsenciasComboPOS = function() {
    if (!productoPendiente || !comboFormulaActiva) return;

    const inputs = document.querySelectorAll('.input-esencia-combo-pos');
    const totalBotellas = inputs.length;
    
    const gramosExtra = parseFloat(document.getElementById('extraGramosEsencia')?.value || 0);
    const precioGramoExtra = parseFloat(document.getElementById('precioGramoExtra')?.value || 0);

    const precioTotalCombo = window.precioComboCalculadoTemp || parseFloat(comboFormulaActiva.precio_promo);
    const precioUnitarioBase = precioTotalCombo / totalBotellas;
    const precioFinalUnitario = precioUnitarioBase + (gramosExtra * precioGramoExtra);
    
    // 🔥 CORRECCIÓN: Forzamos a que el volumen sea un entero matemático limpio (Evita el bug de 1100ML)
    const volLimpio = parseInt(comboFormulaActiva.volumen_total || 30, 10);

    const mlAlcoholPorBotella = Math.max(0, parseFloat(comboFormulaActiva.ml_alcohol) - gramosExtra);
    const gEsenciaNecesaria = parseFloat(comboFormulaActiva.gramos_esencia) + gramosExtra;
    const itemsParaAgregar = [];

    for (let i = 0; i < totalBotellas; i++) {
        const nombreEscrito = inputs[i].value.trim().toUpperCase();
        if (!nombreEscrito) return Swal.fire('Espacio Vacío', `Asigna una fragancia para la Botella #${i + 1}.`, 'warning');

        const prodEsencia = todosLosProductos.find(p => p.nombre.trim().toUpperCase() === nombreEscrito && p.categoria && p.categoria.toUpperCase().includes('ESENCIA'));
        if (!prodEsencia) return Swal.fire('Fragancia Inválida', `El texto en la Botella #${i + 1} no coincide con ninguna esencia registrada.`, 'error');

        // Sumamos ambas cantidades sin bloquear (Como lo corregimos para Recepción)
        const totalDispCombo = parseFloat(prodEsencia.stock_estante || 0) + parseFloat(prodEsencia.stock_real || 0);

        if (totalDispCombo < gEsenciaNecesaria) {
            console.warn(`El Frontend no detecta líquido suficiente de ${prodEsencia.nombre}, delegando apertura al Backend...`);
        }

        const tagExtra = gramosExtra > 0 ? ` (+${gramosExtra}g Ext)` : '';
        
        // 🔥 CORRECCIÓN: Estructura de texto limpia usando el volumen sanitizado (Ej: "30ML")
        const nombreFactura = modoRecargaActual 
            ? `♻️ REC ${volLimpio}ML ${prodEsencia.nombre}${tagExtra} (PROMO)` 
            : `${volLimpio}ML ${prodEsencia.nombre}${tagExtra} (PROMO)`;

        // 🔥 CORRECCIÓN CRÍTICA: Añadimos "_B${i}_" dentro del unique_id para que cada 
        // botella tenga un identificador único en memoria y el carrito no colapse los datos.
        itemsParaAgregar.push({
            id: prodEsencia.id, 
            unique_id: `${prodEsencia.id}_F${comboFormulaActiva.id}_B${i}__${Date.now()}`, 
            nombre: nombreFactura, 
            precio: precioFinalUnitario, 
            cantidad: 1, // Cada item entra de 1 en 1 de forma limpia
            formula_id: comboFormulaActiva.id,
            es_recarga: modoRecargaActual,
            gramos_extra: gramosExtra,
            precio_gramo_extra: precioGramoExtra,
            ml_alcohol_override: mlAlcoholPorBotella,
            monedaElegida: window.monedaComboElegidaTemp || 'USD',
            isLocked: true, 
            tipoPrecio: 'PROMO',
            badgeColor: 'bg-amber-100 text-amber-700 border-amber-200'
        });
    }

    // Si todo salió bien, limpiamos el borrador local de ESTA fórmula porque ya se consolidó en el carrito
    localStorage.removeItem(`borrador_combo_F${comboFormulaActiva.id}`);

    // Inyectar el lote limpio al carrito general
    itemsParaAgregar.forEach(item => carrito.push(item));
    renderCarrito();
    cerrarModalFormula();
    Swal.fire({ toast: true, position: 'bottom-end', icon: 'success', title: 'Combo variado inyectado al ticket', showConfirmButton: false, timer: 1500 });
};

window.cerrarModalFormula = function() {
    const modal = document.getElementById('modalSeleccionFormula');
    if (modal) modal.classList.add('hidden');
    productoPendiente = null;
    comboFormulaActiva = null;
    const tabsContainer = document.getElementById('tabModalEstandar')?.parentElement;
    if (tabsContainer) tabsContainer.classList.remove('hidden');
};

window.seleccionarFormula = async (idFormula, esPromo = false) => {
    if (!productoPendiente) return;
    const formula = formulasGlobales.find(f => f.id === idFormula);
    if (!formula) return;

    const vol = formula.volumen_total;
    let precioBase = 0;
    let monedaElegida = 'USD';

    const precioBsConfigurado = parseFloat(formula.precio_bs || 0);

    if (precioBsConfigurado > 0 && !modoRecargaActual) {
        const modalVisible = document.getElementById('modalSeleccionFormula');
        if (modalVisible) modalVisible.classList.add('hidden');

        const precioUSDTexto = esPromo ? parseFloat(formula.precio_promo).toFixed(2) : parseFloat(formula.precio).toFixed(2);

        const decision = await Swal.fire({
            title: '💱 Selector de Moneda Fija',
            html: `<span class="text-xs text-neutral-400 font-bold uppercase">Elige la modalidad de cobro para esta presentación:</span>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#d97706', 
            cancelButtonColor: '#0a0a0a',
            confirmButtonText: `Bs. Fijos (${precioBsConfigurado.toFixed(0)} Bs.)`,
            cancelButtonText: `Dólares ($${precioUSDTexto})`
        });

        if (decision.dismiss === Swal.DismissReason.backdrop || decision.dismiss === Swal.DismissReason.close) {
            if (modalVisible) modalVisible.classList.remove('hidden');
            return;
        }

        if (decision.isConfirmed) {
            monedaElegida = 'BS';
            precioBase = precioBsConfigurado / tasaCambio; 
        } else {
            monedaElegida = 'USD';
            precioBase = esPromo ? parseFloat(formula.precio_promo) : parseFloat(formula.precio);
        }
        if (modalVisible) modalVisible.classList.remove('hidden');
    } else if (modoRecargaActual) {
        const modalVisible = document.getElementById('modalSeleccionFormula');
        if (modalVisible) modalVisible.classList.add('hidden');

        const { value: precioIngresado } = await Swal.fire({
            title: '💸 Precio de Recarga',
            html: `Ingresa el precio base por la recarga de <b>${vol}ml</b>.<br><span class="text-xs text-gray-500 font-bold">(El costo de los gramos extra se sumará automáticamente)</span>`,
            input: 'number',
            inputPlaceholder: 'Ejemplo: 5.50',
            inputAttributes: { min: '0.1', step: '0.01' },
            showCancelButton: true,
            confirmButtonColor: '#16a34a',
            cancelButtonColor: '#64748b',
            confirmButtonText: '<i class="fa-solid fa-check"></i> Agregar',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value || parseFloat(value) <= 0) return 'Ingresa un precio mayor a 0';
            }
        });

        if (!precioIngresado) {
            if (modalVisible) modalVisible.classList.remove('hidden');
            return; 
        }
        precioBase = parseFloat(precioIngresado);
        if (modalVisible) modalVisible.classList.remove('hidden');
    } else {
        precioBase = esPromo ? parseFloat(formula.precio_promo) : parseFloat(formula.precio);
    }

    // 🔥 CONEXIÓN AL NUEVO PANEL DE LOTES EN LUGAR DE LA PANTALLA VIEJA
    if (esPromo) {
        const datosDeLaPromo = {
            idFormula: formula.id,
            monedaElegida: monedaElegida,
            precioBase: precioBase,
            formula: formula
        };
        window.iniciarSeleccionPromoEnLote(formula.cantidad_promo, datosDeLaPromo);
        return;
    }

    // --- FLUJO ESTÁNDAR ---
    const inputExtraG = document.getElementById('extraGramosEsencia');
    const inputExtraP = document.getElementById('precioGramoExtra');
    const gramosExtra = inputExtraG && inputExtraG.value ? parseFloat(inputExtraG.value) : 0;
    const precioGramoExtra = inputExtraP && inputExtraP.value ? parseFloat(inputExtraP.value) : 0;

    // --- LÓGICA DE DOSIFICACIÓN Y ALCOHOL ---
    const gEsenciaTotal = parseFloat(formula.gramos_esencia) + gramosExtra;
    let mlAlcoholTotal = parseFloat(formula.ml_alcohol) - gramosExtra;
    if (mlAlcoholTotal < 0) mlAlcoholTotal = 0;

    // 🔥 SOLUCIÓN: Se eliminan por completo las alertas de bloqueo de stock (Efecto pared).
    // El Frontend ya no frena la orden si el alcohol, fijador o frascos están PENDIENTES o en Almacén.
    // Se le delega al Backend para que realice el descuento inteligente con o sin confirmación.
    if (!modoRecargaActual) {
        const frasco = inventarioEnvases.find(e => (e.nombre.includes(vol.toString()) || e.contenido_gramos == vol));
        if (!frasco) {
            Swal.fire({ 
                toast: true, 
                position: 'top', 
                icon: 'info', 
                title: `Aviso: Presentación ${vol}ml no mapeada en catálogo global`, 
                showConfirmButton: false, 
                timer: 1550 
            });
        }
    }

    const costoExtraPorBotella = gramosExtra * precioGramoExtra;
    const precioFinalUnitario = precioBase + costoExtraPorBotella;

    const tagExtra = gramosExtra > 0 ? ` (+${gramosExtra}g Ext)` : '';
    const nombreFactura = modoRecargaActual 
        ? `♻️ REC ${vol}ml ${productoPendiente.nombre}${tagExtra}` 
        : `${vol}ml ${productoPendiente.nombre}${tagExtra}`;

    carrito.push({
        id: productoPendiente.id, 
        unique_id: `${productoPendiente.id}_F${idFormula}_${modoRecargaActual ? 'REC' : 'NEW'}_EXT${gramosExtra}_${Date.now()}`, 
        nombre: nombreFactura, 
        precio: precioFinalUnitario, 
        cantidad: 1, 
        formula_id: idFormula,
        es_recarga: modoRecargaActual,
        gramos_extra: gramosExtra,
        precio_gramo_extra: precioGramoExtra, 
        ml_alcohol_override: mlAlcoholTotal,
        monedaElegida: monedaElegida,
        isLocked: monedaElegida === 'BS'
    });

    renderCarrito();
    cerrarModalFormula();
};

window.cambiarTabModal = function(tipo) {
    tabModalActual = tipo;
    
    const tabE = document.getElementById('tabModalEstandar');
    const tabP = document.getElementById('tabModalPromo');
    const wrapperBuscador = document.getElementById('wrapperBuscadorModalPromo');
    const tabsContainer = document.getElementById('tabModalEstandar').parentElement;
    
    if (tabsContainer) tabsContainer.classList.remove('hidden'); // Asegurar visibilidad

    if (tipo === 'ESTANDAR') {
        tabE.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 bg-white text-neutral-950 border border-neutral-200";
        tabP.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 text-neutral-500 hover:text-neutral-950";
        wrapperBuscador.classList.add('hidden');
    } else {
        tabP.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 bg-white text-neutral-950 border border-neutral-200";
        tabE.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 text-neutral-500 hover:text-neutral-950";
        wrapperBuscador.classList.remove('hidden');
        document.getElementById('inputBuscarPromoModal').value = '';
    }
    
    renderContenidoModalFormulas();
};

function renderContenidoModalFormulas() {
    const container = document.getElementById('contenedorFormulas');
    if (!container || !productoPendiente) return;
    container.innerHTML = '';

    if (tabModalActual === 'ESTANDAR') {
        const formulasEstandar = formulasGlobales.filter(f => !(parseFloat(f.cantidad_promo) > 0));

        if (formulasEstandar.length === 0) {
            container.innerHTML = `<div class="text-center py-6 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Ninguna medida regular registrada.</div>`;
            return;
        }

        formulasEstandar.forEach(f => {
            const reqAlcohol = parseFloat(f.ml_alcohol || 0);
            // 🔥 CORREGIDO: Sumamos estante + unidades para que detecte el alcohol en Recepción/Depósito
            const stockAlcohol = productoAlcohol ? (parseFloat(productoAlcohol.stock_estante || 0) + parseFloat(productoAlcohol.stock_unidades || 0)) : 0;
            const hayAlcohol = stockAlcohol >= reqAlcohol;
            let badgeAlcohol = reqAlcohol > 0 ? (hayAlcohol ? `<span class="text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 font-bold text-[9px]">ALC: SÍ</span>` : `<span class="text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 font-bold text-[9px]">ALC: NO</span>`) : '';

            const reqFijador = parseFloat(f.gramos_fijador || 0);
            // 🔥 CORREGIDO: Sumamos estante + unidades para que detecte el fijador en Recepción/Depósito
            const stockFijador = productoFijador ? (parseFloat(productoFijador.stock_estante || 0) + parseFloat(productoFijador.stock_unidades || 0)) : 0;
            const hayFijador = stockFijador >= reqFijador;
            let badgeFijador = reqFijador > 0 ? (hayFijador ? `<span class="text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 font-bold text-[9px]">FIJ: SÍ</span>` : `<span class="text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 font-bold text-[9px]">FIJ: NO</span>`) : '';

            let badgeEnvase = '';
            if (modoRecargaActual) {
                badgeEnvase = `<span class="text-neutral-700 bg-neutral-100 border border-neutral-300 px-1.5 py-0.5 font-bold text-[9px]">♻️ FRASCO CLIENTE</span>`;
            } else {
                // 🔥 CORREGIDO: Buscamos el envase sumando el inventario total disponible
                const envase = inventarioEnvases.find(e => 
                    (e.nombre.includes(f.volumen_total.toString()) || e.contenido_gramos == f.volumen_total) && 
                    (parseFloat(e.stock_estante || 0) + parseFloat(e.stock_unidades || 0)) >= 1
                );
                badgeEnvase = envase ? `<span class="text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 font-bold text-[9px]">ENVASE: SÍ</span>` : `<span class="text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 font-bold text-[9px]">ENVASE: NO</span>`;
            }

            const textoPrecio = modoRecargaActual ? 'Recarga Variable' : `$${parseFloat(f.precio).toFixed(2)}`;

            container.innerHTML += `
                <div class="p-4 border border-neutral-200 rounded-none bg-neutral-50 hover:border-neutral-950 transition-colors flex flex-col gap-2">
                    <div class="flex justify-between items-center">
                        <span class="font-black text-neutral-950 text-xs uppercase tracking-wide"><i class="fa-solid fa-bottle-droplet text-neutral-400 mr-1.5"></i> Formato ${f.volumen_total}ml</span>
                        <div class="flex gap-2">
                            <button type="button" onclick="seleccionarFormula(${f.id}, false)" class="bg-neutral-950 hover:bg-neutral-800 text-white font-black text-[10px] uppercase tracking-widest px-3 py-2 rounded-none">Directo (+1)</button>
                            <button type="button" onclick="window.iniciarEstandarLoteUI(${f.id})" class="bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black text-[10px] uppercase tracking-widest px-3 py-2 border border-amber-600 rounded-none"><i class="fa-solid fa-list-check"></i> Cargar en Lote</button>
                        </div>
                    </div>
                    <div class="flex justify-between items-center border-t border-neutral-200 pt-2 mt-1">
                        <div class="flex gap-1.5 flex-wrap">${badgeEnvase} ${badgeFijador} ${badgeAlcohol}</div>
                        <span class="font-black text-neutral-950 text-xs">${textoPrecio}</span>
                    </div>
                </div>
            `;
        });
    } else {
        window.filtrarPromosModal();
    }
}

window.iniciarEstandarLoteUI = async function(idFormula) {
    if (!productoPendiente) return;
    const formula = formulasGlobales.find(f => f.id === idFormula);
    if (!formula) return;

    let precioBase = parseFloat(formula.precio) || 0;
    let monedaElegida = 'USD';
    const precioBsConfigurado = parseFloat(formula.precio_bs || 0);

    if (precioBsConfigurado > 0 && !modoRecargaActual) {
        const modalVisible = document.getElementById('modalSeleccionFormula');
        if (modalVisible) modalVisible.classList.add('hidden');

        const decision = await Swal.fire({
            title: '💱 Selector de Moneda Fija (Lote)',
            html: `<span class="text-xs text-neutral-400 font-bold uppercase">Elige la modalidad de cobro para este lote estándar:</span>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#d97706', 
            cancelButtonColor: '#0a0a0a',
            confirmButtonText: `Bs. Fijos (${precioBsConfigurado.toFixed(0)} Bs.)`,
            cancelButtonText: `Dólares ($${precioBase.toFixed(2)})`
        });

        if (decision.dismiss === Swal.DismissReason.backdrop || decision.dismiss === Swal.DismissReason.close) {
            if (modalVisible) modalVisible.classList.remove('hidden');
            return;
        }

        if (decision.isConfirmed) {
            monedaElegida = 'BS';
            precioBase = precioBsConfigurado / tasaCambio; 
        } else {
            monedaElegida = 'USD';
            precioBase = parseFloat(formula.precio);
        }
        if (modalVisible) modalVisible.classList.remove('hidden');
    }

    esModoLoteEstandar = true;
    promoMaxPerfumes = 999999; 
    promoPerfumesAgregados = 0;
    loteEsenciasPromo = [];
    estandarDataActual = { idFormula, monedaElegida, precioBase, formula };

    document.getElementById('contenedorFormulas').classList.add('hidden');
    document.getElementById('wrapperBuscadorModalPromo').classList.add('hidden');
    
    const panelLote = document.getElementById('contenedorSeleccionEsenciasPromo');
    panelLote.classList.remove('hidden');
    panelLote.classList.add('flex');

    document.getElementById('promoContadorMaximo').innerText = '∞';
    document.getElementById('inputBusquedaEsenciaPromo').value = '';
    document.getElementById('selectEsenciaPromo').value = '';
    document.getElementById('dropdownResultadosEsencia').classList.add('hidden');

    // 🔥 LA SOLUCIÓN UX: Agregar el perfume al presionar "Cargar Lote"
    if (productoPendiente) {
        loteEsenciasPromo.push({
            id: productoPendiente.id,
            nombre: productoPendiente.nombre,
            cantidad: 1,
            gramos_extra: 0,
            precio_gramo_extra: 0
        });
        promoPerfumesAgregados = 1;
    }

    document.getElementById('promoContadorActual').innerText = promoPerfumesAgregados;
    renderizarListaEsenciasLote();
};

window.filtrarPromosModal = function() {
    if (tabModalActual !== 'PROMO') return;
    
    const container = document.getElementById('contenedorFormulas');
    const buscadorTexto = document.getElementById('inputBuscarPromoModal').value.toLowerCase().trim();
    container.innerHTML = '';

    const formulasPromo = formulasGlobales.filter(f => parseFloat(f.cantidad_promo) > 0);

    if (formulasPromo.length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Ningún combo promocional registrado.</div>`;
        return;
    }

    const gruposPorVolumen = {};
    formulasPromo.forEach(f => {
        if (buscadorTexto && !f.nombre.toLowerCase().includes(buscadorTexto)) return;
        
        // 🔥 LA CORRECCIÓN: Nos aseguramos de que el volumen se guarde estrictamente como un número limpio
        // Para evitar que JavaScript concatene un '1' y convierta 100 en 1100
        const volLimpio = parseInt(f.volumen_total, 10);
        
        if (!gruposPorVolumen[volLimpio]) {
            gruposPorVolumen[volLimpio] = [];
        }
        gruposPorVolumen[volLimpio].push(f);
    });

    if (Object.keys(gruposPorVolumen).length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">No hay combos que coincidan con la búsqueda.</div>`;
        return;
    }

    // Dibujar los acordeones con el volumen sanitizado
    for (const volumen in gruposPorVolumen) {
        const itemsCombo = gruposPorVolumen[volumen];
        
        const divAcordeon = document.createElement('div');
        divAcordeon.className = "border border-neutral-300 bg-white rounded-none overflow-hidden mb-2";
        
        // 🔥 Aquí ya saldrá "100ML" perfecto en vez de "1100ML"
        divAcordeon.innerHTML = `
            <div onclick="toggleAcordeonPromoModal(this)" class="p-4 bg-neutral-950 text-white flex justify-between items-center cursor-pointer select-none transition-colors hover:bg-neutral-900">
                <span class="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                    <i class="fa-solid fa-boxes-stacked text-amber-500 text-xs"></i> Formato de Combos ${volumen}ML
                </span>
                <span class="flecha-acordeon transition-transform duration-200 transform text-xs text-neutral-400 font-black font-mono">▶</span>
            </div>
            <div class="cuerpo-acordeon hidden divide-y divide-neutral-200 bg-neutral-50">
                ${itemsCombo.map(f => `
                    <div class="p-4 flex justify-between items-center hover:bg-neutral-100/70 transition-colors">
                        <div>
                            <div class="font-black text-neutral-950 text-xs">${f.nombre.toUpperCase()}</div>
                            <div class="text-[10px] font-bold text-amber-600 mt-1 uppercase tracking-wider">Lote comercial de ${f.cantidad_promo} unidades</div>
                        </div>
                        <div class="flex items-center gap-4">
                            <span class="font-black text-neutral-950 text-sm">$${parseFloat(f.precio_promo).toFixed(2)}</span>
                            <button type="button" onclick="seleccionarFormula(${f.id}, true)" class="bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black text-[9px] uppercase tracking-widest px-3 py-2 border border-amber-600">Llevar Combo</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(divAcordeon);
    }
};

window.toggleAcordeonPromoModal = function(header) {
    const cuerpo = header.nextElementSibling;
    const flecha = header.querySelector('.flecha-acordeon');
    
    if (cuerpo.classList.contains('hidden')) {
        cuerpo.classList.remove('hidden');
        flecha.innerText = "▼";
    } else {
        cuerpo.classList.add('hidden');
        flecha.innerText = "▶";
    }
};


window.regresarDeAsignacionComboPOS = function() {
    comboFormulaActiva = null;
    cambiarTabModal('PROMO');
};

function agregarAlCarritoLogica(item) {
    const existente = carrito.find(i => i.unique_id === item.unique_id);
    
    if(existente) {
        // Si sumamos a uno existente bloqueado, lo desbloqueamos?
        // Mejor lógica: Si es unique_id exacto, es la misma fila.
        existente.cantidad += item.cantidad;
        if(existente.isLocked) existente.isLocked = false; // Abrir si se edita
    } else {
        carrito.push(item);
    }
    
    renderCarrito(); 

    // Verificamos oferta inmediatamente después de agregar
    if (item.formula_id) {
        verificarOfertaGrupo(item.formula_id);
    }
    
    const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1500 });
    Toast.fire({ icon: 'success', title: 'Agregado al carrito' });
}

function mostrarErrorStock(titulo, producto, disponible, necesario, unidad) {
    Swal.fire({ 
        title: `¡${titulo}!`,
        html: `No puedes preparar este perfume porque falta <b>${producto}</b>.<br><br>
               Stock Actual: <b>${parseFloat(disponible).toFixed(2)} ${unidad}</b><br>
               Necesitas: <span class="text-red-600 font-bold">${parseFloat(necesario).toFixed(2)} ${unidad}</span>`,
        icon: 'error',
        confirmButtonText: 'Entendido'
    });
}

window.confirmarAgregarSinFormula = () => {
    if (productoPendiente) {
        agregarDirecto(productoPendiente, null, ""); // Sin ID de fórmula
        document.getElementById('modalSeleccionFormula').classList.add('hidden');
        productoPendiente = null;
    }
};

window.filtrarEsenciasLote = function(texto) {
    clearTimeout(timeoutBuscadorLote); // Cortar la búsqueda anterior si sigue escribiendo
    
    const dropdown = document.getElementById('dropdownResultadosEsencia');
    const inputOculto = document.getElementById('selectEsenciaPromo');
    
    texto = texto.trim().toUpperCase();
    
    // Si el usuario borra todo, ocultamos el cajón
    if(texto.length === 0) {
        dropdown.classList.add('hidden');
        inputOculto.value = '';
        return;
    }

    // Esperar 300ms después de la última tecla para buscar
    timeoutBuscadorLote = setTimeout(() => {
        // Filtrar sobre el inventario que ya tienes en memoria
        const inventarioEsencias = todosLosProductos.filter(p => 
            p.categoria && p.categoria.toUpperCase().includes('ESENCIA') &&
            p.nombre.toUpperCase().includes(texto)
        );

        if (inventarioEsencias.length === 0) {
            dropdown.innerHTML = '<div class="p-4 text-[10px] text-neutral-500 font-bold uppercase tracking-widest text-center bg-neutral-50">No hay fragancias con ese nombre</div>';
        } else {
            dropdown.innerHTML = inventarioEsencias.map(e => `
                <div onclick="seleccionarEsenciaDesdeDropdown(${e.id}, '${e.nombre.replace(/'/g, "\\'")}')" class="p-3 border-b border-neutral-100 hover:bg-neutral-100 cursor-pointer flex justify-between items-center transition-colors">
                    <span class="text-xs font-black text-neutral-950 uppercase tracking-wider">${e.nombre}</span>
                    <span class="text-[10px] font-bold ${e.stock_estante > 0 ? 'text-green-600 bg-green-50 border-green-200' : 'text-red-500 bg-red-50 border-red-200'} px-2 py-1 border">Disp: ${parseFloat(e.stock_estante).toFixed(0)}g</span>
                </div>
            `).join('');
        }
        dropdown.classList.remove('hidden');
    }, 300); // 300 milisegundos de delay perfecto
};

// Al hacer clic en el resultado estilo Pinterest
window.seleccionarEsenciaDesdeDropdown = function(id, nombre) {
    document.getElementById('selectEsenciaPromo').value = id;
    document.getElementById('inputBusquedaEsenciaPromo').value = nombre;
    document.getElementById('dropdownResultadosEsencia').classList.add('hidden');
    document.getElementById('cantidadEsenciaPromo').focus(); // Salta al número directamente
};

// 5. Función auxiliar para agregar items modificados (con fórmula)
function agregarItemEspecial(newItem) {
    // Buscamos si ya existe ese producto CON ESE TAMAÑO EXACTO en el carrito
    const itemExistente = carrito.find(i => i.unique_id === newItem.unique_id);

    if (itemExistente) {
        // Ya validamos el stock en el paso anterior, así que aquí solo sumamos con confianza
        itemExistente.cantidad += newItem.cantidad;
    } else {
        carrito.push(newItem);
    }
    renderCarrito();
}

// Busca la función imprimirTicketFactura y reemplázala por esta:

function imprimirTicketFactura(datos) {
    // 1. FORMATEADOR (Miles con punto, decimales con coma)
    const formatVE = (valor) => {
        return new Intl.NumberFormat('es-VE', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        }).format(valor);
    };

    // 2. CÁLCULOS (MODIFICADO: INGENIERÍA INVERSA)
    let totalGlobalBs = 0; // Acumulador del total final (con IVA)

    const itemsHTML = datos.items.map(item => {
        // Precio Unitario Final en Bs (Precio Carrito * Tasa)
        const precioFinalBs = item.precio * datos.tasa;
        
        // Subtotal Final en Bs (Lo que paga el cliente por este item con IVA incluido)
        const subtotalFinalBs = precioFinalBs * item.cantidad;
        
        // Desglosamos la base de este item para mostrarla en la columna "TOTAL" de la fila
        // (En facturas fiscales, las líneas suelen mostrar la base imponible)
        const subtotalBaseBs = subtotalFinalBs / 1.16;
        
        // Acumulamos el Total Final (para asegurar que el monto a pagar sea exacto al cobrado)
        totalGlobalBs += subtotalFinalBs;
        
        return `
        <tr>
            <td width="15%" style="vertical-align: top; padding-right: 5px; text-align: center;">${item.cantidad}</td>
            <td width="55%" style="vertical-align: top; padding-right: 5px;">${item.descripcion.toUpperCase()}</td>
            <td width="30%" class="text-right" style="vertical-align: top;">${formatVE(subtotalBaseBs)}</td>
        </tr>`;
    }).join('');

    // CÁLCULOS GLOBALES HACIA ATRÁS
    // Tomamos el total acumulado y extraemos la base y el IVA
    const baseImponibleBs = totalGlobalBs / 1.16;
    const ivaBs = totalGlobalBs - baseImponibleBs;
    const totalPagarBs = totalGlobalBs;

    // 3. DEFINIR CONTENIDO
    let contenidoCuerpo = '';

    if (datos.tipoDocumento === 'FACTURA') {
        // --- DISEÑO FACTURA ---
        contenidoCuerpo = `
            <div class="text-center">
                <div class="font-bold text-lg">INVERSIONES BEAST MODE C.A.</div>
                <div class="font-bold">RIF: J-50442123-0</div>
                <div class="text-xs" style="margin-top:4px; line-height: 1.2;">
                    AV. FRANCISCO DE MIRANDA, CHACAO.<br>
                    CARACAS - VENEZUELA
                </div>
            </div>

            <div class="divider-solid"></div>

            <div style="display: flex; justify-content: space-between;">
                <div>Orden de salida</div>
                <div class="font-bold">NRO: ${datos.id_venta.toString().padStart(8, '0')}</div>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <div>NRO CONTROL</div>
                <div class="font-bold">00-${datos.id_venta.toString().padStart(8, '0')}</div>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <div>FECHA: ${new Date(datos.fecha).toLocaleDateString('es-VE')}</div>
                <div>HORA: ${new Date(datos.fecha).toLocaleTimeString('es-VE')}</div>
            </div>
             <div style="display: flex; justify-content: space-between;">
                <div>CLIENTE:</div>
                <div class="text-right font-bold">${datos.cliente.nombre.substring(0, 25)}</div>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <div>RIF/CI:</div>
                <div>${datos.cliente.documento}</div>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <div>TELF:</div>
                <div>${datos.cliente.telefono || ''}</div>
            </div>
            
            <div style="display: flex; justify-content: space-between;">
                <div>ATENDIDO POR:</div>
                <div class="font-bold text-right">${(datos.nombreVendedor || '').toUpperCase()}</div>
            </div>

            <div class="divider-solid"></div>

            <table>
                <thead>
                    <tr>
                        <th class="text-center" width="15%">CANT</th>
                        <th class="text-left" width="55%">DESCRIPCIÓN</th>
                        <th class="text-right" width="30%">TOTAL (BASE)</th>
                    </tr>
                </thead>
                <tbody style="font-size: 10px;">
                    ${itemsHTML}
                </tbody>
            </table>

            <div class="divider-solid"></div>

            <div class="text-right">
                <div style="display: flex; justify-content: space-between;">
                    <span>BI G:</span>
                    <span>${formatVE(baseImponibleBs)}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>IVA G (16%):</span>
                    <span>${formatVE(ivaBs)}</span>
                </div>

                <div class="divider"></div>

                <div style="display: flex; justify-content: space-between; font-size: 14px; margin-top: 5px;">
                    <span class="font-bold">TOTAL A PAGAR:</span>
                    <span class="font-bold">Bs ${formatVE(totalPagarBs)}</span>
                </div>
            </div>

            <div class="divider-solid" style="margin-top: 15px;"></div>

            <div class="text-center text-xs">
                <p class="font-bold">¡GRACIAS POR SU COMPRA!</p>
            </div>
        `;

    } else {
        // --- DISEÑO NOTA DE ENTREGA ---
        contenidoCuerpo = `
            <div class="text-center">
                <div class="header-nota">NOTA DE ENTREGA</div>
                <div class="font-bold text-lg mt-2">INVERSIONES BEAST MODE C.A.</div>
                <div class="text-xs">RIF: J-50442123-0</div>
            </div>

            <div class="divider-solid"></div>

            <div style="display: flex; justify-content: space-between;">
                <div>CONTROL:</div>
                <div class="font-bold">${datos.id_venta.toString().padStart(8, '0')}</div>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <div>FECHA:</div>
                <div>${new Date(datos.fecha).toLocaleDateString('es-VE')}</div>
            </div>
            
            <div class="divider"></div>
            <div>CLIENTE: <span class="font-bold">${datos.cliente.nombre}</span></div>
            <div>DOC: ${datos.cliente.documento}</div>
            
            <div style="margin-top: 2px;">ATENDIDO POR: <span class="font-bold">${(datos.nombreVendedor || '').toUpperCase()}</span></div>

            <div class="divider-solid"></div>

            <table>
                <thead>
                    <tr>
                        <th class="text-center" width="15%">CANT</th>
                        <th class="text-left" width="55%">DESCRIPCIÓN</th>
                        <th class="text-right" width="30%">TOTAL</th>
                    </tr>
                </thead>
                <tbody style="font-size: 10px;">
                    ${itemsHTML}
                </tbody>
            </table>

            <div class="divider-solid"></div>

            <div class="text-right">
                <div style="display: flex; justify-content: space-between;">
                    <span>SUBTOTAL (Base):</span>
                    <span>${formatVE(baseImponibleBs)}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>IVA (16%):</span>
                    <span>${formatVE(ivaBs)}</span>
                </div>

                <div class="divider"></div>

                <div style="display: flex; justify-content: space-between; font-size: 14px; margin-top: 5px;">
                    <span class="font-bold">TOTAL:</span>
                    <span class="font-bold">Bs ${formatVE(totalPagarBs)}</span>
                </div>
            </div>

            <div class="divider-solid" style="margin-top: 15px;"></div>
            
            <div class="text-center text-xs">
                <p>ORIGINAL: Gracias por su compra</p>
            </div>
        `;
    }

    // 4. IMPRIMIR
    const ventana = window.open('', 'PRINT', 'height=600,width=400');

    if (!ventana) {
        Swal.fire({
            title: '¡Ticket Bloqueado!',
            text: 'Tu navegador bloqueó la ventana de impresión (Pop-up). Por favor, busca el ícono en la barra de direcciones y permite las ventanas emergentes para este sitio.',
            icon: 'warning',
            confirmButtonColor: '#dc2626'
        });
        return; // Detenemos la función aquí para que no de el error rojo
    }
    
    ventana.document.write(`
        <html>
            <head>
                <title>Ticket ${datos.tipoDocumento}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');
                    
                    body {
                        margin: 0; padding: 2px;
                        font-family: 'Courier Prime', 'Courier New', monospace;
                        font-size: 11px;
                        color: #000;
                        text-transform: uppercase;
                        width: 72mm; 
                    }
                    
                    .text-center { text-align: center; }
                    .text-right { text-align: right; }
                    .text-left { text-align: left; }
                    .font-bold { font-weight: bold; }
                    .text-xs { font-size: 10px; }
                    .text-lg { font-size: 14px; }
                    
                    .divider { border-bottom: 1px dashed #000; margin: 4px 0; }
                    .divider-solid { border-bottom: 1px solid #000; margin: 6px 0; }

                    .header-seniat { 
                        font-weight: bold; font-size: 16px; margin-bottom: 5px; letter-spacing: 2px; 
                    }
                    .header-nota { 
                        font-weight: bold; font-size: 14px; margin-bottom: 5px; 
                        border: 2px solid #000; padding: 4px; display: inline-block; 
                    }

                    table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                    td, th { vertical-align: top; padding: 2px 0; }
                    
                    @page { margin: 0; size: auto; }
                </style>
            </head>
            <body>
                ${contenidoCuerpo}
            </body>
        </html>
    `);
    
    ventana.document.close();
    ventana.focus();
    
    setTimeout(() => {
        ventana.print();
        ventana.close();
    }, 500);
}

window.actualizarCantidadCarrito = function(index, nuevaCantidad) {
    let cant = parseInt(nuevaCantidad);
    if(!cant || cant <= 0) cant = 1; 

    if (carrito[index].isLocked) {
        carrito[index].isLocked = false;
    }

    carrito[index].cantidad = cant;
    renderCarrito();
};

function limpiarPagos() {
    // 1. Vaciar el arreglo de pagos realizados
    pagosRealizados = [];

    // 2. Limpiar el campo de referencia por si acaso
    document.getElementById('refPago').value = '';

    // 3. Recalcular todo el resumen visual (esto pondrá IGTF en 0 y el Restante al máximo)
    actualizarResumenCobro();

    // 4. Feedback visual rápido
    const Toast = Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 1200 });
    Toast.fire({ icon: 'info', title: 'Pagos eliminados. Cuenta reseteada.' });
}

window.guardarPedidoBD = async function() {
    if (loteEsenciasPromo.length === 0) {
        return Swal.fire('Error', 'No has agregado ninguna fragancia para guardar.', 'warning');
    }

    const { value: nombrePedido } = await Swal.fire({
        title: 'Guardar Pedido Especial',
        html: '<span class="text-xs text-neutral-500 font-bold uppercase tracking-widest">Identifica este lote para recuperarlo luego</span>',
        input: 'text',
        inputPlaceholder: 'EJ: PEDIDO DE MARÍA',
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> Guardar en BD',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0a0a0a',
        inputValidator: (value) => {
            if (!value || value.trim() === '') return 'Debes ingresar un nombre de identificación.';
        }
    });

    if (nombrePedido) {
        try {
            const token = localStorage.getItem('token');
            const payload = {
                nombre_identificador: nombrePedido,
                formula_id: promoDataActual.idFormula, // 🔒 Estrictez: Amarrado a esta fórmula
                items: loteEsenciasPromo
            };

            const res = await fetch('/api/ventas/borradores', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (res.ok) {
                Swal.fire({ toast: true, position: 'bottom-end', icon: 'success', title: 'Pedido archivado en BD', showConfirmButton: false, timer: 2000 });
                // Limpiamos la vista actual para seguir trabajando
                loteEsenciasPromo = [];
                promoPerfumesAgregados = 0;
                renderizarListaEsenciasLote();
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            Swal.fire('Error', error.message, 'error');
        }
    }
};

window.cargarPedidosBD = async function() {
    if (!promoDataActual || !promoDataActual.idFormula) return;
    
    try {
        const token = localStorage.getItem('token');
        // 🔒 Estrictez: Solo busca los pedidos compatibles con la fórmula actual
        const res = await fetch(`/api/ventas/borradores/formula/${promoDataActual.idFormula}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const borradores = await res.json();

        if (borradores.length === 0) {
            return Swal.fire({
                icon: 'info',
                title: 'Bandeja Vacía',
                text: 'No hay pedidos guardados que correspondan al tamaño de esta promoción.',
                confirmButtonColor: '#0a0a0a'
            });
        }

        // Crear una lista HTML interactiva con SweetAlert
        let htmlLista = '<div class="space-y-2 mt-4 max-h-60 overflow-y-auto custom-scrollbar text-left">';
        
        borradores.forEach(b => {
            // Calculamos cuántos perfumes tiene el lote guardado
            const cantidadTotal = b.items_json.reduce((acc, i) => acc + i.cantidad, 0);
            
            // Creamos la fila JSON para inyectarla directo al clic
            const itemsString = JSON.stringify(b.items_json).replace(/"/g, '&quot;');

            htmlLista += `
                <div class="border border-neutral-300 bg-neutral-50 p-3 hover:bg-neutral-100 transition-colors flex justify-between items-center cursor-pointer" onclick="aplicarPedidoGuardado('${itemsString}', ${b.id})">
                    <div>
                        <div class="font-black text-xs text-neutral-950 uppercase tracking-widest">${b.nombre_identificador}</div>
                        <div class="text-[9px] font-bold text-neutral-500 uppercase tracking-widest mt-1">
                            <i class="fa-solid fa-clock mr-1"></i> ${b.fecha} | <i class="fa-solid fa-flask ml-2 mr-1"></i> ${cantidadTotal} Perfumes
                        </div>
                    </div>
                    <button class="bg-neutral-950 text-white px-3 py-2 text-[10px] font-black uppercase tracking-widest">
                        Cargar
                    </button>
                </div>
            `;
        });
        htmlLista += '</div>';

        Swal.fire({
            title: 'Pedidos Compatibles',
            html: htmlLista,
            showConfirmButton: false,
            showCloseButton: true,
            width: '32em'
        });

    } catch (error) {
        Swal.fire('Error', 'No se pudieron obtener los pedidos.', 'error');
    }
};

window.aplicarPedidoGuardado = async function(itemsString, idBorrador) {
    const items = JSON.parse(itemsString);
    
    // Verificamos si al cargar el pedido no superamos el límite de la promo actual
    const nuevaCantidad = items.reduce((acc, i) => acc + i.cantidad, 0);
    
    if (nuevaCantidad > promoMaxPerfumes) {
        return Swal.fire('Incompatible', `Este pedido requiere ${nuevaCantidad} espacios, pero la promo actual solo permite ${promoMaxPerfumes}.`, 'error');
    }

    // Preguntamos si quiere eliminar el borrador tras cargarlo
    const { isConfirmed } = await Swal.fire({
        title: 'Pedido Cargado',
        text: '¿Deseas eliminar este pedido de la base de datos ahora que lo vas a despachar?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminarlo',
        cancelButtonText: 'No, mantenerlo guardado',
        confirmButtonColor: '#dc2626'
    });

    if (isConfirmed) {
        const token = localStorage.getItem('token');
        await fetch(`/api/ventas/borradores/${idBorrador}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    // Sustituimos los datos actuales por los del pedido y actualizamos contadores
    loteEsenciasPromo = items;
    promoPerfumesAgregados = nuevaCantidad;
    
    renderizarListaEsenciasLote();
    Swal.close(); // Cierra el listado de pedidos
};

/**
 * Calcula el precio unitario basado en la cantidad específica de ESTE ítem.
 * @param {Object} formula - Objeto con los datos de precios y cantidades de la fórmula.
 * @param {Number} cantidad - La cantidad que el usuario escribió para este ítem.
 */

function obtenerPrecioPorEscala(formula, cantidad) {
    const qty = parseInt(cantidad);
    
    // Validamos que existan los datos, si no, usamos valores seguros
    const pPromo = parseFloat(formula.precio_promo || 0);
    const cPromo = parseInt(formula.cantidad_promo || 999999);
    
    const pGranMayor = parseFloat(formula.precio_gran_mayor || 0);
    const cGranMayor = parseInt(formula.cantidad_gran_mayor || 999999);
    
    const pMayor = parseFloat(formula.precio_mayor || 0);
    const cMayor = parseInt(formula.cantidad_mayor || 999999);
    
    const pDetal = parseFloat(formula.precio || 0);

    // LÓGICA DE CASCADA (De mayor cantidad a menor cantidad)
    
    // 1.  Promoción (Ej: > 100 unidades)
    if (pPromo > 0 && qty >= cPromo) {
        return { 
            precio: pPromo, 
            tipo: 'PROMOCIÓN', 
            clase: 'text-purple-600 bg-purple-50 border-purple-200' // Estilos visuales opcionales
        };
    }

    // 2.  Gran Mayor (Ej: > 50 unidades)
    if (pGranMayor > 0 && qty >= cGranMayor) {
        return { 
            precio: pGranMayor, 
            tipo: 'GRAN MAYOR', 
            clase: 'text-orange-600 bg-orange-50 border-orange-200'
        };
    }

    // 3.  Mayor (Ej: > 6 unidades)
    if (pMayor > 0 && qty >= cMayor) {
        return { 
            precio: pMayor, 
            tipo: 'MAYOR', 
            clase: 'text-blue-600 bg-blue-50 border-blue-200'
        };
    }

    // 4. Precio Normal (Detal)
    return { 
        precio: pDetal, 
        tipo: 'DETAL', 
        clase: 'text-gray-600'
    };
}

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

    timeoutProdsMasa = setTimeout(() => {
        // Buscamos sobre la lista maestra cargada en la memoria para velocidad instantánea
        // (Asegúrate de cambiar 'todosLosProductos' por el nombre de tu array global en inventario si cambia)
        const filtrados = todosLosProductos.filter(p => p.nombre.toUpperCase().includes(texto));

        if (filtrados.length === 0) {
            dropdown.innerHTML = '<div class="p-3 text-[10px] text-neutral-400 font-bold uppercase text-center">No se encontraron productos</div>';
        } else {
            dropdown.innerHTML = filtrados.map(p => `
                <div onclick="seleccionarProdMasaDropdown(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${p.stock_unidades})" class="p-3 border-b border-neutral-100 hover:bg-neutral-100 cursor-pointer flex justify-between items-center transition-colors">
                    <span class="text-xs font-black text-neutral-950 uppercase tracking-wider">${p.nombre}</span>
                    <span class="text-[9px] font-mono bg-neutral-100 border text-neutral-600 px-2 py-0.5 rounded">Depósito: ${parseFloat(p.stock_unidades).toFixed(0)} u.</span>
                </div>
            `).join('');
        }
        dropdown.classList.remove('hidden');
    }, 300);
};

window.seleccionarProdMasaDropdown = function(id, nombre, stockUnidades) {
    document.getElementById('idProdMasaSeleccionado').value = id;
    document.getElementById('inputBuscarProdMasa').value = nombre;
    document.getElementById('dropdownProdsMasa').classList.add('hidden');
    document.getElementById('cantBotellasMasa').placeholder = `Máx: ${stockUnidades}`;
    document.getElementById('cantBotellasMasa').focus();
};

async function procesarBajarMercanciaMasa() {
    const idProducto = document.getElementById('idProdMasaSeleccionado').value;
    const cantidad = document.getElementById('cantBotellasMasa').value;
    const destino = document.getElementById('destinoEstanteMasa').value;
    const fila = document.getElementById('pisoEstanteMasa').value;

    if (!idProducto) return Swal.fire('Atención', 'Por favor selecciona un producto usando el buscador.', 'warning');
    if (!cantidad || parseInt(cantidad, 10) <= 0) return Swal.fire('Error', 'Ingresa una cantidad válida de botellas.', 'error');

    try {
        Swal.fire({ title: 'Generando botellas y actualizando estantes...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        const token = localStorage.getItem('token');

        const res = await fetch('/api/ventas/inventario/bajar-estante-lote', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                producto_id: idProducto,
                cantidad_botellas: cantidad,
                destino: destino,
                fila: fila
            })
        });

        const data = await res.json();

        if (res.ok) {
            document.getElementById('modalBajarInventarioMasa').classList.add('hidden');
            await Swal.fire({ icon: 'success', title: '¡Traslado Consolidado!', text: data.mensaje, confirmButtonColor: '#0a0a0a' });
            
            // Si tienes una función de refrescar la grilla de tu inventario ejecútala aquí
            if (typeof init === 'function') init(); 
        } else {
            Swal.fire('No se pudo procesar', data.error, 'error');
        }
    } catch (e) {
        Swal.fire('Error', 'Fallo de conexión con el servidor', 'error');
    }
}


window.eliminarDelCarrito = eliminarDelCarrito; 
window.abrirModalCobro = abrirModalCobro;
window.setMoneda = setMoneda;
window.procesarVenta = abrirModalCobro; 
window.limpiarCarrito = limpiarCarrito;
window.abrirModalCliente = function() { document.getElementById('modalCliente').classList.remove('hidden'); };
window.cerrarModalCliente = function() { document.getElementById('modalCliente').classList.add('hidden'); };
window.cerrarModalCobro = function() { document.getElementById('modalCobro').classList.add('hidden'); };
window.finalizarVentaBackend = finalizarVentaBackend;