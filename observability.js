import { supabase } from "./supabaseClient.js";

let defaults = {
  storeId: null,
  page: null,
  role: null,
};

let listenersInstalled = false;
const dedupeWindowMs = 10_000;
const errorDedupe = new Map(); // key -> lastSeenTs

function shouldSkipDuplicate(message, stack) {
  const key = `${message || ""}|${stack || ""}`;
  const now = Date.now();
  const last = errorDedupe.get(key);
  if (last && now - last < dedupeWindowMs) return true;
  errorDedupe.set(key, now);
  return false;
}

function resolveContext(partial = {}) {
  return {
    storeId: partial.storeId ?? defaults.storeId ?? null,
    page: partial.page ?? defaults.page ?? null,
    role: partial.role ?? defaults.role ?? null,
  };
}

async function getActorUserId() {
  try {
    // Supabase JS v2
    if (supabase?.auth?.getUser) {
      const { data, error } = await supabase.auth.getUser();
      if (!error) return data?.user?.id ?? null;
    }

    // Supabase JS v1
    if (supabase?.auth?.user) {
      const user = supabase.auth.user();
      return user?.id ?? null;
    }
  } catch {
    // Best-effort only
  }
  return null;
}

export function initObservability({ storeId = null, page = null, role = null } = {}) {
  defaults = { storeId, page, role };

  if (listenersInstalled) return;
  listenersInstalled = true;

  // Global JS error handler
  window.addEventListener("error", (event) => {
    try {
      const message = event?.error?.message || event?.message || "unknown_error";
      const stack = event?.error?.stack || null;

      if (shouldSkipDuplicate(message, stack)) return;

      const context = {
        filename: event?.filename || null,
        lineno: event?.lineno || null,
        colno: event?.colno || null,
        errorName: event?.error?.name || null,
        fromEvent: true,
      };

      logClientEvent({
        level: "error",
        eventType: "js_error",
        message,
        stack,
        context,
      });
    } catch {
      // Swallow errors to avoid breaking the app
    }
  });

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event?.reason;
      let message = "unhandled rejection";
      let stack = null;

      if (typeof reason === "string") {
        message = reason;
      } else if (reason && typeof reason === "object") {
        message = reason.message || message;
        stack = reason.stack || null;
      }

      if (shouldSkipDuplicate(message, stack)) return;

      const context = {
        reasonType: typeof reason,
        fromEvent: true,
      };

      logClientEvent({
        level: "error",
        eventType: "unhandled_rejection",
        message,
        stack,
        context,
      });
    } catch {
      // Swallow errors to avoid breaking the app
    }
  });
}

export async function logClientEvent({
  storeId = null,
  page = null,
  role = null,
  level = "info",
  eventType = "custom",
  message = null,
  stack = null,
  context = {},
} = {}) {
  const resolved = resolveContext({ storeId, page, role });
  const safeContext =
    context && typeof context === "object"
      ? context
      : { value: context ?? null };

  try {
    const actorUserId = await getActorUserId();

    await supabase.from("client_events").insert([
      {
        store_id: resolved.storeId || null,
        actor_user_id: actorUserId || null,
        page: resolved.page || null,
        role: resolved.role || null,
        level: level || "info",
        event_type: eventType || "custom",
        message: message || null,
        stack: stack || null,
        context: safeContext,
      },
    ]);
  } catch (err) {
    // Best-effort only; never throw
    try {
      console.warn("client_event_log_failed", { eventType, message, error: err });
    } catch {
      // no-op
    }
  }
}
