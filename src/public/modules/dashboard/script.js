import { VentaService, ProductoService } from '../../js/api.js'; 

let chartDistribucionInstance = null;
let windowFinanzasChartInstance = null;
let dataTopProductos = [];
let dataCategorias = [];

export async function init() {
    console.log("Dashboard Profesional Cargado...");

    try {
        await cargarDatos('7d');

        // Exportar funciones globales
        window.switchChart = switchChart;
        window.cambiarRango = cambiarRango;
        window.abrirModalCritico = abrirModalCritico;
        window.cerrarModalCritico = cerrarModalCritico;
        
        // ¡LISTO! Borramos la línea de "window.navegarA" de aquí 
        // para que use la original de tu router.js

    } catch (e) {
        console.error("Error cargando dashboard:", e);
    }
}

async function cargarDatos(rango) {
    try {
        document.body.style.cursor = 'wait';
        const rangoKPI = rango === '1y' ? '1y' : rango; 

        // 1. Actualizar Etiqueta Visual
        const label = document.getElementById('labelRango');
        if(label) {
            const textos = { '7d': 'Últimos 7 Días', '30d': 'Últimos 30 Días', '1y': 'Año Actual' };
            label.innerHTML = `<i class="fa-regular fa-calendar mr-1"></i> ${textos[rango] || 'Hoy'}`;
        }

        // 2. Fetch Datos
        const [kpis, reportes] = await Promise.all([
            VentaService.getKPIs(rangoKPI),
            VentaService.getReportes(rango)
        ]);

        renderKPIs(kpis, rango);
        
        dataTopProductos = reportes.top_productos || [];
        dataCategorias = reportes.categorias || [];

        // --- CORRECCIÓN CLAVE: RELLENAR DÍAS VACÍOS PARA QUE SE VEA LA LÍNEA ---
        const datosCompletos = completarDatosGrafica(reportes.financiero || [], rango);
        renderFinanzasChart(datosCompletos);
        
        // Refrescar gráfica de distribución
        const btnTop = document.getElementById('btnChartTop');
        if (btnTop && btnTop.classList.contains('bg-white')) {
            renderDistribucionChart(dataTopProductos, 'top');
        } else {
            renderDistribucionChart(dataCategorias, 'cat');
        }

        renderHuesos(reportes.huesos || []);

    } catch (e) {
        console.error("Error cargando dashboard:", e);
    } finally {
        document.body.style.cursor = 'default';
    }
}


// --- FUNCIÓN NUEVA: RELLENAR FECHAS SIN VENTAS CON 0 ---
function completarDatosGrafica(data, rango) {
    const dataMap = new Map(data.map(item => [item.dia, item]));
    const resultados = [];
    const hoy = new Date();
    
    let iteraciones = 7;
    let formato = 'dia'; // 'dia' (DD/MM) o 'mes' (MM/YY)

    if (rango === '30d') iteraciones = 30;
    if (rango === '1y') {
        iteraciones = 12;
        formato = 'mes';
    }

    // Generamos las fechas hacia atrás
    for (let i = iteraciones - 1; i >= 0; i--) {
        const fecha = new Date();
        let label = '';

        if (formato === 'mes') {
            fecha.setMonth(hoy.getMonth() - i);
            const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');
            const anio = fecha.getFullYear().toString().slice(-2);
            label = `${mes}/${anio}`;
        } else {
            fecha.setDate(hoy.getDate() - i);
            const dia = fecha.getDate().toString().padStart(2, '0');
            const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');
            label = `${dia}/${mes}`;
        }

        if (dataMap.has(label)) {
            resultados.push(dataMap.get(label));
        } else {
            // Si no hay datos ese día, metemos 0 para que la línea continúe
            resultados.push({ dia: label, ingreso: 0, utilidad: 0, costo: 0 });
        }
    }
    return resultados;
}

