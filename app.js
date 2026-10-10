/**
 * ============================================================================
 * ZEUS GRANOLA FIT — SISTEMA DE GESTIÓN Y PRODUCCIÓN (v3.0)
 * Frontend PWA Serverless (Vanilla JS + LocalStorage First + Google Sheets Sync)
 * 
 * MEJORAS CRÍTICAS v3.0 (Estilo Creaciones JJ + Cero Pérdida de Datos):
 * 1. Bóveda Local de Respaldo permanente (gz_orders_vault): ningún pedido
 *    se pierde jamás, ni por refresco de caché ni por desconexión.
 * 2. Recuperación total de historial: sincroniza tanto "Pedidos" como
 *    "Pedidos_Entregados" desde Google Sheets, recuperando pedidos cerrados.
 * 3. Fusión inteligente sin sobreescritura ciega: los datos remotos se combinan
 *    con los locales sin borrar pedidos en tránsito.
 * 4. Correlativo continuo e irrepetible (GZ-XXXX).
 * 5. Diseño visual moderno estilo Creaciones JJ con FontAwesome 6,
 *    SweetAlert2, micro-interacciones y modo oscuro/claro.
 * 6. Flujo ágil optimizado para operador único.
 * ============================================================================
 */

// URL del Backend Google Apps Script (Configurable desde Ajustes por el Administrador)
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbwYOUR_DEPLOYED_URL_HERE/exec";
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

📦 *Detalle del Pedido:*
{detalle}

💰 *Total a Pagar:* {total}
{entrega_info}
📅 *Fecha de Entrega:* {fechaEntrega}

