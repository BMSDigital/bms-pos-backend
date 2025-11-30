const { Pool } = require('pg');

// PEGA TU URL DE BASE DE DATOS DE RENDER AQUÍ (La External)
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function agregarColumna() {
    try {
        console.log('⏳ Actualizando base de datos...');
        // Agregamos la columna 'payment_reference' tipo TEXTO, si no existe.
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_reference TEXT;");
        console.log('✅ ¡Éxito! Columna "payment_reference" agregada.');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        pool.end();
    }
}

agregarColumna();