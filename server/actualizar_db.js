const { Pool } = require('pg');

// PEGA TU URL DE BASE DE DATOS DE RENDER AQUÍ (La External)
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function actualizarEsquema() {
    try {
        console.log('⏳ Iniciando migración de esquema para pagos múltiples...');
        
        // 1. CORRECCIÓN PRINCIPAL: Modifica el tipo de dato de payment_method a TEXT 
        // para permitir cadenas largas (múltiples métodos + referencias).
        await pool.query("ALTER TABLE sales ALTER COLUMN payment_method TYPE TEXT;");
        console.log('✅ ¡Éxito! Columna "payment_method" migrada a TEXT.');
        
        // 2. Mantenemos la adición de la columna 'payment_reference' (si no existe)
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_reference TEXT;");
        console.log('✅ ¡Éxito! Columna "payment_reference" agregada (si no existía).');
        
    } catch (err) {
        console.error('❌ Error en la migración:', err.message);
    } finally {
        pool.end();
    }
}

actualizarEsquema();