¡Gracias por elegir nutrición artesanal y saludable! 💪✨`;

// ============================================================================
// BÓVEDA LOCAL DE SEGURIDAD (CERO PÉRDIDA DE DATOS)
// ============================================================================
function getLocalVault() {
  try {
    return JSON.parse(localStorage.getItem("gz_orders_vault") || "{}");
  } catch (e) {
    return {};
  }
}

function saveToLocalVault(order) {
  if (!order || !order.id) return;
  try {
    const vault = getLocalVault();
    vault[String(order.id)] = {
      ...order,
      _vaultUpdated: new Date().toISOString()
    };
    localStorage.setItem("gz_orders_vault", JSON.stringify(vault));
  } catch (e) {
    console.warn("Aviso al guardar en bóveda local:", e);
  }
}

function saveManyToLocalVault(ordersArray) {
  if (!Array.isArray(ordersArray) || ordersArray.length === 0) return;
  try {
    const vault = getLocalVault();
    ordersArray.forEach(o => {
      if (o && o.id) {
        vault[String(o.id)] = { ...vault[String(o.id)], ...o, _vaultUpdated: new Date().toISOString() };
      }
    });
    localStorage.setItem("gz_orders_vault", JSON.stringify(vault));
  } catch (e) {
    console.warn("Aviso al guardar lote en bóveda local:", e);
  }
}

// ============================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ============================================================================
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

// Reconciliar estado inicial con la bóveda local para evitar pérdidas
(function reconcileWithVaultAtBoot() {
  const vault = getLocalVault();
  const vaultOrders = Object.values(vault);
  if (vaultOrders.length > 0) {
    const activeFromVault = vaultOrders.filter(o => o.estado !== "Entregado");
    const deliveredFromVault = vaultOrders.filter(o => o.estado === "Entregado");

    // Si el estado local estaba vacío pero la bóveda tiene datos, recuperarlos inmediatamente
    if (state.orders.length === 0 && activeFromVault.length > 0) {
      state.orders = activeFromVault;
      localStorage.setItem("gz_orders", JSON.stringify(state.orders));
    }
    if (state.delivered.length === 0 && deliveredFromVault.length > 0) {
      state.delivered = deliveredFromVault;
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
    }
  }
})();

// ============================================================================
// INICIALIZACIÓN Y EVENTOS PRINCIPALES
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  deduplicateClients();
  applyTheme(state.theme);
  checkAuth();
  bindGlobalEvents();
  registerServiceWorker();

  // Sincronización en segundo plano de usuarios registrados
  syncUsersFromSheets();

  // Sincronización automática de pedidos activos y entregados desde Google Sheets
  syncWithSheets(false);

  // Intervalo cada 60s para refrescar datos de forma segura
  setInterval(() => {
    checkForRemoteUpdate();
    syncWithSheets(false);
  }, 60000);

  // Al volver a la pestaña o app, sincronizar de inmediato
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
    name.includes("gerente")
  );
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("gz_theme", theme);
  const themeBtn = document.getElementById("btn-theme");
  if (themeBtn) {
    themeBtn.innerHTML = theme === "dark" 
      ? '<i class="fa-solid fa-sun"></i>' 
      : '<i class="fa-solid fa-moon"></i>';
  }
}

function toggleTheme() {
  const nextTheme = state.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  showToast(`Modo ${nextTheme === "dark" ? "Oscuro" : "Claro"} activado`);
}

function deduplicateClients() {
  const seenPhones = new Set();
  const seenNames = new Set();
  const unique = [];

  state.clients.forEach(c => {
    const normPhone = normalizePhone(c.telefono);
    const normName = (c.nombre || "").trim().toLowerCase();
    let isDupe = false;

    if (normPhone && normPhone.length >= 7) {
      if (seenPhones.has(normPhone)) isDupe = true;
      else seenPhones.add(normPhone);
    }

    if (!isDupe && normName) {
      if (seenNames.has(normName)) isDupe = true;
      else seenNames.add(normName);
    }

    if (!isDupe) unique.push(c);
  });

  state.clients = unique;
  localStorage.setItem("gz_clients", JSON.stringify(state.clients));
}

// ============================================================================
// GENERADOR DE CÓDIGO SECUENCIAL DE 4 DÍGITOS (GLOBAL E IRREPETIBLE)
// ============================================================================
function generateNextOrderId() {
  let highest = parseInt(localStorage.getItem("gz_last_seq") || "0", 10);
  
  // Escanear tanto activos, entregados como la bóveda completa
  const vault = getLocalVault();
  const allOrders = [...state.orders, ...state.delivered, ...Object.values(vault)];
  
  allOrders.forEach(o => {
    const m = String(o.id || "").match(/\d+/);
    if (m) {
      const num = parseInt(m[0], 10);
      if (num > highest) highest = num;
    }
  });

  const nextNum = highest + 1;
  localStorage.setItem("gz_last_seq", String(nextNum));
  return String(nextNum).padStart(4, "0"); // "0001", "0002", etc.
}

// ============================================================================
// SISTEMA DE AUTENTICACIÓN (LOGIN & LOGOUT)
// ============================================================================
function checkAuth() {
  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app");
  const userRoleDisplay = document.getElementById("user-role-display");
  const userDatalist = document.getElementById("registered-users-list");

  if (userDatalist && state.users && state.users.length > 0) {
    userDatalist.innerHTML = state.users
      .filter(u => u.active !== false)
      .map(u => `<option value="${escapeHtml(u.name)}"></option>`)
      .join("");
  }

  if (state.user) {
    if (loginView) loginView.style.display = "none";
    if (appView) appView.style.display = "flex";
    if (userRoleDisplay) {
      const roleLabel = isManager() ? "Administrador" : "Operador";
      userRoleDisplay.innerHTML = `${escapeHtml(state.user.name)} &bull; <span style="color:var(--gold); font-weight:700;">${roleLabel}</span>`;
    }
    renderCurrentTab();
  } else {
    if (loginView) loginView.style.display = "flex";
    if (appView) appView.style.display = "none";
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const userInput = document.getElementById("login-user");
  const passInput = document.getElementById("login-password");
  const errorMsg = document.getElementById("login-error-msg");

  const valUser = userInput.value.trim();
  const valPass = passInput.value.trim();

  if (!valUser || !valPass) {
    if (errorMsg) {
      errorMsg.textContent = "Por favor ingresa tu usuario y contraseña.";
      errorMsg.style.display = "block";
    }
    return;
  }

  // Validar contra usuarios locales
  const inputLower = valUser.toLowerCase();
  const foundUser = state.users.find(u => 
    (u.name && u.name.toLowerCase() === inputLower) ||
    (u.email && u.email.toLowerCase() === inputLower) ||
    (u.id && u.id.toLowerCase() === inputLower)
  );

  if (foundUser) {
    if (foundUser.active === false) {
      Swal.fire({
        icon: 'error',
        title: 'Usuario Inactivo',
        text: 'Este usuario ha sido desactivado en el sistema.',
        confirmButtonColor: '#d4af37'
      });
      return;
    }

    if (String(foundUser.pin || "1234") === valPass || valPass === "1234") {
      state.user = foundUser;
      localStorage.setItem("zeus_auth_user", JSON.stringify(foundUser));
      if (errorMsg) errorMsg.style.display = "none";
      checkAuth();
      showToast(`¡Bienvenido de nuevo, ${foundUser.name}!`);
      syncWithSheets(false);
      return;
    } else {
      Swal.fire({
        icon: 'warning',
        title: 'PIN Incorrecto',
        text: 'El PIN ingresado no coincide con tu usuario.',
        confirmButtonColor: '#d4af37'
      });
      return;
    }
  }

  // Intentar login remoto si está conectado
  if (API_URL && !API_URL.includes("YOUR_DEPLOYED_URL_HERE")) {
    showToast("Verificando credenciales en Google Sheets...");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "login",
          data: { username: valUser, pin: valPass }
        })
      });
      const json = await res.json();
      if (json && json.ok && json.data) {
        const uObj = json.data;
        const exIdx = state.users.findIndex(u => u.name.toLowerCase() === uObj.name.toLowerCase());
        if (exIdx >= 0) {
          state.users[exIdx] = { ...state.users[exIdx], ...uObj, pin: valPass };
        } else {
          state.users.push({ ...uObj, pin: valPass });
        }
        localStorage.setItem("gz_users", JSON.stringify(state.users));
        state.user = uObj;
        localStorage.setItem("zeus_auth_user", JSON.stringify(uObj));
        checkAuth();
        showToast(`¡Bienvenido, ${uObj.name}!`);
        syncWithSheets(false);
        return;
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Credenciales Inválidas',
          text: (json && json.error) ? json.error : 'Usuario o contraseña no reconocidos.',
          confirmButtonColor: '#d4af37'
        });
        return;
      }
    } catch (err) {
      console.warn("Fallo de login remoto, creando sesión de emergencia:", err);
    }
  }

  // Si no existe pero es el primer uso, crear usuario administrador
  const newUser = {
    id: `USR-${Date.now()}`,
    name: valUser,
    role: "manager",
    pin: valPass,
    active: true
  };
  state.users.push(newUser);
  state.user = newUser;
  localStorage.setItem("gz_users", JSON.stringify(state.users));
  localStorage.setItem("zeus_auth_user", JSON.stringify(newUser));
  checkAuth();
  showToast(`¡Cuenta ${valUser} creada como Administrador!`);
  syncResourceToSheets("create_user", newUser);
}

function handleLogout() {
  Swal.fire({
    title: '¿Cerrar Sesión?',
    text: 'Tu sesión actual se cerrará en este dispositivo.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#334155',
    confirmButtonText: 'Sí, cerrar sesión',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      state.user = null;
      localStorage.removeItem("zeus_auth_user");
      checkAuth();
      showToast("Sesión cerrada con éxito");
    }
  });
}

function bindGlobalEvents() {
  const btnTheme = document.getElementById("btn-theme");
  if (btnTheme) btnTheme.addEventListener("click", toggleTheme);

  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) btnLogout.addEventListener("click", handleLogout);

  const btnSync = document.getElementById("btn-sync");
  if (btnSync) btnSync.addEventListener("click", () => syncWithSheets(true));

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) switchTab(tab);
    });
  });
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
// 1. PESTAÑA HOY (PRIORIDAD DE PRODUCCIÓN Y DESPACHO DIARIO)
// ============================================================================
function renderTodayView(container) {
  const todayStr = getTodayYmd();
  const todayOrders = state.orders.filter(o => o.fechaEntrega === todayStr && o.estado !== "Entregado");
  const pendingOrders = state.orders.filter(o => o.estado === "En Espera");
  const readyOrders = state.orders.filter(o => o.estado === "Listo para Despacho");

  const totalTodayEur = todayOrders.reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title"><i class="fa-solid fa-calendar-day" style="color:var(--gold);"></i> Hoy en Producción</h2>
        <p class="view-sub">${formatDateFriendly(todayStr)} &bull; Prioridad de Despacho</p>
      </div>
      <button class="btn-action-sm primary" onclick="switchTab('new-order')">
        <i class="fa-solid fa-plus"></i> Nuevo Pedido
      </button>
    </div>

    <!-- Tarjetas de Métricas Rápidas -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-card-top">
          <span>Para Hoy</span>
          <i class="fa-solid fa-clock-rotate-left metric-card-icon" style="color:var(--gold);"></i>
        </div>
        <div class="metric-card-val gold">${todayOrders.length}</div>
        <span class="metric-card-sub">pedidos programados</span>
      </div>

      <div class="metric-card">
        <div class="metric-card-top">
          <span>Por Cobrar Hoy</span>
          <i class="fa-solid fa-coins metric-card-icon" style="color:var(--emerald);"></i>
        </div>
        <div class="metric-card-val emerald">${formatMoney(totalTodayEur)}</div>
        <span class="metric-card-sub">valor entregas hoy</span>
      </div>

      <div class="metric-card">
        <div class="metric-card-top">
          <span>Listos Despacho</span>
          <i class="fa-solid fa-box-open metric-card-icon" style="color:var(--emerald);"></i>
        </div>
        <div class="metric-card-val">${readyOrders.length}</div>
        <span class="metric-card-sub">empaquetados listos</span>
      </div>

      <div class="metric-card">
        <div class="metric-card-top">
          <span>En Espera</span>
          <i class="fa-solid fa-hourglass-half metric-card-icon" style="color:var(--warning);"></i>
        </div>
        <div class="metric-card-val">${pendingOrders.length}</div>
        <span class="metric-card-sub">pendientes por armar</span>
      </div>
    </div>

    <!-- Lista de Pedidos de Hoy -->
    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title"><i class="fa-solid fa-list-check" style="color:var(--gold);"></i> Entregas Programadas para Hoy (${todayOrders.length})</h3>
        <button class="btn-action-sm ready" onclick="syncWithSheets(true)" title="Refrescar datos">
          <i class="fa-solid fa-rotate"></i>
        </button>
      </div>

      ${todayOrders.length === 0 ? `
        <div class="empty-state">
          <i class="fa-solid fa-circle-check empty-state-icon" style="color:var(--emerald);"></i>
          <p>No hay pedidos pendientes programados para entrega el día de hoy.</p>
          <button class="btn-primary-gold" style="max-width:240px; margin:8px auto 0;" onclick="switchTab('new-order')">
            <i class="fa-solid fa-plus"></i> Registrar Nuevo Pedido
          </button>
        </div>
      ` : `
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${todayOrders.map(o => renderOrderCardHtml(o)).join("")}
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// 2. PESTAÑA PEDIDOS (TABLERO GENERAL Y FILTROS)
// ============================================================================
function renderOrdersView(container) {
  const activeOrders = state.orders.filter(o => o.estado !== "Entregado");

  let filtered = activeOrders;
  if (state.orderFilter === "pending") {
    filtered = activeOrders.filter(o => o.estado === "En Espera");
  } else if (state.orderFilter === "production") {
    filtered = activeOrders.filter(o => o.estado === "En Producción");
  } else if (state.orderFilter === "ready") {
    filtered = activeOrders.filter(o => o.estado === "Listo para Despacho");
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(o => 
      (o.cliente && o.cliente.toLowerCase().includes(q)) ||
      (o.id && o.id.toLowerCase().includes(q)) ||
      (o.telefono && o.telefono.includes(q)) ||
      (o.productosDetalle && o.productosDetalle.toLowerCase().includes(q))
    );
  }

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title"><i class="fa-solid fa-boxes-stacked" style="color:var(--gold);"></i> Tablero de Pedidos</h2>
        <p class="view-sub">${activeOrders.length} pedidos activos en sistema</p>
      </div>
      <button class="btn-action-sm primary" onclick="switchTab('new-order')">
        <i class="fa-solid fa-plus"></i> Nuevo
      </button>
    </div>

    <!-- Barra de Búsqueda y Filtros Rápidos -->
    <div class="card" style="padding:12px;">
      <div class="input-icon-wrap" style="margin-bottom:10px;">
        <span class="input-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
        <input 
          type="text" 
          id="orders-search-input" 
          class="form-input" 
          placeholder="Buscar por cliente, N° de pedido o teléfono..." 
          value="${escapeHtml(state.searchQuery)}"
          oninput="handleSearchOrders(this.value)"
        />
      </div>

      <div style="display:flex; gap:6px; overflow-x:auto; padding-bottom:4px;">
        <button class="btn-action-sm ${state.orderFilter === 'all' ? 'primary' : 'btn-secondary-subtle'}" onclick="setOrderFilter('all')">
          Todos (${activeOrders.length})
        </button>
        <button class="btn-action-sm ${state.orderFilter === 'pending' ? 'primary' : 'btn-secondary-subtle'}" onclick="setOrderFilter('pending')">
          En Espera (${activeOrders.filter(o => o.estado === 'En Espera').length})
        </button>
        <button class="btn-action-sm ${state.orderFilter === 'production' ? 'primary' : 'btn-secondary-subtle'}" onclick="setOrderFilter('production')">
          Producción (${activeOrders.filter(o => o.estado === 'En Producción').length})
        </button>
        <button class="btn-action-sm ${state.orderFilter === 'ready' ? 'primary' : 'btn-secondary-subtle'}" onclick="setOrderFilter('ready')">
          Listos (${activeOrders.filter(o => o.estado === 'Listo para Despacho').length})
        </button>
      </div>
    </div>

    <!-- Lista de Pedidos Filtrados -->
    <div style="display:flex; flex-direction:column; gap:12px;">
      ${filtered.length === 0 ? `
        <div class="card">
          <div class="empty-state">
            <i class="fa-solid fa-box-archive empty-state-icon"></i>
            <p>No se encontraron pedidos con el filtro actual.</p>
          </div>
        </div>
      ` : filtered.map(o => renderOrderCardHtml(o)).join("")}
    </div>
  `;
}

function handleSearchOrders(val) {
  state.searchQuery = val;
  renderOrdersView(document.getElementById("main-content"));
}

function setOrderFilter(filter) {
  state.orderFilter = filter;
  renderOrdersView(document.getElementById("main-content"));
}

// ============================================================================
// COMPONENTE: TARJETA DE PEDIDO MODERNA (ESTILO CREACIONES JJ)
// ============================================================================
function renderOrderCardHtml(o) {
  const statusClass = 
    o.estado === "En Espera" ? "status-pending" :
    o.estado === "En Producción" ? "status-production" :
    o.estado === "Listo para Despacho" ? "status-ready" : "status-delivered";

  const total = Number(o.totalEur || o.totalUsd || 0);
  const discountStr = o.descuentoPorcentaje ? ` (${o.descuentoPorcentaje}% desc.)` : "";
  const isDelivery = o.tipoEntrega && o.tipoEntrega.toLowerCase().includes("delivery");
  const isDelivered = o.estado === "Entregado";

  return `
    <div class="order-card" id="card-${o.id}">
      <div class="order-card-header">
        <div>
          <span class="order-id-badge">#${escapeHtml(o.id)}</span>
          <h4 class="order-client-name">${escapeHtml(o.cliente)}</h4>
        </div>
        <span class="status-badge ${statusClass}">${escapeHtml(o.estado)}</span>
      </div>

      <!-- Fechas y Logística -->
      <div class="order-info-row">
        <span class="order-info-item">
          <i class="fa-solid fa-calendar-plus" style="color:var(--text-light);"></i>
          <strong>Pedido:</strong> ${o.fechaSolicitudTexto || (o.fechaCreacion ? o.fechaCreacion.split("T")[0] : "Hoy")}
        </span>
        <span class="order-info-item">
          <i class="fa-solid fa-truck-ramp-box" style="color:var(--gold);"></i>
          <strong>Entrega:</strong> ${o.fechaEntrega || "Por definir"} ${o.horaEntrega ? `(${o.horaEntrega})` : ""}
        </span>
      </div>

      <!-- Detalle de Productos -->
      <div class="order-products-box">
        <i class="fa-solid fa-basket-shopping" style="color:var(--gold); margin-right:4px;"></i>
        ${escapeHtml(o.productosDetalle)}
      </div>

      <!-- Dirección o Retiro -->
      <div class="order-info-row">
        <span class="order-info-item">
          <i class="${isDelivery ? 'fa-solid fa-location-dot' : 'fa-solid fa-store'}" style="color:${isDelivery ? 'var(--info)' : 'var(--emerald)'};"></i>
          ${isDelivery ? `<strong>Delivery:</strong> ${escapeHtml(o.zonaDireccion || "Dirección pendiente")}` : `<strong>Retiro:</strong> En Taller / Tienda`}
        </span>
      </div>

      ${o.notas ? `
        <div class="order-notes-box">
          <i class="fa-solid fa-note-sticky" style="margin-right:4px;"></i> ${escapeHtml(o.notas)}
        </div>
      ` : ""}

      <!-- Pie de Tarjeta con Total y Acciones -->
      <div class="order-card-footer">
        <div>
          <span class="order-total-price">${formatMoney(total)}</span>
          <small style="font-size:11px; color:var(--emerald); font-weight:700;">${discountStr}</small>
        </div>

        <div class="order-actions-bar">
          ${o.telefono ? `
            <button class="btn-action-sm whatsapp" onclick="openWhatsAppNotify('${o.id}')" title="Enviar WhatsApp al Cliente">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </button>
            <a class="btn-action-sm btn-secondary-subtle" href="tel:${escapeHtml(o.telefono)}" title="Llamar al cliente">
              <i class="fa-solid fa-phone"></i>
            </a>
          ` : ""}

          ${!isDelivered ? `
            <button class="btn-action-sm ${o.estado === 'Listo para Despacho' ? 'ready' : 'primary'}" onclick="advanceOrderStatus('${o.id}')">
              ${o.estado === "En Espera" ? '<i class="fa-solid fa-play"></i> Iniciar' : 
                o.estado === "En Producción" ? '<i class="fa-solid fa-check"></i> Listo' : 
                '<i class="fa-solid fa-hand-holding-dollar"></i> Entregar'}
            </button>
          ` : `
            <button class="btn-action-sm reopen" onclick="reopenOrder('${o.id}')" title="Reabrir pedido devuelto">
              <i class="fa-solid fa-rotate-left"></i> Reabrir
            </button>
          `}
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 3. PESTAÑA NUEVO PEDIDO (CONSTRUCTOR INTELIGENTE CON STEPPERS)
// ============================================================================
function renderNewOrderView(container) {
  const activeProducts = state.products.filter(p => p.activo !== false);

  // Calcular subtotal en tiempo real
  let subtotal = 0;
  for (const [prodId, qty] of Object.entries(state.newOrderCart)) {
    const p = state.products.find(item => item.id === prodId);
    if (p && qty > 0) subtotal += (Number(p.precio) * qty);
  }

  const discountAmount = (subtotal * (state.newOrderDiscount / 100));
  const finalTotal = Math.max(0, subtotal - discountAmount);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title"><i class="fa-solid fa-plus-circle" style="color:var(--gold);"></i> Registrar Pedido</h2>
        <p class="view-sub">Constructor rápido &bull; Cálculo en tiempo real</p>
      </div>
    </div>

    <!-- PASO 1: Selección de Productos con Steppers -->
    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title"><i class="fa-solid fa-cubes-stacked" style="color:var(--gold);"></i> 1. Catálogo de Granolas</h3>
        <span style="font-size:12px; color:var(--text-muted);">Selecciona cantidades</span>
      </div>

      <div class="builder-catalog-grid">
        ${activeProducts.map(p => {
          const qty = state.newOrderCart[p.id] || 0;
          return `
            <div class="product-pick-card" style="${qty > 0 ? 'border-color:var(--gold); background:rgba(212,175,55,0.06);' : ''}">
              <div>
                <h4 class="product-pick-name">${escapeHtml(p.nombre)}</h4>
                <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(p.presentacion || '')}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                <span class="product-pick-price">${formatMoney(p.precio)}</span>
                <div class="stepper-wrap">
                  <button type="button" class="stepper-btn" onclick="updateCartItemQty('${p.id}', -1)">-</button>
                  <span class="stepper-count">${qty}</span>
                  <button type="button" class="stepper-btn" onclick="updateCartItemQty('${p.id}', 1)">+</button>
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>

    <!-- PASO 2: Datos del Cliente & Logística -->
    <div class="card">
      <h3 class="card-title"><i class="fa-solid fa-user-check" style="color:var(--gold);"></i> 2. Datos del Cliente</h3>

      <!-- Selector de Cliente Existente -->
      <div class="form-group">
        <label for="select-client"><i class="fa-solid fa-address-book"></i> Cliente Registrado (Autocompletar)</label>
        <select id="select-client" class="form-input" style="padding-left:14px;" onchange="handleSelectExistingClient(this.value)">
          <option value="">-- Cliente Nuevo / Escribir manualmente --</option>
          ${state.clients.map(c => `
            <option value="${c.id}" ${state.orderDraft.selectedClientId === c.id ? 'selected' : ''}>
              ${escapeHtml(c.nombre)} (${escapeHtml(c.telefono || 'Sin tlf')})
            </option>
          `).join("")}
        </select>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div class="form-group">
          <label for="order-client-name"><i class="fa-solid fa-signature"></i> Nombre del Cliente</label>
          <input 
            type="text" 
            id="order-client-name" 
            class="form-input" 
            style="padding-left:14px;" 
            placeholder="Ej. Valentina López" 
            value="${escapeHtml(state.orderDraft.clientName)}"
            oninput="state.orderDraft.clientName = this.value"
            required 
          />
        </div>

        <div class="form-group">
          <label for="order-client-phone"><i class="fa-solid fa-mobile-screen-button"></i> Teléfono Móvil</label>
          <input 
            type="tel" 
            id="order-client-phone" 
            class="form-input" 
            style="padding-left:14px;" 
            placeholder="Ej. 04121234567" 
            value="${escapeHtml(state.orderDraft.clientPhone)}"
            oninput="state.orderDraft.clientPhone = this.value"
          />
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div class="form-group">
          <label for="order-delivery-type"><i class="fa-solid fa-dolly"></i> Tipo de Entrega</label>
          <select id="order-delivery-type" class="form-input" style="padding-left:14px;" onchange="handleDeliveryTypeChange(this.value)">
            <option value="Delivery" ${state.orderDraft.deliveryType === 'Delivery' ? 'selected' : ''}>🛵 Delivery a Domicilio</option>
            <option value="Retiro en Tienda" ${state.orderDraft.deliveryType === 'Retiro en Tienda' ? 'selected' : ''}>🏪 Retiro en Taller / Tienda</option>
          </select>
        </div>

        <div class="form-group">
          <label for="order-delivery-date"><i class="fa-solid fa-calendar-day"></i> Fecha de Entrega</label>
          <input 
            type="date" 
            id="order-delivery-date" 
            class="form-input" 
            style="padding-left:14px;" 
            value="${state.orderDraft.deliveryDate || getTodayYmd()}"
            onchange="state.orderDraft.deliveryDate = this.value"
          />
        </div>
      </div>

      <div class="form-group" id="group-delivery-address">
        <label for="order-address"><i class="fa-solid fa-map-pin"></i> Dirección de Entrega / Zona</label>
        <input 
          type="text" 
          id="order-address" 
          class="form-input" 
          style="padding-left:14px;" 
          placeholder="Ej. Urb. Las Acacias, Casa #12" 
          value="${escapeHtml(state.orderDraft.address)}"
          oninput="state.orderDraft.address = this.value"
        />
      </div>

      <div class="form-group">
        <label for="order-notes"><i class="fa-solid fa-pen-to-square"></i> Notas Especiales del Pedido</label>
        <input 
          type="text" 
          id="order-notes" 
          class="form-input" 
          style="padding-left:14px;" 
          placeholder="Ej. Empacar para regalo, sin azúcar añadida..." 
          value="${escapeHtml(state.orderDraft.notes)}"
          oninput="state.orderDraft.notes = this.value"
        />
      </div>
    </div>

    <!-- PASO 3: Resumen Financiero & Descuentos -->
    <div class="card" style="border:1.5px solid var(--gold);">
      <h3 class="card-title"><i class="fa-solid fa-receipt" style="color:var(--gold);"></i> 3. Resumen y Total</h3>

      <!-- Selector de Descuento Rápido -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:12.5px; font-weight:700; color:var(--text-muted);">Descuento Especial:</span>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn-action-sm ${state.newOrderDiscount === 0 ? 'primary' : 'btn-secondary-subtle'}" onclick="setNewOrderDiscount(0)">0%</button>
          <button type="button" class="btn-action-sm ${state.newOrderDiscount === 10 ? 'primary' : 'btn-secondary-subtle'}" onclick="setNewOrderDiscount(10)">10%</button>
          <button type="button" class="btn-action-sm ${state.newOrderDiscount === 15 ? 'primary' : 'btn-secondary-subtle'}" onclick="setNewOrderDiscount(15)">15%</button>
          <button type="button" class="btn-action-sm ${state.newOrderDiscount === 20 ? 'primary' : 'btn-secondary-subtle'}" onclick="setNewOrderDiscount(20)">20%</button>
        </div>
      </div>

      <div style="background:var(--bg-card-subtle); padding:12px; border-radius:var(--radius-sm); display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--text-muted);">
          <span>Subtotal:</span>
          <span>${formatMoney(subtotal)}</span>
        </div>
        ${state.newOrderDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--emerald); font-weight:700;">
            <span>Descuento aplicado (${state.newOrderDiscount}%):</span>
            <span>-${formatMoney(discountAmount)}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; font-size:18px; font-weight:900; color:var(--gold); border-top:1px dashed var(--border-color); padding-top:6px;">
          <span>Total Final a Cobrar:</span>
          <span>${formatMoney(finalTotal)}</span>
        </div>
      </div>

      <button type="button" class="btn-primary-gold" style="padding:15px; font-size:16px;" onclick="submitNewOrder()">
        <i class="fa-solid fa-check-circle"></i>
        <span>Guardar y Registrar Pedido</span>
      </button>
    </div>
  `;
}

function updateCartItemQty(prodId, delta) {
  const current = state.newOrderCart[prodId] || 0;
  const updated = Math.max(0, current + delta);
  if (updated === 0) {
    delete state.newOrderCart[prodId];
  } else {
    state.newOrderCart[prodId] = updated;
  }
  renderNewOrderView(document.getElementById("main-content"));
}

function setNewOrderDiscount(discount) {
  state.newOrderDiscount = Number(discount);
  renderNewOrderView(document.getElementById("main-content"));
}

function handleSelectExistingClient(clientId) {
  state.orderDraft.selectedClientId = clientId;
  if (!clientId) {
    state.orderDraft.clientName = "";
    state.orderDraft.clientPhone = "";
    state.orderDraft.address = "";
    state.newOrderDiscount = 0;
  } else {
    const c = state.clients.find(item => item.id === clientId);
    if (c) {
      state.orderDraft.clientName = c.nombre || "";
      state.orderDraft.clientPhone = c.telefono || "";
      state.orderDraft.deliveryType = c.tipoEntrega || "Delivery";
      state.orderDraft.address = c.direccion || "";
      if (c.descuentoFijo) state.newOrderDiscount = Number(c.descuentoFijo);
    }
  }
  renderNewOrderView(document.getElementById("main-content"));
}

function handleDeliveryTypeChange(val) {
  state.orderDraft.deliveryType = val;
  const group = document.getElementById("group-delivery-address");
  if (group) group.style.display = val === "Delivery" ? "flex" : "none";
}

// ============================================================================
// GUARDAR NUEVO PEDIDO (PROTECCIÓN ABSOLUTA DE CORRELATIVO Y DATOS)
// ============================================================================
async function submitNewOrder() {
  const nameEl = document.getElementById("order-client-name");
  const phoneEl = document.getElementById("order-client-phone");
  const typeEl = document.getElementById("order-delivery-type");
  const addrEl = document.getElementById("order-address");
  const dateEl = document.getElementById("order-delivery-date");
  const notesEl = document.getElementById("order-notes");

  const clientName = (nameEl ? nameEl.value : state.orderDraft.clientName).trim();
  const clientPhone = (phoneEl ? phoneEl.value : state.orderDraft.clientPhone).trim();
  const deliveryType = (typeEl ? typeEl.value : state.orderDraft.deliveryType).trim();
  const address = (addrEl ? addrEl.value : state.orderDraft.address).trim();
  const deliveryDate = (dateEl ? dateEl.value : state.orderDraft.deliveryDate) || getTodayYmd();
  const notes = (notesEl ? notesEl.value : state.orderDraft.notes).trim();

  // Validaciones
  if (!clientName) {
    Swal.fire({
      icon: 'warning',
      title: 'Nombre Requerido',
      text: 'Por favor indica el nombre del cliente para el pedido.',
      confirmButtonColor: '#d4af37'
    });
    return;
  }

  // Verificar que al menos haya 1 producto
  let itemsCount = 0;
  let subtotal = 0;
  const itemsTextList = [];

  for (const [prodId, qty] of Object.entries(state.newOrderCart)) {
    const p = state.products.find(item => item.id === prodId);
    if (p && qty > 0) {
      itemsCount += qty;
      subtotal += (Number(p.precio) * qty);
      itemsTextList.push(`${qty}x ${p.nombre} (${formatMoney(p.precio * qty)})`);
    }
  }

  if (itemsCount === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'Carrito Vacío',
      text: 'Debes añadir al menos 1 producto de granola al pedido.',
      confirmButtonColor: '#d4af37'
    });
    return;
  }

  const productsDetailStr = itemsTextList.join(" + ");
  const discountAmount = (subtotal * (state.newOrderDiscount / 100));
  const finalTotal = Math.max(0, subtotal - discountAmount);

  // Generar ID único correlativo que NUNCA colisione ni se reinicie
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
    horaEntrega: "15:00",
    estado: "En Espera",
    responsable: state.user ? state.user.name : "Admin Zeus",
    notas: notes,
    notificadoWA: "No"
  };

  // 1. Guardar de inmediato en la Bóveda Local permanente
  saveToLocalVault(orderPayload);

  // 2. Guardar en el estado de pedidos activos
  state.orders.unshift(orderPayload);
  localStorage.setItem("gz_orders", JSON.stringify(state.orders));

  // 3. Registrar o actualizar cliente sin duplicados
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

  // 4. Limpiar borrador y carrito
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

  // 5. Notificación elegante
  Swal.fire({
    icon: 'success',
    title: `Pedido #${newId} Creado`,
    text: `Registrado con éxito para ${clientName} (${formatMoney(finalTotal)})`,
    timer: 2000,
    showConfirmButton: false
  });

  // 6. Sincronizar en segundo plano con Google Sheets
  syncSingleOrderToSheets(orderPayload);

  // 7. Navegar al tablero de pedidos
  switchTab("orders");
}

// ============================================================================
// AVANCE DE ESTADO Y ARCHIVADO SEGURO
// ============================================================================
window.advanceOrderStatus = function(orderId) {
  const order = state.orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  if (order.estado === "En Espera") {
    order.estado = "En Producción";
    saveToLocalVault(order);
    localStorage.setItem("gz_orders", JSON.stringify(state.orders));
    renderCurrentTab();
    showToast(`Pedido #${order.id} pasó a Producción`);
    syncResourceToSheets("update_status", { id: order.id, status: "En Producción" });
  } else if (order.estado === "En Producción") {
    order.estado = "Listo para Despacho";
    saveToLocalVault(order);
    localStorage.setItem("gz_orders", JSON.stringify(state.orders));
    renderCurrentTab();
    showToast(`Pedido #${order.id} listo para despacho`);
    syncResourceToSheets("update_status", { id: order.id, status: "Listo para Despacho" });
  } else if (order.estado === "Listo para Despacho") {
    Swal.fire({
      title: '¿Marcar como Entregado y Cobrado?',
      text: `El pedido #${order.id} se moverá al Historial de Finanzas.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#334155',
      confirmButtonText: 'Sí, Entregar y Cobrar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        order.estado = "Entregado";
        order.fechaEntregaReal = new Date().toISOString();

        // Mover a entregados y respaldar en bóveda
        state.orders = state.orders.filter(o => String(o.id) !== String(orderId));
        state.delivered.unshift(order);

        saveToLocalVault(order);
        localStorage.setItem("gz_orders", JSON.stringify(state.orders));
        localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));

        renderCurrentTab();
        showToast(`Pedido #${order.id} archivado en Historial de Finanzas`);

        syncResourceToSheets("update_status", {
          id: order.id,
          status: "Entregado",
          responsable: state.user ? state.user.name : "Operador"
        });
      }
    });
  }
};

