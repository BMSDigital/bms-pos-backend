// server/server07_credit_updates.js
const { Pool } = require('pg');

// TU URL DE RENDER
const connectionString = process.env.DATABASE_URL || 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function updateCreditSchema() {
    try {
        console.log('⏳ Actualizando tabla sales para soporte de abonos...');
        
        // 1. Agregar columna de monto pagado acumulado
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_paid_usd DECIMAL(10, 2) DEFAULT 0.00;");
        
        // 2. Actualizar ventas viejas: Si dice 'PAGADO', el monto pagado es igual al total. Si 'PENDIENTE', es 0.
        await pool.query("UPDATE sales SET amount_paid_usd = total_usd WHERE status = 'PAGADO' AND amount_paid_usd = 0;");
        
        console.log('✅ Esquema de créditos actualizado correctamente.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        pool.end();
    }
}

updateCreditSchema();