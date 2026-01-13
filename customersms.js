// customersms.js
// Customer SMS page - dispatcher + owner/manager only
// Requires: ./supabaseClient.js + ./auth.js (requireAuth / wireSignOut) + ./sms.js

import { supabase } from "./supabaseClient.js";
import { requireAuth, wireSignOut } from "./auth.js?v=20260110a";
import { sendSms } from "./sms.js";
import { toast } from "./ui.js?v=20260105c";

// SMS Templates
const SMS_TEMPLATES = [
  {
    label: "We called and couldn't find you in the lounge. Your vehicle is ready—please return to valet pickup.",
    value: "We called and couldn't find you in the lounge. Your vehicle is ready—please return to valet pickup."
  },
  {
    label: "Your vehicle is ready for pickup. Please return to valet when you're able.",
    value: "Your vehicle is ready for pickup. Please return to valet when you're able."
  },
  {
    label: "Your vehicle is being staged now. Please return to valet pickup in a few minutes.",
    value: "Your vehicle is being staged now. Please return to valet pickup in a few minutes."
  },
  {
    label: "We attempted to reach you by phone. Please call/return to valet pickup when available.",
    value: "We attempted to reach you by phone. Please call/return to valet pickup when available."
  },
  {
    label: "Your vehicle is at the front valet pickup area.",
    value: "Your vehicle is at the front valet pickup area."
  },
  {
    label: "Hi {name}, your vehicle is ready for pickup. Please return to valet when convenient.",
    value: "Hi {name}, your vehicle is ready for pickup. Please return to valet when convenient."
  },
  {
    label: "{name}, we're ready for you at valet pickup. Please return when you're able.",
    value: "{name}, we're ready for you at valet pickup. Please return when you're able."
  },
  {
    label: "Hello {name}, your vehicle is ready. Please come to valet pickup.",
    value: "Hello {name}, your vehicle is ready. Please come to valet pickup."
  }
];

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    // AUTH GATE (dispatcher + owner/manager only)
    const auth = await requireAuth({ page: "customersms" });
    if (!auth?.ok) return;

    wireSignOut();
    wireForm();
    populateTemplates();
    
    // Render sent log on load
    renderSentLog();
  })();
});

function populateTemplates() {
  const templateSelect = document.getElementById("sms-template");
  if (!templateSelect) return;

  SMS_TEMPLATES.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.value;
    option.textContent = template.label;
    templateSelect.appendChild(option);
  });
}

function wireForm() {
  const form = document.getElementById("sms-form");
  const templateSelect = document.getElementById("sms-template");
  const nameInput = document.getElementById("sms-name");
  const phoneInput = document.getElementById("sms-phone");
  const messageTextarea = document.getElementById("sms-message");
  const sendBtn = document.getElementById("sms-send-btn");
  const clearBtn = document.getElementById("sms-clear-btn");

  if (!form || !templateSelect || !nameInput || !phoneInput || !messageTextarea || !sendBtn) return;

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      templateSelect.value = "";
      nameInput.value = "";
      phoneInput.value = "";
      messageTextarea.value = "";
      const statusSection = document.getElementById("sms-status-section");
      if (statusSection) statusSection.style.display = "none";
    });
  }

  // Update message when template changes
  templateSelect.addEventListener("change", () => {
    const template = templateSelect.value;
    if (template) {
      const name = nameInput.value.trim() || "{name}";
      const message = template.replace(/{name}/g, name);
      messageTextarea.value = message;
    } else {
      messageTextarea.value = "";
    }
  });

  // Update message when name changes (if template is selected)
  nameInput.addEventListener("input", () => {
    const template = templateSelect.value;
    if (template) {
      const name = nameInput.value.trim() || "{name}";
      const message = template.replace(/{name}/g, name);
      messageTextarea.value = message;
    }
  });

  // Send SMS
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const phone = phoneInput.value.trim();
    const message = messageTextarea.value.trim();
    const name = nameInput.value.trim();

    if (!phone || !message) {
      toast("Phone and message are required", "error");
      return;
    }

    // Validate phone format (E.164)
    if (!phone.startsWith("+") || phone.length < 10) {
      toast("Phone must be in E.164 format (e.g., +19494443388)", "error");
      return;
    }

    // Disable send button
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";

    try {
      // Replace {name} placeholder in message
      let finalMessage = message.replace(/{name}/g, name || "Customer");

      // Append signature automatically
      const signature = "\n\nValet Team\nOptima Dealer Services\nFletcher Jones Motorcars\nNewport Beach";
      finalMessage = finalMessage + signature;

      await sendSms(phone, finalMessage);

      toast("SMS sent successfully", "success");

      // Add to sent log
      addToSentLog({
        timestamp: new Date().toISOString(),
        phone: phone,
        name: name || "Unknown",
        message: message // Store original message without signature
      });

      // Clear form
      templateSelect.value = "";
      nameInput.value = "";
      phoneInput.value = "";
      messageTextarea.value = "";

      // Show status
      showStatus("SMS sent successfully", "success");

      // Render sent log
      renderSentLog();
    } catch (error) {
      console.error("SMS send error:", error);
      toast("Failed to send SMS: " + (error.message || "Unknown error"), "error");
      showStatus("Failed to send SMS", "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send SMS";
    }
  });
}

