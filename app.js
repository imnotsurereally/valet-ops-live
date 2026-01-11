// app.js  (FULL FILE REPLACEMENT) — V0.912
// Requires: ./supabaseClient.js  +  ./auth.js (requireAuth / wireSignOut) + ./ui.js

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js?v=20260110a";
import { showModal, showTextModal, showSelectModal, toast, formatSnapTime } from "./ui.js?v=20260105c";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map(); // id -> severity for sound alerts
let pqiEnabled = false;
let uiStateLoaded = false;
let storeId = null;
let valetNames = []; // Dynamic valet names from store_settings

/* ---------- AUDIT LOGGING ---------- */

async function logPickupEvent({ pickupId, storeId, action, payload }) {
  // Return silently if storeId or pickupId missing
  if (!storeId || !pickupId) return;

  try {
    // Get current user
    const { data: userData } = await supabase.auth.getUser();
    const actorUserId = userData?.user?.id ?? null;
    const actorRole = pageKeyFromPath?.() ?? null;

    // Insert audit event
    const { error } = await supabase
      .from("pickup_events")
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
      console.warn("event_log_failed", { action, pickupId, error });
    }
  } catch (err) {
    // Silently fail - logging should never block the main write
    console.warn("event_log_failed", { action, pickupId, error: err });
  }
}

// Ops reliability state
let lastRefreshTime = null;
let lastWriteStatus = "—";
let realtimeStatus = "disconnected";
let loadPickupsInFlight = false;
let loadPickupsQueued = false;
let realtimeDebounceTimer = null;
let realtimeSubscription = null;

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    // AUTH GATE (hard lock)
    const auth = await requireAuth({ page: pageKeyFromPath() });
    if (!auth?.ok) return; // redirected or blocked

    storeId = auth?.profile?.store_id || null;

    // Set role (screen role) from body class
    if (document.body.classList.contains("role-keymachine")) role = "keymachine";
    else if (document.body.classList.contains("role-carwash")) role = "carwash";
    else if (document.body.classList.contains("role-wallboard")) role = "wallboard";
    else if (document.body.classList.contains("role-serviceadvisor")) role = "serviceadvisor";
    else if (document.body.classList.contains("role-loancar")) role = "loancar";
    else role = "dispatcher";

    // Optional sign-out support if a button exists (id="signout-btn")
    wireSignOut();

    // Ops reliability UI
    ensureOpsUI();
    setupDebugToggle();

    setupForm();
    setupTableActions();
    setupCompletedToggle();
    setupPqiToggle();
    loadUIState();

    await loadPickups();
    subscribeRealtime();

    // Load store settings for dynamic valets
    await loadStoreSettings();

    // Timers tick in 15s intervals (UI display snap)
    setInterval(() => renderTables(true), 15 * 1000);

    // Update debug strip every 15 seconds (for "last refresh" time)
    setInterval(() => updateDebugStrip(), 15 * 1000);
  })();
});

/* ---------- UI STATE (completed collapse + PQI) ---------- */

function loadUIState() {
  if (uiStateLoaded) return;
  uiStateLoaded = true;

  let state = {};
  try {
    state = JSON.parse(localStorage.getItem("valetOpsState") || "{}");
  } catch { }

  // Default to collapsed unless explicitly set to false
  const section = document.getElementById("completed-section");
  const btn = document.getElementById("toggle-completed");
  if (section && btn) {
    if (state.completedCollapsed === false) {
      // Explicitly show
      section.classList.remove("completed-collapsed");
      btn.textContent = "Hide";
    } else {
      // Default to collapsed
      section.classList.add("completed-collapsed");
      btn.textContent = "Show";
    }
  }

  if (typeof state.pqiEnabled === "boolean") {
    pqiEnabled = state.pqiEnabled;
    applyPqiToggleUI();
  }
}

function saveUIState() {
  const section = document.getElementById("completed-section");
  const completedCollapsed = !!(
    section && section.classList.contains("completed-collapsed")
  );
  const state = { completedCollapsed, pqiEnabled };

  try {
    localStorage.setItem("valetOpsState", JSON.stringify(state));
  } catch { }
}

/* ---------- PQI toggle (global) ---------- */

function setupPqiToggle() {
  const btn = document.getElementById("pqi-toggle");
  if (!btn) return;

  btn.addEventListener("click", () => {
    pqiEnabled = !pqiEnabled;
    applyPqiToggleUI();
    saveUIState();
  });
}

function applyPqiToggleUI() {
  const btn = document.getElementById("pqi-toggle");
  if (!btn) return;
  if (pqiEnabled) {
    btn.classList.remove("off");
    btn.textContent = "PQI: On";
  } else {
    btn.classList.add("off");
    btn.textContent = "PQI: Off";
  }
}

/* ---------- OPS RELIABILITY SYSTEM ---------- */

function ensureOpsUI() {
  // Create global banner if it doesn't exist
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

  // Create debug strip if it doesn't exist
  if (!document.getElementById("debugStrip")) {
    const strip = document.createElement("div");
    strip.id = "debugStrip";
    strip.className = "debug-strip hidden";
    strip.innerHTML = `
      <div class="debug-item">
        <span class="debug-label">Store:</span>
        <span class="debug-value" id="debug-store">—</span>
      </div>
      <div class="debug-item">
        <span class="debug-label">Role:</span>
        <span class="debug-value" id="debug-role">—</span>
      </div>
      <div class="debug-item">
        <span class="debug-label">Realtime:</span>
        <span class="debug-value" id="debug-realtime">—</span>
      </div>
      <div class="debug-item">
        <span class="debug-label">Last refresh:</span>
        <span class="debug-value" id="debug-refresh">—</span>
      </div>
      <div class="debug-item">
        <span class="debug-label">Last write:</span>
        <span class="debug-value" id="debug-write">—</span>
      </div>
    `;
    document.body.insertBefore(strip, document.body.firstChild);
  }

  // Update debug strip after a brief delay to ensure storeId/role are set
  setTimeout(() => updateDebugStrip(), 100);
}

