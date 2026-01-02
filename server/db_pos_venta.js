// db_setup.js
// Script de Creación y Actualización de Base de Datos BMS-POS
// Autor: Fraibert Bracho

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
    icon_emoji VARCHAR(10) DEFAULT '📦',
    is_taxable BOOLEAN DEFAULT TRUE,
    barcode VARCHAR(50),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    
    -- Campos Nuevos para Lógica Avanzada
    expiration_date DATE,
    is_perishable BOOLEAN DEFAULT FALSE, -- [NUEVO] Control de perecederos
    last_stock_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla Lotes (Control de Vencimientos y Costos)
CREATE TABLE IF NOT EXISTS product_batches (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    expiration_date DATE,
    stock INTEGER NOT NULL DEFAULT 0,
    cost_usd DECIMAL(10, 2) DEFAULT 0,
    
    -- [NUEVO] Código de lote para trazabilidad
    batch_code VARCHAR(100), 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla Ventas (Cabecera de Factura)
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Totales Financieros
    total_usd DECIMAL(10, 2),
    total_ves DECIMAL(12, 2),
    bcv_rate_snapshot DECIMAL(10, 2), -- Tasa histórica del momento de la venta
    
    -- Datos Operativos
    payment_method TEXT, -- Puede incluir "EFECTIVO", "ZELLE", "CREDITO", etc.
    status VARCHAR(20) DEFAULT 'PAGADO', -- PAGADO, PENDIENTE (Crédito), ANULADO
    invoice_type VARCHAR(20) DEFAULT 'TICKET', -- TICKET o FISCAL
    customer_id INTEGER REFERENCES customers(id),
    
    -- Control de Crédito
    due_date TIMESTAMP, -- Fecha de vencimiento del crédito
    amount_paid_usd DECIMAL(10, 2) DEFAULT 0, -- Cuánto han pagado realmente
    
    -- Desglose Fiscal
    subtotal_taxable_usd DECIMAL(10, 2) DEFAULT 0,
    subtotal_exempt_usd DECIMAL(10, 2) DEFAULT 0,
    iva_rate DECIMAL(5, 4) DEFAULT 0.16,
    iva_usd DECIMAL(10, 2) DEFAULT 0
);

-- 5. Tabla Items de Venta (Detalle de Factura)
CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    price_at_moment_usd DECIMAL(10, 2) -- Precio histórico
);

-- 6. Tabla Movimientos (Kardex de Inventario - Auditoría)
CREATE TABLE IF NOT EXISTS inventory_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    type VARCHAR(10) NOT NULL, -- 'IN' (Entrada) o 'OUT' (Salida)
    quantity INTEGER NOT NULL,
    
    -- Trazabilidad
    prev_stock INTEGER, -- Stock antes del movimiento
    new_stock INTEGER,  -- Stock después del movimiento
    
    -- Contexto
    document_ref VARCHAR(100), -- Nro Factura, Nota de Entrega, etc.
    reason VARCHAR(100),       -- VENTA, COMPRA, MERMA, AJUSTE, ETC.
    cost_usd DECIMAL(10, 2),   -- Costo del lote movido
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Tabla Cierre de Caja (Arqueo y Turnos)
CREATE TABLE IF NOT EXISTS cash_shifts (
    id SERIAL PRIMARY KEY,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'ABIERTA', -- ABIERTA, CERRADA
    
    -- Montos Iniciales (Fondo de Caja)
    initial_cash_usd DECIMAL(10, 2) DEFAULT 0,
    initial_cash_ves DECIMAL(12, 2) DEFAULT 0,
    
    -- Montos Calculados por el Sistema (Esperados)
    system_cash_usd DECIMAL(10, 2) DEFAULT 0,
    system_cash_ves DECIMAL(12, 2) DEFAULT 0,
    system_zelle DECIMAL(10, 2) DEFAULT 0,
    system_pago_movil DECIMAL(12, 2) DEFAULT 0,
    system_punto DECIMAL(12, 2) DEFAULT 0,
    
    -- Montos Reales Declarados (Contados por el cajero)
    real_cash_usd DECIMAL(10, 2) DEFAULT 0,
    real_cash_ves DECIMAL(12, 2) DEFAULT 0,
    real_zelle DECIMAL(10, 2) DEFAULT 0,
    real_pago_movil DECIMAL(12, 2) DEFAULT 0,
    real_punto DECIMAL(12, 2) DEFAULT 0,
    
    -- Diferencias (Sobrantes o Faltantes)
    diff_usd DECIMAL(10, 2) DEFAULT 0,
    diff_ves DECIMAL(12, 2) DEFAULT 0,
    
    notes TEXT
);
`;

async function crearTablas() {
    try {
        console.log('⏳ Conectando a Base de Datos...');
        await pool.query(sql);
        console.log('✅ ¡TABLAS ACTUALIZADAS CON ÉXITO! Estructura completa verificada.');
        
        // Verificación opcional de campos nuevos (Alter Table si ya existían)
        // Esto es útil si ya tienes datos y solo quieres agregar las columnas nuevas sin borrar nada
        try {
            await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_perishable BOOLEAN DEFAULT FALSE;`);
            await pool.query(`ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS batch_code VARCHAR(100);`);
            console.log('🔧 Columnas nuevas verificadas (is_perishable, batch_code).');
        } catch (e) {
            console.log('ℹ️ Las columnas ya existían o no se pudieron agregar dinámicamente.');
        }

    } catch (err) {
        console.error('❌ Error gestionando tablas:', err);
    } finally {
        pool.end();
    }
}

crearTablas();