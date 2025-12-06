// app.js
import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map(); // id -> 'green'|'yellow'|'orange'|'red'

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("role-keymachine")) role = "keymachine";
  else if (document.body.classList.contains("role-carwash")) role = "carwash";
  else if (document.body.classList.contains("role-wallboard")) role = "wallboard";
  else role = "dispatcher";

  setupForm();
  setupTableActions();
  loadPickups();
  subscribeRealtime();

  // Timers every 15 seconds
  setInterval(() => {
    renderTables(true); // true = timer-only update (for sounds)
  }, 15 * 1000);
});

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

  if (activeTbody) {
    activeTbody.addEventListener("click", onTableClick);
  }
  if (stagedTbody) {
    stagedTbody.addEventListener("click", onTableClick);
  }
  if (waitingTbody) {
    waitingTbody.addEventListener("click", onTableClick);
  }
}

function onTableClick(e) {
  const btn = e.target.closest("button[data-action]");
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
      break;

    case "keys-machine":
      updates.status = "KEYS_IN_MACHINE";
      updates.keys_holder = "KEY_MACHINE";
      updates.keys_at_machine_at = now;
      break;

    case "wash-area":
      updates.wash_status = "IN_WASH_AREA";
      updates.wash_status_at = now;
      break;

    case "wash-rewash":
      updates.wash_status = "REWASH";
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

    case "waiting-customer":
      updates.status = "WAITING_FOR_CUSTOMER";
      updates.waiting_client_at = now;
      break;

    case "customer-picked-up":
      updates.status = "COMPLETE";
      updates.completed_at = now;
      break;

    case "edit-note": {
      const current = pickups.find((p) => p.id === id);
      const existing = current?.notes || "";
      const next = window.prompt("Notes for this ticket:", existing);
      if (next === null) return;
      updates.notes = next;
      updates.notes_updated_at = now;
      break;
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

  // Sort active by created_at oldest first for wallboard clarity
  active.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Staged
  if (stagedTbody) {
    if (staged.length === 0) {
      stagedTbody.innerHTML =
        '<tr><td colspan="4" class="empty">No staged tickets.</td></tr>';
    } else {
      stagedTbody.innerHTML = staged
        .map((p) => renderStagedRow(p, now))
        .join("");
    }
  }

  // Active
  if (activeTbody) {
    if (active.length === 0) {
      activeTbody.innerHTML =
        '<tr><td colspan="9" class="empty">No active pickups.</td></tr>';
    } else {
      activeTbody.innerHTML = active.map((p) => renderActiveRow(p, now)).join("");
    }
  }

  // Waiting
  if (waitingTbody) {
    if (waiting.length === 0) {
      waitingTbody.innerHTML =
        '<tr><td colspan="6" class="empty">None currently waiting.</td></tr>';
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
        '<tr><td colspan="7" class="empty">No completed tickets yet.</td></tr>';
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

  const masterSeconds = computeSeconds(p.created_at, p.completed_at, now);
  const masterSeverity = computeSeverity(masterSeconds);
  const masterClass = timerClass(masterSeverity);
  const masterLabel = formatDuration(masterSeconds);

  const valetSeconds = computeValetSeconds(p, now);
  const valetSeverity = valetSeconds != null ? computeSeverity(valetSeconds) : null;
  const valetClass = valetSeverity ? timerClass(valetSeverity) : "";
  const valetLabelTime =
    valetSeconds != null ? formatDuration(valetSeconds) : "–";

  const washLabel = humanWashStatus(p.wash_status);

  return `
    <tr>
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>
        <span class="status-badge">${statusLabel}</span>
        ${
          p.status !== "KEYS_IN_MACHINE"
            ? `<button class="btn small keymachine-only" data-action="keys-machine" data-id="${p.id}">Key in machine</button>`
            : ""
        }
      </td>
      <td>
        <div class="wash-buttons">
          <button class="btn small carwash-only keymachine-only" data-action="wash-area" data-id="${
            p.id
          }">
            In wash area
          </button>
          <button class="btn small carwash-only keymachine-only" data-action="wash-rewash" data-id="${
            p.id
          }">
            Rewash
          </button>
        </div>
        <div class="section-subtitle" style="margin-top:0.2rem;">${washLabel}</div>
      </td>
      <td>
        <div class="keys-buttons">
          <button class="btn small keymachine-only" data-action="with-fernando" data-id="${
            p.id
          }">Fernando</button>
          <button class="btn small keymachine-only" data-action="with-juan" data-id="${
            p.id
          }">Juan</button>
          <button class="btn small keymachine-only" data-action="with-miguel" data-id="${
            p.id
          }">Miguel</button>
          <button class="btn small keymachine-only" data-action="with-maria" data-id="${
            p.id
          }">Maria</button>
        </div>
        <div class="section-subtitle" style="margin-top:0.2rem;">${escapeHtml(
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
          Move to waiting
        </button>
      </td>
      <td>
        <button class="btn small notes-button" data-action="edit-note" data-id="${
          p.id
        }">
          ${p.notes ? "Edit" : "Add"}
        </button>
      </td>
      <td>
        <span class="timer ${masterClass}">
          ${masterLabel}
        </span>
      </td>
    </tr>
  `;
}

function renderWaitingRow(p, now) {
  const deliveredBy = p.keys_holder || "—";
  const waitingSeconds = computeSeconds(p.waiting_client_at, p.completed_at, now);
  const waitingSeverity = computeSeverity(waitingSeconds);
  const waitingClass = timerClass(waitingSeverity);
  const waitingLabel = formatDuration(waitingSeconds);

  return `
    <tr>
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td><span class="timer ${waitingClass}">${waitingLabel}</span></td>
      <td>
        <button class="btn small notes-button dispatcher-only" data-action="edit-note" data-id="${
          p.id
        }">
          ${p.notes ? "Edit" : "Add"}
        </button>
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
    </tr>
  `;
}

// --------------- METRICS -----------------

function renderMetrics(active, waiting, completed, now) {
  const completedTodayEl = document.getElementById("metrics-completed-today");
  const avgCycleEl = document.getElementById("metrics-avg-cycle");
  const activeCountEl = document.getElementById("metrics-active-count");
  const waitingCountEl = document.getElementById("metrics-waiting-count");
  const valetsEl = document.getElementById("metrics-valets");

  if (!completedTodayEl || !avgCycleEl || !activeCountEl || !waitingCountEl || !valetsEl) {
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

  // Valet counts today (keys_holder where status complete or waiting)
  const valetCounts = {};
  pickups.forEach((p) => {
    if (!p.keys_holder) return;
    const holder = p.keys_holder;
    valetCounts[holder] = (valetCounts[holder] || 0) + 1;
  });

  const names = Object.keys(valetCounts);
  if (names.length === 0) {
    valetsEl.innerHTML = "<li>No valet activity yet.</li>";
  } else {
    valetsEl.innerHTML = names
      .map(
        (name) => `
      <li>
        <span>${escapeHtml(name)}</span>
        <span>${valetCounts[name]} tickets</span>
      </li>`
      )
      .join("");
  }
}

// --------------- ALERTS -----------------

function maybePlayAlerts(active, now) {
  const audio = document.getElementById("alert-sound");
  if (!audio) return;
  if (role !== "dispatcher" && role !== "wallboard") return;

  active.forEach((p) => {
    const masterSeconds = computeSeconds(p.created_at, p.completed_at, now);
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
      return "Keys in Machine";
    case "KEYS_WITH_VALET":
      return "Keys with Valet";
    case "WAITING_FOR_CUSTOMER":
      return "Waiting for Customer";
    case "COMPLETE":
      return "Complete";
    default:
      return p.status || "";
  }
}

function humanWashStatus(wash_status) {
  switch (wash_status) {
    case "IN_WASH_AREA":
      return "In wash area";
    case "REWASH":
      return "Rewash flagged";
    case "NONE":
    default:
      return "Not set";
  }
}

function computeSeconds(startIso, endIso, now) {
  if (!startIso) return 0;
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : now;
  const diffMs = end - start;
  if (Number.isNaN(diffMs) || diffMs < 0) return 0;
  return diffMs / 1000;
}

function computeValetSeconds(p, now) {
  if (!p.keys_with_valet_at) return null;
  const start = new Date(p.keys_with_valet_at);
  let end = now;

  if (p.keys_at_machine_at) {
    end = new Date(p.keys_at_machine_at);
  } else if (p.waiting_client_at) {
    end = new Date(p.waiting_client_at);
  } else if (p.completed_at) {
    end = new Date(p.completed_at);
  }

  const diffMs = end - start;
  if (Number.isNaN(diffMs) || diffMs <= 0) return 0;
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
