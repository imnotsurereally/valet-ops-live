// app.js
import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";

document.addEventListener("DOMContentLoaded", () => {
  role = document.body.classList.contains("role-keymachine")
    ? "keymachine"
    : "dispatcher";

  setupForm();
  setupTableActions();
  loadPickups();
  subscribeRealtime();

  // Re-render every minute so the stopwatch column stays fresh
  setInterval(renderTables, 60 * 1000);
});

function setupForm() {
  const form = document.getElementById("new-pickup-form");
  if (!form) return; // key machine page has no form

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tagInput = document.getElementById("tag-number");
    const nameInput = document.getElementById("customer-name");
    const tag = tagInput.value.trim();
    const name = nameInput.value.trim();

    if (!tag || !name) return;

    const { error } = await supabase.from("pickups").insert({
      tag_number: tag,
      customer_name: name,
      status: "NEW",
    });

    if (error) {
      console.error(error);
      alert("Error creating pickup. Try again.");
      return;
    }

    tagInput.value = "";
    nameInput.value = "";
  });
}

function setupTableActions() {
  const activeTbody = document.getElementById("active-tbody");
  if (!activeTbody) return;

  activeTbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (!id || !action) return;

    await handleAction(id, action);
  });
}

async function handleAction(id, action) {
  const now = new Date().toISOString();
  const updates = {};

  switch (action) {
    case "keys-machine":
      updates.status = "KEYS_IN_MACHINE";
      updates.keys_holder = "KEY_MACHINE";
      updates.keys_at_machine_at = now;
      break;

    case "wash-today":
      updates.wash_status = "WASHED_TODAY";
      updates.wash_status_at = now;
      break;

    case "wash-yesterday":
      updates.wash_status = "WASHED_YESTERDAY";
      updates.wash_status_at = now;
      break;

    case "wash-notsure":
      updates.wash_status = "NOT_SURE";
      updates.wash_status_at = now;
      break;

    case "with-fernando":
      updates.status = "KEYS_WITH_VALET";
      updates.keys_holder = "Fernando";
      updates.keys_with_valet_at = now;
      break;

    case "with-juan":
      updates.status = "KEYS_WITH_VALET";
      updates.keys_holder = "Juan";
      updates.keys_with_valet_at = now;
      break;

    case "with-miguel":
      updates.status = "KEYS_WITH_VALET";
      updates.keys_holder = "Miguel";
      updates.keys_with_valet_at = now;
      break;

    case "with-maria":
      updates.status = "KEYS_WITH_VALET";
      updates.keys_holder = "Maria";
      updates.keys_with_valet_at = now;
      break;

    case "waiting":
      updates.status = "CAR_WAITING_CLIENT";
      updates.waiting_client_at = now;
      break;

    case "complete":
      updates.status = "COMPLETE";
      updates.completed_at = now;
      break;

    case "edit-note": {
      const current = pickups.find((p) => p.id === id);
      const existing = current?.notes || "";
      const next = window.prompt("Notes for this pickup:", existing);
      if (next === null) return;
      updates.notes = next;
      updates.notes_updated_at = now;
      break;
    }

    default:
      return;
  }

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("pickups")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("Error saving update. Try again.");
  }
}

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
  renderTables();
}

function subscribeRealtime() {
  supabase
    .channel("public:pickups")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pickups" },
      () => {
        // On any change, reload full list (small volume so it's fine)
        loadPickups();
      }
    )
    .subscribe();
}

function renderTables() {
  const activeTbody = document.getElementById("active-tbody");
  const completedTbody = document.getElementById("completed-tbody");

  if (!activeTbody) return;

  const active = pickups.filter((p) => p.status !== "COMPLETE");
  const completed = pickups.filter((p) => p.status === "COMPLETE").slice(0, 50);

  if (active.length === 0) {
    activeTbody.innerHTML =
      '<tr><td colspan="10" class="empty">No active pickups.</td></tr>';
  } else {
    activeTbody.innerHTML = active.map((p) => renderActiveRow(p)).join("");
  }

  if (completedTbody) {
    if (completed.length === 0) {
      completedTbody.innerHTML =
        '<tr><td colspan="6" class="empty">No completed pickups yet.</td></tr>';
    } else {
      completedTbody.innerHTML = completed
        .map((p) => renderCompletedRow(p))
        .join("");
    }
  }
}

