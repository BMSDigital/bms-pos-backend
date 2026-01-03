process.env.TZ = 'America/Caracas';
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const https = require('https');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// [CORRECCIÓN 1] Aquí borré la conexión 'pool' duplicada que tenías antes.

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

// --- 2. Obtener Productos (ACTUALIZADO) ---
app.get('/api/products', async (req, res) => {
    try {
        // Agregamos 'p.is_perishable' al SELECT
        const query = `
            SELECT 
                p.id, p.name, p.category, p.price_usd, 
                COALESCE((SELECT SUM(stock) FROM product_batches WHERE product_id = p.id AND stock > 0), 0) as stock,
                (SELECT MIN(expiration_date) FROM product_batches WHERE product_id = p.id AND stock > 0) as expiration_date,
                p.icon_emoji, p.is_taxable, p.barcode, p.status, p.last_stock_update, p.is_perishable
            FROM products p
            ORDER BY p.id ASC
        `;
        const result = await pool.query(query);
        
        // Mapeamos para agregar el precio en Bolívares calculado
        const productsWithVes = result.rows.map(product => ({
            ...product,
            price_ves: (parseFloat(product.price_usd) * globalBCVRate).toFixed(2),
            stock: parseInt(product.stock) || 0,
            // Formato de fecha seguro
            expiration_date: product.expiration_date ? new Date(product.expiration_date).toISOString().split('T')[0] : null
        }));
        
        res.json(productsWithVes);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

app.get('/api/inventory/batches/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT * FROM product_batches 
            WHERE product_id = $1 AND stock > 0 
            ORDER BY expiration_date ASC
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. Crear/Actualizar Producto (CON GESTIÓN AUTOMÁTICA DE LOTE INICIAL) ---
app.post('/api/products', async (req, res) => {
    const { id, name, category, price_usd, stock, icon_emoji, is_taxable, barcode, status, expiration_date } = req.body;
    
    if (!name || !price_usd) return res.status(400).json({ error: 'Nombre y Precio son obligatorios.' });

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Iniciamos transacción de seguridad

        // Normalización de datos
        const isTaxableVal = (is_taxable === 'true' || is_taxable === true);
        const statusVal = status || 'ACTIVE';
        // Si la fecha viene vacía o es string vacío, la guardamos como NULL
        const expirationVal = (expiration_date && expiration_date !== '') ? expiration_date : null;
        // Determinamos si es perecedero: Si tiene fecha, es perecedero. Si no, no.
        const isPerishableVal = !!expirationVal; 

        let productId;
        let result;

        if (id) {
            // --- MODO EDICIÓN ---
            // NOTA: En edición NO tocamos el stock ni los lotes. Eso se hace por "Movimientos".
            // Solo actualizamos la info descriptiva.
            const query = `
                UPDATE products 
                SET name = $1, category = $2, price_usd = $3, icon_emoji = $4, 
                    is_taxable = $5, barcode = $6, status = $7, expiration_date = $8, is_perishable = $9,
                    last_stock_update = CURRENT_TIMESTAMP 
                WHERE id = $10 RETURNING *`;
            const values = [name, category, price_usd, icon_emoji, isTaxableVal, barcode, statusVal, expirationVal, isPerishableVal, id];
            result = await client.query(query, values);
            productId = id;
        } else {
            // --- MODO CREACIÓN (NUEVO PRODUCTO) ---
            // Aquí sí leemos el stock inicial para crear el primer lote
            const initialStock = parseInt(stock) || 0;
            
            const query = `
                INSERT INTO products (name, category, price_usd, stock, icon_emoji, is_taxable, barcode, status, expiration_date, is_perishable) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`;
            const values = [name, category, price_usd, initialStock, icon_emoji, isTaxableVal, barcode, statusVal, expirationVal, isPerishableVal];
            result = await client.query(query, values);
            productId = result.rows[0].id;

            // MAGIA: Si el usuario puso stock inicial, creamos el lote y el kardex automáticamente
            if (initialStock > 0) {
                // 1. Crear el Lote Inicial
                await client.query(`
                    INSERT INTO product_batches (product_id, stock, expiration_date, cost_usd, batch_code)
                    VALUES ($1, $2, $3, $4, $5)
                `, [productId, initialStock, expirationVal, price_usd, 'LOTE-INICIAL']);

                // 2. Registrar en Movimientos (Kardex)
                await client.query(`
                    INSERT INTO inventory_movements (product_id, type, quantity, reason, document_ref, cost_usd, new_stock)
                    VALUES ($1, 'IN', $2, 'INVENTARIO_INICIAL', 'CARGA_SISTEMA', $3, $4)
                `, [productId, initialStock, price_usd, initialStock]);
            }
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error al guardar producto:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 4. PROCESAR VENTA (INTEGRADO: LOTES, AVANCES, CLIENTES, CRÉDITO Y ETIQUETAS DE CAPITAL)
app.post('/api/sales', async (req, res) => {
    const { 
        items, 
        payment_method, 
        customer_data, 
        customer_id, 
        is_credit, 
        due_days, 
        invoice_type,
        bcv_rate_snapshot 
    } = req.body;

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Iniciar transacción

        // --- 1. LÓGICA DE CLIENTE (GLOBAL) ---
        // Sacada del "if" para que siempre funcione, sea Crédito, Contado o Fiscal.
        let finalCustomerId = null;
        if (customer_id) {
            finalCustomerId = customer_id;
        } else if (customer_data && customer_data.id) {
            finalCustomerId = customer_data.id;
        } 
        // Recuperamos la capacidad de crear cliente al vuelo si tienes la función auxiliar
        else if (customer_data && typeof findOrCreateCustomer === 'function') {
             finalCustomerId = await findOrCreateCustomer(client, customer_data);
        }

        const rateToUse = bcv_rate_snapshot ? parseFloat(bcv_rate_snapshot) : globalBCVRate;
        let subtotalTaxableUsd = 0;
        let subtotalExemptUsd = 0;

        // [NUEVO] VARIABLE PARA ACUMULAR LAS ETIQUETAS DE CAPITAL (Ej: " [CAP:50.00]")
        let capitalTags = "";

        // --- 2. PRE-PROCESAMIENTO DE ITEMS (AVANCES) ---
        // Aquí detectamos si es un servicio o avance antes de tocar stock
        const processedItems = [];

        for (const item of items) {
            let finalProductId = item.product_id;
            let isService = false;

            // [NUEVO] DETECTAR ETIQUETA [CAP:...] EN EL NOMBRE QUE VIENE DEL FRONTEND
            // Y guardarla en una variable para pegarla en la venta después.
            if (item.name && item.name.includes('[CAP:')) {
                const match = item.name.match(/\[CAP:([\d\.]+)\]/);
                if (match) {
                    capitalTags += ` ${match[0]}`; // Acumulamos la etiqueta
                }
            }

            // DETECTAR SI ES UN AVANCE DE EFECTIVO (ID texto o empieza con ADV)
            if (isNaN(finalProductId) || (typeof finalProductId === 'string' && finalProductId.startsWith('ADV'))) {
                
                // 2.1 Buscar si ya existe el producto comodín "AVANCE DE EFECTIVO"
                const serviceCheck = await client.query("SELECT id FROM products WHERE name = 'AVANCE DE EFECTIVO' LIMIT 1");
                
                if (serviceCheck.rows.length > 0) {
                    finalProductId = serviceCheck.rows[0].id;
                } else {
                    // 2.2 Si no existe, LO CREAMOS automáticamente
                    console.log("⚠️ Creando producto comodín 'AVANCE DE EFECTIVO'...");
                    const newService = await client.query(`
                        INSERT INTO products (name, category, price_usd, stock, is_taxable, status)
                        VALUES ('AVANCE DE EFECTIVO', 'SERVICIOS', 0, 999999, false, 'ACTIVE')
                        RETURNING id
                    `);
                    finalProductId = newService.rows[0].id;
                }
                isService = true; // Marcar para no descontar stock
            }

            // Guardamos el item corregido para usarlo abajo
            processedItems.push({ 
                ...item, 
                product_id: finalProductId, 
                original_id: item.product_id,
                is_service: isService 
            });
        }

        // --- 3. PROCESAR INVENTARIO (LOTES / FEFO) ---
        for (const item of processedItems) {
            // Si es servicio (Avance), saltamos el descuento de inventario
            if (item.is_service) {
                subtotalExemptUsd += parseFloat(item.price_usd) * parseInt(item.quantity);
                continue; 
            }

            const productId = item.product_id;
            let qtyToDeduct = parseInt(item.quantity);
            const itemTotalBase = parseFloat(item.price_usd) * qtyToDeduct;

            // 3.1 Calcular Subtotales Financieros
            if (item.is_taxable) subtotalTaxableUsd += itemTotalBase;
            else subtotalExemptUsd += itemTotalBase;

            // 3.2 Buscar Lotes (FEFO: Primero en vencer, primero en salir)
            const batchesRes = await client.query(`
                SELECT id, stock FROM product_batches 
                WHERE product_id = $1 AND stock > 0 
                ORDER BY expiration_date ASC NULLS LAST
            `, [productId]);

            // 3.3 Descuento FEFO
            let remainingQty = qtyToDeduct;
            for (let batch of batchesRes.rows) {
                if (remainingQty <= 0) break;
                const take = Math.min(batch.stock, remainingQty);
                await client.query('UPDATE product_batches SET stock = stock - $1 WHERE id = $2', [take, batch.id]);
                remainingQty -= take;
            }

            // 3.4 Actualizar Stock Total Maestro
            if (batchesRes.rows.length > 0) {
                 const finalStockRes = await client.query('SELECT COALESCE(SUM(stock), 0) as total FROM product_batches WHERE product_id = $1', [productId]);
                 const finalTotal = parseInt(finalStockRes.rows[0].total);
                 await client.query('UPDATE products SET stock = $1, last_stock_update = CURRENT_TIMESTAMP WHERE id = $2', [finalTotal, productId]);
            } else {
                 await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [qtyToDeduct, productId]);
            }
        }
        
        // --- 4. CÁLCULOS FINALES Y CRÉDITO ---
        const IVA_RATE = 0.16;
        const ivaUsd = subtotalTaxableUsd * IVA_RATE;
        const finalTotalUsd = subtotalTaxableUsd + subtotalExemptUsd + ivaUsd;
        const totalVes = finalTotalUsd * rateToUse; 

        // Configuración por defecto (PAGADO)
        let saleStatus = 'PAGADO';
        let dueDate = null;
        let amountPaidUsd = finalTotalUsd; 
        
        // Lógica de Crédito (CORREGIDA)
        if (is_credit) {
            // Validación obligatoria
            if (!finalCustomerId) {
                throw new Error("No se puede procesar venta a CRÉDITO sin seleccionar un Cliente.");
            }

            saleStatus = 'PENDIENTE';
            amountPaidUsd = 0; // CLAVE: Esto evita que sume al reporte diario de caja
            
            const days = due_days ? parseInt(due_days) : 15;
            const date = new Date();
            date.setDate(date.getDate() + days);
            dueDate = date;
        }

        // [NUEVO] CONCATENAR ETIQUETAS AL MÉTODO DE PAGO
        // Así guardamos: "EFECTIVO USD [CAP:20.00]"
        const finalPaymentMethod = (payment_method || 'CONTADO') + capitalTags;

        // --- 5. INSERTAR VENTA ---
        const saleQuery = `
            INSERT INTO sales (
                total_usd, total_ves, bcv_rate_snapshot, payment_method, status, customer_id, due_date,
                subtotal_taxable_usd, subtotal_exempt_usd, iva_rate, iva_usd, amount_paid_usd,
                invoice_type
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
            RETURNING id
        `;
        
        // [MODIFICADO] Usamos finalPaymentMethod en lugar de payment_method
        const saleValues = [
            finalTotalUsd.toFixed(2), totalVes.toFixed(2), rateToUse, finalPaymentMethod, saleStatus, finalCustomerId, dueDate,
            subtotalTaxableUsd.toFixed(2), subtotalExemptUsd.toFixed(2), IVA_RATE, ivaUsd.toFixed(2), amountPaidUsd.toFixed(2),
            invoice_type || 'TICKET'
        ];
        
        const saleResult = await client.query(saleQuery, saleValues);
        const saleId = saleResult.rows[0].id;

        // --- 6. INSERTAR DETALLES Y KARDEX (Usando items procesados) ---
        for (const item of processedItems) {
            // A. Insertar Item de Venta
            await client.query(
                `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_moment_usd) VALUES ($1, $2, $3, $4)`,
                [saleId, item.product_id, item.quantity, item.price_usd] 
            );

            // B. Registrar Movimiento SOLO si no es servicio
            if (!item.is_service) {
                const stockCheck = await client.query('SELECT stock FROM products WHERE id = $1', [item.product_id]);
                const currentStockLog = stockCheck.rows[0] ? stockCheck.rows[0].stock : 0;

                await client.query(`
                    INSERT INTO inventory_movements (product_id, type, quantity, reason, document_ref, new_stock)
                    VALUES ($1, 'OUT', $2, 'VENTA', $3, $4)
                `, [item.product_id, item.quantity, `VENTA #${saleId}`, currentStockLog]);
            }
        }

        await client.query('COMMIT');
        console.log(`✅ Venta #${saleId} | Status: ${saleStatus} | Cliente: ${finalCustomerId || 'Consumidor Final'}`);
        res.json({ success: true, saleId, message: 'Venta exitosa' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en venta:', error);
        res.status(500).json({ success: false, message: error.message, details: error.stack });
    } finally {
        client.release();
    }
});

// --- REPORTES Y CRÉDITOS ---

app.get('/api/reports/daily', async (req, res) => {
    const client = await pool.connect(); // Usamos cliente para control de transacciones
    try {
        // 1. Buscamos las ventas de hoy. 
        // [OPTIMIZACIÓN]: Consultamos directamente la tabla 'sales'.
        // No hace falta unir con productos porque la etiqueta [CAP:...] ya está guardada en 'payment_method'.
        const result = await client.query(`
            SELECT 
                id, 
                amount_paid_usd, 
                bcv_rate_snapshot, 
                payment_method
            FROM sales 
            WHERE DATE(created_at AT TIME ZONE 'America/Caracas') = DATE(CURRENT_TIMESTAMP AT TIME ZONE 'America/Caracas')
            AND status != 'ANULADO'
        `);

        // 2. Variables para acumular los totales
        let totalIngresoBrutoUSD = 0;   // Todo el dinero que entró (Ventas + Capital Avances)
        let totalIngresoBrutoVES = 0;   // Equivalente en Bs
        let totalCapitalAvances = 0;    // Dinero que salió (Capital prestado)

        // Recorremos cada venta encontrada
        result.rows.forEach(row => {
            const paid = parseFloat(row.amount_paid_usd || 0);
            const rate = parseFloat(row.bcv_rate_snapshot || globalBCVRate);
            
            // Sumamos al total bruto (lo que entró en caja físicamente)
            totalIngresoBrutoUSD += paid;
            totalIngresoBrutoVES += (paid * rate);

            // [LÓGICA BLINDADA]: Detectar Avance leyendo el Método de Pago
            // Ejemplo de dato en BD: "PAGO MÓVIL [CAP:50.00]"
            if (row.payment_method && row.payment_method.includes('[CAP:')) {
                try {
                    // Extraemos el número que está dentro de los corchetes
                    const capMatch = row.payment_method.match(/\[CAP:([\d\.]+)\]/);
                    if (capMatch && capMatch[1]) {
                        const capital = parseFloat(capMatch[1]);
                        
                        // Acumulamos este capital para restarlo al final
                        totalCapitalAvances += capital;
                    }
                } catch (e) {
                    console.error("Error leyendo etiqueta CAP:", e);
                }
            }
        });

        // 3. Calculamos la Venta Neta (Ganancia Real)
        // Fórmula: Todo lo que entró - El capital que entregamos al cliente
        const ventaNetaUSD = totalIngresoBrutoUSD - totalCapitalAvances;
        
        // Ajustamos también los Bolívares proporcionalmente
        const ventaNetaVES = totalIngresoBrutoVES - (totalCapitalAvances * globalBCVRate);

        // 4. Enviamos la respuesta con los NOMBRES EXACTOS que tu Frontend espera
        res.json({
            total_transactions: result.rowCount, // Cantidad de facturas emitidas hoy
            total_usd: ventaNetaUSD.toFixed(2),  // <--- ¡AQUÍ ESTÁ LA SOLUCIÓN! Solo muestra tu ganancia.
            total_ves: ventaNetaVES.toFixed(2)
        });

    } catch (err) {
        console.error("Error en reporte diario:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
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
    
    // El % rodea el texto para buscar coincidencias parciales
    const searchQuery = `%${query}%`; 
    
    try {
        // USO DE ILIKE: Ignora mayúsculas/minúsculas automáticamente
        // Busca en Nombre, Cédula o Institución
        const result = await pool.query(
            `SELECT id, full_name, id_number, phone, institution, status 
             FROM customers 
             WHERE (full_name ILIKE $1 OR id_number ILIKE $1 OR institution ILIKE $1) 
             AND status = 'ACTIVO' 
             ORDER BY full_name ASC 
             LIMIT 10`,
            [searchQuery]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error buscando clientes:', err);
        res.status(500).json({ error: 'Error al buscar cliente' });
    }
});

// K. ESTADÍSTICAS AVANZADAS Y REPORTES GERENCIALES (MEJORADO Y CORREGIDO)
app.get('/api/reports/analytics', async (req, res) => {
    const { startDate, endDate } = req.query;
    
    // 1. Configuración de Fechas por defecto (Últimos 30 días si no llegan datos)
    let start = startDate;
    let end = endDate;

    if (!start || !end) {
        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        
        start = thirtyDaysAgo.toISOString();
        end = now.toISOString();
    }

    // 🔥 CORRECCIÓN CRÍTICA: Asegurar que la fecha final cubra todo el día (23:59:59)
    // Si 'end' es solo fecha "YYYY-MM-DD", le agregamos la hora final.
    if (end.length <= 10) {
        end = `${end} 23:59:59`;
    } else {
        // Si ya es formato ISO, forzamos el ajuste manual para asegurar cobertura
        const dateObj = new Date(end);
        dateObj.setHours(23, 59, 59, 999);
        end = dateObj.toISOString();
    }

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

        // 2. Top Clientes (Ordenado por PAGADO real)
        const topCustomersQuery = `
            SELECT c.full_name, COUNT(s.id) as transactions, SUM(s.amount_paid_usd) as total_spent
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            WHERE s.created_at BETWEEN $1 AND $2 AND s.status != 'ANULADO'
            GROUP BY c.id, c.full_name
            ORDER BY total_spent DESC
            LIMIT 5`;

        // 3. Ventas en el tiempo (Dinero Recaudado / Flujo de Caja)
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

        // 4. Ventas por Categoría
        const salesByCategoryQuery = `
            SELECT p.category, SUM(si.quantity) as total_qty, SUM(si.quantity * si.price_at_moment_usd) as total_usd
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.created_at BETWEEN $1 AND $2 AND s.status != 'ANULADO'
            GROUP BY p.category
            ORDER BY total_usd DESC`;

        // 5. Top Deudores (Global)
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

// L. Obtener Ventas de HOY (Mejorado para UX)
app.get('/api/reports/sales-today', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.id, 
                s.created_at,
                s.total_usd,             -- Monto Factura
                s.amount_paid_usd,       -- Monto Real Pagado
                (s.total_usd - s.amount_paid_usd) as debt, -- Cuánto falta (Útil para UX)
                s.total_ves, 
                s.payment_method, 
                s.status, 
                c.full_name 
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            WHERE DATE(s.created_at) = CURRENT_DATE
            ORDER BY s.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// M. REPORTE DETALLADO DE VENTAS (CORREGIDO PARA INCLUIR TODO EL DÍA)
app.get('/api/reports/sales-detail', async (req, res) => {
    try {
        let { startDate, endDate, search } = req.query;

        // 1. Fechas por defecto si no vienen
        if (!startDate || !endDate) {
            const now = new Date();
            // Inicio del mes (Formato YYYY-MM-DD manual para evitar líos de zona horaria)
            startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            // Fin de mes
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        }

        // 🔥 CORRECCIÓN CRÍTICA: MANEJO DE TEXTO DIRECTO
        // En lugar de convertir a "Date" (que a veces resta 4 horas por UTC),
        // concatenamos manualmente la hora final del día. Postgres hará el resto.
        
        // Si endDate es "2025-12-17", esto lo convierte en "2025-12-17 23:59:59"
        let finalEndDateString = endDate;
        if (finalEndDateString.length <= 10) { 
            finalEndDateString = `${endDate} 23:59:59`;
        }

        // Array de parámetros (Usamos el string directo, NO toISOString)
        const queryParams = [startDate, finalEndDateString];
        
        // Construcción de la consulta base
        let queryText = `
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
                s.bcv_rate_snapshot,
                -- NUEVA COLUMNA MÁGICA: Concatena los productos en una sola celda
                (
                    SELECT STRING_AGG(CONCAT(p.name, ' (', si.quantity, ')'), ', ')
                    FROM sale_items si
                    JOIN products p ON si.product_id = p.id
                    WHERE si.sale_id = s.id
                ) as items_comprados
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            WHERE s.created_at BETWEEN $1 AND $2 
        `; // Nota: Postgres al recibir string en timestamp asume la zona horaria local (America/Caracas)

        // ... (El resto del código de búsqueda sigue igual)
        if (search) {
            queryText += ` AND (
                CAST(s.id AS TEXT) ILIKE $3 OR 
                c.full_name ILIKE $3 OR 
                c.id_number ILIKE $3 
            )`;
            queryParams.push(`%${search}%`);
        }

        queryText += ` ORDER BY s.id DESC`;

        const result = await pool.query(queryText, queryParams);

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error generando reporte detallado: ' + err.message });
    }
});

// N. REPORTE DETALLADO DE INVENTARIO (AUDITORÍA / VALORIZACIÓN)
app.get('/api/reports/inventory-detail', async (req, res) => {
    try {
        // Obtenemos productos y calculamos su valor total basado en Stock * Precio Base
        const result = await pool.query(`
            SELECT 
                id, name, category, barcode, status,
                stock, price_usd,
                (stock * price_usd) as total_value_usd,
                is_taxable, is_perishable,
                last_stock_update
            FROM products 
            WHERE status = 'ACTIVE' -- Generalmente se audita lo activo
            ORDER BY category ASC, name ASC
        `);

        // Enriquecemos con los valores en Bolívares usando la tasa actual
        const enriched = result.rows.map(p => ({
            ...p,
            price_ves: (parseFloat(p.price_usd) * globalBCVRate).toFixed(2),
            total_value_ves: (parseFloat(p.total_value_usd) * globalBCVRate).toFixed(2),
            bcv_rate_snapshot: globalBCVRate
        }));

        res.json(enriched);
    } catch (err) {
        console.error(err);
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

// --- Z. ANULACIÓN Y NOTA DE CRÉDITO (REVERSO COMPLETO: MASTER, LOTES Y KARDEX) ---
app.post('/api/sales/:id/void', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body; // Motivo de la anulación

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Verificar el estado actual de la venta
        // [MEJORA]: Traemos status e invoice_type
        const saleCheck = await client.query('SELECT status, invoice_type FROM sales WHERE id = $1', [id]);
        
        if (saleCheck.rows.length === 0) throw new Error('Venta no encontrada');

        // [CORRECCIÓN CRÍTICA]: Limpiamos el estatus para evitar errores falsos
        const rawStatus = saleCheck.rows[0].status;
        const currentStatus = (rawStatus || '').trim().toUpperCase();

        // A. Validación: Si ya está anulada
        if (currentStatus === 'ANULADO') throw new Error('Esta venta ya está anulada.');

        // B. Validación: Si es PARCIAL (SOLICITUD UX: Bloquear para no descuadrar caja)
        if (currentStatus === 'PARCIAL') {
            throw new Error('ACCIÓN DENEGADA: No puede anular una venta con estatus PARCIAL (tiene abonos). Debe liquidar la deuda o gestionar la devolución manual.');
        }

        // 2. Obtener los ítems para devolver al inventario
        // [MEJORA]: Traemos precio, nombre Y CATEGORÍA para filtrar mejor los servicios
        const itemsRes = await client.query(`
            SELECT si.product_id, si.quantity, p.name, p.category, p.price_usd 
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = $1
        `, [id]);
        
        // 3. PROCESO DE DEVOLUCIÓN DE STOCK (LÓGICA INVERSA A LA VENTA)
        for (const item of itemsRes.rows) {
            
            // A. Detectar si es un Servicio (ej. Avance de Efectivo) para ignorar stock
            // [VALIDACIÓN ROBUSTA]: Detectamos "AVANCE" en nombre o si la categoría es SERVICIOS
            const nameUpper = (item.name || '').toUpperCase();
            const catUpper = (item.category || '').toUpperCase();
            
            const isService = (
                nameUpper.includes('AVANCE') ||       // Detecta "AVANCE DE EFECTIVO", "Avance", etc.
                catUpper === 'SERVICIOS' ||           // Detecta Categoría Servicios
                item.product_id.toString().startsWith('ADV')
            );
            
            if (!isService) {
                // B. Restaurar en LOTES (product_batches)
                // Estrategia: Devolvemos el stock al lote con la fecha de vencimiento más lejana (el más nuevo)
                const targetBatch = await client.query(`
                    SELECT id FROM product_batches 
                    WHERE product_id = $1 
                    ORDER BY expiration_date DESC NULLS FIRST 
                    LIMIT 1
                `, [item.product_id]);

                if (targetBatch.rows.length > 0) {
                    // Sumamos al lote existente encontrado
                    await client.query(
                        'UPDATE product_batches SET stock = stock + $1 WHERE id = $2',
                        [item.quantity, targetBatch.rows[0].id]
                    );
                } else {
                    // Caso raro: No hay lotes (se borraron todos). Creamos un lote de recuperación.
                    await client.query(`
                        INSERT INTO product_batches (product_id, stock, batch_code, cost_usd)
                        VALUES ($1, $2, 'REINGRESO-ANULACION', $3)
                    `, [item.product_id, item.quantity, item.price_usd]);
                }

                // C. Restaurar en PRODUCTO MAESTRO (products)
                await client.query(
                    'UPDATE products SET stock = stock + $1, last_stock_update = CURRENT_TIMESTAMP WHERE id = $2',
                    [item.quantity, item.product_id]
                );

                // D. Registrar en KARDEX (inventory_movements) - ¡INDISPENSABLE!
                // Consultamos el stock final para que el Kardex quede exacto
                const finalStockRes = await client.query('SELECT stock FROM products WHERE id = $1', [item.product_id]);
                const finalStock = finalStockRes.rows[0].stock;

                await client.query(`
                    INSERT INTO inventory_movements (product_id, type, quantity, reason, document_ref, new_stock)
                    VALUES ($1, 'IN', $2, 'ANULACION_VENTA', $3, $4)
                `, [
                    item.product_id,            // $1
                    item.quantity,              // $2
                    `ANULACION VENTA #${id}`,   // $3
                    finalStock                  // $4
                ]);
            } else {
                // LOG DE SEGURIDAD
                console.log(`⏩ Omitiendo devolución de stock para ítem tipo Servicio/Avance: ${item.name}`);
            }
        }

        // 4. Actualizar la venta a ANULADO
        // Se deja registro del motivo en el método de pago para auditoría visual
        const updateQuery = `
            UPDATE sales 
            SET status = 'ANULADO', 
                payment_method = payment_method || ' [ANULADO: ' || $1 || ']' 
            WHERE id = $2 
            RETURNING id
        `;
        await client.query(updateQuery, [reason || 'Solicitud Cliente', id]);

        await client.query('COMMIT');
        
        console.log(`🚫 Venta #${id} anulada. Stock, Lotes y Kardex restaurados correctamente.`);
        res.json({ success: true, message: 'Venta anulada y stock restaurado correctamente.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error anulando venta:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- 🚀 NUEVO MÓDULO: GESTIÓN Y CIERRE DE CAJA ---

// 1. Verificar si hay caja abierta / Abrir Caja
app.post('/api/cash/open', async (req, res) => {
    const { initial_cash_usd, initial_cash_ves } = req.body;
    const client = await pool.connect();
    try {
        const checkOpen = await client.query("SELECT id FROM cash_shifts WHERE status = 'ABIERTA'");
        if (checkOpen.rows.length > 0) {
            return res.status(400).json({ error: 'Ya existe una caja abierta. Debe cerrarla primero.' });
        }

        const result = await client.query(`
            INSERT INTO cash_shifts (initial_cash_usd, initial_cash_ves, status)
            VALUES ($1, $2, 'ABIERTA') RETURNING *
        `, [initial_cash_usd || 0, initial_cash_ves || 0]);
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 2. Consultar Estado Actual de la Caja (ADAPTADO: Descuenta salidas de Avance de Efectivo)
app.get('/api/cash/current-status', async (req, res) => {
    try {
        const shiftRes = await pool.query("SELECT * FROM cash_shifts WHERE status = 'ABIERTA' ORDER BY id DESC LIMIT 1");
        if (shiftRes.rows.length === 0) return res.json({ status: 'CERRADA' });

        const shift = shiftRes.rows[0];

        // Sumamos ventas normales Y abonos de crédito realizados hoy
        // Nota: Los abonos se guardan en 'sales' al actualizarse, o si tienes una tabla aparte. 
        // En tu sistema actual, los abonos actualizan la venta original. 
        // Para simplificar y que cuadre HOY, sumaremos ventas creadas hoy Y ventas actualizadas hoy (pagos de deuda).
        // *Por seguridad y consistencia con tu código actual, seguiremos sumando ventas por fecha de creación HOY.*
        
        const salesRes = await pool.query(`
            SELECT payment_method, amount_paid_usd, bcv_rate_snapshot 
            FROM sales 
            WHERE created_at >= $1 AND status != 'ANULADO'
        `, [shift.opened_at]);

        // Inicializamos contadores detallados
        let systemTotals = { 
            cash_usd: 0, 
            cash_ves: 0, 
            zelle: 0, 
            pm: 0, 
            punto: 0,
            credits: 0,    // Ventas a Crédito (Dinero que NO entró)
            donations: 0   // Donaciones (Dinero que NUNCA entrará)
        };

        salesRes.rows.forEach(row => {
            const pm = (row.payment_method || '').toUpperCase();
            const amount = parseFloat(row.amount_paid_usd || 0); // Lo que realmente se pagó
            const rate = parseFloat(row.bcv_rate_snapshot || 0);

            // [NUEVO - SIN AFECTAR ESTRUCTURA]
            // DETECTAR SALIDA DE DINERO POR AVANCE DE EFECTIVO
            // Si el método de pago tiene [CAP:...], significa que entró dinero digital (ej. Zelle)
            // pero salió efectivo físico. Debemos restar esa salida de la caja de Bolívares.
            if (row.payment_method && row.payment_method.includes('[CAP:')) {
                try {
                    const match = row.payment_method.match(/\[CAP:([\d\.]+)\]/);
                    if (match && match[1]) {
                        const capitalUSD = parseFloat(match[1]);
                        const capitalVES = capitalUSD * rate; // Convertimos el capital a Bs
                        
                        // Restamos de la caja física porque el dinero salió
                        systemTotals.cash_ves -= capitalVES;
                    }
                } catch (e) {
                    console.error("Error descontando avance de caja:", e);
                }
            }

            // [TU LÓGICA ORIGINAL INTACTA]
            // 1. DONACIONES (Salida de inventario, Cero dinero)
            if (pm.includes('DONACIÓN') || pm.includes('DONACION') || pm.includes('REGALO')) {
                systemTotals.donations += amount; // Solo informativo
            }
            // 2. CRÉDITOS PENDIENTES (Dinero futuro)
            else if (pm.includes('CRÉDITO') || pm.includes('CREDITO')) {
                // Si la venta fue mixta (parte pago, parte crédito), el amount_paid_usd ya trae lo pagado.
                // Si es totalmente crédito, amount_paid_usd debería ser 0.
                if (amount === 0) systemTotals.credits += 0; // No suma a caja
            }
            // 3. DINERO REAL
            else {
                if (pm.includes('EFECTIVO') && (pm.includes('USD') || pm.includes('REF'))) {
                    systemTotals.cash_usd += amount;
                } else if (pm.includes('EFECTIVO') && (pm.includes('BS') || pm.includes('BOLIVARES'))) {
                    systemTotals.cash_ves += (amount * rate);
                } else if (pm.includes('ZELLE')) {
                    systemTotals.zelle += amount;
                } else if (pm.includes('PAGO MÓVIL') || pm.includes('MOVIL')) {
                    systemTotals.pm += (amount * rate);
                } else if (pm.includes('PUNTO') || pm.includes('TARJETA') || pm.includes('DEBITO')) {
                    systemTotals.punto += (amount * rate);
                }
            }
        });

        res.json({
            status: 'ABIERTA',
            shift_info: shift,
            system_totals: systemTotals
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cash/close', async (req, res) => {
    const { declared, notes } = req.body; 
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shiftRes = await client.query("SELECT * FROM cash_shifts WHERE status = 'ABIERTA' FOR UPDATE");
        if (shiftRes.rows.length === 0) throw new Error('No hay caja abierta.');
        const shift = shiftRes.rows[0];

        // Recálculo de seguridad (Misma lógica que arriba)
        const salesRes = await client.query(`
            SELECT payment_method, amount_paid_usd, bcv_rate_snapshot 
            FROM sales WHERE created_at >= $1 AND status != 'ANULADO'
        `, [shift.opened_at]);

        let sys = { cash_usd: 0, cash_ves: 0, zelle: 0, pm: 0, punto: 0 };
        
        salesRes.rows.forEach(row => {
            const pm = (row.payment_method || '').toUpperCase();
            const paid = parseFloat(row.amount_paid_usd || 0);
            const rate = parseFloat(row.bcv_rate_snapshot || 0);

            // Excluir Donaciones y Créditos del "Sistema Espera" (Dinero)
            if (pm.includes('DONACIÓN') || pm.includes('DONACION') || pm.includes('REGALO')) return;
            if (pm.includes('CRÉDITO') || pm.includes('CREDITO')) return; // Asumiendo que amount_paid_usd es 0 si es full crédito

            if (pm.includes('EFECTIVO') && (pm.includes('USD') || pm.includes('REF'))) sys.cash_usd += paid;
            else if (pm.includes('EFECTIVO') && (pm.includes('BS') || pm.includes('BOLIVARES'))) sys.cash_ves += (paid * rate);
            else if (pm.includes('ZELLE')) sys.zelle += paid;
            else if (pm.includes('PAGO MÓVIL') || pm.includes('MOVIL')) sys.pm += (paid * rate);
            else if (pm.includes('PUNTO') || pm.includes('TARJETA')) sys.punto += (paid * rate);
        });

        const expected_usd = parseFloat(shift.initial_cash_usd) + sys.cash_usd;
        const expected_ves = parseFloat(shift.initial_cash_ves) + sys.cash_ves;

        const diff_usd = parseFloat(declared.cash_usd) - expected_usd;
        const diff_ves = parseFloat(declared.cash_ves) - expected_ves;

        await client.query(`
            UPDATE cash_shifts SET 
                closed_at = CURRENT_TIMESTAMP, status = 'CERRADA',
                system_cash_usd=$1, system_cash_ves=$2, system_zelle=$3, system_pago_movil=$4, system_punto=$5,
                real_cash_usd=$6, real_cash_ves=$7, real_zelle=$8, real_pago_movil=$9, real_punto=$10,
                diff_usd=$11, diff_ves=$12, notes=$13
            WHERE id = $14
        `, [
            sys.cash_usd, sys.cash_ves, sys.zelle, sys.pm, sys.punto,
            declared.cash_usd, declared.cash_ves, declared.zelle, declared.pm, declared.punto,
            diff_usd, diff_ves, notes, shift.id
        ]);

        await client.query('COMMIT');
        res.json({ success: true });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- NUEVO: HISTORIAL DE CIERRES PARA BI ---
app.get('/api/reports/closings', async (req, res) => {
    try {
        // Traemos los últimos 50 cierres ordenados por fecha
        const result = await pool.query(`
            SELECT * FROM cash_shifts 
            ORDER BY opened_at DESC 
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 📦 GESTIÓN DE INVENTARIO PRO (KARDEX)
// ==========================================

// 1. Registrar Movimiento (Entrada/Salida con Auditoría)
// SERVER.JS

// --- ENDPOINT MAESTRO DE MOVIMIENTOS DE INVENTARIO (CON TRANSACCIÓN SEGURA) ---
app.post('/api/inventory/movement', async (req, res) => {
    const { product_id, type, quantity, document_ref, reason, cost_usd, new_expiration, specific_batch_id } = req.body;
    
    // Validaciones iniciales
    const qty = parseInt(quantity);
    if (!product_id || isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: "Datos incompletos o cantidad inválida" });
    }

    // Usamos 'client' en lugar de 'pool' directo para poder hacer ROLLBACK si algo falla
    const client = await pool.connect(); 
    
    try {
        await client.query('BEGIN'); // Iniciamos transacción (todo o nada)

        // 1. Obtener info del producto (Precio base y si es perecedero)
        const prodRes = await client.query('SELECT price_usd, is_perishable FROM products WHERE id = $1', [product_id]);
        if (prodRes.rows.length === 0) throw new Error('Producto no existe');
        
        const product = prodRes.rows[0];
        // Costo del movimiento: Si no envían costo (ej. venta), usamos el precio base del producto
        let currentCost = cost_usd !== undefined && cost_usd !== "" ? parseFloat(cost_usd) : parseFloat(product.price_usd);

        // --- ENTRADAS (IN) ---
        if (type === 'IN') {
            // Validar fecha solo si el producto es perecedero
            let expDate = null;
            if (product.is_perishable) {
                // Si es devolución y no trajo fecha, intentamos usar null o fecha actual, pero idealmente debe venir del front
                expDate = new_expiration || null; 
            }

            // Lógica inteligente: ¿Ya existe un lote con esa fecha y costo? Sumamos ahí.
            // Si no, creamos lote nuevo.
            const existingBatch = await client.query(
                'SELECT id FROM product_batches WHERE product_id = $1 AND expiration_date IS NOT DISTINCT FROM $2 AND cost_usd = $3', 
                [product_id, expDate, currentCost]
            );

            if (existingBatch.rows.length > 0) {
                // Actualizar lote existente
                await client.query('UPDATE product_batches SET stock = stock + $1 WHERE id = $2', [qty, existingBatch.rows[0].id]);
            } else {
                // Crear nuevo lote
                await client.query(
                    'INSERT INTO product_batches (product_id, expiration_date, stock, cost_usd, batch_code) VALUES ($1, $2, $3, $4, $5)',
                    [product_id, expDate, qty, currentCost, document_ref || 'ENTRADA']
                );
            }
        } 
        
        // --- SALIDAS (OUT) ---
        else {
            // Caso A: Salida de Lote Específico (Requerido para Merma/Vencimiento/Daño)
            if (specific_batch_id) {
                const batchCheck = await client.query('SELECT stock FROM product_batches WHERE id = $1', [specific_batch_id]);
                if (batchCheck.rows.length === 0) throw new Error("El lote seleccionado no existe.");
                if (batchCheck.rows[0].stock < qty) throw new Error("El lote no tiene suficiente stock.");
                
                await client.query('UPDATE product_batches SET stock = stock - $1 WHERE id = $2', [qty, specific_batch_id]);
            } 
            // Caso B: Salida Automática FEFO/FIFO (Para Ventas o Consumo General)
            else {
                // Buscamos lotes con stock, ordenados por fecha (los nulos o más lejanos al final)
                const batches = await client.query(`
                    SELECT id, stock FROM product_batches 
                    WHERE product_id = $1 AND stock > 0 
                    ORDER BY expiration_date ASC NULLS LAST
                `, [product_id]);

                let remaining = qty;
                const totalStock = batches.rows.reduce((sum, b) => sum + b.stock, 0);
                
                if (totalStock < qty) throw new Error(`Stock insuficiente. Disponibles: ${totalStock}, Solicitados: ${qty}`);

                for (let batch of batches.rows) {
                    if (remaining <= 0) break;
                    const take = Math.min(batch.stock, remaining);
                    await client.query('UPDATE product_batches SET stock = stock - $1 WHERE id = $2', [take, batch.id]);
                    remaining -= take;
                }
            }
        }

        // 3. Actualizar Stock Total en la tabla maestra 'products'
        // Calculamos: Si es IN, sumamos. Si es OUT, restamos.
        const stockOperator = type === 'IN' ? '+' : '-';
        // Nota: Concatenamos el operador directamente en el string SQL porque no se puede pasar como parámetro bind ($1)
        // Esto es seguro aquí porque 'stockOperator' lo definimos nosotros arriba, no viene del usuario.
        const updateMaster = await client.query(`
            UPDATE products 
            SET stock = stock ${stockOperator} $1, last_stock_update = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING stock
        `, [qty, product_id]);
        
        const finalStock = updateMaster.rows[0].stock;

        // 4. Registrar en el Kardex (Historial imborrable)
        await client.query(`
            INSERT INTO inventory_movements (product_id, type, quantity, reason, document_ref, new_stock)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            product_id,                // $1
            type,                      // $2 (IN o OUT)
            qty,                       // $3
            reason || 'MOVIMIENTO MANUAL', // $4
            document_ref || 'MANUAL',  // $5
            finalStock                 // $6
        ]);

        await client.query('COMMIT'); // Guardar cambios definitivamente
        res.json({ success: true, new_stock: finalStock });

    } catch (err) {
        await client.query('ROLLBACK'); // Deshacer cambios si algo falló en cualquier paso
        console.error("Error en movimiento inventario:", err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release(); // Liberar conexión al pool
    }
});

// 2. Obtener Historial de un Producto
app.get('/api/inventory/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Aumentamos a 50 para que el scroll sea útil y visible
        const result = await pool.query(`
            SELECT * FROM inventory_movements 
            WHERE product_id = $1 
            ORDER BY created_at DESC LIMIT 50
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.json([]); 
    }
});

// --- SERVIR ARCHIVOS ESTÁTICOS DEL FRONTEND (REACT) --- //
// 1. Decirle a Express que busque en la carpeta dist (que se crea en el build)
// Se asume la estructura: /bms-pos-backend/server (aquí estamos) y /bms-pos-backend/bms-pos-frontend
app.use(express.static(path.join(__dirname, '../bms-pos-frontend/dist')));

// 2. Cualquier ruta que NO sea /api, se redirige al index.html de React
// [CORRECCIÓN 2] Cambiado '*' por /.*/ porque Express 5.0 ya no acepta '*'
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../bms-pos-frontend/dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚀 Servidor BMS corriendo en puerto ${port}`);
});