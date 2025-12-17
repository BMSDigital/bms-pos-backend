const { Pool } = require('pg');

// TU URL DE RENDER
const connectionString = process.env.DATABASE_URL || 'postgresql://bms_db_z4m4_user:cYiKio2iKH6EKCBbZBfpbuTf2aSYvSps@dpg-d4ln562li9vc73ed83k0-a.ohio-postgres.render.com/bms_db_z4m4';

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

// --- LISTADO MAESTRO DEL CARRITO ---
const productosParaCargar = [
    // BEBIDAS
    { name: "AGUA 330ml Crystal", price: 0.45, category: "Bebidas", emoji: "💧" },
    { name: "AGUA 333ml Lara", price: 0.45, category: "Bebidas", emoji: "💧" },
    { name: "AGUA 355ml Minalba", price: 1.05, category: "Bebidas", emoji: "💧" },
    { name: "AGUA 500ml Lara", price: 0.55, category: "Bebidas", emoji: "💧" },
    { name: "AGUA 500ml San Felipe", price: 0.60, category: "Bebidas", emoji: "💧" },
    { name: "AGUA 600ml Minalba", price: 1.35, category: "Bebidas", emoji: "💧" },
    { name: "BOTECITO", price: 0.95, category: "Bebidas", emoji: "🧃" },
    { name: "JUGO 250ml", price: 0.95, category: "Bebidas", emoji: "🧃" },
    { name: "JUGO 500ml", price: 2.00, category: "Bebidas", emoji: "🧃" },
    { name: "MALTA", price: 0.80, category: "Bebidas", emoji: "🥤" },
    { name: "REFRESCO", price: 1.00, category: "Bebidas", emoji: "🥤" },

    // BEBIDAS CALIENTES (CAFÉ)
    { name: "CAFÉ GRANDE 57", price: 0.52, category: "Cafetería", emoji: "☕" },
    { name: "CAFÉ MEDIANO 47", price: 0.45, category: "Cafetería", emoji: "☕" },
    { name: "CAFÉ PEQUEÑO 27", price: 0.23, category: "Cafetería", emoji: "☕" },
    { name: "NESCAFE BEBIDA ACHOCOLATADA", price: 2.50, category: "Cafetería", emoji: "☕" },
    { name: "NESCAFE CAFÉ CON LECHE", price: 2.50, category: "Cafetería", emoji: "☕" },
    { name: "NESCAFE CAPUCCINO", price: 2.50, category: "Cafetería", emoji: "☕" },
    { name: "NESCAFE CAPUCCINO VAINILLA", price: 2.50, category: "Cafetería", emoji: "☕" },
    { name: "NESCAFE CHOCO VAINILLA", price: 2.50, category: "Cafetería", emoji: "☕" },
    { name: "NESCAFE LATTE VAINILLA", price: 2.50, category: "Cafetería", emoji: "☕" },
    { name: "NESCAFE MOKACCINO", price: 2.50, category: "Cafetería", emoji: "☕" },

    // VÍVERES Y LÁCTEOS
    { name: "AVENA", price: 0.65, category: "Víveres", emoji: "🌾" },
    { name: "YOGURT", price: 2.50, category: "Lácteos", emoji: "🥛" },
    { name: "SANDWICH", price: 2.00, category: "Alimentos", emoji: "🥪" },

    // GALLETAS
    { name: "CANELITAS", price: 0.90, category: "Galletas", emoji: "🍪" },
    { name: "COCOSETE", price: 1.20, category: "Galletas", emoji: "🥥" },
    { name: "GALLETA DE AVENA", price: 0.55, category: "Galletas", emoji: "🍪" },
    { name: "GALLETA DE SODA", price: 0.25, category: "Galletas", emoji: "🍪" },
    { name: "GALLETA GUAYABA INDEPENDENCIA", price: 0.75, category: "Galletas", emoji: "🍪" },
    { name: "GALLETA HONNY", price: 0.45, category: "Galletas", emoji: "🍪" },
    { name: "GALLETA KRAKER", price: 0.45, category: "Galletas", emoji: "🍪" },
    { name: "GALLETA MARIA", price: 0.25, category: "Galletas", emoji: "🍪" },
    { name: "GALLETA OREO", price: 0.60, category: "Galletas", emoji: "🍪" },
    { name: "GALLETAS CLUB SOCIAL", price: 0.35, category: "Galletas", emoji: "🍪" },
    { name: "GALLETAS MINI", price: 0.10, category: "Galletas", emoji: "🍪" },
    { name: "GALLETAS PACHI-GUAYABA", price: 0.90, category: "Galletas", emoji: "🍪" },
    { name: "MAX COCO", price: 0.65, category: "Galletas", emoji: "🥥" },
    { name: "PIAZZA", price: 0.20, category: "Galletas", emoji: "🍪" },
    { name: "PIRUETA", price: 0.30, category: "Galletas", emoji: "🍪" },
    { name: "SAMBA", price: 1.00, category: "Galletas", emoji: "🍫" },
    { name: "SAMBA MINI", price: 0.75, category: "Galletas", emoji: "🍫" },
    { name: "SUSY", price: 1.20, category: "Galletas", emoji: "🍪" },
    { name: "PALITO", price: 0.55, category: "Galletas", emoji: "🥨" },

    // GOLOSINAS Y DULCES
    { name: "BIANCHI BOMBOM", price: 0.20, category: "Golosinas", emoji: "🍬" },
    { name: "BOMBON AMOR", price: 0.70, category: "Golosinas", emoji: "🍫" },
    { name: "CARAMELOS CAFÉ GOURMET", price: 0.06, category: "Golosinas", emoji: "🍬" },
    { name: "CARAMELOS CHAO", price: 0.04, category: "Golosinas", emoji: "🍬" },
    { name: "CARAMELOS CHOCO TURRON", price: 0.08, category: "Golosinas", emoji: "🍬" },
    { name: "CARAMELOS MENTA HELADA", price: 0.03, category: "Golosinas", emoji: "🍬" },
    { name: "CARAMELOS RICATO", price: 0.06, category: "Golosinas", emoji: "🍬" },
    { name: "CHICLE AGOGO", price: 0.25, category: "Golosinas", emoji: "🍬" },
    { name: "CHICLES TRIDENT", price: 0.80, category: "Golosinas", emoji: "🍬" },
    { name: "CHOCO MANI BIANCHI", price: 0.85, category: "Golosinas", emoji: "🍫" },
    { name: "CHOCOLATE BLISS CALI", price: 1.15, category: "Golosinas", emoji: "🍫" },
    { name: "CHOCOLATE CALI", price: 1.00, category: "Golosinas", emoji: "🍫" },
    { name: "CHOCOLATE COLORETI", price: 0.40, category: "Golosinas", emoji: "🍫" },
    { name: "CHOCOLATE SAVOY DE LECHE", price: 1.60, category: "Golosinas", emoji: "🍫" },
    { name: "CHOCOLATE SAVOY CRICRI", price: 1.60, category: "Golosinas", emoji: "🍫" },
    { name: "CHUPETAS", price: 0.20, category: "Golosinas", emoji: "🍭" },
    { name: "FALQUITO MINI", price: 0.25, category: "Golosinas", emoji: "🍫" },
    { name: "FREEGELLS BARRA", price: 0.40, category: "Golosinas", emoji: "🍬" },
    { name: "MASMELOS", price: 0.10, category: "Golosinas", emoji: "🍬" },
    { name: "MENTICAS", price: 0.60, category: "Golosinas", emoji: "🍬" },
    { name: "MORDISQUITOS", price: 0.35, category: "Golosinas", emoji: "🍫" },
    { name: "PIRULIN", price: 0.60, category: "Golosinas", emoji: "🍫" },
    { name: "TORONTO Y BOMBONES", price: 0.70, category: "Golosinas", emoji: "🍫" },
    { name: "TRULULU GOMITAS", price: 0.10, category: "Golosinas", emoji: "🍬" },
    { name: "TRULULU GOMITAS BOLSA", price: 1.00, category: "Golosinas", emoji: "🍬" },
    { name: "TRULULU SABORES", price: 0.40, category: "Golosinas", emoji: "🍬" },
    { name: "TURRON MANI PASAS", price: 0.50, category: "Golosinas", emoji: "🥜" },

    // DULCES CRIOLLOS
    { name: "BOCADILLO DE GUAYABA", price: 0.30, category: "Dulces Criollos", emoji: "🍬" },
    { name: "BOCADILLO DE PLATANO", price: 0.65, category: "Dulces Criollos", emoji: "🍬" },
    { name: "BOCADILLO DE TAMARINDO", price: 0.30, category: "Dulces Criollos", emoji: "🍬" },
    { name: "CONSERVA DE LECHE", price: 0.20, category: "Dulces Criollos", emoji: "🍬" },

    // SNACKS SALADOS
    { name: "CHEESE TRIS", price: 1.00, category: "Snacks", emoji: "🧀" },
    { name: "DORITOS", price: 1.25, category: "Snacks", emoji: "🍟" },
    { name: "FLIPS LONCHERA", price: 0.80, category: "Snacks", emoji: "🥣" },
    { name: "MANI CON SAL", price: 0.65, category: "Snacks", emoji: "🥜" },
    { name: "MANI TURRON", price: 0.60, category: "Snacks", emoji: "🥜" },
    { name: "MIXTURA", price: 0.65, category: "Snacks", emoji: "🥜" },
    { name: "TOSTON", price: 0.80, category: "Snacks", emoji: "🍌" },

    // POSTRES Y PASTELERÍA (TORTAS)
    { name: "BARQUILLON", price: 0.75, category: "Postres", emoji: "🍦" },
    { name: "GELATINA", price: 1.45, category: "Postres", emoji: "🍮" },
    { name: "PANQUE MARMOLEADO", price: 1.45, category: "Postres", emoji: "🧁" },
    { name: "PANQUE VAINILLA", price: 1.45, category: "Postres", emoji: "🧁" },
    { name: "PONQUECITOS", price: 0.50, category: "Postres", emoji: "🧁" },
    { name: "PONQUECITOS BRIGADEIRO", price: 2.00, category: "Postres", emoji: "🧁" },
    { name: "TORTA DE AUYAMA", price: 1.00, category: "Postres", emoji: "🍰" },
    { name: "TORTA DE CAMBUR", price: 1.00, category: "Postres", emoji: "🍰" },
    { name: "TORTA DE CHOCOLATE", price: 1.00, category: "Postres", emoji: "🍰" },
    { name: "TORTA DE PAN", price: 1.00, category: "Postres", emoji: "🍰" },
    { name: "TORTA DE PIÑA", price: 1.00, category: "Postres", emoji: "🍰" },
    { name: "TORTA DE VAINILLA", price: 1.00, category: "Postres", emoji: "🍰" },
    { name: "TORTA MARMOLEADA", price: 1.00, category: "Postres", emoji: "🍰" },

    // OTROS
    { name: "JABON DE TOCADOR", price: 1.50, category: "Higiene", emoji: "🧼" },
    { name: "BOTA NAVIDEÑA", price: 3.50, category: "Temporada", emoji: "🎅" },
    { name: "ROSA Y CORAZON", price: 3.00, category: "Regalos", emoji: "🎁" }
];

