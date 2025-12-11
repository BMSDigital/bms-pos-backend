const { Pool } = require('pg');

// TU URL DE RENDER
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function updateProductSchema() {
    try {
        console.log('⏳ Actualizando tabla products (Código de Barras y Estatus)...');
        
        // 1. Agregar columna barcode (Opcional)
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(50);");
        
        // 2. Agregar columna status (Por defecto ACTIVO)
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';");
        
        // 3. Asegurar que los productos existentes estén activos
        await pool.query("UPDATE products SET status = 'ACTIVE' WHERE status IS NULL;");
        
        console.log('✅ Esquema de productos actualizado correctamente.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        pool.end();
    }
}

updateProductSchema();