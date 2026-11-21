// qa/fixtures/auth-client.ts
// Supabase client factory for testing actors with real JWTs and RLS enforcement

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-local-dev-testing';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function generateTestJwt(payload: Record<string, any>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${headerB64}.${payloadB64}.${signature}`;
}

export interface ActorInfo {
  authUserId: string;
  email: string;
  role: 'OWNER' | 'STAFF' | 'anon';
  businessId: string;
  memberId: string;
  token?: string;
}

export interface ActorClients {
  owner: SupabaseClient;
  staff1: SupabaseClient;
  staff2: SupabaseClient;
  staff_deactivated: SupabaseClient;
  owner_b: SupabaseClient;
  staff_b: SupabaseClient;
  anon: SupabaseClient;
  invalid_token: SupabaseClient;
  actors: Record<string, ActorInfo>;
}

export function createActorClient(token?: string): SupabaseClient {
  if (!token) {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

export function makeTokenForUser(userId: string, email: string, role = 'authenticated', expiresInSec = 86400 * 7): string {
  const now = Math.floor(Date.now() / 1000);
  return generateTestJwt({
    sub: userId,
    email,
    role,
    aud: 'authenticated',
    iat: now,
    exp: now + expiresInSec,
  });
}