async function cargarSemilla() {
    console.log(`🚀 Iniciando carga de ${productosParaCargar.length} productos al Carrito con Stock 0...`);
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        for (const prod of productosParaCargar) {
            // Verificar si existe para no duplicar (por nombre)
            const check = await client.query("SELECT id FROM products WHERE name = $1", [prod.name]);
            
            if (check.rows.length === 0) {
                // INSERTAR
                const insertQuery = `
                    INSERT INTO products 
                    (name, category, price_usd, stock, icon_emoji, is_taxable, barcode, status, last_stock_update) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                `;
                // Valores: Stock=0, Tax=true (gravado), Barcode='', Status=ACTIVE
                await client.query(insertQuery, [
                    prod.name, 
                    prod.category, 
                    prod.price, 
                    0, // <--- CAMBIO AQUÍ: Stock inicial en CERO
                    prod.emoji, 
                    true, 
                    '', 
                    'ACTIVE'
                ]);
                console.log(`✅ Agregado (Stock 0): ${prod.emoji} ${prod.name}`);
            } else {
                // Si ya existe, actualizamos precio, categoría y emoji, pero NO TOCAMOS EL STOCK
                // (Para respetar si ya tenías inventario real, o si lo acabas de resetear se queda en 0)
                await client.query(
                    "UPDATE products SET price_usd = $1, category = $2, icon_emoji = $3 WHERE name = $4", 
                    [prod.price, prod.category, prod.emoji, prod.name]
                );
                console.log(`🔄 Actualizado datos maestros: ${prod.name}`);
            }
        }

        await client.query('COMMIT');
        console.log('✨ Carga completada exitosamente.');
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en la carga:', err);
    } finally {
        client.release();
        pool.end();
    }
}

// Ejecutar
cargarSemilla();