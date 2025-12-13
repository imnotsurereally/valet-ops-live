// app.js
import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map(); // id -> severity for sound alerts
let pqiEnabled = false;
let uiStateLoaded = false;

// UI collapse state per ticket row (pure UI, not stored in DB)
// id -> { wash: boolean, valet: boolean } where true = "expanded chooser"
const expandState = new Map();

document.addEventListener("DOMContentLoaded", () => {
  // role from body class
  if (document.body.classList.contains("role-keymachine")) role = "keymachine";
  else if (document.body.classList.contains("role-carwash")) role = "carwash";
  else if (document.body.classList.contains("role-wallboard")) role = "wallboard";
  else if (document.body.classList.contains("role-serviceadvisor")) role = "serviceadvisor";
  else if (document.body.classList.contains("role-loancar")) role = "loancar";
  else role = "dispatcher";

  setupForm();
  setupTableActions();
  setupCompletedToggle();
  setupPqiToggle();
  loadUIState();

  loadPickups();
  subscribeRealtime();

  // Timers tick in 15s intervals
  setInterval(() => renderTables(true), 15 * 1000);
});

/* ---------- UI STATE (completed collapse + PQI) ---------- */

function loadUIState() {
  if (uiStateLoaded) return;
  uiStateLoaded = true;

  let state = {};
  try {
    state = JSON.parse(localStorage.getItem("valetOpsState") || "{}");
  } catch {}

  if (state.completedCollapsed) {
    const section = document.getElementById("completed-section");
    const btn = document.getElementById("toggle-completed");
    if (section) section.classList.add("completed-collapsed");
    if (btn) btn.textContent = "Show";
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
  } catch {}
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

    // Role-based routing for V1 screens
    // - serviceadvisor: goes to STAGED
    // - loancar: goes to NEW + note
    let insertData = {
      tag_number: tag,
      customer_name: name,
      status: staged ? "STAGED" : "NEW",
      wash_status: "NONE",
      active_started_at: staged ? null : nowIso
    };

    if (role === "serviceadvisor") {
      insertData.status = "STAGED";
      insertData.active_started_at = null;
    }

    if (role === "loancar") {
      insertData.status = "NEW";
      insertData.active_started_at = nowIso;
      insertData.notes = `[${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })}] customer just arrived in loaner`;
      insertData.notes_updated_at = nowIso;
    }

    const { error } = await supabase.from("pickups").insert(insertData);

    if (error) {
      console.error(error);
      alert("Error creating ticket. Check console.");
      return;
    }

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

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  if (!id || !action) return;

  // Permission gate: service advisor + loan car can only add notes.
  if (role === "serviceadvisor" || role === "loancar") {
    if (action !== "edit-note") return;
  }

  // UI-only expand/collapse actions
  if (action === "toggle-wash") {
    toggleExpand(id, "wash");
    return;
  }
  if (action === "toggle-valet") {
    toggleExpand(id, "valet");
    return;
  }

  handleAction(id, action);
}

function toggleExpand(id, key) {
  const cur = expandState.get(id) || { wash: false, valet: false };
  cur[key] = !cur[key];
  expandState.set(id, cur);
  renderTables(false);
}

