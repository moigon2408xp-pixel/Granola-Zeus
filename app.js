/**
 * ============================================================================
 * GRANOLA ZEUS – SISTEMA DE GESTIÓN, PRODUCCIÓN Y DESPACHO (v1.0)
 * Frontend PWA Serverless (Vanilla JS + Local Storage Cache)
 * ============================================================================
 */

// URL de la Web App de Google Apps Script (Reemplazar con la URL desplegada)
let API_URL = localStorage.getItem("gz_api_url") || "https://script.google.com/macros/s/AKfycbz_PONER_TU_URL_AQUI/exec";

// Estado Global de la Aplicación
const state = {
  currentTab: "today",
  theme: localStorage.getItem("gz_theme") || "light",
  user: JSON.parse(localStorage.getItem("gz_user") || '{"id":"USR-001","name":"Admin Zeus","role":"manager","email":"admin@granolazeus.com"}'),
  orders: [],
  products: [],
  clients: [],
  users: [],
  totalDelivered: 0,
  history: [],
  offline: false,
  orderFilter: "all",
  historyFilter: ""
};

// ============================================================================
// INICIALIZACIÓN
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(state.theme);
  bindEvents();
  registerServiceWorker();
  loadData();
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
// LLAMADAS API (FETCH + MANEJO DE CACHÉ LOCAL)
// ============================================================================
async function apiCall(action, payload = {}) {
  if (API_URL.includes("PONER_TU_URL_AQUI")) {
    return mockApiCall(action, payload);
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Error en la operación");
    return json.data;
  } catch (err) {
    console.warn("Error en API, activando modo offline:", err);
    state.offline = true;
    showToast("⚠️ Modo sin conexión / Servidor ocupado");
    throw err;
  }
}

// Mock inicial para pruebas instantáneas
function mockApiCall(action, payload) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (action === "dashboard") {
        const savedOrders = JSON.parse(localStorage.getItem("gz_mock_orders") || "null");
        resolve({
          orders: savedOrders || [
            {
              id: "GZ-0001",
              fechaCreacion: new Date().toISOString(),
              cliente: "María González",
              telefono: "04141234567",
              tipoEntrega: "Delivery",
              zonaDireccion: "Norte - Urb. Los Mangos casa 12",
              productosDetalle: "2x Granola Miel & Nueces 500g ($17.00)",
              totalUsd: 17.00,
              fechaEntrega: new Date().toISOString().split("T")[0],
              horaEntrega: "Tarde (2pm - 5pm)",
              estado: "Pendiente",
              responsable: "Admin Zeus",
              notas: "Dejar en portería si no responden",
              notificadoWA: "No"
            },
            {
              id: "GZ-0002",
              fechaCreacion: new Date().toISOString(),
              cliente: "Carlos Pérez",
              telefono: "04249876543",
              tipoEntrega: "Retiro en Tienda",
              zonaDireccion: "Local Comercial",
              productosDetalle: "1x Granola Cacao Crunch 1kg ($15.00) + 1x Frutas del Bosque 350g ($6.50)",
              totalUsd: 21.50,
              fechaEntrega: new Date().toISOString().split("T")[0],
              horaEntrega: "Mañana (9am - 12pm)",
              estado: "En Producción",
              responsable: "Operador Taller",
              notas: "Poco dulce si es posible",
              notificadoWA: "No"
            }
          ],
          products: [
            { id: "PROD-001", nombre: "Granola Miel & Nueces", presentacion: "500g", precio: 8.50, activo: true },
            { id: "PROD-002", nombre: "Granola Cacao Crunch", presentacion: "1kg", precio: 15.00, activo: true },
            { id: "PROD-003", nombre: "Granola Frutas del Bosque", presentacion: "350g", precio: 6.50, activo: true },
            { id: "PROD-004", nombre: "Granola Sin Azúcar", presentacion: "500g", precio: 9.00, activo: true }
          ],
          clients: [
            { nombre: "María González", telefono: "04141234567", delivery: "Sí", zona: "Norte", direccion: "Urb. Los Mangos casa 12" },
            { nombre: "Carlos Pérez", telefono: "04249876543", delivery: "No", zona: "Centro", direccion: "Retira en local" }
          ],
          users: [
            { id: "USR-001", name: "Admin Zeus", role: "manager" },
            { id: "USR-002", name: "Operador Taller", role: "worker" }
          ],
          totalDelivered: 5
        });
      } else if (action === "create_order") {
        const id = "GZ-" + ("000" + Math.floor(Math.random() * 900 + 100)).slice(-4);
        resolve({ id, message: `Pedido ${id} creado exitosamente` });
      } else {
        resolve({ message: "Operación completada exitosamente" });
      }
    }, 200);
  });
}

