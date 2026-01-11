// ui.js — Shared UI helper functions (dependency-free, iPad Safari compatible)
// Provides: modals, toasts, CSV/TSV export

/* ---------- MODAL SYSTEM ---------- */

/**
 * Show a modal dialog
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string|HTMLElement} options.content - Modal body content (HTML string or element)
 * @param {string} [options.width="400px"] - Modal width
 * @param {string} [options.confirmText="OK"] - Confirm button text
 * @param {string} [options.cancelText="Cancel"] - Cancel button text
 * @param {boolean} [options.hideCancel=false] - Hide cancel button
 * @param {string} [options.focusSelector] - Selector to focus after modal opens
 * @returns {Promise<"ok"|null>} - "ok" if confirmed, null if cancelled
 */
export function showModal({ title, content, width = "400px", confirmText = "OK", cancelText = "Cancel", hideCancel = false, focusSelector } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 1rem;
    `;

        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style.cssText = `
      background: #0a0b10;
      border: 1px solid #2b2e3a;
      border-radius: 10px;
      padding: 1.5rem;
      max-width: ${width};
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    `;

        const titleEl = document.createElement("div");
        titleEl.className = "modal-title";
        titleEl.style.cssText = "font-weight: 600; font-size: 1.1rem; margin-bottom: 1rem; color: #f5f5f5;";
        titleEl.textContent = title;

        const bodyEl = document.createElement("div");
        bodyEl.className = "modal-body";
        bodyEl.style.cssText = "margin-bottom: 1.5rem; color: #d1d5db; line-height: 1.5;";
        if (typeof content === "string") {
            bodyEl.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            bodyEl.appendChild(content);
        }

        const actionsEl = document.createElement("div");
        actionsEl.className = "modal-actions";
        actionsEl.style.cssText = "display: flex; gap: 0.5rem; justify-content: flex-end;";

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "btn btn-primary";
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = () => {
            document.body.removeChild(overlay);
            resolve("ok");
        };

        if (!hideCancel) {
            const cancelBtn = document.createElement("button");
            cancelBtn.className = "btn";
            cancelBtn.textContent = cancelText;
            cancelBtn.onclick = () => {
                document.body.removeChild(overlay);
                resolve(null);
            };
            actionsEl.appendChild(cancelBtn);
        }

        actionsEl.appendChild(confirmBtn);

        modal.appendChild(titleEl);
        modal.appendChild(bodyEl);
        modal.appendChild(actionsEl);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Focus management
        if (focusSelector) {
            setTimeout(() => {
                const focusEl = modal.querySelector(focusSelector);
                if (focusEl && typeof focusEl.focus === "function") {
                    focusEl.focus();
                }
            }, 100);
        } else {
            confirmBtn.focus();
        }

        // Close on overlay click
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });

        // Close on Escape key
        const escapeHandler = (e) => {
            if (e.key === "Escape") {
                document.body.removeChild(overlay);
                document.removeEventListener("keydown", escapeHandler);
                resolve(null);
            }
        };
        document.addEventListener("keydown", escapeHandler);
    });
}

/**
 * Show a text input modal
 * @param {string} title - Modal title
 * @param {Object} options
 * @param {string} [options.placeholder=""] - Input placeholder
 * @param {string} [options.initialValue=""] - Initial input value
 * @param {boolean} [options.required=false] - Require non-empty input
 * @param {boolean} [options.multiline=false] - Use textarea instead of input
 * @returns {Promise<string|null>} - Input value if confirmed, null if cancelled
 */
export function showTextModal(title, { placeholder = "", initialValue = "", required = false, multiline = false } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 1rem;
    `;

        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style.cssText = `
      background: #0a0b10;
      border: 1px solid #2b2e3a;
      border-radius: 10px;
      padding: 1.5rem;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    `;

        const titleEl = document.createElement("div");
        titleEl.className = "modal-title";
        titleEl.style.cssText = "font-weight: 600; font-size: 1.1rem; margin-bottom: 1rem; color: #f5f5f5;";
        titleEl.textContent = title;

        const inputEl = multiline ? document.createElement("textarea") : document.createElement("input");
        inputEl.className = "modal-input";
        inputEl.style.cssText = `
      width: 100%;
      padding: 0.5rem;
      background: #030307;
      border: 1px solid #2b2e3a;
      border-radius: 6px;
      color: #f5f5f5;
      font-size: 0.9rem;
      font-family: inherit;
      margin-bottom: 1rem;
      box-sizing: border-box;
    `;
        if (multiline) {
            inputEl.style.minHeight = "100px";
            inputEl.style.resize = "vertical";
        }
        inputEl.placeholder = placeholder;
        inputEl.value = initialValue;

        const actionsEl = document.createElement("div");
        actionsEl.className = "modal-actions";
        actionsEl.style.cssText = "display: flex; gap: 0.5rem; justify-content: flex-end;";

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "btn btn-primary";
        confirmBtn.textContent = "OK";
        confirmBtn.onclick = () => {
            const value = inputEl.value.trim();
            if (required && !value) {
                toast("This field is required", "error");
                return;
            }
            document.body.removeChild(overlay);
            resolve(value || null);
        };

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = () => {
            document.body.removeChild(overlay);
            resolve(null);
        };

        actionsEl.appendChild(cancelBtn);
        actionsEl.appendChild(confirmBtn);

        modal.appendChild(titleEl);
        modal.appendChild(inputEl);
        modal.appendChild(actionsEl);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Focus input
        setTimeout(() => inputEl.focus(), 100);

        // Submit on Enter (unless multiline)
        if (!multiline) {
            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    confirmBtn.click();
                }
            });
        }

        // Close on overlay click
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });

        // Close on Escape key
        const escapeHandler = (e) => {
            if (e.key === "Escape") {
                document.body.removeChild(overlay);
                document.removeEventListener("keydown", escapeHandler);
                resolve(null);
            }
        };
        document.addEventListener("keydown", escapeHandler);
    });
}

