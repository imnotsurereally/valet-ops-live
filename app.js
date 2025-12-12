import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map();
let pqiEnabled = false;
let uiStateLoaded = false;

const VALETS = ["Fernando", "Juan", "Miguel", "Maria", "Helper"];

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("role-keymachine")) role = "keymachine";
  else if (document.body.classList.contains("role-carwash")) role = "carwash";
  else if (document.body.classList.contains("role-wallboard")) role = "wallboard";
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

/* ---------- UI STATE ---------- */
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
  const completedCollapsed = !!(section && section.classList.contains("completed-collapsed"));
  const state = { completedCollapsed, pqiEnabled };
  try {
    localStorage.setItem("valetOpsState", JSON.stringify(state));
  } catch {}
}

/* ---------- PQI toggle ---------- */
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

    const tag = tagInput.value.trim();
    const name = nameInput.value.trim();
    const staged = stageCheckbox?.checked || false;
    if (!tag || !name) return;

    const nowIso = new Date().toISOString();

    const insertData = {
      tag_number: tag,
      customer_name: name,
      status: staged ? "STAGED" : "NEW",
      wash_status: "NONE",
      active_started_at: staged ? null : nowIso
    };

    const { error } = await supabase.from("pickups").insert(insertData);

    if (error) {
      console.error(error);
      alert("Error creating ticket. Check console.");
      return;
    }

    tagInput.value = "";
    nameInput.value = "";
    if (stageCheckbox) stageCheckbox.checked = false;
  });
}

/* ---------- TABLE ACTIONS ---------- */
function setupTableActions() {
  ["active-tbody", "staged-tbody", "waiting-tbody", "completed-tbody"].forEach((id) => {
    const tbody = document.getElementById(id);
    if (!tbody) return;
    tbody.addEventListener("click", onTableClick);
  });
}

function onTableClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const id = btn.getAttribute("data-id");
  const action = btn.getAttribute("data-action");
  if (!id || !action) return;

  handleAction(id, action);
}

