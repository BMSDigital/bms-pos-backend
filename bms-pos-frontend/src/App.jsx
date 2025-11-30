import { useState, useEffect } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';

// TU URL DE RENDER
const API_URL = 'https://bms-postventa-api.onrender.com/api';

function App() {
  // --- ESTADOS ---
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
  
  // --- LÓGICA DE PAGO INTELIGENTE ---
  const [paymentShares, setPaymentShares] = useState({}); 
  
  // Data Dashboard
  const [stats, setStats] = useState({ total_usd: 0, total_ves: 0, total_transactions: 0 });
  const [recentSales, setRecentSales] = useState([]);
  const [lowStock, setLowStock] = useState([]);

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
    
    // PUNTO 4: MENSAJE CORDIAL Y PROFESIONAL
    if (qty + 1 > product.stock) {
        Swal.fire({ 
            icon: 'info', // Usamos 'info' en vez de error para ser más suaves
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

  // --- CÁLCULOS ---
  const totalUSD = cart.reduce((sum, item) => sum + (parseFloat(item.price_usd) * item.quantity), 0);
  const totalVES = totalUSD * bcvRate;
  
  // --- GESTIÓN DE PAGO AUTOMÁTICO (PUNTO 3) ---
  const handleOpenPayment = () => {
      if (cart.length === 0) return Swal.fire('Carrito Vacío', '', 'info');
      setPaymentShares({}); 
      setIsPaymentModalOpen(true);
  };

  const updatePaymentShare = (method, value) => {
      setPaymentShares(prev => ({ ...prev, [method]: value }));
  };

  // Esta función hace la MAGIA de calcular el resto automático
  const autoFillRemaining = (targetMethod) => {
      // 1. Calcular cuánto han pagado los OTROS métodos
      let paidByOthersUSD = 0;
      
      Object.entries(paymentShares).forEach(([method, amountStr]) => {
          if (method === targetMethod) return; // Ignoramos el método actual que queremos llenar
          const amount = parseFloat(amountStr) || 0;
          if (method.includes('Ref') || method === 'Zelle') {
              paidByOthersUSD += amount;
          } else {
              paidByOthersUSD += (amount / bcvRate);
          }
      });

      // 2. Calcular cuánto falta en USD
      let remainingToCoverUSD = totalUSD - paidByOthersUSD;
      if (remainingToCoverUSD < 0) remainingToCoverUSD = 0;

      // 3. Convertir al método destino y setear
      let finalValue = 0;
      if (targetMethod.includes('Ref') || targetMethod === 'Zelle') {
          finalValue = remainingToCoverUSD.toFixed(2);
      } else {
          // Si es Bolívares, convertimos USD -> VES
          finalValue = (remainingToCoverUSD * bcvRate).toFixed(2);
      }

      updatePaymentShare(targetMethod, finalValue);
  };

  const calculatePaymentTotals = () => {
      let paidUSD = 0;
      Object.entries(paymentShares).forEach(([method, amountStr]) => {
          const amount = parseFloat(amountStr) || 0;
          if (method.includes('Ref') || method === 'Zelle') {
              paidUSD += amount; 
          } else {
              paidUSD += (amount / bcvRate);
          }
      });
      const remainingUSD = totalUSD - paidUSD;
      return { paidUSD, remainingUSD };
  };

  const { remainingUSD } = calculatePaymentTotals();
  // Margen de tolerancia de 0.05 para errores de redondeo
  const isInsufficient = remainingUSD > 0.05; 

  const processSale = async () => {
      if (isInsufficient) {
          return Swal.fire('Monto Insuficiente', `Faltan Ref ${remainingUSD.toFixed(2)} por cubrir.`, 'warning');
      }

      const methodsString = Object.entries(paymentShares)
          .filter(([_, amt]) => parseFloat(amt) > 0)
          .map(([method, amt]) => `${method}: ${method.includes('Ref') || method === 'Zelle' ? 'Ref' : 'Bs'}${amt}`)
          .join(' + ');

      try {
          const saleData = {
              payment_method: methodsString || 'Pago Completo',
              items: cart.map(i => ({ product_id: i.id, quantity: i.quantity, price_usd: i.price_usd }))
          };
          
          Swal.fire({ title: 'Procesando...', didOpen: () => Swal.showLoading() });
          await axios.post(`${API_URL}/sales`, saleData);
          
          const changeMsg = remainingUSD < -0.05 ? `<br><b>Vuelto Estimado: Ref ${Math.abs(remainingUSD).toFixed(2)}</b>` : '';

          Swal.fire({ 
              icon: 'success', 
              title: '¡Venta Registrada!', 
              html: `Inventario actualizado.${changeMsg}`, 
              confirmButtonColor: '#0056B3' 
          });

          setCart([]);
          setIsPaymentModalOpen(false);
          setIsMobileCartOpen(false);
          fetchData();
      } catch (error) {
          Swal.fire('Error', 'Fallo al procesar venta', 'error');
      }
  };

  const showSaleDetail = async (saleId) => {
      try {
          const res = await axios.get(`${API_URL}/sales/${saleId}`);
          setSelectedSaleDetail({ id: saleId, items: res.data });
      } catch (error) { console.error(error); }
  };

  const CartItem = ({ item }) => (
    <div onClick={() => removeFromCart(item.id)} className="flex justify-between items-center py-3 px-3 mb-2 rounded-xl bg-white border border-gray-100 shadow-sm active:scale-95 cursor-pointer select-none">
      <div className="flex items-center gap-3">
        <div className="relative">
            <div className="h-10 w-10 bg-gray-50 rounded-lg flex items-center justify-center text-lg">{item.category === 'Bebidas' ? '🥤' : '🍔'}</div>
            <div className="absolute -top-2 -right-2 bg-higea-red text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full border border-white">{item.quantity}</div>
        </div>
        <div>
           <p className="font-bold text-gray-700 text-sm leading-tight">{item.name}</p>
           {/* PUNTO 2: CAMBIO $ -> Ref */}
           <p className="text-[10px] text-gray-400 font-medium">Ref {item.price_usd} c/u</p>
        </div>
      </div>
      <div className="text-right">
        {/* PUNTO 2: CAMBIO $ -> Ref */}
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
          <button onClick={() => { fetchData(); setView('DASHBOARD'); }} className={`p-3 rounded-xl transition-all ${view === 'DASHBOARD' ? 'bg-blue-50 text-higea-blue' : 'text-gray-400 hover:bg-gray-100'}`}><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" /></svg></button>
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
                              {/* PUNTO 2: Ref */}
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
                      
                      {/* PUNTO 1: FECHA Y PUNTO VERDE DE CAJA ABIERTA */}
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
        ) : (
           <div className="p-4 md:p-8 overflow-y-auto h-full">
              <h2 className="text-2xl font-black text-gray-800 mb-6">Panel Gerencial</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                      <p className="text-gray-400 text-xs font-bold uppercase">Ventas Hoy (Ref)</p>
                      <p className="text-3xl font-black text-higea-blue mt-1">Ref {parseFloat(stats.total_usd).toFixed(2)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                      <p className="text-gray-400 text-xs font-bold uppercase">Ventas Hoy (Bs)</p>
                      <p className="text-3xl font-black text-gray-800 mt-1">Bs {parseFloat(stats.total_ves).toLocaleString('es-VE', { maximumFractionDigits: 0 })}</p>
                  </div>
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-red-100 bg-red-50/30">
                      <p className="text-red-400 text-xs font-bold uppercase">Alertas Stock</p>
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
                              <tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Método</th><th className="px-4 py-3 text-right">Total</th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {recentSales.map((sale) => (
                                  <tr key={sale.id} onClick={() => showSaleDetail(sale.id)} className="hover:bg-blue-50 cursor-pointer active:bg-blue-100">
                                      <td className="px-4 py-3 font-bold text-higea-blue">#{sale.id}</td>
                                      <td className="px-4 py-3">{sale.full_date}</td>
                                      <td className="px-4 py-3"><span className="px-2 py-1 rounded bg-gray-100 text-[10px]">{sale.payment_method.slice(0, 30)}...</span></td>
                                      <td className="px-4 py-3 text-right font-bold">Ref {sale.total_usd}</td>
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
      </div>

      {/* --- MODAL DE PAGO AUTOMÁTICO (PUNTO 3 y 4) --- */}
      {isPaymentModalOpen && (
          <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl animate-scale-up">
                  <div className="bg-gray-50 p-5 border-b border-gray-100 text-center">
                      <h3 className="text-sm font-bold text-gray-400 uppercase">Total a Pagar</h3>
                      <p className="text-3xl font-black text-gray-800">Ref {totalUSD.toFixed(2)}</p>
                      <p className="text-sm text-higea-blue font-bold">Bs {totalVES.toLocaleString('es-VE', {maximumFractionDigits:2})}</p>
                  </div>
                  
                  <div className="p-5 space-y-3 max-h-[50vh] overflow-y-auto">
                      <p className="text-xs font-bold text-gray-400 mb-2">SELECCIONE MÉTODOS DE PAGO:</p>
                      
                      {/* INPUT: PAGO MÓVIL (Con Botón Rayo) */}
                      <div className="flex items-center gap-2">
                         <div className="flex-1 relative">
                             <span className="absolute left-2 top-2.5 text-xs font-bold text-gray-500 z-10">Pago Móvil (Bs)</span>
                             <input type="number" placeholder="0.00" 
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 pl-28 font-bold focus:border-higea-blue outline-none"
                                value={paymentShares['Pago Móvil'] || ''}
                                onChange={(e) => updatePaymentShare('Pago Móvil', e.target.value)}
                             />
                         </div>
                         <button onClick={() => autoFillRemaining('Pago Móvil')} className="bg-yellow-400 hover:bg-yellow-500 text-white p-2.5 rounded-lg shadow-sm" title="Cubrir Restante con Pago Móvil">
                            ⚡
                         </button>
                      </div>

                      {/* INPUT: EFECTIVO REF */}
                      <div className="flex items-center gap-2">
                         <div className="flex-1 relative">
                             <span className="absolute left-2 top-2.5 text-xs font-bold text-gray-500 z-10">Efectivo (Ref)</span>
                             <input type="number" placeholder="0.00" 
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 pl-28 font-bold focus:border-higea-blue outline-none"
                                value={paymentShares['Efectivo Ref'] || ''}
                                onChange={(e) => updatePaymentShare('Efectivo Ref', e.target.value)}
                             />
                         </div>
                         <button onClick={() => autoFillRemaining('Efectivo Ref')} className="bg-green-500 hover:bg-green-600 text-white p-2.5 rounded-lg shadow-sm" title="Cubrir Restante con Efectivo Ref">
                            ⚡
                         </button>
                      </div>

                      {/* INPUT: ZELLE */}
                      <div className="flex items-center gap-2">
                         <div className="flex-1 relative">
                             <span className="absolute left-2 top-2.5 text-xs font-bold text-gray-500 z-10">Zelle (Ref)</span>
                             <input type="number" placeholder="0.00" 
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 pl-28 font-bold focus:border-higea-blue outline-none"
                                value={paymentShares['Zelle'] || ''}
                                onChange={(e) => updatePaymentShare('Zelle', e.target.value)}
                             />
                         </div>
                         <button onClick={() => autoFillRemaining('Zelle')} className="bg-purple-500 hover:bg-purple-600 text-white p-2.5 rounded-lg shadow-sm" title="Cubrir Restante con Zelle">
                            ⚡
                         </button>
                      </div>

                      {/* INPUT: PUNTO DE VENTA */}
                      <div className="flex items-center gap-2">
                         <div className="flex-1 relative">
                             <span className="absolute left-2 top-2.5 text-xs font-bold text-gray-500 z-10">Punto (Bs)</span>
                             <input type="number" placeholder="0.00" 
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 pl-28 font-bold focus:border-higea-blue outline-none"
                                value={paymentShares['Punto de Venta'] || ''}
                                onChange={(e) => updatePaymentShare('Punto de Venta', e.target.value)}
                             />
                         </div>
                         <button onClick={() => autoFillRemaining('Punto de Venta')} className="bg-blue-500 hover:bg-blue-600 text-white p-2.5 rounded-lg shadow-sm" title="Cubrir Restante con Punto">
                            ⚡
                         </button>
                      </div>

                      {/* RESULTADO CALCULADORA */}
                      <div className={`mt-4 p-3 rounded-xl border flex justify-between items-center ${remainingUSD > 0.05 ? 'bg-red-50 border-red-100 text-red-600' : 'bg-green-50 border-green-100 text-green-600'}`}>
                          <span className="font-bold text-sm">{remainingUSD > 0.05 ? 'Faltan:' : 'Vuelto/Cambio:'}</span>
                          <span className="font-black text-xl">Ref {Math.abs(remainingUSD).toFixed(2)}</span>
                      </div>
                  </div>

                  <div className="p-5 flex gap-3 bg-white border-t border-gray-50">
                      <button onClick={() => setIsPaymentModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold text-sm">Cancelar</button>
                      <button onClick={processSale} disabled={remainingUSD > 0.05} className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all ${remainingUSD > 0.05 ? 'bg-gray-300' : 'bg-higea-blue hover:bg-blue-700'}`}>
                          Procesar
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL CARRITO MÓVIL --- */}
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

      {/* --- MODAL DETALLE VENTA --- */}
      {selectedSaleDetail && (
          <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-5 relative">
                  <button onClick={() => setSelectedSaleDetail(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">✕</button>
                  <h3 className="font-bold text-lg mb-4 text-gray-800">Venta #{selectedSaleDetail.id}</h3>
                  <div className="space-y-3 max-h-[300px] overflow-y-auto">
                      {selectedSaleDetail.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between border-b border-gray-100 pb-2">
                              <div><p className="font-bold text-sm text-gray-700">{item.name}</p><p className="text-xs text-gray-400">Ref {item.price_at_moment_usd}</p></div>
                              <div className="text-right"><span className="bg-blue-50 text-higea-blue text-xs font-bold px-2 py-1 rounded">x{item.quantity}</span></div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;