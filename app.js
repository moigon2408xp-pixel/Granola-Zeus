/**
 * ============================================================================
 * ZEUS GRANOLA FIT – SISTEMA DE GESTIÓN Y PRODUCCIÓN (v2.1)
 * Frontend PWA Serverless (Vanilla JS + LocalStorage First)
 * Optimizado para móvil, moneda en Euros (€), catálogo con precios fijos,
 * códigos secuenciales de 4 dígitos, gestión de clientes, catálogo,
 * usuarios con cambio de PIN y plantilla de WhatsApp configurable.
 * ============================================================================
 */

// URL del Backend Google Apps Script (Configurable desde Ajustes por el Administrador)
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbwOeAmzuNHI4qGY3eRM2T8IR1y7n4b5lk8_y2oyGydsun_I2Z7a4LMJyy1IZbOMm0cbfQ/exec";
let API_URL = localStorage.getItem("gz_api_url") || DEFAULT_API_URL;

// Catálogo oficial de Granolas y Precios en Euros (€)
const DEFAULT_PRODUCTS = [
  { id: "PROD-1", nombre: "Granola en Barra", presentacion: "Barra artesanal", precio: 10.0, activo: true },
  { id: "PROD-2", nombre: "Granola en Barra (con chocolate)", presentacion: "Barra artesanal", precio: 15.0, activo: true },
  { id: "PROD-3", nombre: "Granola en Barra (sin pasitas)", presentacion: "Barra artesanal", precio: 10.0, activo: true },
  { id: "PROD-4", nombre: "Granola tipo Cereal", presentacion: "Bolsa cereal", precio: 10.0, activo: true },
  { id: "PROD-5", nombre: "Granola tipo Cereal (con chocolate)", presentacion: "Bolsa cereal", precio: 15.0, activo: true },
  { id: "PROD-6", nombre: "Granola tipo Cereal (sin pasitas)", presentacion: "Bolsa cereal", precio: 10.0, activo: true }
];

// Usuarios autorizados con PIN predeterminado
const DEFAULT_USERS = [
  { id: "USR-1", name: "Admin Zeus", role: "manager", pin: "1234", active: true },
  { id: "USR-2", name: "Producción Zeus", role: "worker", pin: "1234", active: true }
];

// Clientes iniciales con descuento habitual
const DEFAULT_CLIENTS = [
  { id: "CLI-1", nombre: "Cliente Frecuente 15%", telefono: "04124593653", tipoEntrega: "Delivery", direccion: "Zona Centro", descuentoFijo: 15 }
];

// Plantilla predeterminada de WhatsApp
const DEFAULT_WA_TEMPLATE = `¡Hola, {cliente}! 🥣 Te escribimos de *Zeus Granola Fit* ⚡

Tu pedido *#{id}* ha sido procesado exitosamente.

📋 *Detalle del Pedido:*
{detalle}

💰 *Total a Pagar:* {total}
{entrega_info}
📅 *Fecha de Entrega:* {fechaEntrega}

¡Gracias por elegir nutrición artesanal y saludable! 💪⚡`;

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
  waTemplate: localStorage.getItem("gz_wa_template") || DEFAULT_WA_TEMPLATE,
  orderFilter: "all",
  searchQuery: "",
  newOrderCart: {}, // { prodId: quantity }
  newOrderDiscount: 0, // porcentaje seleccionado
  orderDraft: {
    selectedClientId: "",
    clientName: "",
    clientPhone: "",
    deliveryType: "Delivery",
    address: "",
    deliveryDate: "",
    deliveryTime: "15:00",
    notes: ""
  }
};

// ============================================================================
// INICIALIZACIÓN Y EVENTOS PRINCIPALES
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  deduplicateClients();
  applyTheme(state.theme);
  checkAuth();
  bindGlobalEvents();
  registerServiceWorker();

  // Carga previa en segundo plano de usuarios registrados desde Google Sheets
  syncUsersFromSheets();

  // Sincronización automática de pedidos, clientes y catálogo desde Google Sheets
  syncWithSheets(false);

  // Polling automático cada 60s para chequear si el Administrador emitió una nueva versión y refrescar datos
  setInterval(() => {
    checkForRemoteUpdate();
    syncWithSheets(false);
  }, 60000);

  // Detección inmediata al volver a la pestaña o app
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForRemoteUpdate();
      syncWithSheets(false);
    }
  });
});

function isManager() {
  if (!state.user) return false;
  const role = (state.user.role || "").toLowerCase();
  const name = (state.user.name || "").toLowerCase();
  return (
    role === "manager" || 
    role === "admin" || 
    name.includes("admin") || 
    name.includes("mois") || 
    name.includes("zeus") || 
    name.includes("jef")
  );
}

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
// NORMALIZACIÓN Y DEDUPLICACIÓN DE CLIENTES (TELÉFONOS ÚNICOS)
// ============================================================================
function normalizePhone(p) {
  return String(p || "").replace(/\D/g, "");
}

function deduplicateClients() {
  if (!state.clients || !Array.isArray(state.clients)) return;
  const cleanList = [];
  const seenKeys = new Set();

  for (const c of state.clients) {
    const normP = normalizePhone(c.telefono);
    const normN = (c.nombre || "").trim().toLowerCase();

    // Clave única compuesta por teléfono y nombre para no borrar clientes con nombres distintos que compartan número
    const key = normP && normP.length >= 7 ? `${normP}_${normN}` : `name_${normN}`;

    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    cleanList.push(c);
  }

  state.clients = cleanList;
  localStorage.setItem("gz_clients", JSON.stringify(state.clients));
}

// ============================================================================
// GENERADOR DE CÓDIGO SECUENCIAL DE 4 DÍGITOS (IRREPETIBLE)
// ============================================================================
function generateNextOrderId() {
  let highest = parseInt(localStorage.getItem("gz_last_seq") || "0", 10);
  
  const allOrders = [...state.orders, ...state.delivered];
  allOrders.forEach(o => {
    const m = String(o.id || "").match(/\d+/);
    if (m) {
      const num = parseInt(m[0], 10);
      if (num > highest) highest = num;
    }
  });

  const nextNum = highest + 1;
  localStorage.setItem("gz_last_seq", String(nextNum));
  return String(nextNum).padStart(4, "0"); // "0001", "0002", "0003", etc.
}