function renderKPIs(kpis, rango) {
    const inv = kpis.inventory || {}; 
    const sales = kpis.sales || {}; 
    const lowStock = kpis.lowStock || {};

    if(document.getElementById('dashLowStock')) 
        document.getElementById('dashLowStock').innerText = lowStock.low_stock_count || 0;
    
    if(document.getElementById('dashValorTotal')) 
        document.getElementById('dashValorTotal').innerText = `$${parseFloat(inv.valor_total_venta || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    
    if(document.getElementById('dashVentasHoy')) 
        document.getElementById('dashVentasHoy').innerText = `$${parseFloat(sales.ventas_hoy || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    
    if(document.getElementById('dashTransacciones')) 
        document.getElementById('dashTransacciones').innerText = sales.transacciones_hoy || 0;

    // Títulos dinámicos
    const labelVentas = document.getElementById('dashLabelVentas');
    if (labelVentas) {
        if (rango === '30d') labelVentas.innerText = "VENTAS (MES)";
        else if (rango === '1y') labelVentas.innerText = "VENTAS (AÑO)";
        else if (rango === '7d') labelVentas.innerText = "VENTAS (7 DÍAS)";
        else labelVentas.innerText = "VENTAS NETAS";
    }

    // Flecha de Tendencia (Corregido para evitar que parezca un punto)
    const ventasActual = parseFloat(sales.ventas_hoy || 0);
    const ventasAnterior = parseFloat(sales.ventas_ayer || 0); 
    const trendEl = document.getElementById('trendArrow');
    const labelVs = document.getElementById('labelVs');

    if (labelVs) labelVs.innerText = rango === 'hoy' ? "vs ayer" : "vs periodo anterior";

    if (trendEl) {
        if (ventasAnterior === 0) {
            // Si no hay ventas anteriores, mostramos 0% o 100% en lugar de "--"
            if(ventasActual > 0) {
                trendEl.innerHTML = `<i class="fa-solid fa-arrow-up"></i> 100%`;
                trendEl.className = "flex items-center gap-1 px-1.5 py-0.5 rounded mr-2 bg-green-100 text-green-700";
            } else {
                trendEl.innerHTML = `<i class="fa-solid fa-minus"></i> 0%`;
                trendEl.className = "flex items-center gap-1 px-1.5 py-0.5 rounded mr-2 bg-gray-100 text-gray-500";
            }
        } else {
            const diff = ((ventasActual - ventasAnterior) / ventasAnterior) * 100;
            const isPositive = diff >= 0;
            trendEl.innerHTML = `<i class="fa-solid fa-arrow-${isPositive ? 'up' : 'down'}"></i> ${Math.abs(diff).toFixed(1)}%`;
            trendEl.className = `flex items-center gap-1 px-1.5 py-0.5 rounded mr-2 ${isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`;
        }
    }
}

function renderFinanzasChart(data) {
    const ctx = document.getElementById('dashFinanzasChart');
    if (!ctx) return;

    if (windowFinanzasChartInstance) {
        windowFinanzasChartInstance.destroy();
        windowFinanzasChartInstance = null;
    }

    windowFinanzasChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: data.map(d => d.dia),
            datasets: [
                {
                    label: 'Utilidad Neta',
                    data: data.map(d => d.utilidad),
                    type: 'line',
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#10b981',
                    pointRadius: 4, 
                    pointHoverRadius: 6,
                    tension: 0.3, // Curvatura suave de la línea
                    fill: true,
                    order: 0
                },
                {
                    label: 'Ventas Totales',
                    data: data.map(d => d.ingreso),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4,
                    barPercentage: 0.6,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10,
                    callbacks: { label: (ctx) => `${ctx.dataset.label}: $${parseFloat(ctx.raw).toFixed(2)}` }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } },
                x: { grid: { display: false } }
            }
        }
    });
}

