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

// Función auxiliar para buscar o crear un cliente
async function findOrCreateCustomer(client, customerData) {
    const { full_name, id_number, phone, institution } = customerData;
    
    // 1. Buscar cliente por cédula
    let result = await client.query('SELECT id FROM customers WHERE id_number = $1', [id_number]);
    if (result.rows.length > 0) {
        return result.rows[0].id;
    }
    
    // 2. Si no existe, crear uno nuevo
    const insertQuery = 'INSERT INTO customers (full_name, id_number, phone, institution) VALUES ($1, $2, $3, $4) RETURNING id';
    const insertValues = [full_name, id_number, phone || null, institution || null];
    result = await client.query(insertQuery, insertValues);
    return result.rows[0].id;
}


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

// 4. PROCESAR VENTA (MODIFICADA para Crédito)
app.post('/api/sales', async (req, res) => {
    const { items, payment_method, customer_data, is_credit, due_days } = req.body; 
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Iniciar transacción segura

        let totalUsd = 0;

        // 1. Recorrer items para verificar stock y restar
        for (const item of items) {
            totalUsd += parseFloat(item.price_usd) * item.quantity;
            
            // RESTAR STOCK (Atómicamente)
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

        // 2. Manejo de Crédito y Cliente
        let saleStatus = 'PAGADO';
        let customerId = null;
        let dueDate = null;
        
        if (is_credit && customer_data) {
            customerId = await findOrCreateCustomer(client, customer_data);
            saleStatus = 'PENDIENTE';
            
            // Calcular fecha de vencimiento: 15 o 30 días
            const days = due_days === 30 ? 30 : 15;
            dueDate = `CURRENT_TIMESTAMP + INTERVAL '${days} days'`;
        }


        // 3. Calcular Totales
        const totalVes = totalUsd * globalBCVRate;

        // 4. Guardar la Cabecera de la Venta
        const saleQuery = `
            INSERT INTO sales (total_usd, total_ves, bcv_rate_snapshot, payment_method, status, customer_id, due_date) 
            VALUES ($1, $2, $3, $4, $5, $6, ${dueDate || 'NULL'}) RETURNING id
        `;
        const saleValues = [totalUsd, totalVes, globalBCVRate, payment_method, saleStatus, customerId];
        
        const saleResult = await client.query(saleQuery, saleValues);
        const saleId = saleResult.rows[0].id;

        // 5. Guardar los Detalles (Items)
        for (const item of items) {
            await client.query(
                `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_moment_usd) 
                 VALUES ($1, $2, $3, $4)`,
                [saleId, item.product_id, item.quantity, item.price_usd]
            );
        }

        await client.query('COMMIT'); // ¡Confirmar cambios!
        
        console.log(`✅ Venta registrada ID: ${saleId} (Status: ${saleStatus})`);
        res.json({ success: true, saleId, status: saleStatus });

    } catch (error) {
        await client.query('ROLLBACK'); // Si algo falla, deshacer todo
        console.error('❌ Error en venta:', error.message);
        // Devolvemos el mensaje de error al frontend
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});


// --- 5. REPORTES Y ESTADÍSTICAS (Actualizados) ---

// F. Listado de Cuentas por Cobrar (Créditos Pendientes)
app.get('/api/reports/credit-pending', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.id, 
                s.total_usd, 
                s.total_ves,
                s.status,
                s.created_at,
                s.due_date,
                c.full_name,
                c.id_number,
                c.phone,
                c.institution,
                CASE WHEN s.due_date < NOW() THEN TRUE ELSE FALSE END as is_overdue
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.status = 'PENDIENTE'
            ORDER BY s.due_date ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// G. Marcar Crédito como PAGADO
app.post('/api/sales/:id/pay-credit', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            "UPDATE sales SET status = 'PAGADO', payment_method = payment_method || ' + [PAGO CRÉDITO SALDADO]' WHERE id = $1 AND status = 'PENDIENTE' RETURNING id",
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Venta no encontrada o ya pagada.' });
        }
        res.json({ success: true, message: 'Crédito saldado con éxito.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// H. Obtener detalle de una venta específica 
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

// B. Últimas Ventas (Historial reciente) -> MODIFICADO para incluir datos de cliente
app.get('/api/reports/recent-sales', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.id, 
                s.total_usd, 
                s.total_ves, 
                s.payment_method, 
                to_char(s.created_at, 'DD/MM/YYYY HH12:MI AM') as full_date,
                s.status,
                c.full_name,
                c.id_number
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            ORDER BY s.id DESC 
            LIMIT 10
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [Otras rutas de reportes (C, D, E) permanecen inalteradas, se omiten aquí por brevedad]
// Ya que 'low-stock' se utiliza en el frontend, asumimos que existe y funciona correctamente.

// Iniciar Servidor
app.listen(port, () => {
    console.log(`🚀 Servidor BMS corriendo en puerto ${port}`);
});