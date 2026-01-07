// auth.js (FULL FILE REPLACEMENT) — Supabase v1 compatible
import { supabase } from "./supabaseClient.js";

const ROUTES = {
  dispatcher: "dispatcher.html",
  keymachine: "keymachine.html",
  carwash: "carwash.html",
  serviceadvisor: "serviceadvisor.html",
  loancar: "loancar.html",
  wallboard: "wallboard.html",
  history: "history.html",
  sales_manager: "sales_manager.html",
  sales_driver: "sales_driver.html",
  sales_history: "sales_history.html",
  executive: "executive.html",
  system_settings: "system_settings.html",
  driver: "sales_driver.html", // operational_role "driver" maps to sales_driver.html
  home: "index.html",
  login: "login.html"
};

// 🚫 V0.912: employees should NOT have "home/index" access
const EMPLOYEE_ALLOWED_EXTRA = {
  dispatcher: new Set(["history"]) // dispatcher employee can use history
};

function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  const op = (profile?.operational_role || "").toLowerCase().trim();

  if (raw === "owner" || raw === "manager") return raw;
  if (op) return op; // employee with operational_role set
  return raw; // employee role already equals screen role
}

function pageKeyFromPath() {
  const file = (
    (window.location.pathname || "").split("/").pop() || ""
  ).toLowerCase();

  const map = {
    "index.html": "home",
    "dispatcher.html": "dispatcher",
    "keymachine.html": "keymachine",
    "carwash.html": "carwash",
    "serviceadvisor.html": "serviceadvisor",
    "loancar.html": "loancar",
    "wallboard.html": "wallboard",
    "history.html": "history",
    "sales_manager.html": "sales_manager",
    "sales_driver.html": "sales_driver",
    "sales_history.html": "sales_history",
    "executive.html": "executive",
    "system_settings.html": "system_settings",
    "login.html": "login"
  };

  return map[file] || null;
}

function hardRedirect(toFile) {
  const base = window.location.pathname.includes("/")
    ? window.location.pathname.split("/").slice(0, -1).join("/") + "/"
    : "/";
  window.location.replace(base + toFile);
}

// Store name cache (in-memory, per session)
let storeNameCache = new Map();

/**
 * ✅ Important:
 * We keep BOTH:
 * - role-{effectiveRole}  (who the user is)
 * - role-{currentPage}    (what page this is, like role-history)
 */
function setBodyRoleClasses(effectiveRole, currentPage) {
  // Remove ALL known role classes (both hyphen and underscore variants)
  const known = [
    "role-dispatcher",
    "role-keymachine",
    "role-carwash",
    "role-wallboard",
    "role-serviceadvisor",
    "role-loancar",
    "role-owner",
    "role-manager",
    "role-history",
    "role-home",
    "role-login",
    "role-sales-manager",
    "role-sales_manager", // underscore variant
    "role-sales-driver",
    "role-sales_driver",   // underscore variant
    "role-sales-history",
    "role-sales_history",   // underscore variant
    "role-executive",
    "role-system_settings",
    "role-system-settings"  // hyphen variant
  ];

  known.forEach((c) => document.body.classList.remove(c));

  // Add role classes (preserve underscores in effectiveRole)
  if (effectiveRole) document.body.classList.add(`role-${effectiveRole}`);
  if (currentPage) document.body.classList.add(`role-${currentPage}`);
}

/**
 * Render screen context line at top of page
 * Format: "{STORE_NAME}  •  {SCREEN_LABEL}  •  {ROLE_LABEL}  •  {USER_LABEL}"
 */
async function renderScreenContext(profile, pageKey) {
  const contextEl = document.getElementById("screen-context");
  if (!contextEl) return;

  // Screen label mapping
  const screenLabels = {
    home: "Home",
    dispatcher: "Dispatcher",
    keymachine: "Key Machine",
    carwash: "Car Wash",
    serviceadvisor: "Service Advisor",
    loancar: "Loan Car",
    wallboard: "Wallboard",
    history: "History",
    sales_manager: "Sales Manager",
    sales_driver: "Sales Driver",
    sales_history: "Sales History",
    executive: "Executive Console",
    system_settings: "System Settings"
  };

  const screenLabel = screenLabels[pageKey] || pageKey || "Unknown";

  // Role label (pretty-case operational_role, fallback to role)
  const opRole = profile?.operational_role || "";
  const baseRole = profile?.role || "";
  const roleForLabel = opRole || baseRole;
  const roleLabel = roleForLabel
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  // User label (display_name if exists, else role label)
  const userLabel = profile?.display_name || roleLabel;

  // Store name (cached)
  let storeName = "Store";
  if (profile?.store_id) {
    if (storeNameCache.has(profile.store_id)) {
      storeName = storeNameCache.get(profile.store_id);
    } else {
      try {
        const { data, error } = await supabase
          .from("stores")
          .select("name")
          .eq("id", profile.store_id)
          .maybeSingle();

        if (!error && data?.name) {
          storeName = data.name;
          storeNameCache.set(profile.store_id, storeName);
        }
      } catch (err) {
        console.warn("Failed to load store name:", err);
      }
    }
  }

  // Build context string
  const contextParts = [storeName, screenLabel, roleLabel, userLabel].filter(Boolean);
  contextEl.textContent = contextParts.join("  •  ");
}