function setupDebugToggle() {
  // Check localStorage for debug strip visibility
  let debugVisible = false;
  try {
    const state = JSON.parse(localStorage.getItem("valetOpsDebug") || "{}");
    debugVisible = state.debugVisible === true;
  } catch { }

  const strip = document.getElementById("debugStrip");
  if (strip) {
    if (debugVisible) {
      strip.classList.remove("hidden");
    }
  }

  // Add keyboard shortcut (Ctrl+Shift+D)
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "D") {
      e.preventDefault();
      toggleDebugStrip();
    }
  });

  // Try to add toggle button to header-right if it exists
  const headerRight = document.querySelector(".header-right");
  if (headerRight && !document.getElementById("debug-toggle-btn")) {
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "debug-toggle-btn";
    toggleBtn.className = "debug-toggle";
    toggleBtn.textContent = "Debug";
    toggleBtn.onclick = toggleDebugStrip;
    headerRight.insertBefore(toggleBtn, headerRight.firstChild);
  }
}

function toggleDebugStrip() {
  const strip = document.getElementById("debugStrip");
  if (!strip) return;

  const isVisible = !strip.classList.contains("hidden");
  if (isVisible) {
    strip.classList.add("hidden");
  } else {
    strip.classList.remove("hidden");
    updateDebugStrip();
  }

  // Persist state
  try {
    localStorage.setItem("valetOpsDebug", JSON.stringify({ debugVisible: !isVisible }));
  } catch { }
}

function updateDebugStrip() {
  const strip = document.getElementById("debugStrip");
  if (!strip || strip.classList.contains("hidden")) return;

  // Store
  const storeEl = document.getElementById("debug-store");
  if (storeEl) storeEl.textContent = storeId || "none";

  // Role
  const roleEl = document.getElementById("debug-role");
  if (roleEl) roleEl.textContent = pageKeyFromPath() || role;

  // Realtime
  const realtimeEl = document.getElementById("debug-realtime");
  if (realtimeEl) {
    realtimeEl.textContent = realtimeStatus;
    realtimeEl.className = "debug-value " + realtimeStatus;
  }

  // Last refresh
  const refreshEl = document.getElementById("debug-refresh");
  if (refreshEl && lastRefreshTime) {
    const secondsAgo = Math.floor((Date.now() - lastRefreshTime) / 1000);
    if (secondsAgo < 60) {
      refreshEl.textContent = `${secondsAgo}s ago`;
    } else if (secondsAgo < 3600) {
      refreshEl.textContent = `${Math.floor(secondsAgo / 60)}m ago`;
    } else {
      refreshEl.textContent = `${Math.floor(secondsAgo / 3600)}h ago`;
    }
  }

  // Last write
  const writeEl = document.getElementById("debug-write");
  if (writeEl) writeEl.textContent = lastWriteStatus;
}

function setDebugLastWrite(status) {
  lastWriteStatus = status;
  updateDebugStrip();
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

async function safeUpdatePickup(id, updates, meta = {}) {
  const action = meta.action || "unknown";
  const timestamp = new Date().toISOString();

  try {
    // Build query with store isolation
    let query = supabase
      .from("pickups")
      .update(updates)
      .eq("id", id);

    if (storeId) {
      query = query.eq("store_id", storeId);
    }

    // Force return affected rows
    const { data, error } = await query.select("id");

    if (error) {
      // Error case
      const details = error.message || "Check console for details";
      showBanner("error", "Save failed", details);
      setDebugLastWrite("ERROR");

      // Structured console log
      console.error("[OPS] Write failure", {
        action,
        id,
        storeId,
        role,
        updateKeys: Object.keys(updates),
        timestamp,
        error: error.message
      });

      return { success: false, error };
    }

    // Check for no-op (0 rows affected)
    if (!data || data.length === 0) {
      const details = "Likely RLS/store context mismatch";
      showBanner("warn", "Update blocked (0 rows)", details);
      setDebugLastWrite("NO-OP");

      // Structured console log
      console.warn("[OPS] No-op write", {
        action,
        id,
        storeId,
        role,
        updateKeys: Object.keys(updates),
        timestamp,
        reason: "0 rows affected"
      });

      return { success: false, noop: true };
    }

    // Success case
    const rows = data.length;
    hideBanner();
    setDebugLastWrite(`OK rows=${rows}`);

    // Brief OK banner (optional, auto-hide after 2s)
    showBanner("ok", "Update saved");
    setTimeout(() => {
      const banner = document.getElementById("globalBanner");
      if (banner && banner.classList.contains("is-ok")) {
        hideBanner();
      }
    }, 2000);

    // Audit logging (best-effort, non-blocking)
    if (rows > 0) {
      // Build payload with minimal details
      const payload = {
        updates: Object.keys(updates)
      };

      // Only include fields that were actually updated
      if (updates.notes !== undefined) {
        const noteText = updates.notes || "";
        payload.notePreview = noteText.length > 100 ? noteText.substring(0, 100) + "..." : noteText;
      }
      if (updates.status !== undefined) {
        payload.status = updates.status;
      }
      if (updates.wash_status !== undefined) {
        payload.wash_status = updates.wash_status;
      }
      if (updates.keys_holder !== undefined) {
        payload.keys_holder = updates.keys_holder;
      }

      // Fire and forget - don't await to avoid blocking
      logPickupEvent({
        pickupId: id,
        storeId,
        action,
        payload
      }).catch(() => {
        // Already handled in logPickupEvent, but catch here too for safety
      });
    }

    return { success: true, rows };
  } catch (err) {
    // Unexpected error
    showBanner("error", "Save failed", "Unexpected error");
    setDebugLastWrite("ERROR");

    console.error("[OPS] Write exception", {
      action,
      id,
      storeId,
      role,
      updateKeys: Object.keys(updates),
      timestamp,
      error: err.message
    });

    return { success: false, error: err };
  }
}

/* ---------- STORE SETTINGS ---------- */

async function loadStoreSettings() {
  if (!storeId) return;

  try {
    const { data, error } = await supabase
      .from("store_settings")
      .select("valet_names")
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) {
      console.error("Store settings load error:", error);
      return;
    }

    if (!data) {
      // Fallback to default valets if no settings
      valetNames = ["Fernando", "Juan", "Miguel", "Maria", "Helper"];
      return;
    }

    // Parse JSONB array or text[] - handle both
    if (Array.isArray(data.valet_names)) {
      valetNames = data.valet_names;
    } else if (typeof data.valet_names === "string") {
      try {
        valetNames = JSON.parse(data.valet_names);
      } catch {
        valetNames = [data.valet_names];
      }
    } else {
      // Fallback
      valetNames = ["Fernando", "Juan", "Miguel", "Maria", "Helper"];
    }

    if (valetNames.length === 0) {
      valetNames = ["Fernando", "Juan", "Miguel", "Maria", "Helper"];
    }
  } catch (err) {
    console.error("Store settings error:", err);
    valetNames = ["Fernando", "Juan", "Miguel", "Maria", "Helper"];
  }
}

