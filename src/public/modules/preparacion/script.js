import { FormulaService, ProductoService } from '../../js/api.js';

let tipoFormularioActual = 'ESTANDAR'; 
let formulaSeleccionadaActual = null;  
let catalogoEsenciasDisponibles = [];
let idsPorEliminar = [];               

export async function init() {
    console.log("Módulo de Fórmulas Inteligente (Validación Estricta Activa) Cargado");
    
    window.limpiarFormulario = limpiarFormulario;
    window.cargarEditarGrupo = cargarEditarGrupo;
    window.eliminarFormula = eliminarFormula;
    window.cambiarTipoFormulario = cambiarTipoFormulario;
    window.agregarFilaPromo = agregarFilaPromo;
    window.eliminarFilaPromo = eliminarFilaPromo;
    window.abrirModalPrepararPromo = abrirModalPrepararPromo;
    window.cerrarModalPrepararPromo = cerrarModalPrepararPromo;
    window.procesarVaciadoPromo = procesarVaciadoPromo;

    await cargarTabla();

    const form = document.getElementById('formFormula');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await guardarFormula();
        });
    }
}

window.cambiarTipoFormulario = function(tipo) {
    tipoFormularioActual = tipo;
    
    const tabEstandar = document.getElementById('tabEstandar');
    const tabPromo = document.getElementById('tabPromo');
    const seccionMayoristas = document.getElementById('seccionMayoristas');
    const seccionPromociones = document.getElementById('seccionPromociones');

    // 🛡️ CONTROL ANTI-LAG: Evita crasheos si el HTML aún no se renderiza del todo
    if (!tabEstandar || !tabPromo || !seccionMayoristas || !seccionPromociones) return;

    if (tipo === 'ESTANDAR') {
        tabEstandar.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 bg-white text-neutral-950 border border-neutral-300";
        tabPromo.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 text-neutral-500 hover:text-neutral-950";
        seccionMayoristas.classList.remove('hidden');
        seccionPromociones.classList.add('hidden');
    } else {
        tabPromo.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 bg-white text-neutral-950 border border-neutral-300";
        tabEstandar.className = "py-3 text-[10px] font-black uppercase tracking-widest text-center transition-all duration-200 text-neutral-500 hover:text-neutral-950";
        seccionMayoristas.classList.add('hidden');
        seccionPromociones.classList.remove('hidden');
        
        const contenedor = document.getElementById('contenedorFilasPromo');
        if (contenedor && contenedor.children.length === 0) {
            agregarFilaPromo();
        }
    }
};

window.agregarFilaPromo = function(cantidad = '', precio = '', precio_bs = '', dbId = null) {
    const contenedor = document.getElementById('contenedorFilasPromo');
    if (!contenedor) return;

    const div = document.createElement('div');
    div.className = "fila-promo-dinamica flex items-center gap-2 bg-neutral-50 p-2.5 border border-neutral-200 rounded-none animate-fade-in";
    div.setAttribute('data-id', dbId || ''); 
    
    div.innerHTML = `
        <div class="w-14 shrink-0">
            <input type="number" placeholder="CANT" value="${cantidad}" class="input-cant-promo w-full p-2 border border-neutral-300 text-xs font-black text-center text-neutral-950 outline-none" min="1" required>
        </div>
        <div class="text-neutral-400 font-bold text-xs">X</div>
        <div class="flex-1">
            <input type="number" step="0.01" placeholder="TOTAL USD $" value="${precio}" class="input-precio-promo w-full p-2 border border-neutral-300 text-xs font-bold text-right outline-none" required>
        </div>
        <div class="text-neutral-300 font-bold text-xs">/</div>
        <div class="flex-1">
            <input type="number" step="0.01" placeholder="TOTAL Bs" value="${precio_bs}" class="input-precio-bs-promo w-full p-2 border border-amber-300 bg-amber-50/20 text-xs font-bold text-right text-neutral-950 outline-none" required>
        </div>
        <button type="button" onclick="eliminarFilaPromo(this)" class="text-neutral-400 hover:text-red-600 font-bold px-1 text-xs">✕</button>
    `;
    contenedor.appendChild(div);
};

window.eliminarFilaPromo = function(btn) {
    const row = btn.parentElement;
    const dbId = row.getAttribute('data-id');
    if (dbId) idsPorEliminar.push(parseInt(dbId));
    row.remove();
};

