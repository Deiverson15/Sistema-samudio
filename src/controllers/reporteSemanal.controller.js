const pool = require('../config/db');
const ExcelJS = require('exceljs'); 

// Función interna para formatear fechas de la BD de forma segura e inmune a tipos de datos
const extraerFechaString = (val) => {
    if (!val) return '';
    if (val instanceof Date) {
        return val.toISOString().split('T')[0];
    }
    if (typeof val === 'string') {
        return val.split('T')[0].split(' ')[0];
    }
    return String(val);
};

const getResumenSemanal = async (req, res) => {
    const { fecha_referencia } = req.query; 
    
    try {
        let fechaBase;
        if (fecha_referencia) {
            // FIX CRÍTICO: Romper el string manualmente para evitar el desfase de zona horaria de JavaScript
            const partes = fecha_referencia.split('-'); 
            fechaBase = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
        } else {
            fechaBase = new Date();
        }

        const diaSemana = fechaBase.getDay(); 
        
        const diferenciaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
        const lunes = new Date(fechaBase);
        lunes.setDate(fechaBase.getDate() + diferenciaLunes);
        
        const sabado = new Date(lunes);
        sabado.setDate(lunes.getDate() + 5);

        const fechaInicio = lunes.getFullYear() + '-' + String(lunes.getMonth() + 1).padStart(2, '0') + '-' + String(lunes.getDate()).padStart(2, '0');
        const fechaFin = sabado.getFullYear() + '-' + String(sabado.getMonth() + 1).padStart(2, '0') + '-' + String(sabado.getDate()).padStart(2, '0');

        const cierresRes = await pool.query(`
            SELECT id, total_usd, total_bs, cantidad_ventas, detalles_json, DATE(fecha_cierre) as fecha_dia
            FROM cierres_caja
            WHERE DATE(fecha_cierre) BETWEEN $1 AND $2
            ORDER BY fecha_cierre ASC
        `, [fechaInicio, fechaFin]);

        const diasConCierre = new Set();
        cierresRes.rows.forEach(r => {
            const fechaStr = extraerFechaString(r.fecha_dia);
            if (fechaStr) diasConCierre.add(fechaStr);
        });

        const cantidadDias = diasConCierre.size;
        const cumpleSeisDias = cantidadDias === 6;

        let granTotalUSD = 0;
        let granTotalBs = 0;
        const resumenMap = {};

        cierresRes.rows.forEach(cierre => {
            granTotalUSD += parseFloat(cierre.total_usd || 0);
            granTotalBs += parseFloat(cierre.total_bs || 0);

            const detalles = cierre.detalles_json || {};
            let desglose = [];

            if (Array.isArray(detalles.desglose_pagos)) {
                desglose = detalles.desglose_pagos;
            } else if (detalles.desglose_pagos && Array.isArray(detalles.desglose_pagos.desglose_pagos)) {
                desglose = detalles.desglose_pagos.desglose_pagos;
            } else if (Array.isArray(detalles.desglose_metodos)) {
                desglose = detalles.desglose_metodos;
            }

            desglose.forEach(d => {
                const metodo = (d.metodo || 'Otros').toUpperCase();
                const transacciones = parseInt(d.transacciones || d.cantidad_transacciones || 0);
                const usd = parseFloat(d.total_usd || d.usd || 0);
                const bs = parseFloat(d.total_bs || d.bs || 0);

                if (!resumenMap[metodo]) {
                    resumenMap[metodo] = { metodo, transacciones: 0, total_usd: 0, total_bs: 0 };
                }

                resumenMap[metodo].transacciones += transacciones;
                resumenMap[metodo].total_usd += usd;
                resumenMap[metodo].total_bs += bs;
            });
        });

        res.json({
            rango: { inicio: fechaInicio, fin: fechaFin },
            text_rango: `${fechaInicio.split('-').reverse().join('/')} al ${fechaFin.split('-').reverse().join('/')}`,
            cantidad_dias: cantidadDias,
            cumple_seis_dias: cumpleSeisDias,
            totales: {
                total_usd: granTotalUSD.toFixed(2),
                total_bs: granTotalBs.toFixed(2)
            },
            desglose_metodos: Object.values(resumenMap)
        });

    } catch (error) {
        console.error("Error en resumen semanal:", error);
        res.status(500).json({ error: 'Error interno obteniendo balance semanal' });
    }
};

