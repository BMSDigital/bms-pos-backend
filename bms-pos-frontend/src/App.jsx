import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';

// --- NUEVAS FUNCIONES DE VALIDACIÓN Y FORMATO ---

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
const API_URL = import.meta.env.VITE_API_URL || 'https://bms-postventa-api.onrender.com/api';

// 🇻🇪 REQUISITO LEGAL: Tasa de IVA estándar en Venezuela
const IVA_RATE = 0.16; 

// --- LISTA EXTENSA DE EMOJIS SOLICITADA POR EL USUARIO (Más de 100) ---
const EMOJI_OPTIONS = [
    // Comida Rápida / Platos
    '🍔', '🍟', '🍕', '🌭', '🌮', '🌯', '🥙', '🧆', '🥪', '🫔', '🍝', '🍜', '🍲', '🥣', '🥗', '🥘', '🍣', '🍤', '🍙', '🍚', '🍛', '🦪', '🍢', '🍡', '🥟', '🥠', '🥡', '🍜', 
    // Carnes / Aves / Proteínas
    '🥩', '🥓', '🍗', '🍖', '🥚', '🍳', '🐟', '🦞', '🦀', '🦐', '🦑', 
    // Víveres / Productos
    '🍎', '🍏', '🍊', '🍋', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🧅', '🧄', '🍠', '🍄', '🥜', '🌰', '🌽', '🥕', '🥔', '🥐', '🍞', '🥖', '🥨', '🥯', '🧇', '🧀', '🧈', '🥛', '🍼', '🍯', 
    // Dulces / Postres
    '🍰', '🎂', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍩', '🍪', '🍦', '🍧', '🍨', '🍬', '🍫', '🍿', '🧇', 
    // Frutas
    '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍌', '🍐', 
    // Bebidas
    '🥤', '🧋', '🫖', '☕️', '🍵', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥛', '🧃', 
    // Informática / Electrónica
    '💻', '🖥️', '⌨️', '🖱️', '🖨️', '📱', '🔋', '🔌', '💡', '💾', '💿', '⏱️', '⌚', '🎙️', '🎧', 
    // General / Misceláneos
    '🏷️', '🎁', '🛍️', '💸', '📦', '🛠️', '🧹', '🧺', '🛒', '🔑', '🔗', '📍'
];