function switchChart(type) {
    const btnTop = document.getElementById('btnChartTop');
    const btnCat = document.getElementById('btnChartCat');

    if (type === 'top') {
        renderDistribucionChart(dataTopProductos, 'top');
        btnTop.classList.add('bg-white', 'text-gray-800', 'shadow');
        btnTop.classList.remove('text-gray-500');
        btnCat.classList.remove('bg-white', 'text-gray-800', 'shadow');
        btnCat.classList.add('text-gray-500');
    } else {
        renderDistribucionChart(dataCategorias, 'cat');
        btnCat.classList.add('bg-white', 'text-gray-800', 'shadow');
        btnCat.classList.remove('text-gray-500');
        btnTop.classList.remove('bg-white', 'text-gray-800', 'shadow');
        btnTop.classList.add('text-gray-500');
    }
}

function renderDistribucionChart(data, type) {
    const ctx = document.getElementById('dashDistribucionChart');
    if (!ctx) return;

    if (chartDistribucionInstance) {
        chartDistribucionInstance.destroy();
    }

    if (!data || data.length === 0) return; 

    const labels = type === 'top' ? data.map(d => d.nombre) : data.map(d => d.categoria);
    const values = data.map(d => parseFloat(d.total_vendido));
    
    chartDistribucionInstance = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%', 
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 }, usePointStyle: true } }
            }
        }
    });
}

function renderHuesos(huesos) {
    const tbody = document.getElementById('tablaHuesos');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (huesos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-green-600 font-medium">Todo excelente.</td></tr>`;
        return;
    }

    huesos.forEach(p => {
        const dineroDormido = (parseFloat(p.stock_unidades) * parseFloat(p.precio_venta)).toFixed(2);
        tbody.innerHTML += `
            <tr class="border-b hover:bg-orange-50 transition">
                <td class="px-4 py-3 font-medium text-gray-800">${p.nombre}</td>
                <td class="px-4 py-3"><span class="bg-gray-100 text-gray-600 py-1 px-2 rounded text-xs">${p.categoria}</span></td>
                <td class="px-4 py-3 text-center font-bold text-red-500">${p.stock_unidades} u.</td>
                <td class="px-4 py-3 text-center text-gray-500">$${dineroDormido}</td>
                <td class="px-4 py-3 text-right">
                    <span class="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded font-bold cursor-help" title="Producto sin movimiento">
                        <i class="fa-regular fa-bell mr-1"></i> Revisar
                    </span>
                </td>
            </tr>
        `;
    });
}

async function abrirModalCritico() {
    const modal = document.getElementById('modalCritico');
    const tbody = document.getElementById('listaCriticos');
    
    if(!modal) return;
    
    modal.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4">Cargando datos...</td></tr>';

    try {
        // 1. OBTENER TOKEN
        const token = localStorage.getItem('token'); 

        if (!token) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-500">Sesión no iniciada.</td></tr>';
            return;
        }

        // 2. PETICIÓN CON EL FORMATO CORRECTO (Bearer)
        const response = await fetch('/api/productos?bajoStock=true&limit=100', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // <--- CORRECCIÓN CRÍTICA: Se agregó `Bearer ` antes del token
            }
        });

        // Manejo de errores de permisos (401/403)
        if (response.status === 403 || response.status === 401) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-500 font-bold"><i class="fa-solid fa-lock mr-2"></i> Acceso Denegado. Revisa tus permisos.</td></tr>';
            return;
        }

        const resultado = await response.json();
        
        tbody.innerHTML = '';
        
        if (!resultado.data || resultado.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-green-600 font-bold">¡Todo en orden! No hay alertas.</td></tr>';
            return;
        }

        resultado.data.forEach(prod => {
            const stock = parseFloat(prod.stock_real);
            const min = parseFloat(prod.stock_minimo);
            const deficit = (min - stock).toFixed(0);

            tbody.innerHTML += `
                <tr>
                    <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-900">${prod.nombre}</td>
                    <td class="px-3 py-2 whitespace-nowrap text-sm text-red-600 font-bold text-center">${stock}</td>
                    <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-center">${min}</td>
                    <td class="px-3 py-2 whitespace-nowrap text-sm text-orange-600 font-bold text-center">-${deficit}</td>
                </tr>
            `;
        });

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-500">Error de conexión.</td></tr>';
    }
}

