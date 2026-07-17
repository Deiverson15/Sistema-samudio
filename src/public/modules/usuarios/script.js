import { UsuarioService } from '../../js/api.js';

let usuariosGlobales = [];
let cacheTiendasListaHTML = '';

export async function init() {
    console.log("Cargando Gestión de Usuarios Corporativos Multi-Tienda...");
    
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // 1. Cargas Iniciales Seguras
    await cargarTiendasSelect(); 
    await cargarUsuarios();

    // 2. Escuchar sockets en tiempo real para el estado online
    if (window.socket) {
        window.socket.on('usuarios-online', (idsOnline) => {
            console.log("Stream Socket: Personal Online ->", idsOnline);
            cargarUsuarios(idsOnline);
        });
    }

    // 3. Formulario de Registro
    const form = document.getElementById('formUsuario');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const nuevoUsuario = {
                nombre: document.getElementById('nombreUser').value,
                rol: document.getElementById('rolUser').value,
                email: document.getElementById('emailUser').value,
                password: document.getElementById('passUser').value,
                direccion: document.getElementById('direccionUser').value,
                tienda_id: document.getElementById('usuarioTienda').value 
            };

            try {
                await UsuarioService.create(nuevoUsuario);
                
                Swal.fire({
                    icon: 'success',
                    title: 'USUARIO ASIGNADO',
                    text: 'El perfil de acceso fue guardado y amarrado a la sucursal correctamente.',
                    confirmButtonColor: '#0a0a0a',
                    customClass: { popup: 'rounded-none' }
                });

                form.reset();
                cargarUsuarios(); 
            } catch (error) {
                Swal.fire('Error', error.message || 'No se pudo registrar', 'error');
            }
        });
    }

    // 4. Exponer funciones al árbol de window
    window.toggleUsuario = toggleUsuario;
    window.verActividad = verActividad;
    window.eliminarUsuario = eliminarUsuario;
}

// ==========================================
// 🏢 FUNCIÓN: CARGAR TIENDAS EN EL SELECT
// ==========================================
async function cargarTiendasSelect() {
    try {
        const select = document.getElementById('usuarioTienda');
        if (!select) return;

        const token = localStorage.getItem('token');
        const res = await fetch('/api/tiendas', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error();
        const tiendas = await res.json();
        
        let htmlOpciones = '<option value="">-- SELECCIONE UNA SEDE --</option>';
        tiendas.forEach(t => {
            if (t.activo !== false) {
                htmlOpciones += `<option value="${t.id}">${t.nombre.toUpperCase()} ${t.es_principal ? '(PRINCIPAL)' : ''}</option>`;
            }
        });

        select.innerHTML = htmlOpciones;
        cacheTiendasListaHTML = htmlOpciones; // 💾 Salvaguardamos para el modal de edición

    } catch (error) {
        console.warn("Error jaloneando sedes de base de datos.");
        if(document.getElementById('usuarioTienda')) document.getElementById('usuarioTienda').innerHTML = '<option value="">Error cargando tiendas</option>';
    }
}

// ==========================================
// 👥 FUNCIÓN: CARGAR USUARIOS EN TABLA
// ==========================================
async function cargarUsuarios(idsOnline = []) {
    const tbody = document.getElementById('tablaUsuarios');
    const badgeTotal = document.getElementById('totalUsersBadge');
    
    if(idsOnline.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-8 font-mono text-xs text-neutral-400 uppercase"><i class="fa-solid fa-circle-notch fa-spin text-neutral-950 mr-2"></i> Escaneando nómina de personal...</td></tr>';
    }

    try {
        const usuarios = await UsuarioService.getAll();
        usuariosGlobales = usuarios; // Sincronizamos caché global

        if (usuarios.error) throw new Error(usuarios.error);
        
        tbody.innerHTML = '';
        if(badgeTotal) badgeTotal.innerText = `${usuarios.length} Usuarios`;

        if (usuarios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center p-6 text-xs font-bold uppercase text-neutral-400 bg-neutral-50">No hay cuentas registradas.</td></tr>';
            return;
        }

        tbody.innerHTML = usuarios.map(u => {
            const estaEnLinea = idsOnline.includes(String(u.id)) || idsOnline.includes(u.id) || u.en_linea;

            const estadoClass = u.activo ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200';
            const estadoText = u.activo ? 'ACTIVO' : 'INACTIVO';
            const btnIcon = u.activo ? 'fa-toggle-on' : 'fa-toggle-off';
            const btnColor = u.activo ? 'text-neutral-950' : 'text-neutral-300';

            const tiendaBadge = u.tienda_nombre 
                ? `<span class="inline-flex items-center gap-1 bg-neutral-100 text-neutral-800 text-[10px] font-black px-2 py-0.5 border border-neutral-300 uppercase">${u.tienda_nombre}</span>`
                : `<span class="text-neutral-400 text-xs italic font-bold uppercase">Sin Asignar</span>`;

            return `
                <tr class="hover:bg-neutral-50/50 border-b border-neutral-200 transition group font-sans">
                    <td class="p-4 px-6">
                        <div class="font-black text-neutral-950 text-xs uppercase tracking-wide">${escapeHtml(u.nombre)}</div>
                        <div class="text-[10px] text-neutral-400 font-mono font-bold lowercase mt-0.5">${escapeHtml(u.email)}</div>
                    </td>
                    <td class="p-4 text-center">
                        <span class="px-2 py-0.5 text-[9px] font-black uppercase bg-neutral-950 text-white tracking-widest">${escapeHtml(u.rol)}</span>
                    </td>
                    <td class="p-4 text-center">${tiendaBadge}</td>
                    <td class="p-4 text-center">
                        <span class="px-2 py-0.5 text-[9px] font-black border ${estadoClass}">${estadoText}</span>
                    </td>
                    <td class="p-4 text-center">
                         <span class="text-[10px] uppercase font-black ${estaEnLinea ? 'text-emerald-600' : 'text-neutral-300'}">
                            ${estaEnLinea ? '● online' : '○ offline'}
                         </span>
                    </td>
                    <td class="p-4 px-6 text-right font-sans">
                        <div class="flex justify-end gap-1">
                            <button onclick="toggleUsuario(${u.id}, ${u.activo})" class="p-2 text-neutral-400 hover:${btnColor} transition cursor-pointer" title="Alternar Estado"><i class="fa-solid ${btnIcon} text-lg"></i></button>
                            <button onclick="prepararEdicionUsuario(${u.id})" class="p-2 text-neutral-400 hover:text-amber-600 transition cursor-pointer" title="Editar Personal"><i class="fa-solid fa-user-pen text-sm"></i></button>
                            <button onclick="verActividad(${u.id}, '${u.nombre.replace(/'/g, "\\'")}')" class="p-2 text-neutral-400 hover:text-blue-600 transition cursor-pointer" title="Auditar Terminal Lateral"><i class="fa-solid fa-terminal text-sm"></i></button>
                            <button onclick="eliminarUsuario(${u.id}, '${u.nombre.replace(/'/g, "\\'")}')" class="p-2 text-neutral-400 hover:text-red-600 transition cursor-pointer" title="Destruir Cuenta"><i class="fa-solid fa-trash-can text-sm"></i></button>
                        </div>
                    </td>
                </tr>`;
        }).join('');

    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-red-500 font-bold text-xs uppercase bg-red-50">⚠️ Fallo crítico en el enlace de personal: ${error.message}</td></tr>`;
    }
}

async function toggleUsuario(id, estadoActual) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/usuarios/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ activo: !estadoActual })
        });

        if (!res.ok) throw new Error((await res.json()).error);
        await cargarUsuarios();

        Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500, icon: 'success', title: `Acceso modificado con éxito` });
    } catch (e) { Swal.fire('Error', e.message, 'error'); }
}

