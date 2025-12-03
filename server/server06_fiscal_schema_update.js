const { Pool } = require('pg');

// PEGA TU URL DE BASE DE DATOS DE RENDER AQUÍ
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function updateFiscalSchema() {
    try {
        console.log('⏳ Iniciando migración de esquema fiscal (IVA y Base Imponible/Exenta)...');
        
        // 1. Añadir campo is_taxable a products (por defecto, todos los productos existentes se consideran GRAVADOS)
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN DEFAULT TRUE;");
        console.log('✅ Columna "is_taxable" añadida a products.');
        
        // 2. Añadir campos de desglose fiscal a sales
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal_taxable_usd DECIMAL(10, 2) DEFAULT 0.00;");
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal_exempt_usd DECIMAL(10, 2) DEFAULT 0.00;");
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS iva_rate DECIMAL(4, 2) DEFAULT 0.16;"); // Tasa de IVA fija
        await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS iva_usd DECIMAL(10, 2) DEFAULT 0.00;");
        console.log('✅ Columnas de desglose fiscal (subtotal_taxable_usd, subtotal_exempt_usd, iva_rate, iva_usd) añadidas a sales.');

        console.log('🎉 ¡Éxito! Migración de esquema fiscal completada.');
        
    } catch (err) {
        console.error('❌ Error al migrar el esquema fiscal:', err.message);
    } finally {
        pool.end();
    }
}

updateFiscalSchema();