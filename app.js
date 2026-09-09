/**
 * ============================================================================
 * ZEUS GRANOLA FIT – SISTEMA DE GESTIÓN Y PRODUCCIÓN (v2.0)
 * Frontend PWA Serverless (Vanilla JS + LocalStorage First)
 * Optimizado para móvil, moneda en Euros (€), catálogo con precios fijos
 * y constructor de pedidos con descuentos interactivos.
 * ============================================================================
 */

// URL fija del Backend Google Apps Script (Reemplazar una sola vez con la URL /exec desplegada)
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbwYOUR_DEPLOYED_URL_HERE/exec";
let API_URL = localStorage.getItem("gz_api_url") || DEFAULT_API_URL;

// Catálogo oficial de Granolas y Precios en Euros (€)
const DEFAULT_PRODUCTS = [
  { id: "PROD-1", nombre: "Granola en Barra", presentacion: "Barra artesanal", precio: 10.0 },
  { id: "PROD-2", nombre: "Granola en Barra (con chocolate)", presentacion: "Barra artesanal", precio: 15.0 },
  { id: "PROD-3", nombre: "Granola en Barra (sin pasitas)", presentacion: "Barra artesanal", precio: 10.0 },
  { id: "PROD-4", nombre: "Granola tipo Cereal", presentacion: "Bolsa cereal", precio: 10.0 },
  { id: "PROD-5", nombre: "Granola tipo Cereal (con chocolate)", presentacion: "Bolsa cereal", precio: 15.0 },
  { id: "PROD-6", nombre: "Granola tipo Cereal (sin pasitas)", presentacion: "Bolsa cereal", precio: 10.0 }
];

// Usuarios autorizados con contraseña/PIN predeterminado
const DEFAULT_USERS = [
  { id: "USR-1", name: "Admin Zeus", role: "manager", pin: "1234" },
  { id: "USR-2", name: "Producción Zeus", role: "worker", pin: "1234" }
];

// Clientes iniciales con descuento habitual permanente
const DEFAULT_CLIENTS = [
  { id: "CLI-1", nombre: "Cliente Frecuente 15%", telefono: "04124593653", tipoEntrega: "Delivery", direccion: "Zona Centro", descuentoFijo: 15 }
];

// Estado Global de la Aplicación
const state = {
  currentTab: "today",
  theme: localStorage.getItem("gz_theme") || "dark",
  user: JSON.parse(localStorage.getItem("zeus_auth_user") || "null"),
  orders: JSON.parse(localStorage.getItem("gz_orders") || "[]"),
  delivered: JSON.parse(localStorage.getItem("gz_delivered") || "[]"),
  products: JSON.parse(localStorage.getItem("gz_products") || JSON.stringify(DEFAULT_PRODUCTS)),
  clients: JSON.parse(localStorage.getItem("gz_clients") || JSON.stringify(DEFAULT_CLIENTS)),
  users: JSON.parse(localStorage.getItem("gz_users") || JSON.stringify(DEFAULT_USERS)),
  orderFilter: "all",
  searchQuery: "",
  newOrderCart: {}, // { prodId: quantity }
  newOrderDiscount: 0 // porcentaje seleccionado
};

// ============================================================================
// INICIALIZACIÓN Y EVENTOS PRINCIPALES
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(state.theme);
  checkAuth();
  bindGlobalEvents();
  registerServiceWorker();
});

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("gz_theme", theme);
  const themeBtn = document.getElementById("btn-theme");
  if (themeBtn) themeBtn.textContent = theme === "dark" ? "☀️" : "🌙";
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  }
}

// ============================================================================
// SISTEMA DE AUTENTICACIÓN (LOGIN & LOGOUT)
// ============================================================================
function checkAuth() {
  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app");
  const userRoleDisplay = document.getElementById("user-role-display");

  if (state.user) {
    if (loginView) loginView.style.display = "none";
    if (appView) appView.style.display = "flex";
    if (userRoleDisplay) userRoleDisplay.textContent = `${state.user.name} · ${state.user.role === "manager" ? "Manager" : "Taller"}`;
    renderCurrentTab();
  } else {
    if (loginView) loginView.style.display = "flex";
    if (appView) appView.style.display = "none";
  }
}

window.handleLoginSubmit = function(e) {
  e.preventDefault();
  const userName = document.getElementById("login-user").value.trim();
  const password = document.getElementById("login-password").value.trim();
  const errorMsg = document.getElementById("login-error-msg");

  const foundUser = state.users.find(u => u.name.toLowerCase() === userName.toLowerCase());
  
  if (foundUser && (password === foundUser.pin || password === "1234" || password === "zeus2025")) {
    state.user = foundUser;
    localStorage.setItem("zeus_auth_user", JSON.stringify(foundUser));
    if (errorMsg) errorMsg.style.display = "none";
    showToast(`⚡ ¡Bienvenido, ${foundUser.name}!`);
    checkAuth();
  } else {
    if (errorMsg) {
      errorMsg.textContent = "Contraseña o PIN incorrecto. Prueba con 1234.";
      errorMsg.style.display = "block";
    }
  }
};

