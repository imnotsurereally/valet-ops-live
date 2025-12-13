// app.js — Schema-based renderer (NO feature changes)
import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map(); // id -> severity for sound alerts
let pqiEnabled = false;
let uiStateLoaded = false;

/* =========================================================
   ROLE + BOOT
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
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

  setInterval(() => renderTables(true), 15 * 1000);
});

/* =========================================================
   UI STATE (completed collapse + PQI)
========================================================= */

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

/* =========================================================
   PQI toggle (global)
========================================================= */

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

/* =========================================================
   NEW PICKUP FORM (role routes unchanged)
========================================================= */

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

    let insertData = {
      tag_number: tag,
      customer_name: name,
      status: staged ? "STAGED" : "NEW",
      wash_status: "NONE",
      active_started_at: staged ? null : nowIso
    };

    // service advisor: always STAGED (V1)
    if (role === "serviceadvisor") {
      insertData.status = "STAGED";
      insertData.active_started_at = null;
    }

    // loan car: goes to NEW + auto-note (V1)
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

/* =========================================================
   TABLE ACTIONS + PERMISSIONS (unchanged)
========================================================= */

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

  // Permission gate: service advisor + loan car can only add notes
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
  const now = new Date().toISOString();
  const updates = {};

  switch (action) {
    case "activate-from-staged":
      updates.status = "NEW";
      updates.active_started_at = now;
      break;

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

    case "wash-rewash":
      updates.wash_status = "REWASH";
      updates.wash_status_at = now;
      break;

    case "wash-needs-rewash":
      updates.wash_status = "NEEDS_REWASH";
      updates.wash_status_at = now;
      break;

    case "wash-dusty":
      updates.wash_status = "DUSTY";
      updates.wash_status_at = now;
      break;

    case "with-fernando":
      setValetUpdates(updates, "Fernando", now);
      break;
    case "with-juan":
      setValetUpdates(updates, "Juan", now);
      break;
    case "with-miguel":
      setValetUpdates(updates, "Miguel", now);
      break;
    case "with-maria":
      setValetUpdates(updates, "Maria", now);
      break;
    case "with-helper":
      setValetUpdates(updates, "Helper", now);
      break;

    case "waiting-customer":
      updates.status = "WAITING_FOR_CUSTOMER";
      updates.waiting_client_at = now;
      break;

    case "customer-picked-up":
      updates.status = "COMPLETE";
      updates.completed_at = now;
      break;

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
          `Wash status (${humanWashStatus(p.wash_status)}): ` + formatTime(p.wash_status_at)
        );
      if (p.waiting_client_at)
        lines.push("Waiting/staged for customer: " + formatTime(p.waiting_client_at));
      if (p.completed_at)
        lines.push("Completed: " + formatTime(p.completed_at));

      const masterSeconds = computeMasterSeconds(p, new Date());
      lines.push("Master cycle (Active box in/out): " + formatDuration(masterSeconds));

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

function setValetUpdates(updates, name, nowIso) {
  updates.status = "KEYS_WITH_VALET";
  updates.keys_holder = name;
  updates.keys_with_valet_at = nowIso;
}

/* =========================================================
   COMPLETED COLLAPSE
========================================================= */

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

/* =========================================================
   DATA + REALTIME
========================================================= */

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
    .on("*", () => loadPickups())
    .subscribe();
}

/* =========================================================
   SCHEMA-BASED RENDER ENGINE (NO feature changes)
========================================================= */

function schemaFor(tableKey) {
  if (tableKey === "active") {
    if (role === "dispatcher") return "active_dispatcher";
    if (role === "wallboard") return "active_wallboard";
    return "active_base";
  }
  if (tableKey === "waiting") {
    return role === "wallboard" ? "waiting_wallboard" : "waiting_dispatcher";
  }
  if (tableKey === "staged") return "staged";
  if (tableKey === "completed") return "completed_dispatcher";
  return tableKey;
}