/**
 * Show a select/dropdown modal
 * @param {string} title - Modal title
 * @param {Object} options
 * @param {string} [options.label=""] - Label text above select
 * @param {Array<{label: string, value: string}>} options.options - Select options
 * @param {boolean} [options.required=false] - Require selection
 * @returns {Promise<string|null>} - Selected value if confirmed, null if cancelled
 */
export function showSelectModal(title, { label = "", options = [], required = false } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 1rem;
    `;

        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style.cssText = `
      background: #0a0b10;
      border: 1px solid #2b2e3a;
      border-radius: 10px;
      padding: 1.5rem;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    `;

        const titleEl = document.createElement("div");
        titleEl.className = "modal-title";
        titleEl.style.cssText = "font-weight: 600; font-size: 1.1rem; margin-bottom: 1rem; color: #f5f5f5;";
        titleEl.textContent = title;

        const selectEl = document.createElement("select");
        selectEl.className = "modal-input";
        selectEl.style.cssText = `
      width: 100%;
      padding: 0.5rem;
      background: #030307;
      border: 1px solid #2b2e3a;
      border-radius: 6px;
      color: #f5f5f5;
      font-size: 0.9rem;
      font-family: inherit;
      margin-bottom: 1rem;
      box-sizing: border-box;
    `;
        selectEl.innerHTML = '<option value="">Select...</option>';
        options.forEach((opt) => {
            const option = document.createElement("option");
            option.value = opt.value;
            option.textContent = opt.label || opt.value;
            selectEl.appendChild(option);
        });

        const actionsEl = document.createElement("div");
        actionsEl.className = "modal-actions";
        actionsEl.style.cssText = "display: flex; gap: 0.5rem; justify-content: flex-end;";

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "btn btn-primary";
        confirmBtn.textContent = "Confirm";
        confirmBtn.onclick = () => {
            const value = selectEl.value;
            if (required && !value) {
                toast("Please make a selection", "error");
                return;
            }
            document.body.removeChild(overlay);
            resolve(value || null);
        };

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = () => {
            document.body.removeChild(overlay);
            resolve(null);
        };

        actionsEl.appendChild(cancelBtn);
        actionsEl.appendChild(confirmBtn);

        modal.appendChild(titleEl);
        if (label) {
            const labelEl = document.createElement("div");
            labelEl.style.cssText = "font-size: 0.85rem; color: #9ca3af; margin-bottom: 0.5rem;";
            labelEl.textContent = label;
            modal.appendChild(labelEl);
        }
        modal.appendChild(selectEl);
        modal.appendChild(actionsEl);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Focus select
        setTimeout(() => selectEl.focus(), 100);

        // Close on overlay click
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });

        // Close on Escape key
        const escapeHandler = (e) => {
            if (e.key === "Escape") {
                document.body.removeChild(overlay);
                document.removeEventListener("keydown", escapeHandler);
                resolve(null);
            }
        };
        document.addEventListener("keydown", escapeHandler);
    });
}

/* ---------- TOAST SYSTEM ---------- */

/**
 * Show a toast notification
 * @param {string} message - Toast message
 * @param {string} [kind="info"] - Toast kind: "info", "success", "error", "warn"
 */
export function toast(message, kind = "info") {
    const toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.style.cssText = `
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    background: #0a0b10;
    border: 1px solid #2b2e3a;
    border-radius: 8px;
    padding: 0.75rem 1.5rem;
    font-size: 0.9rem;
    color: #f5f5f5;
    z-index: 10001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: toastSlideIn 0.3s ease-out;
  `;

    // Kind-specific styling
    const kindStyles = {
        info: { borderColor: "#3b82f6", color: "#bfdbfe" },
        success: { borderColor: "#51cf66", color: "#a9ffb7" },
        error: { borderColor: "#ff6b6b", color: "#ff9b9b" },
        warn: { borderColor: "#ffa94d", color: "#ffb47a" }
    };
    const style = kindStyles[kind] || kindStyles.info;
    toastEl.style.borderColor = style.borderColor;
    toastEl.style.color = style.color;

    toastEl.textContent = message;
    document.body.appendChild(toastEl);

    // Auto-hide after 3 seconds
    setTimeout(() => {
        toastEl.style.animation = "toastSlideOut 0.3s ease-in";
        setTimeout(() => {
            if (toastEl.parentNode) {
                document.body.removeChild(toastEl);
            }
        }, 300);
    }, 3000);
}

// Add toast animations to head if not already present
if (!document.getElementById("toast-animations")) {
    const style = document.createElement("style");
    style.id = "toast-animations";
    style.textContent = `
    @keyframes toastSlideIn {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
    @keyframes toastSlideOut {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
    }
  `;
    document.head.appendChild(style);
}

/* ---------- CSV/TSV EXPORT ---------- */

/**
 * Download CSV file
 * @param {string} filename - Filename (without extension)
 * @param {Array<{key: string, label: string}>} headers - Column definitions
 * @param {Array<Object>} rows - Data rows (objects with keys matching header.key)
 */
export function downloadCSV(filename, headers, rows) {
    // Build CSV content
    const csvRows = [];

    // Header row
    const headerRow = headers.map((h) => escapeCSVField(h.label)).join(",");
    csvRows.push(headerRow);

    // Data rows
    rows.forEach((row) => {
        const dataRow = headers.map((h) => {
            const value = row[h.key] ?? "";
            return escapeCSVField(String(value));
        }).join(",");
        csvRows.push(dataRow);
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast("CSV downloaded", "success");
}

/**
 * Copy TSV to clipboard (for Google Sheets paste)
 * @param {Array<{key: string, label: string}>} headers - Column definitions
 * @param {Array<Object>} rows - Data rows
 */
export async function copyTSV(headers, rows) {
    // Build TSV content
    const tsvRows = [];

    // Header row
    const headerRow = headers.map((h) => h.label).join("\t");
    tsvRows.push(headerRow);

    // Data rows
    rows.forEach((row) => {
        const dataRow = headers.map((h) => {
            const value = row[h.key] ?? "";
            return String(value).replace(/\t/g, " ").replace(/\n/g, " ");
        }).join("\t");
        tsvRows.push(dataRow);
    });

    const tsvContent = tsvRows.join("\n");

    try {
        await navigator.clipboard.writeText(tsvContent);
        toast("TSV copied to clipboard", "success");
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = tsvContent;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand("copy");
            toast("TSV copied to clipboard", "success");
        } catch (e) {
            toast("Failed to copy TSV", "error");
        }
        document.body.removeChild(textarea);
    }
}

function escapeCSVField(field) {
    if (field == null) return "";
    const str = String(field);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/* =========================================================
   TIMER SNAP UTIL (APPENDED — SAFE)
   ========================================================= */

export function snapTo15(seconds) {
    return Math.floor(seconds / 15) * 15;
}

export function formatSnapTime(seconds) {
    const s = snapTo15(seconds);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
}

