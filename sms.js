import { supabase } from "./supabaseClient.js";

export async function sendDemoSms(to, message) {
  const { data, error } = await supabase.functions.invoke("send-sms", {
    body: { to, body: message },
  });

  if (error) throw error;
  return data;
}