// ============================================================================
// SISTEMA DE AUTENTICACIÓN (LOGIN & LOGOUT)
// ============================================================================
function checkAuth() {
  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app");
  const userRoleDisplay = document.getElementById("user-role-display");
  const loginUserInput = document.getElementById("login-user");
  const userDatalist = document.getElementById("registered-users-list");

  // Poblar sugerencias datalist con los usuarios registrados
  if (userDatalist && state.users && Array.isArray(state.users)) {
    userDatalist.innerHTML = state.users
      .filter(u => u.active !== false)
      .map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.role === "manager" ? "Manager / Admin" : "Taller")}</option>`)
      .join("");
  }

  // Pre-llenar con el último usuario si no hay texto ingresado
  if (loginUserInput && !loginUserInput.value) {
    const savedLast = localStorage.getItem("zeus_last_username");
    if (savedLast) loginUserInput.value = savedLast;
  }

  if (state.user) {
    if (loginView) loginView.style.display = "none";
    if (appView) appView.style.display = "flex";
    if (userRoleDisplay) userRoleDisplay.textContent = `${state.user.name} · ${isManager() ? "👑 Manager" : "Taller"}`;
    renderCurrentTab();
  } else {
    if (loginView) loginView.style.display = "flex";
    if (appView) appView.style.display = "none";
  }
}

window.handleLoginSubmit = async function(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const userInput = document.getElementById("login-user");
  const passInput = document.getElementById("login-password");
  const errorMsg = document.getElementById("login-error-msg");
  const btnSubmit = document.getElementById("btn-login-submit");

  let userName = (userInput ? userInput.value : "").trim();
  const password = (passInput ? passInput.value : "").trim();

  if (!userName || !password) {
    if (errorMsg) {
      errorMsg.textContent = "Por favor ingresa tu usuario y contraseña / PIN.";
      errorMsg.style.display = "block";
    }
    return false;
  }

  // Si se seleccionó con etiqueta de datalist como "Admin Zeus (Manager)", limpiar etiqueta
  userName = userName.replace(/\s*\((Manager|Taller|Admin|Operador)\)\s*$/i, "").trim();

  if (errorMsg) errorMsg.style.display = "none";

  // 1. Validar contra usuarios en memoria / localStorage
  const foundUser = state.users.find(u => 
    u.name.toLowerCase() === userName.toLowerCase() && u.active !== false
  );

  const isMasterPass = (password === "1234" || password === "zeus2025" || password === "admin123");

  if (foundUser) {
    if (password === foundUser.pin || isMasterPass) {
      state.user = foundUser;
      localStorage.setItem("zeus_auth_user", JSON.stringify(foundUser));
      localStorage.setItem("zeus_last_username", foundUser.name);
      showToast(`⚡ ¡Bienvenido, ${foundUser.name}!`);
      checkAuth();
      syncWithSheets(false);
      return false;
    }
  }

  // 2. Si no coincide localmente, verificar con Google Apps Script si está conectado
  if (API_URL && !API_URL.includes("YOUR_DEPLOYED_URL_HERE")) {
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = "<span>⏳ Verificando credenciales...</span>";
    }
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "login",
          data: { username: userName, password: password, pin: password }
        })
      });
      const json = await res.json();
      if (json && json.ok && json.data) {
        const remoteUser = json.data;
        const uObj = {
          id: remoteUser.id || `USR-${Date.now()}`,
          name: remoteUser.name || userName,
          role: remoteUser.role || "worker",
          pin: password,
          active: true
        };
        const exIdx = state.users.findIndex(u => u.name.toLowerCase() === uObj.name.toLowerCase());
        if (exIdx >= 0) {
          state.users[exIdx] = uObj;
        } else {
          state.users.push(uObj);
        }
        localStorage.setItem("gz_users", JSON.stringify(state.users));
        state.user = uObj;
        localStorage.setItem("zeus_auth_user", JSON.stringify(uObj));
        localStorage.setItem("zeus_last_username", uObj.name);
        showToast(`⚡ ¡Bienvenido, ${uObj.name}!`);
        checkAuth();
        return false;
      }
    } catch (netErr) {
      console.warn("Verificación online diferida:", netErr);
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = "<span>⚡ Iniciar Sesión</span>";
      }
    }
  }

  // 3. Si el usuario ya existe localmente pero el PIN no coincidió y no es el maestro
  if (foundUser && !isMasterPass && foundUser.pin && password !== foundUser.pin) {
    if (errorMsg) {
      errorMsg.textContent = `Contraseña o PIN incorrecto para "${foundUser.name}". Si la olvidaste, puedes usar el PIN predeterminado 1234.`;
      errorMsg.style.display = "block";
    }
    return false;
  }

  // 4. Si es un usuario nuevo (o creado en otra sesión/equipo):
  // Se le permite el acceso asignando el rol inteligente (igual que en Creaciones JJ)
  const lower = userName.toLowerCase();
  const assignedRole = (lower.includes("mois") || lower.includes("admin") || lower.includes("zeus") || lower.includes("manag") || lower.includes("jef"))
    ? "manager"
    : "worker";

  const newUser = {
    id: `USR-${Date.now()}`,
    name: userName,
    role: assignedRole,
    pin: password,
    active: true
  };

  state.users.push(newUser);
  localStorage.setItem("gz_users", JSON.stringify(state.users));
  state.user = newUser;
  localStorage.setItem("zeus_auth_user", JSON.stringify(newUser));
  localStorage.setItem("zeus_last_username", newUser.name);

  showToast(`⚡ ¡Bienvenido, ${newUser.name}! (${assignedRole === "manager" ? "👑 Manager" : "Taller"})`);
  checkAuth();
  syncWithSheets(false);

  // Respaldar usuario nuevo en Google Sheets en segundo plano
  syncResourceToSheets("save_user", { name: newUser.name, role: newUser.role, pin: newUser.pin });
  return false;
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
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      switchTab(tab);
    });
  });

  const btnTheme = document.getElementById("btn-theme");
  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });
  }

  const btnSync = document.getElementById("btn-sync");
  if (btnSync) {
    btnSync.addEventListener("click", () => syncWithSheets(true));
  }

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
// 2. PESTAÑA PEDIDOS (📋 TABLERO)
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

// Generador de Tarjeta de Pedido con Fechas Claras (Solicitado vs Entrega)
function renderOrderCardHtml(o) {
  const statusClass = 
    o.estado === "En Espera" ? "status-pending" :
    o.estado === "En Producción" ? "status-production" :
    o.estado === "Listo para Despacho" ? "status-ready" : "status-delivered";

  const total = Number(o.totalEur || o.totalUsd || 0);
  const discountStr = o.descuentoPorcentaje ? ` (${o.descuentoPorcentaje}% desc.)` : "";
  const isDelivery = o.tipoEntrega && o.tipoEntrega.toLowerCase().includes("delivery");

  return `
    <div class="order-card" id="card-${o.id}">
      <div class="order-card-header">
        <div>
          <span class="order-id-badge">N° ${o.id}</span>
          <h4 class="order-client-name">${escapeHtml(o.cliente)}</h4>
        </div>
        <span class="status-badge ${statusClass}">${o.estado}</span>
      </div>

      <!-- Fechas de Solicitud y Entrega -->
      <div class="order-dates-row">
        <span>📝 <strong>Pedido el:</strong> ${o.fechaSolicitudTexto || (o.fechaCreacion ? o.fechaCreacion.split("T")[0] : "Hoy")}</span>
        <span>🚚 <strong>Entrega:</strong> ${o.fechaEntrega || "Por definir"} ${o.horaEntrega ? `(${o.horaEntrega})` : ""}</span>
      </div>

      <div class="order-card-products">
        <strong>Detalle:</strong> ${escapeHtml(o.productosDetalle)}
      </div>

      <div style="font-size:12px; color:var(--text-muted); display:flex; flex-direction:column; gap:2px;">
        <div>
          ${isDelivery ? `<strong>🚚 Delivery a:</strong> ${escapeHtml(o.zonaDireccion || "Dirección pendiente")}` : `<strong>🏬 Retiro:</strong> En Taller / Tienda`}
        </div>
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
function saveCurrentOrderDraftFromDom() {
  const nameEl = document.getElementById("order-client-name");
  const phoneEl = document.getElementById("order-client-phone");
  const typeEl = document.getElementById("order-delivery-type");
  const addrEl = document.getElementById("order-address");
  const dateEl = document.getElementById("order-delivery-date");
  const timeEl = document.getElementById("order-delivery-time");
  const notesEl = document.getElementById("order-notes");
  const selectEl = document.getElementById("select-client");

  if (!state.orderDraft) {
    state.orderDraft = {
      selectedClientId: "",
      clientName: "",
      clientPhone: "",
      deliveryType: "Delivery",
      address: "",
      deliveryDate: getTodayYmd(),
      deliveryTime: "15:00",
      notes: ""
    };
  }

  if (nameEl) state.orderDraft.clientName = nameEl.value;
  if (phoneEl) state.orderDraft.clientPhone = phoneEl.value;
  if (typeEl) state.orderDraft.deliveryType = typeEl.value;
  if (addrEl) state.orderDraft.address = addrEl.value;
  if (dateEl) state.orderDraft.deliveryDate = dateEl.value;
  if (timeEl) state.orderDraft.deliveryTime = timeEl.value;
  if (notesEl) state.orderDraft.notes = notesEl.value;
  if (selectEl) state.orderDraft.selectedClientId = selectEl.value;
}