function cerrarModalCritico() {
    const modal = document.getElementById('modalCritico');
    if(modal) modal.classList.add('hidden');
}


// 1. ÚNICA FUNCIÓN DE FILTRADO (Asegúrate de que no haya otra llamada igual en este archivo)
window.cambiarRango = async function(valor) {
    console.log("🔄 Ejecutando filtro para:", valor);

    let urlReportes = `/api/ventas/reportes?rango=${valor}`;
    let urlKPIs = `/api/ventas/dashboard-kpis?rango=${valor}`;

    // A. INTERCEPCIÓN DEL RANGO PERSONALIZADO
    if (valor === 'custom') {
        console.log("🛠️ Levantando modal flotante corporativo...");
        
        try {
            const { value: formValues } = await Swal.fire({
                title: 'FILTRAR POR PERÍODO',
                html: `
                    <div class="flex flex-col gap-4 text-left p-2">
                        <div class="flex flex-col">
                            <label class="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1">Fecha de Inicio</label>
                            <input id="swal-start" type="date" class="border border-neutral-300 p-2 text-xs font-semibold bg-neutral-50 rounded-none outline-none focus:border-neutral-950">
                        </div>
                        <div class="flex flex-col">
                            <label class="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1">Fecha de Cierre</label>
                            <input id="swal-end" type="date" class="border border-neutral-300 p-2 text-xs font-semibold bg-neutral-50 rounded-none outline-none focus:border-neutral-950">
                        </div>
                    </div>
                `,
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'APLICAR FILTRO',
                cancelButtonText: 'CANCELAR',
                confirmButtonColor: '#0f172a', // Tu color original neutro
                cancelButtonColor: '#94a3b8',
                customClass: {
                    popup: 'rounded-none border border-neutral-400',
                    confirmButton: 'rounded-none text-xs font-bold tracking-widest uppercase py-3 px-6',
                    cancelButton: 'rounded-none text-xs font-bold tracking-widest uppercase py-3 px-6'
                },
                preConfirm: () => {
                    const start = document.getElementById('swal-start').value;
                    const end = document.getElementById('swal-end').value;
                    if (!start || !end) {
                        Swal.showValidationMessage('Debes ingresar ambas fechas para continuar.');
                        return false;
                    }
                    return { start, end };
                }
            });

            if (!formValues) {
                console.log("❌ Filtro cancelado por el usuario.");
                document.getElementById('rangoTiempo').value = '7d';
                return;
            }

            console.log("✅ Fechas capturadas con éxito:", formValues.start, "al", formValues.end);

            urlReportes = `/api/ventas/reportes?start=${formValues.start}&end=${formValues.end}`;
            urlKPIs = `/api/ventas/dashboard-kpis?rango=custom&start=${formValues.start}&end=${formValues.end}`;
            
            const labelRango = document.getElementById('labelRango');
            if (labelRango) {
                labelRango.innerHTML = `<i class="fa-regular fa-calendar mr-2"></i> ${formValues.start.split('-').reverse().join('/')} AL ${formValues.end.split('-').reverse().join('/')}`;
            }
        } catch (swalError) {
            console.error("Error al abrir SweetAlert2:", swalError);
            return;
        }
    } else {
        const labelRango = document.getElementById('labelRango');
        if (labelRango) {
            const textoRango = valor === '7d' ? 'ÚLTIMOS 7 DÍAS' : valor === '30d' ? 'ÚLTIMOS 30 DÍAS' : 'ESTE AÑO';
            labelRango.innerHTML = `<i class="fa-regular fa-calendar mr-2"></i> ${textoRango}`;
        }
    }

    // B. PETICIÓN AL BACKEND
    try {
        const token = localStorage.getItem('token');
        const headers = { 'Authorization': `Bearer ${token}` };

        console.log("📡 Solicitando datos al servidor...");
        const [resReportes, resKPIs] = await Promise.all([
            fetch(urlReportes, { headers }),
            fetch(urlKPIs, { headers })
        ]);

        const dataReportes = await resReportes.json();
        const dataKPIs = await resKPIs.json();

        // C. ENTREGA DE DATOS A TUS FUNCIONES (Diseño Intacto)
        if (resReportes.ok) {
            console.log("📊 Datos recibidos, limpiando lienzos para repintar...");
            
            // Scroll Técnico
            const viewport = document.getElementById('canvasViewport');
            if (viewport && dataReportes.financiero) {
                const cantidadPuntos = dataReportes.financiero.length;
                if (cantidadPuntos > 12) {
                    viewport.style.width = `${cantidadPuntos * 55}px`;
                } else {
                    viewport.style.width = '100%';
                }
            }

            // Destrucción limpia de los Canvas para evitar errores de Chart.js
            const chartFinanzasViejo = Chart.getChart("dashFinanzasChart");
            if (chartFinanzasViejo) chartFinanzasViejo.destroy();

            const chartDistribucionViejo = Chart.getChart("dashDistribucionChart");
            if (chartDistribucionViejo) chartDistribucionViejo.destroy();

            // ALIMENTAMOS TUS FUNCIONES ORIGINALES EXACTAS
            if (typeof renderFinanzasChart === 'function') {
                renderFinanzasChart(dataReportes.financiero);
            }
            if (typeof renderDistribucionChart === 'function') {
                renderDistribucionChart(dataReportes.categorias, dataReportes.top_productos);
            }
            if (typeof renderHuesosTable === 'function') {
                renderHuesosTable(dataReportes.huesos);
            }
        }

        // D. ACTUALIZACIÓN DE TARJETAS SUPERIORES Y NUEVOS MÓDULOS
        if (resKPIs.ok && dataKPIs.sales) {
            // Tarjetas Originales
            document.getElementById('dashVentasHoy').innerText = `$${parseFloat(dataKPIs.sales.ventas_hoy).toFixed(2)}`;
            document.getElementById('dashTransacciones').innerText = dataKPIs.sales.transacciones_hoy;
            
            const trendArrow = document.getElementById('trendArrow');
            if (trendArrow) {
                const actual = parseFloat(dataKPIs.sales.ventas_hoy || 0);
                const previo = parseFloat(dataKPIs.sales.ventas_ayer || 0);
                if (actual >= previo) {
                    trendArrow.innerHTML = `<i class="fa-solid fa-arrow-up text-green-600"></i>`;
                } else {
                    trendArrow.innerHTML = `<i class="fa-solid fa-arrow-down text-red-600"></i>`;
                }
            }
            if (dataKPIs.lowStock) {
                document.getElementById('dashLowStock').innerText = dataKPIs.lowStock.low_stock_count;
            }

            // Tarjetas Financieras
            if (dataKPIs.inventory) {
                // Capital en Stock Normal
                document.getElementById('dashValorTotal').innerText = `$${parseFloat(dataKPIs.inventory.valor_total_venta).toFixed(2)}`;
                
                // 🔥 NUEVO: Capital Estancado (+30 Días)
                const capTotal = parseFloat(dataKPIs.inventory.valor_total_venta) || 0;
                const capEstancado = parseFloat(dataKPIs.inventory.capital_estancado) || 0;
                
                const elEstancado = document.getElementById('dashCapitalEstancado');
                if(elEstancado) elEstancado.innerText = `$${capEstancado.toFixed(2)}`;
                
                let porcentaje = 0;
                if (capTotal > 0) porcentaje = (capEstancado / capTotal) * 100;
                
                const barraEst = document.getElementById('barraEstancado');
                if(barraEst) barraEst.style.width = `${porcentaje}%`;
                
                const porcEst = document.getElementById('dashPorcentajeEstancado');
                if(porcEst) porcEst.innerText = `${porcentaje.toFixed(1)}% del total`;
            }
            
            // 🔥 NUEVO: Distribución de Ventas (Top Rendimiento)
            if (dataKPIs.ranking) {
                window.datosRankingGlobal = dataKPIs.ranking; // Guardamos en memoria global
                window.renderizarMiniRanking(); // Llamamos a la función que dibuja el Podio
            }
        }
    } catch (error) {
        console.error("🚨 Error de conexión o proceso:", error);
    }
};