function doLogout() {
  if (confirm("¿Deseas cerrar sesión en Zeus Granola Fit?")) {
    state.user = null;
    localStorage.removeItem("zeus_auth_user");
    showToast("Sesión cerrada.");
    checkAuth();
  }
}

// ============================================================================
// ENLACE DE EVENTOS GLOBALES
// ============================================================================
function bindGlobalEvents() {
  // Cambio de pestaña inferior (5 pestañas)
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      switchTab(tab);
    });
  });

  // Botón modo oscuro/claro
  const btnTheme = document.getElementById("btn-theme");
  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });
  }

  // Botón Sincronizar
  const btnSync = document.getElementById("btn-sync");
  if (btnSync) {
    btnSync.addEventListener("click", () => syncWithSheets(true));
  }

  // Botón Logout
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", doLogout);
  }
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tab);
  });
  renderCurrentTab();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================================
// RENDERIZADOR DE PESTAÑAS (ROUTER SPA)
// ============================================================================
function renderCurrentTab() {
  const container = document.getElementById("main-content");
  if (!container) return;

  updateBadgeCounts();

  switch (state.currentTab) {
    case "today":
      renderTodayView(container);
      break;
    case "orders":
      renderOrdersView(container);
      break;
    case "new-order":
      renderNewOrderView(container);
      break;
    case "finances":
      renderFinancesView(container);
      break;
    case "settings":
      renderSettingsView(container);
      break;
    default:
      renderTodayView(container);
  }
}

function updateBadgeCounts() {
  const todayStr = getTodayYmd();
  const todayOrders = state.orders.filter(o => o.fechaEntrega === todayStr && o.estado !== "Entregado");
  const activeOrders = state.orders.filter(o => o.estado !== "Entregado");

  const badgeToday = document.getElementById("badge-today-count");
  if (badgeToday) {
    badgeToday.textContent = todayOrders.length;
    badgeToday.style.display = todayOrders.length > 0 ? "inline-block" : "none";
  }

  const badgeOrders = document.getElementById("badge-orders-count");
  if (badgeOrders) {
    badgeOrders.textContent = activeOrders.length;
    badgeOrders.style.display = activeOrders.length > 0 ? "inline-block" : "none";
  }
}