async function cargarTabla() {
    const tbody = document.getElementById('tablaFormulas');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="text-center p-6"><i class="fa-solid fa-flask fa-spin text-xl text-neutral-950"></i></td></tr>';
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/formulas', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();

        tbody.innerHTML = '';
        if(data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center p-6 text-neutral-400 uppercase tracking-widest text-[10px] font-black">Sin configuraciones comerciales</td></tr>';
            return;
        }

        const grupos = {};
       data.forEach(f => {
                const key = `${f.nombre.trim().toUpperCase()}_${f.volumen_total}`;
                if (!grupos[key]) {
                    grupos[key] = {
                        nombre: f.nombre, volumen_total: f.volumen_total,
                        gramos_esencia: f.gramos_esencia, ml_alcohol: f.ml_alcohol, gramos_fijador: f.gramos_fijador,
                        // 🔥 Guardamos los nuevos campos en el mapeador local
                        precio_gramo_extra: f.precio_gramo_extra,
                        precio_fijador_extra: f.precio_fijador_extra,
                        precio_recarga: f.precio_recarga,
                        precio: 0, precio_bs: 0, cantidad_mayor: 6, precio_mayor: 0, precio_mayor_bs: 0,
                        cantidad_gran_mayor: 50, precio_gran_mayor: 0, precio_gran_mayor_bs: 0,
                        esPromo: false, combos: [], ids: []
                    };
                }
            grupos[key].ids.push(f.id);
            if (parseFloat(f.cantidad_promo) > 0) {
                grupos[key].esPromo = true;
                grupos[key].combos.push({ id: f.id, cantidad_promo: f.cantidad_promo, precio_promo: f.precio_promo, precio_bs: f.precio_bs });
            } else {
                grupos[key].standardId = f.id;
                grupos[key].precio = f.precio;
                grupos[key].precio_bs = f.precio_bs;
                grupos[key].cantidad_mayor = f.cantidad_mayor;
                grupos[key].precio_mayor = f.precio_mayor;
                grupos[key].precio_mayor_bs = f.precio_mayor_bs;
                grupos[key].cantidad_gran_mayor = f.cantidad_gran_mayor;
                grupos[key].precio_gran_mayor = f.precio_gran_mayor;
                grupos[key].precio_gran_mayor_bs = f.precio_gran_mayor_bs;
            }
        });

        window.gruposFormulasTemp = grupos;

        Object.values(grupos).forEach(g => {
            let precioTexto = '';
            if (parseFloat(g.precio) > 0) precioTexto += `$${parseFloat(g.precio).toFixed(1)}`;
            if (parseFloat(g.precio_bs) > 0) precioTexto += ` (${parseFloat(g.precio_bs).toFixed(0)}Bs)`;
            
            if (g.esPromo) {
                const textoCombosConBs = g.combos.map(c => {
                    let strCombo = `${c.cantidad_promo}x$${parseFloat(c.precio_promo).toFixed(0)}`;
                    if (parseFloat(c.precio_bs) > 0) strCombo += ` (${parseFloat(c.precio_bs).toFixed(0)}Bs)`;
                    return strCombo;
                }).join(' / ');
                precioTexto = precioTexto ? `${precioTexto} | Promo: ${textoCombosConBs}` : textoCombosConBs;
            }
            
            const badge = g.esPromo 
                ? `<span class="px-2 py-0.5 border border-amber-400 bg-amber-50 text-amber-700 font-black text-[9px] uppercase tracking-wider">Combo (${g.combos.length})</span>` 
                : `<span class="px-2 py-0.5 border border-neutral-300 bg-neutral-100 text-neutral-600 font-black text-[9px] uppercase tracking-wider">Estándar</span>`;

            tbody.innerHTML += `
                <tr class="hover:bg-neutral-50 cursor-pointer transition border-b border-neutral-200" onclick="cargarEditarGrupo('${g.nombre.replace(/'/g, "\\'")}', ${g.volumen_total})">
                    <td class="p-4 px-6 font-black text-neutral-950 text-xs">${g.nombre}</td>
                    <td class="p-4 text-center font-bold text-neutral-500 text-xs">${g.volumen_total} ML</td>
                    <td class="p-4 text-right font-black text-xs text-neutral-900" style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${precioTexto}</td>
                    <td class="p-4 text-center">${badge}</td>
                </tr>
            `;
        });
    } catch (error) { console.error(error); }
}

