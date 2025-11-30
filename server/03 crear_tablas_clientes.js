const { Pool } = require('pg');

// PEGA AQUÍ TU EXTERNAL DATABASE URL DE RENDER
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false } // Necesario para Render
});

const sql = `
-- 1. Tabla de Productos (Mantenida)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    price_usd DECIMAL(10, 2) NOT NULL, -- La clave: Precio en Dólares
    stock INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. NUEVA TABLA: Tabla de Clientes (Para Crédito)
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    id_number VARCHAR(20) UNIQUE NOT NULL, -- Cédula (CI)
    phone VARCHAR(20),
    institution VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Ventas (Historial - MODIFICADA)
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_usd DECIMAL(10, 2),
    total_ves DECIMAL(12, 2),
    bcv_rate_snapshot DECIMAL(10, 2), -- Guardamos a qué tasa se vendió
    payment_method TEXT, -- Cambiado a TEXT para aceptar cadenas largas (multi-pago + refs)
    
    -- Campos de Crédito (NUEVOS)
    status VARCHAR(20) DEFAULT 'PAGADO', -- Puede ser 'PAGADO', 'PENDIENTE', 'CANCELADO'
    due_date TIMESTAMP NULL, -- Fecha límite de pago
    customer_id INTEGER REFERENCES customers(id) -- Cliente asociado al crédito
);

-- 4. Tabla de Detalles (Mantenida)
CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    price_at_moment_usd DECIMAL(10, 2)
);
`;

async function createTables() {
    try {
        console.log('Conectando a Render y creando tablas...');
        await pool.query(sql);
        console.log('¡Tablas creadas/actualizadas con éxito en la nube!');
    } catch (err) {
        console.error('Error creando tablas:', err);
    } finally {
        await pool.end();
    }
}

createTables();