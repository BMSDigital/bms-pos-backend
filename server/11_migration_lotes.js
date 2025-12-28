const { Pool } = require('pg');
// COLOCA TU URL DE BASE DE DATOS AQUÍ
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function migrateToBatches() {
    try {
        console.log('🚀 Iniciando migración a Sistema de Lotes Robusto...');

        // 1. Crear tabla de Lotes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_batches (
                id SERIAL PRIMARY KEY,
                product_id INT REFERENCES products(id),
                batch_code VARCHAR(50), -- Código de lote del fabricante (opcional)
                expiration_date DATE,
                stock INT DEFAULT 0,
                cost_usd NUMERIC(10, 2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabla product_batches creada.');

        // 2. Migrar el stock actual de 'products' a un lote inicial en 'product_batches'
        // Solo para productos que tengan stock > 0
        const migration = await pool.query(`
            INSERT INTO product_batches (product_id, expiration_date, stock, cost_usd, batch_code)
            SELECT id, expiration_date, stock, price_usd, 'LOTE-INICIAL'
            FROM products
            WHERE stock > 0
            AND NOT EXISTS (SELECT 1 FROM product_batches WHERE product_batches.product_id = products.id);
        `);
        
        console.log(`📦 Se crearon ${migration.rowCount} lotes iniciales basados en el inventario actual.`);
        console.log('✅ Sistema actualizado a Nivel 2.');

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        pool.end();
    }
}

migrateToBatches();