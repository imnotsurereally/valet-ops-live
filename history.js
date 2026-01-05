// history.js  (FULL FILE REPLACEMENT) — V0.912
// Requires: ./supabaseClient.js + ./auth.js (requireAuth / wireSignOut) + ./ui.js

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js?v=20260105a";
import { showModal, toast, downloadCSV, copyTSV } from "./ui.js?v=20260105a";

let storeId = null;
let pickups = [];

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    // AUTH GATE (dispatcher-only per auth.js rules)
    const auth = await requireAuth({ page: "history" });
    if (!auth?.ok) return;

    storeId = auth?.profile?.store_id || null;

    wireSignOut();
    wireControls();
    wireTimelineClicks();
    wireExportButtons();

    // auto-run once on load
    runSearch();
  })();
});

/* ---------- Controls ---------- */

function wireControls() {
  const dateEl = document.getElementById("history-date");
  const searchEl = document.getElementById("history-search");
  const applyBtn = document.getElementById("history-apply");

  // default date = today
  if (dateEl && !dateEl.value) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    dateEl.value = `${yyyy}-${mm}-${dd}`;
  }

  if (applyBtn) applyBtn.addEventListener("click", runSearch);

  // Enter key triggers Apply
  if (searchEl) {
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    });
  }

  if (dateEl) {
    dateEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    });
  }
}

async function runSearch() {
  const dateEl = document.getElementById("history-date");
  const searchEl = document.getElementById("history-search");

  const dateVal = dateEl?.value || "";
  const q = (searchEl?.value || "").trim().toLowerCase();

  await loadHistory({ dateVal, q });
  renderHistory({ q });
}

/* ---------- Data ---------- */

async function loadHistory({ dateVal, q }) {
  // Query by created_at day window for open tickets, completed_at for completed
  let start = null;
  let end = null;

  if (dateVal) {
    start = new Date(dateVal + "T00:00:00");
    end = new Date(dateVal + "T23:59:59.999");
  }

  let query = supabase
    .from("pickups")
    .select("*")
    .order("created_at", { ascending: false });

  if (storeId) query = query.eq("store_id", storeId);
  if (start) query = query.gte("created_at", start.toISOString());
  if (end) query = query.lte("created_at", end.toISOString());

  const { data, error } = await query;

  if (error) {
    console.error(error);
    toast("History load failed. Check console.", "error");
    pickups = [];
    return;
  }

  let rows = data || [];

  // lightweight client-side search
  if (q) {
    rows = rows.filter((p) => {
      const tag = String(p.tag_number || "").toLowerCase();
      const name = String(p.customer_name || "").toLowerCase();
      return tag.includes(q) || name.includes(q);
    });
  }

  pickups = rows;
}

/* ---------- Render ---------- */

function renderHistory({ q }) {
  const completedTbody = document.getElementById("completed-tbody");
  const activeTbody = document.getElementById("active-tbody");

  // Filter completed by completed_at day (not created_at)
  const dateEl = document.getElementById("history-date");
  let targetDate = new Date();
  if (dateEl && dateEl.value) {
    targetDate = new Date(dateEl.value + "T00:00:00");
  }

  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  const completed = pickups.filter((p) => {
    if (p.status !== "COMPLETE") return false;
    if (!p.completed_at) return false;
    const completedDate = new Date(p.completed_at);
    return completedDate >= dayStart && completedDate <= dayEnd;
  });
  const open = pickups.filter((p) => p.status !== "COMPLETE");

  // Store completed for export
  window._historyCompletedForExport = completed;

  setCount("count-completed", completed.length);
  setCount("count-active", open.length);

  if (completedTbody) {
    completedTbody.innerHTML =
      completed.length === 0
        ? `<tr><td colspan="8" class="empty">${
            q ? "No matches." : "No completed tickets for this date."
          }</td></tr>`
        : completed.map((p) => renderCompletedRow(p)).join("");
  }

  if (activeTbody) {
    activeTbody.innerHTML =
      open.length === 0
        ? `<tr><td colspan="7" class="empty">${
            q ? "No matches." : "No open results."
          }</td></tr>`
        : open.map((p) => renderOpenRow(p)).join("");
  }
}

