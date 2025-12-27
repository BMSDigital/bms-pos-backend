const { Pool } = require('pg');

// PEGA TU URL DE BASE DE DATOS DE RENDER AQUÍ (La misma que usaste en tus otros scripts)
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function addExpirationColumn() {
    try {
        console.log('⏳ Añadiendo columna "expiration_date" a la tabla products...');
        
        // Comando para añadir la columna si no existe
        // Usamos IF NOT EXISTS para evitar errores si lo corres dos veces
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS expiration_date DATE;");
        
        console.log('✅ ¡Éxito! Columna "expiration_date" añadida a products.');
        
    } catch (err) {
        console.error('❌ Error al migrar:', err.message);
    } finally {
        pool.end();
    }
}

addExpirationColumn();