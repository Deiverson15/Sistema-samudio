document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 🔒 1. ZONA DE SEGURIDAD (LOGIN CHECK)
    // ==========================================
    const token = localStorage.getItem('token');
    
    if (!token) {
        window.location.href = '/login.html';
        return; 
    }

    // ==========================================
    // 👤 2. PERSONALIZACIÓN DE USUARIO, ROLES Y TIENDA
    // ==========================================
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario'));
        
        if (usuario) {
            const avatarLetra = document.getElementById('avatarLetra');
            const textoRol = document.getElementById('textoRol');
            
            if (avatarLetra && usuario.nombre) {
                avatarLetra.innerText = usuario.nombre.charAt(0).toUpperCase();
            }
            
            if (textoRol) {
                const rolMostrar = usuario.rol === 'superadmin' ? 'S. Admin' : usuario.rol;
                textoRol.innerText = `${rolMostrar} | ${usuario.nombre.split(' ')[0]}`; 
            }

            const etiquetaSede = document.getElementById('nombreSedeActual');
            if (etiquetaSede) {
                const nombreTienda = usuario.tienda_nombre || 'Sede Principal';
                etiquetaSede.innerText = nombreTienda;
                
                if (usuario.tienda_id) {
                    etiquetaSede.classList.remove('bg-neutral-900', 'border-neutral-800', 'text-neutral-400');
                    etiquetaSede.classList.add('bg-purple-900/30', 'border-purple-800', 'text-purple-300');
                    etiquetaSede.innerHTML = `<i class="fa-solid fa-store mr-1"></i> ${nombreTienda}`;
                }
            }

           const rol = usuario.rol ? usuario.rol.toLowerCase().trim() : ''; 
const idTiendaActiva = parseInt(usuario.tienda_id, 10);

const menusRestringidos = {
    vendedor: [
        'menu-dashboard', 'menu-inventario', 'menu-preparacion', 
        'menu-compras', 'menu-proveedores', 'menu-reportes', 
        'menu-usuarios', 'menu-ajustes', 'menu-auditoria', 
        'menu-tiendas', 'menu-fabricacion'
    ],
    gerente: [
        'menu-usuarios', 
        'menu-auditoria', 
        'menu-tiendas'
    ],
    admin: ['menu-tiendas'],  
    superadmin: [], 
    developer: []   
};
            const todosLosMenus = [
    'menu-dashboard', 'menu-inventario', 'menu-estante', 'menu-preparacion', 
    'menu-ventas', 'menu-compras', 'menu-proveedores', 'menu-reportes', 
    'menu-usuarios', 'menu-ajustes', 'menu-auditoria', 'menu-tiendas', 'menu-fabricacion'
];
            
            todosLosMenus.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block'; 
});

            const idsParaOcultar = menusRestringidos[rol] || [];
idsParaOcultar.forEach(id => {
    const elemento = document.getElementById(id);
    if (elemento) elemento.style.display = 'none';
});

if (idTiendaActiva === 1) {
    const menuEstante = document.getElementById('menu-estante');
    if (menuEstante) menuEstante.style.display = 'none';
}
            
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
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault(); 
            const href = link.getAttribute('href');
            if(href && href !== '#') {
                cargarPagina(href);
            }
        });
    });

    cargarPagina('dashboard');
    window.navegarA = (pagina) => cargarPagina(pagina);
});

async function cargarPagina(modulo) {
    const mainContent = document.getElementById('main-content');
    const pageTitle = document.getElementById('page-title');

    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.remove('active-link', 'bg-slate-800', 'text-white');
    });
    
    const activeLink = document.querySelector(`.nav-link[href="${modulo}"]`);
    if(activeLink) {
        activeLink.classList.add('active-link', 'bg-slate-800', 'text-white');
    }

    const titulos = {
        'dashboard': 'Resumen General',
        'inventario': 'Gestión de Inventario',
        'estante': '📦 Mi Estante (Piso 1)',
        'fabricacion': 'Laboratorio y Producción',
        'facturacion': 'Punto de Venta',
        'ventas': 'Historial de Transacciones',
        'reportes': 'Reportes y Métricas',
        'compras': 'Recepción de Mercancía',
        'auditoria': 'Control y Auditoría',
        'proveedores': 'Directorio de Proveedores',
        'ajustes': 'Ajustes de Inventario',
        'usuarios': 'Administración de Usuarios y Seguridad',
        'tiendas': 'Administración de Sucursales',
    };
    
    if (pageTitle) {
        pageTitle.innerText = titulos[modulo] || 'Sistema de Gestión';
    }

    try {
        mainContent.innerHTML = `
            <div class="flex h-full flex-col items-center justify-center text-blue-600 animate-fade-in">
                <i class="fa-solid fa-circle-notch fa-spin text-4xl mb-3"></i>
                <span class="text-sm font-semibold text-gray-400">Cargando sección...</span>
            </div>`;
        
        const response = await fetch(`modules/${modulo}/index.html`);
        
        if (!response.ok) {
            if (response.status === 402) {
                document.body.innerHTML = `
                    <div class="bg-slate-900 text-white h-screen w-screen flex flex-col justify-center items-center text-center p-10 fixed inset-0 z-50">
                        <i class="fa-solid fa-lock text-7xl mb-6 text-red-500 animate-pulse"></i>
                        <h1 class="text-5xl font-bold mb-4">SISTEMA SUSPENDIDO</h1>
                        <p class="text-xl text-slate-300 max-w-lg mb-8">El acceso a este software ha sido restringido. Por favor, póngase en contacto con el desarrollador para regularizar el estado de su licencia o mensualidad.</p>
                        <a href="/login.html" class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition">Volver al Inicio</a>
                    </div>`;
                return;
            } 
            
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

        try {
            const modulePath = `../modules/${modulo}/script.js`;
            const module = await import(modulePath);
            
            if (module.init) {
                await module.init(); 
            }
        } catch (jsError) {
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

// Habilitar clic en la sede para usuarios Superadmin/Admin
const usuarioActual = JSON.parse(localStorage.getItem('usuario') || '{}');
const esAdministrador = ['superadmin', 'admin', 'developer'].includes(usuarioActual.rol?.toLowerCase());

if (esAdministrador) {
    const etiquetaSede = document.getElementById('nombreSedeActual');
    if (etiquetaSede) {
        etiquetaSede.classList.add('cursor-pointer', 'hover:border-white');
        etiquetaSede.title = "Haz clic para cambiar de sucursal";
        
        etiquetaSede.addEventListener('click', async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/tiendas', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const tiendas = await res.json();
                
                // Reutilizamos la función global de login.html si está cargada o abrimos el modal
                if (typeof abrirSelectorTiendas === 'function') {
                    abrirSelectorTiendas(tiendas);
                } else {
                    location.reload(); // Recarga limpia para refrescar contexto
                }
            } catch (e) {
                console.error("Error abriendo selector de tiendas:", e);
            }
        });
    }
}