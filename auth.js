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

/**
 * ✅ Important:
 * We keep BOTH:
 * - role-{effectiveRole}  (who the user is)
 * - role-{currentPage}    (what page this is, like role-history)
 */
function setBodyRoleClasses(effectiveRole, currentPage) {
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
    "role-sales-driver"
  ];

  known.forEach((c) => document.body.classList.remove(c));

  if (effectiveRole) document.body.classList.add(`role-${effectiveRole}`);
  if (currentPage) document.body.classList.add(`role-${currentPage}`);
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