const exportarExcelSemanal = async (req, res) => {
    const { fecha_inicio, fecha_fin } = req.query;

    try {
        const cierresRes = await pool.query(`
            SELECT total_usd, total_bs, detalles_json
            FROM cierres_caja
            WHERE DATE(fecha_cierre) BETWEEN $1 AND $2
        `, [fecha_inicio, fecha_fin]);

        const resumenMap = {};
        let totalGeneralUSD = 0;
        let totalGeneralBs = 0;
        let totalGeneralTransacciones = 0;

        cierresRes.rows.forEach(cierre => {
            const detalles = cierre.detalles_json || {};
            let desglose = [];

            if (Array.isArray(detalles.desglose_pagos)) {
                desglose = detalles.desglose_pagos;
            } else if (detalles.desglose_pagos && Array.isArray(detalles.desglose_pagos.desglose_pagos)) {
                desglose = detalles.desglose_pagos.desglose_pagos;
            } else if (Array.isArray(detalles.desglose_metodos)) {
                desglose = detalles.desglose_metodos;
            }

            desglose.forEach(d => {
                const metodo = (d.metodo || 'Otros').toUpperCase();
                const transacciones = parseInt(d.transacciones || d.cantidad_transacciones || 0);
                const usd = parseFloat(d.total_usd || d.usd || 0);
                const bs = parseFloat(d.total_bs || d.bs || 0);

                if (!resumenMap[metodo]) {
                    resumenMap[metodo] = { metodo, transacciones: 0, total_usd: 0, total_bs: 0 };
                }

                resumenMap[metodo].transacciones += transacciones;
                resumenMap[metodo].total_usd += usd;
                resumenMap[metodo].total_bs += bs;

                totalGeneralTransacciones += transacciones;
                totalGeneralUSD += usd;
                totalGeneralBs += bs;
            });
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema Fraganza - Auditoría Interna';
        const worksheet = workbook.addWorksheet('Auditoría Semanal', {
            views: [{ showGridLines: true }] 
        });

        worksheet.columns = [
            { key: 'metodo', width: 30 },
            { key: 'transacciones', width: 20 },
            { key: 'total_usd', width: 25 },
            { key: 'total_bs', width: 25 }
        ];

        // ENCABEZADO CORPORATIVO
        worksheet.mergeCells('A2:D2');
        const titleCell = worksheet.getCell('A2');
        titleCell.value = "REPORTE CONSOLIDADO SEMANAL COMERCIAL";
        titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF0F172A' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

        // CORRECCIÓN: Quitamos la palabra "FISCAL"
        worksheet.mergeCells('A3:D3');
        const rangoCell = worksheet.getCell('A3');
        const fInicioClean = fecha_inicio.split('-').reverse().join('/');
        const fFinClean = fecha_fin.split('-').reverse().join('/');
        rangoCell.value = `PERÍODO: Desde el Lunes ${fInicioClean} hasta el Sábado ${fFinClean}`;
        rangoCell.font = { name: 'Arial', size: 10, bold: true, italic: true, color: { argb: 'FF475569' } };

        worksheet.addRow([]); 

        // CABECERA DE TABLA
        const headers = ['MÉTODO DE PAGO', 'CANT. OPERACIONES', 'VOLUMEN TOTAL (USD)', 'VOLUMEN TOTAL (BS)'];
        const headerRow = worksheet.addRow(headers);
        headerRow.height = 28;

        headerRow.eachCell((cell) => {
            cell.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; 
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
                top: { style: 'thin', color: { argb: 'FF1E293B' } }
            };
        });

        const borderFino = {
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        Object.values(resumenMap).forEach((row, index) => {
            const rowData = [
                row.metodo,
                row.transacciones,
                row.total_usd,
                row.total_bs
            ];

            const newRow = worksheet.addRow(rowData);
            newRow.height = 22;

            const esImpar = index % 2 === 1;
            const fondoFila = esImpar ? 'FFF8FAFC' : 'FFFFFFFF'; 

            newRow.eachCell((cell, colNum) => {
                cell.font = { name: 'Arial', size: 10, color: { argb: 'FF334155' } };
                cell.border = borderFino;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fondoFila } };

                if (colNum === 1) {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0F172A' } }; 
                } else if (colNum === 2) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                    cell.numFmt = '#,##0'; 
                } else if (colNum === 3) {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.numFmt = '$#,##0.00'; // Formato de dólar impecable
                } else if (colNum === 4) {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.numFmt = '"Bs. "#,##0.00'; // CORRECCIÓN: Cambiado de $ a Bs. nativo
                }
            });
        });

        // FILA DE TOTALES GENERALES
        const rowTotal = worksheet.addRow([
            'TOTALES GENERALES',
            totalGeneralTransacciones,
            totalGeneralUSD,
            totalGeneralBs
        ]);
        rowTotal.height = 26;

        rowTotal.eachCell((cell, colNum) => {
            cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FF0F172A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; 
            
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF94A3B8' } },
                bottom: { style: 'double', color: { argb: 'FF0F172A' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };

            if (colNum === 1) {
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
            } else if (colNum === 2) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.numFmt = '#,##0';
            } else if (colNum === 3) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '$#,##0.00';
            } else if (colNum === 4) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '"Bs. "#,##0.00'; // CORRECCIÓN: Cambiado de $ a Bs. nativo en Totales
            }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Auditoria_Semanal_${fecha_inicio}_al_${fecha_fin}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Error en Excel Semanal:", error);
        res.status(500).send("Error generando el archivo binario del reporte.");
    }
};

module.exports = { getResumenSemanal, exportarExcelSemanal };