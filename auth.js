// auth.js (Supabase v1)
// Purpose: hard auth gate + role-to-screen routing + store context loader

import { supabase } from "./supabaseClient.js";

/* --------- PAGE MAP --------- */
const ROLE_TO_PAGE = {
  dispatcher: "dispatcher.html",
  keymachine: "keymachine.html",
  carwash: "carwash.html",
  wallboard: "wallboard.html",
  serviceadvisor: "serviceadvisor.html",
  loancar: "loancar.html",
  history: "history.html",
  settings: "settings.html"
};

const PAGE_TO_ALLOWED_ROLES = {
  "dispatcher.html": ["dispatcher", "owner", "manager"],
  "keymachine.html": ["keymachine", "owner", "manager"],
  "carwash.html": ["carwash", "owner", "manager"],
  "wallboard.html": ["wallboard", "owner", "manager"],
  "serviceadvisor.html": ["serviceadvisor", "owner", "manager"],
  "loancar.html": ["loancar", "owner", "manager"],
  "history.html": ["owner", "manager"], // V1: keep archive + exports restricted
  "settings.html": ["owner", "manager"]
};

function currentPageName() {
  const p = (location.pathname || "").split("/").pop();
  return p || "dispatcher.html";
}

function inferPageFromBodyClass() {
  const b = document.body;
  if (!b) return currentPageName();
  if (b.classList.contains("role-dispatcher")) return "dispatcher.html";
  if (b.classList.contains("role-keymachine")) return "keymachine.html";
  if (b.classList.contains("role-carwash")) return "carwash.html";
  if (b.classList.contains("role-wallboard")) return "wallboard.html";
  if (b.classList.contains("role-serviceadvisor")) return "serviceadvisor.html";
  if (b.classList.contains("role-loancar")) return "loancar.html";
  // history/settings pages should not rely on body class
  return currentPageName();
}

function normalizeOperationalRole(profile) {
  // We support multiple schema variants safely:
  // - profile.operational_role
  // - profile.app_role
  // - profile.screen_role
  // - profile.role (if it’s actually a screen role)
  const candidate =
    profile?.operational_role ||
    profile?.app_role ||
    profile?.screen_role ||
    profile?.role ||
    null;

  const allowed = new Set([
    "dispatcher",
    "keymachine",
    "carwash",
    "wallboard",
    "serviceadvisor",
    "loancar"
  ]);

  if (typeof candidate === "string" && allowed.has(candidate)) return candidate;
  return null;
}

function isOwnerOrManager(profile) {
  const r = String(profile?.role || "").toLowerCase();
  return r === "owner" || r === "manager";
}

function bestLandingPage(profile) {
  if (!profile) return "login.html";
  if (isOwnerOrManager(profile)) return "dispatcher.html"; // V1 default landing
  const op = normalizeOperationalRole(profile) || "dispatcher";
  return ROLE_TO_PAGE[op] || "dispatcher.html";
}

async function fetchMyProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data;
}

async function fetchStoreSettings(storeId) {
  if (!storeId) return null;
  const { data } = await supabase
    .from("store_settings")
    .select("*")
    .eq("store_id", storeId)
    .single();

  return data || null;
}

/* --------- PUBLIC API --------- */

export async function requireAuthGate() {
  const page = inferPageFromBodyClass();
  const isLogin = page === "login.html";

  const session = supabase.auth.session();
  const user = session?.user || null;

  if (!user) {
    if (!isLogin) location.href = "login.html";
    return null;
  }

  // Logged in but on login page -> bounce to landing
  if (isLogin) {
    // try to use profile to land correctly, otherwise fallback
    try {
      const profile = await fetchMyProfile(user.id);
      location.href = bestLandingPage(profile);
      return null;
    } catch {
      location.href = "dispatcher.html";
      return null;
    }
  }

  // Load profile (hard requirement)
  let profile = null;
  try {
    profile = await fetchMyProfile(user.id);
  } catch (e) {
    console.error("Profile missing or fetch failed:", e);
    alert(
      "Login OK but profile not found. Ask admin to create your profile row."
    );
    // safest: sign out to avoid partial access
    await supabase.auth.signOut().catch(() => {});
    location.href = "login.html";
    return null;
  }

  const allowed = PAGE_TO_ALLOWED_ROLES[page] || null;

  // Owner/manager: can access any V1 page; employee: locked to their operational screen only
  if (allowed) {
    if (isOwnerOrManager(profile)) {
      // allowed anywhere
    } else {
      const opRole = normalizeOperationalRole(profile);
      if (!opRole) {
        alert(
          "Your account is missing an operational role (dispatcher/keymachine/etc)."
        );
        await supabase.auth.signOut().catch(() => {});
        location.href = "login.html";
        return null;
      }
      if (!allowed.includes(opRole)) {
        location.href = ROLE_TO_PAGE[opRole] || "dispatcher.html";
        return null;
      }
    }
  }

  // Store context (optional but used by app.js)
  const storeId = profile.store_id || null;
  const storeSettings = await fetchStoreSettings(storeId);

  // Make context globally available (simple V1)
  window.__AUTH = {
    user,
    profile,
    storeId,
    storeSettings
  };

  return window.__AUTH;
}

export async function signInWithEmail(email, password) {
  const { error } = await supabase.auth.signIn({ email, password });
  if (error) throw error;

  // After sign-in, redirect using profile
  const session = supabase.auth.session();
  const user = session?.user;
  if (!user) {
    location.href = "dispatcher.html";
    return;
  }
  const profile = await fetchMyProfile(user.id);
  location.href = bestLandingPage(profile);
}

export async function signOutNow() {
  await supabase.auth.signOut();
  location.href = "login.html";
}

/* Convenience helpers */
export function getAuth() {
  return window.__AUTH || null;
}
export function isPrivileged() {
  const p = window.__AUTH?.profile;
  return isOwnerOrManager(p);
}