async function verActividad(id, nombreUsuario) {
    const container = document.getElementById('listaActividadUsuario');
    const targetBadge = document.getElementById('monitorTarget');
    if (!container) return;

    if (targetBadge) targetBadge.innerText = nombreUsuario.toUpperCase();

    container.innerHTML = `<div class="text-neutral-500 text-center font-mono text-[9px] uppercase mt-12 font-bold"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-neutral-900"></i> Descargando logs del operador...</div>`;

    try {
        const logs = await UsuarioService.getActividad(id);
        
        if (!Array.isArray(logs) || logs.length === 0) {
            container.innerHTML = `<div class="text-neutral-400 text-center font-mono text-[9px] uppercase mt-12 font-bold"><i class="fa-solid fa-folder-open text-xl opacity-30 mb-2 block text-center w-full"></i> Sin operaciones recientes en este turno.</div>`;
            return;
        }

        // Renderizado instantáneo de un solo golpe al DOM de la consola lateral
        container.innerHTML = logs.map(l => {
            let icon = 'fa-terminal';
            let color = 'text-neutral-500';

            const acc = l.accion.toUpperCase();
            if (acc.includes('LOGIN')) { icon = 'fa-right-to-bracket'; color = 'text-emerald-400'; }
            else if (acc.includes('ERROR') || acc.includes('FAIL')) { icon = 'fa-circle-xmark'; color = 'text-red-500'; }
            else if (acc.includes('CREAR')) { icon = 'fa-square-plus'; color = 'text-blue-400'; }
            else if (acc.includes('EDITAR')) { icon = 'fa-user-pen'; color = 'text-amber-500'; }
            else if (acc.includes('ELIMINAR')) { icon = 'fa-circle-exclamation'; color = 'text-red-600'; }

            return `
                <div class="p-3 bg-neutral-900 border border-neutral-800 rounded-none font-mono text-[9px] uppercase text-neutral-400 tracking-wider">
                    <div class="flex gap-2 items-start">
                        <span class="mt-0.5"><i class="fa-solid ${icon} ${color}"></i></span>
                        <div class="w-full">
                            <p class="font-black text-neutral-200 tracking-wide">${escapeHtml(l.accion)}</p>
                            <p class="text-neutral-400 leading-normal lowercase select-text mt-1">${escapeHtml(l.detalle)}</p>
                            <span class="text-[8px] text-neutral-600 block border-t border-neutral-800 pt-1.5 mt-1.5 font-sans font-bold">${new Date(l.fecha).toLocaleString('es-VE')}</span>
                        </div>
                    </div>
                </div>`;
        }).join('');

    } catch (e) {
        container.innerHTML = `<div class="text-red-500 font-mono text-[9px] p-4 border border-red-900/50 bg-red-950/20 uppercase">Fallo de stream de auditoría lateral.</div>`;
    }
}


