// auth.js
import { supabase } from "./supabaseClient.js";

const ROUTES = {
  index: "index.html",
  dispatcher: "dispatcher.html",
  keymachine: "keymachine.html",
  carwash: "carwash.html",
  serviceadvisor: "serviceadvisor.html",
  loancar: "loancar.html",
  wallboard: "wallboard.html",
  history: "history.html",
  login: "login.html"
};

// owner/manager only pages (V1)
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
    "index.html": "index",
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

function routeForRole(role) {
  // employee screen roles
  if (ROUTES[role]) return ROUTES[role];
  return ROUTES.login;
}

function rememberLastPage() {
  const key = pageKeyFromPath();
  if (!key) return;
  if (key === "login") return;
  try {
    localStorage.setItem("lastPage", key);
  } catch {}
}

function getLastPageFileFallback() {
  try {
    const last = (localStorage.getItem("lastPage") || "").toLowerCase().trim();
    if (last && ROUTES[last]) return ROUTES[last];
  } catch {}
  return ROUTES.index;
}

function setBodyRoleClassForScreen(screenKey) {
  const classes = [
    "role-dispatcher",
    "role-keymachine",
    "role-carwash",
    "role-wallboard",
    "role-serviceadvisor",
    "role-loancar"
  ];
  classes.forEach((c) => document.body.classList.remove(c));

  if (!screenKey) return;
  document.body.classList.add(`role-${screenKey}`);
}

/**
 * Auth gate:
 * - employees: redirected to ONLY their allowed page
 * - owner/manager: allowed anywhere (+ owner-only pages), and we set body role to the current page screen
 */
export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // login page doesn't require gate
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
    console.error("Profile load failed:", error);
    await supabase.auth.signOut().catch(() => {});
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-profile" };
  }

  const effectiveRole = normalizeRole(profile);

  // Save last page (for return-after-login)
  rememberLastPage();

  // OWNER/MANAGER: allow all pages, but set UI role based on the page they are viewing
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    // history is fine for owner/manager; anything else is fine too.
    // Set screen role class so app.js behaves correctly on each page:
    // - index page doesn't run tables anyway, but safe
    if (currentPage && currentPage !== "login" && currentPage !== "index") {
      setBodyRoleClassForScreen(currentPage);
    }
    return { ok: true, session, profile, effectiveRole };
  }

  // EMPLOYEES: enforce access to one page only
  const allowedFile = routeForRole(effectiveRole);
  const allowedKey = Object.keys(ROUTES).find((k) => ROUTES[k] === allowedFile);

  // block owner/manager-only pages
  if (OWNER_MANAGER_ONLY.has(currentPage)) {
    hardRedirect(allowedFile);
    return { ok: false, reason: "owner-manager-only" };
  }

  // wrong page -> redirect to their allowed page
  if (currentPage && allowedKey && currentPage !== allowedKey) {
    hardRedirect(allowedFile);
    return { ok: false, reason: "wrong-page" };
  }

  // set screen class for employee
  if (currentPage && currentPage !== "index") {
    setBodyRoleClassForScreen(currentPage);
  }

  return { ok: true, session, profile, effectiveRole };
}

/**
 * Login helper for login.html
 * - redirects owner/manager to last page (or index)
 * - redirects employees to their allowed page
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

    // owner/manager: go to last page or index
    if (effectiveRole === "owner" || effectiveRole === "manager") {
      hardRedirect(getLastPageFileFallback());
      return;
    }

    // employee: go to their allowed screen
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
