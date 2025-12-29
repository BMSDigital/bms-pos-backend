// db_pos_venta.js
const { Pool } = require('pg');

// Tu URL de base de datos en Render
const connectionString = 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

const sql = `
-- 1. Tabla Clientes
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    id_number VARCHAR(20) UNIQUE NOT NULL,
    phone VARCHAR(20),
    institution VARCHAR(100),
    status VARCHAR(20) DEFAULT 'ACTIVO',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla Productos
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    price_usd DECIMAL(10, 2) NOT NULL,
    stock INTEGER DEFAULT 0,
    icon_emoji VARCHAR(10) DEFAULT '🍔',
    is_taxable BOOLEAN DEFAULT TRUE,
    barcode VARCHAR(50),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    expiration_date DATE,
    last_stock_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla Lotes (Vencimientos)
CREATE TABLE IF NOT EXISTS product_batches (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    expiration_date DATE,
    stock INTEGER NOT NULL DEFAULT 0,
    cost_usd DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla Ventas
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_usd DECIMAL(10, 2),
    total_ves DECIMAL(12, 2),
    bcv_rate_snapshot DECIMAL(10, 2),
    payment_method TEXT,
    status VARCHAR(20) DEFAULT 'PAGADO',
    invoice_type VARCHAR(20) DEFAULT 'TICKET',
    customer_id INTEGER REFERENCES customers(id),
    due_date TIMESTAMP,
    subtotal_taxable_usd DECIMAL(10, 2) DEFAULT 0,
    subtotal_exempt_usd DECIMAL(10, 2) DEFAULT 0,
    iva_rate DECIMAL(5, 4) DEFAULT 0.16,
    iva_usd DECIMAL(10, 2) DEFAULT 0,
    amount_paid_usd DECIMAL(10, 2) DEFAULT 0
);

-- 5. Tabla Items de Venta
CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    price_at_moment_usd DECIMAL(10, 2)
);

-- 6. Tabla Movimientos (Kardex)
CREATE TABLE IF NOT EXISTS inventory_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    type VARCHAR(10) NOT NULL,
    quantity INTEGER NOT NULL,
    prev_stock INTEGER,
    new_stock INTEGER,
    document_ref VARCHAR(100),
    reason VARCHAR(100),
    cost_usd DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Tabla Cierre de Caja
CREATE TABLE IF NOT EXISTS cash_shifts (
    id SERIAL PRIMARY KEY,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'ABIERTA',
    initial_cash_usd DECIMAL(10, 2) DEFAULT 0,
    initial_cash_ves DECIMAL(12, 2) DEFAULT 0,
    system_cash_usd DECIMAL(10, 2) DEFAULT 0,
    system_cash_ves DECIMAL(12, 2) DEFAULT 0,
    system_zelle DECIMAL(10, 2) DEFAULT 0,
    system_pago_movil DECIMAL(12, 2) DEFAULT 0,
    system_punto DECIMAL(12, 2) DEFAULT 0,
    real_cash_usd DECIMAL(10, 2) DEFAULT 0,
    real_cash_ves DECIMAL(12, 2) DEFAULT 0,
    real_zelle DECIMAL(10, 2) DEFAULT 0,
    real_pago_movil DECIMAL(12, 2) DEFAULT 0,
    real_punto DECIMAL(12, 2) DEFAULT 0,
    diff_usd DECIMAL(10, 2) DEFAULT 0,
    diff_ves DECIMAL(12, 2) DEFAULT 0,
    notes TEXT
);
`;

async function crearTablas() {
    try {
        console.log('⏳ Conectando a Render...');
        await pool.query(sql);
        console.log('✅ ¡TABLAS CREADAS CON ÉXITO! Base de datos lista.');
    } catch (err) {
        console.error('❌ Error creando tablas:', err);
    } finally {
        pool.end();
    }
}

crearTablas();