/* ---------- NEW PICKUP FORM ---------- */

function setupForm() {
  const form = document.getElementById("new-pickup-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tagInput = document.getElementById("tag-number");
    const nameInput = document.getElementById("customer-name");
    const stageCheckbox = document.getElementById("stage-only");

    const tag = tagInput?.value?.trim();
    const name = nameInput?.value?.trim();
    const staged = stageCheckbox?.checked || false;

    if (!tag || !name) return;

    const nowIso = new Date().toISOString();

    // Base insert
    let insertData = {
      store_id: storeId,
      tag_number: tag,
      customer_name: name,
      status: staged ? "STAGED" : "NEW",
      wash_status: "NONE",
      active_started_at: staged ? null : nowIso
    };

    // ✅ V0.912: SERVICE ADVISOR
    // - always staged
    // - notes always start with: "Service advisor request"
    // - allow advisor to add/edit the "original note" at creation time
    if (role === "serviceadvisor") {
      insertData.status = "STAGED";
      insertData.active_started_at = null;

      const baseLine = "Service advisor request";
      const extra = await showTextModal(
        "Optional note for dispatcher",
        {
          placeholder: "Optional note (saved under 'Service advisor request')",
          initialValue: "",
          required: false,
          multiline: false
        }
      );

      if (extra === null) return; // User cancelled

      const extraTrimmed = (extra || "").trim();
      insertData.notes = extraTrimmed ? `${baseLine}\n${extraTrimmed}` : baseLine;
      insertData.notes_updated_at = nowIso;
    }

    // ✅ V0.912: LOAN CAR
    // - always active pickup
    // - note exactly: "customer just arrived in loaner"
    if (role === "loancar") {
      insertData.status = "NEW";
      insertData.active_started_at = nowIso;
      insertData.notes = "customer just arrived in loaner";
      insertData.notes_updated_at = nowIso;
    }

    const { error } = await supabase.from("pickups").insert(insertData);

    if (error) {
      console.error(error);
      toast("Error creating ticket. Check console.", "error");
      return;
    }

    toast("Ticket created", "success");

    if (tagInput) tagInput.value = "";
    if (nameInput) nameInput.value = "";
    if (stageCheckbox) stageCheckbox.checked = false;
  });
}

/* ---------- TABLE ACTIONS ---------- */

function setupTableActions() {
  ["active-tbody", "staged-tbody", "waiting-tbody", "completed-tbody"].forEach(
    (id) => {
      const tbody = document.getElementById(id);
      if (!tbody) return;
      tbody.addEventListener("click", onTableClick);
    }
  );
}

function onTableClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  // ✅ HARD READ-ONLY: wallboard can never trigger actions
  if (role === "wallboard") return;

  // V0.912: service advisor + loan car can only add notes (no status changes)
  if (role === "serviceadvisor" || role === "loancar") {
    const action = btn.getAttribute("data-action");
    if (action !== "edit-note") return;
  }

  const id = btn.getAttribute("data-id");
  const action = btn.getAttribute("data-action");
  if (!id || !action) return;
  handleAction(id, action);
}

