const pool = require('../config/db');


const getTasaBCV = async (req, res) => {
    const EXTERNAL_API = 'https://api.dolarvzla.com/public/exchange-rate';
    
    try {
        const response = await fetch(EXTERNAL_API);
        
        if (!response.ok) {
            throw new Error(`API Externa falló con estado: ${response.status}`);
        }
        
        const data = await response.json();
        const tasaRecibida = data.bcv?.price; 

        if (!tasaRecibida || isNaN(parseFloat(tasaRecibida))) {
            throw new Error("No se pudo encontrar la tasa BCV válida en la respuesta del API externo. Verifique la estructura.");
        }

        res.json({ 
            tasa: parseFloat(tasaRecibida),
            origen: 'DolarVzla API (BCV)',
            actualizacion: new Date().toISOString()
        });

    } catch (error) {
        console.error("Error al obtener la tasa BCV del API externo:", error.message);
        res.status(503).json({ 
            error: error.message,
            fallback_tasa: 36.50,
            origen: 'FALLBACK'
        });
    }
};

module.exports = { getTasaBCV };