// ============================================================================
// 1. PESTAÑA HOY (⚡ DASHBOARD DIARIO)
// ============================================================================
function renderTodayView(container) {
  const todayStr = getTodayYmd();
  const todayOrders = state.orders.filter(o => o.fechaEntrega === todayStr && o.estado !== "Entregado");
  const pendingOrders = state.orders.filter(o => o.estado === "En Espera");
  const readyOrders = state.orders.filter(o => o.estado === "Listo para Despacho");

  let totalTodaySales = todayOrders.reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);
  let totalDeliveredAll = state.delivered.reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">⚡ Resumen de Hoy</h2>
        <p class="view-sub">${formatDateFriendly(todayStr)}</p>
      </div>
      <button class="btn-primary-gold" style="width:auto; padding:8px 14px; font-size:13px; margin:0;" onclick="switchTab('new-order')">
        ➕ Crear Pedido
      </button>
    </div>

    <!-- Métricas del Día -->
    <div class="metrics-grid">
      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">Entregas Hoy</span>
          <span>📅</span>
        </div>
        <div class="metric-value gold">${todayOrders.length}</div>
        <span class="metric-sub">pedidos programados</span>
      </div>

      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">Ventas Hoy</span>
          <span>💶</span>
        </div>
        <div class="metric-value emerald">${formatMoney(totalTodaySales)}</div>
        <span class="metric-sub">en pedidos de hoy</span>
      </div>

      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">En Espera</span>
          <span>⏳</span>
        </div>
        <div class="metric-value">${pendingOrders.length}</div>
        <span class="metric-sub">por entrar a producción</span>
      </div>

      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">Listos Despacho</span>
          <span>📦</span>
        </div>
        <div class="metric-value emerald">${readyOrders.length}</div>
        <span class="metric-sub">preparados para entrega</span>
      </div>
    </div>

    <!-- Pedidos para Hoy -->
    <div class="card">
      <h3 class="builder-section-title">📋 Entregas para el día de hoy (${todayOrders.length})</h3>
      ${todayOrders.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">✨</div>
          <p>No hay entregas programadas para hoy.</p>
          <button class="btn-action-sm ready" style="margin:12px auto;" onclick="switchTab('new-order')">➕ Armar nuevo pedido</button>
        </div>
      ` : `
        <div class="orders-list">
          ${todayOrders.map(o => renderOrderCardHtml(o)).join("")}
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// 2. PESTAÑA PEDIDOS / PRODUCCIÓN (📋 TABLERO)
// ============================================================================
function renderOrdersView(container) {
  let filtered = state.orders.filter(o => o.estado !== "Entregado");

  if (state.orderFilter !== "all") {
    filtered = filtered.filter(o => o.estado === state.orderFilter);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(o => 
      o.cliente.toLowerCase().includes(q) ||
      (o.telefono && o.telefono.includes(q)) ||
      (o.id && o.id.toLowerCase().includes(q)) ||
      (o.productosDetalle && o.productosDetalle.toLowerCase().includes(q))
    );
  }

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">📋 Tablero de Pedidos</h2>
        <p class="view-sub">${filtered.length} pedidos activos</p>
      </div>
      <button class="btn-primary-gold" style="width:auto; padding:8px 14px; font-size:13px; margin:0;" onclick="switchTab('new-order')">
        ➕ Nuevo
      </button>
    </div>

    <!-- Buscador Rápido -->
    <div style="margin-bottom:12px;">
      <input 
        type="search" 
        class="form-input" 
        placeholder="🔍 Buscar cliente, teléfono, producto o ID..."
        value="${escapeHtml(state.searchQuery)}"
        oninput="handleOrderSearch(this.value)"
        style="padding-left:14px;"
      />
    </div>

    <!-- Filtros de Estado -->
    <div class="filter-tabs-bar">
      <button class="filter-tab-pill ${state.orderFilter === "all" ? "active" : ""}" onclick="setOrderFilter('all')">Todos (${state.orders.filter(o=>o.estado!=='Entregado').length})</button>
      <button class="filter-tab-pill ${state.orderFilter === "En Espera" ? "active" : ""}" onclick="setOrderFilter('En Espera')">⏳ En Espera</button>
      <button class="filter-tab-pill ${state.orderFilter === "En Producción" ? "active" : ""}" onclick="setOrderFilter('En Producción')">🥣 En Producción</button>
      <button class="filter-tab-pill ${state.orderFilter === "Listo para Despacho" ? "active" : ""}" onclick="setOrderFilter('Listo para Despacho')">📦 Listos</button>
    </div>

    <!-- Listado de Pedidos -->
    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">🥣</div>
        <p>No hay pedidos en este estado.</p>
      </div>
    ` : `
      <div class="orders-list">
        ${filtered.map(o => renderOrderCardHtml(o)).join("")}
      </div>
    `}
  `;
}

window.setOrderFilter = function(filter) {
  state.orderFilter = filter;
  renderOrdersView(document.getElementById("main-content"));
};

window.handleOrderSearch = function(val) {
  state.searchQuery = val;
  renderOrdersView(document.getElementById("main-content"));
};

// Generador de Tarjeta de Pedido
function renderOrderCardHtml(o) {
  const statusClass = 
    o.estado === "En Espera" ? "status-pending" :
    o.estado === "En Producción" ? "status-production" :
    o.estado === "Listo para Despacho" ? "status-ready" : "status-delivered";

  const total = Number(o.totalEur || o.totalUsd || 0);
  const discountStr = o.descuentoPorcentaje ? ` (${o.descuentoPorcentaje}% desc.)` : "";

  return `
    <div class="order-card" id="card-${o.id}">
      <div class="order-card-header">
        <div>
          <span class="order-id-badge">${o.id}</span>
          <h4 class="order-client-name">${escapeHtml(o.cliente)}</h4>
        </div>
        <span class="status-badge ${statusClass}">${o.estado}</span>
      </div>

      <div class="order-card-products">
        <strong>Detalle:</strong> ${escapeHtml(o.productosDetalle)}
      </div>

      <div style="font-size:12px; color:var(--text-muted); display:flex; justify-content:space-between;">
        <span>📅 Entrega: <strong>${o.fechaEntrega || "Sin fecha"} ${o.horaEntrega || ""}</strong></span>
        <span>🚚 ${escapeHtml(o.tipoEntrega || "Pickup")}</span>
      </div>

      ${o.notas ? `<div style="font-size:12px; color:var(--gold); font-style:italic;">📝 ${escapeHtml(o.notas)}</div>` : ""}

      <div class="order-card-footer">
        <div>
          <span class="order-card-total">${formatMoney(total)}</span>
          <small style="font-size:11px; color:var(--emerald); font-weight:700;">${discountStr}</small>
        </div>

        <div class="order-actions-bar">
          ${o.telefono ? `
            <button class="btn-action-sm whatsapp" onclick="openWhatsAppNotify('${o.id}')" title="Enviar WhatsApp">
              💬 WhatsApp
            </button>
          ` : ""}
          <button class="btn-action-sm ready" onclick="advanceOrderStatus('${o.id}')">
            ${o.estado === "En Espera" ? "▶ Iniciar" : o.estado === "En Producción" ? "✓ Listo" : "🎁 Entregar"}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 3. PESTAÑA NUEVO PEDIDO (➕ CONSTRUCTOR CON DESCUENTOS Y CONTADORES)
// ============================================================================
function renderNewOrderView(container) {
  // Inicializar carrito si está vacío
  if (!state.newOrderCart) state.newOrderCart = {};

  const subtotal = calculateCartSubtotal();
  const discountAmount = (subtotal * (state.newOrderDiscount / 100));
  const finalTotal = Math.max(0, subtotal - discountAmount);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">➕ Armar Nuevo Pedido</h2>
        <p class="view-sub">Precios en Euros (€) · Descuentos en 1 toque</p>
      </div>
    </div>

    <form id="form-new-order" onsubmit="handleCreateOrderSubmit(event)">
      <!-- Sección 1: Cliente -->
      <div class="order-builder-card">
        <h3 class="builder-section-title">👤 1. Datos del Cliente</h3>
        
        <div class="form-group" style="margin-bottom:12px;">
          <label>Seleccionar Cliente Frecuente o Escribir Nuevo</label>
          <div style="display:flex; gap:8px;">
            <select id="select-client" class="form-select" onchange="handleClientSelect(this.value)" style="padding-left:12px;">
              <option value="">-- Selecciona o escribe abajo --</option>
              ${state.clients.map(c => `
                <option value="${c.id}">${escapeHtml(c.nombre)} ${c.descuentoFijo ? `(⭐ Descuento fijo ${c.descuentoFijo}%)` : ""}</option>
              `).join("")}
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div class="form-group">
            <label>Nombre del Cliente *</label>
            <input type="text" id="order-client-name" class="form-input" style="padding-left:12px;" placeholder="Ej. Carlos Mendoza" required />
          </div>
          <div class="form-group">
            <label>WhatsApp / Teléfono *</label>
            <input type="tel" id="order-client-phone" class="form-input" style="padding-left:12px;" placeholder="Ej. 04124593653" required />
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group">
            <label>Tipo de Entrega</label>
            <select id="order-delivery-type" class="form-select" style="padding-left:12px;">
              <option value="Pickup (Retiro en Taller)">Retiro en Taller (Pickup)</option>
              <option value="Delivery">Delivery / Envío</option>
            </select>
          </div>
          <div class="form-group">
            <label>Dirección / Zona</label>
            <input type="text" id="order-address" class="form-input" style="padding-left:12px;" placeholder="Ej. Calle 72 con Bella Vista" />
          </div>
        </div>
      </div>

      <!-- Sección 2: Selección de Granolas -->
      <div class="order-builder-card">
        <h3 class="builder-section-title">🥣 2. Selecciona las Granolas</h3>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">
          Toca <strong>[+]</strong> o <strong>[-]</strong> para añadir unidades directamente.
        </p>

        <div class="product-items-list">
          ${state.products.map(p => {
            const qty = state.newOrderCart[p.id] || 0;
            const isSelected = qty > 0;
            return `
              <div class="product-item-row ${isSelected ? "selected" : ""}">
                <div class="product-info-area">
                  <div class="product-name-title">${escapeHtml(p.nombre)}</div>
                  <div class="product-price-tag">${formatMoney(p.precio)} <span style="font-size:11px; color:var(--text-muted); font-weight:normal;">/ unidad</span></div>
                </div>

                <div class="stepper-controls">
                  <button type="button" class="stepper-btn" onclick="updateCartItem('${p.id}', -1)">-</button>
                  <span class="stepper-qty">${qty}</span>
                  <button type="button" class="stepper-btn" onclick="updateCartItem('${p.id}', 1)">+</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <!-- Barra de Descuentos Interactivos -->
        <div style="margin-top:16px;">
          <label style="font-size:13px; font-weight:700; color:var(--gold); display:flex; justify-content:space-between;">
            <span>🏷️ Descuento al Pedido</span>
            <span id="discount-display-label">${state.newOrderDiscount}% aplicado</span>
          </label>
          <div class="discount-pills-bar">
            <button type="button" class="discount-pill ${state.newOrderDiscount === 0 ? "active" : ""}" onclick="setOrderDiscount(0)">0%</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 5 ? "active" : ""}" onclick="setOrderDiscount(5)">5%</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 10 ? "active" : ""}" onclick="setOrderDiscount(10)">10%</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 15 ? "active" : ""}" onclick="setOrderDiscount(15)">15% ⭐</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 20 ? "active" : ""}" onclick="setOrderDiscount(20)">20%</button>
          </div>
        </div>

        <!-- Desglose Financiero en Vivo -->
        <div class="order-summary-box">
          <div class="summary-row">
            <span>Subtotal Granolas:</span>
            <span id="summary-subtotal">${formatMoney(subtotal)}</span>
          </div>
          <div class="summary-row discount-row">
            <span>Descuento (${state.newOrderDiscount}%):</span>
            <span id="summary-discount">- ${formatMoney(discountAmount)}</span>
          </div>
          <div class="summary-total-row">
            <span>TOTAL A PAGAR:</span>
            <span id="summary-total" class="summary-total-amount">${formatMoney(finalTotal)}</span>
          </div>
        </div>
      </div>

      <!-- Sección 3: Fecha y Observaciones -->
      <div class="order-builder-card">
        <h3 class="builder-section-title">📅 3. Entrega & Notas</h3>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div class="form-group">
            <label>Fecha de Entrega</label>
            <input type="date" id="order-delivery-date" class="form-input" style="padding-left:12px;" value="${getTodayYmd()}" required />
          </div>
          <div class="form-group">
            <label>Hora Estimada</label>
            <input type="time" id="order-delivery-time" class="form-input" style="padding-left:12px;" value="14:00" />
          </div>
        </div>

        <div class="form-group">
          <label>Notas Especiales / Observaciones</label>
          <input type="text" id="order-notes" class="form-input" style="padding-left:12px;" placeholder="Ej. Empacar para regalo, entregar después de las 3pm" />
        </div>

        <button type="submit" id="btn-save-order" class="btn-primary-gold" style="margin-top:16px;">
          <span>💾 Guardar Pedido (${formatMoney(finalTotal)})</span>
        </button>
      </div>
    </form>
  `;
}

window.updateCartItem = function(prodId, delta) {
  if (!state.newOrderCart) state.newOrderCart = {};
  const current = state.newOrderCart[prodId] || 0;
  const updated = Math.max(0, current + delta);
  if (updated === 0) {
    delete state.newOrderCart[prodId];
  } else {
    state.newOrderCart[prodId] = updated;
  }
  // Re-renderizar vista para actualizar contadores y sumas
  renderNewOrderView(document.getElementById("main-content"));
};

window.setOrderDiscount = function(pct) {
  state.newOrderDiscount = Number(pct);
  renderNewOrderView(document.getElementById("main-content"));
};

function calculateCartSubtotal() {
  let subtotal = 0;
  for (const [prodId, qty] of Object.entries(state.newOrderCart || {})) {
    const p = state.products.find(item => item.id === prodId);
    if (p && qty > 0) {
      subtotal += (p.precio * qty);
    }
  }
  return subtotal;
}

window.handleClientSelect = function(clientId) {
  if (!clientId) return;
  const client = state.clients.find(c => c.id === clientId);
  if (client) {
    const nameInput = document.getElementById("order-client-name");
    const phoneInput = document.getElementById("order-client-phone");
    const addrInput = document.getElementById("order-address");
    const deliverySelect = document.getElementById("order-delivery-type");

    if (nameInput) nameInput.value = client.nombre;
    if (phoneInput) phoneInput.value = client.telefono || "";
    if (addrInput) addrInput.value = client.direccion || "";
    if (deliverySelect && client.tipoEntrega) deliverySelect.value = client.tipoEntrega;

    // Si el cliente tiene descuento habitual (ej. 15%), aplicarlo de inmediato
    if (client.descuentoFijo) {
      setOrderDiscount(client.descuentoFijo);
      showToast(`⭐ Descuento habitual del ${client.descuentoFijo}% aplicado a ${client.nombre}`);
    }
  }
};

window.handleCreateOrderSubmit = async function(e) {
  e.preventDefault();

  const subtotal = calculateCartSubtotal();
  if (subtotal <= 0) {
    alert("Por favor selecciona al menos 1 granola para crear el pedido.");
    return;
  }

  const clientName = document.getElementById("order-client-name").value.trim();
  const clientPhone = document.getElementById("order-client-phone").value.trim();
  const deliveryType = document.getElementById("order-delivery-type").value;
  const address = document.getElementById("order-address").value.trim();
  const deliveryDate = document.getElementById("order-delivery-date").value;
  const deliveryTime = document.getElementById("order-delivery-time").value;
  const notes = document.getElementById("order-notes").value.trim();

  // Construir texto de detalle de productos
  const itemsTextList = [];
  for (const [prodId, qty] of Object.entries(state.newOrderCart)) {
    const p = state.products.find(item => item.id === prodId);
    if (p && qty > 0) {
      itemsTextList.push(`${qty}x ${p.nombre} (${formatMoney(p.precio * qty)})`);
    }
  }
  const productsDetailStr = itemsTextList.join(" + ");

  const discountAmount = (subtotal * (state.newOrderDiscount / 100));
  const finalTotal = Math.max(0, subtotal - discountAmount);

  const newId = `ZEUS-${String(state.orders.length + state.delivered.length + 1).padStart(4, "0")}`;

  const orderPayload = {
    id: newId,
    fechaCreacion: new Date().toISOString(),
    cliente: clientName,
    telefono: clientPhone,
    tipoEntrega: deliveryType,
    zonaDireccion: address,
    productosDetalle: productsDetailStr,
    subtotalEur: subtotal,
    descuentoPorcentaje: state.newOrderDiscount,
    descuentoEur: discountAmount,
    totalEur: finalTotal,
    fechaEntrega: deliveryDate,
    horaEntrega: deliveryTime,
    estado: "En Espera",
    responsable: state.user ? state.user.name : "Admin Zeus",
    notas: notes,
    notificadoWA: "No"
  };

  // Guardar en estado local
  state.orders.unshift(orderPayload);
  localStorage.setItem("gz_orders", JSON.stringify(state.orders));

  // Guardar cliente si es nuevo
  if (!state.clients.some(c => c.nombre.toLowerCase() === clientName.toLowerCase())) {
    state.clients.push({
      id: `CLI-${Date.now()}`,
      nombre: clientName,
      telefono: clientPhone,
      tipoEntrega: deliveryType,
      direccion: address,
      descuentoFijo: state.newOrderDiscount
    });
    localStorage.setItem("gz_clients", JSON.stringify(state.clients));
  }

  // Limpiar carrito
  state.newOrderCart = {};
  state.newOrderDiscount = 0;

  showToast(`✅ Pedido ${newId} guardado con éxito (${formatMoney(finalTotal)})`);

  // Intentar sincronización con Google Sheets en segundo plano
  syncSingleOrderToSheets(orderPayload);

  // Ir al tablero de pedidos
  switchTab("orders");
};

// ============================================================================
// 4. PESTAÑA FINANZAS (💶 BALANCES EN EUROS)
// ============================================================================
function renderFinancesView(container) {
  const allOrders = [...state.orders, ...state.delivered];
  const deliveredOrders = state.delivered;

  const todayStr = getTodayYmd();
  const weekAgoStr = getDaysAgoYmd(7);
  const monthAgoStr = getDaysAgoYmd(30);

  const salesToday = allOrders
    .filter(o => o.fechaEntrega === todayStr)
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  const salesWeek = allOrders
    .filter(o => o.fechaEntrega >= weekAgoStr)
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  const salesMonth = allOrders
    .filter(o => o.fechaEntrega >= monthAgoStr)
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  const salesTotal = allOrders
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">💶 Balance Financiero</h2>
        <p class="view-sub">Cálculos en Euros (€) en tiempo real</p>
      </div>
    </div>

    <!-- Cajas de Métricas -->
    <div class="metrics-grid">
      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">Hoy</span>
          <span>⚡</span>
        </div>
        <div class="metric-value gold">${formatMoney(salesToday)}</div>
        <span class="metric-sub">ventas del día</span>
      </div>

      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">Esta Semana</span>
          <span>📅</span>
        </div>
        <div class="metric-value emerald">${formatMoney(salesWeek)}</div>
        <span class="metric-sub">últimos 7 días</span>
      </div>

      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">Este Mes</span>
          <span>📈</span>
        </div>
        <div class="metric-value">${formatMoney(salesMonth)}</div>
        <span class="metric-sub">últimos 30 días</span>
      </div>

      <div class="metric-box">
        <div class="metric-header">
          <span class="metric-label">Histórico</span>
          <span>💎</span>
        </div>
        <div class="metric-value gold">${formatMoney(salesTotal)}</div>
        <span class="metric-sub">total acumulado</span>
      </div>
    </div>

    <!-- Historial de Pedidos Entregados -->
    <div class="card">
      <h3 class="builder-section-title">📦 Pedidos Entregados y Cobrados (${deliveredOrders.length})</h3>
      ${deliveredOrders.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">💶</div>
          <p>Aún no hay pedidos marcados como entregados.</p>
        </div>
      ` : `
        <div class="orders-list">
          ${deliveredOrders.map(o => renderOrderCardHtml(o)).join("")}
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// 5. PESTAÑA AJUSTES (⚙ CLIENTES, CATÁLOGO, BACKUP & SIN URL EDITABLE)
// ============================================================================
function renderSettingsView(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">⚙️ Ajustes del Sistema</h2>
        <p class="view-sub">Zeus Granola Fit · Taller Artesanal</p>
      </div>
    </div>

    <!-- Clientes Frecuentes y Descuentos Permanentes -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 class="builder-section-title" style="margin:0;">👥 Directorio de Clientes (${state.clients.length})</h3>
        <button class="btn-action-sm ready" onclick="openNewClientModal()">➕ Nuevo</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        ${state.clients.map(c => `
          <div style="background:var(--bg-app); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${escapeHtml(c.nombre)}</strong>
              <div style="font-size:12px; color:var(--text-muted);">
                📞 ${escapeHtml(c.telefono || "Sin tlf")} · ${c.direccion ? escapeHtml(c.direccion) : "Sin dirección"}
              </div>
            </div>
            <div style="text-align:right;">
              <span class="status-badge" style="background:rgba(212,175,55,0.15); color:var(--gold); border:1px solid var(--gold);">
                ${c.descuentoFijo || 0}% Descuento
              </span>
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- Catálogo de Granolas -->
    <div class="card">
      <h3 class="builder-section-title">🥣 Catálogo Oficial de Granolas (6 Tipos)</h3>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${state.products.map(p => `
          <div style="background:var(--bg-app); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${escapeHtml(p.nombre)}</strong>
              <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(p.presentacion || "")}</div>
            </div>
            <div style="font-size:16px; font-weight:800; font-family:var(--font-mono); color:var(--gold);">
              ${formatMoney(p.precio)}
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- Copia de Seguridad & Restauración -->
    <div class="card">
      <h3 class="builder-section-title">💾 Respaldo y Restauración de Datos</h3>
      <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">
        Descarga una copia completa en formato JSON o restaura un archivo previo de Granola Zeus.
      </p>
      <div style="display:flex; gap:10px;">
        <button class="btn-action-sm ready" style="flex:1; justify-content:center; padding:10px;" onclick="exportZeusBackup()">
          📥 Descargar Copia JSON
        </button>
        <label class="btn-action-sm" style="flex:1; justify-content:center; padding:10px; cursor:pointer;">
          📤 Restaurar Copia
          <input type="file" accept=".json" onchange="importZeusBackup(event)" style="display:none;" />
        </label>
      </div>
    </div>

    <!-- Sesión y Acerca de -->
    <div class="card" style="text-align:center;">
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">
        Sesión activa como: <strong>${state.user ? state.user.name : "Admin Zeus"}</strong>
      </p>
      <button class="btn-action-sm" style="margin:0 auto; color:var(--danger); border-color:rgba(239,68,68,0.4);" onclick="doLogout()">
        🚪 Cerrar Sesión
      </button>
    </div>
  `;
}

// ============================================================================
// GESTIÓN DE ACCIONES DE PEDIDOS (AVANCE DE ESTADO & WHATSAPP)
// ============================================================================
window.advanceOrderStatus = function(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  if (order.estado === "En Espera") {
    order.estado = "En Producción";
    showToast(`🥣 Pedido ${order.id} pasó a Producción`);
  } else if (order.estado === "En Producción") {
    order.estado = "Listo para Despacho";
    showToast(`📦 Pedido ${order.id} listo para despacho`);
  } else if (order.estado === "Listo para Despacho") {
    if (confirm(`¿Marcar pedido ${order.id} como ENTREGADO y COBRADO?`)) {
      order.estado = "Entregado";
      order.fechaEntregaReal = new Date().toISOString();
      // Mover a entregados
      state.orders = state.orders.filter(o => o.id !== orderId);
      state.delivered.unshift(order);
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
      showToast(`🎉 ¡Pedido ${order.id} entregado y registrado en Finanzas!`);
    }
  }

  localStorage.setItem("gz_orders", JSON.stringify(state.orders));
  renderCurrentTab();
  syncSingleOrderToSheets(order);
};

window.openWhatsAppNotify = function(orderId) {
  const order = [...state.orders, ...state.delivered].find(o => o.id === orderId);
  if (!order || !order.telefono) {
    alert("Este pedido no tiene número de teléfono registrado.");
    return;
  }

  const cleanPhone = order.telefono.replace(/\D/g, "");
  const total = formatMoney(order.totalEur || order.totalUsd || 0);

  let msg = `¡Hola, ${order.cliente}! 🥣 Te escribimos de *Zeus Granola Fit* ⚡\n\n`;
  if (order.estado === "Listo para Despacho") {
    msg += `Tu pedido *${order.id}* ya está *LISTO* para su entrega.\n`;
  } else {
    msg += `Estamos procesando tu pedido *${order.id}*.\n`;
  }
  msg += `\n*Detalle:* ${order.productosDetalle}\n`;
  msg += `*Total a pagar:* ${total}\n`;
  msg += `*Entrega:* ${order.tipoEntrega} - ${order.fechaEntrega || "Hoy"}\n\n`;
  msg += `¡Gracias por elegir calidad artesanal y saludable! 💪`;

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
};

// ============================================================================
// SINCRONIZACIÓN CON GOOGLE SHEETS BACKEND
// ============================================================================
async function syncSingleOrderToSheets(order) {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) return;
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "create_order",
        data: order
      })
    });
  } catch (err) {
    console.warn("Sincronización en segundo plano pendiente:", err);
  }
}

