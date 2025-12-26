const { Pool } = require('pg');

// ✅ USAMOS LA CONEXIÓN DIRECTA A RENDER (Tomada de tu archivo 09)
// Esto soluciona el error de conexión a localhost
const connectionString = 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function createKardexTable() {
    const client = await pool.connect();
    try {
        console.log('🚀 Iniciando creación de tabla para Kardex (Movimientos de Inventario) en RENDER...');

        const query = `
            CREATE TABLE IF NOT EXISTS inventory_movements (
                id SERIAL PRIMARY KEY,
                product_id INTEGER REFERENCES products(id),
                type VARCHAR(10) NOT NULL, -- 'IN' (Entrada) o 'OUT' (Salida)
                quantity INTEGER NOT NULL,
                prev_stock INTEGER, -- Stock antes del movimiento
                new_stock INTEGER,  -- Stock después del movimiento
                document_ref VARCHAR(100), -- Nro Factura / Nota Entrega
                reason VARCHAR(100), -- Compra, Merma, Ajuste
                cost_usd DECIMAL(10, 2), -- Costo al momento de la entrada
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;

        await client.query(query);
        console.log('✅ Tabla "inventory_movements" creada exitosamente en la nube.');

    } catch (err) {
        console.error('❌ Error creando la tabla:', err);
    } finally {
        client.release();
        pool.end();
    }
}

createKardexTable();