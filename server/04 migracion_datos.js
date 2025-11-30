const { Pool } = require('pg');

// PEGA TU URL DE BASE DE DATOS DE RENDER AQUÍ (La External)
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function actualizarEsquema() {
    try {
        console.log('⏳ Iniciando migración de esquema para pagos a Crédito...');
        
        // --- Migración de la Tabla sales ---
        await pool.query("ALTER TABLE sales ALTER COLUMN payment_method TYPE TEXT;");
        console.log('✅ Columna "payment_method" migrada a TEXT.');
        
        // Agregamos nuevas columnas a sales (si no existen)
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PAGADO';");
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date TIMESTAMP NULL;");
        
        // --- Creación de Tabla customers (si no existe) ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id SERIAL PRIMARY KEY,
                full_name VARCHAR(150) NOT NULL,
                id_number VARCHAR(20) UNIQUE NOT NULL, 
                phone VARCHAR(20),
                institution VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabla "customers" creada/confirmada.');
        
        // Nota: Añadir FK customer_id a sales es complejo si hay datos, se ignora en migración simple.
        // Si usas crear_tablas.js, la FK ya estará ahí. Si solo usas este script, la columna se añade.
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER;"); 
        console.log('✅ Columna "customer_id" agregada a sales.');
        
    } catch (err) {
        console.error('❌ Error en la migración:', err.message);
    } finally {
        pool.end();
    }
}

actualizarEsquema();