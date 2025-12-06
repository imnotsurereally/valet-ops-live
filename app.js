// app.js
import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map(); // id -> 'green'|'yellow'|'orange'|'red'

// Global PQI toggle
let pqiEnabled = false;
let uiStateLoaded = false;

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("role-keymachine")) role = "keymachine";
  else if (document.body.classList.contains("role-carwash")) role = "carwash";
  else if (document.body.classList.contains("role-wallboard")) role = "wallboard";
  else role = "dispatcher";

  setupForm();
  setupTableActions();
  setupCompletedToggle();
  setupPqiToggle();
  loadUIState(); // restore collapsed completed + PQI

  loadPickups();
  subscribeRealtime();

  // Timers every 15 seconds
  setInterval(() => {
    renderTables(true); // true = timer-only update (for sounds)
  }, 15 * 1000);
});

// --------------- UI STATE (AUTO-RECOVERY) -----------------

function loadUIState() {
  if (uiStateLoaded) return;
  uiStateLoaded = true;
  let state;
  try {
    state = JSON.parse(localStorage.getItem("valetOpsState") || "{}");
  } catch {
    state = {};
  }

  // Completed collapsed
  if (state.completedCollapsed) {
    const section = document.getElementById("completed-section");
    const btn = document.getElementById("toggle-completed");
    if (section) section.classList.add("completed-collapsed");
    if (btn) btn.textContent = "Show";
  }

  // PQI enabled
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
  } catch {
    // ignore
  }
}

// --------------- PQI global toggle -----------------

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

// --------------- FORM (DISPATCHER) -----------------

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

    const { error } = await supabase.from("pickups").insert({
      tag_number: tag,
      customer_name: name,
      status: staged ? "STAGED" : "NEW",
      wash_status: "NONE",
    });

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

// --------------- TABLE ACTIONS -----------------

function setupTableActions() {
  const activeTbody = document.getElementById("active-tbody");
  const stagedTbody = document.getElementById("staged-tbody");
  const waitingTbody = document.getElementById("waiting-tbody");
  const completedTbody = document.getElementById("completed-tbody");

  if (activeTbody) activeTbody.addEventListener("click", onTableClick);
  if (stagedTbody) stagedTbody.addEventListener("click", onTableClick);
  if (waitingTbody) waitingTbody.addEventListener("click", onTableClick);
  if (completedTbody) completedTbody.addEventListener("click", onTableClick);
}

function onTableClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
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
      updates.activated_at = now;
      break;

    case "keys-machine":
      updates.status = "KEYS_IN_MACHINE";
      updates.keys_holder = "KEY_MACHINE";
      updates.keys_at_machine_at = now;
      break;

    // Status/location wash-related
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

    // Valets
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

    // Stage for customer (waiting)
    case "waiting-customer":
      updates.status = "WAITING_FOR_CUSTOMER";
      updates.waiting_client_at = now;
      break;

    // Customer picked up -> complete
    case "customer-picked-up":
      updates.status = "COMPLETE";
      updates.completed_at = now;
      break;

    // Notes
    case "edit-note": {
      const current = pickups.find((p) => String(p.id) === String(id));
      const existing = current?.notes || "";
      const next = window.prompt("Notes for this ticket:", existing);
      if (next === null) return;
      updates.notes = next;
      updates.notes_updated_at = now;
      break;
    }

    // Timeline view (no DB write)
    case "view-timeline": {
      const p = pickups.find((p) => String(p.id) === String(id));
      if (!p) return;
      const lines = [];

      lines.push(`Ticket ${p.tag_number} – ${p.customer_name}`);
      lines.push("--------------------------------");

      if (p.created_at) lines.push("Created: " + formatTime(p.created_at));
      if (p.activated_at)
        lines.push("Activated (left staged): " + formatTime(p.activated_at));
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

      const totalSeconds = computeSeconds(
        p.created_at,
        p.completed_at || new Date().toISOString(),
        new Date()
      );
      lines.push(
        "Total cycle time: " + formatDuration(totalSeconds) + " (from created)"
      );

      if (p.notes) {
        lines.push("");
        lines.push("Notes:");
        lines.push(p.notes);
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

function setValetUpdates(updates, name, now) {
  updates.status = "KEYS_WITH_VALET";
  updates.keys_holder = name;
  updates.keys_with_valet_at = now;
}

// --------------- COMPLETED COLLAPSE -----------------

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

// --------------- DATA + REALTIME -----------------

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

// --------------- RENDERING -----------------

function renderTables(isTimerTick) {
  const stagedTbody = document.getElementById("staged-tbody");
  const activeTbody = document.getElementById("active-tbody");
  const waitingTbody = document.getElementById("waiting-tbody");
  const completedTbody = document.getElementById("completed-tbody");

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

  // Oldest first for active
  active.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Counts in headers
  setCount("count-staged", staged.length);
  setCount("count-active", active.length);
  setCount("count-waiting", waiting.length);
  setCount("count-completed", completed.length);

  // Staged
  if (stagedTbody) {
    if (staged.length === 0) {
      stagedTbody.innerHTML =
        '<tr><td colspan="4" class="empty">No staged tickets.</td></tr>';
    } else {
      stagedTbody.innerHTML = staged.map((p) => renderStagedRow(p, now)).join("");
    }
  }

  // Active
  if (activeTbody) {
    if (active.length === 0) {
      activeTbody.innerHTML =
        '<tr><td colspan="8" class="empty">No active pickups.</td></tr>';
    } else {
      activeTbody.innerHTML = active.map((p) => renderActiveRow(p, now)).join("");
    }
  }

  // Waiting
  if (waitingTbody) {
    if (waiting.length === 0) {
      waitingTbody.innerHTML =
        '<tr><td colspan="7" class="empty">None currently waiting.</td></tr>';
    } else {
      waitingTbody.innerHTML = waiting
        .map((p) => renderWaitingRow(p, now))
        .join("");
    }
  }

  // Completed
  if (completedTbody) {
    if (completed.length === 0) {
      completedTbody.innerHTML =
        '<tr><td colspan="8" class="empty">No completed tickets yet.</td></tr>';
    } else {
      completedTbody.innerHTML = completed
        .map((p) => renderCompletedRow(p, now))
        .join("");
    }
  }

  // Metrics (dispatcher only)
  if (role === "dispatcher") {
    renderMetrics(active, waiting, completed, now);
  }

  // Sounds only on timer ticks
  if (isTimerTick) {
    maybePlayAlerts(active, now);
  }
}

function setCount(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value);
}

function renderStagedRow(p, now) {
  return `
    <tr>
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>
        <button class="btn small dispatcher-only" data-action="activate-from-staged" data-id="${
          p.id
        }">
          Activate
        </button>
      </td>
    </tr>
  `;
}

function renderActiveRow(p, now) {
  const statusLabel = humanStatus(p);
  const valetLabel = p.keys_holder ? `Keys with ${p.keys_holder}` : "—";

  const masterSeconds = computeMasterSeconds(p, now);
  const masterSeverity = computeSeverity(masterSeconds);
  const masterClass = timerClass(masterSeverity);
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetSeverity = valetSeconds != null ? computeSeverity(valetSeconds) : null;
  const valetClass = valetSeverity ? timerClass(valetSeverity) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";

  // DO NOT tint entire row anymore (only timers show severity)
  const rowClass = "";

  const washLabel = humanWashStatus(p.wash_status);
  const washNeedsClass =
    p.wash_status === "NEEDS_REWASH" ? "wash-needs" : "";

  const currentWash = p.wash_status || "NONE";
  const currentValet = p.keys_holder || "";

  return `
    <tr class="${rowClass}">
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>
        <div>
          <span class="status-badge">${statusLabel}</span>
        </div>
        <div class="wash-buttons" style="margin-top:0.15rem;">
          <button class="btn small keymachine-only ${
            p.status === "KEYS_IN_MACHINE" ? "btn-selected" : ""
          }" data-action="keys-machine" data-id="${p.id}">
            Keys in key machine
          </button>
        </div>
        <div class="wash-buttons" style="margin-top:0.15rem;">
          <button class="btn small ${
            currentWash === "IN_WASH_AREA" ? "btn-selected" : ""
          }" data-action="car-wash-area" data-id="${p.id}">Car in wash</button>
          <button class="btn small ${
            currentWash === "ON_RED_LINE" ? "btn-selected" : ""
          }" data-action="car-red-line" data-id="${p.id}">Car on red line</button>
        </div>
        <div class="wash-buttons" style="margin-top:0.15rem;">
          <button class="btn small ${
            currentWash === "REWASH" ? "btn-selected" : ""
          }" data-action="wash-rewash" data-id="${p.id}">Re wash</button>
          <button class="btn small ${
            currentWash === "NEEDS_REWASH" ? "btn-selected" : ""
          }" data-action="wash-needs-rewash" data-id="${p.id}">Needs rewash</button>
          <button class="btn small ${
            currentWash === "DUSTY" ? "btn-selected" : ""
          }" data-action="wash-dusty" data-id="${p.id}">Dusty</button>
        </div>
        <div class="section-subtitle ${washNeedsClass}" style="margin-top:0.15rem;">
          ${washLabel}
        </div>
      </td>
      <td>
        <div class="keys-buttons">
          <button class="btn small keymachine-only ${
            currentValet === "Fernando" ? "btn-selected" : ""
          }" data-action="with-fernando" data-id="${p.id}">Fernando</button>
          <button class="btn small keymachine-only ${
            currentValet === "Juan" ? "btn-selected" : ""
          }" data-action="with-juan" data-id="${p.id}">Juan</button>
          <button class="btn small keymachine-only ${
            currentValet === "Miguel" ? "btn-selected" : ""
          }" data-action="with-miguel" data-id="${p.id}">Miguel</button>
          <button class="btn small keymachine-only ${
            currentValet === "Maria" ? "btn-selected" : ""
          }" data-action="with-maria" data-id="${p.id}">Maria</button>
          <button class="btn small keymachine-only ${
            currentValet === "Helper" ? "btn-selected" : ""
          }" data-action="with-helper" data-id="${p.id}">Helper</button>
        </div>
        <div class="section-subtitle" style="margin-top:0.15rem;">${escapeHtml(
          valetLabel
        )}</div>
      </td>
      <td>
        <span class="timer ${valetClass}">
          ${valetLabelTime}
        </span>
      </td>
      <td class="dispatcher-only">
        <button class="btn small dispatcher-only" data-action="waiting-customer" data-id="${
          p.id
        }">
          Move to staged
        </button>
      </td>
      <td>
        <button class="btn small notes-button ${
          p.notes ? "btn-selected" : ""
        }" data-action="edit-note" data-id="${p.id}">
          ${p.notes ? "Edit" : "Add"}
        </button>
        ${
          p.notes
            ? `<div class="notes-preview">${escapeHtml(p.notes).slice(
                0,
                40
              )}${p.notes.length > 40 ? "…" : ""}</div>`
            : ""
        }
      </td>
      <td>
        <span class="timer ${masterClass}">
          ${masterLabel}
        </span>
        ${
          pqiEnabled
            ? '<span class="pqi-badge" style="margin-left:0.3rem;">PQI</span>'
            : ""
        }
      </td>
    </tr>
  `;
}

function renderWaitingRow(p, now) {
  const deliveredBy = p.keys_holder || "—";
  const stagedSeconds = computeSeconds(p.waiting_client_at, p.completed_at, now);
  const stagedSeverity = computeSeverity(stagedSeconds);
  const stagedClass = timerClass(stagedSeverity);
  const stagedLabel = formatDuration(stagedSeconds);

  const masterSeconds = computeMasterSeconds(p, now);
  const masterSeverity = computeSeverity(masterSeconds);
  const masterClass = timerClass(masterSeverity);
  const masterLabel = formatDuration(masterSeconds);

  const rowClass = "";

  return `
    <tr class="${rowClass}">
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${stagedClass}">${stagedLabel}</span></td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
      <td>
        <button class="btn small notes-button ${
          p.notes ? "btn-selected" : ""
        } dispatcher-only" data-action="edit-note" data-id="${p.id}">
          ${p.notes ? "Edit" : "Add"}
        </button>
        ${
          p.notes
            ? `<div class="notes-preview">${escapeHtml(p.notes).slice(
                0,
                40
              )}${p.notes.length > 40 ? "…" : ""}</div>`
            : ""
        }
      </td>
      <td>
        <button class="btn small dispatcher-only" data-action="customer-picked-up" data-id="${
          p.id
        }">
          Customer picked up
        </button>
      </td>
    </tr>
  `;
}

function renderCompletedRow(p, now) {
  const totalSeconds = computeSeconds(p.created_at, p.completed_at, now);
  const totalLabel = formatDuration(totalSeconds);
  const deliveredBy = p.keys_holder || "—";

  return `
    <tr>
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>${totalLabel}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>${formatTime(p.completed_at)}</td>
      <td>${p.notes ? escapeHtml(p.notes) : ""}</td>
      <td>
        <button class="btn small" data-action="view-timeline" data-id="${p.id}">
          Timeline
        </button>
      </td>
    </tr>
  `;
}

// --------------- METRICS -----------------

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
  ) {
    return;
  }

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

  if (completedToday.length === 0) {
    avgCycleEl.textContent = "–";
  } else {
    const totalSec = completedToday.reduce((sum, p) => {
      return sum + computeSeconds(p.created_at, p.completed_at, now);
    }, 0);
    const avgSec = totalSec / completedToday.length;
    avgCycleEl.textContent = formatDuration(avgSec);
  }

  // Red line count: wash_status ON_RED_LINE
  const redLineCount = pickups.filter(
    (p) => p.wash_status === "ON_RED_LINE" && p.status !== "COMPLETE"
  ).length;
  redlineCountEl.textContent = String(redLineCount);

  // Valet counts – fixed list plus counts
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

