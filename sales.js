// sales.js — Sales module (separate from service)
// Requires: ./supabaseClient.js + ./auth.js (requireAuth / wireSignOut)

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js";

let salesPickups = [];
let pageRole = null; // "sales_manager" or "sales_driver"
let storeId = null;
let salespeople = [];
let drivers = [];
let refreshInterval = null;
let timerInterval = null;

/* ---------- INITIALIZATION ---------- */

function pageKeyFromPath() {
  const file = (
    (window.location.pathname || "").split("/").pop() || ""
  ).toLowerCase();

  if (file === "sales_manager.html") return "sales_manager";
  if (file === "sales_driver.html") return "sales_driver";
  return null;
}

async function initSalesApp() {
  const currentPage = pageKeyFromPath();
  if (!currentPage) {
    console.error("Not a sales page");
    return;
  }

  pageRole = currentPage;

  // Auth gate
  const auth = await requireAuth({ page: currentPage });
  if (!auth?.ok) return; // redirected or blocked

  storeId = auth?.profile?.store_id || null;
  const userRole = auth?.effectiveRole || "";

  // Role guard
  if (pageRole === "sales_manager") {
    // Only owner/gm/sales_manager allowed
    const allowed = ["owner", "manager", "sales_manager"];
    if (!allowed.includes(userRole.toLowerCase())) {
      alert("Access denied. Sales Manager page requires owner/gm/sales_manager role.");
      window.location.href = "index.html";
      return;
    }
  } else if (pageRole === "sales_driver") {
    // Only driver/owner/gm allowed
    const allowed = ["driver", "owner", "manager"];
    if (!allowed.includes(userRole.toLowerCase())) {
      alert("Access denied. Sales Driver page requires driver/owner/gm role.");
      window.location.href = "index.html";
      return;
    }
  }

  // Wire sign out
  wireSignOut();

  // Setup UI
  ensureOpsUI();
  setupCompletedToggle();

  // Load store settings
  await loadStoreSettings();

  // Setup form (manager only)
  if (pageRole === "sales_manager") {
    setupForm();
  }

  // Setup table actions
  setupTableActions();

  // Load data
  await loadSalesPickups();

  // Start refresh intervals
  refreshInterval = setInterval(() => loadSalesPickups(), 5000);
  timerInterval = setInterval(() => renderTables(true), 1000);
}

/* ---------- STORE SETTINGS ---------- */

async function loadStoreSettings() {
  if (!storeId) return;

  try {
    const { data, error } = await supabase
      .from("store_settings")
      .select("salespeople, drivers")
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) {
      console.error("Store settings load error:", error);
      showBanner("error", "Failed to load store settings");
      return;
    }

    if (!data) {
      showBanner("warn", "Store settings not found. Configure salespeople/drivers in Supabase store_settings.");
      return;
    }

    // Parse JSONB arrays
    salespeople = Array.isArray(data.salespeople) ? data.salespeople : [];
    drivers = Array.isArray(data.drivers) ? data.drivers : [];

    if (salespeople.length === 0 || drivers.length === 0) {
      showBanner("warn", "Configure salespeople/drivers in Supabase store_settings.");
    } else {
      hideBanner();
    }

    // Populate salesperson dropdown (manager only)
    if (pageRole === "sales_manager") {
      const select = document.getElementById("salesperson");
      if (select) {
        select.innerHTML = '<option value="">Select salesperson...</option>';
        salespeople.forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        });
      }
    }
  } catch (err) {
    console.error("Store settings error:", err);
    showBanner("error", "Failed to load store settings");
  }
}

/* ---------- BANNER SYSTEM ---------- */

