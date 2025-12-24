// auth.js (Supabase v1 compatible - NO getSession / NO signInWithPassword)
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

const OWNER_MANAGER_ONLY = new Set(["history"]);

function normalizeRole(profile) {
  const raw = (profile?.role || "").toLowerCase().trim();
  const op = (profile?.operational_role || "").toLowerCase().trim();
  if (raw === "owner" || raw === "manager") return raw;
  if (op) return op;
  return raw;
}

function hardRedirect(toFile) {
  const base = window.location.pathname.includes("/")
    ? window.location.pathname.split("/").slice(0, -1).join("/") + "/"
    : "/";
  window.location.replace(base + toFile);
}

function routeForRole(role) {
  // owner/manager should be able to go anywhere -> land on home/index
  if (role === "owner" || role === "manager") return ROUTES.home;
  if (ROUTES[role]) return ROUTES[role];
  return ROUTES.login;
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

export async function requireAuth({ page } = {}) {
  const currentPage = page || pageKeyFromPath();

  // ✅ Supabase v1 session check
  const session = supabase.auth.session();

  // LOGIN page behavior
  if (currentPage === "login") {
    if (!session?.user) return { ok: true, page: "login" };

    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, store_id, role, operational_role, display_name")
      .eq("user_id", session.user.id)
      .maybeSingle();

    const effectiveRole = normalizeRole(profile);
    hardRedirect(routeForRole(effectiveRole));
    return { ok: false, reason: "already-logged-in" };
  }

  // Protected pages: require session
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
  setBodyRoleClass(effectiveRole);

  // owner/manager can access anything
  if (effectiveRole === "owner" || effectiveRole === "manager") {
    return { ok: true, session, profile, effectiveRole };
  }

  // employees: block owner/manager pages
  if (OWNER_MANAGER_ONLY.has(currentPage)) {
    hardRedirect(routeForRole(effectiveRole));
    return { ok: false, reason: "owner-manager-only" };
  }

  // employees: only their own screen
  const allowedFile = routeForRole(effectiveRole);
  const allowedKey = Object.keys(ROUTES).find((k) => ROUTES[k] === allowedFile);
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

    // ✅ Supabase v1 sign-in
    const { user, session, error } = await supabase.auth.signIn({ email, password });

    if (error || !session?.user || !user?.id) {
      setErr(error?.message || "Login failed.");
      return;
    }

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

export function wireSignOut() {
  const btn = document.getElementById("signout-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    await supabase.auth.signOut().catch(() => {});
    hardRedirect(ROUTES.login);
  });
}
