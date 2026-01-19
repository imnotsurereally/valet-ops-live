// system_settings.js — System Settings (Owner/Manager only, read-only)
// Requires: ./supabaseClient.js + ./auth.js (requireAuth / wireSignOut)

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js?v=20260110a";
import { initObservability, logClientEvent } from "./observability.js";

let storeId = null;
let healthInterval = null;
let queryErrorCount = 0;
let lastSuccessfulQuery = null;

function pageKeyFromPath() {
  const file = (
    (window.location.pathname || "").split("/").pop() || ""
  ).toLowerCase();
  return file === "system_settings.html" ? "system_settings" : null;
}

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    const currentPage = pageKeyFromPath();
    if (!currentPage) {
      console.error("Not system_settings page");
      return;
    }

    // Auth gate
    const auth = await requireAuth({ page: currentPage });
    if (!auth?.ok) return; // redirected or blocked

    storeId = auth?.profile?.store_id || null;
    const effectiveRole = auth?.effectiveRole || "";
    const profile = auth?.profile || null;

  // Observability (best effort; non-blocking)
  initObservability({ storeId, page: currentPage, role: currentPage });
  logClientEvent({
    storeId,
    page: currentPage,
    role: currentPage,
    level: "info",
    eventType: "page_load",
    message: "loaded",
    context: {},
  });

    // Role lock: only owner/manager allowed
    if (effectiveRole !== "owner" && effectiveRole !== "manager") {
      window.location.href = "index.html";
      return;
    }

    // Wire sign out
    wireSignOut();

    // Screen context is already rendered by requireAuth

    // Display constants
    document.getElementById("system-polling").textContent = "5s";
    document.getElementById("system-timer-snap").textContent = "15s";

    // Try to infer realtime status (check if any realtime subscription exists)
    // For now, we'll set to "Unknown" since we can't easily detect subscriptions
    document.getElementById("system-realtime").textContent = "Unknown";

    // Get version from query param or default
    const urlParams = new URLSearchParams(window.location.search);
    const version = urlParams.get("version") || "20260105e";
    document.getElementById("system-version").textContent = version;

    // Initialize health monitoring
    updateHealthDisplay();
    await runHealthCheck();

    // Health check every 10s
    healthInterval = setInterval(async () => {
      await runHealthCheck();
    }, 10000);
  })();
});

async function runHealthCheck() {
  if (!storeId) return;

  try {
    // Lightweight query: just check if store exists
    const { data, error } = await supabase
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .limit(1)
      .maybeSingle();

    if (error) {
      queryErrorCount++;
      console.warn("Health check query error:", error);
    } else if (data) {
      lastSuccessfulQuery = new Date();
      updateHealthDisplay();
    }
  } catch (err) {
    queryErrorCount++;
    console.warn("Health check error:", err);
  }

  updateHealthDisplay();
}

function updateHealthDisplay() {
  const lastQueryEl = document.getElementById("health-last-query");
  const errorCountEl = document.getElementById("health-error-count");

  if (lastQueryEl) {
    if (lastSuccessfulQuery) {
      const now = Date.now();
      const secondsAgo = Math.floor((now - lastSuccessfulQuery.getTime()) / 1000);
      const timeStr = lastSuccessfulQuery.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });

      if (secondsAgo < 60) {
        lastQueryEl.textContent = `${timeStr} (${secondsAgo}s ago)`;
      } else if (secondsAgo < 3600) {
        lastQueryEl.textContent = `${timeStr} (${Math.floor(secondsAgo / 60)}m ago)`;
      } else {
        lastQueryEl.textContent = timeStr;
      }
    } else {
      lastQueryEl.textContent = "—";
    }
  }

  if (errorCountEl) {
    errorCountEl.textContent = queryErrorCount.toString();
    if (queryErrorCount > 0) {
      errorCountEl.style.color = "#ff9b9b";
    } else {
      errorCountEl.style.color = "#f5f5f5";
    }
  }
}

