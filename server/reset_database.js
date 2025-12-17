const { Pool } = require('pg');

// Usamos la misma conexión que tienes configurada en tus otros scripts
// Si tienes la URL en variable de entorno, úsala, si no, usa la cadena directa de Render
const connectionString = process.env.DATABASE_URL || 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4';

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function clearDatabase() {
    const client = await pool.connect();
    try {
        console.log('⚠️  INICIANDO LIMPIEZA TOTAL DE BASE DE DATOS...');
        console.log('⏳ Vaciando tablas y reiniciando contadores de ID...');

        // TRUNCATE: Borra rápido
        // RESTART IDENTITY: Reinicia los IDs a 1
        // CASCADE: Borra datos dependientes (ej: si borra venta, borra sus items)
        
        // El orden aquí es importante, aunque CASCADE ayuda, es mejor listar las tablas principales
        const query = `
            TRUNCATE TABLE 
                sale_items, 
                sales, 
                products, 
                customers 
            RESTART IDENTITY CASCADE;
        `;

        await client.query(query);

        console.log('✅ Base de datos vaciada correctamente.');
        console.log('✨ Las tablas sales, sale_items, products y customers están limpias.');
        console.log('✨ Los IDs comenzarán desde el número 1.');

    } catch (err) {
        console.error('❌ Error al vaciar la base de datos:', err.message);
    } finally {
        client.release();
        pool.end();
    }
}

// Ejecutar función (Confirmación de seguridad simple)
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

readline.question('ESTÁS A PUNTO DE BORRAR TODA LA DATA. ¿Estás seguro? (escribe "si"): ', (answer) => {
    if (answer.toLowerCase() === 'si') {
        clearDatabase();
    } else {
        console.log('Operación cancelada.');
        pool.end();
    }
    readline.close();
});