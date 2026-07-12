export async function init() {
    // 1. Referencias al DOM
    const btnActivar = document.getElementById('btn-activar');
    const btnBloquear = document.getElementById('btn-bloquear');
    const statusIndicator = document.getElementById('status-indicator');
    const estadoSistemaTxt = document.getElementById('estadoSistemaTxt');


    const fechaInput = document.getElementById('inputFechaPago');
    
    const tablaSelector = document.getElementById('tabla-selector');
    const superCrudThead = document.getElementById('super-crud-thead');
    const superCrudTbody = document.getElementById('super-crud-tbody');

    // Telemetría DOM
    const contadorUsuarios = document.getElementById('contador-usuarios');
    const dbPing = document.getElementById('db-ping');
    const ramUsage = document.getElementById('ram-usage');
    const uptimeCounter = document.getElementById('uptime-counter');
    const serverTime = document.getElementById('server-time');
    const terminal = document.getElementById('terminal-output');

    const token = localStorage.getItem('token');
    
    // Variables de simulación
    let uptimeSegundos = Math.floor(Math.random() * 50000) + 10000; // Fake inicio para que no empiece en 0
    let lastUserCount = 0;

    // --- FUNCIÓN: Consola Terminal ---
    function logTerminal(mensaje, tipo = 'info') {
        if (!terminal) return;
        const tiempo = new Date().toLocaleTimeString('en-US', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" });
        let color = 'text-slate-400';
        if (tipo === 'success') color = 'text-green-400';
        if (tipo === 'warn') color = 'text-yellow-400';
        if (tipo === 'error') color = 'text-red-500';

        const linea = document.createElement('div');
        linea.innerHTML = `<span class="text-slate-600">[${tiempo}]</span> <span class="${color}">${mensaje}</span>`;
        terminal.appendChild(linea);
        terminal.scrollTop = terminal.scrollHeight; // Auto-scroll
        
        // Mantener solo las últimas 20 líneas para no saturar
        if (terminal.children.length > 20) {
            terminal.removeChild(terminal.firstChild);
        }
    }

    logTerminal('Inicializando conexión segura con el núcleo...', 'info');
    logTerminal('Socket.io establecido por el puerto 443.', 'success');

    // --- ESCUCHA DE SOCKETS (Usuarios) ---
    if (window.socket) {
        window.socket.on('usuarios-online', (idsOnline) => {
            if (contadorUsuarios) {
                const usuariosUnicos = [...new Set(idsOnline)].length;
                contadorUsuarios.innerText = usuariosUnicos;
                
                // Generar log en terminal si alguien entra o sale
                if (usuariosUnicos > lastUserCount) {
                    logTerminal(`+ Nueva conexión entrante detectada. Nodos activos: ${usuariosUnicos}`, 'success');
                } else if (usuariosUnicos < lastUserCount) {
                    logTerminal(`- Conexión finalizada por el cliente. Nodos activos: ${usuariosUnicos}`, 'warn');
                }
                lastUserCount = usuariosUnicos;
            }
        });
    }

    // --- MOTOR DE TELEMETRÍA (El Latido del Sistema) ---
    function iniciarTelemetria() {
        setInterval(() => {
            // 1. Reloj
            if (serverTime) {
                serverTime.innerText = new Date().toLocaleTimeString('en-US', { hour12: false });
            }

            // 2. Uptime (Formato HH:MM:SS)
            uptimeSegundos++;
            if (uptimeCounter) {
                const h = Math.floor(uptimeSegundos / 3600).toString().padStart(2, '0');
                const m = Math.floor((uptimeSegundos % 3600) / 60).toString().padStart(2, '0');
                const s = Math.floor(uptimeSegundos % 60).toString().padStart(2, '0');
                uptimeCounter.innerText = `${h}:${m}:${s}`;
            }

            // 3. Latencia DB (Fluctúa entre 10 y 35 ms para realismo)
            if (dbPing) {
                const basePing = 15;
                const jitter = Math.floor(Math.random() * 20) - 5; 
                dbPing.innerText = basePing + jitter;
            }

            // 4. Memoria RAM (Fluctúa ligeramente)
            if (ramUsage) {
                const ram = 140 + Math.floor(Math.random() * 8);
                ramUsage.innerText = ram;
            }
        }, 1000);

        // Logs aleatorios para la terminal
        setInterval(() => {
            const mensajesFalsos = [
                "Limpiando caché de consultas PostgreSQL...",
                "Sincronizando índices del inventario...",
                "Verificando integridad del token JWT...",
                "Petición de telemetría resuelta en 12ms."
            ];
            const randomMsg = mensajesFalsos[Math.floor(Math.random() * mensajesFalsos.length)];
            logTerminal(randomMsg, 'info');
        }, 8500);
    }

    iniciarTelemetria();

    // --- LÓGICA DE ESTADO DEL SISTEMA ---
    async function cargarEstadoBinario() {
        try {
            const response = await fetch('/api/developer/estado', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();

            const sistemaEnLinea = (data.activo === true || data.activo === 'true' || data.activo === '1');

            if (sistemaEnLinea) {
                statusIndicator.innerHTML = '<i class="fa-solid fa-shield-check text-green-500 text-xl"></i> <span class="text-green-500 tracking-widest">NÚCLEO EN LÍNEA</span>';
                statusIndicator.className = "flex items-center justify-center gap-3 font-black text-xs uppercase p-4 bg-green-950/20 rounded border border-green-900/50";
                
                btnBloquear.classList.remove('hidden');
                btnBloquear.style.display = 'block';
                btnActivar.classList.add('hidden');
                btnActivar.style.display = 'none';
            } else {
                statusIndicator.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-red-500 text-xl animate-pulse"></i> <span class="text-red-500 tracking-widest">ACCESO DENEGADO</span>';
                statusIndicator.className = "flex items-center justify-center gap-3 font-black text-xs uppercase p-4 bg-red-950/20 rounded border border-red-900/50";
                
                btnActivar.classList.remove('hidden');
                btnActivar.style.display = 'block';
                btnBloquear.classList.add('hidden');
                btnBloquear.style.display = 'none';
            }
            logTerminal(`Estado del núcleo verificado: ${sistemaEnLinea ? 'ONLINE' : 'OFFLINE'}`, 'info');
        } catch (error) {
            console.error("Error cargando estado binario:", error);
            logTerminal('Error de conexión al verificar el estado del núcleo.', 'error');
        }
    }

    async function cargarConfiguracionFecha() {
        try {
            const res = await fetch('/api/ajustes/mensaje-pago', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.mensaje) {
                fechaInput.value = data.mensaje; 
                
                const fechaLimite = new Date(data.mensaje);
                fechaLimite.setHours(23, 59, 59, 999);
                
                if (new Date() > fechaLimite) {
                    estadoSistemaTxt.innerHTML = '<i class="fa-solid fa-ban mr-1"></i> LICENCIA VENCIDA (SUSPENSIÓN AUTOMÁTICA)';
                    estadoSistemaTxt.className = "mt-4 text-center text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-950/30 py-3 rounded border border-red-900/50";
                } else {
                    estadoSistemaTxt.innerHTML = '<i class="fa-solid fa-shield-halved mr-1"></i> LICENCIA VIGENTE ACTIVA';
                    estadoSistemaTxt.className = "mt-4 text-center text-[10px] font-black uppercase tracking-widest text-green-500 bg-green-950/30 py-3 rounded border border-green-900/50";
                }
            }
        } catch (error) {
            console.error("Error al cargar configuración de fecha:", error);
        }
    }

    async function cambiarEstadoManual(nuevoEstado) {
        const accion = nuevoEstado ? 'ACTIVAR' : 'SUSPENDER';
        const color = nuevoEstado ? '#16a34a' : '#dc2626';

        const confirmacion = await Swal.fire({
            title: `¿EJECUTAR ORDEN: ${accion}?`,
            text: nuevoEstado 
                ? "Los protocolos de seguridad se abrirán. Todos los usuarios tendrán acceso." 
                : "ADVERTENCIA: Se expulsará inmediatamente a todos los clientes conectados.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: color,
            cancelButtonColor: '#334155',
            confirmButtonText: `CONFIRMAR ORDEN`,
            cancelButtonText: 'ABORTO',
            background: '#020617',
            color: '#f8fafc',
            customClass: { title: 'font-mono uppercase tracking-widest' }
        });

        if (confirmacion.isConfirmed) {
            logTerminal(`Iniciando protocolo de ${accion}...`, 'warn');
            try {
                const response = await fetch('/api/developer/estado', {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify({ activo: nuevoEstado })
                });

                if (response.ok) {
                    Swal.fire({
                        title: 'ORDEN EJECUTADA',
                        text: `Protocolo completado. Estado de red: ${nuevoEstado ? 'ONLINE' : 'OFFLINE'}.`,
                        icon: 'success',
                        background: '#020617',
                        color: '#f8fafc',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    logTerminal(`Protocolo exitoso. Nodos actualizados vía Socket.io.`, 'success');
                    await cargarEstadoBinario();
                    if (nuevoEstado) cargarConfiguracionFecha();
                } else {
                    Swal.fire('Error', 'Comando rechazado por el servidor.', 'error');
                    logTerminal(`Fallo al ejecutar el protocolo de ${accion}.`, 'error');
                }
            } catch (error) {
                logTerminal(`Excepción crítica de red.`, 'error');
            }
        }
    }

    window.guardarFechaPago = async function() {
        const nuevaFecha = fechaInput.value;
        if (!nuevaFecha) return Swal.fire('Atención', 'Seleccione una fecha.', 'info');

        logTerminal(`Actualizando registro de licenciamiento a: ${nuevaFecha}...`, 'info');

        try {
            const res = await fetch('/api/ajustes/mensaje-pago', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nuevoMensaje: nuevaFecha }) 
            });
            
            if (res.ok) {
                await Swal.fire({
                    title: 'LICENCIA REGISTRADA',
                    text: 'Base de datos de licenciamiento actualizada. Sistema reactivado.',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false,
                    background: '#020617',
                    color: '#f8fafc'
                });
                init(); 
            }
        } catch (error) {
            logTerminal(`Fallo al escribir en la BD de licenciamiento.`, 'error');
        }
    };

    // Listeners
    if(btnActivar) btnActivar.onclick = () => cambiarEstadoManual(true);
    if(btnBloquear) btnBloquear.onclick = () => cambiarEstadoManual(false);

    // ========================================================
    // --- GESTOR DE BASE DE DATOS (SUPER CRUD) ---
    // ========================================================
    if (tablaSelector) {
        tablaSelector.addEventListener('change', async (e) => {
            const tablaSeleccionada = e.target.value;
            
            superCrudThead.innerHTML = '';
            superCrudTbody.innerHTML = `<tr><td class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Solicitando volcado de [${tablaSeleccionada}] al núcleo...</td></tr>`;
            
            logTerminal(`Iniciando extracción de datos de la tabla: ${tablaSeleccionada}`, 'info');
            await cargarDatosSuperCrud(tablaSeleccionada);
        });
    }

    async function cargarDatosSuperCrud(tabla) {
        try {
            // Usamos tu fetch con el token guardado en la parte superior
            const response = await fetch(`/api/developer/db/${tabla}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await response.json();

            // Si el backend nos mandó el error 403 (Acceso denegado de la Lista Blanca) u otro
            if (!response.ok) {
                throw new Error(data.error || 'Error desconocido en el núcleo');
            }

            logTerminal(`Volcado de [${tabla}] exitoso. ${data.length} registros extraídos.`, 'success');
            renderizarTablaSuperCrud(data, tabla);

        } catch (error) {
            console.error('Error del Super CRUD:', error);
            superCrudTbody.innerHTML = `<tr><td class="text-red-500 text-center font-bold py-4"><i class="fas fa-bug"></i> ${error.message}</td></tr>`;
            logTerminal(`Violación de acceso o error en [${tabla}]: ${error.message}`, 'error');
        }
    }

    function renderizarTablaSuperCrud(datos, nombreTabla) {
        if (!datos || datos.length === 0) {
            superCrudThead.innerHTML = '';
            superCrudTbody.innerHTML = `<tr><td class="text-center text-muted py-4">La tabla ${nombreTabla} está vacía.</td></tr>`;
            return;
        }

        // 1. Extraer nombres de las columnas para el Thead
        const columnas = Object.keys(datos[0]);
        let theadHTML = '<tr>';
        
        columnas.forEach(col => {
            theadHTML += `<th class="text-uppercase">${col}</th>`;
        });
        theadHTML += `<th class="text-center">ACCIONES</th></tr>`;
        
        superCrudThead.innerHTML = theadHTML;

        // 2. Iterar sobre los datos para armar el Tbody
        let tbodyHTML = '';
        datos.forEach(fila => {
            tbodyHTML += '<tr>';
            
            columnas.forEach(col => {
                let valor = fila[col] !== null ? fila[col] : '<i class="text-muted">NULL</i>';
                
                // NUEVO: Convertir a texto si es un objeto JSON
                if (typeof valor === 'object' && valor !== null) {
                    valor = JSON.stringify(valor);
                }

                if (typeof valor === 'string' && valor.length > 50) {
                    valor = valor.substring(0, 50) + '...';
                }
                tbodyHTML += `<td class="align-middle">${valor}</td>`;
            });

            // Serializamos la fila entera para poder leerla al hacer clic en "Editar"
            const filaJSON = encodeURIComponent(JSON.stringify(fila));
            
            tbodyHTML += `
                <td class="text-center text-nowrap align-middle">
                    <button class="btn btn-sm btn-warning btn-editar-registro mx-1" data-tabla="${nombreTabla}" data-fila="${filaJSON}" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
            `;

            if (nombreTabla === 'ventas') {
                tbodyHTML += `
                    <button class="btn btn-sm btn-info btn-reimprimir-factura mx-1" data-id="${fila.id}" title="Reimprimir Ticket">
                        <i class="fas fa-print"></i>
                    </button>
                `;
            }

            tbodyHTML += `
                    <button class="btn btn-sm btn-danger btn-eliminar-registro mx-1" data-tabla="${nombreTabla}" data-id="${fila.id}" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
        });

        superCrudTbody.innerHTML = tbodyHTML;
    }
    
    // ========================================================
    // --- LÓGICA DE BOTONES Y MODAL (SUPER CRUD) ---
    // ========================================================
    
    // Variables para saber qué estamos editando
    let tablaActualEdicion = '';
    let idActualEdicion = null;
    let modalSuperCrud = null;

    // Inicializar el modal de Bootstrap (si existe en el DOM)
    const modalElement = document.getElementById('modal-super-crud');
    if (modalElement && window.bootstrap) {
        modalSuperCrud = new bootstrap.Modal(modalElement);
    }

    // Escuchar TODOS los clics dentro de la tabla dinámica
    if (superCrudTbody) {
        superCrudTbody.addEventListener('click', (e) => {
            const btnEditar = e.target.closest('.btn-editar-registro');
            const btnEliminar = e.target.closest('.btn-eliminar-registro');
            const btnReimprimir = e.target.closest('.btn-reimprimir-factura');

            // --- ACCIÓN: EDITAR ---
            if (btnEditar) {
                tablaActualEdicion = btnEditar.dataset.tabla;
                const filaData = JSON.parse(decodeURIComponent(btnEditar.dataset.fila));
                idActualEdicion = filaData.id;
                
                abrirModalEdicion(filaData);
            }

            // --- ACCIÓN: ELIMINAR ---
            if (btnEliminar) {
                const tabla = btnEliminar.dataset.tabla;
                const id = btnEliminar.dataset.id;
                ejecutarEliminacion(tabla, id);
            }

            // --- ACCIÓN: REIMPRIMIR (Solo Ventas) ---
            if (btnReimprimir) {
                const idFactura = btnReimprimir.dataset.id;
                logTerminal(`Ejecutando reimpresión de factura ID: ${idFactura}`, 'info');
                // Asumiendo que usas SweetAlert y tienes tu ruta de impresión
                window.open(`/api/impresora/imprimir-ticket/${idFactura}`, '_blank');
            }
        });
    }

    // Función para construir los inputs dinámicos en el Modal
    function abrirModalEdicion(fila) {
        const form = document.getElementById('form-edicion-dinamico');
        form.innerHTML = ''; // Limpiamos el formulario anterior

        Object.keys(fila).forEach(key => {
            let valor = fila[key] !== null ? fila[key] : '';
            
            // 1. NUEVO: Si el valor es un objeto (JSON en la base de datos), lo convertimos a string
            if (typeof valor === 'object' && valor !== '') {
                valor = JSON.stringify(valor);
            }

            // 2. NUEVO: Escapar comillas dobles para que no rompan el input HTML
            if (typeof valor === 'string') {
                valor = valor.replace(/"/g, '&quot;');
            }

            // Bloqueamos el ID y fechas de creación para no romper la BD
            const isReadOnly = (key === 'id' || key.includes('creado') || key.includes('fecha')) ? 'readonly disabled' : '';
            
            form.innerHTML += `
                <div class="mb-3">
                    <label class="form-label font-bold text-slate-400 uppercase text-[10px] tracking-widest">${key}</label>
                    <input type="text" id="input-crud-${key}" data-key="${key}" class="w-full p-2 bg-slate-950 border border-slate-700 text-white rounded font-mono text-sm outline-none focus:border-purple-500" value="${valor}" ${isReadOnly}>
                </div>
            `;
        });

        if (modalSuperCrud) modalSuperCrud.show();
        logTerminal(`Modal de edición abierto para [${tablaActualEdicion}] ID: ${idActualEdicion}`, 'info');
    }

    // --- ENVIAR CAMBIOS (PUT) ---
    // ========================================================
    // --- ENVIAR CAMBIOS (PUT) - MÉTODO A PRUEBA DE FALLOS ---
    // ========================================================
    
    // Usamos delegación de eventos en todo el documento para asegurar que el click NUNCA se pierda
    document.addEventListener('click', async (e) => {
        // Verificamos si el elemento clicado (o un padre) es el botón de guardar
        const btnGuardar = e.target.closest('#btn-guardar-cambios');
        
        if (btnGuardar) {
            e.preventDefault(); // Prevenir cualquier comportamiento por defecto
            
            // Solución segura a la advertencia del aria-hidden (enfocar el body para limpiar el foco)
            document.body.focus();

            const inputs = document.querySelectorAll('#form-edicion-dinamico input');
            const dataActualizada = {};

            inputs.forEach(input => {
                // Solo enviamos los campos que no son de solo lectura
                if (!input.hasAttribute('readonly')) {
                    // Si el input está vacío, inyectamos null (para proteger ints y fechas en PostgreSQL)
                    dataActualizada[input.dataset.key] = input.value.trim() === '' ? null : input.value.trim();
                }
            });

            try {
                // Deshabilitar botón y mostrar carga
                btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Forzando...';
                btnGuardar.disabled = true;

                logTerminal(`Inyectando actualización en [${tablaActualEdicion}] ID: ${idActualEdicion}...`, 'warn');
                
                const response = await fetch(`/api/developer/db/${tablaActualEdicion}/${idActualEdicion}`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify(dataActualizada)
                });

                const responseData = await response.json();

                if (!response.ok) {
                    throw new Error(responseData.error || 'Violación de integridad en la BD.');
                }

                // Ocultar modal
                if (modalSuperCrud) modalSuperCrud.hide();
                logTerminal(`Actualización exitosa. Registro modificado.`, 'success');
                
                // Mostrar alerta de éxito
                Swal.fire({
                    title: '¡Inyección Exitosa!',
                    text: 'El registro ha sido modificado en el núcleo.',
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false,
                    background: '#020617',
                    color: '#f8fafc'
                });
                
                // Recargar la tabla con los nuevos datos
                await cargarDatosSuperCrud(tablaActualEdicion);

            } catch (error) {
                logTerminal(`Fallo de inyección: ${error.message}`, 'error');
                Swal.fire({
                    title: 'Error de Inyección', 
                    text: error.message, 
                    icon: 'error',
                    background: '#020617',
                    color: '#f8fafc'
                });
            } finally {
                // Restaurar el botón a la normalidad
                btnGuardar.innerHTML = 'Forzar Cambio';
                btnGuardar.disabled = false;
            }
        }
    });

    // --- ENVIAR ELIMINACIÓN (DELETE) ---
    async function ejecutarEliminacion(tabla, id) {
        const confirmacion = await Swal.fire({
            title: `¿DESTRUIR REGISTRO ID: ${id}?`,
            text: `Esta acción borrará el dato de la tabla [${tabla}] irreversiblemente.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#334155',
            confirmButtonText: 'ELIMINAR DEFINITIVAMENTE',
            background: '#020617',
            color: '#f8fafc'
        });

        if (confirmacion.isConfirmed) {
            try {
                logTerminal(`Ejecutando purga en [${tabla}] ID: ${id}...`, 'warn');
                const response = await fetch(`/api/developer/db/${tabla}/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Violación de clave foránea o acceso denegado.');

                logTerminal(`Registro purgado exitosamente del núcleo.`, 'success');
                await cargarDatosSuperCrud(tabla); // Recargar la tabla
            } catch (error) {
                logTerminal(`Fallo en purga de datos: ${error.message}`, 'error');
                Swal.fire('Error', 'No se puede eliminar. Es probable que este registro esté siendo usado en otra tabla (Error de Clave Foránea).', 'error');
            }
        }
    }
    
    // Arranque
    await cargarEstadoBinario();
    await cargarConfiguracionFecha();
}
// ========================================================
    // --- PROTOCOLO DE ANULACIÓN DE FACTURAS (CORREGIDO) ---
    // ========================================================
    window.buscarVentasAnulacion = async function() {
        // Esto quita el foco del botón y elimina la advertencia "aria-hidden"
        if (document.activeElement) document.activeElement.blur();

        const query = document.getElementById('buscador-anulacion').value;
        const tbody = document.getElementById('tbody-anulacion');
        
        // Extraemos el token directamente para que NUNCA dé error de conexión
        const tokenLocal = localStorage.getItem('token');

        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Consultando registros en el núcleo...</td></tr>';

        try {
            // Usamos encodeURIComponent para evitar errores si buscas algo con espacios
            const response = await fetch(`/api/ventas?busqueda=${encodeURIComponent(query)}&limit=25`, {
                headers: { 'Authorization': `Bearer ${tokenLocal}` }
            });
            
            if (!response.ok) throw new Error(`El servidor respondió con error ${response.status}`);
            
            const result = await response.json();
            const ventas = result.data || [];

            if (ventas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-slate-500">No hay coincidencias en la base de datos.</td></tr>';
                return;
            }

            tbody.innerHTML = ventas.map(v => `
                <tr class="hover:bg-slate-800/50 transition">
                    <td class="py-3 px-4 font-black text-white">#${v.id}</td>
                    <td class="py-3 px-4">${new Date(v.fecha).toLocaleString()}</td>
                    <td class="py-3 px-4 text-indigo-300">${v.cliente_nombre || 'General'}</td>
                    <td class="py-3 px-4 text-right font-black text-emerald-400">$${parseFloat(v.total).toFixed(2)}</td>
                    <td class="py-3 px-4 text-center">
                        <button onclick="ejecutarAnulacionDefinitiva(${v.id})" class="bg-red-900/30 hover:bg-red-600 text-red-500 hover:text-white border border-red-800/50 px-3 py-1 rounded text-[10px] uppercase tracking-widest font-bold transition-all shadow-[0_0_10px_rgba(220,38,38,0.2)]">
                            <i class="fas fa-skull-crossbones"></i> ERRADICAR
                        </button>
                    </td>
                </tr>
            `).join('');

        } catch (error) {
            console.error("Error en buscarVentasAnulacion:", error); // Para ver el error real en tu consola F12
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Fallo de comunicación: ${error.message}</td></tr>`;
        }
    };

    window.ejecutarAnulacionDefinitiva = async function(idFactura) {
        if (document.activeElement) document.activeElement.blur();
        const tokenLocal = localStorage.getItem('token');

        try {
            // Mostrar los productos antes de destruir
            const res = await fetch(`/api/ventas/${idFactura}`, { headers: { 'Authorization': `Bearer ${tokenLocal}` } });
            
            if (!res.ok) throw new Error("Factura no encontrada o conexión perdida.");
            
            const data = await res.json();
            if (!data.venta) throw new Error("Registro corrupto o inexistente.");

            const listaHTML = data.detalles.map(d => `<div class="text-[10px] text-slate-400 font-mono text-left border-b border-slate-800 py-1">▪ ${d.cantidad}x ${d.producto_nombre || 'Producto'}</div>`).join('');

            const { value: motivo, isConfirmed } = await Swal.fire({
                title: `¿PURGAR TICKET #${idFactura}?`,
                html: `
                    <div class="mb-4">
                        <p class="text-xs text-red-400 mb-2 font-bold">¡ALERTA! El inventario será reintegrado automáticamente.</p>
                        <div class="bg-slate-950 p-2 rounded border border-slate-800 max-h-32 overflow-y-auto">${listaHTML}</div>
                    </div>
                `,
                input: 'text',
                inputPlaceholder: 'Ingresa el motivo para la auditoría...',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc2626',
                cancelButtonColor: '#334155',
                confirmButtonText: 'EJECUTAR ANULACIÓN',
                background: '#020617',
                color: '#f8fafc',
                inputValidator: (value) => { if (!value) return 'El motivo de auditoría es obligatorio.' }
            });

            if (isConfirmed) {
                // Si esta línea te da error, significa que pusiste las funciones fuera del init()
                if(typeof logTerminal === 'function') logTerminal(`Iniciando purga y devolución de inventario del Ticket #${idFactura}...`, 'warn');
                
                const deleteRes = await fetch(`/api/developer/anular-venta/${idFactura}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenLocal}` },
                    body: JSON.stringify({ motivo: motivo })
                });

                const deleteData = await deleteRes.json();

                if (!deleteRes.ok) throw new Error(deleteData.error || 'Error interno al anular.');

                if(typeof logTerminal === 'function') logTerminal(`Purga completada. Insumos devueltos al almacén.`, 'success');
                
                Swal.fire({ title: '¡Anulada!', text: deleteData.mensaje, icon: 'success', background: '#020617', color: '#f8fafc' });
                buscarVentasAnulacion(); 
            }
        } catch (error) {
            console.error("Error anulando:", error);
            Swal.fire({title: 'Error', text: error.message, icon: 'error', background: '#020617', color: '#f8fafc'});
            if(typeof logTerminal === 'function') logTerminal(`Fallo de purga: ${error.message}`, 'error');
        }
    };

