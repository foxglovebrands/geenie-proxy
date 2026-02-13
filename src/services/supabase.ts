import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

// Create Supabase client with service role key
// This bypasses RLS and allows server-side operations
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Database types for type safety
export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: 'starter' | 'professional' | 'agency';
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'inactive';
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
}
