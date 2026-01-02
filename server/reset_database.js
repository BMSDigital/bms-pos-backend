// reset_database.js
// ⚠️ PELIGRO: ESTE SCRIPT BORRA TODOS LOS DATOS DE LA BASE DE DATOS
// Úsalo solo para reiniciar el sistema desde cero (Limpieza Total).

const { Pool } = require('pg');
const readline = require('readline');

// Tu URL de conexión (La misma de tu proyecto)
const connectionString = 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93';

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function clearDatabase() {
    const client = await pool.connect();
    try {
        console.log('\n⚠️  INICIANDO PROTOCOLO DE LIMPIEZA TOTAL...');
        console.log('⏳ Vaciando tablas y reiniciando contadores a 1...');

        // TRUNCATE: Borra datos instantáneamente
        // RESTART IDENTITY: Reinicia los IDs (SERIAL) a 1
        // CASCADE: Borra en cascada (si borras Productos, se borran sus Lotes y Movimientos automáticamente)
        
        const query = `
            TRUNCATE TABLE 
                sale_items,           -- Items de facturas
                sales,                -- Facturas / Ventas
                inventory_movements,  -- Kardex / Historial [NUEVO]
                product_batches,      -- Lotes y Vencimientos [NUEVO]
                products,             -- Productos
                customers,            -- Clientes
                cash_shifts           -- Cierres de Caja [NUEVO]
            RESTART IDENTITY CASCADE;
        `;

        await client.query(query);

        console.log('✅ BASE DE DATOS VACIADA CORRECTAMENTE.');
        console.log('✨ Todas las tablas (Ventas, Inventario, Caja, Clientes) están limpias.');
        console.log('✨ Los contadores de ID comenzarán desde el número 1.');

    } catch (err) {
        console.error('❌ Error fatal al vaciar la base de datos:', err.message);
    } finally {
        client.release();
        pool.end();
        process.exit(0);
    }
}

// --- INTERFAZ DE SEGURIDAD (PREGUNTA ANTES DE BORRAR) ---
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('\n🛑  ¡ADVERTENCIA DE SEGURIDAD!  🛑');
console.log('Estás a punto de ELIMINAR PERMANENTEMENTE todo el historial de ventas, inventario, clientes y caja.');
console.log('Esta acción NO se puede deshacer.\n');

rl.question('¿Estás 100% seguro de que quieres borrar toda la data? (Escribe "si" para confirmar): ', (answer) => {
    if (answer.toLowerCase() === 'si') {
        clearDatabase();
    } else {
        console.log('❌ Operación cancelada. Tus datos están a salvo.');
        process.exit(0);
    }
    rl.close();
});