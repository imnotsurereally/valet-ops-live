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

// pages owner/manager only
const OWNER_MANAGER_ONLY = new Set(["history"]);

function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  const op = (profile?.operational_role || "").toLowerCase().trim();

  if (raw === "owner" || raw === "manager") return raw;
  if (op) return op;
  return raw; // already a screen role
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

function hardRedirect(toFile) {
  const base = window.location.pathname.includes("/")
    ? window.location.pathname.split("/").slice(0, -1).join("/") + "/"
    : "/";
  window.location.replace(base + toFile);
}

function routeForRole(role) {
  // Owner/manager land on home so they can choose any screen + future admin pages
  if (role === "owner" || role === "manager") return ROUTES.home;

  if (ROUTES[role]) return ROUTES[role];
  return ROUTES.login;
}

/**
 * Call this at the top of every protected page (including index if you want it protected).
 * Example in app.js: await requireAuth({ page: pageKeyFromPath() })
 */
export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // Login page: if already logged in, bounce to correct landing.
  if (currentPage === "login") {
    const session = supabase.auth.session();
    if (session?.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_id, store_id, role, operational_role, display_name")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const effectiveRole = normalizeRole(profile);
      hardRedirect(routeForRole(effectiveRole));
      return { ok: false, reason: "already-logged-in" };
    }
    return { ok: true, page: "login" };
  }

  // Protected pages: require session
  const session = supabase.auth.session();
  if (!session?.user) {
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-session" };
  }

  const userId = session.user.id;

  // Load profile
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
  setBodyRoleClass(effectiveRole);

  // Owner/manager: can access any page in V1 (plus exclusive pages later)
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    // optional: block login page already handled above
    return { ok: true, session, profile, effectiveRole };
  }

  // Employees: block owner/manager-only pages
  if (OWNER_MANAGER_ONLY.has(currentPage)) {
    hardRedirect(routeForRole(effectiveRole));
    return { ok: false, reason: "owner-manager-only" };
  }

  // Employees: allowed only their screen
  const allowedFile = routeForRole(effectiveRole);

  // If they visit wrong page, push them back
  const allowedKey = Object.keys(ROUTES).find((k) => ROUTES[k] === allowedFile);
  if (currentPage && allowedKey && currentPage !== allowedKey) {
    hardRedirect(allowedFile);
    return { ok: false, reason: "wrong-page" };
  }

  return { ok: true, session, profile, effectiveRole };
}

/**
 * Login wiring for login.html
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
