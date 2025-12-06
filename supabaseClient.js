// supabaseClient.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://azsjlplgxhohpzuobxrj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6c2pscGxneGhvaHB6dW9ieHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzU5NDAsImV4cCI6MjA4MDU1MTk0MH0._WudnsgmWGMmoUV8C6PA_qbg5_3tWNCe8wD-6GJ-Cy8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
