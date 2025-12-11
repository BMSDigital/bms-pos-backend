const { Pool } = require('pg');

// TU URL DE RENDER
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function fixProductStatus() {
    try {
        console.log('🔧 Reparando estados nulos en productos...');
        
        // Esta línea pone 'ACTIVE' a todo lo que no tenga estado
        await pool.query("UPDATE products SET status = 'ACTIVE' WHERE status IS NULL OR status = '';");
        
        console.log('✅ ¡Listo! Todos los productos son visibles ahora.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        pool.end();
    }
}

fixProductStatus();