function ensureOpsUI() {
  if (!document.getElementById("globalBanner")) {
    const banner = document.createElement("div");
    banner.id = "globalBanner";
    banner.className = "global-banner hidden";
    const messageSpan = document.createElement("span");
    messageSpan.className = "banner-message";
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "banner-dismiss";
    dismissBtn.textContent = "×";
    dismissBtn.addEventListener("click", () => {
      banner.classList.add("hidden");
    });
    banner.appendChild(messageSpan);
    banner.appendChild(dismissBtn);
    document.body.insertBefore(banner, document.body.firstChild);
  }
}

function showBanner(type, message, details = "") {
  const banner = document.getElementById("globalBanner");
  if (!banner) return;

  banner.className = `global-banner is-${type}`;
  const messageEl = banner.querySelector(".banner-message");
  if (messageEl) {
    messageEl.textContent = message + (details ? ` ${details}` : "");
  }
  banner.classList.remove("hidden");
}

function hideBanner() {
  const banner = document.getElementById("globalBanner");
  if (banner) banner.classList.add("hidden");
}

/* ---------- COMPLETED TOGGLE ---------- */

function setupCompletedToggle() {
  const btn = document.getElementById("toggle-completed");
  const section = document.getElementById("completed-section");
  if (!btn || !section) return;

  // Default to collapsed
  section.classList.add("completed-collapsed");
  btn.textContent = "Show";

  btn.addEventListener("click", () => {
    const collapsed = section.classList.contains("completed-collapsed");
    if (collapsed) {
      section.classList.remove("completed-collapsed");
      btn.textContent = "Hide";
    } else {
      section.classList.add("completed-collapsed");
      btn.textContent = "Show";
    }
  });
}

/* ---------- EVENT LOGGING ---------- */

async function logSalesPickupEvent({ pickupId, storeId, action, payload }) {
  if (!storeId || !pickupId) return;

  try {
    const { data: userData } = await supabase.auth.getUser();
    const actorUserId = userData?.user?.id ?? null;
    const actorRole = pageRole ?? null;

    const { error } = await supabase
      .from("sales_pickup_events")
      .insert([
        {
          pickup_id: pickupId,
          store_id: storeId,
          actor_user_id: actorUserId,
          actor_role: actorRole,
          action,
          payload
        }
      ]);

    if (error) {
      console.warn("sales_event_log_failed", { action, pickupId, error });
    }
  } catch (err) {
    console.warn("sales_event_log_failed", { action, pickupId, error: err });
  }
}

/* ---------- CRUD OPERATIONS ---------- */

async function createSalesPickup({ stock_number, salesperson_name, notes }) {
  if (!storeId || !stock_number || !salesperson_name) {
    showBanner("error", "Missing required fields");
    return;
  }

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("sales_pickups")
    .insert([
      {
        store_id: storeId,
        stock_number,
        salesperson_name,
        notes: notes || null,
        status: "REQUESTED",
        requested_at: nowIso
      }
    ])
    .select()
    .single();

  if (error) {
    console.error("Create sales pickup error:", error);
    showBanner("error", "Failed to create request", error.message);
    return;
  }

  // Log event
  await logSalesPickupEvent({
    pickupId: data.id,
    storeId,
    action: "create_request",
    payload: { stock_number, salesperson_name }
  });

  showBanner("ok", "Request created");
  setTimeout(() => hideBanner(), 2000);

  // Reload data
  await loadSalesPickups();
}

async function updateSalesPickup(id, updates, meta = {}) {
  const action = meta.action || "unknown";

  try {
    let query = supabase
      .from("sales_pickups")
      .update(updates)
      .eq("id", id);

    if (storeId) {
      query = query.eq("store_id", storeId);
    }

    const { data, error } = await query.select("id");

    if (error) {
      showBanner("error", "Save failed", error.message);
      return { success: false, error };
    }

    if (!data || data.length === 0) {
      showBanner("warn", "Update blocked (0 rows)", "Record not found or access denied");
      return { success: false, error: "no_rows" };
    }

    showBanner("ok", "Update saved");
    setTimeout(() => hideBanner(), 2000);

    // Log event
    const payload = {
      updates: Object.keys(updates)
    };
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.notes !== undefined) {
      const noteText = updates.notes || "";
      payload.notePreview = noteText.length > 100 ? noteText.substring(0, 100) + "..." : noteText;
    }

    await logSalesPickupEvent({
      pickupId: id,
      storeId,
      action,
      payload
    });

    return { success: true, rows: data.length };
  } catch (err) {
    showBanner("error", "Save failed", "Unexpected error");
    return { success: false, error: err };
  }
}