// --------------- ALERTS -----------------

function maybePlayAlerts(active, now) {
  const audio = document.getElementById("alert-sound");
  if (!audio) return;
  if (role !== "dispatcher" && role !== "wallboard") return;

  active.forEach((p) => {
    const masterSeconds = computeMasterSeconds(p, now);
    const severity = computeSeverity(masterSeconds);
    const prev = severityMap.get(p.id) || "green";
    severityMap.set(p.id, severity);

    // Only alert when crossing into orange or red
    if ((severity === "orange" || severity === "red") && prev !== severity) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  });
}

// --------------- HELPERS -----------------

function humanStatus(p) {
  switch (p.status) {
    case "STAGED":
      return "Staged";
    case "NEW":
      return "New";
    case "KEYS_IN_MACHINE":
      return "Keys in key machine";
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

function computeSeconds(startIso, endIso, now) {
  if (!startIso) return 0;
  const start = new Date(startIso);
  let end = endIso ? new Date(endIso) : now;

  // If somehow end < start due to out-of-order timestamps, clamp to now
  if (end < start) end = now;
  const diffMs = end - start;
  if (Number.isNaN(diffMs) || diffMs < 0) return 0;
  return diffMs / 1000;
}

// Master timer: from activated_at (if present) or created_at
function computeMasterSeconds(p, now) {
  const startIso = p.activated_at || p.created_at;
  return computeSeconds(startIso, p.completed_at, now);
}

// Valet time: from keys_with_valet_at until keys_at_machine_at / waiting / completed / now
function computeValetSeconds(p, now) {
  if (!p.keys_with_valet_at) return null;
  const start = new Date(p.keys_with_valet_at);
  let end =
    p.keys_at_machine_at ||
    p.waiting_client_at ||
    p.completed_at ||
    now.toISOString();

  return computeSeconds(start.toISOString(), end, now);
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
  // snap to 15-second intervals
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