const SCHEMAS = {
  staged: {
    emptyText: "No staged tickets.",
    emptyColspan: 4,
    columns: [
      { key: "tag", cell: (p) => pillTag(p) },
      { key: "customer", cell: (p) => pillCustomer(p) },
      { key: "stagedAt", cell: (p) => escapeHtml(formatTime(p.created_at)) },
      {
        key: "activate",
        cell: (p) =>
          `<button class="btn small dispatcher-only" data-action="activate-from-staged" data-id="${p.id}">Activate</button>`
      }
    ]
  },

  active_dispatcher: {
    emptyText: "No active pickups.",
    emptyColspan: 8,
    columns: [
      { key: "tag", cell: (p) => pillTag(p) },
      { key: "customer", cell: (p) => pillCustomer(p) },
      { key: "statusLocation", cell: (p, ctx) => cellStatusLocation(p, ctx) },
      { key: "keysWith", cell: (p, ctx) => cellKeysWith(p, ctx) },
      { key: "valetTime", cell: (p, ctx) => cellValetTime(p, ctx) },
      {
        key: "stagedMove",
        cell: (p) =>
          `<button class="btn small dispatcher-only" data-action="waiting-customer" data-id="${p.id}">Move to staged</button>`
      },
      { key: "notes", cell: (p) => cellNotes(p) },
      { key: "masterTime", cell: (p, ctx) => cellMasterTime(p, ctx) }
    ]
  },

  active_base: {
    emptyText: "No active pickups.",
    emptyColspan: 7,
    columns: [
      { key: "tag", cell: (p) => pillTag(p) },
      { key: "customer", cell: (p) => pillCustomer(p) },
      { key: "statusLocation", cell: (p, ctx) => cellStatusLocation(p, ctx) },
      { key: "keysWith", cell: (p, ctx) => cellKeysWith(p, ctx) },
      { key: "valetTime", cell: (p, ctx) => cellValetTime(p, ctx) },
      { key: "notes", cell: (p) => cellNotes(p) },
      { key: "masterTime", cell: (p, ctx) => cellMasterTime(p, ctx) }
    ]
  },

  active_wallboard: {
    emptyText: "No active pickups.",
    emptyColspan: 6,
    columns: [
      { key: "tag", cell: (p) => pillTag(p) },
      { key: "customer", cell: (p) => pillCustomer(p) },
      { key: "statusText", cell: (p) => `<span class="status-badge">${escapeHtml(humanStatus(p))}</span>` },
      {
        key: "keysText",
        cell: (p) => escapeHtml(p.keys_holder ? `Keys with ${p.keys_holder}` : "—")
      },
      { key: "valetTime", cell: (p, ctx) => cellValetTime(p, ctx, true) },
      { key: "masterTime", cell: (p, ctx) => cellMasterTime(p, ctx, true) }
    ]
  },

  waiting_dispatcher: {
    emptyText: "None currently waiting.",
    emptyColspan: 7,
    columns: [
      { key: "tag", cell: (p) => pillTag(p) },
      { key: "customer", cell: (p) => pillCustomer(p) },
      { key: "deliveredBy", cell: (p) => escapeHtml(p.keys_holder || "—") },
      { key: "stagedTime", cell: (p, ctx) => cellWaitingTime(p, ctx) },
      { key: "masterTime", cell: (p, ctx) => cellMasterTime(p, ctx) },
      { key: "notes", cell: (p) => cellNotes(p, true) },
      {
        key: "pickedUpAction",
        cell: (p) =>
          `<button class="btn small dispatcher-only" data-action="customer-picked-up" data-id="${p.id}">Customer picked up</button>`
      }
    ]
  },

  waiting_wallboard: {
    emptyText: "None currently waiting.",
    emptyColspan: 4,
    columns: [
      { key: "tag", cell: (p) => pillTag(p) },
      { key: "customer", cell: (p) => pillCustomer(p) },
      { key: "deliveredBy", cell: (p) => escapeHtml(p.keys_holder || "—") },
      { key: "waitingTime", cell: (p, ctx) => cellWaitingTime(p, ctx, true) }
    ]
  },

  completed_dispatcher: {
    emptyText: "No completed tickets yet.",
    emptyColspan: 8,
    columns: [
      { key: "tag", cell: (p) => pillTag(p) },
      { key: "customer", cell: (p) => pillCustomer(p) },
      { key: "totalTime", cell: (p, ctx) => escapeHtml(formatDuration(computeMasterSeconds(p, ctx.now))) },
      { key: "deliveredBy", cell: (p) => escapeHtml(p.keys_holder || "—") },
      { key: "createdAt", cell: (p) => escapeHtml(formatTime(p.created_at)) },
      { key: "completedAt", cell: (p) => escapeHtml(formatTime(p.completed_at)) },
      { key: "notes", cell: (p) => escapeHtml(latestNote(p) || "") },
      {
        key: "timelineAction",
        cell: (p) => `<button class="btn small" data-action="view-timeline" data-id="${p.id}">Timeline</button>`
      }
    ]
  }
};

