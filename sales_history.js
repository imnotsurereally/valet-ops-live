// sales_history.js — Sales History (Owner/Manager only)
// Requires: ./supabaseClient.js + ./auth.js (requireAuth / wireSignOut) + ./ui.js

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js?v=20260110a";
import { toast, downloadCSV, copyTSV } from "./ui.js?v=20260105c";

let salesPickups = [];
let storeId = null;

/* ---------- INITIALIZATION ---------- */

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    // Auth gate (owner/manager only)
    const auth = await requireAuth({ page: "sales_history" });
    if (!auth?.ok) return; // redirected or blocked

    storeId = auth?.profile?.store_id || null;
    const userRole = auth?.effectiveRole || "";

    // Role guard: ONLY owner/manager allowed
    const allowed = ["owner", "manager"];
    if (!allowed.includes(userRole.toLowerCase())) {
      toast("Access denied. Sales History requires owner/manager role.", "error");
      setTimeout(() => {
        window.location.href = "index.html";
      }, 2000);
      return;
    }

    // Wire sign out
    wireSignOut();

    // Setup UI
    setupDateFilter();
    setupExportButtons();

    // Load data
    await loadSalesPickups();
  })();
});

/* ---------- DATE FILTER ---------- */

function setupDateFilter() {
  const dateInput = document.getElementById("completed-date-filter");
  if (!dateInput) return;

  // Default to today
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  dateInput.value = `${yyyy}-${mm}-${dd}`;

  dateInput.addEventListener("change", () => {
    renderCompletedTable();
  });
}

/* ---------- EXPORT BUTTONS ---------- */

function setupExportButtons() {
  const csvBtn = document.getElementById("export-csv");
  const tsvBtn = document.getElementById("export-tsv");

  if (csvBtn) {
    csvBtn.addEventListener("click", exportCompletedCSV);
  }
  if (tsvBtn) {
    tsvBtn.addEventListener("click", exportCompletedTSV);
  }
}

/* ---------- DATA LOADING ---------- */

async function loadSalesPickups() {
  if (!storeId) return;

  try {
    let query = supabase
      .from("sales_pickups")
      .select("*")
      .eq("store_id", storeId)
      .in("status", ["COMPLETE", "CANCELLED"])
      .order("requested_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error("Load sales pickups error:", error);
      toast("Failed to load history", "error");
      return;
    }

    salesPickups = data || [];
    renderCompletedTable();
  } catch (err) {
    console.error("Load sales pickups error:", err);
    toast("Failed to load history", "error");
  }
}

/* ---------- RENDERING ---------- */

function renderCompletedTable() {
  const tbody = document.getElementById("completed-tbody");
  if (!tbody) return;

  // Filter by completed_at/cancelled_at day (default today)
  const dateInput = document.getElementById("completed-date-filter");
  let targetDate = new Date();
  if (dateInput && dateInput.value) {
    targetDate = new Date(dateInput.value + "T00:00:00");
  }

  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setDate(dayEnd.getDate() + 1);
  dayEnd.setHours(0, 0, 0, 0);

  const completed = salesPickups.filter((p) => {
    const timeField = p.status === "COMPLETE" ? p.completed_at : p.cancelled_at;
    if (!timeField) return false;
    const timeDate = new Date(timeField);
    return timeDate >= dayStart && timeDate < dayEnd;
  });

  const countEl = document.getElementById("count-completed");
  if (countEl) countEl.textContent = completed.length;

  // Store for export
  window._salesHistoryCompletedForExport = completed;

  if (completed.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No completed/cancelled requests for this date.</td></tr>';
    return;
  }

  tbody.innerHTML = completed
    .map((p) => {
      const finalStatus = p.status === "COMPLETE" ? "COMPLETE" : "CANCELLED";
      const timeField = p.status === "COMPLETE" ? p.completed_at : p.cancelled_at;
      const timeStr = timeField ? formatTime(timeField) : "—";
      
      // Calculate master time (from requested_at to completed_at/cancelled_at)
      const masterTime = p.requested_at && timeField
        ? formatDuration(new Date(p.requested_at), new Date(timeField))
        : "—";

      const notesPreview = p.notes
        ? (p.notes.length > 100 ? p.notes.substring(0, 100) + "..." : p.notes)
        : "";

      return `
        <tr>
          <td class="cell-tag">${escapeHtml(p.stock_number || "")}</td>
          <td>${escapeHtml(p.salesperson_name || "")}</td>
          <td>${escapeHtml(p.driver_name || "—")}</td>
          <td>${escapeHtml(finalStatus)}</td>
          <td>${escapeHtml(timeStr)}</td>
          <td>${escapeHtml(masterTime)}</td>
          <td>${escapeHtml(notesPreview)}</td>
        </tr>
      `;
    })
    .join("");
}

