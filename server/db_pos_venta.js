// db_setup.js
// Script de Creación y Actualización de Base de Datos BMS-POS (Actualizado)
// Autor: Fraibert Bracho & Asistente AI

const { Pool } = require('pg');

// Tu URL de conexión (La misma de tu server.js)
const connectionString = 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

const sql = `
-- 1. Tabla Clientes (Gestión de Personas)
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    id_number VARCHAR(20) UNIQUE NOT NULL, -- Cédula o RIF
    phone VARCHAR(20),
    institution VARCHAR(100),
    status VARCHAR(20) DEFAULT 'ACTIVO',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla Productos (Maestro de Inventario)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    price_usd DECIMAL(10, 2) NOT NULL,
    stock INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 5,
    status VARCHAR(20) DEFAULT 'ACTIVO',
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla Ventas (Cabecera de Factura)
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    payment_method VARCHAR(50), -- PAGO MÓVIL, DIVISAS, TRANSFERENCIA, PUNTO
    total_usd DECIMAL(10, 2),
    total_ves DECIMAL(12, 2),
    bcv_rate_snapshot DECIMAL(10, 2), -- Tasa BCV al momento de la venta
    status VARCHAR(20) DEFAULT 'PAGADO', -- PAGADO, PENDIENTE (Crédito), ANULADO
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- CAMPOS PARA CRÉDITO
    due_date TIMESTAMP, -- Fecha límite de pago
    amount_paid_usd DECIMAL(10, 2) DEFAULT 0, -- Cuánto han abonado
    
    -- CAMPOS FISCALES (SENIAT)
    invoice_type VARCHAR(20) DEFAULT 'NOTA', -- FACTURA, NOTA
    subtotal_taxable_usd DECIMAL(10, 2) DEFAULT 0, -- Base Imponible
    subtotal_exempt_usd DECIMAL(10, 2) DEFAULT 0, -- Exento
    iva_rate DECIMAL(5, 2) DEFAULT 16.00,
    iva_usd DECIMAL(10, 2) DEFAULT 0
);

-- 4. Detalle de Venta (Items)
CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price_usd DECIMAL(10, 2) NOT NULL,
    subtotal_usd DECIMAL(10, 2) NOT NULL,
    product_name_snapshot VARCHAR(100) -- Guardamos el nombre por si se borra el producto
);

-- 5. Movimientos de Inventario (Kardex)
CREATE TABLE IF NOT EXISTS inventory_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    type VARCHAR(20), -- ENTRADA (Compra), SALIDA (Venta), AJUSTE
    quantity INTEGER,
    previous_stock INTEGER,
    new_stock INTEGER,
    reason TEXT,
    reference_id INTEGER, -- ID de venta o compra
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Proveedores (Compras)
CREATE TABLE IF NOT EXISTS providers (
    id SERIAL PRIMARY KEY,
    rif VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    address TEXT,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Órdenes de Compra
CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    provider_id INTEGER REFERENCES providers(id),
    status VARCHAR(20) DEFAULT 'RECIBIDO',
    total_usd DECIMAL(10, 2),
    exchange_rate DECIMAL(10, 2),
    invoice_number VARCHAR(50), -- Número de Factura del Proveedor
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Items de Compra
CREATE TABLE IF NOT EXISTS purchase_items (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER,
    cost_usd DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Lotes de Productos (Vencimiento)
CREATE TABLE IF NOT EXISTS product_batches (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    batch_code VARCHAR(50),
    expiration_date DATE,
    quantity INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. Historial de Abonos (NUEVO: Para Cuentas por Cobrar)
-- Esta tabla permite registrar cuándo entró el dinero exactamente, independientemente de cuándo se hizo la venta.
CREATE TABLE IF NOT EXISTS credit_payments (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(id),
    amount_usd DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(150), -- Guardará el detalle ej: "PAGO_MOVIL [Ref: 1234]"
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
    try {
        console.log('⏳ Iniciando verificación de base de datos...');
        
        // 1. Ejecución principal de tablas
        await pool.query(sql);
        console.log('✅ TABLAS ESTRUCTURALES VERIFICADAS.');
        
        // 2. MIGRACIONES Y ACTUALIZACIONES (ALTER TABLE)
        // Esto es necesario porque si las tablas ya existen, el CREATE TABLE arriba no agrega columnas nuevas.
        
        try {
            // Actualización Productos: Perecederos y Código de Lote
            await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_perishable BOOLEAN DEFAULT FALSE;`);
            await pool.query(`ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS batch_code VARCHAR(100);`);
            
            // [NUEVO] Actualización Productos: Insumo vs Producto
            await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_raw_material BOOLEAN DEFAULT FALSE;`);
            
            // 🔥 [NUEVO] Columna para auditoría de pagos (Solución Error Pay-All) 🔥
            await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

            // ==================================================================================
            // 👇 [CRÍTICO] SOLUCIÓN ERROR LIBRO DE VENTAS (SENIAT) 👇
            // ==================================================================================
            await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS control_number VARCHAR(50);`);
            console.log('✅ Columna control_number verificada (Requerida para Libro de Ventas).');
            // ==================================================================================
            
            console.log('🔧 Columnas adicionales verificadas (is_perishable, batch_code, is_raw_material, updated_at, control_number).');
        } catch (e) {
            console.log('ℹ️ Nota sobre actualizaciones: ', e.message);
        }

        console.log('🚀 ¡BASE DE DATOS LISTA PARA USAR!');

    } catch (err) {
        console.error('❌ Error gestionando tablas:', err);
    } finally {
        await pool.end();
    }
})();