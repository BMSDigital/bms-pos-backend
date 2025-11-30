// server/semilla.js
const axios = require('axios');

// TU URL REAL DE RENDER
const API_URL = 'https://bms-postventa-api.onrender.com/api/products';

const productosIniciales = [
    { name: "Hamburguesa Doble", category: "Comida", price_usd: 5.50, stock: 50 },
    { name: "Pepito Mixto", category: "Comida", price_usd: 7.00, stock: 40 },
    { name: "Pollo en Brasa (Entero)", category: "Pollos", price_usd: 12.00, stock: 20 },
    { name: "Coca-Cola 1.5L", category: "Bebidas", price_usd: 2.50, stock: 100 },
    { name: "Malta Polar", category: "Bebidas", price_usd: 1.20, stock: 100 },
    { name: "Ración de Papas", category: "Extras", price_usd: 3.00, stock: 80 }
];

async function cargarDatos() {
    console.log("🍔 Enviando productos a la nube...");
    for (const producto of productosIniciales) {
        try {
            await axios.post(API_URL, producto);
            console.log(`✅ Creado: ${producto.name}`);
        } catch (error) {
            console.error(`❌ Error en ${producto.name}:`, error.message);
        }
    }
    console.log("¡Listo! Inventario inicial cargado.");
}

cargarDatos();