// 2. PARCHE DE ARRANQUE PARA SPA (Asegura la escucha de tu HTML original)
setTimeout(() => {
    const selectorRango = document.getElementById('rangoTiempo');
    if (selectorRango) {
        // Enlaza el evento forzosamente a nuestra función global
        selectorRango.addEventListener('change', function(e) {
            window.cambiarRango(e.target.value);
        });
    }
}, 400);

let chartFinanzas = null;
let chartDistribucion = null;
let datosDistribucionActual = { top: [], cat: [] };
let vistaDistribucionActual = 'top'; // Controla si vemos 'top' o 'categorías'

// =====================================================================
// 1. RENDERIZADO DE GRÁFICA PRINCIPAL (Desempeño Financiero)
// =====================================================================
window.renderizarGraficaFinanzas = function(datos) {
    if (chartFinanzas) {
        chartFinanzas.destroy();
    }

    const ctx = document.getElementById('dashFinanzasChart').getContext('2d');
    chartFinanzas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: datos.map(item => item.dia),
            datasets: [
                {
                    label: 'Ingreso Bruto ($)',
                    data: datos.map(item => item.ingreso),
                    backgroundColor: '#0a0a0a', // Negro puro corporativo
                    borderWidth: 0,
                    borderRadius: 2
                },
                {
                    label: 'Costo / Inversión ($)',
                    data: datos.map(item => item.costo),
                    backgroundColor: '#d4d4d4', // Gris neutro claro
                    borderWidth: 0,
                    borderRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: '#f5f5f5' } },
                x: { grid: { display: false } }
            },
            plugins: {
                legend: { 
                    position: 'top',
                    labels: { font: { family: 'Inter', size: 10, weight: 'bold' }, color: '#171717' } 
                }
            }
        }
    });
};