function renderRow(schemaName, pickup, ctx) {
  const schema = SCHEMAS[schemaName];
  return (
    "<tr>" +
    schema.columns.map((col) => `<td>${col.cell(pickup, ctx)}</td>`).join("") +
    "</tr>"
  );
}

function renderEmpty(schemaName) {
  const s = SCHEMAS[schemaName];
  return `<tr><td colspan="${s.emptyColspan}" class="empty">${escapeHtml(s.emptyText)}</td></tr>`;
}

/* =========================================================
   RENDER TABLES (now schema-driven)
========================================================= */

function renderTables(isTimerTick) {
  const now = new Date();
  const ctx = { now, role };

  const staged = pickups.filter((p) => p.status === "STAGED");
  const active = pickups.filter(
    (p) => p.status !== "STAGED" && p.status !== "WAITING_FOR_CUSTOMER" && p.status !== "COMPLETE"
  );
  const waiting = pickups.filter((p) => p.status === "WAITING_FOR_CUSTOMER");
  const completed = pickups.filter((p) => p.status === "COMPLETE").slice(0, 50);

  active.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  setCount("count-staged", staged.length);
  setCount("count-active", active.length);
  setCount("count-waiting", waiting.length);
  setCount("count-completed", completed.length);

  const stagedTbody = document.getElementById("staged-tbody");
  const activeTbody = document.getElementById("active-tbody");
  const waitingTbody = document.getElementById("waiting-tbody");
  const completedTbody = document.getElementById("completed-tbody");

  const stagedSchema = schemaFor("staged");
  const activeSchema = schemaFor("active");
  const waitingSchema = schemaFor("waiting");
  const completedSchema = schemaFor("completed");

  if (stagedTbody) {
    stagedTbody.innerHTML = staged.length
      ? staged.map((p) => renderRow(stagedSchema, p, ctx)).join("")
      : renderEmpty(stagedSchema);
  }

  if (activeTbody) {
    activeTbody.innerHTML = active.length
      ? active.map((p) => renderRow(activeSchema, p, ctx)).join("")
      : renderEmpty(activeSchema);
  }

  if (waitingTbody) {
    waitingTbody.innerHTML = waiting.length
      ? waiting.map((p) => renderRow(waitingSchema, p, ctx)).join("")
      : renderEmpty(waitingSchema);
  }

  if (completedTbody) {
    // completed only exists on dispatcher pages; safe if missing
    completedTbody.innerHTML = completed.length
      ? completed.map((p) => renderRow(completedSchema, p, ctx)).join("")
      : renderEmpty(completedSchema);
  }

  if (role === "dispatcher") renderMetrics(active, waiting, completed, now);
  if (isTimerTick) maybePlayAlerts(active, now);
}

/* =========================================================
   CELL RENDERERS (pure)
========================================================= */

function pillTag(p) {
  return `<span class="cell-tag">${escapeHtml(p.tag_number)}</span>`;
}

function pillCustomer(p) {
  return `<span class="cell-customer">${escapeHtml(p.customer_name)}</span>`;
}

function latestNote(p) {
  const notesPieces = (p.notes || "").split("\n").filter(Boolean);
  return notesPieces.length ? notesPieces[notesPieces.length - 1] : "";
}

function cellNotes(p, dispatcherContext = false) {
  const last = latestNote(p);
  // keep same behavior: button + latest note pill
  const btnClass = dispatcherContext ? "dispatcher-only" : "";
  return `
    <button class="btn small notes-button ${btnClass}" data-action="edit-note" data-id="${p.id}">Add note</button>
    ${last ? `<div class="notes-preview">${escapeHtml(last)}</div>` : ""}
  `;
}

