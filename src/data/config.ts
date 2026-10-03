// Environment-driven cloud config.
// With no Supabase env vars the app runs in fully offline "Local only" mode.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const CLOUD_ENABLED: boolean = Boolean(
  url && anonKey && url.startsWith('http'),
);

export const supabase: SupabaseClient | null = CLOUD_ENABLED
  ? createClient(url as string, anonKey as string)
  : null;
