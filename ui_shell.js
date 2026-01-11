// ui_shell.js — shared shell: sidebar + topbar + density + nav RBAC + active link + icons
export const ICONS = {
  dispatcher: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 2l4 8-4 12-4-12 4-8z"/><path d="M12 10l6-2-6 2-6-2 6 2z"/></svg>`,
  keymachine: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M7 14a5 5 0 1 1 4.6 3H10l-2 2H6v-2l2-2h1"/><path d="M15 11h2"/></svg>`,
  carwash: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12z"/></svg>`,
  wallboard: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`,
  history: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 8v5l3 2"/><path d="M3 12a9 9 0 1 0 3-6"/><path d="M3 3v5h5"/></svg>`,
  sales_manager: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M8 7V5h8v2"/><path d="M4 7h16v12H4z"/><path d="M4 12h16"/></svg>`,
  sales_driver: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M5 12h12"/><path d="M13 6l6 6-6 6"/></svg>`,
  sales_history: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 8v5l3 2"/><path d="M3 12a9 9 0 1 0 3-6"/><path d="M3 3v5h5"/></svg>`,
  executive: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M4 16l6-6 4 4 6-8"/><path d="M20 6v6h-6"/></svg>`,
  settings: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a8 8 0 0 0 .1-2l2-1.2-2-3.5-2.3.7a7.6 7.6 0 0 0-1.7-1L15 4h-6l-.5 3a7.6 7.6 0 0 0-1.7 1L4.5 7.3l-2 3.5 2 1.2a8 8 0 0 0 .1 2l-2 1.2 2 3.5 2.3-.7a7.6 7.6 0 0 0 1.7 1L9 20h6l.5-3a7.6 7.6 0 0 0 1.7-1l2.3.7 2-3.5-2-1.2z"/></svg>`,
  home: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M6 10v11h12V10"/></svg>`
};

export function applyDensityFromStorage() {
  const saved = localStorage.getItem("ui_density") || "dense";
  document.documentElement.dataset.density = saved;
}

export function setDensity(mode) {
  const m = (mode === "comfort") ? "comfort" : "dense";
  localStorage.setItem("ui_density", m);
  document.documentElement.dataset.density = m;
}

export function wireShellInteractions({ profile, pageKey }) {
  // Sidebar expand: REAL expand (grid column change) via JS
  const shell = document.querySelector(".app-shell");
  const nav = document.querySelector(".side-nav");
  if (shell && nav) {
    nav.addEventListener("mouseenter", () => shell.classList.add("nav-expanded"));
    nav.addEventListener("mouseleave", () => shell.classList.remove("nav-expanded"));
  }

  // Active link
  document.querySelectorAll(".side-link").forEach(a => {
    a.classList.toggle("is-active", a.dataset.page === pageKey);
  });

  // Role-based nav hide
  const role = profile?.operational_role || profile?.role || "";
  const isOwner = role === "owner" || role === "manager" || role === "gm" || role === "general_manager";
  const isDispatcher = role === "dispatcher";
  const isSalesMgr = role === "sales_manager";
  const isSalesDriver = role === "sales_driver";

  // Default: hide owner-only pages unless owner/manager
  document.querySelectorAll('[data-owner-only="1"]').forEach(el => {
    el.style.display = isOwner ? "" : "none";
  });

  // Sales access
  document.querySelectorAll('[data-sales-only="1"]').forEach(el => {
    el.style.display = (isOwner || isSalesMgr || isSalesDriver) ? "" : "none";
  });

  // Service access (keep visible for now; auth.js already redirects)
  // (Optional: tighten later per role matrix)

  // Topbar identity line
  const who = (profile?.display_name || "").trim() || (role ? role.toUpperCase() : "USER");
  const store = (profile?.store_name || "").trim();
  const el = document.getElementById("topbar-who");
  if (el) el.textContent = store ? `${store} • ${who}` : who;

  // Density toggle buttons
  const denseBtn = document.getElementById("density-dense");
  const comfortBtn = document.getElementById("density-comfort");
  if (denseBtn && comfortBtn) {
    const cur = document.documentElement.dataset.density || "dense";
    denseBtn.classList.toggle("is-active", cur === "dense");
    comfortBtn.classList.toggle("is-active", cur === "comfort");
    denseBtn.onclick = () => { setDensity("dense"); denseBtn.classList.add("is-active"); comfortBtn.classList.remove("is-active"); };
    comfortBtn.onclick = () => { setDensity("comfort"); comfortBtn.classList.add("is-active"); denseBtn.classList.remove("is-active"); };
  }
}

export function injectSvgIcons() {
  document.querySelectorAll(".side-link").forEach(a => {
    const key = a.dataset.page;
    const iconWrap = a.querySelector(".side-link__icon");
    if (!iconWrap) return;
    const svg = ICONS[key];
    if (svg) iconWrap.innerHTML = svg;
  });
}

/* =========================================================
   SCREEN CONTEXT INJECTOR (SAFE)
   ========================================================= */

export function injectScreenContext({ store, screen, role, user }) {
  const el = document.getElementById("screen-context");
  if (!el) return;
  el.textContent = `${store} • ${screen} • ${role} • ${user || role}`;
}
