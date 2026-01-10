import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    },
  });
}

function b64(str: string) {
  return btoa(str);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  const TWILIO_MESSAGING_SERVICE_SID =
    Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "";

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_MESSAGING_SERVICE_SID) {
    return json(500, {
      ok: false,
      error: "Missing Twilio secrets in Supabase Edge Function Secrets.",
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const to = String(payload?.to || "").trim();
  const body = String(payload?.body || "").trim();

  if (!to || !to.startsWith("+") || to.length < 10) {
    return json(400, {
      ok: false,
      error: "Invalid 'to'. Use E.164 format like +1877...",
    });
  }

  if (!body) {
    return json(400, { ok: false, error: "Missing 'body'." });
  }

  if (body.length > 1200) {
    return json(400, { ok: false, error: "Message too long (max 1200 chars)." });
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const authHeader =
    "Basic " + b64(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("Body", body);
  form.set("MessagingServiceSid", TWILIO_MESSAGING_SERVICE_SID);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: form,
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return json(400, {
        ok: false,
        error: "Twilio send failed",
        twilio_status: resp.status,
        twilio: data,
      });
    }

    return json(200, {
      ok: true,
      sid: data?.sid,
      status: data?.status,
      to: data?.to,
      body_preview: (data?.body || "").slice(0, 80),
    });
  } catch (e) {
    return json(500, {
      ok: false,
      error: "Server error sending SMS",
      detail: String((e as any)?.message || e),
    });
  }
});