function App() {
  // --- ESTADOS PRINCIPALES ---
  const [view, setView] = useState('POS');
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [bcvRate, setBcvRate] = useState(0);
  const [fallbackRate, setFallbackRate] = useState(0); // 💡 NUEVO: Tasa de Fallback para el warning
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  
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
  const [productForm, setProductForm] = useState({ id: null, name: '', category: '', price_usd: 0.00, stock: 0, is_taxable: true, icon_emoji: EMOJI_OPTIONS[0] || '🍔' });

  // NUEVOS ESTADOS para búsqueda de inventario
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [filteredInventory, setFilteredInventory] = useState([]);
  const [inventoryCurrentPage, setInventoryCurrentPage] = useState(1); // <-- PAGINACIÓN INVENTARIO
  // ------------------------------------------

  // 💡 NUEVOS ESTADOS para búsqueda en POS y Paginación (Punto 1)
  const [posSearchQuery, setPosSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const productsPerPage = 12; // Límite por página (puedes ajustarlo)
  // ------------------------------------------
  
  // --- NUEVOS ESTADOS DASHBOARD MEJORADO ---
  const [showStockModal, setShowStockModal] = useState(false); // Modal Alerta Stock
  const [showDailySalesModal, setShowDailySalesModal] = useState(false); // Modal Detalle Ventas Hoy
  const [dailySalesList, setDailySalesList] = useState([]); // Datos para el modal anterior
  const [topDebtors, setTopDebtors] = useState([]); // Top deudores para dashboard
  
  // --- ESTADOS REPORTE GERENCIAL AVANZADO ---
  const [analyticsData, setAnalyticsData] = useState(null);
  const [reportDateRange, setReportDateRange] = useState({
      start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
  });

  // 1. Carga inicial de datos al montar el componente
  useEffect(() => { fetchData(); }, []);
  
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
  
  // 💡 Lógica de filtro para la tabla de inventario (AÑADIDO RESET DE PÁGINA)
  useEffect(() => {
      if (productSearchQuery) {
          const lowerQuery = productSearchQuery.toLowerCase();
          const results = products.filter(p => 
              p.name.toLowerCase().includes(lowerQuery) || 
              p.category.toLowerCase().includes(lowerQuery) ||
              p.id.toString().includes(lowerQuery)
          );
          setFilteredInventory(results);
      } else {
          setFilteredInventory(products);
      }
      setInventoryCurrentPage(1); // <-- RESET DE PÁGINA
  }, [productSearchQuery, products]);

  // 💡 MODIFICADO: Lógica de filtro para productos (Ahora incluye categoría, búsqueda en POS y resetea la página)
  useEffect(() => {
    let results = products;
    
    // 1. Filtrar por Categoría
    if (selectedCategory !== 'Todos') {
        results = results.filter(p => p.category === selectedCategory);
    }

    // 2. Filtrar por Búsqueda en POS (Nuevo)
    if (posSearchQuery) {
        const lowerQuery = posSearchQuery.toLowerCase();
        results = results.filter(p => 
            p.name.toLowerCase().includes(lowerQuery) || 
            p.category.toLowerCase().includes(lowerQuery)
        );
    }
    
    setFilteredProducts(results);
    setCurrentPage(1); // Resetear página a 1 al cambiar filtro/búsqueda
  }, [selectedCategory, products, posSearchQuery]);


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
              ...productForm,
              // Convertir valores numéricos y booleanos al formato correcto
              price_usd: parseFloat(productForm.price_usd),
              stock: parseInt(productForm.stock),
              is_taxable: productForm.is_taxable // Ya es un booleano por handleProductFormChange
          };
          
          await axios.post(`${API_URL}/products`, productToSend);
          
          Swal.fire('¡Éxito!', `Producto ${productForm.id ? 'actualizado' : 'registrado'} correctamente.`, 'success');
          
          setProductForm({ id: null, name: '', category: '', price_usd: 0.00, stock: 0, is_taxable: true, icon_emoji: EMOJI_OPTIONS[0] || '🍔' });
          fetchData(); 
      } catch (error) {
          const message = error.response?.data?.error || error.message;
          Swal.fire('Error', `Fallo al guardar producto: ${message}`, 'error');
      }
  }


  const fetchData = async () => {
    try {
      const statusRes = await axios.get(`${API_URL}/status`);
      setBcvRate(statusRes.data.bcv_rate);
      setFallbackRate(statusRes.data.fallback_rate);

      const prodRes = await axios.get(`${API_URL}/products`);
      const allProducts = prodRes.data
        .map(p => ({ ...p, is_taxable: p.is_taxable === true || p.is_taxable === 't' || p.is_taxable === 1 }))
        .sort((a, b) => a.id - b.id);
        
      setProducts(allProducts);
      setFilteredProducts(allProducts);
      setFilteredInventory(allProducts);
      setCategories(['Todos', ...new Set(allProducts.map(p => p.category))]);

      const statsRes = await axios.get(`${API_URL}/reports/daily`);
      setStats(statsRes.data);
      const recentRes = await axios.get(`${API_URL}/reports/recent-sales`);
      setRecentSales(recentRes.data);
      const stockRes = await axios.get(`${API_URL}/reports/low-stock`);
      setLowStock(stockRes.data);
      
      // --- CORRECCIÓN AQUÍ: Definir creditsRes antes de usarlo ---
      const creditsRes = await axios.get(`${API_URL}/reports/credit-pending`);
      setPendingCredits(creditsRes.data);
      
      const overdue = creditsRes.data.filter(c => c.is_overdue).length;
      setOverdueCount(overdue);

      const groupedRes = await axios.get(`${API_URL}/reports/credit-grouped`);
      setGroupedCredits(groupedRes.data);
      
      // Intentar cargar analíticas (con manejo de error suave)
      try {
          const analyticsRes = await axios.get(`${API_URL}/reports/analytics`); 
          setTopDebtors(analyticsRes.data.topDebtors || []);
          setAnalyticsData(analyticsRes.data);
      } catch (analyticsError) {
          console.warn("Analytics endpoint not ready yet", analyticsError);
      }
      
      setLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
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
      if (cart.length === 0) return Swal.fire('Carrito Vacío', '', 'info');
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
          const res = await axios.get(`${API_URL}/customers/search?query=${query}`);
          setCustomerSearchResults(res.data);
      } catch (error) {
          console.error("Error searching customers:", error);
          setCustomerSearchResults([]);
      } finally {
          setIsSearchingCustomer(false);
      }
  };


  // FUNCIÓN UNIFICADA DE PROCESAMIENTO DE VENTA/CRÉDITO
  const processSale = async (isCreditFlow = false) => {
      
      const isCreditSale = isCreditFlow && (parseFloat(paymentShares['Crédito']) || 0) > 0;

      // 1. Validar datos mínimos del cliente para Crédito (si aplica)
      if (isCreditSale && (!customerData.full_name || !customerData.id_number)) {
          return Swal.fire('Datos Incompletos', 'Nombre y Número de Identificador son obligatorios para ventas a crédito.', 'warning');
      }
      
      const paymentDescription = Object.entries(paymentShares)
          .filter(([_, amt]) => parseFloat(amt) > 0)
          .map(([method, amt]) => {
              const methodData = paymentMethods.find(m => m.name === method);
              const currencySymbol = methodData.currency === 'Ref' ? 'Ref' : 'Bs';
              const reference = paymentReferences[method] ? ` [Ref: ${paymentReferences[method]}]` : ''; 
              return `${method.replace('Ref', '(Ref)').replace('Bs', '(Bs)')}: ${currencySymbol}${amt}${reference}`; 
          })
          .join(' + ');
      
      try {
          const saleData = {
              payment_method: paymentDescription || 'Pago Completo (0 USD)',
              // MODIFICADO: Incluir si el item es gravado o exento en el envío al backend
              items: cart.map(i => ({ 
                  product_id: i.id, 
                  quantity: i.quantity, 
                  price_usd: i.price_usd,
                  is_taxable: i.is_taxable // <-- CRUCIAL: Enviar el estatus fiscal
              })),
              is_credit: isCreditSale, 
              customer_data: isCreditSale ? customerData : null, 
              due_days: isCreditSale ? dueDays : null, 
          };
          
          Swal.fire({ title: `Procesando ${isCreditSale ? 'Crédito' : 'Venta'}...`, didOpen: () => Swal.showLoading() });
          
          const res = await axios.post(`${API_URL}/sales`, saleData);
          const { finalTotalUsd } = res.data; // Usamos el total final calculado por el backend (con IVA)

          Swal.fire({ 
              icon: 'success', 
              title: isCreditSale ? '¡Crédito Registrado!' : '¡Venta Registrada!', 
              html: `Inventario actualizado. Total Final: Ref ${finalTotalUsd}`, 
              confirmButtonColor: '#0056B3' 
          });

          // Resetear estados
          setCart([]);
          setIsCustomerModalOpen(false);
          setIsPaymentModalOpen(false); 
          setCustomerData({ full_name: '', id_number: '', phone: '', institution: '' });
          fetchData(); 
      } catch (error) {
          const message = error.response?.data?.message || error.message;
          Swal.fire('Error', `Fallo al procesar ${isCreditSale ? 'crédito' : 'venta'}`, 'error');
          console.error(error);
      }
  }


  // Función de validación y apertura de modal de cliente para Crédito
  const handleCreditProcess = async () => {
      const creditAmount = parseFloat(paymentShares['Crédito']) || 0;
      const creditUsed = creditAmount > 0;
      const isOverpaid = remainingUSD < -0.05; // Más de 5 centavos de cambio

      if (remainingUSD > 0.05 && (!creditUsed || creditAmount < remainingUSD)) {
          return Swal.fire('Monto Insuficiente', `Faltan Ref ${remainingUSD.toFixed(2)} por cubrir.`, 'warning');
      }
      
      // 💡 MEJORA UX: Confirmación de Vuelto
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

      if (creditUsed) {
          setIsCustomerModalOpen(true);
          setIsPaymentModalOpen(false); 
      } else {
          processSale(false);
      }
  }
  
  // --- NUEVAS FUNCIONES PARA CRÉDITO AGRUPADO ---
  const openCustomerCredits = async (customer) => {
      try {
          Swal.fire({title: 'Cargando...', didOpen: () => Swal.showLoading()});
          const res = await axios.get(`${API_URL}/credits/customer/${customer.customer_id}`);
          setCustomerCreditsDetails(res.data);
          setSelectedCreditCustomer(customer);
          Swal.close();
      } catch (error) {
          Swal.fire('Error', 'No se pudieron cargar los detalles', 'error');
      }
  };

  const handlePaymentProcess = async (saleId, totalDebt, currentPaid) => {
      const remaining = totalDebt - currentPaid;
      
      const { value: formValues } = await Swal.fire({
          title: `Abonar a Factura #${saleId}`,
          html: `
              <div class="text-left mb-4">
                  <p class="text-sm text-gray-500">Deuda Total: <b>Ref ${totalDebt.toFixed(2)}</b></p>
                  <p class="text-sm text-gray-500">Abonado: <b>Ref ${currentPaid.toFixed(2)}</b></p>
                  <p class="text-lg text-higea-red font-bold">Restante: Ref ${remaining.toFixed(2)}</p>
              </div>
              <label class="block text-left text-xs font-bold text-gray-600">Monto a Abonar (Ref)</label>
              <input id="swal-amount" type="number" step="0.01" class="swal2-input" value="${remaining.toFixed(2)}" placeholder="Monto en USD">
              
              <label class="block text-left text-xs font-bold text-gray-600 mt-2">Método de Pago</label>
              <select id="swal-method" class="swal2-input">
                  <option value="EFECTIVO_USD">Efectivo Ref</option>
                  <option value="ZELLE">Zelle</option>
                  <option value="PAGO_MOVIL">Pago Móvil (Bs)</option>
                  <option value="PUNTO_VENTA">Punto de Venta (Bs)</option>
              </select>
              <input id="swal-ref" class="swal2-input" placeholder="Referencia (Opcional)">
          `,
          showCancelButton: true,
          confirmButtonText: 'Procesar Pago',
          confirmButtonColor: '#0056B3',
          preConfirm: () => {
              const amount = document.getElementById('swal-amount').value;
              const method = document.getElementById('swal-method').value;
              const ref = document.getElementById('swal-ref').value;
              
              if (!amount || parseFloat(amount) <= 0) return Swal.showValidationMessage('Ingrese un monto válido');
              if (parseFloat(amount) > remaining + 0.05) return Swal.showValidationMessage('El monto excede la deuda');
              return { amount, method, ref };
          }
      });

      if (formValues) {
          try {
              Swal.fire({ title: 'Procesando...', didOpen: () => Swal.showLoading() });
              const paymentDetails = `${formValues.method}${formValues.ref ? ` [Ref: ${formValues.ref}]` : ''}`;
              
              await axios.post(`${API_URL}/sales/${saleId}/pay-credit`, {
                  paymentDetails,
                  amountUSD: formValues.amount
              });

              Swal.fire('Éxito', 'Abono registrado correctamente', 'success');
              // Recargar datos del cliente específico para ver cambios al instante
              const res = await axios.get(`${API_URL}/credits/customer/${selectedCreditCustomer.customer_id}`);
              setCustomerCreditsDetails(res.data);
              fetchData(); // Actualizar dashboard general
          } catch (error) {
              Swal.fire('Error', error.response?.data?.error || 'Falló el pago', 'error');
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
          // 💡 MEJORA: La ruta ahora devuelve saleInfo y los items
          const res = await axios.get(`${API_URL}/sales/${sale.id}`);
          
          setSelectedSaleDetail({ 
              id: sale.id, 
              items: res.data.items, 
              payment_method: sale.payment_method, 
              // Usamos los campos específicos del desglose que ahora devuelve el backend
              total_usd: parseFloat(res.data.total_usd),
              total_ves: parseFloat(res.data.total_ves),
              status: sale.status,
              full_name: sale.full_name,
              id_number: sale.id_number,
              due_date: sale.due_date,
              bcv_rate_snapshot: parseFloat(res.data.bcv_rate_snapshot), 
              taxBreakdown: {
                 subtotalTaxableUSD: parseFloat(res.data.subtotal_taxable_usd),
                 subtotalExemptUSD: parseFloat(res.data.subtotal_exempt_usd),
                 ivaUSD: parseFloat(res.data.iva_usd),
                 ivaRate: parseFloat(res.data.iva_rate),
              }
          });
      } catch (error) { console.error(error); }
  };
  
  // Componente Reutilizable para la entrada de Pago (UX Táctil)
  const PaymentInput = ({ name, currency, value }) => {
      const isSelected = currentMethod === name && isNumpadOpen;
      const displayValue = parseFloat(value) > 0 ? value : '0.00';
      const currencySymbol = currency === 'Ref' ? 'Ref ' : 'Bs ';

      const openNumpad = () => {
          setCurrentMethod(name);
          // Usamos 'value' directamente para evitar el error de estado
          setCurrentInputValue(parseFloat(value) > 0 ? value.toString() : '');
          setCurrentReference(paymentReferences[name] || ''); 
          setIsNumpadOpen(true);
      };

      const isCreditActive = name === 'Crédito' && parseFloat(value) > 0;

      return (
          <div 
              onClick={openNumpad}
              className={`flex justify-between items-center p-4 rounded-xl shadow-md cursor-pointer transition-all ${isCreditActive ? 'bg-red-100 border-higea-red border-2' : (isSelected ? 'bg-blue-100 border-higea-blue border-2' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100')}`}
          >
              <span className="font-bold text-gray-700">{name} ({currency})</span>
              <span className={`font-black text-xl ${isCreditActive ? 'text-higea-red' : 'text-gray-800'}`}>
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

  // Componente Modal de Captura de Cliente 
  const CustomerModal = () => {
      const isCreditUsed = (parseFloat(paymentShares['Crédito']) || 0) > 0;
      
      // Implementación de debounce para la búsqueda (Solo por ID)
      const debouncedSearch = useCallback(
          debounce((query) => searchCustomers(query), 300),
          []
      );

      // Usamos la función de validación/capitalización en el input handler
      const handleIdChange = (e) => {
          // Usa la validación de formato
          const value = validateIdNumber(e.target.value); 
          setCustomerData(prev => ({ 
             ...prev, 
             id_number: value,
             // Limpia temporalmente nombre e institución si el ID cambia y no hay selección
             full_name: customerSearchResults.find(c => c.id_number === value)?.full_name || prev.full_name,
             institution: customerSearchResults.find(c => c.id_number === value)?.institution || prev.institution,
           }));
          
          if (value.length > 3) {
             debouncedSearch(value);
          } else {
             setCustomerSearchResults([]);
          }
      };
      
      const handleNameChange = (e) => {
          const value = capitalizeWords(e.target.value); 
          setCustomerData(prev => ({ ...prev, full_name: value }));
      };

      const handleSelectCustomer = (customer) => {
          setCustomerData({
              full_name: customer.full_name,
              id_number: customer.id_number,
              phone: customer.phone || '',
              institution: customer.institution || '',
          });
          setCustomerSearchResults([]); // Cerrar resultados
      };

      const handleChange = (e) => {
          const { name, value } = e.target;
          let newValue = value;
          
          if (name === 'phone') {
              newValue = validatePhone(value);
          } else if (name === 'institution') {
              newValue = capitalizeWords(value);
          }
          
          setCustomerData(prev => ({ ...prev, [name]: newValue }));
      };

      // Determinar si el formulario está listo para el envío (nombre y ID obligatorios)
      const isFormReadyToSubmit = customerData.full_name.trim() && customerData.id_number.trim();
      
      return (
          <div className="fixed inset-0 z-[65] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-scale-up">
                  <div className="bg-higea-blue p-5 text-white text-center">
                      <h3 className="text-xl font-bold">Registro de Crédito</h3>
                      <p className="text-sm mt-1">Total a Financiar: Ref {finalTotalUSD.toFixed(2)}</p>
                  </div>
                  
                  <div className="p-5 space-y-4">
                      <div className="flex justify-between items-center bg-yellow-50 p-3 rounded-xl border border-yellow-200">
                          <span className="font-bold text-yellow-800 text-sm">Plazo de Pago</span>
                          <div className="flex gap-2">
                            <button onClick={() => setDueDays(15)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 15 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>15 Días</button>
                            <button onClick={() => setDueDays(30)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 30 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>30 Días</button>
                          </div>
                      </div>

                      {/* Campo de Número de Identificador (Clave para Búsqueda) */}
                      <div className="relative">
                          {/* CAMBIO DE ETIQUETA/PLACEHOLDER */}
                          <input type="text" name="id_number" placeholder="Cédula/Rif (*)" onChange={handleIdChange} value={customerData.id_number} 
                              className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none font-bold" 
                              autoFocus={true} 
                              style={{ paddingRight: isSearchingCustomer ? '40px' : '15px' }}
                              /> 
                          
                          {isSearchingCustomer && (
                            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 border-2 border-higea-blue border-t-transparent rounded-full animate-spin"></div>
                          )}

                          {/* RESULTADOS DE BÚSQUEDA (Si hay) */}
                          {customerSearchResults.length > 0 && (
                              <div className="absolute top-full left-0 w-full bg-white border border-gray-200 rounded-xl mt-1 shadow-lg z-10 max-h-40 overflow-y-auto">
                                  {customerSearchResults.map(customer => (
                                      <div 
                                          key={customer.id} 
                                          onClick={() => handleSelectCustomer(customer)}
                                          className="p-3 border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                                      >
                                          <p className="font-bold text-gray-800 leading-tight">{customer.full_name}</p>
                                          <p className="text-xs text-gray-500">ID: {customer.id_number} - {customer.institution}</p>
                                      </div>
                                  ))}
                              </div>
                          )}
                           {/* Aviso si no hay resultados ACTIVO */}
                           {(customerData.id_number.length >= 3 && customerSearchResults.length === 0 && !isSearchingCustomer) && (
                                <p className="text-xs text-red-500 mt-1">No se encontró cliente **ACTIVO**. Los datos se usarán para crearlo o actualizarlo.</p>
                          )}
                      </div>
                      
                      <input type="text" name="full_name" placeholder="Nombre Completo (*)" onChange={handleNameChange} value={customerData.full_name} 
                          className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                          onFocus={() => setCustomerSearchResults([])} 
                          /> 
                      
                      <div className="grid grid-cols-2 gap-4">
                          <input type="tel" name="phone" placeholder="Teléfono" onChange={handleChange} value={customerData.phone} 
                              className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                              onFocus={() => setCustomerSearchResults([])} />
                          <input type="text" name="institution" placeholder="Institución/Referencia" onChange={handleChange} value={customerData.institution} 
                              className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                              onFocus={() => setCustomerSearchResults([])} />
                      </div>
                          
                      {isCreditUsed && <p className="text-xs text-gray-500 italic">* Esta venta será marcada como PENDIENTE de pago. Se requiere Nombre e Identificador.</p>}
                  </div>

                  <div className="p-5 flex gap-3 bg-white border-t border-gray-50">
                      <button onClick={() => { setIsCustomerModalOpen(false); setIsPaymentModalOpen(true); }} className="flex-1 py-3 text-gray-500 font-bold text-sm">Volver</button>
                      <button 
                          onClick={() => processSale(true)} 
                          disabled={!isFormReadyToSubmit}
                          className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all ${!isFormReadyToSubmit ? 'bg-gray-300' : 'bg-higea-red hover:bg-red-700'}`}
                      >
                          Confirmar Crédito
                      </button>
                  </div>
              </div>
          </div>
      );
  }
  
  // Cargar detalle de ventas de hoy al hacer click en la tarjeta
  const openDailySalesDetail = async () => {
      try {
          Swal.fire({title: 'Cargando...', didOpen: () => Swal.showLoading()});
          const res = await axios.get(`${API_URL}/reports/sales-today`);
          setDailySalesList(res.data);
          setShowDailySalesModal(true);
          Swal.close();
      } catch (error) {
          Swal.close();
      }
  };

  // Cargar Reporte Avanzado con Filtro de Fecha
  const fetchAdvancedReport = async () => {
      try {
          Swal.fire({title: 'Generando Estadísticas...', didOpen: () => Swal.showLoading()});
          const res = await axios.get(`${API_URL}/reports/analytics?startDate=${reportDateRange.start}&endDate=${reportDateRange.end}`);
          setAnalyticsData(res.data);
          Swal.close();
      } catch (error) {
          Swal.fire('Error', 'No se pudo generar el reporte', 'error');
      }
  };

  // COMPONENTE VISUAL: Barra de Progreso Simple (Para gráficas sin librerías)
  const SimpleBarChart = ({ data, labelKey, valueKey, colorClass, formatMoney }) => {
      if (!data || data.length === 0) return <p className="text-gray-400 text-sm">Sin datos disponibles.</p>;
      
      const maxValue = Math.max(...data.map(d => parseFloat(d[valueKey])));
      
      return (
          <div className="space-y-3">
              {data.map((item, idx) => {
                  const val = parseFloat(item[valueKey]);
                  const percent = maxValue > 0 ? (val / maxValue) * 100 : 0;
                  return (
                      <div key={idx} className="w-full">
                          <div className="flex justify-between text-xs mb-1">
                              <span className="font-bold text-gray-700 truncate w-2/3">{item[labelKey]}</span>
                              <span className="font-medium text-gray-600">
                                  {formatMoney ? `Ref ${val.toFixed(2)}` : val}
                              </span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                              <div 
                                  className={`h-2.5 rounded-full ${colorClass}`} 
                                  style={{ width: `${percent}%`, transition: 'width 1s ease-in-out' }}
                              ></div>
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
            <div className="h-10 w-10 bg-gray-50 rounded-lg flex items-center justify-center text-lg">{item.category === 'Bebidas' ? '🥤' : '🍔'}</div>
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


  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans overflow-hidden text-gray-800">
      
      {/* SIDEBAR PC (Navegación actualizada) */}
      <nav className="hidden md:flex w-20 bg-white border-r border-gray-200 flex-col items-center py-6 z-40 shadow-lg">
          <div className="mb-8 h-10 w-10 bg-higea-red rounded-xl flex items-center justify-center text-white font-bold text-xl">H</div>
          <button onClick={() => setView('POS')} className={`p-3 rounded-xl mb-4 transition-all ${view === 'POS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg></button>
          
          <button onClick={() => { fetchData(); setView('DASHBOARD'); }} className={`p-3 rounded-xl transition-all relative ${view === 'DASHBOARD' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" /></svg>
              {/* Notificación de Créditos Vencidos */}
              {overdueCount > 0 && <span className="absolute top-1 right-1 h-3 w-3 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">{overdueCount}</span>}
          </button>
          
          <button onClick={() => { fetchData(); setView('CREDIT_REPORT'); }} className={`p-3 rounded-xl transition-all mb-4 ${view === 'CREDIT_REPORT' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
          </button>
          
          {/* BOTÓN NUEVO MÓDULO (Punto 1) */}
          <button onClick={() => { setView('CUSTOMERS'); }} className={`p-3 rounded-xl transition-all ${view === 'CUSTOMERS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </button>

          {/* 💡 NUEVO BOTÓN: Gestión de Productos */}
          <button onClick={() => { setView('PRODUCTS'); }} className={`p-3 rounded-xl transition-all ${view === 'PRODUCTS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>
		  
		  {/* ↓↓↓ NUEVO BOTÓN AQUÍ (Reportes Avanzados) ↓↓↓ */}
          <button onClick={() => { setView('ADVANCED_REPORTS'); fetchAdvancedReport(); }} className={`p-3 rounded-xl transition-all ${view === 'ADVANCED_REPORTS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
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

                  {/* Filtros de Categoría (Ahora ocupan su propia fila) */}
                  <div className="px-4 py-3 overflow-x-auto no-scrollbar flex items-center gap-2 bg-[#F8FAFC]">
                      {categories.map(cat => (
                          <button key={cat} onClick={() => setSelectedCategory(cat)} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold border transition-all ${selectedCategory === cat ? 'bg-higea-blue text-white border-higea-blue' : 'bg-white text-gray-500 border-gray-200'}`}>{cat}</button>
                      ))}
                  </div>

                  {/* 💡 MODIFICADO: Usar currentProducts para aplicar paginación */}
                  <div className="flex-1 overflow-y-auto px-4 pb-20 md:pb-6 custom-scrollbar">
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                      {currentProducts.map((prod) => (
                        <div key={prod.id} onClick={() => addToCart(prod)} className="bg-white rounded-2xl p-3 border border-gray-100 shadow-sm active:scale-95 transition-transform">
                          <div className="flex justify-between items-start mb-2">
                              <div className="h-10 w-10 bg-gray-50 rounded-lg flex items-center justify-center text-xl">{prod.icon_emoji}</div>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${prod.stock < 5 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>{prod.stock}</span>
                          </div>
                          <h3 className="font-bold text-gray-800 text-sm leading-tight line-clamp-2 h-10">{prod.name}</h3>
                          <div className="flex flex-col mt-2">
                              {/* Ref */}
                              <span className="text-lg font-black text-higea-red">Ref {prod.price_usd}</span>
                              <span className="text-xs font-bold text-higea-blue">Bs {prod.price_ves}</span>
                          </div>
                        </div>
                      ))}
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
                  <div className="p-5 border-b border-gray-100">
                      <h2 className="text-lg font-bold text-gray-800">Orden Actual</h2>
                      
                      {/* FECHA Y PUNTO VERDE DE CAJA ABIERTA */}
                      <div className="flex items-center gap-2 mt-1">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                          </span>
                          <p className="text-xs text-gray-500">{new Date().toLocaleDateString()} • Caja Abierta</p>
                      </div>
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

                  {/* 3. ALERTAS DE STOCK (Limitado a 4 con Modal) */}
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-red-100 bg-red-50/30 relative">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-red-400 text-xs font-bold uppercase">Alertas Stock ({lowStock.length})</p>
                        {lowStock.length > 4 && (
                            <button onClick={() => setShowStockModal(true)} className="text-[10px] font-bold text-red-600 bg-white px-2 py-1 rounded-full border border-red-100 hover:bg-red-50">Ver Todo</button>
                        )}
                      </div>
                      <div className="space-y-2">
                          {lowStock.slice(0, 4).map((p, i) => ( // Limite de 4
                              <div key={i} className="flex justify-between items-center text-xs bg-white p-1.5 rounded-lg border border-red-50">
                                  <span className="truncate w-3/4 font-medium text-gray-600">{p.icon_emoji} {p.name}</span>
                                  <span className="font-bold text-red-500 bg-red-100 px-1.5 rounded">{p.stock}</span>
                              </div>
                          ))}
                          {lowStock.length === 0 && <p className="text-xs text-green-600 font-bold">¡Inventario Saludable!</p>}
                      </div>
                  </div>

                  {/* 4. TOP DEUDORES (Mini Lista) */}
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-orange-100 bg-orange-50/30">
                       <p className="text-orange-400 text-xs font-bold uppercase mb-2">Top Deudores</p>
                       <div className="space-y-2">
                           {topDebtors.slice(0, 3).map((d, i) => (
                               <div key={i} className="flex justify-between items-center text-xs">
                                   <span className="truncate w-2/3 font-bold text-gray-600">{d.full_name.split(' ')[0]}...</span>
                                   <span className="font-black text-orange-600">Ref {parseFloat(d.debt).toFixed(2)}</span>
                               </div>
                           ))}
                           {topDebtors.length === 0 && <p className="text-xs text-gray-400">Sin deudas pendientes.</p>}
                           {topDebtors.length > 0 && <button onClick={() => setView('CREDIT_REPORT')} className="w-full mt-2 text-[10px] font-bold text-orange-600 hover:underline">Ir a Cobranzas →</button>}
                       </div>
                  </div>
              </div>

              {/* ÚLTIMAS TRANSACCIONES (Igual que antes pero con mejor estilo) */}
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-bold text-gray-800">Últimas Transacciones</h3>
                      <span className="text-xs text-gray-400">Mostrando últimas 10</span>
                  </div>
                  <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs md:text-sm text-gray-600">
                          <thead className="bg-gray-50 text-gray-400 uppercase font-bold">
                              <tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3 text-center">Estatus</th><th className="px-4 py-3 text-right">Monto Ref</th><th className="px-4 py-3 text-right">Monto Bs</th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {recentSales.map((sale) => (
                                  <tr key={sale.id} onClick={() => showSaleDetail(sale)} className="hover:bg-blue-50 cursor-pointer transition-colors">
                                      <td className="px-4 py-3 font-bold text-higea-blue">#{sale.id}</td>
                                      <td className="px-4 py-3">{sale.full_date}</td>
                                      <td className="px-4 py-3 font-medium text-gray-700">{sale.full_name || 'Consumidor Final'}</td>
                                      <td className="px-4 py-3 text-center">
                                          <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                                            sale.status === 'PENDIENTE' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                                          }`}>
                                              {sale.status}
                                          </span>
                                      </td>
                                      <td className="px-4 py-3 text-right font-black text-gray-800">Ref {parseFloat(sale.total_usd).toFixed(2)}</td> 
                                      <td className="px-4 py-3 text-right text-gray-500">Bs {parseFloat(sale.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 0 })}</td> 
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
           </div>
        ) : view === 'CREDIT_REPORT' ? (
             /* NUEVO PANEL DE REPORTES DE CRÉDITO AGRUPADO */
           <div className="p-4 md:p-8 overflow-y-auto h-full">
               <h2 className="text-2xl font-black text-gray-800 mb-6">Cuentas por Cobrar (Consolidado)</h2>
               
               {/* Si no hay cliente seleccionado, mostramos la LISTA GENERAL AGRUPADA */}
               {!selectedCreditCustomer ? (
                   <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                       <div className="p-5 border-b border-gray-100 bg-gray-50"><h3 className="font-bold text-gray-800">Clientes con Deuda ({groupedCredits.length})</h3></div>
                       <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs md:text-sm text-gray-600">
                                <thead className="bg-gray-100 text-gray-500 uppercase font-bold">
                                    <tr>
                                        <th className="px-4 py-3">Cliente</th>
                                        <th className="px-4 py-3">Identificador</th>
                                        <th className="px-4 py-3 text-center">Facturas</th>
                                        <th className="px-4 py-3 text-right">Deuda Total</th>
                                        <th className="px-4 py-3 text-right">Restante</th>
                                        <th className="px-4 py-3 text-center">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {groupedCredits.map((client) => (
                                        <tr key={client.customer_id} className="hover:bg-blue-50 cursor-pointer" onClick={() => openCustomerCredits(client)}>
                                            <td className="px-4 py-3 font-bold text-higea-blue">{client.full_name}</td>
                                            <td className="px-4 py-3">{client.id_number}</td>
                                            <td className="px-4 py-3 text-center"><span className="bg-gray-200 px-2 py-1 rounded-full text-xs font-bold">{client.total_bills}</span></td>
                                            <td className="px-4 py-3 text-right text-gray-400">Ref {parseFloat(client.total_debt).toFixed(2)}</td>
                                            <td className="px-4 py-3 text-right font-black text-higea-red text-base">Ref {parseFloat(client.remaining_balance).toFixed(2)}</td>
                                            <td className="px-4 py-3 text-center">
                                                <button className="bg-blue-100 text-higea-blue text-xs font-bold px-3 py-1.5 rounded-xl hover:bg-blue-200">
                                                    Ver Detalles
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {groupedCredits.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-gray-400">¡Al día! No hay deudas pendientes.</td></tr>}
                                </tbody>
                            </table>
                       </div>
                   </div>
               ) : (
                   /* Si hay cliente seleccionado, mostramos SUS FACTURAS */
                   <div className="bg-white rounded-3xl shadow-lg border border-gray-200 overflow-hidden animate-slide-up">
                        <div className="p-5 border-b border-gray-100 bg-blue-50 flex justify-between items-center">
                            <div>
                                <button onClick={() => setSelectedCreditCustomer(null)} className="text-gray-500 hover:text-higea-blue font-bold text-sm mb-1 flex items-center gap-1">← Volver al listado</button>
                                <h3 className="text-xl font-black text-higea-blue">{selectedCreditCustomer.full_name}</h3>
                                <p className="text-sm text-gray-600">ID: {selectedCreditCustomer.id_number}</p>
                            </div>
                            <div className="text-right bg-white p-3 rounded-xl border border-blue-100 shadow-sm">
                                <p className="text-xs text-gray-500 uppercase font-bold">Total a Pagar</p>
                                <p className="text-2xl font-black text-higea-red">Ref {parseFloat(selectedCreditCustomer.remaining_balance).toFixed(2)}</p>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs md:text-sm text-gray-600">
                                <thead className="bg-gray-100 text-gray-500 uppercase font-bold">
                                    <tr>
                                        <th className="px-4 py-3"># Venta</th>
                                        <th className="px-4 py-3">Fecha</th>
                                        <th className="px-4 py-3">Vence</th>
                                        <th className="px-4 py-3 text-right">Total</th>
                                        <th className="px-4 py-3 text-right">Abonado</th>
                                        <th className="px-4 py-3 text-right">Pendiente</th>
                                        <th className="px-4 py-3 text-center">Estado</th>
                                        <th className="px-4 py-3 text-right">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {customerCreditsDetails.map((sale) => (
                                        <tr key={sale.id} className={sale.is_overdue ? 'bg-red-50' : ''}>
                                            <td className="px-4 py-3 font-bold text-higea-blue">#{sale.id}</td>
                                            <td className="px-4 py-3">{new Date(sale.created_at).toLocaleDateString()}</td>
                                            <td className={`px-4 py-3 font-bold ${sale.is_overdue ? 'text-red-600' : ''}`}>
                                                {new Date(sale.due_date).toLocaleDateString()}
                                                {sale.is_overdue && <span className="ml-1 text-[9px] bg-red-600 text-white px-1 rounded">VENCIDA</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right">Ref {parseFloat(sale.total_usd).toFixed(2)}</td>
                                            <td className="px-4 py-3 text-right text-green-600">Ref {parseFloat(sale.amount_paid_usd || 0).toFixed(2)}</td>
                                            <td className="px-4 py-3 text-right font-black text-gray-800">Ref {parseFloat(sale.remaining_amount).toFixed(2)}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`px-2 py-1 rounded text-[10px] font-bold ${sale.status === 'PARCIAL' ? 'bg-orange-100 text-orange-600' : 'bg-yellow-100 text-yellow-600'}`}>
                                                    {sale.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right flex gap-2 justify-end">
                                                <button onClick={() => showSaleDetail(sale)} className="bg-gray-100 text-gray-600 p-2 rounded-lg hover:bg-gray-200" title="Ver Items">👁️</button>
                                                <button onClick={() => handlePaymentProcess(sale.id, parseFloat(sale.total_usd), parseFloat(sale.amount_paid_usd || 0))} className="bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-green-600 shadow-md active:scale-95 transition-transform">
                                                    Abonar
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                   </div>
               )}
           </div>
        ) : view === 'CUSTOMERS' ? (
            /* MÓDULO DE CLIENTES (CUSTOMERS) - APLICACIÓN DE PAGINACIÓN Y EDICIÓN RÁPIDA */
           <div className="p-4 md:p-8 overflow-y-auto h-full">
                <h2 className="text-2xl font-black text-gray-800 mb-6">Gestión de Clientes</h2>

                {/* Cálculos de Paginación para Clientes */}
                {(() => {
                    const customersPerPage = 10;
                    const indexOfLastCustomer = customerCurrentPage * customersPerPage;
                    const indexOfFirstCustomer = indexOfLastCustomer - customersPerPage;
                    const currentCustomers = filteredCustomers.slice(indexOfFirstCustomer, indexOfLastCustomer);
                    const customerTotalPages = Math.ceil(filteredCustomers.length / customersPerPage);

                    return (
                        <>
                            {/* Formulario de Registro/Edición */}
                            <div className="bg-white p-5 rounded-3xl shadow-lg border border-gray-100 mb-8 max-w-lg mx-auto">
                                <h3 className="text-xl font-bold text-higea-blue mb-4">{customerForm.id ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
                                <form onSubmit={saveCustomer}>
                                    {/* Campos con las nuevas validaciones */}
                                    <input 
                                        type="text" 
                                        name="full_name" 
                                        placeholder="Nombre Completo (*)" 
                                        value={customerForm.full_name}
                                        onChange={handleCustomerFormChange} 
                                        className="w-full border p-3 rounded-xl mb-3 focus:border-higea-blue outline-none" 
                                        required
                                    />
                                    
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                        {/* Número de Identificador (Punto 2) */}
                                        <input 
                                            type="text" 
                                            name="id_number" 
                                            placeholder="Número de Identificador (*)" 
                                            value={customerForm.id_number}
                                            onChange={handleCustomerFormChange} 
                                            className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none font-bold" 
                                            required
                                        />
                                        {/* Teléfono (Punto 3) */}
                                        <input 
                                            type="tel" 
                                            name="phone" 
                                            placeholder="Teléfono" 
                                            value={customerForm.phone}
                                            onChange={handleCustomerFormChange} 
                                            className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                                        />
                                    </div>
                                    
                                    <input 
                                        type="text" 
                                        name="institution" 
                                        placeholder="Institución/Referencia" 
                                        value={customerForm.institution}
                                        onChange={handleCustomerFormChange} 
                                        className="w-full border p-3 rounded-xl mb-3 focus:border-higea-blue outline-none" 
                                    />

                                    <div className="flex gap-4 items-center">
                                        <label className="text-sm font-bold text-gray-600">Estatus:</label>
                                        <select 
                                            name="status"
                                            value={customerForm.status}
                                            onChange={handleCustomerFormChange}
                                            className="border p-3 rounded-xl flex-1 bg-white"
                                        >
                                            <option value="ACTIVO">ACTIVO (Apto para crédito)</option>
                                            <option value="INACTIVO">INACTIVO (No apto para crédito)</option>
                                        </select>
                                    </div>

                                    <button 
                                        type="submit"
                                        className="w-full bg-green-600 text-white font-bold py-3 rounded-xl mt-4 shadow-md hover:bg-green-700"
                                    >
                                        {customerForm.id ? 'Guardar Cambios' : 'Registrar Nuevo Cliente'}
                                    </button>

                                    <button 
                                        type="button"
                                        onClick={() => setCustomerForm({ id: null, full_name: '', id_number: '', phone: '', institution: '', status: 'ACTIVO' })}
                                        className="w-full bg-gray-200 text-gray-700 font-bold py-3 rounded-xl mt-2 hover:bg-gray-300"
                                    >
                                        Limpiar Formulario
                                    </button>
                                </form>
                            </div>

                            {/* Tabla de Listado de Clientes */}
                            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mt-8">
                                <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                                    <h3 className="font-bold text-gray-800">Listado de Clientes ({filteredCustomers.length})</h3>
                                    {/* 💡 MEJORA UX: Búsqueda en listado */}
                                     <input 
                                        type="text" 
                                        placeholder="Buscar por Nombre, ID o Teléfono..." 
                                        value={customerSearchQuery}
                                        onChange={(e) => setCustomerSearchQuery(e.target.value)}
                                        className="border p-2 rounded-lg text-sm w-1/2 focus:border-higea-blue outline-none" 
                                    />
                                </div>
                                 <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs md:text-sm text-gray-600">
                                        <thead className="bg-gray-50 text-gray-400 uppercase font-bold">
                                            <tr>
                                                <th className="px-4 py-3">ID</th>
                                                <th className="px-4 py-3">Nombre</th>
                                                <th className="px-4 py-3">Identificador</th>
                                                <th className="px-4 py-3">Teléfono</th>
                                                <th className="px-4 py-3">Estatus</th>
                                                <th className="px-4 py-3 text-right">Acción</th> {/* Se mantiene la columna por consistencia con Product */}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {/* Usamos currentCustomers para la paginación */}
                                            {currentCustomers.map((customer) => (
                                                <tr 
                                                    key={customer.id} 
                                                    onClick={() => editCustomer(customer)} // <-- EDICIÓN RÁPIDA (Click en la fila)
                                                    className="hover:bg-blue-50 cursor-pointer"
                                                >
                                                    <td className="px-4 py-3 font-bold text-higea-blue">#{customer.id}</td>
                                                    <td className="px-4 py-3 text-gray-800">{customer.full_name}</td>
                                                    <td className="px-4 py-3 font-medium">{customer.id_number}</td>
                                                    <td className="px-4 py-3">{customer.phone || 'N/A'}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                                                            (customer.status || 'ACTIVO') === 'ACTIVO' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                        }`}>
                                                            {customer.status || 'ACTIVO'} 
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button onClick={(e) => { e.stopPropagation(); editCustomer(customer); }} className="bg-higea-blue text-white text-xs font-bold px-3 py-1.5 rounded-xl hover:bg-blue-700 active:scale-95 transition-transform">
                                                            Editar
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                 </div>
                                 {filteredCustomers.length === 0 && <p className="p-4 text-center text-gray-400">No se encontraron clientes con esos criterios de búsqueda.</p>}
                                 
                                 {/* Controles de Paginación de Clientes */}
                                 {customerTotalPages > 1 && (
                                    <div className="p-4 border-t border-gray-200 flex justify-center items-center gap-4 bg-white">
                                        <button 
                                            onClick={() => setCustomerCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={customerCurrentPage === 1} 
                                            className="px-3 py-1 rounded-lg text-sm font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors"
                                        >
                                            Anterior
                                        </button>
                                        <span className="text-sm font-bold text-gray-700">Página {customerCurrentPage} de {customerTotalPages}</span>
                                        <button 
                                            onClick={() => setCustomerCurrentPage(prev => Math.min(customerTotalPages, prev + 1))}
                                            disabled={customerCurrentPage === customerTotalPages} 
                                            className="px-3 py-1 rounded-lg text-sm font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors"
                                        >
                                            Siguiente
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    );
                })()}
           </div>

        ) : view === 'PRODUCTS' ? (
            /* RENDERIZADO DIRECTO DEL CONTENIDO DE LA VISTA DE PRODUCTOS - APLICACIÓN DE PAGINACIÓN */
            <div className="p-4 md:p-8 overflow-y-auto h-full">
                <h2 className="text-2xl font-black text-gray-800 mb-6">Gestión de Productos e Inventario</h2>
                
                {/* Cálculos de Paginación para Inventario */}
                {(() => {
                    const inventoryPerPage = 10;
                    const indexOfLastInventory = inventoryCurrentPage * inventoryPerPage;
                    const indexOfFirstInventory = indexOfLastInventory - inventoryPerPage;
                    // Usamos la porción de la lista filtrada que corresponde a la página actual
                    const currentInventory = filteredInventory.slice(indexOfFirstInventory, indexOfLastInventory);
                    const inventoryTotalPages = Math.ceil(filteredInventory.length / inventoryPerPage);
                    
                    return (
                        <>
                            {/* Formulario de Creación/Edición con campo is_taxable */}
                            <div className="bg-white p-5 rounded-3xl shadow-lg border border-gray-100 mb-8 max-w-xl mx-auto">
                                <h3 className="text-xl font-bold text-higea-blue mb-4">{productForm.id ? 'Editar Producto' : 'Nuevo Producto'}</h3>
                                <form onSubmit={saveProduct}>
                                    {/* El campo name usa la nueva validación/formato */}
                                    <input type="text" name="name" placeholder="Nombre del Producto (*)" value={productForm.name} onChange={handleProductFormChange} className="w-full border p-3 rounded-xl mb-3 focus:border-higea-blue outline-none" required />
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                        {/* El campo category usa la nueva validación/formato */}
                                        <input type="text" name="category" placeholder="Categoría" value={productForm.category} onChange={handleProductFormChange} className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" />
                                        <input type="number" name="price_usd" placeholder="Precio USD (*)" value={productForm.price_usd} onChange={handleProductFormChange} step="0.01" min="0.01" className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" required />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <input type="number" name="stock" placeholder="Stock Inicial/Actual" value={productForm.stock} onChange={handleProductFormChange} min="0" className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" required />
                                        
                                        {/* Input de texto para entrada libre y Emojis seleccionados */}
                                        <input 
                                            type="text" 
                                            name="icon_emoji" 
                                            placeholder="Icono Emoji (🍔)" 
                                            value={productForm.icon_emoji} 
                                            onChange={handleProductFormChange} 
                                            className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none text-xl text-center font-bold" 
                                            maxLength="1" // Limita a un solo carácter/emoji
                                            required
                                        />
                                    </div>
                                    
                                    {/* NUEVA SECCIÓN: Selector rápido de Emojis (Más compacto, 6 columnas) */}
                                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 mb-4">
                                        <label className="text-sm font-bold text-gray-600 flex-shrink-0 block mb-2">Selección Rápida de Emoji:</label>
                                        
                                        {/* Contenedor para 6 columnas en móvil/tablet y scroll vertical más compacto (max-h-28 ~ 112px) */}
                                        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1 max-h-28 overflow-y-scroll p-1 border border-dashed border-gray-300 rounded-lg"> 
                                            
                                            {EMOJI_OPTIONS.map((emoji, index) => (
                                                <button
                                                    type="button"
                                                    key={index}
                                                    onClick={() => handleEmojiSelect(emoji)}
                                                    // p-1.5 y text-base para que sigan siendo legibles, pero compactos
                                                    className={`text-base p-1.5 rounded-lg transition-all border w-full text-center flex items-center justify-center ${productForm.icon_emoji === emoji ? 'bg-higea-blue text-white border-higea-blue' : 'bg-white hover:bg-gray-200 border-gray-200'}`}
                                                    title={emoji}
                                                >
                                                    {emoji}
                                                </button>
                                            ))}
                                        </div>
                                        <p className='text-xs text-gray-500 mt-2 text-center'>Selecciona un icono de la lista o escríbelo directamente en el campo de arriba.</p>
                                    </div>
                                    {/* FIN MODIFICACIÓN */}
                                    
                                    {/* 🇻🇪 REQUISITO FISCAL: Control del IVA */}
                                    <div className="flex gap-4 items-center bg-gray-50 p-3 rounded-xl border border-gray-200 mb-4">
                                        <label className="text-sm font-bold text-gray-600 flex-shrink-0">Estatus Fiscal (IVA 16%):</label>
                                        <select 
                                            name="is_taxable"
                                            // CRUCIAL: Convertir a string para el selector HTML
                                            value={productForm.is_taxable.toString()} 
                                            onChange={handleProductFormChange}
                                            className="border p-3 rounded-xl flex-1 bg-white font-bold text-sm"
                                        >
                                            <option value="true">GRAVADO (Sujeto a IVA)</option>
                                            <option value="false">EXENTO (No lleva IVA)</option>
                                        </select>
                                    </div>
                                    {/* FIN REQUISITO FISCAL */}
                                    
                                    <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-xl shadow-md hover:bg-green-700">
                                        {productForm.id ? 'Guardar Cambios' : 'Registrar Producto'}
                                    </button>
                                    <button type="button" onClick={() => setProductForm({ id: null, name: '', category: '', price_usd: 0.00, stock: 0, is_taxable: true, icon_emoji: EMOJI_OPTIONS[0] || '🍔' })} className="w-full bg-gray-200 text-gray-700 font-bold py-3 rounded-xl mt-2 hover:bg-gray-300">Limpiar Formulario</button>
                                </form>
                            </div>
                            
                            {/* TABLA DE INVENTARIO ACTUAL (MODIFICADA CON BÚSQUEDA Y CLIC DE EDICIÓN) */}
                             <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                                 <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                                     <h3 className="font-bold text-gray-800">Inventario Actual ({filteredInventory.length})</h3>
                                     {/* Input de Búsqueda de Artículos */}
                                     <input 
                                        type="text" 
                                        placeholder="Buscar por Nombre, Categoría o ID..." 
                                        value={productSearchQuery}
                                        onChange={(e) => setProductSearchQuery(e.target.value)}
                                        // FIX: Mantiene el foco
                                        key="inventory-search-input"
                                        className="border p-2 rounded-lg text-sm w-1/2 focus:border-higea-blue outline-none" 
                                    />
                                </div>
                                 <div className="overflow-x-auto">
                                     <table className="w-full text-left text-xs md:text-sm text-gray-600">
                                         <thead className="bg-gray-50 text-gray-400 uppercase font-bold">
                                             <tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Nombre</th><th className="px-4 py-3">Categoría</th><th className="px-4 py-3">Status Fiscal</th><th className="px-4 py-3 text-right">Precio Ref</th><th className="px-4 py-3 text-right">Stock</th><th className="px-4 py-3 text-right">Acción</th></tr>
                                         </thead>
                                         <tbody className="divide-y divide-gray-100">
                                              {/* Usamos currentInventory para la paginación */}
                                              {currentInventory.map(p => (
                                               <tr 
                                                   key={p.id}
                                                   // 💡 EDICIÓN RÁPIDA: Clic en la fila carga el formulario
                                                   onClick={() => {
                                                    setProductForm({
                                                        id: p.id, 
                                                        name: p.name, 
                                                        category: p.category, 
                                                        price_usd: parseFloat(p.price_usd), 
                                                        stock: p.stock, 
                                                        icon_emoji: p.icon_emoji, 
                                                        is_taxable: p.is_taxable
                                                    });
                                                    window.scrollTo(0, 0); // Desplazar hacia arriba para ver el formulario
                                                   }}
                                                   className="hover:bg-blue-50 cursor-pointer"
                                               >
                                                   <td className="px-4 py-3 font-bold text-higea-blue">#{p.id}</td>
                                                   <td className="px-4 py-3 text-gray-800">{p.name}</td>
                                                   <td className="px-4 py-3">{p.category}</td>
                                                   <td className="px-4 py-3">
                                                       <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.is_taxable ? 'bg-blue-100 text-higea-blue' : 'bg-green-100 text-green-600'}`}>
                                                          {p.is_taxable ? 'GRAVADO' : 'EXENTO'}
                                                       </span>
                                                   </td>
                                                   <td className="px-4 py-3 text-right">Ref {parseFloat(p.price_usd).toFixed(2)}</td>
                                                   <td className={`px-4 py-3 text-right font-bold ${p.stock <= 5 ? 'text-red-500' : 'text-gray-800'}`}>{p.stock}</td>
                                                   <td className="px-4 py-3 text-right">
                                                       <button 
                                                          onClick={(e) => {
                                                            e.stopPropagation(); // Evitar que el clic de la fila se dispare
                                                            setProductForm({
                                                                id: p.id, 
                                                                name: p.name, 
                                                                category: p.category, 
                                                                price_usd: parseFloat(p.price_usd), 
                                                                stock: p.stock, 
                                                                icon_emoji: p.icon_emoji, 
                                                                is_taxable: p.is_taxable
                                                            });
                                                            window.scrollTo(0, 0);
                                                           }} 
                                                           className="bg-higea-blue text-white text-xs font-bold px-3 py-1.5 rounded-xl hover:bg-blue-700">Editar</button>
                                                   </td>
                                               </tr>
                                              ))}
                                         </tbody>
                                     </table>
                                 </div>
                                 {filteredInventory.length === 0 && <p className="p-4 text-center text-gray-400">No se encontraron artículos con esos criterios de búsqueda.</p>}
                                 
                                 {/* Controles de Paginación de Inventario */}
                                 {inventoryTotalPages > 1 && (
                                    <div className="p-4 border-t border-gray-200 flex justify-center items-center gap-4 bg-white">
                                        <button 
                                            onClick={() => setInventoryCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={inventoryCurrentPage === 1} 
                                            className="px-3 py-1 rounded-lg text-sm font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors"
                                        >
                                            Anterior
                                        </button>
                                        <span className="text-sm font-bold text-gray-700">Página {inventoryCurrentPage} de {inventoryTotalPages}</span>
                                        <button 
                                            onClick={() => setInventoryCurrentPage(prev => Math.min(inventoryTotalPages, prev + 1))}
                                            disabled={inventoryCurrentPage === inventoryTotalPages} 
                                            className="px-3 py-1 rounded-lg text-sm font-bold bg-gray-100 disabled:opacity-50 hover:bg-gray-200 transition-colors"
                                        >
                                            Siguiente
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    );
                })()}
            </div>
        ): view === 'ADVANCED_REPORTS' ? (
            /* --- VISTA: REPORTES GERENCIALES AVANZADOS --- */
            <div className="p-4 md:p-8 overflow-y-auto h-full animate-slide-up">
                
                {/* Cabecera y Filtros */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                    <h2 className="text-2xl font-black text-gray-800">Reportes Gerenciales</h2>
                    
                    {/* Filtro de Fechas */}
                    <div className="flex gap-2 bg-white p-2 rounded-xl shadow-sm border border-gray-200 items-center">
                        <span className="text-xs font-bold text-gray-400 pl-2">Desde:</span>
                        <input 
                            type="date" 
                            value={reportDateRange.start}
                            onChange={(e) => setReportDateRange(prev => ({...prev, start: e.target.value}))}
                            className="text-xs font-bold text-gray-600 outline-none bg-transparent"
                        />
                        <span className="text-xs font-bold text-gray-400">Hasta:</span>
                        <input 
                            type="date" 
                            value={reportDateRange.end}
                            onChange={(e) => setReportDateRange(prev => ({...prev, end: e.target.value}))}
                            className="text-xs font-bold text-gray-600 outline-none bg-transparent"
                        />
                        <button onClick={fetchAdvancedReport} className="bg-higea-blue text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 shadow-sm transition-all active:scale-95">
                            Filtrar
                        </button>
                    </div>
                </div>

                {analyticsData ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                        
                        {/* 1. GRÁFICA: PRODUCTOS MÁS VENDIDOS */}
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <span className="bg-blue-100 text-higea-blue p-1.5 rounded-lg text-lg">🏆</span> 
                                Productos Más Vendidos
                            </h3>
                            <SimpleBarChart 
                                data={analyticsData.topProducts} 
                                labelKey="name" 
                                valueKey="total_qty" 
                                colorClass="bg-higea-blue"
                            />
                        </div>

                        {/* 2. GRÁFICA: MEJORES CLIENTES */}
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <span className="bg-green-100 text-green-600 p-1.5 rounded-lg text-lg">👥</span> 
                                Mejores Clientes (Volumen de Compra)
                            </h3>
                            <SimpleBarChart 
                                data={analyticsData.topCustomers} 
                                labelKey="full_name" 
                                valueKey="total_spent" 
                                colorClass="bg-green-500"
                                formatMoney={true}
                            />
                        </div>

                        {/* 3. TABLA: EVOLUCIÓN DE VENTAS DIARIA */}
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 col-span-1 md:col-span-2">
                            <h3 className="font-bold text-gray-800 mb-4">Evolución de Ventas (Rango Seleccionado)</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-gray-600">
                                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs font-bold">
                                        <tr>
                                            <th className="px-4 py-3 rounded-l-lg">Fecha</th>
                                            <th className="px-4 py-3 text-right">Total Ref</th>
                                            <th className="px-4 py-3 text-right">Total Bs</th>
                                            <th className="px-4 py-3 rounded-r-lg w-1/3">Tendencia</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {analyticsData.salesOverTime.map((day, idx) => {
                                            // Calcular porcentaje relativo al día máximo para la barrita
                                            const maxDay = Math.max(...analyticsData.salesOverTime.map(d => parseFloat(d.total_usd)));
                                            const percent = maxDay > 0 ? (parseFloat(day.total_usd) / maxDay) * 100 : 0;
                                            
                                            return (
                                                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-3 font-medium text-gray-800">
                                                        {new Date(day.sale_date).toLocaleDateString('es-VE', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-higea-blue text-base">
                                                        Ref {parseFloat(day.total_usd).toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-500 font-bold">
                                                        Bs {parseFloat(day.total_ves).toLocaleString('es-VE', {maximumFractionDigits: 2})}
                                                    </td>
                                                    <td className="px-4 py-3 align-middle">
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-2 bg-gray-100 rounded-full flex-1 overflow-hidden">
                                                                <div 
                                                                    className="h-full bg-gradient-to-r from-blue-400 to-higea-blue rounded-full" 
                                                                    style={{ width: `${percent}%` }}
                                                                ></div>
                                                            </div>
                                                            <span className="text-[10px] font-bold text-gray-400">{Math.round(percent)}%</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                        {analyticsData.salesOverTime.length === 0 && (
                                            <tr>
                                                <td colSpan="4" className="p-8 text-center text-gray-400 italic">
                                                    No se encontraron ventas registradas en este rango de fechas.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <div className="w-10 h-10 border-4 border-gray-200 border-t-higea-blue rounded-full animate-spin mb-3"></div>
                        <p>Cargando datos analíticos...</p>
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
                  <span className="font-black text-lg">{cart.reduce((a,b)=>a+b.quantity,0)}</span>
              </button>
          </div>

          <button onClick={() => {fetchData(); setView('DASHBOARD');}} className={`flex flex-col items-center ${view === 'DASHBOARD' ? 'text-higea-blue' : 'text-gray-400'}`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              <span className="text-[10px] font-bold">Reportes</span>
          </button>
          
          <button onClick={() => {fetchData(); setView('CREDIT_REPORT');}} className={`flex flex-col items-center ${view === 'CREDIT_REPORT' ? 'text-higea-blue' : 'text-gray-400'}`}>
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
                      <p className="text-sm text-higea-blue font-bold">Bs {totalVES.toLocaleString('es-VE', {maximumFractionDigits:2})}</p>
                      
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
                      <p className="text-xs font-bold text-gray-400 mb-2">SELECCIONE MÉTODO DE PAGO:</p>
                      
                      {paymentMethods.map(method => (
                          <PaymentInput 
                              key={method.name} 
                              name={method.name} 
                              currency={method.currency} 
                              value={paymentShares[method.name] || '0.00'}
                          />
                      ))}

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
                          { (parseFloat(paymentShares['Crédito']) || 0) > 0 ? 'Continuar Crédito' : 'Procesar Pago' }
                      </button>
                  </div>
              </div>
          </div>
      )}

      {isNumpadOpen && <NumpadModal />}
      {isCustomerModalOpen && <CustomerModal />} 

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
                  <div className="flex justify-between mb-4"><span className="font-bold text-gray-500">Total Bs</span><span className="font-black text-2xl text-higea-blue">{totalVES.toLocaleString('es-VE', {maximumFractionDigits:0})}</span></div>
                  <button onClick={handleOpenPayment} className="w-full bg-higea-red text-white py-4 rounded-xl font-bold shadow-lg">COBRAR (Ref {finalTotalUSD.toFixed(2)})</button>
              </div>
          </div>
      )}

      {/* --- MODAL DETALLE VENTA (MEJORADO PARA CRÉDITO Y FISCAL) --- */}
      {selectedSaleDetail && (
          <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative">
                  <button onClick={() => setSelectedSaleDetail(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">✕</button>
                  
                  <div className="p-5 border-b">
                     <h3 className="font-bold text-lg text-gray-800">Detalle de Venta #{selectedSaleDetail.id}</h3>
                     {/* 🇻🇪 REQUISITO LEGAL: Aviso de no-factura fiscal */}
                     <p className='text-xs text-red-500 font-bold mt-1'>TICKET PRO-FORMA (NO VÁLIDO PARA CRÉDITO FISCAL)</p>
                  </div>

                  <div className="max-h-[70vh] overflow-y-auto">
                      
                      {/* DETALLES DEL CLIENTE (Si existen) */}
                      {(selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.full_name) && (
                          <div className="p-5 bg-yellow-50 border-b border-yellow-100">
                               <p className="text-xs font-bold uppercase text-yellow-800 mb-2">Detalles de Crédito</p>
                               <div className="text-sm space-y-1 text-yellow-900">
                                    <p><span className="font-bold">Cliente:</span> {selectedSaleDetail.full_name}</p>
                                    <p><span className="font-bold">Cédula/RIF:</span> {selectedSaleDetail.id_number}</p>
                                    <p><span className="font-bold">Estado:</span> 
                                       <span className={`ml-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                         selectedSaleDetail.status === 'PENDIENTE' ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'
                                       }`}>
                                           {selectedSaleDetail.status}
                                       </span>
                                    </p>
                                    {selectedSaleDetail.due_date && <p><span className="font-bold">Vencimiento:</span> {new Date(selectedSaleDetail.due_date).toLocaleDateString()}</p>}
                               </div>
                          </div>
                      )}
                      
                      {/* Lista de Productos (Incluyendo precio en Bolívares) */}
                      <div className="p-5 space-y-3 border-b border-gray-100">
                          <p className="text-xs font-bold uppercase text-gray-400 mb-2">Productos Vendidos</p>
                          {selectedSaleDetail.items.map((item, idx) => {
                                const itemTotalUsd = parseFloat(item.price_at_moment_usd) * item.quantity;
                                const itemTotalVes = itemTotalUsd * selectedSaleDetail.bcv_rate_snapshot;
                                
                                return (
                                    <div key={idx} className="flex justify-between pb-2 border-b border-gray-100 last:border-b-0">
                                        <div>
                                            <p className="font-bold text-sm text-gray-700">{item.name}</p>
                                            <p className="text-xs text-gray-400">Ref {item.price_at_moment_usd} c/u</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="bg-blue-50 text-higea-blue text-xs font-bold px-2 py-1 rounded">x{item.quantity}</span>
                                            <p className="font-bold text-gray-800 mt-1">Ref {itemTotalUsd.toFixed(2)}</p>
                                            {/* 💡 MEJORA: Precio en Bolívares */}
                                            <p className="text-xs text-gray-500">Bs {itemTotalVes.toLocaleString('es-VE', { maximumFractionDigits: 2 })}</p>
                                        </div>
                                    </div>
                                );
                          })}
                      </div>

                      {/* Resumen de Pago (Incluye desglose FISCAL) */}
                      <div className="p-5 bg-gray-50">
                          <div className="text-sm space-y-1 mb-3">
                              {/* 🇻🇪 REQUISITO LEGAL: Desglose de Base Exenta / Base Imponible / IVA */}
                              {selectedSaleDetail.taxBreakdown.subtotalExemptUSD > 0 && (
                                <div className="flex justify-between text-gray-600"><span className='font-medium'>Base Exenta</span><span className='font-bold'>Ref {selectedSaleDetail.taxBreakdown.subtotalExemptUSD.toFixed(2)}</span></div>
                              )}
                              <div className="flex justify-between text-gray-600"><span className='font-medium'>Base Imponible</span><span className='font-bold'>Ref {selectedSaleDetail.taxBreakdown.subtotalTaxableUSD.toFixed(2)}</span></div>
                              <div className="flex justify-between text-red-600"><span className='font-medium'>Monto IVA ({selectedSaleDetail.taxBreakdown.ivaRate * 100}%)</span><span className='font-bold'>Ref {selectedSaleDetail.taxBreakdown.ivaUSD.toFixed(2)}</span></div>
                          </div>
                          
                          <div className="flex justify-between pt-3 border-t border-gray-200">
                            <span className="font-bold text-gray-500">TOTAL FINAL VENTA:</span>
                            <div>
                                <span className="font-black text-lg text-higea-red block text-right">Ref {selectedSaleDetail.total_usd.toFixed(2)}</span>
                                <span className="font-medium text-sm text-gray-700 block text-right">Bs {selectedSaleDetail.total_ves.toLocaleString('es-VE', { maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                          <p className="text-xs font-bold uppercase text-gray-400 mt-4 mb-2">Método de Pago:</p>
                          <p className="text-sm font-medium text-gray-700 break-words">{selectedSaleDetail.payment_method}</p>
                           <p className="text-xs text-gray-400 mt-2">Tasa BCV del momento: Bs {selectedSaleDetail.bcv_rate_snapshot.toFixed(2)}</p>
                      </div>
                  </div>
              </div>
          </div>
      )}
	  
	  {/* MODAL: STOCK COMPLETO */}
      {showStockModal && (
          <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-lg h-[80vh] flex flex-col shadow-2xl animate-scale-up">
                  <div className="p-5 border-b flex justify-between items-center bg-red-50 rounded-t-3xl">
                      <h3 className="font-bold text-red-600">⚠️ Reporte de Stock Bajo</h3>
                      <button onClick={() => setShowStockModal(false)} className="bg-white p-1 rounded-full text-red-500">✕</button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5">
                      <table className="w-full text-sm">
                          <thead className="bg-gray-100 text-gray-500 uppercase text-xs">
                              <tr><th className="px-2 py-2 text-left">Producto</th><th className="px-2 py-2 text-right">Stock</th><th className="px-2 py-2 text-center">Cat</th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {lowStock.map(p => (
                                  <tr key={p.id}>
                                      <td className="px-2 py-3 font-medium">{p.icon_emoji} {p.name}</td>
                                      <td className="px-2 py-3 text-right font-black text-red-500">{p.stock}</td>
                                      <td className="px-2 py-3 text-center text-xs text-gray-400">{p.category}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
                  <div className="p-4 border-t text-center bg-gray-50 rounded-b-3xl">
                      <button onClick={() => setShowStockModal(false)} className="text-gray-500 font-bold text-sm">Cerrar</button>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL: VENTAS DE HOY DETALLADAS */}
      {showDailySalesModal && (
          <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl animate-scale-up">
                  <div className="p-5 border-b flex justify-between items-center bg-blue-50 rounded-t-3xl">
                      <div>
                          <h3 className="font-bold text-higea-blue">Resumen de Ventas - HOY</h3>
                          <p className="text-xs text-gray-500">{new Date().toLocaleDateString()}</p>
                      </div>
                      <button onClick={() => setShowDailySalesModal(false)} className="bg-white p-1 rounded-full text-blue-500">✕</button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-0">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-gray-100 text-gray-500 uppercase text-xs sticky top-0">
                              <tr><th className="px-4 py-3">Hora</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Método</th><th className="px-4 py-3 text-right">Monto</th><th className="px-4 py-3"></th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {dailySalesList.map(sale => (
                                  <tr key={sale.id} className="hover:bg-blue-50">
                                      <td className="px-4 py-3 text-gray-500">{new Date(sale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                                      <td className="px-4 py-3 font-bold text-gray-700">{sale.full_name || 'Consumidor Final'}</td>
                                      <td className="px-4 py-3 text-xs">{sale.payment_method.split('[')[0].slice(0, 15)}...</td>
                                      <td className="px-4 py-3 text-right font-black text-higea-blue">Ref {parseFloat(sale.total_usd).toFixed(2)}</td>
                                      <td className="px-4 py-3 text-center">
                                          <button onClick={() => showSaleDetail(sale)} className="text-gray-400 hover:text-blue-500">👁️</button>
                                      </td>
                                  </tr>
                              ))}
                              {dailySalesList.length === 0 && <tr><td colSpan="5" className="p-5 text-center text-gray-400">Aún no hay ventas hoy.</td></tr>}
                          </tbody>
                      </table>
                  </div>
                  <div className="p-4 border-t bg-gray-50 flex justify-between items-center rounded-b-3xl">
                      <div className="text-xs text-gray-500">Total Transacciones: <b>{dailySalesList.length}</b></div>
                      <div className="text-xl font-black text-higea-blue">Total: Ref {dailySalesList.reduce((acc, curr) => acc + parseFloat(curr.total_usd), 0).toFixed(2)}</div>
                  </div>
              </div>
          </div>
      )}
	  
    </div>
  );
}

export default App;