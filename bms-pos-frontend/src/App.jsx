import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';

// TU URL DE RENDER
const API_URL = 'https://bms-postventa-api.onrender.com/api';

function App() {
  // --- ESTADOS PRINCIPALES ---
  const [view, setView] = useState('POS');
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [bcvRate, setBcvRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  
  // Modales
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedSaleDetail, setSelectedSaleDetail] = useState(null); 
  // NUEVO: Estado para el modal de captura de cliente (Crédito)
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
  // NUEVO: Estado para créditos pendientes
  const [pendingCredits, setPendingCredits] = useState([]); 
  const [lowStock, setLowStock] = useState([]);
  // NUEVO: Estado para notificaciones de vencimiento
  const [overdueCount, setOverdueCount] = useState(0); 

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const statusRes = await axios.get(`${API_URL}/status`);
      setBcvRate(statusRes.data.bcv_rate);

      const prodRes = await axios.get(`${API_URL}/products`);
      const allProducts = prodRes.data.sort((a, b) => a.id - b.id);
      setProducts(allProducts);
      setFilteredProducts(allProducts);
      setCategories(['Todos', ...new Set(allProducts.map(p => p.category))]);

      const statsRes = await axios.get(`${API_URL}/reports/daily`);
      setStats(statsRes.data);
      const recentRes = await axios.get(`${API_URL}/reports/recent-sales`);
      setRecentSales(recentRes.data);
      const stockRes = await axios.get(`${API_URL}/reports/low-stock`);
      setLowStock(stockRes.data);
      
      // NUEVO: Obtener créditos pendientes y contar vencidos
      const creditsRes = await axios.get(`${API_URL}/reports/credit-pending}`);
      setPendingCredits(creditsRes.data);
      const overdue = creditsRes.data.filter(c => c.is_overdue).length;
      setOverdueCount(overdue);
      
      setLoading(false);
    } catch (error) {
      console.error("Error:", error);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCategory === 'Todos') setFilteredProducts(products);
    else setFilteredProducts(products.filter(p => p.category === selectedCategory));
  }, [selectedCategory, products]);

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
      if (existing) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (id) => {
    setCart(prev => {
        const existing = prev.find(i => i.id === id);
        if (existing.quantity > 1) return prev.map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i);
        return prev.filter(i => i.id !== id);
    });
  };

  // --- CÁLCULOS PRINCIPALES ---
  const totalUSD = cart.reduce((sum, item) => sum + (parseFloat(item.price_usd) * item.quantity), 0);
  const totalVES = totalUSD * bcvRate;
  
  // Lista de métodos de pago con su tipo de moneda
  const paymentMethods = [
      { name: 'Efectivo Ref', currency: 'Ref' },
      { name: 'Efectivo Bs', currency: 'Bs' },
      { name: 'Zelle', currency: 'Ref' },
      { name: 'Crédito', currency: 'Ref' }, // Método clave para gestión de clientes
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
      const remainingUSD = totalUSD - paidUSD;
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

      let remainingToCoverUSD = totalUSD - paidByOthersUSD;
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

  // NUEVA FUNCIÓN UNIFICADA DE PROCESAMIENTO DE VENTA/CRÉDITO
  const processSale = async (isCreditFlow = false) => {
      
      const isCreditSale = isCreditFlow && (parseFloat(paymentShares['Crédito']) || 0) > 0;

      // 1. Validar datos mínimos del cliente para Crédito (si aplica)
      if (isCreditSale && (!customerData.full_name || !customerData.id_number)) {
          return Swal.fire('Datos Incompletos', 'Nombre y Cédula son obligatorios para ventas a crédito.', 'warning');
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
              items: cart.map(i => ({ product_id: i.id, quantity: i.quantity, price_usd: i.price_usd })),
              is_credit: isCreditSale, // Bandera para el backend
              customer_data: isCreditSale ? customerData : null, // Datos del cliente solo si es crédito
              due_days: isCreditSale ? dueDays : null, // 15 o 30 días solo si es crédito
          };
          
          Swal.fire({ title: `Procesando ${isCreditSale ? 'Crédito' : 'Venta'}...`, didOpen: () => Swal.showLoading() });
          await axios.post(`${API_URL}/sales`, saleData);
          
          Swal.fire({ 
              icon: 'success', 
              title: isCreditSale ? '¡Crédito Registrado!' : '¡Venta Registrada!', 
              html: `Inventario actualizado. Total: Ref ${totalUSD.toFixed(2)}`, 
              confirmButtonColor: '#0056B3' 
          });

          // Resetear estados
          setCart([]);
          setIsCustomerModalOpen(false);
          setIsPaymentModalOpen(false); // <--- Corrección: Cierra el modal principal de pago
          setCustomerData({ full_name: '', id_number: '', phone: '', institution: '' });
          fetchData(); 
      } catch (error) {
          const message = error.response?.data?.message || error.message;
          Swal.fire('Error', `Fallo al procesar ${isCreditSale ? 'crédito' : 'venta'}`, 'error');
          console.error(error);
      }
  }


  // Función de validación y apertura de modal de cliente para Crédito
  const handleCreditProcess = () => {
      // 1. Verificar si solo se paga con Crédito o Crédito es el saldo pendiente
      const creditAmount = parseFloat(paymentShares['Crédito']) || 0;
      const creditUsed = creditAmount > 0;
      
      // Verificación de saldo: Si hay saldo pendiente y no se usó crédito para cubrirlo
      if (remainingUSD > 0.05 && (!creditUsed || creditAmount < remainingUSD)) {
          return Swal.fire('Monto Insuficiente', `Faltan Ref ${remainingUSD.toFixed(2)} por cubrir.`, 'warning');
      }

      if (creditUsed) {
          // Si se usó crédito, abrir modal de cliente.
          setIsCustomerModalOpen(true);
          setIsPaymentModalOpen(false); 
      } else {
          // Si es pago completo (no crédito), procesar directamente
          processSale(false);
      }
  }

  // --- Funciones de Reporte de Crédito ---
  const markAsPaid = async (saleId) => {
      const result = await Swal.fire({
          title: '¿Marcar como Pagado?',
          text: "¿Estás seguro de que deseas saldar la cuenta por cobrar?",
          icon: 'question',
          showCancelButton: true,
          confirmButtonColor: '#0056B3',
          cancelButtonColor: '#E11D2B',
          confirmButtonText: 'Sí, Saldo Ahora'
      });
      
      if (result.isConfirmed) {
          try {
              await axios.post(`${API_URL}/sales/${saleId}/pay-credit`);
              Swal.fire('¡Saldado!', 'El crédito ha sido marcado como PAGADO.', 'success');
              fetchData();
          } catch (error) {
              Swal.fire('Error', 'No se pudo saldar el crédito.', 'error');
          }
      }
  }

  const showSaleDetail = async (sale) => {
      try {
          const res = await axios.get(`${API_URL}/sales/${sale.id}`);
          
          // Incluimos todos los datos de la venta para el detalle, incluyendo datos de cliente si existen
          setSelectedSaleDetail({ 
              id: sale.id, 
              items: res.data, 
              payment_method: sale.payment_method, 
              total_usd: sale.total_usd,
              total_ves: sale.total_ves,
              status: sale.status,
              full_name: sale.full_name,
              id_number: sale.id_number,
              due_date: sale.due_date,
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
          setCurrentInputValue(parseFloat(value) > 0 ? value.toString() : '');
          setCurrentReference(paymentReferences[name] || ''); 
          setIsNumpadOpen(true);
      };

      // Si es Crédito y el monto es > 0, se resalta como un crédito activo en la vista general
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
          // MODIFICACIÓN DE RESPONSIVIDAD: items-end en móvil, items-center en md+
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
                              autoFocus
                          />
                      </div>
                  )}

                  {/* NUMPAD GRID */}
                  <div className="grid grid-cols-3 gap-2 p-4 pt-0">
                      {numpadKeys.map(key => (
                          <button 
                              key={key} 
                              onClick={() => handleNumpadClick(key)} 
                              onMouseDown={(e) => e.preventDefault()}
                              className={`p-4 rounded-xl text-2xl font-bold transition-colors ${key === 'C' ? 'bg-red-100 text-red-600' : 'bg-gray-100 hover:bg-gray-200'}`}
                          >
                              {key}
                          </button>
                      ))}
                      <button 
                          onClick={handleNumpadClick.bind(null, 'DEL')} 
                          onMouseDown={(e) => e.preventDefault()}
                          className="col-span-1 p-4 rounded-xl text-2xl font-bold bg-gray-100 hover:bg-gray-200"
                      >
                          ⌫
                      </button>
                  </div>
                  
                  {/* ACCIONES RÁPIDAS */}
                  <div className="p-4 pt-0 flex flex-col gap-2">
                      <button 
                          onClick={handlePayRemaining} 
                          onMouseDown={(e) => e.preventDefault()}
                          className="w-full bg-yellow-500 text-white font-bold py-3 rounded-xl hover:bg-yellow-600"
                      >
                          PAGAR SALDO ({currencySymbol})
                      </button>
                      <button 
                          onClick={handleConfirm} 
                          onMouseDown={(e) => e.preventDefault()}
                          className="w-full bg-higea-blue text-white font-bold py-3 rounded-xl hover:bg-blue-700"
                      >
                          CONFIRMAR MONTO
                      </button>
                  </div>
              </div>
          </div>
      );
  };

  // Componente Modal de Captura de Cliente (Aparece SÓLO si se usa Crédito)
  const CustomerModal = () => {
      const isCreditUsed = (parseFloat(paymentShares['Crédito']) || 0) > 0;
      
      const handleChange = (e) => {
          const { name, value } = e.target;
          setCustomerData(prev => ({ ...prev, [name]: value }));
      };

      const handleBlur = (e) => {
          // Desenfocar el campo manualmente después de la edición para mejorar la UX táctil
          e.target.blur();
      };

      return (
          <div className="fixed inset-0 z-[65] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-scale-up">
                  <div className="bg-higea-blue p-5 text-white text-center">
                      <h3 className="text-xl font-bold">Registro de Crédito</h3>
                      <p className="text-sm mt-1">Total a Financiar: Ref {totalUSD.toFixed(2)}</p>
                  </div>
                  
                  <div className="p-5 space-y-4">
                      <div className="flex justify-between items-center bg-yellow-50 p-3 rounded-xl border border-yellow-200">
                          <span className="font-bold text-yellow-800 text-sm">Plazo de Pago</span>
                          <div className="flex gap-2">
                            <button onClick={() => setDueDays(15)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 15 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>15 Días</button>
                            <button onClick={() => setDueDays(30)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${dueDays === 30 ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>30 Días</button>
                          </div>
                      </div>

                      <input type="text" name="full_name" placeholder="Nombre Completo (*)" onChange={handleChange} value={customerData.full_name} 
                          className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                          autoFocus={true} 
                          onBlur={handleBlur} /> {/* <-- FIX: Añadido onBlur */}
                      
                      <div className="grid grid-cols-2 gap-4">
                          <input type="text" name="id_number" placeholder="Cédula/RIF (*)" onChange={handleChange} value={customerData.id_number} 
                              className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                              onBlur={handleBlur} /> {/* <-- FIX: Añadido onBlur */}
                          <input type="tel" name="phone" placeholder="Teléfono" onChange={handleChange} value={customerData.phone} 
                              className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                              onBlur={handleBlur} /> {/* <-- FIX: Añadido onBlur */}
                      </div>
                      
                      <input type="text" name="institution" placeholder="Institución/Referencia" onChange={handleChange} value={customerData.institution} 
                          className="w-full border p-3 rounded-xl focus:border-higea-blue outline-none" 
                          onBlur={handleBlur} /> {/* <-- FIX: Añadido onBlur */}
                          
                      {isCreditUsed && <p className="text-xs text-gray-500 italic">* Esta venta será marcada como PENDIENTE de pago.</p>}
                  </div>

                  <div className="p-5 flex gap-3 bg-white border-t border-gray-50">
                      <button onClick={() => { setIsCustomerModalOpen(false); setIsPaymentModalOpen(true); }} className="flex-1 py-3 text-gray-500 font-bold text-sm">Volver</button>
                      <button onClick={() => processSale(true)} className="flex-1 py-3 text-white font-bold rounded-xl shadow-lg bg-higea-red hover:bg-red-700">
                          Confirmar Crédito
                      </button>
                  </div>
              </div>
          </div>
      );
  }


  // --- RESTO DE COMPONENTES Y LÓGICA DE UI ---
  const CartItem = ({ item }) => (
    <div onClick={() => removeFromCart(item.id)} className="flex justify-between items-center py-3 px-3 mb-2 rounded-xl bg-white border border-gray-100 shadow-sm active:scale-95 cursor-pointer select-none">
      <div className="flex items-center gap-3">
        <div className="relative">
            <div className="h-10 w-10 bg-gray-50 rounded-lg flex items-center justify-center text-lg">{item.category === 'Bebidas' ? '🥤' : '🍔'}</div>
            <div className="absolute -top-2 -right-2 bg-higea-red text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full border border-white">{item.quantity}</div>
        </div>
        <div>
           <p className="font-bold text-gray-700 text-sm leading-tight">{item.name}</p>
           {/* Ref */}
           <p className="text-[10px] text-gray-400 font-medium">Ref {item.price_usd} c/u</p>
        </div>
      </div>
      <div className="text-right">
        {/* Ref */}
        <div className="font-bold text-gray-800 text-sm">Ref {(item.price_usd * item.quantity).toFixed(2)}</div>
      </div>
    </div>
  );

  if (loading) return <div className="h-screen flex items-center justify-center bg-gray-50"><div className="w-10 h-10 border-4 border-higea-blue border-t-transparent rounded-full animate-spin"></div></div>;

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans overflow-hidden text-gray-800">
      
      {/* SIDEBAR PC */}
      <nav className="hidden md:flex w-20 bg-white border-r border-gray-200 flex-col items-center py-6 z-40 shadow-lg">
          <div className="mb-8 h-10 w-10 bg-higea-red rounded-xl flex items-center justify-center text-white font-bold text-xl">H</div>
          <button onClick={() => setView('POS')} className={`p-3 rounded-xl mb-4 transition-all ${view === 'POS' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg></button>
          
          <button onClick={() => { fetchData(); setView('DASHBOARD'); }} className={`p-3 rounded-xl transition-all relative ${view === 'DASHBOARD' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" /></svg>
              {/* Notificación de Créditos Vencidos */}
              {overdueCount > 0 && <span className="absolute top-1 right-1 h-3 w-3 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">{overdueCount}</span>}
          </button>
          
          <button onClick={() => { fetchData(); setView('CREDIT_REPORT'); }} className={`p-3 rounded-xl transition-all ${view === 'CREDIT_REPORT' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}>
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
          </button>
      </nav>

      {/* CONTENIDO */}
      <div className="flex-1 relative overflow-hidden flex flex-col pb-16 md:pb-0">
        
        {view === 'POS' ? (
           <div className="flex h-full flex-col md:flex-row">
              <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                  <header className="bg-white/90 backdrop-blur-md border-b border-gray-200 px-4 py-3 flex justify-between items-center shadow-sm z-20">
                     <div className="flex flex-col">
                        <span className="text-[10px] font-bold tracking-[0.2em] text-higea-blue uppercase">VOLUNTARIADO</span>
                        <h1 className="text-xl font-black text-higea-red leading-none">HIGEA</h1>
                     </div>
                     <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-bold text-gray-800">{bcvRate.toFixed(2)} Bs</span>
                     </div>
                  </header>

                  <div className="px-4 py-3 overflow-x-auto no-scrollbar flex items-center gap-2 bg-[#F8FAFC]">
                      {categories.map(cat => (
                          <button key={cat} onClick={() => setSelectedCategory(cat)} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold border transition-all ${selectedCategory === cat ? 'bg-higea-blue text-white border-higea-blue' : 'bg-white text-gray-500 border-gray-200'}`}>{cat}</button>
                      ))}
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 pb-20 md:pb-6 custom-scrollbar">
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                      {filteredProducts.map((prod) => (
                        <div key={prod.id} onClick={() => addToCart(prod)} className="bg-white rounded-2xl p-3 border border-gray-100 shadow-sm active:scale-95 transition-transform">
                          <div className="flex justify-between items-start mb-2">
                              <div className="h-10 w-10 bg-gray-50 rounded-lg flex items-center justify-center text-xl">{prod.category === 'Bebidas' ? '🥤' : '🍔'}</div>
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
                  </div>
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
                  <div className="p-5 bg-white border-t border-gray-100">
                      <div className="flex justify-between mb-4 items-end">
                          <span className="text-sm text-gray-500">Total a Pagar</span>
                          <span className="text-2xl font-black text-higea-blue">Bs {totalVES.toLocaleString('es-VE', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <button onClick={handleOpenPayment} className="w-full bg-higea-red text-white font-bold py-3 rounded-xl shadow-lg hover:bg-red-700">COBRAR</button>
                  </div>
              </aside>
           </div>
        ) : view === 'DASHBOARD' ? (
           <div className="p-4 md:p-8 overflow-y-auto h-full">
              <h2 className="text-2xl font-black text-gray-800 mb-6">Panel Gerencial</h2>
              
              {/* MODIFICACIÓN UX: Grid de 4 columnas para más información clave */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                      <p className="text-gray-400 text-xs font-bold uppercase">Ventas Hoy (Ref)</p>
                      <p className="text-3xl font-black text-higea-blue mt-1">Ref {parseFloat(stats.total_usd).toFixed(2)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                      <p className="text-gray-400 text-xs font-bold uppercase">Ventas Hoy (Bs)</p>
                      <p className="text-3xl font-black text-gray-800 mt-1">Bs {parseFloat(stats.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 0 })}</p>
                  </div>
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-orange-100 bg-orange-50/30">
                      <p className="text-orange-400 text-xs font-bold uppercase">Créditos Pendientes</p>
                      <p className="text-3xl font-black text-orange-600 mt-1">{pendingCredits.length}</p>
                  </div>
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-red-100 bg-red-50/30">
                      <p className="text-red-400 text-xs font-bold uppercase">Alertas Stock ({lowStock.length})</p>
                      <div className="mt-2 space-y-1 max-h-20 overflow-y-auto">
                          {lowStock.map((p, i) => (
                              <div key={i} className="flex justify-between text-xs"><span className="truncate w-3/4">{p.name}</span><span className="font-bold text-red-500">{p.stock}</span></div>
                          ))}
                      </div>
                  </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-5 border-b border-gray-100"><h3 className="font-bold text-gray-800">Últimas Transacciones</h3></div>
                  <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs md:text-sm text-gray-600">
                          <thead className="bg-gray-50 text-gray-400 uppercase font-bold">
                              <tr>
                                  <th className="px-4 py-3">ID</th>
                                  <th className="px-4 py-3">Fecha</th>
                                  <th className="px-4 py-3">Cliente / Método</th> {/* MODIFICADO UX */}
                                  <th className="px-4 py-3">Status</th> 
                                  <th className="px-4 py-3 text-right">Total Ref</th> 
                                  <th className="px-4 py-3 text-right">Total Bs</th> 
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {recentSales.map((sale) => (
                                  <tr key={sale.id} onClick={() => showSaleDetail(sale)} className="hover:bg-blue-50 cursor-pointer active:bg-blue-100">
                                      <td className="px-4 py-3 font-bold text-higea-blue">#{sale.id}</td>
                                      <td className="px-4 py-3">{sale.full_date}</td>
                                      <td className="px-4 py-3"> {/* Muestra datos de cliente si es crédito, sino el método */}
                                          {sale.status === 'PENDIENTE' && sale.full_name ? (
                                              <div className="flex flex-col">
                                                  <span className="font-bold text-gray-800 leading-tight">{sale.full_name}</span>
                                                  <span className="text-xs text-gray-500">CI: {sale.id_number}</span>
                                              </div>
                                          ) : (
                                              <span className="px-2 py-1 rounded bg-gray-100 text-[10px]">{sale.payment_method.slice(0, 30)}...</span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3">
                                          <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                                            sale.status === 'PENDIENTE' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                                          }`}>
                                              {sale.status}
                                          </span>
                                      </td>
                                      <td className="px-4 py-3 text-right font-bold text-higea-red">Ref {parseFloat(sale.total_usd).toFixed(2)}</td> 
                                      <td className="px-4 py-3 text-right font-bold">Bs {parseFloat(sale.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 0 })}</td> 
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
           </div>
        ) : (
             /* NUEVO PANEL DE REPORTES DE CRÉDITO */
           <div className="p-4 md:p-8 overflow-y-auto h-full">
               <h2 className="text-2xl font-black text-gray-800 mb-6">Cuentas por Cobrar (Crédito)</h2>
               
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                        <p className="text-gray-400 text-xs font-bold uppercase">Créditos Pendientes</p>
                        <p className="text-3xl font-black text-higea-blue mt-1">{pendingCredits.length}</p>
                    </div>
                    <div className="bg-white p-5 rounded-3xl shadow-sm border border-red-100 bg-red-50/30">
                        <p className="text-red-400 text-xs font-bold uppercase">Vencidos (Alerta)</p>
                        <p className="text-3xl font-black text-red-600 mt-1">{overdueCount}</p>
                    </div>
               </div>
               
               <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                   <div className="p-5 border-b border-gray-100"><h3 className="font-bold text-gray-800">Listado de Créditos PENDIENTES</h3></div>
                   <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs md:text-sm text-gray-600">
                            <thead className="bg-gray-50 text-gray-400 uppercase font-bold">
                                <tr>
                                    <th className="px-4 py-3">ID</th>
                                    <th className="px-4 py-3">Cliente (Cédula)</th>
                                    <th className="px-4 py-3">Vencimiento</th>
                                    <th className="px-4 py-3 text-right">Monto Ref</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {pendingCredits.map((credit) => (
                                    <tr key={credit.id} className={`${credit.is_overdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-blue-50'}`}>
                                        <td className="px-4 py-3 font-bold text-higea-blue cursor-pointer" onClick={() => showSaleDetail(credit)}>#{credit.id}</td>
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-gray-800">{credit.full_name}</p>
                                            <p className="text-xs text-gray-500">CI: {credit.id_number}</p>
                                        </td>
                                        <td className={`px-4 py-3 font-bold ${credit.is_overdue ? 'text-red-600' : 'text-gray-800'}`}>
                                            {new Date(credit.due_date).toLocaleDateString()}
                                        </td>
                                        <td className="px-4 py-3 text-right font-black text-higea-red">Ref {parseFloat(credit.total_usd).toFixed(2)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold ${credit.is_overdue ? 'bg-red-200 text-red-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                                {credit.is_overdue ? 'VENCIDO' : credit.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => markAsPaid(credit.id)} className="bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl hover:bg-green-600 active:scale-95 transition-transform">
                                                Saldar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                   </div>
               </div>
           </div>
        )}
      </div>

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
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
              <span className="text-[10px] font-bold">Crédito</span>
          </button>
      </div>


      {/* MODAL PRINCIPAL DE PAGO (MODIFICADO PARA LLAMAR A CAPTURA DE CLIENTE) */}
      {isPaymentModalOpen && (
          <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl animate-scale-up">
                  <div className="bg-gray-50 p-5 border-b border-gray-100 text-center">
                      <h3 className="text-sm font-bold text-gray-400 uppercase">Total a Pagar</h3>
                      <p className="text-3xl font-black text-gray-800">Ref {totalUSD.toFixed(2)}</p>
                      <p className="text-sm text-higea-blue font-bold">Bs {totalVES.toLocaleString('es-VE', {maximumFractionDigits:2})}</p>
                      
                      {/* ACCIÓN RÁPIDA DE PAGO EXACTO */}
                      {!isNumpadOpen && remainingUSD > 0.05 && (
                          <div className="mt-4">
                              <button onClick={() => handleExactPayment(paymentMethods[0].name)} className="bg-higea-red text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-red-700 transition-colors">
                                  Pagar Ref {totalUSD.toFixed(2)} con {paymentMethods[0].name}
                              </button>
                          </div>
                      )}
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
                          onClick={handleCreditProcess} // Llama a la función que decide si es crédito o pago normal
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
      {isCustomerModalOpen && <CustomerModal />} {/* Nuevo modal de cliente */}

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
                  <div className="flex justify-between mb-4"><span className="font-bold text-gray-500">Total Bs</span><span className="font-black text-2xl text-higea-blue">{totalVES.toLocaleString('es-VE', {maximumFractionDigits:0})}</span></div>
                  <button onClick={handleOpenPayment} className="w-full bg-higea-red text-white py-4 rounded-xl font-bold shadow-lg">COBRAR</button>
              </div>
          </div>
      )}

      {/* --- MODAL DETALLE VENTA (MEJORADO PARA CRÉDITO) --- */}
      {selectedSaleDetail && (
          <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative">
                  <button onClick={() => setSelectedSaleDetail(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">✕</button>
                  
                  <div className="p-5 border-b">
                     <h3 className="font-bold text-lg text-gray-800">Detalle de Venta #{selectedSaleDetail.id}</h3>
                  </div>

                  <div className="max-h-[70vh] overflow-y-auto">
                      
                      {/* DETALLES DEL CLIENTE (Si existen) */}
                      {(selectedSaleDetail.status === 'PENDIENTE' || selectedSaleDetail.full_name) && (
                          <div className="p-5 bg-yellow-50 border-b border-yellow-100">
                               <p className="text-xs font-bold uppercase text-yellow-800 mb-2">Detalles de Crédito</p>
                               <div className="text-sm space-y-1 text-yellow-900">
                                    <p><span className="font-bold">Cliente:</span> {selectedSaleDetail.full_name}</p>
                                    <p><span className="font-bold">Cédula:</span> {selectedSaleDetail.id_number}</p>
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
                      
                      {/* Resumen de Pago */}
                      <div className="p-5 bg-gray-50 border-b border-gray-100">
                          <p className="text-xs font-bold uppercase text-gray-400 mb-2">Método de Pago</p>
                          <p className="text-sm font-medium text-gray-700 break-words">{selectedSaleDetail.payment_method}</p>
                          
                          <div className="flex justify-between mt-3 pt-3 border-t border-gray-200">
                            <span className="font-bold text-gray-500">Total Venta:</span>
                            <div>
                                <span className="font-black text-lg text-higea-red block text-right">Ref {parseFloat(selectedSaleDetail.total_usd).toFixed(2)}</span>
                                <span className="font-medium text-sm text-gray-700 block text-right">Bs {parseFloat(selectedSaleDetail.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                      </div>

                      {/* Lista de Productos */}
                      <div className="p-5 space-y-3">
                          <p className="text-xs font-bold uppercase text-gray-400 mb-2">Productos Vendidos</p>
                          {selectedSaleDetail.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between pb-2 border-b border-gray-100 last:border-b-0">
                                  <div>
                                      <p className="font-bold text-sm text-gray-700">{item.name}</p>
                                      <p className="text-xs text-gray-400">Ref {item.price_at_moment_usd} c/u</p>
                                  </div>
                                  <div className="text-right">
                                      <span className="bg-blue-50 text-higea-blue text-xs font-bold px-2 py-1 rounded">x{item.quantity}</span>
                                      <p className="font-bold text-gray-800 mt-1">Ref {(item.price_at_moment_usd * item.quantity).toFixed(2)}</p>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;