process.env.TZ = 'America/Caracas';
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

// ESTO ES NUEVO: Cada vez que se use la base de datos, forzamos la hora de Vzla
pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'America/Caracas'", (err) => {
        if (err) console.error('Error configurando Timezone DB:', err);
    });
});

// --- LÓGICA DE PRECIOS & SCRAPING BCV ---
let globalBCVRate = 0; // Aquí guardamos la tasa en memoria
const FALLBACK_RATE = 40.00; // Tasa de reserva en caso de fallo crítico
const IVA_RATE = 0.16; // Tasa de IVA estándar para cálculo en backend
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
                console.warn('⚠️ Error: Tasa BCV extraída no es válida. Usando FALLBACK.');
                if (globalBCVRate === 0) globalBCVRate = FALLBACK_RATE;
            }
        } else {
            console.warn('⚠️ Error: Selector BCV falló. Usando FALLBACK.');
             if (globalBCVRate === 0) globalBCVRate = FALLBACK_RATE;
        }
    } catch (error) {
        console.error('⚠️ Error obteniendo BCV:', error.message);
        if (globalBCVRate === 0) globalBCVRate = FALLBACK_RATE;
    }
}

// Ejecutar al inicio y cada 1 hora
actualizarTasaBCV();
setInterval(actualizarTasaBCV, 3600000);

// --- FUNCIONES AUXILIARES ---
async function findOrCreateCustomer(client, customerData) {
    const { full_name, id_number, phone, institution } = customerData;
    let result = await client.query("SELECT id FROM customers WHERE id_number = $1 AND status = 'ACTIVO'", [id_number]);
    if (result.rows.length > 0) return result.rows[0].id;
    
    const insertQuery = 'INSERT INTO customers (full_name, id_number, phone, institution, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id_number) DO UPDATE SET full_name = $1, phone = $3, institution = $4, status = $5 RETURNING id';
    const insertValues = [full_name, id_number, phone || null, institution || null, 'ACTIVO'];
    result = await client.query(insertQuery, insertValues);
    return result.rows[0].id;
}

// --- RUTAS DE LA API (ENDPOINTS) ---

// 1. Estado del Sistema
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        bcv_rate: globalBCVRate,
        fallback_rate: FALLBACK_RATE,
        server_time: new Date()
    });
});

