const { Pool } = require('pg');

// TU URL DE RENDER (Tomada de tu archivo anterior)
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function addLastUpdateColumn() {
    try {
        console.log('⏳ Agregando columna de rastreo de fecha (last_stock_update)...');
        
        // 1. Agregar columna last_stock_update
        // TIMESTAMP WITH TIME ZONE: Guarda la hora exacta universal
        // DEFAULT CURRENT_TIMESTAMP: Si no enviamos fecha, pone la de "ahora mismo"
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS last_stock_update TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;");
        
        console.log('✅ Base de datos actualizada correctamente. Ahora el inventario tendrá fecha de modificación.');
    } catch (err) {
        console.error('❌ Error actualizando la base de datos:', err.message);
    } finally {
        pool.end();
    }
}

addLastUpdateColumn();