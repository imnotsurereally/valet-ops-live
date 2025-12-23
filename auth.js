// auth.js
import { supabase } from "./supabaseClient.js";

/**
 * V1 Auth Gate
 * - Requires Supabase session
 * - Loads profile (role/store)
 * - Adds role class to <body> for CSS gating
 * - Redirects user to their allowed screen if they hit the wrong page
 *
 * Profiles assumptions (flexible):
 * - profiles.role may be: owner|manager|dispatcher|keymachine|carwash|serviceadvisor|loancar|wallboard
 * - OR profiles.role is owner|manager|employee AND profiles.operational_role holds the screen role
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

// pages that are always owner/manager only in V1
const OWNER_MANAGER_ONLY = new Set(["history"]); // add "settings" later when you have settings.html

function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  const op = (profile?.operational_role || "").toLowerCase().trim();

  // if owner/manager, keep it
  if (raw === "owner" || raw === "manager") return raw;

  // if operational_role exists, use it
  if (op) return op;

  // otherwise role is already a screen role
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
    "index.html": "dispatcher" // if someone lands on index, we treat it like dispatcher route
  };

  return map[file] || null;
}

function setBodyRoleClass(role) {
  // wipe known role classes
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

  // apply
  if (!role) return;
  document.body.classList.add(`role-${role}`);
}

function routeForRole(role) {
  // owner/manager default landing:
  if (role === "owner" || role === "manager") return ROUTES.dispatcher;

  // employee screen roles
  if (ROUTES[role]) return ROUTES[role];

  // fallback
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

  // 1) require session
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.user) {
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-session" };
  }

  const userId = session.user.id;

  // 2) load profile
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("user_id, store_id, role, operational_role, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !profile) {
    // If profile missing, treat as locked out
    console.error("Profile load failed:", error);
    await supabase.auth.signOut().catch(() => {});
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-profile" };
  }

  const effectiveRole = normalizeRole(profile);

  // 3) apply CSS role class
  setBodyRoleClass(effectiveRole);

  // 4) page access rules
  // owner/manager can access everything in V1 (except we can enforce settings later)
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    // owner/manager still blocked from nothing here
    return { ok: true, session, profile, effectiveRole };
  }

  // employees: one allowed page only (their role)
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

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data?.session?.user) {
      setErr(error?.message || "Login failed.");
      return;
    }

    // load profile to route correctly
    const userId = data.session.user.id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, operational_role")
      .eq("user_id", userId)
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