// =====================================================================
// 2. RENDERIZADO DE GRÁFICA SECUNDARIA (Distribución - Dona)
// =====================================================================
window.renderizarDistribucion = function(categorias, topProductos) {
    // Guardamos los datos en memoria para poder alternar entre botones
    datosDistribucionActual.cat = categorias;
    datosDistribucionActual.top = topProductos;
    window.actualizarGraficaDistribucion();
};

window.switchChart = function(tipo) {
    vistaDistribucionActual = tipo;
    
    // Cambiamos los estilos de los botones (Activo vs Inactivo) respetando tu HTML
    const btnTop = document.getElementById('btnChartTop');
    const btnCat = document.getElementById('btnChartCat');
    
    const claseActiva = "px-4 py-1 text-[10px] font-bold bg-white text-neutral-900 shadow-sm border border-neutral-300 uppercase tracking-widest transition rounded-none";
    const claseInactiva = "px-4 py-1 text-[10px] font-bold text-neutral-500 hover:text-neutral-900 uppercase tracking-widest transition rounded-none";

    btnTop.className = tipo === 'top' ? claseActiva : claseInactiva;
    btnCat.className = tipo === 'cat' ? claseActiva : claseInactiva;

    window.actualizarGraficaDistribucion();
};

window.actualizarGraficaDistribucion = function() {
    if (chartDistribucion) {
        chartDistribucion.destroy();
    }

    const ctx = document.getElementById('dashDistribucionChart').getContext('2d');
    const esTop = vistaDistribucionActual === 'top';
    const dataAUsar = esTop ? datosDistribucionActual.top : datosDistribucionActual.cat;
    
    const labels = dataAUsar.map(d => esTop ? d.nombre : d.categoria);
    const values = dataAUsar.map(d => parseFloat(d.total_vendido || 0));

    // Paleta de colores monocromática (Gama de grises y negros)
    const paletaMonocromatica = ['#0a0a0a', '#262626', '#525252', '#a3a3a3', '#e5e5e5'];

    chartDistribucion = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: paletaMonocromatica,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%', // Hace que la dona sea delgada y elegante
            plugins: {
                legend: { 
                    position: 'right', 
                    labels: { font: { family: 'Inter', size: 9, weight: 'bold' }, color: '#525252' } 
                }
            }
        }
    });
};

