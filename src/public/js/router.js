document.addEventListener('DOMContentLoaded', () => {
    

    // ==========================================
// 5. MOTOR GLOBAL DE REPORTES (Delegación)
// ==========================================
document.addEventListener('click', async (e) => {
    // Detectamos si el clic ocurrió en una tarjeta de reporte
    const card = e.target.closest('.reporte-card');
    
    if (card) {
        const tipo = card.getAttribute('data-tipo');
        if (tipo) {
            await window.descargarExcel(tipo);
        }
    }
});


// En tu router.js, actualiza esta lógica:
window.abrirModalReporte = function(tipo) {
    currentReport = tipo; // Guardamos el tipo globalmente
    const modal = document.getElementById('reportModal');
    
    // Si el reporte es 'tiendas', podrías mostrar un selector de tienda también
    // Si es 'kardex', quizás solo necesites fecha inicio.
    
    modal.classList.remove('hidden');
};

// Y en tu ejecutarDescarga:
async function ejecutarDescarga() {
    const start = document.getElementById('inputStart').value;
    const end = document.getElementById('inputEnd').value;
    
    // Construimos la URL con los parámetros de fecha
    let url = `/api/ventas/exportar/excel?filtro=${currentReport}`;
    if(start) url += `&start=${start}`;
    if(end) url += `&end=${end}`;
    
    // Llamamos a la función de descarga que ya tenemos
    window.descargarExcel(currentReport, url); 
    closeModal();
}

// Definimos la función de forma global para que sea accesible siempre
window.descargarExcel = async (tipo) => {
    const token = localStorage.getItem('token');
    if (!token) return window.location.href = '/login.html';

    Swal.fire({
        title: 'GENERANDO...',
        text: 'Compilando archivo...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const response = await fetch(`/api/ventas/exportar/excel?filtro=${tipo}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Error al conectar con el servidor');
        }

        const blob = await response.blob();
        Swal.close();

        // Trigger descarga
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_${tipo.toUpperCase()}_${new Date().toISOString().slice(0,10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        
    } catch (error) {
        Swal.close();
        Swal.fire({ icon: 'error', title: 'ERROR', text: error.message });
        console.error("Error en descarga:", error);
    }
};


let currentReport = '';

function openModal(tipo) {
    currentReport = tipo;
    const modal = document.getElementById('reportModal');
    const title = document.getElementById('modalTitle');
    
    // Configuración dinámica según el reporte
    document.getElementById('dateFilterStart').classList.remove('hidden');
    document.getElementById('dateFilterEnd').classList.remove('hidden');
    
    title.innerText = `Reporte: ${tipo.toUpperCase()}`;
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('reportModal').classList.add('hidden');
}

async function ejecutarDescarga() {
    const start = document.getElementById('inputStart').value;
    const end = document.getElementById('inputEnd').value;
    
    // Aquí validamos si el reporte necesita fechas obligatorias
    if (!start || !end) {
        Swal.fire({ icon: 'warning', text: 'Por favor, selecciona el rango de fechas' });
        return;
    }

    const url = `/api/ventas/exportar/excel?filtro=${currentReport}&start=${start}&end=${end}`;
    window.descargarExcel(currentReport, url); // Reutilizamos tu función de descarga
    closeModal();
}

    // ==========================================
    // 🔒 1. ZONA DE SEGURIDAD (LOGIN CHECK)
    // ==========================================
    const token = localStorage.getItem('token');
    
    // Si no hay token, redirigir al login inmediatamente
    if (!token) {
        window.location.href = '/login.html';
        return; // Detener ejecución del script
    }

    // ==========================================
    // 👤 2. PERSONALIZACIÓN DE USUARIO Y ROLES
    // ==========================================
// ==========================================
    // 👤 2. PERSONALIZACIÓN DE USUARIO, ROLES Y TIENDA
    // ==========================================
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario'));
        
        if (usuario) {
            // A. Personalizar Nombre, Rol y Avatar en el Sidebar
            const avatarLetra = document.getElementById('avatarLetra');
            const textoRol = document.getElementById('textoRol');
            
            if (avatarLetra && usuario.nombre) {
                avatarLetra.innerText = usuario.nombre.charAt(0).toUpperCase();
            }
            
            if (textoRol) {
                // Mostrar el Rol Real y el Primer Nombre
                const rolMostrar = usuario.rol === 'superadmin' ? 'S. Admin' : usuario.rol;
                textoRol.innerText = `${rolMostrar} | ${usuario.nombre.split(' ')[0]}`; 
            }

            // B. PERSONALIZAR LA SEDE/TIENDA EN EL ENCABEZADO
            const etiquetaSede = document.getElementById('nombreSedeActual');
            if (etiquetaSede) {
                // Sacamos el nombre de la tienda que viene en el login
                const nombreTienda = usuario.tienda_nombre || 'Sede Principal';
                etiquetaSede.innerText = nombreTienda;
                
                // Si la tienda existe, le damos un color más profesional (Púrpura/Slate)
                if (usuario.tienda_id) {
                    etiquetaSede.classList.remove('bg-neutral-900', 'border-neutral-800', 'text-neutral-400');
                    etiquetaSede.classList.add('bg-purple-900/30', 'border-purple-800', 'text-purple-300');
                    etiquetaSede.innerHTML = `<i class="fa-solid fa-store mr-1"></i> ${nombreTienda}`;
                }
            }

           const rol = usuario.rol; 
            
            // Lista de lo que se debe OCULTAR (Restricciones)
            const menusRestringidos = {
                vendedor: [
                    'menu-inventario', 'menu-estante', 'menu-preparacion', 
                    'menu-ventas', 'menu-compras', 'menu-proveedores', 
                    'menu-reportes', 'menu-usuarios', 'menu-ajustes', 
                    'menu-auditoria', 'menu-tiendas'
                ],
                gerente: [
                    'menu-usuarios', 
                    'menu-auditoria', 
                    'menu-tiendas'
                ],
                admin: [
                    'menu-tiendas' // El Admin ve usuarios, pero no administra tiendas
                ],     
                superadmin: [], // ¡El Superadmin ahora no tiene nada oculto!
                developer: []   // ¡El Developer no tiene nada oculto!
            };

            // 1. Primero ponemos todos los menús en "block" (visibles) para resetear
            const todosLosMenus = [
                'menu-dashboard', 'menu-inventario', 'menu-estante', 'menu-preparacion', 
                'menu-ventas', 'menu-compras', 'menu-proveedores', 'menu-reportes', 
                'menu-usuarios', 'menu-ajustes', 'menu-auditoria', 'menu-tiendas'
            ];
            
            todosLosMenus.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'block'; 
            });

            // 2. Ahora ocultamos solo los que pertenecen al rol actual
            const idsParaOcultar = menusRestringidos[rol] || [];
            idsParaOcultar.forEach(id => {
                const elemento = document.getElementById(id);
                if (elemento) elemento.style.display = 'none';
            });
            
            // Lógica especial y estricta para el Panel Developer
            const devMenu = document.getElementById('menu-developer');
            if (rol === 'developer') {
                if (devMenu) devMenu.style.display = 'block';
            } else {
                if (devMenu) devMenu.style.display = 'none';
            }
        }
    } catch (e) {
        console.error("Error al procesar permisos:", e);
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
        window.location.href = '/login.html';
    }


    // ==========================================
    // 🚪 3. LÓGICA DE CERRAR SESIÓN (LOGOUT)
    // ==========================================
    const botonesSalir = document.querySelectorAll('button');
    botonesSalir.forEach(btn => {
        // Detectamos el botón por su icono o texto
        if(btn.innerHTML.includes('fa-right-from-bracket') || btn.innerHTML.includes('Cerrar Sesión')) {
            btn.addEventListener('click', async () => {
                const result = await Swal.fire({
                    title: '¿Cerrar Sesión?',
                    text: "¿Desea salir del sistema?",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#d33',
                    confirmButtonText: 'Sí, cerrar sesión'
                });

                if(result.isConfirmed) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('usuario');
                    window.location.href = '/login.html';
                }
            });
        }
    });

    // ==========================================
    // 🧭 4. NAVEGACIÓN Y ENRUTAMIENTO
    // ==========================================
    
    // Manejar clics en el menú lateral (Links con clase .nav-link)
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault(); 
            const href = link.getAttribute('href');
            if(href && href !== '#') {
                cargarPagina(href);
            }
        });
    });

    // Cargar página inicial por defecto (Dashboard)
    // Opcional: Podrías leer la URL para ver si el usuario quería ir a una sección específica
    cargarPagina('dashboard');

    // Función global para navegación interna desde otros botones (ej: Dashboard)
    window.navegarA = (pagina) => cargarPagina(pagina);
});

