// history.js (NEW FILE)
// Requires: supabaseClient.js + auth.js (requireAuth)

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js?v=20251224a";

let storeId = null;
let pickups = [];

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    const auth = await requireAuth({ page: "history" });
    if (!auth?.ok) return;

    storeId = auth?.profile?.store_id || null;

    wireSignOut();

    wireControls();
  })();
});

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

  const run = async () => {
    const dateVal = dateEl?.value || "";
    const q = (searchEl?.value || "").trim().toLowerCase();
    await loadHistory({ dateVal, q });
    renderHistory({ q });
  };

  if (applyBtn) applyBtn.addEventListener("click", run);
}

async function loadHistory({ dateVal, q }) {
  // We query by created_at day window (simple + reliable)
  // If you want completed_at day window later, we can add a toggle.
  let start = null;
  let end = null;

  if (dateVal) {
    start = new Date(dateVal + "T00:00:00");
    end = new Date(dateVal + "T23:59:59.999");
  }

  let query = supabase.from("pickups").select("*").order("created_at", { ascending: false });

  if (storeId) query = query.eq("store_id", storeId);
  if (start) query = query.gte("created_at", start.toISOString());
  if (end) query = query.lte("created_at", end.toISOString());

  const { data, error } = await query;
  if (error) {
    console.error(error);
    alert("History load failed. Check console.");
    pickups = [];
    return;
  }

  pickups = data || [];

  // lightweight client-side search
  if (q) {
    pickups = pickups.filter((p) => {
      const tag = String(p.tag_number || "").toLowerCase();
      const name = String(p.customer_name || "").toLowerCase();
      return tag.includes(q) || name.includes(q);
    });
  }
}

function renderHistory({ q }) {
  const completedTbody = document.getElementById("completed-tbody");
  const activeTbody = document.getElementById("active-tbody");

  const completed = pickups.filter((p) => p.status === "COMPLETE");
  const open = pickups.filter((p) => p.status !== "COMPLETE");

  setCount("count-completed", completed.length);
  setCount("count-active", open.length);

  if (completedTbody) {
    completedTbody.innerHTML =
      completed.length === 0
        ? `<tr><td colspan="8" class="empty">${q ? "No matches." : "No completed tickets for this date."}</td></tr>`
        : completed.map((p) => renderCompletedRow(p)).join("");
  }

  if (activeTbody) {
    activeTbody.innerHTML =
      open.length === 0
        ? `<tr><td colspan="7" class="empty">${q ? "No matches." : "No open results."}</td></tr>`
        : open.map((p) => renderOpenRow(p)).join("");
  }

  // click handler for Timeline buttons
  [completedTbody, activeTbody].forEach((tb) => {
    if (!tb) return;
    tb.onclick = (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "view-timeline") showTimeline(id);
    };
  });
}

function renderCompletedRow(p) {
  const deliveredBy = p.keys_holder || "—";
  const masterSeconds = computeMasterSeconds(p, new Date());
  const masterLabel = formatDuration(masterSeconds);

  const notes = (p.notes || "").split("\n").filter(Boolean).map(escapeHtml).join("<br>");

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

function showTimeline(id) {
  const p = pickups.find((x) => String(x.id) === String(id));
  if (!p) return;

  const lines = [];
  lines.push(`Ticket ${p.tag_number} – ${p.customer_name}`);
  lines.push("--------------------------------");

  if (p.created_at) lines.push("Created: " + formatTime(p.created_at));
  if (p.active_started_at) lines.push("Entered Active: " + formatTime(p.active_started_at));
  if (p.keys_with_valet_at && p.keys_holder) lines.push(`Keys with ${p.keys_holder}: ` + formatTime(p.keys_with_valet_at));
  if (p.keys_at_machine_at) lines.push("Keys in key machine: " + formatTime(p.keys_at_machine_at));
  if (p.wash_status_at && p.wash_status && p.wash_status !== "NONE") lines.push(`Wash status (${p.wash_status}): ` + formatTime(p.wash_status_at));
  if (p.waiting_client_at) lines.push("Waiting/staged: " + formatTime(p.waiting_client_at));
  if (p.completed_at) lines.push("Completed: " + formatTime(p.completed_at));

  const masterSeconds = computeMasterSeconds(p, new Date());
  lines.push("Master cycle: " + formatDuration(masterSeconds));

  if (p.notes) {
    lines.push("");
    lines.push("Notes:");
    p.notes.split("\n").forEach((n) => lines.push("• " + n));
  }

  alert(lines.join("\n"));
}

function computeMasterSeconds(p, now) {
  const startIso = p.active_started_at || p.created_at;
  if (!startIso) return 0;
  const endIso = p.waiting_client_at || null;
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