// 2. Obtener Productos (CORREGIDO: AHORA INCLUYE STATUS Y BARCODE)
app.get('/api/products', async (req, res) => {
    try {
        // AGREGAMOS 'barcode' y 'status' A LA LISTA DE CAMPOS SELECCIONADOS
        const result = await pool.query('SELECT id, name, category, price_usd, stock, icon_emoji, is_taxable, barcode, status FROM products ORDER BY id ASC');
        
        const productsWithVes = result.rows.map(product => ({
            ...product,
            price_ves: (parseFloat(product.price_usd) * globalBCVRate).toFixed(2),
            // Aseguramos que si el status viene nulo (productos viejos), se trate como ACTIVE
            status: product.status || 'ACTIVE' 
        }));
        
        res.json(productsWithVes);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// 3. Crear/Actualizar Producto (CORREGIDO)
app.post('/api/products', async (req, res) => {
    // 1. Extraemos TODOS los campos del body
    const { id, name, category, price_usd, stock, icon_emoji, is_taxable, barcode, status } = req.body;
    
    // Validaciones básicas
    if (!name || !price_usd || price_usd <= 0) return res.status(400).json({ error: 'Datos inválidos.' });
    
    try {
        let result;
        // Convertimos is_taxable a booleano real
        const isTaxableValue = typeof is_taxable === 'boolean' ? is_taxable : (is_taxable === 'true');
        
        // --- AQUÍ ESTABA EL ERROR ---
        // Si 'status' viene en el body, lo usamos. Si no, usamos 'ACTIVE' por defecto.
        // Antes quizás se estaba forzando 'ACTIVE' siempre.
        const statusValue = status ? status : 'ACTIVE'; 
        
        // Barcode opcional
        const barcodeValue = barcode || '';

        if (id) {
            // UPDATE: Asegúrate de que el orden de los signos $ coincida con el array de valores
            const query = `
                UPDATE products 
                SET name = $1, category = $2, price_usd = $3, stock = $4, icon_emoji = $5, is_taxable = $6, barcode = $7, status = $8 
                WHERE id = $9 RETURNING *`;
            
            const values = [name, category || null, price_usd, stock || 0, icon_emoji || '🍔', isTaxableValue, barcodeValue, statusValue, id];
            
            result = await pool.query(query, values);
            
            if (result.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
        } else {
            // INSERT
            const query = `
                INSERT INTO products (name, category, price_usd, stock, icon_emoji, is_taxable, barcode, status) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;
                
            const values = [name, category || null, price_usd, stock || 0, icon_emoji || '🍔', isTaxableValue, barcodeValue, statusValue];
            
            result = await pool.query(query, values);
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err); // Importante para ver errores en la consola del servidor
        res.status(500).json({ error: err.message });
    }
});

// 4. PROCESAR VENTA
app.post('/api/sales', async (req, res) => {
    const { items, payment_method, customer_data, is_credit, due_days, invoice_type } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        let subtotalTaxableUsd = 0;
        let subtotalExemptUsd = 0;

        for (const item of items) {
            const itemTotalBase = parseFloat(item.price_usd) * item.quantity;
            const updateResult = await client.query(
                `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id`,
                [item.quantity, item.product_id]
            );

            if (updateResult.rowCount === 0) throw new Error(`Stock insuficiente ID ${item.product_id}`);
            
            if (item.is_taxable) subtotalTaxableUsd += itemTotalBase;
            else subtotalExemptUsd += itemTotalBase;
        }
        
        const ivaUsd = subtotalTaxableUsd * IVA_RATE;
        const finalTotalUsd = subtotalTaxableUsd + subtotalExemptUsd + ivaUsd;
        const totalVes = finalTotalUsd * globalBCVRate; 

        let saleStatus = 'PAGADO';
        let customerId = null;
        let dueDate = null;
        // Si es contado, el pagado es igual al total. Si es crédito, 0 (por ahora).
        let amountPaidUsd = finalTotalUsd; 
        
        // Permitir guardar cliente si es crédito O si es factura fiscal
        if ((is_credit || invoice_type === 'FISCAL') && customer_data) {
            customerId = await findOrCreateCustomer(client, customer_data);
            
            // CORRECCIÓN: Solo marcar PENDIENTE si es explícitamente crédito
            if (is_credit) {
                saleStatus = 'PENDIENTE';
                amountPaidUsd = 0; 
                const days = due_days === 30 ? 30 : 15;
                dueDate = `CURRENT_TIMESTAMP + INTERVAL '${days} days'`;
            } else {
                // Si es Fiscal pero de Contado -> PAGADO
                saleStatus = 'PAGADO';
                amountPaidUsd = finalTotalUsd; // Se asume pagado completo
                dueDate = null;
            }
        }

        const saleQuery = `
            INSERT INTO sales (
                total_usd, total_ves, bcv_rate_snapshot, payment_method, status, customer_id, due_date,
                subtotal_taxable_usd, subtotal_exempt_usd, iva_rate, iva_usd, amount_paid_usd,
                invoice_type
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, ${dueDate || 'NULL'}, $7, $8, $9, $10, $11, $12) RETURNING id
        `;
        const saleValues = [
            finalTotalUsd.toFixed(2), totalVes.toFixed(2), globalBCVRate, payment_method, saleStatus, customerId,
            subtotalTaxableUsd.toFixed(2), subtotalExemptUsd.toFixed(2), IVA_RATE, ivaUsd.toFixed(2), amountPaidUsd.toFixed(2),
			invoice_type || 'TICKET'
        ];
        
        const saleResult = await client.query(saleQuery, saleValues);
        const saleId = saleResult.rows[0].id;

        for (const item of items) {
            await client.query(
                `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_moment_usd) VALUES ($1, $2, $3, $4)`,
                [saleId, item.product_id, item.quantity, item.price_usd]
            );
        }

        await client.query('COMMIT');
        console.log(`✅ Venta registrada ID: ${saleId}`);
        res.json({ success: true, saleId, status: saleStatus, finalTotalUsd: finalTotalUsd.toFixed(2) });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en venta:', error.message);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// --- REPORTES Y CRÉDITOS ---

// A. Resumen del Día (MODIFICADO: Solo Dinero Real Recaudado)
app.get('/api/reports/daily', async (req, res) => {
    try {
        // COALESCE(SUM(amount_paid_usd), 0) -> Suma solo lo que han abonado/pagado hoy.
        // Para los Bs, multiplicamos lo pagado por la tasa de esa venta (más preciso).
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_transactions, 
                COALESCE(SUM(amount_paid_usd), 0) as total_usd, 
                COALESCE(SUM(amount_paid_usd * bcv_rate_snapshot), 0) as total_ves
            FROM sales 
            WHERE DATE(created_at) = CURRENT_DATE AND status != 'ANULADO'
        `);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// B. Últimas Ventas
app.get('/api/reports/recent-sales', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, s.total_usd, s.total_ves, s.payment_method, to_char(s.created_at, 'DD/MM/YYYY HH12:MI AM') as full_date, s.status, c.full_name, c.id_number
            FROM sales s LEFT JOIN customers c ON s.customer_id = c.id ORDER BY s.id DESC LIMIT 10
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// C. Stock Bajo
app.get('/api/reports/low-stock', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, name, stock, category, icon_emoji, is_taxable FROM products WHERE stock <= 10 ORDER BY stock ASC`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// F. Listado Simple de Créditos Pendientes (Mantenido por compatibilidad)
app.get('/api/reports/credit-pending', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, s.total_usd, s.total_ves, s.status, s.created_at, s.due_date, c.full_name, c.id_number, c.phone,
                CASE WHEN s.due_date < NOW() THEN TRUE ELSE FALSE END as is_overdue
            FROM sales s JOIN customers c ON s.customer_id = c.id WHERE s.status IN ('PENDIENTE', 'PARCIAL') ORDER BY s.due_date ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NUEVOS ENDPOINTS PARA CRÉDITO AGRUPADO Y ABONOS ---

// I. Reporte de Crédito AGRUPADO por Cliente (Nuevo)
app.get('/api/reports/credit-grouped', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.id as customer_id,
                c.full_name,
                c.id_number,
                c.phone,
                COUNT(s.id) as total_bills,
                SUM(s.total_usd) as total_debt,
                SUM(s.amount_paid_usd) as total_paid,
                (SUM(s.total_usd) - SUM(s.amount_paid_usd)) as remaining_balance
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.status IN ('PENDIENTE', 'PARCIAL')
            GROUP BY c.id, c.full_name, c.id_number, c.phone
            ORDER BY remaining_balance DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// J. Detalle de Facturas de un Cliente (Nuevo)
app.get('/api/credits/customer/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT 
                s.id, s.total_usd, s.amount_paid_usd, (s.total_usd - s.amount_paid_usd) as remaining_amount,
                s.total_ves, s.status, s.created_at, s.due_date,
                CASE WHEN s.due_date < NOW() THEN TRUE ELSE FALSE END as is_overdue
            FROM sales s
            WHERE s.customer_id = $1 AND s.status IN ('PENDIENTE', 'PARCIAL')
            ORDER BY s.due_date ASC
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// G. Abonar o Saldar Crédito (MEJORADO: Soporta parciales)
app.post('/api/sales/:id/pay-credit', async (req, res) => {
    const { id } = req.params;
    const { paymentDetails, amountUSD } = req.body; 
    
    // Si no envían monto (compatibilidad anterior), asumimos pago total
    // Pero lo ideal es que el frontend envíe amountUSD.
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verificar deuda actual
        const saleRes = await client.query("SELECT total_usd, amount_paid_usd FROM sales WHERE id = $1", [id]);
        if (saleRes.rows.length === 0) throw new Error('Venta no encontrada');
        
        const sale = saleRes.rows[0];
        const total = parseFloat(sale.total_usd);
        const currentPaid = parseFloat(sale.amount_paid_usd || 0);
        
        // Si no se especifica monto, se asume el restante total (Saldar)
        let payAmount = amountUSD ? parseFloat(amountUSD) : (total - currentPaid);
        
        if (payAmount <= 0) throw new Error('Monto de abono inválido');

        const newPaid = currentPaid + payAmount;
        
        // Validación de sobrepago (con margen de 0.05)
        if (newPaid > total + 0.05) throw new Error('El monto excede la deuda restante.');

        // 2. Calcular nuevo estatus
        let newStatus = 'PARCIAL';
        if (newPaid >= total - 0.05) {
            newStatus = 'PAGADO';
        }

        // 3. Actualizar
        const updateQuery = `
            UPDATE sales 
            SET status = $1, 
                amount_paid_usd = $2, 
                payment_method = payment_method || ' || ' || $3 
            WHERE id = $4 
            RETURNING id
        `;
        const logMsg = `[Abono: $${payAmount.toFixed(2)} - ${paymentDetails}]`;
        
        await client.query(updateQuery, [newStatus, newPaid, logMsg, id]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Abono registrado.', newStatus, remaining: total - newPaid });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// H. Detalle de Venta (CORREGIDO: AHORA TRAE DATOS DEL CLIENTE)
app.get('/api/sales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Buscamos la venta Y los datos del cliente usando LEFT JOIN
        const saleInfoResult = await pool.query(`
            SELECT 
                s.total_usd, s.total_ves, s.bcv_rate_snapshot, 
                s.subtotal_taxable_usd, s.subtotal_exempt_usd, s.iva_rate, s.iva_usd, 
                s.payment_method, s.status, s.invoice_type, s.created_at, s.due_date,
                c.full_name, c.id_number, c.phone, c.institution
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            WHERE s.id = $1
        `, [id]);

        if (saleInfoResult.rows.length === 0) return res.status(404).json({ error: 'Venta no encontrada.' });
        
        // 2. Buscamos los items
        const itemsResult = await pool.query(`
            SELECT p.name, p.is_taxable, si.quantity, si.price_at_moment_usd 
            FROM sale_items si 
            JOIN products p ON si.product_id = p.id 
            WHERE si.sale_id = $1
        `, [id]);

        res.json({ ...saleInfoResult.rows[0], items: itemsResult.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GESTIÓN DE CLIENTES ---

app.get('/api/customers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY full_name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al listar clientes' });
    }
});

app.post('/api/customers', async (req, res) => {
    const { id, full_name, id_number, phone, institution, status } = req.body;
    if (!full_name || !id_number || !status) return res.status(400).json({ error: 'Datos obligatorios faltantes.' });
    
    const client = await pool.connect(); 
    try {
        let result;
        if (id) {
            const query = 'UPDATE customers SET full_name = $1, id_number = $2, phone = $3, institution = $4, status = $5 WHERE id = $6 RETURNING *';
            result = await client.query(query, [full_name, id_number, phone, institution, status, id]);
            if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        } else {
            const query = `INSERT INTO customers (full_name, id_number, phone, institution, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id_number) DO UPDATE SET full_name = $1, phone = $3, institution = $4, status = $5 RETURNING *`;
            result = await client.query(query, [full_name, id_number, phone, institution, status]); 
        }
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') res.status(409).json({ error: `Identificador ${id_number} duplicado.` });
        else res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/customers/search', async (req, res) => {
    const { query } = req.query; 
    if (!query) return res.status(400).json({ error: 'Parámetro query requerido.' });
    const searchQuery = `%${query.toLowerCase()}%`; 
    try {
        const result = await pool.query(
            `SELECT id, full_name, id_number, phone, institution FROM customers WHERE (LOWER(id_number) LIKE $1 OR LOWER(full_name) LIKE $1) AND status = 'ACTIVO' ORDER BY full_name ASC LIMIT 10`,
            [searchQuery]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al buscar cliente' });
    }
});

// K. ESTADÍSTICAS AVANZADAS Y REPORTES GERENCIALES (MEJORADO)
app.get('/api/reports/analytics', async (req, res) => {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString();
    const end = endDate || new Date().toISOString();

    const client = await pool.connect();
    try {
        // 1. Top Productos
        const topProductsQuery = `
            SELECT p.name, SUM(si.quantity) as total_qty, SUM(si.quantity * si.price_at_moment_usd) as total_revenue
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.created_at BETWEEN $1 AND $2 AND s.status != 'ANULADO'
            GROUP BY p.id, p.name
            ORDER BY total_qty DESC
            LIMIT 5`;

        // 2. Top Clientes (MODIFICADO: Ordenar por lo que realmente han PAGADO)
        const topCustomersQuery = `
            SELECT c.full_name, COUNT(s.id) as transactions, SUM(s.amount_paid_usd) as total_spent
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.created_at BETWEEN $1 AND $2 AND s.status != 'ANULADO'
            GROUP BY c.id, c.full_name
            ORDER BY total_spent DESC
            LIMIT 5`;

        // 3. Ventas en el tiempo (MODIFICADO: Gráfica de Ingresos Reales)
        const salesOverTimeQuery = `
            SELECT 
                DATE(created_at) as sale_date, 
                SUM(amount_paid_usd) as total_usd, 
                SUM(amount_paid_usd * bcv_rate_snapshot) as total_ves, 
                COUNT(*) as tx_count
            FROM sales
            WHERE created_at BETWEEN $1 AND $2 AND status != 'ANULADO'
            GROUP BY DATE(created_at)
            ORDER BY sale_date ASC`;

        // 4. Ventas por Categoría (NUEVO PARA GRÁFICAS)
        const salesByCategoryQuery = `
            SELECT p.category, SUM(si.quantity) as total_qty, SUM(si.quantity * si.price_at_moment_usd) as total_usd
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.created_at BETWEEN $1 AND $2 AND s.status != 'ANULADO'
            GROUP BY p.category
            ORDER BY total_usd DESC`;

        // 5. Top Deudores (Histórico global, no depende de fechas)
        const topDebtorsQuery = `
            SELECT c.full_name, (SUM(s.total_usd) - SUM(s.amount_paid_usd)) as debt
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.status IN ('PENDIENTE', 'PARCIAL')
            GROUP BY c.id, c.full_name
            ORDER BY debt DESC
            LIMIT 5`;

        const [topProducts, topCustomers, salesTime, salesCat, topDebtors] = await Promise.all([
            client.query(topProductsQuery, [start, end]),
            client.query(topCustomersQuery, [start, end]),
            client.query(salesOverTimeQuery, [start, end]),
            client.query(salesByCategoryQuery, [start, end]),
            client.query(topDebtorsQuery)
        ]);

        res.json({
            topProducts: topProducts.rows,
            topCustomers: topCustomers.rows,
            salesOverTime: salesTime.rows,
            salesByCategory: salesCat.rows,
            topDebtors: topDebtors.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// L. Obtener Ventas de HOY Detalladas
app.get('/api/reports/sales-today', async (req, res) => {
    try {
        // Traemos amount_paid_usd para mostrar "Pagado" en vez de "Total" si prefieres
        const result = await pool.query(`
            SELECT s.*, c.full_name,
            (s.total_usd - s.amount_paid_usd) as debt_amount -- Calculamos la deuda al vuelo
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            WHERE DATE(s.created_at) = CURRENT_DATE
            ORDER BY s.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// M. REPORTE DETALLADO DE VENTAS (Rango de Fechas)
app.get('/api/reports/sales-detail', async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
        // Traemos TODO el detalle para exportar/visualizar
        const result = await pool.query(`
            SELECT 
                s.id, 
                s.created_at, 
                COALESCE(c.full_name, 'Consumidor Final') as client_name, 
                COALESCE(c.id_number, 'N/A') as client_id,
                s.payment_method, 
                s.status, 
                s.invoice_type, 
                s.total_usd, 
                s.total_ves,
                (SELECT string_agg(p.name || ' (' || si.quantity || ')', ', ') 
                 FROM sale_items si JOIN products p ON si.product_id = p.id 
                 WHERE si.sale_id = s.id) as items_summary
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            WHERE s.created_at BETWEEN $1 AND $2
            ORDER BY s.id DESC
        `, [startDate, endDate]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// N. REPORTE DETALLADO DE INVENTARIO (Todo)
app.get('/api/reports/inventory-detail', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id, name, category, stock, price_usd, status, is_taxable, barcode,
                (stock * price_usd) as total_value_usd
            FROM products 
            ORDER BY status, name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [NUEVO] Registrar Saldo Inicial (Deuda Antigua)
app.post('/api/customers/:id/initial-balance', async (req, res) => {
    const { id } = req.params; // ID del cliente
    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verificar que el cliente existe
        const checkClient = await client.query('SELECT full_name FROM customers WHERE id = $1', [id]);
        if (checkClient.rows.length === 0) throw new Error('Cliente no encontrado');

        // 2. Crear una "Venta" simbólica que represente la deuda anterior
        // Status PENDIENTE, Método SALDO_INICIAL, sin ítems de inventario.
        const saleQuery = `
            INSERT INTO sales (
                total_usd, total_ves, bcv_rate_snapshot, payment_method, status, customer_id, due_date,
                subtotal_taxable_usd, subtotal_exempt_usd, iva_rate, iva_usd, amount_paid_usd
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9, $10, $11) RETURNING id
        `;
        
        // Asumimos que la deuda vieja no desglosa impuestos nuevos, la ponemos como exenta para simplificar
        const values = [
            amount, // total_usd
            (amount * globalBCVRate).toFixed(2), // total_ves (aprox al cambio de hoy)
            globalBCVRate,
            `SALDO INICIAL - ${description || 'Deuda Anterior'}`, // payment_method (usado como descripción)
            'PENDIENTE', // Status clave
            id,
            0, // subtotal_taxable
            amount, // subtotal_exempt (Todo el saldo va aquí)
            0.16, // iva_rate (referencial)
            0, // iva_usd
            0 // amount_paid_usd (Nada pagado aun)
        ];

        await client.query(saleQuery, values);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Saldo inicial registrado correctamente' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.listen(port, () => {
    console.log(`🚀 Servidor BMS corriendo en puerto ${port}`);
});