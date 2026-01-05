// executive.js — Executive Console (Owner/Manager only, read-only analytics)
// Requires: ./supabaseClient.js + ./auth.js (requireAuth / wireSignOut)

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js?v=20260105d";

let storeId = null;
let servicePickups = [];
let salesPickups = [];
let refreshInterval = null;
let lastRefreshTime = null;

function pageKeyFromPath() {
  const file = (
    (window.location.pathname || "").split("/").pop() || ""
  ).toLowerCase();
  return file === "executive.html" ? "executive" : null;
}

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    const currentPage = pageKeyFromPath();
    if (!currentPage) {
      console.error("Not executive page");
      return;
    }

    // Auth gate
    const auth = await requireAuth({ page: currentPage });
    if (!auth?.ok) return; // redirected or blocked

    storeId = auth?.profile?.store_id || null;
    const effectiveRole = auth?.effectiveRole || "";

    // Role lock: only owner/manager allowed
    if (effectiveRole !== "owner" && effectiveRole !== "manager") {
      window.location.href = "index.html";
      return;
    }

    // Wire sign out
    wireSignOut();

    // Setup tabs
    setupTabs();

    // Setup refresh button
    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadData();
      });
    }

    // Initial load
    await loadData();

    // Auto-refresh every 30s
    refreshInterval = setInterval(() => {
      loadData();
    }, 30000);
  })();
});

function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");

      // Update button states
      tabBtns.forEach((b) => b.classList.remove("selected", "active"));
      btn.classList.add("selected", "active");

      // Show/hide content
      tabContents.forEach((content) => {
        content.style.display = "none";
      });

      if (tab === "store") {
        document.getElementById("tab-store").style.display = "block";
      } else if (tab === "service") {
        document.getElementById("tab-service").style.display = "block";
      } else if (tab === "sales") {
        document.getElementById("tab-sales").style.display = "block";
      }

      // Re-render current tab
      renderTab(tab);
    });
  });

  // Default to store tab
  const storeBtn = document.querySelector('[data-tab="store"]');
  if (storeBtn) {
    storeBtn.classList.add("selected", "active");
    document.getElementById("tab-store").style.display = "block";
  }
}

async function loadData() {
  if (!storeId) return;

  // Calculate today window (local time)
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();

  // Load service pickups
  // Strategy: Load pickups created today or later + completed today
  // This matches requirement: "created_at >= dayStart OR completed_at >= dayStart"
  try {
    // Load pickups created today or later (includes active ones)
    let createdQuery = supabase
      .from("pickups")
      .select("id, created_at, completed_at, status, location, wash_status, active_started_at, waiting_client_at, keys_holder")
      .eq("store_id", storeId)
      .gte("created_at", dayStartIso);

    // Load pickups completed today (even if created earlier)
    let completedQuery = supabase
      .from("pickups")
      .select("id, created_at, completed_at, status, location, wash_status, active_started_at, waiting_client_at, keys_holder")
      .eq("store_id", storeId)
      .eq("status", "COMPLETE")
      .gte("completed_at", dayStartIso)
      .lt("completed_at", dayEndIso);

    const [createdResult, completedResult] = await Promise.all([
      createdQuery,
      completedQuery
    ]);

    if (createdResult.error) {
      console.error("Load created pickups error:", createdResult.error);
    }
    if (completedResult.error) {
      console.error("Load completed pickups error:", completedResult.error);
    }

    // Combine and deduplicate by id
    const createdData = createdResult.data || [];
    const completedData = completedResult.data || [];
    const allIds = new Set();
    servicePickups = [];

    [...createdData, ...completedData].forEach((p) => {
      if (!allIds.has(p.id)) {
        allIds.add(p.id);
        servicePickups.push(p);
      }
    });
  } catch (err) {
    console.error("Load service pickups error:", err);
  }

  // Load sales pickups
  // Strategy: Load all from store, filter client-side for today window
  // This is simpler and matches existing codebase patterns
  try {
    let query = supabase
      .from("sales_pickups")
      .select("id, created_at, completed_at, cancelled_at, status, on_the_way_at, salesperson_name, driver_name")
      .eq("store_id", storeId)
      .gte("created_at", dayStartIso);

    const { data, error } = await query;

    if (error) {
      console.error("Load sales pickups error:", error);
      return;
    }

    // Filter client-side: include if created today OR completed today OR cancelled today
    salesPickups = (data || []).filter((p) => {
      const created = p.created_at ? new Date(p.created_at) : null;
      const completed = p.completed_at ? new Date(p.completed_at) : null;
      const cancelled = p.cancelled_at ? new Date(p.cancelled_at) : null;
      return (
        (created && created >= dayStart && created < dayEnd) ||
        (completed && completed >= dayStart && completed < dayEnd) ||
        (cancelled && cancelled >= dayStart && cancelled < dayEnd)
      );
    });
  } catch (err) {
    console.error("Load sales pickups error:", err);
  }

  // Update last refresh time
  lastRefreshTime = Date.now();
  updateLastUpdated();

  // Render all tabs
  renderStoreOverview();
  renderServiceTab();
  renderSalesTab();
}