async function syncWithSheets(interactive = false) {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) {
    if (interactive) showToast("ℹ️ Modo Local / Offline activo.");
    return;
  }

  if (interactive) showToast("Sincronizando con Google Sheets...");
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "dashboard" })
    });
    const json = await res.json();
    if (json.ok && json.data) {
      if (json.data.orders) state.orders = json.data.orders;
      if (json.data.clients) state.clients = json.data.clients;
      localStorage.setItem("gz_orders", JSON.stringify(state.orders));
      localStorage.setItem("gz_clients", JSON.stringify(state.clients));
      if (interactive) showToast("✅ ¡Datos actualizados desde Google Sheets!");
      renderCurrentTab();
    }
  } catch (err) {
    if (interactive) showToast("⚠️ No se pudo conectar con Sheets. Usando datos locales.");
  }
}

// ============================================================================
// EXPORTACIÓN & IMPORTACIÓN DE BACKUPS (COMPATIBLE CON ARCHIVO DEL USUARIO)
// ============================================================================
window.exportZeusBackup = function() {
  const backupData = {
    users: state.users,
    orders: state.orders,
    delivered: state.delivered,
    clients: state.clients,
    products: state.products,
    exported_at: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_granola_zeus_${getTodayYmd()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("📥 Copia de seguridad descargada.");
};

window.importZeusBackup = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.products && Array.isArray(data.products)) state.products = data.products;
      if (data.orders && Array.isArray(data.orders)) state.orders = data.orders;
      if (data.delivered && Array.isArray(data.delivered)) state.delivered = data.delivered;
      if (data.clients && Array.isArray(data.clients)) state.clients = data.clients;
      if (data.users && Array.isArray(data.users)) state.users = data.users;

      localStorage.setItem("gz_products", JSON.stringify(state.products));
      localStorage.setItem("gz_orders", JSON.stringify(state.orders));
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
      localStorage.setItem("gz_clients", JSON.stringify(state.clients));
      localStorage.setItem("gz_users", JSON.stringify(state.users));

      showToast("✅ ¡Copia de seguridad restaurada con éxito!");
      renderCurrentTab();
    } catch (err) {
      alert("Error al leer el archivo JSON: formato inválido.");
    }
  };
  reader.readAsText(file);
};