async function handleAction(id, action) {
  // ✅ DOUBLE LOCK: even if a click slips through, wallboard can never mutate data
  if (role === "wallboard") return;

  const now = new Date().toISOString();
  const updates = {};

  switch (action) {
    /* --- move staged -> active: start master time here --- */
    case "activate-from-staged":
      updates.status = "NEW";
      updates.active_started_at = now;
      break;

    /* --- status/location & key machine --- */
    case "keys-machine":
      updates.status = "KEYS_IN_MACHINE";
      updates.keys_holder = "KEY_MACHINE";
      updates.keys_at_machine_at = now;
      break;

    case "car-wash-area":
      updates.wash_status = "IN_WASH_AREA";
      updates.wash_status_at = now;
      break;

    case "car-red-line":
      updates.wash_status = "ON_RED_LINE";
      updates.wash_status_at = now;
      break;

    case "key-car-missing":
      updates.wash_status = "KEY_CAR_MISSING";
      updates.wash_status_at = now;
      break;

    case "wash-needs-rewash":
      updates.wash_status = "NEEDS_REWASH_PENDING";
      updates.wash_status_at = now;
      break;

    case "rewash-yes": {
      // Show "Text car wash manager?" dialog
      const textManager = await showSelectModal("Text car wash manager?", {
        label: "Should we text the car wash manager?",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" }
        ],
        required: true
      });

      if (textManager === null) return; // User cancelled

      const shouldText = textManager === "yes";
      if (shouldText) {
        // Non-blocking text stub
        sendOpsText({
          message: `Rewash needed for ticket ${pickups.find((p) => String(p.id) === String(id))?.tag_number || id}`,
          ticketId: id,
          storeId
        });
      }

      updates.wash_status = "SEND_TO_WASH";
      updates.wash_status_at = now;
      // Append note about rewash confirmation
      const current = pickups.find((p) => String(p.id) === String(id));
      const existingNotes = current?.notes || "";
      const stamp = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
      const rewashNote = `[${stamp}] Rewash confirmed — Text manager: ${shouldText ? "Yes" : "No"}`;
      updates.notes = existingNotes ? existingNotes + "\n" + rewashNote : rewashNote;
      updates.notes_updated_at = now;
      break;
    }

    case "rewash-no":
      updates.wash_status = "NEEDS_REWASH_NO";
      updates.wash_status_at = now;
      break;

    case "wash-dusty":
      updates.wash_status = "DUSTY";
      updates.wash_status_at = now;
      break;

    /* --- valets (dynamic) --- */
    case "with-valet":
      const valetName = btn.getAttribute("data-valet-name");
      if (valetName) {
        setValetUpdates(updates, valetName, now);
      }
      break;

    /* --- move to waiting/staged for customer: freeze master timer --- */
    case "waiting-customer":
      updates.status = "WAITING_FOR_CUSTOMER";
      updates.waiting_client_at = now;
      break;

    /* --- customer picked up -> complete --- */
    case "customer-picked-up":
      updates.status = "COMPLETE";
      updates.completed_at = now;
      break;

    /* --- notes: append history, do not erase --- */
    case "edit-note": {
      const current = pickups.find((p) => String(p.id) === String(id));
      const existing = current?.notes || "";
      const placeholder = existing
        ? "Add new note (previous notes stay on record)"
        : "Add note";
      const newNote = await showTextModal("Add Note", {
        placeholder,
        initialValue: "",
        required: false,
        multiline: true
      });
      if (newNote === null) return; // User cancelled
      const trimmed = newNote.trim();
      if (!trimmed) return;

      const stamp = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      const line = `[${stamp}] ${trimmed}`;
      const combined = existing ? existing + "\n" + line : line;

      updates.notes = combined;
      updates.notes_updated_at = now;
      break;
    }

    /* --- timeline view --- */
    case "view-timeline": {
      const p = pickups.find((pk) => String(pk.id) === String(id));
      if (!p) return;
      const lines = [];
      lines.push(`Ticket ${p.tag_number} – ${p.customer_name}`);
      lines.push("--------------------------------");

      if (p.created_at) lines.push("Created: " + formatTime(p.created_at));
      if (p.active_started_at)
        lines.push("Entered Active Pickups: " + formatTime(p.active_started_at));
      if (p.keys_with_valet_at && p.keys_holder)
        lines.push(`Keys with ${p.keys_holder}: ` + formatTime(p.keys_with_valet_at));
      if (p.keys_at_machine_at)
        lines.push("Keys in key machine: " + formatTime(p.keys_at_machine_at));
      if (p.wash_status_at && p.wash_status && p.wash_status !== "NONE")
        lines.push(
          `Wash status (${humanWashStatus(p.wash_status)}): ` +
          formatTime(p.wash_status_at)
        );
      if (p.waiting_client_at)
        lines.push("Waiting/staged for customer: " + formatTime(p.waiting_client_at));
      if (p.completed_at) lines.push("Completed: " + formatTime(p.completed_at));

      const masterSeconds = computeMasterSeconds(p, new Date());
      lines.push("Master cycle (Active box in/out): " + formatDuration(masterSeconds));

      if (p.notes) {
        lines.push("");
        lines.push("Notes history:");
        p.notes.split("\n").forEach((n) => lines.push("• " + n));
      }

      await showModal({
        title: "Timeline",
        content: `<pre style="white-space: pre-wrap; font-family: monospace; font-size: 0.85rem;">${escapeHtml(lines.join("\n"))}</pre>`,
        width: "600px"
      });
      return;
    }

    default:
      return;
  }

  if (Object.keys(updates).length === 0) return;

  // Use safe update wrapper (no-op detector + banner)
  const result = await safeUpdatePickup(id, updates, { action });

  // Stop on failure (error or no-op)
  if (!result.success) {
    return; // Banner already shown, no need for alert
  }
}

function setValetUpdates(updates, name, nowIso) {
  updates.status = "KEYS_WITH_VALET";
  updates.keys_holder = name;
  updates.keys_with_valet_at = nowIso;
}

/* ---------- COMPLETED COLLAPSE ---------- */

function setupCompletedToggle() {
  const section = document.getElementById("completed-section");
  const btn = document.getElementById("toggle-completed");
  if (!section || !btn) return;

  btn.addEventListener("click", () => {
    const collapsed = section.classList.toggle("completed-collapsed");
    btn.textContent = collapsed ? "Show" : "Hide";
    saveUIState();
  });
}

/* ---------- DATA + REALTIME ---------- */

