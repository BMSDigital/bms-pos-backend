// db_status.js
// Script de Reporte de Estatus de Base de Datos
// Muestra tablas, conteo de filas y columnas actuales

const { Pool } = require('pg');

// Tu URL de conexión (La misma de tu server.js)
const connectionString = 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93'; 

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function verificarEstatus() {
    try {
        console.clear();
        console.log('📡 Conectando para auditar la Base de Datos...\n');

        // 1. Obtener lista de todas las tablas públicas
        const resTablas = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);

        if (resTablas.rows.length === 0) {
            console.log('⚠️ No se encontraron tablas en la base de datos.');
            return;
        }

        console.log(`✅ Se encontraron ${resTablas.rows.length} tablas.\n`);
        console.log('--------------------------------------------------');

        // 2. Recorrer cada tabla para obtener detalles
        for (let row of resTablas.rows) {
            const tableName = row.table_name;

            // a. Contar filas (registros)
            const resCount = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
            const rowCount = resCount.rows[0].count;

            // b. Obtener columnas y sus tipos
            const resCols = await pool.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_name = $1 
                ORDER BY ordinal_position;
            `, [tableName]);

            // c. Imprimir encabezado de tabla
            console.log(`📂 TABLA: ${tableName.toUpperCase()}`);
            console.log(`📊 Registros actuales: ${rowCount}`);
            console.log(`📝 Estructura (Columnas):`);
            
            // d. Imprimir columnas de forma ordenada
            resCols.rows.forEach(col => {
                let extra = '';
                if (col.column_name === 'is_raw_material') extra = ' <-- [NUEVO]';
                if (col.column_name === 'rif') extra = ' <-- [SENIAT]';
                
                // Formato:  - nombre_columna (tipo_dato)
                console.log(`   - ${col.column_name.padEnd(25)} (${col.data_type})${extra}`);
            });

            console.log('--------------------------------------------------');
        }

    } catch (err) {
        console.error('❌ Error al consultar la base de datos:', err);
    } finally {
        pool.end();
        console.log('\n🏁 Auditoría finalizada.');
    }
}

verificarEstatus();