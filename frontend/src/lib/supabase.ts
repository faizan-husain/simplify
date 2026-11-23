import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'anon_key_placeholder';

// Session-based storage: Session is cleared as soon as the browser tab/window is closed.
// This enforces mandatory login upon reopening the browser while allowing page reloads (F5).
const safeSessionStorage = typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : undefined;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: safeSessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