async function loadPickups() {
  // Prevent overlapping calls
  if (loadPickupsInFlight) {
    loadPickupsQueued = true;
    return;
  }

  loadPickupsInFlight = true;
  loadPickupsQueued = false;

  try {
    let q = supabase.from("pickups").select("*").order("created_at", {
      ascending: false
    });

    if (storeId) q = q.eq("store_id", storeId);

    const { data, error } = await q;

    if (error) {
      console.error(error);
      return;
    }

    pickups = data || [];
    renderTables(false);

    // Track successful refresh
    lastRefreshTime = Date.now();
    updateDebugStrip();
  } finally {
    loadPickupsInFlight = false;

    // If events arrived while in flight, queue another run
    if (loadPickupsQueued) {
      setTimeout(() => loadPickups(), 100);
    }
  }
}

function subscribeRealtime() {
  // Unsubscribe existing if any
  if (realtimeSubscription) {
    try {
      realtimeSubscription.unsubscribe();
    } catch (e) {
      // Ignore unsubscribe errors
    }
  }

  realtimeStatus = "connecting";
  updateDebugStrip();

  // Debounced refresh function
  const debouncedRefresh = () => {
    if (realtimeDebounceTimer) {
      clearTimeout(realtimeDebounceTimer);
    }
    realtimeDebounceTimer = setTimeout(() => {
      loadPickups();
    }, 750); // 750ms debounce
  };

  // Subscribe (Supabase v1)
  try {
    realtimeSubscription = supabase
      .from("pickups")
      .on("*", () => {
        // Mark as connected when we receive events
        if (realtimeStatus !== "connected") {
          realtimeStatus = "connected";
          updateDebugStrip();
        }
        debouncedRefresh();
      })
      .subscribe();

    // Assume connected after subscription attempt
    setTimeout(() => {
      if (realtimeStatus === "connecting") {
        realtimeStatus = "connected";
        updateDebugStrip();
      }
    }, 1000);
  } catch (err) {
    realtimeStatus = "disconnected";
    updateDebugStrip();
    console.error("[OPS] Realtime subscription error:", err);
  }
}

/* ---------- RENDERING ---------- */

function renderTables(isTimerTick) {
  const now = new Date();

  const staged = pickups.filter((p) => p.status === "STAGED");
  const active = pickups.filter(
    (p) =>
      p.status !== "STAGED" &&
      p.status !== "WAITING_FOR_CUSTOMER" &&
      p.status !== "COMPLETE"
  );
  const waiting = pickups.filter((p) => p.status === "WAITING_FOR_CUSTOMER");
  const completed = pickups.filter((p) => p.status === "COMPLETE").slice(0, 50);

  // Oldest first in active box
  active.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  setCount("count-staged", staged.length);
  setCount("count-active", active.length);
  setCount("count-waiting", waiting.length);
  setCount("count-completed", completed.length);

  const stagedTbody = document.getElementById("staged-tbody");
  const activeTbody = document.getElementById("active-tbody");
  const waitingTbody = document.getElementById("waiting-tbody");
  const completedTbody = document.getElementById("completed-tbody");

  if (stagedTbody) {
    stagedTbody.innerHTML =
      staged.length === 0
        ? '<tr><td colspan="4" class="empty">No staged tickets.</td></tr>'
        : staged.map((p) => renderStagedRow(p)).join("");
  }

  if (activeTbody) {
    activeTbody.innerHTML =
      active.length === 0
        ? `<tr><td colspan="${activeColspan()}" class="empty">No active pickups.</td></tr>`
        : active.map((p) => renderActiveRow(p, now)).join("");
  }

  if (waitingTbody) {
    waitingTbody.innerHTML =
      waiting.length === 0
        ? `<tr><td colspan="${waitingColspan()}" class="empty">None currently waiting.</td></tr>`
        : waiting.map((p) => renderWaitingRow(p, now)).join("");
  }

  if (completedTbody) {
    completedTbody.innerHTML =
      completed.length === 0
        ? '<tr><td colspan="8" class="empty">No completed tickets yet.</td></tr>'
        : completed.map((p) => renderCompletedRow(p, now)).join("");
  }

  if (role === "dispatcher") renderMetrics(active, waiting, completed, now);
  if (isTimerTick) maybePlayAlerts(active, now);
}

function activeColspan() {
  if (role === "wallboard") return 6;
  if (role === "dispatcher") return 8;
  return 7;
}

function waitingColspan() {
  if (role === "wallboard") return 4;
  return 7;
}

function setCount(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value);
}

function renderStagedRow(p) {
  return `
    <tr>
      <td class="cell-tag"><span class="pill-blue">${escapeHtml(p.tag_number)}</span></td>
      <td class="cell-customer"><span class="pill-blue">${escapeHtml(p.customer_name)}</span></td>
      <td>${formatTime(p.created_at)}</td>
      <td>
        <button class="btn small dispatcher-only" data-action="activate-from-staged" data-id="${p.id}">
          Activate
        </button>
      </td>
    </tr>
  `;
}

