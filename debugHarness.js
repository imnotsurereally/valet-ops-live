// debugHarness.js — V1 "God-mode" Debug Harness
// Safe: does NOTHING unless enabled via:
//   - URL: ?debug=1
//   - LocalStorage: localStorage.setItem('debugHarness','1')
// Disable via:
//   - URL: ?debug=0
//   - LocalStorage: localStorage.removeItem('debugHarness')
//
// What it does when enabled:
//  - Floating debug panel with status + last click target
//  - Captures ALL click events (capture phase) and shows the element chain
//  - Detects overlays blocking clicks using elementFromPoint()
//  - Confirms that TBODY exists + receives click events
//  - Captures JS errors + unhandled promise rejections
//  - Adds a visible build stamp (if #build-stamp exists)
//
// No exports; just side-effect instrumentation.

(function () {
  const qs = new URLSearchParams(window.location.search);
  const urlDebug = qs.get("debug"); // "1" / "0" / null

  if (urlDebug === "1") localStorage.setItem("debugHarness", "1");
  if (urlDebug === "0") localStorage.removeItem("debugHarness");

  const enabled = localStorage.getItem("debugHarness") === "1";
  if (!enabled) return;

  const HARNESS_VERSION = "debugHarness V1 — 2025-12-28";

  // ---------- Utilities ----------
  function nowStamp() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function elLabel(el) {
    if (!el) return "(null)";
    const id = el.id ? `#${el.id}` : "";
    const cls =
      el.classList && el.classList.length ? "." + Array.from(el.classList).slice(0, 4).join(".") : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  function chainFrom(el, max = 8) {
    const chain = [];
    let cur = el;
    while (cur && chain.length < max) {
      chain.push(elLabel(cur));
      cur = cur.parentElement;
    }
    return chain.join("  ←  ");
  }

  function cssSummary(el) {
    try {
      const cs = getComputedStyle(el);
      return {
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        position: cs.position,
        opacity: cs.opacity,
        display: cs.display,
        visibility: cs.visibility,
      };
    } catch {
      return {};
    }
  }

  function safeJson(obj) {
    try {
      return JSON.stringify(obj);
    } catch {
      return String(obj);
    }
  }

  // ---------- UI Panel ----------
  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.right = "12px";
  panel.style.bottom = "12px";
  panel.style.width = "360px";
  panel.style.maxWidth = "92vw";
  panel.style.maxHeight = "55vh";
  panel.style.overflow = "auto";
  panel.style.background = "rgba(10, 11, 16, 0.92)";
  panel.style.border = "1px solid rgba(96,165,250,0.7)";
  panel.style.borderRadius = "12px";
  panel.style.padding = "10px";
  panel.style.fontFamily = "ui-monospace, Menlo, Consolas, monospace";
  panel.style.fontSize = "12px";
  panel.style.color = "#e5e7eb";
  panel.style.zIndex = "2147483647";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "8px";

  const title = document.createElement("div");
  title.innerHTML = `<strong>DEBUG ON</strong> <span style="color:#9ca3af">(${HARNESS_VERSION})</span>`;

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "6px";

  const btnClear = document.createElement("button");
  btnClear.textContent = "Clear";
  btnClear.style.border = "1px solid #374151";
  btnClear.style.background = "#0b1220";
  btnClear.style.color = "#e5e7eb";
  btnClear.style.borderRadius = "8px";
  btnClear.style.padding = "4px 8px";
  btnClear.style.cursor = "pointer";

  const btnOff = document.createElement("button");
  btnOff.textContent = "Disable";
  btnOff.style.border = "1px solid #7f1d1d";
  btnOff.style.background = "#220a0a";
  btnOff.style.color = "#fecaca";
  btnOff.style.borderRadius = "8px";
  btnOff.style.padding = "4px 8px";
  btnOff.style.cursor = "pointer";

  btnRow.appendChild(btnClear);
  btnRow.appendChild(btnOff);

  header.appendChild(title);
  header.appendChild(btnRow);

  const status = document.createElement("div");
  status.style.marginTop = "8px";
  status.style.color = "#bfdbfe";
  status.textContent = `[${nowStamp()}] Harness enabled. Click a broken button now.`;

  const log = document.createElement("div");
  log.style.marginTop = "8px";
  log.style.whiteSpace = "pre-wrap";
  log.style.color = "#e5e7eb";

  panel.appendChild(header);
  panel.appendChild(status);
  panel.appendChild(log);
  document.documentElement.appendChild(panel);

  function push(line) {
    const text = `[${nowStamp()}] ${line}\n`;
    log.textContent = text + log.textContent; // newest on top
  }

  btnClear.addEventListener("click", () => (log.textContent = ""));
  btnOff.addEventListener("click", () => {
    localStorage.removeItem("debugHarness");
    push("Disabled. Reloading…");
    setTimeout(() => location.reload(), 300);
  });

  // ---------- Build stamp (optional) ----------
  const stampEl = document.getElementById("build-stamp");
  if (stampEl) {
    stampEl.textContent = `Build: ${HARNESS_VERSION}`;
  }

  // ---------- Error capture ----------
  window.addEventListener("error", (e) => {
    push(`JS ERROR: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
  });

  window.addEventListener("unhandledrejection", (e) => {
    push(`UNHANDLED PROMISE: ${safeJson(e.reason)}`);
  });

  // ---------- Confirm TBODY exists + receives clicks ----------
  const TBODIES = ["active-tbody", "staged-tbody", "waiting-tbody", "completed-tbody"];
  function attachTbodyProbes() {
    TBODIES.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) {
        push(`TBODY MISSING: #${id}`);
        return;
      }
      // Prevent duplicate probes
      if (el.__debugProbeAttached) return;
      el.__debugProbeAttached = true;

      el.addEventListener(
        "click",
        () => {
          push(`TBODY CLICK RECEIVED: #${id}`);
        },
        true
      );
      push(`TBODY OK + PROBED: #${id}`);
    });
  }

  // Initial + observe changes (because your app replaces tbody.innerHTML)
  attachTbodyProbes();
  const mo = new MutationObserver(() => attachTbodyProbes());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- Click tracing + overlay detection ----------
  window.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      const btn = target.closest?.("[data-action]");
      const info = btn
        ? `CLICK [data-action]: action="${btn.getAttribute("data-action")}" id="${btn.getAttribute("data-id")}"`
        : "CLICK (no data-action found)";

      // elementFromPoint — what is actually on top at the click position?
      const top = document.elementFromPoint(e.clientX, e.clientY);

      push(info);
      push(`Target: ${elLabel(target)} | Chain: ${chainFrom(target)}`);
      push(`Top@Point: ${elLabel(top)} | TopCSS: ${safeJson(cssSummary(top))}`);

      // If a top element is NOT the clicked target chain, it may be blocking clicks
      if (top && top !== target && !target.contains(top) && !top.contains(target)) {
        push(
          `⚠ Possible overlay: Top@Point (${elLabel(top)}) is not the same as target (${elLabel(target)}).`
        );
      }

      // Extra: show CSS pointer-events status of target + parents
      let cur = target;
      let hops = 0;
      while (cur && hops < 6) {
        const cs = cssSummary(cur);
        if (cs.pointerEvents === "none") {
          push(`⚠ pointer-events:none found on ${elLabel(cur)} (this blocks clicks).`);
          break;
        }
        cur = cur.parentElement;
        hops++;
      }
    },
    true // capture phase (we see it even if something stops propagation later)
  );

  // ---------- Quick hotkeys ----------
  // Press "D" to toggle panel visibility
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "d") {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }
  });

  push("Ready. If buttons still do nothing, the logs will tell us WHY.");
})();