/* ---------- EXPORT ---------- */

async function exportCompletedCSV() {
  const completed = window._salesHistoryCompletedForExport || [];
  if (completed.length === 0) {
    toast("No completed/cancelled requests to export", "warn");
    return;
  }

  const headers = [
    { key: "created_at", label: "Created At" },
    { key: "completed_at_or_cancelled_at", label: "Completed/Cancelled At" },
    { key: "stock_number", label: "Stock #" },
    { key: "salesperson", label: "Salesperson" },
    { key: "driver", label: "Driver" },
    { key: "notes", label: "Notes" },
    { key: "master_time", label: "Master Time" },
    { key: "status", label: "Status" }
  ];

  const rows = completed.map((p) => {
    const timeField = p.status === "COMPLETE" ? p.completed_at : p.cancelled_at;
    const masterTime = p.requested_at && timeField
      ? formatDuration(new Date(p.requested_at), new Date(timeField))
      : "";

    return {
      created_at: p.requested_at ? new Date(p.requested_at).toISOString() : "",
      completed_at_or_cancelled_at: timeField ? new Date(timeField).toISOString() : "",
      stock_number: p.stock_number || "",
      salesperson: p.salesperson_name || "",
      driver: p.driver_name || "",
      notes: (p.notes || "").replace(/\n/g, " | "),
      master_time: masterTime,
      status: p.status || ""
    };
  });

  const dateInput = document.getElementById("completed-date-filter");
  const dateStr = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().split("T")[0];
  downloadCSV(`sales-history-${dateStr}`, headers, rows);
}

async function exportCompletedTSV() {
  const completed = window._salesHistoryCompletedForExport || [];
  if (completed.length === 0) {
    toast("No completed/cancelled requests to export", "warn");
    return;
  }

  const headers = [
    { key: "created_at", label: "Created At" },
    { key: "completed_at_or_cancelled_at", label: "Completed/Cancelled At" },
    { key: "stock_number", label: "Stock #" },
    { key: "salesperson", label: "Salesperson" },
    { key: "driver", label: "Driver" },
    { key: "notes", label: "Notes" },
    { key: "master_time", label: "Master Time" },
    { key: "status", label: "Status" }
  ];

  const rows = completed.map((p) => {
    const timeField = p.status === "COMPLETE" ? p.completed_at : p.cancelled_at;
    const masterTime = p.requested_at && timeField
      ? formatDuration(new Date(p.requested_at), new Date(timeField))
      : "";

    return {
      created_at: p.requested_at ? new Date(p.requested_at).toISOString() : "",
      completed_at_or_cancelled_at: timeField ? new Date(timeField).toISOString() : "",
      stock_number: p.stock_number || "",
      salesperson: p.salesperson_name || "",
      driver: p.driver_name || "",
      notes: (p.notes || "").replace(/\n/g, " | "),
      master_time: masterTime,
      status: p.status || ""
    };
  });

  copyTSV(headers, rows);
}

/* ---------- HELPERS ---------- */

// Helper: snap milliseconds to 15-second increments
function snapMsTo15s(ms) {
  return Math.floor(ms / 15000) * 15000;
}

function formatDuration(startTime, endTime) {
  const diffMs = endTime - startTime;
  const snappedMs = snapMsTo15s(diffMs);
  const seconds = Math.floor(snappedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