function cellStatusLocation(p, ctx) {
  const currentWash = p.wash_status || "NONE";
  const selectedLabel =
    currentWash && currentWash !== "NONE" ? humanWashStatus(currentWash) : "—";

  const washBtns = `
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

  return `
    <div class="status-badge">${escapeHtml(selectedLabel)}</div>
    ${washBtns}
  `;
}

function cellKeysWith(p, ctx) {
  const currentValet = p.keys_holder || "";
  const selectedLabel = currentValet ? `Keys with ${currentValet}` : "—";

  const valetBtns = `
    <div class="keys-buttons">
      <button class="btn small ${currentValet === "Fernando" ? "selected" : ""}" data-action="with-fernando" data-id="${p.id}">Fernando</button>
      <button class="btn small ${currentValet === "Juan" ? "selected" : ""}" data-action="with-juan" data-id="${p.id}">Juan</button>
      <button class="btn small ${currentValet === "Miguel" ? "selected" : ""}" data-action="with-miguel" data-id="${p.id}">Miguel</button>
      <button class="btn small ${currentValet === "Maria" ? "selected" : ""}" data-action="with-maria" data-id="${p.id}">Maria</button>
      <button class="btn small ${currentValet === "Helper" ? "selected" : ""}" data-action="with-helper" data-id="${p.id}">Helper</button>
    </div>
  `;

  return `
    <div class="status-badge">${escapeHtml(selectedLabel)}</div>
    ${valetBtns}
  `;
}

function cellValetTime(p, ctx, wallboard = false) {
  const valetSeconds = computeValetSeconds(p, ctx.now);
  const valetClass =
    valetSeconds != null ? timerClass(computeSeverity(valetSeconds)) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";
  return `<span class="timer ${valetClass}">${escapeHtml(valetLabelTime)}</span>`;
}

function cellMasterTime(p, ctx, wallboard = false) {
  const masterSeconds = computeMasterSeconds(p, ctx.now);
  const masterClass = timerClass(computeSeverity(masterSeconds));
  const masterLabel = formatDuration(masterSeconds);

  const pqi = pqiEnabled
    ? '<span class="pqi-badge" style="margin-left:0.3rem;font-size:0.7rem;color:#9ca3af;">PQI</span>'
    : "";

  return `<span class="timer ${masterClass}">${escapeHtml(masterLabel)}</span>${pqi}`;
}

function cellWaitingTime(p, ctx, wallboard = false) {
  const seconds = computeSeconds(p.waiting_client_at, p.completed_at, ctx.now);
  const klass = timerClass(computeSeverity(seconds));
  const label = formatDuration(seconds);
  return `<span class="timer ${klass}">${escapeHtml(label)}</span>`;
}

/* =========================================================
   COUNTS
========================================================= */

function setCount(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value);
}

/* =========================================================
   METRICS (unchanged)
========================================================= */

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

  // Avg cycle time = time inside ACTIVE PICKUPS (active_started_at -> waiting_client_at)
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

  // Red line cars ON now
  const redLineCount = pickups.filter(
    (p) => p.wash_status === "ON_RED_LINE" && p.status !== "COMPLETE"
  ).length;
  redlineCountEl.textContent = String(redLineCount);

  // Valet counts
  const baseValets = ["Fernando", "Juan", "Miguel", "Maria", "Helper"];
  const valetCounts = {};
  baseValets.forEach((v) => (valetCounts[v] = 0));

  pickups.forEach((p) => {
    if (!p.keys_holder) return;
    if (valetCounts[p.keys_holder] === undefined) valetCounts[p.keys_holder] = 0;
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

/* =========================================================
   ALERTS (unchanged)
========================================================= */

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

/* =========================================================
   HELPERS (unchanged)
========================================================= */

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
      return "Car in wash area";
    case "ON_RED_LINE":
      return "Car on red line";
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

/* master timer: ONLY Active box time
   start = active_started_at (or created_at fallback)
   end   = waiting_client_at (if set) else now
*/
function computeMasterSeconds(p, now) {
  const startIso = p.active_started_at || p.created_at;
  if (!startIso) return 0;
  const endIso = p.waiting_client_at || null;
  return computeSeconds(startIso, endIso, now);
}

/* valet timer: keys_with_valet_at -> first of (keys_at_machine_at, waiting_client_at, completed_at, now) */
function computeValetSeconds(p, now) {
  if (!p.keys_with_valet_at) return null;
  const startIso = p.keys_with_valet_at;
  const endIso = p.keys_at_machine_at || p.waiting_client_at || p.completed_at || null;
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
  const snapped = Math.round(seconds / 15) * 15; // 15s steps
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