async function eliminarUsuario(id, nombre, force = false) {
    let titulo = force ? '⚠️ ¿DESTRUIR REGISTRO FÍSICO?' : '¿ELIMINAR ACCESO?';
    let htmlContent = force 
        ? `<div class="text-left text-xs font-mono uppercase leading-normal p-4 bg-red-950/20 border border-red-900/60 text-red-400 rounded-none">
             El operador <b>${nombre}</b> tiene amarres históricos comerciales en el libro diario. Si destruyes la cuenta se desvincularán de su ID para siempre. ¿Ejecutar purga?
           </div>`
        : `Estás por remover permanentemente la credencial de: <b class="uppercase">${nombre}</b>.`;

    const confirmacion = await Swal.fire({
        title: titulo, html: htmlContent, icon: force ? 'error' : 'warning',
        showCancelButton: true, confirmButtonColor: force ? '#dc2626' : '#0a0a0a', cancelButtonColor: '#94a3b8',
        confirmButtonText: force ? 'EJECUTAR PURGA' : 'SÍ, REMOVER', cancelButtonText: 'CANCELAR',
        customClass: { popup: 'rounded-none border border-neutral-400', confirmButton: 'rounded-none text-[10px] tracking-widest', cancelButton: 'rounded-none text-[10px] tracking-widest' }
    });

    if (confirmacion.isConfirmed) {
        try {
            const token = localStorage.getItem('token');
            const url = force ? `/api/usuarios/${id}?force=true` : `/api/usuarios/${id}`;
            const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (res.ok) {
                Swal.fire({ icon: 'success', title: 'OPERACIÓN CONSOLIDADA', text: data.mensaje, timer: 1500, showConfirmButton: false, confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
                cargarUsuarios(); 
            } else if (data.error === 'tiene_historial') {
                eliminarUsuario(id, nombre, true); // Relanzar en cascada modo forzado
            } else { throw new Error(data.error); }
        } catch (error) { Swal.fire('Error', error.message, 'error'); }
    }
}

window.prepararEdicion = (id) => {
    const prod = productosGlobales.find(p => p.id === id);
    if(!prod) return;

    abrirModalCrear(); 

    document.getElementById('modalTitulo').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Producto';
    const btn = document.getElementById('btnGuardar');
    if(btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i> <span>Actualizar Datos</span>';

    document.getElementById('producto_id_edicion').value = prod.id;
    document.getElementById('codigo').value = prod.codigo;
    document.getElementById('nombre').value = prod.nombre;
    document.getElementById('marca').value = prod.marca;
    
    document.getElementById('costo').value = prod.costo || '';
    document.getElementById('precio_venta').value = prod.precio_venta || '';
    document.getElementById('stock_minimo').value = prod.stock_minimo || 5;

    const selectCat = document.getElementById('categoria');
    selectCat.value = prod.categoria || 'Otros';
    
    // 🔥 PRECARGA DEL GÉNERO
    const selectGen = document.getElementById('genero');
    if(selectGen) selectGen.value = prod.genero || 'UNISEX';
    
    if (typeof actualizarFormularioPorCategoria === 'function') {
        actualizarFormularioPorCategoria(prod.categoria);
    }

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

window.cerrarModalEditarUsuario = () => {
    document.getElementById('modalEditarUsuario').classList.add('hidden');
};

window.cerrarModalEditarUsuario = () => {
    document.getElementById('modalEditarUsuario').classList.add('hidden');
};

window.guardarEdicionUsuario = async () => {
    const id = document.getElementById('editUserId').value;
    const payload = {
        nombre: document.getElementById('editNombre').value,
        email: document.getElementById('editEmail').value,
        rol: document.getElementById('editRol').value,
        direccion: document.getElementById('editDireccion').value,
        tienda_id: document.getElementById('editTienda').value || null,
        password: document.getElementById('editPassword').value // Enviamos contraseña opcional
    };

    try {
        Swal.fire({ title: 'Actualizando núcleo de credenciales...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        const token = localStorage.getItem('token');
        
        const res = await fetch(`/api/usuarios/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        Swal.fire({ icon: 'success', title: 'PERFIL ACTUALIZADO', text: 'Los cambios de rango y claves se aplicaron con éxito.', confirmButtonColor: '#0a0a0a', customClass: { popup: 'rounded-none' } });
        cerrarModalEditarUsuario();
        cargarUsuarios(); 
    } catch (error) { Swal.fire('Error', error.message, 'error'); }
};