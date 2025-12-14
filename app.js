// app.js
import { supabase } from "./supabaseClient.js";

let pickups = [];
let role = "dispatcher";
let severityMap = new Map();
let pqiEnabled = false;
let uiStateLoaded = false;

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
  const completedCollapsed = !!(
    section && section.classList.contains("completed-collapsed")
  );
  const state = { completedCollapsed, pqiEnabled };

  try {
    localStorage.setItem("valetOpsState", JSON.stringify(state));
  } catch {}
}

/* ---------- PQI ---------- */

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
  btn.textContent = pqiEnabled ? "PQI: On" : "PQI: Off";
  btn.classList.toggle("off", !pqiEnabled);
}

/* ---------- FORM ---------- */

function setupForm() {
  const form = document.getElementById("new-pickup-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tag = document.getElementById("tag-number")?.value?.trim();
    const name = document.getElementById("customer-name")?.value?.trim();
    const staged = document.getElementById("stage-only")?.checked || false;
    if (!tag || !name) return;

    const now = new Date().toISOString();

    let insertData = {
      tag_number: tag,
      customer_name: name,
      status: staged ? "STAGED" : "NEW",
      wash_status: "NONE",
      active_started_at: staged ? null : now
    };

    if (role === "serviceadvisor") {
      insertData.status = "STAGED";
      insertData.active_started_at = null;
    }

    if (role === "loancar") {
      insertData.status = "NEW";
      insertData.active_started_at = now;
      insertData.notes = `[${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}] customer just arrived in loaner`;
      insertData.notes_updated_at = now;
    }

    const { error } = await supabase.from("pickups").insert(insertData);
    if (error) return alert("Error creating ticket");

    form.reset();
  });
}

/* ---------- TABLE ACTIONS ---------- */

function setupTableActions() {
  ["active-tbody", "staged-tbody", "waiting-tbody", "completed-tbody"].forEach(
    (id) => {
      const tbody = document.getElementById(id);
      if (tbody) tbody.addEventListener("click", onTableClick);
    }
  );
}

function onTableClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  if ((role === "serviceadvisor" || role === "loancar") && btn.dataset.action !== "edit-note") {
    return;
  }

  handleAction(btn.dataset.id, btn.dataset.action);
}

async function handleAction(id, action) {
  const now = new Date().toISOString();
  const updates = {};

  switch (action) {
    case "activate-from-staged":
      updates.status = "NEW";
      updates.active_started_at = now;
      break;

    case "edit-note": {
      const p = pickups.find(x => String(x.id) === String(id));
      const existing = p?.notes || "";
      const note = prompt("Add note:", "");
      if (!note) return;
      const stamp = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      updates.notes = existing ? existing + "\n" + `[${stamp}] ${note}` : `[${stamp}] ${note}`;
      updates.notes_updated_at = now;
      break;
    }

    default:
      return;
  }

  await supabase.from("pickups").update(updates).eq("id", id);
}

/* ---------- DATA ---------- */

async function loadPickups() {
  const { data } = await supabase.from("pickups").select("*").order("created_at", { ascending: false });
  pickups = data || [];
  renderTables(false);
}

function subscribeRealtime() {
  supabase.from("pickups").on("*", loadPickups).subscribe();
}

/* ---------- RENDER ---------- */

function renderTables() {
  const staged = pickups.filter(p => p.status === "STAGED");
  const stagedTbody = document.getElementById("staged-tbody");

  if (stagedTbody) {
    stagedTbody.innerHTML = staged.length
      ? staged.map(renderStagedRow).join("")
      : `<tr><td colspan="4" class="empty">No staged tickets.</td></tr>`;
  }
}

function renderStagedRow(p) {
  const notes = (p.notes || "").split("\n").filter(Boolean);
  const lastNote = notes[notes.length - 1] || "";

  // Column 4 switches by role, column count stays the same
  const col4 =
    role === "dispatcher"
      ? `<button class="btn small" data-action="activate-from-staged" data-id="${p.id}">Activate</button>`
      : `
        <button class="btn small notes-button" data-action="edit-note" data-id="${p.id}">Add note</button>
        ${lastNote ? `<div class="notes-preview">${escapeHtml(lastNote)}</div>` : ""}
      `;

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>${col4}</td>
    </tr>
  `;
}

/* ---------- HELPERS ---------- */

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