function cargarEditarGrupo(nombre, volumen_total) {
    const key = `${nombre.trim().toUpperCase()}_${volumen_total}`;
    const g = window.gruposFormulasTemp[key];
    if(!g) return;

    formulaSeleccionadaActual = g;
    idsPorEliminar = []; 

    const inputId = document.getElementById('formulaId');
    if (inputId) inputId.value = g.standardId || g.ids[0] || '';
    
    document.getElementById('tituloFormulario').innerText = "Editar Formato";
    document.getElementById('btnEliminar').classList.remove('hidden');

    document.getElementById('nombre').value = g.nombre;
    document.getElementById('volumen_total').value = g.volumen_total;
    document.getElementById('gramos_esencia').value = g.gramos_esencia;
    document.getElementById('ml_alcohol').value = g.ml_alcohol;
    document.getElementById('gramos_fijador').value = g.gramos_fijador;

    // 🔥 PINTAR LOS NUEVOS VALORES EXTRAS EN LA COMPOSICIÓN EDITADA
    document.getElementById('precio_gramo_extra').value = g.precio_gramo_extra || '';
    document.getElementById('precio_fijador_extra').value = g.precio_fijador_extra || '';
    document.getElementById('precio_recarga').value = g.precio_recarga || '';

    document.getElementById('precio').value = g.precio || '';
    document.getElementById('precio_bs').value = g.precio_bs || '';
    document.getElementById('cantidad_mayor').value = g.cantidad_mayor || 6;
    document.getElementById('precio_mayor').value = g.precio_mayor || '';
    document.getElementById('precio_mayor_bs').value = g.precio_mayor_bs || '';
    document.getElementById('cantidad_gran_mayor').value = g.cantidad_gran_mayor || 50;
    document.getElementById('precio_gran_mayor').value = g.precio_gran_mayor || '';
    document.getElementById('precio_gran_mayor_bs').value = g.precio_gran_mayor_bs || '';

    if (g.esPromo) {
        cambiarTipoFormulario('PROMO');
        const container = document.getElementById('contenedorFilasPromo');
        if (container) {
            container.innerHTML = ''; 
            g.combos.forEach(c => {
                agregarFilaPromo(c.cantidad_promo, c.precio_promo, c.precio_bs, c.id);
            });
        }
        document.getElementById('btnLanzarPromo').classList.remove('hidden');
    } else {
        cambiarTipoFormulario('ESTANDAR');
        document.getElementById('btnLanzarPromo').classList.add('hidden');
    }
}

function cargarEditarGrupo(nombre, volumen_total) {
    const key = `${nombre.trim().toUpperCase()}_${volumen_total}`;
    const g = window.gruposFormulasTemp[key];
    if(!g) return;

    formulaSeleccionadaActual = g;
    idsPorEliminar = []; 

    const inputId = document.getElementById('formulaId');
    if (inputId) inputId.value = g.standardId || g.ids[0] || '';
    
    document.getElementById('tituloFormulario').innerText = "Editar Formato";
    document.getElementById('btnEliminar').classList.remove('hidden');

    document.getElementById('nombre').value = g.nombre;
    document.getElementById('volumen_total').value = g.volumen_total;
    document.getElementById('gramos_esencia').value = g.gramos_esencia;
    document.getElementById('ml_alcohol').value = g.ml_alcohol;
    document.getElementById('gramos_fijador').value = g.gramos_fijador;

    // 🔥 PINTAR LOS NUEVOS VALORES EXTRAS EN LA COMPOSICIÓN EDITADA
    document.getElementById('precio_gramo_extra').value = g.precio_gramo_extra || '';
    document.getElementById('precio_fijador_extra').value = g.precio_fijador_extra || '';
    document.getElementById('precio_recarga').value = g.precio_recarga || '';

    document.getElementById('precio').value = g.precio || '';
    document.getElementById('precio_bs').value = g.precio_bs || '';
    document.getElementById('cantidad_mayor').value = g.cantidad_mayor || 6;
    document.getElementById('precio_mayor').value = g.precio_mayor || '';
    document.getElementById('precio_mayor_bs').value = g.precio_mayor_bs || '';
    document.getElementById('cantidad_gran_mayor').value = g.cantidad_gran_mayor || 50;
    document.getElementById('precio_gran_mayor').value = g.precio_gran_mayor || '';
    document.getElementById('precio_gran_mayor_bs').value = g.precio_gran_mayor_bs || '';

    if (g.esPromo) {
        cambiarTipoFormulario('PROMO');
        const container = document.getElementById('contenedorFilasPromo');
        if (container) {
            container.innerHTML = ''; 
            g.combos.forEach(c => {
                agregarFilaPromo(c.cantidad_promo, c.precio_promo, c.precio_bs, c.id);
            });
        }
        document.getElementById('btnLanzarPromo').classList.remove('hidden');
    } else {
        cambiarTipoFormulario('ESTANDAR');
        document.getElementById('btnLanzarPromo').classList.add('hidden');
    }
}

