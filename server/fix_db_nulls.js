// server/fix_db_nulls.js
const { Pool } = require('pg');

// 👇 Tu conexión directa a Render (tomada de tus archivos subidos)
const connectionString = 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93';

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function fixDatabase() {
    try {
        console.log('🔌 Conectando a la base de datos en la nube...');
        const client = await pool.connect();
        console.log('✅ Conexión establecida.');
        client.release();

        console.log('🔧 Ajustando tablas para permitir fechas vacías...');
        
        // 1. Intentar modificar tabla PRODUCTS
        try {
            await pool.query("ALTER TABLE products ALTER COLUMN expiration_date DROP NOT NULL;");
            console.log('✅ Tabla [products]: Ahora acepta fecha vacía.');
        } catch (e) {
            // Ignoramos si la columna no existe o ya era nullable, pero mostramos el aviso
            console.log('ℹ️ Nota en [products]:', e.message); 
        }

        // 2. Intentar modificar tabla PRODUCT_BATCHES (Lotes)
        try {
            await pool.query("ALTER TABLE product_batches ALTER COLUMN expiration_date DROP NOT NULL;");
            console.log('✅ Tabla [product_batches]: Ahora acepta fecha vacía.');
        } catch (e) {
            console.log('ℹ️ Nota en [product_batches]:', e.message);
        }
        
        console.log('🏁 Proceso de Base de Datos terminado.');

    } catch (err) {
        console.error('❌ Error General:', err);
    } finally {
        pool.end();
    }
}

fixDatabase();