async function addNote(pickupId, noteText, userName) {
  const pickup = salesPickups.find((p) => p.id === pickupId);
  if (!pickup) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const newNote = `[${timeStr}] ${userName}: ${noteText}`;
  const updatedNotes = pickup.notes
    ? `${pickup.notes}\n${newNote}`
    : newNote;

  await updateSalesPickup(
    pickupId,
    {
      notes: updatedNotes,
      notes_updated_at: now.toISOString()
    },
    { action: "note_added" }
  );

  await loadSalesPickups();
}

/* ---------- DRIVER ACTIONS ---------- */

function showDropdownModal(title, options) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    const content = document.createElement("div");
    content.style.cssText = `
      background: #0a0b10;
      border: 1px solid #2b2e3a;
      border-radius: 10px;
      padding: 1.5rem;
      min-width: 300px;
    `;

    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.cssText = "font-weight: 600; margin-bottom: 1rem; color: #f5f5f5;";

    const select = document.createElement("select");
    select.className = "input-text";
    select.style.cssText = "width: 100%; margin-bottom: 1rem;";
    select.innerHTML = '<option value="">Select...</option>';
    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });

    const buttonRow = document.createElement("div");
    buttonRow.style.cssText = "display: flex; gap: 0.5rem; justify-content: flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn small";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(null);
    };

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn small btn-primary";
    confirmBtn.textContent = "Confirm";
    confirmBtn.onclick = () => {
      const value = select.value;
      document.body.removeChild(modal);
      resolve(value || null);
    };

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(confirmBtn);

    content.appendChild(titleEl);
    content.appendChild(select);
    content.appendChild(buttonRow);
    modal.appendChild(content);
    document.body.appendChild(modal);
  });
}

async function driverOnTheWay(pickupId) {
  if (drivers.length === 0) {
    showBanner("error", "No drivers configured");
    return;
  }

  const selectedDriver = await showDropdownModal("Select Driver", drivers);
  if (!selectedDriver) return;

  const nowIso = new Date().toISOString();

  await updateSalesPickup(
    pickupId,
    {
      status: "ON_THE_WAY",
      on_the_way_at: nowIso,
      driver_name: selectedDriver
    },
    { action: "driver_on_the_way" }
  );

  await loadSalesPickups();
}

async function driverComplete(pickupId) {
  const nowIso = new Date().toISOString();

  await updateSalesPickup(
    pickupId,
    {
      status: "COMPLETE",
      completed_at: nowIso
    },
    { action: "driver_complete" }
  );

  await loadSalesPickups();
}

async function cancelSalesPickup(pickupId, isManager = false) {
  const reasons = [
    "SWITCHED_STOCK",
    "WRONG_STOCK",
    "AT_MARRIOTT",
    "AT_ARMSTRONG",
    "OTHER"
  ];

  const cancelReason = await showDropdownModal("Select Cancel Reason", reasons);
  if (!cancelReason) return;

  const nowIso = new Date().toISOString();

  await updateSalesPickup(
    pickupId,
    {
      status: "CANCELLED",
      cancelled_at: nowIso,
      cancel_reason: cancelReason
    },
    { action: "cancel_request" }
  );

  await loadSalesPickups();
}

/* ---------- FORM SETUP (MANAGER) ---------- */

