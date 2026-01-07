import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// --- UTILIDADES DE FORMATO FINANCIERO (Pegar arriba en App.jsx) ---

// 1. Formateador Bolívares (Ej: 1.234,56)
const formatBs = (amount) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0,00';
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
};

// 2. Formateador Dólares (Ej: 1,234.56)
const formatUSD = (amount) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0.00';
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
};

// --- FUNCIÓN DE PROCESAMIENTO DE IMAGEN ---
const handleImageRead = (file, callback) => {
    if (!file) return;
    // Validación: Máximo 2MB para no saturar la BD
    if (file.size > 2 * 1024 * 1024) {
        Swal.fire('Archivo muy pesado', 'Por favor usa una imagen menor a 2MB', 'warning');
        return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
        callback(reader.result); // Retorna el string Base64
    };
    reader.readAsDataURL(file);
};

// 4. Validar Nombre de PRODUCTO (Permite Letras, Números, Puntos, Guiones y Comas)
const validateProductName = (value) => {
    if (!value) return '';
    // Permite letras, números, espacios y caracteres comunes de medidas (.,-/)
    // Elimina emojis o símbolos raros
    return value.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s\.\,\-\/]/g, '');
};

// 1. Capitalizar la primera letra de cada palabra
const capitalizeWords = (str) => {
    if (!str) return '';
    // Corregido para no capitalizar después de caracteres que no sean espacios (ej: O'Brien)
    return str.toLowerCase().split(' ').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
};

// 2. Validar y formatear ID (Cédula/RIF)
const validateIdNumber = (value) => {
    if (!value) return '';
    const upperValue = value.toUpperCase();

    // 1. Limpiar: Solo permitir V, E, J, G, T, dígitos y guion
    const cleaned = upperValue.replace(/[^VEJGT\d-]/g, '');
    if (!cleaned) return '';

    let formatted = '';

    // 2. Aplicar restricción de Carácter Inicial (V, E, J, G, T)
    if ('VEJGT'.includes(cleaned[0])) {
        formatted += cleaned[0];
    } else {
        // Si comienza con un caracter inválido, lo ignora.
        return '';
    }

    // 3. Forzar el guion después de la letra inicial si hay más caracteres
    const numberPart = cleaned.substring(1).replace(/-/g, ''); // Eliminar guiones duplicados en la parte numérica

    if (cleaned.length > 1) {
        // Reconstruir forzando el guion: L-NNNNNNNN
        formatted += '-' + numberPart;
    } else {
        formatted = cleaned;
    }

    // 4. Asegurar que la parte numérica solo sean dígitos
    if (formatted.includes('-')) {
        const parts = formatted.split('-');
        // Reemplazar cualquier cosa que no sea un dígito después del guion
        formatted = parts[0] + '-' + parts[1].replace(/[^\d]/g, '');
    }

    // 5. Aplicar límite de longitud final
    return formatted.substring(0, 15);
};

// 3. Validar y formatear Teléfono (Internacional)
const validatePhone = (value) => {
    if (!value) return '';
    // Permite +, números, espacios, paréntesis y guiones. Limita a 18 caracteres.
    const cleaned = value.replace(/[^+\d\s()-]/g, '');
    return cleaned.substring(0, 18);
};

// UTILITY FUNCTION: Debounce para evitar sobrecargar el backend con búsquedas
const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            func.apply(null, args);
        }, delay);
    };
};
// 💡 MEJORA ARQUITECTURA: Uso de variables de entorno de Vite
// Necesitas un archivo .env en la raíz del frontend con VITE_API_URL
const API_URL = import.meta.env.VITE_API_URL || 'https://voluntariado-pos-venta.onrender.com/api';

/*const API_URL = window.location.hostname === 'localhost' ? 'https://voluntariado-pos-venta.onrender.com/api' : '/api';*/

// 🇻🇪 REQUISITO LEGAL: Tasa de IVA estándar en Venezuela
const IVA_RATE = 0.16;

// --- LISTA EXTENSA DE EMOJIS SOLICITADA POR EL USUARIO (Más de 100) ---
const EMOJI_OPTIONS = [
    // Comida Rápida / Platos (Agregado: Arepa 🫓)
    '🍔', '🍟', '🍕', '🌭', '🌮', '🌯', '🥙', '🧆', '🥪', '🫔', '🍝', '🍜', '🍲', '🥣', '🥗', '🥘', '🍣', '🍤', '🍙', '🍚', '🍛', '🦪', '🍢', '🍡', '🥟', '🥠', '🥡', '🍜', '🫓',

    // Carnes / Aves / Proteínas
    '🥩', '🥓', '🍗', '🍖', '🥚', '🍳', '🐟', '🦞', '🦀', '🦐', '🦑',

    // Víveres / Productos (Agregado: Enlatados 🥫 y Sal 🧂)
    '🍎', '🍏', '🍊', '🍋', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🧅', '🧄', '🍠', '🍄', '🥜', '🌰', '🌽', '🥕', '🥔', '🥐', '🍞', '🥖', '🥨', '🥯', '🧇', '🧀', '🧈', '🥛', '🍼', '🍯', '🥫', '🧂',

    // Dulces / Postres (Agregado: Panquecas 🥞)
    '🍰', '🎂', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍩', '🍪', '🍦', '🍧', '🍨', '🍬', '🍫', '🍿', '🧇', '🥞',

    // Frutas
    '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍌', '🍐',

    // Bebidas (Agregado: Agua 💧 y Hielo 🧊)
    '🥤', '🧋', '🫖', '☕️', '🍵', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥛', '🧃', '💧', '🧊',

    // Higiene y Cuidado Personal (NUEVO: Para Jabones y Aseo)
    '🧼', '🧻', '🧴', '🪥', '🧽', '🚿', '🛀', '🧸',

    // Temporada / Navidad (NUEVO: Para Botas Navideñas y Regalos)
    '🎄', '🎅', '🎁', '🎉', '🎈',

    // Informática / Electrónica
    '💻', '🖥️', '⌨️', '🖱️', '🖨️', '📱', '🔋', '🔌', '💡', '💾', '💿', '⏱️', '⌚', '🎙️', '🎧',

    // General / Misceláneos
    '🏷️', '🛍️', '💸', '📦', '🛠️', '🧹', '🧺', '🛒', '🔑', '🔗', '📍'
];

// --- COMPONENTE AVATAR (Poner antes de function App) ---
const ProductAvatar = ({ icon, size = "w-12 h-12 text-4xl" }) => {
    if (!icon) return <div className={`${size} flex items-center justify-center bg-slate-100 rounded-lg`}>📦</div>;
    const isImage = icon.startsWith('data:image') || icon.startsWith('http');
    return (
        <div className={`${size} shrink-0 rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden flex items-center justify-center relative`}>
            {isImage ? (
                <img src={icon} alt="Item" className="w-full h-full object-cover" loading="lazy" />
            ) : (
                <span className="leading-none">{icon}</span>
            )}
        </div>
    );
};

function App() {
    // ... otros estados ...
    const [cashShift, setCashShift] = useState(null); // null = cargando, 'CERRADA' = no hay turno, Objeto = turno abierto

    // --- ESTADOS PRINCIPALES ---
    const [view, setView] = useState('POS');
    const [products, setProducts] = useState([]);
    const [filteredProducts, setFilteredProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('Todos');

    // --- ESTADOS NECESARIOS (Agrégalos junto a tus otros useState) ---
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);   // ID para enviar al backend

    // --- LÓGICA PARA CARRUSEL DE CATEGORÍAS UX ---
    const categoryScrollRef = useRef(null);

    const scrollCategories = (direction) => {
        if (categoryScrollRef.current) {
            const scrollAmount = 300; // Cantidad de píxeles a mover
            categoryScrollRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };
    const [bcvRate, setBcvRate] = useState(0);
    const [fallbackRate, setFallbackRate] = useState(0); // 💡 NUEVO: Tasa de Fallback para el warning
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState([]);
    const [isFiscalInvoice, setIsFiscalInvoice] = useState(false);

    const [isCustomerFormOpen, setIsCustomerFormOpen] = useState(false); // NUEVO ESTADO
    const [isProductFormOpen, setIsProductFormOpen] = useState(false); // NUEVO ESTADO PARA PRODUCTOS

    const [closingsHistory, setClosingsHistory] = useState([]);

    // Estado para el visor de recibos
    const [receiptPreview, setReceiptPreview] = useState(null); // Guardará el HTML del recibo

    // Estado para paginación de reportes de ventas
    const [salesReportPage, setSalesReportPage] = useState(1);

    // Estados para Auditoría de Inventario
    const [inventoryReportPage, setInventoryReportPage] = useState(1);
    const [selectedAuditProduct, setSelectedAuditProduct] = useState(null); // Para el modal de detalle

    // --- ESTADO PARA VISOR DE KARDEX ---
    const [isKardexOpen, setIsKardexOpen] = useState(false);
    const [kardexHistory, setKardexHistory] = useState([]);
    const [kardexProduct, setKardexProduct] = useState(null);

    // --- ESTADOS NUEVOS: GESTIÓN DE INVENTARIO (KARDEX) ---
    const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
    const [movementProduct, setMovementProduct] = useState(null);
    const [movementType, setMovementType] = useState('IN'); // 'IN' o 'OUT'
    const [movementForm, setMovementForm] = useState({ quantity: '', document_ref: '', reason: 'COMPRA_PROVEEDOR', cost_usd: '', new_expiration: '', next_expiration: '' });

    // --- ESTADO PARA PESTAÑAS DEL MODAL DE AUDITORÍA ---
    const [auditTab, setAuditTab] = useState('INFO'); // 'INFO' (Finanzas) o 'HISTORY' (Movimientos)

    const [batches, setBatches] = useState([]); // Para guardar los lotes del producto
    const [selectedBatch, setSelectedBatch] = useState(null); // Lote seleccionado para borrar

    // --- ESTADOS PARA REPORTES AVANZADOS (NUEVO SISTEMA DE PESTAÑAS) ---
    const [reportTab, setReportTab] = useState('DASHBOARD'); // 'DASHBOARD', 'SALES', 'INVENTORY'
    const [detailedSales, setDetailedSales] = useState([]);
    const [detailedInventory, setDetailedInventory] = useState([]);
    //const [reportSearch, setReportSearch] = useState(''); // Buscador universal para tablas de reporte

    // Modales
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedSaleDetail, setSelectedSaleDetail] = useState(null);
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);

    // --- ESTADOS DE CRÉDITO Y PAGO ---
    const [paymentShares, setPaymentShares] = useState({});
    const [isNumpadOpen, setIsNumpadOpen] = useState(false);
    const [currentMethod, setCurrentMethod] = useState('');
    const [currentInputValue, setCurrentInputValue] = useState('');
    const [paymentReferences, setPaymentReferences] = useState({});
    const [currentReference, setCurrentReference] = useState('');
    const [customerData, setCustomerData] = useState({ full_name: '', id_number: '', phone: '', institution: '' });
    const [dueDays, setDueDays] = useState(15);

    // Data Dashboard y Reportes de Crédito
    const [stats, setStats] = useState({ total_usd: 0, total_ves: 0, total_transactions: 0 });
    const [recentSales, setRecentSales] = useState([]);
    const [pendingCredits, setPendingCredits] = useState([]);

    // Estados para Créditos Agrupados
    const [groupedCredits, setGroupedCredits] = useState([]);
    const [selectedCreditCustomer, setSelectedCreditCustomer] = useState(null); // Para ver detalle del cliente
    const [customerCreditsDetails, setCustomerCreditsDetails] = useState([]); // Lista de facturas del cliente

    const [lowStock, setLowStock] = useState([]);
    const [overdueCount, setOverdueCount] = useState(0);

    // ESTADOS para búsqueda de cliente (Crédito)
    const [customerSearchResults, setCustomerSearchResults] = useState([]);
    const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);

    // ESTADOS para el módulo de Clientes
    const [allCustomers, setAllCustomers] = useState([]);
    const [filteredCustomers, setFilteredCustomers] = useState([]); // 💡 NUEVO: Estado para filtrar la lista
    const [customerSearchQuery, setCustomerSearchQuery] = useState(''); // 💡 NUEVO: Estado para el input de búsqueda
    const [customerCurrentPage, setCustomerCurrentPage] = useState(1); // <-- PAGINACIÓN CLIENTES

    // ESTADOS para el módulo de Productos (Esqueleto CRUD)
    const [customerForm, setCustomerForm] = useState({ id: null, full_name: '', id_number: '', phone: '', institution: '', status: 'ACTIVO' });

    // ESTADO ACTUALIZADO
    const [productForm, setProductForm] = useState({
    id: null,
    name: '',
    category: '',
    price_usd: '',
    stock: '',      // <--- Para que el input empiece vacío
    is_taxable: true,
    icon_emoji: '🍔',
    barcode: '',
    status: 'ACTIVE',
    expiration_date: '',
    is_perishable: true // <--- Para que el checkbox funcione
});
    
    // NUEVOS ESTADOS para búsqueda de inventario
    const [productSearchQuery, setProductSearchQuery] = useState('');
    const [filteredInventory, setFilteredInventory] = useState([]);
    const [filterExpiration, setFilterExpiration] = useState(false);
    const [inventoryCurrentPage, setInventoryCurrentPage] = useState(1); // <-- PAGINACIÓN INVENTARIO
    // ------------------------------------------

    // 💡 NUEVOS ESTADOS para búsqueda en POS y Paginación (Punto 1)
    const [posSearchQuery, setPosSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const productsPerPage = 12; // Límite por página (puedes ajustarlo)
    // ------------------------------------------

    // --- ESTADOS PARA MÓDULO CRÉDITO (NUEVOS) ---
    const [creditSearchQuery, setCreditSearchQuery] = useState('');
    const [filteredCredits, setFilteredCredits] = useState([]);
    const [creditCurrentPage, setCreditCurrentPage] = useState(1);

    // --- ESTADO PARA PAGINACIÓN DE DETALLE DE DEUDOR ---
    const [detailsCurrentPage, setDetailsCurrentPage] = useState(1);

    // --- NUEVOS ESTADOS DASHBOARD MEJORADO ---
    const [showStockModal, setShowStockModal] = useState(false); // Modal Alerta Stock
    const [showDailySalesModal, setShowDailySalesModal] = useState(false); // Modal Detalle Ventas Hoy
    const [dailySalesList, setDailySalesList] = useState([]); // Datos para el modal anterior
    const [topDebtors, setTopDebtors] = useState([]); // Top deudores para dashboard

    // --- ESTADOS REPORTE GERENCIAL AVANZADO ---
    const [analyticsData, setAnalyticsData] = useState(null);
	
	// --- ESTADOS PARA AVANCE DE EFECTIVO ---
    const [isCashAdvanceOpen, setIsCashAdvanceOpen] = useState(false);
    const [advanceData, setAdvanceData] = useState({
        amountBs: '', // Cuánto efectivo quiere el cliente
        commission: 10 // Porcentaje de comisión por defecto (ej: 10%)
    });

    // --- FUNCIÓN PARA CALCULAR Y AGREGAR EL AVANCE AL CARRITO ---
    const handleAddCashAdvance = (e) => {
        e.preventDefault();
        
        const amount = parseFloat(advanceData.amountBs);
        const commRate = parseFloat(advanceData.commission);

        if (!amount || amount <= 0) return Swal.fire('Error', 'Ingrese un monto válido', 'error');
        if (bcvRate <= 0) return Swal.fire('Error', 'No hay tasa BCV para calcular', 'error');

        // 1. Cálculos en Bolívares
        const commissionAmount = amount * (commRate / 100);
        const totalToChargeBs = amount + commissionAmount;

        // 2. Conversión a Dólares (Base del Sistema)
        // El precio en el carrito será el TOTAL (Avance + Comisión) convertido a USD
        const totalInUsd = totalToChargeBs / bcvRate;

        // [MODIFICACIÓN CLAVE UX/BACKEND] 
        // Calculamos el Capital Neto en USD para guardarlo en la etiqueta oculta.
        // Esto permite que el backend sepa exactamente cuánto dinero NO es venta real.
        const capitalInUsd = amount / bcvRate;

        // 3. Crear el Item "Servicio"
        const advanceItem = {
            id: `ADV-${Date.now()}`, // ID único temporal
            // Aquí inyectamos el tag [CAP:00.00] en el nombre.
            // El usuario ve: "🔴 AVANCE EFECTIVO [CAP:25.00] (Entregar: Bs 1000)"
            // El backend usa ese [CAP:25.00] para restar el capital de las ventas.
            name: `🔴 AVANCE EFECTIVO [CAP:${capitalInUsd.toFixed(2)}] (Entregar: Bs ${formatBs(amount)})`,
            price_usd: totalInUsd.toFixed(2), // Precio total en USD (Capital + Comisión)
            price_ves: formatBs(totalToChargeBs), // Solo visual
            stock: 999, // Servicio ilimitado
            icon_emoji: "💸",
            is_taxable: false, // Generalmente esto no lleva IVA
            quantity: 1,
            category: "Servicios"
        };

        addToCart(advanceItem);
        setIsCashAdvanceOpen(false);
        setAdvanceData({ amountBs: '', commission: 10 }); // Reset

        // Alerta de recordatorio para el cajero (SIN CAMBIOS)
        Swal.fire({
            icon: 'warning',
            title: '¡Recordatorio de Caja!',
            text: `Debes entregar Bs ${formatBs(amount)} en billetes al finalizar el cobro.`,
            confirmButtonColor: '#d33'
        });
    };
	
	// [NUEVO] FUNCIÓN DE VALIDACIÓN DE FONDOS PARA AVANCES
    // Ubicación: Pegar esto antes del "return (" del componente App
    const validateAndAddAdvance = async (e) => {
        e.preventDefault(); // Evita que se recargue la página

        // 1. Validaciones básicas
        if (!advanceData.amountBs || parseFloat(advanceData.amountBs) <= 0) {
            return Swal.fire('Error', 'Ingrese un monto válido', 'warning');
        }

        const requestedBs = parseFloat(advanceData.amountBs);

        // 2. Consultar disponibilidad REAL en caja (Backend)
        try {
            Swal.fire({ 
                title: 'Verificando fondos...', 
                didOpen: () => Swal.showLoading(),
                background: '#fff',
                showConfirmButton: false
            });
            
            const res = await axios.get(`${API_URL}/cash/current-status`);
            Swal.close();

            const status = res.data;
            
            // Si la caja no está abierta, no se puede sacar dinero
            if (status.status !== 'ABIERTA') {
                return Swal.fire('Caja Cerrada', 'Debe realizar la apertura de caja primero.', 'warning');
            }

            const sys = status.system_totals;
            const initial = status.shift_info;

            // --- FÓRMULA DE DISPONIBILIDAD ---
            // (Base Inicial + Ventas Efectivo) - (Salidas Efectivo ya realizadas)
            const cashInBs = parseFloat(initial.initial_cash_ves) + sys.cash_ves;
            const cashOutBs = sys.cash_outflows_ves || 0;
            const availableBs = cashInBs - cashOutBs;

            // 3. COMPARAR: ¿Tengo suficiente billete?
            if (requestedBs > availableBs) {
                return Swal.fire({
                    icon: 'error',
                    title: '🚫 Fondos Insuficientes',
                    html: `
                        <div class="text-left font-sans">
                            <p class="mb-3 text-slate-600">No hay suficiente efectivo físico en la gaveta.</p>
                            <div class="bg-red-50 p-3 rounded border border-red-100 text-sm text-red-800">
                                <p><strong>Solicitado:</strong> Bs ${requestedBs.toLocaleString('es-VE', {minimumFractionDigits: 2})}</p>
                                <p><strong>Disponible:</strong> Bs ${availableBs.toLocaleString('es-VE', {minimumFractionDigits: 2})}</p>
                                <hr class="border-red-200 my-1"/>
                                <p><strong>Faltante:</strong> Bs ${(requestedBs - availableBs).toLocaleString('es-VE', {minimumFractionDigits: 2})}</p>
                            </div>
                            <p class="mt-2 text-xs text-slate-400 text-center">Debe ingresar más ventas en efectivo primero.</p>
                        </div>
                    `,
                    confirmButtonColor: '#ef4444'
                });
            }

            // 4. SI HAY FONDOS -> AGREGAR AL CARRITO (Tu lógica original)
            const commissionAmount = requestedBs * (parseFloat(advanceData.commission) / 100);
            const totalWithCommission = requestedBs + commissionAmount;
            
            addToCart({
                id: Date.now(),
                name: 'Avance de Efectivo',
                // El precio base para el sistema es la comisión (ganancia), 
                // pero guardamos la metadata del avance para el cierre.
                price_usd: totalWithCommission / bcvRate, 
                price_bs: totalWithCommission,
                is_advance: true,
                advance_amount_bs: requestedBs, // Lo que sale de caja
                commission_bs: commissionAmount, // Lo que ganamos
                commission_percent: advanceData.commission
            });

            // 5. CERRAR MODAL Y LIMPIAR
            setShowAdvanceModal(false);
            setAdvanceData({ amountBs: '', commission: 10 });
            
            Swal.fire({
                icon: 'success',
                title: 'Validado',
                text: 'Avance agregado al carrito correctamente.',
                timer: 1500,
                showConfirmButton: false
            });

        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Error de conexión al verificar caja.', 'error');
        }
    };

    // 💡 MEJORA UX: Rango de fechas AUTOMÁTICO (Desde el 1° del mes hasta Hoy)
    const [reportDateRange, setReportDateRange] = useState(() => {
        const now = new Date();
        // Obtener el primer día del mes actual
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

        // Ajuste de zona horaria local para evitar desfases (opcional pero recomendado)
        const toLocalISO = (date) => {
            const offset = date.getTimezoneOffset() * 60000;
            return new Date(date.getTime() - offset).toISOString().split('T')[0];
        };

        return {
            start: toLocalISO(firstDay), // Ej: 2025-12-01
            end: toLocalISO(now)         // Ej: 2025-12-17
        };
    });

    // AGREGAR ESTOS DOS NUEVOS:
    const [salesSearch, setSalesSearch] = useState('');       // Exclusivo para Ventas
    const [inventorySearch, setInventorySearch] = useState(''); // Exclusivo para Inventario
    const [isSearchingSales, setIsSearchingSales] = useState(false); // Spinner local

    // --- REEMPLAZA TU FUNCIÓN promptOpenCash CON ESTA ---
const promptOpenCash = async () => {
    const { value: formValues } = await Swal.fire({
        // ... (MANTENEMOS TU DISEÑO VISUAL ACTUAL DE SWEETALERT) ...
        title: `<div class="flex flex-col items-center pt-3 pb-1">
                    <span class="text-4xl animate-bounce-slow">☀️</span>
                    <span class="text-2xl font-black text-slate-800 mt-2 tracking-tight">Iniciar Jornada</span>
                </div>`,
        html: `
            <div class="text-left font-sans px-1">
                <p class="text-center text-slate-400 text-xs mb-6 font-medium leading-relaxed">
                    Indica el efectivo inicial en gaveta (Sencillo/Cambio) para comenzar.
                </p>
                <div class="space-y-4">
                    <div class="bg-slate-50 p-1 rounded-2xl border border-slate-100 group focus-within:border-blue-300 focus-within:bg-blue-50/30 transition-all duration-300">
                        <label class="block text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1 ml-3 mt-2">Fondo en Bolívares</label>
                        <div class="relative">
                            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 font-black text-xl">Bs</span>
                            <input id="init-ves" type="number" step="0.01" class="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-black text-slate-700 text-2xl focus:outline-none focus:ring-0 transition-all placeholder:text-slate-200 shadow-sm group-focus-within:shadow-md" placeholder="0.00">
                        </div>
                    </div>
                    <div class="bg-slate-50 p-1 rounded-2xl border border-slate-100 group focus-within:border-emerald-300 focus-within:bg-emerald-50/30 transition-all duration-300">
                        <label class="block text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1 ml-3 mt-2">Fondo en Divisas</label>
                        <div class="relative">
                            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 font-black text-sm uppercase tracking-wider">Ref</span>
                            <input id="init-usd" type="number" step="0.01" class="w-full pl-14 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-black text-slate-700 text-2xl focus:outline-none focus:ring-0 transition-all placeholder:text-slate-200 shadow-sm group-focus-within:shadow-md" placeholder="0.00">
                        </div>
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Abrir Caja',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0056B3',
        cancelButtonColor: '#ffffff',
        background: '#ffffff',
        width: '420px',
        padding: '1.5rem',
        buttonsStyling: false,
        customClass: {
            popup: 'rounded-[2.5rem] shadow-2xl border border-slate-50',
            confirmButton: 'w-full bg-higea-blue text-white font-bold rounded-xl py-4 text-sm shadow-lg shadow-blue-200 hover:shadow-xl hover:scale-[1.01] transition-all mb-2 mx-4',
            cancelButton: 'w-full bg-white text-slate-400 font-bold rounded-xl py-3 text-xs hover:text-rose-500 transition-all mx-4 border border-transparent hover:border-slate-100'
        },
        didOpen: () => {
            document.getElementById('init-ves').focus();
        },
        preConfirm: () => {
            const usd = document.getElementById('init-usd').value;
            const ves = document.getElementById('init-ves').value;
            return { 
                usd: usd ? parseFloat(usd) : 0, 
                ves: ves ? parseFloat(ves) : 0 
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ 
                title: '', 
                html: '<span class="text-sm font-bold text-slate-500">Iniciando sistema...</span>', 
                timerProgressBar: true, 
                didOpen: () => Swal.showLoading(),
                background: 'transparent',
                backdrop: 'rgba(255,255,255,0.8)'
            });

            await axios.post(`${API_URL}/cash/open`, {
                initial_cash_usd: formValues.usd,
                initial_cash_ves: formValues.ves
            });

            const Toast = Swal.mixin({
                toast: true,
                position: 'top',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true,
                didOpen: (toast) => {
                    toast.addEventListener('mouseenter', Swal.stopTimer)
                    toast.addEventListener('mouseleave', Swal.resumeTimer)
                }
            });

            Toast.fire({
                icon: 'success',
                title: '¡Caja Abierta!',
                text: 'Listo para procesar ventas'
            });

            checkCashStatus(); 

        } catch (err) {
            // --- AQUÍ ESTÁ LA MEJORA UX (VALIDACIÓN DE SEGURIDAD) ---
            if (err.response && err.response.data && err.response.data.error === 'CONFLICTO_TURNO_ABIERTO') {
                Swal.fire({
                    title: '⛔ ACCESO DENEGADO',
                    html: `
                        <div class="text-left">
                            <p class="mb-3 text-slate-600 text-sm">Por seguridad fiscal, no pueden existir dos turnos simultáneos.</p>
                            <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded shadow-sm">
                                <p class="font-bold text-red-800 text-xs uppercase">ERROR CRÍTICO:</p>
                                <p class="text-red-700 text-xs font-mono mt-1">${err.response.data.message}</p>
                            </div>
                            <p class="mt-4 text-xs text-slate-400">Solución: Realiza el ARQUEO del turno anterior antes de iniciar uno nuevo.</p>
                        </div>
                    `,
                    icon: 'error',
                    confirmButtonText: 'Entendido, ir a cerrar',
                    confirmButtonColor: '#ef4444'
                });
            } else {
                // Error genérico (Conexión, etc)
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: err.response?.data?.error || 'Error de conexión',
                    confirmButtonColor: '#E11D2B'
                });
            }
        }
    }
};

    // 1. Carga inicial de datos al montar el componente
    useEffect(() => {
        checkCashStatus(); // <--- AGREGAR ESTO
        fetchData();
    }, []);

    const checkCashStatus = async () => {
        try {
            const res = await axios.get(`${API_URL}/cash/current-status`);

            // CORRECCIÓN LÓGICA CRÍTICA:
            // Si el backend dice 'ABIERTA', guardamos la info del turno (shift_info).
            // Si dice 'CERRADA', ponemos null para bloquear el cobro.
            if (res.data.status === 'ABIERTA' && res.data.shift_info) {
                setCashShift(res.data.shift_info);
            } else {
                setCashShift(null); // Esto activa el bloqueo y muestra el botón "ABRIR"
            }

        } catch (error) {
            console.error(error);
            // En caso de error de conexión, asumimos cerrada por seguridad
            setCashShift(null);
        }
    };

    // 2. Carga de clientes solo al cambiar a la vista CUSTOMERS
    useEffect(() => {
        if (view === 'CUSTOMERS') {
            loadCustomers();
        }
    }, [view]);

    // 💡 Lógica de filtro para la tabla de clientes (AÑADIDO RESET DE PÁGINA)
    useEffect(() => {
        if (customerSearchQuery) {
            const lowerQuery = customerSearchQuery.toLowerCase();
            const results = allCustomers.filter(c =>
                c.full_name.toLowerCase().includes(lowerQuery) ||
                c.id_number.toLowerCase().includes(lowerQuery) ||
                c.phone?.includes(lowerQuery)
            );
            setFilteredCustomers(results);
        } else {
            setFilteredCustomers(allCustomers);
        }
        setCustomerCurrentPage(1); // <-- RESET DE PÁGINA
    }, [customerSearchQuery, allCustomers]);

    // 💡 Lógica de filtro OPTIMIZADA (Con Debounce para evitar Violations)
    useEffect(() => {
        // Creamos un temporizador para no filtrar inmediatamente al escribir
        const timerId = setTimeout(() => {
            let results = products;

            // 1. Filtro por Búsqueda (Texto)
            if (productSearchQuery) {
                const lowerQuery = productSearchQuery.toLowerCase();
                results = results.filter(p =>
                    p.name.toLowerCase().includes(lowerQuery) ||
                    p.category.toLowerCase().includes(lowerQuery) ||
                    p.id.toString().includes(lowerQuery) ||
                    (p.barcode && p.barcode.includes(lowerQuery))
                );
            }

            // 2. Filtro por Vencimiento
            if (filterExpiration) {
                results = results.filter(product => {
                    if (!product.expiration_date) return false;
                    const daysLeft = Math.ceil((new Date(product.expiration_date) - new Date()) / (1000 * 60 * 60 * 24));
                    return daysLeft <= 30;
                });
            }

            setFilteredInventory(results);
            setInventoryCurrentPage(1);
        }, 300); // <--- ESPERA 300ms (Esto elimina el lag del 'input handler')

        // Limpieza: Si escribes otra letra antes de los 300ms, cancela el cálculo anterior
        return () => clearTimeout(timerId);

    }, [productSearchQuery, products, filterExpiration]);

    // 💡 MODIFICADO: Lógica de filtro para productos (POS)
    useEffect(() => {
        // 1. Filtrar por Categoría y por STATUS ACTIVO (Solo mostramos activos en el POS)
        let results = products.filter(p => p.status === 'ACTIVE'); // <--- FILTRO IMPORTANTE

        if (selectedCategory !== 'Todos') {
            results = results.filter(p => p.category === selectedCategory);
        }

        // 2. Filtrar por Búsqueda en POS (Nuevo)
        if (posSearchQuery) {
            const lowerQuery = posSearchQuery.toLowerCase();
            // Ahora permitimos buscar también por código de barras en el POS
            results = results.filter(p =>
                p.name.toLowerCase().includes(lowerQuery) ||
                p.category.toLowerCase().includes(lowerQuery) ||
                (p.barcode && p.barcode.includes(lowerQuery)) // <--- BÚSQUEDA POR BARCODE
            );
        }

        setFilteredProducts(results);
        setCurrentPage(1);
    }, [selectedCategory, products, posSearchQuery]);

    // Efecto para resetear a la página 1 cada vez que abres un cliente nuevo
    useEffect(() => {
        if (selectedCreditCustomer) {
            setDetailsCurrentPage(1);
        }
    }, [selectedCreditCustomer]);

    // 💡 LÓGICA DE FILTRO PARA CRÉDITOS
    useEffect(() => {
        if (creditSearchQuery) {
            const lower = creditSearchQuery.toLowerCase();
            const results = groupedCredits.filter(c =>
                c.full_name.toLowerCase().includes(lower) ||
                c.id_number.toLowerCase().includes(lower)
            );
            setFilteredCredits(results);
        } else {
            setFilteredCredits(groupedCredits);
        }
        setCreditCurrentPage(1); // Resetear a página 1 al buscar
    }, [creditSearchQuery, groupedCredits]);

    // EFECTO: Carga de Ventas (Automática y Debounced)
    useEffect(() => {
        if (reportTab === 'SALES') {
            // Si acabamos de entrar a la pestaña (no hay búsqueda escrita), cargamos RÁPIDO (100ms)
            // Si estamos escribiendo en el buscador, esperamos un poco más (500ms) para no saturar
            const delayTime = salesSearch ? 500 : 50;

            const timer = setTimeout(() => {
                fetchSalesDetail(salesSearch);
            }, delayTime);

            return () => clearTimeout(timer);
        }
    }, [salesSearch, reportTab]); // <--- AQUÍ SÍ DEJAMOS 'reportTab'

    const fetchBatches = async (productId) => {
        try {
            const res = await axios.get(`${API_URL}/inventory/batches/${productId}`);
            setBatches(res.data);
        } catch (error) { console.error(error); }
    };

    // ABRIR MODAL
    const openMovementModal = (product, type) => {
        setMovementProduct(product);
        setMovementType(type);
        setMovementForm({
            quantity: '',
            reason: type === 'IN' ? 'COMPRA_PROVEEDOR' : 'VENTA',
            document_ref: '',
            new_expiration: '',
            // IMPORTANTE: Cargamos el precio actual por defecto
            cost_usd: product.price_usd, 
            batch_id: ''
        });
        setIsMovementModalOpen(true);
    };

    // ENVIAR MOVIMIENTO (CORREGIDO: CÁLCULO DE STOCK REAL)
    // ENVIAR MOVIMIENTO (NIVEL 2: GESTIÓN DE LOTES ROBUSTA)
    const handleMovementSubmit = async (e) => {
        e.preventDefault();
        const qty = parseInt(movementForm.quantity);

        if (!qty || qty <= 0) return Swal.fire('Error', 'Cantidad inválida', 'warning');
        if (movementType === 'IN' && !movementForm.document_ref) return Swal.fire('Atención', 'El Nro de Factura es obligatorio para entradas.', 'warning');

        // VALIDACIÓN: Si es una salida específica (Vencimiento o Merma), es obligatorio seleccionar un lote
        if (movementType === 'OUT' && (movementForm.reason === 'VENCIMIENTO' || movementForm.reason === 'MERMA_DAÑO') && !selectedBatch) {
            return Swal.fire('Error', 'Debes seleccionar un lote de la lista para retirar.', 'warning');
        }

        try {
            Swal.fire({ title: 'Procesando...', didOpen: () => Swal.showLoading() });

            // ENVIAMOS AL BACKEND (El backend maneja la suma de lotes y lógica FEFO)
            await axios.post(`${API_URL}/inventory/movement`, {
                product_id: movementProduct.id,
                type: movementType,
                quantity: qty,
                document_ref: movementForm.document_ref,
                reason: movementForm.reason,
                cost_usd: movementForm.cost_usd,
                // Si es entrada, enviamos la fecha del nuevo lote
                new_expiration: movementType === 'IN' ? movementForm.new_expiration : null,
                // Si es salida específica, enviamos el ID del lote seleccionado
                specific_batch_id: selectedBatch
            });

            Swal.fire({ icon: 'success', title: 'Movimiento Exitoso', timer: 1500, showConfirmButton: false });

            // Limpieza y Cierre
            setIsMovementModalOpen(false);
            setMovementForm({
                quantity: '',
                document_ref: '',
                reason: 'COMPRA_PROVEEDOR',
                cost_usd: '',
                new_expiration: '',
                next_expiration: '' // Limpiamos campos viejos por si acaso
            });
            setSelectedBatch(null);

            // CRÍTICO: Recargar los datos para ver el nuevo stock total calculado por el backend
            fetchData();

        } catch (error) {
            console.error(error);
            Swal.fire('Error', error.response?.data?.error || 'Error al procesar', 'error');
        }
    };

    // Helper auxiliar corregido (recibe el stock calculado)
    const updateProductDate = async (prod, date, correctStock) => {
        return axios.post(`${API_URL}/products`, {
            ...prod,
            price_usd: prod.price_usd,
            stock: correctStock, // <--- AQUÍ ESTÁ LA CORRECCIÓN: Usamos el stock calculado (10), no el viejo (3)
            is_taxable: prod.is_taxable,
            expiration_date: date
        });
    };

    // --- FUNCIÓN: VER KARDEX (HISTORIAL) ---
    const viewKardexHistory = async (product) => {
        setKardexProduct(product);
        setIsKardexOpen(true);
        setKardexHistory([]); // Limpiar anterior

        try {
            Swal.fire({ title: 'Auditando Kardex...', didOpen: () => Swal.showLoading() });
            // Asegúrate de tener este endpoint en tu server.js (lo creamos en el paso anterior)
            const res = await axios.get(`${API_URL}/inventory/history/${product.id}`);
            setKardexHistory(res.data);
            Swal.close();
        } catch (error) {
            console.error(error);
            Swal.fire('Info', 'No hay historial disponible aún para este producto.', 'info');
            setIsKardexOpen(false);
        }
    };

    // --- FUNCIÓN: IMPRIMIR REPORTE KARDEX (ADAPTADO A LEYES VENEZOLANAS - BS) ---
    const printKardexReport = () => {
        if (!kardexProduct || kardexHistory.length === 0) return Swal.fire('Error', 'No hay datos para exportar', 'warning');

        const doc = new jsPDF('l', 'mm', 'a4'); 
        const pageWidth = doc.internal.pageSize.width;

        // --- PALETA ---
        const colors = {
            header: [30, 41, 59],    // Slate 800
            green: [22, 163, 74],    // Green 600
            red: [220, 38, 38],      // Red 600
            blue: [37, 99, 235]      // Blue 600
        };

        // 1. ENCABEZADO FISCAL
        doc.setFillColor(...colors.header);
        doc.rect(0, 0, pageWidth, 30, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text("KARDEX DE INVENTARIO VALORIZADO", 14, 12); // Nombre técnico contable

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text("CONTROL DE MOVIMIENTOS Y EXISTENCIAS (EXPRESADO EN BOLÍVARES)", 14, 18);
        
        // Datos de la Empresa y Tasa
        doc.setFontSize(9);
        doc.text("RIF: J-30521322-4", pageWidth - 14, 10, { align: 'right' });
        doc.text("Razón Social: VOLUNTARIADO HIGEA C.A.", pageWidth - 14, 15, { align: 'right' });
        doc.text(`Emisión: ${new Date().toLocaleString('es-VE')}`, pageWidth - 14, 20, { align: 'right' });
        doc.text(`Tasa de Cambio Base: Bs ${formatBs(bcvRate)}`, pageWidth - 14, 25, { align: 'right' });

        // 2. DATOS DEL PRODUCTO
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(200, 200, 200);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(14, 35, pageWidth - 28, 20, 2, 2, 'FD');

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`PRODUCTO: ${kardexProduct.name.toUpperCase()}`, 20, 42);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`CÓDIGO: ${kardexProduct.barcode || 'S/C'}`, 20, 48);
        doc.text(`CATEGORÍA: ${kardexProduct.category || 'General'}`, 20, 52);

        // Saldos Actuales Valorizados
        const stockActual = kardexProduct.stock;
        const costoUnitRef = parseFloat(kardexProduct.price_usd);
        const costoUnitBs = costoUnitRef * bcvRate;
        const valorTotalBs = stockActual * costoUnitBs;

        doc.text(`EXISTENCIA: ${stockActual} UND`, 120, 48);
        // Costo Unitario en Bs (Obligatorio)
        doc.text(`COSTO UNITARIO: Bs ${formatBs(costoUnitBs)}`, 120, 52);

        // Valor Total en Bs (Activo Realizable)
        doc.setFont('helvetica', 'bold');
        doc.text(`VALOR TOTAL (BS): Bs ${formatBs(valorTotalBs)}`, 200, 48);
        
        // Referencia en Divisa (Auxiliar para Gerencia)
        doc.setTextColor(...colors.blue);
        doc.setFontSize(8);
        doc.text(`(Ref. Total: $${formatUSD(stockActual * costoUnitRef)})`, 200, 52);
        doc.setTextColor(0, 0, 0); // Reset color

        // 3. TABLA ANALÍTICA (CUMPLIMIENTO LEGAL)
        autoTable(doc, {
            startY: 60,
            head: [[
                'FECHA', 'DOC. REF', 'CONCEPTO', // Datos Operativos
                'TIPO', 'CANT', 
                'COSTO UNIT (BS)', 'TOTAL OP (BS)', // Datos Financieros Legales
                'TOTAL OP (REF)', // Dato Gerencial (Opcional pero útil)
                'SALDO'
            ]],
            body: kardexHistory.map(mov => {
                // Cálculos Financieros
                const costRef = mov.cost_usd ? parseFloat(mov.cost_usd) : 0;
                const costBs = costRef * bcvRate; // Convertimos a Bs a la tasa del reporte (o histórica si la tuvieras)
                
                const totalRef = costRef * mov.quantity;
                const totalBs = totalRef * bcvRate;
                
                return [
                    new Date(mov.created_at).toLocaleDateString('es-VE'),
                    mov.document_ref || '-',
                    mov.reason ? mov.reason.replace(/_/g, ' ') : 'MOVIMIENTO',
                    mov.type === 'IN' ? 'ENTRADA' : 'SALIDA',
                    mov.quantity,
                    // Columnas Financieras en Bolívares (Prioridad)
                    formatBs(costBs),
                    formatBs(totalBs),
                    // Columna Financiera en Divisa (Secundaria)
                    formatUSD(totalRef),
                    mov.new_stock
                ];
            }),
            styles: { fontSize: 8, cellPadding: 2, valign: 'middle' },
            headStyles: { 
                fillColor: colors.header, 
                textColor: 255, 
                fontStyle: 'bold', 
                halign: 'center' 
            },
            columnStyles: {
                0: { cellWidth: 20 }, // Fecha
                3: { fontStyle: 'bold', halign: 'center' }, // Tipo
                4: { halign: 'center', fontStyle: 'bold' }, // Cant
                5: { halign: 'right' }, // Unit Bs
                6: { halign: 'right', fontStyle: 'bold' }, // Total Bs
                7: { halign: 'right', textColor: colors.blue }, // Total Ref
                8: { halign: 'center', fontStyle: 'bold', fillColor: [241, 245, 249] } // Saldo
            },
            didParseCell: function (data) {
                // Colorear Entradas y Salidas
                if (data.section === 'body' && data.column.index === 3) {
                    if (data.cell.raw === 'ENTRADA') data.cell.styles.textColor = colors.green;
                    else data.cell.styles.textColor = colors.red;
                }
            }
        });

        // 4. PIE DE PÁGINA LEGAL (FUNDAMENTO JURÍDICO)
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(7);
        doc.setTextColor(100);
        
        doc.text("NOTA: Los valores en Bolívares se calculan en base a la tasa de cambio vigente a la fecha de emisión de este reporte, conforme a lo establecido en la normativa legal.", 14, finalY);
        doc.text("BASE LEGAL: Art. 177 Reglamento ISLR (Sistema de Inventarios Permanentes) y Providencia Administrativa SNAT/2011/0071.", 14, finalY + 4);

        // Líneas de Firma para Auditoría
        doc.setDrawColor(0, 0, 0);
        doc.line(200, finalY + 15, 270, finalY + 15);
        doc.text("Conformado Por (Firma y Sello)", 220, finalY + 20);

        doc.save(`Kardex_Valorizado_${kardexProduct.name.replace(/\s+/g, '_')}.pdf`);
    };

	// --- 1. FUNCIÓN DE REPORTE DE AUDITORÍA (CORREGIDA Y CON DATOS FISCALES) ---
    const printInventoryAuditPDF = () => {
        if (!products || products.length === 0) return Swal.fire('Vacío', 'No hay datos de inventario para generar el reporte.', 'info');

        const doc = new jsPDF('l', 'mm', 'a4'); // Horizontal
        const pageWidth = doc.internal.pageSize.width;

        // --- PALETA ---
        const colors = {
            header: [30, 41, 59],    // Slate 800
            accent: [225, 29, 43],   // Higea Red
            text: [51, 65, 85],      // Slate 700
            bg: [241, 245, 249]      // Slate 100
        };

        // 1. ENCABEZADO FORMAL (AMPLIADO CON DATOS FISCALES)
        doc.setFillColor(...colors.header);
        doc.rect(0, 0, pageWidth, 35, 'F'); // Aumentamos altura a 35

        // Título Principal
        doc.setFontSize(16);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text("REPORTE DE VALORIZACIÓN Y EXISTENCIAS", 14, 12);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text("CONTROL DE INVENTARIO FÍSICO", 14, 18);

        // --- DATOS FISCALES DE LA EMPRESA (NUEVO) ---
        doc.setFontSize(9);
        doc.text("RIF: J-30521322-4", 14, 24); // Ajustar con tu RIF real
        doc.text("Razón Social: VOLUNTARIADO HIGEA C.A.", 14, 29); // Ajustar nombre

        // Datos de Fecha y Tasa (Alineados a la derecha)
        const dateStr = new Date().toLocaleString('es-VE');
        const rateStr = formatBs(bcvRate);
        
        doc.text(`Fecha de Corte: ${dateStr}`, pageWidth - 14, 12, { align: 'right' });
        doc.text(`Tasa de Cambio BCV: Bs ${rateStr}`, pageWidth - 14, 18, { align: 'right' });
        doc.text(`Expresado en: Bolívares (Bs) y Divisa Referencial (Ref)`, pageWidth - 14, 24, { align: 'right' });

        // 2. CÁLCULO DE TOTALES
        let totalStock = 0;
        let totalValueUSD = 0;
        let totalValueVES = 0;

        products.forEach(item => {
            const stock = parseInt(item.stock) || 0;
            const price = parseFloat(item.price_usd) || 0;
            const totalUSD = stock * price;
            const totalVES = totalUSD * bcvRate;

            totalStock += stock;
            totalValueUSD += totalUSD;
            totalValueVES += totalVES;
        });

        // Dibujar Totales (Bajamos la coordenada Y porque el header es más alto)
        const startYTotals = 40;
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(200, 200, 200);
        doc.roundedRect(14, startYTotals, pageWidth - 28, 20, 3, 3, 'S');

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
        doc.text("ITEMS TOTALES", 30, startYTotals + 6, { align: 'center' });
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`${products.length}`, 30, startYTotals + 14, { align: 'center' });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text("UNIDADES EN STOCK", 80, startYTotals + 6, { align: 'center' });
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`${totalStock}`, 80, startYTotals + 14, { align: 'center' });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text("VALOR TOTAL (BS)", 150, startYTotals + 6, { align: 'center' });
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.accent); 
        doc.text(`Bs ${formatBs(totalValueVES)}`, 150, startYTotals + 14, { align: 'center' });

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text("VALOR TOTAL (REF)", 230, startYTotals + 6, { align: 'center' });
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 86, 179); 
        doc.text(`Ref ${formatUSD(totalValueUSD)}`, 230, startYTotals + 14, { align: 'center' });

        // 3. TABLA DE DETALLE
        autoTable(doc, {
            startY: startYTotals + 25,
            head: [['CÓDIGO', 'DESCRIPCIÓN DEL PRODUCTO', 'CATEGORÍA', 'STOCK', 'COSTO UNIT (BS)', 'TOTAL (BS)', 'TOTAL (REF)']],
            body: products.map(item => {
                const stock = parseInt(item.stock) || 0;
                const price = parseFloat(item.price_usd) || 0;
                const totalUSD = stock * price;
                const totalVES = totalUSD * bcvRate;
                const unitVES = price * bcvRate;

                return [
                    item.barcode || `INT-${item.id}`,
                    item.name.substring(0, 45),
                    item.category || 'General',
                    stock,
                    formatBs(unitVES),
                    formatBs(totalVES),
                    formatUSD(totalUSD)
                ];
            }),
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: colors.header, textColor: 255, fontStyle: 'bold', halign: 'center' },
            columnStyles: {
                0: { cellWidth: 25 }, 
                3: { halign: 'center', fontStyle: 'bold' }, 
                4: { halign: 'right' },
                5: { halign: 'right', fontStyle: 'bold' }, 
                6: { halign: 'right', textColor: [0, 86, 179] } 
            },
            alternateRowStyles: { fillColor: colors.bg }
        });

        // 4. PIE DE PÁGINA LEGAL
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text("Este reporte refleja la valorización del inventario según los costos registrados en el sistema al momento de su emisión.", 14, finalY);
        doc.text("Base Legal: Art. 177 Reglamento de la Ley de ISLR (Valuación de Inventarios) y Providencia Administrativa 0071.", 14, finalY + 4);

        // Espacio para firmas (Opcional pero recomendado para auditoría)
        doc.setDrawColor(200, 200, 200);
        doc.line(200, finalY + 15, 270, finalY + 15);
        doc.text("Revisado por (Firma y Sello)", 215, finalY + 19);

        doc.save(`Auditoria_Inventario_${new Date().toISOString().split('T')[0]}.pdf`);
    };
	
	// --- FUNCIÓN: REPORTE DE TOMA DE INVENTARIO FÍSICO (CONTEO CIEGO - CON DATOS FISCALES) ---
    const printPhysicalCountReport = () => {
        // Usamos inventoryFilteredData si quieres imprimir solo lo filtrado, o products para todo
        const dataToPrint = inventoryFilteredData.length > 0 ? inventoryFilteredData : products;
        
        if (!dataToPrint || dataToPrint.length === 0) return Swal.fire('Error', 'No hay datos para generar el acta', 'warning');

        const doc = new jsPDF('p', 'mm', 'a4'); // Vertical
        const pageWidth = doc.internal.pageSize.width;

        // --- PALETA ---
        const colors = {
            header: [51, 65, 85],    // Slate 700
            bg: [255, 255, 255]      // Blanco
        };

        // 1. ENCABEZADO FISCAL (Igual que los otros reportes)
        doc.setFillColor(...colors.header);
        doc.rect(0, 0, pageWidth, 30, 'F'); // Altura ajustada

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text("ACTA DE TOMA DE INVENTARIO FÍSICO", 14, 12);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text("INSTRUMENTO DE CONTEO CIEGO (AUDITORÍA)", 14, 18);

        // --- DATOS DE LA EMPRESA ---
        doc.setFontSize(9);
        doc.text("J-30521322-4", 14, 24); 
        doc.text("Razón Social: VOLUNTARIADO HIGEA C.A.", 14, 28);

        // Datos de la Jornada (Alineados a la derecha)
        const fecha = new Date().toLocaleDateString('es-VE');
        doc.text(`Fecha de Emisión: ${fecha}`, pageWidth - 14, 12, { align: 'right' });
        doc.text("Responsable de Conteo: ___________________", pageWidth - 14, 18, { align: 'right' });
        doc.text("Auditor Supervisor: ___________________", pageWidth - 14, 24, { align: 'right' });

        // 2. TABLA DE CONTEO (SIN CANTIDADES NI COSTOS)
        autoTable(doc, {
            startY: 35, // Bajamos un poco por el encabezado más alto
            head: [['CÓDIGO', 'CATEGORÍA', 'DESCRIPCIÓN DEL PRODUCTO', 'UNIDAD', 'CONTEO REAL (FÍSICO)']],
            body: dataToPrint.map(item => [
                item.barcode || `INT-${item.id}`,
                item.category || 'General',
                item.name,
                'UND',
                '' // <--- CAMPO VACÍO INTENCIONAL PARA ESCRIBIR
            ]),
            styles: { fontSize: 9, cellPadding: 3, valign: 'middle', lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { 
                fillColor: colors.header, 
                textColor: 255, 
                fontStyle: 'bold', 
                halign: 'center' 
            },
            columnStyles: {
                0: { cellWidth: 25 }, 
                1: { cellWidth: 30 },
                2: { cellWidth: 'auto' }, 
                3: { cellWidth: 20, halign: 'center' },
                4: { cellWidth: 40, minCellHeight: 10 } // Espacio alto para escribir números a mano
            },
            // Dibujar la línea para escribir en la columna de conteo
            didDrawCell: function (data) {
                if (data.section === 'body' && data.column.index === 4) {
                    const x = data.cell.x;
                    const y = data.cell.y;
                    const w = data.cell.width;
                    const h = data.cell.height;
                    // Dibujamos una línea en la parte inferior de la celda
                    doc.setDrawColor(100, 100, 100);
                    doc.setLineWidth(0.5);
                    doc.line(x + 5, y + h - 2, x + w - 5, y + h - 2);
                }
            },
            alternateRowStyles: { fillColor: [250, 250, 250] } 
        });

        // 3. PIE DE PÁGINA (DECLARACIÓN JURADA)
        const finalY = doc.lastAutoTable.finalY + 15;
        doc.setFontSize(8);
        doc.setTextColor(0, 0, 0);
        
        doc.text("Certifico que he realizado el conteo físico de los artículos listados, verificando su existencia real en los almacenes.", 14, finalY);
        doc.text("Este documento es propiedad exclusiva de VOLUNTARIADO HIGEA y sirve de soporte para el cierre contable.", 14, finalY + 4);

        // Espacio para firmas al final del documento
        if (finalY < 250) { 
            doc.line(40, finalY + 20, 90, finalY + 20);
            doc.text("Firma Responsable", 65, finalY + 24, { align: 'center' });

            doc.line(120, finalY + 20, 170, finalY + 20);
            doc.text("Firma Auditor", 145, finalY + 24, { align: 'center' });
        }

        doc.save(`Toma_Fisica_Inventario_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    // --- FUNCIÓN INTELIGENTE PARA EXPORTAR CSV (Soporta: Inventario, Ventas, Historial y Resumen) ---
    const downloadCSV = (data, fileName) => {
        if (!data || data.length === 0) return Swal.fire('Vacío', 'No hay datos para exportar', 'info');

        // 1. DETECTAR QUÉ TIPO DE DATA ES
        const first = data[0];
        const isInventory = first.hasOwnProperty('stock') && first.hasOwnProperty('name');
        const isDailySummary = first.hasOwnProperty('sale_date') && first.hasOwnProperty('total_usd');
        // DETECCIÓN NUEVA PARA KARDEX:
        const isKardex = first.hasOwnProperty('new_stock') && first.hasOwnProperty('reason'); 

        let orderedHeaders = [];
        let rowMapper = null;

        if (isInventory) {
            // --- A. MODO INVENTARIO ---
            orderedHeaders = ["ID", "Producto", "Categoría", "Estatus", "Stock", "Costo Ref", "Costo Bs", "Valor Total Ref", "Valor Total Bs"];
            rowMapper = (row) => ({
                "ID": row.id,
                "Producto": row.name,
                "Categoría": row.category,
                "Estatus": row.status,
                "Stock": row.stock,
                "Costo Ref": parseFloat(row.price_usd).toFixed(2),
                "Costo Bs": (parseFloat(row.price_usd) * bcvRate).toFixed(2),
                "Valor Total Ref": parseFloat(row.total_value_usd || 0).toFixed(2),
                "Valor Total Bs": (parseFloat(row.total_value_usd || 0) * bcvRate).toFixed(2)
            });

        } else if (isDailySummary) {
            // --- B. MODO RESUMEN GERENCIAL ---
            orderedHeaders = ["Fecha", "Transacciones", "Total Recaudado (Ref)", "Total Recaudado (Bs)"];
            rowMapper = (row) => ({
                "Fecha": new Date(row.sale_date).toLocaleDateString(),
                "Transacciones": row.tx_count,
                "Total Recaudado (Ref)": parseFloat(row.total_usd).toFixed(2),
                "Total Recaudado (Bs)": parseFloat(row.total_ves).toFixed(2)
            });

        } else if (isKardex) {
            // --- C. MODO KARDEX (HISTORIAL) - RESTAURADO ---
            orderedHeaders = ["Fecha", "Hora", "Tipo", "Concepto", "Referencia", "Costo Lote ($)", "Cantidad", "Saldo Final"];
            rowMapper = (row) => ({
                "Fecha": new Date(row.created_at).toLocaleDateString('es-VE'),
                "Hora": new Date(row.created_at).toLocaleTimeString('es-VE'),
                "Tipo": row.type === 'IN' ? 'ENTRADA' : 'SALIDA',
                "Concepto": row.reason ? row.reason.replace(/_/g, ' ') : '-',
                "Referencia": row.document_ref || '-',
                "Costo Lote ($)": row.cost_usd ? parseFloat(row.cost_usd).toFixed(2) : '-',
                "Cantidad": row.quantity,
                "Saldo Final": row.new_stock
            });

        } else {
            // --- D. MODO VENTAS DETALLADAS (Fallback) ---
            orderedHeaders = ["Nro Factura", "Fecha", "Cliente", "Documento", "Ítems", "Estado", "Pago", "Total Ref", "Total Bs"];
            rowMapper = (row) => ({
                "Nro Factura": row.id || row.sale_id,
                "Fecha": new Date(row.created_at).toLocaleString('es-VE'),
                "Cliente": row.full_name || row.client_name || 'Consumidor Final',
                "Documento": row.client_id || row.id_number || 'N/A',
                "Ítems": row.items_comprados || 'Sin detalle',
                "Estado": row.status,
                "Pago": row.payment_method,
                "Total Ref": parseFloat(row.total_usd).toFixed(2),
                "Total Bs": parseFloat(row.total_ves).toFixed(2)
            });
        }

        // 2. Construir el contenido CSV
        const csvContent = [
            orderedHeaders.join(';'),
            ...data.map(originalRow => {
                const mappedRow = rowMapper(originalRow);
                return orderedHeaders.map(header => {
                    let value = mappedRow[header];
                    if (value === null || value === undefined) value = '';
                    return String(value).replace(/(\r\n|\n|\r)/gm, " ").replace(/;/g, ",");
                }).join(';');
            })
        ].join('\r\n');

        // 3. Descargar con BOM para compatibilidad Excel
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${fileName}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const fetchSalesDetail = async (termInput) => {
        // --- [NUEVO] VALIDACIÓN DE FECHAS UX ---
        const start = new Date(reportDateRange.start);
        const end = new Date(reportDateRange.end);

        if (end < start) {
            return Swal.fire({
                icon: 'error',
                title: 'Rango de Fechas Inválido',
                text: 'La fecha final no puede ser menor a la fecha de inicio.',
                confirmButtonColor: '#E11D2B'
            });
        }
        // ---------------------------------------

        try {
            // LÓGICA: Si termInput es un evento (click) o es null, usamos el estado actual 'salesSearch'.
            const term = (typeof termInput === 'string') ? termInput : salesSearch;

            if (!term) Swal.fire({ title: 'Cargando ventas...', didOpen: () => Swal.showLoading() }); // UX: Mensaje más claro
            else setIsSearchingSales(true);

            const res = await axios.get(`${API_URL}/reports/sales-detail`, {
                params: {
                    startDate: reportDateRange.start,
                    endDate: reportDateRange.end,
                    search: term
                }
            });

            // ... (Resto del código de normalización igual) ...

            const normalizedData = res.data.map(item => ({
                ...item,
                id: item.id || item["Nro Factura"] || item.sale_id,
                full_name: item.client_name || item["Cliente"] || 'Cliente Casual', // Ajuste para coincidir con tu server.js nuevo
                total_ves: item.total_ves || item["Total Bs"],
                total_usd: item.total_usd || item["Total USD"],
                status: item.status || item["Estado"]
            }));

            setDetailedSales(normalizedData);
            setReportTab('SALES'); // Aseguramos que cambie la pestaña
            setSalesReportPage(1);

            if (!term) Swal.close();
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudieron cargar las ventas.', 'error');
        } finally {
            setIsSearchingSales(false);
        }
    };

    // EFECTO: Búsqueda en vivo para Ventas (Espera 500ms tras escribir)
    useEffect(() => {
        // Solo ejecutar si estamos en la pestaña de ventas
        if (reportTab === 'SALES') {
            const delayDebounceFn = setTimeout(() => {
                fetchSalesDetail(salesSearch);
            }, 500);

            return () => clearTimeout(delayDebounceFn);
        }
        // 👇👇 IMPORTANTE: Aquí abajo SOLO debe estar 'salesSearch'. 
        // Si dice [salesSearch, reportTab], BORRA reportTab.
    }, [salesSearch]);

    // Cargar Inventario Detallado
    const fetchInventoryDetail = async () => {
        try {
            Swal.fire({ title: 'Analizando inventario...', didOpen: () => Swal.showLoading() });
            const res = await axios.get(`${API_URL}/reports/inventory-detail`);
            setDetailedInventory(res.data);
            setReportTab('INVENTORY');
            setInventoryReportPage(1); // <--- REINICIO DE PAGINACIÓN
            Swal.close();
        } catch (error) {
            Swal.fire('Error', 'Revisa la conexión.', 'error');
        }
    };


    // Función de carga de clientes (usada en el useEffect anterior)
    const loadCustomers = async () => {
        try {
            const res = await axios.get(`${API_URL}/customers`);
            setAllCustomers(res.data);
        } catch (error) {
            console.error("Error loading customers:", error);
        }
    };

    // Función para cargar datos de cliente en el formulario de edición
    const editCustomer = (customer) => {
        setCustomerForm({
            id: customer.id,
            full_name: customer.full_name,
            id_number: customer.id_number,
            phone: customer.phone || '',
            institution: customer.institution || '',
            status: customer.status || 'ACTIVO',
        });
        // Desplazarse hacia arriba para que el usuario vea el formulario
        window.scrollTo(0, 0);
    }

    // --- FUNCIÓN PARA AGREGAR SALDO INICIAL A CLIENTE ---
    const addInitialBalance = async (customer) => {
        const { value: formValues } = await Swal.fire({
            title: `Saldo Inicial: ${customer.full_name}`,
            html: `
              <p class="text-sm text-gray-500 mb-4">Ingresa el monto de la deuda antigua para traerla al sistema actual.</p>
              <input id="swal-balance-amount" type="number" step="0.01" class="swal2-input" placeholder="Monto en USD (Ref)">
              <input id="swal-balance-desc" type="text" class="swal2-input" placeholder="Nota (Ej: Deuda año 2024)">
          `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Registrar Deuda',
            confirmButtonColor: '#E11D2B', // Rojo institucional
            preConfirm: () => {
                const amount = document.getElementById('swal-balance-amount').value;
                const desc = document.getElementById('swal-balance-desc').value;
                if (!amount || parseFloat(amount) <= 0) {
                    Swal.showValidationMessage('Por favor ingrese un monto válido');
                }
                return { amount, desc };
            }
        });

        if (formValues) {
            try {
                Swal.fire({ title: 'Registrando...', didOpen: () => Swal.showLoading() });

                await axios.post(`${API_URL}/customers/${customer.id}/initial-balance`, {
                    amount: formValues.amount,
                    description: formValues.desc
                });

                Swal.fire('¡Listo!', 'El saldo inicial ha sido cargado como una cuenta por cobrar.', 'success');

                // Recargar datos si estamos en la vista de reportes o clientes
                fetchData();
                loadCustomers();

            } catch (error) {
                console.error(error);
                Swal.fire('Error', 'No se pudo registrar el saldo inicial.', 'error');
            }
        }
    };

    // Función para guardar/actualizar el cliente
    const saveCustomer = async (e) => {
        e.preventDefault();

        if (!customerForm.full_name || !customerForm.id_number) {
            return Swal.fire('Datos Incompletos', 'Nombre y Número de Identificador son obligatorios.', 'warning');
        }

        try {
            Swal.fire({ title: `Guardando Cliente...`, didOpen: () => Swal.showLoading() });
            await axios.post(`${API_URL}/customers`, customerForm);

            Swal.fire('¡Éxito!', `Cliente ${customerForm.id ? 'actualizado' : 'registrado'} correctamente.`, 'success');

            // Resetear formulario y recargar lista
            setCustomerForm({ id: null, full_name: '', id_number: '', phone: '', institution: '', status: 'ACTIVO' });
            loadCustomers();
        } catch (error) {
            // 💡 MEJORA: Manejo de errores 409 (Conflicto de ID) del backend
            const message = error.response?.data?.error || error.message;
            const status = error.response?.status;

            if (status === 409) {
                Swal.fire('Error de Duplicado', message, 'error');
            } else {
                Swal.fire('Error', `Fallo al guardar cliente: ${message}`, 'error');
            }
        }
    }

    // Función para manejar los cambios en el formulario de clientes con validación
    const handleCustomerFormChange = (e) => {
        const { name, value } = e.target;
        let newValue = value;

        if (name === 'full_name') {
            newValue = capitalizeWords(value);
        } else if (name === 'id_number') {
            newValue = validateIdNumber(value);
        } else if (name === 'phone') {
            newValue = validatePhone(value);
        } else if (name === 'institution') {
            newValue = capitalizeWords(value);
        }

        setCustomerForm(prev => ({ ...prev, [name]: newValue }));
    };

    // --- NUEVA LÓGICA: Lógica de Edición/Creación de Productos con Campo Fiscal y Validación de Texto ---
    const handleProductFormChange = (e) => {
        const { name, value } = e.target;
        let newValue = value;

        // 🎯 LÓGICA DE VALIDACIÓN Y FORMATO: Nombre y Categoría solo letras + Capitalización
        if (name === 'name' || name === 'category') {
            // 1. Limpiar: Permitir solo letras, espacios y caracteres acentuados comunes.
            const cleaned = value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '');

            // 2. Formatear (Capitalizar por palabra)
            newValue = cleaned.toLowerCase().split(' ').map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');
        }

        setProductForm(prev => ({
            ...prev,
            // CRUCIAL: Convertir el valor de `is_taxable` a booleano, o usar newValue si es otro campo
            [name]: (name === 'is_taxable') ? (value === 'true') : newValue
        }));
    };

    // Función para selección rápida de emoji
    const handleEmojiSelect = (emoji) => {
        setProductForm(prev => ({ ...prev, icon_emoji: emoji }));
    };

    const saveProduct = async (e) => {
        e.preventDefault();

        if (!productForm.name || !productForm.price_usd || parseFloat(productForm.price_usd) <= 0) {
            return Swal.fire('Datos Incompletos', 'Nombre y Precio (USD > 0) son obligatorios.', 'warning');
        }

        try {
            Swal.fire({ title: `Guardando Producto...`, didOpen: () => Swal.showLoading() });

            const productToSend = {
                ...productForm, // Hereda id, name, category, icon_emoji, etc.

                // Convertir valores numéricos y booleanos al formato correcto
                price_usd: parseFloat(productForm.price_usd),
                stock: parseInt(productForm.stock),

                // Aseguramos que is_taxable sea un booleano real (por si viene como string "true")
                is_taxable: (productForm.is_taxable === true || productForm.is_taxable === 'true'),

                // IMPORTANTE: Aseguramos explícitamente que status y barcode se envíen
                status: productForm.status,
                barcode: productForm.barcode
            };

            // Opcional: ver en consola qué se está enviando para depurar
            console.log("Enviando al servidor:", productToSend);

            await axios.post(`${API_URL}/products`, productToSend);

            Swal.fire('¡Éxito!', `Producto ${productForm.id ? 'actualizado' : 'registrado'} correctamente.`, 'success');

            // Resetear formulario incluyendo los nuevos campos
            setProductForm({
                id: null,
                name: '',
                category: '',
                price_usd: 0.00,
                stock: 0,
                is_taxable: true,
                icon_emoji: EMOJI_OPTIONS[0] || '🍔',
                barcode: '',
                status: 'ACTIVE',
                expiration_date: '' // <--- RESETEAR FECHA
            });

            setIsProductFormOpen(false); // Cierra el modal al terminar
            fetchData(); // Recarga la lista
        } catch (error) {
            const message = error.response?.data?.error || error.message;
            Swal.fire('Error', `Fallo al guardar producto: ${message}`, 'error');
        }
    }


   // FUNCIÓN DE CARGA DE DATOS (CORREGIDA: CÁLCULO DE TASA INTELIGENTE)
    const fetchData = async () => {
        try {
            // 1. Cargar estado y configuración
            const statusRes = await axios.get(`${API_URL}/status`);
            const currentBcvRate = statusRes.data.bcv_rate; // Guardamos la tasa actual para usarla de respaldo
            
            setBcvRate(currentBcvRate);
            setFallbackRate(statusRes.data.fallback_rate);

            // 2. Cargar Productos
            const prodRes = await axios.get(`${API_URL}/products`);
            const rawProducts = Array.isArray(prodRes.data) ? prodRes.data : [];

            const allProducts = rawProducts
                .map(p => ({ ...p, is_taxable: p.is_taxable === true || p.is_taxable === 't' || p.is_taxable === 1 }))
                .sort((a, b) => a.id - b.id);

            setProducts(allProducts);
            setFilteredProducts(allProducts);
            setFilteredInventory(allProducts);
            setCategories(['Todos', ...new Set(allProducts.map(p => p.category))]);

            // 3. Reportes básicos
            const statsRes = await axios.get(`${API_URL}/reports/daily`);
            const rawStats = statsRes.data; 

            const recentRes = await axios.get(`${API_URL}/reports/recent-sales`);
            setRecentSales(Array.isArray(recentRes.data) ? recentRes.data : []);

            const stockRes = await axios.get(`${API_URL}/reports/low-stock`);
            setLowStock(Array.isArray(stockRes.data) ? stockRes.data : []);

            // ===========================================================================
            // --- CORRECCIÓN MATEMÁTICA: TASA INTELIGENTE PARA EVITAR CERO ---
            // ===========================================================================
            const salesRes = await axios.get(`${API_URL}/reports/sales-today`);
            const rawSales = Array.isArray(salesRes.data) ? salesRes.data : [];

            const sales = rawSales.map(sale => ({
                ...sale,
                total_usd: parseFloat(sale.total_usd) || 0,
                amount_paid_usd: parseFloat(sale.amount_paid_usd) || 0,
                bcv_rate_snapshot: parseFloat(sale.bcv_rate_snapshot) || 0,
                total_ves: parseFloat(sale.total_ves) || 0,
                payment_method: sale.payment_method || ''
            }));

            setDailySalesList(sales);

            // Cálculo interno
            let totalRef = 0;
            let totalBs = 0;
            let count = 0;

            sales.forEach(sale => {
                // 1. Filtros de Exclusión
                const isStatusDonation = sale.status === 'DONADO';
                const methodStr = (sale.payment_method || '').toUpperCase();
                const isDescDonation = methodStr.includes('DONACI') || methodStr.includes('DONACIÓN');

                if (sale.status !== 'ANULADO' && !isStatusDonation && !isDescDonation) {
                    
                    // 2. Base del cálculo: Lo que realmente se pagó
                    let montoReal = sale.amount_paid_usd;

                    // 3. Lógica de Avance (Restar Capital)
                    if (methodStr.includes('[CAP:')) {
                        try {
                            const match = sale.payment_method.match(/\[CAP:([\d\.]+)\]/);
                            if (match && match[1]) {
                                const capital = parseFloat(match[1]);
                                montoReal -= capital; 
                            }
                        } catch (e) { console.error("Error CAP:", e); }
                    }

                    // 4. [CORRECCIÓN CRÍTICA] Tasa Inteligente
                    // Si la venta no tiene tasa guardada (es 0), la calculamos (Total Bs / Total $)
                    // Si eso falla, usamos la tasa del día (currentBcvRate)
                    let tasaVenta = sale.bcv_rate_snapshot;
                    if (!tasaVenta || tasaVenta === 0) {
                        if (sale.total_usd > 0 && sale.total_ves > 0) {
                            tasaVenta = sale.total_ves / sale.total_usd; // Deducimos la tasa
                        } else {
                            tasaVenta = currentBcvRate; // Usamos la tasa de hoy como último recurso
                        }
                    }

                    // Calculamos los Bs Reales usando esa tasa segura
                    let montoRealBs = montoReal * tasaVenta;

                    totalRef += montoReal;
                    totalBs += montoRealBs; 
                    count++;
                }
            });

            // ✅ Actualizar UI
            setStats({
                ...rawStats,
                total_usd: totalRef,
                total_ves: totalBs,
                sales_count: count
            });
            // ===========================================================================

            // 4. Créditos
            const creditsRes = await axios.get(`${API_URL}/reports/credit-pending`);
            const creditsData = Array.isArray(creditsRes.data) ? creditsRes.data : [];
            setPendingCredits(creditsData);
            setOverdueCount(creditsData.filter(c => c.is_overdue).length);
            
            const groupedRes = await axios.get(`${API_URL}/reports/credit-grouped`);
            setGroupedCredits(Array.isArray(groupedRes.data) ? groupedRes.data : []);

            // 5. Analíticas
            try {
                const analyticsRes = await axios.get(`${API_URL}/reports/analytics`);
                setTopDebtors(analyticsRes.data.topDebtors || []);
                setAnalyticsData(analyticsRes.data);
            } catch (e) { console.warn("Analytics error", e); }

            // Estado de Caja
            const cashRes = await axios.get(`${API_URL}/cash/current-status`);
            if (cashRes.data.status === 'ABIERTA') {
                setIsCashOpen(true);
                setCashShift(cashRes.data.shift_info);
            } else {
                setIsCashOpen(false);
                setCashShift(null);
            }

            setLoading(false);
        } catch (error) {
            console.error("Error fetching data:", error);
            if (!dailySalesList) setDailySalesList([]);
            setLoading(false);
        }
    };

    // --- LÓGICA CARRITO ---
    const addToCart = (product) => {
        const existing = cart.find((item) => item.id === product.id);
        const qty = existing ? existing.quantity : 0;

        if (qty + 1 > product.stock) {
            Swal.fire({
                icon: 'info',
                title: 'Ups, se nos agotó',
                text: `Lo sentimos, por el momento no disponemos de más unidades de ${product.name}.`,
                confirmButtonColor: '#0056B3',
                confirmButtonText: 'Entendido'
            });
            return;
        }
        setCart(prev => {
            // MODIFICADO: Asegurar que la información fiscal (is_taxable) se guarda en el carrito
            if (existing) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
            // Se incluye is_taxable en el item del carrito
            return [...prev, { ...product, quantity: 1, is_taxable: product.is_taxable }];
        });
    };

    const removeFromCart = (id) => {
        setCart(prev => {
            const existing = prev.find(i => i.id === id);
            if (existing.quantity > 1) return prev.map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i);
            return prev.filter(i => i.id !== id);
        });
    };
	
	// --- LÓGICA DE ESCÁNER DE CÓDIGO DE BARRAS (GLOBAL) ---
    useEffect(() => {
        let barcodeBuffer = '';
        let lastKeyTime = 0;
        const SCANNER_THRESHOLD = 50; // ms entre teclas (los escáneres son muy rápidos)

        const handleGlobalKeyDown = (e) => {
            // 1. Ignorar si el usuario está escribiendo en un input normal (Buscador, formulario, etc)
            // EXCEPCIÓN: Si el input es "readOnly" o el body, dejamos pasar el evento.
            const target = e.target;
            if (target.tagName === 'INPUT' && !target.readOnly && target.type !== 'checkbox' && target.type !== 'radio') {
                return; 
            }

            const currentTime = Date.now();
            
            // 2. Si pasó mucho tiempo desde la última tecla, reiniciamos el buffer (es tecleo manual lento)
            if (currentTime - lastKeyTime > SCANNER_THRESHOLD) {
                barcodeBuffer = '';
            }
            
            lastKeyTime = currentTime;

            // 3. Detectar "Enter" como final del código
            if (e.key === 'Enter') {
                if (barcodeBuffer.length > 2) { // Evitamos lecturas fantasmas de 1 o 2 caracteres
                    
                    // BUSCAR EL PRODUCTO POR CÓDIGO DE BARRAS
                    const scannedProduct = products.find(p => 
                        p.barcode === barcodeBuffer || 
                        p.barcode === barcodeBuffer.trim()
                    );

                    if (scannedProduct) {
                        // LÓGICA DE STOCK (UX: Feedback si no hay stock)
                        if (scannedProduct.stock > 0) {
                            addToCart(scannedProduct);
                            
                            // Feedback Visual Sutil (Toast rápido)
                            const Toast = Swal.mixin({
                                toast: true,
                                position: 'bottom-end',
                                showConfirmButton: false,
                                timer: 1500,
                                timerProgressBar: true
                            });
                            Toast.fire({
                                icon: 'success',
                                title: `+1 ${scannedProduct.name}`
                            });
                        } else {
                            // Sonido o alerta de error
                            Swal.fire({
                                icon: 'error',
                                title: 'Sin Stock',
                                text: `El producto "${scannedProduct.name}" está agotado.`,
                                timer: 2000,
                                showConfirmButton: false
                            });
                        }
                    } else {
                        // Opcional: Feedback si no existe el código
                        console.log(`Código no encontrado: ${barcodeBuffer}`);
                    }
                }
                barcodeBuffer = ''; // Limpiar buffer después del Enter
            } else {
                // 4. Acumular caracteres imprimibles (Números y Letras)
                if (e.key.length === 1) {
                    barcodeBuffer += e.key;
                }
            }
        };

        // Agregar el listener al documento global
        window.addEventListener('keydown', handleGlobalKeyDown);

        // Limpieza al desmontar
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
        };
    }, [products, addToCart]); // Dependencias vitales para que funcione con la data actual

    // --- CÁLCULOS PRINCIPALES (CON DESGLOSE FISCAL) ---
    const calculateTotals = () => {
        let subtotalTaxableUSD = 0; // Base Imponible (Gravado)
        let subtotalExemptUSD = 0;  // Subtotal Exento

        cart.forEach(item => {
            const itemTotalBase = parseFloat(item.price_usd) * item.quantity;
            if (item.is_taxable) {
                subtotalTaxableUSD += itemTotalBase;
            } else {
                subtotalExemptUSD += itemTotalBase;
            }
        });

        const ivaUSD = subtotalTaxableUSD * IVA_RATE;
        const finalTotalUSD = subtotalTaxableUSD + subtotalExemptUSD + ivaUSD;
        const totalVES = finalTotalUSD * bcvRate;

        return {
            subtotalTaxableUSD, // Base Imponible
            subtotalExemptUSD,  // Exento
            ivaUSD,
            finalTotalUSD,
            totalVES
        };
    };

    // Desestructuramos los nuevos totales
    const { subtotalTaxableUSD, subtotalExemptUSD, ivaUSD, finalTotalUSD, totalVES } = calculateTotals();

    // Lista de métodos de pago con su tipo de moneda
    const paymentMethods = [
        { name: 'Efectivo Ref', currency: 'Ref' },
        { name: 'Efectivo Bs', currency: 'Bs' },
        { name: 'Zelle', currency: 'Ref' },
        { name: 'Donación', currency: 'Ref' }, // <--- AGREGAR ESTO
        { name: 'Crédito', currency: 'Ref' },
        { name: 'Pago Móvil', currency: 'Bs' },
        { name: 'Punto de Venta', currency: 'Bs' },
    ];

    // MÉTODOS QUE REQUIEREN REFERENCIA
    const methodsRequiringReference = ['Pago Móvil', 'Punto de Venta', 'Zelle'];

    // --- LÓGICA DE PAGO INTELIGENTE (Cálculos de conversión) ---
    const updatePaymentShare = useCallback((method, value) => {
        setPaymentShares(prev => ({ ...prev, [method]: value }));
    }, []);

    const handleOpenPayment = () => {
        // --- 1. NUEVA VALIDACIÓN: IMPEDIR COBRO SI NO HAY CAJA ABIERTA ---
        if (!cashShift) {
            Swal.fire({
                icon: 'warning',
                title: '¡Caja Cerrada!',
                text: 'No es posible procesar pagos sin abrir caja.',
                confirmButtonText: '☀️ Abrir Caja Ahora',
                confirmButtonColor: '#E11D2B',
                showCancelButton: true,
                cancelButtonText: 'Cancelar'
            }).then((res) => {
                if (res.isConfirmed) promptOpenCash();
            });
            return; // DETIENE EL PROCESO
        }
        // ----------------------------------------------------------------

        if (cart.length === 0) return Swal.fire('Carrito Vacío', '', 'info');

        // El resto de tu lógica original sigue igual...
        setPaymentShares({});
        setPaymentReferences({});
        setCurrentReference('');
        setCustomerSearchResults([]);
        setCustomerData({ full_name: '', id_number: '', phone: '', institution: '' });
        setIsPaymentModalOpen(true);
    };

    const calculatePaymentTotals = () => {
        let paidUSD = 0;
        Object.entries(paymentShares).forEach(([method, amountStr]) => {
            const amount = parseFloat(amountStr) || 0;
            const methodData = paymentMethods.find(m => m.name === method);

            if (methodData && methodData.currency === 'Ref') {
                paidUSD += amount;
            } else {
                paidUSD += (amount / bcvRate);
            }
        });
        // 💡 REQUISITO LEGAL: Usamos el TOTAL FINAL (incluido IVA)
        const remainingUSD = finalTotalUSD - paidUSD;
        return { paidUSD, remainingUSD };
    };

    const { remainingUSD } = calculatePaymentTotals();
    const isInsufficient = remainingUSD > 0.05;
    const remainingVES = remainingUSD * bcvRate;

    const calculateRemainingAmount = (targetMethod) => {
        let paidByOthersUSD = 0;

        Object.entries(paymentShares).forEach(([method, amountStr]) => {
            if (method === targetMethod) return;
            const amount = parseFloat(amountStr) || 0;
            const methodData = paymentMethods.find(m => m.name === method);

            if (methodData && methodData.currency === 'Ref') {
                paidByOthersUSD += amount;
            } else {
                paidByOthersUSD += (amount / bcvRate);
            }
        });

        let remainingToCoverUSD = finalTotalUSD - paidByOthersUSD;
        if (remainingToCoverUSD < 0) remainingToCoverUSD = 0;

        const methodData = paymentMethods.find(m => m.name === targetMethod);
        if (methodData.currency === 'Ref') {
            return remainingToCoverUSD.toFixed(2);
        } else {
            return (remainingToCoverUSD * bcvRate).toFixed(2);
        }
    };

    const handlePayRemaining = () => {
        const remainingAmount = calculateRemainingAmount(currentMethod);
        const finalValue = parseFloat(remainingAmount);
        const reference = currentReference.trim();
        const needsReference = methodsRequiringReference.includes(currentMethod);

        if (needsReference && finalValue > 0 && !reference) {
            Swal.fire('Referencia Requerida', 'Por favor, ingrese la referencia para este pago.', 'warning');
            return;
        }

        updatePaymentShare(currentMethod, remainingAmount);
        setPaymentReferences(prev => ({ ...prev, [currentMethod]: reference }));

        setIsNumpadOpen(false);
        setCurrentInputValue('');
        setCurrentReference('');
    };

    const handleExactPayment = (method) => {
        const remainingAmount = calculateRemainingAmount(method);
        updatePaymentShare(method, remainingAmount);

        if (methodsRequiringReference.includes(method)) {
            setPaymentReferences(prev => ({ ...prev, [method]: 'REF-RAPIDA' }));
        }
    }

    // FUNCIÓN: Buscar cliente en el backend
    const searchCustomers = async (query) => {
        if (query.length < 3) {
            setCustomerSearchResults([]);
            return;
        }
        setIsSearchingCustomer(true);
        try {
            // Asegúrate que API_URL esté definido, si no usa 'http://localhost:3000/api'
            const res = await axios.get(`${API_URL}/customers/search?query=${query}`);
            setCustomerSearchResults(res.data);
        } catch (error) {
            console.error("Error searching customers:", error);
            setCustomerSearchResults([]);
        } finally {
            setIsSearchingCustomer(false);
        }
    };

    // 2. FUNCIÓN PARA SELECCIONAR CLIENTE (Esta es la nueva lógica UX)
    // Se ejecuta cuando el usuario hace click en un nombre de la lista desplegable
    const selectCustomer = (customer) => {
        // A. Llenamos los campos visibles del formulario automáticamente
        setCustomerData({
            full_name: customer.full_name,
            id_number: customer.id_number,
            phone: customer.phone || '',
            institution: customer.institution || ''
        });

        // B. GUARDAMOS EL ID (Esto es lo vital para que el Backend vincule el historial)
        setSelectedCustomerId(customer.id);

        // C. Limpiamos los resultados para cerrar la lista desplegable
        setCustomerSearchResults([]);
    };

    // --- GENERADOR DE HTML DE RECIBO (CORREGIDO: TASA HISTÓRICA + NOMBRE COMPLETO) ---
    // FUNCIÓN GENERADORA DE TICKET (DISEÑO UI MODERN/MINIMALISTA + BLINDAJE LEGAL)
    // Se agregó 'paymentMethod' al final para recibir el desglose de pagos
    const generateReceiptHTML = (saleId, customer, items, invoiceType = 'TICKET', saleStatus = 'PAGADO', createdAt = new Date(), totalSaleUsd = 0, historicalRate = null, paymentMethod = 'NO ESPECIFICADO') => {

        const rate = historicalRate ? parseFloat(historicalRate) : bcvRate;
        
        // --- LÓGICA DE SEGURIDAD (Sin cambios) ---
        const isVoided = saleStatus === 'ANULADO';

        let itemsToPrint = items;
        if (!items || items.length === 0) {
            itemsToPrint = [{
                name: 'SALDO INICIAL / DEUDA ANTIGUA',
                quantity: 1,
                price_usd: totalSaleUsd,
                is_taxable: false
            }];
        }

        let totalBsExento = 0;
        let totalBsBase = 0;
        let totalRefBase = 0;
        let totalUsdGravable = 0;
        let hasAdvanceGlobal = false;

        // --- CÁLCULOS MATEMÁTICOS (Sin cambios) ---
        const itemsHTML = itemsToPrint.map(item => {
            const priceUsd = parseFloat(item.price_at_moment_usd || item.price_usd || 0);
            const qty = parseFloat(item.quantity);
            const totalItemUsd = priceUsd * qty;
            const isTaxable = (item.is_taxable === true || item.is_taxable === 'true' || item.is_taxable === 1);

            let isAdvance = false;
            let capitalTotalUsd = 0;
            let commissionTotalUsd = 0;

            if (item.name && (item.name.toUpperCase().includes('AVANCE') || item.name.includes('[CAP:'))) {
                try {
                    const match = item.name.match(/\[CAP:\s*([\d\.,]+)\]/i);
                    if (match && match[1]) {
                        isAdvance = true;
                        hasAdvanceGlobal = true;
                        const unitCapital = parseFloat(match[1].replace(',', '.'));
                        capitalTotalUsd = unitCapital; 
                        commissionTotalUsd = totalItemUsd - capitalTotalUsd;
                        if (commissionTotalUsd < 0) isAdvance = false; 
                    }
                } catch (e) { isAdvance = false; }
            }

            // HTML MINIMALISTA PARA ITEMS (Sin bordes internos, solo alineación)
            if (isAdvance) {
                const commissionBs = commissionTotalUsd * rate;
                const capitalBs = capitalTotalUsd * rate;
                totalBsExento += capitalBs; 
                
                if (isTaxable) {
                    totalBsBase += commissionBs;
                    totalUsdGravable += commissionTotalUsd;
                } else {
                    totalBsExento += commissionBs;
                }
                totalRefBase += totalItemUsd;

                return `
                <div class="item-row">
                    <div class="col-qty">${qty}</div>
                    <div class="col-desc">SERV. FINANCIERO (COMISIÓN)${isTaxable ? '' : ' (E)'}</div>
                    <div class="col-price">${commissionBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                </div>
                <div class="item-row" style="color:#555;">
                    <div class="col-qty">-</div>
                    <div class="col-desc">ENTREGA DE EFECTIVO (E)</div>
                    <div class="col-price">${capitalBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                </div>`;
            } else {
                const subtotalItemBs = totalItemUsd * rate;
                totalRefBase += totalItemUsd;
                let exemptMark = '';
                
                if (isTaxable) {
                    totalBsBase += subtotalItemBs;
                    totalUsdGravable += totalItemUsd;
                } else {
                    totalBsExento += subtotalItemBs;
                    exemptMark = ' (E)';
                }

                const cleanName = item.name.replace(/\[CAP:.*?\]/i, '').trim();
                return `
                <div class="item-row">
                    <div class="col-qty">${qty}</div>
                    <div class="col-desc">${cleanName.substring(0, 30)}${exemptMark}</div>
                    <div class="col-price">${subtotalItemBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                </div>`;
            }
        }).join('');

        const ivaBs = totalBsBase * 0.16;
        const totalGeneralBs = totalBsExento + totalBsBase + ivaBs;
        const ivaUsd = totalUsdGravable * 0.16;
        const totalGeneralRef = totalRefBase + ivaUsd;

        const clientName = customer.full_name || 'CONSUMIDOR FINAL';
        const clientId = customer.id_number || 'V-00000000';
        const clientDir = customer.institution || '';

        const isFiscal = invoiceType === 'FISCAL';
        const isCredit = saleStatus === 'PENDIENTE' || saleStatus === 'PARCIAL';
        
        let docTitle = 'NOTA DE ENTREGA';
        if (isFiscal) docTitle = 'FACTURA (SENIAT)';
        if (isCredit && !isFiscal) docTitle = 'CONTROL DE CRÉDITO';
        if (isVoided) docTitle = 'DOCUMENTO ANULADO'; 

        const dateStr = new Date(createdAt).toLocaleString('es-VE');

        // --- PLANTILLA HTML/CSS MODERNA Y COMPACTA ---
        return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
            
            @page { size: 80mm auto; margin: 0; }
            
            body { 
                width: 72mm; 
                margin: 0 auto; 
                padding: 5px 0;
                font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
                font-size: 10px; 
                line-height: 1.2;
                color: #222; 
                background: #fff; 
                text-transform: uppercase;
            }

            /* Tipografía Numérica: Tabular nums hace que los números se alineen verticalmente perfecto */
            .nums { font-variant-numeric: tabular-nums; letter-spacing: -0.5px; }

            /* Utilidades de Alineación */
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .text-justify { text-align: justify; }
            .bold { font-weight: 700; }
            .black { font-weight: 900; }
            
            /* Separadores Minimalistas */
            .divider { border-bottom: 1px dotted #888; margin: 6px 0; width: 100%; }
            .divider-bold { border-bottom: 2px solid #000; margin: 8px 0; width: 100%; }

            /* Header Moderno */
            .header-title { font-size: 13px; margin-bottom: 2px; letter-spacing: 0.5px; }
            .header-meta { font-size: 9px; color: #444; }
            .doc-type { margin-top: 8px; font-size: 11px; background: #000; color: #fff; padding: 2px 0; border-radius: 4px; }

            /* Grid de Cliente Compacto */
            .client-grid { display: flex; flex-wrap: wrap; margin-top: 5px; gap: 2px; }
            .client-row { display: flex; width: 100%; justify-content: space-between; }
            .label { color: #666; font-size: 9px; margin-right: 4px; }
            .val { font-weight: 700; text-align: right; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

            /* Tabla de Productos Flex (Más control que table HTML) */
            .item-container { margin: 5px 0; }
            .item-header { display: flex; font-size: 8px; color: #666; border-bottom: 1px solid #ccc; padding-bottom: 2px; margin-bottom: 4px; }
            .item-row { display: flex; margin-bottom: 3px; align-items: flex-start; }
            
            /* Columnas Definidas */
            .col-qty { width: 10%; text-align: center; font-weight: 700; }
            .col-desc { width: 65%; padding-right: 5px; line-height: 1.1; }
            .col-price { width: 25%; text-align: right; font-weight: 500; }

            /* Totales Modernos */
            .totals-area { display: flex; flex-direction: column; align-items: flex-end; margin-top: 5px; }
            .total-row { display: flex; justify-content: space-between; width: 100%; margin-bottom: 2px; }
            .total-label { font-size: 9px; color: #444; }
            .total-val { font-size: 10px; font-weight: 700; }
            
            .final-total { font-size: 16px; margin-top: 4px; padding-top: 4px; border-top: 1px solid #000; width: 100%; display: flex; justify-content: space-between; align-items: center; }
            .ref-total { font-size: 11px; color: #444; margin-top: 2px; text-align: right; width: 100%; }

            /* Footer Legal Compacto */
            .legal-box { font-size: 8px; text-transform: none; color: #444; margin-top: 8px; line-height: 1.1; }
            .signature-line { margin-top: 30px; border-top: 1px solid #000; width: 60%; margin-left: auto; margin-right: auto; }
            
            /* Marca de Agua ANULADO */
            .watermark {
                position: fixed; top: 35%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg);
                font-size: 48px; color: rgba(200, 0, 0, 0.15); border: 4px solid rgba(200, 0, 0, 0.15);
                padding: 10px; z-index: 999; font-weight: 900; letter-spacing: 5px; pointer-events: none;
            }
        </style>
    </head>
    <body>
        ${isVoided ? '<div class="watermark">ANULADO</div>' : ''}

        <div class="text-center">
            ${isFiscal ? '<div class="bold" style="font-size:10px;">SENIAT</div>' : ''}
            <div class="header-title black">VOLUNTARIADO HIGEA C.A.</div>
            <div class="header-meta bold">RIF: J-30521322-4</div>
            <div class="header-meta" style="text-transform: none;">Av. Vargas, Carrera 31, Edif. Sede<br>Barquisimeto, Lara</div>
            <div class="doc-type bold text-center">${docTitle}</div>
        </div>

        <div class="client-grid">
            <div class="client-row">
                <span class="label">CLIENTE:</span>
                <span class="val">${clientName}</span>
            </div>
            <div class="client-row">
                <span class="label">DOC ID:</span>
                <span class="val nums">${clientId}</span>
            </div>
            ${clientDir ? `<div class="client-row"><span class="label">DIR:</span><span class="val" style="font-size:8px;">${clientDir.substring(0, 30)}</span></div>` : ''}
            
            <div class="divider"></div>
            
            <div class="client-row" style="font-size: 9px;">
                <span>FACT: <span class="bold nums">#${saleId.toString().padStart(6, '0')}</span></span>
                <span class="nums">${dateStr}</span>
            </div>
        </div>

        <div class="divider-bold"></div>

        <div class="item-container">
            <div class="item-header">
                <div class="col-qty">CANT</div>
                <div class="col-desc">DESCRIPCIÓN</div>
                <div class="col-price">TOTAL</div>
            </div>
            <div class="nums">
                ${itemsHTML}
            </div>
        </div>

        <div class="divider"></div>

        <div class="totals-area nums">
            ${(isFiscal || totalBsBase > 0) ? `
                <div class="total-row"><span class="total-label">Subtotal Exento:</span><span class="total-val">${totalBsExento.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span></div>
                <div class="total-row"><span class="total-label">Base Imponible:</span><span class="total-val">${totalBsBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span></div>
                <div class="total-row"><span class="total-label">IVA (16%):</span><span class="total-val">${ivaBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span></div>
                <div class="divider" style="border-style: solid; opacity: 0.5;"></div>
            ` : ''}

            <div class="final-total">
                <span class="black">TOTAL BS</span>
                <span class="black" style="font-size:18px;">${totalGeneralBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
            </div>
            <div class="ref-total bold">REF: $${totalGeneralRef.toFixed(2)}</div>
            <div class="ref-total" style="font-size:9px;">Tasa de Cambio BCV: Bs ${rate.toFixed(2)}</div>
        </div>

        <div style="margin-top: 8px; border-top: 1px dashed #888; padding-top: 4px;">
            <div class="bold" style="font-size: 9px;">MÉTODO DE PAGO:</div>
            <div style="font-size: 9px; word-break: break-all; white-space: normal; line-height: 1.1; margin-top: 2px;">
                ${paymentMethod}
            </div>
        </div>

        ${isCredit ? '<div class="text-center bold" style="margin-top:10px; padding:5px; border:1px solid #000; border-radius:4px;">VENTA A CRÉDITO - POR PAGAR</div>' : ''}

        <div class="legal-box text-justify">
            Recibí conforme mercancía y servicios. Precios en Bolívares según tasa oficial BCV vigente.
            ${hasAdvanceGlobal ? '<br/><br/><strong>* AVANCE EFECTIVO:</strong> Declaro recibir a mi satisfacción el monto en efectivo detallado como "ENTREGA DE EFECTIVO", operación no sujeta a venta.' : ''}
        </div>

        <div class="signature-line"></div>
        <div class="text-center" style="font-size: 8px; color:#666; margin-top:2px;">FIRMA Y CÉDULA CLIENTE</div>

        <div class="text-center" style="font-size:8px; margin-top:15px; color:#888;">
            COPIA DIGITAL / CONTROL INTERNO<br>
            ${isFiscal ? 'DOCUMENTO REFERENCIAL' : 'SIN VALIDEZ FISCAL'}
        </div>
    </body>
    </html>
    `;
    };

    // FUNCIÓN UNIFICADA DE PROCESAMIENTO (BLINDADA CONTRA ERRORES DE PAGO Y VISUALIZACIÓN)
    const processSale = async (isCreditFlow = false) => {
        
        // --- 1. DETECCIÓN ROBUSTA DEL TIPO DE VENTA ---
        const currentMethodName = (typeof paymentMethod !== 'undefined' && paymentMethod) ? paymentMethod.toUpperCase() : '';
        
        // DETECCIÓN DE DONACIÓN
        const isDonationTab = currentMethodName.includes('DONACI'); 
        const isDonationSplit = isCreditFlow && (parseFloat(paymentShares['Donación']) || 0) > 0;
        const isDonationSale = isDonationTab || isDonationSplit;

        // DETECCIÓN DE CRÉDITO
        const isCreditSale = isCreditFlow && (parseFloat(paymentShares['Crédito']) || 0) > 0;

        // --- VALIDACIÓN DE SEGURIDAD CRÍTICA: PAGOS INCOMPLETOS ---
        // Solo validamos si NO es crédito y NO es donación
        if (!isCreditSale && !isDonationSale) {
            let totalPaidCalculated = 0;
            
            Object.keys(paymentShares).forEach(key => {
                const amount = parseFloat(paymentShares[key]) || 0;
                if (amount > 0) {
                    const methodInfo = paymentMethods.find(m => m.name === key);
                    // Si es Ref (Dólares), sumamos directo. Si es Bs, convertimos a Dólares usando la tasa actual.
                    if (methodInfo?.currency === 'Ref') {
                        totalPaidCalculated += amount;
                    } else {
                        // Importante: Usamos la tasa del momento (bcvRate) para validar
                        totalPaidCalculated += (amount / bcvRate);
                    }
                }
            });

            // Usamos un margen de tolerancia de $0.10 para evitar bloqueos por redondeo
            if (Math.abs(totalPaidCalculated - finalTotalUSD) > 0.10) {
                 // Si pagó de MENOS, bloqueamos la venta
                if (totalPaidCalculated < finalTotalUSD) {
                    return Swal.fire({
                        icon: 'warning',
                        title: 'Pago Incompleto',
                        text: `El monto ingresado ($${totalPaidCalculated.toFixed(2)}) no cubre el total de la venta ($${finalTotalUSD.toFixed(2)}). Faltan $${(finalTotalUSD - totalPaidCalculated).toFixed(2)}.`,
                        confirmButtonText: 'Corregir Pagos',
                        confirmButtonColor: '#EF4444'
                    });
                }
            }
        }
        // --- FIN VALIDACIÓN DE SEGURIDAD ---


        // --- 2. VALIDACIONES DE DATOS (CON REDIRECCIÓN AL FORMULARIO) ---
        // CASO A: FACTURA FISCAL
        if (isFiscalInvoice) {
            if (!customerData.full_name || !customerData.id_number) {
                return Swal.fire({
                    icon: 'warning',
                    title: 'Datos Fiscales Requeridos',
                    text: 'Para emitir Factura Fiscal, Nombre y RIF son obligatorios.',
                    confirmButtonText: 'Ingresar Datos',
                    confirmButtonColor: '#0056B3',
                    showCancelButton: true,
                    cancelButtonText: 'Cancelar'
                }).then((result) => {
                    if (result.isConfirmed) {
                        setIsPaymentModalOpen(false);
                        setIsCustomerModalOpen(true);
                    }
                });
            }
        }

        // CASO B: CRÉDITO O DONACIÓN
        if ((isCreditSale || isDonationSale) && (!customerData.full_name || !customerData.id_number)) {
            const typeMsg = isDonationSale ? 'Beneficiario (Donación)' : 'Cliente (Crédito)';
            return Swal.fire({
                icon: 'warning',
                title: 'Datos Faltantes', 
                text: `Debe registrar Nombre y Cédula del ${typeMsg} para auditoría.`, 
                confirmButtonText: 'Registrar Datos',
                confirmButtonColor: isDonationSale ? '#F59E0B' : '#EF4444'
            }).then(() => {
                setIsPaymentModalOpen(false);
                setIsCustomerModalOpen(true);
            });
        }

        // --- 3. DEFINICIÓN DE ESTATUS ---
        let currentStatus = 'PAGADO'; 
        if (isCreditSale) currentStatus = 'PENDIENTE';
        if (isDonationSale) currentStatus = 'DONADO'; 

        // --- 4. DESCRIPCIÓN DEL PAGO ---
        let paymentDescription = '';
        
        if (isDonationSale) {
            paymentDescription = 'DONACIÓN (Salida de Inventario)';
        } else {
            const activeMethods = Object.keys(paymentShares).filter(k => (parseFloat(paymentShares[k]) || 0) > 0);
            
            if (activeMethods.length > 0) {
                paymentDescription = activeMethods.map(m => {
                    const amt = paymentShares[m];
                    const methodData = paymentMethods.find(pm => pm.name === m);
                    const symbol = methodData?.currency === 'Ref' ? 'Ref' : 'Bs'; 
                    return `${m}: ${symbol}${amt}`; 
                }).join(' + ');
            } else {
                const safeName = currentMethodName || 'PAGO DIRECTO';
                paymentDescription = `${safeName}: Ref ${finalTotalUSD.toFixed(2)}`;
            }
        }

        try {
            const saleData = {
                payment_method: paymentDescription,
                items: cart.map(i => ({
                    product_id: i.id,
                    name: i.name, 
                    quantity: i.quantity,
                    price_usd: i.price_usd,
                    is_taxable: i.is_taxable
                })),
                
                is_credit: isCreditSale,
                customer_data: (isCreditSale || isFiscalInvoice || isDonationSale) ? customerData : null,
                due_days: isCreditSale ? dueDays : null,
                invoice_type: isFiscalInvoice ? 'FISCAL' : 'TICKET',
                
                bcv_rate_snapshot: bcvRate, 
                total_usd: finalTotalUSD,   
                total_ves: totalVES,

                status: currentStatus 
            };

            Swal.fire({ title: `Procesando...`, didOpen: () => Swal.showLoading() });

            const res = await axios.post(`${API_URL}/sales`, saleData);
            const { saleId } = res.data;

            Swal.fire({
                icon: 'success',
                title: isDonationSale ? '¡Donación Exitosa!' : '¡Venta Procesada!',
                text: isDonationSale ? 'Inventario descontado. No suma a caja.' : `Ticket #${saleId} generado.`,
                confirmButtonColor: isDonationSale ? '#F59E0B' : '#0056B3'
            });

            // Visualización Previa (CORREGIDA PARA ENVIAR DETALLES DE PAGO)
            if (isFiscalInvoice) {
                // Aquí pasamos TODOS los parámetros requeridos, incluyendo paymentDescription al final
                const html = generateReceiptHTML(
                    saleId || '000', 
                    customerData, 
                    cart, 
                    'FISCAL', 
                    'PAGADO', 
                    new Date(), 
                    finalTotalUSD, 
                    bcvRate, 
                    paymentDescription // <--- ESTE ES EL DATO CLAVE QUE FALTABA
                );
                setReceiptPreview(html);
            }

            // Limpieza
            setCart([]);
            setIsCustomerModalOpen(false);
            setIsPaymentModalOpen(false);
            setCustomerData({ full_name: '', id_number: '', phone: '', institution: '' });
            setIsFiscalInvoice(false);
            
            fetchData(); 

        } catch (error) {
            console.error(error);
            const msg = error.response?.data?.message || error.message;
            Swal.fire('Error', `Fallo al guardar: ${msg}`, 'error');
        }
    };


    // Función de validación y apertura de modal de cliente para Crédito / Donación
    const handleCreditProcess = async () => {
        const creditAmount = parseFloat(paymentShares['Crédito']) || 0;
        const donationAmount = parseFloat(paymentShares['Donación']) || 0; // [NUEVO] - Capturamos Donación

        const creditUsed = creditAmount > 0;
        const donationUsed = donationAmount > 0; // [NUEVO]

        const isOverpaid = remainingUSD < -0.05; // Más de 5 centavos de cambio

        // VALIDACIÓN: Si falta dinero y no se cubre con lo declarado en Crédito ni en Donación
        if (remainingUSD > 0.05 && (!creditUsed || creditAmount < remainingUSD) && (!donationUsed || donationAmount < remainingUSD)) {
            return Swal.fire('Monto Insuficiente', `Faltan Ref ${remainingUSD.toFixed(2)} por cubrir.`, 'warning');
        }

        // 💡 MEJORA UX: Confirmación de Vuelto (Se mantiene intacta)
        if (isOverpaid) {
            const changeUSD = Math.abs(remainingUSD).toFixed(2);
            // 💡 UX: Mostrar el vuelto en Bolívares con más precisión.
            const changeVES = Math.abs(remainingVES).toLocaleString('es-VE', { maximumFractionDigits: 2 });

            const result = await Swal.fire({
                icon: 'question',
                title: '¡Vuelto/Cambio!',
                html: `<p>El monto pagado excede el total. Entregar de vuelto:</p><p class="text-3xl font-black text-green-600 mt-2">Ref ${changeUSD}</p><p class="text-lg font-bold text-gray-700">(Bs ${changeVES})</p>`,
                showCancelButton: true,
                confirmButtonText: 'Confirmar Venta y Entregar Vuelto',
                cancelButtonText: 'Revisar Pago',
                confirmButtonColor: '#10B981', // green
                cancelButtonColor: '#6B7280',
            });

            if (!result.isConfirmed) {
                return; // Detener el proceso si el usuario quiere revisar
            }
        }

        // [CAMBIO] Si es Crédito O Donación, abrimos el modal de Clientes/Beneficiarios
        if (creditUsed || donationUsed) {
            setIsCustomerModalOpen(true);
            setIsPaymentModalOpen(false);
        } else {
            processSale(false);
        }
    }

    // --- NUEVAS FUNCIONES PARA CRÉDITO AGRUPADO ---
    const openCustomerCredits = async (customer) => {
        try {
            Swal.fire({ title: 'Cargando...', didOpen: () => Swal.showLoading() });
            const res = await axios.get(`${API_URL}/credits/customer/${customer.customer_id}`);
            setCustomerCreditsDetails(res.data);
            setSelectedCreditCustomer(customer);
            Swal.close();
        } catch (error) {
            Swal.fire('Error', 'No se pudieron cargar los detalles', 'error');
        }
    };

    // --- MODAL DE ABONO PREMIUM (COMPACT VERSION) ---
const handlePaymentProcess = async (saleId, totalDebt, currentPaid) => {
    const remaining = totalDebt - currentPaid;
    const currentRate = typeof bcvRate !== 'undefined' ? bcvRate : 0; 

    // Métodos de Pago (Estilos)
    const paymentMethods = [
        { id: 'PAGO_MOVIL', label: 'Pago Móvil', icon: '📱', style: 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' },
        { id: 'PUNTO_VENTA', label: 'Punto Venta', icon: '💳', style: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100' },
        { id: 'EFECTIVO_USD', label: 'Efectivo $', icon: '💵', style: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' },
        { id: 'EFECTIVO_BS', label: 'Efectivo Bs', icon: '🇻🇪', style: 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100' },
        { id: 'ZELLE', label: 'Zelle', icon: '🇺🇸', style: 'bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100' },
        { id: 'TRANSFERENCIA', label: 'Transf.', icon: '🏦', style: 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100' },
    ];

    const { value: formValues } = await Swal.fire({
        // Header Compacto
        title: `<div class="flex items-center justify-between border-b border-slate-100 pb-2 mb-0">
                    <span class="text-sm font-black text-slate-700">Factura #${saleId}</span>
                    <span class="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md uppercase tracking-wider">Cobranza</span>
                </div>`,
        background: '#ffffff',
        width: 'auto', 
        padding: '1rem', // Padding general reducido
        buttonsStyling: false,
        customClass: {
            popup: 'rounded-2xl shadow-xl border border-slate-100 w-[95%] max-w-[380px]', // Ancho máximo reducido para parecer "App Móvil"
            confirmButton: 'w-full bg-slate-900 text-white font-bold rounded-lg py-2.5 text-sm shadow-md hover:shadow-lg hover:scale-[1.01] transition-all mb-2',
            cancelButton: 'w-full bg-white text-slate-400 font-bold rounded-lg py-1.5 text-xs hover:bg-slate-50 transition-all'
        },
        html: `
            <div class="text-left font-sans mt-0 space-y-3">
                
                <div class="flex justify-between items-center bg-slate-50 rounded-lg p-2 border border-slate-100 text-[10px]">
                    <div class="flex flex-col">
                        <span class="text-slate-400 font-bold uppercase">Total</span>
                        <span class="font-bold text-slate-600">$${totalDebt.toFixed(2)}</span>
                    </div>
                    <div class="w-px h-5 bg-slate-200 mx-2"></div>
                    <div class="flex flex-col">
                        <span class="text-emerald-500 font-bold uppercase">Abonado</span>
                        <span class="font-bold text-emerald-600">$${currentPaid.toFixed(2)}</span>
                    </div>
                    <div class="w-px h-5 bg-slate-200 mx-2"></div>
                    <div class="flex flex-col items-end">
                        <span class="text-rose-500 font-black uppercase">Por Pagar</span>
                        <span class="font-black text-rose-600 text-xs">$${remaining.toFixed(2)}</span>
                    </div>
                </div>

                <div class="relative">
                    <div class="flex justify-between items-center mb-1">
                        <label class="text-[10px] font-bold text-slate-400 uppercase">Monto a abonar</label>
                        <div id="conversion-helper" class="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                            🇻🇪 Bs ${(remaining * currentRate).toLocaleString('es-VE', {minimumFractionDigits: 2})}
                        </div>
                    </div>
                    
                    <div class="relative group">
                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 font-bold text-lg">$</span>
                        <input id="swal-amount" type="number" step="0.01" 
                            class="w-full pl-7 pr-12 py-2 bg-white border border-slate-200 rounded-xl font-black text-slate-700 text-xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:text-slate-200 shadow-sm" 
                            value="${remaining.toFixed(2)}" placeholder="0.00">
                        
                        <button type="button" id="btn-max" class="absolute right-2 top-1/2 -translate-y-1/2 bg-slate-100 text-[9px] font-bold text-slate-500 px-2 py-1 rounded hover:bg-slate-800 hover:text-white transition-colors uppercase border border-slate-200">
                            Max
                        </button>
                    </div>
                </div>

                <div>
                    <label class="block text-[9px] font-bold text-slate-400 uppercase mb-1.5">Método de Pago</label>
                    <div class="grid grid-cols-3 gap-2">
                        ${paymentMethods.map(m => `
                            <button type="button" class="method-card flex flex-col items-center justify-center py-2 rounded-lg border transition-all duration-200 active:scale-95 group ${m.style}" 
                                data-value="${m.id}"
                                data-active-class="ring-2 ring-offset-1 ring-indigo-500 border-transparent shadow-sm">
                                <span class="text-base filter drop-shadow-sm mb-0.5 group-hover:scale-110 transition-transform">${m.icon}</span>
                                <span class="text-[8px] font-bold uppercase tracking-tight leading-none">${m.label}</span>
                            </button>
                        `).join('')}
                    </div>
                    <input type="hidden" id="swal-method" value="PAGO_MOVIL">
                </div>

                <div class="flex gap-2">
                    <input id="swal-ref" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-600 text-[11px] focus:outline-none focus:border-indigo-400 focus:bg-white transition-all placeholder:text-slate-300" placeholder="📝 Referencia (Opcional)...">
                    
                    <label class="flex items-center justify-center w-10 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all group" title="Activar Factura Fiscal">
                        <input type="checkbox" id="swal-is-fiscal" class="peer sr-only">
                        <span class="text-slate-300 peer-checked:text-blue-600 text-base transition-colors group-hover:text-blue-400">🖨️</span>
                    </label>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Confirmar Pago',
        cancelButtonText: 'Cancelar',
        reverseButtons: true,
        
        // --- LÓGICA JAVASCRIPT INTACTA ---
        didOpen: () => {
            const popup = Swal.getPopup();
            const inputAmount = popup.querySelector('#swal-amount');
            const helper = popup.querySelector('#conversion-helper');
            const methodInput = popup.querySelector('#swal-method');
            const cards = popup.querySelectorAll('.method-card');
            const btnMax = popup.querySelector('#btn-max');

            // Actualizar Bs en vivo
            const updateBs = (val) => {
                const bsVal = (parseFloat(val) || 0) * currentRate;
                helper.innerHTML = `🇻🇪 Bs ${bsVal.toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            };

            // Listeners
            inputAmount.addEventListener('input', (e) => updateBs(e.target.value));

            btnMax.addEventListener('click', () => {
                inputAmount.value = remaining.toFixed(2);
                updateBs(remaining);
                inputAmount.focus();
                // Feedback visual sutil
                inputAmount.classList.add('ring-2', 'ring-indigo-500/20');
                setTimeout(() => inputAmount.classList.remove('ring-2', 'ring-indigo-500/20'), 300);
            });

            // Lógica de Selección de Tarjetas
            const selectMethod = (card) => {
                // Resetear estilos visuales
                cards.forEach(c => {
                    // Restaurar clases originales (quitando las de activo)
                    c.className = `method-card flex flex-col items-center justify-center py-2 rounded-lg border transition-all duration-200 active:scale-95 group ${paymentMethods.find(m => m.id === c.dataset.value).style}`;
                    c.querySelector('span:first-child').classList.add('grayscale');
                    c.querySelector('span:first-child').classList.remove('scale-110');
                });
                
                // Aplicar estilo activo
                const activeClasses = card.getAttribute('data-active-class');
                // Al activar, quitamos grayscale y añadimos el anillo de foco
                card.className = `method-card flex flex-col items-center justify-center py-2 rounded-lg border transition-all duration-200 active:scale-95 group ${paymentMethods.find(m => m.id === card.dataset.value).style} ${activeClasses}`;
                card.querySelector('span:first-child').classList.remove('grayscale');
                card.querySelector('span:first-child').classList.add('scale-110');
                
                methodInput.value = card.getAttribute('data-value');
            };

            // Inicializar eventos click
            cards.forEach(card => {
                card.addEventListener('click', () => selectMethod(card));
                // Estado inicial
                if(card.querySelector('span:first-child')) card.querySelector('span:first-child').classList.add('grayscale');
                // Preseleccionar primero
                if(card.getAttribute('data-value') === 'PAGO_MOVIL') selectMethod(card);
            });
        },

        preConfirm: () => {
            const amount = document.getElementById('swal-amount').value;
            const method = document.getElementById('swal-method').value;
            const ref = document.getElementById('swal-ref').value;
            const isFiscal = document.getElementById('swal-is-fiscal').checked;

            if (!amount || parseFloat(amount) <= 0) return Swal.showValidationMessage('Ingrese un monto válido');
            if (parseFloat(amount) > remaining + 0.05) return Swal.showValidationMessage('El monto excede la deuda');

            // Asegúrate de que selectedCreditCustomer exista en el contexto superior
            if (isFiscal && (typeof selectedCreditCustomer === 'undefined' || !selectedCreditCustomer || !selectedCreditCustomer.id_number)) {
                return Swal.showValidationMessage('El cliente requiere Cédula/RIF para fiscal');
            }

            return { amount, method, ref, isFiscal };
        }
    });

    // --- PROCESAMIENTO (INTACTO) ---
    if (formValues) {
        try {
            Swal.fire({ title: '', html: 'Procesando pago...', timerProgressBar: true, didOpen: () => Swal.showLoading() });
            
            const paymentDetails = `${formValues.method}${formValues.ref ? ` [Ref: ${formValues.ref}]` : ''}`;

            await axios.post(`${API_URL}/sales/${saleId}/pay-credit`, {
                paymentDetails,
                amountUSD: formValues.amount,
                invoice_type: formValues.isFiscal ? 'FISCAL' : 'TICKET'
            });

            await Swal.fire({
                icon: 'success',
                title: '¡Abono Registrado!',
                html: `<span class="text-slate-600">Se han abonado <b class="text-emerald-600">$${formValues.amount}</b> correctamente.</span>`,
                confirmButtonColor: '#10B981',
                timer: 2000
            });

            if (formValues.isFiscal) console.log("Imprimiendo Fiscal...");

            // Asegúrate de tener acceso a setCustomerCreditsDetails y fetchData
            if (typeof selectedCreditCustomer !== 'undefined') {
                const res = await axios.get(`${API_URL}/credits/customer/${selectedCreditCustomer.customer_id}`);
                if (typeof setCustomerCreditsDetails === 'function') setCustomerCreditsDetails(res.data);
                if (typeof fetchData === 'function') fetchData();
            }
        } catch (error) {
            Swal.fire('Error', error.response?.data?.error || 'Error en el proceso', 'error');
        }
    }
};

    // --- Funciones de Reporte de Crédito ---
    const markAsPaid = async (saleId) => {
        let paymentMethod = '';
        let paymentReference = '';

        const { value: formValues } = await Swal.fire({
            title: 'Saldar Cuenta',
            html:
                '<h4 class="text-lg font-bold text-gray-700 mb-4">Confirmar Método de Pago</h4>' +
                '<select id="swal-payment-method" class="swal2-input">' +
                '<option value="EFECTIVO_USD">Efectivo Ref</option>' +
                '<option value="ZELLE">Zelle</option>' +
                '<option value="PAGO_MOVIL">Pago Móvil (Bs)</option>' +
                '<option value="PUNTO_VENTA">Punto de Venta (Bs)</option>' +
                '<option value="TRANSFERENCIA">Transferencia (Bs)</option>' +
                '</select>' +
                '<input id="swal-payment-ref" class="swal2-input" placeholder="Referencia / Últimos 4 dígitos">',
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Saldar Cuenta Completo',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0056B3',
            preConfirm: () => {
                paymentMethod = document.getElementById('swal-payment-method').value;
                paymentReference = document.getElementById('swal-payment-ref').value;

                if (!paymentMethod) {
                    Swal.showValidationMessage('Debe seleccionar un método de pago.');
                    return false;
                }
                if (paymentMethod !== 'EFECTIVO_USD' && !paymentReference.trim()) {
                    Swal.showValidationMessage('La referencia es obligatoria para este pago.');
                    return false;
                }
                return { paymentMethod, paymentReference };
            }
        });

        if (formValues) {
            try {
                const paymentDetails = `${formValues.paymentMethod}${formValues.paymentReference ? ` [Ref: ${formValues.paymentReference}]` : ''}`;

                await axios.post(`${API_URL}/sales/${saleId}/pay-credit`, { paymentDetails });

                Swal.fire('¡Saldado!', 'El crédito ha sido marcado como PAGADO. Método registrado.', 'success');
                fetchData();
            } catch (error) {
                Swal.fire('Error', 'No se pudo saldar el crédito.', 'error');
            }
        }
    }

    const showSaleDetail = async (sale) => {
        try {
            // --- [INICIO CORRECCIÓN] ---
            // 1. Detectamos el ID correctamente, sin importar si viene de la búsqueda o de la lista normal
            const saleId = sale.id || sale["Nro Factura"] || sale.sale_id;

            // 2. Si no hay ID, detenemos todo para evitar el Error 500
            if (!saleId) {
                console.error("Objeto venta recibido sin ID:", sale);
                return Swal.fire('Error', 'No se pudo identificar el ID de la venta.', 'error');
            }
            // --- [FIN CORRECCIÓN] ---

            Swal.fire({ title: 'Cargando detalle...', didOpen: () => Swal.showLoading() });

            // 3. Usamos 'saleId' en lugar de 'sale.id' en la URL
            const res = await axios.get(`${API_URL}/sales/${saleId}`);

            // Validación de seguridad para datos nulos (TU CÓDIGO ORIGINAL)
            const safeParse = (val) => {
                const num = parseFloat(val);
                return isNaN(num) ? 0 : num;
            };

            setSelectedSaleDetail({
                id: saleId, // <--- 4. Usamos la variable corregida aquí también
                items: res.data.items || [],
                // Si viene de la lista, usa ese dato, si no intenta buscarlo en la respuesta o pone texto genérico
                payment_method: sale.payment_method || res.data.payment_method || 'Desconocido',
                total_usd: safeParse(res.data.total_usd),
                total_ves: safeParse(res.data.total_ves),
                status: sale.status || res.data.status || 'PAGADO',
                full_name: sale.full_name || res.data.full_name || 'Cliente Casual',
                id_number: sale.id_number || res.data.id_number || '',
                due_date: sale.due_date || res.data.due_date || null,
                bcv_rate_snapshot: safeParse(res.data.bcv_rate_snapshot),

                // AGREGADO POR PRECAUCIÓN: Para que el recibo sepa si es Fiscal o Ticket
                invoice_type: sale.invoice_type || res.data.invoice_type || 'TICKET',

                // PROTECCIÓN CONTRA CRASH: Usamos '|| 0' para evitar error en ventas viejas
                taxBreakdown: {
                    subtotalTaxableUSD: safeParse(res.data.subtotal_taxable_usd || 0),
                    subtotalExemptUSD: safeParse(res.data.subtotal_exempt_usd || 0),
                    ivaUSD: safeParse(res.data.iva_usd || 0),
                    ivaRate: safeParse(res.data.iva_rate || 0.16),
                }
            });

            Swal.close(); // Cerrar el loading
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudieron cargar los detalles de la venta.', 'error');
        }
    };

    // Componente Reutilizable para la entrada de Pago (UX Táctil)
    const PaymentInput = ({ name, currency, value }) => {
        const isSelected = currentMethod === name && isNumpadOpen;
        const displayValue = parseFloat(value) > 0 ? value : '0.00';
        const currencySymbol = currency === 'Ref' ? 'Ref ' : 'Bs ';

        // Detectar si tiene valor
        const hasValue = parseFloat(value) > 0;

        const openNumpad = () => {
            setCurrentMethod(name);
            setCurrentInputValue(parseFloat(value) > 0 ? value.toString() : '');
            setCurrentReference(paymentReferences[name] || '');
            setIsNumpadOpen(true);
        };

        const isCreditActive = name === 'Crédito' && hasValue;

        return (
            <div
                onClick={openNumpad}
                // CAMBIO 1: Borde azul institucional suave cuando tiene valor
                className={`flex justify-between items-center p-4 rounded-xl shadow-md cursor-pointer transition-all ${isCreditActive ? 'bg-red-50 border-higea-red border-2' :
                    (isSelected ? 'bg-blue-100 border-higea-blue border-2' :
                        (hasValue ? 'bg-white border-higea-blue border-2 shadow-blue-100' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'))
                    }`}
            >
                {/* CAMBIO 2: Texto del nombre en Azul Institucional si tiene valor */}
                <span className={`font-bold ${hasValue ? 'text-higea-blue' : 'text-gray-600'}`}>{name} ({currency})</span>

                {/* CAMBIO 3: Monto GIGANTE en Azul Institucional (higea-blue) */}
                <span className={`font-black text-2xl transition-colors ${isCreditActive ? 'text-higea-red' :
                    (hasValue ? 'text-higea-blue scale-110' : 'text-gray-300')
                    }`}>
                    {currencySymbol}{displayValue}
                </span>
            </div>
        );
    };

    // Teclado Numérico Custom para Móviles/Táctil
    const NumpadModal = () => {
        const methodData = paymentMethods.find(m => m.name === currentMethod);
        const currencySymbol = methodData.currency === 'Ref' ? 'Ref' : 'Bs';
        const needsReference = methodsRequiringReference.includes(currentMethod);

        const { remainingUSD: totalRemainingUSD } = calculatePaymentTotals();
        const totalRemainingVES = totalRemainingUSD * bcvRate;

        const handleNumpadClick = (key) => {
            if (key === 'C') {
                setCurrentInputValue('');
                return;
            }
            if (key === 'DEL') {
                setCurrentInputValue(prev => prev.slice(0, -1));
                return;
            }
            if (key === '.') {
                if (currentInputValue.includes('.')) return;
                setCurrentInputValue(prev => prev + '.');
                return;
            }

            let newValue = currentInputValue + key;
            if (newValue.includes('.')) {
                const parts = newValue.split('.');
                if (parts[1].length > 2) return;
            }
            if (newValue.length > 1 && newValue.startsWith('0') && !newValue.includes('.')) {
                newValue = newValue.substring(1);
            }

            setCurrentInputValue(newValue);
        };

        const handleConfirm = () => {
            const finalValue = parseFloat(currentInputValue).toFixed(2) || '';

            if (needsReference && finalValue > 0 && !currentReference.trim()) {
                return Swal.fire('Referencia Requerida', 'Por favor, ingrese la referencia bancaria.', 'warning');
            }

            updatePaymentShare(currentMethod, finalValue);
            setPaymentReferences(prev => ({ ...prev, [currentMethod]: currentReference.trim() }));

            setIsNumpadOpen(false);
            setCurrentInputValue('');
            setCurrentReference('');
        };

        const numpadKeys = [
            '7', '8', '9',
            '4', '5', '6',
            '1', '2', '3',
            'C', '0', '.',
        ];

        return (
            <div className="fixed inset-0 z-[70] bg-black/70 flex items-end justify-center p-0 md:items-center md:p-8">
                <div className="bg-white rounded-t-3xl md:rounded-3xl w-full max-w-sm shadow-2xl animate-slide-up-numpad">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-3xl md:rounded-t-3xl">
                        <h4 className="font-bold text-lg text-gray-800">{currentMethod}</h4>
                        <button onClick={() => setIsNumpadOpen(false)} className="text-gray-500 hover:text-red-500 font-bold">✕</button>
                    </div>

                    {/* DISPLAY DE MONTO PRINCIPAL Y SALDO FALTANTE (UX) */}
                    <div className="p-4 text-center">
                        <p className="text-sm text-gray-500">Monto a Pagar ({currencySymbol})</p>
                        <h2 className="text-4xl font-black text-higea-blue mt-1">
                            {currencySymbol} {currentInputValue || '0.00'}
                        </h2>

                        {/* INDICADOR DE SALDO FALTANTE (UX) */}
                        {totalRemainingUSD > 0.05 && (
                            <div className="mt-2 text-xs font-medium text-gray-500">
                                Falta cubrir:
                                <span className="font-bold text-higea-red ml-1">Ref {totalRemainingUSD.toFixed(2)}</span>
                                <span className="ml-2">({totalRemainingVES.toLocaleString('es-VE', { maximumFractionDigits: 0 })} Bs)</span>
                            </div>
                        )}
                    </div>

                    {/* CAMPO DE REFERENCIA BANCARIA (Condicional y con UX de Teclado del Sistema) */}
                    {needsReference && (
                        <div className="px-4 pb-4">
                            <label className="text-xs font-bold text-gray-500 block mb-1">Referencia Bancaria / Lote {currentMethod.includes('Zelle') ? '(Opcional si es monto < $5)' : '*'}</label>
                            <input
                                type="text"
                                value={currentReference}
                                onChange={(e) => setCurrentReference(e.target.value.toUpperCase())}
                                placeholder="Ej: A1234, 1234567"
                                className="w-full border-2 border-gray-200 focus:border-higea-blue rounded-xl p-3 text-lg font-bold text-gray-800 transition-colors"
                                // ✨ MEJORA UX: autoFocus para mejor interacción táctil/desktop
                                autoFocus={true}
                            />
                        </div>
                    )}

                    {/* NUMPAD GRID */}
                    <div className="grid grid-cols-3 gap-2 p-4 pt-0">
                        {numpadKeys.map(key => (
                            <button
                                key={key}
                                onClick={() => handleNumpadClick(key)}
                                onMouseDown={(e) => e.preventDefault()} // FIX CRUCIAL: Previene el robo de foco
                                className={`p-4 rounded-xl text-2xl font-bold transition-colors ${key === 'C' ? 'bg-red-100 text-red-600' : 'bg-gray-100 hover:bg-gray-200'}`}
                            >
                                {key}
                            </button>
                        ))}
                        <button
                            onClick={handleNumpadClick.bind(null, 'DEL')}
                            onMouseDown={(e) => e.preventDefault()} // FIX CRUCIAL: Previene el robo de foco
                            className="col-span-1 p-4 rounded-xl text-2xl font-bold bg-gray-100 hover:bg-gray-200"
                        >
                            ⌫
                        </button>
                    </div>

                    {/* ACCIONES RÁPIDAS */}
                    <div className="p-4 pt-0 flex flex-col gap-2">
                        <button
                            onClick={handlePayRemaining}
                            onMouseDown={(e) => e.preventDefault()} // FIX CRUCIAL: Previene el robo de foco
                            className="w-full bg-yellow-500 text-white font-bold py-3 rounded-xl hover:bg-yellow-600"
                        >
                            PAGAR SALDO ({currencySymbol})
                        </button>
                        <button
                            onClick={handleConfirm}
                            onMouseDown={(e) => e.preventDefault()} // FIX CRUCIAL: Previene el robo de foco
                            className="w-full bg-higea-blue text-white font-bold py-3 rounded-xl hover:bg-blue-700"
                        >
                            CONFIRMAR MONTO
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // =========================================================================
    // LÓGICA DEL MODAL DE CLIENTES (INTEGRADA EN APP PARA CORREGIR FOCO)
    // =========================================================================

    // Detectamos si estamos aquí por crédito o solo por factura fiscal
    const isCreditUsed = (parseFloat(paymentShares['Crédito']) || 0) > 0;
	const isDonationUsed = (parseFloat(paymentShares['Donación']) || 0) > 0; // [NUEVO]

    // Usamos el debounce para no saturar el servidor mientras escribes
    const debouncedSearch = useCallback(
        debounce((query) => searchCustomers(query), 300),
        []
    );

    // --- FUNCIÓN: LIMPIAR FORMULARIO (UX MEJORADO) ---
    const handleClear = () => {
        setCustomerData({
            full_name: '',
            id_number: '',
            phone: '',
            institution: ''
        });
        setSelectedCustomerId(null);
        setCustomerSearchResults([]);
    };

    // 1. MANEJO DEL INPUT DE NOMBRE (AQUÍ ESTÁ LA BÚSQUEDA NUEVA UX)
    const handleNameChange = (e) => {
        const value = capitalizeWords(e.target.value);

        // Actualizamos el dato visual
        setCustomerData(prev => ({ ...prev, full_name: value }));

        // Disparamos la búsqueda si hay más de 2 letras
        if (value.length > 2) {
            debouncedSearch(value);
        } else {
            setCustomerSearchResults([]);
        }

        // IMPORTANTE: Si el usuario escribe manualmente, reseteamos el ID seleccionado
        // para que el backend sepa que podría ser un cliente nuevo o modificado.
        setSelectedCustomerId(null);
    };

    // 2. MANEJO DEL INPUT DE CÉDULA (Solo validación)
    const handleIdChange = (e) => {
        const value = validateIdNumber(e.target.value);
        setCustomerData(prev => ({ ...prev, id_number: value }));
    };

    // 3. AL SELECCIONAR DE LA LISTA DESPLEGABLE
    const handleListSelect = (customer) => {
        // Llamamos a la función PRINCIPAL 'selectCustomer' que definimos arriba en App
        selectCustomer(customer);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        let newValue = value;
        if (name === 'phone') newValue = validatePhone(value);
        if (name === 'institution') newValue = capitalizeWords(value);
        setCustomerData(prev => ({ ...prev, [name]: newValue }));
    };

    // --- LOGICA DEL BOTÓN PRINCIPAL ---
    const handleConfirm = () => {
        if (isCreditUsed || isDonationUsed) {
            // Si es crédito, procesamos la venta completa como PENDIENTE
            processSale(true);
        } else {
            // Si es solo FISCAL CONTADO, guardamos datos y volvemos al pago
            setIsCustomerModalOpen(false);
            setIsPaymentModalOpen(true);
            Swal.fire({
                icon: 'success',
                title: 'Datos Fiscales Asignados',
                text: 'Ahora puede procesar el pago.',
                timer: 1500,
                showConfirmButton: false
            });
        }
    };
	
	// --- NUEVA FUNCIÓN: MANEJAR IMPRESIÓN DESDE HISTORIAL (REPARADA) ---
    const handlePrintTicket = (sale) => {
        // 1. Recuperar datos del cliente para el recibo
        const tempCustomer = {
            full_name: sale.full_name || 'Consumidor Final',
            id_number: sale.id_number || 'V-00000000',
            institution: sale.institution || '',
            phone: sale.phone || ''
        };

        // 2. RECUPERACIÓN INTELIGENTE DE ETIQUETA [CAP:...]
        // Problema: A veces la BD guarda el nombre genérico "AVANCE DE EFECTIVO" y pierde el [CAP].
        // Solución: Buscamos la etiqueta en el 'payment_method' (donde sí se guarda seguro) y se la inyectamos.
        let capTag = '';
        if (sale.payment_method && sale.payment_method.includes('[CAP:')) {
            try {
                const match = sale.payment_method.match(/\[CAP:([\d\.,]+)\]/);
                if (match) capTag = match[0]; // Ej: "[CAP:20.00]"
            } catch (e) { console.error(e); }
        }

        // Preparamos los items asegurando que el Avance tenga su etiqueta
        const itemsPrepared = sale.items.map(i => {
            let finalName = i.name;
            // Si es un avance, no tiene etiqueta en el nombre, pero sí la encontramos en el pago:
            if (capTag && (finalName.toUpperCase().includes('AVANCE') || finalName.toUpperCase().includes('ADV')) && !finalName.includes('[CAP:')) {
                finalName = `${finalName} ${capTag}`; // ¡Aquí ocurre la magia!
            }
            return { ...i, name: finalName };
        });

        // 3. Generar HTML usando la función maestra
        const html = generateReceiptHTML(
            sale.id,
            tempCustomer,
            itemsPrepared,
            sale.invoice_type, // 'TICKET' o 'FISCAL'
            sale.status,
            sale.created_at,
            parseFloat(sale.total_usd),
            parseFloat(sale.bcv_rate_snapshot) // <--- IMPORTANTE: Pasamos la tasa histórica
        );

        // 4. Mostrar en el visor
        setReceiptPreview(html);
    };

    const isFormReadyToSubmit = customerData.full_name.trim() && customerData.id_number.trim();

    // --- FUNCIÓN DE RENDERIZADO VISUAL ---
    const renderCustomerModal = () => {
        // [AJUSTE ROBUSTO] Detectar si es Donación (Igual que en processSale)
        const currentMethodName = (typeof paymentMethod !== 'undefined' && paymentMethod) ? paymentMethod.toUpperCase() : '';
        const isDonationTab = currentMethodName.includes('DONACI');
        const isDonationSplit = (parseFloat(paymentShares['Donación']) || 0) > 0;
        
        const isDonationUsed = isDonationTab || isDonationSplit;
        const isCreditUsed = (parseFloat(paymentShares['Crédito']) || 0) > 0;

        return (
            <div className="fixed inset-0 z-[65] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-scale-up">
                    
                    {/* HEADER DIFERENCIADO POR COLOR: Donación (Amarillo) / Crédito (Rojo) / Fiscal (Azul) */}
                    <div className={`p-5 text-white text-center relative ${
                        isDonationUsed ? 'bg-yellow-500' : (isCreditUsed ? 'bg-higea-red' : 'bg-higea-blue')
                    }`}>

                        {/* --- BOTÓN NUEVO: LIMPIAR TODO (Esquina superior derecha) --- */}
                        <button
                            onClick={handleClear}
                            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-all text-white shadow-sm"
                            title="Limpiar Formulario"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                        {/* ----------------------------------------------------------- */}

                        <h3 className="text-xl font-bold">
                            {isDonationUsed 
                                ? 'Registro de Donación' 
                                : (isCreditUsed ? 'Registro de Crédito' : 'Datos para Factura Fiscal')}
                        </h3>
                        <p className="text-sm mt-1 opacity-90">
                            {isDonationUsed 
                                ? 'Ingrese los datos del BENEFICIARIO de la donación' 
                                : (isCreditUsed ? 'Esta venta quedará PENDIENTE de pago' : 'Ingrese los datos del cliente para la factura')}
                        </p>
                    </div>

                    <div className="p-5 space-y-4">
                        {/* Solo mostrar selector de días si es CRÉDITO (Oculto en Donación) */}
                        {isCreditUsed && !isDonationUsed && (
                            <div className="flex justify-between items-center bg-yellow-50 p-3 rounded-xl border border-yellow-200">
                                <span className="font-bold text-yellow-800 text-sm">Plazo de Pago</span>
                                <div className="flex gap-2">
                                    <button onClick={() => setDueDays(15)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 15 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>15 Días</button>
                                    <button onClick={() => setDueDays(30)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 30 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>30 Días</button>
                                </div>
                            </div>
                        )}

                        {/* INPUT NOMBRE (AHORA CON LA LÓGICA DE BÚSQUEDA AQUÍ) */}
                        <div className="relative">
                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">
                                {isDonationUsed ? 'Nombre del Beneficiario (*)' : 'Razón Social / Nombre (*)'}
                            </label>
                            
                            <input
                                type="text"
                                name="full_name"
                                placeholder={isDonationUsed ? "Buscar beneficiario..." : "Escribe para buscar cliente..."}
                                onChange={handleNameChange}
                                value={customerData.full_name}
                                className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none font-bold text-gray-800"
                                autoFocus={true}
                            />

                            {/* Spinner de carga dentro del input */}
                            {isSearchingCustomer && <div className="absolute right-3 top-9 w-4 h-4 border-2 border-higea-blue border-t-transparent rounded-full animate-spin"></div>}

                            {/* DROPDOWN DE RESULTADOS (MOVIDO AQUÍ) */}
                            {customerSearchResults.length > 0 && (
                                <div className="absolute top-full left-0 w-full bg-white border border-gray-200 rounded-xl mt-1 shadow-xl z-50 max-h-48 overflow-y-auto">
                                    {customerSearchResults.map(customer => (
                                        <div
                                            key={customer.id}
                                            onClick={() => handleListSelect(customer)}
                                            className="p-3 border-b border-gray-50 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors"
                                        >
                                            <div className="flex flex-col">
                                                <span className="font-bold text-gray-800 text-sm">{customer.full_name}</span>
                                                <span className="text-xs text-gray-400">{customer.institution || 'Sin dirección'}</span>
                                            </div>
                                            <span className="text-xs font-mono font-bold text-higea-blue bg-blue-50 px-2 py-1 rounded border border-blue-100">
                                                {customer.id_number}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* INPUT CÉDULA (SIMPLE) */}
                        <div>
                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">
                                {isDonationUsed ? 'Cédula del Beneficiario (*)' : 'Cédula / RIF (*)'}
                            </label>
                            <input
                                type="text"
                                name="id_number"
                                placeholder="V-12345678"
                                onChange={handleIdChange}
                                value={customerData.id_number}
                                className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none font-mono text-gray-700 font-medium"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <input type="tel" name="phone" placeholder="Teléfono" onChange={handleChange} value={customerData.phone} className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" />
                            <input type="text" name="institution" placeholder="Dirección Fiscal" onChange={handleChange} value={customerData.institution} className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" />
                        </div>
                    </div>

                    <div className="p-5 flex gap-3 bg-white border-t border-gray-50">
                        <button onClick={() => { setIsCustomerModalOpen(false); setIsPaymentModalOpen(true); }} className="flex-1 py-3 text-gray-500 font-bold text-sm hover:bg-gray-50 rounded-xl transition-colors">Volver</button>
                        
                        <button
                            onClick={handleConfirm}
                            disabled={!isFormReadyToSubmit}
                            className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 ${
                                !isFormReadyToSubmit 
                                    ? 'bg-gray-300' 
                                    : (isDonationUsed 
                                        ? 'bg-yellow-500 hover:bg-yellow-600' 
                                        : (isCreditUsed ? 'bg-higea-red hover:bg-red-700' : 'bg-higea-blue hover:bg-blue-700')
                                      )
                            }`}
                        >
                            {isDonationUsed 
                                ? 'Confirmar Donación' 
                                : (isCreditUsed ? 'Confirmar Crédito' : 'Guardar Datos Fiscales')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const openDailySalesDetail = async () => {
        try {
            Swal.fire({ title: 'Cargando...', didOpen: () => Swal.showLoading() });
            const res = await axios.get(`${API_URL}/reports/sales-today`);

            // --- PROTECCIÓN: Limpiar datos antes de guardarlos en el estado ---
            const safeData = res.data.map(sale => ({
                ...sale,
                // 1. Evita error en .split() si el método es null
                payment_method: sale.payment_method || 'Desconocido',

                // 2. CORRECCIÓN CLAVE: Aseguramos que TODOS los montos sean números reales
                total_usd: parseFloat(sale.total_usd) || 0,
                amount_paid_usd: parseFloat(sale.amount_paid_usd) || 0, // <--- IMPORTANTE: Para sumar flujo de caja
                bcv_rate_snapshot: parseFloat(sale.bcv_rate_snapshot) || 0, // <--- IMPORTANTE: Para calcular Bs exactos

                // 3. Texto por defecto para nombre
                full_name: sale.full_name || 'Consumidor Final'
            }));

            setDailySalesList(safeData);
            setShowDailySalesModal(true);
            Swal.close();
        } catch (error) {
            console.error("Error cargando ventas diarias:", error);
            Swal.close();
            Swal.fire('Error', 'No se pudo cargar el reporte de hoy', 'error');
        }
    };
// -----------------------------------------------------------------------------
    // 🇻🇪 ARQUEO DE CAJA "PREMIUM DASHBOARD" (LAYOUT 2 COLUMNAS + AUDITORÍA)
    // -----------------------------------------------------------------------------
    const handleCashClose = async () => {
        
        // 1. PANTALLA DE CARGA (Feedback Inmediato)
        Swal.fire({
            title: 'Auditoría en curso...',
            html: '<div class="text-sm text-slate-500 font-medium animate-pulse">Sincronizando contadores fiscales y donaciones...</div>',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            background: '#ffffff',
            showConfirmButton: false,
            width: 400,
            padding: '2em'
        });

        let statusData;
        try {
            const res = await axios.get(`${API_URL}/cash/current-status`);
            statusData = res.data;
            Swal.close();

            if (statusData.status === 'CERRADA') {
                return Swal.fire({ icon: 'info', title: 'Turno Cerrado', text: 'No hay caja abierta.', confirmButtonColor: '#3b82f6' });
            }
        } catch (e) {
            Swal.close();
            return Swal.fire('Error', 'Sin conexión al servidor.', 'error');
        }

        // --- CÁLCULOS (PREDICCIÓN DEL SISTEMA) ---
        const sys = statusData.system_totals;
        const initial = statusData.shift_info;

        // Fórmula: (Base + Ventas) - Salidas
        const expectedBs  = (parseFloat(initial.initial_cash_ves) + sys.cash_ves) - (sys.cash_outflows_ves || 0);
        const expectedUsd = (parseFloat(initial.initial_cash_usd) + sys.cash_usd) - (sys.cash_outflows_usd || 0);
        
        // [NUEVO] Lógica de Caja en Rojo (Matemática Negativa)
        const isNegativeBs = expectedBs < 0;
        const isNegativeUsd = expectedUsd < 0;

        // [NUEVO] Auditoría de Donaciones (Inventario que salió sin dinero)
        const totalDonationsRef = sys.donations || 0;

        const expectedPm    = sys.pm || 0;
        const expectedPunto = sys.punto || 0;
        const expectedZelle = sys.zelle || 0;

        // --- UI/UX PREMIUM LAYOUT ---
        await Swal.fire({
            title: '',
            width: '1050px', // Ancho suficiente para 2 columnas cómodas
            padding: 0,
            background: '#f8fafc', // Slate-50 background
            showCancelButton: true,
            // BOTONES ROBUSTOS CON ICONOS
            confirmButtonText: '<span class="flex items-center gap-3"><span>🔒</span> <span>CONFIRMAR CIERRE</span></span>',
            cancelButtonText: 'Cancelar Operación',
            
            // --- ESTILOS DE BOTONES NIVEL "APP NATIVA" ---
            buttonsStyling: false, 
            customClass: {
                popup: 'rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100', 
                actions: 'p-6 bg-white border-t border-slate-100 w-full flex gap-4 justify-end items-center z-10', 
                confirmButton: 'bg-slate-900 text-white hover:bg-black px-8 py-4 rounded-2xl font-bold text-sm tracking-wide shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 transform', 
                cancelButton: 'bg-white text-slate-400 hover:text-slate-600 hover:bg-slate-50 px-6 py-4 rounded-2xl font-bold text-sm border border-transparent hover:border-slate-200 transition-all duration-300'
            },

            html: `
                <div class="bg-white px-10 py-6 border-b border-slate-100 flex justify-between items-center sticky top-0 z-10 shadow-sm">
                    <div>
                        <h2 class="text-3xl font-black text-slate-800 tracking-tighter">Cierre de Caja</h2>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Turno #${initial.id}</span>
                            <span class="text-slate-400 text-xs font-medium">${new Date().toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">Tasa Oficial</p>
                        <div class="text-xl font-black text-emerald-600 bg-emerald-50 px-4 py-1.5 rounded-xl border border-emerald-100 shadow-sm inline-block">
                            ${bcvRate.toFixed(2)} Bs
                        </div>
                    </div>
                </div>

                ${totalDonationsRef > 0 ? `
                <div class="mx-10 mt-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r shadow-sm flex items-start gap-4 animate-in fade-in slide-in-from-top-2">
                    <div class="text-2xl">🎁</div>
                    <div class="flex-1 text-left">
                        <h4 class="font-bold text-yellow-800 uppercase text-xs tracking-widest">Auditoría de Donaciones</h4>
                        <p class="text-xs text-yellow-700 mt-1">Se detectó salida de mercancía por concepto de donación. Verifica los tickets firmados.</p>
                    </div>
                    <div class="text-right">
                        <span class="block text-[10px] font-bold text-yellow-600 uppercase">Total Ref</span>
                        <span class="text-xl font-black text-yellow-800">$${totalDonationsRef.toFixed(2)}</span>
                    </div>
                </div>
                ` : ''}

                <div class="grid grid-cols-1 md:grid-cols-12 gap-0 min-h-[450px] mt-2">
                    
                    <div class="md:col-span-7 p-8 space-y-6 border-r border-slate-100 bg-[#FAFAFA]">
                        <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-blue-500"></span> Conteo de Efectivo
                        </h3>

                        <div class="bg-white p-6 rounded-3xl shadow-[0_4px_20px_-10px_rgba(0,0,0,0.1)] border border-slate-100 group focus-within:ring-4 focus-within:ring-blue-50 transition-all cursor-text relative overflow-hidden" onclick="document.getElementById('inp-bs').focus()">
                            <div class="absolute top-0 right-0 bg-slate-800 text-white text-[9px] font-bold px-3 py-1.5 rounded-bl-xl z-0">
                                MONEDA NACIONAL
                            </div>
                            
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">En Gaveta (Bolívares)</label>
                            <div class="flex items-center gap-3 relative z-10">
                                <span class="text-4xl">🇻🇪</span>
                                <div class="flex-1">
                                    <input id="inp-bs" type="number" step="0.01" placeholder="0,00"
                                        class="w-full text-4xl font-black text-slate-800 bg-transparent outline-none placeholder-slate-200 tabular-nums">
                                </div>
                            </div>

                            <div class="mt-4 pt-3 border-t border-slate-50 flex justify-between items-center">
                                ${isNegativeBs 
                                    ? `<div class="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100 w-full">
                                         <span>⚠️ Saldo Negativo (Faltante Op.):</span>
                                         <span class="ml-auto">${formatBs(expectedBs)} Bs</span>
                                       </div>`
                                    : `<span class="text-xs text-slate-400 font-medium">El sistema calcula: <b class="text-slate-600">${formatBs(expectedBs)} Bs</b></span>`
                                }
                                
                                ${!isNegativeBs ? `<span id="badge-bs" class="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-1 rounded transition-all">Esperando...</span>` : ''}
                            </div>
                            ${isNegativeBs ? `<span id="badge-bs" class="hidden"></span>` : ''} </div>

                        <div class="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 group focus-within:ring-4 focus-within:ring-emerald-50 transition-all cursor-text" onclick="document.getElementById('inp-usd').focus()">
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">En Gaveta (Divisas)</label>
                            <div class="flex items-center gap-3">
                                <span class="text-4xl text-emerald-500">$</span>
                                <div class="flex-1">
                                    <input id="inp-usd" type="number" step="0.01" placeholder="0.00"
                                        class="w-full text-4xl font-black text-emerald-600 bg-transparent outline-none placeholder-emerald-100/50 tabular-nums">
                                </div>
                            </div>

                            <div class="mt-4 pt-3 border-t border-slate-50 flex justify-between items-center">
                                ${isNegativeUsd 
                                    ? `<div class="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100 w-full">
                                         <span>⚠️ Saldo Negativo (Faltante Op.):</span>
                                         <span class="ml-auto">$${formatUSD(expectedUsd)}</span>
                                       </div>`
                                    : `<span class="text-xs text-slate-400 font-medium">El sistema calcula: <b class="text-slate-600">$${formatUSD(expectedUsd)}</b></span>`
                                }
                                
                                ${!isNegativeUsd ? `<span id="badge-usd" class="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-1 rounded transition-all">Esperando...</span>` : ''}
                            </div>
                            ${isNegativeUsd ? `<span id="badge-usd" class="hidden"></span>` : ''}
                        </div>
                    </div>

                    <div class="md:col-span-5 p-8 bg-white flex flex-col h-full">
                        <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-purple-500"></span> Verificación Digital
                        </h3>
                        
                        <div class="space-y-3 flex-1">
                            <div class="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                                <div class="flex flex-col">
                                    <span class="text-xs font-bold text-slate-700">Pago Móvil</span>
                                    <span class="text-[10px] text-slate-400">Esp: ${formatBs(expectedPm)}</span>
                                </div>
                                <input id="inp-pm" type="number" value="${expectedPm > 0 ? expectedPm : ''}"
                                    class="w-28 text-right font-bold text-slate-800 bg-transparent outline-none border-b border-slate-200 focus:border-blue-500 text-sm" placeholder="0.00">
                            </div>

                            <div class="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                                <div class="flex flex-col">
                                    <span class="text-xs font-bold text-slate-700">Punto de Venta</span>
                                    <span class="text-[10px] text-slate-400">Esp: ${formatBs(expectedPunto)}</span>
                                </div>
                                <input id="inp-punto" type="number" value="${expectedPunto > 0 ? expectedPunto : ''}"
                                    class="w-28 text-right font-bold text-slate-800 bg-transparent outline-none border-b border-slate-200 focus:border-blue-500 text-sm" placeholder="0.00">
                            </div>

                            <div class="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                                <div class="flex flex-col">
                                    <span class="text-xs font-bold text-purple-600">Zelle (Ref)</span>
                                    <span class="text-[10px] text-slate-400">Esp: $${formatUSD(expectedZelle)}</span>
                                </div>
                                <input id="inp-zelle" type="number" value="${expectedZelle > 0 ? expectedZelle : ''}"
                                    class="w-28 text-right font-bold text-purple-700 bg-transparent outline-none border-b border-purple-200 focus:border-purple-500 text-sm" placeholder="0.00">
                            </div>
                        </div>

                        <div class="mt-6 pt-6 border-t border-slate-100">
                            <label class="block text-[10px] font-bold text-slate-400 uppercase mb-2">Observaciones / Incidencias</label>
                            <textarea id="inp-notes" rows="3" class="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs font-medium text-slate-600 focus:bg-white focus:ring-2 focus:ring-slate-100 focus:border-slate-300 outline-none resize-none transition-all" placeholder="Escribe aquí si hubo devoluciones, billetes rotos o diferencias justificadas..."></textarea>
                        </div>
                    </div>

                </div>
            `,
            // --- 🧠 LÓGICA REACTIVA (Mantiene el semáforo visual) ---
            didOpen: () => {
                const inpBs = document.getElementById('inp-bs');
                const inpUsd = document.getElementById('inp-usd');
                const badgeBs = document.getElementById('badge-bs');
                const badgeUsd = document.getElementById('badge-usd');

                const auditLive = () => {
                    // Cálculo Bs
                    const valBs = parseFloat(inpBs.value) || 0;
                    const diffBs = valBs - expectedBs;
                    
                    // Solo actualizamos el badge si NO es negativo (si es negativo el badge está oculto y se muestra el aviso rojo)
                    if(badgeBs && !badgeBs.classList.contains('hidden')) {
                        if(inpBs.value === '') {
                            badgeBs.className = 'text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-1 rounded';
                            badgeBs.innerText = 'Esperando...';
                        } else if (Math.abs(diffBs) < 1) {
                            badgeBs.className = 'text-[10px] font-bold bg-emerald-100 text-emerald-600 px-2 py-1 rounded border border-emerald-200';
                            badgeBs.innerHTML = '✨ EXACTO';
                        } else {
                            const color = diffBs > 0 ? 'blue' : 'rose';
                            const sign = diffBs > 0 ? '+' : '';
                            badgeBs.className = `text-[10px] font-bold bg-${color}-50 text-${color}-600 px-2 py-1 rounded border border-${color}-100`;
                            badgeBs.innerHTML = `${sign}${formatBs(diffBs)} Bs`;
                        }
                    }

                    // Cálculo USD
                    const valUsd = parseFloat(inpUsd.value) || 0;
                    const diffUsd = valUsd - expectedUsd;
                    
                    if(badgeUsd && !badgeUsd.classList.contains('hidden')) {
                        if(inpUsd.value === '') {
                            badgeUsd.className = 'text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-1 rounded';
                            badgeUsd.innerText = 'Esperando...';
                        } else if (Math.abs(diffUsd) < 0.1) {
                            badgeUsd.className = 'text-[10px] font-bold bg-emerald-100 text-emerald-600 px-2 py-1 rounded border border-emerald-200';
                            badgeUsd.innerHTML = '✨ EXACTO';
                        } else {
                            const color = diffUsd > 0 ? 'blue' : 'rose';
                            const sign = diffUsd > 0 ? '+' : '';
                            badgeUsd.className = `text-[10px] font-bold bg-${color}-50 text-${color}-600 px-2 py-1 rounded border border-${color}-100`;
                            badgeUsd.innerHTML = `${sign}$${formatUSD(diffUsd)}`;
                        }
                    }
                };

                inpBs.addEventListener('input', auditLive);
                inpUsd.addEventListener('input', auditLive);
                setTimeout(() => inpBs.focus(), 150);
            },

            preConfirm: () => {
                return {
                    cash_ves: parseFloat(document.getElementById('inp-bs').value) || 0,
                    cash_usd: parseFloat(document.getElementById('inp-usd').value) || 0,
                    pm: parseFloat(document.getElementById('inp-pm').value) || 0,
                    punto: parseFloat(document.getElementById('inp-punto').value) || 0,
                    zelle: parseFloat(document.getElementById('inp-zelle').value) || 0,
                    notes: document.getElementById('inp-notes').value
                };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const declared = result.value;

                // --- ALERTA DE SEGURIDAD (Si hay mucha diferencia) ---
                const finalDiffBs = declared.cash_ves - expectedBs;
                const finalDiffUsd = declared.cash_usd - expectedUsd;
                
                // Ajustamos la lógica de alarma para tolerar los negativos si están justificados
                const isAlarming = Math.abs(finalDiffBs) > 20 || Math.abs(finalDiffUsd) > 1;

                if (isAlarming) {
                    const confirmMistake = await Swal.fire({
                        title: 'Diferencia Detectada',
                        text: 'Los montos ingresados no coinciden con el sistema. ¿Deseas continuar de todas formas?',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: 'Sí, Registrar Faltante/Sobrante',
                        cancelButtonText: 'Recontar',
                        confirmButtonColor: '#f59e0b',
                        cancelButtonColor: '#1e293b'
                    });
                    if (!confirmMistake.isConfirmed) return handleCashClose(); // Recursividad para reabrir
                }

                // --- ENVÍO AL BACKEND ---
                try {
                    Swal.fire({ title: 'Generando Reporte Z...', didOpen: () => Swal.showLoading(), showConfirmButton: false, background: '#fff' });
                    await axios.post(`${API_URL}/cash/close`, { declared, notes: declared.notes });
                    
                    setCashShift(null); // Actualiza estado React
                    
                    Swal.fire({
                        title: '¡Cierre Exitoso!',
                        html: '<span class="text-slate-500">El turno ha finalizado correctamente.</span>',
                        icon: 'success',
                        confirmButtonText: 'Entendido',
                        confirmButtonColor: '#10b981'
                    });

                    if (view === 'ADVANCED_REPORTS' && typeof fetchClosingsHistory === 'function') fetchClosingsHistory();
                } catch (error) {
                    console.error(error);
                    Swal.fire('Error', 'No se pudo guardar el cierre.', 'error');
                }
            }
        });
    };

    // --- NUEVO: FUNCIÓN PARA ANULAR VENTA (NOTA DE CRÉDITO) ---
    const handleVoidSale = async (sale) => {
        // Validaciones UX
        if (sale.status === 'ANULADO') return Swal.fire('Error', 'Esta venta ya está anulada.', 'error');

        const isFiscal = sale.invoice_type === 'FISCAL';

        // 1. Confirmación de Seguridad
        const { value: reason } = await Swal.fire({
            title: isFiscal ? '⚠️ Generar Nota de Crédito' : '⚠️ Anular Venta',
            html: `
            <p class="text-sm text-gray-600 mb-4">
                Esta acción <b>reversará el inventario</b> (sumará el stock) y marcará la venta como ANULADA para que no sume en los reportes.
            </p>
            ${isFiscal ? '<p class="text-xs text-red-500 font-bold bg-red-50 p-2 rounded mb-4">Nota: Al ser Fiscal, esto registrará una Nota de Crédito interna.</p>' : ''}
        `,
            input: 'text',
            inputPlaceholder: 'Motivo de la anulación (Ej: Error en cobro, Devolución)',
            inputValidator: (value) => {
                if (!value) return '¡Debes escribir un motivo obligatoriamente!';
            },
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#E11D2B', // Rojo Alerta
            confirmButtonText: 'Sí, Anular y Reversar',
            cancelButtonText: 'Cancelar'
        });

        if (reason) {
            try {
                Swal.fire({ title: 'Procesando Reverso...', didOpen: () => Swal.showLoading() });

                // 2. Llamada al Backend
                // Usamos el ID normalizado que ya tienes en tus objetos de venta
                const saleId = sale.id || sale["Nro Factura"];

                await axios.post(`${API_URL}/sales/${saleId}/void`, { reason });

                // 3. Feedback Exitoso
                await Swal.fire({
                    icon: 'success',
                    title: '¡Anulación Exitosa!',
                    text: 'El inventario ha sido restaurado y la venta descontada de los reportes.',
                    timer: 2000
                });

                // 4. Actualizar Vistas
                setSelectedSaleDetail(null); // Cerrar modal detalle
                fetchData(); // Refrescar Dashboard Simple

                if (reportTab === 'SALES') fetchSalesDetail(); // Refrescar reporte de ventas si está abierto
                if (showDailySalesModal) openDailySalesDetail(); // Refrescar ventas del día si está abierto

                // --- CORRECCIÓN BUG BI: ACTUALIZACIÓN EN TIEMPO REAL ---
                // Si el usuario está viendo el Dashboard Avanzado, forzamos la recarga de gráficas
                if (view === 'ADVANCED_REPORTS' && reportTab === 'DASHBOARD') fetchAdvancedReport();

            } catch (error) {
                console.error(error);
                Swal.fire('Error', error.response?.data?.error || 'No se pudo anular la venta', 'error');
            }
        }
    };

    // --- FUNCIÓN GENERAR REPORTE PDF (DISEÑO MODERNO: REF + BS) ---
    const exportReportToPDF = () => {
        // 1. Validar datos
        if (!analyticsData || !analyticsData.salesOverTime) {
            return Swal.fire('Sin datos', 'No hay información para generar el reporte.', 'warning');
        }

        const doc = new jsPDF();

        // --- PALETA DE COLORES HIGEA MODERNA ---
        const colors = {
            primary: [0, 86, 179],   // Higea Blue (#0056B3)
            secondary: [225, 29, 43], // Higea Red (#E11D2B)
            darkText: [30, 41, 59],   // Slate 800
            lightText: [100, 116, 139], // Slate 500
            bgLight: [248, 250, 252],  // Slate 50
            border: [226, 232, 240]    // Slate 200
        };

        // --- HELPER: TARJETA KPI (AHORA SOPORTA DOBLE MONEDA) ---
        const drawModernCard = (x, y, width, height, title, valueRef, valueBs, accentColor) => {
            // Fondo y Borde
            doc.setDrawColor(...colors.border);
            doc.setFillColor(255, 255, 255);
            doc.roundedRect(x, y, width, height, 4, 4, 'FD');

            // Línea de acento superior
            doc.setFillColor(...accentColor);
            doc.rect(x + 1, y + 1, width - 2, 2, 'F');

            // Título
            doc.setTextColor(...colors.lightText);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text(title.toUpperCase(), x + 6, y + 12);

            // Valor Principal (REF)
            doc.setTextColor(...accentColor);
            doc.setFontSize(14); // Un poco más pequeño para que quepa todo
            doc.setFont('helvetica', 'bold');
            doc.text(valueRef, x + 6, y + 20);

            // Subtítulo / Valor Secundario (BS)
            if (valueBs) {
                doc.setFontSize(9);
                doc.setTextColor(...colors.darkText);
                doc.setFont('helvetica', 'bold'); // Bs en negrita gris oscuro
                doc.text(valueBs, x + 6, y + 26);
            }
        };

        // --- 1. ENCABEZADO ---
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, 210, 4, 'F');

        doc.setFontSize(24);
        doc.setTextColor(...colors.darkText);
        doc.setFont('helvetica', 'bold');
        doc.text("Reporte Gerencial", 14, 25);

        doc.setFontSize(10);
        doc.setTextColor(...colors.lightText);
        doc.setFont('helvetica', 'normal');
        doc.text("Inteligencia de Negocios Higea POS", 14, 32);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.primary);
        doc.text(`Periodo: ${new Date(reportDateRange.start).toLocaleDateString()} — ${new Date(reportDateRange.end).toLocaleDateString()}`, 14, 38);

        doc.setFontSize(8);
        doc.setTextColor(...colors.lightText);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generado: ${new Date().toLocaleString()}`, 196, 25, { align: 'right' });


        // --- 2. SECCIÓN DE KPIS (DOBLE MONEDA) ---
        let finalY = 50;
        doc.setFontSize(12);
        doc.setTextColor(...colors.darkText);
        doc.setFont('helvetica', 'bold');
        doc.text("Resumen Ejecutivo", 14, finalY);
        finalY += 8;

        // Cálculos Totales
        const totalUSD = analyticsData.salesOverTime.reduce((acc, day) => acc + parseFloat(day.total_usd), 0);
        const totalVES = analyticsData.salesOverTime.reduce((acc, day) => acc + parseFloat(day.total_ves), 0); // Total Bs real
        const totalTransacciones = analyticsData.salesOverTime.reduce((acc, day) => acc + parseInt(day.tx_count), 0);

        // Cálculos Promedios
        const ticketPromedioUSD = totalTransacciones > 0 ? totalUSD / totalTransacciones : 0;
        const ticketPromedioVES = totalTransacciones > 0 ? totalVES / totalTransacciones : 0;

        // Dibujar Tarjetas
        const cardWidth = 58;
        const cardHeight = 32; // Un poco más alta para que quepan los dos montos
        const gap = 6;

        // KPI 1: Dinero Recaudado (Ref y Bs)
        drawModernCard(
            14, finalY, cardWidth, cardHeight,
            "Dinero Recaudado",
            `Ref ${totalUSD.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
            `Bs ${totalVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
            colors.primary
        );

        // KPI 2: Transacciones (Solo número)
        drawModernCard(
            14 + cardWidth + gap, finalY, cardWidth, cardHeight,
            "Transacciones",
            `${totalTransacciones}`,
            "Operaciones exitosas",
            colors.darkText
        );

        // KPI 3: Ticket Promedio (Ref y Bs)
        const ticketColor = ticketPromedioUSD > 50 ? colors.primary : colors.secondary;
        drawModernCard(
            14 + (cardWidth + gap) * 2, finalY, cardWidth, cardHeight,
            "Ticket Promedio",
            `Ref ${ticketPromedioUSD.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
            `Bs ${ticketPromedioVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
            ticketColor
        );

        finalY += cardHeight + 15;

        // --- ESTILOS DE TABLA ---
        const cleanTableStyles = {
            theme: 'striped',
            headStyles: {
                fillColor: colors.primary,
                textColor: 255,
                fontStyle: 'bold',
                halign: 'left',
                cellPadding: 3
            },
            bodyStyles: { textColor: colors.darkText, fontSize: 9, cellPadding: 3 },
            alternateRowStyles: { fillColor: colors.bgLight },
            styles: { lineColor: 255, lineWidth: 0.1 }
        };

        // --- TABLA 1: EVOLUCIÓN (Ref y Bs) ---
        doc.setFontSize(11);
        doc.setTextColor(...colors.darkText);
        doc.text("1. Evolución de Ventas Diarias", 14, finalY);
        finalY += 4;

        autoTable(doc, {
            ...cleanTableStyles,
            startY: finalY,
            // Encabezados explícitos
            head: [['Fecha', 'Ops', 'Recaudado (Ref)', 'Recaudado (Bs)']],
            body: analyticsData.salesOverTime.map(row => [
                new Date(row.sale_date).toLocaleDateString(),
                row.tx_count,
                // Usamos Ref y Bs sin el símbolo $
                `Ref ${parseFloat(row.total_usd).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
                `Bs ${parseFloat(row.total_ves).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
            ]),
            columnStyles: {
                0: { cellWidth: 35 },
                1: { halign: 'center' },
                2: { fontStyle: 'bold', halign: 'right', textColor: colors.primary }, // Ref destacado
                3: { halign: 'right', textColor: colors.darkText } // Bs normal
            }
        });

        finalY = doc.lastAutoTable.finalY + 15;

        // --- TABLA 2: TOP PRODUCTOS ---
        if (finalY > 230) { doc.addPage(); finalY = 20; }

        doc.setFontSize(11);
        doc.setTextColor(...colors.darkText);
        doc.text("2. Productos Más Vendidos (Top 5)", 14, finalY);
        finalY += 4;

        autoTable(doc, {
            ...cleanTableStyles,
            startY: finalY,
            head: [['Producto', 'Unidades', 'Ingreso (Ref)']], // Solo Ref disponible en este endpoint
            headStyles: { ...cleanTableStyles.headStyles, fillColor: colors.secondary },
            body: analyticsData.topProducts.map(row => [
                row.name,
                row.total_qty,
                `Ref ${parseFloat(row.total_revenue).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
            ]),
            columnStyles: {
                1: { halign: 'center' },
                2: { halign: 'right', fontStyle: 'bold' }
            }
        });

        finalY = doc.lastAutoTable.finalY + 15;

        // --- TABLA 3: CATEGORÍAS ---
        if (finalY > 230) { doc.addPage(); finalY = 20; }

        doc.setFontSize(11);
        doc.setTextColor(...colors.darkText);
        doc.text("3. Rendimiento por Categoría", 14, finalY);
        finalY += 4;

        autoTable(doc, {
            ...cleanTableStyles,
            startY: finalY,
            head: [['Categoría', 'Participación', 'Total (Ref)']],
            body: analyticsData.salesByCategory.map(row => {
                const percentage = totalUSD > 0 ? (parseFloat(row.total_usd) / totalUSD * 100).toFixed(1) : 0;
                return [
                    row.category,
                    `${percentage}%`,
                    `Ref ${parseFloat(row.total_usd).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
                ]
            }),
            columnStyles: {
                1: { halign: 'center', textColor: colors.lightText, fontSize: 8 },
                2: { halign: 'right', fontStyle: 'bold' }
            }
        });

        // --- PIE DE PÁGINA ---
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setDrawColor(...colors.border);
            doc.line(14, 285, 196, 285);

            doc.setFontSize(8);
            doc.setTextColor(...colors.lightText);
            doc.text(`Sistema Higea POS - Reporte Gerencial Multimoneda`, 14, 290);
            doc.text(`${i} / ${pageCount}`, 196, 290, { align: 'right' });
        }

        doc.save(`Higea_Reporte_${reportDateRange.start}.pdf`);
    };

    // Cargar Reporte Avanzado con Filtro de Fecha
    const fetchAdvancedReport = async () => {
        try {
            Swal.fire({ title: 'Generando Estadísticas...', didOpen: () => Swal.showLoading() });
            const res = await axios.get(`${API_URL}/reports/analytics?startDate=${reportDateRange.start}&endDate=${reportDateRange.end}`);
            setAnalyticsData(res.data);
            Swal.close();
        } catch (error) {
            Swal.fire('Error', 'No se pudo generar el reporte', 'error');
        }
    };

    // --- COMPONENTE DE GRÁFICA MEJORADO (UX PRO) ---
    const SimpleBarChart = ({ data, labelKey, valueKey, colorClass, formatMoney, icon }) => {
        if (!data || data.length === 0) return (
            <div className="flex flex-col items-center justify-center h-40 text-gray-300">
                <span className="text-4xl mb-2">📊</span>
                <p className="text-xs font-medium">Sin datos para mostrar</p>
            </div>
        );

        const maxValue = Math.max(...data.map(d => parseFloat(d[valueKey])));

        return (
            <div className="space-y-4">
                {data.map((item, idx) => {
                    const val = parseFloat(item[valueKey]);
                    const percent = maxValue > 0 ? (val / maxValue) * 100 : 0;
                    return (
                        <div key={idx} className="group">
                            <div className="flex justify-between items-end mb-1">
                                <span className="text-xs font-bold text-gray-700 flex items-center gap-2">
                                    <span className="text-gray-400 font-normal w-4">{idx + 1}.</span>
                                    {item[labelKey]}
                                </span>
                                <span className="text-xs font-black text-gray-800">
                                    {formatMoney ? `Ref ${val.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : val}
                                </span>
                            </div>

                            {/* Barra con fondo y animación */}
                            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden relative">
                                <div
                                    className={`h-full rounded-full ${colorClass} transition-all duration-1000 ease-out relative group-hover:opacity-90`}
                                    style={{ width: `${percent}%` }}
                                >
                                    {/* Brillo sutil en la barra */}
                                    <div className="absolute top-0 right-0 bottom-0 left-0 bg-gradient-to-b from-white/20 to-transparent"></div>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    };

    // --- RESTO DE COMPONENTES Y LÓGICA DE UI ---
    const CartItem = ({ item }) => (
        <div onClick={() => removeFromCart(item.id)} className="flex justify-between items-center py-3 px-3 mb-2 rounded-xl bg-white border border-gray-100 shadow-sm active:scale-95 cursor-pointer select-none">
            <div className="flex items-center gap-3">
                <div className="relative">
                    <ProductAvatar icon={item.icon_emoji} size="h-10 w-10 text-lg" />
                    <div className="absolute -top-2 -right-2 bg-higea-red text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full border border-white">{item.quantity}</div>
                </div>
                <div>
                    <p className="font-bold text-gray-700 text-sm leading-tight line-clamp-1">{item.name}</p>
                    {/* Ref */}
                    <p className="text-[10px] text-gray-400 font-medium">Ref {item.price_usd} c/u</p>
                    {/* NUEVO: Indicador Fiscal en el carrito */}
                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${item.is_taxable ? 'bg-blue-100 text-higea-blue' : 'bg-green-100 text-green-600'}`}>
                        {item.is_taxable ? 'GRAVADO' : 'EXENTO'}
                    </span>
                </div>
            </div>
            <div className="text-right">
                {/* Ref */}
                <div className="font-bold text-gray-800 text-sm">Ref {(parseFloat(item.price_usd) * item.quantity).toFixed(2)}</div>
            </div>
        </div>
    );

    if (loading) return <div className="h-screen flex items-center justify-center bg-gray-50"><div className="w-10 h-10 border-4 border-higea-blue border-t-transparent rounded-full animate-spin"></div></div>;

    const isFallbackActive = bcvRate === fallbackRate; // 💡 NUEVO: Verificación de Fallback

    // 💡 LÓGICA DE PAGINACIÓN DE PRODUCTOS (POS View)
    const indexOfLastProduct = currentPage * productsPerPage;
    const indexOfFirstProduct = indexOfLastProduct - productsPerPage;
    const currentProducts = filteredProducts.slice(indexOfFirstProduct, indexOfLastProduct);
    const totalPages = Math.ceil(filteredProducts.length / productsPerPage);

    const paginate = (pageNumber) => {
        if (pageNumber > 0 && pageNumber <= totalPages) {
            setCurrentPage(pageNumber);
        }
    };

    // --- LÓGICA DE FILTRADO CENTRALIZADA PARA INVENTARIO ---
    const inventoryFilteredData = detailedInventory.filter(p => {
        if (!inventorySearch) return true; // Si no hay búsqueda, devuelve todo
        const term = inventorySearch.toLowerCase();
        return (
            p.name.toLowerCase().includes(term) ||
            (p.category && p.category.toLowerCase().includes(term)) ||
            (p.barcode && p.barcode.includes(term))
        );
    });

    const uniqueCategories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();

    const fetchClosingsHistory = async () => {
        try {
            Swal.fire({ title: 'Cargando cierres...', didOpen: () => Swal.showLoading() });
            const res = await axios.get(`${API_URL}/reports/closings`);
            setClosingsHistory(res.data);
            setReportTab('CLOSINGS');
            Swal.close();
        } catch (error) {
            Swal.fire('Error', 'No se pudo cargar el historial', 'error');
        }
    };

    // --- FUNCIÓN REPORTE PDF (UX PREMIUM VENEZUELA: DATOS FISCALES + AVANCES) ---
const printClosingReport = (shift) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // --- 🏢 DATOS FISCALES CONFIGURABLES (EDITAR AQUÍ) ---
    const FISCAL_INFO = {
        name: "VOLUNTARIADO HIGEA C.A.",
        rif: "J-30521322-4",
        address: " Av. Vargas con Carrera 31, Edif. Badan Lara, Barquisimeto",
        //serial: "HKA-11002394 (Simulado)",
        providencia: "Providencia Administrativa SNAT/2024/00012"
    };

    // Colores Institucionales
    const colors = {
        header: [15, 23, 42],    // Slate 900
        textHeader: [255, 255, 255],
        textDark: [30, 41, 59],  // Slate 800
        textLight: [100, 116, 139], // Slate 500
        accent: [37, 99, 235],   // Blue 600
        bgRow: [248, 250, 252],  // Slate 50
        line: [226, 232, 240]
    };

    // 1. ENCABEZADO FISCAL (SENIAT STYLE)
    // Fondo oscuro para título
    doc.setFillColor(...colors.header);
    doc.rect(0, 0, pageWidth, 40, 'F'); // Aumenté altura para que quepa la data fiscal

    // Título Principal
    doc.setFontSize(18);
    doc.setTextColor(...colors.textHeader);
    doc.setFont('helvetica', 'bold');
    doc.text("REPORTE DE CIERRE (Z)", 14, 15);

    // Datos de la Empresa (Izquierda)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(FISCAL_INFO.name, 14, 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`RIF: ${FISCAL_INFO.rif}`, 14, 26);
    // Dirección con salto de línea si es muy larga
    const splitAddress = doc.splitTextToSize(FISCAL_INFO.address, 110);
    doc.text(splitAddress, 14, 30);

    // Datos del Reporte (Derecha)
    doc.setFontSize(10);
    doc.setTextColor(203, 213, 225); // Slate 300
    doc.text(`CONTROL FISCAL INTERNO`, pageWidth - 14, 15, { align: 'right' });
    
    doc.setFontSize(9);
    doc.text(`TURNO ID: #${shift.id}`, pageWidth - 14, 22, { align: 'right' });
    //doc.text(`SERIAL: ${FISCAL_INFO.serial}`, pageWidth - 14, 26, { align: 'right' });
    doc.text(`${new Date(shift.opened_at).toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString('es-VE')}`, pageWidth - 14, 30, { align: 'right' });

    let y = 55; // Bajamos el inicio del contenido

    // --- SECCIÓN 1: RESUMEN DE MOVIMIENTOS ---
    doc.setFontSize(11);
    doc.setTextColor(...colors.textDark);
    doc.setFont('helvetica', 'bold');
    doc.text("1. CONCILIACIÓN DE EFECTIVO (GAVETA)", 14, y);
    
    doc.setDrawColor(...colors.accent);
    doc.setLineWidth(0.5);
    doc.line(14, y + 2, pageWidth - 14, y + 2);
    y += 10;

    const drawSummaryRow = (label, vesVal, usdVal, isDeduction = false, isTotal = false) => {
        const xValVes = 140;
        const xValUsd = 180;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
        doc.setTextColor(...(isDeduction ? [220, 38, 38] : (isTotal ? colors.textDark : colors.textLight)));
        
        doc.text(label, 14, y);
        
        const prefix = isDeduction ? '-' : '';
        doc.text(`${prefix}Bs ${vesVal.toLocaleString('es-VE', {minimumFractionDigits:2})}`, xValVes, y, { align: 'right' });
        doc.text(`${prefix}$${usdVal.toFixed(2)}`, xValUsd, y, { align: 'right' });
        
        y += 7;
    };

    // Valores
    const baseVes = parseFloat(shift.initial_cash_ves || 0);
    const baseUsd = parseFloat(shift.initial_cash_usd || 0);
    const ventasVes = parseFloat(shift.system_cash_ves || 0);
    const ventasUsd = parseFloat(shift.system_cash_usd || 0);
    const avancesVes = parseFloat(shift.cash_outflows_ves || 0);
    const avancesUsd = parseFloat(shift.cash_outflows_usd || 0);

    const esperadoVes = (baseVes + ventasVes) - avancesVes;
    const esperadoUsd = (baseUsd + ventasUsd) - avancesUsd;

    drawSummaryRow("(+) Fondo de Caja Inicial", baseVes, baseUsd);
    drawSummaryRow("(+) Ventas en Efectivo", ventasVes, ventasUsd);
    
    if (avancesVes > 0 || avancesUsd > 0) {
        drawSummaryRow("(-) Avances / Retiros", avancesVes, avancesUsd, true);
    }

    doc.setDrawColor(200, 200, 200);
    doc.line(100, y - 4, pageWidth - 14, y - 4);
    
    drawSummaryRow("(=) TOTAL ESPERADO EN GAVETA", esperadoVes, esperadoUsd, false, true);
    
    y += 10;

    // --- SECCIÓN 2: DESGLOSE ---
    doc.setFontSize(11);
    doc.setTextColor(...colors.textDark);
    doc.setFont('helvetica', 'bold');
    doc.text("2. DESGLOSE POR MÉTODO DE PAGO", 14, y);
    doc.setDrawColor(...colors.accent);
    doc.line(14, y + 2, pageWidth - 14, y + 2);
    y += 12;

    // Header Tabla
    doc.setFillColor(...colors.bgRow);
    doc.rect(14, y - 6, pageWidth - 28, 10, 'F');
    doc.setFontSize(9);
    doc.text("MÉTODO", 18, y);
    doc.text("ESPERADO (SISTEMA)", 90, y, {align:'right'});
    doc.text("CONTADO (REAL)", 140, y, {align:'right'});
    doc.text("DIFERENCIA", 190, y, {align:'right'});
    y += 12;

    const drawTableRow = (label, sysBs, sysRef, realBs, realRef) => {
        const diffBs = realBs - sysBs;
        const diffRef = realRef - sysRef;

        if (sysBs===0 && sysRef===0 && realBs===0 && realRef===0) return;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.textDark);
        doc.text(label, 18, y);

        // Sistema
        doc.setFont('helvetica', 'normal');
        doc.text(`Bs ${sysBs.toLocaleString('es-VE', {minimumFractionDigits:2})}`, 90, y, {align:'right'});
        doc.setTextColor(...colors.textLight);
        doc.setFontSize(8);
        doc.text(`Ref ${sysRef.toFixed(2)}`, 90, y+4, {align:'right'});

        // Real
        doc.setFontSize(9);
        doc.setTextColor(...colors.textDark);
        doc.text(`Bs ${realBs.toLocaleString('es-VE', {minimumFractionDigits:2})}`, 140, y, {align:'right'});
        doc.setTextColor(...colors.textLight);
        doc.setFontSize(8);
        doc.text(`Ref ${realRef.toFixed(2)}`, 140, y+4, {align:'right'});

        // Diferencia
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        if (Math.abs(diffBs) < 1) doc.setTextColor(22, 163, 74);
        else doc.setTextColor(220, 38, 38);
        doc.text(`Bs ${diffBs.toLocaleString('es-VE', {minimumFractionDigits:2})}`, 190, y, {align:'right'});

        if (Math.abs(diffRef) < 0.1) doc.setTextColor(22, 163, 74);
        else doc.setTextColor(220, 38, 38);
        doc.setFontSize(8);
        doc.text(`Ref ${diffRef.toFixed(2)}`, 190, y+4, {align:'right'});

        doc.setDrawColor(240, 240, 240);
        doc.line(14, y+6, pageWidth-14, y+6);

        y += 14;
    };

    drawTableRow("Efectivo (Gaveta)", esperadoVes, esperadoUsd, parseFloat(shift.real_cash_ves||0), parseFloat(shift.real_cash_usd||0));
    drawTableRow("Pago Móvil", parseFloat(shift.system_pago_movil||0), 0, parseFloat(shift.real_pago_movil||0), 0);
    drawTableRow("Punto de Venta", parseFloat(shift.system_punto||0), 0, parseFloat(shift.real_punto||0), 0);
    drawTableRow("Zelle", 0, parseFloat(shift.system_zelle||0), 0, parseFloat(shift.real_zelle||0));

    // --- SECCIÓN 3: PIE DE PÁGINA ---
    y += 10;
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'italic');
    doc.text(FISCAL_INFO.providencia, 14, pageHeight - 15);
    doc.text("Documento generado por Higea POS", pageWidth - 14, pageHeight - 15, { align: 'right' });

    doc.save(`Cierre_Fiscal_${shift.id}.pdf`);
};

    return (
        <div className="flex h-screen bg-[#F8FAFC] font-sans overflow-hidden text-gray-800">

            {/* SIDEBAR PC (Iconos Profesionales Actualizados) */}
            <nav className="hidden md:flex w-20 bg-white border-r border-gray-200 flex-col items-center py-6 z-40 shadow-lg">
                <div className="mb-8 h-10 w-10 bg-higea-red rounded-xl flex items-center justify-center text-white font-bold text-xl">H</div>
                
                {/* 1. POS (Ventas): Cambiado a Carrito de Compras 🛒 */}
                <button onClick={() => setView('POS')} title="Punto de Venta" className={`p-3 rounded-xl mb-4 transition-all ${view === 'POS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                </button>

                {/* 2. DASHBOARD: Gráfico de Barras 📊 (Correcto) */}
                <button onClick={() => { fetchData(); setView('DASHBOARD'); }} title="Panel Principal" className={`p-3 rounded-xl transition-all relative ${view === 'DASHBOARD' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                    </svg>
                    {/* Notificación de Créditos Vencidos */}
                    {overdueCount > 0 && <span className="absolute top-1 right-1 h-3 w-3 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">{overdueCount}</span>}
                </button>

                {/* 3. CRÉDITOS: Tarjeta de Crédito 💳 (Correcto para Cuentas por Cobrar) */}
                <button onClick={() => { fetchData(); setView('CREDIT_REPORT'); }} title="Cuentas por Cobrar" className={`p-3 rounded-xl transition-all mb-4 ${view === 'CREDIT_REPORT' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                </button>

                {/* 4. CLIENTES: Usuario 👤 (Correcto) */}
                <button onClick={() => { setView('CUSTOMERS'); }} title="Clientes" className={`p-3 rounded-xl transition-all ${view === 'CUSTOMERS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                </button>

                {/* 5. PRODUCTOS: Cambiado a CAJA/INVENTARIO 📦 (Corrección solicitada) */}
                <button onClick={() => { setView('PRODUCTS'); }} title="Inventario de Productos" className={`p-3 rounded-xl transition-all ${view === 'PRODUCTS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                </button>
				
				{/* BOTÓN AVANCE DE EFECTIVO (NUEVO) */}
                <button 
                    onClick={() => setIsCashAdvanceOpen(true)} 
                    title="Avance de Efectivo" 
                    className="p-3 rounded-xl transition-all text-emerald-600 bg-emerald-50 hover:bg-emerald-100 mb-4"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                </button>

                {/* 6. REPORTES AVANZADOS: Documento con Gráfico 📄 (Correcto) */}
                <button onClick={() => { setView('ADVANCED_REPORTS'); fetchAdvancedReport(); }} title="Reportes Gerenciales" className={`p-3 rounded-xl transition-all ${view === 'ADVANCED_REPORTS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </button>

            </nav>

            {/* CONTENIDO (Estructura de renderizado revisada) */}
            <div className="flex-1 relative overflow-hidden flex flex-col pb-16 md:pb-0">

                {view === 'POS' ? (
                    <div className="flex h-full flex-col md:flex-row">
                        {/* Contenido POS */}
                        <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                            <header className="bg-white/90 backdrop-blur-md border-b border-gray-200 px-4 py-3 flex justify-between items-center shadow-sm z-20">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-bold tracking-[0.2em] text-higea-blue uppercase">VOLUNTARIADO</span>
                                    <h1 className="text-xl font-black text-higea-red leading-none">HIGEA</h1>
                                </div>
                                <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                    {isFallbackActive ? ( // 💡 MEJORA: Warning si usa tasa de fallback
                                        <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.398 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                    ) : (
                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                    )}
                                    <span className="text-sm font-bold text-gray-800">{bcvRate.toFixed(2)} Bs</span>
                                    {isFallbackActive && <span className="text-xs text-orange-500 font-medium">(FALLBACK)</span>}
                                </div>
                            </header>

                            {/* NUEVA SECCIÓN: Búsqueda de alta visibilidad (UX mejorada) */}
                            <div className="px-4 py-3 bg-[#F8FAFC] border-b border-gray-100">
                                <input
                                    key="pos-search-input-fix" // FIX: Stable key to maintain focus
                                    type="text"
                                    placeholder="🔍 Buscar artículo por nombre o categoría..."
                                    value={posSearchQuery}
                                    onChange={(e) => setPosSearchQuery(e.target.value)}
                                    className="border-2 p-3 rounded-xl text-sm w-full focus:border-higea-blue outline-none shadow-inner"
                                    autoFocus={true} // UX: Focus automático
                                />
                            </div>

                            {/* SECCIÓN DE CATEGORÍAS (DISEÑO FINAL: SÓLIDO Y ALINEADO) */}
                            <div className="relative w-full bg-white border-b border-gray-100 h-16 shadow-sm z-10 group flex items-center">

                                {/* 1. ZONA IZQUIERDA (Botón Atrás - Fondo Sólido) */}
                                <div className="absolute left-0 top-0 bottom-0 w-12 bg-white z-20 flex items-center justify-center shadow-[4px_0_12px_-4px_rgba(0,0,0,0.1)]">
                                    <button
                                        onClick={() => scrollCategories('left')}
                                        className="w-8 h-8 rounded-full bg-gray-50 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-higea-blue hover:border-higea-blue hover:bg-white transition-all active:scale-95"
                                        title="Anterior"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                                    </button>
                                </div>

                                {/* 2. CONTENEDOR DE SCROLL */}
                                <div
                                    ref={categoryScrollRef}
                                    className="flex overflow-x-auto gap-3 h-full items-center no-scrollbar scroll-smooth snap-x"
                                >
                                    {/* 🔥 ESPACIADOR INICIAL */}
                                    <div className="w-16 flex-shrink-0"></div>

                                    {categories.map((cat) => {
                                        const isActive = selectedCategory === cat;
                                        return (
                                            <button
                                                key={cat}
                                                onClick={() => setSelectedCategory(cat)}
                                                className={`
                                    snap-start whitespace-nowrap px-5 py-2 rounded-full text-sm font-bold transition-all duration-300 border select-none flex items-center gap-2 z-10
                                    ${isActive
                                                        ? 'bg-higea-blue text-white border-transparent shadow-md shadow-blue-500/20 scale-100'
                                                        : 'bg-white text-slate-500 border-slate-100 hover:border-blue-200 hover:text-higea-blue hover:bg-slate-50'
                                                    }
                                `}
                                            >
                                                {/* Icono rayo solo para Todos */}
                                                {cat === 'Todos' && <span className="text-base">⚡</span>}
                                                <span>{cat}</span>
                                            </button>
                                        )
                                    })}

                                    {/* Espaciador final para simetría */}
                                    <div className="w-16 flex-shrink-0"></div>
                                </div>

                                {/* 3. ZONA DERECHA (Botón Siguiente - Fondo Sólido) */}
                                <div className="absolute right-0 top-0 bottom-0 w-12 bg-white z-20 flex items-center justify-center shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.1)]">
                                    <button
                                        onClick={() => scrollCategories('right')}
                                        className="w-8 h-8 rounded-full bg-gray-50 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-higea-blue hover:border-higea-blue hover:bg-white transition-all active:scale-95"
                                        title="Siguiente"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                    </button>
                                </div>
                            </div>

                            {/* 💡 MODIFICADO: Usar currentProducts para aplicar paginación */}
                            <div className="flex-1 overflow-y-auto px-4 pb-20 md:pb-6 custom-scrollbar">
                                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                                    {currentProducts.map((prod) => {
                                        // LÓGICA DE ESTADO (UX)
                                        const isOutOfStock = prod.stock <= 0;
                                        const isLowStock = prod.stock > 0 && prod.stock <= 10;
                                        
                                        return (
                                            <div 
                                                key={prod.id} 
                                                onClick={() => !isOutOfStock && addToCart(prod)} 
                                                // UI: Añadimos 'group' para efectos hover y bordes suaves
                                                className={`group relative bg-white rounded-[20px] p-4 border transition-all duration-300 flex flex-col h-full select-none
                                                    ${isOutOfStock 
                                                        ? 'border-slate-100 opacity-60 grayscale cursor-not-allowed' 
                                                        : 'border-slate-100 hover:border-blue-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer'
                                                    }`}
                                                title={`Stock exacto: ${prod.stock}`}
                                            >
                                                {/* 1. HEADER: STOCK Y ESTADO (Diseño "Pill" Elegante) */}
                                                <div className="flex justify-between items-start mb-2">
                                                    {/* Badge de Stock: Muestra número pero con estilo profesional */}
                                                    <div className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 border shadow-sm ${
                                                        isOutOfStock ? 'bg-slate-100 text-slate-400 border-slate-200' :
                                                        isLowStock ? 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse' :
                                                        'bg-emerald-50 text-emerald-600 border-emerald-100'
                                                    }`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                                            isOutOfStock ? 'bg-slate-400' :
                                                            isLowStock ? 'bg-amber-500' :
                                                            'bg-emerald-500'
                                                        }`}></span>
                                                        {isOutOfStock ? 'AGOTADO' : `${prod.stock} Und`}
                                                    </div>
                                                </div>

                                                {/* 2. CUERPO: ICONO Y NOMBRE */}
                                                <div className="flex-1 flex flex-col items-center text-center gap-2 mb-3">
                                                    {/* Avatar con efecto de flotación al hover */}
                                                    <div className="transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6 filter drop-shadow-sm">
                                                        <ProductAvatar icon={prod.icon_emoji} size="h-14 w-14 text-4xl" />
                                                    </div>
                                                    
                                                    {/* Nombre con tipografía limpia */}
                                                    <h3 className={`font-bold text-sm leading-snug line-clamp-2 ${
                                                        isOutOfStock ? 'text-slate-400' : 'text-slate-700 group-hover:text-blue-600'
                                                    }`}>
                                                        {prod.name}
                                                    </h3>
                                                </div>

                                                {/* 3. FOOTER: PRECIOS JERARQUIZADOS */}
                                                <div className="mt-auto pt-3 border-t border-slate-50 relative">
                                                    
                                                    <div className="flex flex-col items-center">
                                                        {/* Precio Principal (Bs) - Grande y Rojo */}
                                                        <div className={`flex items-center gap-1 ${isOutOfStock ? 'text-slate-300' : 'text-higea-red'}`}>
                                                            <span className="text-xs font-bold opacity-60">Bs</span>
                                                            <span className="text-xl font-black tracking-tight leading-none">
                                                                {prod.price_ves}
                                                            </span>
                                                        </div>

                                                        {/* Precio Secundario (Ref) - Discreto */}
                                                        <div className="text-[10px] text-slate-400 font-medium mt-0.5 bg-slate-50 px-2 rounded-md">
                                                            Ref ${prod.price_usd}
                                                        </div>
                                                    </div>

                                                    {/* 4. BOTÓN "AGREGAR" FANTASMA (Solo aparece al hover) */}
                                                    {!isOutOfStock && (
                                                        <div className="absolute right-0 bottom-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                                                            <div className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg shadow-blue-200">
                                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                                                                </svg>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {/* Mostrar mensaje si no hay productos */}
                                {currentProducts.length === 0 && (
                                    <p className="text-center text-gray-400 mt-10 text-sm">No se encontraron productos en esta categoría o búsqueda.</p>
                                )}
                            </div>

                            {/* 💡 CONTROLES DE PAGINACIÓN (Nuevo) */}
                            {totalPages > 1 && (
                                <div className="p-4 border-t border-gray-200 flex justify-center items-center gap-4 bg-white sticky bottom-0">
                                    <button onClick={() => paginate(currentPage - 1)} disabled={currentPage === 1} className="px-3 py-1 rounded-lg text-sm font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors">
                                        Anterior
                                    </button>
                                    <span className="text-sm font-bold text-gray-700">Página {currentPage} de {totalPages}</span>
                                    <button onClick={() => paginate(currentPage + 1)} disabled={currentPage === totalPages} className="px-3 py-1 rounded-lg text-sm font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors">
                                        Siguiente
                                    </button>
                                </div>
                            )}
                        </div>

                        <aside className="w-[350px] bg-white border-l border-gray-200 hidden md:flex flex-col shadow-xl z-20">
                            <div className="p-5 border-b border-gray-100 bg-gray-50/50">

                                {/* --- AQUÍ ESTÁ EL NUEVO WIDGET DE ESTADO DE CAJA INTEGRADO --- */}
                                <div className={`mb-3 rounded-xl border-l-4 shadow-sm transition-all duration-300 ${cashShift
                                    ? 'bg-white border-green-500'
                                    : 'bg-red-50 border-red-500'
                                    }`}>
                                    <div className="p-3 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {/* Ícono dinámico */}
                                            <div className={`p-1.5 rounded-full ${cashShift ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                                {cashShift ? (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                ) : (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                                )}
                                            </div>

                                            {/* Información de Texto */}
                                            <div>
                                                <h3 className={`text-xs font-bold uppercase tracking-wider ${cashShift ? 'text-green-800' : 'text-red-800'}`}>
                                                    {cashShift ? 'Caja Operativa' : 'Caja Cerrada'}
                                                </h3>
                                                <p className="text-[10px] text-gray-500 font-medium leading-tight">
                                                    {cashShift
                                                        // VALIDACIÓN: Evita el error "Invalid Date" verificando que opened_at exista
                                                        ? `Apertura: ${new Date(cashShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                                        : 'Se requiere apertura'
                                                    }
                                                </p>
                                            </div>
                                        </div>

                                        {/* BOTÓN DE ACCIÓN (Solo si está cerrada) */}
                                        {!cashShift && (
                                            <button
                                                onClick={promptOpenCash}
                                                className="bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold py-2 px-4 rounded-lg shadow-md transition-transform transform hover:scale-105 active:scale-95 flex items-center gap-1 animate-pulse"
                                            >
                                                <span>☀️ ABRIR</span>
                                            </button>
                                        )}

                                        {/* Indicador ON (Solo si está abierta) */}
                                        {cashShift && (
                                            <div className="flex items-center gap-1 bg-green-50 px-2 py-1 rounded border border-green-100">
                                                <span className="relative flex h-2 w-2">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                                </span>
                                                <span className="text-[10px] font-bold text-green-700">ON</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {/* --------------------------------------------------------- */}

                                <h2 className="text-lg font-bold text-gray-800 px-1">Orden Actual</h2>
                            </div>

                            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
                                {cart.length === 0 ? <p className="text-center text-gray-400 mt-10 text-sm">Carrito Vacío</p> : cart.map(item => <CartItem key={item.id} item={item} />)}
                            </div>

                            {/* 💡 MEJORA UX: Desglose Fiscal en carrito */}
                            {cart.length > 0 && (
                                <div className='px-5 pt-3 border-t border-gray-100'>
                                    {subtotalExemptUSD > 0 && (
                                        <div className="flex justify-between text-sm text-gray-500"><span className='font-medium'>Subtotal Exento</span><span className='font-bold'>Ref {subtotalExemptUSD.toFixed(2)}</span></div>
                                    )}
                                    <div className="flex justify-between text-sm text-gray-500"><span className='font-medium'>Base Imponible</span><span className='font-bold'>Ref {subtotalTaxableUSD.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-sm text-higea-red mb-2"><span className='font-medium'>IVA ({IVA_RATE * 100}%)</span><span className='font-bold'>Ref {ivaUSD.toFixed(2)}</span></div>
                                </div>
                            )}

                            <div className="p-5 bg-white border-t border-gray-100">
                                <div className="flex justify-between mb-4 items-end">
                                    <span className="text-sm text-gray-500">Total Final a Pagar</span>
                                    <span className="text-2xl font-black text-higea-blue">Bs {totalVES.toLocaleString('es-VE', { maximumFractionDigits: 0 })}</span>
                                </div>
                                <button onClick={handleOpenPayment} className="w-full bg-higea-red text-white font-bold py-3 rounded-xl shadow-lg hover:bg-red-700">COBRAR (Ref {finalTotalUSD.toFixed(2)})</button>
                                {/* 💡 MEJORA UX: Botón de Cancelar Venta */}
                                {cart.length > 0 && (
                                    <button onClick={() => setCart([])} className="w-full mt-2 bg-gray-200 text-gray-700 font-bold py-3 rounded-xl hover:bg-gray-300">CANCELAR VENTA</button>
                                )}
                            </div>
                        </aside>
                    </div>
                ) : view === 'DASHBOARD' ? (
                    <div className="p-4 md:p-8 overflow-y-auto h-full animate-slide-up">
                        <h2 className="text-2xl font-black text-gray-800 mb-6">Panel Gerencial</h2>

                        {/* Tarjetas KPI Superiores */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                            {/* 1. VENTAS HOY (Clickable) */}
                            <div
                                onClick={openDailySalesDetail}
                                className="bg-white p-5 rounded-3xl shadow-sm border border-blue-100 cursor-pointer hover:shadow-md transition-all active:scale-95 group"
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-gray-400 text-xs font-bold uppercase group-hover:text-higea-blue transition-colors">Ventas Hoy (Ref)</p>
                                        <p className="text-3xl font-black text-higea-blue mt-1">Ref {parseFloat(stats.total_usd).toFixed(2)}</p>
                                        <p className="text-[10px] text-gray-400 mt-1">Click para ver detalle</p>
                                    </div>
                                    <div className="bg-blue-50 p-2 rounded-xl group-hover:bg-blue-100 transition-colors">
                                        <svg className="w-6 h-6 text-higea-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    </div>
                                </div>
                            </div>

                            {/* 2. VENTAS HOY BS */}
                            <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                                <p className="text-gray-400 text-xs font-bold uppercase">Ventas Hoy (Bs)</p>
                                <p className="text-3xl font-black text-gray-800 mt-1">Bs {parseFloat(stats.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 0 })}</p>
                            </div>

                            {/* 3. ALERTAS DE STOCK (Mejorado) */}
                            <div className="bg-white p-5 rounded-3xl shadow-sm border border-red-100 bg-red-50/30 relative flex flex-col justify-between">
                                <div className="flex justify-between items-center mb-3">
                                    <p className="text-red-400 text-xs font-bold uppercase">Alertas Stock ({lowStock.length})</p>
                                    {/* 💡 MEJORA: Botón siempre visible si hay al menos 1 item */}
                                    {lowStock.length > 0 && (
                                        <button onClick={(e) => { e.stopPropagation(); setShowStockModal(true); }} className="text-[10px] font-bold text-white bg-red-400 px-2 py-1 rounded-lg hover:bg-red-500 shadow-sm transition-colors">
                                            Ver Detalle
                                        </button>
                                    )}
                                </div>
                                <div className="space-y-2 mb-2">
                                    {lowStock.slice(0, 4).map((p, i) => (
                                        <div key={i} className="flex justify-between items-center text-xs bg-white p-2 rounded-xl border border-red-50 shadow-sm">
                                            <span className="truncate w-3/4 font-medium text-gray-700 flex items-center gap-1">
                                                {/* CORRECCIÓN AQUÍ: Detectar imagen vs Emoji */}
                                                {(p.icon_emoji && (p.icon_emoji.startsWith('data:image') || p.icon_emoji.startsWith('http'))) ? (
                                                    <img 
                                                        src={p.icon_emoji} 
                                                        alt="img" 
                                                        className="w-5 h-5 rounded-full object-cover border border-gray-100 flex-shrink-0"
                                                    />
                                                ) : (
                                                    <span className="text-base">{p.icon_emoji || '📦'}</span>
                                                )}
                                                {/* Fin corrección */}
                                                {p.name}
                                            </span>
                                            <span className="font-black text-red-500 bg-red-50 px-2 py-0.5 rounded-md">{p.stock}</span>
                                        </div>
                                    ))}
                                    {lowStock.length === 0 && <p className="text-xs text-green-600 font-bold bg-green-50 p-2 rounded-lg text-center">¡Inventario Saludable! 🎉</p>}
                                </div>
                            </div>

                            {/* 4. TOP DEUDORES (Mini Lista) */}
                            <div className="bg-white p-5 rounded-3xl shadow-sm border border-orange-100 bg-orange-50/30">
                                <p className="text-orange-400 text-xs font-bold uppercase mb-2">Top Deudores</p>
                                <div className="space-y-3">
                                    {topDebtors.slice(0, 3).map((d, i) => (
                                        <div key={i} className="flex justify-between items-center text-xs border-b border-orange-100 last:border-0 pb-1 last:pb-0">
                                            {/* UX MEJORADA: flex-1 permite que el nombre ocupe todo el espacio libre antes de cortar */}
                                            <span className="truncate flex-1 font-bold text-gray-700 pr-2" title={d.full_name}>
                                                {d.full_name}
                                            </span>
                                            <span className="font-black text-orange-600 whitespace-nowrap">
                                                Ref {parseFloat(d.debt).toFixed(2)}
                                            </span>
                                        </div>
                                    ))}
                                    {topDebtors.length === 0 && <p className="text-xs text-gray-400">Sin deudas pendientes.</p>}
                                    {topDebtors.length > 0 && <button onClick={() => setView('CREDIT_REPORT')} className="w-full mt-2 text-[10px] font-bold text-orange-600 hover:underline">Ir a Cobranzas →</button>}
                                </div>
                            </div>
                        </div>

                        {/* ÚLTIMAS TRANSACCIONES (Adaptado: Estatus Diferenciado + Método de Pago) */}
<div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
    <div className="p-5 border-b border-gray-100 flex justify-between items-center">
        <h3 className="font-bold text-gray-800">Últimas Transacciones</h3>
        <span className="text-xs text-gray-400">Mostrando últimas 10</span>
    </div>
    <div className="overflow-x-auto">
        <table className="w-full text-left text-xs md:text-sm text-gray-600">
            <thead className="bg-gray-50 text-gray-400 uppercase font-bold">
                <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Cliente</th>
                    {/* Nueva Columna: Método */}
                    <th className="px-4 py-3 text-center">Método</th>
                    <th className="px-4 py-3 text-center">Estatus</th>
                    <th className="px-4 py-3 text-right">Monto Ref</th>
                    <th className="px-4 py-3 text-right">Monto Bs</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
    {recentSales.map((sale) => {
        // 1. Lógica para detectar tipo de factura (Seguridad por si el campo no viene)
        const isFiscal = sale.invoice_type === 'FISCAL';

        // 2. Tu lógica original de Donación (Preservada intacta)
        const isDonationVisual = sale.status === 'DONADO' || 
            (sale.payment_method && sale.payment_method.toUpperCase().includes('DONACI'));

        return (
            <tr key={sale.id} onClick={() => showSaleDetail(sale)} className="hover:bg-blue-50 cursor-pointer transition-colors group">
                
                {/* --- CAMBIO AQUÍ: ID con diferenciación Visual Minimalista --- */}
                <td className="px-4 py-3 align-middle">
                    <div className="flex flex-col items-start gap-1">
                        <span className="font-black text-higea-blue text-sm leading-none">#{sale.id}</span>
                        {/* Badge de Tipo de Documento */}
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-[4px] border transition-all ${
                            isFiscal 
                                ? 'bg-blue-50 text-blue-900 border-blue-200 shadow-sm' // Estilo Fiscal: Serio, Oscuro
                                : 'bg-white text-gray-400 border-gray-200'             // Estilo Ticket: Sutil, Limpio
                        }`}>
                            {isFiscal ? '🧾 FISCAL' : 'TICKET'}
                        </span>
                    </div>
                </td>
                
                {/* Fecha */}
                <td className="px-4 py-3">{sale.full_date}</td>
                
                {/* Cliente */}
                <td className="px-4 py-3 font-medium text-gray-700 truncate max-w-[150px]" title={sale.full_name}>
                    {sale.full_name || 'Consumidor Final'}
                </td>

                {/* Método de Pago */}
                <td className="px-4 py-3 text-center">
                    <span className="px-2 py-1 bg-gray-100 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-500 truncate max-w-[100px] inline-block" title={sale.payment_method}>
                        {sale.payment_method || 'N/A'}
                    </span>
                </td>

                {/* Estatus Inteligente (Tu código original preservado) */}
                <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wide border ${
                        sale.status === 'ANULADO'   ? 'bg-rose-50 text-rose-500 border-rose-100 line-through' :
                        sale.status === 'PENDIENTE' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                        sale.status === 'PARCIAL'   ? 'bg-indigo-50 text-indigo-600 border-indigo-200' :
                        isDonationVisual            ? 'bg-yellow-50 text-yellow-600 border-yellow-200' :
                        'bg-emerald-50 text-emerald-600 border-emerald-200'
                    }`}>
                        {isDonationVisual ? '🎁 DONADO' : sale.status}
                    </span>
                </td>

                {/* Montos */}
                <td className={`px-4 py-3 text-right font-black ${sale.status === 'ANULADO' ? 'text-slate-300 decoration-slate-300 line-through' : 'text-gray-800'}`}>
                    Ref {parseFloat(sale.total_usd).toFixed(2)}
                </td>
                <td className={`px-4 py-3 text-right ${sale.status === 'ANULADO' ? 'text-slate-300 decoration-slate-300 line-through' : 'text-gray-500'}`}>
                    Bs {parseFloat(sale.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 0 })}
                </td>
            </tr>
        );
    })}
</tbody>
        </table>
    </div>
</div>
                    </div>
                ) : view === 'CREDIT_REPORT' ? (
                    /* --- MÓDULO DE CRÉDITO (REDISEÑO CON BÚSQUEDA Y PAGINACIÓN) --- */
                    <div className="p-4 md:p-8 overflow-y-auto h-full animate-slide-up bg-slate-50">

                        {/* Si NO hay cliente seleccionado, mostramos la LISTA GENERAL */}
                        {!selectedCreditCustomer ? (
                            <>
                                {/* CABECERA Y CONTROLES */}
                                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                                    <div>
                                        <h2 className="text-2xl font-black text-gray-800">Cartera de Crédito</h2>
                                        <p className="text-sm text-gray-500">Gestión de cuentas por cobrar consolidadas</p>
                                    </div>

                                    {/* BARRA DE BÚSQUEDA */}
                                    <div className="relative w-full md:w-72">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                                        <input
                                            type="text"
                                            placeholder="Buscar cliente o ID..."
                                            value={creditSearchQuery}
                                            onChange={(e) => setCreditSearchQuery(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-higea-blue outline-none shadow-sm text-sm"
                                        />
                                    </div>
                                </div>

                                {/* CONTENEDOR DE LA LISTA */}
                                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">

                                    {/* ENCABEZADO TABLA (SOLO PC) */}
                                    <div className="hidden md:grid grid-cols-12 bg-gray-50 p-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                        <div className="col-span-4">Cliente / Deudor</div>
                                        <div className="col-span-2">Identificación</div>
                                        <div className="col-span-1 text-center">Facturas</div>
                                        <div className="col-span-2 text-right">Deuda Total</div>
                                        <div className="col-span-2 text-right text-higea-red">Restante</div>
                                        <div className="col-span-1 text-center">Acción</div>
                                    </div>

                                    {/* LISTADO DE DATOS */}
                                    <div className="divide-y divide-gray-100">
                                        {(() => {
                                            const creditsPerPage = 10;
                                            const indexOfLastCredit = creditCurrentPage * creditsPerPage;
                                            const indexOfFirstCredit = indexOfLastCredit - creditsPerPage;
                                            const currentCredits = filteredCredits.slice(indexOfFirstCredit, indexOfLastCredit);
                                            const totalCreditPages = Math.ceil(filteredCredits.length / creditsPerPage);

                                            if (filteredCredits.length === 0) {
                                                return (
                                                    <div className="p-12 text-center flex flex-col items-center justify-center text-gray-400">
                                                        <div className="text-4xl mb-2">🎉</div>
                                                        <p>No se encontraron deudas pendientes.</p>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <>
                                                    {currentCredits.map((client) => (
                                                        <div
                                                            key={client.customer_id}
                                                            onClick={() => openCustomerCredits(client)}
                                                            className="p-4 hover:bg-blue-50 transition-colors cursor-pointer group"
                                                        >
                                                            {/* VISTA DESKTOP */}
                                                            <div className="hidden md:grid grid-cols-12 items-center gap-2">
                                                                <div className="col-span-4 font-bold text-gray-800 flex items-center gap-3">
                                                                    <div className="h-8 w-8 rounded-full bg-blue-100 text-higea-blue flex items-center justify-center text-xs font-bold">
                                                                        {client.full_name.charAt(0)}
                                                                    </div>
                                                                    {client.full_name}
                                                                </div>
                                                                <div className="col-span-2 text-xs text-gray-500 font-mono">{client.id_number}</div>
                                                                <div className="col-span-1 text-center">
                                                                    <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-lg text-xs font-bold">{client.total_bills}</span>
                                                                </div>
                                                                <div className="col-span-2 text-right text-gray-400 text-xs font-medium">Ref {parseFloat(client.total_debt).toFixed(2)}</div>
                                                                <div className="col-span-2 text-right font-black text-higea-red text-sm">Ref {parseFloat(client.remaining_balance).toFixed(2)}</div>
                                                                <div className="col-span-1 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <span className="text-xs font-bold text-higea-blue hover:underline">Ver →</span>
                                                                </div>
                                                            </div>

                                                            {/* VISTA MÓVIL */}
                                                            <div className="md:hidden flex justify-between items-center">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="h-10 w-10 rounded-full bg-blue-50 text-higea-blue flex items-center justify-center font-bold">
                                                                        {client.full_name.charAt(0)}
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-bold text-gray-800 text-sm line-clamp-1">{client.full_name}</p>
                                                                        <p className="text-xs text-gray-400">{client.total_bills} facturas pendientes</p>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <p className="text-[10px] text-gray-400 uppercase">Por Pagar</p>
                                                                    <p className="font-black text-higea-red text-lg">Ref {parseFloat(client.remaining_balance).toFixed(2)}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}

                                                    {/* PAGINACIÓN */}
                                                    {totalCreditPages > 1 && (
                                                        <div className="p-4 border-t border-gray-100 flex justify-center items-center gap-4 bg-white">
                                                            <button
                                                                onClick={() => setCreditCurrentPage(prev => Math.max(1, prev - 1))}
                                                                disabled={creditCurrentPage === 1}
                                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors"
                                                            >
                                                                Anterior
                                                            </button>
                                                            <span className="text-xs font-bold text-gray-500">Pág {creditCurrentPage} de {totalCreditPages}</span>
                                                            <button
                                                                onClick={() => setCreditCurrentPage(prev => Math.min(totalCreditPages, prev + 1))}
                                                                disabled={creditCurrentPage === totalCreditPages}
                                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors"
                                                            >
                                                                Siguiente
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </>
                        ) : (
                            /* VISTA DE DETALLE (FACTURAS DEL CLIENTE) - MEJORADA CON PAGINACIÓN Y UX MÓVIL */
                            <div className="bg-white rounded-3xl shadow-lg border border-gray-200 overflow-hidden animate-slide-up h-full flex flex-col">

                                {/* CABECERA FIJA DEL CLIENTE */}
                                <div className="p-5 border-b border-gray-100 bg-blue-50/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
                                    <div>
                                        <button
                                            onClick={() => setSelectedCreditCustomer(null)}
                                            className="text-gray-500 hover:text-higea-blue font-bold text-xs mb-2 flex items-center gap-1 transition-colors px-2 py-1 hover:bg-white rounded-lg"
                                        >
                                            <span>←</span> Volver al listado
                                        </button>
                                        <h3 className="text-xl md:text-2xl font-black text-higea-blue leading-tight">
                                            {selectedCreditCustomer.full_name}
                                        </h3>
                                        <div className="flex flex-wrap gap-3 mt-1">
                                            <span className="text-xs font-mono bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-500">
                                                🆔 {selectedCreditCustomer.id_number}
                                            </span>
                                            {selectedCreditCustomer.phone && (
                                                <span className="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-500">
                                                    📞 {selectedCreditCustomer.phone}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="w-full md:w-auto bg-white p-4 rounded-2xl border border-blue-100 shadow-sm flex justify-between md:block items-center">
                                        <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-0 md:mb-1">Deuda Total</p>
                                        <p className="text-2xl md:text-3xl font-black text-higea-red">Ref {parseFloat(selectedCreditCustomer.remaining_balance).toFixed(2)}</p>
                                    </div>
                                </div>

                                {/* CONTENEDOR DE LISTA CON SCROLL */}
                                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">

                                    {/* LÓGICA DE PAGINACIÓN */}
                                    {(() => {
                                        const itemsPerPage = 5; // Menos ítems por página para que se vea bien en móviles
                                        const indexOfLastItem = detailsCurrentPage * itemsPerPage;
                                        const indexOfFirstItem = indexOfLastItem - itemsPerPage;
                                        const currentInvoices = customerCreditsDetails.slice(indexOfFirstItem, indexOfLastItem);
                                        const totalPages = Math.ceil(customerCreditsDetails.length / itemsPerPage);

                                        return (
                                            <>
                                                {/* --- VERSIÓN ESCRITORIO (TABLA) --- */}
                                                <div className="hidden md:block bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                                                    <table className="w-full text-left text-sm text-gray-600">
                                                        <thead className="bg-gray-50 text-gray-400 uppercase font-bold tracking-wider text-xs border-b border-gray-100">
                                                            <tr>
                                                                <th className="px-6 py-4"># Venta</th>
                                                                <th className="px-6 py-4">Fechas</th>
                                                                <th className="px-6 py-4 text-right">Total</th>
                                                                <th className="px-6 py-4 text-right">Abonado</th>
                                                                <th className="px-6 py-4 text-right">Restante</th>
                                                                <th className="px-6 py-4 text-center">Estado</th>
                                                                <th className="px-6 py-4 text-center">Acción</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {currentInvoices.map((sale) => (
                                                                <tr
                                                                    key={sale.id}
                                                                    // ACCIÓN PRINCIPAL: Clic en fila abre el detalle de la venta
                                                                    onClick={() => showSaleDetail(sale)}
                                                                    className={`hover:bg-blue-50 transition-colors cursor-pointer ${sale.is_overdue ? 'bg-red-50/20' : ''}`}
                                                                >
                                                                    <td className="px-6 py-4 font-bold text-higea-blue">#{sale.id}</td>
                                                                    <td className="px-6 py-4">
                                                                        <div className="text-xs text-gray-500">Emisión: {new Date(sale.created_at).toLocaleDateString()}</div>
                                                                        <div className={`text-xs font-bold ${sale.is_overdue ? 'text-red-600' : 'text-gray-400'}`}>
                                                                            Vence: {new Date(sale.due_date).toLocaleDateString()}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-4 text-right">Ref {parseFloat(sale.total_usd).toFixed(2)}</td>
                                                                    <td className="px-6 py-4 text-right text-green-600 font-medium">Ref {parseFloat(sale.amount_paid_usd || 0).toFixed(2)}</td>
                                                                    <td className="px-6 py-4 text-right">
                                                                        <span className="font-black text-gray-800 text-base">Ref {parseFloat(sale.remaining_amount).toFixed(2)}</span>
                                                                    </td>
                                                                    <td className="px-6 py-4 text-center">
                                                                        <span className={`px-2 py-1 rounded text-[10px] font-bold ${sale.status === 'PARCIAL' ? 'bg-orange-100 text-orange-600' : 'bg-yellow-100 text-yellow-600'}`}>
                                                                            {sale.status}
                                                                        </span>
                                                                        {sale.is_overdue && <div className="text-[9px] text-red-600 font-black mt-1">VENCIDA</div>}
                                                                    </td>
                                                                    <td className="px-6 py-4 text-center">
                                                                        <div className="flex justify-center gap-2">
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation(); // <--- EVITA QUE SE ABRA EL DETALLE DOS VECES
                                                                                    showSaleDetail(sale);
                                                                                }}
                                                                                className="p-2 text-gray-400 hover:text-higea-blue bg-white border border-gray-200 rounded-lg shadow-sm z-10 relative"
                                                                                title="Ver Detalle"
                                                                            >
                                                                                👁️
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation(); // <--- EVITA QUE SE ABRA EL DETALLE AL QUERER ABONAR
                                                                                    handlePaymentProcess(sale.id, parseFloat(sale.total_usd), parseFloat(sale.amount_paid_usd || 0));
                                                                                }}
                                                                                className="bg-green-500 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-green-600 shadow-md active:scale-95 transition-all z-10 relative"
                                                                            >
                                                                                Abonar
                                                                            </button>
																			
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                {/* --- VERSIÓN MÓVIL (TARJETAS) --- */}
                                                <div className="md:hidden space-y-3">
                                                    {currentInvoices.map((sale) => (
                                                        <div key={sale.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden">
                                                            {/* Indicador lateral de estado */}
                                                            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${sale.is_overdue ? 'bg-red-500' : (sale.status === 'PARCIAL' ? 'bg-orange-400' : 'bg-yellow-400')}`}></div>

                                                            <div className="pl-3">
                                                                <div className="flex justify-between items-start mb-2">
                                                                    <div>
                                                                        <span className="font-black text-lg text-gray-800">#{sale.id}</span>
                                                                        <p className="text-[10px] text-gray-400">Emisión: {new Date(sale.created_at).toLocaleDateString()}</p>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sale.status === 'PARCIAL' ? 'bg-orange-50 text-orange-600' : 'bg-yellow-50 text-yellow-600'}`}>
                                                                            {sale.status}
                                                                        </span>
                                                                        {sale.is_overdue && <p className="text-[10px] font-bold text-red-500 mt-1">¡VENCIDA!</p>}
                                                                    </div>
                                                                </div>

                                                                <div className="flex justify-between items-end bg-gray-50 p-2 rounded-lg mb-3">
                                                                    <div>
                                                                        <p className="text-[10px] text-gray-400">Total Original</p>
                                                                        <p className="text-xs font-medium text-gray-600">Ref {parseFloat(sale.total_usd).toFixed(2)}</p>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <p className="text-[10px] text-higea-red font-bold uppercase">Deuda Restante</p>
                                                                        <p className="text-xl font-black text-higea-red">Ref {parseFloat(sale.remaining_amount).toFixed(2)}</p>
                                                                    </div>
                                                                </div>

                                                                <div className="flex gap-2">
                                                                    <button onClick={() => showSaleDetail(sale)} className="flex-1 py-2 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                                                        Ver Detalle
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handlePaymentProcess(sale.id, parseFloat(sale.total_usd), parseFloat(sale.amount_paid_usd || 0))}
                                                                        className="flex-1 py-2 text-xs font-bold text-white bg-green-500 rounded-lg shadow-md active:scale-95 transition-all"
                                                                    >
                                                                        Abonar
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* --- CONTROLES DE PAGINACIÓN (COMUNES) --- */}
                                                {totalPages > 1 && (
                                                    <div className="mt-4 flex justify-center items-center gap-4 py-2">
                                                        <button
                                                            onClick={() => setDetailsCurrentPage(prev => Math.max(1, prev - 1))}
                                                            disabled={detailsCurrentPage === 1}
                                                            className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-gray-200 disabled:opacity-50 disabled:bg-gray-50 shadow-sm"
                                                        >
                                                            Anterior
                                                        </button>
                                                        <span className="text-xs font-bold text-gray-500 bg-white px-3 py-2 rounded-lg border border-gray-100 shadow-sm">
                                                            Página {detailsCurrentPage} de {totalPages}
                                                        </span>
                                                        <button
                                                            onClick={() => setDetailsCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                                            disabled={detailsCurrentPage === totalPages}
                                                            className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-gray-200 disabled:opacity-50 disabled:bg-gray-50 shadow-sm"
                                                        >
                                                            Siguiente
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                ) : view === 'CUSTOMERS' ? (
                    /* MÓDULO DE CLIENTES (UX MEJORADA: BOTONES FIJOS) */
                    <div className="p-4 md:p-8 overflow-y-auto h-full relative bg-slate-50">

                        {/* CABECERA Y CONTROLES */}
                        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                            <div>
                                <h2 className="text-2xl font-black text-gray-800">Directorio de Clientes</h2>
                                <p className="text-sm text-gray-500">Gestione su base de datos de clientes</p>
                            </div>

                            <div className="flex w-full md:w-auto gap-2">
                                {/* BARRA DE BÚSQUEDA */}
                                <div className="relative w-full md:w-64">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                                    <input
                                        type="text"
                                        placeholder="Buscar cliente..."
                                        value={customerSearchQuery}
                                        onChange={(e) => setCustomerSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-higea-blue outline-none shadow-sm text-sm"
                                    />
                                </div>

                                {/* BOTÓN NUEVO CLIENTE (DESKTOP) */}
                                <button
                                    onClick={() => {
                                        setCustomerForm({ id: null, full_name: '', id_number: '', phone: '', institution: '', status: 'ACTIVO' });
                                        setIsCustomerFormOpen(true);
                                    }}
                                    className="hidden md:flex bg-higea-blue text-white px-5 py-3 rounded-xl font-bold shadow-md hover:bg-blue-700 transition-all items-center gap-2 whitespace-nowrap"
                                >
                                    <span>+</span> Nuevo Cliente
                                </button>
                            </div>
                        </div>

                        {/* TABLA DE CLIENTES */}
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                            {/* ENCABEZADO TABLA (SOLO PC) */}
                            <div className="hidden md:grid grid-cols-12 bg-gray-50 p-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                <div className="col-span-1">ID</div>
                                <div className="col-span-4">Cliente / Razón Social</div>
                                <div className="col-span-2">Identificador</div>
                                <div className="col-span-2">Teléfono</div>
                                <div className="col-span-1 text-center">Estatus</div>
                                <div className="col-span-2 text-right">Acciones</div>
                            </div>

                            {/* LISTADO DE DATOS */}
                            <div className="divide-y divide-gray-100">
                                {(() => {
                                    // Lógica de paginación
                                    const customersPerPage = 10;
                                    const indexOfLastCustomer = customerCurrentPage * customersPerPage;
                                    const indexOfFirstCustomer = indexOfLastCustomer - customersPerPage;
                                    const currentCustomers = filteredCustomers.slice(indexOfFirstCustomer, indexOfLastCustomer);
                                    const customerTotalPages = Math.ceil(filteredCustomers.length / customersPerPage);

                                    if (filteredCustomers.length === 0) {
                                        return (
                                            <div className="p-10 text-center flex flex-col items-center justify-center text-gray-400">
                                                <div className="text-4xl mb-2">📭</div>
                                                <p>No se encontraron clientes.</p>
                                            </div>
                                        );
                                    }

                                    return (
                                        <>
                                            {/* ... dentro de view === 'CUSTOMERS' ... */}
                                            {currentCustomers.map((customer) => (
                                                <div
                                                    key={customer.id}
                                                    // ACCIÓN PRINCIPAL: Clic en cualquier parte edita al cliente
                                                    onClick={() => {
                                                        editCustomer(customer);
                                                        setIsCustomerFormOpen(true);
                                                    }}
                                                    className="p-4 hover:bg-blue-50 transition-colors cursor-pointer group border-b border-gray-100 last:border-0"
                                                >
                                                    {/* VISTA DESKTOP (GRID) */}
                                                    <div className="hidden md:grid grid-cols-12 items-center gap-2">
                                                        <div className="col-span-1 font-bold text-higea-blue">#{customer.id}</div>
                                                        <div className="col-span-4 font-medium text-gray-800 truncate" title={customer.full_name}>{customer.full_name}</div>
                                                        <div className="col-span-2 text-gray-600 font-mono text-xs">{customer.id_number}</div>
                                                        <div className="col-span-2 text-gray-500 text-xs">{customer.phone || '-'}</div>
                                                        <div className="col-span-1 text-center">
                                                            <span className={`px-2 py-1 rounded text-[10px] font-bold ${(customer.status || 'ACTIVO') === 'ACTIVO' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                                }`}>
                                                                {customer.status || 'ACTIVO'}
                                                            </span>
                                                        </div>

                                                        {/* BOTONES DE ACCIÓN (Con stopPropagation para no chocar con la fila) */}
                                                        <div className="col-span-2 flex justify-end gap-2">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation(); // <--- EVITA QUE SE ABRA EL EDITOR AL PULSAR SALDO
                                                                    addInitialBalance(customer);
                                                                }}
                                                                className="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 border border-green-200 text-xs font-bold transition-colors flex items-center gap-1 z-10 relative"
                                                                title="Cargar Saldo Inicial"
                                                            >
                                                                <span>💸</span> Saldo
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation(); // <--- EVITA DOBLE CLIC
                                                                    editCustomer(customer);
                                                                    setIsCustomerFormOpen(true);
                                                                }}
                                                                className="px-3 py-1.5 bg-white text-higea-blue rounded-lg hover:bg-blue-50 border border-gray-200 text-xs font-bold transition-colors flex items-center gap-1 z-10 relative"
                                                                title="Editar Cliente"
                                                            >
                                                                <span>✏️</span> Editar
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* VISTA MÓVIL (STACKED) */}
                                                    <div className="md:hidden flex justify-between items-center">
                                                        <div className="flex-1">
                                                            <p className="font-bold text-gray-800 text-sm">{customer.full_name}</p>
                                                            <p className="text-xs text-gray-500 font-mono">{customer.id_number}</p>
                                                            <p className="text-[10px] text-gray-400 mt-1">{customer.phone}</p>
                                                        </div>

                                                        <div className="flex flex-col items-end gap-2">
                                                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${(customer.status || 'ACTIVO') === 'ACTIVO' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                                }`}>
                                                                {customer.status || 'ACTIVO'}
                                                            </span>

                                                            <div className="flex gap-2 mt-1">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        addInitialBalance(customer);
                                                                    }}
                                                                    className="text-[10px] bg-green-50 text-green-700 px-3 py-2 rounded-lg border border-green-200 font-bold active:scale-95"
                                                                >
                                                                    + Deuda
                                                                </button>
                                                                {/* El botón Editar es visualmente redundante en móvil porque tocar la tarjeta ya edita, 
                        pero lo mantenemos si el usuario quiere un botón explícito */}
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        editCustomer(customer);
                                                                        setIsCustomerFormOpen(true);
                                                                    }}
                                                                    className="text-[10px] bg-white text-higea-blue px-3 py-2 rounded-lg border border-gray-200 font-bold active:scale-95"
                                                                >
                                                                    Editar
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}

                                            {/* CONTROLES PAGINACIÓN */}
                                            {customerTotalPages > 1 && (
                                                <div className="p-4 border-t border-gray-100 flex justify-center items-center gap-4 bg-white">
                                                    <button
                                                        onClick={() => setCustomerCurrentPage(prev => Math.max(1, prev - 1))}
                                                        disabled={customerCurrentPage === 1}
                                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200"
                                                    >
                                                        Anterior
                                                    </button>
                                                    <span className="text-xs font-bold text-gray-500">Pág {customerCurrentPage} de {customerTotalPages}</span>
                                                    <button
                                                        onClick={() => setCustomerCurrentPage(prev => Math.min(customerTotalPages, prev + 1))}
                                                        disabled={customerCurrentPage === customerTotalPages}
                                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200"
                                                    >
                                                        Siguiente
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* BOTÓN FLOTANTE (FAB) SOLO PARA MÓVIL */}
                        <button
                            onClick={() => {
                                setCustomerForm({ id: null, full_name: '', id_number: '', phone: '', institution: '', status: 'ACTIVO' });
                                setIsCustomerFormOpen(true);
                            }}
                            className="md:hidden fixed bottom-20 right-4 h-14 w-14 bg-higea-blue text-white rounded-full shadow-2xl flex items-center justify-center text-3xl font-light z-40 active:scale-90 transition-transform"
                        >
                            +
                        </button>

                        {/* --- MODAL FORMULARIO DE CLIENTE (MANTENIDO IGUAL) --- */}
                        {isCustomerFormOpen && (
                            <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                                <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl animate-scale-up overflow-hidden">
                                    <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                        <h3 className="text-lg font-black text-gray-800">
                                            {customerForm.id ? 'Editar Cliente' : 'Registrar Nuevo Cliente'}
                                        </h3>
                                        <button onClick={() => setIsCustomerFormOpen(false)} className="w-8 h-8 flex items-center justify-center bg-white rounded-full text-gray-500 shadow-sm hover:text-red-500 font-bold">✕</button>
                                    </div>

                                    <div className="p-6 max-h-[70vh] overflow-y-auto">
                                        <form onSubmit={(e) => {
                                            saveCustomer(e).then(() => {
                                                setIsCustomerFormOpen(false);
                                            });
                                        }}>
                                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Nombre / Razón Social (*)</label>
                                            <input
                                                type="text"
                                                name="full_name"
                                                placeholder="Ej: Juan Pérez"
                                                value={customerForm.full_name}
                                                onChange={handleCustomerFormChange}
                                                className="w-full border-2 border-gray-100 p-3 rounded-xl mb-4 focus:border-higea-blue outline-none font-medium"
                                                autoFocus
                                                required
                                            />

                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                <div>
                                                    <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Cédula / RIF (*)</label>
                                                    <input
                                                        type="text"
                                                        name="id_number"
                                                        placeholder="V-12345678"
                                                        value={customerForm.id_number}
                                                        onChange={handleCustomerFormChange}
                                                        className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-higea-blue outline-none font-bold text-gray-700"
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Teléfono</label>
                                                    <input
                                                        type="tel"
                                                        name="phone"
                                                        placeholder="0414-1234567"
                                                        value={customerForm.phone}
                                                        onChange={handleCustomerFormChange}
                                                        className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-higea-blue outline-none"
                                                    />
                                                </div>
                                            </div>

                                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Dirección / Institución</label>
                                            <input
                                                type="text"
                                                name="institution"
                                                placeholder="Ej: Av. 20 con calle 10..."
                                                value={customerForm.institution}
                                                onChange={handleCustomerFormChange}
                                                className="w-full border-2 border-gray-100 p-3 rounded-xl mb-4 focus:border-higea-blue outline-none"
                                            />

                                            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 mb-6">
                                                <label className="text-xs font-bold text-gray-500 block mb-2">Estatus del Cliente</label>
                                                <div className="flex gap-2">
                                                    {['ACTIVO', 'INACTIVO'].map(st => (
                                                        <button
                                                            key={st}
                                                            type="button"
                                                            onClick={() => setCustomerForm(prev => ({ ...prev, status: st }))}
                                                            className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${customerForm.status === st
                                                                ? (st === 'ACTIVO' ? 'bg-green-500 text-white border-green-500' : 'bg-red-500 text-white border-red-500')
                                                                : 'bg-white text-gray-400 border-gray-200'
                                                                }`}
                                                        >
                                                            {st}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <button
                                                type="submit"
                                                className="w-full bg-higea-blue text-white font-bold py-4 rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all"
                                            >
                                                {customerForm.id ? 'Guardar Cambios' : 'Registrar Cliente'}
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : view === 'PRODUCTS' ? (
                    /* MÓDULO DE PRODUCTOS (UX PRO + KARDEX EN LISTA) */
                    <div className="p-4 md:p-8 overflow-y-auto h-full relative bg-slate-50">

                        {/* CABECERA Y CONTROLES */}
                        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                            <div>
                                <h2 className="text-2xl font-black text-gray-800">Inventario Maestro</h2>
                                <p className="text-sm text-gray-500">Gestión de existencias, costos y auditoría (Kardex)</p>
                            </div>

                            <div className="flex w-full md:w-auto gap-2">
                                <div className="relative w-full md:w-64">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                                    <input
                                        type="text"
                                        placeholder="Buscar nombre, código..."
                                        value={productSearchQuery}
                                        onChange={(e) => setProductSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-higea-blue outline-none shadow-sm text-sm"
                                    />
                                </div>
                                {/* BOTÓN DE GESTIÓN DE VENCIMIENTOS (PASO C) */}
                                <button
                                    onClick={() => setFilterExpiration(!filterExpiration)}
                                    className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-sm border ${filterExpiration
                                            ? 'bg-orange-100 text-orange-700 border-orange-200 ring-2 ring-orange-200'
                                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                        }`}
                                >
                                    <span>{filterExpiration ? '🔥 Riesgos' : '📅 Vencimientos'}</span>
                                    {filterExpiration && (
                                        <span className="bg-orange-200 text-orange-800 px-1.5 rounded-full text-[9px]">ON</span>
                                    )}
                                </button>

                                <button
                                    onClick={() => {
                                        // Resetear formulario
                                        setProductForm({
                                            id: null,
                                            name: '',
                                            category: '',
                                            price_usd: 0.00,
                                            stock: 0,
                                            is_taxable: true,
                                            icon_emoji: EMOJI_OPTIONS[0] || '🍔',
                                            barcode: '',
                                            status: 'ACTIVE',
                                            expiration_date: '' // <--- RESETEAR FECHA
                                        });
                                        setIsProductFormOpen(true);
                                    }}
                                    className="hidden md:flex bg-higea-blue text-white px-5 py-3 rounded-xl font-bold shadow-md hover:bg-blue-700 transition-all items-center gap-2 whitespace-nowrap"
                                >
                                    <span>+</span> Nuevo Ítem
                                </button>
                            </div>
                        </div>

                        {/* TABLA DE INVENTARIO */}
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="hidden md:grid grid-cols-12 bg-gray-50 p-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                <div className="col-span-1">ID</div>
                                <div className="col-span-4">Producto / Código</div>
                                <div className="col-span-2">Categoría</div>
                                <div className="col-span-2 text-right">Precio (Bs / Ref)</div>
                                <div className="col-span-1 text-center">Stock</div>
                                <div className="col-span-2 text-center">Gestión Rápida</div>
                            </div>

                            <div className="divide-y divide-gray-100">
                                {(() => {
                                    const inventoryPerPage = 10;
                                    const indexOfLastInventory = inventoryCurrentPage * inventoryPerPage;
                                    const indexOfFirstInventory = indexOfLastInventory - inventoryPerPage;
                                    const currentInventory = filteredInventory.slice(indexOfFirstInventory, indexOfLastInventory);
                                    const inventoryTotalPages = Math.ceil(filteredInventory.length / inventoryPerPage);

                                    if (filteredInventory.length === 0) return <div className="p-10 text-center text-gray-400"><div className="text-4xl mb-2">📦</div><p>No se encontraron productos.</p></div>;

                                    return (
                                        <>
                                            {currentInventory.map((p) => (
                                                <div
                                                    key={p.id}
                                                    // Al hacer clic en la fila abrimos edición (comportamiento original)
                                                    onClick={() => {
                                                        setProductForm({
                                                            id: p.id,
                                                            name: p.name,
                                                            category: p.category,
                                                            price_usd: parseFloat(p.price_usd),
                                                            stock: p.stock,
                                                            icon_emoji: p.icon_emoji,
                                                            is_taxable: p.is_taxable,
                                                            barcode: p.barcode || '',
                                                            status: p.status || 'ACTIVE',
                                                            expiration_date: p.expiration_date || '' // <--- CARGAR FECHA GUARDADA
                                                        });
                                                        setIsProductFormOpen(true);
                                                    }}
                                                    className={`p-4 transition-colors group cursor-pointer border-b border-gray-100 last:border-0 ${p.status === 'INACTIVE' ? 'bg-gray-50 opacity-75' : 'hover:bg-blue-50 bg-white'}`}
                                                >
                                                    {/* --- VISTA ESCRITORIO --- */}
                                                    <div className="hidden md:grid grid-cols-12 items-center gap-2">
                                                        <div className="col-span-1 font-bold text-gray-400">#{p.id}</div>
                                                        <div className="col-span-4 font-medium text-gray-800 flex items-center gap-3">
                                                            <div className={p.status === 'INACTIVE' ? 'grayscale opacity-50' : ''}>
                                                                <ProductAvatar icon={p.icon_emoji} size="h-10 w-10 text-xl" />
                                                            </div>
                                                            <div>
                                                                <p className="leading-tight font-bold">{p.name}</p>
                                                                <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                                                                    <span>🕒</span>
                                                                    {p.last_stock_update
                                                                        ? new Date(p.last_stock_update).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                                                                        : 'Sin movimientos'}
                                                                </p>
                                                                <div className="flex gap-2 mt-1">
                                                                    {p.barcode && <span className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 font-mono">||| {p.barcode}</span>}
                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.is_taxable ? 'text-blue-600 bg-blue-50' : 'text-green-600 bg-green-50'}`}>
                                                                        {p.is_taxable ? 'GRAVADO' : 'EXENTO'}
                                                                    </span>
                                                                    {p.status === 'INACTIVE' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">INACTIVO</span>}
                                                                </div>

                                                                {/* SEMÁFORO CORREGIDO PARA LOTES */}
                                                                {(() => {
                                                                    // Si no hay fecha (null o string vacío), asumimos que es mercancía estable o sin fecha registrada
                                                                    if (!p.expiration_date) {
                                                                        return (
                                                                            <div className="mt-1.5 flex items-center gap-1.5 text-[9px] px-2 py-1 rounded border w-fit bg-gray-100 text-gray-500 border-gray-200">
                                                                                <span>♾️</span>
                                                                                <span>Sin Vencimiento</span>
                                                                            </div>
                                                                        );
                                                                    }

                                                                    const expDate = new Date(p.expiration_date);
                                                                    // Corrección de zona horaria simple para evitar que reste un día
                                                                    expDate.setMinutes(expDate.getMinutes() + expDate.getTimezoneOffset());

                                                                    const today = new Date();
                                                                    today.setHours(0, 0, 0, 0); // Ignorar hora actual

                                                                    const diffTime = expDate - today;
                                                                    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                                                                    let badgeClass = "bg-green-50 text-green-700 border-green-200";
                                                                    let icon = "✅";
                                                                    let text = `Vence: ${expDate.toLocaleDateString('es-VE')}`;

                                                                    if (daysLeft < 0) {
                                                                        badgeClass = "bg-red-100 text-red-700 border-red-200 font-black animate-pulse";
                                                                        icon = "💀";
                                                                        text = "¡VENCIDO!";
                                                                    } else if (daysLeft <= 30) {
                                                                        badgeClass = "bg-orange-100 text-orange-700 border-orange-200 font-bold";
                                                                        icon = "⚠️";
                                                                        text = `Vence en ${daysLeft} días`;
                                                                    }

                                                                    return (
                                                                        <div className={`mt-1.5 flex items-center gap-1.5 text-[9px] px-2 py-1 rounded border w-fit transition-all ${badgeClass}`}>
                                                                            <span className="text-xs">{icon}</span>
                                                                            <span>{text}</span>
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </div>
                                                        <div className="col-span-2 text-gray-500 text-xs font-medium">{p.category}</div>
                                                        <div className="col-span-2 text-right">
                                                            <div className="font-black text-gray-800 text-sm">Bs {p.price_ves}</div>
                                                            <div className="text-[10px] font-bold text-gray-500">Ref {parseFloat(p.price_usd).toFixed(2)}</div>
                                                        </div>

                                                        {/* COLUMNA STOCK (Con alerta visual) */}
                                                        <div className="col-span-1 text-center">
                                                            <span className={`font-black px-2 py-1 rounded-lg text-xs ${p.stock <= 5 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-green-50 text-green-700'}`}>
                                                                {p.stock}
                                                            </span>
                                                        </div>

                                                        {/* COLUMNA GESTIÓN (BOTONES ICONOS FLAT UI) */}
                                                        <div className="col-span-2 flex justify-center items-center gap-2">

                                                            {/* 1. ENTRADA (Verde Esmeralda - Growth) */}
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); openMovementModal(p, 'IN'); }}
                                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95 border border-emerald-100 hover:border-transparent"
                                                                title="Registrar Entrada"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                                                            </button>

                                                            {/* 2. SALIDA (Rojo Rose - Alert) */}
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); openMovementModal(p, 'OUT'); }}
                                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95 border border-rose-100 hover:border-transparent"
                                                                title="Registrar Salida"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" /></svg>
                                                            </button>

                                                            {/* 3. EDITAR (Gris Neutro - Edit) */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setProductForm({
                                                                        id: p.id,
                                                                        name: p.name,
                                                                        category: p.category,
                                                                        price_usd: parseFloat(p.price_usd),
                                                                        stock: p.stock,
                                                                        icon_emoji: p.icon_emoji,
                                                                        is_taxable: p.is_taxable,
                                                                        barcode: p.barcode || '',
                                                                        status: p.status || 'ACTIVE',
                                                                        expiration_date: p.expiration_date || '' // <--- CARGAR FECHA GUARDADA
                                                                    });
                                                                    setIsProductFormOpen(true);
                                                                }}
                                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-higea-blue hover:text-white transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95 border border-slate-200 hover:border-transparent"
                                                                title="Editar Ficha"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                            </button>

                                                            {/* 4. KARDEX (Indigo - History) */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    viewKardexHistory(p);
                                                                }}
                                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-500 hover:text-white transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95 border border-indigo-100 hover:border-transparent"
                                                                title="Ver Historial Kardex"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* --- VISTA MÓVIL --- */}
                                                    <div className="md:hidden flex justify-between items-center">
                                                        <div className="flex items-center gap-3">
                                                            <div className={p.status === 'INACTIVE' ? 'grayscale opacity-50' : ''}>
                                                                <ProductAvatar icon={p.icon_emoji} size="h-12 w-12 text-2xl" />
                                                            </div>
                                                            <div>
                                                                <p className="font-bold text-gray-800 text-sm line-clamp-1">{p.name}</p>
                                                                <p className="text-[9px] text-gray-400">🕒 {p.last_stock_update ? new Date(p.last_stock_update).toLocaleDateString() : '-'}</p>
                                                                <div className="flex flex-wrap gap-1 mt-1">
                                                                    {p.barcode && <span className="text-[9px] bg-gray-100 px-1 rounded border">||| {p.barcode}</span>}
                                                                </div>
                                                                {/* SECCIÓN DE PRECIOS ACTUALIZADA (Bs Primero) */}
                                                                <div className="mt-1 flex flex-col items-start">
                                                                    <p className="font-black text-gray-800 text-sm">Bs {p.price_ves}</p>
                                                                    <p className="text-[10px] font-bold text-higea-blue">Ref {parseFloat(p.price_usd).toFixed(2)}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-2">
                                                            <span className={`font-bold px-2 py-0.5 rounded text-xs ${p.stock <= 5 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>{p.stock} Und</span>

                                                            {/* BOTONES MÓVIL (COMPACTOS) */}
                                                            <div className="flex gap-2">
                                                                <button onClick={(e) => { e.stopPropagation(); openMovementModal(p, 'IN'); }} className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center font-bold shadow-sm active:scale-95">+</button>
                                                                <button onClick={(e) => { e.stopPropagation(); openMovementModal(p, 'OUT'); }} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center font-bold shadow-sm active:scale-95">-</button>
                                                                <button onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setProductForm({
                                                                        id: p.id,
                                                                        name: p.name,
                                                                        category: p.category,
                                                                        price_usd: parseFloat(p.price_usd),
                                                                        stock: p.stock,
                                                                        icon_emoji: p.icon_emoji,
                                                                        is_taxable: p.is_taxable,
                                                                        barcode: p.barcode || '',
                                                                        status: p.status || 'ACTIVE',
                                                                        expiration_date: p.expiration_date || '' // <--- CARGAR FECHA GUARDADA
                                                                    });
                                                                    setIsProductFormOpen(true);
                                                                }} className="w-8 h-8 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 flex items-center justify-center shadow-sm active:scale-95">✎</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}

                                            {/* PAGINACIÓN */}
                                            {inventoryTotalPages > 1 && (
                                                <div className="p-4 border-t border-gray-100 flex justify-center items-center gap-4">
                                                    <button onClick={() => setInventoryCurrentPage(prev => Math.max(1, prev - 1))} disabled={inventoryCurrentPage === 1} className="px-3 py-1 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50">Anterior</button>
                                                    <span className="text-xs font-bold text-gray-500">Pág {inventoryCurrentPage} de {inventoryTotalPages}</span>
                                                    <button onClick={() => setInventoryCurrentPage(prev => Math.min(inventoryTotalPages, prev + 1))} disabled={inventoryCurrentPage === inventoryTotalPages} className="px-3 py-1 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50">Siguiente</button>
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>

                        <button onClick={() => { setProductForm({ id: null, name: '', category: '', price_usd: 0.00, stock: 0, is_taxable: true, icon_emoji: '🍔', barcode: '', status: 'ACTIVE', expiration_date: '' }); setIsProductFormOpen(true); }} className="md:hidden fixed bottom-20 right-4 h-14 w-14 bg-higea-blue text-white rounded-full shadow-2xl flex items-center justify-center text-3xl font-light z-40 active:scale-90 transition-transform">+</button>

                        {/* --- MODAL GESTIÓN DE STOCK (MOVIMIENTOS / DEVOLUCIONES / MERMA) --- */}
            {isMovementModalOpen && movementProduct && (
                <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl animate-scale-up overflow-hidden relative">

                        {/* Header con Código de Color */}
                        <div className={`p-6 text-center text-white relative ${movementType === 'IN' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                            <button onClick={() => setIsMovementModalOpen(false)} className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/20 hover:bg-white/30 rounded-full w-8 h-8 flex items-center justify-center font-bold transition-all">✕</button>
                            <h3 className="text-xl font-black uppercase tracking-wider">{movementType === 'IN' ? 'Registrar Entrada' : 'Registrar Salida'}</h3>
                            <p className="text-white/90 text-sm font-medium mt-1">{movementProduct.name}</p>
                        </div>

                        <form onSubmit={handleMovementSubmit} className="p-6 space-y-5">
                            
                            {/* 1. Cantidad (Con Indicador de Disponibilidad) */}
                            <div className="flex flex-col items-center justify-center">
                                <div className="w-1/2 relative text-center">
                                    <input 
                                        type="number" min="1" required autoFocus
                                        value={movementForm.quantity}
                                        onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })}
                                        className={`w-full text-center text-5xl font-black border-b-2 outline-none py-2 bg-transparent transition-colors ${
                                            // Validación Visual Roja si se pasa del stock en salidas
                                            movementType === 'OUT' && parseInt(movementForm.quantity) > movementProduct.stock 
                                            ? 'border-rose-500 text-rose-600' 
                                            : 'border-gray-200 focus:border-gray-800'
                                        }`}
                                        placeholder="0"
                                    />
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mt-1">Unidades</span>
                                </div>

                                {/* MEJORA UX: INDICADOR DE STOCK DISPONIBLE */}
                                {movementType === 'OUT' && (
                                    <div className={`mt-2 text-xs font-bold px-3 py-1 rounded-full border ${
                                        parseInt(movementForm.quantity) > movementProduct.stock 
                                        ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse' 
                                        : 'bg-gray-50 text-gray-500 border-gray-200'
                                    }`}>
                                        Disponibles: {movementProduct.stock}
                                    </div>
                                )}
                            </div>

                            {/* 2. Motivo */}
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Motivo del Movimiento</label>
                                <select 
                                    value={movementForm.reason}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        // Lógica inteligente de Costos para Entradas
                                        let newCost = movementForm.cost_usd;
                                        if(val === 'DONACION_RECIBIDA') newCost = 0;
                                        if(val === 'COMPRA_PROVEEDOR') newCost = movementProduct.price_usd;

                                        setMovementForm({ ...movementForm, reason: val, cost_usd: newCost });
                                        
                                        // Cargar lotes si es salida específica (Merma o Vencimiento)
                                        if (['VENCIMIENTO', 'MERMA_DAÑO'].includes(val)) fetchBatches(movementProduct.id);
                                    }}
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-gray-200"
                                >
                                    {movementType === 'IN' ? (
                                        <>
                                            <option value="COMPRA_PROVEEDOR">📦 Compra / Nuevo Lote</option>
                                            <option value="DEVOLUCION_CLIENTE">↩️ Devolución de Cliente (A Stock)</option>
                                            <option value="AJUSTE_POSITIVO">🔧 Ajuste de Inventario (+)</option>
                                            <option value="DONACION_RECIBIDA">🎁 Donación Recibida</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="VENTA">💰 Venta (FEFO Automático)</option>
                                            <option value="CONSUMO_INTERNO">☕ Consumo Interno</option>
                                            <option value="MERMA_DAÑO">🗑️ Merma / Daño (Seleccionar Lote)</option>
                                            <option value="VENCIMIENTO">📅 Retiro por Vencimiento (Seleccionar Lote)</option>
                                            <option value="AJUSTE_NEGATIVO">🔧 Ajuste de Inventario (-)</option>
                                        </>
                                    )}
                                </select>
                                
                                {movementForm.reason === 'DEVOLUCION_CLIENTE' && (
                                    <p className="text-[10px] text-emerald-600 bg-emerald-50 p-2 rounded mt-2 font-medium">ℹ️ Retorno a inventario disponible.</p>
                                )}
                            </div>

                            {/* 3. Datos Dinámicos (Grid para Entradas) */}
                            {movementType === 'IN' ? (
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Costo Unitario */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Costo Unitario ($)</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                                            <input 
                                                type="number" step="0.01" min="0"
                                                value={movementForm.cost_usd}
                                                onChange={(e) => setMovementForm({...movementForm, cost_usd: e.target.value})}
                                                className={`w-full pl-6 pr-3 py-3 border rounded-xl text-sm font-bold outline-none transition-all ${movementForm.reason === 'DONACION_RECIBIDA' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 focus:border-gray-400'}`}
                                            />
                                        </div>
                                    </div>
                                    {/* Referencia */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Ref. / Factura</label>
                                        <input 
                                            type="text"
                                            value={movementForm.document_ref}
                                            onChange={(e) => setMovementForm({...movementForm, document_ref: e.target.value})}
                                            placeholder="Ej: FAC-001"
                                            className="w-full p-3 border border-gray-200 rounded-xl text-sm outline-none focus:border-gray-400"
                                        />
                                    </div>
                                </div>
                            ) : (
                                // Solo Referencia para Salidas
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Nota de Salida</label>
                                    <input 
                                        type="text"
                                        value={movementForm.document_ref}
                                        onChange={(e) => setMovementForm({...movementForm, document_ref: e.target.value})}
                                        placeholder="Ej: Consumo gerencia"
                                        className="w-full p-3 border border-gray-200 rounded-xl text-sm outline-none focus:border-gray-400"
                                    />
                                </div>
                            )}

                            {/* Fecha Vencimiento (Solo Entradas de Perecederos) */}
                            {movementType === 'IN' && movementProduct.is_perishable && (
                                <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 animate-fade-in-up">
                                    <label className="text-[10px] font-bold text-orange-800 uppercase mb-1 block">Vencimiento del Lote</label>
                                    <input 
                                        type="date"
                                        required={movementForm.reason !== 'DEVOLUCION_CLIENTE'}
                                        value={movementForm.new_expiration}
                                        onChange={(e) => setMovementForm({...movementForm, new_expiration: e.target.value})}
                                        className="w-full p-2 bg-white border border-orange-200 rounded-lg text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-200"
                                    />
                                </div>
                            )}

                            {/* Selector de Lote (Solo Salidas Específicas) */}
                            {movementType === 'OUT' && ['VENCIMIENTO', 'MERMA_DAÑO'].includes(movementForm.reason) && (
                                <div className="animate-fade-in-up">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Seleccione lote a retirar:</p>
                                    <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-xl bg-gray-50 p-2 space-y-1 custom-scrollbar">
                                        {batches.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">Sin lotes disponibles</p> : batches.map(batch => (
                                            <div 
                                                key={batch.id} 
                                                onClick={() => setSelectedBatch(batch.id)}
                                                className={`p-2 rounded-lg text-xs flex justify-between cursor-pointer border transition-all ${selectedBatch === batch.id ? 'bg-rose-50 border-rose-500 text-rose-700 ring-1 ring-rose-200' : 'bg-white border-gray-200 hover:border-gray-300'}`}
                                            >
                                                <span>📅 Vence: {batch.expiration_date ? new Date(batch.expiration_date).toLocaleDateString() : 'N/A'}</span>
                                                <span className="font-bold">Cant: {batch.stock}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {!selectedBatch && <p className="text-[10px] text-rose-500 mt-1 text-right">* Obligatorio</p>}
                                </div>
                            )}

                            <button 
                                type="submit"
                                // Bloqueamos el botón si intenta sacar más de lo que tiene
                                disabled={movementType === 'OUT' && parseInt(movementForm.quantity) > movementProduct.stock}
                                className={`w-full py-4 rounded-xl text-white font-bold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${movementType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                            >
                                {movementType === 'IN' ? 'CONFIRMAR ENTRADA' : 'CONFIRMAR SALIDA'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

                        {/* --- MODAL FORMULARIO DE PRODUCTO (CON VALIDACIÓN LEGAL Y CAPITALIZACIÓN AUTOMÁTICA) --- */}
            {isProductFormOpen && (
                <div className="fixed inset-0 z-[70] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-[32px] w-full max-w-4xl shadow-2xl shadow-slate-900/50 overflow-hidden flex flex-col max-h-[95vh] animate-scale-up border border-slate-100">

                        {/* 1. Header Minimalista */}
                        <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-white/90 backdrop-blur-xl z-20 sticky top-0">
                            <div>
                                <h3 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                                    {productForm.id ? (
                                        <> <span className="bg-blue-100 text-blue-600 p-2 rounded-xl text-lg">✏️</span> <span>Editar Ficha Técnica</span> </>
                                    ) : (
                                        <> <span className="bg-green-100 text-green-600 p-2 rounded-xl text-lg">✨</span> <span>Nuevo Producto</span> </>
                                    )}
                                </h3>
                                <p className="text-sm text-slate-400 font-medium mt-1 ml-12">Gestión de activos y cumplimiento fiscal</p>
                            </div>
                            <button onClick={() => setIsProductFormOpen(false)} className="w-10 h-10 flex items-center justify-center bg-slate-50 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all transform hover:rotate-90 hover:scale-110 shadow-sm">✕</button>
                        </div>

                        {/* Cuerpo del Formulario */}
                        <div className="p-8 overflow-y-auto custom-scrollbar bg-slate-50/30">
                            <form onSubmit={(e) => { saveProduct(e).then(() => setIsProductFormOpen(false)); }}>

                                {/* GRUPO A: IDENTIDAD (IMAGEN Y DATOS BÁSICOS) */}
                                <div className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-100 mb-8 relative">
                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                        1. Identidad del Producto
                                    </h4>

                                    <div className="flex flex-col lg:flex-row gap-8">
                                        {/* COLUMNA IZQUIERDA: FOTO */}
                                        <div className="w-full lg:w-1/3 shrink-0 flex flex-col gap-4">
                                            <div
                                                className="aspect-square w-full rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 relative overflow-hidden group hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer shadow-inner flex items-center justify-center"
                                                onClick={() => document.getElementById('file-upload').click()}
                                            >
                                                {productForm.icon_emoji && productForm.icon_emoji.startsWith('data:image') ? (
                                                    <>
                                                        <img src={productForm.icon_emoji} alt="Producto" className="w-full h-full object-cover animate-fade-in" />
                                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white backdrop-blur-sm">
                                                            <span className="text-2xl mb-2">🔄</span>
                                                            <span className="text-xs font-bold uppercase">Cambiar Foto</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="text-center group-hover:scale-110 transition-transform">
                                                        {productForm.icon_emoji && !productForm.icon_emoji.startsWith('data:image') ? (
                                                            <span className="text-[6rem] leading-none drop-shadow-md">{productForm.icon_emoji}</span>
                                                        ) : (
                                                            <>
                                                                <span className="text-5xl mb-3 block">📷</span>
                                                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Subir Foto</span>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                                <input id="file-upload" type="file" accept="image/*" className="hidden" onChange={(e) => handleImageRead(e.target.files[0], (base64) => setProductForm({ ...productForm, icon_emoji: base64 }))} />
                                            </div>

                                            {/* Botón Borrar Foto */}
                                            {productForm.icon_emoji?.startsWith('data:image') && (
                                                <button type="button" onClick={(e) => { e.stopPropagation(); setProductForm({ ...productForm, icon_emoji: '📦' }); }} className="text-[10px] font-bold text-red-500 hover:bg-red-50 py-2 rounded-lg transition-colors">
                                                    🗑️ Eliminar Foto
                                                </button>
                                            )}

                                            {/* Selector Rápido de Emojis */}
                                            {!productForm.icon_emoji?.startsWith('data:image') && (
                                                <div className="h-40 overflow-y-auto custom-scrollbar bg-slate-50 rounded-xl p-2 border border-slate-100 shadow-inner">
                                                    <div className="grid grid-cols-5 gap-1.5 place-items-center">
                                                        {EMOJI_OPTIONS.map((emoji, index) => (
                                                            <button key={index} type="button" onClick={() => setProductForm({ ...productForm, icon_emoji: emoji })} className={`w-10 h-10 flex items-center justify-center text-xl rounded-lg transition-all active:scale-95 ${productForm.icon_emoji === emoji ? 'bg-white shadow-md ring-2 ring-blue-400 scale-110' : 'hover:bg-white hover:shadow-sm opacity-80 hover:opacity-100'}`}>
                                                                {emoji}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* COLUMNA DERECHA: TEXTOS (CON CAPITALIZACIÓN ACTIVA) */}
                                        <div className="flex-1 flex flex-col gap-6">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">Nombre Comercial (*)</label>
                                                <input 
                                                    type="text" 
                                                    name="name" 
                                                    placeholder="Ej: Harina P.A.N. 1kg" 
                                                    value={productForm.name} 
                                                    onChange={(e) => {
                                                        // LÓGICA DE CAPITALIZACIÓN ACTIVA:
                                                        // 1. Permite escribir todo.
                                                        // 2. Convierte la primera letra de cada palabra a MAYÚSCULA automáticamente.
                                                        const val = e.target.value;
                                                        
                                                        // Esta expresión regular capitaliza la primera letra después de un inicio o espacio
                                                        const formatted = val.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
                                                        
                                                        setProductForm({ ...productForm, name: formatted });
                                                    }}
                                                    className="w-full h-14 px-5 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none font-bold text-slate-700 text-lg placeholder-slate-300 transition-all" 
                                                    required 
                                                    autoFocus 
                                                    autoComplete="off"
                                                />
                                                {/* Pequeña ayuda visual */}
												<p className="text-[9px] text-slate-400 mt-1 pl-2">
                                                Incluya marca, peso o medida (Ej: 1kg, 2L, 500g).
                                            </p>
                                            </div>

                                            <div className="grid grid-cols-2 gap-5">
                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">Categoría</label>
                                                    <input type="text" list="category-list" name="category" value={productForm.category} onChange={handleProductFormChange} className="w-full h-12 px-4 border border-slate-200 rounded-xl outline-none text-sm focus:border-blue-500" placeholder="Seleccionar..." />
                                                    <datalist id="category-list">{uniqueCategories.map(c => <option key={c} value={c} />)}</datalist>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">Código Barras</label>
                                                    <input type="text" name="barcode" value={productForm.barcode} onChange={handleProductFormChange} className="w-full h-12 px-4 border border-slate-200 rounded-xl outline-none text-sm font-mono text-slate-500" placeholder="Escanee..." />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* GRUPO B: COSTOS Y PRECIOS (MONEDA DUAL LEGAL) */}
                                <div className="mb-8">
                                    <div className="relative overflow-hidden bg-white border border-slate-200 rounded-[24px] shadow-xl shadow-slate-200/50">
                                        <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-3 border-b border-slate-100 flex justify-between items-center">
                                            <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> Estructura de Costos
                                            </h4>
                                            <div className="text-[10px] font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                                Tasa BCV: {formatBs(bcvRate)}
                                            </div>
                                        </div>

                                        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100">
                                            {/* PRECIO REF (BASE DEL SISTEMA) */}
                                            <div className="flex-1 p-6 group hover:bg-blue-50/20 transition-colors relative">
                                                <label className="text-[10px] font-bold text-blue-500 uppercase tracking-wide mb-2 block">Precio (Ref) *</label>
                                                <div className="relative flex items-baseline">
                                                    <span className="text-3xl font-light text-slate-300 mr-2">$</span>
                                                    <input 
                                                        type="number" step="0.01" min="0" required name="price_usd"
                                                        value={productForm.price_usd} 
                                                        onChange={(e) => setProductForm(prev => ({ ...prev, price_usd: e.target.value }))}
                                                        className="w-full bg-transparent text-4xl font-black text-slate-800 outline-none placeholder:text-slate-200 font-mono tracking-tight"
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-2 font-medium">Base de cálculo</p>
                                            </div>

                                            {/* ÍCONO DE CONVERSIÓN */}
                                            <div className="relative flex items-center justify-center -my-3 md:my-0">
                                                <div className="absolute z-10 bg-white border border-slate-100 text-slate-300 p-2 rounded-full shadow-lg">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                                </div>
                                            </div>

                                            {/* PRECIO BS (CALCULADO AUTO) */}
                                            <div className="flex-1 p-6 bg-slate-50/30 group hover:bg-slate-50 transition-colors relative">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 block">Equivalente (Bs)</label>
                                                <div className="relative flex items-baseline">
                                                    <span className="text-2xl font-light text-slate-300 mr-2">Bs</span>
                                                    <input 
                                                        type="text" 
                                                        value={productForm.price_usd ? formatBs(parseFloat(productForm.price_usd) * bcvRate) : ''}
                                                        onChange={(e) => {
                                                            let valClean = e.target.value.replace(/\./g, '').replace(',', '.');
                                                            let valBs = parseFloat(valClean);
                                                            if (!isNaN(valBs) && bcvRate > 0) {
                                                                setProductForm(prev => ({ ...prev, price_usd: (valBs / bcvRate).toFixed(2) }));
                                                            } else {
                                                                setProductForm(prev => ({ ...prev, price_usd: '' }));
                                                            }
                                                        }}
                                                        className="w-full bg-transparent text-3xl font-bold text-slate-600 outline-none placeholder:text-slate-200 font-mono"
                                                        placeholder="0,00"
                                                    />
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-2 font-medium flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Actualización auto. (BCV)
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* GRUPO C: CONTROL LOGÍSTICO Y FISCAL */}
                                <div className="bg-white p-6 rounded-[24px] border border-slate-100 shadow-sm">
                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                        3. Control de Inventario y Fiscal
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                                        {/* COLUMNA IZQ: STOCK BLINDADO */}
                                        <div className="space-y-6">
                                            <div className={`relative group p-4 rounded-xl border ${productForm.id ? 'bg-slate-100 border-slate-200' : 'bg-white border-blue-200'}`}>
                                                <div className="flex justify-between mb-2">
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Existencia Física</label>
                                                    {productForm.id && <span className="text-[10px] bg-slate-200 text-slate-600 px-2 rounded-full font-bold">🔒 BLOQUEADO</span>}
                                                </div>
                                                <div className="relative">
                                                    <input 
                                                        type="number" 
                                                        disabled={!!productForm.id} // ⚠️ OBLIGATORIO POR LEY: NO EDITAR STOCK SIN SOPORTE
                                                        value={productForm.stock} 
                                                        onChange={e => setProductForm({ ...productForm, stock: e.target.value })}
                                                        className="w-full bg-transparent text-2xl font-black outline-none disabled:text-slate-400 disabled:cursor-not-allowed"
                                                        placeholder="0"
                                                    />
                                                    {productForm.id && <span className="absolute right-0 top-1/2 -translate-y-1/2 text-2xl opacity-20">🔒</span>}
                                                </div>
                                                {/* Mensaje Legal Educativo */}
                                                {productForm.id ? (
                                                    <div className="mt-2 text-[10px] text-slate-500 leading-tight flex gap-2 items-start bg-slate-200/50 p-2 rounded-lg border border-slate-200">
                                                        <span>⚖️</span>
                                                        <span>Por normativa (Providencia 0071), el stock no se edita directamente. Use <b>"Registrar Entrada/Salida"</b> para generar la traza de auditoría.</span>
                                                    </div>
                                                ) : (
                                                    <p className="text-[10px] text-blue-500 mt-1 font-medium">* Inventario inicial de apertura.</p>
                                                )}
                                            </div>

                                            {/* Vencimiento */}
                                            <div className={`p-4 rounded-xl border ${productForm.is_perishable ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-200'}`}>
                                                <label className="flex items-center gap-2 cursor-pointer mb-2">
                                                    <input type="checkbox" className="accent-orange-500 w-4 h-4" checked={productForm.is_perishable} onChange={(e) => setProductForm(p => ({ ...p, is_perishable: e.target.checked }))} />
                                                    <span className={`text-xs font-bold uppercase ${productForm.is_perishable ? 'text-orange-700' : 'text-slate-400'}`}>Producto Perecedero</span>
                                                </label>
                                                {productForm.is_perishable && (
                                                    <input type="date" name="expiration_date" value={productForm.expiration_date || ''} onChange={handleProductFormChange} className="w-full p-2 rounded border border-orange-200 text-sm font-bold text-gray-700" />
                                                )}
                                            </div>
                                        </div>

                                        {/* COLUMNA DER: FISCALIDAD (IVA) */}
                                        <div className="space-y-4">
                                            {/* Alerta de IVA */}
                                            <div className={`p-4 rounded-xl border flex flex-col gap-2 transition-colors ${productForm.id ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-slate-200'}`}>
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase block">Impuesto (IVA)</label>
                                                        <span className="text-[10px] text-slate-400">Régimen General (16%)</span>
                                                    </div>
                                                    <select name="is_taxable" value={productForm.is_taxable} onChange={handleProductFormChange} className="bg-white border text-xs font-bold text-slate-700 rounded-lg py-1 px-2 focus:ring-2 focus:ring-blue-100 cursor-pointer">
                                                        <option value="true">SÍ (Gravado)</option>
                                                        <option value="false">NO (Exento)</option>
                                                    </select>
                                                </div>
                                                {productForm.id && (
                                                    <p className="text-[9px] text-yellow-700 bg-yellow-100/50 p-1.5 rounded border border-yellow-200">
                                                        ⚠️ Advertencia: Cambiar el estatus fiscal de un producto activo puede afectar el histórico del Libro de Ventas.
                                                    </p>
                                                )}
                                            </div>

                                            <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                                                <div><label className="text-[10px] font-bold text-slate-500 uppercase block">Estatus</label></div>
                                                <select name="status" value={productForm.status} onChange={handleProductFormChange} className={`border-none text-xs font-bold rounded-lg py-2 pl-3 pr-8 ${productForm.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                                    <option value="ACTIVE">ACTIVO</option>
                                                    <option value="INACTIVE">INACTIVO</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Botón Guardar Flotante */}
                                <div className="pt-6 sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pb-2 z-20">
                                    <button type="submit" className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-2xl shadow-xl hover:scale-[1.01] transition-all flex justify-center items-center gap-3 text-lg">
                                        <span>💾</span>
                                        <span>{productForm.id ? 'Guardar Cambios' : 'Registrar Producto'}</span>
                                    </button>
                                </div>

                            </form>
                        </div>
                    </div>
                </div>
            )}
                    </div>
                ) : view === 'ADVANCED_REPORTS' ? (
                    /* --- VISTA: INTELIGENCIA DE NEGOCIOS (REDISEÑO PRO + DRILL DOWN + CIERRES) --- */
                    <div className="p-4 md:p-8 overflow-y-auto h-full animate-slide-up bg-slate-50">

                        {/* CABECERA Y NAVEGACIÓN */}
                        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-8 gap-6">
                            <div>
                                <h2 className="text-3xl font-black text-slate-800 tracking-tight">Inteligencia de Negocios</h2>
                                <p className="text-slate-500 mt-1 font-medium">
                                    {reportTab === 'DASHBOARD' ? 'Análisis de rendimiento y KPIs' :
                                        reportTab === 'SALES' ? 'Explorador Detallado de Transacciones' :
                                            reportTab === 'INVENTORY' ? 'Auditoría Completa de Inventario' : 'Historial de Cierres de Caja'}
                                </p>
                            </div>

                            {/* BARRA DE PESTAÑAS (TABS) */}
                            <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200 overflow-x-auto max-w-full">
                                <button
                                    onClick={() => setReportTab('DASHBOARD')}
                                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap ${reportTab === 'DASHBOARD' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    <span>📊</span> Dashboard
                                </button>
                                <button
                                    onClick={() => {
                                        setReportTab('SALES');
                                        fetchSalesDetail();
                                    }}
                                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap ${reportTab === 'SALES' ? 'bg-higea-blue text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    <span>📑</span> Ventas
                                </button>
                                <button
                                    onClick={() => {
                                        setReportTab('INVENTORY');
                                        fetchInventoryDetail();
                                    }}
                                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap ${reportTab === 'INVENTORY' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    <span>📦</span> Inventario
                                </button>
                                {/* NUEVO BOTÓN DE CIERRES */}
                                <button
    onClick={() => fetchClosingsHistory()}
    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap ${reportTab === 'CLOSINGS' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
>
    <span>🔐</span> Cierres
</button>
                            </div>
                        </div>

                        {/* --- CONTENIDO DINÁMICO (PESTAÑAS) --- */}

                        {/* PESTAÑA 1: DASHBOARD */}
                        {reportTab === 'DASHBOARD' && (
                            <>
                                {/* CONTROL DE FECHAS */}
                                <div className="flex flex-wrap items-center gap-3 bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200 mb-8 w-fit ml-auto">
                                    <div className="flex items-center bg-slate-100 rounded-xl px-4 py-2 border border-slate-200">
                                        <span className="text-xs font-bold text-slate-400 mr-2 uppercase tracking-wider">Desde</span>
                                        <input type="date" value={reportDateRange.start} onChange={(e) => setReportDateRange(prev => ({ ...prev, start: e.target.value }))} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer" />
                                    </div>
                                    <div className="text-slate-300 font-bold">→</div>
                                    <div className="flex items-center bg-slate-100 rounded-xl px-4 py-2 border border-slate-200">
                                        <span className="text-xs font-bold text-slate-400 mr-2 uppercase tracking-wider">Hasta</span>
                                        <input type="date" value={reportDateRange.end} onChange={(e) => setReportDateRange(prev => ({ ...prev, end: e.target.value }))} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer" />
                                    </div>
                                    <div className="h-8 w-px bg-slate-200 mx-1"></div>

                                    <button onClick={fetchAdvancedReport} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 flex items-center gap-2">
                                        <span>🔄</span> <span className="hidden sm:inline">Actualizar</span>
                                    </button>

                                    <button onClick={exportReportToPDF} className="bg-higea-red hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-md transition-all active:scale-95 flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                                        <span>PDF Reporte</span>
                                    </button>

                                    <button onClick={() => downloadCSV(analyticsData.salesOverTime, 'Resumen_Gerencial')} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-md transition-all active:scale-95 flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                        <span className="hidden sm:inline">Excel</span>
                                    </button>
                                </div>

                                {analyticsData ? (
                                    <div className="space-y-8 pb-20">
                                        {/* 1. SECCIÓN KPI */}
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            {/* KPI 1: Ingresos */}
                                            <div onClick={fetchSalesDetail} className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-6 text-white shadow-xl shadow-blue-200 relative overflow-hidden group cursor-pointer active:scale-95 transition-all">
                                                <div className="absolute right-0 top-0 h-32 w-32 bg-white opacity-5 rounded-full -mr-10 -mt-10 blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                                                <div className="relative z-10">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                                        </div>
                                                        <span className="text-blue-200 text-xs font-bold bg-blue-900/30 px-2 py-1 rounded-lg flex items-center gap-1">Ver Detalle <span className="text-lg">→</span></span>
                                                    </div>
                                                    <p className="text-4xl font-black tracking-tight mb-1">
                                                        Ref {analyticsData.salesOverTime.reduce((acc, day) => acc + parseFloat(day.total_usd), 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-blue-200 text-sm font-medium">Dinero Recaudado (Caja)</p>
                                                </div>
                                            </div>

                                            {/* KPI 2: Transacciones */}
                                            <div onClick={fetchSalesDetail} className="bg-white rounded-3xl p-6 border border-slate-100 shadow-lg relative overflow-hidden group cursor-pointer active:scale-95 transition-all">
                                                <div className="absolute right-0 bottom-0 h-24 w-24 bg-purple-50 rounded-full -mr-5 -mb-5 group-hover:scale-110 transition-transform"></div>
                                                <div className="relative z-10">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="bg-purple-100 p-3 rounded-2xl"><svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg></div>
                                                        <span className="text-purple-600 text-xs font-bold bg-purple-50 px-2 py-1 rounded-lg">Ver Operaciones →</span>
                                                    </div>
                                                    <p className="text-4xl font-black text-slate-800 tracking-tight mb-1">{analyticsData.salesOverTime.reduce((acc, day) => acc + parseInt(day.tx_count || 0), 0)}</p>
                                                    <p className="text-slate-400 text-sm font-medium">Operaciones Realizadas</p>
                                                </div>
                                            </div>

                                            {/* KPI 3: Promedio */}
                                            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-lg relative overflow-hidden group">
                                                <div className="absolute right-0 bottom-0 h-24 w-24 bg-emerald-50 rounded-full -mr-5 -mb-5 group-hover:scale-110 transition-transform"></div>
                                                <div className="relative z-10">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="bg-emerald-100 p-3 rounded-2xl"><svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg></div>
                                                        <span className="text-emerald-600 text-xs font-bold bg-emerald-50 px-2 py-1 rounded-lg">KPI Clave</span>
                                                    </div>
                                                    <p className="text-4xl font-black text-slate-800 tracking-tight mb-1">
                                                        Ref {(() => {
                                                            const total = analyticsData.salesOverTime.reduce((acc, day) => acc + parseFloat(day.total_usd), 0);
                                                            const count = analyticsData.salesOverTime.reduce((acc, day) => acc + parseInt(day.tx_count || 0), 0);
                                                            return count > 0 ? (total / count).toLocaleString('es-VE', { minimumFractionDigits: 2 }) : '0.00';
                                                        })()}
                                                    </p>
                                                    <p className="text-slate-400 text-sm font-medium">Promedio por Venta</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* 2. GRÁFICAS */}
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            <div onClick={fetchInventoryDetail} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 cursor-pointer hover:border-blue-200 transition-colors group">
                                                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-50">
                                                    <div className="bg-yellow-100 p-2 rounded-xl text-yellow-600 text-xl">🏆</div>
                                                    <div>
                                                        <h3 className="font-bold text-slate-800 text-lg group-hover:text-blue-600 transition-colors">Productos Estrella</h3>
                                                        <p className="text-xs text-slate-400">Clic para ver Inventario Completo</p>
                                                    </div>
                                                </div>
                                                <SimpleBarChart data={analyticsData.topProducts} labelKey="name" valueKey="total_qty" colorClass="bg-yellow-400" formatMoney={false} />
                                            </div>

                                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                                                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-50">
                                                    <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600 text-xl">🏷️</div>
                                                    <div><h3 className="font-bold text-slate-800 text-lg">Rendimiento por Categoría</h3><p className="text-xs text-slate-400">Ingresos generados (Ref)</p></div>
                                                </div>
                                                <SimpleBarChart data={analyticsData.salesByCategory} labelKey="category" valueKey="total_usd" colorClass="bg-indigo-500" formatMoney={true} />
                                            </div>
                                        </div>

                                        {/* 3. DEUDORES Y EVOLUCIÓN */}
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 lg:col-span-1">
                                                <div className="flex items-center gap-3 mb-4">
                                                    <div className="bg-red-100 p-2 rounded-xl text-red-600 text-lg">📉</div>
                                                    <h3 className="font-bold text-slate-800">Top Deudores</h3>
                                                </div>
                                                <div className="space-y-4">
                                                    {topDebtors.slice(0, 5).map((debtor, idx) => (
                                                        <div key={idx} className="flex justify-between items-center p-3 rounded-xl bg-slate-50 border border-slate-100">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">{debtor.full_name.charAt(0)}</div>
                                                                <div><p className="text-xs font-bold text-slate-700 truncate w-24">{debtor.full_name}</p><p className="text-[10px] text-slate-400">Pendiente</p></div>
                                                            </div>
                                                            <span className="font-black text-red-500 text-sm">Ref {parseFloat(debtor.debt).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                    {topDebtors.length === 0 && <p className="text-center text-slate-400 text-sm py-4">Sin deudas pendientes 🎉</p>}
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 lg:col-span-2 overflow-hidden flex flex-col">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="bg-slate-100 p-2 rounded-xl text-slate-600 text-lg">📅</div>
                                                    <h3 className="font-bold text-slate-800 text-lg">Evolución Diaria Detallada</h3>
                                                </div>
                                                <div className="overflow-x-auto custom-scrollbar flex-1">
                                                    <table className="w-full text-left text-sm text-slate-600">
                                                        <thead>
                                                            <tr className="border-b-2 border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-wider">
                                                                <th className="px-4 py-3">Fecha</th>
                                                                <th className="px-4 py-3 text-center">Ops</th>
                                                                <th className="px-4 py-3 text-right">Total Ref</th>
                                                                <th className="px-4 py-3 text-right">Total Bs</th>
                                                                <th className="px-4 py-3 text-center hidden sm:table-cell">Volumen</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-50">
                                                            {analyticsData.salesOverTime.map((day, idx) => {
                                                                const maxDay = Math.max(...analyticsData.salesOverTime.map(d => parseFloat(d.total_usd)));
                                                                const percent = maxDay > 0 ? (parseFloat(day.total_usd) / maxDay) * 100 : 0;
                                                                return (
                                                                    <tr key={idx} className="hover:bg-blue-50/50 transition-colors">
                                                                        <td className="px-4 py-3 font-medium text-slate-800">{new Date(day.sale_date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                                                        <td className="px-4 py-3 text-center"><span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-xs font-bold">{day.tx_count}</span></td>
                                                                        <td className="px-4 py-3 text-right font-black text-higea-blue">Ref {parseFloat(day.total_usd).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                                                                        <td className="px-4 py-3 text-right text-slate-400 font-mono text-xs">Bs {parseFloat(day.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 0 })}</td>
                                                                        <td className="px-4 py-3 align-middle hidden sm:table-cell w-32">
                                                                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                                                <div className={`h-full rounded-full ${percent > 80 ? 'bg-green-500' : percent > 40 ? 'bg-blue-500' : 'bg-slate-400'}`} style={{ width: `${percent}%` }}></div>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-96 text-slate-400">
                                        <div className="w-16 h-16 border-4 border-slate-200 border-t-higea-blue rounded-full animate-spin mb-6"></div>
                                        <p className="font-bold text-lg text-slate-500 animate-pulse">Procesando Inteligencia de Negocios...</p>
                                    </div>
                                )}
                            </>
                        )}

                        {/* PESTAÑA 2: DETALLE DE VENTAS */}
                        {reportTab === 'SALES' && (
                            <div className="bg-white rounded-3xl shadow-lg border border-slate-200 overflow-hidden animate-fade-in flex flex-col h-[80vh]">
                                {/* BARRA DE HERRAMIENTAS */}
                                <div className="p-4 border-b border-slate-100 flex flex-col xl:flex-row justify-between items-center gap-4 bg-slate-50">
                                    <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm w-full md:w-auto">
                                        <span className="text-xs font-bold text-gray-400 pl-2">Rango:</span>
                                        <input type="date" value={reportDateRange.start} onChange={(e) => setReportDateRange(prev => ({ ...prev, start: e.target.value }))} className="text-xs font-bold text-gray-700 outline-none bg-transparent px-1 py-1 cursor-pointer" />
                                        <span className="text-gray-400 font-bold">→</span>
                                        <input type="date" value={reportDateRange.end} min={reportDateRange.start} onChange={(e) => setReportDateRange(prev => ({ ...prev, end: e.target.value }))} className="text-xs font-bold text-gray-700 outline-none bg-transparent px-1 py-1 cursor-pointer" />
                                        <button onClick={() => fetchSalesDetail()} className="bg-higea-blue text-white p-2 rounded-lg hover:bg-blue-700 transition-colors shadow-sm" title="Buscar ventas en este rango">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                        </button>
                                    </div>

                                    <div className="relative w-full md:w-80">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                                        <input type="text" placeholder="Buscar (Cliente, ID, Ref)..." value={salesSearch} onChange={(e) => setSalesSearch(e.target.value)} className="w-full border p-2.5 pl-10 rounded-xl text-sm outline-none focus:border-higea-blue shadow-sm bg-white" />
                                        {isSearchingSales && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <div className="w-4 h-4 border-2 border-higea-blue border-t-transparent rounded-full animate-spin"></div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                                        <span className="text-xs font-bold text-slate-500 uppercase bg-white px-3 py-1.5 rounded-lg border border-slate-200 hidden md:block">
                                            {detailedSales.length} Reg
                                        </span>
                                        <button onClick={() => downloadCSV(detailedSales, 'Reporte_Ventas')} className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-700 shadow-md flex items-center gap-2 transition-all active:scale-95 whitespace-nowrap w-full md:w-auto justify-center">
                                            <span>📥</span> Exportar Excel (.csv)
                                        </button>
                                    </div>
                                </div>

                                {/* TABLA DE VENTAS */}
                                <div className="overflow-x-auto flex-1 custom-scrollbar bg-slate-50/50">
                                    <table className="w-full text-left text-xs text-gray-600">
                                        <thead className="bg-white text-gray-500 font-bold uppercase sticky top-0 shadow-sm z-10 text-[11px] tracking-wider">
                                            <tr>
                                                <th className="px-6 py-4 bg-slate-50 border-b border-slate-100">Fecha / Hora</th>
                                                <th className="px-6 py-4 bg-slate-50 border-b border-slate-100">N° Control</th>
                                                <th className="px-6 py-4 bg-slate-50 border-b border-slate-100">Cliente</th>
                                                <th className="px-6 py-4 bg-slate-50 border-b border-slate-100 text-center">Método</th>
                                                <th className="px-6 py-4 bg-slate-50 border-b border-slate-100 text-right">Total Bs</th>
                                                <th className="px-6 py-4 bg-slate-50 border-b border-slate-100 text-right">Total Ref</th>
                                                <th className="px-6 py-4 bg-slate-50 border-b border-slate-100 text-center">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 bg-white">
                                            {(() => {
                                                const ITEMS_PER_PAGE = 50;
                                                const filteredData = detailedSales;
                                                const indexOfLast = salesReportPage * ITEMS_PER_PAGE;
                                                const indexOfFirst = indexOfLast - ITEMS_PER_PAGE;
                                                const currentData = filteredData.slice(indexOfFirst, indexOfLast);
                                                const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);

                                                if (currentData.length === 0) return <tr><td colSpan="7" className="p-10 text-center italic text-gray-400">Sin resultados</td></tr>;

                                                return (
                                                    <>
                                                        {currentData.map((sale) => (
                                                            <tr key={sale.id} onClick={() => showSaleDetail(sale)} className="hover:bg-blue-50 transition-colors cursor-pointer group">
                                                                <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                                                                    {new Date(sale.created_at || sale["Fecha Hora"]).toLocaleDateString()} <span className="text-[10px] text-gray-400 ml-1">{new Date(sale.created_at || sale["Fecha Hora"]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                </td>
                                                                <td className="px-6 py-4 font-mono font-bold text-higea-blue">#{sale.id || sale["Nro Factura"]}</td>
                                                                <td className="px-6 py-4">
                                                                    <div className="font-bold text-gray-700 text-sm">{sale.client_name || sale["Cliente"]}</div>
                                                                    <div className="text-[10px] text-gray-400">{sale.client_id || sale["Documento"]}</div>
                                                                </td>
                                                                <td className="px-6 py-4 text-center">
                                                                    <span className="px-2 py-1 bg-gray-100 border border-gray-200 rounded text-[10px] font-medium text-gray-500 truncate max-w-[100px] inline-block">
                                                                        {sale.payment_method || sale["Metodo Pago"]}
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-4 text-right font-medium text-gray-500">Bs {parseFloat(sale.total_ves || sale["Total Bs"]).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                                                                <td className="px-6 py-4 text-right"><span className="font-black text-slate-800 text-sm bg-slate-100 px-2 py-1 rounded">Ref {parseFloat(sale.total_usd || sale["Total USD"]).toFixed(2)}</span></td>
                                                                <td className="px-6 py-4 text-center">
                                                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${(sale.status || sale["Estado"]) === 'PAGADO' ? 'bg-green-100 text-green-700' : (sale.status || sale["Estado"]) === 'PENDIENTE' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                                                        {sale.status || sale["Estado"]}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {totalPages > 1 && (
                                                            <tr>
                                                                <td colSpan="7" className="p-4 bg-slate-50 border-t border-slate-200">
                                                                    <div className="flex justify-center items-center gap-4">
                                                                        <button onClick={(e) => { e.stopPropagation(); setSalesReportPage(p => Math.max(1, p - 1)); }} disabled={salesReportPage === 1} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold disabled:opacity-50 hover:bg-gray-50">Anterior</button>
                                                                        <span className="text-xs font-bold text-gray-600">Página {salesReportPage} de {totalPages}</span>
                                                                        <button onClick={(e) => { e.stopPropagation(); setSalesReportPage(p => Math.min(totalPages, p + 1)); }} disabled={salesReportPage === totalPages} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold disabled:opacity-50 hover:bg-gray-50">Siguiente</button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* --- 3. TABLA DE AUDITORÍA DE INVENTARIO (CON TUS VARIABLES EXISTENTES) --- */}
                    {reportTab === 'INVENTORY' && (
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
                            
                            {/* Encabezado: Título + TU Buscador + Botones */}
                            <div className="p-5 border-b border-gray-100 flex flex-col lg:flex-row justify-between items-center gap-4 bg-gray-50">
                                
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                        📦 Auditoría de Existencias
                                        {/* Usamos inventoryFilteredData para el contador real */}
                                        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                                            {inventoryFilteredData.length} Ítems
                                        </span>
                                    </h3>
                                    <p className="text-xs text-gray-500">Valorización en tiempo real (Bs y Ref)</p>
                                </div>

                                {/* LA BONDAD RESTAURADA: Tu buscador conectado a 'inventorySearch' */}
                                <div className="flex-1 max-w-md w-full relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                                    <input 
                                        type="text" 
                                        placeholder="Buscar por nombre, código o categoría..." 
                                        // Usamos TU estado existente
                                        value={inventorySearch}
                                        onChange={(e) => setInventorySearch(e.target.value)}
                                        className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-50 outline-none transition-all"
                                    />
                                    {inventorySearch && (
                                        <button 
                                            onClick={() => setInventorySearch('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs font-bold"
                                        >
                                            BORRAR
                                        </button>
                                    )}
                                </div>
                                
                                <div className="flex gap-2">
                                    <button 
                                        // El PDF legal imprime TODO el inventario (detailedInventory) por normativa
                                        onClick={() => printInventoryAuditPDF(detailedInventory)} 
                                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-700 shadow-md transition-all active:scale-95"
                                    >
                                        <span>📄</span> PDF Legal
                                    </button>
                                    <button 
                                        // EXCEL INTELIGENTE: Exporta solo lo que ves en pantalla (inventoryFilteredData)
                                        onClick={() => downloadCSV(inventoryFilteredData, 'Auditoria_Inventario')} 
                                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-xs font-bold rounded-xl hover:bg-green-700 shadow-md transition-all active:scale-95"
                                    >
                                        <span>📊</span> Excel / CSV
                                    </button>
									<button 
                                        onClick={printPhysicalCountReport} 
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white text-xs font-bold rounded-xl hover:bg-slate-800 shadow-md transition-all active:scale-95"
                                        title="Imprimir formato para contar manualmente en almacén"
                                    >
                                        <span>📋</span> Conteo Físico
                                    </button>
                                </div>
                            </div>

                            {/* Tabla de Datos */}
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-gray-600">
                                    <thead className="bg-slate-100 text-gray-500 uppercase font-bold text-xs">
                                        <tr>
                                            <th className="px-6 py-3">Producto</th>
                                            <th className="px-6 py-3">Categoría</th>
                                            <th className="px-6 py-3 text-center">Stock</th>
                                            <th className="px-6 py-3 text-right">Costo Unit. (Bs)</th>
                                            <th className="px-6 py-3 text-right">Valor Total (Bs)</th>
                                            <th className="px-6 py-3 text-right">Valor Total (Ref)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {inventoryFilteredData.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="p-8 text-center text-gray-400 italic">
                                                    No se encontraron productos con esa búsqueda.
                                                </td>
                                            </tr>
                                        ) : (
                                            // Renderizamos TUS datos filtrados
                                            inventoryFilteredData.map((item) => {
                                                // Nota: detailedInventory ya trae 'price_ves', 'total_value_ves' calculados del backend
                                                // pero por seguridad recalculamos visualmente para consistencia con la tasa actual
                                                const stock = parseInt(item.stock) || 0;
                                                const price = parseFloat(item.price_usd) || 0;
                                                const totalRef = parseFloat(item.total_value_usd) || 0;
                                                
                                                // Si el backend ya trajo el cálculo, lo usamos, si no calculamos
                                                const totalBs = totalRef * bcvRate;
                                                const unitBs = price * bcvRate;

                                                return (
                                                    <tr 
                                                        key={item.id} 
                                                        // RESTAURAMOS EL CLICK AL KARDEX
                                                        onClick={() => viewKardexHistory(item)}
                                                        className="hover:bg-blue-50 transition-colors cursor-pointer group"
                                                        title="🖱️ Clic para ver Movimientos y Kardex"
                                                    >
                                                        <td className="px-6 py-3 font-bold text-gray-800">
                                                            <div className="flex items-center gap-3">
                                                                <span className="text-xl group-hover:scale-125 transition-transform">{item.icon_emoji}</span>
                                                                <div>
                                                                    {item.name}
                                                                    <div className="text-[10px] text-gray-400 font-mono flex gap-2">
                                                                        <span>{item.barcode || 'S/C'}</span>
                                                                        <span className="text-blue-400 opacity-0 group-hover:opacity-100 font-bold transition-opacity">Ver Detalle ➜</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-3 text-xs">{item.category}</td>
                                                        <td className="px-6 py-3 text-center">
                                                            <span className={`px-2 py-1 rounded text-xs font-bold ${stock <= 5 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                                                                {stock}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-3 text-right font-mono text-xs">
                                                            Bs {formatBs(unitBs)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right font-bold text-gray-800">
                                                            Bs {formatBs(totalBs)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right font-bold text-blue-600">
                                                            Ref {formatUSD(totalRef)}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                        {/* PESTAÑA 4: CIERRES (VENEZUELA: BS PREDOMINANTE & AVANCES INCLUIDOS) */}
{reportTab === 'CLOSINGS' && (
    <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden animate-fade-in flex flex-col h-[80vh]">
        
        {/* HEADER PREMIUM */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white">
            <div>
                <h3 className="font-black text-slate-800 text-xl tracking-tight">Historial de Auditoría</h3>
                <p className="text-xs text-slate-500 font-medium mt-1">Control Fiscal de Cajas • Bases, Ventas y Avances</p>
            </div>
            {/* El botón se mantiene por si acaso falla el internet, pero la carga es automática */}
            <button onClick={fetchClosingsHistory} className="bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm hover:shadow-md transition-all">
                <span>🔄</span> Sincronizar
            </button>
        </div>

        <div className="overflow-x-auto flex-1 custom-scrollbar p-2">
            <table className="w-full text-left text-sm text-slate-600 border-collapse">
                <thead className="text-[10px] text-slate-400 uppercase tracking-widest bg-slate-50/50 sticky top-0 z-10 backdrop-blur-sm">
                    <tr>
                        <th className="px-6 py-4 rounded-l-xl">ID / Estado</th>
                        <th className="px-6 py-4">Responsable / Fecha</th>
                        <th className="px-6 py-4">Flujo de Caja (Base - Avances)</th>
                        <th className="px-6 py-4 text-right">Sistema (Esperado)</th>
                        <th className="px-6 py-4 text-right">Conteos (Real)</th>
                        <th className="px-6 py-4 text-center">Diferencia</th>
                        <th className="px-6 py-4 text-center rounded-r-xl">Fiscal</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                    {closingsHistory.map((shift) => (
                        <tr key={shift.id} className="hover:bg-blue-50/30 transition-colors group">
                            
                            {/* ID y STATUS */}
                            <td className="px-6 py-5">
                                <div className="flex flex-col gap-1">
                                    <span className="font-black text-slate-700 text-lg">#{shift.id}</span>
                                    {shift.status === 'ABIERTA' 
                                        ? <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold w-fit">🟢 ABIERTA</span>
                                        : <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold w-fit">🔒 CERRADA</span>
                                    }
                                </div>
                            </td>

                            {/* FECHA Y HORA */}
                            <td className="px-6 py-5">
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-600 text-xs uppercase">{shift.cashier_name || 'Cajero'}</span>
                                    <span className="text-[10px] text-slate-400 mt-0.5">
                                        {new Date(shift.opened_at).toLocaleDateString()} • {new Date(shift.opened_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </span>
                                    {shift.closed_at && (
                                        <span className="text-[9px] text-slate-300">
                                            Cierre: {new Date(shift.closed_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                        </span>
                                    )}
                                </div>
                            </td>

                            {/* FLUJO DE CAJA (Base Inicial y Avances) */}
                            <td className="px-6 py-5">
                                <div className="flex flex-col gap-2 text-xs">
                                    {/* Base Inicial */}
                                    <div className="flex justify-between items-center text-slate-500">
                                        <span>📥 Base:</span>
                                        <span className="font-bold">Bs {parseFloat(shift.initial_cash_ves || 0).toLocaleString('es-VE', {compactDisplay: 'short'})}</span>
                                    </div>
                                    {/* Avances (Salidas) */}
                                    {(parseFloat(shift.cash_outflows_ves || 0) > 0 || parseFloat(shift.cash_outflows_usd || 0) > 0) && (
                                        <div className="flex justify-between items-center text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">
                                            <span>📤 Avances:</span>
                                            <span className="font-bold">- Bs {parseFloat(shift.cash_outflows_ves || 0).toLocaleString('es-VE')}</span>
                                        </div>
                                    )}
                                </div>
                            </td>

                            {/* SISTEMA (Cálculo corregido: Base + Ventas - Avances) */}
                            <td className="px-6 py-5 text-right">
                                <div className="flex flex-col">
                                    <span className="text-slate-700 font-bold text-sm">
                                        Bs {((parseFloat(shift.initial_cash_ves || 0) + parseFloat(shift.system_cash_ves || 0)) - parseFloat(shift.cash_outflows_ves || 0)).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-medium mt-0.5">
                                        Ref {((parseFloat(shift.initial_cash_usd || 0) + parseFloat(shift.system_cash_usd || 0)) - parseFloat(shift.cash_outflows_usd || 0)).toFixed(2)}
                                    </span>
                                </div>
                            </td>

                            {/* REAL (Lo que contó el cajero) */}
                            <td className="px-6 py-5 text-right">
                                <div className="flex flex-col">
                                    <span className="font-black text-slate-800 text-sm">Bs {parseFloat(shift.real_cash_ves || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 rounded self-end mt-0.5">
                                        Ref {parseFloat(shift.real_cash_usd || 0).toFixed(2)}
                                    </span>
                                </div>
                            </td>

                            {/* DIFERENCIA */}
                            <td className="px-6 py-5 text-center">
                                <div className="flex flex-col items-center gap-1">
                                    {Math.abs(parseFloat(shift.diff_ves)) < 1
                                        ? <span className="text-[10px] font-black text-emerald-500">✨ OK</span>
                                        : <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${parseFloat(shift.diff_ves) > 0 ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>
                                            {parseFloat(shift.diff_ves) > 0 ? '+' : ''}Bs {parseFloat(shift.diff_ves).toLocaleString('es-VE', {maximumFractionDigits:0})}
                                          </span>
                                    }
                                    {Math.abs(parseFloat(shift.diff_usd)) >= 0.5 && (
                                         <span className={`text-[9px] font-bold ${parseFloat(shift.diff_usd) > 0 ? 'text-blue-500' : 'text-rose-500'}`}>
                                            {parseFloat(shift.diff_usd) > 0 ? '+' : ''}Ref {parseFloat(shift.diff_usd).toFixed(2)}
                                         </span>
                                    )}
                                </div>
                            </td>

                            {/* ACCIÓN PDF */}
                            <td className="px-6 py-5 text-center">
                                <button
                                    onClick={() => printClosingReport(shift)}
                                    className="bg-slate-800 hover:bg-black text-white p-2 rounded-xl transition-all shadow-lg hover:shadow-xl hover:scale-105"
                                    title="Descargar Reporte Z Fiscal"
                                >
                                    🖨️
                                </button>
                            </td>
                        </tr>
                    ))}
                    {closingsHistory.length === 0 && (
                        <tr>
                            <td colSpan="7" className="px-6 py-12 text-center">
                                <div className="flex flex-col items-center opacity-50">
                                    <span className="text-4xl mb-2">📂</span>
                                    <span className="text-slate-500 font-medium">No hay historial de cierres disponible.</span>
                                </div>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </div>
)}

                        {/* MODAL DETALLE PRODUCTO (RESPONSIVE PRO: HEADER MÓVIL CORREGIDO + SIDEBAR PC + FINANZAS VENEZUELA) */}
                        {selectedAuditProduct && (
                            <div className="fixed inset-0 z-[90] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-2 md:p-4 animate-fade-in">

                                {/* CONTENEDOR PRINCIPAL */}
                                <div className="bg-white rounded-2xl md:rounded-[2.5rem] w-full max-w-5xl h-[90vh] md:h-[85vh] shadow-2xl relative animate-scale-up flex flex-col md:flex-row overflow-hidden">

                                    {/* Botón Cerrar */}
                                    <button
                                        onClick={() => setSelectedAuditProduct(null)}
                                        className="absolute top-2 right-2 md:top-4 md:right-4 bg-white hover:bg-slate-100 text-slate-400 hover:text-red-500 rounded-full p-2 z-30 transition-all shadow-md border border-slate-100"
                                    >
                                        ✕
                                    </button>

                                    {/* --- PANEL IZQUIERDO (IDENTIDAD) --- */}
                                    <div className="w-full md:w-4/12 bg-slate-50 p-4 md:p-6 flex flex-row md:flex-col items-center justify-between md:justify-center border-b md:border-b-0 md:border-r border-slate-200 relative shrink-0 gap-3">
                                        <div className="absolute top-0 left-0 w-full md:h-1.5 h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>

                                        {/* 1. INFO VISUAL */}
                                        <div className="relative z-10 flex flex-row md:flex-col items-center gap-4 md:gap-0 flex-1 md:flex-none overflow-hidden">
                                            <div className="relative shrink-0">
                                                <div className="h-16 w-16 md:h-28 md:w-28 bg-white rounded-2xl md:rounded-[2rem] border-2 md:border-4 border-white shadow-md md:shadow-xl flex items-center justify-center text-3xl md:text-6xl relative z-10">
                                                    {products.find(p => p.id === selectedAuditProduct.id)?.icon_emoji || '📦'}
                                                </div>
                                                <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 md:-bottom-3 px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest shadow-sm border border-white whitespace-nowrap z-20 ${selectedAuditProduct.status === 'ACTIVE' ? 'bg-emerald-500 text-white' : 'bg-slate-400 text-white'}`}>
                                                    {selectedAuditProduct.status === 'ACTIVE' ? 'ACTIVO' : 'INACTIVO'}
                                                </div>
                                            </div>
                                            <div className="text-left md:text-center min-w-0 pl-1 md:pl-0 pt-1 md:pt-4">
                                                <h3 className="font-black text-lg md:text-2xl text-slate-800 leading-tight mb-0.5 md:mb-1 truncate md:whitespace-normal">
                                                    {selectedAuditProduct.name}
                                                </h3>
                                                <span className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider block truncate">
                                                    {selectedAuditProduct.category}
                                                </span>
                                            </div>
                                        </div>

                                        {/* 2. CARD STOCK */}
                                        <div className={`hidden md:flex w-full max-w-[220px] p-4 rounded-2xl border-2 flex-col items-center justify-center bg-white ${selectedAuditProduct.stock < 5 ? 'border-red-100 shadow-sm shadow-red-100' : 'border-slate-200 shadow-sm'}`}>
                                            <span className="text-[10px] font-bold uppercase text-slate-400">Existencia Total</span>
                                            <span className={`text-4xl font-black ${selectedAuditProduct.stock < 5 ? 'text-red-500' : 'text-slate-800'}`}>{selectedAuditProduct.stock}</span>
                                            <span className="text-xs font-bold opacity-50 mt-1">Unidades</span>
                                        </div>
                                        <div className="md:hidden flex flex-col items-end pr-8">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase">Stock</span>
                                            <span className={`text-2xl font-black ${selectedAuditProduct.stock < 5 ? 'text-red-500' : 'text-slate-800'}`}>{selectedAuditProduct.stock}</span>
                                        </div>
                                    </div>

                                    {/* --- PANEL DERECHO: CONTENIDO --- */}
                                    <div className="w-full md:w-8/12 bg-white flex flex-col h-full overflow-hidden">

                                        {/* PESTAÑAS */}
                                        <div className="flex border-b border-slate-100 px-4 md:px-8 pt-2 md:pt-6 gap-6 shrink-0 bg-white z-20 overflow-x-auto no-scrollbar">
                                            <button
                                                onClick={() => setAuditTab('INFO')}
                                                className={`pb-3 md:pb-4 text-xs font-bold uppercase tracking-widest transition-all border-b-[3px] whitespace-nowrap ${auditTab === 'INFO' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                                            >
                                                📊 Finanzas
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setAuditTab('HISTORY');
                                                    axios.get(`${API_URL}/inventory/history/${selectedAuditProduct.id}`)
                                                        .then(res => setKardexHistory(res.data))
                                                        .catch(console.error);
                                                }}
                                                className={`pb-3 md:pb-4 text-xs font-bold uppercase tracking-widest transition-all border-b-[3px] whitespace-nowrap ${auditTab === 'HISTORY' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                                            >
                                                📜 Movimientos
                                            </button>
                                        </div>

                                        {/* ÁREA DE SCROLL */}
                                        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar relative h-full">

                                            {/* VISTA 1: FINANZAS ADAPTADAS A VENEZUELA */}
                                            {auditTab === 'INFO' && (
                                                <div className="flex flex-col h-full animate-fade-in space-y-4 md:space-y-6">

                                                    {/* 1. Datos Técnicos */}
                                                    <div className="grid grid-cols-2 gap-3 md:gap-6">
                                                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col justify-center">
                                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Código de Barras</p>
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                <span className="text-xl opacity-20">|||</span>
                                                                <p className="font-mono text-sm md:text-base font-black text-slate-700 truncate">
                                                                    {selectedAuditProduct.barcode || 'NO REGISTRADO'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className={`p-4 rounded-2xl border flex flex-col justify-center ${selectedAuditProduct.is_taxable ? 'bg-blue-50 border-blue-100' : 'bg-emerald-50 border-emerald-100'}`}>
                                                            <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${selectedAuditProduct.is_taxable ? 'text-blue-400' : 'text-emerald-400'}`}>Régimen Fiscal</p>
                                                            <p className={`text-sm md:text-base font-black ${selectedAuditProduct.is_taxable ? 'text-blue-700' : 'text-emerald-700'}`}>
                                                                {selectedAuditProduct.is_taxable ? 'GRAVADO (IVA 16%)' : 'EXENTO (E)'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* 2. COSTO UNITARIO (Sin $) */}
                                                    <div className="p-5 md:p-8 rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/50 bg-white relative overflow-hidden group">
                                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                                            <span className="text-6xl">📈</span>
                                                        </div>
                                                        <h4 className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Costo Unitario de Reposición</h4>

                                                        <div className="flex flex-col md:flex-row items-baseline gap-2 md:gap-8">
                                                            <div>
                                                                <span className="text-4xl md:text-5xl font-black text-slate-800 tracking-tight">
                                                                    {/* CAMBIO: Usamos 'Ref' pequeño en lugar de $ */}
                                                                    <span className="text-sm md:text-lg text-slate-400 font-bold mr-1 align-top">Ref</span>
                                                                    {parseFloat(selectedAuditProduct.price_usd).toFixed(2)}
                                                                </span>
                                                            </div>
                                                            <div className="h-px w-full md:w-px md:h-12 bg-slate-100"></div>
                                                            <div>
                                                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Costo en Bolívares</p>
                                                                <span className="text-2xl md:text-3xl font-bold text-slate-600">
                                                                    Bs {(parseFloat(selectedAuditProduct.price_usd) * bcvRate).toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* 3. VALOR TOTAL (Sin $) */}
                                                    <div className="mt-auto bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 rounded-2xl md:rounded-[2rem] p-6 md:p-8 text-white shadow-2xl shadow-indigo-300/50 relative overflow-hidden">
                                                        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-3xl animate-pulse-slow"></div>
                                                        <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-indigo-900/20 rounded-full blur-3xl"></div>

                                                        <div className="relative z-10">
                                                            <p className="text-[10px] md:text-xs font-bold opacity-80 uppercase tracking-[0.2em] mb-4 border-b border-white/20 pb-2 inline-block">Valor Total del Inventario</p>

                                                            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                                                                <div>
                                                                    <p className="text-4xl md:text-6xl font-black tracking-tight drop-shadow-md">
                                                                        {/* CAMBIO: Usamos 'Ref' en lugar de $ */}
                                                                        <span className="text-lg md:text-2xl opacity-60 font-bold mr-2 align-top">Ref</span>
                                                                        {parseFloat(selectedAuditProduct.total_value_usd).toFixed(2)}
                                                                    </p>
                                                                    <p className="text-xs font-medium opacity-60 mt-1">Calculado en base al stock actual</p>
                                                                </div>

                                                                <div className="w-full md:w-auto bg-white/10 backdrop-blur-md rounded-xl p-3 md:p-4 border border-white/10">
                                                                    <p className="text-[9px] font-bold opacity-70 uppercase mb-1">Total en Bolívares</p>
                                                                    <p className="text-xl md:text-2xl font-bold">
                                                                        Bs {(parseFloat(selectedAuditProduct.total_value_usd) * bcvRate).toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* VISTA 2: HISTORIAL (TIMELINE) */}
                                            {auditTab === 'HISTORY' && (
                                                <div className="animate-fade-in pb-16 md:pb-10">
                                                    {kardexHistory.length === 0 ? (
                                                        <div className="h-40 md:h-64 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl mt-4">
                                                            <span className="text-3xl md:text-5xl mb-2 opacity-50">📜</span>
                                                            <p className="text-[10px] md:text-xs font-bold uppercase tracking-wider">No hay historial disponible</p>
                                                        </div>
                                                    ) : (
                                                        <div className="relative border-l-2 border-indigo-50 ml-2 md:ml-3 space-y-4 md:space-y-8 mt-2">
                                                            {kardexHistory.map((mov, idx) => (
                                                                <div key={idx} className="relative pl-4 md:pl-8 group">
                                                                    <div className={`absolute -left-[9px] md:-left-[11px] top-0 w-4 h-4 md:w-6 md:h-6 rounded-full border-2 md:border-4 border-white shadow-md flex items-center justify-center text-[8px] md:text-[10px] z-10 ${mov.type === 'IN' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                                                                        }`}>
                                                                        {mov.type === 'IN' ? '↓' : '↑'}
                                                                    </div>

                                                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 md:p-4 rounded-xl md:rounded-2xl bg-white border border-slate-100 hover:border-indigo-100 hover:shadow-md transition-all shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                                                                        <div className="mb-2 sm:mb-0 w-full sm:w-auto">
                                                                            <div className="flex items-center justify-between sm:justify-start gap-2 mb-1">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wide ${mov.type === 'IN' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                                                                                        }`}>
                                                                                        {mov.type === 'IN' ? 'ENTRADA' : 'SALIDA'}
                                                                                    </span>
                                                                                    <span className="text-[9px] md:text-[10px] text-slate-400 font-mono font-medium">
                                                                                        {new Date(mov.created_at).toLocaleDateString()}
                                                                                    </span>
                                                                                </div>
                                                                                <span className="text-[9px] text-slate-300 font-mono md:hidden">
                                                                                    {new Date(mov.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                                </span>
                                                                            </div>

                                                                            <p className="text-xs md:text-sm font-bold text-slate-700 line-clamp-1">
                                                                                {mov.reason.replace(/_/g, ' ')}
                                                                            </p>

                                                                            {(mov.document_ref || (mov.type === 'IN' && mov.cost_usd)) && (
                                                                                <div className="mt-2 flex flex-wrap gap-2">
                                                                                    {mov.document_ref && (
                                                                                        <span className="inline-flex items-center gap-1 text-[9px] md:text-[10px] font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100 truncate max-w-[120px]">
                                                                                            📄 {mov.document_ref}
                                                                                        </span>
                                                                                    )}
                                                                                    {mov.type === 'IN' && mov.cost_usd && (
                                                                                        <span className="inline-flex items-center gap-1 text-[9px] md:text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                                                                                            Ref {parseFloat(mov.cost_usd).toFixed(2)}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        <div className="text-right pl-0 md:pl-4 border-t md:border-t-0 md:border-l border-slate-50 pt-2 md:pt-0 mt-2 md:mt-0 w-full sm:w-auto flex flex-row sm:flex-col justify-between sm:justify-center items-center sm:items-end">
                                                                            <span className={`block text-base md:text-xl font-black ${mov.type === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>
                                                                                {mov.type === 'IN' ? '+' : '-'}{mov.quantity}
                                                                            </span>
                                                                            <div className="flex items-center justify-end gap-1 text-[9px] text-slate-400 font-bold uppercase mt-0 md:mt-0.5">
                                                                                <span>Saldo:</span>
                                                                                <span className="text-slate-600 text-[10px] md:text-xs">{mov.new_stock}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="absolute bottom-0 left-0 w-full h-8 md:h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                ) : (
                    <div className="h-full p-8 text-center text-red-500">Vista no encontrada.</div>
                )}
            </div>

            {/* Navegación Móvil (Actualizada) */}
            <div className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 flex justify-around py-3 z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                <button onClick={() => setView('POS')} className={`flex flex-col items-center ${view === 'POS' ? 'text-higea-blue' : 'text-gray-400'}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                    <span className="text-[10px] font-bold">Venta</span>
                </button>

                <div className="relative -top-6">
                    <button onClick={() => setIsMobileCartOpen(true)} className="bg-higea-red text-white h-14 w-14 rounded-full flex items-center justify-center shadow-lg border-4 border-[#F8FAFC]">
                        <span className="font-black text-lg">{cart.reduce((a, b) => a + b.quantity, 0)}</span>
                    </button>
                </div>

                <button onClick={() => { fetchData(); setView('DASHBOARD'); }} className={`flex flex-col items-center ${view === 'DASHBOARD' ? 'text-higea-blue' : 'text-gray-400'}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    <span className="text-[10px] font-bold">Reportes</span>
                </button>

                <button onClick={() => { fetchData(); setView('CREDIT_REPORT'); }} className={`flex flex-col items-center ${view === 'CREDIT_REPORT' ? 'text-higea-blue' : 'text-gray-400'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    <span className="text-[10px] font-bold">Crédito</span>
                </button>

                {/* BOTÓN NUEVO MÓDULO MÓVIL (Punto 1) */}
                <button onClick={() => { setView('CUSTOMERS'); }} className={`flex flex-col items-center ${view === 'CUSTOMERS' ? 'text-higea-blue' : 'text-gray-400'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    <span className="text-[10px] font-bold">Clientes</span>
                </button>
            </div>


            {/* MODALES */}
            {isPaymentModalOpen && (
                <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl animate-scale-up">
                        <div className="bg-gray-50 p-5 border-b border-gray-100 text-center">
                            <h3 className="text-sm font-bold text-gray-400 uppercase">Total Final a Pagar ({IVA_RATE * 100}% IVA Incluido)</h3>
                            <p className="text-3xl font-black text-gray-800">Ref {finalTotalUSD.toFixed(2)}</p>
                            <p className="text-sm text-higea-blue font-bold">Bs {totalVES.toLocaleString('es-VE', { maximumFractionDigits: 2 })}</p>

                            {/* ACCIÓN RÁPIDA DE PAGO EXACTO */}
                            {!isNumpadOpen && remainingUSD > 0.05 && (
                                <div className="mt-4">
                                    <button onClick={() => handleExactPayment(paymentMethods[0].name)} className="bg-higea-red text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-red-700 transition-colors">
                                        Pagar Ref {finalTotalUSD.toFixed(2)} con {paymentMethods[0].name}
                                    </button>
                                </div>
                            )}

                            {/* 💡 REQUISITO LEGAL/UX: Desglose Fiscal en modal de pago */}
                            <div className='mt-4 p-2 border border-gray-200 rounded-xl text-xs'>
                                {subtotalExemptUSD > 0 && (
                                    <div className="flex justify-between text-gray-500"><span className='font-medium'>Subtotal Exento</span><span className='font-bold'>Ref {subtotalExemptUSD.toFixed(2)}</span></div>
                                )}
                                <div className="flex justify-between text-gray-500"><span className='font-medium'>Base Imponible</span><span className='font-bold'>Ref {subtotalTaxableUSD.toFixed(2)}</span></div>
                                <div className="flex justify-between text-higea-red"><span className='font-medium'>Monto IVA ({IVA_RATE * 100}%)</span><span className='font-bold'>Ref {ivaUSD.toFixed(2)}</span></div>
                            </div>
                        </div>

                        <div className="p-5 space-y-3 max-h-[50vh] overflow-y-auto">

                            {/* --- [INICIO] NUEVO SWITCH FISCAL (Punto 2.3) --- */}
                            <div className="mb-4 bg-blue-50 p-3 rounded-xl border border-blue-100">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-blue-800 flex items-center gap-2">
                                        📄 Factura Fiscal
                                    </span>

                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={isFiscalInvoice}
                                            onChange={(e) => setIsFiscalInvoice(e.target.checked)}
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-higea-blue"></div>
                                    </label>
                                </div>
                                {isFiscalInvoice && (
                                    <p className="text-[10px] text-blue-600 mt-1 font-medium">
                                        * Se validarán datos del cliente (RIF/Dirección) al confirmar.
                                    </p>
                                )}
                            </div>
                            {/* --- [FIN] NUEVO SWITCH FISCAL --- */}

                            <p className="text-xs font-bold text-gray-400 mb-2">SELECCIONE MÉTODO DE PAGO:</p>

                            {/* --- [CORRECCIÓN SEGURIDAD] BLOQUEO DE EFECTIVO BS EN AVANCES --- */}
                            {paymentMethods.map(method => {
                                // 1. Detectar si hay avance en el carrito
                                const hasCashAdvance = cart.some(item => 
                                    (item.name && item.name.toUpperCase().includes('AVANCE')) || 
                                    (item.id && item.id.toString().startsWith('ADV'))
                                );

                                // 2. Condición de bloqueo: Hay avance Y el método es Efectivo Bs
                                const isBlocked = hasCashAdvance && method.name === 'Efectivo Bs';

                                // 3. Renderizado Condicional
                                if (isBlocked) {
                                    return (
                                        <div key={method.name} className="relative p-3 bg-gray-100 border border-gray-200 rounded-xl opacity-70 cursor-not-allowed select-none">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="font-bold text-gray-400 text-sm flex items-center gap-2">
                                                    {method.name}
                                                </span>
                                                <span className="text-[9px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold border border-red-200">
                                                    🚫 NO PERMITIDO
                                                </span>
                                            </div>
                                            <div className="w-full bg-gray-200 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-gray-400 text-xs font-mono">
                                                BLOQUEADO POR AVANCE
                                            </div>
                                            <p className="text-[9px] text-red-500 mt-1 text-center font-medium leading-tight">
                                                No se puede pagar un Avance con Efectivo Bs.
                                            </p>
                                        </div>
                                    );
                                }

                                // 4. Renderizado Normal (Tu componente original)
                                return (
                                    <PaymentInput
                                        key={method.name}
                                        name={method.name}
                                        currency={method.currency}
                                        value={paymentShares[method.name] || '0.00'}
                                    />
                                );
                            })}
                            {/* --- [FIN] BLOQUEO --- */}

                            {/* RESULTADO CALCULADORA DUAL (Faltan/Vuelto en Ref y Bs) */}
                            <div className={`mt-4 p-3 rounded-xl border ${remainingUSD > 0.05 ? 'bg-red-50 border-red-100 text-red-600' : 'bg-green-50 border-green-100 text-green-600'}`}>
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-sm">{remainingUSD > 0.05 ? 'Faltan:' : 'Vuelto/Cambio:'}</span>
                                    <span className="font-black text-xl">Ref {Math.abs(remainingUSD).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center mt-1 pt-1 border-t border-dashed border-gray-200">
                                    <span className="text-xs font-medium italic">Equivalente en Bolívares:</span>
                                    <span className="font-bold text-sm">Bs {Math.abs(remainingVES).toLocaleString('es-VE', { maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-5 flex gap-3 bg-white border-t border-gray-50">
                            <button onClick={() => setIsPaymentModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold text-sm">Cancelar</button>
                            <button
                                onClick={handleCreditProcess}
                                disabled={isInsufficient && (parseFloat(paymentShares['Crédito']) || 0) === 0}
                                className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all ${isInsufficient && (parseFloat(paymentShares['Crédito']) || 0) === 0 ? 'bg-gray-300' : 'bg-higea-blue hover:bg-blue-700'}`}
                            >
                                {(parseFloat(paymentShares['Crédito']) || 0) > 0 ? 'Continuar Crédito' : 'Procesar Pago'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isNumpadOpen && <NumpadModal />}
            {isCustomerModalOpen && renderCustomerModal()}

            {/* --- MODAL CARRITO MÓVIL (MANTENIDO) --- */}
            {isMobileCartOpen && (
                <div className="fixed inset-0 z-[55] bg-white md:hidden flex flex-col animate-slide-up">
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <h2 className="font-bold text-gray-800">Tu Orden</h2>
                        <button onClick={() => setIsMobileCartOpen(false)} className="p-2 bg-gray-200 rounded-full">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                        {cart.map(item => <CartItem key={item.id} item={item} />)}
                    </div>
                    <div className="p-4 border-t">
                        {/* 💡 MEJORA UX: Desglose Fiscal en carrito móvil */}
                        {subtotalExemptUSD > 0 && (
                            <div className="flex justify-between mb-2"><span className="font-medium text-gray-500">Subtotal Exento</span><span className="font-bold text-gray-800">Ref {subtotalExemptUSD.toFixed(2)}</span></div>
                        )}
                        <div className="flex justify-between mb-2"><span className="font-medium text-gray-500">Base Imponible</span><span className="font-bold text-gray-800">Ref {subtotalTaxableUSD.toFixed(2)}</span></div>
                        <div className="flex justify-between mb-4"><span className="font-medium text-gray-500">IVA ({IVA_RATE * 100}%)</span><span className="font-bold text-higea-red">Ref {ivaUSD.toFixed(2)}</span></div>
                        <div className="flex justify-between mb-4"><span className="font-bold text-gray-500">Total Bs</span><span className="font-black text-2xl text-higea-blue">{totalVES.toLocaleString('es-VE', { maximumFractionDigits: 0 })}</span></div>
                        <button onClick={handleOpenPayment} className="w-full bg-higea-red text-white py-4 rounded-xl font-bold shadow-lg">COBRAR (Ref {finalTotalUSD.toFixed(2)})</button>
                    </div>
                </div>
            )}

            {/* --- MODAL DETALLE VENTA (UX PREMIUM: LOGICA DE COLOR DINÁMICA & CLIENTE OPTIMIZADO) --- */}
{selectedSaleDetail && (
    <div className="fixed inset-0 z-[90] bg-[#020617]/80 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in font-sans antialiased">
        
        {/* CARD PRINCIPAL */}
        <div className="bg-[#F8FAFC] rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl shadow-black/40 relative animate-scale-up flex flex-col max-h-[92vh] ring-1 ring-white/10">

            {/* 1. HEADER HERO (Colores Semánticos: Azul=Fiscal, Naranja=Deuda, Esmeralda=Pagado) */}
            <div className={`relative px-8 pt-10 pb-8 shrink-0 text-white overflow-hidden transition-all duration-700 ${
                selectedSaleDetail.invoice_type === 'FISCAL' 
                    ? 'bg-gradient-to-br from-blue-700 via-indigo-800 to-slate-900 shadow-lg shadow-indigo-900/20' 
                    : (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL') 
                        ? 'bg-gradient-to-br from-orange-500 via-orange-600 to-red-700 shadow-lg shadow-orange-900/20' // <--- NARANJA ENCABEZADO
                        : 'bg-gradient-to-br from-emerald-500 via-teal-600 to-emerald-800 shadow-lg shadow-emerald-900/20' 
            }`}>
                
                {/* Decoración Fondo */}
                <div className="absolute inset-0 opacity-[0.08] mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
                
                {/* Botón Cerrar */}
                <button
                    onClick={() => setSelectedSaleDetail(null)}
                    className="absolute top-5 right-5 bg-white/10 hover:bg-white/20 hover:rotate-90 border border-white/10 backdrop-blur-md text-white rounded-full w-9 h-9 flex items-center justify-center transition-all duration-300 z-20 shadow-lg"
                >
                    ✕
                </button>

                {/* Contenido Header */}
                <div className="relative z-10 text-center flex flex-col items-center">
                    
                    {/* Badge Estatus */}
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/20 backdrop-blur-md border border-white/10 shadow-lg mb-2">
                        <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor] ${selectedSaleDetail.status === 'PAGADO' ? 'bg-emerald-300 text-emerald-300' : 'bg-white text-white animate-pulse'}`}></div>
                        <span className="text-[9px] font-black tracking-[0.2em] uppercase text-white/90">
                            {selectedSaleDetail.status}
                        </span>
                    </div>

                    <h3 className="font-bold text-base tracking-widest uppercase text-white/80 mb-2">
                        {selectedSaleDetail.invoice_type === 'FISCAL' ? 'Documento Fiscal' :
                        (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL') ? 'Cuenta por Cobrar' :
                        'Ticket de Venta'}
                    </h3>

                    {/* MONTO PRINCIPAL */}
                    <div className="flex flex-col items-center">
                         <div className="flex items-baseline justify-center gap-1 drop-shadow-xl">
                            <span className="text-2xl font-medium text-white/70 translate-y-[-2px]">Bs</span>
                            <span className="text-5xl md:text-6xl font-black tracking-tighter text-white leading-none">
                                {parseFloat(selectedSaleDetail.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                            </span>
                        </div>
                        <div className="mt-2 bg-white/10 px-4 py-1 rounded-full backdrop-blur-md border border-white/20 shadow-inner">
                             <p className="text-xs font-bold font-mono tracking-wider text-white">
                                Ref ${parseFloat(selectedSaleDetail.total_usd).toFixed(2)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. CUERPO (DATOS ORGANIZADOS) */}
            <div className="flex-1 overflow-y-auto px-5 py-6 custom-scrollbar space-y-5 bg-[#F8FAFC]">
                
                {/* --- BLOQUE DE METADATOS UNIFICADO (GRID 2x2) --- */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-1">
                    <div className="grid grid-cols-2 divide-x divide-slate-50">
                        {/* Fecha */}
                        <div className="p-3 flex flex-col items-center justify-center border-b border-slate-50">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Fecha</span>
                            <span className="text-xs font-bold text-slate-700">
                                {new Date(selectedSaleDetail.created_at || new Date()).toLocaleDateString()}
                            </span>
                        </div>
                        {/* Control */}
                        <div className="p-3 flex flex-col items-center justify-center border-b border-slate-50">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Control</span>
                            <span className="text-xs font-black text-slate-800 font-mono">#{selectedSaleDetail.id}</span>
                        </div>
                        {/* Tipo Doc */}
                        <div className="p-3 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Tipo</span>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${
                                selectedSaleDetail.invoice_type === 'FISCAL' 
                                ? 'bg-blue-50 text-blue-700 border-blue-100' 
                                : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            }`}>
                                {selectedSaleDetail.invoice_type === 'FISCAL' ? 'FISCAL' : 'TICKET'}
                            </span>
                        </div>
                        {/* Condición (Aquí aplicamos Naranja si es Crédito) */}
                        <div className="p-3 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Modo</span>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${
                                (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL') 
                                ? 'bg-orange-50 text-orange-700 border-orange-200' // <--- NARANJA BADGE
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}>
                                {(selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL') ? 'CRÉDITO' : 'CONTADO'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* --- CLIENTE CARD (ICONO ADAPTABLE) --- */}
                <div className={`p-4 rounded-2xl shadow-sm border flex items-center gap-4 relative overflow-hidden group transition-colors ${
                     (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL')
                     ? 'bg-orange-50/30 border-orange-100' // Fondo sutil naranja si es deuda
                     : 'bg-white border-slate-100'
                }`}>
                    
                    {/* Icono Cliente (Cambia a Naranja si es deuda) */}
                    <div className={`relative z-10 h-12 w-12 rounded-2xl flex items-center justify-center shadow-md transform group-hover:scale-105 transition-transform duration-300 ${
                        selectedSaleDetail.invoice_type === 'FISCAL' 
                            ? 'bg-gradient-to-br from-blue-500 to-indigo-600' 
                        : (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL')
                            ? 'bg-gradient-to-br from-orange-400 to-orange-600' // <--- NARANJA ICONO
                            : 'bg-gradient-to-br from-emerald-400 to-emerald-600'
                    }`}>
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                    </div>

                    <div className="flex-1 min-w-0 relative z-10">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Cliente</p>
                        <p className="text-sm font-bold text-slate-800 truncate leading-tight">
                            {selectedSaleDetail.full_name || 'Consumidor Final'}
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                            {selectedSaleDetail.id_number || 'ID: No registrado'}
                        </p>
                    </div>
                </div>

                {/* --- LISTA DE ÍTEMS --- */}
                <div>
                     <div className="flex justify-between items-end px-2 mb-2">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Detalle Compra</p>
                        <span className="text-[9px] font-bold text-slate-400">{selectedSaleDetail.items.length} Ítems</span>
                     </div>
                     <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                        {selectedSaleDetail.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center p-3 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <span className={`text-[10px] font-black h-7 w-7 flex items-center justify-center rounded-lg shadow-sm ${
                                        selectedSaleDetail.invoice_type === 'FISCAL' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                                    }`}>
                                        {item.quantity}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="font-bold text-xs text-slate-700 truncate">{item.name}</p>
                                        <p className="text-[9px] text-slate-400 font-medium">Ref {parseFloat(item.price_at_moment_usd || item.price_usd).toFixed(2)}</p>
                                    </div>
                                </div>
                                <span className="font-bold text-xs text-slate-800 whitespace-nowrap pl-2">
                                    Ref {(parseFloat(item.price_at_moment_usd || item.price_usd) * item.quantity).toFixed(2)}
                                </span>
                            </div>
                        ))}
                     </div>
                </div>

                {/* --- INFO FINANCIERA --- */}
                <div className="bg-slate-50 rounded-2xl p-4 text-xs space-y-2 border border-slate-100">
                     <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-500">Método de Pago</span>
                        <span className="font-bold text-slate-700 uppercase bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm">
                            {selectedSaleDetail.payment_method}
                        </span>
                     </div>
                     {selectedSaleDetail.taxBreakdown && selectedSaleDetail.taxBreakdown.ivaUSD > 0 && (
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200/50">
                            <span className="font-semibold text-blue-500">Impuesto (IVA 16%)</span>
                            <span className="font-bold text-blue-600">Ref {selectedSaleDetail.taxBreakdown.ivaUSD.toFixed(2)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 3. FOOTER ACCIONES (Botón Principal cambia a Naranja si es Crédito) */}
            <div className="p-5 bg-white border-t border-slate-100 flex flex-col gap-3 shadow-[0_-20px_40px_-15px_rgba(0,0,0,0.05)] z-10">
                
                {/* Botón Imprimir (Dinámico) */}
                <button
                    onClick={() => handlePrintTicket(selectedSaleDetail)} 
                    className={`w-full relative overflow-hidden text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 active:scale-95 group flex items-center justify-center gap-2 ${
                        selectedSaleDetail.invoice_type === 'FISCAL' 
                        ? 'bg-slate-900' // Fiscal = Oscuro
                        : (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL')
                            ? 'bg-orange-600 hover:bg-orange-500' // Crédito = NARANJA
                            : 'bg-emerald-600 hover:bg-emerald-500' // Pagado = Esmeralda
                    }`}
                >
                    <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                    <span className="tracking-wide uppercase text-xs">{selectedSaleDetail.invoice_type === 'FISCAL' ? 'Reimprimir Fiscal' : 'Imprimir Ticket'}</span>
                </button>

                {/* Botón Anular */}
                {selectedSaleDetail.status !== 'ANULADO' ? (
                    <button
                        onClick={() => handleVoidSale(selectedSaleDetail)}
                        disabled={selectedSaleDetail.status === 'PARCIAL'}
                        className={`w-full py-3 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest border transition-all duration-300 flex items-center justify-center gap-2 ${
                            selectedSaleDetail.status === 'PARCIAL' 
                            ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                            : 'bg-white border-rose-100 text-rose-500 hover:bg-rose-50 hover:border-rose-200'
                        }`}
                    >
                        {selectedSaleDetail.status === 'PARCIAL' ? '🔒 Bloqueado' : (selectedSaleDetail.invoice_type === 'FISCAL' ? 'Emitir Nota de Crédito' : 'Anular Venta')}
                    </button>
                ) : (
                    <div className="w-full py-3 rounded-xl bg-slate-50 border border-slate-100 text-slate-300 font-black text-[10px] uppercase tracking-[0.2em] text-center select-none">
                         ⛔ Venta Anulada
                    </div>
                )}
            </div>

        </div>
    </div>
)}

            {/* MODAL: STOCK COMPLETO (UX Mejorada) */}
            {showStockModal && (
                <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-lg h-[80vh] flex flex-col shadow-2xl animate-scale-up overflow-hidden">
                        <div className="p-5 border-b flex justify-between items-center bg-red-50">
                            <div className="flex items-center gap-3">
                                <div className="bg-red-100 p-2 rounded-full text-red-500">⚠️</div>
                                <h3 className="font-bold text-red-900 text-lg">Reporte de Stock Bajo</h3>
                            </div>
                            <button onClick={() => setShowStockModal(false)} className="bg-white w-8 h-8 rounded-full text-red-500 font-bold shadow-sm hover:bg-red-100 transition-colors">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-400 uppercase text-[10px] font-bold tracking-wider">
                                    <tr><th className="px-3 py-2 text-left rounded-l-lg">Producto</th><th className="px-3 py-2 text-center">Cat</th><th className="px-3 py-2 text-right rounded-r-lg">Stock</th></tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {lowStock.map(p => (
                                        <tr key={p.id} className="hover:bg-red-50/50 transition-colors">
                                            <td className="px-3 py-3 font-bold text-gray-700 flex items-center gap-2">
                                                {/* AQUÍ ESTÁ LA CORRECCIÓN: Detectar si es Imagen o Emoji */}
                                                {(p.icon_emoji && (p.icon_emoji.startsWith('data:image') || p.icon_emoji.startsWith('http'))) ? (
                                                    <img 
                                                        src={p.icon_emoji} 
                                                        alt={p.name} 
                                                        className="w-8 h-8 rounded-full object-cover border border-gray-200"
                                                    />
                                                ) : (
                                                    <span className="text-xl">{p.icon_emoji || '📦'}</span>
                                                )}
                                                {/* Fin de la corrección */}
                                                {p.name}
                                            </td>
                                            <td className="px-3 py-3 text-center text-xs text-gray-400 bg-gray-50 rounded-lg m-1">{p.category}</td>
                                            <td className="px-3 py-3 text-right">
                                                <span className="bg-red-100 text-red-600 font-black px-3 py-1 rounded-full">{p.stock}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-4 border-t bg-gray-50 text-center">
                            <button onClick={() => setShowStockModal(false)} className="w-full bg-gray-200 text-gray-600 font-bold py-3 rounded-xl hover:bg-gray-300 transition-colors">Cerrar Reporte</button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: VENTAS DE HOY DETALLADAS (CORREGIDO: CÁLCULOS VISUALES RESTAN CAPITAL) */}
            {showDailySalesModal && (
                <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl animate-scale-up overflow-hidden">

                        {/* --- HEADER CON BOTÓN DE CUADRE --- */}
                        <div className="p-6 border-b flex justify-between items-center bg-blue-50">
                            <div>
                                <h3 className="font-black text-2xl text-higea-blue">Cierre de Caja - HOY</h3>
                                <p className="text-sm text-blue-400 font-medium">{new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                            </div>

                            <div className="flex items-center gap-3">
                                {/* BOTÓN DE GESTIÓN DE CIERRE (NUEVO) */}
                                <button
                                    onClick={handleCashClose}
                                    className="bg-higea-blue hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-2 animate-pulse"
                                >
                                    <span>📠</span> <span className="hidden sm:inline">Realizar Cuadre</span>
                                </button>

                                <button onClick={() => setShowDailySalesModal(false)} className="bg-white w-10 h-10 rounded-full text-blue-500 font-bold shadow-sm hover:bg-blue-100 transition-colors">✕</button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-0 bg-gray-50/50">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="bg-white text-gray-400 uppercase text-[10px] font-bold tracking-wider sticky top-0 shadow-sm z-10 border-b border-gray-100">
                                    <tr>
                                        <th className="px-6 py-4 text-left">Hora</th>
                                        <th className="px-6 py-4 text-left">Cliente</th>
                                        <th className="px-6 py-4 text-left">Método Pago</th>
                                        <th className="px-6 py-4 text-right">Total Ref</th>
                                        <th className="px-6 py-4 text-center">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 bg-white">
                                    {dailySalesList.map(sale => (
                                        <tr
                                            key={sale.id}
                                            // ACCIÓN 1: Click en toda la fila abre el detalle
                                            onClick={() => showSaleDetail(sale)}
                                            className="hover:bg-blue-50/60 transition-colors group cursor-pointer"
                                        >
                                            {/* HORA (Fuente Mono para alineación perfecta) */}
                                            <td className="px-6 py-4 text-gray-500 font-mono text-xs whitespace-nowrap align-middle">
                                                {new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </td>

                                            {/* CLIENTE */}
                                            <td className="px-6 py-4 align-middle">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-700 text-sm">{sale.full_name || 'Consumidor Final'}</span>
                                                    <span className="text-[10px] text-gray-400 font-medium">ID Venta: #{sale.id}</span>
                                                </div>
                                            </td>

                                            {/* MÉTODO DE PAGO (Estilo Badge/Etiqueta Elegante) */}
                                            <td className="px-6 py-4 align-middle">
                                                <div className="flex items-center">
                                                    <div className="max-w-[160px]" title={sale.payment_method}>
                                                        <p className="bg-gray-100 text-gray-600 border border-gray-200 px-3 py-1 rounded-full text-xs font-medium truncate w-full text-center">
                                                            {sale.payment_method}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* TOTAL REF (Alineado a la derecha, tipografía fuerte) */}
                                            <td className="px-6 py-4 text-right align-middle">
                                                <span className="font-black text-higea-blue text-base tracking-tight">
                                                    {/* Corrección visual en la lista individual también */}
                                                    Ref {(() => {
                                                        let amount = parseFloat(sale.total_usd);
                                                        // Visualmente restamos el capital si es avance para no confundir
                                                        if (sale.payment_method && sale.payment_method.includes('[CAP:')) {
                                                            const match = sale.payment_method.match(/\[CAP:([\d\.]+)\]/);
                                                            if (match && match[1]) amount -= parseFloat(match[1]);
                                                        }
                                                        return amount.toFixed(2);
                                                    })()}
                                                </span>
                                            </td>

                                            {/* ACCIÓN (Botón Visual) */}
                                            <td className="px-6 py-4 text-center align-middle">
                                                <button
                                                    // ACCIÓN 2: El botón también funciona (stopPropagation previene doble evento)
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        showSaleDetail(sale);
                                                    }}
                                                    className="p-2 text-gray-400 hover:text-higea-blue hover:bg-white bg-transparent rounded-full transition-all active:scale-95"
                                                    title="Ver Detalles Completos"
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}

                                    {/* ESTADO VACÍO */}
                                    {dailySalesList.length === 0 && (
                                        <tr>
                                            <td colSpan="5" className="p-12 text-center text-gray-400 italic bg-gray-50/30">
                                                <div className="flex flex-col items-center gap-2">
                                                    <span className="text-2xl">💤</span>
                                                    <span>No hay movimientos registrados hoy.</span>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer con Totales (CORREGIDO: RESTA EL CAPITAL DEL AVANCE) */}
                        <div className="p-5 border-t bg-white flex flex-col md:flex-row justify-between items-center shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-20 gap-4">
                            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide self-start md:self-center">
                                {/* Solo cuenta las ventas válidas */}
                                Transacciones: <span className="text-gray-800 text-lg ml-1">{dailySalesList.filter(s => s.status !== 'ANULADO').length}</span>

                                {/* Opcional: Muestra cuántas anuladas hay por separado */}
                                {dailySalesList.some(s => s.status === 'ANULADO') && (
                                    <span className="ml-2 text-red-400 font-medium text-[10px]">
                                        ({dailySalesList.filter(s => s.status === 'ANULADO').length} Anuladas)
                                    </span>
                                )}
                            </div>

                            <div className="flex flex-col items-end">
                                <p className="text-xs text-gray-400 font-bold uppercase mb-1">Total Recaudado (Dinero en Mano)</p>

                                <div className="flex items-end gap-4">
                                    {/* TOTAL EN BS (CORREGIDO) */}
                                    <div className="text-right">
                                        <span className="text-[10px] font-bold text-gray-400 block">EN BOLÍVARES</span>
                                        <span className="text-xl font-bold text-gray-600">
                                            Bs {dailySalesList.reduce((acc, curr) => {
                                                if (curr.status === 'ANULADO') return acc;
                                                
                                                // 1. Obtenemos monto base
                                                let netAmount = curr.amount_paid_usd;
                                                
                                                // 2. Si es Avance, restamos capital
                                                if (curr.payment_method && curr.payment_method.includes('[CAP:')) {
                                                    try {
                                                        const match = curr.payment_method.match(/\[CAP:([\d\.]+)\]/);
                                                        if (match && match[1]) netAmount -= parseFloat(match[1]);
                                                    } catch (e) {}
                                                }

                                                // 3. Multiplicamos por la tasa de ESA venta
                                                return acc + (netAmount * (curr.bcv_rate_snapshot || bcvRate));
                                            }, 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                                        </span>
                                    </div>

                                    {/* TOTAL EN USD (CORREGIDO) */}
                                    <div className="text-right border-l pl-4 border-gray-200">
                                        <span className="text-[10px] font-bold text-higea-blue block">EN DÓLARES (REF)</span>
                                        <span className="text-3xl font-black text-higea-blue leading-none">
                                            Ref {dailySalesList.reduce((acc, curr) => {
                                                if (curr.status === 'ANULADO') return acc;
                                                
                                                // 1. Obtenemos monto base
                                                let netAmount = curr.amount_paid_usd;
                                                
                                                // 2. Si es Avance, restamos capital
                                                if (curr.payment_method && curr.payment_method.includes('[CAP:')) {
                                                    try {
                                                        const match = curr.payment_method.match(/\[CAP:([\d\.]+)\]/);
                                                        if (match && match[1]) netAmount -= parseFloat(match[1]);
                                                    } catch (e) {}
                                                }

                                                return acc + netAmount;
                                            }, 0).toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL DE VISUALIZACIÓN PREVIA DE FACTURA (CENTRADO) --- */}
            {receiptPreview && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-2xl w-full max-w-sm flex flex-col shadow-2xl relative animate-scale-up overflow-hidden border-4 border-higea-blue">

                        {/* Cabecera del Visor */}
                        <div className="bg-higea-blue p-4 text-white flex justify-between items-center">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                🖨️ Vista Previa Fiscal
                            </h3>
                            <button onClick={() => setReceiptPreview(null)} className="bg-white/20 hover:bg-white/30 rounded-full p-1 text-white transition-colors">✕</button>
                        </div>

                        {/* El Recibo (Renderizado en un Iframe para aislamiento perfecto) */}
                        <div className="flex-1 bg-gray-100 p-4 flex justify-center overflow-y-auto max-h-[60vh]">
                            <div className="bg-white shadow-lg w-full max-w-[80mm] min-h-[300px]">
                                <iframe
                                    srcDoc={receiptPreview}
                                    className="w-full h-full min-h-[400px] border-none"
                                    title="Receipt Preview"
                                />
                            </div>
                        </div>

                        {/* Botones de Acción */}
                        <div className="p-4 bg-white border-t border-gray-200 flex gap-3">
                            <button
                                onClick={() => setReceiptPreview(null)}
                                className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-colors"
                            >
                                Cerrar
                            </button>
                            <button
                                onClick={() => {
                                    // Truco para imprimir el contenido del iframe
                                    const iframe = document.querySelector('iframe[title="Receipt Preview"]');
                                    if (iframe) {
                                        iframe.contentWindow.print();
                                    }
                                }}
                                className="flex-1 bg-higea-blue text-white font-bold py-3 rounded-xl shadow-lg hover:bg-blue-700 transition-colors flex justify-center items-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                IMPRIMIR
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL VISOR DE KARDEX (CON BOTÓN DE REPORTE PDF) --- */}
            {isKardexOpen && kardexProduct && (
                <div className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-lg h-[85vh] flex flex-col shadow-2xl overflow-hidden relative ring-1 ring-white/20">

                        {/* HEADER */}
                        <div className="relative p-6 bg-gradient-to-br from-slate-800 to-slate-900 text-white shrink-0 overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10 text-9xl transform translate-x-10 -translate-y-10 rotate-12 select-none pointer-events-none">
                                {kardexProduct.icon_emoji}
                            </div>
                            <div className="relative z-10 flex justify-between items-start">
                                <div>
                                    <p className="text-[10px] font-bold text-blue-300 uppercase tracking-[0.2em] mb-2">Auditoría de Inventario</p>
                                    <h3 className="text-2xl font-black tracking-tight leading-none mb-3 w-4/5 text-white">{kardexProduct.name}</h3>

                                    <div className="inline-flex items-center gap-3 bg-white/10 px-4 py-2 rounded-xl border border-white/10 backdrop-blur-sm shadow-sm">
                                        <span className="text-xs text-slate-300 font-medium uppercase tracking-wide">Stock Actual</span>
                                        <div className="h-4 w-px bg-white/20"></div>
                                        <span className="text-xl font-black text-white tracking-tight">{kardexProduct.stock}</span>
                                        <span className="text-[10px] text-slate-400 font-bold">UND</span>
                                    </div>
                                </div>

                                {/* GRUPO DE BOTONES (IMPRIMIR + CERRAR) */}
                                <div className="flex gap-2">
                                    {/* NUEVO BOTÓN: DESCARGAR PDF */}
                                    <button
                                        onClick={printKardexReport}
                                        className="bg-emerald-500/20 hover:bg-emerald-500 hover:text-white text-emerald-300 rounded-full p-2.5 transition-all active:scale-90 backdrop-blur-md border border-emerald-500/30 shadow-lg"
                                        title="Descargar Reporte PDF"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    </button>

                                    <button
                                        onClick={() => setIsKardexOpen(false)}
                                        className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2.5 transition-all active:scale-90 backdrop-blur-md border border-white/5"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* CUERPO: TIMELINE CORREGIDO (EL QUE YA TENÍAS) */}
                        <div className="flex-1 overflow-y-auto bg-slate-50 p-0 custom-scrollbar">
                            {kardexHistory.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                                    <span className="text-6xl mb-4 grayscale opacity-50">📊</span>
                                    <p className="font-bold text-sm uppercase tracking-wide">Sin movimientos registrados</p>
                                </div>
                            ) : (
                                <div className="relative pb-10 pt-4">
                                    <div className="absolute left-[58px] top-0 bottom-0 w-0.5 bg-slate-200"></div>

                                    {kardexHistory.map((mov, idx) => {
                                        const isEntry = mov.type === 'IN';
                                        return (
                                            <div key={idx} className="relative pl-24 pr-6 py-4 group hover:bg-white transition-colors border-b border-slate-100 last:border-0">
                                                <div className={`absolute left-[50px] top-5 w-4 h-4 rounded-full border-[3px] border-slate-50 shadow-md z-10 transition-transform group-hover:scale-125 ${isEntry ? 'bg-emerald-500' : 'bg-rose-500'
                                                    }`}></div>

                                                <div className="absolute left-1 top-5 w-[45px] text-right flex flex-col items-end">
                                                    <p className="text-[10px] font-black text-slate-500 leading-tight">
                                                        {new Date(mov.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })}
                                                    </p>
                                                    <p className="text-[8px] font-medium text-slate-300 mt-0.5">
                                                        {new Date(mov.created_at).getFullYear()}
                                                    </p>
                                                </div>

                                                <div className="flex justify-between items-start gap-4">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded text-white uppercase tracking-wider shadow-sm ${isEntry ? 'bg-emerald-500' : 'bg-rose-500'
                                                                }`}>
                                                                {isEntry ? 'ENTRADA' : 'SALIDA'}
                                                            </span>
                                                            <span className="text-[10px] font-mono font-medium text-slate-400">
                                                                {new Date(mov.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm font-bold text-slate-700 leading-snug truncate" title={mov.reason}>
                                                            {mov.reason.replace(/_/g, ' ')}
                                                        </p>
                                                        {(mov.document_ref || (isEntry && mov.cost_usd)) && (
                                                            <div className="mt-2 flex flex-wrap gap-2">
                                                                {mov.document_ref && (
                                                                    <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-slate-500 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm max-w-full truncate">
                                                                        📄 {mov.document_ref}
                                                                    </span>
                                                                )}
                                                                {isEntry && mov.cost_usd && (
                                                                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 shadow-sm">
                                                                        Ref {parseFloat(mov.cost_usd).toFixed(2)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="text-right flex flex-col items-end shrink-0">
                                                        <span className={`text-2xl font-black tracking-tighter tabular-nums ${isEntry ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                            {isEntry ? '+' : '-'}{mov.quantity}
                                                        </span>
                                                        <div className="flex items-center gap-1.5 mt-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Saldo</span>
                                                            <span className="text-xs font-black text-slate-700 bg-slate-200/50 px-1.5 py-0.5 rounded border border-slate-200">
                                                                {mov.new_stock}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="p-3 bg-white border-t border-slate-100 flex justify-center items-center gap-2 text-[10px] text-slate-400 font-medium">
                            <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            Registro inmutable de seguridad
                        </div>
                    </div>
                </div>
            )}
			
			{/* --- MODAL AVANCE DE EFECTIVO (GLOBAL) --- */}
            {isCashAdvanceOpen && (
                <div className="fixed inset-0 z-[80] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-[32px] w-full max-w-md shadow-2xl shadow-slate-900/50 overflow-hidden flex flex-col animate-scale-up border border-slate-100">

                        {/* 1. Header Minimalista */}
                        <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-white/90 backdrop-blur-xl z-20 sticky top-0">
                            <div>
                                <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                                    <span className="bg-emerald-100 text-emerald-600 p-2 rounded-xl text-lg">💸</span>
                                    <span>Avance de Efectivo</span>
                                </h3>
                                <p className="text-xs text-slate-400 font-medium mt-1 ml-11">Servicio de retiro en caja</p>
                            </div>
                            <button onClick={() => setIsCashAdvanceOpen(false)} className="w-8 h-8 flex items-center justify-center bg-slate-50 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all transform hover:rotate-90 hover:scale-110 shadow-sm">✕</button>
                        </div>

                        {/* Cuerpo del Formulario */}
                        <div className="p-8 bg-slate-50/30">
                            <form onSubmit={validateAndAddAdvance}>

                                {/* GRUPO: DATOS DEL AVANCE */}
                                <div className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-100 mb-6 relative">
                                    <div className="flex flex-col gap-6">
                                        
                                        {/* Input Monto */}
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">Monto a Entregar (Bs)</label>
                                            <div className="relative">
                                                <input 
                                                    type="number" 
                                                    step="0.01" 
                                                    autoFocus
                                                    required
                                                    value={advanceData.amountBs}
                                                    onChange={(e) => setAdvanceData({...advanceData, amountBs: e.target.value})}
                                                    className="w-full h-16 pl-12 pr-5 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 outline-none font-black text-slate-700 text-3xl placeholder-slate-300 transition-all"
                                                    placeholder="0.00"
                                                />
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">Bs</span>
                                            </div>
                                        </div>

                                        {/* Input Comisión */}
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">Comisión del Servicio (%)</label>
                                            <div className="flex gap-3">
                                                <div className="relative w-24 shrink-0">
                                                    <input 
                                                        type="number" 
                                                        step="0.1" 
                                                        required
                                                        value={advanceData.commission}
                                                        onChange={(e) => setAdvanceData({...advanceData, commission: e.target.value})}
                                                        className="w-full h-12 px-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 focus:border-emerald-500 outline-none text-center"
                                                    />
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                                                </div>
                                                
                                                {/* Botones de Comisión Rápida */}
                                                <div className="flex-1 flex gap-2">
                                                    {[5, 10, 12, 15].map(pct => (
                                                        <button 
                                                            key={pct}
                                                            type="button"
                                                            onClick={() => setAdvanceData({...advanceData, commission: pct})}
                                                            className={`flex-1 rounded-xl text-xs font-bold transition-all border ${
                                                                advanceData.commission == pct 
                                                                ? 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm' 
                                                                : 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50'
                                                            }`}
                                                        >
                                                            {pct}%
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* RESUMEN DE CÁLCULO */}
                                {advanceData.amountBs && (
                                    <div className="bg-emerald-50/50 border border-emerald-100 p-5 rounded-[24px] mb-6 space-y-3 relative overflow-hidden">
                                        <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-100 rounded-full opacity-50 blur-xl"></div>

                                        <div className="flex justify-between items-center text-xs font-medium text-slate-500 relative z-10">
                                            <span>Entregar Efectivo:</span>
                                            <span className="font-bold text-slate-700">Bs {formatBs(parseFloat(advanceData.amountBs))}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs font-medium text-emerald-600 relative z-10">
                                            <span>Comisión ({advanceData.commission}%):</span>
                                            <span className="font-bold">+ Bs {formatBs(parseFloat(advanceData.amountBs) * (parseFloat(advanceData.commission)/100))}</span>
                                        </div>
                                        
                                        <div className="border-t border-emerald-200/50 pt-3 mt-1 relative z-10">
                                            <div className="flex justify-between items-end">
                                                <span className="text-xs font-black text-emerald-800 uppercase tracking-wide">Total a Cobrar</span>
                                                <span className="text-2xl font-black text-emerald-600 leading-none">
                                                    Bs {formatBs(parseFloat(advanceData.amountBs) * (1 + parseFloat(advanceData.commission)/100))}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-right text-emerald-400 font-medium mt-1">
                                                Ref: $ {( (parseFloat(advanceData.amountBs) * (1 + parseFloat(advanceData.commission)/100)) / bcvRate ).toFixed(2)}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Botón Acción */}
                                <button type="submit" className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-2xl shadow-xl hover:scale-[1.01] transition-all flex justify-center items-center gap-3 text-lg group">
                                    <span className="group-hover:animate-bounce">🛒</span>
                                    <span>Agregar al Carrito</span>
                                </button>

                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;