async function handleAction(id, action) {
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
      // collapse after select
      collapseAfterSelect(id, "wash");
      break;

    case "car-red-line":
      updates.wash_status = "ON_RED_LINE";
      updates.wash_status_at = now;
      collapseAfterSelect(id, "wash");
      break;

    case "wash-rewash":
      updates.wash_status = "REWASH";
      updates.wash_status_at = now;
      collapseAfterSelect(id, "wash");
      break;

    case "wash-needs-rewash":
      updates.wash_status = "NEEDS_REWASH";
      updates.wash_status_at = now;
      collapseAfterSelect(id, "wash");
      break;

    case "wash-dusty":
      updates.wash_status = "DUSTY";
      updates.wash_status_at = now;
      collapseAfterSelect(id, "wash");
      break;

    /* --- valets --- */
    case "with-fernando":
      setValetUpdates(updates, "Fernando", now);
      collapseAfterSelect(id, "valet");
      break;
    case "with-juan":
      setValetUpdates(updates, "Juan", now);
      collapseAfterSelect(id, "valet");
      break;
    case "with-miguel":
      setValetUpdates(updates, "Miguel", now);
      collapseAfterSelect(id, "valet");
      break;
    case "with-maria":
      setValetUpdates(updates, "Maria", now);
      collapseAfterSelect(id, "valet");
      break;
    case "with-helper":
      setValetUpdates(updates, "Helper", now);
      collapseAfterSelect(id, "valet");
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
      const promptText = existing
        ? "Add new note (previous notes stay on record):\n\n" +
          existing +
          "\n\nNew note:"
        : "Add note:";
      const newNote = window.prompt(promptText, "");
      if (newNote === null) return;
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
        lines.push(
          `Keys with ${p.keys_holder}: ` + formatTime(p.keys_with_valet_at)
        );
      if (p.keys_at_machine_at)
        lines.push("Keys in key machine: " + formatTime(p.keys_at_machine_at));
      if (p.wash_status_at && p.wash_status && p.wash_status !== "NONE")
        lines.push(
          `Wash status (${humanWashStatus(p.wash_status)}): ` +
            formatTime(p.wash_status_at)
        );
      if (p.waiting_client_at)
        lines.push(
          "Waiting/staged for customer: " + formatTime(p.waiting_client_at)
        );
      if (p.completed_at)
        lines.push("Completed: " + formatTime(p.completed_at));

      const masterSeconds = computeMasterSeconds(p, new Date());
      lines.push(
        "Master cycle (Active box in/out): " + formatDuration(masterSeconds)
      );

      if (p.notes) {
        lines.push("");
        lines.push("Notes history:");
        p.notes.split("\n").forEach((n) => lines.push("• " + n));
      }

      alert(lines.join("\n"));
      return;
    }

    default:
      return;
  }

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase.from("pickups").update(updates).eq("id", id);

  if (error) {
    console.error(error);
    alert("Error saving update. Check console.");
  }
}

function collapseAfterSelect(id, key) {
  const cur = expandState.get(id) || { wash: false, valet: false };
  cur[key] = false; // collapse chooser after a selection
  expandState.set(id, cur);
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
  const { data, error } = await supabase
    .from("pickups")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  pickups = data || [];
  renderTables(false);
}