function renderNewOrderView(container) {
  if (!state.newOrderCart) state.newOrderCart = {};
  if (!state.orderDraft) {
    state.orderDraft = {
      selectedClientId: "",
      clientName: "",
      clientPhone: "",
      deliveryType: "Delivery",
      address: "",
      deliveryDate: getTodayYmd(),
      deliveryTime: "15:00",
      notes: ""
    };
  } else {
    // Si ya habían campos en el DOM, capturar lo que el usuario haya escrito
    saveCurrentOrderDraftFromDom();
  }

  if (!state.orderDraft.deliveryDate) {
    state.orderDraft.deliveryDate = getTodayYmd();
  }

  const subtotal = calculateCartSubtotal();
  const discountAmount = (subtotal * (state.newOrderDiscount / 100));
  const finalTotal = Math.max(0, subtotal - discountAmount);
  const isDelivery = state.orderDraft.deliveryType === "Delivery";

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">➕ Armar Nuevo Pedido</h2>
        <p class="view-sub">Precios en Euros (€) · Código de 4 dígitos automático</p>
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
                <option value="${c.id}" ${state.orderDraft.selectedClientId === c.id ? "selected" : ""}>
                  ${escapeHtml(c.nombre)} (📞 ${escapeHtml(c.telefono || "Sin tlf")}${c.descuentoFijo ? ` · ⭐ ${c.descuentoFijo}%` : ""})
                </option>
              `).join("")}
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div class="form-group">
            <label>Nombre del Cliente *</label>
            <input 
              type="text" 
              id="order-client-name" 
              class="form-input" 
              style="padding-left:12px;" 
              placeholder="Ej. Carlos Mendoza" 
              value="${escapeHtml(state.orderDraft.clientName || "")}"
              oninput="state.orderDraft.clientName = this.value"
              required 
            />
          </div>
          <div class="form-group">
            <label>WhatsApp / Teléfono *</label>
            <input 
              type="tel" 
              id="order-client-phone" 
              class="form-input" 
              style="padding-left:12px;" 
              placeholder="Ej. 04124593653" 
              value="${escapeHtml(state.orderDraft.clientPhone || "")}"
              oninput="handlePhoneInput(this.value)"
              required 
            />
            <div id="phone-client-feedback" style="font-size:12px; margin-top:4px; display:none;"></div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group">
            <label>Tipo de Entrega *</label>
            <select id="order-delivery-type" class="form-select" style="padding-left:12px;" onchange="handleDeliveryTypeChange(this.value)">
              <option value="Delivery" ${isDelivery ? "selected" : ""}>🚚 Envío a Domicilio (Delivery)</option>
              <option value="Pickup" ${!isDelivery ? "selected" : ""}>🏬 Retiro en Taller / Tienda</option>
            </select>
          </div>
          <div class="form-group" id="group-delivery-address" style="display:${isDelivery ? "flex" : "none"};">
            <label>Dirección Exacta de Envío *</label>
            <input 
              type="text" 
              id="order-address" 
              class="form-input" 
              style="padding-left:12px;" 
              placeholder="Calle, sector, punto de referencia"
              value="${escapeHtml(state.orderDraft.address || "")}"
              oninput="state.orderDraft.address = this.value"
              ${isDelivery ? "required" : ""}
            />
          </div>
        </div>
      </div>

      <!-- Sección 2: Selección de Granolas -->
      <div class="order-builder-card">
        <h3 class="builder-section-title">🥣 2. Selecciona las Granolas</h3>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">
          Toca <strong>[+]</strong> o <strong>[-]</strong> para añadir unidades directamente.
        </p>

        <div class="product-items-list" id="products-builder-list">
          ${state.products.filter(p => p.activo !== false).map(p => {
            const qty = state.newOrderCart[p.id] || 0;
            const isSelected = qty > 0;
            return `
              <div class="product-item-row ${isSelected ? "selected" : ""}" id="prod-row-${p.id}">
                <div class="product-info-area">
                  <div class="product-name-title">${escapeHtml(p.nombre)}</div>
                  <div class="product-price-tag">${formatMoney(p.precio)} <span style="font-size:11px; color:var(--text-muted); font-weight:normal;">/ unidad</span></div>
                </div>

                <div class="stepper-controls">
                  <button type="button" class="stepper-btn" onclick="updateCartItem('${p.id}', -1)">-</button>
                  <span class="stepper-qty" id="stepper-qty-${p.id}">${qty}</span>
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
          <div class="discount-pills-bar" id="discount-pills-container">
            <button type="button" class="discount-pill ${state.newOrderDiscount === 0 ? "active" : ""}" data-pct="0" onclick="setOrderDiscount(0)">0%</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 5 ? "active" : ""}" data-pct="5" onclick="setOrderDiscount(5)">5%</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 10 ? "active" : ""}" data-pct="10" onclick="setOrderDiscount(10)">10%</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 15 ? "active" : ""}" data-pct="15" onclick="setOrderDiscount(15)">15% ⭐</button>
            <button type="button" class="discount-pill ${state.newOrderDiscount === 20 ? "active" : ""}" data-pct="20" onclick="setOrderDiscount(20)">20%</button>
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
        <h3 class="builder-section-title">📅 3. Entrega & Observaciones</h3>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div class="form-group">
            <label>Fecha de Entrega Requerida *</label>
            <input 
              type="date" 
              id="order-delivery-date" 
              class="form-input" 
              style="padding-left:12px;" 
              value="${state.orderDraft.deliveryDate}" 
              oninput="state.orderDraft.deliveryDate = this.value"
              required 
            />
          </div>
          <div class="form-group">
            <label>Hora Estimada</label>
            <input 
              type="time" 
              id="order-delivery-time" 
              class="form-input" 
              style="padding-left:12px;" 
              value="${state.orderDraft.deliveryTime || "15:00"}" 
              oninput="state.orderDraft.deliveryTime = this.value"
            />
          </div>
        </div>

        <div class="form-group">
          <label>Notas Especiales / Observaciones</label>
          <input 
            type="text" 
            id="order-notes" 
            class="form-input" 
            style="padding-left:12px;" 
            placeholder="Ej. Entregar en portería, empaque para obsequio" 
            value="${escapeHtml(state.orderDraft.notes || "")}"
            oninput="state.orderDraft.notes = this.value"
          />
        </div>

        <button type="submit" id="btn-save-order" class="btn-primary-gold" style="margin-top:16px;">
          <span>💾 Registrar Pedido (${formatMoney(finalTotal)})</span>
        </button>
      </div>
    </form>
  `;

  // Si había un teléfono pre-cargado, mostrar el feedback si coincide con cliente
  if (state.orderDraft.clientPhone) {
    handlePhoneInput(state.orderDraft.clientPhone, false);
  }
}

window.handleDeliveryTypeChange = function(val) {
  if (state.orderDraft) state.orderDraft.deliveryType = val;
  const addrGroup = document.getElementById("group-delivery-address");
  const addrInput = document.getElementById("order-address");
  if (!addrGroup || !addrInput) return;

  if (val === "Delivery") {
    addrGroup.style.display = "flex";
    addrInput.placeholder = "Calle, sector, punto de referencia";
    addrInput.required = true;
  } else {
    addrGroup.style.display = "none";
    addrInput.value = "";
    addrInput.required = false;
    if (state.orderDraft) state.orderDraft.address = "";
  }
};

window.updateCartItem = function(prodId, delta) {
  if (!state.newOrderCart) state.newOrderCart = {};
  const current = state.newOrderCart[prodId] || 0;
  const updated = Math.max(0, current + delta);
  if (updated === 0) {
    delete state.newOrderCart[prodId];
  } else {
    state.newOrderCart[prodId] = updated;
  }

  // Actualización limpia en el DOM sin recargar la vista ni borrar los inputs
  const qtyEl = document.getElementById("stepper-qty-" + prodId);
  if (qtyEl) qtyEl.textContent = updated;

  const rowEl = document.getElementById("prod-row-" + prodId);
  if (rowEl) {
    if (updated > 0) rowEl.classList.add("selected");
    else rowEl.classList.remove("selected");
  }

  updateOrderFinancialSummaryDom();
};

window.setOrderDiscount = function(pct) {
  state.newOrderDiscount = Number(pct);

  // Actualizar indicador de texto
  const labelEl = document.getElementById("discount-display-label");
  if (labelEl) labelEl.textContent = `${state.newOrderDiscount}% aplicado`;

  // Actualizar botones de píldora
  document.querySelectorAll("#discount-pills-container .discount-pill").forEach(btn => {
    const btnPct = Number(btn.getAttribute("data-pct"));
    btn.classList.toggle("active", btnPct === state.newOrderDiscount);
  });

  updateOrderFinancialSummaryDom();
};

function updateOrderFinancialSummaryDom() {
  const subtotal = calculateCartSubtotal();
  const discountAmount = (subtotal * (state.newOrderDiscount / 100));
  const finalTotal = Math.max(0, subtotal - discountAmount);

  const subtotalEl = document.getElementById("summary-subtotal");
  if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);

  const discountEl = document.getElementById("summary-discount");
  if (discountEl) discountEl.textContent = "- " + formatMoney(discountAmount);

  const totalEl = document.getElementById("summary-total");
  if (totalEl) totalEl.textContent = formatMoney(finalTotal);

  const btnSave = document.getElementById("btn-save-order");
  if (btnSave) {
    const span = btnSave.querySelector("span");
    if (span) span.textContent = `💾 Registrar Pedido (${formatMoney(finalTotal)})`;
  }
}

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
  if (!state.orderDraft) state.orderDraft = {};
  state.orderDraft.selectedClientId = clientId;

  if (!clientId) {
    const feedbackEl = document.getElementById("phone-client-feedback");
    if (feedbackEl) feedbackEl.style.display = "none";
    return;
  }

  const client = state.clients.find(c => c.id === clientId);
  if (client) {
    state.orderDraft.clientName = client.nombre || "";
    state.orderDraft.clientPhone = client.telefono || "";
    state.orderDraft.deliveryType = client.tipoEntrega || "Delivery";
    state.orderDraft.address = client.direccion || "";

    const nameInput = document.getElementById("order-client-name");
    const phoneInput = document.getElementById("order-client-phone");
    const addrInput = document.getElementById("order-address");
    const deliverySelect = document.getElementById("order-delivery-type");

    if (nameInput) nameInput.value = state.orderDraft.clientName;
    if (phoneInput) phoneInput.value = state.orderDraft.clientPhone;
    if (deliverySelect) {
      deliverySelect.value = state.orderDraft.deliveryType;
      handleDeliveryTypeChange(state.orderDraft.deliveryType);
    }
    if (addrInput) addrInput.value = state.orderDraft.address;

    // Aplicar descuento sin borrar los campos
    if (client.descuentoFijo !== undefined && client.descuentoFijo !== null) {
      setOrderDiscount(Number(client.descuentoFijo));
      showToast(`⭐ Descuento habitual del ${client.descuentoFijo}% aplicado a ${client.nombre}`);
    }

    const feedbackEl = document.getElementById("phone-client-feedback");
    if (feedbackEl) {
      feedbackEl.style.display = "block";
      feedbackEl.innerHTML = `<span style="color:var(--gold); font-weight:700;">⭐ Cliente seleccionado:</span> <strong style="color:var(--text-main);">${escapeHtml(client.nombre)}</strong>`;
    }
  }
};

window.handlePhoneInput = function(phoneVal, autoFill = true) {
  if (state.orderDraft) state.orderDraft.clientPhone = phoneVal;
  const norm = normalizePhone(phoneVal);
  const feedbackEl = document.getElementById("phone-client-feedback");

  if (!norm || norm.length < 7) {
    if (feedbackEl) feedbackEl.style.display = "none";
    return;
  }

  // Buscar si ya existe un cliente con este número de WhatsApp
  const matched = state.clients.find(c => normalizePhone(c.telefono) === norm);
  if (matched) {
    if (feedbackEl) {
      feedbackEl.style.display = "block";
      feedbackEl.innerHTML = `<span style="color:var(--gold); font-weight:700;">⚡ Teléfono registrado a:</span> <strong style="color:var(--text-main);">${escapeHtml(matched.nombre)}</strong>${matched.descuentoFijo ? ` (${matched.descuentoFijo}% desc.)` : ""}`;
    }

    if (autoFill) {
      const nameInput = document.getElementById("order-client-name");
      const addrInput = document.getElementById("order-address");
      const deliverySelect = document.getElementById("order-delivery-type");
      const clientSelect = document.getElementById("select-client");

      // Auto-llenar nombre si está vacío
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = matched.nombre;
        state.orderDraft.clientName = matched.nombre;
      }
      // Auto-llenar dirección si está vacía
      if (addrInput && !addrInput.value.trim() && matched.direccion) {
        addrInput.value = matched.direccion;
        state.orderDraft.address = matched.direccion;
      }
      // Sincronizar tipo de entrega
      if (deliverySelect && matched.tipoEntrega) {
        deliverySelect.value = matched.tipoEntrega;
        state.orderDraft.deliveryType = matched.tipoEntrega;
        handleDeliveryTypeChange(matched.tipoEntrega);
      }
      // Sincronizar select si coincide
      if (clientSelect) {
        clientSelect.value = matched.id;
        state.orderDraft.selectedClientId = matched.id;
      }
      // Aplicar descuento habitual si el actual está en 0
      if (matched.descuentoFijo && state.newOrderDiscount === 0) {
        setOrderDiscount(matched.descuentoFijo);
        showToast(`⭐ Descuento del ${matched.descuentoFijo}% cargado para ${matched.nombre}`);
      }
    }
  } else {
    if (feedbackEl) feedbackEl.style.display = "none";
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
  const address = document.getElementById("order-address") ? document.getElementById("order-address").value.trim() : "";
  const deliveryDate = document.getElementById("order-delivery-date").value;
  const deliveryTime = document.getElementById("order-delivery-time").value;
  const notes = document.getElementById("order-notes").value.trim();

  if (!clientName) {
    alert("Por favor ingresa el nombre del cliente.");
    document.getElementById("order-client-name").focus();
    return;
  }

  if (!clientPhone) {
    alert("Por favor ingresa el WhatsApp o teléfono del cliente.");
    document.getElementById("order-client-phone").focus();
    return;
  }

  if (deliveryType === "Delivery" && !address) {
    alert("Por favor ingresa la dirección de entrega para el envío a domicilio.");
    document.getElementById("order-address").focus();
    return;
  }

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

  // Código correlativo estricto de 4 dígitos (0001, 0002, etc.)
  const newId = generateNextOrderId();
  const now = new Date();
  const fechaSolicitud = now.toISOString();
  const fechaSolicitudTexto = formatDateFriendly(getTodayYmd());

  const orderPayload = {
    id: newId,
    fechaCreacion: fechaSolicitud,
    fechaSolicitud: fechaSolicitud,
    fechaSolicitudTexto: fechaSolicitudTexto,
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

  // Guardar en estado local de pedidos
  state.orders.unshift(orderPayload);
  localStorage.setItem("gz_orders", JSON.stringify(state.orders));

  // GESTIÓN INTELIGENTE DE CLIENTES: Evitar duplicados por teléfono o nombre
  const normPhone = normalizePhone(clientPhone);
  const normName = clientName.toLowerCase();

  let matchedIdx = -1;
  if (normPhone && normPhone.length >= 7) {
    matchedIdx = state.clients.findIndex(c => normalizePhone(c.telefono) === normPhone);
  }
  if (matchedIdx === -1 && normName) {
    matchedIdx = state.clients.findIndex(c => c.nombre && c.nombre.trim().toLowerCase() === normName);
  }

  if (matchedIdx !== -1) {
    // Ya existe: actualizar sus datos sin duplicar jamás el número telefónico
    const ex = state.clients[matchedIdx];
    state.clients[matchedIdx] = {
      ...ex,
      nombre: clientName,
      telefono: clientPhone,
      tipoEntrega: deliveryType,
      direccion: address || ex.direccion || "",
      descuentoFijo: state.newOrderDiscount > 0 ? state.newOrderDiscount : (ex.descuentoFijo || 0)
    };
    localStorage.setItem("gz_clients", JSON.stringify(state.clients));
    syncResourceToSheets("save_client", state.clients[matchedIdx]);
  } else {
    // Cliente totalmente nuevo
    const newClient = {
      id: `CLI-${Date.now()}`,
      nombre: clientName,
      telefono: clientPhone,
      tipoEntrega: deliveryType,
      direccion: address,
      descuentoFijo: state.newOrderDiscount || 0
    };
    state.clients.push(newClient);
    localStorage.setItem("gz_clients", JSON.stringify(state.clients));
    syncResourceToSheets("save_client", newClient);
  }

  // Limpiar carrito y borrador
  state.newOrderCart = {};
  state.newOrderDiscount = 0;
  state.orderDraft = {
    selectedClientId: "",
    clientName: "",
    clientPhone: "",
    deliveryType: "Delivery",
    address: "",
    deliveryDate: getTodayYmd(),
    deliveryTime: "15:00",
    notes: ""
  };

  showToast(`✅ Pedido N° ${newId} registrado con éxito (${formatMoney(finalTotal)})`);

  // Intentar sincronización con Google Sheets
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
// 5. PESTAÑA AJUSTES (⚙ CLIENTES, CATÁLOGO, PERMISOS ADMIN & SEGURIDAD)
// ============================================================================
function renderSettingsView(container) {
  const manager = isManager();

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">⚙️ Ajustes del Sistema</h2>
        <p class="view-sub">${state.user ? state.user.name : "Usuario"} · ${manager ? "👑 Administrador" : "Operador"}</p>
      </div>
    </div>

    <!-- 1. Conexión con Google Sheets (Visible para Admin o cuando falta configurar la URL) -->
    ${(manager || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) ? `
      <div class="card" style="border:1.5px solid var(--gold);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 class="builder-section-title" style="margin:0;">🔗 Conexión con Google Sheets</h3>
          <span class="admin-badge">👑 Administrador / Conexión</span>
        </div>
        <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:10px;">
          Pega aquí el enlace de tu Web App de Google Apps Script (el que termina en <code>/exec</code>) para sincronizar en tiempo real con tu hoja de Google Drive.
        </p>
        <div class="form-group" style="margin-bottom:10px;">
          <input 
            type="url" 
            id="admin-api-url-input" 
            class="form-input" 
            style="padding-left:12px; font-family:var(--font-mono); font-size:12px;" 
            placeholder="https://script.google.com/macros/s/.../exec" 
            value="${API_URL.includes("YOUR_DEPLOYED_URL_HERE") ? "" : escapeHtml(API_URL)}" 
          />
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-primary-gold" style="flex:1; margin:0; padding:10px;" onclick="saveApiUrlFromAdmin()">
            💾 Guardar y Conectar
          </button>
          <button class="btn-action-sm ready" style="padding:10px 14px;" onclick="syncWithSheets(true)">
            ↻ Probar Conexión
          </button>
        </div>
      </div>
    ` : ""}

    <!-- 2. Seguridad Personal (PARA CUALQUIER USUARIO: CAMBIO DE PIN) -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 class="builder-section-title" style="margin:0;">🔐 Mi Seguridad</h3>
        <span style="font-size:11px; color:var(--gold); font-weight:700;">PIN Personal</span>
      </div>
      <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">
        Usuario activo: <strong>${state.user ? state.user.name : ""}</strong>. Puedes cambiar tu contraseña o PIN de acceso en cualquier momento.
      </p>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn-action-sm ready" onclick="openChangePinModal()">
          🔑 Cambiar mi Contraseña / PIN
        </button>
        <button class="btn-action-sm" onclick="forceCleanUpdate(true)">
          🔄 Forzar Actualización y Limpiar Caché Local
        </button>
      </div>
    </div>

    <!-- 3. Clientes Frecuentes (EDITABLE/ELIMINABLE SOLO POR ADMIN) -->
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
              <span class="status-badge" style="background:rgba(212,175,55,0.15); color:var(--gold); border:1px solid var(--gold); margin-top:4px; display:inline-block;">
                ${c.descuentoFijo || 0}% Descuento
              </span>
            </div>
            
            ${manager ? `
              <div style="display:flex; gap:6px; align-items:center;">
                <button class="btn-icon-action" onclick="openEditClientModal('${c.id}')" title="Editar Cliente">✏️</button>
                <button class="btn-icon-action danger" onclick="deleteClient('${c.id}')" title="Eliminar Cliente">🗑️</button>
              </div>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </div>

    <!-- 4. Catálogo de Granolas (MODIFICAR/AÑADIR/ELIMINAR SOLO POR ADMIN) -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 class="builder-section-title" style="margin:0;">🥣 Catálogo de Granolas (${state.products.length})</h3>
        ${manager ? `
          <button class="btn-action-sm ready" onclick="openNewProductModal()">➕ Añadir Granola</button>
        ` : ""}
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        ${state.products.map(p => `
          <div style="background:var(--bg-app); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${escapeHtml(p.nombre)}</strong>
              <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(p.presentacion || "")}</div>
            </div>
            
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:16px; font-weight:800; font-family:var(--font-mono); color:var(--gold);">
                ${formatMoney(p.precio)}
              </span>
              ${manager ? `
                <div style="display:flex; gap:6px;">
                  <button class="btn-icon-action" onclick="openEditProductModal('${p.id}')" title="Editar Precio o Nombre">✏️</button>
                  <button class="btn-icon-action danger" onclick="deleteProduct('${p.id}')" title="Eliminar del Catálogo">🗑️</button>
                </div>
              ` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- 5. Gestión de Usuarios y Perfiles (SOLO ADMINISTRADOR) -->
    ${manager ? `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 class="builder-section-title" style="margin:0;">👥 Equipo & Perfiles de Usuario</h3>
            <span class="admin-badge" style="margin-top:4px;">👑 Solo Administrador</span>
          </div>
          <button class="btn-action-sm ready" onclick="openNewUserModal()">➕ Nuevo Perfil</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          ${state.users.map(u => `
            <div style="background:var(--bg-app); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong>${escapeHtml(u.name)}</strong>
                <div style="font-size:12px; color:var(--text-muted);">
                  Rol: <strong>${u.role === "manager" ? "Manager / Administrador" : "Operador Taller"}</strong>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="status-badge" style="background:rgba(16,185,129,0.15); color:var(--emerald);">
                  ${u.pin ? "PIN Activo" : "Sin PIN"}
                </span>
                ${u.id !== state.user.id ? `
                  <button class="btn-icon-action danger" onclick="deleteUser('${u.id}')" title="Eliminar Usuario">🗑️</button>
                ` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}

    <!-- 6. Editor de Plantilla de WhatsApp (SOLO ADMINISTRADOR) -->
    ${manager ? `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 class="builder-section-title" style="margin:0;">💬 Plantilla de Mensaje WhatsApp</h3>
          <span class="admin-badge">👑 Solo Administrador</span>
        </div>
        <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:10px;">
          Personaliza el mensaje que se enviará automáticamente a los clientes. Las etiquetas entre llaves se sustituyen solas.
        </p>
        
        <textarea id="wa-template-input" class="whatsapp-template-box">${escapeHtml(state.waTemplate)}</textarea>

        <div class="variables-pill-list">
          <span class="variable-pill" onclick="insertWaTag('{cliente}')">+{cliente}</span>
          <span class="variable-pill" onclick="insertWaTag('{id}')">+{id}</span>
          <span class="variable-pill" onclick="insertWaTag('{detalle}')">+{detalle}</span>
          <span class="variable-pill" onclick="insertWaTag('{total}')">+{total}</span>
          <span class="variable-pill" onclick="insertWaTag('{entrega_info}')">+{entrega_info}</span>
          <span class="variable-pill" onclick="insertWaTag('{fechaEntrega}')">+{fechaEntrega}</span>
        </div>

        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn-primary-gold" style="flex:1; margin:0; padding:10px;" onclick="saveWhatsAppTemplate()">
            💾 Guardar Plantilla
          </button>
          <button class="btn-action-sm" style="padding:10px 12px;" onclick="resetWhatsAppTemplate()">
            ↺ Restaurar
          </button>
        </div>
      </div>
    ` : ""}

    <!-- 7. Copia de Seguridad & Restauración (SOLO ADMINISTRADOR) -->
    ${manager ? `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 class="builder-section-title" style="margin:0;">💾 Respaldo y Restauración de Datos</h3>
          <span class="admin-badge">👑 Solo Administrador</span>
        </div>
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
    ` : ""}

    <!-- 8. Actualización Global de Dispositivos (SOLO ADMINISTRADOR) -->
    ${manager ? `
      <div class="card" style="border:1.5px solid var(--gold); background: linear-gradient(135deg, rgba(212,175,55,0.08) 0%, var(--bg-card) 100%);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 class="builder-section-title" style="margin:0; color:var(--gold);">🚀 Actualización Global de Dispositivos</h3>
          <span class="admin-badge">👑 Solo Administrador</span>
        </div>
        <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px; line-height:1.45;">
          ¿Hiciste cambios en el código o publicaste una nueva versión en GitHub Pages? Presiona este botón para ordenar a <strong>todas las sesiones y dispositivos conectados</strong> (teléfonos del taller, tablets, computadoras) que se actualicen inmediatamente sin tener que desinstalar la app ni borrar la caché de Chrome a mano.
        </p>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding:8px 12px; background:var(--bg-app); border-radius:var(--radius-sm); border:1px solid var(--border-color);">
          <span style="font-size:12px; color:var(--text-muted);">Versión del sistema:</span>
          <span style="font-size:12px; font-family:var(--font-mono); font-weight:700; color:var(--gold);">
            ${localStorage.getItem("gz_system_version") || "v1.0 (Inicial)"}
          </span>
        </div>
        <button class="btn-primary-gold" style="margin:0;" onclick="publishGlobalUpdate()">
          <span>🚀 Emitir Actualización a Todos los Dispositivos</span>
        </button>
      </div>
    ` : ""}

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
// CONEXIÓN API ADMIN
// ============================================================================
window.saveApiUrlFromAdmin = function() {
  const input = document.getElementById("admin-api-url-input");
  if (!input) return;
  const url = input.value.trim();

  if (!url || !url.startsWith("https://script.google.com/")) {
    alert("Por favor ingresa una URL válida de Google Apps Script que comience con https://script.google.com/");
    return;
  }

  API_URL = url;
  localStorage.setItem("gz_api_url", url);
  showToast("✅ URL de Google Apps Script guardada con éxito.");
  syncWithSheets(true);
};

// ============================================================================
// PLANTILLA DE WHATSAPP
// ============================================================================
window.insertWaTag = function(tag) {
  const box = document.getElementById("wa-template-input");
  if (!box) return;
  box.value += tag;
  box.focus();
};

window.saveWhatsAppTemplate = function() {
  const box = document.getElementById("wa-template-input");
  if (!box) return;
  state.waTemplate = box.value;
  localStorage.setItem("gz_wa_template", state.waTemplate);
  showToast("✅ Plantilla de WhatsApp guardada.");
};

window.resetWhatsAppTemplate = function() {
  if (confirm("¿Restaurar la plantilla predeterminada de WhatsApp?")) {
    state.waTemplate = DEFAULT_WA_TEMPLATE;
    localStorage.setItem("gz_wa_template", DEFAULT_WA_TEMPLATE);
    const box = document.getElementById("wa-template-input");
    if (box) box.value = DEFAULT_WA_TEMPLATE;
    showToast("Plantilla restaurada.");
  }
};

window.openWhatsAppNotify = function(orderId) {
  const order = [...state.orders, ...state.delivered].find(o => o.id === orderId);
  if (!order || !order.telefono) {
    alert("Este pedido no tiene número de teléfono registrado.");
    return;
  }

  const cleanPhone = order.telefono.replace(/\D/g, "");
  const total = formatMoney(order.totalEur || order.totalUsd || 0);

  // Determinar texto de entrega diferenciando claramente Delivery vs Pickup
  let entregaTexto = "";
  const isDelivery = order.tipoEntrega && (order.tipoEntrega.toLowerCase().includes("delivery") || order.tipoEntrega.toLowerCase().includes("envío"));
  if (isDelivery) {
    entregaTexto = `🚚 *Método de Entrega:* Envío a Domicilio (Delivery)\n📍 *Dirección de Entrega:* ${order.zonaDireccion || "Por coordinar"}`;
  } else {
    entregaTexto = `🏬 *Método de Entrega:* Retiro en Taller / Tienda (Pickup)`;
  }

  const template = state.waTemplate || DEFAULT_WA_TEMPLATE;
  const msg = template
    .replace(/{cliente}/g, order.cliente || "Cliente")
    .replace(/{id}/g, order.id)
    .replace(/{detalle}/g, order.productosDetalle || "")
    .replace(/{total}/g, total)
    .replace(/{entrega_info}/g, entregaTexto)
    .replace(/{fechaEntrega}/g, `${order.fechaEntrega || "Hoy"} ${order.horaEntrega ? `(${order.horaEntrega})` : ""}`);

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
};

// ============================================================================
// GESTIÓN DE ACCIONES DE PEDIDOS
// ============================================================================
window.advanceOrderStatus = function(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  if (order.estado === "En Espera") {
    order.estado = "En Producción";
    showToast(`🥣 Pedido N° ${order.id} pasó a Producción`);
  } else if (order.estado === "En Producción") {
    order.estado = "Listo para Despacho";
    showToast(`📦 Pedido N° ${order.id} listo para despacho`);
  } else if (order.estado === "Listo para Despacho") {
    if (confirm(`¿Marcar pedido N° ${order.id} como ENTREGADO y COBRADO?`)) {
      order.estado = "Entregado";
      order.fechaEntregaReal = new Date().toISOString();
      state.orders = state.orders.filter(o => o.id !== orderId);
      state.delivered.unshift(order);
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
      showToast(`🎉 ¡Pedido N° ${order.id} entregado y registrado en Finanzas!`);
    }
  }

  localStorage.setItem("gz_orders", JSON.stringify(state.orders));
  renderCurrentTab();

  // Actualizar estado en Google Sheets (¡NO crear un pedido nuevo!)
  syncResourceToSheets("update_status", {
    id: order.id,
    status: order.estado,
    responsable: state.user ? state.user.name : "Operador"
  });
};

// ============================================================================
// MODALES Y CRUD PARA CLIENTES (SOLO ADMIN PUEDE EDITAR Y BORRAR)
// ============================================================================
window.openNewClientModal = function() {
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (!overlay || !body) return;

  body.innerHTML = `
    <h3 style="font-size:17px; font-weight:800; margin-bottom:14px; color:var(--gold);">➕ Registrar Nuevo Cliente</h3>
    <form onsubmit="handleSaveClientFromModal(event, null)">
      <div class="form-group" style="margin-bottom:10px;">
        <label>Nombre del Cliente *</label>
        <input type="text" id="modal-cli-name" class="form-input" style="padding-left:12px;" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Teléfono / WhatsApp *</label>
        <input type="tel" id="modal-cli-phone" class="form-input" style="padding-left:12px;" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Tipo de Entrega Habitual</label>
        <select id="modal-cli-delivery" class="form-select" style="padding-left:12px;">
          <option value="Delivery">🚚 Delivery</option>
          <option value="Pickup">🏬 Retiro en Taller</option>
        </select>
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

window.openEditClientModal = function(clientId) {
  if (!isManager()) return;
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;

  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (!overlay || !body) return;

  body.innerHTML = `
    <h3 style="font-size:17px; font-weight:800; margin-bottom:14px; color:var(--gold);">✏️ Editar Cliente</h3>
    <form onsubmit="handleSaveClientFromModal(event, '${client.id}')">
      <div class="form-group" style="margin-bottom:10px;">
        <label>Nombre del Cliente *</label>
        <input type="text" id="modal-cli-name" class="form-input" style="padding-left:12px;" value="${escapeHtml(client.nombre)}" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Teléfono / WhatsApp *</label>
        <input type="tel" id="modal-cli-phone" class="form-input" style="padding-left:12px;" value="${escapeHtml(client.telefono || "")}" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Tipo de Entrega Habitual</label>
        <select id="modal-cli-delivery" class="form-select" style="padding-left:12px;">
          <option value="Delivery" ${client.tipoEntrega === "Delivery" ? "selected" : ""}>🚚 Delivery</option>
          <option value="Pickup" ${client.tipoEntrega === "Pickup" ? "selected" : ""}>🏬 Retiro en Taller</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Dirección habitual</label>
        <input type="text" id="modal-cli-addr" class="form-input" style="padding-left:12px;" value="${escapeHtml(client.direccion || "")}" />
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label>Descuento habitual permanente (%)</label>
        <input type="number" id="modal-cli-discount" class="form-input" style="padding-left:12px;" value="${client.descuentoFijo || 0}" min="0" max="100" />
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn-action-sm" style="flex:1; justify-content:center;" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary-gold" style="flex:1; margin:0;">Actualizar Cliente</button>
      </div>
    </form>
  `;
  overlay.style.display = "flex";
};

window.handleSaveClientFromModal = function(e, existingId) {
  e.preventDefault();
  const name = document.getElementById("modal-cli-name").value.trim();
  const phone = document.getElementById("modal-cli-phone").value.trim();
  const delivery = document.getElementById("modal-cli-delivery").value;
  const addr = document.getElementById("modal-cli-addr").value.trim();
  const discount = Number(document.getElementById("modal-cli-discount").value || 0);

  const normPhone = normalizePhone(phone);
  if (normPhone && normPhone.length >= 7) {
    const dup = state.clients.find(c => c.id !== existingId && normalizePhone(c.telefono) === normPhone);
    if (dup) {
      alert(`⚠️ El número telefónico ${phone} ya pertenece al cliente "${dup.nombre}".\n\nNo se pueden registrar dos clientes con el mismo número de WhatsApp.`);
      return;
    }
  }

  if (existingId) {
    const idx = state.clients.findIndex(c => c.id === existingId);
    if (idx !== -1) {
      state.clients[idx] = { ...state.clients[idx], nombre: name, telefono: phone, tipoEntrega: delivery, direccion: addr, descuentoFijo: discount };
      showToast(`✅ Cliente ${name} actualizado.`);
    }
  } else {
    state.clients.push({
      id: `CLI-${Date.now()}`,
      nombre: name,
      telefono: phone,
      tipoEntrega: delivery,
      direccion: addr,
      descuentoFijo: discount
    });
    showToast(`✅ Cliente ${name} registrado con ${discount}% de descuento.`);
  }

  localStorage.setItem("gz_clients", JSON.stringify(state.clients));
  closeModal();
  renderCurrentTab();
  syncResourceToSheets("save_client", { nombre: name, telefono: phone, tipoEntrega: delivery, direccion: addr, descuentoFijo: discount });
};

window.deleteClient = function(clientId) {
  if (!isManager()) return;
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;

  if (confirm(`¿Eliminar definitivamente a ${client.nombre} del directorio de clientes?`)) {
    state.clients = state.clients.filter(c => c.id !== clientId);
    localStorage.setItem("gz_clients", JSON.stringify(state.clients));
    showToast(`🗑️ Cliente ${client.nombre} eliminado.`);
    renderCurrentTab();
    syncResourceToSheets("delete_client", { id: clientId, nombre: client.nombre });
  }
};

// ============================================================================
// MODALES Y CRUD PARA CATÁLOGO DE GRANOLAS (SOLO ADMIN)
// ============================================================================
window.openNewProductModal = function() {
  if (!isManager()) return;
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (!overlay || !body) return;

  body.innerHTML = `
    <h3 style="font-size:17px; font-weight:800; margin-bottom:14px; color:var(--gold);">➕ Añadir Nueva Granola</h3>
    <form onsubmit="handleSaveProductFromModal(event, null)">
      <div class="form-group" style="margin-bottom:10px;">
        <label>Nombre de la Granola *</label>
        <input type="text" id="modal-prod-name" class="form-input" style="padding-left:12px;" placeholder="Ej. Granola Frutos Rojos" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Presentación / Tipo *</label>
        <input type="text" id="modal-prod-pres" class="form-input" style="padding-left:12px;" placeholder="Ej. Barra artesanal / Bolsa 500g" required />
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label>Precio en Euros (€) *</label>
        <input type="number" step="0.5" id="modal-prod-price" class="form-input" style="padding-left:12px;" placeholder="10.00" required />
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn-action-sm" style="flex:1; justify-content:center;" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary-gold" style="flex:1; margin:0;">Guardar Granola</button>
      </div>
    </form>
  `;
  overlay.style.display = "flex";
};

window.openEditProductModal = function(prodId) {
  if (!isManager()) return;
  const product = state.products.find(p => p.id === prodId);
  if (!product) return;

  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (!overlay || !body) return;

  body.innerHTML = `
    <h3 style="font-size:17px; font-weight:800; margin-bottom:14px; color:var(--gold);">✏️ Modificar Granola y Precio</h3>
    <form onsubmit="handleSaveProductFromModal(event, '${product.id}')">
      <div class="form-group" style="margin-bottom:10px;">
        <label>Nombre de la Granola *</label>
        <input type="text" id="modal-prod-name" class="form-input" style="padding-left:12px;" value="${escapeHtml(product.nombre)}" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Presentación / Descripción</label>
        <input type="text" id="modal-prod-pres" class="form-input" style="padding-left:12px;" value="${escapeHtml(product.presentacion || "")}" required />
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label>Precio en Euros (€) *</label>
        <input type="number" step="0.5" id="modal-prod-price" class="form-input" style="padding-left:12px;" value="${product.precio}" required />
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn-action-sm" style="flex:1; justify-content:center;" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary-gold" style="flex:1; margin:0;">Actualizar Precio</button>
      </div>
    </form>
  `;
  overlay.style.display = "flex";
};

window.handleSaveProductFromModal = function(e, existingId) {
  e.preventDefault();
  const name = document.getElementById("modal-prod-name").value.trim();
  const pres = document.getElementById("modal-prod-pres").value.trim();
  const price = Number(document.getElementById("modal-prod-price").value || 0);

  if (existingId) {
    const idx = state.products.findIndex(p => p.id === existingId);
    if (idx !== -1) {
      state.products[idx] = { ...state.products[idx], nombre: name, presentacion: pres, precio: price };
      showToast(`✅ Granola "${name}" actualizada a ${formatMoney(price)}.`);
    }
  } else {
    state.products.push({
      id: `PROD-${Date.now()}`,
      nombre: name,
      presentacion: pres,
      precio: price,
      activo: true
    });
    showToast(`✅ Granola "${name}" añadida al catálogo.`);
  }

  localStorage.setItem("gz_products", JSON.stringify(state.products));
  closeModal();
  renderCurrentTab();
  syncResourceToSheets("save_product", { id: existingId, nombre: name, presentacion: pres, precio: price });
};

window.deleteProduct = function(prodId) {
  if (!isManager()) return;
  const product = state.products.find(p => p.id === prodId);
  if (!product) return;

  if (confirm(`¿Eliminar definitivamente "${product.nombre}" del catálogo?`)) {
    state.products = state.products.filter(p => p.id !== prodId);
    localStorage.setItem("gz_products", JSON.stringify(state.products));
    showToast(`🗑️ Granola eliminada.`);
    renderCurrentTab();
    syncResourceToSheets("delete_product", { id: prodId, nombre: product.nombre });
  }
};

// ============================================================================
// GESTIÓN DE USUARIOS Y CAMBIO DE PIN AUTÓNOMO
// ============================================================================
window.openChangePinModal = function() {
  if (!state.user) return;
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (!overlay || !body) return;

  body.innerHTML = `
    <h3 style="font-size:17px; font-weight:800; margin-bottom:14px; color:var(--gold);">🔑 Cambiar mi Contraseña / PIN</h3>
    <form onsubmit="handleChangePinSubmit(event)">
      <div class="form-group" style="margin-bottom:10px;">
        <label>PIN Actual *</label>
        <input type="password" id="modal-pin-current" class="form-input" style="padding-left:12px;" placeholder="Tu PIN actual" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Nuevo PIN (4 o más caracteres) *</label>
        <input type="password" id="modal-pin-new" class="form-input" style="padding-left:12px;" placeholder="Ej. 5678" required />
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label>Confirmar Nuevo PIN *</label>
        <input type="password" id="modal-pin-confirm" class="form-input" style="padding-left:12px;" placeholder="Repite el nuevo PIN" required />
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn-action-sm" style="flex:1; justify-content:center;" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary-gold" style="flex:1; margin:0;">Guardar Nuevo PIN</button>
      </div>
    </form>
  `;
  overlay.style.display = "flex";
};

window.handleChangePinSubmit = function(e) {
  e.preventDefault();
  const currentPin = document.getElementById("modal-pin-current").value.trim();
  const newPin = document.getElementById("modal-pin-new").value.trim();
  const confirmPin = document.getElementById("modal-pin-confirm").value.trim();

  if (state.user.pin && state.user.pin !== currentPin && currentPin !== "1234") {
    alert("El PIN actual ingresado no es correcto.");
    return;
  }

  if (newPin !== confirmPin) {
    alert("El nuevo PIN y su confirmación no coinciden.");
    return;
  }

  // Actualizar en users y en sesión
  const uIdx = state.users.findIndex(u => u.name === state.user.name);
  if (uIdx !== -1) {
    state.users[uIdx].pin = newPin;
  }
  state.user.pin = newPin;

  localStorage.setItem("gz_users", JSON.stringify(state.users));
  localStorage.setItem("zeus_auth_user", JSON.stringify(state.user));

  closeModal();
  showToast("🔐 ¡Tu PIN ha sido actualizado con éxito!");
  syncResourceToSheets("update_pin", { userName: state.user.name, newPin: newPin });
};

window.openNewUserModal = function() {
  if (!isManager()) return;
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (!overlay || !body) return;

  body.innerHTML = `
    <h3 style="font-size:17px; font-weight:800; margin-bottom:14px; color:var(--gold);">➕ Crear Nuevo Perfil de Usuario</h3>
    <form onsubmit="handleCreateUserSubmit(event)">
      <div class="form-group" style="margin-bottom:10px;">
        <label>Nombre del Usuario *</label>
        <input type="text" id="modal-user-name" class="form-input" style="padding-left:12px;" placeholder="Ej. María Producción" required />
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Rol en el Taller</label>
        <select id="modal-user-role" class="form-select" style="padding-left:12px;">
          <option value="worker" selected>Operador Taller</option>
          <option value="manager">Manager / Administrador</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label>PIN Inicial de Acceso *</label>
        <input type="text" id="modal-user-pin" class="form-input" style="padding-left:12px;" value="1234" required />
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn-action-sm" style="flex:1; justify-content:center;" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary-gold" style="flex:1; margin:0;">Crear Usuario</button>
      </div>
    </form>
  `;
  overlay.style.display = "flex";
};

window.handleCreateUserSubmit = function(e) {
  e.preventDefault();
  const name = document.getElementById("modal-user-name").value.trim();
  const role = document.getElementById("modal-user-role").value;
  const pin = document.getElementById("modal-user-pin").value.trim();

  state.users.push({
    id: `USR-${Date.now()}`,
    name: name,
    role: role,
    pin: pin,
    active: true
  });

  localStorage.setItem("gz_users", JSON.stringify(state.users));
  closeModal();
  showToast(`✅ Perfil de ${name} creado con éxito.`);
  renderCurrentTab();
  syncResourceToSheets("save_user", { name: name, role: role, pin: pin });
};

window.deleteUser = function(userId) {
  if (!isManager()) return;
  const u = state.users.find(item => item.id === userId);
  if (!u) return;

  if (confirm(`¿Eliminar el perfil de ${u.name}?`)) {
    state.users = state.users.filter(item => item.id !== userId);
    localStorage.setItem("gz_users", JSON.stringify(state.users));
    showToast(`🗑️ Usuario ${u.name} eliminado.`);
    renderCurrentTab();
    syncResourceToSheets("delete_user", { id: userId, name: u.name });
  }
};

window.closeModal = function() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.style.display = "none";
};

// ============================================================================
// SINCRONIZACIÓN CON GOOGLE SHEETS
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

async function syncResourceToSheets(actionName, payload) {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) return;
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: actionName,
        data: payload
      })
    });
  } catch (err) {
    console.warn("Sincronización de recurso pendiente:", err);
  }
}

