// auth.js (Supabase v1 compatible)
import { supabase } from "./supabaseClient.js";

const ROUTES = {
  dispatcher: "dispatcher.html",
  keymachine: "keymachine.html",
  carwash: "carwash.html",
  serviceadvisor: "serviceadvisor.html",
  loancar: "loancar.html",
  wallboard: "wallboard.html",
  history: "history.html",
  home: "index.html",
  login: "login.html"
};

// Pages that should always be accessible once logged in (router pages / non-operational)
const ALWAYS_ALLOWED = new Set(["home"]);

// Owner/Manager can access everything. Employees are restricted.
function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  const op = (profile?.operational_role || "").toLowerCase().trim();

  if (raw === "owner" || raw === "manager") return raw;
  if (op) return op; // employee with operational_role set
  return raw; // employee role already equals screen role
}

function pageKeyFromPath() {
  const file = ((window.location.pathname || "").split("/").pop() || "").toLowerCase();
  const map = {
    "index.html": "home",
    "dispatcher.html": "dispatcher",
    "keymachine.html": "keymachine",
    "carwash.html": "carwash",
    "serviceadvisor.html": "serviceadvisor",
    "loancar.html": "loancar",
    "wallboard.html": "wallboard",
    "history.html": "history",
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

function setBodyRoleClass(role) {
  const classes = [
    "role-dispatcher",
    "role-keymachine",
    "role-carwash",
    "role-wallboard",
    "role-serviceadvisor",
    "role-loancar",
    "role-owner",
    "role-manager"
  ];
  classes.forEach((c) => document.body.classList.remove(c));
  if (role) document.body.classList.add(`role-${role}`);
}

function routeForRole(role) {
  // owner/manager land on home/index (router) — they can go anywhere after
  if (role === "owner" || role === "manager") return ROUTES.home;

  // employees land on their operational page
  if (ROUTES[role]) return ROUTES[role];

  // fallback
  return ROUTES.login;
}

/**
 * Allowed pages matrix (V1)
 * - owner/manager: everything
 * - dispatcher employee: dispatcher + history (+ home)
 * - other employees: only their one screen (+ home)
 */
function isEmployeeAllowedOnPage(effectiveRole, currentPage) {
  if (!currentPage) return false;
  if (ALWAYS_ALLOWED.has(currentPage)) return true;

  // Dispatcher employee gets History too
  if (effectiveRole === "dispatcher") {
    return currentPage === "dispatcher" || currentPage === "history";
  }

  // Everyone else: only their own page
  return currentPage === effectiveRole;
}

export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // Supabase v1 session check
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
      // session exists but profile broken -> sign out and stay on login
      console.error("Profile load failed:", error);
      await supabase.auth.signOut().catch(() => {});
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
    await supabase.auth.signOut().catch(() => {});
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-profile" };
  }

  const effectiveRole = normalizeRole(profile);

  // Apply CSS role class to body (for your .dispatcher-only etc.)
  setBodyRoleClass(effectiveRole);

  // Owner/Manager: allow everything
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    return { ok: true, session, profile, effectiveRole };
  }

  // Employee access rules
  const allowed = isEmployeeAllowedOnPage(effectiveRole, currentPage);

  if (!allowed) {
    // If they hit the wrong page, send them to their landing screen.
    // Dispatcher employees still land on dispatcher, not history.
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

    // Supabase v1 sign-in
    const { user, session, error } = await supabase.auth.signIn({ email, password });

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
    await supabase.auth.signOut().catch(() => {});
    hardRedirect(ROUTES.login);
  });
}
