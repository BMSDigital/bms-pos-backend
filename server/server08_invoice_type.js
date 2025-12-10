const { Pool } = require('pg');

// TU URL DE BASE DE DATOS DE RENDER (Tomada de tus archivos anteriores)
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function addInvoiceTypeColumn() {
    try {
        console.log('⏳ Agregando soporte para Facturación Fiscal (columna invoice_type)...');
        
        // Agregamos la columna 'invoice_type' a la tabla 'sales'.
        // DEFAULT 'TICKET': Todas las ventas viejas y las normales serán tipo Ticket/Nota de Entrega.
        // Las nuevas que marques serán 'FISCAL'.
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(20) DEFAULT 'TICKET';");
        
        console.log('✅ ¡Éxito! Columna "invoice_type" agregada a la tabla sales.');
        
    } catch (err) {
        console.error('❌ Error al actualizar la base de datos:', err.message);
    } finally {
        pool.end();
    }
}

addInvoiceTypeColumn();