function setupForm() {
  const form = document.getElementById("new-sales-request-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const stockInput = document.getElementById("stock-number");
    const salespersonInput = document.getElementById("salesperson");
    const notesInput = document.getElementById("notes");

    const stockNumber = stockInput?.value?.trim();
    const salespersonName = salespersonInput?.value?.trim();
    const notes = notesInput?.value?.trim() || null;

    if (!stockNumber || !salespersonName) {
      showBanner("error", "Stock # and Salesperson are required");
      return;
    }

    await createSalesPickup({ stock_number: stockNumber, salesperson_name: salespersonName, notes });

    // Reset form
    form.reset();
    if (salespersonInput) {
      salespersonInput.innerHTML = '<option value="">Select salesperson...</option>';
      salespeople.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        salespersonInput.appendChild(option);
      });
    }
  });
}

/* ---------- TABLE ACTIONS ---------- */

function setupTableActions() {
  // Delegate click events to table body
  const activeTbody = document.getElementById("active-tbody");
  if (activeTbody) {
    activeTbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      const pickupId = btn.dataset.pickupId;
      if (!pickupId) return;

      const action = btn.dataset.action;
      if (!action) return;

      if (action === "add-note") {
        const noteText = prompt("Enter note:");
        if (!noteText || !noteText.trim()) return;

        const { data: userData } = await supabase.auth.getUser();
        const userName = userData?.user?.email || "Unknown";
        await addNote(pickupId, noteText.trim(), userName);
      } else if (action === "on-the-way") {
        await driverOnTheWay(pickupId);
      } else if (action === "complete") {
        await driverComplete(pickupId);
      } else if (action === "cancel") {
        const isManager = pageRole === "sales_manager";
        await cancelSalesPickup(pickupId, isManager);
      }
    });
  }
}

/* ---------- DATA LOADING ---------- */