function renderActiveRow(p) {
  const statusLabel = humanStatus(p.status);
  const minutes = computeMinutes(p.created_at, p.completed_at);

  const keysInMachineDisabled = !!p.keys_at_machine_at;
  const washTodayActive = p.wash_status === "WASHED_TODAY";
  const washYesterdayActive = p.wash_status === "WASHED_YESTERDAY";
  const washNotSureActive = p.wash_status === "NOT_SURE";
  const waitingDisabled = p.status === "CAR_WAITING_CLIENT" || p.status === "COMPLETE";
  const completeDisabled = p.status === "COMPLETE";

  return `
    <tr>
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td><span class="status-badge">${statusLabel}</span></td>

      <td class="keymachine-only">
        <button
          class="btn small"
          data-action="keys-machine"
          data-id="${p.id}"
          ${keysInMachineDisabled ? "disabled" : ""}
        >
          ${keysInMachineDisabled ? "✓ Set" : "Set"}
        </button>
      </td>

      <td class="keymachine-only">
        <div class="wash-buttons">
          <button
            class="btn small"
            data-action="wash-today"
            data-id="${p.id}"
            ${washTodayActive ? "disabled" : ""}
          >
            Today
          </button>
          <button
            class="btn small"
            data-action="wash-yesterday"
            data-id="${p.id}"
            ${washYesterdayActive ? "disabled" : ""}
          >
            Yesterday
          </button>
          <button
            class="btn small"
            data-action="wash-notsure"
            data-id="${p.id}"
            ${washNotSureActive ? "disabled" : ""}
          >
            Not sure
          </button>
        </div>
      </td>

      <td class="keymachine-only">
        <div class="keys-buttons">
          <button class="btn small" data-action="with-fernando" data-id="${p.id}">Fernando</button>
          <button class="btn small" data-action="with-juan" data-id="${p.id}">Juan</button>
          <button class="btn small" data-action="with-miguel" data-id="${p.id}">Miguel</button>
          <button class="btn small" data-action="with-maria" data-id="${p.id}">Maria</button>
        </div>
      </td>

      <td class="dispatcher-only">
        <button
          class="btn small"
          data-action="waiting"
          data-id="${p.id}"
          ${waitingDisabled ? "disabled" : ""}
        >
          Waiting
        </button>
      </td>

      <td class="dispatcher-only">
        <button
          class="btn small"
          data-action="complete"
          data-id="${p.id}"
          ${completeDisabled ? "disabled" : ""}
        >
          Complete
        </button>
      </td>

      <td>
        <button class="btn small notes-button" data-action="edit-note" data-id="${p.id}">
          ${p.notes ? "Edit" : "Add"}
        </button>
      </td>

      <td class="time-cell">
        ${typeof minutes === "number" ? minutes + " min" : "-"}
      </td>
    </tr>
  `;
}

function renderCompletedRow(p) {
  const totalMinutes = computeMinutes(p.created_at, p.completed_at);
  return `
    <tr>
      <td>${escapeHtml(p.tag_number)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td class="time-cell">${typeof totalMinutes === "number" ? totalMinutes + " min" : "-"}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>${formatTime(p.completed_at)}</td>
      <td>${p.notes ? escapeHtml(p.notes) : ""}</td>
    </tr>
  `;
}

function humanStatus(status) {
  switch (status) {
    case "NEW":
      return "New";
    case "KEYS_IN_MACHINE":
      return "Keys in Machine";
    case "KEYS_WITH_VALET":
      return "Keys with Valet";
    case "CAR_WAITING_CLIENT":
      return "Waiting for Client";
    case "COMPLETE":
      return "Complete";
    default:
      return status || "";
  }
}

function computeMinutes(startIso, endIso) {
  if (!startIso) return null;
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  const diffMs = end - start;
  if (Number.isNaN(diffMs) || diffMs < 0) return null;
  const minutes = Math.round(diffMs / 60000);
  return minutes;
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
