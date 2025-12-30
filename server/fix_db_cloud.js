const { Pool } = require('pg');
// Tu conexión directa (Copiada de tus archivos para asegurar conexión)
const connectionString = 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93';

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
    try {
        console.log('🚀 Iniciando parche de Base de Datos...');
        await pool.query("ALTER TABLE products ALTER COLUMN expiration_date DROP NOT NULL;");
        await pool.query("ALTER TABLE product_batches ALTER COLUMN expiration_date DROP NOT NULL;");
        console.log('✨ Éxito: Ahora el sistema acepta productos sin vencimiento.');
    } catch (e) { console.log('Info:', e.message); }
    pool.end();
}
run();