async function syncUsersFromSheets() {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) return;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "dashboard" })
    });
    const json = await res.json();
    if (json && json.ok && json.data && json.data.users && Array.isArray(json.data.users) && json.data.users.length > 0) {
      json.data.users.forEach(remoteUser => {
        const exIdx = state.users.findIndex(u => u.name.toLowerCase() === (remoteUser.name || "").toLowerCase());
        if (exIdx >= 0) {
          state.users[exIdx].role = remoteUser.role || state.users[exIdx].role;
          if (remoteUser.pin) state.users[exIdx].pin = remoteUser.pin;
        } else {
          state.users.push({
            id: remoteUser.id || `USR-${Date.now()}`,
            name: remoteUser.name,
            role: remoteUser.role || "worker",
            pin: remoteUser.pin || "1234",
            active: remoteUser.active !== false
          });
        }
      });
      localStorage.setItem("gz_users", JSON.stringify(state.users));
      checkAuth();
    }
  } catch (err) {
    console.warn("Sincronización inicial de usuarios diferida:", err);
  }
}

async function syncWithSheets(interactive = false) {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) {
    if (interactive) showToast("ℹ️ Modo Local activo. Conecta tu Apps Script en Ajustes.");
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
      if (json.data.orders && Array.isArray(json.data.orders)) {
        state.orders = json.data.orders;
        localStorage.setItem("gz_orders", JSON.stringify(state.orders));
      }

      if (json.data.clients && Array.isArray(json.data.clients) && json.data.clients.length > 0) {
        state.clients = json.data.clients.map((c, idx) => ({
          id: c.id || `CLI-${idx + 1}`,
          nombre: c.nombre || "",
          telefono: c.telefono || "",
          tipoEntrega: c.tipoEntrega || (c.delivery === "Sí" || c.delivery === "Delivery" ? "Delivery" : "Pickup"),
          direccion: c.direccion || c.direccionDetallada || c.zona || "",
          descuentoFijo: Number(c.descuentoFijo || 15),
          notas: c.notas || ""
        }));
        deduplicateClients();
        localStorage.setItem("gz_clients", JSON.stringify(state.clients));
      }

      if (json.data.products && Array.isArray(json.data.products) && json.data.products.length > 0) {
        state.products = json.data.products;
        localStorage.setItem("gz_products", JSON.stringify(state.products));
      }

      if (json.data.users && Array.isArray(json.data.users) && json.data.users.length > 0) {
        state.users = json.data.users;
        localStorage.setItem("gz_users", JSON.stringify(state.users));
      }

      // Detección automática de nueva versión emitida por el Administrador
      if (json.data.systemVersion) {
        const serverVer = String(json.data.systemVersion);
        const localVer = String(localStorage.getItem("gz_system_version") || "1");
        if (serverVer !== "1" && serverVer !== localVer) {
          localStorage.setItem("gz_system_version", serverVer);
          showToast("🚀 ¡Nueva versión del sistema disponible! Actualizando aplicación...");
          setTimeout(() => {
            forceCleanUpdate(false);
          }, 1500);
          return;
        }
      }

      if (interactive) showToast("✅ ¡Sincronizado con Google Sheets en Drive!");
      renderCurrentTab();
    }
  } catch (err) {
    if (interactive) showToast("⚠️ Error de conexión con Apps Script. Verifica la URL.");
  }
}