function showStatus(message, type) {
  const statusSection = document.getElementById("sms-status-section");
  const statusEl = document.getElementById("sms-status");

  if (!statusSection || !statusEl) return;

  statusSection.style.display = "block";
  statusEl.textContent = message;
  statusEl.className = `status-badge ${type === "success" ? "timer-green" : "timer-red"}`;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusSection.style.display = "none";
  }, 5000);
}

/* ---------- SENT LOG (localStorage-backed) ---------- */

function addToSentLog(entry) {
  try {
    const logKey = "customersms_log";
    let log = [];
    
    // Load existing log
    const stored = localStorage.getItem(logKey);
    if (stored) {
      try {
        log = JSON.parse(stored);
      } catch (e) {
        log = [];
      }
    }

    // Add new entry at the beginning
    log.unshift(entry);

    // Keep only last 25 entries
    if (log.length > 25) {
      log = log.slice(0, 25);
    }

    // Save back to localStorage
    localStorage.setItem(logKey, JSON.stringify(log));
  } catch (e) {
    console.warn("Failed to save to sent log:", e);
  }
}

function getSentLog() {
  try {
    const logKey = "customersms_log";
    const stored = localStorage.getItem(logKey);
    if (!stored) return [];
    
    try {
      return JSON.parse(stored);
    } catch (e) {
      return [];
    }
  } catch (e) {
    return [];
  }
}

function renderSentLog() {
  const logContainer = document.getElementById("sms-sent-log");
  if (!logContainer) return;

  const log = getSentLog();
  
  if (log.length === 0) {
    logContainer.innerHTML = '<div class="empty">No messages sent yet.</div>';
    return;
  }

  const logHtml = log.map((entry) => {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString();
    
    // Mask phone except last 4 digits
    const phoneMasked = entry.phone.length > 4 
      ? "***" + entry.phone.slice(-4)
      : "***";
    
    // Preview first ~120 chars of message
    const messagePreview = entry.message.length > 120
      ? entry.message.substring(0, 120) + "..."
      : entry.message;

    return `
      <div style="padding: 0.75rem; border-bottom: 1px solid var(--border);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
          <div style="font-weight: 600;">${escapeHtml(entry.name || "Unknown")}</div>
          <div style="font-size: 0.75rem; color: var(--text-2);">${timeStr}</div>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-2); margin-bottom: 0.25rem;">
          To: ${escapeHtml(phoneMasked)}
        </div>
        <div style="font-size: 0.85rem; color: var(--text);">
          ${escapeHtml(messagePreview)}
        </div>
      </div>
    `;
  }).join("");

  logContainer.innerHTML = logHtml;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