function routeForRole(role) {
  // owner/manager land on home/index (router) — they can go anywhere after
  if (role === "owner" || role === "manager") return ROUTES.home;

  // employees land on their operational page (single-screen terminals)
  if (ROUTES[role]) return ROUTES[role];

  // Unknown role: if authenticated, owner/gm can go to index, otherwise error
  // This should not happen in normal flow, but handle gracefully
  console.warn("Unknown role for routing:", role);
  return ROUTES.login;
}

/**
 * V0.912 Allowed pages matrix
 * - owner/manager: everything (including index/home)
 * - dispatcher employee: dispatcher + history (NOT home)
 * - other employees: only their one screen (NOT home)
 */
function isEmployeeAllowedOnPage(effectiveRole, currentPage) {
  if (!currentPage) return false;

  // 🚫 Employees can never access home/index
  if (currentPage === "home") return false;

  // Base rule: employees can access only their own operational page
  if (currentPage === effectiveRole) return true;

  // Exceptions: dispatcher gets history
  const extra = EMPLOYEE_ALLOWED_EXTRA[effectiveRole];
  if (extra && extra.has(currentPage)) return true;

  return false;
}

export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // ✅ Supabase v1 session check
  const session = supabase.auth.session();

  // LOGIN PAGE:
  // - if not logged in: allow login page to load
  // - if logged in: redirect to correct landing route
  if (currentPage === "login") {
    if (!session?.user) return { ok: true, page: "login" };

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("user_id, store_id, role, operational_role, display_name")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !profile) {
      console.error("Profile load failed:", error);
      await supabase.auth.signOut().catch(() => { });
      return { ok: true, page: "login" };
    }

    const effectiveRole = normalizeRole(profile);
    hardRedirect(routeForRole(effectiveRole));
    return { ok: false, reason: "already-logged-in" };
  }

  // PROTECTED PAGES:
  // Require session
  if (!session?.user) {
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-session" };
  }

  // Load profile
  const userId = session.user.id;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("user_id, store_id, role, operational_role, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !profile) {
    console.error("Profile load failed:", error);
    await supabase.auth.signOut().catch(() => { });
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-profile" };
  }

  const effectiveRole = normalizeRole(profile);

  // ✅ Apply BOTH user role + page role classes
  setBodyRoleClasses(effectiveRole, currentPage);

  // Render screen context (after auth success, before returning)
  await renderScreenContext(profile, currentPage);

  // Special case: sales_history is owner/manager ONLY (enforced here and in sales_history.js)
  if (currentPage === "sales_history") {
    if (effectiveRole !== "owner" && effectiveRole !== "manager") {
      hardRedirect(routeForRole(effectiveRole));
      return { ok: false, reason: "sales_history_restricted" };
    }
  }

  // Special case: executive is owner/manager ONLY (enforced here and in executive.js)
  if (currentPage === "executive") {
    if (effectiveRole !== "owner" && effectiveRole !== "manager") {
      hardRedirect(routeForRole(effectiveRole));
      return { ok: false, reason: "executive_restricted" };
    }
  }

  // Special case: system_settings is owner/manager ONLY (enforced here and in system_settings.js)
  if (currentPage === "system_settings") {
    if (effectiveRole !== "owner" && effectiveRole !== "manager") {
      hardRedirect(routeForRole(effectiveRole));
      return { ok: false, reason: "system_settings_restricted" };
    }
  }

  // Owner/Manager: allow everything
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    return { ok: true, session, profile, effectiveRole };
  }

  // Employee access rules (V0.912)
  const allowed = isEmployeeAllowedOnPage(effectiveRole, currentPage);

  if (!allowed) {
    hardRedirect(routeForRole(effectiveRole));
    return { ok: false, reason: "wrong-page" };
  }

  return { ok: true, session, profile, effectiveRole };
}

/**
 * Login helper for login.html
 * Expects:
 * - form#login-form
 * - input#login-email
 * - input#login-password
 * - div#login-error (optional)
 */
export function wireLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  const emailEl = document.getElementById("login-email");
  const passEl = document.getElementById("login-password");
  const errEl = document.getElementById("login-error");

  const setErr = (msg) => {
    if (!errEl) return;
    errEl.textContent = msg || "";
    errEl.style.display = msg ? "block" : "none";
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setErr("");

    const email = (emailEl?.value || "").trim();
    const password = passEl?.value || "";

    if (!email || !password) {
      setErr("Email + password required.");
      return;
    }

    // ✅ Supabase v1 sign-in
    const { user, session, error } = await supabase.auth.signIn({
      email,
      password
    });

    if (error || !session?.user || !user?.id) {
      setErr(error?.message || "Login failed.");
      return;
    }

    // Load profile to route correctly
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("role, operational_role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (pErr || !profile) {
      setErr("Profile missing. Contact admin.");
      return;
    }

    const effectiveRole = normalizeRole(profile);
    hardRedirect(routeForRole(effectiveRole));
  });
}

/**
 * Optional: sign out button wiring
 * - button#signout-btn
 */
export function wireSignOut() {
  const btn = document.getElementById("signout-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    await supabase.auth.signOut().catch(() => { });
    hardRedirect(ROUTES.login);
  });
}

function highlightActiveSidebarLink() {
  const page = document.body?.dataset?.page || "";
  document.querySelectorAll(".side-link").forEach(a => {
    a.classList.toggle("is-active", a.dataset.page === page);
  });
}
document.addEventListener("DOMContentLoaded", highlightActiveSidebarLink);
