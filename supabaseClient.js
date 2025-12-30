// supabaseClient.js
// Uses Supabase v1 from the <script> tag (window.supabase)
//
// Purpose:
// - Create ONE shared Supabase client instance for the entire app.
// - Import { supabase } from this file anywhere you need DB/auth.
// - No debug code in production (keeps console clean).

const SUPABASE_URL = "https://azsjlplgxhohpzuobxrj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6c2pscGxneGhvaHB6dW9ieHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzU5NDAsImV4cCI6MjA4MDU1MTk0MH0._WudnsgmWGMmoUV8C6PA_qbg5_3tWNCe8wD-6GJ-Cy8";

if (!window.supabase) {
  throw new Error(
    "Supabase library not found. Make sure you included the Supabase <script> tag before loading supabaseClient.js"
  );
}

// Create a single shared client instance
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
});
