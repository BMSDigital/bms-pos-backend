// migracion_datos.js
// Script de carga masiva EXACTA basado en tu LISTA DEL CARRITO.
// Incluye creación de Lotes y Kardex inicial.

const { Pool } = require('pg');

// Tu conexión a Render
const connectionString = 'postgresql://voluntariado_higea:2Dt3MUBnXdjlvlJ3B7NoJzB1K09eMFGI@dpg-d59diqili9vc73aj5j8g-a.ohio-postgres.render.com/db_pos_venta_nu93';

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

// --- LISTA COMPLETA DE PRODUCTOS (TU DATA EXACTA) ---
const PRODUCTOS_A_MIGRAR = [
    // BEBIDAS
    { name: "AGUA 330ml Crystal", price_usd: 0.45, category: "Bebidas", icon_emoji: "💧", stock: 24, is_perishable: true },
    { name: "AGUA 333ml Lara", price_usd: 0.45, category: "Bebidas", icon_emoji: "💧", stock: 24, is_perishable: true },
    { name: "AGUA 355ml Minalba", price_usd: 1.05, category: "Bebidas", icon_emoji: "💧", stock: 24, is_perishable: true },
    { name: "AGUA 500ml Lara", price_usd: 0.55, category: "Bebidas", icon_emoji: "💧", stock: 24, is_perishable: true },
    { name: "AGUA 500ml San Felipe", price_usd: 0.60, category: "Bebidas", icon_emoji: "💧", stock: 24, is_perishable: true },
    { name: "AGUA 600ml Minalba", price_usd: 1.35, category: "Bebidas", icon_emoji: "💧", stock: 24, is_perishable: true },
    { name: "BOTECITO", price_usd: 0.95, category: "Bebidas", icon_emoji: "🧃", stock: 24, is_perishable: true },
    { name: "JUGO 250ml", price_usd: 0.95, category: "Bebidas", icon_emoji: "🧃", stock: 24, is_perishable: true },
    { name: "JUGO 500ml", price_usd: 2.00, category: "Bebidas", icon_emoji: "🧃", stock: 24, is_perishable: true },
    { name: "MALTA", price_usd: 0.80, category: "Bebidas", icon_emoji: "🥤", stock: 24, is_perishable: true },
    { name: "REFRESCO", price_usd: 1.00, category: "Bebidas", icon_emoji: "🥤", stock: 24, is_perishable: true },

    // BEBIDAS CALIENTES (CAFÉ)
    // Nota: Como son preparados al momento, stock inicial alto o infinito lógico.
    { name: "CAFÉ GRANDE 57", price_usd: 0.52, category: "Cafetería", icon_emoji: "☕", stock: 100, is_perishable: false },
    { name: "CAFÉ MEDIANO 47", price_usd: 0.45, category: "Cafetería", icon_emoji: "☕", stock: 100, is_perishable: false },
    { name: "CAFÉ PEQUEÑO 27", price_usd: 0.23, category: "Cafetería", icon_emoji: "☕", stock: 100, is_perishable: false },
    { name: "NESCAFE BEBIDA ACHOCOLATADA", price_usd: 2.50, category: "Cafetería", icon_emoji: "☕", stock: 50, is_perishable: false },
    { name: "NESCAFE CAFÉ CON LECHE", price_usd: 2.50, category: "Cafetería", icon_emoji: "☕", stock: 50, is_perishable: false },
    { name: "NESCAFE CAPUCCINO", price_usd: 2.50, category: "Cafetería", icon_emoji: "☕", stock: 50, is_perishable: false },
    { name: "NESCAFE CAPUCCINO VAINILLA", price_usd: 2.50, category: "Cafetería", icon_emoji: "☕", stock: 50, is_perishable: false },
    { name: "NESCAFE CHOCO VAINILLA", price_usd: 2.50, category: "Cafetería", icon_emoji: "☕", stock: 50, is_perishable: false },
    { name: "NESCAFE LATTE VAINILLA", price_usd: 2.50, category: "Cafetería", icon_emoji: "☕", stock: 50, is_perishable: false },
    { name: "NESCAFE MOKACCINO", price_usd: 2.50, category: "Cafetería", icon_emoji: "☕", stock: 50, is_perishable: false },

    // VÍVERES Y LÁCTEOS
    { name: "AVENA", price_usd: 0.65, category: "Víveres", icon_emoji: "🌾", stock: 20, is_perishable: true },
    { name: "YOGURT", price_usd: 2.50, category: "Lácteos", icon_emoji: "🥛", stock: 15, is_perishable: true },
    { name: "SANDWICH", price_usd: 2.00, category: "Alimentos", icon_emoji: "🥪", stock: 10, is_perishable: true },

    // GALLETAS
    { name: "CANELITAS", price_usd: 0.90, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "COCOSETE", price_usd: 1.20, category: "Galletas", icon_emoji: "🥥", stock: 24, is_perishable: true },
    { name: "GALLETA DE AVENA", price_usd: 0.55, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETA DE SODA", price_usd: 0.25, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETA GUAYABA INDEPENDENCIA", price_usd: 0.75, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETA HONNY", price_usd: 0.45, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETA KRAKER", price_usd: 0.45, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETA MARIA", price_usd: 0.25, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETA OREO", price_usd: 0.60, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETAS CLUB SOCIAL", price_usd: 0.35, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETAS MINI", price_usd: 0.10, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "GALLETAS PACHI-GUAYABA", price_usd: 0.90, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "MAX COCO", price_usd: 0.65, category: "Galletas", icon_emoji: "🥥", stock: 24, is_perishable: true },
    { name: "PIAZZA", price_usd: 0.20, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "PIRUETA", price_usd: 0.30, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "SAMBA", price_usd: 1.00, category: "Galletas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "SAMBA MINI", price_usd: 0.75, category: "Galletas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "SUSY", price_usd: 1.20, category: "Galletas", icon_emoji: "🍪", stock: 24, is_perishable: true },
    { name: "PALITO", price_usd: 0.55, category: "Galletas", icon_emoji: "🥨", stock: 24, is_perishable: true },

    // GOLOSINAS Y DULCES
    { name: "BIANCHI BOMBOM", price_usd: 0.20, category: "Golosinas", icon_emoji: "🍬", stock: 50, is_perishable: true },
    { name: "BOMBON AMOR", price_usd: 0.70, category: "Golosinas", icon_emoji: "🍫", stock: 50, is_perishable: true },
    { name: "CARAMELOS CAFÉ GOURMET", price_usd: 0.06, category: "Golosinas", icon_emoji: "🍬", stock: 100, is_perishable: true },
    { name: "CARAMELOS CHAO", price_usd: 0.04, category: "Golosinas", icon_emoji: "🍬", stock: 100, is_perishable: true },
    { name: "CARAMELOS CHOCO TURRON", price_usd: 0.08, category: "Golosinas", icon_emoji: "🍬", stock: 100, is_perishable: true },
    { name: "CARAMELOS MENTA HELADA", price_usd: 0.03, category: "Golosinas", icon_emoji: "🍬", stock: 100, is_perishable: true },
    { name: "CARAMELOS RICATO", price_usd: 0.06, category: "Golosinas", icon_emoji: "🍬", stock: 100, is_perishable: true },
    { name: "CHICLE AGOGO", price_usd: 0.25, category: "Golosinas", icon_emoji: "🍬", stock: 50, is_perishable: true },
    { name: "CHICLES TRIDENT", price_usd: 0.80, category: "Golosinas", icon_emoji: "🍬", stock: 50, is_perishable: true },
    { name: "CHOCO MANI BIANCHI", price_usd: 0.85, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "CHOCOLATE BLISS CALI", price_usd: 1.15, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "CHOCOLATE CALI", price_usd: 1.00, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "CHOCOLATE COLORETI", price_usd: 0.40, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "CHOCOLATE SAVOY DE LECHE", price_usd: 1.60, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "CHOCOLATE SAVOY CRICRI", price_usd: 1.60, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "CHUPETAS", price_usd: 0.20, category: "Golosinas", icon_emoji: "🍭", stock: 50, is_perishable: true },
    { name: "FALQUITO MINI", price_usd: 0.25, category: "Golosinas", icon_emoji: "🍫", stock: 50, is_perishable: true },
    { name: "FREEGELLS BARRA", price_usd: 0.40, category: "Golosinas", icon_emoji: "🍬", stock: 24, is_perishable: true },
    { name: "MASMELOS", price_usd: 0.10, category: "Golosinas", icon_emoji: "🍬", stock: 50, is_perishable: true },
    { name: "MENTICAS", price_usd: 0.60, category: "Golosinas", icon_emoji: "🍬", stock: 24, is_perishable: true },
    { name: "MORDISQUITOS", price_usd: 0.35, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "PIRULIN", price_usd: 0.60, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "TORONTO Y BOMBONES", price_usd: 0.70, category: "Golosinas", icon_emoji: "🍫", stock: 24, is_perishable: true },
    { name: "TRULULU GOMITAS", price_usd: 0.10, category: "Golosinas", icon_emoji: "🍬", stock: 50, is_perishable: true },
    { name: "TRULULU GOMITAS BOLSA", price_usd: 1.00, category: "Golosinas", icon_emoji: "🍬", stock: 24, is_perishable: true },
    { name: "TRULULU SABORES", price_usd: 0.40, category: "Golosinas", icon_emoji: "🍬", stock: 24, is_perishable: true },
    { name: "TURRON MANI PASAS", price_usd: 0.50, category: "Golosinas", icon_emoji: "🥜", stock: 24, is_perishable: true },

    // DULCES CRIOLLOS
    { name: "BOCADILLO DE GUAYABA", price_usd: 0.30, category: "Dulces Criollos", icon_emoji: "🍬", stock: 24, is_perishable: true },
    { name: "BOCADILLO DE PLATANO", price_usd: 0.65, category: "Dulces Criollos", icon_emoji: "🍬", stock: 24, is_perishable: true },
    { name: "BOCADILLO DE TAMARINDO", price_usd: 0.30, category: "Dulces Criollos", icon_emoji: "🍬", stock: 24, is_perishable: true },
    { name: "CONSERVA DE LECHE", price_usd: 0.20, category: "Dulces Criollos", icon_emoji: "🍬", stock: 24, is_perishable: true },

    // SNACKS SALADOS
    { name: "CHEESE TRIS", price_usd: 1.00, category: "Snacks", icon_emoji: "🧀", stock: 24, is_perishable: true },
    { name: "DORITOS", price_usd: 1.25, category: "Snacks", icon_emoji: "🍟", stock: 24, is_perishable: true },
    { name: "FLIPS LONCHERA", price_usd: 0.80, category: "Snacks", icon_emoji: "🥣", stock: 24, is_perishable: true },
    { name: "MANI CON SAL", price_usd: 0.65, category: "Snacks", icon_emoji: "🥜", stock: 24, is_perishable: true },
    { name: "MANI TURRON", price_usd: 0.60, category: "Snacks", icon_emoji: "🥜", stock: 24, is_perishable: true },
    { name: "MIXTURA", price_usd: 0.65, category: "Snacks", icon_emoji: "🥜", stock: 24, is_perishable: true },
    { name: "TOSTON", price_usd: 0.80, category: "Snacks", icon_emoji: "🍌", stock: 24, is_perishable: true },

    // POSTRES Y PASTELERÍA (TORTAS)
    { name: "BARQUILLON", price_usd: 0.75, category: "Postres", icon_emoji: "🍦", stock: 20, is_perishable: true },
    { name: "GELATINA", price_usd: 1.45, category: "Postres", icon_emoji: "🍮", stock: 20, is_perishable: true },
    { name: "PANQUE MARMOLEADO", price_usd: 1.45, category: "Postres", icon_emoji: "🧁", stock: 15, is_perishable: true },
    { name: "PANQUE VAINILLA", price_usd: 1.45, category: "Postres", icon_emoji: "🧁", stock: 15, is_perishable: true },
    { name: "PONQUECITOS", price_usd: 0.50, category: "Postres", icon_emoji: "🧁", stock: 24, is_perishable: true },
    { name: "PONQUECITOS BRIGADEIRO", price_usd: 2.00, category: "Postres", icon_emoji: "🧁", stock: 15, is_perishable: true },
    { name: "TORTA DE AUYAMA", price_usd: 1.00, category: "Postres", icon_emoji: "🍰", stock: 12, is_perishable: true },
    { name: "TORTA DE CAMBUR", price_usd: 1.00, category: "Postres", icon_emoji: "🍰", stock: 12, is_perishable: true },
    { name: "TORTA DE CHOCOLATE", price_usd: 1.00, category: "Postres", icon_emoji: "🍰", stock: 12, is_perishable: true },
    { name: "TORTA DE PAN", price_usd: 1.00, category: "Postres", icon_emoji: "🍰", stock: 12, is_perishable: true },
    { name: "TORTA DE PIÑA", price_usd: 1.00, category: "Postres", icon_emoji: "🍰", stock: 12, is_perishable: true },
    { name: "TORTA DE VAINILLA", price_usd: 1.00, category: "Postres", icon_emoji: "🍰", stock: 12, is_perishable: true },
    { name: "TORTA MARMOLEADA", price_usd: 1.00, category: "Postres", icon_emoji: "🍰", stock: 12, is_perishable: true },

    // OTROS
    { name: "JABON DE TOCADOR", price_usd: 1.50, category: "Higiene", icon_emoji: "🧼", stock: 24, is_perishable: false },
    { name: "BOTA NAVIDEÑA", price_usd: 3.50, category: "Temporada", icon_emoji: "🎅", stock: 10, is_perishable: false },
    { name: "ROSA Y CORAZON", price_usd: 3.00, category: "Regalos", icon_emoji: "🎁", stock: 10, is_perishable: false }
];