function subscribeRealtime() {
  supabase
    .from("pickups")
    .on("*", () => {
      loadPickups();
    })
    .subscribe();
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
  const completed = pickups
    .filter((p) => p.status === "COMPLETE")
    .slice(0, 50);

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
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>
        <button class="btn small dispatcher-only" data-action="activate-from-staged" data-id="${p.id}">
          Activate
        </button>
      </td>
    </tr>
  `;
}

/*
  Active columns:
   1 Tag #
   2 Customer
   3 Status/Location
   4 Keys with
   5 Valet Time
   6 (Dispatcher only) Staged
   7 Notes
   8 Master Time
*/
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
  const lastNote = notesPieces.length ? notesPieces[notesPieces.length - 1] : "";

  const washSelectedLabel =
    currentWash && currentWash !== "NONE" ? humanWashStatus(currentWash) : "—";
  const valetSelectedLabel = currentValet ? `Keys with ${currentValet}` : "—";

  const expanded = expandState.get(String(p.id)) || { wash: false, valet: false };

  const washChooser = `
    <div class="wash-buttons" style="margin-top:0.15rem;">
      <button class="btn small ${currentWash === "IN_WASH_AREA" ? "selected" : ""}"
        data-action="car-wash-area" data-id="${p.id}">Car in wash</button>
      <button class="btn small ${currentWash === "ON_RED_LINE" ? "selected" : ""}"
        data-action="car-red-line" data-id="${p.id}">Car on red line</button>
    </div>
    <div class="wash-buttons" style="margin-top:0.15rem;">
      <button class="btn small ${currentWash === "DUSTY" ? "selected" : ""}"
        data-action="wash-dusty" data-id="${p.id}">Dusty</button>
      <button class="btn small keymachine-only ${p.status === "KEYS_IN_MACHINE" ? "selected" : ""}"
        data-action="keys-machine" data-id="${p.id}">Key machine</button>
    </div>
    <div class="wash-buttons" style="margin-top:0.15rem;">
      <button class="btn small ${currentWash === "NEEDS_REWASH" ? "selected wash-needs" : ""}"
        data-action="wash-needs-rewash" data-id="${p.id}">Needs rewash</button>
      <button class="btn small ${currentWash === "REWASH" ? "selected" : ""}"
        data-action="wash-rewash" data-id="${p.id}">Re wash</button>
    </div>
  `;

  const washCollapsed = `
    <div>
      <button class="btn small selected" data-action="toggle-wash" data-id="${p.id}">
        ${escapeHtml(washSelectedLabel)}
      </button>
      <button class="btn small" style="margin-left:0.25rem;" data-action="toggle-wash" data-id="${p.id}">
        Change
      </button>
    </div>
  `;

  const valetChooser = `
    <div class="keys-buttons">
      <button class="btn small ${currentValet === "Fernando" ? "selected" : ""}" data-action="with-fernando" data-id="${p.id}">Fernando</button>
      <button class="btn small ${currentValet === "Juan" ? "selected" : ""}" data-action="with-juan" data-id="${p.id}">Juan</button>
      <button class="btn small ${currentValet === "Miguel" ? "selected" : ""}" data-action="with-miguel" data-id="${p.id}">Miguel</button>
      <button class="btn small ${currentValet === "Maria" ? "selected" : ""}" data-action="with-maria" data-id="${p.id}">Maria</button>
      <button class="btn small ${currentValet === "Helper" ? "selected" : ""}" data-action="with-helper" data-id="${p.id}">Helper</button>
    </div>
  `;

  const valetCollapsed = `
    <div>
      <button class="btn small selected" data-action="toggle-valet" data-id="${p.id}">
        ${escapeHtml(valetSelectedLabel)}
      </button>
      <button class="btn small" style="margin-left:0.25rem;" data-action="toggle-valet" data-id="${p.id}">
        Change
      </button>
    </div>
  `;

  const washCell =
    currentWash === "NONE" || expanded.wash ? washChooser : washCollapsed;

  const valetCell =
    !currentValet || expanded.valet ? valetChooser : valetCollapsed;

  const notesHtml = `
    <button class="btn small notes-button" data-action="edit-note" data-id="${p.id}">Add note</button>
    ${lastNote ? `<div class="notes-preview">${escapeHtml(lastNote)}</div>` : ""}
  `;

  if (role === "dispatcher") {
    return `
      <tr>
        <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
        <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
        <td>${washCell}</td>
        <td>${valetCell}</td>
        <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
        <td class="dispatcher-only">
          <button class="btn small dispatcher-only" data-action="waiting-customer" data-id="${p.id}">
            Move to staged
          </button>
        </td>
        <td>${notesHtml}</td>
        <td>
          <span class="timer ${masterClass}">${masterLabel}</span>
          ${
            pqiEnabled
              ? '<span class="pqi-badge" style="margin-left:0.3rem;font-size:0.7rem;color:#9ca3af;">PQI</span>'
              : ""
          }
        </td>
      </tr>
    `;
  }

  // keymachine / carwash / serviceadvisor / loancar: 7 cols (no staged)
  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${washCell}</td>
      <td>${valetCell}</td>
      <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
      <td>${notesHtml}</td>
      <td>
        <span class="timer ${masterClass}">${masterLabel}</span>
        ${
          pqiEnabled
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
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
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
    const waitingSeconds = computeSeconds(p.waiting_client_at, p.completed_at, now);
    const waitingClass = timerClass(computeSeverity(waitingSeconds));
    const waitingLabel = formatDuration(waitingSeconds);

    return `
      <tr>
        <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
        <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
        <td>${escapeHtml(deliveredBy)}</td>
        <td><span class="timer ${waitingClass}">${waitingLabel}</span></td>
      </tr>
    `;
  }

  const deliveredBy = p.keys_holder || "—";

  const stagedSeconds = computeSeconds(p.waiting_client_at, p.completed_at, now);
  const stagedClass = timerClass(computeSeverity(stagedSeconds));
  const stagedLabel = formatDuration(stagedSeconds);

  const masterSeconds = computeMasterSeconds(p, now);
  const masterClass = timerClass(computeSeverity(masterSeconds));
  const masterLabel = formatDuration(masterSeconds);

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);
  const lastNote = notesPieces.length ? notesPieces[notesPieces.length - 1] : "";

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${stagedClass}">${stagedLabel}</span></td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
      <td>
        <button class="btn small notes-button dispatcher-only" data-action="edit-note" data-id="${p.id}">
          Add note
        </button>
        ${lastNote ? `<div class="notes-preview">${escapeHtml(lastNote)}</div>` : ""}
      </td>
      <td>
        <button class="btn small dispatcher-only" data-action="customer-picked-up" data-id="${p.id}">
          Customer picked up
        </button>
      </td>
    </tr>
  `;
}