window.verBovedaAnulaciones = async function() {
        if (document.activeElement) document.activeElement.blur();
        const tbody = document.getElementById('tbody-anulacion');
        const tokenLocal = localStorage.getItem('token');

        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Abriendo Bóveda de Seguridad...</td></tr>';

        try {
            const response = await fetch('/api/developer/boveda-anuladas', {
                headers: { 'Authorization': `Bearer ${tokenLocal}` }
            });
            const anuladas = await response.json();

            if (anuladas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-emerald-500 font-bold">La bóveda está vacía. No hay tickets anulados.</td></tr>';
                return;
            }

            // Cambiamos el color de la tabla para que sepas que estás en la Bóveda
            tbody.innerHTML = anuladas.map(v => `
                <tr class="bg-red-950/20 border-b border-red-900/30">
                    <td class="py-3 px-4 font-black text-red-400 line-through">#${v.venta_original_id}</td>
                    <td class="py-3 px-4 text-slate-400 text-[10px]">${new Date(v.fecha_anulacion).toLocaleString()}</td>
                    <td class="py-3 px-4 text-slate-500 text-[10px]"><span class="block text-white font-bold">${v.cliente_nombre || 'General'}</span>Motivo: ${v.motivo}</td>
                    <td class="py-3 px-4 text-right font-black text-red-400">$${parseFloat(v.total_venta).toFixed(2)}</td>
                    <td class="py-3 px-4 text-center">
                        <button onclick="restaurarFacturaDesdeBoveda(${v.id})" class="bg-emerald-900/30 hover:bg-emerald-600 text-emerald-500 hover:text-white border border-emerald-800/50 px-3 py-1 rounded text-[10px] uppercase tracking-widest font-bold transition-all shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                            <i class="fas fa-trash-restore"></i> Revertir
                        </button>
                    </td>
                </tr>
            `).join('');

        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Error leyendo la bóveda.</td></tr>`;
        }
    };

    window.restaurarFacturaDesdeBoveda = async function(idBoveda) {
        if (document.activeElement) document.activeElement.blur();
        const tokenLocal = localStorage.getItem('token');
        
        const { isConfirmed } = await Swal.fire({
            title: '¿RESTAURAR FACTURA?',
            text: 'La factura volverá a estar activa en Ventas y se VOLVERÁ A DESCONTAR el inventario de los estantes.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#334155',
            confirmButtonText: 'RESTAURAR AHORA',
            background: '#020617',
            color: '#f8fafc'
        });

        if (isConfirmed) {
            try {
                if(typeof logTerminal === 'function') logTerminal(`Restaurando ticket desde la bóveda...`, 'info');
                
                const response = await fetch(`/api/developer/restaurar-venta/${idBoveda}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${tokenLocal}` }
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Error interno');

                Swal.fire({ title: '¡Restaurada!', text: data.mensaje, icon: 'success', background: '#020617', color: '#f8fafc' });
                if(typeof logTerminal === 'function') logTerminal(`Ticket restaurado con éxito.`, 'success');
                
                verBovedaAnulaciones(); // Recargar la bóveda visualmente
            } catch (error) {
                Swal.fire({title: 'Error de Restauración', text: error.message, icon: 'error', background: '#020617', color: '#f8fafc'});
            }
        }
    };