async function guardarFormula() {
    const mainId = document.getElementById('formulaId').value;
    const token = localStorage.getItem('token');
    
    // 🔥 CAPTURAMOS LOS VALORES DE NUESTROS INPUTS NUEVOS
    const pGramoExtra = document.getElementById('precio_gramo_extra').value || 0;
    const pFijadorExtra = document.getElementById('precio_fijador_extra').value || 0;
    const pRecarga = document.getElementById('precio_recarga').value || 0;

    const basePayload = {
        nombre: document.getElementById('nombre').value.trim(),
        volumen_total: document.getElementById('volumen_total').value,
        gramos_esencia: document.getElementById('gramos_esencia').value || 0,
        ml_alcohol: document.getElementById('ml_alcohol').value || 0,
        gramos_fijador: document.getElementById('gramos_fijador').value || 0,
        // 🔥 Los metemos a la base estructural del envío
        precio_gramo_extra: pGramoExtra,
        precio_fijador_extra: pFijadorExtra,
        precio_recarga: pRecarga
    };

    try {
        for (const deleteId of idsPorEliminar) {
            await fetch(`/api/formulas/${deleteId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        }
        idsPorEliminar = [];

        if (tipoFormularioActual === 'ESTANDAR') {
            const data = {
                ...basePayload,
                precio: document.getElementById('precio').value || 0,
                precio_bs: document.getElementById('precio_bs').value || 0,
                cantidad_mayor: document.getElementById('cantidad_mayor').value || 6,
                precio_mayor: document.getElementById('precio_mayor').value || 0,
                precio_mayor_bs: document.getElementById('precio_mayor_bs').value || 0,
                cantidad_gran_mayor: document.getElementById('cantidad_gran_mayor').value || 50,
                precio_gran_mayor: document.getElementById('precio_gran_mayor').value || 0,
                precio_gran_mayor_bs: document.getElementById('precio_gran_mayor_bs').value || 0,
                cantidad_promo: 0, precio_promo: 0
            };
            
            const targetId = formulaSeleccionadaActual?.standardId;
            const method = targetId ? 'PUT' : 'POST';
            const url = targetId ? `/api/formulas/${targetId}` : '/api/formulas';
            await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) });

        } else {
            const filas = document.querySelectorAll('.fila-promo-dinamica');
            for (let i = 0; i < filas.length; i++) {
                const cant = filas[i].querySelector('.input-cant-promo').value || 0;
                const prec = filas[i].querySelector('.input-precio-promo').value || 0;
                const precBs = filas[i].querySelector('.input-precio-bs-promo').value || 0;
                const currentDbId = filas[i].getAttribute('data-id');

                const dataPromo = {
                    ...basePayload,
                    precio: 0, 
                    precio_bs: precBs, 
                    cantidad_mayor: 6, precio_mayor: 0, precio_mayor_bs: 0, cantidad_gran_mayor: 50, precio_gran_mayor: 0, precio_gran_mayor_bs: 0,
                    cantidad_promo: cant, precio_promo: prec
                };

                const method = currentDbId ? 'PUT' : 'POST';
                const url = currentDbId ? `/api/formulas/${currentDbId}` : '/api/formulas';
                await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(dataPromo) });
            }
        }

        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Configuración comercial unificada', showConfirmButton: false, timer: 1500 });
        limpiarFormulario();
        await cargarTabla();

    } catch (e) { console.error(e); }
}

async function abrirModalPrepararPromo() {
    if (!formulaSeleccionadaActual || !formulaSeleccionadaActual.esPromo) return;
    let comboObjetivo = null;

    if (formulaSeleccionadaActual.combos.length === 1) {
        comboObjetivo = formulaSeleccionadaActual.combos[0];
    } else if (formulaSeleccionadaActual.combos.length > 1) {
        const opcionesCombo = {};
        formulaSeleccionadaActual.combos.forEach(c => {
            opcionesCombo[c.id] = `Combo: ${c.cantidad_promo} Botellas por $${parseFloat(c.precio_promo).toFixed(1)} / ${parseFloat(c.precio_bs).toFixed(0)}Bs`;
        });

        const { value: selectedId } = await Swal.fire({
            title: '⚡ Lote Múltiple Detectado',
            text: 'Selecciona cuál de las promociones unificadas deseas dosificar:',
            input: 'select',
            inputOptions: opcionesCombo,
            inputPlaceholder: '-- SELECONAR --',
            showCancelButton: true,
            confirmButtonColor: '#0a0a0a'
        });

        if (!selectedId) return;
        comboObjetivo = formulaSeleccionadaActual.combos.find(c => c.id == selectedId);
    }

    window.comboActivoParaVaciado = comboObjetivo;

    const modal = document.getElementById('modalPrepararPromo');
    const contenedor = document.getElementById('contenedorSlotsPromo');
    const txtHeader = document.getElementById('txtResumenPromoHeader');
    
    contenedor.innerHTML = '<div class="text-center py-4 text-xs font-bold text-neutral-400 uppercase"><i class="fa-solid fa-circle-notch fa-spin"></i> Desplegando esencias...</div>';
    modal.classList.remove('hidden');

    try {
        const resProds = await ProductoService.getAll(1, 1000, "", false);
        catalogoEsenciasDisponibles = (resProds.data || []).filter(p => p.categoria && p.categoria.toUpperCase().includes('ESENCIA'));

        const totalBotellas = parseInt(comboObjetivo.cantidad_promo);
        txtHeader.innerText = `LOTE: ${formulaSeleccionadaActual.nombre} | PREPARANDO COMBO DE ${totalBotellas} UNIDADES`;
        contenedor.innerHTML = '';
        
        for (let i = 0; i < totalBotellas; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = "p-4 border border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-none";
            wrapper.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-7 h-7 bg-neutral-950 text-white flex items-center justify-center font-black text-xs">${i + 1}</div>
                    <span class="text-xs font-black uppercase tracking-wider text-neutral-900">Fragancia de la botella</span>
                </div>
                <select class="select-esencia-promo w-full sm:w-72 p-2.5 border border-neutral-300 font-bold uppercase text-xs bg-white focus:border-neutral-950 outline-none cursor-pointer" required>
                    <option value="" disabled selected>-- ASIGNAR FRAGANCIA --</option>
                    ${catalogoEsenciasDisponibles.map(e => `<option value="${e.id}">${e.nombre} (Alm: ${parseFloat(e.stock_real).toFixed(0)}g | Est: ${parseFloat(e.stock_estante).toFixed(0)}g)</option>`).join('')}
                </select>
            `;
            contenedor.appendChild(wrapper);
        }
    } catch (error) { console.error(error); }
}

function cerrarModalPrepararPromo() {
    document.getElementById('modalPrepararPromo').classList.add('hidden');
    window.comboActivoParaVaciado = null;
}

async function procesarVaciadoPromo() {
    const dropdowns = document.querySelectorAll('.select-esencia-promo');
    const lotesPayload = [];
    let todosSeleccionados = true;

    dropdowns.forEach(select => {
        if (!select.value) { todosSeleccionados = false; return; }
        lotesPayload.push({
            formulaId: window.comboActivoParaVaciado.id, 
            productoId: parseInt(select.value),
            cantidad: 1
        });
    });

    if (!todosSeleccionados) {
        return Swal.fire('Faltan frascos', 'Asigna una fragancia para cada una de las botellas que comprende el combo.', 'warning');
    }

    Swal.fire({ title: 'Efectuando rebajas masivas en almacén...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const token = localStorage.getItem('token');
        const origenElegido = document.getElementById('selectOrigenPromo').value;

        const res = await fetch('/api/formulas/consumir-externo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ lotes: lotesPayload, origen: origenElegido })
        });

        if (res.ok) {
            cerrarModalPrepararPromo();
            limpiarFormulario();
            await cargarTabla();
            Swal.fire({ icon: 'success', title: '¡Materia Prima Descontada!', text: 'Se ha realizado el vaciado unificado de insumos técnicos con éxito.', confirmButtonColor: '#0a0a0a' });
        } else {
            const errData = await res.json();
            throw new Error(errData.error || 'Quiebre de inventario');
        }
    } catch (error) { Swal.fire('Quiebre de Existencias', error.message, 'error'); }
}

async function eliminarFormula() {
    if(!formulaSeleccionadaActual) return;

    const confirm = await Swal.fire({ 
        title: '¿Eliminar formato comercial?', 
        text: "Se borrarán de forma masiva todos los combos y escalas unificadas bajo este nombre.", 
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonColor: '#0a0a0a', 
        confirmButtonText: 'Sí, purgar todo' 
    });
    
    if(confirm.isConfirmed) {
        try {
            const token = localStorage.getItem('token');
            for (const id of formulaSeleccionadaActual.ids) {
                await fetch(`/api/formulas/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            }
            Swal.fire('Catálogo Limpio', 'El formato unificado ha sido purgado por completo.', 'success'); 
            limpiarFormulario(); 
            await cargarTabla(); 
        } catch (e) { console.error(e); }
    }
}