function renderActiveRow(p, now) {
  if (role === "wallboard") return renderActiveRowWallboard(p, now);

  const masterSeconds = computeMasterSeconds(p, now);
  const masterClass = timerClass(computeSeverity(masterSeconds));
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetClass =
    valetSeconds != null ? timerClass(computeSeverity(valetSeconds)) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";

  const currentWash = p.wash_status || "NONE";
  const currentValet = p.keys_holder || "";

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);
  const latestNote = notesPieces.length ? notesPieces[notesPieces.length - 1] : "";
  const olderNotes = notesPieces.slice(0, -1).slice(-4); // Last 4 older notes

  const washSelectedLabel =
    currentWash && currentWash !== "NONE" ? humanWashStatus(currentWash) : "—";
  const valetSelectedLabel = currentValet ? `Keys with ${currentValet}` : "—";

  // Determine rewash state for inline dialog
  const needsRewashPending = currentWash === "NEEDS_REWASH_PENDING";
  const needsRewashNo = currentWash === "NEEDS_REWASH_NO";
  const sendToWash = currentWash === "SEND_TO_WASH";
  const keyCarMissing = currentWash === "KEY_CAR_MISSING";

  const washBtns = `
    <div class="wash-buttons">
      <button class="btn small ${currentWash === "IN_WASH_AREA" ? "selected" : ""}"
        data-action="car-wash-area" data-id="${p.id}">In wash</button>
      <button class="btn small ${currentWash === "ON_RED_LINE" ? "selected" : ""}"
        data-action="car-red-line" data-id="${p.id}">On redline</button>
    </div>
    <div class="wash-buttons">
      <button class="btn small ${currentWash === "DUSTY" ? "selected" : ""}"
        data-action="wash-dusty" data-id="${p.id}">Dusty</button>
      <button class="btn small keymachine-only ${p.status === "KEYS_IN_MACHINE" ? "selected" : ""}"
        data-action="keys-machine" data-id="${p.id}">Key machine</button>
    </div>
    <div class="wash-buttons">
      <button class="btn small ${needsRewashPending || needsRewashNo ? "selected wash-needs pulse-blue" : ""} ${sendToWash ? "selected pulse-orange" : ""}"
        data-action="wash-needs-rewash" data-id="${p.id}">${sendToWash ? "Send to wash" : "Needs rewash"}</button>
      <button class="btn small ${keyCarMissing ? "selected pulse-red" : ""}"
        data-action="key-car-missing" data-id="${p.id}">Key/car missing</button>
    </div>
  `;

  // Inline rewash dialog
  let rewashDialogHtml = "";
  if (needsRewashPending) {
    rewashDialogHtml = `
      <div class="inline-dialog pulse-blue" data-pickup-id="${p.id}">
        <div class="dialog-content">
          <div class="dialog-label">Rewash needed?</div>
          <div class="dialog-buttons">
            <button class="btn small" data-action="rewash-yes" data-id="${p.id}">Yes rewash</button>
            <button class="btn small" data-action="rewash-no" data-id="${p.id}">Don't rewash</button>
          </div>
        </div>
      </div>
    `;
  } else if (needsRewashNo) {
    // Keep pulsing blue indicator but no dialog
  } else if (sendToWash) {
    // Show orange "Send to wash" state (already in button)
  }

  // Dynamic valet buttons
  const valetBtns = `
    <div class="valet-grid">
      ${valetNames.map((name) => `
        <button class="btn small ${currentValet === name ? "selected" : ""}" 
          data-action="with-valet" 
          data-valet-name="${escapeHtml(name)}" 
          data-id="${p.id}">${escapeHtml(name)}</button>
      `).join("")}
    </div>
  `;

  // Notes as pills
  let notesHtml = `<button class="btn small notes-button" data-action="edit-note" data-id="${p.id}">Add note</button>`;
  if (notesPieces.length > 0) {
    notesHtml += '<div class="notes-list">';
    notesPieces.forEach((note, idx) => {
      const isLatest = idx === notesPieces.length - 1;
      notesHtml += `<span class="note-pill ${isLatest ? "latest" : "old"}">${escapeHtml(note)}</span>`;
    });
    notesHtml += '</div>';
  }

  if (role === "dispatcher") {
    return `
      <tr>
        <td class="cell-tag"><span class="pill-blue">${escapeHtml(p.tag_number)}</span></td>
        <td class="cell-customer"><span class="pill-blue">${escapeHtml(p.customer_name)}</span></td>
        <td>
          <div class="status-badge">${escapeHtml(washSelectedLabel)}</div>
          ${washBtns}
          ${rewashDialogHtml}
        </td>
        <td>
          <div class="status-badge">${escapeHtml(valetSelectedLabel)}</div>
          ${valetBtns}
        </td>
        <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
        <td class="dispatcher-only">
          <button class="btn small dispatcher-only" data-action="waiting-customer" data-id="${p.id}">
            Move to staged
          </button>
        </td>
        <td>${notesHtml}</td>
        <td>
          <span class="timer ${masterClass}">${masterLabel}</span>
          ${pqiEnabled
        ? '<span class="pqi-badge" style="margin-left:0.3rem;font-size:0.7rem;color:#9ca3af;">PQI</span>'
        : ""
      }
        </td>
      </tr>
    `;
  }

  return `
    <tr>
      <td class="cell-tag"><span class="pill-blue">${escapeHtml(p.tag_number)}</span></td>
      <td class="cell-customer"><span class="pill-blue">${escapeHtml(p.customer_name)}</span></td>
      <td>
        <div class="status-badge">${escapeHtml(washSelectedLabel)}</div>
        ${washBtns}
        ${rewashDialogHtml}
      </td>
      <td>
        <div class="status-badge">${escapeHtml(valetSelectedLabel)}</div>
        ${valetBtns}
      </td>
      <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
      <td>${notesHtml}</td>
      <td>
        <span class="timer ${masterClass}">${masterLabel}</span>
        ${pqiEnabled
      ? '<span class="pqi-badge" style="margin-left:0.3rem;font-size:0.7rem;color:#9ca3af;">PQI</span>'
      : ""
    }
      </td>
    </tr>
  `;
}

