import { UsuarioService } from '../../js/api.js';

let usuariosGlobales = [];

export async function init() {
    console.log("Cargando Gestión de Usuarios...");
    
    // 1. Verificación de Seguridad
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // 2. Cargas Iniciales
    await cargarUsuarios();
    await cargarTiendasSelect(); // Cargar lista de sucursales

    // --- NUEVO: Escuchar usuarios en línea en tiempo real ---
    if (window.socket) {
        window.socket.on('usuarios-online', (idsOnline) => {
            console.log("Actualizando lista de usuarios online:", idsOnline);
            // Recargamos la tabla pasando la lista de IDs activos
            cargarUsuarios(idsOnline);
        });
    }

    // 3. Listener del Formulario de Registro
    const form = document.getElementById('formUsuario');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Recopilar datos, incluyendo la tienda seleccionada
            const nuevoUsuario = {
                nombre: document.getElementById('nombreUser').value,
                rol: document.getElementById('rolUser').value,
                email: document.getElementById('emailUser').value,
                password: document.getElementById('passUser').value,
                direccion: document.getElementById('direccionUser').value,
                tienda_id: document.getElementById('usuarioTienda').value 
            };

            try {
                // Enviamos al backend
                await UsuarioService.create(nuevoUsuario);
                
                Swal.fire({
                    icon: 'success',
                    title: 'Usuario registrado',
                    text: 'El usuario ha sido creado y asignado a la tienda correctamente.',
                    timer: 2000,
                    showConfirmButton: false
                });

                form.reset();
                cargarUsuarios(); // Recargar la tabla para ver el cambio
            } catch (error) {
                console.error(error);
                Swal.fire('Error', error.message || 'No se pudo crear el usuario', 'error');
            }
        });
    }

    // 4. Exponer funciones globales para los botones de la tabla
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

        // Solicitud con Token de seguridad incluido
        const token = localStorage.getItem('token');
        const res = await fetch('/api/tiendas', {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            }
        });
        
        if (!res.ok) throw new Error('Error al obtener tiendas');
        
        const tiendas = await res.json();
        
        // Limpiar y poner opción por defecto
        select.innerHTML = '<option value="">-- Seleccione una Sede --</option>';
        
        tiendas.forEach(t => {
            // CORRECCIÓN: Mostramos todas las tiendas a menos que estén explícitamente en "false"
            if (t.activo !== false) {
                const option = document.createElement('option');
                option.value = t.id;
                option.textContent = `${t.nombre} ${t.es_principal ? '(Principal)' : ''}`;
                select.appendChild(option);
            }
        });

    } catch (error) {
        console.warn("No se pudieron cargar las tiendas:", error);
        const select = document.getElementById('usuarioTienda');
        if(select) select.innerHTML = '<option value="">Error cargando tiendas</option>';
    }
}

