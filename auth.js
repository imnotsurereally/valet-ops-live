// auth.js (SAFE + BORING VERSION)
// Does NOT touch <body> classes. HTML controls screen behavior via body class.

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

// owner/manager-only pages
const OWNER_MANAGER_ONLY = new Set(["history"]);

function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  const op = (profile?.operational_role || "").toLowerCase().trim();
  if (raw === "owner" || raw === "manager") return raw;
  if (op) return op;
  return raw;
}

function pageKeyFromPath() {
  const file = ((window.location.pathname || "").split("/").pop() || "").toLowerCase();
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

function routeForEmployeeRole(role) {
  if (ROUTES[role]) return ROUTES[role];
  return ROUTES.login;
}

export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // login does not require gate
  if (currentPage === "login") return { ok: true, page: "login" };

  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.user) {
    hardRedirect(ROUTES.login);
    return { ok: false, reason: "no-session" };
  }

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

  // owner/manager can access any page (and future owner pages)
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    return { ok: true, session, profile, effectiveRole };
  }

  // employee rules: one page only
  const allowedFile = routeForEmployeeRole(effectiveRole);
  const allowedKey = Object.keys(ROUTES).find((k) => ROUTES[k] === allowedFile);

  // block owner/manager-only pages
  if (OWNER_MANAGER_ONLY.has(currentPage)) {
    hardRedirect(allowedFile);
    return { ok: false, reason: "owner-manager-only" };
  }

  // redirect if wrong page
  if (currentPage && allowedKey && currentPage !== allowedKey) {
    hardRedirect(allowedFile);
    return { ok: false, reason: "wrong-page" };
  }

  return { ok: true, session, profile, effectiveRole };
}

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

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

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

    // owner/manager: go to index so you can choose screens
    if (effectiveRole === "owner" || effectiveRole === "manager") {
      hardRedirect(ROUTES.index);
      return;
    }

    // employee: go to their locked screen
    hardRedirect(routeForEmployeeRole(effectiveRole));
  });
}

export function wireSignOut() {
  const btn = document.getElementById("signout-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    await supabase.auth.signOut().catch(() => {});
    hardRedirect(ROUTES.login);
  });
}
