// ui_shell.js — shared shell: sidebar + topbar + nav RBAC + active link + icons
export const ICONS = {
  dispatcher: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 2l4 8-4 12-4-12 4-8z"/><path d="M12 10l6-2-6 2-6-2 6 2z"/></svg>`,
  keymachine: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M7 14a5 5 0 1 1 4.6 3H10l-2 2H6v-2l2-2h1"/><path d="M15 11h2"/></svg>`,
  carwash: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12z"/></svg>`,
  wallboard: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`,
  history: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 8v5l3 2"/><path d="M3 12a9 9 0 1 0 3-6"/><path d="M3 3v5h5"/></svg>`,
  customersms: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/><path d="M7 9h10M7 13h6"/></svg>`,
  sales_manager: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M8 7V5h8v2"/><path d="M4 7h16v12H4z"/><path d="M4 12h16"/></svg>`,
  sales_driver: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M5 12h12M13 6l6 6-6 6"/></svg>`,
  sales_history: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 8v5l3 2"/><path d="M3 12a9 9 0 1 0 3-6"/><path d="M3 3v5h5"/></svg>`,
  executive: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M4 16l6-6 4 4 6-8"/><path d="M20 6v6h-6"/></svg>`,
  settings: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a8 8 0 0 0 .1-2l2-1.2-2-3.5-2.3.7a7.6 7.6 0 0 0-1.7-1L15 4h-6l-.5 3a7.6 7.6 0 0 0-1.7 1L4.5 7.3l-2 3.5 2 1.2a8 8 0 0 0 .1 2l-2 1.2 2 3.5 2.3-.7a7.6 7.6 0 0 0 1.7 1L9 20h6l.5-3a7.6 7.6 0 0 0 1.7-1l2.3.7 2-3.5-2-1.2z"/></svg>`,
  home: `<svg class="sb-ico" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M6 10v11h12V10"/></svg>`
};

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

  // SMS access (dispatcher + owner/manager)
  document.querySelectorAll('[data-sms-only="1"]').forEach(el => {
    el.style.display = (isOwner || isDispatcher) ? "" : "none";
  });

  // Service access (keep visible for now; auth.js already redirects)
  // (Optional: tighten later per role matrix)

  // Topbar identity line - Single canonical form: "Optima Dealer Services · <Store Name> · <Role>"
  const roleDisplay = (profile?.operational_role || profile?.role || "").toLowerCase().trim();
  const roleFormatted = roleDisplay ? roleDisplay.charAt(0).toUpperCase() + roleDisplay.slice(1).replace(/_/g, " ") : "";
  const store = (profile?.store_name || "").trim();
  const el = document.getElementById("topbar-who");
  if (el) {
    const parts = [];
    if (store) parts.push(store);
    if (roleFormatted) parts.push(roleFormatted);
    el.textContent = parts.length > 0 ? parts.join(" · ") : "";
  }

  // Update topbar title to "Optima Dealer Services"
  const topbarTitle = document.querySelector(".topbar__title");
  if (topbarTitle) {
    topbarTitle.textContent = "Optima Dealer Services";
  }

  // Update sidebar brand text to "Optima Dealer Services"
  const sidebarBrandText = document.querySelector(".side-nav__brand-text");
  if (sidebarBrandText) {
    sidebarBrandText.textContent = "Optima Dealer Services";
  }

  // Ensure logo appears on all pages
  ensureLogoOnAllPages();

  // Wire theme toggle
  wireThemeToggle();
  
  // Apply theme from storage on load
  applyThemeFromStorage();
  
  // Inject Customer SMS link for dispatcher + owner/manager
  injectCustomerSmsLink(isOwner, isDispatcher);
}