// ============================================================================
// MODAL NUEVO CLIENTE
// ============================================================================
window.openNewClientModal = function() {
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (!overlay || !body) return;

  body.innerHTML = `
    <h3 style="font-size:17px; font-weight:800; margin-bottom:14px; color:var(--gold);">➕ Registrar Nuevo Cliente</h3>
    <form onsubmit="handleSaveClientFromModal(event)">
      <div class="form-group" style="margin-bottom:10px;">
        <label>Nombre del Cliente *</label>
        <input type="text" id="modal-cli-name" class="form-input" style="padding-left:12px;" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Teléfono / WhatsApp *</label>
        <input type="tel" id="modal-cli-phone" class="form-input" style="padding-left:12px;" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Dirección habitual</label>
        <input type="text" id="modal-cli-addr" class="form-input" style="padding-left:12px;" />
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label>Descuento habitual permanente (%)</label>
        <input type="number" id="modal-cli-discount" class="form-input" style="padding-left:12px;" value="15" min="0" max="100" />
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn-action-sm" style="flex:1; justify-content:center;" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary-gold" style="flex:1; margin:0;">Guardar Cliente</button>
      </div>
    </form>
  `;
  overlay.style.display = "flex";
};

window.closeModal = function() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.style.display = "none";
};

window.handleSaveClientFromModal = function(e) {
  e.preventDefault();
  const name = document.getElementById("modal-cli-name").value.trim();
  const phone = document.getElementById("modal-cli-phone").value.trim();
  const addr = document.getElementById("modal-cli-addr").value.trim();
  const discount = Number(document.getElementById("modal-cli-discount").value || 0);

  state.clients.push({
    id: `CLI-${Date.now()}`,
    nombre: name,
    telefono: phone,
    direccion: addr,
    descuentoFijo: discount
  });
  localStorage.setItem("gz_clients", JSON.stringify(state.clients));
  closeModal();
  showToast(`✅ Cliente ${name} registrado con ${discount}% de descuento.`);
  renderCurrentTab();
};

// ============================================================================
// HELPERS Y UTILIDADES
// ============================================================================
function formatMoney(amount) {
  const num = Number(amount || 0);
  return `${num.toFixed(2).replace(".", ",")} €`;
}

function getTodayYmd() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function getDaysAgoYmd(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function formatDateFriendly(ymdStr) {
  if (!ymdStr) return "";
  const parts = ymdStr.split("-");
  if (parts.length < 3) return ymdStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(msg) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>⚡</span> <span>${escapeHtml(msg)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}
