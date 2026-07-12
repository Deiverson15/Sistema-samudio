// OJO: Necesitaremos actualizar api.js en el siguiente paso para que esto funcione
import { ProveedorService } from '../../js/api.js';

export async function init() {
    console.log("Iniciando Proveedores...");
    cargarTabla();

    const form = document.getElementById('formProveedor');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await guardar();
        });
    }
}

async function cargarTabla() {
    const lista = await ProveedorService.getAll();
    const tbody = document.getElementById('tablaProveedores');
    tbody.innerHTML = '';

    lista.forEach(p => {
        tbody.innerHTML += `
            <tr class="hover:bg-purple-50">
                <td class="px-4 py-3 font-bold text-gray-800">${p.empresa}</td>
                <td class="px-4 py-3">
                    <div class="text-sm">${p.contacto || '--'}</div>
                </td>
                <td class="px-4 py-3 text-xs text-gray-500">
                    <div><i class="fa-solid fa-phone mr-1"></i> ${p.telefono || ''}</div>
                    <div><i class="fa-solid fa-envelope mr-1"></i> ${p.email || ''}</div>
                </td>
                <td class="px-4 py-3 text-center">
                    <button onclick="eliminar(${p.id})" class="text-red-500 hover:text-red-700"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });

    // Exponer funcion global
    window.eliminar = async (id) => {
        const result = await Swal.fire({
            title: '¿Eliminar Proveedor?',
            text: "Esta acción es irreversible si no tiene lotes asociados.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Sí, eliminar'
        });

        if(result.isConfirmed) {
            await ProveedorService.delete(id);
            Swal.fire(
                '¡Eliminado!',
                'El proveedor ha sido eliminado.',
                'success'
            );
            cargarTabla();
        }
    };
}

async function guardar() {
    try {
        const data = {
            documento: document.getElementById('documento').value,
            empresa: document.getElementById('empresa').value,
            contacto: document.getElementById('contacto').value,
            telefono: document.getElementById('telefono').value,
            email: document.getElementById('email').value,
            direccion: document.getElementById('direccion').value
        };

        const res = await ProveedorService.create(data);

        if(res.error) {
            Swal.fire('Error', res.error, 'error');
        } else {
            Swal.fire({
                icon: 'success',
                title: '¡Registrado!',
                text: 'Proveedor registrado correctamente.',
                confirmButtonColor: '#000000' // Negro para combinar con tu estilo
            });
            document.getElementById('formProveedor').reset();
            cargarTabla();
        }
    } catch (error) {
        console.error("Error al capturar datos:", error);
    }
}