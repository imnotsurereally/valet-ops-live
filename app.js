// app.js
import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map(); // id -> severity for sound alerts
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
  const id = btn.getAttribute("data-id");
  const action = btn.getAttribute("data-action");
  if (!id || !action) return;
  handleAction(id, action);
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

    /* --- valets --- */
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
        "Master cycle (Active box in/out): " +
          formatDuration(masterSeconds)
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
    // staged only exists on dispatcher screen
    stagedTbody.innerHTML =
      staged.length === 0
        ? '<tr><td colspan="4" class="empty">No staged tickets.</td></tr>'
        : staged.map((p) => renderStagedRow(p)).join("");
  }

  if (activeTbody) {
    if (active.length === 0) {
      activeTbody.innerHTML =
        role === "wallboard"
          ? '<tr><td colspan="6" class="empty">No active pickups.</td></tr>'
          : role === "dispatcher"
          ? '<tr><td colspan="8" class="empty">No active pickups.</td></tr>'
          : '<tr><td colspan="7" class="empty">No active pickups.</td></tr>';
    } else {
      activeTbody.innerHTML = active
        .map((p) => {
          if (role === "dispatcher") return renderActiveRowDispatcher(p, now);
          if (role === "wallboard") return renderActiveRowWallboard(p, now);
          // keymachine + carwash
          return renderActiveRowOps(p, now);
        })
        .join("");
    }
  }

  if (waitingTbody) {
    if (waiting.length === 0) {
      waitingTbody.innerHTML =
        role === "wallboard"
          ? '<tr><td colspan="4" class="empty">None currently waiting.</td></tr>'
          : '<tr><td colspan="7" class="empty">None currently waiting.</td></tr>';
    } else {
      waitingTbody.innerHTML = waiting
        .map((p) =>
          role === "wallboard"
            ? renderWaitingRowWallboard(p, now)
            : renderWaitingRowDispatcher(p, now)
        )
        .join("");
    }
  }

  if (completedTbody) {
    // completed only exists on dispatcher
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

/* ---------- ROW RENDERERS ---------- */

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

function renderActiveRowDispatcher(p, now) {
  const masterSeconds = computeMasterSeconds(p, now);
  const masterSeverity = computeSeverity(masterSeconds);
  const masterClass = timerClass(masterSeverity);
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetSeverity =
    valetSeconds != null ? computeSeverity(valetSeconds) : null;
  const valetClass = valetSeverity ? timerClass(valetSeverity) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";

  const notesParts = splitNotes(p.notes);

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${renderStatusLocationControls(p, { allowClicks: role !== "wallboard" })}</td>
      <td>${renderValetControls(p, { allowClicks: role !== "wallboard" })}</td>
      <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
      <td class="dispatcher-only">
        <button class="btn small dispatcher-only" data-action="waiting-customer" data-id="${p.id}">
          Move to staged
        </button>
      </td>
      <td>${renderNotesCell(p.id, notesParts, { allowEdit: role === "dispatcher" })}</td>
      <td>
        <span class="timer ${masterClass}">${masterLabel}</span>
        ${pqiEnabled ? `<span class="pqi-badge">PQI</span>` : ""}
      </td>
    </tr>
  `;
}

function renderActiveRowOps(p, now) {
  const masterSeconds = computeMasterSeconds(p, now);
  const masterSeverity = computeSeverity(masterSeconds);
  const masterClass = timerClass(masterSeverity);
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetSeverity =
    valetSeconds != null ? computeSeverity(valetSeconds) : null;
  const valetClass = valetSeverity ? timerClass(valetSeverity) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";

  const notesParts = splitNotes(p.notes);

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${renderStatusLocationControls(p, { allowClicks: role !== "wallboard" })}</td>
      <td>${renderValetControls(p, { allowClicks: role !== "wallboard" })}</td>
      <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
      <td>${renderNotesCell(p.id, notesParts, { allowEdit: role !== "wallboard" })}</td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
    </tr>
  `;
}

function renderActiveRowWallboard(p, now) {
  const masterSeconds = computeMasterSeconds(p, now);
  const masterSeverity = computeSeverity(masterSeconds);
  const masterClass = timerClass(masterSeverity);
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetSeverity =
    valetSeconds != null ? computeSeverity(valetSeconds) : null;
  const valetClass = valetSeverity ? timerClass(valetSeverity) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td><span class="status-badge">${escapeHtml(humanStatus(p))}</span></td>
      <td>${escapeHtml(p.keys_holder ? `Keys with ${p.keys_holder}` : "—")}</td>
      <td><span class="timer ${valetClass}">${valetLabelTime}</span></td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
    </tr>
  `;
}

function renderWaitingRowDispatcher(p, now) {
  const deliveredBy = p.keys_holder || "—";

  const stagedSeconds = computeSeconds(p.waiting_client_at, p.completed_at, now);
  const stagedSeverity = computeSeverity(stagedSeconds);
  const stagedClass = timerClass(stagedSeverity);
  const stagedLabel = formatDuration(stagedSeconds);

  const masterSeconds = computeMasterSeconds(p, now);
  const masterSeverity = computeSeverity(masterSeconds);
  const masterClass = timerClass(masterSeverity);
  const masterLabel = formatDuration(masterSeconds);

  const notesParts = splitNotes(p.notes);

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${stagedClass}">${stagedLabel}</span></td>
      <td><span class="timer ${masterClass}">${masterLabel}</span></td>
      <td>${renderNotesCell(p.id, notesParts, { allowEdit: role === "dispatcher" })}</td>
      <td>
        <button class="btn small dispatcher-only" data-action="customer-picked-up" data-id="${p.id}">
          Customer picked up
        </button>
      </td>
    </tr>
  `;
}

function renderWaitingRowWallboard(p, now) {
  const deliveredBy = p.keys_holder || "—";
  const stagedSeconds = computeSeconds(p.waiting_client_at, p.completed_at, now);
  const stagedSeverity = computeSeverity(stagedSeconds);
  const stagedClass = timerClass(stagedSeverity);
  const stagedLabel = formatDuration(stagedSeconds);

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${stagedClass}">${stagedLabel}</span></td>
    </tr>
  `;
}

function renderCompletedRow(p, now) {
  const masterSeconds = computeMasterSeconds(p, now);
  const masterLabel = formatDuration(masterSeconds);
  const deliveredBy = p.keys_holder || "—";

  const notesParts = splitNotes(p.notes);
  const allNotesHtml = [notesParts.last, ...notesParts.prev]
    .filter(Boolean)
    .map((n, idx) =>
      idx === 0
        ? `<div class="notes-preview">${escapeHtml(n)}</div>`
        : `<div class="notes-history-line">${escapeHtml(n)}</div>`
    )
    .join("");

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${masterLabel}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>${formatTime(p.completed_at)}</td>
      <td>${allNotesHtml || ""}</td>
      <td>
        <button class="btn small" data-action="view-timeline" data-id="${p.id}">
          Timeline
        </button>
      </td>
    </tr>
  `;
}

/* ---------- CELL HELPERS (LOCKED RULES) ---------- */

function renderStatusLocationControls(p, { allowClicks }) {
  const currentWash = p.wash_status || "NONE";
  const isKeysMachine = p.status === "KEYS_IN_MACHINE";

  // “Selected = show ONLY selected” rule:
  // If wash_status is set (not NONE) -> show only that wash status.
  // Else if key machine status set -> show only Key machine.
  // Else show all options.
  const hasSelection = currentWash !== "NONE" || isKeysMachine;

  if (hasSelection) {
    if (currentWash !== "NONE") {
      return renderOneStatusButton(currentWash, p.id, allowClicks);
    }
    // keys machine selected
    return renderKeysMachineButton(p.id, true, allowClicks);
  }

  // No selection yet: show full set
  return `
    <div class="wash-buttons">
      ${renderWashButton("IN_WASH_AREA", "Car in wash", "car-wash-area", currentWash, p.id, allowClicks)}
      ${renderWashButton("ON_RED_LINE", "Car on red line", "car-red-line", currentWash, p.id, allowClicks)}
      ${renderWashButton("DUSTY", "Dusty", "wash-dusty", currentWash, p.id, allowClicks)}
      ${renderWashButton("NEEDS_REWASH", "Needs rewash", "wash-needs-rewash", currentWash, p.id, allowClicks, true)}
      ${renderWashButton("REWASH", "Re wash", "wash-rewash", currentWash, p.id, allowClicks)}
      ${renderKeysMachineButton(p.id, false, allowClicks)}
    </div>
  `;
}

function renderOneStatusButton(washStatus, id, allowClicks) {
  const map = {
    IN_WASH_AREA: { label: "Car in wash", action: "car-wash-area" },
    ON_RED_LINE: { label: "Car on red line", action: "car-red-line" },
    DUSTY: { label: "Dusty", action: "wash-dusty" },
    NEEDS_REWASH: { label: "Needs rewash", action: "wash-needs-rewash" },
    REWASH: { label: "Re wash", action: "wash-rewash" }
  };

  const cfg = map[washStatus] || { label: humanWashStatus(washStatus), action: "" };
  const classes =
    washStatus === "NEEDS_REWASH"
      ? "btn small btn-selected wash-needs"
      : "btn small btn-selected";

  const attrs = allowClicks && cfg.action ? `data-action="${cfg.action}"` : "";
  const idAttr = `data-id="${id}"`;

  return `
    <div class="wash-buttons">
      <button class="${classes}" ${attrs} ${idAttr}>${escapeHtml(cfg.label)}</button>
    </div>
  `;
}

function renderKeysMachineButton(id, selected, allowClicks) {
  const classes = `btn small keymachine-only ${selected ? "btn-selected" : ""}`;
  const attrs = allowClicks ? `data-action="keys-machine"` : "";
  return `<button class="${classes}" ${attrs} data-id="${id}">Key machine</button>`;
}

function renderWashButton(value, label, action, currentWash, id, allowClicks, needsBlink = false) {
  const selected = currentWash === value;
  const cls = `btn small ${selected ? "btn-selected" : ""} ${selected && needsBlink ? "wash-needs" : ""}`;
  const attrs = allowClicks ? `data-action="${action}"` : "";
  return `<button class="${cls}" ${attrs} data-id="${id}">${escapeHtml(label)}</button>`;
}

function renderValetControls(p, { allowClicks }) {
  const selected = p.keys_holder && VALETS.includes(p.keys_holder) ? p.keys_holder : "";

  // LOCKED RULE: once selected, hide others
  if (selected) {
    return `
      <div class="keys-buttons">
        <button class="btn small keymachine-only btn-selected" ${
          allowClicks ? `data-action="${valetAction(selected)}"` : ""
        } data-id="${p.id}">
          ${escapeHtml(selected)}
        </button>
      </div>
      <div class="section-subtitle" style="margin-top:0.15rem;">
        ${escapeHtml(`Keys with ${selected}`)}
      </div>
    `;
  }

  // No valet selected yet: show all options
  return `
    <div class="keys-buttons">
      ${VALETS.map((name) => {
        const act = valetAction(name);
        return `
          <button class="btn small keymachine-only" ${
            allowClicks ? `data-action="${act}"` : ""
          } data-id="${p.id}">
            ${escapeHtml(name)}
          </button>
        `;
      }).join("")}
    </div>
    <div class="section-subtitle" style="margin-top:0.15rem;">—</div>
  `;
}

function valetAction(name) {
  switch (name) {
    case "Fernando": return "with-fernando";
    case "Juan": return "with-juan";
    case "Miguel": return "with-miguel";
    case "Maria": return "with-maria";
    case "Helper": return "with-helper";
    default: return "with-helper";
  }
}

function splitNotes(notes) {
  const parts = (notes || "").split("\n").filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : "";
  const prev = parts.slice(0, -1).reverse(); // newest first in history
  return { last, prev };
}

function renderNotesCell(id, notesParts, { allowEdit }) {
  const btnHtml = allowEdit
    ? `<button class="btn small notes-button" data-action="edit-note" data-id="${id}">Add note</button>`
    : "";

  const lastHtml = notesParts.last
    ? `<div class="notes-preview">${escapeHtml(notesParts.last)}</div>`
    : "";

  const prevHtml = notesParts.prev.length
    ? notesParts.prev
        .map((n) => `<div class="notes-history-line">${escapeHtml(n)}</div>`)
        .join("")
    : "";

  return `
    <div class="notes-cell">
      ${btnHtml}
      ${lastHtml}
      ${prevHtml}
    </div>
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
  const valetCounts = {};
  VALETS.forEach((v) => (valetCounts[v] = 0));

  pickups.forEach((p) => {
    if (!p.keys_holder) return;
    if (valetCounts[p.keys_holder] === undefined) {
      valetCounts[p.keys_holder] = 0;
    }
    valetCounts[p.keys_holder] += 1;
  });

  valetsEl.innerHTML = VALETS
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
