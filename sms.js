// sms.js
// Frontend helper for sending SMS via Supabase Edge Function (send-sms)

import { supabase } from "./supabaseClient.js";

/**
 * Send an SMS via Supabase Edge Function
 * @param {string} to - E.164 phone number (ex: +19494443388)
 * @param {string} body - Message text
 */
export async function sendSms(to, body) {
  if (!to || !body) {
    throw new Error("sendSms requires both 'to' and 'body'");
  }

  const { data, error } = await supabase.functions.invoke("send-sms", {
    body: {
      to,
      body,
    },
  });

  if (error) {
    console.error("SMS send failed:", error);
    throw error;
  }

  return data;
}