function updateLastUpdated() {
  const el = document.getElementById("last-updated");
  if (!el) return;

  if (lastRefreshTime) {
    const now = Date.now();
    const secondsAgo = Math.floor((now - lastRefreshTime) / 1000);
    const timeStr = new Date(lastRefreshTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    if (secondsAgo < 60) {
      el.textContent = `Last updated: ${timeStr} (${secondsAgo}s ago)`;
    } else if (secondsAgo < 3600) {
      el.textContent = `Last updated: ${timeStr} (${Math.floor(secondsAgo / 60)}m ago)`;
    } else {
      el.textContent = `Last updated: ${timeStr}`;
    }
  } else {
    el.textContent = "Last updated: —";
  }
}

function renderStoreOverview() {
  // Calculate today window
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Service Active Count: status != COMPLETE
  const serviceActive = servicePickups.filter(
    (p) => p.status !== "COMPLETE"
  ).length;

  // Service Waiting/Ready Count: status = WAITING_FOR_CUSTOMER
  const serviceWaiting = servicePickups.filter(
    (p) => p.status === "WAITING_FOR_CUSTOMER"
  ).length;

  // Service Completed Today
  const serviceCompletedToday = servicePickups.filter((p) => {
    if (!p.completed_at) return false;
    const d = new Date(p.completed_at);
    return d >= dayStart && d < dayEnd;
  }).length;

  // Avg Service Cycle Time Today
  const cycleTimes = servicePickups
    .filter((p) => {
      if (!p.active_started_at || !p.waiting_client_at) return false;
      const started = new Date(p.active_started_at);
      const waiting = new Date(p.waiting_client_at);
      return started >= dayStart && waiting >= dayStart;
    })
    .map((p) => {
      const started = new Date(p.active_started_at);
      const waiting = new Date(p.waiting_client_at);
      return (waiting - started) / 1000 / 60; // minutes
    });

  const avgCycleTime = cycleTimes.length > 0
    ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
    : null;

  // Needs Rewash Count
  const needsRewash = servicePickups.filter(
    (p) =>
      (p.wash_status && p.wash_status.startsWith("NEEDS_REWASH")) ||
      p.wash_status === "SEND_TO_WASH"
  ).length;

  // Key/Car Missing Count
  const keyCarMissing = servicePickups.filter(
    (p) => p.wash_status === "KEY_CAR_MISSING"
  ).length;

  // Sales Active Requests
  const salesActive = salesPickups.filter(
    (p) => p.status !== "COMPLETE" && p.status !== "CANCELLED"
  ).length;

  // Sales Completed Today
  const salesCompletedToday = salesPickups.filter((p) => {
    if (!p.completed_at) return false;
    const d = new Date(p.completed_at);
    return d >= dayStart && d < dayEnd;
  }).length;

  // Avg Driver Time Today
  const driverTimes = salesPickups
    .filter((p) => {
      if (!p.on_the_way_at || !p.completed_at) return false;
      const completed = new Date(p.completed_at);
      return completed >= dayStart && completed < dayEnd;
    })
    .map((p) => {
      const onWay = new Date(p.on_the_way_at);
      const completed = new Date(p.completed_at);
      return (completed - onWay) / 1000 / 60; // minutes
    });

  const avgDriverTime = driverTimes.length > 0
    ? driverTimes.reduce((a, b) => a + b, 0) / driverTimes.length
    : null;

  // Live Health
  const healthText = "Polling: 30s / Timers: 15s";

  // Update KPI cards
  setKPI("kpi-service-active", serviceActive);
  setKPI("kpi-service-waiting", serviceWaiting);
  setKPI("kpi-service-completed", serviceCompletedToday);
  setKPI("kpi-service-avg-cycle", avgCycleTime ? formatDuration(avgCycleTime * 60) : "—");
  setKPI("kpi-needs-rewash", needsRewash);
  setKPI("kpi-key-car-missing", keyCarMissing);
  setKPI("kpi-sales-active", salesActive);
  setKPI("kpi-sales-completed", salesCompletedToday);
  setKPI("kpi-sales-avg-driver", avgDriverTime ? formatDuration(avgDriverTime * 60) : "—");
  setKPI("kpi-live-health", healthText);
}

function renderServiceTab() {
  // Reuse calculations from store overview
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const serviceActive = servicePickups.filter(
    (p) => p.status !== "COMPLETE"
  ).length;

  const serviceCompletedToday = servicePickups.filter((p) => {
    if (!p.completed_at) return false;
    const d = new Date(p.completed_at);
    return d >= dayStart && d < dayEnd;
  }).length;

  const cycleTimes = servicePickups
    .filter((p) => {
      if (!p.active_started_at || !p.waiting_client_at) return false;
      const started = new Date(p.active_started_at);
      const waiting = new Date(p.waiting_client_at);
      return started >= dayStart && waiting >= dayStart;
    })
    .map((p) => {
      const started = new Date(p.active_started_at);
      const waiting = new Date(p.waiting_client_at);
      return (waiting - started) / 1000 / 60;
    });

  const avgCycleTime = cycleTimes.length > 0
    ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
    : null;

  setKPI("kpi-service-active-tab", serviceActive);
  setKPI("kpi-service-completed-tab", serviceCompletedToday);
  setKPI("kpi-service-avg-cycle-tab", avgCycleTime ? formatDuration(avgCycleTime * 60) : "—");

  // Breakdown by status
  const statusCounts = {};
  servicePickups.forEach((p) => {
    const status = p.status || "UNKNOWN";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const statusRows = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `
      <tr>
        <td>${escapeHtml(humanStatus(status))}</td>
        <td>${count}</td>
      </tr>
    `)
    .join("");

  const statusTbody = document.getElementById("breakdown-status");
  if (statusTbody) {
    statusTbody.innerHTML = statusRows || '<tr><td colspan="2" class="empty">No data</td></tr>';
  }

  // Breakdown by location (using wash_status as location indicator)
  const locationCounts = {};
  servicePickups.forEach((p) => {
    const location = p.wash_status || "NONE";
    locationCounts[location] = (locationCounts[location] || 0) + 1;
  });

  const locationRows = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([location, count]) => `
      <tr>
        <td>${escapeHtml(humanWashStatus(location))}</td>
        <td>${count}</td>
      </tr>
    `)
    .join("");

  const locationTbody = document.getElementById("breakdown-location");
  if (locationTbody) {
    locationTbody.innerHTML = locationRows || '<tr><td colspan="2" class="empty">No data</td></tr>';
  }

  // Top valets today (by completed count, using keys_holder)
  const valetCounts = {};
  servicePickups
    .filter((p) => {
      if (!p.completed_at || !p.keys_holder) return false;
      const d = new Date(p.completed_at);
      return d >= dayStart && d < dayEnd;
    })
    .forEach((p) => {
      const valet = p.keys_holder || "UNKNOWN";
      valetCounts[valet] = (valetCounts[valet] || 0) + 1;
    });

  const valetRows = Object.entries(valetCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([valet, count]) => `
      <tr>
        <td>${escapeHtml(valet)}</td>
        <td>${count}</td>
      </tr>
    `)
    .join("");

  const valetTbody = document.getElementById("breakdown-valets");
  if (valetTbody) {
    valetTbody.innerHTML = valetRows || '<tr><td colspan="2" class="empty">No completed tickets today</td></tr>';
  }
}

function renderSalesTab() {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const salesActive = salesPickups.filter(
    (p) => p.status !== "COMPLETE" && p.status !== "CANCELLED"
  ).length;

  const salesCompletedToday = salesPickups.filter((p) => {
    if (!p.completed_at) return false;
    const d = new Date(p.completed_at);
    return d >= dayStart && d < dayEnd;
  }).length;

  const driverTimes = salesPickups
    .filter((p) => {
      if (!p.on_the_way_at || !p.completed_at) return false;
      const completed = new Date(p.completed_at);
      return completed >= dayStart && completed < dayEnd;
    })
    .map((p) => {
      const onWay = new Date(p.on_the_way_at);
      const completed = new Date(p.completed_at);
      return (completed - onWay) / 1000 / 60;
    });

  const avgDriverTime = driverTimes.length > 0
    ? driverTimes.reduce((a, b) => a + b, 0) / driverTimes.length
    : null;

  setKPI("kpi-sales-active-tab", salesActive);
  setKPI("kpi-sales-completed-tab", salesCompletedToday);
  setKPI("kpi-sales-avg-driver-tab", avgDriverTime ? formatDuration(avgDriverTime * 60) : "—");

  // Breakdown by status
  const statusCounts = {};
  salesPickups.forEach((p) => {
    const status = p.status || "UNKNOWN";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const statusRows = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `
      <tr>
        <td>${escapeHtml(status)}</td>
        <td>${count}</td>
      </tr>
    `)
    .join("");

  const statusTbody = document.getElementById("breakdown-sales-status");
  if (statusTbody) {
    statusTbody.innerHTML = statusRows || '<tr><td colspan="2" class="empty">No data</td></tr>';
  }

  // By salesperson today (created today)
  const salespersonCounts = {};
  salesPickups
    .filter((p) => {
      if (!p.created_at) return false;
      const d = new Date(p.created_at);
      return d >= dayStart && d < dayEnd;
    })
    .forEach((p) => {
      const salesperson = p.salesperson_name || "UNKNOWN";
      salespersonCounts[salesperson] = (salespersonCounts[salesperson] || 0) + 1;
    });

  const salespersonRows = Object.entries(salespersonCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([salesperson, count]) => `
      <tr>
        <td>${escapeHtml(salesperson)}</td>
        <td>${count}</td>
      </tr>
    `)
    .join("");

  const salespersonTbody = document.getElementById("breakdown-salesperson");
  if (salespersonTbody) {
    salespersonTbody.innerHTML = salespersonRows || '<tr><td colspan="2" class="empty">No requests created today</td></tr>';
  }

  // By driver today (completed today)
  const driverCounts = {};
  salesPickups
    .filter((p) => {
      if (!p.completed_at || !p.driver_name) return false;
      const d = new Date(p.completed_at);
      return d >= dayStart && d < dayEnd;
    })
    .forEach((p) => {
      const driver = p.driver_name || "UNKNOWN";
      driverCounts[driver] = (driverCounts[driver] || 0) + 1;
    });

  const driverRows = Object.entries(driverCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([driver, count]) => `
      <tr>
        <td>${escapeHtml(driver)}</td>
        <td>${count}</td>
      </tr>
    `)
    .join("");

  const driverTbody = document.getElementById("breakdown-driver");
  if (driverTbody) {
    driverTbody.innerHTML = driverRows || '<tr><td colspan="2" class="empty">No requests completed today</td></tr>';
  }
}

function renderTab(tab) {
  if (tab === "store") {
    renderStoreOverview();
  } else if (tab === "service") {
    renderServiceTab();
  } else if (tab === "sales") {
    renderSalesTab();
  }
}

function setKPI(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value !== null && value !== undefined ? String(value) : "—";
  }
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0m 00s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function humanStatus(status) {
  switch (status) {
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
      return status || "Unknown";
  }
}

function humanWashStatus(wash_status) {
  switch (wash_status) {
    case "IN_WASH_AREA":
      return "In Wash Area";
    case "ON_RED_LINE":
      return "On Red Line";
    case "KEY_CAR_MISSING":
      return "Key/Car Missing";
    case "NEEDS_REWASH_PENDING":
      return "Needs Rewash (Pending)";
    case "NEEDS_REWASH_NO":
      return "Needs Rewash (No)";
    case "SEND_TO_WASH":
      return "Send to Wash";
    case "DUSTY":
      return "Dusty";
    case "NONE":
    default:
      return "None";
  }
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