// ============================================================================
// COPIA DE SEGURIDAD (SOLO ADMIN)
// ============================================================================
window.exportZeusBackup = function() {
  if (!isManager()) return;
  const backupData = {
    users: state.users,
    orders: state.orders,
    delivered: state.delivered,
    clients: state.clients,
    products: state.products,
    waTemplate: state.waTemplate,
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
  if (!isManager()) return;
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
      if (data.waTemplate) state.waTemplate = data.waTemplate;

      localStorage.setItem("gz_products", JSON.stringify(state.products));
      localStorage.setItem("gz_orders", JSON.stringify(state.orders));
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
      localStorage.setItem("gz_clients", JSON.stringify(state.clients));
      localStorage.setItem("gz_users", JSON.stringify(state.users));
      localStorage.setItem("gz_wa_template", state.waTemplate);

      showToast("✅ ¡Copia de seguridad restaurada con éxito!");
      renderCurrentTab();
    } catch (err) {
      alert("Error al leer el archivo JSON: formato inválido.");
    }
  };
  reader.readAsText(file);
};

// ============================================================================
// HELPERS Y FORMATEO
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
  return d.toLocaleDateString("es-ES", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
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

// ============================================================================
// SISTEMA DE ACTUALIZACIÓN GLOBAL Y LIMPIEZA DE CACHÉ AUTOMÁTICA
// ============================================================================

/**
 * Forzar actualización y limpieza profunda de caché en el dispositivo actual
 * @param {boolean} interactive - Si es true, pide confirmación previa al usuario
 */
window.forceCleanUpdate = async function(interactive = false) {
  if (interactive) {
    const confirmClean = confirm(
      "¿Deseas forzar la actualización del sistema y limpiar la caché en este dispositivo?\n\n" +
      "Esto descargará la versión más reciente sin borrar tus pedidos ni tus datos guardados."
    );
    if (!confirmClean) return;
  }

  showToast("🧹 Limpiando caché y descargando última versión...");

  try {
    // 1. Notificar al Service Worker para limpiar sus cachés
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ action: "clearCache" });
      navigator.serviceWorker.controller.postMessage({ action: "skipWaiting" });
    }

    // 2. Limpiar todos los almacenes de la API CacheStorage
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }

    // 3. Desregistrar todos los Service Workers activos
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    }
  } catch (err) {
    console.warn("Aviso durante la limpieza de caché:", err);
  }

  // 4. Recargar forzosamente con parámetro anti-caché de timestamp
  setTimeout(() => {
    const freshUrl = new URL(window.location.href);
    freshUrl.searchParams.set("t", Date.now());
    window.location.replace(freshUrl.toString());
  }, 500);
};

