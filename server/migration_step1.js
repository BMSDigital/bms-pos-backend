const { Pool } = require('pg');

// Asegúrate de que esta URL sea la correcta de tu archivo .env o hardcodeada como en tus otros archivos
const connectionString = process.env.DATABASE_URL || 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93';

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

const runMigration = async () => {
    try {
        console.log('⏳ Iniciando migración de Base de Datos...');
        
        await pool.query(`
            ALTER TABLE products ADD COLUMN IF NOT EXISTS is_perishable BOOLEAN DEFAULT TRUE;
            ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS cost_usd DECIMAL(10, 2) DEFAULT 0;
        `);

        console.log('✅ Migración completada: Columnas agregadas exitosamente.');
    } catch (err) {
        console.error('❌ Error en migración:', err.message);
    } finally {
        pool.end();
    }
};

runMigration();