function renderCompletedRow(p) {
  const deliveredBy = p.keys_holder || "—";

  // V0.912: history should show final/frozen master time (waiting or completed)
  const masterSeconds = computeMasterSeconds(p, new Date());
  const masterLabel = formatDuration(masterSeconds);

  const notes = (p.notes || "")
    .split("\n")
    .filter(Boolean)
    .map(escapeHtml)
    .join("<br>");

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${masterLabel}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td>${formatTime(p.created_at)}</td>
      <td>${formatTime(p.completed_at)}</td>
      <td>${notes || ""}</td>
      <td>
        <button class="btn small" data-action="view-timeline" data-id="${p.id}">Timeline</button>
      </td>
    </tr>
  `;
}

function renderOpenRow(p) {
  const deliveredBy = p.keys_holder || "—";

  const masterSeconds = computeMasterSeconds(p, new Date());
  const masterLabel = formatDuration(masterSeconds);

  const notesPieces = (p.notes || "").split("\n").filter(Boolean);
  const lastNote = notesPieces.length ? notesPieces[notesPieces.length - 1] : "";

  return `
    <tr>
      <td class="cell-tag">${escapeHtml(p.tag_number)}</td>
      <td class="cell-customer">${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(p.status || "")}</td>
      <td>${escapeHtml(deliveredBy)}</td>
      <td>${escapeHtml(lastNote)}</td>
      <td>${masterLabel}</td>
      <td>
        <button class="btn small" data-action="view-timeline" data-id="${p.id}">Timeline</button>
      </td>
    </tr>
  `;
}

/* ---------- Timeline clicks (bind once) ---------- */

function wireTimelineClicks() {
  const completedTbody = document.getElementById("completed-tbody");
  const activeTbody = document.getElementById("active-tbody");

  [completedTbody, activeTbody].forEach((tb) => {
    if (!tb) return;
    tb.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      if (action === "view-timeline") showTimeline(id);
    });
  });
}

async function showTimeline(id) {
  const p = pickups.find((x) => String(x.id) === String(id));
  if (!p) return;

  const lines = [];
  lines.push(`Ticket ${p.tag_number} – ${p.customer_name}`);
  lines.push("--------------------------------");

  if (p.created_at) lines.push("Created: " + formatTime(p.created_at));
  if (p.active_started_at) lines.push("Entered Active: " + formatTime(p.active_started_at));
  if (p.keys_with_valet_at && p.keys_holder) lines.push(`Keys with ${p.keys_holder}: ` + formatTime(p.keys_with_valet_at));
  if (p.keys_at_machine_at) lines.push("Keys in key machine: " + formatTime(p.keys_at_machine_at));

  if (p.wash_status_at && p.wash_status && p.wash_status !== "NONE")
    lines.push(`Wash status (${p.wash_status}): ` + formatTime(p.wash_status_at));

  if (p.waiting_client_at) lines.push("Waiting/staged: " + formatTime(p.waiting_client_at));
  if (p.completed_at) lines.push("Completed: " + formatTime(p.completed_at));

  const masterSeconds = computeMasterSeconds(p, new Date());
  lines.push("Master cycle: " + formatDuration(masterSeconds));

  if (p.notes) {
    lines.push("");
    lines.push("Notes:");
    p.notes.split("\n").forEach((n) => lines.push("• " + n));
  }

  await showModal({
    title: "Timeline",
    content: `<pre style="white-space: pre-wrap; font-family: monospace; font-size: 0.85rem;">${escapeHtml(lines.join("\n"))}</pre>`,
    width: "600px"
  });
}

async function exportHistoryCSV() {
  const completed = window._historyCompletedForExport || [];
  if (completed.length === 0) {
    toast("No completed tickets to export", "warn");
    return;
  }

  const headers = [
    { key: "tag_number", label: "Tag #" },
    { key: "customer_name", label: "Customer" },
    { key: "master_time", label: "Total Time" },
    { key: "keys_holder", label: "Delivered By" },
    { key: "created_at", label: "Created" },
    { key: "completed_at", label: "Completed" },
    { key: "notes", label: "Notes" }
  ];

  const rows = completed.map((p) => {
    const masterSeconds = computeMasterSeconds(p, new Date());
    return {
      tag_number: p.tag_number || "",
      customer_name: p.customer_name || "",
      master_time: formatDuration(masterSeconds),
      keys_holder: p.keys_holder || "",
      created_at: formatTime(p.created_at),
      completed_at: formatTime(p.completed_at),
      notes: (p.notes || "").replace(/\n/g, " | ")
    };
  });

  const dateEl = document.getElementById("history-date");
  const dateStr = dateEl && dateEl.value ? dateEl.value : new Date().toISOString().split("T")[0];
  downloadCSV(`history-completed-${dateStr}`, headers, rows);
}

async function exportHistoryTSV() {
  const completed = window._historyCompletedForExport || [];
  if (completed.length === 0) {
    toast("No completed tickets to export", "warn");
    return;
  }

  const headers = [
    { key: "tag_number", label: "Tag #" },
    { key: "customer_name", label: "Customer" },
    { key: "master_time", label: "Total Time" },
    { key: "keys_holder", label: "Delivered By" },
    { key: "created_at", label: "Created" },
    { key: "completed_at", label: "Completed" },
    { key: "notes", label: "Notes" }
  ];

  const rows = completed.map((p) => {
    const masterSeconds = computeMasterSeconds(p, new Date());
    return {
      tag_number: p.tag_number || "",
      customer_name: p.customer_name || "",
      master_time: formatDuration(masterSeconds),
      keys_holder: p.keys_holder || "",
      created_at: formatTime(p.created_at),
      completed_at: formatTime(p.completed_at),
      notes: (p.notes || "").replace(/\n/g, " | ")
    };
  });

  copyTSV(headers, rows);
}

/* ---------- Helpers ---------- */

function computeMasterSeconds(p, now) {
  const startIso = p.active_started_at || p.created_at;
  if (!startIso) return 0;

  // V0.912: freeze master timer once waiting OR completed
  const endIso = p.waiting_client_at || p.completed_at || null;
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

function setCount(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value);
}

function wireExportButtons() {
  const csvBtn = document.getElementById("history-export-csv");
  const tsvBtn = document.getElementById("history-export-tsv");

  if (csvBtn) {
    csvBtn.addEventListener("click", exportHistoryCSV);
  }
  if (tsvBtn) {
    tsvBtn.addEventListener("click", exportHistoryTSV);
  }
}