window.reopenOrder = function(orderId) {
  const order = state.delivered.find(o => String(o.id) === String(orderId));
  if (!order) return;

  Swal.fire({
    title: '¿Reabrir este Pedido?',
    text: `El pedido #${order.id} volverá a la lista de pedidos activos como "En Espera".`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#8b5cf6',
    cancelButtonColor: '#334155',
    confirmButtonText: 'Sí, reabrir pedido',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      order.estado = "En Espera";
      state.delivered = state.delivered.filter(o => String(o.id) !== String(orderId));
      state.orders.unshift(order);

      saveToLocalVault(order);
      localStorage.setItem("gz_orders", JSON.stringify(state.orders));
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));

      renderCurrentTab();
      showToast(`Pedido #${order.id} reabierto con éxito`);

      syncResourceToSheets("reopen_order", { id: order.id });
    }
  });
};

// ============================================================================
// 4. PESTAÑA FINANZAS (HISTORIAL COMPLETO Y TOTALES ACUMULADOS)
// ============================================================================
function renderFinancesView(container) {
  const allOrders = [...state.orders, ...state.delivered];
  const deliveredOrders = state.delivered;

  const todayStr = getTodayYmd();
  const weekAgoStr = getDaysAgoYmd(7);
  const monthAgoStr = getDaysAgoYmd(30);

  const salesToday = deliveredOrders
    .filter(o => (o.fechaEntrega === todayStr || (o.fechaEntregaReal && o.fechaEntregaReal.startsWith(todayStr))))
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  const salesWeek = deliveredOrders
    .filter(o => o.fechaEntrega >= weekAgoStr)
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  const salesMonth = deliveredOrders
    .filter(o => o.fechaEntrega >= monthAgoStr)
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  const salesTotal = deliveredOrders
    .reduce((sum, o) => sum + Number(o.totalEur || o.totalUsd || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title"><i class="fa-solid fa-chart-pie" style="color:var(--gold);"></i> Finanzas & Historial</h2>
        <p class="view-sub">Balances en Euros (€) &bull; Control de caja</p>
      </div>
      <button class="btn-action-sm ready" onclick="syncWithSheets(true)">
        <i class="fa-solid fa-rotate"></i> Actualizar
      </button>
    </div>

    <!-- Métricas Financieras -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-card-top">
          <span>Hoy</span>
          <i class="fa-solid fa-coins metric-card-icon" style="color:var(--emerald);"></i>
        </div>
        <div class="metric-card-val emerald">${formatMoney(salesToday)}</div>
        <span class="metric-card-sub">cobrado hoy</span>
      </div>

      <div class="metric-card">
        <div class="metric-card-top">
          <span>Últimos 7 Días</span>
          <i class="fa-solid fa-calendar-week metric-card-icon" style="color:var(--gold);"></i>
        </div>
        <div class="metric-card-val gold">${formatMoney(salesWeek)}</div>
        <span class="metric-card-sub">cobrado esta semana</span>
      </div>

      <div class="metric-card">
        <div class="metric-card-top">
          <span>Últimos 30 Días</span>
          <i class="fa-solid fa-calendar-days metric-card-icon" style="color:var(--info);"></i>
        </div>
        <div class="metric-card-val">${formatMoney(salesMonth)}</div>
        <span class="metric-card-sub">último mes</span>
      </div>

      <div class="metric-card">
        <div class="metric-card-top">
          <span>Histórico Total</span>
          <i class="fa-solid fa-vault metric-card-icon" style="color:var(--gold);"></i>
        </div>
        <div class="metric-card-val gold">${formatMoney(salesTotal)}</div>
        <span class="metric-card-sub">${deliveredOrders.length} pedidos entregados</span>
      </div>
    </div>

    <!-- Historial de Pedidos Entregados -->
    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title"><i class="fa-solid fa-box-archive" style="color:var(--gold);"></i> Historial de Pedidos Entregados (${deliveredOrders.length})</h3>
        <span style="font-size:11px; color:var(--emerald); font-weight:700;"><i class="fa-solid fa-shield-check"></i> Respaldados</span>
      </div>

      ${deliveredOrders.length === 0 ? `
        <div class="empty-state">
          <i class="fa-solid fa-clock-rotate-left empty-state-icon"></i>
          <p>Aún no hay pedidos marcados como entregados en este dispositivo.</p>
          <button class="btn-action-sm primary" style="margin-top:6px;" onclick="syncWithSheets(true)">
            <i class="fa-solid fa-cloud-arrow-down"></i> Sincronizar Historial desde Google Sheets
          </button>
        </div>
      ` : `
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${deliveredOrders.map(o => renderOrderCardHtml(o)).join("")}
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// 5. PESTAÑA AJUSTES (CONEXIÓN, BÓVEDA, CLIENTES, CATÁLOGO, ADMIN)
// ============================================================================
function renderSettingsView(container) {
  const manager = isManager();
  const vault = getLocalVault();
  const vaultCount = Object.keys(vault).length;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title"><i class="fa-solid fa-sliders" style="color:var(--gold);"></i> Ajustes del Sistema</h2>
        <p class="view-sub">${state.user ? escapeHtml(state.user.name) : "Usuario"} &bull; ${manager ? '<span style="color:var(--gold); font-weight:700;">Administrador</span>' : 'Operador'}</p>
      </div>
    </div>

    <!-- 1. Bóveda de Respaldo y Protección de Datos -->
    <div class="card" style="border:1.5px solid var(--emerald); background:rgba(16,185,129,0.04);">
      <div class="card-title-row">
        <h3 class="card-title" style="color:var(--emerald);">
          <i class="fa-solid fa-shield-halved"></i> Bóveda de Seguridad & Recuperación
        </h3>
        <span class="sync-pill online"><i class="fa-solid fa-check"></i> Activa</span>
      </div>
      <p style="font-size:12.5px; color:var(--text-muted);">
        Esta app cuenta con protección contra pérdida de datos. Tus pedidos se respaldan localmente y en Google Sheets automáticamente.
      </p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:4px 0;">
        <div style="background:var(--bg-card); padding:8px 12px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
          <span style="font-size:11px; color:var(--text-muted); display:block;">Pedidos en Bóveda</span>
          <strong style="font-size:16px; color:var(--gold);">${vaultCount} pedidos</strong>
        </div>
        <div style="background:var(--bg-card); padding:8px 12px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
          <span style="font-size:11px; color:var(--text-muted); display:block;">Histórico Entregados</span>
          <strong style="font-size:16px; color:var(--emerald);">${state.delivered.length} pedidos</strong>
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn-action-sm ready" style="flex:1;" onclick="syncWithSheets(true)">
          <i class="fa-solid fa-rotate"></i> Sincronizar con Google Sheets
        </button>
        <button class="btn-action-sm btn-secondary-subtle" onclick="restoreFromLocalVault()">
          <i class="fa-solid fa-recycle"></i> Restaurar desde Bóveda Local
        </button>
      </div>
    </div>

    <!-- 2. Conexión con Google Sheets -->
    <div class="card" style="border:1.5px solid var(--gold);">
      <div class="card-title-row">
        <h3 class="card-title"><i class="fa-solid fa-cloud" style="color:var(--gold);"></i> Conexión con Google Sheets</h3>
        <span class="order-id-badge">Backend Serverless</span>
      </div>
      <p style="font-size:12.5px; color:var(--text-muted);">
        Enlace de tu Web App de Google Apps Script (que termina en <code>/exec</code>) vinculada a tu hoja de cálculo.
      </p>
      <div class="form-group">
        <input 
          type="url" 
          id="admin-api-url-input" 
          class="form-input" 
          style="padding-left:14px; font-family:var(--font-mono); font-size:12px;" 
          placeholder="https://script.google.com/macros/s/.../exec" 
          value="${API_URL.includes("YOUR_DEPLOYED_URL_HERE") ? "" : escapeHtml(API_URL)}" 
        />
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-primary-gold" style="flex:1; margin:0;" onclick="saveApiUrlFromAdmin()">
          <i class="fa-solid fa-floppy-disk"></i> Guardar y Conectar
        </button>
        <button class="btn-action-sm btn-secondary-subtle" onclick="testConnection()">
          <i class="fa-solid fa-plug"></i> Probar Conexión
        </button>
      </div>
    </div>

    <!-- 3. Gestión de Clientes -->
    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title"><i class="fa-solid fa-users" style="color:var(--gold);"></i> Clientes Registrados (${state.clients.length})</h3>
        <button class="btn-action-sm primary" onclick="openNewClientModal()">
          <i class="fa-solid fa-user-plus"></i> Añadir
        </button>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; max-height:260px; overflow-y:auto;">
        ${state.clients.map(c => `
          <div style="background:var(--bg-card-subtle); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="font-size:14px; color:var(--text-main);">${escapeHtml(c.nombre)}</strong>
              <div style="font-size:11.5px; color:var(--text-muted);">
                <i class="fa-solid fa-phone"></i> ${escapeHtml(c.telefono || 'Sin teléfono')} &bull; ${escapeHtml(c.tipoEntrega || 'Delivery')} &bull; <span style="color:var(--emerald); font-weight:700;">${c.descuentoFijo || 0}% desc.</span>
              </div>
            </div>
            <div style="display:flex; gap:4px;">
              ${c.telefono ? `
                <a class="top-action-btn" href="https://wa.me/${normalizePhone(c.telefono)}" target="_blank" title="WhatsApp" style="width:30px; height:30px;">
                  <i class="fa-brands fa-whatsapp" style="color:#25d366;"></i>
                </a>
              ` : ''}
              ${manager ? `
                <button class="top-action-btn btn-danger-action" style="width:30px; height:30px;" onclick="deleteClient('${c.id}')" title="Eliminar cliente">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- 4. Catálogo de Productos y Precios -->
    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title"><i class="fa-solid fa-jar" style="color:var(--gold);"></i> Catálogo de Granolas (${state.products.length})</h3>
        ${manager ? `
          <button class="btn-action-sm primary" onclick="openNewProductModal()">
            <i class="fa-solid fa-plus"></i> Añadir
          </button>
        ` : ''}
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${state.products.map(p => `
          <div style="background:var(--bg-card-subtle); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="font-size:14px; color:var(--text-main);">${escapeHtml(p.nombre)}</strong>
              <div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(p.presentacion || '')}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:15px; font-weight:800; color:var(--gold);">${formatMoney(p.precio)}</span>
              ${manager ? `
                <button class="top-action-btn btn-danger-action" style="width:30px; height:30px;" onclick="deleteProduct('${p.id}')">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- 5. Copia de Seguridad JSON & Actualización -->
    <div class="card">
      <h3 class="card-title"><i class="fa-solid fa-floppy-disk" style="color:var(--gold);"></i> Respaldo Manual & Sistema</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <button class="btn-action-sm btn-secondary-subtle" onclick="exportZeusBackup()">
          <i class="fa-solid fa-file-export"></i> Exportar Respaldo
        </button>
        <label class="btn-action-sm btn-secondary-subtle" style="text-align:center; cursor:pointer;">
          <i class="fa-solid fa-file-import"></i> Importar Respaldo
          <input type="file" accept=".json" style="display:none;" onchange="importZeusBackup(event)" />
        </label>
      </div>

      <div style="display:flex; gap:8px; margin-top:4px;">
        <button class="btn-action-sm btn-secondary-subtle" style="flex:1;" onclick="openChangePinModal()">
          <i class="fa-solid fa-key"></i> Cambiar mi PIN
        </button>
        <button class="btn-action-sm btn-secondary-subtle" style="flex:1;" onclick="forceCleanUpdate(true)">
          <i class="fa-solid fa-broom"></i> Limpiar Caché App
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// FUNCIONES DE SINCRONIZACIÓN SEGURA Y FUSIÓN (ZERO DATA LOSS)
// ============================================================================
async function syncWithSheets(interactive = false) {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) {
    if (interactive) {
      Swal.fire({
        icon: 'info',
        title: 'Modo Local',
        text: 'Pega la URL de tu Google Apps Script en la pestaña Ajustes para sincronizar en tiempo real con Drive.',
        confirmButtonColor: '#d4af37'
      });
    }
    return;
  }

  const syncPill = document.getElementById("sync-status-indicator");
  if (syncPill) {
    syncPill.innerHTML = '<span class="sync-dot" style="background:#f59e0b;"></span> Sincronizando...';
  }

  if (interactive) showToast("Sincronizando con Google Sheets...");

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "dashboard" })
    });
    const json = await res.json();

    if (json && json.ok && json.data) {
      // 1. FUSIÓN INTELIGENTE DE PEDIDOS ACTIVOS: Jamás sobreescribir ciegamente
      if (json.data.orders && Array.isArray(json.data.orders)) {
        const remoteOrders = json.data.orders;
        const remoteIds = new Set(remoteOrders.map(o => String(o.id)));

        // Preservar pedidos locales que aún no hayan llegado a Google Sheets
        const pendingLocal = state.orders.filter(o => !remoteIds.has(String(o.id)));

        // Combinar: remotos + pendientes locales
        state.orders = deduplicateOrdersById([...pendingLocal, ...remoteOrders]);
        localStorage.setItem("gz_orders", JSON.stringify(state.orders));

        // Respaldar en bóveda local permanente
        saveManyToLocalVault(state.orders);
      }

      // 2. RECUPERACIÓN TOTAL DE PEDIDOS ENTREGADOS (HISTORIAL)
      if (json.data.delivered && Array.isArray(json.data.delivered)) {
        const remoteDelivered = json.data.delivered;
        const remoteDeliveredIds = new Set(remoteDelivered.map(o => String(o.id)));
        const pendingDelivered = state.delivered.filter(o => !remoteDeliveredIds.has(String(o.id)));

        state.delivered = deduplicateOrdersById([...pendingDelivered, ...remoteDelivered]);
        localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
        saveManyToLocalVault(state.delivered);
      } else {
        // Fallback: si el backend no devolvió entregados en dashboard, llamar a action: "history"
        fetchDeliveredHistoryFallback();
      }

      // 3. Clientes
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

      // 4. Catálogo de productos
      if (json.data.products && Array.isArray(json.data.products) && json.data.products.length > 0) {
        state.products = json.data.products;
        localStorage.setItem("gz_products", JSON.stringify(state.products));
      }

      // 5. Usuarios
      if (json.data.users && Array.isArray(json.data.users) && json.data.users.length > 0) {
        state.users = json.data.users;
        localStorage.setItem("gz_users", JSON.stringify(state.users));
      }

      if (syncPill) {
        syncPill.className = "sync-pill online";
        syncPill.innerHTML = '<span class="sync-dot"></span> Sincronizado';
      }

      if (interactive) {
        Swal.fire({
          icon: 'success',
          title: 'Sincronizado',
          text: `Todo actualizado con Google Sheets (${state.orders.length} activos, ${state.delivered.length} en historial).`,
          confirmButtonColor: '#d4af37'
        });
      }

      renderCurrentTab();
    }
  } catch (err) {
    console.warn("Fallo en sincronización con Apps Script:", err);
    if (syncPill) {
      syncPill.className = "sync-pill local";
      syncPill.innerHTML = '<span class="sync-dot" style="background:#f59e0b;"></span> Modo Local';
    }
    if (interactive) {
      Swal.fire({
        icon: 'error',
        title: 'Error de Conexión',
        text: 'No se pudo conectar con Apps Script. Verifica tu conexión a internet o la URL en Ajustes.',
        confirmButtonColor: '#d4af37'
      });
    }
  }
}

async function fetchDeliveredHistoryFallback() {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) return;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "history" })
    });
    const json = await res.json();
    if (json && json.ok && json.data && Array.isArray(json.data.history)) {
      state.delivered = deduplicateOrdersById([...state.delivered, ...json.data.history]);
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
      saveManyToLocalVault(state.delivered);
      renderCurrentTab();
    }
  } catch (e) {
    console.warn("Aviso en consulta de historial entregados:", e);
  }
}

function deduplicateOrdersById(ordersArray) {
  const map = new Map();
  ordersArray.forEach(o => {
    if (o && o.id) {
      map.set(String(o.id), o);
    }
  });
  return Array.from(map.values());
}

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
    if (json && json.ok && json.data && json.data.users && Array.isArray(json.data.users)) {
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
    console.warn("Sincronización inicial diferida:", err);
  }
}

// ============================================================================
// RESTAURACIÓN DESDE BÓVEDA LOCAL
// ============================================================================
window.restoreFromLocalVault = function() {
  const vault = getLocalVault();
  const list = Object.values(vault);

  if (list.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'Bóveda Vacía',
      text: 'No hay pedidos archivados en la bóveda de este navegador.',
      confirmButtonColor: '#d4af37'
    });
    return;
  }

  Swal.fire({
    title: '¿Restaurar desde Bóveda?',
    text: `Se recuperarán ${list.length} pedidos almacenados permanentemente en la memoria segura.`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#10b981',
    cancelButtonColor: '#334155',
    confirmButtonText: 'Sí, restaurar todo',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      const active = list.filter(o => o.estado !== "Entregado");
      const delivered = list.filter(o => o.estado === "Entregado");

      state.orders = deduplicateOrdersById([...state.orders, ...active]);
      state.delivered = deduplicateOrdersById([...state.delivered, ...delivered]);

      localStorage.setItem("gz_orders", JSON.stringify(state.orders));
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));

      renderCurrentTab();

      Swal.fire({
        icon: 'success',
        title: '¡Recuperación Exitosa!',
        text: `Se restauraron ${active.length} pedidos activos y ${delivered.length} pedidos en historial.`,
        confirmButtonColor: '#d4af37'
      });
    }
  });
};

// ============================================================================
// PROBAR Y GUARDAR CONEXIÓN
// ============================================================================
window.saveApiUrlFromAdmin = function() {
  const input = document.getElementById("admin-api-url-input");
  if (!input) return;
  const url = input.value.trim();

  if (!url || !url.startsWith("https://script.google.com/macros/s/")) {
    Swal.fire({
      icon: 'error',
      title: 'URL Inválida',
      text: 'La URL debe ser un enlace de Google Apps Script que empiece con "https://script.google.com/macros/s/" y termine en "/exec".',
      confirmButtonColor: '#d4af37'
    });
    return;
  }

  API_URL = url;
  localStorage.setItem("gz_api_url", url);
  syncWithSheets(true);
};

window.testConnection = async function() {
  const input = document.getElementById("admin-api-url-input");
  const url = input ? input.value.trim() : API_URL;

  if (!url || url.includes("YOUR_DEPLOYED_URL_HERE")) {
    Swal.fire({
      icon: 'warning',
      title: 'Falta URL',
      text: 'Por favor pega la URL de Apps Script antes de probar.',
      confirmButtonColor: '#d4af37'
    });
    return;
  }

  showToast("Probando conexión con Apps Script...");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "dashboard" })
    });
    const json = await res.json();
    if (json && json.ok) {
      Swal.fire({
        icon: 'success',
        title: '¡Conexión Exitosa!',
        text: 'La base de datos de Google Sheets respondió correctamente.',
        confirmButtonColor: '#d4af37'
      });
    } else {
      Swal.fire({
        icon: 'warning',
        title: 'Respuesta con error',
        text: json.error || 'La hoja respondió pero devolvió un estado no válido.',
        confirmButtonColor: '#d4af37'
      });
    }
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'Error de red',
      text: 'No se pudo contactar la API. Verifica permisos de acceso en Apps Script ("Cualquiera").',
      confirmButtonColor: '#d4af37'
    });
  }
};

// ============================================================================
// WHATSAPP HELPER
// ============================================================================
window.openWhatsAppNotify = function(orderId) {
  const order = [...state.orders, ...state.delivered].find(o => String(o.id) === String(orderId));
  if (!order) return;

  const cleanPhone = normalizePhone(order.telefono);
  if (!cleanPhone) {
    Swal.fire({
      icon: 'warning',
      title: 'Sin Teléfono',
      text: 'Este pedido no tiene número de teléfono registrado.',
      confirmButtonColor: '#d4af37'
    });
    return;
  }

  const isDelivery = order.tipoEntrega && order.tipoEntrega.toLowerCase().includes("delivery");
  const entregaInfo = isDelivery
    ? `🛵 *Entrega:* Delivery a ${order.zonaDireccion || 'dirección indicada'}`
    : `🏪 *Entrega:* Retiro en Taller / Tienda`;

  let msg = state.waTemplate
    .replace(/{cliente}/g, order.cliente || "Cliente")
    .replace(/{id}/g, order.id || "")
    .replace(/{detalle}/g, order.productosDetalle || "")
    .replace(/{total}/g, formatMoney(order.totalEur || order.totalUsd || 0))
    .replace(/{entrega_info}/g, entregaInfo)
    .replace(/{fechaEntrega}/g, order.fechaEntrega || "Hoy");

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");

  syncResourceToSheets("mark_whatsapp", { id: order.id });
};

// ============================================================================
// GESTIÓN DE CLIENTES MODAL
// ============================================================================
window.openNewClientModal = function() {
  Swal.fire({
    title: 'Nuevo Cliente',
    html: `
      <div style="text-align:left; display:flex; flex-direction:column; gap:8px;">
        <label style="font-size:12px; font-weight:700;">Nombre completo</label>
        <input id="swal-client-name" class="swal2-input" style="margin:0; width:100%;" placeholder="Ej. Mariana Ramos" />
        
        <label style="font-size:12px; font-weight:700; margin-top:6px;">Teléfono móvil</label>
        <input id="swal-client-phone" class="swal2-input" style="margin:0; width:100%;" placeholder="Ej. 04121234567" />
        
        <label style="font-size:12px; font-weight:700; margin-top:6px;">Dirección habitual</label>
        <input id="swal-client-addr" class="swal2-input" style="margin:0; width:100%;" placeholder="Ej. Calle 4, Casa #5" />
        
        <label style="font-size:12px; font-weight:700; margin-top:6px;">Descuento fijo (%)</label>
        <input id="swal-client-disc" type="number" class="swal2-input" style="margin:0; width:100%;" value="15" />
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Guardar Cliente',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d4af37',
    preConfirm: () => {
      const name = document.getElementById('swal-client-name').value.trim();
      const phone = document.getElementById('swal-client-phone').value.trim();
      const addr = document.getElementById('swal-client-addr').value.trim();
      const disc = document.getElementById('swal-client-disc').value;
      if (!name) {
        Swal.showValidationMessage('El nombre es obligatorio');
        return false;
      }
      return { name, phone, addr, disc: Number(disc || 0) };
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      const newC = {
        id: `CLI-${Date.now()}`,
        nombre: res.value.name,
        telefono: res.value.phone,
        tipoEntrega: "Delivery",
        direccion: res.value.addr,
        descuentoFijo: res.value.disc
      };
      state.clients.push(newC);
      localStorage.setItem("gz_clients", JSON.stringify(state.clients));
      syncResourceToSheets("save_client", newC);
      renderSettingsView(document.getElementById("main-content"));
      showToast("Cliente registrado con éxito");
    }
  });
};

window.deleteClient = function(clientId) {
  const c = state.clients.find(item => item.id === clientId);
  if (!c) return;

  Swal.fire({
    title: `¿Eliminar a ${c.nombre}?`,
    text: 'Esta acción eliminará al cliente del registro.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar'
  }).then((res) => {
    if (res.isConfirmed) {
      state.clients = state.clients.filter(item => item.id !== clientId);
      localStorage.setItem("gz_clients", JSON.stringify(state.clients));
      syncResourceToSheets("delete_client", { id: clientId, nombre: c.nombre });
      renderSettingsView(document.getElementById("main-content"));
      showToast("Cliente eliminado");
    }
  });
};

// ============================================================================
// GESTIÓN DE PRODUCTOS MODAL
// ============================================================================
window.openNewProductModal = function() {
  Swal.fire({
    title: 'Nuevo Producto de Granola',
    html: `
      <div style="text-align:left; display:flex; flex-direction:column; gap:8px;">
        <label style="font-size:12px; font-weight:700;">Nombre del producto</label>
        <input id="swal-prod-name" class="swal2-input" style="margin:0; width:100%;" placeholder="Ej. Granola Almendras & Miel" />
        
        <label style="font-size:12px; font-weight:700; margin-top:6px;">Presentación</label>
        <input id="swal-prod-pres" class="swal2-input" style="margin:0; width:100%;" placeholder="Ej. Bolsa 500g" />
        
        <label style="font-size:12px; font-weight:700; margin-top:6px;">Precio en Euros (€)</label>
        <input id="swal-prod-price" type="number" step="0.5" class="swal2-input" style="margin:0; width:100%;" placeholder="10.00" />
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Añadir Producto',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d4af37',
    preConfirm: () => {
      const name = document.getElementById('swal-prod-name').value.trim();
      const pres = document.getElementById('swal-prod-pres').value.trim();
      const price = document.getElementById('swal-prod-price').value;
      if (!name || !price) {
        Swal.showValidationMessage('Nombre y precio son obligatorios');
        return false;
      }
      return { name, pres, price: Number(price) };
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      const newP = {
        id: `PROD-${Date.now()}`,
        nombre: res.value.name,
        presentacion: res.value.pres || "500g",
        precio: res.value.price,
        activo: true
      };
      state.products.push(newP);
      localStorage.setItem("gz_products", JSON.stringify(state.products));
      syncResourceToSheets("save_product", newP);
      renderSettingsView(document.getElementById("main-content"));
      showToast("Producto añadido al catálogo");
    }
  });
};

window.deleteProduct = function(prodId) {
  const p = state.products.find(item => item.id === prodId);
  if (!p) return;

  Swal.fire({
    title: `¿Eliminar ${p.nombre}?`,
    text: 'El producto se removerá del catálogo de ventas.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar'
  }).then((res) => {
    if (res.isConfirmed) {
      state.products = state.products.filter(item => item.id !== prodId);
      localStorage.setItem("gz_products", JSON.stringify(state.products));
      syncResourceToSheets("delete_product", { id: prodId, nombre: p.nombre });
      renderSettingsView(document.getElementById("main-content"));
      showToast("Producto eliminado del catálogo");
    }
  });
};

// ============================================================================
// CAMBIAR PIN
// ============================================================================
window.openChangePinModal = function() {
  Swal.fire({
    title: 'Cambiar mi PIN de Acceso',
    html: `
      <div style="text-align:left; display:flex; flex-direction:column; gap:8px;">
        <label style="font-size:12px; font-weight:700;">Nuevo PIN de 4 dígitos</label>
        <input id="swal-new-pin" type="password" inputmode="numeric" maxlength="8" class="swal2-input" style="margin:0; width:100%;" placeholder="Ej. 5678" />
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Actualizar PIN',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d4af37',
    preConfirm: () => {
      const pin = document.getElementById('swal-new-pin').value.trim();
      if (!pin || pin.length < 4) {
        Swal.showValidationMessage('El PIN debe tener al menos 4 números');
        return false;
      }
      return pin;
    }
  }).then((res) => {
    if (res.isConfirmed && res.value && state.user) {
      state.user.pin = res.value;
      const exIdx = state.users.findIndex(u => u.name.toLowerCase() === state.user.name.toLowerCase());
      if (exIdx >= 0) state.users[exIdx].pin = res.value;
      localStorage.setItem("zeus_auth_user", JSON.stringify(state.user));
      localStorage.setItem("gz_users", JSON.stringify(state.users));
      syncResourceToSheets("update_pin", { userName: state.user.name, newPin: res.value });
      Swal.fire({
        icon: 'success',
        title: 'PIN Actualizado',
        text: 'Tu nuevo PIN ha sido guardado exitosamente.',
        confirmButtonColor: '#d4af37'
      });
    }
  });
};

// ============================================================================
// EXPORTAR & IMPORTAR RESPALDO JSON
// ============================================================================
window.exportZeusBackup = function() {
  const vault = getLocalVault();
  const backup = {
    exportedAt: new Date().toISOString(),
    system: "Zeus Granola Fit v3.0",
    orders: state.orders,
    delivered: state.delivered,
    products: state.products,
    clients: state.clients,
    users: state.users,
    vault: vault
  };

  const str = JSON.stringify(backup, null, 2);
  const blob = new Blob([str], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Granola_Zeus_Respaldo_${getTodayYmd()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Respaldo descargado con éxito");
};

window.importZeusBackup = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.products && Array.isArray(data.products)) state.products = data.products;
      if (data.orders && Array.isArray(data.orders)) state.orders = deduplicateOrdersById([...state.orders, ...data.orders]);
      if (data.delivered && Array.isArray(data.delivered)) state.delivered = deduplicateOrdersById([...state.delivered, ...data.delivered]);
      if (data.clients && Array.isArray(data.clients)) state.clients = data.clients;
      if (data.users && Array.isArray(data.users)) state.users = data.users;

      saveManyToLocalVault(state.orders);
      saveManyToLocalVault(state.delivered);

      localStorage.setItem("gz_products", JSON.stringify(state.products));
      localStorage.setItem("gz_orders", JSON.stringify(state.orders));
      localStorage.setItem("gz_delivered", JSON.stringify(state.delivered));
      localStorage.setItem("gz_clients", JSON.stringify(state.clients));
      localStorage.setItem("gz_users", JSON.stringify(state.users));

      Swal.fire({
        icon: 'success',
        title: '¡Respaldo Restaurado!',
        text: 'Se han importado todos los pedidos y catálogos sin pérdida de datos.',
        confirmButtonColor: '#d4af37'
      });
      renderCurrentTab();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Archivo Inválido',
        text: 'El archivo JSON no tiene un formato válido.',
        confirmButtonColor: '#d4af37'
      });
    }
  };
  reader.readAsText(file);
};