/* ---------- ACTION HANDLER ---------- */
async function handleAction(id, action) {
  // Wallboard is read-only.
  if (role === "wallboard") return;

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

    case "clear-wash":
      updates.wash_status = "NONE";
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

    case "clear-valet":
      updates.status = "NEW";
      updates.keys_holder = null;
      updates.keys_with_valet_at = null;
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
        ? "Add new note (previous notes stay):\n\n" + existing + "\n\nNew note:"
        : "Add note:";
      const newNote = window.prompt(promptText, "");
      if (newNote === null) return;

      const trimmed = newNote.trim();
      if (!trimmed) return;

      const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
      if (p.active_started_at) lines.push("Entered Active Pickups: " + formatTime(p.active_started_at));
      if (p.keys_with_valet_at && p.keys_holder) lines.push(`Keys with ${p.keys_holder}: ` + formatTime(p.keys_with_valet_at));
      if (p.keys_at_machine_at) lines.push("Keys in key machine: " + formatTime(p.keys_at_machine_at));
      if (p.wash_status_at && p.wash_status && p.wash_status !== "NONE") lines.push(`Wash status (${humanWashStatus(p.wash_status)}): ` + formatTime(p.wash_status_at));
      if (p.waiting_client_at) lines.push("Waiting/staged for customer: " + formatTime(p.waiting_client_at));
      if (p.completed_at) lines.push("Completed: " + formatTime(p.completed_at));

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
  const active = pickups.filter((p) => p.status !== "STAGED" && p.status !== "WAITING_FOR_CUSTOMER" && p.status !== "COMPLETE");
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

  if (stagedTbody) {
    stagedTbody.innerHTML =
      staged.length === 0
        ? '<tr><td colspan="4" class="empty">No staged tickets.</td></tr>'
        : staged.map((p) => renderStagedRow(p)).join("");
  }

  if (activeTbody) {
    const cols = role === "dispatcher" ? 8 : (role === "wallboard" ? 6 : 7);
    activeTbody.innerHTML =
      active.length === 0
        ? `<tr><td colspan="${cols}" class="empty">No active pickups.</td></tr>`
        : active.map((p) => renderActiveRow(p, now)).join("");
  }

  if (waitingTbody) {
    const cols = role === "wallboard" ? 4 : 7;
    waitingTbody.innerHTML =
      waiting.length === 0
        ? `<tr><td colspan="${cols}" class="empty">None currently waiting.</td></tr>`
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

function renderActiveRow(p, now) {
  const masterSeconds = computeMasterSeconds(p, now);
  const masterClass = timerClass(computeSeverity(masterSeconds));
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetLabelTime = valetSeconds != null ? formatDuration(valetSeconds) : "–";
  const valetClass = valetSeconds != null ? timerClass(computeSeverity(valetSeconds)) : "";

  const currentWash = p.wash_status || "NONE";
  const currentValet = p.keys_holder || "";

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);
  const lastNote = notesPieces.length ? notesPieces[notesPieces.length - 1] : "";
  const prevNotes = notesPieces.slice(0, -1);

  const washBlock = renderWashBlock(currentWash, p.id, p.status);
  const valetBlock = renderValetBlock(currentValet, p.id);

  // WALLBOARD (6 cols)
  if (role === "wallboard") {
    return `
      <tr>
        <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
        <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
        <td><span class="status-badge">${humanStatus(p)}</span></td>
        <td>${escapeHtml(currentValet || "—")}</td>
        <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
        <td><span class="timer ${masterClass}">${masterLabel}</span></td>
      </tr>
    `;
  }

  // DISPATCHER (8 cols)
  if (role === "dispatcher") {
    return `
      <tr>
        <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
        <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
        <td>${washBlock}</td>
        <td>
          ${valetBlock}
          <div class="section-subtitle" style="margin-top:0.15rem;">
            ${currentValet ? `Keys with ${escapeHtml(currentValet)}` : "—"}
          </div>
        </td>
        <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
        <td class="dispatcher-only">
          <button class="btn small dispatcher-only" data-action="waiting-customer" data-id="${p.id}">
            Move to staged
          </button>
        </td>
        <td>
          <button class="btn small notes-button" data-action="edit-note" data-id="${p.id}">Add note</button>
          ${lastNote ? `<div class="notes-preview">${escapeHtml(lastNote)}</div>` : ""}
          ${prevNotes.length ? prevNotes.map((n) => `<div class="notes-history-line">${escapeHtml(n)}</div>`).join("") : ""}
        </td>
        <td>
          <span class="timer ${masterClass}">${masterLabel}</span>
          ${pqiEnabled ? `<span class="pqi-badge" style="margin-left:0.3rem;font-size:0.7rem;color:#9ca3af;">PQI</span>` : ""}
        </td>
      </tr>
    `;
  }

  // KEYMACHINE / CARWASH (7 cols)
  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${washBlock}</td>
      <td>
        ${valetBlock}
        <div class="section-subtitle" style="margin-top:0.15rem;">
          ${currentValet ? `Keys with ${escapeHtml(currentValet)}` : "—"}
        </div>
      </td>
      <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
      <td>
        <button class="btn small notes-button" data-action="edit-note" data-id="${p.id}">Add note</button>
        ${lastNote ? `<div class="notes-preview">${escapeHtml(lastNote)}</div>` : ""}
        ${prevNotes.length ? prevNotes.map((n) => `<div class="notes-history-line">${escapeHtml(n)}</div>`).join("") : ""}
      </td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
    </tr>
  `;
}

function renderWashBlock(currentWash, id, status) {
  // If something is set, show only the selected pill + Change (cleaner)
  if (currentWash && currentWash !== "NONE") {
    const isNeeds = currentWash === "NEEDS_REWASH";
    const classes = `btn small selected ${isNeeds ? "wash-needs" : ""}`;
    return `
      <div class="wash-buttons">
        <button class="${classes}" data-action="${washActionFromState(currentWash)}" data-id="${id}">
          ${washLabelFromState(currentWash, status)}
        </button>
        <button class="btn small" data-action="clear-wash" data-id="${id}">Change</button>
      </div>
    `;
  }

  // Otherwise show options
  return `
    <div>
      <div class="wash-buttons">
        <button class="btn small" data-action="car-wash-area" data-id="${id}">Car in wash</button>
        <button class="btn small" data-action="car-red-line" data-id="${id}">Car on red line</button>
      </div>
      <div class="wash-buttons" style="margin-top:0.15rem;">
        <button class="btn small" data-action="wash-dusty" data-id="${id}">Dusty</button>
        <button class="btn small" data-action="wash-needs-rewash" data-id="${id}">Needs rewash</button>
        <button class="btn small" data-action="wash-rewash" data-id="${id}">Re wash</button>
      </div>
      <div class="wash-buttons" style="margin-top:0.15rem;">
        <button class="btn small ${status === "KEYS_IN_MACHINE" ? "selected" : ""}" data-action="keys-machine" data-id="${id}">
          Key machine
        </button>
      </div>
    </div>
  `;
}

function renderValetBlock(currentValet, id) {
  // If set, show only selected valet + Change
  if (currentValet && VALETS.includes(currentValet)) {
    return `
      <div class="keys-buttons">
        <button class="btn small selected" data-action="${valetActionFromName(currentValet)}" data-id="${id}">
          ${escapeHtml(currentValet)}
        </button>
        <button class="btn small" data-action="clear-valet" data-id="${id}">Change</button>
      </div>
    `;
  }

  // Otherwise show all valet options
  return `
    <div class="keys-buttons">
      ${VALETS.map((v) => {
        return `<button class="btn small" data-action="${valetActionFromName(v)}" data-id="${id}">${escapeHtml(v)}</button>`;
      }).join("")}
    </div>
  `;
}

function washActionFromState(state) {
  switch (state) {
    case "IN_WASH_AREA": return "car-wash-area";
    case "ON_RED_LINE": return "car-red-line";
    case "DUSTY": return "wash-dusty";
    case "NEEDS_REWASH": return "wash-needs-rewash";
    case "REWASH": return "wash-rewash";
    default: return "car-wash-area";
  }
}

function washLabelFromState(state, status) {
  if (status === "KEYS_IN_MACHINE") return "Key machine";
  switch (state) {
    case "IN_WASH_AREA": return "Car in wash";
    case "ON_RED_LINE": return "Car on red line";
    case "DUSTY": return "Dusty";
    case "NEEDS_REWASH": return "Needs rewash";
    case "REWASH": return "Re wash";
    default: return "Status set";
  }
}

function valetActionFromName(name) {
  switch (name) {
    case "Fernando": return "with-fernando";
    case "Juan": return "with-juan";
    case "Miguel": return "with-miguel";
    case "Maria": return "with-maria";
    case "Helper": return "with-helper";
    default: return "with-helper";
  }
}

function renderWaitingRow(p, now) {
  const deliveredBy = p.keys_holder || "—";
  const stagedSeconds = computeSeconds(p.waiting_client_at, p.completed_at, now);
  const stagedClass = timerClass(computeSeverity(stagedSeconds));
  const stagedLabel = formatDuration(stagedSeconds);

  const masterSeconds = computeMasterSeconds(p, now);
  const masterClass = timerClass(computeSeverity(masterSeconds));
  const masterLabel = formatDuration(masterSeconds);

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);
  const lastNote = notesPieces.length ? notesPieces[notesPieces.length - 1] : "";
  const prevNotes = notesPieces.slice(0, -1);

  // WALLBOARD waiting table is different (4 cols)
  if (role === "wallboard") {
    return `
      <tr>
        <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
        <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
        <td>${escapeHtml(deliveredBy)}</td>
        <td><span class="timer ${stagedClass}">${stagedLabel}</span></td>
      </tr>
    `;
  }

  // Dispatcher waiting table (7 cols)
  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${stagedClass}">${stagedLabel}</span></td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
      <td>
        <button class="btn small notes-button dispatcher-only" data-action="edit-note" data-id="${p.id}">Add note</button>
        ${lastNote ? `<div class="notes-preview">${escapeHtml(lastNote)}</div>` : ""}
        ${prevNotes.length ? prevNotes.map((n) => `<div class="notes-history-line">${escapeHtml(n)}</div>`).join("") : ""}
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
        ${prevNotes.length ? "<br>" + prevNotes.map((n) => escapeHtml(n)).join("<br>") : ""}
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
  if (!completedTodayEl || !avgCycleEl || !activeCountEl || !waitingCountEl || !redlineCountEl || !valetsEl) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const completedToday = completed.filter((p) => p.completed_at && new Date(p.completed_at) >= today);

  completedTodayEl.textContent = String(completedToday.length);
  activeCountEl.textContent = String(active.length);
  waitingCountEl.textContent = String(waiting.length);

  const cycles = completedToday
    .map((p) => (p.active_started_at && p.waiting_client_at) ? computeSeconds(p.active_started_at, p.waiting_client_at, now) : null)
    .filter((v) => v != null);

  avgCycleEl.textContent = cycles.length ? formatDuration(cycles.reduce((a, b) => a + b, 0) / cycles.length) : "–";

  const redLineCount = pickups.filter((p) => p.wash_status === "ON_RED_LINE" && p.status !== "COMPLETE").length;
  redlineCountEl.textContent = String(redLineCount);

  const valetCounts = {};
  VALETS.forEach((v) => (valetCounts[v] = 0));
  pickups.forEach((p) => {
    if (!p.keys_holder) return;
    if (valetCounts[p.keys_holder] === undefined) valetCounts[p.keys_holder] = 0;
    valetCounts[p.keys_holder] += 1;
  });

  valetsEl.innerHTML = VALETS
    .map((name) => `<li><span class="valet-name">${escapeHtml(name)}</span><span class="valet-count">${valetCounts[name] || 0} tickets</span></li>`)
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
    case "STAGED": return "Staged";
    case "NEW": return "New";
    case "KEYS_IN_MACHINE": return "Key machine";
    case "KEYS_WITH_VALET": return "Keys with valet";
    case "WAITING_FOR_CUSTOMER": return "Waiting/staged for customer";
    case "COMPLETE": return "Complete";
    default: return p.status || "";
  }
}

function humanWashStatus(wash_status) {
  switch (wash_status) {
    case "IN_WASH_AREA": return "Car in wash area";
    case "ON_RED_LINE": return "Car on red line";
    case "REWASH": return "Re wash";
    case "NEEDS_REWASH": return "Needs rewash";
    case "DUSTY": return "Dusty";
    default: return "Not set";
  }
}

function computeMasterSeconds(p, now) {
  const startIso = p.active_started_at || p.created_at;
  if (!startIso) return 0;
  const endIso = p.waiting_client_at || null;
  return computeSeconds(startIso, endIso, now);
}

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
    case "yellow": return "timer-yellow";
    case "orange": return "timer-orange";
    case "red": return "timer-red";
    default: return "timer-green";
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
