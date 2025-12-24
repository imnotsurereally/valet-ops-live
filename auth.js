// auth.js (Supabase v1 compatible)
import { supabase } from "./supabaseClient.js";

/**
 * V1 Auth Gate (Supabase JS v1)
 * - Requires Supabase session
 * - Loads profile (role/store)
 * - Adds role class to <body> for CSS gating
 * - Redirects user to their allowed screen if they hit the wrong page
 */

const ROUTES = {
  dispatcher: "dispatcher.html",
  keymachine: "keymachine.html",
  carwash: "carwash.html",
  serviceadvisor: "serviceadvisor.html",
  loancar: "loancar.html",
  wallboard: "wallboard.html",
  history: "history.html",
  login: "login.html"
};

const OWNER_MANAGER_ONLY = new Set(["history"]);

function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  const op = (profile?.operational_role || "").toLowerCase().trim();
  if (raw === "owner" || raw === "manager") return raw;
  if (op) return op;
  return raw;
}

function pageKeyFromPath() {
  const path = (window.location.pathname || "").split("/").pop() || "";
  const file = path.toLowerCase();

  const map = {
    "dispatcher.html": "dispatcher",
    "keymachine.html": "keymachine",
    "carwash.html": "carwash",
    "serviceadvisor.html": "serviceadvisor",
    "loancar.html": "loancar",
    "wallboard.html": "wallboard",
    "history.html": "history",
    "login.html": "login",
    "index.html": "dispatcher"
  };

  return map[file] || null;
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
  if (!role) return;
  document.body.classList.add(`role-${role}`);
}

function routeForRole(role) {
  if (role === "owner" || role === "manager") return ROUTES.dispatcher;
  if (ROUTES[role]) return ROUTES[role];
  return ROUTES.login;
}

function hardRedirect(toFile) {
  const base = window.location.pathname.includes("/")
    ? window.location.pathname.split("/").slice(0, -1).join("/") + "/"
    : "/";
  window.location.replace(base + toFile);
}

/**
 * Call this at the top of EVERY protected page.
 * Example: await requireAuth({ page: "dispatcher" });
 */
export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // login page doesn't require auth gate
  if (currentPage === "login") return { ok: true, page: "login" };

  // Supabase v1 session
  const session = supabase.auth.session();
  if (!session?.user) {
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-session" };
  }

  const userId = session.user.id;

  // load profile
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

  // apply CSS role class
  setBodyRoleClass(effectiveRole);

  // owner/manager can access everything in V1
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    return { ok: true, session, profile, effectiveRole };
  }

  const allowedFile = routeForRole(effectiveRole);
  const allowedKey = Object.keys(ROUTES).find((k) => ROUTES[k] === allowedFile);

  // block owner/manager-only pages
  if (OWNER_MANAGER_ONLY.has(currentPage)) {
    hardRedirect(allowedFile);
    return { ok: false, reason: "owner-manager-only" };
  }

  // if user hits wrong page, redirect to their one page
  if (currentPage && allowedKey && currentPage !== allowedKey) {
    hardRedirect(allowedFile);
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
    const { user, error } = await supabase.auth.signIn({ email, password });

    if (error || !user) {
      setErr(error?.message || "Login failed.");
      return;
    }

    // fetch profile to route correctly
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, operational_role")
      .eq("user_id", user.id)
      .maybeSingle();

    const effectiveRole = normalizeRole(profile);
    const dest = routeForRole(effectiveRole);
    hardRedirect(dest);
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
