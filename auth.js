// auth.js (Supabase JS v1 compatible)
import { supabase } from "./supabaseClient.js";

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
const OWNER_MANAGER_ONLY = new Set(["history"]);

function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  // operational_role might NOT exist in your schema (you hit that earlier), so ignore it safely
  const op = (profile?.operational_role || "").toLowerCase().trim();

  if (raw === "owner" || raw === "manager") return raw;
  if (op) return op; // if you add it later
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
  if (role) document.body.classList.add(`role-${role}`);
}

function routeForRole(role) {
  // owner/manager can go anywhere; default landing is dispatcher
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

async function loadProfile(userId) {
  // IMPORTANT: operational_role might not exist in your table.
  // So we only select fields we know exist. Add operational_role later if/when you add the column.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("user_id, store_id, role, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  return { profile, error };
}

/**
 * Call this at the top of EVERY protected page.
 * Example: await requireAuth({ page: "dispatcher" });
 */
export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // Supabase v1 session
  const session = supabase.auth.session();

  // LOGIN PAGE: if already logged in, route them away
  if (currentPage === "login") {
    if (session?.user) {
      const userId = session.user.id;
      const { profile, error } = await loadProfile(userId);

      if (!error && profile) {
        const effectiveRole = normalizeRole(profile);
        const dest = routeForRole(effectiveRole);
        hardRedirect(dest);
        return { ok: true, session, profile, effectiveRole };
      }
    }
    return { ok: true, page: "login" };
  }

  // Protected pages require session
  if (!session?.user) {
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-session" };
  }

  const userId = session.user.id;

  const { profile, error } = await loadProfile(userId);

  if (error || !profile) {
    console.error("Profile load failed:", error);
    await supabase.auth.signOut().catch(() => {});
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-profile" };
  }

  const effectiveRole = normalizeRole(profile);
  setBodyRoleClass(effectiveRole);

  // owner/manager can access everything in V1
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    return { ok: true, session, profile, effectiveRole };
  }

  // Employees: only their one screen
  const allowedFile = routeForRole(effectiveRole);
  const allowedKey = Object.keys(ROUTES).find((k) => ROUTES[k] === allowedFile);

  // block owner/manager-only pages
  if (OWNER_MANAGER_ONLY.has(currentPage)) {
    hardRedirect(allowedFile);
    return { ok: false, reason: "owner-manager-only" };
  }

  // if user hits wrong page, redirect to their allowed page
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

    // ✅ Supabase v1 sign-in API:
    const { user, session, error } = await supabase.auth.signIn({ email, password });

    if (error || !session?.user) {
      setErr(error?.message || "Login failed.");
      return;
    }

    // load profile to route correctly
    const userId = session.user.id;
    const { profile } = await loadProfile(userId);

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
