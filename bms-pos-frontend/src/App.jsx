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
  const [isFiscalInvoice, setIsFiscalInvoice] = useState(false);
  
  const [isCustomerFormOpen, setIsCustomerFormOpen] = useState(false); // NUEVO ESTADO
  const [isProductFormOpen, setIsProductFormOpen] = useState(false); // NUEVO ESTADO PARA PRODUCTOS
  
  // Estado para el visor de recibos
  const [receiptPreview, setReceiptPreview] = useState(null); // Guardará el HTML del recibo
  
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
  
// --- GENERADOR DE HTML DE RECIBO (CORREGIDO PARA DEUDORES Y SALDOS INICIALES) ---
const generateReceiptHTML = (saleId, customer, items, invoiceType = 'TICKET', saleStatus = 'PAGADO', createdAt = new Date(), totalSaleUsd = 0) => {
    const rate = bcvRate; 
    
    // VALIDACIÓN IMPORTANTE: Si es un Saldo Inicial, 'items' vendrá vacío.
    // Creamos un item "falso" para que aparezca en el recibo.
    let itemsToPrint = items;
    if (!items || items.length === 0) {
        itemsToPrint = [{
            name: 'SALDO INICIAL / DEUDA ANTIGUA',
            quantity: 1,
            price_usd: totalSaleUsd, // Usamos el total de la venta
            is_taxable: false
        }];
    }

    // Acumuladores
    let totalBsExento = 0;      
    let totalBsBase = 0;        
    let totalRefBase = 0;       
    let totalUsdGravable = 0;   

    const itemsHTML = itemsToPrint.map(item => {
        // En saldos iniciales usamos price_usd directo, en ventas normales price_at_moment
        const priceUsd = item.price_at_moment_usd || item.price_usd || 0; 
        const qty = item.quantity;
        
        const subtotalItemUsd = priceUsd * qty;
        const subtotalItemBs = subtotalItemUsd * rate;
        
        totalRefBase += subtotalItemUsd;

        const isTaxable = (item.is_taxable === true || item.is_taxable === 'true' || item.is_taxable === 1);
        let exemptMark = '';

        if (isTaxable) {
            totalBsBase += subtotalItemBs; 
            totalUsdGravable += subtotalItemUsd; 
        } else {
            totalBsExento += subtotalItemBs; 
            exemptMark = ' (E)'; 
        }
        
        return `
        <tr>
            <td style="padding:2px 0;">${qty}</td>
            <td style="padding:2px 0;">${item.name.substring(0, 18)}${exemptMark}</td>
            <td class="right" style="padding:2px 0;">${subtotalItemBs.toLocaleString('es-VE', {minimumFractionDigits: 2})}</td>
        </tr>`;
    }).join('');

    // Cálculos
    const ivaBs = totalBsBase * 0.16; 
    const totalGeneralBs = totalBsExento + totalBsBase + ivaBs;
    const ivaUsd = totalUsdGravable * 0.16; 
    const totalGeneralRef = totalRefBase + ivaUsd; 

    // Datos del Cliente (Ahora sí llegarán desde el backend)
    const clientName = customer.full_name || 'CONSUMIDOR FINAL';
    const clientId = customer.id_number || 'V-00000000';
    const clientDir = customer.institution || '';
    
    // Títulos
    const isFiscal = invoiceType === 'FISCAL';
    const isCredit = saleStatus === 'PENDIENTE' || saleStatus === 'PARCIAL';
    let docTitle = 'NOTA DE ENTREGA';
    if (isFiscal) docTitle = 'FACTURA (SENIAT)';
    if (isCredit && !isFiscal) docTitle = 'CONTROL DE CRÉDITO';

    const dateStr = new Date(createdAt).toLocaleString('es-VE');

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            @page { size: 80mm auto; margin: 0; }
            body { width: 72mm; margin: 2mm auto; font-family: 'Courier New', Courier, monospace; font-size: 11px; text-transform: uppercase; color: #000; background: #fff; }
            .header { text-align: center; margin-bottom: 5px; }
            .bold { font-weight: bold; }
            .row { display: flex; justify-content: space-between; }
            .line { border-bottom: 1px dashed #000; margin: 5px 0; }
            .right { text-align: right; }
            .center { text-align: center; }
            .box { border: 1px solid #000; padding: 5px; text-align: center; margin: 10px 0; font-weight:bold;}
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            td { vertical-align: top; word-wrap: break-word; }
            td:nth-child(1) { width: 15%; } 
            td:nth-child(2) { width: 55%; } 
            td:nth-child(3) { width: 30%; } 
        </style>
    </head>
    <body>
        <div class="header">
            ${isFiscal ? '<div class="bold" style="font-size:12px">SENIAT</div>' : ''}
            <div class="bold" style="font-size:14px">VOLUNTARIADO HIGEA</div>
            <div style="font-size:10px; margin-bottom: 2px;">RIF: J-30521322-4</div>
            <div style="font-size:9px; line-height: 1.1;">
                Av. Vargas, Carrera 31, Edif. Sede de la Fundación Higea<br/>
                Barquisimeto, Estado Lara
            </div>
            <div style="margin-top:5px; font-weight:bold; border-top:1px solid #000; padding-top:2px; font-size:12px;">${docTitle}</div>
        </div>
        
        <div style="font-size:10px;">
            <div class="row"><span>CLIENTE:</span> <span class="right bold">${clientName.substring(0,20)}</span></div>
            <div class="row"><span>RIF/CI:</span> <span class="right bold">${clientId}</span></div>
            ${(clientDir) ? `<div class="row"><span>DIR:</span> <span class="right" style="font-size:9px">${clientDir.substring(0,20)}</span></div>` : ''}
        </div>

        <div class="line"></div>
        <div class="row" style="font-size:10px;">
            <span>FACT: 0000${saleId}</span>
            <span>${dateStr.split(',')[0]}</span>
        </div>
        <div class="line"></div>
        
        <table>
            <tr style="font-size:10px;"><td class="bold">CNT</td><td class="bold">DESCRIP</td><td class="bold right">TOTAL</td></tr>
            ${itemsHTML}
        </table>
        
        <div class="line"></div>
        
        <div class="right">
            ${totalBsBase > 0.01 ? `
            <div class="row"><span>BI (16%):</span> <span>${totalBsBase.toLocaleString('es-VE', {minimumFractionDigits: 2})}</span></div>
            <div class="row"><span>IVA (16%):</span> <span>${ivaBs.toLocaleString('es-VE', {minimumFractionDigits: 2})}</span></div>
            ` : ''}
            
            <div class="line"></div>

            <div class="row bold" style="font-size:14px; margin-top:5px">
                <span>TOTAL BS:</span> 
                <span>${totalGeneralBs.toLocaleString('es-VE', {minimumFractionDigits: 2})}</span>
            </div>
            
            <div class="row bold" style="font-size:11px; color:#333; margin-top:2px;">
                <span>(REF $${totalGeneralRef.toFixed(2)})</span>
            </div>
        </div>

        ${isCredit ? '<div class="box">VENTA A CRÉDITO<br/>PENDIENTE DE PAGO</div>' : ''}
        
        <br/>
        <div class="center" style="font-size:9px">
            COPIA DIGITAL / REIMPRESIÓN<br/>
            ${isFiscal ? 'NO FISCAL - REFERENCIAL' : 'CONTROL INTERNO'}
        </div>
    </body>
    </html>
    `;
};

  // FUNCIÓN UNIFICADA DE PROCESAMIENTO DE VENTA/CRÉDITO
  const processSale = async (isCreditFlow = false) => {
      
      const isCreditSale = isCreditFlow && (parseFloat(paymentShares['Crédito']) || 0) > 0;

      // --- [NUEVO] 1. VALIDACIÓN PARA FACTURA FISCAL (UX) ---
      // Si el switch está encendido, OBLIGAMOS a tener Nombre y RIF
      if (isFiscalInvoice) {
          if (!customerData.full_name || !customerData.id_number) {
              return Swal.fire({
                  icon: 'warning',
                  title: 'Datos Fiscales Requeridos',
                  text: 'Para emitir una Factura Fiscal, es obligatorio asignar un Cliente (Nombre y RIF).',
                  confirmButtonText: 'Ingresar Datos del Cliente',
                  confirmButtonColor: '#0056B3',
                  showCancelButton: true,
                  cancelButtonText: 'Cancelar'
              }).then((result) => {
                  if (result.isConfirmed) {
                      // Cerramos el modal de pago y abrimos el de cliente para que llenen los datos
                      setIsPaymentModalOpen(false);
                      setIsCustomerModalOpen(true);
                  }
              });
          }
      }

      // 2. Validar datos mínimos del cliente para Crédito (si aplica)
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
              // --- [CORRECCIÓN CLAVE AQUÍ] ---
              // Enviamos los datos del cliente si es Crédito O si es Factura Fiscal (Esto soluciona tu error)
              customer_data: (isCreditSale || isFiscalInvoice) ? customerData : null, 
              due_days: isCreditSale ? dueDays : null, 
              
              // --- ASEGÚRATE DE QUE ESTO ESTÉ AQUÍ ---
              invoice_type: isFiscalInvoice ? 'FISCAL' : 'TICKET'
          };
          
          Swal.fire({ title: `Procesando ${isCreditSale ? 'Crédito' : 'Venta'}...`, didOpen: () => Swal.showLoading() });
          
          const res = await axios.post(`${API_URL}/sales`, saleData);
          // Recuperamos saleId también para poder imprimir el número correcto
          const { finalTotalUsd, saleId } = res.data; 

          Swal.fire({ 
              icon: 'success', 
              title: isCreditSale ? '¡Crédito Registrado!' : '¡Venta Registrada!', 
              html: `Inventario actualizado. Total Final: Ref ${finalTotalUsd}`, 
              confirmButtonColor: '#0056B3' 
          });

          // --- NUEVO: MOSTRAR VISUALIZACIÓN PREVIA EN EL CENTRO ---
          if (isFiscalInvoice) {
             const html = generateReceiptHTML(saleId || '000', customerData, cart);
             setReceiptPreview(html); // Esto abrirá el nuevo modal
          }

          // Resetear estados
          setCart([]);
          setIsCustomerModalOpen(false);
          setIsPaymentModalOpen(false); 
          setCustomerData({ full_name: '', id_number: '', phone: '', institution: '' });
          setIsFiscalInvoice(false); // Resetear el switch para la próxima venta
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

              <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span class="text-sm font-bold text-gray-700 flex items-center gap-2">
                      📄 Generar Factura Fiscal
                  </span>
                  <label class="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" id="swal-is-fiscal" class="sr-only peer">
                      <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-higea-blue"></div>
                  </label>
              </div>
          `,
          showCancelButton: true,
          confirmButtonText: 'Procesar Pago',
          confirmButtonColor: '#0056B3',
          preConfirm: () => {
              const amount = document.getElementById('swal-amount').value;
              const method = document.getElementById('swal-method').value;
              const ref = document.getElementById('swal-ref').value;
              // Capturamos el estado del switch fiscal
              const isFiscal = document.getElementById('swal-is-fiscal').checked;
              
              // Validaciones originales
              if (!amount || parseFloat(amount) <= 0) return Swal.showValidationMessage('Ingrese un monto válido');
              if (parseFloat(amount) > remaining + 0.05) return Swal.showValidationMessage('El monto excede la deuda');

              // ADAPTACIÓN PUNTO 2.2: VALIDACIÓN UX DE CLIENTE
              if (isFiscal) {
                  // Verificamos que el cliente seleccionado tenga RIF (id_number)
                  // Nota: selectedCreditCustomer debe estar disponible en el contexto
                  if (!selectedCreditCustomer || !selectedCreditCustomer.id_number) {
                      return Swal.showValidationMessage('❌ REQUISITO FISCAL: El cliente debe tener RIF/Cédula registrado.');
                  }
                  // Aquí puedes agregar validación de dirección si tu sistema ya maneja ese campo
                  // if (!selectedCreditCustomer.address) return Swal.showValidationMessage('❌ REQUISITO FISCAL: Falta la dirección del cliente.');
              }

              return { amount, method, ref, isFiscal };
          }
      });

      if (formValues) {
          try {
              Swal.fire({ title: 'Procesando...', didOpen: () => Swal.showLoading() });
              const paymentDetails = `${formValues.method}${formValues.ref ? ` [Ref: ${formValues.ref}]` : ''}`;
              
              await axios.post(`${API_URL}/sales/${saleId}/pay-credit`, {
                  paymentDetails,
                  amountUSD: formValues.amount,
                  // Opcional: Si el backend soporta actualizar el tipo de factura en el abono, lo enviamos
                  invoice_type: formValues.isFiscal ? 'FISCAL' : 'TICKET'
              });

              Swal.fire('Éxito', 'Abono registrado correctamente', 'success');
              
              // Si se solicitó factura fiscal, disparamos la impresión aquí (Paso 3)
              if (formValues.isFiscal) {
                   // Llamamos a la función de impresión fiscal (asegúrate de tener los datos de venta/items a mano o hacer un fetch rápido)
                   // printFiscalReceipt(datosDeVenta, selectedCreditCustomer, itemsDeVenta);
                   console.log("Imprimiendo comprobante fiscal..."); 
              }

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
          Swal.fire({ title: 'Cargando detalle...', didOpen: () => Swal.showLoading() });
          
          const res = await axios.get(`${API_URL}/sales/${sale.id}`);
          
          // Validación de seguridad para datos nulos
          const safeParse = (val) => {
              const num = parseFloat(val);
              return isNaN(num) ? 0 : num;
          };

          setSelectedSaleDetail({ 
              id: sale.id, 
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
      // Detectamos si estamos aquí por crédito o solo por factura fiscal
      const isCreditUsed = (parseFloat(paymentShares['Crédito']) || 0) > 0;
      
      const debouncedSearch = useCallback(
          debounce((query) => searchCustomers(query), 300),
          []
      );

      const handleIdChange = (e) => {
          const value = validateIdNumber(e.target.value); 
          setCustomerData(prev => ({ 
             ...prev, 
             id_number: value,
             full_name: customerSearchResults.find(c => c.id_number === value)?.full_name || prev.full_name,
             institution: customerSearchResults.find(c => c.id_number === value)?.institution || prev.institution,
           }));
          
          if (value.length > 3) debouncedSearch(value);
          else setCustomerSearchResults([]);
      };
      
      const handleNameChange = (e) => {
          setCustomerData(prev => ({ ...prev, full_name: capitalizeWords(e.target.value) }));
      };

      const handleSelectCustomer = (customer) => {
          setCustomerData({
              full_name: customer.full_name,
              id_number: customer.id_number,
              phone: customer.phone || '',
              institution: customer.institution || '',
          });
          setCustomerSearchResults([]);
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
          if (isCreditUsed) {
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

      const isFormReadyToSubmit = customerData.full_name.trim() && customerData.id_number.trim();
      
      return (
          <div className="fixed inset-0 z-[65] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-scale-up">
                  {/* HEADER DIFERENCIADO POR COLOR */}
                  <div className={`p-5 text-white text-center ${isCreditUsed ? 'bg-higea-red' : 'bg-higea-blue'}`}>
                      <h3 className="text-xl font-bold">
                          {isCreditUsed ? 'Registro de Crédito' : 'Datos para Factura Fiscal'}
                      </h3>
                      <p className="text-sm mt-1 opacity-90">
                          {isCreditUsed ? 'Esta venta quedará PENDIENTE de pago' : 'Ingrese los datos del cliente para la factura'}
                      </p>
                  </div>
                  
                  <div className="p-5 space-y-4">
                      {/* Solo mostrar selector de días si es CRÉDITO */}
                      {isCreditUsed && (
                          <div className="flex justify-between items-center bg-yellow-50 p-3 rounded-xl border border-yellow-200">
                              <span className="font-bold text-yellow-800 text-sm">Plazo de Pago</span>
                              <div className="flex gap-2">
                                <button onClick={() => setDueDays(15)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 15 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>15 Días</button>
                                <button onClick={() => setDueDays(30)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 30 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>30 Días</button>
                              </div>
                          </div>
                      )}

                      <div className="relative">
                          <input type="text" name="id_number" placeholder="Cédula/Rif (*)" onChange={handleIdChange} value={customerData.id_number} 
                              className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none font-bold" 
                              autoFocus={true} 
                          /> 
                          {isSearchingCustomer && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-higea-blue border-t-transparent rounded-full animate-spin"></div>}
                          
                          {customerSearchResults.length > 0 && (
                              <div className="absolute top-full left-0 w-full bg-white border border-gray-200 rounded-xl mt-1 shadow-lg z-10 max-h-40 overflow-y-auto">
                                  {customerSearchResults.map(customer => (
                                      <div key={customer.id} onClick={() => handleSelectCustomer(customer)} className="p-3 border-b border-gray-100 hover:bg-blue-50 cursor-pointer">
                                          <p className="font-bold text-gray-800">{customer.full_name}</p>
                                          <p className="text-xs text-gray-500">{customer.id_number}</p>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                      
                      <input type="text" name="full_name" placeholder="Razón Social / Nombre (*)" onChange={handleNameChange} value={customerData.full_name} className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" /> 
                      
                      <div className="grid grid-cols-2 gap-4">
                          <input type="tel" name="phone" placeholder="Teléfono" onChange={handleChange} value={customerData.phone} className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" />
                          <input type="text" name="institution" placeholder="Dirección Fiscal" onChange={handleChange} value={customerData.institution} className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" />
                      </div>
                  </div>

                  <div className="p-5 flex gap-3 bg-white border-t border-gray-50">
                      <button onClick={() => { setIsCustomerModalOpen(false); setIsPaymentModalOpen(true); }} className="flex-1 py-3 text-gray-500 font-bold text-sm">Volver</button>
                      <button 
                          onClick={handleConfirm} 
                          disabled={!isFormReadyToSubmit}
                          className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all ${!isFormReadyToSubmit ? 'bg-gray-300' : (isCreditUsed ? 'bg-higea-red hover:bg-red-700' : 'bg-higea-blue hover:bg-blue-700')}`}
                      >
                          {isCreditUsed ? 'Confirmar Crédito' : 'Guardar Datos Fiscales'}
                      </button>
                  </div>
              </div>
          </div>
      );
  }
  
  const openDailySalesDetail = async () => {
      try {
          Swal.fire({title: 'Cargando...', didOpen: () => Swal.showLoading()});
          const res = await axios.get(`${API_URL}/reports/sales-today`);
          
          // --- PROTECCIÓN: Limpiar datos antes de guardarlos en el estado ---
          const safeData = res.data.map(sale => ({
              ...sale,
              // 1. Evita error en .split() si el método es null
              payment_method: sale.payment_method || 'Desconocido', 
              // 2. Evita NaN en las sumas
              total_usd: parseFloat(sale.total_usd) || 0,
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
  
  // --- FUNCIÓN PARA EXPORTAR A EXCEL (CSV) ---
  const exportReportToCSV = () => {
      // 1. Validar datos
      if (!analyticsData || !analyticsData.salesOverTime || analyticsData.salesOverTime.length === 0) {
          return Swal.fire('Sin datos', 'No hay información para exportar en este rango.', 'warning');
      }

      try {
          // 2. Estilos CSS para el Excel (Colores institucionales Higea)
          // Esto le dará el toque "Profesional" y "Novedoso"
          const styles = `
            <style>
              .header { background-color: #0056B3; color: white; font-weight: bold; text-align: center; border: 1px solid #000; }
              .sub-header { background-color: #E11D2B; color: white; font-weight: bold; text-align: left; border: 1px solid #000; }
              .row-even { background-color: #f2f2f2; border: 1px solid #ccc; }
              .row-odd { background-color: #ffffff; border: 1px solid #ccc; }
              .money { text-align: right; }
              .title { font-size: 18px; font-weight: bold; text-align: center; height: 40px; }
              .meta { font-style: italic; color: #555; text-align: center; }
              td { padding: 5px; }
            </style>
          `;

          // 3. Construir el contenido HTML (Tablas)
          let html = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
            <head>
              <meta charset="UTF-8">
              ${styles}
            </head>
            <body>
              <table>
                <tr><td colspan="5" class="title">REPORTE GERENCIAL DE VENTAS - HIGEA</td></tr>
                <tr><td colspan="5" class="meta">Generado el: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</td></tr>
                <tr><td colspan="5" class="meta">Rango: ${reportDateRange.start} al ${reportDateRange.end}</td></tr>
                <tr><td></td></tr>

                <tr><td colspan="5" class="sub-header">HISTÓRICO DE VENTAS DIARIAS</td></tr>
                <tr>
                    <td class="header">Fecha</td>
                    <td class="header">Transacciones</td>
                    <td class="header">Total Ref (USD)</td>
                    <td class="header">Total Bs</td>
                    <td class="header">Ticket Promedio</td>
                </tr>
          `;

          // Llenar datos diarios
          analyticsData.salesOverTime.forEach((row, index) => {
              const rowClass = index % 2 === 0 ? 'row-even' : 'row-odd';
              const ticketAvg = row.tx_count > 0 ? (row.total_usd / row.tx_count).toFixed(2) : 0;
              const date = new Date(row.sale_date).toLocaleDateString();
              
              html += `
                <tr>
                    <td class="${rowClass}">${date}</td>
                    <td class="${rowClass}" style="text-align:center;">${row.tx_count}</td>
                    <td class="${rowClass} money">${parseFloat(row.total_usd).toFixed(2)}</td>
                    <td class="${rowClass} money">${parseFloat(row.total_ves).toLocaleString('es-VE', {minimumFractionDigits: 2})}</td>
                    <td class="${rowClass} money">${ticketAvg}</td>
                </tr>
              `;
          });

          // SECCIÓN 2: PRODUCTOS TOP
          html += `
                <tr><td></td></tr>
                <tr><td colspan="3" class="sub-header">TOP PRODUCTOS ESTRELLA</td></tr>
                <tr>
                    <td class="header" colspan="2">Producto</td>
                    <td class="header">Unidades Vendidas</td>
                    <td class="header">Ingresos Generados (Ref)</td>
                </tr>
          `;

          analyticsData.topProducts.forEach((row, index) => {
              const rowClass = index % 2 === 0 ? 'row-even' : 'row-odd';
              html += `
                <tr>
                    <td class="${rowClass}" colspan="2">${row.name}</td>
                    <td class="${rowClass}" style="text-align:center;">${row.total_qty}</td>
                    <td class="${rowClass} money">${parseFloat(row.total_revenue).toFixed(2)}</td>
                </tr>
              `;
          });

          // SECCIÓN 3: VENTAS POR CATEGORÍA
          html += `
                <tr><td></td></tr>
                <tr><td colspan="2" class="sub-header">RENDIMIENTO POR CATEGORÍA</td></tr>
                <tr>
                    <td class="header">Categoría</td>
                    <td class="header">Total Facturado (Ref)</td>
                </tr>
          `;

          analyticsData.salesByCategory.forEach((row, index) => {
              const rowClass = index % 2 === 0 ? 'row-even' : 'row-odd';
              html += `
                <tr>
                    <td class="${rowClass}">${row.category}</td>
                    <td class="${rowClass} money">${parseFloat(row.total_usd).toFixed(2)}</td>
                </tr>
              `;
          });

          // Totales Generales al final
          const totalGeneralUSD = analyticsData.salesOverTime.reduce((acc, curr) => acc + parseFloat(curr.total_usd), 0);
          html += `
                <tr><td></td></tr>
                <tr>
                    <td colspan="2" style="font-weight:bold; font-size:14px; text-align:right;">TOTAL GENERAL PERIODO:</td>
                    <td style="font-weight:bold; font-size:14px; background-color:#FFFF00; border:1px solid #000;" class="money">
                        Ref ${totalGeneralUSD.toFixed(2)}
                    </td>
                </tr>
          `;

          html += `
              </table>
            </body>
            </html>
          `;

          // 4. Crear Blob y Descargar
          // Usamos 'application/vnd.ms-excel' para que el SO reconozca que debe abrirse con Excel
          const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          // La extensión .xls es necesaria para este truco de HTML
          link.setAttribute("download", `Reporte_Gerencial_Higea_${reportDateRange.start}.xls`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

      } catch (error) {
          console.error("Error exportando Excel:", error);
          Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
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
                                {formatMoney ? `Ref ${val.toLocaleString('es-VE', {minimumFractionDigits: 2})}` : val}
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
                                      <span className="text-base">{p.icon_emoji}</span> {p.name}
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
                                                        <tr key={sale.id} className={`hover:bg-blue-50 transition-colors ${sale.is_overdue ? 'bg-red-50/20' : ''}`}>
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
                                                                    <button onClick={() => showSaleDetail(sale)} className="p-2 text-gray-400 hover:text-higea-blue bg-white border border-gray-200 rounded-lg shadow-sm" title="Ver Detalle">
                                                                        👁️
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => handlePaymentProcess(sale.id, parseFloat(sale.total_usd), parseFloat(sale.amount_paid_usd || 0))} 
                                                                        className="bg-green-500 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-green-600 shadow-md active:scale-95 transition-all"
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
            /* MÓDULO DE CLIENTES (UX MEJORADA: LISTADO + MODAL) */
           <div className="p-4 md:p-8 overflow-y-auto h-full relative">
                
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

                {/* TABLA DE CLIENTES (CARD STYLE EN MÓVIL, TABLE EN PC) */}
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
                            // Lógica de paginación (Mantenida)
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
                                    {currentCustomers.map((customer) => (
                                        <div 
                                            key={customer.id} 
                                            onClick={() => {
                                                editCustomer(customer);
                                                setIsCustomerFormOpen(true); // Abrir modal al editar
                                            }}
                                            className="p-4 hover:bg-blue-50 transition-colors cursor-pointer group"
                                        >
                                            {/* VISTA DESKTOP (GRID) */}
                                            <div className="hidden md:grid grid-cols-12 items-center gap-2">
                                                <div className="col-span-1 font-bold text-higea-blue">#{customer.id}</div>
                                                <div className="col-span-4 font-medium text-gray-800 truncate" title={customer.full_name}>{customer.full_name}</div>
                                                <div className="col-span-2 text-gray-600 font-mono text-xs">{customer.id_number}</div>
                                                <div className="col-span-2 text-gray-500 text-xs">{customer.phone || '-'}</div>
                                                <div className="col-span-1 text-center">
                                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                                                        (customer.status || 'ACTIVO') === 'ACTIVO' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                    }`}>
                                                        {customer.status || 'ACTIVO'} 
                                                    </span>
                                                </div>
                                                <div className="col-span-2 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); addInitialBalance(customer); }} 
                                                        className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200" title="Saldo Inicial"
                                                    >
                                                        💸
                                                    </button>
                                                    <button className="p-2 bg-blue-100 text-higea-blue rounded-lg hover:bg-blue-200" title="Editar">
                                                        ✏️
                                                    </button>
                                                </div>
                                            </div>

                                            {/* VISTA MÓVIL (STACKED) */}
                                            <div className="md:hidden flex justify-between items-center">
                                                <div>
                                                    <p className="font-bold text-gray-800 text-sm">{customer.full_name}</p>
                                                    <p className="text-xs text-gray-500 font-mono">{customer.id_number}</p>
                                                    <p className="text-[10px] text-gray-400 mt-1">{customer.phone}</p>
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                                        (customer.status || 'ACTIVO') === 'ACTIVO' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                    }`}>
                                                        {customer.status || 'ACTIVO'} 
                                                    </span>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); addInitialBalance(customer); }} 
                                                        className="text-[10px] bg-green-50 text-green-700 px-2 py-1 rounded border border-green-200"
                                                    >
                                                        + Deuda
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {/* CONTROLES PAGINACIÓN */}
                                    {customerTotalPages > 1 && (
                                        <div className="p-4 border-t border-gray-100 flex justify-center items-center gap-4">
                                            <button 
                                                onClick={() => setCustomerCurrentPage(prev => Math.max(1, prev - 1))}
                                                disabled={customerCurrentPage === 1} 
                                                className="px-3 py-1 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50"
                                            >
                                                Anterior
                                            </button>
                                            <span className="text-xs font-bold text-gray-500">Pág {customerCurrentPage} de {customerTotalPages}</span>
                                            <button 
                                                onClick={() => setCustomerCurrentPage(prev => Math.min(customerTotalPages, prev + 1))}
                                                disabled={customerCurrentPage === customerTotalPages} 
                                                className="px-3 py-1 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50"
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

                {/* --- MODAL FORMULARIO DE CLIENTE --- */}
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
                                        // Si guardó con éxito (puedes ajustar saveCustomer para que retorne true/false), cerramos
                                        // Por ahora cerramos al enviar si no hubo error crítico atrapado
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
                                                    onClick={() => setCustomerForm(prev => ({...prev, status: st}))}
                                                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${
                                                        customerForm.status === st 
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
            /* MÓDULO DE PRODUCTOS (UX MEJORADA: LISTADO + MODAL) */
            <div className="p-4 md:p-8 overflow-y-auto h-full relative">
                
                {/* CABECERA Y CONTROLES */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                    <div>
                        <h2 className="text-2xl font-black text-gray-800">Inventario de Productos</h2>
                        <p className="text-sm text-gray-500">Gestione precios, stock y exenciones fiscales</p>
                    </div>
                    
                    <div className="flex w-full md:w-auto gap-2">
                        {/* BARRA DE BÚSQUEDA */}
                        <div className="relative w-full md:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                            <input 
                                type="text" 
                                placeholder="Buscar producto..." 
                                value={productSearchQuery}
                                onChange={(e) => setProductSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-higea-blue outline-none shadow-sm text-sm" 
                            />
                        </div>
                        
                        {/* BOTÓN NUEVO PRODUCTO (DESKTOP) */}
                        <button 
                            onClick={() => {
                                setProductForm({ id: null, name: '', category: '', price_usd: 0.00, stock: 0, is_taxable: true, icon_emoji: '🍔' });
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
                    {/* ENCABEZADO TABLA (SOLO PC) */}
                    <div className="hidden md:grid grid-cols-12 bg-gray-50 p-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                        <div className="col-span-1">ID</div>
                        <div className="col-span-4">Producto</div>
                        <div className="col-span-2">Categoría</div>
                        <div className="col-span-2 text-right">Precio Ref</div>
                        <div className="col-span-1 text-center">Stock</div>
                        <div className="col-span-2 text-right">Acción</div>
                    </div>

                    {/* LISTADO DE DATOS */}
                    <div className="divide-y divide-gray-100">
                        {(() => {
                            const inventoryPerPage = 10;
                            const indexOfLastInventory = inventoryCurrentPage * inventoryPerPage;
                            const indexOfFirstInventory = indexOfLastInventory - inventoryPerPage;
                            const currentInventory = filteredInventory.slice(indexOfFirstInventory, indexOfLastInventory);
                            const inventoryTotalPages = Math.ceil(filteredInventory.length / inventoryPerPage);
                            
                            if (filteredInventory.length === 0) {
                                return (
                                    <div className="p-10 text-center flex flex-col items-center justify-center text-gray-400">
                                        <div className="text-4xl mb-2">📦</div>
                                        <p>No se encontraron productos.</p>
                                    </div>
                                );
                            }

                            return (
                                <>
                                    {currentInventory.map((p) => (
                                        <div 
                                            key={p.id} 
                                            onClick={() => {
                                                setProductForm({
                                                    id: p.id, name: p.name, category: p.category, 
                                                    price_usd: parseFloat(p.price_usd), stock: p.stock, 
                                                    icon_emoji: p.icon_emoji, is_taxable: p.is_taxable
                                                });
                                                setIsProductFormOpen(true);
                                            }}
                                            className="p-4 hover:bg-blue-50 transition-colors cursor-pointer group"
                                        >
                                            {/* VISTA DESKTOP (GRID) */}
                                            <div className="hidden md:grid grid-cols-12 items-center gap-2">
                                                <div className="col-span-1 font-bold text-higea-blue">#{p.id}</div>
                                                <div className="col-span-4 font-medium text-gray-800 flex items-center gap-2">
                                                    <span className="text-xl">{p.icon_emoji}</span>
                                                    <div>
                                                        <p className="leading-tight">{p.name}</p>
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.is_taxable ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                                                            {p.is_taxable ? 'GRAVADO' : 'EXENTO'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="col-span-2 text-gray-500 text-xs">{p.category}</div>
                                                <div className="col-span-2 text-right font-bold text-gray-700">Ref {parseFloat(p.price_usd).toFixed(2)}</div>
                                                <div className="col-span-1 text-center">
                                                    <span className={`font-bold px-2 py-1 rounded-lg text-xs ${p.stock <= 5 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                                                        {p.stock}
                                                    </span>
                                                </div>
                                                <div className="col-span-2 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button className="text-xs font-bold text-higea-blue hover:underline">Editar</button>
                                                </div>
                                            </div>

                                            {/* VISTA MÓVIL (TARJETA) */}
                                            <div className="md:hidden flex justify-between items-center">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 bg-gray-50 rounded-lg flex items-center justify-center text-xl">{p.icon_emoji}</div>
                                                    <div>
                                                        <p className="font-bold text-gray-800 text-sm line-clamp-1">{p.name}</p>
                                                        <div className="flex gap-2 mt-0.5">
                                                            <span className="text-xs text-gray-500">{p.category}</span>
                                                            <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${p.is_taxable ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                                                                {p.is_taxable ? 'IVA' : 'EXE'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-black text-higea-red text-sm">Ref {parseFloat(p.price_usd).toFixed(2)}</p>
                                                    <p className={`text-[10px] font-bold ${p.stock <= 5 ? 'text-red-500' : 'text-gray-400'}`}>Stock: {p.stock}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {/* CONTROLES PAGINACIÓN */}
                                    {inventoryTotalPages > 1 && (
                                        <div className="p-4 border-t border-gray-100 flex justify-center items-center gap-4">
                                            <button 
                                                onClick={() => setInventoryCurrentPage(prev => Math.max(1, prev - 1))}
                                                disabled={inventoryCurrentPage === 1} 
                                                className="px-3 py-1 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50"
                                            >
                                                Anterior
                                            </button>
                                            <span className="text-xs font-bold text-gray-500">Pág {inventoryCurrentPage} de {inventoryTotalPages}</span>
                                            <button 
                                                onClick={() => setInventoryCurrentPage(prev => Math.min(inventoryTotalPages, prev + 1))}
                                                disabled={inventoryCurrentPage === inventoryTotalPages} 
                                                className="px-3 py-1 rounded-lg text-xs font-bold bg-gray-100 disabled:opacity-50"
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

                {/* BOTÓN FLOTANTE (FAB) MÓVIL */}
                <button 
                    onClick={() => {
                        setProductForm({ id: null, name: '', category: '', price_usd: 0.00, stock: 0, is_taxable: true, icon_emoji: '🍔' });
                        setIsProductFormOpen(true);
                    }}
                    className="md:hidden fixed bottom-20 right-4 h-14 w-14 bg-higea-blue text-white rounded-full shadow-2xl flex items-center justify-center text-3xl font-light z-40 active:scale-90 transition-transform"
                >
                    +
                </button>

                {/* --- MODAL FORMULARIO DE PRODUCTO --- */}
                {isProductFormOpen && (
                    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                        <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl animate-scale-up overflow-hidden max-h-[90vh] flex flex-col">
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                                <h3 className="text-lg font-black text-gray-800">
                                    {productForm.id ? 'Editar Producto' : 'Nuevo Producto'}
                                </h3>
                                <button onClick={() => setIsProductFormOpen(false)} className="w-8 h-8 flex items-center justify-center bg-white rounded-full text-gray-500 shadow-sm hover:text-red-500 font-bold">✕</button>
                            </div>
                            
                            <div className="p-6 overflow-y-auto">
                                <form onSubmit={(e) => {
                                    saveProduct(e).then(() => setIsProductFormOpen(false));
                                }}>
                                    <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Nombre del Producto (*)</label>
                                    <input type="text" name="name" placeholder="Ej: Pizza Margarita" value={productForm.name} onChange={handleProductFormChange} className="w-full border-2 border-gray-100 p-3 rounded-xl mb-4 focus:border-higea-blue outline-none font-medium" required autoFocus />
                                    
                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Categoría</label>
                                            <input type="text" name="category" placeholder="Ej: Comida" value={productForm.category} onChange={handleProductFormChange} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-higea-blue outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Precio (Ref) (*)</label>
                                            <input type="number" name="price_usd" placeholder="0.00" value={productForm.price_usd} onChange={handleProductFormChange} step="0.01" min="0.01" className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-higea-blue outline-none font-bold text-gray-700" required />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Stock Actual</label>
                                            <input type="number" name="stock" placeholder="0" value={productForm.stock} onChange={handleProductFormChange} min="0" className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-higea-blue outline-none" required />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 ml-1 mb-1 block">Icono (Emoji)</label>
                                            <input type="text" name="icon_emoji" value={productForm.icon_emoji} onChange={handleProductFormChange} className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-higea-blue outline-none text-center text-xl" maxLength="2" />
                                        </div>
                                    </div>

                                    {/* Selector Rápido de Emojis */}
                                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 mb-4">
                                        <p className='text-xs font-bold text-gray-400 mb-2 uppercase'>Selección Rápida</p>
                                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 max-h-24 overflow-y-auto custom-scrollbar p-1"> 
                                            {EMOJI_OPTIONS.map((emoji, index) => (
                                                <button
                                                    type="button"
                                                    key={index}
                                                    onClick={() => handleEmojiSelect(emoji)}
                                                    className={`text-xl p-1 rounded-lg hover:bg-white hover:shadow-sm transition-all ${productForm.icon_emoji === emoji ? 'bg-higea-blue text-white shadow-md' : ''}`}
                                                >
                                                    {emoji}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Switch Fiscal */}
                                    <div className="flex gap-4 items-center bg-blue-50 p-3 rounded-xl border border-blue-100 mb-6">
                                        <div className="bg-white p-2 rounded-full shadow-sm text-lg">⚖️</div>
                                        <div className="flex-1">
                                            <label className="text-xs font-bold text-blue-800 block">Estatus Fiscal (IVA 16%)</label>
                                            <select 
                                                name="is_taxable"
                                                value={productForm.is_taxable.toString()} 
                                                onChange={handleProductFormChange}
                                                className="bg-transparent text-sm font-medium text-gray-700 w-full outline-none mt-1"
                                            >
                                                <option value="true">GRAVADO (Aplica IVA)</option>
                                                <option value="false">EXENTO (No aplica)</option>
                                            </select>
                                        </div>
                                    </div>
                                    
                                    <button type="submit" className="w-full bg-higea-blue text-white font-bold py-4 rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all">
                                        {productForm.id ? 'Guardar Cambios' : 'Registrar Producto'}
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        ) : view === 'ADVANCED_REPORTS' ? (
            /* --- VISTA: INTELIGENCIA DE NEGOCIOS (REDISEÑO PRO) --- */
            <div className="p-4 md:p-8 overflow-y-auto h-full animate-slide-up bg-slate-50">
                
                {/* CABECERA */}
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-8 gap-6">
                    <div>
                        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Inteligencia de Negocios</h2>
                        <p className="text-slate-500 mt-1 font-medium">Análisis de rendimiento y toma de decisiones</p>
                    </div>
                    
                    {/* CONTROL DE FECHAS MEJORADO */}
                    <div className="flex flex-wrap items-center gap-3 bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex items-center bg-slate-100 rounded-xl px-4 py-2 border border-slate-200">
                            <span className="text-xs font-bold text-slate-400 mr-2 uppercase tracking-wider">Desde</span>
                            <input 
                                type="date" 
                                value={reportDateRange.start}
                                onChange={(e) => setReportDateRange(prev => ({...prev, start: e.target.value}))}
                                className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer"
                            />
                        </div>
                        <div className="text-slate-300 font-bold">→</div>
                        <div className="flex items-center bg-slate-100 rounded-xl px-4 py-2 border border-slate-200">
                            <span className="text-xs font-bold text-slate-400 mr-2 uppercase tracking-wider">Hasta</span>
                            <input 
                                type="date" 
                                value={reportDateRange.end}
                                onChange={(e) => setReportDateRange(prev => ({...prev, end: e.target.value}))}
                                className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer"
                            />
                        </div>
                        
                        <div className="h-8 w-px bg-slate-200 mx-1"></div>

                        <button onClick={fetchAdvancedReport} className="bg-higea-blue hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md shadow-blue-200 transition-all active:scale-95 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            Actualizar
                        </button>
                        <button onClick={exportReportToCSV} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md shadow-green-200 transition-all active:scale-95 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            Excel
                        </button>
                    </div>
                </div>

                {analyticsData ? (
                    <div className="space-y-8 pb-20">
                        
                        {/* 1. SECCIÓN KPI (TARJETAS GRANDES) */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* KPI 1: Ingresos */}
                            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-6 text-white shadow-xl shadow-blue-200 relative overflow-hidden group">
                                <div className="absolute right-0 top-0 h-32 w-32 bg-white opacity-5 rounded-full -mr-10 -mt-10 blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                        </div>
                                        <span className="text-blue-200 text-xs font-bold bg-blue-900/30 px-2 py-1 rounded-lg">Total Facturado</span>
                                    </div>
                                    <p className="text-4xl font-black tracking-tight mb-1">
                                        Ref {analyticsData.salesOverTime.reduce((acc, day) => acc + parseFloat(day.total_usd), 0).toLocaleString('es-VE', {minimumFractionDigits: 2})}
                                    </p>
                                    <p className="text-blue-200 text-sm font-medium">Ingresos brutos en el periodo</p>
                                </div>
                            </div>

                            {/* KPI 2: Transacciones */}
                            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-lg relative overflow-hidden group">
                                <div className="absolute right-0 bottom-0 h-24 w-24 bg-purple-50 rounded-full -mr-5 -mb-5 group-hover:scale-110 transition-transform"></div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="bg-purple-100 p-3 rounded-2xl">
                                            <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                                        </div>
                                        <span className="text-purple-600 text-xs font-bold bg-purple-50 px-2 py-1 rounded-lg">Volumen</span>
                                    </div>
                                    <p className="text-4xl font-black text-slate-800 tracking-tight mb-1">
                                        {analyticsData.salesOverTime.reduce((acc, day) => acc + parseInt(day.tx_count || 0), 0)}
                                    </p>
                                    <p className="text-slate-400 text-sm font-medium">Operaciones realizadas</p>
                                </div>
                            </div>

                            {/* KPI 3: Promedio por Venta (Ticket Promedio Renombrado) */}
                            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-lg relative overflow-hidden group">
                                <div className="absolute right-0 bottom-0 h-24 w-24 bg-emerald-50 rounded-full -mr-5 -mb-5 group-hover:scale-110 transition-transform"></div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="bg-emerald-100 p-3 rounded-2xl">
                                            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                                        </div>
                                        <span className="text-emerald-600 text-xs font-bold bg-emerald-50 px-2 py-1 rounded-lg">KPI Clave</span>
                                    </div>
                                    <p className="text-4xl font-black text-slate-800 tracking-tight mb-1">
                                        Ref {(() => {
                                            const total = analyticsData.salesOverTime.reduce((acc, day) => acc + parseFloat(day.total_usd), 0);
                                            const count = analyticsData.salesOverTime.reduce((acc, day) => acc + parseInt(day.tx_count || 0), 0);
                                            return count > 0 ? (total / count).toLocaleString('es-VE', {minimumFractionDigits: 2}) : '0.00';
                                        })()}
                                    </p>
                                    <p className="text-slate-400 text-sm font-medium">Promedio por Venta</p>
                                </div>
                            </div>
                        </div>

                        {/* 2. GRÁFICAS COMPARATIVAS (GRID 2 COLUMNAS) */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* TOP PRODUCTOS */}
                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-50">
                                    <div className="bg-yellow-100 p-2 rounded-xl text-yellow-600 text-xl">🏆</div>
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-lg">Productos Estrella</h3>
                                        <p className="text-xs text-slate-400">Los 5 más vendidos en el periodo</p>
                                    </div>
                                </div>
                                <SimpleBarChart 
                                    data={analyticsData.topProducts} 
                                    labelKey="name" 
                                    valueKey="total_qty" 
                                    colorClass="bg-yellow-400"
                                    formatMoney={false}
                                />
                            </div>

                            {/* VENTAS POR CATEGORÍA */}
                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-50">
                                    <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600 text-xl">🏷️</div>
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-lg">Rendimiento por Categoría</h3>
                                        <p className="text-xs text-slate-400">Ingresos generados (USD/Ref)</p>
                                    </div>
                                </div>
                                <SimpleBarChart 
                                    data={analyticsData.salesByCategory} 
                                    labelKey="category" 
                                    valueKey="total_usd" 
                                    colorClass="bg-indigo-500"
                                    formatMoney={true}
                                />
                            </div>
                        </div>

                        {/* 3. RESUMEN DE COBRANZA Y DEUDORES (NUEVO) */}
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
                                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                                                    {debtor.full_name.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-bold text-slate-700 truncate w-24">{debtor.full_name.split(' ')[0]}</p>
                                                    <p className="text-[10px] text-slate-400">Pendiente</p>
                                                </div>
                                            </div>
                                            <span className="font-black text-red-500 text-sm">
                                                Ref {parseFloat(debtor.debt).toFixed(2)}
                                            </span>
                                        </div>
                                    ))}
                                    {topDebtors.length === 0 && <p className="text-center text-slate-400 text-sm py-4">Sin deudas pendientes 🎉</p>}
                                </div>
                             </div>

                             {/* 4. TABLA DETALLADA (2/3 DEL ANCHO) */}
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
                                                        <td className="px-4 py-3 font-medium text-slate-800">
                                                            {new Date(day.sale_date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-xs font-bold">{day.tx_count}</span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-black text-higea-blue">
                                                            Ref {parseFloat(day.total_usd).toLocaleString('es-VE', {minimumFractionDigits: 2})}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-slate-400 font-mono text-xs">
                                                            Bs {parseFloat(day.total_ves).toLocaleString('es-VE', {maximumFractionDigits: 0})}
                                                        </td>
                                                        <td className="px-4 py-3 align-middle hidden sm:table-cell w-32">
                                                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                                <div 
                                                                    className={`h-full rounded-full ${percent > 80 ? 'bg-green-500' : percent > 40 ? 'bg-blue-500' : 'bg-slate-400'}`} 
                                                                    style={{ width: `${percent}%` }}
                                                                ></div>
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
                        <p className="text-sm">Analizando transacciones, productos y categorías</p>
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

      {/* --- MODAL DETALLE VENTA (CORREGIDO Y PROFESIONAL) --- */}
      {selectedSaleDetail && (
          <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative animate-scale-up border-4 border-white">
                  
                  {/* BOTÓN CERRAR */}
                  <button 
                      onClick={() => setSelectedSaleDetail(null)} 
                      className="absolute top-3 right-3 text-gray-500 hover:text-red-600 bg-white rounded-full p-2 shadow-sm z-20 font-bold"
                  >
                      ✕
                  </button>
                  
                  {/* --- CABECERA DINÁMICA (Aquí está la magia visual) --- */}
                  <div className={`p-6 text-center border-b ${
                      selectedSaleDetail.invoice_type === 'FISCAL' ? 'bg-blue-600 text-white' : 
                      (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL') ? 'bg-red-600 text-white' : 
                      'bg-gray-100 text-gray-800'
                  }`}>
                     <h3 className="font-black text-2xl uppercase tracking-wide">
                         {selectedSaleDetail.invoice_type === 'FISCAL' ? 'DOCUMENTO FISCAL' : 
                          (selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL') ? 'CRÉDITO / DEUDA' : 
                          'TICKET DE VENTA'}
                     </h3>
                     <p className="text-sm font-medium opacity-90 mt-1">
                         Venta #{selectedSaleDetail.id} • {new Date(selectedSaleDetail.created_at || new Date()).toLocaleDateString()}
                     </p>
                     
                     {/* ETIQUETA DE ESTATUS GRANDE */}
                     <div className="mt-3">
                         <span className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-wider shadow-sm ${
                             selectedSaleDetail.status === 'PAGADO' ? 'bg-green-400 text-green-900' : 'bg-yellow-400 text-yellow-900'
                         }`}>
                             ESTADO: {selectedSaleDetail.status}
                         </span>
                     </div>
                  </div>

                  <div className="max-h-[60vh] overflow-y-auto bg-gray-50">
                      
                      {/* --- SECCIÓN DATOS DEL CLIENTE --- */}
                      <div className="p-5 bg-white border-b border-gray-200">
                           <p className="text-xs font-bold uppercase text-gray-400 mb-3 tracking-wider">Datos del Cliente</p>
                           
                           {selectedSaleDetail.full_name ? (
                               <div className="space-y-1">
                                   <p className="text-lg font-bold text-gray-800">{selectedSaleDetail.full_name}</p>
                                   <p className="text-sm text-gray-500 font-mono">ID: {selectedSaleDetail.id_number || 'No registrado'}</p>
                                   
                                   {(selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.status === 'PARCIAL') && selectedSaleDetail.due_date && (
                                       <p className="text-xs font-bold text-red-600 mt-2 bg-red-50 p-2 rounded-lg inline-block">
                                           ⚠️ Vence: {new Date(selectedSaleDetail.due_date).toLocaleDateString()}
                                       </p>
                                   )}
                               </div>
                           ) : (
                               <p className="text-sm text-gray-400 italic">Cliente Consumidor Final (Anónimo)</p>
                           )}
                      </div>
                      
                      {/* --- LISTA DE PRODUCTOS --- */}
                      <div className="p-5">
                          <p className="text-xs font-bold uppercase text-gray-400 mb-3 tracking-wider">Items Vendidos</p>
                          <div className="space-y-3">
                              {selectedSaleDetail.items.map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                                        <div>
                                            <p className="font-bold text-sm text-gray-700">{item.name}</p>
                                            <p className="text-xs text-gray-400">Ref {parseFloat(item.price_at_moment_usd).toFixed(2)} x {item.quantity}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-gray-800">Ref {(parseFloat(item.price_at_moment_usd) * item.quantity).toFixed(2)}</p>
                                        </div>
                                    </div>
                              ))}
                          </div>
                      </div>

                      {/* --- TOTALES Y PAGOS --- */}
                      <div className="p-5 bg-white border-t border-gray-200">
                          <div className="flex justify-between items-end mb-4">
                            <span className="text-sm font-bold text-gray-500">Total Pagado</span>
                            <div className="text-right">
                                <span className="block text-2xl font-black text-gray-900">Ref {parseFloat(selectedSaleDetail.total_usd).toFixed(2)}</span>
                                <span className="block text-xs text-gray-500 font-medium">Bs {parseFloat(selectedSaleDetail.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                          
                          <div className="bg-gray-50 p-3 rounded-xl text-xs text-gray-600 space-y-1">
                              <p><span className="font-bold">Método:</span> {selectedSaleDetail.payment_method}</p>
                              {selectedSaleDetail.taxBreakdown && selectedSaleDetail.taxBreakdown.ivaUSD > 0 && (
                                  <p><span className="font-bold text-blue-600">Incluye IVA (16%):</span> Ref {selectedSaleDetail.taxBreakdown.ivaUSD.toFixed(2)}</p>
                              )}
                          </div>
                      </div>
                  </div>

                  {/* --- BOTÓN DE REIMPRESIÓN MEJORADO --- */}
<div className="p-4 bg-white border-t border-gray-200">
    <button 
      onClick={() => {
          // Preparamos los datos del cliente. Si no hay datos (cliente casual), enviamos vacíos
          // para que la función generateReceiptHTML use los valores por defecto ("CONSUMIDOR FINAL")
          const tempCustomer = {
              full_name: selectedSaleDetail.full_name || '', // Si es null, pasa string vacío
              id_number: selectedSaleDetail.id_number || '',
              institution: selectedSaleDetail.institution || '', 
              phone: selectedSaleDetail.phone || ''
          };

          // Llamamos a la nueva función con todos los parámetros
          const html = generateReceiptHTML(
              selectedSaleDetail.id, 
              tempCustomer, 
              selectedSaleDetail.items,
              selectedSaleDetail.invoice_type, // 'FISCAL' o 'TICKET'
              selectedSaleDetail.status,       // 'PAGADO', 'PENDIENTE', etc.
              selectedSaleDetail.created_at    // Fecha real de la venta,
			  parseFloat(selectedSaleDetail.total_usd)
          );
          
          setReceiptPreview(html); 
      }}
      className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-black shadow-lg transition-all active:scale-95"
    >
        <span className="text-xl">🖨️</span>
        {/* Cambiamos el texto dinámicamente para mejor UX */}
        {selectedSaleDetail.invoice_type === 'FISCAL' ? 'Reimprimir Copia Fiscal' : 'Imprimir Ticket / Nota'}
    </button>
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
                                          <span className="text-xl">{p.icon_emoji}</span> {p.name}
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

      {/* MODAL: VENTAS DE HOY DETALLADAS */}
      {showDailySalesModal && (
          <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-3xl w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl animate-scale-up overflow-hidden">
                  <div className="p-6 border-b flex justify-between items-center bg-blue-50">
                      <div>
                          <h3 className="font-black text-2xl text-higea-blue">Cierre de Caja - HOY</h3>
                          <p className="text-sm text-blue-400 font-medium">{new Date().toLocaleDateString('es-VE', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})}</p>
                      </div>
                      <button onClick={() => setShowDailySalesModal(false)} className="bg-white w-10 h-10 rounded-full text-blue-500 font-bold shadow-sm hover:bg-blue-100 transition-colors">✕</button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-0 bg-gray-50/50">
                      <table className="w-full text-sm text-left border-collapse">
                          <thead className="bg-white text-gray-400 uppercase text-[10px] font-bold tracking-wider sticky top-0 shadow-sm z-10">
                              <tr>
                                  <th className="px-5 py-3">Hora</th>
                                  <th className="px-5 py-3">Cliente</th>
                                  <th className="px-5 py-3">Método Pago</th>
                                  <th className="px-5 py-3 text-right">Total Ref</th>
                                  <th className="px-5 py-3 text-center">Acción</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                              {dailySalesList.map(sale => (
                                  <tr key={sale.id} className="hover:bg-blue-50 transition-colors group">
                                      <td className="px-5 py-4 text-gray-500 font-mono text-xs">
                                          {new Date(sale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                      </td>
                                      <td className="px-5 py-4">
                                          <div className="font-bold text-gray-700">{sale.full_name || 'Consumidor Final'}</div>
                                          <div className="text-[10px] text-gray-400">ID: #{sale.id}</div>
                                      </td>
                                      <td className="px-5 py-4">
                                          <span className="px-2 py-1 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 border border-gray-200">
                                              {sale.payment_method.split('[')[0].slice(0, 15)}...
                                          </span>
                                      </td>
                                      <td className="px-5 py-4 text-right">
                                          <span className="font-black text-higea-blue text-base">Ref {parseFloat(sale.total_usd).toFixed(2)}</span>
                                      </td>
                                      <td className="px-5 py-4 text-center">
                                          <button 
                                              onClick={() => showSaleDetail(sale)} 
                                              className="bg-blue-50 text-higea-blue p-2 rounded-lg hover:bg-higea-blue hover:text-white transition-colors shadow-sm"
                                              title="Ver Detalles Completos"
                                          >
                                              👁️
                                          </button>
                                      </td>
                                  </tr>
                              ))}
                              {dailySalesList.length === 0 && <tr><td colSpan="5" className="p-12 text-center text-gray-400 italic">No hay movimientos registrados hoy.</td></tr>}
                          </tbody>
                      </table>
                  </div>
                  
                  {/* Footer con Totales */}
                  <div className="p-5 border-t bg-white flex justify-between items-center shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-20">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                          Transacciones: <span className="text-gray-800 text-lg ml-1">{dailySalesList.length}</span>
                      </div>
                      <div className="text-right">
                          <p className="text-xs text-gray-400 font-bold uppercase mb-1">Total Recaudado</p>
                          <p className="text-3xl font-black text-higea-blue leading-none">
                              Ref {dailySalesList.reduce((acc, curr) => acc + parseFloat(curr.total_usd), 0).toFixed(2)}
                          </p>
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
	  
    </div>
  );
}

export default App;