function injectCustomerSmsLink(isOwner, isDispatcher) {
  // Only show for dispatcher + owner/manager
  if (!isOwner && !isDispatcher) return;
  
  // Find the Service group
  const serviceGroup = document.querySelector('.side-nav__group');
  if (!serviceGroup) return;
  
  // Check if link already exists
  if (document.querySelector('.side-link[data-page="customersms"]')) return;
  
  // Find the History link to insert after
  const historyLink = document.querySelector('.side-link[data-page="history"]');
  if (!historyLink) return;
  
  // Create Customer SMS link
  const smsLink = document.createElement('a');
  smsLink.className = 'side-link';
  smsLink.href = 'customersms.html';
  smsLink.setAttribute('data-page', 'customersms');
  smsLink.setAttribute('data-sms-only', '1');
  smsLink.innerHTML = `
    <div class="side-link__icon">
      ${ICONS.customersms}
    </div>
    <div class="side-link__label">Customer SMS</div>
  `;
  
  // Insert after History link
  historyLink.parentNode.insertBefore(smsLink, historyLink.nextSibling);
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

/* ========== THEME SYSTEM ========== */

export function applyThemeFromStorage() {
  let theme = "dark";
  try {
    const stored = localStorage.getItem("ui_theme");
    if (stored === "light" || stored === "dark") {
      theme = stored;
    }
  } catch (e) {
    // Default to dark
  }
  // Set on documentElement immediately
  document.documentElement.setAttribute("data-theme", theme);
  setTheme(theme);
}

// Apply theme on DOMContentLoaded (before any rendering)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyThemeFromStorage);
} else {
  applyThemeFromStorage();
}

export function setTheme(mode) {
  if (mode !== "dark" && mode !== "light") {
    mode = "dark";
  }
  document.documentElement.setAttribute("data-theme", mode);
  try {
    localStorage.setItem("ui_theme", mode);
  } catch (e) {
    // Ignore storage errors
  }
  updateThemeToggleUI(mode);
}

function updateThemeToggleUI(currentTheme) {
  const darkBtn = document.getElementById("theme-dark");
  const lightBtn = document.getElementById("theme-light");
  
  if (darkBtn) {
    darkBtn.classList.toggle("is-active", currentTheme === "dark");
  }
  if (lightBtn) {
    lightBtn.classList.toggle("is-active", currentTheme === "light");
  }
}

export function wireThemeToggle() {
  let topbarRight = document.querySelector(".topbar__right");
  if (!topbarRight) {
    // Create topbar__right if it doesn't exist
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    topbarRight = document.createElement("div");
    topbarRight.className = "topbar__right";
    topbar.appendChild(topbarRight);
  }

  // Remove existing theme toggles if any
  const existingDark = document.getElementById("theme-dark");
  const existingLight = document.getElementById("theme-light");
  if (existingDark) existingDark.remove();
  if (existingLight) existingLight.remove();

  // Create Dark button
  const darkBtn = document.createElement("button");
  darkBtn.id = "theme-dark";
  darkBtn.className = "theme-toggle";
  darkBtn.textContent = "Dark";
  darkBtn.addEventListener("click", () => setTheme("dark"));

  // Create Light button
  const lightBtn = document.createElement("button");
  lightBtn.id = "theme-light";
  lightBtn.className = "theme-toggle";
  lightBtn.textContent = "Light";
  lightBtn.addEventListener("click", () => setTheme("light"));

  // Insert at the beginning of topbar__right
  topbarRight.insertBefore(lightBtn, topbarRight.firstChild);
  topbarRight.insertBefore(darkBtn, topbarRight.firstChild);

  // Update UI to reflect current theme
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  updateThemeToggleUI(currentTheme);
}

/* ========== LOGO INJECTION ========== */

function ensureLogoOnAllPages() {
  const appHeader = document.querySelector(".app-header");
  if (!appHeader) return;

  // Check if logo already exists
  const existingLogo = appHeader.querySelector("img.logo");
  if (existingLogo) return;

  // Create and inject logo as first element
  const logo = document.createElement("img");
  logo.src = "assets/optima-logo-new.jpg";
  logo.alt = "Optima Dealer Services";
  logo.className = "logo";
  appHeader.insertBefore(logo, appHeader.firstChild);
}

