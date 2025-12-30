const { Pool } = require('pg');
// Usa tu cadena de conexión de Render
const connectionString = process.env.DATABASE_URL || 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93';

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function upgradeToImages() {
    try {
        console.log('📸 Actualizando base de datos para soportar Imágenes Reales...');
        // Cambiamos el tipo de dato a TEXT para que quepan las imágenes codificadas
        await pool.query("ALTER TABLE products ALTER COLUMN icon_emoji TYPE TEXT;");
        console.log('✅ Éxito: Ahora puedes guardar fotos reales en el campo de icono.');
    } catch (e) {
        console.log('Nota:', e.message);
    } finally {
        pool.end();
    }
}
upgradeToImages();