// --- FUNCIÓN PRINCIPAL DE MIGRACIÓN ---
async function migrarDatos() {
    const client = await pool.connect();
    
    console.log(`🚀 Iniciando carga masiva de ${PRODUCTOS_A_MIGRAR.length} productos...`);
    console.log('--------------------------------------------------');

    try {
        await client.query('BEGIN'); // Iniciamos transacción general

        for (const prod of PRODUCTOS_A_MIGRAR) {
            
            // 1. Insertar Producto (Generamos código de barras simple si no lo tiene)
            const barcodeSimulado = `INT-${Math.floor(Math.random() * 1000000)}`;

            const insertProductQuery = `
                INSERT INTO products (
                    name, category, price_usd, stock, icon_emoji, 
                    is_taxable, barcode, status, is_perishable
                ) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8) 
                RETURNING id;
            `;
            
            const values = [
                prod.name,
                prod.category,
                prod.price_usd,
                prod.stock,
                prod.icon_emoji,
                false, // Default: Todo paga IVA (ajustable en backend si quieres)
                prod.barcode || barcodeSimulado,
                prod.is_perishable
            ];

            const res = await client.query(insertProductQuery, values);
            const productId = res.rows[0].id;

            // 2. Crear Lote Inicial (Obligatorio para que aparezca disponible)
            if (prod.stock > 0) {
                // Fecha de vencimiento simulada: 
                // Si es perecedero: +6 meses desde hoy. Si no: NULL.
                const expDate = prod.is_perishable 
                    ? new Date(new Date().setMonth(new Date().getMonth() + 6)) 
                    : null;

                await client.query(`
                    INSERT INTO product_batches (product_id, stock, cost_usd, batch_code, expiration_date, created_at)
                    VALUES ($1, $2, $3, 'LOTE-INICIAL-2025', $4, NOW())
                `, [productId, prod.stock, prod.price_usd * 0.70, expDate]); // Costo estimado al 70%

                // 3. Registrar en Kardex
                await client.query(`
                    INSERT INTO inventory_movements (product_id, type, quantity, reason, document_ref, cost_usd, new_stock)
                    VALUES ($1, 'IN', $2, 'INVENTARIO_INICIAL', 'CARGA_MASIVA', $3, $4)
                `, [productId, prod.stock, prod.price_usd * 0.70, prod.stock]);
            }

            console.log(`✅ Creado: ${prod.name} ($${prod.price_usd})`);
        }

        await client.query('COMMIT'); 
        console.log('--------------------------------------------------');
        console.log(`✨ ¡MIGRACIÓN DE ${PRODUCTOS_A_MIGRAR.length} ARTÍCULOS COMPLETADA! ✨`);

    } catch (err) {
        await client.query('ROLLBACK'); 
        console.error('❌ Error fatal:', err.message);
    } finally {
        client.release();
        pool.end();
    }
}

// Ejecutar
migrarDatos();