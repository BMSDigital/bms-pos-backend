const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const https = require('https');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Habilitar CORS para que el Frontend pueda conectarse
app.use(cors());
app.use(express.json());

// --- CONEXIÓN A BASE DE DATOS ---
// Usamos process.env.DATABASE_URL que Render nos dará automáticamente
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- LÓGICA DE PRECIOS & SCRAPING BCV ---
let globalBCVRate = 0; // Aquí guardamos la tasa en memoria
const agent = new https.Agent({ rejectUnauthorized: false });

async function actualizarTasaBCV() {
    try {
        console.log('🔄 Buscando tasa BCV...');
        const response = await axios.get('https://www.bcv.org.ve/', { httpsAgent: agent });
        const html = response.data;
        const $ = cheerio.load(html);

        // Selector específico del BCV (puede cambiar si ellos actualizan su web)
        const dollarElement = $('#dolar .centrado strong').first();
        const rateText = dollarElement.text().trim();

        if (rateText) {
            // Limpiar formato (ej: "45,50" -> 45.50)
            const cleanRate = parseFloat(rateText.replace(/\./g, '').replace(/,/g, '.'));
            
            if (!isNaN(cleanRate) && cleanRate > 0) {
                globalBCVRate = cleanRate;
                console.log(`✅ Tasa BCV actualizada: ${globalBCVRate} Bs/$`);
            }
        }
    } catch (error) {
        console.error('⚠️ Error obteniendo BCV (Usando última tasa conocida):', error.message);
    }
}

// Ejecutar al inicio y cada 1 hora
actualizarTasaBCV();
setInterval(actualizarTasaBCV, 3600000);

// --- RUTAS DE LA API (ENDPOINTS) ---

// 1. Estado del Sistema y Tasa
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        bcv_rate: globalBCVRate,
        server_time: new Date()
    });
});

// 2. Obtener Productos (Calculando precio en Bs al vuelo)
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        
        // Aquí aplicamos la ESTRATEGIA DE PRECIOS
        const productsWithVes = result.rows.map(product => ({
            ...product, // Copia datos originales (nombre, precio_usd, etc)
            price_ves: (parseFloat(product.price_usd) * globalBCVRate).toFixed(2) // Calcula Bs
        }));

        res.json(productsWithVes);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// 3. Crear un Producto (Solo para probar que guarda en la BD)
app.post('/api/products', async (req, res) => {
    const { name, category, price_usd, stock } = req.body;
    try {
        const query = 'INSERT INTO products (name, category, price_usd, stock) VALUES ($1, $2, $3, $4) RETURNING *';
        const values = [name, category, price_usd, stock];
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. PROCESAR VENTA (La pieza que faltaba)
app.post('/api/sales', async (req, res) => {
    const { items, payment_method, payment_reference } = req.body; 
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Iniciar transacción segura

        let totalUsd = 0;

        // 1. Recorrer items para verificar stock y restar
        for (const item of items) {
            // Verificar precio actual para seguridad
            // Ojo: En un sistema real verificaríamos el precio de la DB, 
            // aquí confiamos en el del frontend por simplicidad o lo recalculamos.
            
            totalUsd += parseFloat(item.price_usd) * item.quantity;
            
            // RESTAR STOCK (Atómicamente)
            // Esta consulta resta la cantidad SOLO SI hay suficiente stock
            const updateResult = await client.query(
                `UPDATE products 
                 SET stock = stock - $1 
                 WHERE id = $2 AND stock >= $1 
                 RETURNING id`,
                [item.quantity, item.product_id]
            );

            if (updateResult.rowCount === 0) {
                // Si no actualizó nada, es porque no había stock
                throw new Error(`Stock insuficiente para el producto ID ${item.product_id}`);
            }
        }

        // 2. Calcular Totales
        const totalVes = totalUsd * globalBCVRate;

        // 3. Guardar la Cabecera de la Venta
        const saleResult = await client.query(  // <--- AGREGADO
            `INSERT INTO sales (total_usd, total_ves, bcv_rate_snapshot, payment_method, payment_reference) 
				VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [totalUsd, totalVes, globalBCVRate, payment_method, payment_reference || ''] // <--- AGREGADO
        );
        const saleId = saleResult.rows[0].id;

        // 4. Guardar los Detalles (Items)
        for (const item of items) {
            await client.query(
                `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_moment_usd) 
                 VALUES ($1, $2, $3, $4)`,
                [saleId, item.product_id, item.quantity, item.price_usd]
            );
        }

        await client.query('COMMIT'); // ¡Confirmar cambios!
        
        console.log(`✅ Venta registrada ID: ${saleId}`);
        res.json({ success: true, saleId });

    } catch (error) {
        await client.query('ROLLBACK'); // Si algo falla, deshacer todo
        console.error('❌ Error en venta:', error.message);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// --- 5. REPORTES Y ESTADÍSTICAS ---

// A. Resumen del Día (Total vendido hoy)
app.get('/api/reports/daily', async (req, res) => {
    try {
        const client = await pool.connect();
        // Sumamos todas las ventas donde la fecha sea HOY
        const result = await client.query(`
            SELECT 
                COUNT(*) as total_transactions,
                COALESCE(SUM(total_usd), 0) as total_usd,
                COALESCE(SUM(total_ves), 0) as total_ves
            FROM sales 
            WHERE DATE(created_at) = CURRENT_DATE
        `);
        client.release();
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// B. Últimas Ventas (Historial reciente)
app.get('/api/reports/recent-sales', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, total_usd, total_ves, payment_method, payment_reference,
                   to_char(created_at, 'DD/MM/YYYY HH12:MI AM') as full_date 
            FROM sales 
            ORDER BY id DESC 
            LIMIT 10
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// C. Productos con Bajo Stock (Menos de 10 unidades)
app.get('/api/reports/low-stock', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT name, stock 
            FROM products 
            WHERE stock < 10 
            ORDER BY stock ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// D. Obtener detalle de una venta específica (Qué productos se vendieron)
app.get('/api/sales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT p.name, si.quantity, si.price_at_moment_usd
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = $1
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// E. Actualizar Referencia de una Venta (Para agregarla desde el reporte)
app.put('/api/sales/:id/reference', async (req, res) => {
    const { id } = req.params;
    const { reference } = req.body;
    try {
        const client = await pool.connect();
        await client.query(
            'UPDATE sales SET payment_reference = $1 WHERE id = $2',
            [reference, id]
        );
        client.release();
        res.json({ success: true, message: 'Referencia actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Iniciar Servidor
app.listen(port, () => {
    console.log(`🚀 Servidor BMS corriendo en puerto ${port}`);
});