// ============================================================================
// CARGA Y RENDERIZADO DE DATOS
// ============================================================================
async function loadData(showLoading = true) {
  if (showLoading) {
    document.getElementById("main-content").innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Sincronizando con Granola Zeus...</p>
      </div>
    `;
  }

  try {
    const data = await apiCall("dashboard");
    state.orders = data.orders || [];
    state.products = data.products || [];
    state.clients = data.clients || [];
    state.users = data.users || [];
    state.totalDelivered = data.totalDelivered || 0;

    localStorage.setItem("gz_cached_dashboard", JSON.stringify(data));
    updateBadges();
    renderCurrentTab();
  } catch (err) {
    const cached = localStorage.getItem("gz_cached_dashboard");
    if (cached) {
      const data = JSON.parse(cached);
      state.orders = data.orders || [];
      state.products = data.products || [];
      state.clients = data.clients || [];
      state.users = data.users || [];
      updateBadges();
      renderCurrentTab();
    }
  }
}

function updateBadges() {
  const todayStr = new Date().toISOString().split("T")[0];
  
  const urgentOrders = state.orders.filter(o => {
    return o.estado !== "Entregado" && (o.fechaEntrega <= todayStr || priorityLevel(o) === "overdue");
  });

  const todayBadge = document.getElementById("badge-today-count");
  if (todayBadge) {
    todayBadge.textContent = urgentOrders.length;
    todayBadge.style.display = urgentOrders.length > 0 ? "inline-block" : "none";
  }

  const activeOrders = state.orders.filter(o => o.estado !== "Entregado");
  const ordersBadge = document.getElementById("badge-orders-count");
  if (ordersBadge) {
    ordersBadge.textContent = activeOrders.length;
    ordersBadge.style.display = activeOrders.length > 0 ? "inline-block" : "none";
  }

  const overdueCount = state.orders.filter(o => priorityLevel(o) === "overdue").length;
  const todayCount = state.orders.filter(o => priorityLevel(o) === "today").length;
  const bannerContainer = document.getElementById("critical-banner-container");

  if (bannerContainer) {
    if (overdueCount > 0 || todayCount > 0) {
      bannerContainer.innerHTML = `
        <div class="critical-banner">
          <div class="critical-banner-pills">
            ${overdueCount > 0 ? `<span class="banner-pill">🚨 ${overdueCount} RETRASADO${overdueCount > 1 ? "S" : ""}</span>` : ""}
            ${todayCount > 0 ? `<span class="banner-pill" style="background:var(--warning);">⚡ ${todayCount} PARA HOY</span>` : ""}
          </div>
          <span>Revisa los pedidos pendientes</span>
        </div>
      `;
    } else {
      bannerContainer.innerHTML = "";
    }
  }
}

function priorityLevel(order) {
  if (order.estado === "Entregado") return "delivered";
  const today = new Date().toISOString().split("T")[0];
  if (!order.fechaEntrega) return "scheduled";
  if (order.fechaEntrega < today) return "overdue";
  if (order.fechaEntrega === today) return "today";
  return "scheduled";
}

// ============================================================================
// ENRUTADOR DE VISTAS
// ============================================================================
function renderCurrentTab() {
  const container = document.getElementById("main-content");
  
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === state.currentTab);
  });

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
    case "clients":
      renderClientsView(container);
      break;
    case "products":
      renderProductsView(container);
      break;
    case "history":
      renderHistoryView(container);
      break;
    case "settings":
      renderSettingsView(container);
      break;
  }
}

// ============================================================================
// VISTA: HOY / URGENTES
// ============================================================================
function renderTodayView(container) {
  const todayStr = new Date().toISOString().split("T")[0];
  const urgentOrders = state.orders.filter(o => o.estado !== "Entregado" && (o.fechaEntrega <= todayStr || priorityLevel(o) === "overdue"));

  urgentOrders.sort((a, b) => {
    const prioA = priorityLevel(a) === "overdue" ? 0 : 1;
    const prioB = priorityLevel(b) === "overdue" ? 0 : 1;
    return prioA - prioB;
  });

  let html = `
    <div class="view-header">
      <div>
        <h2 class="view-title">⚡ Despachos de Hoy & Urgentes</h2>
        <p class="view-subtitle">Pedidos programados para entregar o en retraso (${urgentOrders.length})</p>
      </div>
      <button class="secondary-btn" onclick="switchTab('new-order')">➕ Nuevo Pedido</button>
    </div>
  `;

  if (urgentOrders.length === 0) {
    html += `
      <div style="text-align:center; padding: 40px 20px; background:var(--bg-card); border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <span style="font-size:40px;">🎉</span>
        <h3 style="margin-top:10px; font-weight:800;">¡Todo al día!</h3>
        <p style="color:var(--text-muted); font-size:13px; margin-top:4px;">No hay pedidos pendientes para hoy. Puedes revisar la pestaña de Producción o registrar uno nuevo.</p>
      </div>
    `;
  } else {
    html += urgentOrders.map(renderOrderCard).join("");
  }

  container.innerHTML = html;
}

// ============================================================================
// VISTA: PRODUCCIÓN / TABLERO
// ============================================================================
function renderOrdersView(container) {
  let filtered = state.orders.filter(o => o.estado !== "Entregado");
  if (state.orderFilter !== "all") {
    filtered = filtered.filter(o => o.estado.toLowerCase().includes(state.orderFilter));
  }

  let html = `
    <div class="view-header">
      <div>
        <h2 class="view-title">📋 Control de Producción</h2>
        <p class="view-subtitle">Pedidos en taller y empaque (${filtered.length})</p>
      </div>
      <button class="secondary-btn" onclick="switchTab('new-order')">➕ Nuevo Pedido</button>
    </div>

    <div class="filter-bar">
      <button class="filter-chip ${state.orderFilter === 'all' ? 'active' : ''}" onclick="setOrderFilter('all')">Todos (${state.orders.filter(o => o.estado !== 'Entregado').length})</button>
      <button class="filter-chip ${state.orderFilter === 'pendiente' ? 'active' : ''}" onclick="setOrderFilter('pendiente')">⏳ Pendientes</button>
      <button class="filter-chip ${state.orderFilter === 'producción' || state.orderFilter === 'produccion' ? 'active' : ''}" onclick="setOrderFilter('produccion')">🥣 En Producción</button>
      <button class="filter-chip ${state.orderFilter === 'listo' ? 'active' : ''}" onclick="setOrderFilter('listo')">✅ Listos / Empacados</button>
    </div>
  `;

  if (filtered.length === 0) {
    html += `
      <div style="text-align:center; padding: 40px 20px; background:var(--bg-card); border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <p style="color:var(--text-muted);">No hay pedidos en esta categoría.</p>
      </div>
    `;
  } else {
    html += filtered.map(renderOrderCard).join("");
  }

  container.innerHTML = html;
}

function setOrderFilter(f) {
  state.orderFilter = f;
  renderOrdersView(document.getElementById("main-content"));
}

// ============================================================================
// COMPONENTE: TARJETA DE PEDIDO
// ============================================================================
function renderOrderCard(order) {
  const prio = priorityLevel(order);
  const isDelivery = order.tipoEntrega === "Delivery";
  
  let cardClass = "order-card";
  if (prio === "overdue") cardClass += " overdue";
  else if (prio === "today") cardClass += " today";

  let statusClass = "status-pendiente";
  if (order.estado === "En Producción") statusClass = "status-produccion";
  else if (order.estado === "Listo" || order.estado === "Listo / Empacado") statusClass = "status-listo";
  else if (order.estado === "Entregado") statusClass = "status-entregado";

  return `
    <div class="${cardClass}" onclick="openOrderDetailModal('${order.id}')">
      <div class="order-head">
        <div class="order-id-group">
          <span class="order-id">${order.id}</span>
          <span class="order-client">${escapeHtml(order.cliente)}</span>
        </div>
        <div>
          ${prio === 'overdue' ? '<span class="pill-overdue">🚨 RETRASADO</span>' : ''}
          ${prio === 'today' ? '<span class="pill-today">⚡ HOY</span>' : ''}
          ${prio === 'scheduled' ? '<span class="pill-scheduled">📅 ' + formatDate(order.fechaEntrega) + '</span>' : ''}
        </div>
      </div>

      <div style="display:flex; gap:6px; margin: 4px 0; flex-wrap:wrap;">
        <span class="status-badge ${statusClass}">${order.estado}</span>
        ${isDelivery ? `<span class="badge-delivery">🚚 Delivery: ${escapeHtml(order.zonaDireccion || 'Dirección indicada')}</span>` : `<span class="badge-pickup">🏪 Retiro en Tienda</span>`}
        ${order.notificadoWA === 'Sí' ? `<span style="font-size:11px; background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:4px; font-weight:700;">💬 Notificado</span>` : ''}
      </div>

      <div class="order-items-preview">
        🥣 ${escapeHtml(order.productosDetalle || 'Sin detalle')}
      </div>

      ${order.notas ? `<div class="card-note-preview">📝 ${escapeHtml(order.notas)}</div>` : ''}

      <div class="order-meta-grid">
        <span>⏰ ${escapeHtml(order.horaEntrega || 'Horario flexible')} · 👤 ${escapeHtml(order.responsable || 'Sin Asignar')}</span>
        <span class="order-total-price">$${Number(order.totalUsd || 0).toFixed(2)}</span>
      </div>
    </div>
  `;
}

// ============================================================================
// VISTA: REGISTRAR NUEVO PEDIDO
// ============================================================================
let orderBuilderItems = {};

function renderNewOrderView(container) {
  orderBuilderItems = {};
  state.products.forEach(p => {
    if (p.activo) orderBuilderItems[p.id] = 0;
  });

  const todayStr = new Date().toISOString().split("T")[0];

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">➕ Registrar Nuevo Pedido</h2>
        <p class="view-subtitle">Selecciona los productos y completa los datos del cliente</p>
      </div>
    </div>

    <form id="form-new-order" class="form-grid" onsubmit="handleCreateOrder(event)">
      <div class="field">
        <span class="field-label">🥣 PRODUCTOS DEL PEDIDO</span>
        <div class="product-builder-list">
          ${state.products.filter(p => p.activo).map(p => `
            <div class="product-builder-item">
              <div class="product-builder-info">
                <div class="product-builder-title">${escapeHtml(p.nombre)}</div>
                <div class="product-builder-meta">Presentación: <strong>${escapeHtml(p.presentacion)}</strong> · Precio: <strong>$${Number(p.precio).toFixed(2)}</strong></div>
              </div>
              <div class="qty-counter">
                <button type="button" class="qty-btn" onclick="updateQty('${p.id}', -1)">-</button>
                <span id="qty-${p.id}" class="qty-val">0</span>
                <button type="button" class="qty-btn" onclick="updateQty('${p.id}', 1)">+</button>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="total-summary-card">
          <span class="total-summary-label">Total Estimado del Pedido:</span>
          <span id="display-total-price" class="total-summary-val">$0.00</span>
        </div>
      </div>

      <div class="field">
        <span class="field-label">CLIENTE</span>
        <select id="select-frequent-client" onchange="fillClientData(this.value)">
          <option value="">-- Seleccionar cliente guardado o escribir nuevo --</option>
          ${state.clients.map((c, i) => `<option value="${i}">${escapeHtml(c.nombre)} (${escapeHtml(c.telefono || 'Sin tel')})</option>`).join('')}
        </select>
        <input id="input-client-name" name="cliente" required placeholder="Nombre completo del cliente" style="margin-top:6px;">
      </div>

      <div class="field">
        <span class="field-label">TELÉFONO / WHATSAPP</span>
        <input id="input-client-phone" name="telefono" type="tel" placeholder="Ej: 04141234567">
      </div>

      <div class="field">
        <span class="field-label">MODALIDAD DE ENTREGA</span>
        <select id="select-delivery-type" name="tipoEntrega" onchange="toggleDeliveryFields(this.value)">
          <option value="Retiro en Tienda">🏪 Retiro en Tienda / Local</option>
          <option value="Delivery">🚚 Delivery / Envío a Domicilio</option>
        </select>
      </div>

      <div id="delivery-address-group" class="field" style="display:none;">
        <span class="field-label">DIRECCIÓN DE ENTREGA Y ZONA</span>
        <input id="input-delivery-address" name="zonaDireccion" placeholder="Zona, calle, punto de referencia">
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div class="field">
          <span class="field-label">FECHA DE ENTREGA</span>
          <input name="fechaEntrega" type="date" value="${todayStr}" required>
        </div>
        <div class="field">
          <span class="field-label">HORARIO ESTIMADO</span>
          <select name="horaEntrega">
            <option value="Mañana (9am - 12pm)">Mañana (9am - 12pm)</option>
            <option value="Tarde (2pm - 5pm)" selected>Tarde (2pm - 5pm)</option>
            <option value="Inmediato">Inmediato ⚡</option>
            <option value="A convenir">A convenir con el cliente</option>
          </select>
        </div>
      </div>

      <div class="field">
        <span class="field-label">RESPONSABLE ASIGNADO</span>
        <select name="responsable">
          ${state.users.map(u => `<option value="${escapeHtml(u.name)}" ${u.name === state.user.name ? 'selected' : ''}>${escapeHtml(u.name)} (${u.role})</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <span class="field-label">NOTAS / INDICACIONES ESPECIALES</span>
        <textarea name="notas" rows="2" placeholder="Ej: Sin pasas, para regalo con lazo, cobro en efectivo..."></textarea>
      </div>

      <button type="submit" id="btn-submit-order" class="primary-btn" style="margin-top:10px;">
        💾 Guardar y Registrar Pedido
      </button>
    </form>
  `;
}

function updateQty(prodId, delta) {
  const current = orderBuilderItems[prodId] || 0;
  const next = Math.max(0, current + delta);
  orderBuilderItems[prodId] = next;

  const qtyEl = document.getElementById(`qty-${prodId}`);
  if (qtyEl) qtyEl.textContent = next;

  calculateOrderTotal();
}

function calculateOrderTotal() {
  let total = 0;
  state.products.forEach(p => {
    const q = orderBuilderItems[p.id] || 0;
    total += q * (p.precio || 0);
  });

  const totalEl = document.getElementById("display-total-price");
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
}

function fillClientData(idx) {
  if (idx === "") return;
  const client = state.clients[idx];
  if (!client) return;

  document.getElementById("input-client-name").value = client.nombre || "";
  document.getElementById("input-client-phone").value = client.telefono || "";
  
  if (client.delivery === "Sí") {
    document.getElementById("select-delivery-type").value = "Delivery";
    toggleDeliveryFields("Delivery");
    document.getElementById("input-delivery-address").value = client.direccion || client.zona || "";
  } else {
    document.getElementById("select-delivery-type").value = "Retiro en Tienda";
    toggleDeliveryFields("Retiro en Tienda");
  }
}

function toggleDeliveryFields(type) {
  const group = document.getElementById("delivery-address-group");
  if (group) group.style.display = type === "Delivery" ? "flex" : "none";
}

async function handleCreateOrder(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById("btn-submit-order");
  btn.disabled = true;
  btn.textContent = "Registrando pedido...";

  let itemsSummary = [];
  let totalUsd = 0;

  state.products.forEach(p => {
    const q = orderBuilderItems[p.id] || 0;
    if (q > 0) {
      const sub = q * p.precio;
      totalUsd += sub;
      itemsSummary.push(`${q}x ${p.nombre} (${p.presentacion}) - $${sub.toFixed(2)}`);
    }
  });

  if (itemsSummary.length === 0) {
    alert("Debes seleccionar al menos un producto con el botón (+).");
    btn.disabled = false;
    btn.textContent = "💾 Guardar y Registrar Pedido";
    return;
  }

  const formData = new FormData(form);
  const payload = {
    cliente: formData.get("cliente"),
    telefono: formData.get("telefono"),
    tipoEntrega: formData.get("tipoEntrega"),
    zonaDireccion: formData.get("zonaDireccion") || "",
    productosDetalle: itemsSummary.join(" + "),
    totalUsd: totalUsd,
    fechaEntrega: formData.get("fechaEntrega"),
    horaEntrega: formData.get("horaEntrega"),
    responsable: formData.get("responsable"),
    notas: formData.get("notas"),
    estado: "Pendiente"
  };

  try {
    const res = await apiCall("create_order", payload);
    showToast(`✅ Pedido ${res.id || ''} guardado con éxito`);
    await loadData(false);
    switchTab("today");
  } catch (err) {
    alert("Error al guardar: " + err.message);
    btn.disabled = false;
    btn.textContent = "💾 Guardar y Registrar Pedido";
  }
}

// ============================================================================
// MODAL: DETALLE Y ACCIONES DEL PEDIDO
// ============================================================================
function openOrderDetailModal(orderId) {
  const order = state.orders.find(o => o.id === orderId) || (state.history || []).find(o => o.id === orderId);
  if (!order) return;

  const isDelivered = order.estado === "Entregado";
  const isDelivery = order.tipoEntrega === "Delivery";

  openModal(`
    <div class="modal-head">
      <div>
        <span class="order-id">${order.id}</span>
        <h3 style="margin-top:4px; font-size:18px;">${escapeHtml(order.cliente)}</h3>
      </div>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>

    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:16px;">
      <div style="background:var(--border-light); padding:12px; border-radius:var(--radius-sm);">
        <div style="font-size:11px; font-weight:800; color:var(--text-muted); margin-bottom:4px;">PRODUCTOS / DETALLE:</div>
        <div style="font-weight:700; font-size:15px; color:var(--primary);">${escapeHtml(order.productosDetalle)}</div>
        <div style="font-size:16px; font-weight:800; margin-top:6px; color:var(--secondary);">Total: $${Number(order.totalUsd || 0).toFixed(2)}</div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px;">
        <div><strong>Modalidad:</strong> ${isDelivery ? '🚚 Delivery' : '🏪 Retiro en Tienda'}</div>
        <div><strong>Estado actual:</strong> <span class="status-badge status-listo">${order.estado}</span></div>
        <div><strong>Fecha acordada:</strong> ${formatDate(order.fechaEntrega)}</div>
        <div><strong>Horario:</strong> ${escapeHtml(order.horaEntrega || 'Flexible')}</div>
        <div><strong>Teléfono:</strong> ${order.telefono ? `<a href="tel:${order.telefono}" style="color:var(--primary);">${order.telefono}</a>` : 'No registrado'}</div>
        <div><strong>Responsable:</strong> ${escapeHtml(order.responsable)}</div>
      </div>

      ${order.zonaDireccion ? `<div style="font-size:13px; background:var(--bg-app); padding:8px; border-radius:6px;"><strong>Dirección / Zona:</strong> ${escapeHtml(order.zonaDireccion)}</div>` : ''}
      ${order.notas ? `<div style="font-size:13px; background:var(--warning-light); padding:8px; border-radius:6px; color:var(--text-main);"><strong>Notas:</strong> ${escapeHtml(order.notas)}</div>` : ''}
    </div>

    <div style="display:flex; flex-direction:column; gap:8px;">
      ${!isDelivered ? `
        <div class="btn-row">
          ${order.estado === 'Pendiente' ? `
            <button class="primary-btn" onclick="changeOrderStatus('${order.id}', 'En Producción')">🥣 Iniciar Producción</button>
          ` : ''}
          ${order.estado === 'En Producción' ? `
            <button class="primary-btn" style="background:var(--secondary);" onclick="changeOrderStatus('${order.id}', 'Listo')">✅ Marcar Listo / Empacado</button>
          ` : ''}
          ${order.estado === 'Listo' || order.estado === 'Listo / Empacado' ? `
            <button class="primary-btn" style="background:var(--secondary);" onclick="changeOrderStatus('${order.id}', 'Entregado')">📦 Confirmar Entrega / Despacho</button>
          ` : ''}
          ${isManager() && order.estado !== 'Listo' && order.estado !== 'Listo / Empacado' ? `
            <button class="secondary-btn" onclick="changeOrderStatus('${order.id}', 'Entregado')">📦 Entrega Directa</button>
          ` : ''}
        </div>
      ` : ''}

      <div class="btn-row">
        ${order.telefono ? `
          <button class="wa-btn" onclick="sendWhatsAppReceipt('${order.id}')">💬 Enviar Recibo WhatsApp</button>
        ` : ''}
        ${!isDelivered && isManager() ? `
          <button class="secondary-btn" onclick="openRescheduleModal('${order.id}')">📅 Cambiar Fecha</button>
        ` : ''}
      </div>
    </div>
  `);
}

async function changeOrderStatus(orderId, newStatus) {
  if (newStatus === "Entregado" && !confirm(`¿Confirmar que el pedido ${orderId} fue entregado al cliente / despachado?`)) {
    return;
  }

  try {
    showToast(`Actualizando a "${newStatus}"...`);
    await apiCall("update_status", { id: orderId, status: newStatus });
    closeModal();
    await loadData(false);
    showToast(`✅ Pedido ${orderId} actualizado`);
  } catch (err) {
    alert("Error al actualizar estado: " + err.message);
  }
}

function sendWhatsAppReceipt(orderId) {
  const order = state.orders.find(o => o.id === orderId) || (state.history || []).find(o => o.id === orderId);
  if (!order || !order.telefono) return;

  let cleanPhone = order.telefono.replace(/\\D/g, "");
  if (!cleanPhone.startsWith("58") && cleanPhone.startsWith("0")) {
    cleanPhone = "58" + cleanPhone.slice(1);
  } else if (!cleanPhone.startsWith("58") && cleanPhone.length === 10) {
    cleanPhone = "58" + cleanPhone;
  }

  const msg = `⚡🥣 *GRANOLA ZEUS* 🥣⚡\\n¡Hola *${order.cliente}*! 👋\\n\\nTu pedido *#${order.id}* está listo:\\n📦 *Detalle:*\\n${order.productosDetalle}\\n\\n💰 *Total a pagar:* $${Number(order.totalUsd).toFixed(2)}\\n🚚 *Modalidad:* ${order.tipoEntrega}${order.zonaDireccion ? ' (' + order.zonaDireccion + ')' : ''}\\n📅 *Fecha:* ${formatDate(order.fechaEntrega)} - ${order.horaEntrega}\\n\\n¡Muchas gracias por apoyar nuestra producción artesanal! ✨`;

  const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;
  
  apiCall("mark_whatsapp", { id: orderId }).catch(console.error);
  order.notificadoWA = "Sí";

  window.open(url, "_blank");
}

function openRescheduleModal(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  openModal(`
    <div class="modal-head">
      <h3>📅 Cambiar Fecha de Entrega</h3>
      <button class="close-btn" onclick="openOrderDetailModal('${orderId}')">×</button>
    </div>
    <form id="form-reschedule" class="form-grid" onsubmit="handleReschedule(event, '${orderId}')">
      <div class="field">
        <span class="field-label">NUEVA FECHA</span>
        <input name="fechaEntrega" type="date" value="${order.fechaEntrega}" required>
      </div>
      <div class="field">
        <span class="field-label">NUEVO HORARIO ESTIMADO</span>
        <select name="horaEntrega">
          <option value="Mañana (9am - 12pm)">Mañana (9am - 12pm)</option>
          <option value="Tarde (2pm - 5pm)">Tarde (2pm - 5pm)</option>
          <option value="Inmediato">Inmediato ⚡</option>
          <option value="A convenir">A convenir</option>
        </select>
      </div>
      <div class="field">
        <span class="field-label">MOTIVO DEL CAMBIO / NOTA</span>
        <input name="notas" placeholder="Ej: Cliente solicitó aplazar para el viernes">
      </div>
      <div class="btn-row" style="margin-top:10px;">
        <button type="button" class="secondary-btn" onclick="openOrderDetailModal('${orderId}')">Cancelar</button>
        <button type="submit" class="primary-btn">Guardar Nueva Fecha</button>
      </div>
    </form>
  `);
}

async function handleReschedule(e, orderId) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await apiCall("update_order", { id: orderId, ...data });
    showToast("Fecha reprogramada correctamente");
    closeModal();
    await loadData(false);
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================================
// VISTA: CLIENTES FRECUENTES
// ============================================================================
function renderClientsView(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">👥 Directorio de Clientes</h2>
        <p class="view-subtitle">Clientes registrados con datos de entrega (${state.clients.length})</p>
      </div>
      <button class="primary-btn" style="flex:0;" onclick="openNewClientModal()">➕ Nuevo Cliente</button>
    </div>

    <div style="display:flex; flex-direction:column; gap:10px;">
      ${state.clients.map((c, i) => `
        <div class="product-builder-item" style="align-items:flex-start;">
          <div>
            <div style="font-weight:800; font-size:15px;">${escapeHtml(c.nombre)}</div>
            <div style="font-size:13px; color:var(--text-muted); margin-top:2px;">
              📞 ${c.telefono ? `<a href="tel:${c.telefono}" style="color:var(--primary); font-weight:700;">${c.telefono}</a>` : 'Sin teléfono'}
              · ${c.delivery === 'Sí' ? '🚚 Delivery Habitual' : '🏪 Retira en Tienda'}
            </div>
            ${c.direccion || c.zona ? `<div style="font-size:12px; color:var(--text-light); margin-top:2px;">📍 ${escapeHtml(c.zona ? c.zona + ' - ' : '')}${escapeHtml(c.direccion || '')}</div>` : ''}
          </div>
          <div style="display:flex; gap:6px;">
            ${c.telefono ? `<button class="secondary-btn" style="padding:6px 10px;" onclick="directWhatsAppClient('${c.telefono}', '${c.nombre}')">💬</button>` : ''}
            <button class="secondary-btn" style="padding:6px 10px;" onclick="openEditClientModal(${i})">✏️</button>
          </div>
        </div>
      `).join('') || '<p style="color:var(--text-muted); text-align:center;">No hay clientes registrados.</p>'}
    </div>
  `;
}

function directWhatsAppClient(phone, name) {
  let clean = phone.replace(/\\D/g, "");
  if (!clean.startsWith("58") && clean.startsWith("0")) clean = "58" + clean.slice(1);
  const msg = `¡Hola ${name}! Te escribimos de Granola Zeus ⚡🥣`;
  window.open(`https://api.whatsapp.com/send?phone=${clean}&text=${encodeURIComponent(msg)}`, "_blank");
}

function openNewClientModal() {
  openModal(`
    <div class="modal-head">
      <h3>➕ Registrar Cliente Frecuente</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <form class="form-grid" onsubmit="handleSaveClient(event)">
      <div class="field">
        <span class="field-label">NOMBRE DEL CLIENTE</span>
        <input name="nombre" required placeholder="Nombre y Apellido">
      </div>
      <div class="field">
        <span class="field-label">TELÉFONO / WHATSAPP</span>
        <input name="telefono" type="tel" placeholder="04141234567">
      </div>
      <div class="field">
        <span class="field-label">MODALIDAD HABITUAL</span>
        <select name="delivery">
          <option value="No">🏪 Retiro en Tienda</option>
          <option value="Sí">🚚 Delivery</option>
        </select>
      </div>
      <div class="field">
        <span class="field-label">ZONA / SECTOR</span>
        <input name="zona" placeholder="Ej: Norte, Este, Casco Central">
      </div>
      <div class="field">
        <span class="field-label">DIRECCIÓN COMPLETA</span>
        <input name="direccion" placeholder="Calle, casa/edificio, punto de referencia">
      </div>
      <button type="submit" class="primary-btn">Guardar Cliente</button>
    </form>
  `);
}

function openEditClientModal(idx) {
  const c = state.clients[idx];
  if (!c) return;

  openModal(`
    <div class="modal-head">
      <h3>✏️ Editar Cliente</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <form class="form-grid" onsubmit="handleSaveClient(event, '${c.nombre}')">
      <div class="field">
        <span class="field-label">NOMBRE</span>
        <input name="nombre" value="${escapeHtml(c.nombre)}" required>
      </div>
      <div class="field">
        <span class="field-label">TELÉFONO</span>
        <input name="telefono" type="tel" value="${escapeHtml(c.telefono || '')}">
      </div>
      <div class="field">
        <span class="field-label">MODALIDAD HABITUAL</span>
        <select name="delivery">
          <option value="No" ${c.delivery !== 'Sí' ? 'selected' : ''}>🏪 Retiro en Tienda</option>
          <option value="Sí" ${c.delivery === 'Sí' ? 'selected' : ''}>🚚 Delivery</option>
        </select>
      </div>
      <div class="field">
        <span class="field-label">ZONA</span>
        <input name="zona" value="${escapeHtml(c.zona || '')}">
      </div>
      <div class="field">
        <span class="field-label">DIRECCIÓN</span>
        <input name="direccion" value="${escapeHtml(c.direccion || '')}">
      </div>
      <div class="btn-row">
        <button type="button" class="danger-btn" onclick="deleteClient('${c.nombre}')">🗑️ Eliminar</button>
        <button type="submit" class="primary-btn">Guardar Cambios</button>
      </div>
    </form>
  `);
}

async function handleSaveClient(e, originalName = null) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    if (originalName) {
      await apiCall("edit_client", { nombreOriginal: originalName, ...data });
      showToast("Cliente actualizado");
    } else {
      await apiCall("create_client", data);
      showToast("Cliente registrado");
    }
    closeModal();
    await loadData(false);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteClient(name) {
  if (!confirm(`¿Eliminar al cliente "${name}"?`)) return;
  try {
    await apiCall("delete_client", { nombre: name });
    closeModal();
    await loadData(false);
    showToast("Cliente eliminado");
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================================
// VISTA: CATÁLOGO DE PRODUCTOS
// ============================================================================
function renderProductsView(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">🥣 Catálogo de Productos</h2>
        <p class="view-subtitle">Gestión de recetas, presentaciones y precios (${state.products.length})</p>
      </div>
      ${isManager() ? `<button class="primary-btn" style="flex:0;" onclick="openNewProductModal()">➕ Nuevo Producto</button>` : ''}
    </div>

    <div style="display:flex; flex-direction:column; gap:10px;">
      ${state.products.map((p, i) => `
        <div class="product-builder-item">
          <div>
            <div style="font-weight:800; font-size:15px;">${escapeHtml(p.nombre)}</div>
            <div style="font-size:13px; color:var(--text-muted); margin-top:2px;">
              Presentación: <strong>${escapeHtml(p.presentacion)}</strong> · Precio: <strong style="color:var(--secondary);">$${Number(p.precio).toFixed(2)}</strong>
              ${p.activo ? '<span style="color:#15803d; font-weight:700;"> · Activo</span>' : '<span style="color:#dc2626; font-weight:700;"> · Inactivo</span>'}
            </div>
            ${p.notas ? `<div style="font-size:11px; color:var(--text-light);">${escapeHtml(p.notas)}</div>` : ''}
          </div>
          ${isManager() ? `
            <button class="secondary-btn" style="padding:6px 12px;" onclick="openEditProductModal('${p.id}')">✏️ Editar</button>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function openNewProductModal() {
  openModal(`
    <div class="modal-head">
      <h3>➕ Añadir Nuevo Producto</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <form class="form-grid" onsubmit="handleSaveProduct(event)">
      <div class="field">
        <span class="field-label">NOMBRE DEL PRODUCTO</span>
        <input name="nombre" required placeholder="Ej: Granola Proteica Chía & Almendras">
      </div>
      <div class="field">
        <span class="field-label">PRESENTACIÓN / PESO</span>
        <input name="presentacion" required placeholder="Ej: 500g, 1kg, 250g">
      </div>
      <div class="field">
        <span class="field-label">PRECIO (USD $)</span>
        <input name="precio" type="number" step="0.5" required placeholder="Ej: 8.50">
      </div>
      <div class="field">
        <span class="field-label">DESCRIPCIÓN / INGREDIENTES</span>
        <input name="notas" placeholder="Ej: Avena tostada, semillas de chía, almendras laminadas">
      </div>
      <button type="submit" class="primary-btn">Guardar en Catálogo</button>
    </form>
  `);
}

function openEditProductModal(prodId) {
  const p = state.products.find(item => item.id === prodId);
  if (!p) return;

  openModal(`
    <div class="modal-head">
      <h3>✏️ Editar Producto</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <form class="form-grid" onsubmit="handleSaveProduct(event, '${p.id}')">
      <div class="field">
        <span class="field-label">NOMBRE</span>
        <input name="nombre" value="${escapeHtml(p.nombre)}" required>
      </div>
      <div class="field">
        <span class="field-label">PRESENTACIÓN</span>
        <input name="presentacion" value="${escapeHtml(p.presentacion)}" required>
      </div>
      <div class="field">
        <span class="field-label">PRECIO (USD $)</span>
        <input name="precio" type="number" step="0.5" value="${p.precio}" required>
      </div>
      <div class="field">
        <span class="field-label">ESTADO</span>
        <select name="activo">
          <option value="true" ${p.activo ? 'selected' : ''}>Activo (Disponible para pedidos)</option>
          <option value="false" ${!p.activo ? 'selected' : ''}>Inactivo (Oculto)</option>
        </select>
      </div>
      <div class="field">
        <span class="field-label">DESCRIPCIÓN</span>
        <input name="notas" value="${escapeHtml(p.notas || '')}">
      </div>
      <div class="btn-row">
        <button type="button" class="danger-btn" onclick="deleteProduct('${p.id}')">🗑️ Eliminar</button>
        <button type="submit" class="primary-btn">Guardar Cambios</button>
      </div>
    </form>
  `);
}

async function handleSaveProduct(e, prodId = null) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.activo = data.activo === "true" || data.activo === true;
  try {
    if (prodId) {
      await apiCall("edit_product", { id: prodId, ...data });
      showToast("Producto actualizado");
    } else {
      await apiCall("create_product", data);
      showToast("Producto añadido al catálogo");
    }
    closeModal();
    await loadData(false);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteProduct(prodId) {
  if (!confirm("¿Eliminar este producto del catálogo?")) return;
  try {
    await apiCall("delete_product", { id: prodId });
    closeModal();
    await loadData(false);
    showToast("Producto eliminado");
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================================
// VISTA: HISTORIAL Y ENTREGADOS
// ============================================================================
async function renderHistoryView(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">📦 Historial de Despachos</h2>
        <p class="view-subtitle">Pedidos entregados y métricas</p>
      </div>
      <button class="secondary-btn" onclick="loadHistoryData()">↻ Cargar Historial</button>
    </div>
    <div id="history-content">
      <div class="loading-state"><div class="spinner"></div><p>Cargando historial...</p></div>
    </div>
  `;

  await loadHistoryData();
}

async function loadHistoryData() {
  const container = document.getElementById("history-content");
  if (!container) return;

  try {
    const res = await apiCall("history");
    state.history = res.history || [];

    if (state.history.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; background:var(--bg-card); border-radius:var(--radius-md); border:1px solid var(--border-color);">
          <p style="color:var(--text-muted);">Aún no hay pedidos entregados en el historial.</p>
        </div>
      `;
      return;
    }

    let totalUsd = state.history.reduce((acc, o) => acc + Number(o.totalUsd || 0), 0);

    container.innerHTML = `
      <div class="total-summary-card" style="margin-bottom:16px;">
        <div>
          <span style="font-size:12px; font-weight:700; color:var(--text-muted);">TOTAL DESPACHADOS:</span>
          <div style="font-size:20px; font-weight:800;">${state.history.length} Pedidos</div>
        </div>
        <div>
          <span style="font-size:12px; font-weight:700; color:var(--text-muted);">MONTO TOTAL:</span>
          <div style="font-size:20px; font-weight:800; color:var(--secondary); font-family:var(--font-mono);">$${totalUsd.toFixed(2)}</div>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        ${state.history.map(renderOrderCard).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger); text-align:center;">Error al cargar historial: ${err.message}</p>`;
  }
}

// ============================================================================
// VISTA: AJUSTES Y CONFIGURACIÓN
// ============================================================================
function renderSettingsView(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h2 class="view-title">⚙️ Ajustes del Sistema</h2>
        <p class="view-subtitle">Conexión, usuario activo y personalización</p>
      </div>
    </div>

    <div class="form-grid">
      <div style="background:var(--bg-card); padding:16px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <h3 style="font-size:15px; font-weight:800; margin-bottom:8px;">👤 Perfil de Usuario</h3>
        <p style="font-size:13px; color:var(--text-muted);">Usuario actual: <strong>${escapeHtml(state.user.name)}</strong> (${state.user.role})</p>
        <div style="margin-top:10px; display:flex; gap:8px;">
          <button class="secondary-btn" onclick="switchUserRole()">Cambiar a ${state.user.role === 'manager' ? 'Operador (Worker)' : 'Manager (Admin)'}</button>
        </div>
      </div>

      <div style="background:var(--bg-card); padding:16px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <h3 style="font-size:15px; font-weight:800; margin-bottom:8px;">🌐 Conexión Google Sheets Backend</h3>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">URL de la Web App desplegada en Google Apps Script:</p>
        <input id="input-api-url" value="${escapeHtml(API_URL)}" placeholder="https://script.google.com/macros/s/.../exec">
        <button class="primary-btn" style="margin-top:10px;" onclick="saveApiUrl()">💾 Guardar URL de Backend</button>
      </div>

      <div style="background:var(--bg-card); padding:16px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <h3 style="font-size:15px; font-weight:800; margin-bottom:8px;">🎓 Guía de Operación</h3>
        <button class="secondary-btn" onclick="openGuideModal()">Abrir Manual de Uso</button>
      </div>
    </div>
  `;
}

function saveApiUrl() {
  const url = document.getElementById("input-api-url").value.trim();
  if (!url) return alert("Por favor ingresa una URL válida");
  API_URL = url;
  localStorage.setItem("gz_api_url", url);
  showToast("URL de API guardada");
  loadData();
}

function switchUserRole() {
  if (state.user.role === "manager") {
    state.user = { id: "USR-002", name: "Operador Taller", role: "worker", email: "produccion@granolazeus.com" };
  } else {
    state.user = { id: "USR-001", name: "Admin Zeus", role: "manager", email: "admin@granolazeus.com" };
  }
  localStorage.setItem("gz_user", JSON.stringify(state.user));
  document.getElementById("user-name-display").textContent = state.user.name;
  showToast(`Cambiado a rol: ${state.user.name} (${state.user.role})`);
  renderCurrentTab();
}

// ============================================================================
// MODAL DE GUÍA
// ============================================================================
function openGuideModal() {
  openModal(`
    <div class="modal-head">
      <h3>🎓 Manual de Operación – Granola Zeus</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div>
      <div class="guide-card">
        <div class="guide-step-title">1. 🥣 Registro Rápido de Pedidos</div>
        <div class="guide-desc">Usa los botones (+) y (-) para seleccionar las cantidades de granola de cada sabor. El total se calcula automáticamente. Si el cliente tiene Delivery, el sistema te pedirá la dirección y zona.</div>
      </div>
      <div class="guide-card">
        <div class="guide-step-title">2. ⏱️ Flujo de Producción</div>
        <div class="guide-desc"><strong>Pendiente:</strong> Orden recibida.<br><strong>En Producción:</strong> Horneando, mezclando o empacando.<br><strong>Listo:</strong> Empaque sellado con etiqueta.<br><strong>Entregado:</strong> Despachado al cliente.</div>
      </div>
      <div class="guide-card">
        <div class="guide-step-title">3. 💬 Notificaciones por WhatsApp</div>
        <div class="guide-desc">Con un solo toque en el botón "WhatsApp" del pedido, se abre un mensaje pre-formateado con el desglose de productos y total en dólares para enviar al cliente.</div>
      </div>
      <div class="guide-card">
        <div class="guide-step-title">4. 🚚 Prioridad de Despacho</div>
        <div class="guide-desc">Las tarjetas en rojo (🚨 RETRASADO) o ámbar (⚡ HOY) te alertan qué pedidos deben salir de cocina primero.</div>
      </div>
    </div>
  `);
}

// ============================================================================
// HELPERS Y EVENTOS
// ============================================================================
function isManager() {
  return state.user && state.user.role === "manager";
}

function switchTab(tab) {
  state.currentTab = tab;
  renderCurrentTab();
}

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    showToast("Sincronizando...");
    loadData();
  });

  document.getElementById("btn-theme")?.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  document.getElementById("btn-guide")?.addEventListener("click", openGuideModal);
}

function openModal(html) {
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  if (overlay && body) {
    body.innerHTML = html;
    overlay.style.display = "flex";
  }
}

function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.style.display = "none";
}

function showToast(msg) {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 2600);
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

function formatDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}