async function loadSalesPickups() {
  if (!storeId) return;

  try {
    let query = supabase
      .from("sales_pickups")
      .select("*")
      .eq("store_id", storeId)
      .order("requested_at", { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error("Load sales pickups error:", error);
      showBanner("error", "Failed to load requests");
      return;
    }

    salesPickups = data || [];
    renderTables(false);
  } catch (err) {
    console.error("Load sales pickups error:", err);
    showBanner("error", "Failed to load requests");
  }
}

/* ---------- RENDERING ---------- */

function renderTables(timerOnly = false) {
  if (!timerOnly) {
    renderActiveTable();
    renderCompletedTable();
  } else {
    // Just update timers
    updateTimers();
  }
}

function renderActiveTable() {
  const tbody = document.getElementById("active-tbody");
  if (!tbody) return;

  const active = salesPickups.filter(
    (p) => p.status === "REQUESTED" || p.status === "ON_THE_WAY"
  );

  const countEl = document.getElementById("count-active");
  if (countEl) countEl.textContent = active.length;

  if (active.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No active requests.</td></tr>';
    return;
  }

  tbody.innerHTML = active
    .map((p) => {
      const onTheWay = p.status === "ON_THE_WAY";
      const driverTimer = onTheWay && p.on_the_way_at
        ? formatTimer(new Date(p.on_the_way_at))
        : "—";
      const masterTime = p.requested_at ? formatTimer(new Date(p.requested_at)) : "—";

      const notesPreview = p.notes
        ? (p.notes.length > 100 ? p.notes.substring(0, 100) + "..." : p.notes)
        : "";

      if (pageRole === "sales_manager") {
        // Manager view: no action buttons
        return `
          <tr data-pickup-id="${p.id}">
            <td class="cell-tag">${escapeHtml(p.stock_number || "")}</td>
            <td>${escapeHtml(p.salesperson_name || "")}</td>
            <td>${onTheWay ? "Yes" : "No"}</td>
            <td class="driver-timer-cell">${driverTimer}</td>
            <td>
              <div class="notes-preview">
                ${notesPreview ? `<div class="note-line latest">${escapeHtml(notesPreview)}</div>` : ""}
                <button class="btn small notes-button" data-action="add-note" data-pickup-id="${p.id}">Add note</button>
              </div>
            </td>
            <td class="master-timer-cell">${masterTime}</td>
            <td>
              <button class="btn small" data-action="cancel" data-pickup-id="${p.id}">Cancel</button>
            </td>
          </tr>
        `;
      } else {
        // Driver view: action buttons
        const onTheWayBtn = p.status === "REQUESTED"
          ? `<button class="btn small" data-action="on-the-way" data-pickup-id="${p.id}">On the way</button>`
          : "";
        const completeBtn = p.status === "ON_THE_WAY"
          ? `<button class="btn small btn-primary" data-action="complete" data-pickup-id="${p.id}">At dealer / Complete</button>`
          : "";

        return `
          <tr data-pickup-id="${p.id}">
            <td class="cell-tag">${escapeHtml(p.stock_number || "")}</td>
            <td>${escapeHtml(p.salesperson_name || "")}</td>
            <td>
              ${onTheWayBtn}
              ${completeBtn}
            </td>
            <td class="driver-timer-cell">${driverTimer}</td>
            <td>
              <div class="notes-preview">
                ${notesPreview ? `<div class="note-line latest">${escapeHtml(notesPreview)}</div>` : ""}
                <button class="btn small notes-button" data-action="add-note" data-pickup-id="${p.id}">Add note</button>
              </div>
            </td>
            <td class="master-timer-cell">${masterTime}</td>
            <td>
              <button class="btn small" data-action="cancel" data-pickup-id="${p.id}">Cancel</button>
            </td>
          </tr>
        `;
      }
    })
    .join("");

  updateTimers();
}

function renderCompletedTable() {
  const tbody = document.getElementById("completed-tbody");
  if (!tbody) return;

  const completed = salesPickups.filter(
    (p) => p.status === "COMPLETE" || p.status === "CANCELLED"
  );

  const countEl = document.getElementById("count-completed");
  if (countEl) countEl.textContent = completed.length;

  if (completed.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No completed requests yet.</td></tr>';
    return;
  }

  tbody.innerHTML = completed
    .map((p) => {
      const finalStatus = p.status === "COMPLETE" ? "COMPLETE" : "CANCELLED";
      const timeField = p.status === "COMPLETE" ? p.completed_at : p.cancelled_at;
      const timeStr = timeField ? new Date(timeField).toLocaleString() : "—";

      return `
        <tr>
          <td class="cell-tag">${escapeHtml(p.stock_number || "")}</td>
          <td>${escapeHtml(p.salesperson_name || "")}</td>
          <td>${escapeHtml(finalStatus)}</td>
          <td>${escapeHtml(timeStr)}</td>
          <td>
            <button class="btn small" data-timeline-id="${p.id}" disabled>Timeline</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function updateTimers() {
  const active = salesPickups.filter(
    (p) => p.status === "REQUESTED" || p.status === "ON_THE_WAY"
  );

  active.forEach((p) => {
    const row = document.querySelector(`tr[data-pickup-id="${p.id}"]`);
    if (!row) return;

    // Update driver timer if ON_THE_WAY
    if (p.status === "ON_THE_WAY" && p.on_the_way_at) {
      const timer = formatTimer(new Date(p.on_the_way_at));
      const timerCell = row.querySelector(".driver-timer-cell");
      if (timerCell) timerCell.textContent = timer;
    }

    // Update master time
    if (p.requested_at) {
      const timer = formatTimer(new Date(p.requested_at));
      const masterTimeCell = row.querySelector(".master-timer-cell");
      if (masterTimeCell) masterTimeCell.textContent = timer;
    }
  });
}

function formatTimer(startTime) {
  const now = new Date();
  const diff = now - startTime;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ---------- STARTUP ---------- */

document.addEventListener("DOMContentLoaded", () => {
  initSalesApp();
});