function renderCompletedRow(p, now) {
  const masterSeconds = computeMasterSeconds(p, now);
  const masterLabel = formatDuration(masterSeconds);
  const deliveredBy = p.keys_holder || "—";

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);
  const lastNote = notesPieces.length ? notesPieces[notesPieces.length - 1] : "";
  const prevNotes = notesPieces.slice(0, -1);

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${masterLabel}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>${formatTime(p.completed_at)}</td>
      <td>
        ${lastNote ? escapeHtml(lastNote) : ""}
        ${
          prevNotes.length
            ? "<br>" + prevNotes.map((n) => escapeHtml(n)).join("<br>")
            : ""
        }
      </td>
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

  const baseValets = ["Fernando", "Juan", "Miguel", "Maria", "Helper"];
  const valetCounts = {};
  baseValets.forEach((v) => (valetCounts[v] = 0));

  pickups.forEach((p) => {
    if (!p.keys_holder) return;
    if (valetCounts[p.keys_holder] === undefined) {
      valetCounts[p.keys_holder] = 0;
    }
    valetCounts[p.keys_holder] += 1;
  });

  valetsEl.innerHTML = baseValets
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
      audio.play().catch(() => {});
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
      return "Car in wash";
    case "ON_RED_LINE":
      return "On red line";
    case "REWASH":
      return "Re wash";
    case "NEEDS_REWASH":
      return "Needs rewash";
    case "DUSTY":
      return "Dusty";
    case "NONE":
    default:
      return "Not set";
  }
}

/* master timer: ONLY Active box time */
function computeMasterSeconds(p, now) {
  const startIso = p.active_started_at || p.created_at;
  if (!startIso) return 0;
  const endIso = p.waiting_client_at || null;
  return computeSeconds(startIso, endIso, now);
}

/* valet timer */
function computeValetSeconds(p, now) {
  if (!p.keys_with_valet_at) return null;
  const startIso = p.keys_with_valet_at;
  const endIso =
    p.keys_at_machine_at || p.waiting_client_at || p.completed_at || null;
  return computeSeconds(startIso, endIso, now);
}

function computeSeconds(startIso, endIso, now) {
  if (!startIso) return 0;
  const start = new Date(startIso);
  let end = endIso ? new Date(endIso) : now;
  if (end < start) end = now;
  const diffMs = end - start;
  if (Number.isNaN(diffMs) || diffMs < 0) return 0;
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