function renderActiveRowWallboard(p, now) {
  const masterSeconds = computeMasterSeconds(p, now);
  const masterClass = timerClass(computeSeverity(masterSeconds));
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetClass =
    valetSeconds != null ? timerClass(computeSeverity(valetSeconds)) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";

  const statusLabel = humanStatus(p);
  const deliveredBy = p.keys_holder ? `Keys with ${p.keys_holder}` : "—";

  return `
    <tr>
      <td class="cell-tag"><span class="pill-blue">${escapeHtml(p.tag_number)}</span></td>
      <td class="cell-customer"><span class="pill-blue">${escapeHtml(p.customer_name)}</span></td>
      <td><span class="status-badge">${escapeHtml(statusLabel)}</span></td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
    </tr>
  `;
}

function renderWaitingRow(p, now) {
  if (role === "wallboard") {
    const deliveredBy = p.keys_holder || "—";
    const waitingMs = computeSeconds(
      p.waiting_client_at,
      p.completed_at,
      now
    ) * 1000;
    const waitingSnappedMs = snapMsTo15s(waitingMs);
    const waitingSeconds = waitingSnappedMs / 1000;
    const waitingClass = timerClass(computeSeverity(waitingSeconds));
    const waitingLabel = formatDuration(waitingSeconds);

    return `
      <tr>
        <td class="cell-tag"><span class="pill-blue">${escapeHtml(p.tag_number)}</span></td>
        <td class="cell-customer"><span class="pill-blue">${escapeHtml(p.customer_name)}</span></td>
        <td>${escapeHtml(deliveredBy)}</td>
        <td><span class="timer ${waitingClass}">${waitingLabel}</span></td>
      </tr>
    `;
  }

  const deliveredBy = p.keys_holder || "—";
  const stagedMs = computeSeconds(p.waiting_client_at, p.completed_at, now) * 1000;
  const stagedSnappedMs = snapMsTo15s(stagedMs);
  const stagedSeconds = stagedSnappedMs / 1000;
  const stagedClass = timerClass(computeSeverity(stagedSeconds));
  const stagedLabel = formatDuration(stagedSeconds);

  const masterSeconds = computeMasterSeconds(p, now);
  const masterClass = timerClass(computeSeverity(masterSeconds));
  const masterLabel = formatDuration(masterSeconds);

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);

  let notesHtml = `<button class="btn small notes-button dispatcher-only" data-action="edit-note" data-id="${p.id}">Add note</button>`;
  if (notesPieces.length > 0) {
    notesHtml += '<div class="notes-list">';
    notesPieces.forEach((note, idx) => {
      const isLatest = idx === notesPieces.length - 1;
      notesHtml += `<span class="note-pill ${isLatest ? "latest" : "old"}">${escapeHtml(note)}</span>`;
    });
    notesHtml += '</div>';
  }

  return `
    <tr>
      <td class="cell-tag"><span class="pill-blue">${escapeHtml(p.tag_number)}</span></td>
      <td class="cell-customer"><span class="pill-blue">${escapeHtml(p.customer_name)}</span></td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${stagedClass}">${stagedLabel}</span></td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
      <td>${notesHtml}</td>
      <td>
        <button class="btn small dispatcher-only" data-action="customer-picked-up" data-id="${p.id}">
          Customer picked up
        </button>
      </td>
    </tr>
  `;
}

function renderCompletedRow(p, now) {
  // Completed rows: master time is frozen, but still snap for display consistency
  const masterMs = computeMasterSeconds(p, now) * 1000;
  const masterSnappedMs = snapMsTo15s(masterMs);
  const masterSeconds = masterSnappedMs / 1000;
  const masterLabel = formatDuration(masterSeconds);
  const deliveredBy = p.keys_holder || "—";

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);

  let notesHtml = "";
  if (notesPieces.length > 0) {
    notesHtml += '<div class="notes-list">';
    notesPieces.forEach((note, idx) => {
      const isLatest = idx === notesPieces.length - 1;
      notesHtml += `<span class="note-pill ${isLatest ? "latest" : "old"}">${escapeHtml(note)}</span>`;
    });
    notesHtml += '</div>';
  }

  return `
    <tr>
      <td class="cell-tag"><span class="pill-blue">${escapeHtml(p.tag_number)}</span></td>
      <td class="cell-customer"><span class="pill-blue">${escapeHtml(p.customer_name)}</span></td>
      <td>${masterLabel}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>${formatTime(p.completed_at)}</td>
      <td>${notesHtml}</td>
      <td>
        <button class="btn small" data-action="view-timeline" data-id="${p.id}">
          Timeline
        </button>
      </td>
    </tr>
  `;
}

/* ---------- METRICS ---------- */

function renderMetrics(active, waiting, completed, now) {
  const completedTodayEl = document.getElementById("metrics-completed-today");
  const avgCycleEl = document.getElementById("metrics-avg-cycle");
  const activeCountEl = document.getElementById("metrics-active-count");
  const waitingCountEl = document.getElementById("metrics-waiting-count");
  const redlineCountEl = document.getElementById("metrics-redline-count");
  const valetsEl = document.getElementById("metrics-valets");

  if (
    !completedTodayEl ||
    !avgCycleEl ||
    !activeCountEl ||
    !waitingCountEl ||
    !redlineCountEl ||
    !valetsEl
  )
    return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const completedToday = completed.filter((p) => {
    if (!p.completed_at) return false;
    const d = new Date(p.completed_at);
    return d >= today;
  });

  completedTodayEl.textContent = String(completedToday.length);
  activeCountEl.textContent = String(active.length);
  waitingCountEl.textContent = String(waiting.length);

  const cycles = completedToday
    .map((p) => {
      if (!p.active_started_at || !p.waiting_client_at) return null;
      return computeSeconds(p.active_started_at, p.waiting_client_at, now);
    })
    .filter((v) => v != null);

  if (!cycles.length) {
    avgCycleEl.textContent = "–";
  } else {
    const total = cycles.reduce((a, b) => a + b, 0);
    const avg = total / cycles.length;
    avgCycleEl.textContent = formatDuration(avg);
  }

  const redLineCount = pickups.filter(
    (p) => p.wash_status === "ON_RED_LINE" && p.status !== "COMPLETE"
  ).length;
  redlineCountEl.textContent = String(redLineCount);

  const valetCounts = {};
  valetNames.forEach((v) => (valetCounts[v] = 0));

  pickups.forEach((p) => {
    if (!p.keys_holder) return;
    if (valetCounts[p.keys_holder] === undefined) {
      valetCounts[p.keys_holder] = 0;
    }
    valetCounts[p.keys_holder] += 1;
  });

  valetsEl.innerHTML = valetNames
    .map(
      (name) => `
      <li>
        <span class="valet-name">${escapeHtml(name)}</span>
        <span class="valet-count">${valetCounts[name] || 0} tickets</span>
      </li>`
    )
    .join("");
}

