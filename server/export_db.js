const { spawn } = require('child_process');
const path = require('path');

// 1. Configuración (Extraída de tus archivos)
const config = {
    user: 'voluntariado_higea',
    host: 'dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com',
    database: 'db_pos_venta_nu93',
    password: '2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI',
    port: '5432'
};

// 2. Definir archivo de salida con fecha y hora para no sobrescribir
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const fileName = `respaldo_completo_${timestamp}.sql`;
const filePath = path.join(__dirname, fileName);

console.log(`⏳ Iniciando exportación completa de la base de datos...`);
console.log(`📡 Conectando a: ${config.host}`);
console.log(`📄 Archivo destino: ${filePath}`);

// 3. Argumentos para pg_dump
// -F p: Formato Plano (SQL legible)
// -b: Incluir Blobs (Objetos grandes)
// -v: Verbose (Mostrar progreso)
// -f: Archivo de salida
const args = [
    '-h', config.host,
    '-p', config.port,
    '-U', config.user,
    '-d', config.database,
    '-F', 'p', 
    '-b',
    '-v',
    '-f', filePath
];

// 4. Ejecución del proceso
// IMPORTANTE: Pasamos la contraseña en 'env' para que Windows no falle
const dumpProcess = spawn('pg_dump', args, {
    env: {
        ...process.env,      // Mantiene las variables de tu sistema (PATH, etc)
        PGPASSWORD: config.password // Inyecta la contraseña de forma segura
    }
});

// 5. Manejo de eventos (Logs y Errores)
dumpProcess.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
});

dumpProcess.stderr.on('data', (data) => {
    // pg_dump envía el progreso al stderr, así que lo mostramos como info
    console.log(`ℹ️  Progreso: ${data.toString().trim()}`);
});

dumpProcess.on('error', (error) => {
    if (error.code === 'ENOENT') {
        console.error('\n❌ ERROR CRÍTICO: No se encontró el comando "pg_dump".');
        console.error('👉 Solución: Debes instalar PostgreSQL en tu computadora (solo los "Command Line Tools") y agregarlo al PATH de Windows.');
    } else {
        console.error(`❌ Error de ejecución: ${error.message}`);
    }
});

dumpProcess.on('close', (code) => {
    if (code === 0) {
        console.log('\n✅ ---------------------------------------------------');
        console.log('✅ ¡RESPALDO COMPLETADO EXITOSAMENTE!');
        console.log(`✅ Archivo guardado en: ${filePath}`);
        console.log('✅ ---------------------------------------------------');
    } else {
        console.error(`\n❌ El proceso finalizó con errores (Código: ${code})`);
    }
});