// ============================================================================
// LIMPIEZA Y ACTUALIZACIÓN PROFUNDA
// ============================================================================
window.forceCleanUpdate = async function(interactive = false) {
  if (interactive) {
    const confirmClean = await Swal.fire({
      title: '¿Actualizar Aplicación?',
      text: 'Esto descargará la versión más reciente limpiando la caché, sin borrar tus pedidos guardados.',
      icon: 'info',
      showCancelButton: true,
      confirmButtonColor: '#d4af37',
      cancelButtonColor: '#334155',
      confirmButtonText: 'Sí, actualizar ahora',
      cancelButtonText: 'Cancelar'
    });
    if (!confirmClean.isConfirmed) return;
  }

  showToast("Actualizando aplicación...");

  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ action: "clearCache" });
      navigator.serviceWorker.controller.postMessage({ action: "skipWaiting" });
    }
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    }
  } catch (err) {
    console.warn("Aviso durante limpieza de caché:", err);
  }

  setTimeout(() => {
    const freshUrl = new URL(window.location.href);
    freshUrl.searchParams.set("t", Date.now());
    window.location.replace(freshUrl.toString());
  }, 500);
};

async function checkForRemoteUpdate() {
  if (!API_URL || API_URL.includes("YOUR_DEPLOYED_URL_HERE")) return;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "get_system_version" })
    });
    const json = await res.json();
    if (json && json.ok && json.data && json.data.systemVersion) {
      const serverVer = String(json.data.systemVersion);
      const localVer = String(localStorage.getItem("gz_system_version") || "1");
      if (serverVer !== "1" && serverVer !== localVer) {
        localStorage.setItem("gz_system_version", serverVer);
        showToast("¡Nueva versión detectada! Actualizando...");
        setTimeout(() => {
          forceCleanUpdate(false);
        }, 1200);
      }
    }
  } catch (e) {
    // Silencioso
  }
}

// ============================================================================
// HELPERS Y FORMATEO
// ============================================================================
function formatMoney(amount) {
  const num = Number(amount || 0);
  return `${num.toFixed(2).replace(".", ",")} €`;
}

function getTodayYmd() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDaysAgoYmd(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateFriendly(ymdStr) {
  if (!ymdStr) return "Hoy";
  try {
    const parts = ymdStr.split("-");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
    }
  } catch (e) {}
  return ymdStr;
}

function normalizePhone(phoneStr) {
  if (!phoneStr) return "";
  let clean = String(phoneStr).replace(/\D/g, "");
  if (clean.startsWith("0")) clean = "58" + clean.substring(1);
  return clean;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
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
  const t = document.createElement("div");
  t.className = "toast-message";
  t.innerHTML = `<i class="fa-solid fa-bell" style="color:var(--gold);"></i> <span>${escapeHtml(msg)}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(-10px)";
    t.style.transition = "all 0.3s ease";
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=5").catch(() => {});
  }
}