// =====================================================================
// 3. RENDERIZADO DE TABLA DE ESTANCAMIENTO (Productos Hueso)
// =====================================================================
window.renderizarTablaHuesos = function(productos) {
    const tbody = document.getElementById('tablaHuesos');
    if (!tbody) return;

    if (!productos || productos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-neutral-500 text-xs font-bold uppercase tracking-widest">Inventario con rotación saludable. No hay estancamiento.</td></tr>`;
        return;
    }

    tbody.innerHTML = productos.map(p => {
        const dineroDormido = parseFloat(p.stock_unidades || 0) * parseFloat(p.precio_venta || 0);
        return `
            <tr class="hover:bg-neutral-50 transition-colors border-b border-neutral-100">
                <td class="px-6 py-4 font-black text-neutral-950">${p.nombre}</td>
                <td class="px-6 py-4 text-neutral-500 text-[10px] font-bold uppercase tracking-widest">${p.categoria}</td>
                <td class="px-6 py-4 text-center font-bold">${parseFloat(p.stock_unidades).toFixed(0)} u</td>
                <td class="px-6 py-4 text-center font-black text-neutral-950">$${dineroDormido.toFixed(2)}</td>
                <td class="px-6 py-4 text-right">
                    <span class="px-3 py-1 text-[9px] font-black bg-neutral-200 text-neutral-800 uppercase tracking-widest rounded-none border border-neutral-300">
                        Dormido
                    </span>
                </td>
            </tr>
        `;
    }).join('');
};