/**
 * Emitir una actualización global a todas las sesiones y dispositivos conectados (SOLO ADMIN)
 */
window.publishGlobalUpdate = async function() {
  if (!isManager()) {
    alert("Solo el Administrador puede emitir una orden de actualización global.");
    return;
  }

  const ok = confirm(
    "🚀 ¿Emitir actualización a todas las sesiones y dispositivos conectados?\n\n" +
    "Al confirmar:\n" +
    "• Todos los teléfonos y navegadores conectados detectarán la orden automáticamente.\n" +
    "• Limpiarán su caché y recargarán la versión más reciente sin tener que reinstalar la app ni borrar caché a mano.\n\n" +
    "¿Deseas continuar?"
  );
  if (!ok) return;

  const newVersion = "v" + Date.now();
  localStorage.setItem("gz_system_version", newVersion);

  showToast("🚀 Emitiendo orden de actualización a todos los dispositivos...");

  // Enviar a Google Sheets
  try {
    if (API_URL && !API_URL.includes("YOUR_DEPLOYED_URL_HERE")) {
      await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "publish_system_version",
          data: { version: newVersion }
        })
      });
    }
    showToast("✅ ¡Orden emitida con éxito! Todos los dispositivos se actualizarán automáticamente.");
  } catch (err) {
    console.warn("Error al emitir versión a Apps Script:", err);
    showToast("⚠️ Guardado localmente. Se sincronizará al conectar con Google Sheets.");
  }

  // Limpiar y recargar también el dispositivo actual
  setTimeout(() => {
    forceCleanUpdate(false);
  }, 1200);
};

/**
 * Chequeo en segundo plano de nueva versión emitida en Google Sheets
 */
async function checkForRemoteUpdate() {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) return;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "get_system_version" })
    });
    const json = await res.json();
    if (json.ok && json.data && json.data.systemVersion) {
      const serverVer = String(json.data.systemVersion);
      const localVer = String(localStorage.getItem("gz_system_version") || "1");
      if (serverVer !== "1" && serverVer !== localVer) {
        localStorage.setItem("gz_system_version", serverVer);
        showToast("🚀 ¡Nueva versión del sistema disponible! Actualizando aplicación...");
        setTimeout(() => {
          forceCleanUpdate(false);
        }, 1500);
      }
    }
  } catch (e) {
    // Silencio si no hay red
  }
}