async function cargarPagina(modulo) {
    const mainContent = document.getElementById('main-content');
    const pageTitle = document.getElementById('page-title');

    // 1. Actualizar estilos del menú (Resaltar activo)
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.remove('active-link', 'bg-slate-800', 'text-white');
        // Buscar el icono dentro para restaurar su color si es necesario (opcional)
    });
    
    // Buscar el link que corresponde al módulo actual para activarlo
    const activeLink = document.querySelector(`.nav-link[href="${modulo}"]`);
    if(activeLink) {
        activeLink.classList.add('active-link', 'bg-slate-800', 'text-white');
    }

    // 2. Cambiar Título del Header (Mapa de títulos)
    const titulos = {
        'dashboard': 'Resumen General',
        'inventario': 'Gestión de Inventario',
        'estante': '📦 Mi Estante (Piso 1)',
        'facturacion': 'Punto de Venta',
        'ventas': 'Historial de Transacciones',
        'reportes': 'Reportes y Métricas',
        'compras': 'Recepción de Mercancía',
        'auditoria': 'Control y Auditoría',
        'proveedores': 'Directorio de Proveedores',
        'ajustes': 'Ajustes de Inventario',
        'usuarios': 'Administración de Usuarios y Seguridad',
        'tiendas': 'Administración de Sucursales', // [NUEVO]
    };
    
    if (pageTitle) {
        pageTitle.innerText = titulos[modulo] || 'Sistema de Gestión';
    }

    // 3. Cargar HTML y JS del módulo
    try {
        // Spinner de carga mientras fetch trabaja
        mainContent.innerHTML = `
            <div class="flex h-full flex-col items-center justify-center text-blue-600 animate-fade-in">
                <i class="fa-solid fa-circle-notch fa-spin text-4xl mb-3"></i>
                <span class="text-sm font-semibold text-gray-400">Cargando sección...</span>
            </div>`;
        
        // Cargar HTML
        const response = await fetch(`modules/${modulo}/index.html`);
        
        if (!response.ok) {
            // NUEVO: Manejo de Sistema Bloqueado (Falta de pago)
            if (response.status === 402) {
                document.body.innerHTML = `
                    <div class="bg-slate-900 text-white h-screen w-screen flex flex-col justify-center items-center text-center p-10 fixed inset-0 z-50">
                        <i class="fa-solid fa-lock text-7xl mb-6 text-red-500 animate-pulse"></i>
                        <h1 class="text-5xl font-bold mb-4">SISTEMA SUSPENDIDO</h1>
                        <p class="text-xl text-slate-300 max-w-lg mb-8">El acceso a este software ha sido restringido. Por favor, póngase en contacto con el desarrollador para regularizar el estado de su licencia o mensualidad.</p>
                        <a href="/login.html" class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition">Volver al Inicio</a>
                    </div>`;
                return;
            } // Aquí faltaban las llaves de cierre correctas y el código de abajo
            
            // Manejo de errores específicos (Existente)
            if(response.status === 401 || response.status === 403) {
                Swal.fire('Sesión Expirada', 'Por favor ingresa nuevamente', 'warning')
                .then(() => {
                    localStorage.removeItem('token');
                    window.location.href = '/login.html';
                });
                return;
            }
            throw new Error(`Módulo "${modulo}" no encontrado o inaccesible.`);
        }

        
        const html = await response.text();
        mainContent.innerHTML = html;

        // Cargar JS del módulo dinámicamente (importación bajo demanda)
        try {
            // Cache busting simple usando timestamp para desarrollo (opcional)
            // const version = new Date().getTime(); 
            // const modulePath = `../modules/${modulo}/script.js?v=${version}`;
            
            const modulePath = `../modules/${modulo}/script.js`;
            const module = await import(modulePath);
            
            if (module.init) {
                await module.init(); 
            }
        } catch (jsError) {
            // Algunos módulos pueden ser solo HTML (sin script.js), no es un error crítico.
            // Solo logueamos si el error NO es que falta el archivo (ej: error de sintaxis en el JS)
            if (!jsError.message.includes('Failed to fetch dynamically imported module')) {
                console.error(`Error inicializando script de ${modulo}:`, jsError);
            }
        }

    } catch (error) {
        console.error(error);
        mainContent.innerHTML = `
            <div class="flex flex-col h-full items-center justify-center text-red-400 p-10">
                <i class="fa-solid fa-triangle-exclamation text-5xl mb-4"></i>
                <h3 class="text-lg font-bold text-gray-700">No se pudo cargar la sección</h3>
                <p class="text-sm text-gray-500 mt-2">${error.message}</p>
                <button onclick="cargarPagina('dashboard')" class="mt-6 bg-slate-900 text-white px-4 py-2 rounded shadow hover:bg-slate-800 transition">
                    Volver al Inicio
                </button>
            </div>`;
    }
}