// =====================================================================
// 4. MANEJO DEL MODAL DE STOCK CRÍTICO
// =====================================================================
window.abrirModalCritico = async function() {
    const modal = document.getElementById('modalCritico');
    if (modal) modal.classList.remove('hidden');

    try {
        const token = localStorage.getItem('token');
        // Consulta rápida a tu endpoint de productos filtrando por bajo stock
        const res = await fetch('/api/productos?bajoStock=true&limit=50', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        const tbody = document.getElementById('listaCriticos');
        if (tbody) {
            if (data.data && data.data.length > 0) {
                tbody.innerHTML = data.data.map(p => {
                    const deficit = parseFloat(p.stock_minimo) - parseFloat(p.stock_real);
                    return `
                    <tr class="hover:bg-neutral-50">
                        <td class="px-6 py-4 font-bold text-[10px] uppercase text-neutral-900">${p.nombre}</td>
                        <td class="px-6 py-4 text-center text-[10px] font-black text-red-600">${parseFloat(p.stock_real).toFixed(2)}</td>
                        <td class="px-6 py-4 text-center text-[10px] font-bold text-neutral-500">${parseFloat(p.stock_minimo).toFixed(2)}</td>
                        <td class="px-6 py-4 text-center text-[10px] font-black text-neutral-950">-${deficit.toFixed(2)}</td>
                    </tr>`;
                }).join('');
            } else {
                tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-[10px] font-bold uppercase tracking-widest text-neutral-400">No hay déficit crítico detectado</td></tr>`;
            }
        }
    } catch (e) {
        console.error("Error cargando modal crítico:", e);
    }
};

window.cerrarModalCritico = function() {
    const modal = document.getElementById('modalCritico');
    if (modal) modal.classList.add('hidden');
};

// =====================================================================
// 5. INICIALIZACIÓN AUTOMÁTICA
// =====================================================================
// Arranca el dashboard solicitando los últimos 7 días automáticamente
document.addEventListener('DOMContentLoaded', () => {
    window.cambiarRango('7d');
});
// Si tu sistema usa inyección dinámica (SPA) y el DOM ya cargó, forzamos la llamada directa:
window.cambiarRango('7d');


// =====================================================================
// 🔥 NUEVO MÓDULO: RANKING Y DISTRIBUCIÓN DE VENTAS
// =====================================================================
window.datosRankingGlobal = []; // Array que almacena la consulta de base de datos

window.renderizarMiniRanking = function() {
    const filtro = document.getElementById('filtroRankingVentas').value; // Lee si dice 'top' o 'bottom'
    const listaEl = document.getElementById('listaMiniRanking');
    if(!listaEl) return;

    if (!window.datosRankingGlobal || window.datosRankingGlobal.length === 0) {
        listaEl.innerHTML = '<li class="text-[10px] text-neutral-500 uppercase tracking-widest text-center mt-4">Sin ventas registradas en este periodo.</li>';
        return;
    }

    // Clonar arreglo para evitar alterar la tabla original del modal
    let datos = [...window.datosRankingGlobal];
    
    // Si eligen "Menos Vendidas", invertimos el array
    if (filtro === 'bottom') {
        datos.reverse(); 
    }

    // Cortamos solo los 3 primeros para que quepan perfectos en la tarjeta negra
    const top3 = datos.slice(0, 3);
    
    listaEl.innerHTML = top3.map((p, i) => {
        const indexStr = filtro === 'top' ? `#${i+1}` : `🔻`;
        const indexColor = filtro === 'top' ? 'text-emerald-400' : 'text-red-400';
        return `
            <li class="flex justify-between items-center border-b border-neutral-800 pb-2">
                <div class="flex items-center gap-3">
                    <span class="text-sm font-black ${indexColor}">${indexStr}</span>
                    <div>
                        <p class="text-xs font-bold text-white uppercase">${p.nombre}</p>
                        <p class="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">${p.categoria || 'S/N'}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-xs font-black text-emerald-400">${parseFloat(p.cantidad_vendida).toFixed(0)} <span class="text-[9px] text-emerald-700">uds</span></p>
                    <p class="text-[9px] font-bold text-neutral-400">$${parseFloat(p.total_generado).toFixed(2)}</p>
                </div>
            </li>
        `;
    }).join('');
};

window.abrirModalRanking = function() {
    const modal = document.getElementById('modalRanking');
    const tbody = document.getElementById('listaModalRanking');
    if(!modal || !tbody) return;

    modal.classList.remove('hidden');

    if (!window.datosRankingGlobal || window.datosRankingGlobal.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-[10px] text-neutral-500 uppercase tracking-widest">No hay datos de distribución disponibles.</td></tr>';
        return;
    }

    // Dibuja la tabla completa siempre desde la #1 hasta la última
    tbody.innerHTML = window.datosRankingGlobal.map((p, i) => {
        return `
            <tr class="hover:bg-neutral-50 transition-colors">
                <td class="px-6 py-3 text-center text-xs font-black text-neutral-400">#${i+1}</td>
                <td class="px-6 py-3 text-xs font-bold text-neutral-900 uppercase">${p.nombre}</td>
                <td class="px-6 py-3 text-center text-[10px] font-bold text-neutral-500 uppercase tracking-widest">${p.categoria || 'S/N'}</td>
                <td class="px-6 py-3 text-center text-xs font-black text-emerald-600">${parseFloat(p.cantidad_vendida).toFixed(0)} uds</td>
                <td class="px-6 py-3 text-right text-xs font-black text-neutral-950">$${parseFloat(p.total_generado).toFixed(2)}</td>
            </tr>
        `;
    }).join('');
};

window.cerrarModalRanking = function() {
    const modal = document.getElementById('modalRanking');
    if(modal) modal.classList.add('hidden');
};