/* ---------- ALERTS ---------- */

function maybePlayAlerts(active, now) {
  const audio = document.getElementById("alert-sound");
  if (!audio) return;
  if (role !== "dispatcher" && role !== "wallboard") return;

  active.forEach((p) => {
    const masterSeconds = computeMasterSeconds(p, now);
    const severity = computeSeverity(masterSeconds);
    const prev = severityMap.get(p.id) || "green";
    severityMap.set(p.id, severity);

    if ((severity === "orange" || severity === "red") && prev !== severity) {
      audio.currentTime = 0;
      audio.play().catch(() => { });
    }
  });
}

/* ---------- HELPERS ---------- */

function humanStatus(p) {
  switch (p.status) {
    case "STAGED":
      return "Staged";
    case "NEW":
      return "New";
    case "KEYS_IN_MACHINE":
      return "Key machine";
    case "KEYS_WITH_VALET":
      return "Keys with valet";
    case "WAITING_FOR_CUSTOMER":
      return "Waiting/staged for customer";
    case "COMPLETE":
      return "Complete";
    default:
      return p.status || "";
  }
}

function humanWashStatus(wash_status) {
  switch (wash_status) {
    case "IN_WASH_AREA":
      return "In wash";
    case "ON_RED_LINE":
      return "On redline";
    case "KEY_CAR_MISSING":
      return "Key/car missing";
    case "NEEDS_REWASH_PENDING":
      return "Needs rewash";
    case "NEEDS_REWASH_NO":
      return "Needs rewash";
    case "SEND_TO_WASH":
      return "Send to wash";
    case "DUSTY":
      return "Dusty";
    case "NONE":
    default:
      return "Not set";
  }
}

/* ---------- TEXT STUB (NON-BLOCKING) ---------- */

async function sendOpsText({ message, ticketId, storeId }) {
  if (window.OPS_TEXT_WEBHOOK_URL) {
    // Fire and forget POST
    fetch(window.OPS_TEXT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, ticketId, storeId })
    }).catch(() => {
      // Silently fail - don't block UI
    });
  } else {
    toast("Text not configured (demo mode)", "info");
  }
}

function computeMasterSeconds(p, now) {
  const startIso = p.active_started_at || p.created_at;
  if (!startIso) return 0;
  const endIso = p.waiting_client_at || null;
  const ms = computeSeconds(startIso, endIso, now) * 1000;
  const snappedMs = snapMsTo15s(ms);
  return snappedMs / 1000;
}

function computeValetSeconds(p, now) {
  if (!p.keys_with_valet_at) return null;
  const startIso = p.keys_with_valet_at;
  const endIso =
    p.keys_at_machine_at || p.waiting_client_at || p.completed_at || null;
  const ms = computeSeconds(startIso, endIso, now) * 1000;
  const snappedMs = snapMsTo15s(ms);
  return snappedMs / 1000;
}

function computeSeconds(startIso, endIso, now) {
  if (!startIso) return 0;
  const start = new Date(startIso);
  let end = endIso ? new Date(endIso) : now;
  if (end < start) end = now;
  const diffMs = end - start;
  if (Number.isNaN(diffMs) || diffMs < 0) return 0;
  // Note: This returns raw seconds; callers should snap to 15s for display
  return diffMs / 1000;
}

function computeSeverity(seconds) {
  const minutes = seconds / 60;
  if (minutes >= 25) return "red";
  if (minutes >= 20) return "orange";
  if (minutes >= 10) return "yellow";
  return "green";
}

function timerClass(severity) {
  switch (severity) {
    case "yellow":
      return "timer-yellow";
    case "orange":
      return "timer-orange";
    case "red":
      return "timer-red";
    case "green":
    default:
      return "timer-green";
  }
}

// Helper: snap milliseconds to 15-second increments
function snapMsTo15s(ms) {
  return Math.floor(ms / 15000) * 15000;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) seconds = 0;
  const snapped = Math.round(seconds / 15) * 15;
  const mins = Math.floor(snapped / 60);
  const secs = snapped % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageKeyFromPath() {
  const path = (window.location.pathname || "").split("/").pop() || "";
  const file = path.toLowerCase();

  const map = {
    "dispatcher.html": "dispatcher",
    "keymachine.html": "keymachine",
    "carwash.html": "carwash",
    "serviceadvisor.html": "serviceadvisor",
    "loancar.html": "loancar",
    "wallboard.html": "wallboard",
    "history.html": "history",
    "login.html": "login",
    // V0.912: index/home is not an employee destination. Still map it safely.
    "index.html": "home"
  };

  return map[file] || null;
}

/* =========================================================
   SERVICE TIMER DISPLAY OVERRIDE (NON-DESTRUCTIVE)
   ========================================================= */

export function renderServiceTimer(el, seconds) {
  if (!el) return;
  el.textContent = formatSnapTime(seconds);
}
