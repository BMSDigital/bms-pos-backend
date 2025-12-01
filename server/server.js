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
const FALLBACK_RATE = 40.00; // Tasa de reserva en caso de fallo crítico
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
            } else {
                // FALLBACK 1: Tasa extraída no es válida
                console.warn('⚠️ Error: Tasa BCV extraída no es un número válido (> 0). Usando última conocida o FALLBACK.');
                if (globalBCVRate === 0) {
                    globalBCVRate = FALLBACK_RATE;
                    console.log(`✅ Usando tasa de FALLBACK: ${globalBCVRate} Bs/$`);
                }
            }
        } else {
             // FALLBACK 2: Selector falló
            console.warn('⚠️ Error: No se encontró el elemento de la tasa BCV. Usando última conocida o FALLBACK.');
             if (globalBCVRate === 0) {
                globalBCVRate = FALLBACK_RATE;
                console.log(`✅ Usando tasa de FALLBACK: ${globalBCVRate} Bs/$`);
            }
        }
    } catch (error) {
         // FALLBACK 3: Fallo de conexión o request
        console.error('⚠️ Error obteniendo BCV (Usando última tasa conocida o FALLBACK):', error.message);
        if (globalBCVRate === 0) {
            globalBCVRate = FALLBACK_RATE;
            console.log(`✅ Usando tasa de FALLBACK: ${globalBCVRate} Bs/$`);
        }
    }
}

// Ejecutar al inicio y cada 1 hora
actualizarTasaBCV();
setInterval(actualizarTasaBCV, 3600000);

// --- RUTAS DE LA API (ENDPOINTS) ---

// Función auxiliar para buscar o crear un cliente
async function findOrCreateCustomer(client, customerData) {
    const { full_name, id_number, phone, institution } = customerData;
    
    // 1. Buscar cliente por identificador (Ahora solo busca clientes ACTIVO)
    let result = await client.query("SELECT id FROM customers WHERE id_number = $1 AND status = 'ACTIVO'", [id_number]);
    if (result.rows.length > 0) {
        return result.rows[0].id;
    }
    
    // 2. Si no existe, crear uno nuevo (Se inserta como ACTIVO por defecto)
    const insertQuery = 'INSERT INTO customers (full_name, id_number, phone, institution, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id_number) DO UPDATE SET full_name = $1, phone = $3, institution = $4, status = $5 RETURNING id';
    const insertValues = [full_name, id_number, phone || null, institution || null, 'ACTIVO'];
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
            // El backend intenta buscar/crear al cliente incluso si la búsqueda inicial falló en el frontend.
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
// ... (El resto de rutas de reportes y sales/:id se mantienen)
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
    const { paymentDetails } = req.body; // Nuevo detalle de pago
    
    try {
        const result = await pool.query(
            "UPDATE sales SET status = 'PAGADO', payment_method = payment_method || ' + [PAGO SALDADO: ' || $2 || ']' WHERE id = $1 AND status = 'PENDIENTE' RETURNING id",
            [id, paymentDetails]
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

// C. NUEVO: Alertas de Stock Bajo (Resuelve el 404 del log)
app.get('/api/reports/low-stock', async (req, res) => {
    try {
        // FIX: Se incluye stock <= 10 (incluyendo 0)
        const result = await pool.query(`
            SELECT id, name, stock, category
            FROM products
            WHERE stock <= 10
            ORDER BY stock ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error al obtener stock bajo:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ====================================================================
// --- RUTAS: MÓDULO DE CLIENTES (Gestión de Clientes) ---
// ====================================================================

// A. Listar Clientes
app.get('/api/customers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY full_name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al listar clientes' });
    }
});

// B. Crear/Actualizar Cliente (Punto 4: Modificación/Edición)
app.post('/api/customers', async (req, res) => {
    const { id, full_name, id_number, phone, institution, status } = req.body;
    
    // Asumimos que las validaciones complejas de formato se hacen en el frontend
    if (!full_name || !id_number || !status) {
        return res.status(400).json({ error: 'Nombre, Identificador y Estatus son obligatorios.' });
    }
    
    try {
        let result;
        if (id) {
            // Actualizar cliente existente
            const query = 'UPDATE customers SET full_name = $1, id_number = $2, phone = $3, institution = $4, status = $5 WHERE id = $6 RETURNING *';
            const values = [full_name, id_number, phone, institution, status, id];
            result = await pool.query(query, values);
            if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        } else {
            // Crear nuevo cliente (usando ON CONFLICT para manejar ID_NUMBER ya existentes)
            const query = `
                INSERT INTO customers (full_name, id_number, phone, institution, status) 
                VALUES ($1, $2, $3, $4, $5) 
                ON CONFLICT (id_number) DO UPDATE 
                SET full_name = $1, phone = $3, institution = $4, status = $5
                RETURNING *`;
            const values = [full_name, id_number, phone, institution, status];
            result = await pool.query(query, values);
        }
        res.json(result.rows[0]);

    } catch (err) {
        // Manejo de errores de base de datos
        res.status(500).json({ error: `Error DB al guardar cliente: ${err.message}` });
    }
});

// C. Búsqueda de Cliente (Corregida la variable searchQuery)
app.get('/api/customers/search', async (req, res) => {
    const { query } = req.query; 
    if (!query) {
        return res.status(400).json({ error: 'El parámetro "query" es requerido.' });
    }
    
    // Corregido: La variable searchQuery debe ser definida aquí
    const searchQuery = `%${query.toLowerCase()}%`; 

    try {
        const result = await pool.query(
            `SELECT id, full_name, id_number, phone, institution 
             FROM customers 
             WHERE (LOWER(id_number) LIKE $1 OR LOWER(full_name) LIKE $1)
             AND status = 'ACTIVO'
             ORDER BY full_name ASC 
             LIMIT 10`,
            [searchQuery]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error al buscar cliente:', err);
        res.status(500).json({ error: 'Error al buscar cliente' });
    }
});


// Iniciar Servidor
app.listen(port, () => {
    console.log(`🚀 Servidor BMS corriendo en puerto ${port}`);
});