// ==========================================
// 👥 FUNCIÓN: CARGAR USUARIOS EN TABLA
// ==========================================
async function cargarUsuarios(idsOnline = []) {
    const tbody = document.getElementById('tablaUsuarios');
    const badgeTotal = document.getElementById('totalUsersBadge');
    
    // Si no estamos actualizando solo los online, mostramos el spinner
    if(idsOnline.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4"><i class="fa-solid fa-spinner fa-spin text-blue-500"></i> Cargando personal...</td></tr>';
    }

    try {
        const usuarios = await UsuarioService.getAll();

        // NUEVA LÍNEA: Guardamos los usuarios globalmente para poder editarlos en el modal
        usuariosGlobales = usuarios;

        if (usuarios.error) throw new Error(usuarios.error);
        if (!Array.isArray(usuarios)) throw new Error("Formato de respuesta inválido");

        tbody.innerHTML = '';
        if(badgeTotal) badgeTotal.innerText = `${usuarios.length} Usuarios`;

        if (usuarios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-gray-500">No hay usuarios registrados.</td></tr>';
            return;
        }

        usuarios.forEach(u => {
            // Verificamos si el ID del usuario está en la lista de los que están en línea enviada por el socket
            const estaEnLinea = idsOnline.includes(String(u.id)) || idsOnline.includes(u.id);

            // Estilos dinámicos según estado
            const estadoClass = u.activo 
                ? 'bg-green-100 text-green-700 border-green-200' 
                : 'bg-red-100 text-red-700 border-red-200';
            
            const estadoText = u.activo ? 'ACTIVO' : 'INACTIVO';
            const btnIcon = u.activo ? 'fa-toggle-on' : 'fa-toggle-off';
            const btnColor = u.activo ? 'text-green-600' : 'text-gray-400';

            // Badge de Tienda
            const tiendaBadge = u.tienda_nombre 
                ? `<span class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded border border-indigo-100">
                     <i class="fa-solid fa-store text-[10px]"></i> ${u.tienda_nombre}
                   </span>`
                : `<span class="text-gray-400 text-xs italic">Sin Asignar</span>`;

            // Construir fila
            const row = `
                <tr class="hover:bg-gray-50 border-b border-gray-100 transition group">
                    <td class="px-4 py-3">
                        <div class="font-bold text-gray-700">${u.nombre}</div>
                        <div class="text-xs text-gray-400">${u.email}</div>
                    </td>
                    
                    <td class="px-4 py-3 text-center">
                        <span class="px-2 py-1 rounded text-[10px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-100">
                            ${u.rol}
                        </span>
                    </td>

                    <td class="px-4 py-3 text-center">
                        ${tiendaBadge}
                    </td>

                    <td class="px-4 py-3 text-center">
                        <span class="px-2 py-1 rounded text-[10px] font-bold border ${estadoClass}">
                            ${estadoText}
                        </span>
                    </td>

                    <td class="px-4 py-3 text-center">
                         <span class="text-xs ${estaEnLinea ? 'text-green-500 font-bold' : 'text-gray-300'}">
                            ${estaEnLinea ? '● En Línea' : '○ Desconectado'}
                         </span>
                    </td>

                    <td class="px-4 py-3 text-center flex justify-center gap-2 opacity-100 lg:opacity-60 group-hover:opacity-100 transition">
                        <button onclick="toggleUsuario(${u.id}, ${u.activo})" 
                            class="p-2 rounded hover:bg-gray-100 ${btnColor} transition" 
                            title="${u.activo ? 'Desactivar acceso' : 'Activar acceso'}">
                            <i class="fa-solid ${btnIcon} text-lg"></i>
                        </button>
                        
                        <button onclick="prepararEdicionUsuario(${u.id})" 
                            class="p-2 rounded hover:bg-amber-50 text-gray-400 hover:text-amber-500 transition"
                            title="Editar datos del usuario">
                            <i class="fa-solid fa-pen"></i>
                        </button>

                        <button onclick="verActividad(${u.id})" 
                            class="p-2 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition"
                            title="Ver Historial">
                            <i class="fa-solid fa-clock-rotate-left"></i>
                        </button>

                        <button onclick="eliminarUsuario(${u.id}, '${u.nombre}')" 
                            class="p-2 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition"
                            title="Eliminar usuario permanentemente">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

    } catch (error) {
        console.error("Error al cargar usuarios:", error);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center p-4 text-red-500 bg-red-50">
                    <i class="fa-solid fa-triangle-exclamation"></i> 
                    <b>Error de conexión:</b> ${error.message}
                </td>
            </tr>`;
        
        if (error.message.includes('Token') || error.message.includes('Acceso')) {
            setTimeout(() => window.location.href = '/login.html', 2000);
        }
    }
}

async function toggleUsuario(id, estadoActual) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/usuarios/${id}/estado`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ activo: !estadoActual })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error);
        }

        await cargarUsuarios();
        
        // Notificación discreta
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
        });
        Toast.fire({
            icon: 'success',
            title: `Acceso ${!estadoActual ? 'habilitado' : 'deshabilitado'}`
        });

    } catch (e) {
        Swal.fire('Error', e.message, 'error');
    }
}

async function verActividad(id) {
    try {
        const logs = await UsuarioService.getActividad(id);
        
        if(!Array.isArray(logs)) throw new Error("Error al obtener logs");

        if(logs.length === 0) return Swal.fire('Sin registros', 'Este usuario no tiene actividad reciente.', 'info');
        
        let html = '<ul class="text-left text-sm text-gray-600 space-y-3 max-h-60 overflow-y-auto px-2">';
        logs.forEach(l => {
            // Iconos según acción
            let icon = '<i class="fa-solid fa-circle-info text-gray-400"></i>';
            if(l.accion.includes('LOGIN')) icon = '<i class="fa-solid fa-right-to-bracket text-green-500"></i>';
            if(l.accion.includes('ERROR') || l.accion.includes('DENEGADO')) icon = '<i class="fa-solid fa-triangle-exclamation text-red-500"></i>';
            if(l.accion.includes('CREAR')) icon = '<i class="fa-solid fa-plus text-blue-500"></i>';

            html += `
                <li class="border-b border-gray-100 pb-2 last:border-0">
                    <div class="flex gap-2 items-start">
                        <span class="mt-1">${icon}</span>
                        <div>
                            <p class="font-semibold text-gray-800">${l.accion}</p>
                            <p class="text-xs text-gray-500">${l.detalle}</p>
                            <span class="text-[10px] text-gray-400 block mt-1">${new Date(l.fecha).toLocaleString()}</span>
                        </div>
                    </div>
                </li>`;
        });
        html += '</ul>';

        Swal.fire({
            title: 'Historial de Actividad',
            html: html,
            width: 500,
            showCloseButton: true,
            confirmButtonText: 'Cerrar'
        });
    } catch (e) {
        Swal.fire('Error', 'No se pudo cargar el historial', 'error');
    }
}

async function eliminarUsuario(id, nombre, force = false) {
    // Textos y colores dinámicos: Normal vs Forzar
    let titulo = force ? '⚠️ ¿FORZAR ELIMINACIÓN?' : '¿Eliminar usuario?';
    let textoHtml = force 
        ? `<div class="text-left text-sm space-y-3">
             <p>El usuario <b>${nombre}</b> tiene historial de movimientos en el sistema.</p>
             <p class="text-red-600 font-bold p-3 bg-red-50 border border-red-200 rounded">
                Si forzamos su eliminación, su cuenta será destruida por completo y se desvincularán sus registros para siempre.
             </p>
             <p class="font-black text-center text-neutral-900 mt-2">¿Estás completamente seguro de proceder?</p>
           </div>`
        : `Estás a punto de eliminar a <b>${nombre}</b>.<br><span class="text-sm text-gray-500">Esta acción es irreversible.</span>`;
    
    let icono = force ? 'error' : 'warning';
    
    const confirmacion = await Swal.fire({
        title: titulo,
        html: textoHtml,
        icon: icono,
        showCancelButton: true,
        confirmButtonColor: force ? '#dc2626' : '#1e293b', // Rojo fuerte si es para forzar
        cancelButtonColor: '#94a3b8', 
        cancelButtonText: 'Cancelar',
        confirmButtonText: force ? 'Sí, destruir cuenta' : 'Sí, eliminar'
    });

    if (confirmacion.isConfirmed) {
        try {
            const token = localStorage.getItem('token');
            // Si force es true, le decimos al backend que pase por alto la seguridad
            const url = force ? `/api/usuarios/${id}?force=true` : `/api/usuarios/${id}`;
            
            const res = await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await res.json();

            if (res.ok) {
                Swal.fire({
                    title: '¡Eliminado!', 
                    text: data.mensaje, 
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });
                cargarUsuarios(); // Refresca la tabla
            } else {
                // Si el backend avisa que tiene historial, REPETIMOS la función pero con FORCE en true
                if (data.error === 'tiene_historial') {
                    eliminarUsuario(id, nombre, true);
                } else {
                    Swal.fire('No se pudo eliminar', data.error || data.mensaje, 'warning');
                }
            }
        } catch (error) {
            Swal.fire('Error', 'No se pudo procesar la solicitud', 'error');
        }
    }
}

// ==========================================
// 📝 LÓGICA DE EDICIÓN DE USUARIO
// ==========================================
window.prepararEdicionUsuario = async (id) => {
    const usuario = usuariosGlobales.find(u => u.id === id);
    if (!usuario) return;

    // Llenar el select de tiendas del modal con la misma info del select principal
    const selectTiendaMain = document.getElementById('usuarioTienda');
    const selectTiendaEdit = document.getElementById('editTienda');
    selectTiendaEdit.innerHTML = selectTiendaMain.innerHTML;

    // Asignar los valores del usuario a los inputs
    document.getElementById('editUserId').value = usuario.id;
    document.getElementById('editNombre').value = usuario.nombre;
    document.getElementById('editEmail').value = usuario.email;
    document.getElementById('editRol').value = usuario.rol;
    document.getElementById('editDireccion').value = usuario.direccion || '';
    document.getElementById('editTienda').value = usuario.tienda_id || '';

    // Mostrar modal
    document.getElementById('modalEditarUsuario').classList.remove('hidden');
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
        tienda_id: document.getElementById('editTienda').value || null
    };

    try {
        Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });
        const token = localStorage.getItem('token');
        
        const res = await fetch(`/api/usuarios/${id}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al actualizar');

        Swal.fire('¡Actualizado!', 'Los datos del usuario fueron modificados correctamente.', 'success');
        cerrarModalEditarUsuario();
        cargarUsuarios(); // Refrescamos la tabla
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
};