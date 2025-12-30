const { Pool } = require('pg');

// Tu URL de conexión (la misma que usas en server.js o db_pos_venta.js)
const connectionString = process.env.DATABASE_URL || 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93';

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

const runFix = async () => {
    try {
        console.log('⏳ Reparando tabla product_batches...');
        
        // Agregamos la columna faltante
        await pool.query(`
            ALTER TABLE product_batches 
            ADD COLUMN IF NOT EXISTS batch_code VARCHAR(100);
        `);

        console.log('✅ ¡Listo! La columna "batch_code" ha sido creada.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        pool.end();
    }
};

runFix();