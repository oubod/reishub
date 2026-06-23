// js/supabase-client.js

// The publishable key is intentionally public. RLS policies protect the data.
// Never put a Supabase secret/service-role key in browser code.

const SUPABASE_URL = 'https://rsnbcgrtrjfvnoczildf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_x8DaZHPwJORpR2tE5eClMA_yUsD2NTD';

// Initialize the Supabase client.
// The `supabase` variable is exposed globally by the CDN script.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
