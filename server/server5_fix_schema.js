const { Pool } = require('pg');

// PEGA TU URL DE BASE DE DATOS DE RENDER AQUÍ
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function addMissingColumn() {
    try {
        console.log('⏳ Añadiendo columna "status" a la tabla customers...');
        
        // Comando para añadir la columna si no existe, con su valor por defecto
        await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVO';");
        
        console.log('✅ ¡Éxito! Columna "status" añadida a customers.');
        
    } catch (err) {
        console.error('❌ Error al migrar:', err.message);
    } finally {
        pool.end();
    }
}

addMissingColumn();