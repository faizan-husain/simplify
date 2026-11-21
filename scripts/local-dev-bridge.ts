import 'dotenv/config';
import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Client, types } from 'pg';

// Force node-pg to serialize DATE (OID 1082) as raw 'YYYY-MM-DD' string,
// matching Supabase PostgREST production API behavior (prevents UTC date shifting).
types.setTypeParser(1082, (val: string) => val);

const PORT = 54321;
const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf8');
}

function signJwt(payload: Record<string, any>): string {
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

function extractJwtSub(authHeader?: string): { userId?: string; role?: string; email?: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return {};
  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return {
      userId: payload.sub,
      role: payload.role || 'authenticated',
      email: payload.email,
    };
  } catch {
    return {};
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveEffectiveUser(
  client: Client,
  userId?: string,
  email?: string,
  role?: string
): Promise<{ userId: string; role: string }> {
  try {
    // 1. Direct match on members.auth_user_id (only if userId is valid UUID)
    if (userId && UUID_REGEX.test(userId)) {
      const memRes = await client.query(
        `SELECT auth_user_id, role FROM public.members 
         WHERE auth_user_id = $1 AND active = true AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      if (memRes.rows.length > 0) {
        return { userId, role: memRes.rows[0].role || role || 'authenticated' };
      }

      // Check if user is explicitly deactivated or deleted in members
      const inactiveCheck = await client.query(
        `SELECT id FROM public.members WHERE auth_user_id = $1 AND (active = false OR deleted_at IS NOT NULL) LIMIT 1`,
        [userId]
      );
      if (inactiveCheck.rows.length > 0) {
        return { userId: '', role: 'anon' };
      }

      // Check if auth.users has this user and check by email
      const userRes = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0 && userRes.rows[0].email) {
        const uEmail = userRes.rows[0].email.toLowerCase().trim();
        const cleanMobile = uEmail.replace(/\D/g, '').slice(-10);
        const memByEmail = await client.query(
          `SELECT auth_user_id, role FROM public.members 
           WHERE (LOWER(email) = $2 OR mobile = $1 OR '91' || mobile || '@simplify.local' = $2 OR (role = 'OWNER' AND $2 = 'owner@simplify.com') OR (role = 'STAFF' AND $2 = 'staff@simplify.com'))
             AND active = true AND deleted_at IS NULL LIMIT 1`,
          [cleanMobile, uEmail]
        );
        if (memByEmail.rows.length > 0 && memByEmail.rows[0].auth_user_id) {
          return { userId: memByEmail.rows[0].auth_user_id, role: memByEmail.rows[0].role };
        }
      }
    }

    // 2. If email in JWT payload matches
    if (email) {
      const cleanEmail = email.toLowerCase().trim();
      const cleanMobile = cleanEmail.replace(/\D/g, '').slice(-10);
      const memRes = await client.query(
        `SELECT auth_user_id, role FROM public.members 
         WHERE (LOWER(email) = $2 OR mobile = $1 OR '91' || mobile || '@simplify.local' = $2 OR (role = 'OWNER' AND $2 = 'owner@simplify.com') OR (role = 'STAFF' AND $2 = 'staff@simplify.com'))
           AND active = true AND deleted_at IS NULL LIMIT 1`,
        [cleanMobile, cleanEmail]
      );
      if (memRes.rows.length > 0 && memRes.rows[0].auth_user_id) {
        return { userId: memRes.rows[0].auth_user_id, role: memRes.rows[0].role };
      }
    }

    // 3. Fallback: Resolve to active member in development
    if (role === 'STAFF' || (email && email.toLowerCase().includes('staff'))) {
      const staffRes = await client.query(
        `SELECT id, auth_user_id, role FROM public.members 
         WHERE role = 'STAFF' AND active = true AND deleted_at IS NULL 
         ORDER BY created_at ASC LIMIT 1`
      );
      if (staffRes.rows.length > 0 && staffRes.rows[0].auth_user_id) {
        return { userId: staffRes.rows[0].auth_user_id, role: 'STAFF' };
      }
    }

    const ownerRes = await client.query(
      `SELECT id, auth_user_id, role FROM public.members 
       WHERE role = 'OWNER' AND active = true AND deleted_at IS NULL 
       ORDER BY created_at ASC LIMIT 1`
    );
    if (ownerRes.rows.length > 0) {
      const owner = ownerRes.rows[0];
      let ownerAuthId = owner.auth_user_id;
      if (!ownerAuthId) {
        ownerAuthId = crypto.randomUUID();
        await client.query('UPDATE public.members SET auth_user_id = $1 WHERE id = $2', [ownerAuthId, owner.id]);
        await client.query(
          `INSERT INTO auth.users (id, email) VALUES ($1, 'owner@simplify.com') 
           ON CONFLICT (email) DO UPDATE SET id = $1`,
          [ownerAuthId]
        );
      }
      return { userId: ownerAuthId, role: owner.role || 'OWNER' };
    }
  } catch (err) {
    console.warn('Could not resolve effective user:', err);
  }

  return { userId: userId || crypto.randomUUID(), role: role || 'authenticated' };
}

async function getPgClient(): Promise<Client> {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });
  await client.connect();
  return client;
}

function getCorsHeaders(req?: http.IncomingMessage): Record<string, string> {
  const reqHeaders = req?.headers['access-control-request-headers'];
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': reqHeaders || 'authorization, x-client-info, apikey, content-type, prefer, range, accept, x-requested-with, cache-control, pragma',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
    'Access-Control-Expose-Headers': 'content-range, range, x-total-count',
    'Access-Control-Max-Age': '86400',
  };
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any, headers?: Record<string, string>) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...getCorsHeaders(),
    ...(headers || {}),
  });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

process.on('uncaughtException', (err) => {
  console.error('[Bridge UncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Bridge UnhandledRejection]', reason);
});

const server = http.createServer(async (req, res) => {
  try {
    // CORS Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders(req));
      res.end();
      return;
    }

    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;

  const { userId, role, email } = extractJwtSub(req.headers['authorization']);

  // --- 0. ROOT HEALTH / STATUS ENDPOINT ---
  if ((pathname === '/' || pathname === '/health') && req.method === 'GET') {
    const isBrowser = req.headers['accept']?.includes('text/html');
    if (isBrowser) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SIMPLIFY Backend Bridge — Online</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); text-align: center; }
    .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 13px; margin-bottom: 16px; }
    .badge-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; }
    h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px 0; color: #fff; }
    p { font-size: 14px; color: #94a3b8; margin: 0 0 24px 0; }
    .info-box { background: #0f172a; border-radius: 8px; padding: 14px; text-align: left; font-family: monospace; font-size: 13px; color: #cbd5e1; margin-bottom: 24px; line-height: 1.6; }
    .btn { display: block; background: #0f766e; color: #fff; text-decoration: none; font-weight: 600; padding: 12px 20px; border-radius: 8px; transition: background 0.2s; }
    .btn:hover { background: #115e59; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="badge-dot"></span> Backend Online</div>
    <h1>SIMPLIFY Backend Bridge</h1>
    <p>The Supabase API Bridge is running and connected to PostgreSQL.</p>
    <div class="info-box">
      <div>🟢 Status: Healthy & Ready</div>
      <div>⚡ Port: 54321</div>
      <div>📦 Database: simplify_dev</div>
      <div>🔑 Auth & PostgREST: Active</div>
    </div>
    <a href="http://localhost:5173" class="btn">Open Frontend App (localhost:5173) &rarr;</a>
  </div>
</body>
</html>`);
      return;
    }

    sendJson(res, 200, {
      status: 'online',
      service: 'SIMPLIFY Supabase Local Dev Bridge',
      port: PORT,
      database: DB_NAME,
      message: 'Backend is running and healthy',
    });
    return;
  }

  // --- 1. AUTH ENDPOINTS ---
  if (pathname === '/auth/v1/token' && req.method === 'POST') {
    const body = await readBody(req);
    const grantType = reqUrl.searchParams.get('grant_type') || body.grant_type || 'password';
    const client = await getPgClient();

    try {
      let user: any = null;

      if (grantType === 'refresh_token' || body.refresh_token) {
        const tokenSub = extractJwtSub('Bearer ' + body.refresh_token);
        const resolved = await resolveEffectiveUser(client, tokenSub.userId, tokenSub.email, tokenSub.role);
        const result = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [resolved.userId]);
        if (result.rows.length > 0) {
          user = result.rows[0];
        } else {
          const insertUser = await client.query(
            "INSERT INTO auth.users (id, email) VALUES ($1, 'owner@simplify.com') ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id RETURNING id, email",
            [resolved.userId]
          );
          user = insertUser.rows[0];
        }
      } else {
        const input = (body.email || body.phone || '').trim().toLowerCase();
        const password = body.password ? String(body.password) : '';
        const cleanDigits = input.replace(/\D/g, '');

        // 1. Try finding member by email in public.members first
        if (input.includes('@')) {
          const memByEmail = await client.query(
            `SELECT m.id, m.business_id, m.auth_user_id, m.name, m.email, m.mobile, m.role, u.id as u_id, u.encrypted_password
             FROM public.members m
             LEFT JOIN auth.users u ON u.id = m.auth_user_id
             WHERE (LOWER(m.email) = $1 OR LOWER(u.email) = $1)
               AND m.active = true AND m.deleted_at IS NULL
             ORDER BY m.created_at ASC
             LIMIT 1`,
            [input]
          );

          if (memByEmail.rows.length > 0) {
            const member = memByEmail.rows[0];
            let memberAuthId = member.auth_user_id || member.u_id;
            if (!memberAuthId) {
              memberAuthId = crypto.randomUUID();
              await client.query('UPDATE public.members SET auth_user_id = $1 WHERE id = $2', [memberAuthId, member.id]);
            }

            // Verify password if encrypted_password exists
            if (password && member.encrypted_password) {
              const pwCheck = await client.query(
                'SELECT (encrypted_password = public.crypt($1, encrypted_password)) AS valid FROM auth.users WHERE id = $2',
                [password, memberAuthId]
              );
              if (pwCheck.rows.length > 0 && !pwCheck.rows[0].valid) {
                sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid email or password' });
                return;
              }
            }

            user = { id: memberAuthId, email: member.email || input, role: member.role };
          }
        }

        // 2. Try finding member by mobile number next (e.g. 9876543210 or 919876543210@simplify.local)
        if (cleanDigits.length >= 10) {
          const mobile10 = cleanDigits.slice(-10);
          const memberRes = await client.query(
            `SELECT id, business_id, auth_user_id, name, mobile, role 
             FROM public.members 
             WHERE (mobile = $1 OR mobile = $2) AND active = true AND deleted_at IS NULL 
             ORDER BY created_at ASC 
             LIMIT 1`,
            [mobile10, cleanDigits]
          );

          if (memberRes.rows.length > 0) {
            const member = memberRes.rows[0];
            let memberAuthId = member.auth_user_id;
            const syntheticEmail = `91${member.mobile}@simplify.local`;

            if (!memberAuthId) {
              memberAuthId = crypto.randomUUID();
              await client.query('UPDATE public.members SET auth_user_id = $1 WHERE id = $2', [memberAuthId, member.id]);
            }

            // Ensure auth.users has this exact user ID
            const userCheck = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [memberAuthId]);
            if (userCheck.rows.length > 0) {
              user = userCheck.rows[0];
            } else {
              // Delete any conflict on email first if it had another random id
              await client.query('DELETE FROM auth.users WHERE LOWER(email) = $1', [syntheticEmail.toLowerCase()]);
              const insertRes = await client.query(
                'INSERT INTO auth.users (id, email) VALUES ($1, $2) RETURNING id, email',
                [memberAuthId, syntheticEmail]
              );
              user = insertRes.rows[0];
            }
          }
        }

        // 2. If not found by mobile, search auth.users by email directly
        if (!user && input) {
          const result = await client.query('SELECT id, email FROM auth.users WHERE LOWER(email) = $1', [input]);
          if (result.rows.length > 0) {
            const foundUser = result.rows[0];
            // Check if linked to a member
            const memberRes = await client.query('SELECT id, auth_user_id FROM public.members WHERE auth_user_id = $1', [foundUser.id]);
            if (memberRes.rows.length > 0) {
              user = foundUser;
            } else if (input === 'owner@simplify.com') {
              // Link owner@simplify.com to primary OWNER member
              const ownerMemberRes = await client.query("SELECT id, auth_user_id FROM public.members WHERE role = 'OWNER' ORDER BY created_at ASC LIMIT 1");
              if (ownerMemberRes.rows.length > 0) {
                const ownerMember = ownerMemberRes.rows[0];
                if (ownerMember.auth_user_id) {
                  const linkedAuth = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [ownerMember.auth_user_id]);
                  user = linkedAuth.rows[0] || { id: ownerMember.auth_user_id, email: input };
                } else {
                  await client.query('UPDATE public.members SET auth_user_id = $1 WHERE id = $2', [foundUser.id, ownerMember.id]);
                  user = foundUser;
                }
              } else {
                user = foundUser;
              }
            } else {
              user = foundUser;
            }
          }
        }
        // 3. Fallback for staff login in dev
        if (!user && (input.includes('staff') || input === 'staff@simplify.com')) {
          const staffMemberRes = await client.query("SELECT id, auth_user_id FROM public.members WHERE role = 'STAFF' AND active = true ORDER BY created_at ASC LIMIT 1");
          if (staffMemberRes.rows.length > 0) {
            const staffMember = staffMemberRes.rows[0];
            let staffAuthId = staffMember.auth_user_id || '22222222-2222-2222-2222-222222222222';
            user = { id: staffAuthId, email: 'staff@simplify.com', role: 'STAFF' };
          }
        }

        // 4. Fallback for owner login in dev
        if (!user && (input.includes('owner') || input.includes('simplify.com') || !input)) {
          const ownerMemberRes = await client.query("SELECT id, auth_user_id FROM public.members WHERE role = 'OWNER' ORDER BY created_at ASC LIMIT 1");
          if (ownerMemberRes.rows.length > 0) {
            const ownerMember = ownerMemberRes.rows[0];
            let ownerAuthId = ownerMember.auth_user_id;
            if (!ownerAuthId) {
              ownerAuthId = crypto.randomUUID();
              await client.query('UPDATE public.members SET auth_user_id = $1 WHERE id = $2', [ownerAuthId, ownerMember.id]);
            }
            // Check if user already exists in auth.users by ID
            const existingById = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [ownerAuthId]);
            if (existingById.rows.length > 0) {
              user = existingById.rows[0];
            } else {
              // Check if user exists by email
              const existingByEmail = await client.query("SELECT id, email FROM auth.users WHERE LOWER(email) = 'owner@simplify.com'");
              if (existingByEmail.rows.length > 0) {
                user = existingByEmail.rows[0];
                await client.query('UPDATE public.members SET auth_user_id = $1 WHERE id = $2', [user.id, ownerMember.id]);
              } else {
                try {
                  const insertRes = await client.query(
                    "INSERT INTO auth.users (id, email) VALUES ($1, 'owner@simplify.com') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email RETURNING id, email",
                    [ownerAuthId]
                  );
                  user = insertRes.rows[0] || { id: ownerAuthId, email: 'owner@simplify.com' };
                } catch {
                  user = { id: ownerAuthId, email: 'owner@simplify.com' };
                }
              }
            }
          }
        }
      }

      if (!user) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const token = signJwt({
        sub: user.id,
        email: user.email,
        role: 'authenticated',
        aud: 'authenticated',
        exp: nowSec + 86400 * 7,
      });

      sendJson(res, 200, {
        access_token: token,
        token_type: 'bearer',
        expires_in: 86400 * 7,
        refresh_token: token,
        user: {
          id: user.id,
          aud: 'authenticated',
          role: 'authenticated',
          email: user.email,
          user_metadata: {},
          app_metadata: { provider: 'email', providers: ['email'] },
        },
      });
    } finally {
      await client.end();
    }
    return;
  }

  if (pathname === '/auth/v1/user' && req.method === 'GET') {
    const client = await getPgClient();
    try {
      const resolved = await resolveEffectiveUser(client, userId, email, role);
      let result = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [resolved.userId]);
      let user = result.rows[0];
      if (!user) {
        const existingEmail = await client.query("SELECT id, email FROM auth.users WHERE LOWER(email) = 'owner@simplify.com'");
        if (existingEmail.rows.length > 0) {
          user = existingEmail.rows[0];
        } else {
          try {
            const insertRes = await client.query(
              "INSERT INTO auth.users (id, email) VALUES ($1, 'owner@simplify.com') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email RETURNING id, email",
              [resolved.userId]
            );
            user = insertRes.rows[0] || { id: resolved.userId, email: 'owner@simplify.com' };
          } catch {
            user = { id: resolved.userId, email: 'owner@simplify.com' };
          }
        }
      }
      sendJson(res, 200, {
        id: user.id,
        aud: 'authenticated',
        role: resolved.role,
        email: user.email || 'owner@simplify.com',
        user_metadata: {},
        app_metadata: { provider: 'email', providers: ['email'] },
      });
    } finally {
      await client.end();
    }
    return;
  }

  if (pathname === '/auth/v1/user' && req.method === 'PUT') {
    const body = await readBody(req);
    const client = await getPgClient();
    try {
      const resolved = await resolveEffectiveUser(client, userId, email, role);
      if (body.password) {
        if (String(body.password).length < 6) {
          sendJson(res, 400, { error: 'validation_error', message: 'Password must be at least 6 characters' });
          return;
        }
        await client.query(
          "UPDATE auth.users SET encrypted_password = public.crypt($1, public.gen_salt('bf')), updated_at = now() WHERE id = $2",
          [body.password, resolved.userId]
        );
      }
      if (body.data?.name && typeof body.data.name === 'string' && body.data.name.trim().length >= 2) {
        await client.query(
          "UPDATE public.members SET name = $1, updated_at = now() WHERE auth_user_id = $2",
          [body.data.name.trim(), resolved.userId]
        );
      }
      const userRes = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [resolved.userId]);
      const u = userRes.rows[0] || { id: resolved.userId, email: email || 'owner@simplify.com' };
      sendJson(res, 200, {
        id: u.id,
        aud: 'authenticated',
        role: resolved.role,
        email: u.email,
        user_metadata: {},
        app_metadata: { provider: 'email', providers: ['email'] },
      });
    } finally {
      await client.end();
    }
    return;
  }

  if (pathname === '/auth/v1/signup' && req.method === 'POST') {
    const body = await readBody(req);
    const email = body.email;
    const client = await getPgClient();
    try {
      const newId = crypto.randomUUID();
      const result = await client.query(
        'INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET updated_at = now() RETURNING id, email',
        [newId, email]
      );
      const user = result.rows[0];
      const nowSec = Math.floor(Date.now() / 1000);
      const token = signJwt({
        sub: user.id,
        email: user.email,
        role: 'authenticated',
        aud: 'authenticated',
        exp: nowSec + 86400 * 7,
      });
      sendJson(res, 200, {
        access_token: token,
        token_type: 'bearer',
        expires_in: 86400 * 7,
        refresh_token: token,
        user: {
          id: user.id,
          aud: 'authenticated',
          role: 'authenticated',
          email: user.email,
          user_metadata: {},
          app_metadata: { provider: 'email', providers: ['email'] },
        },
      });
    } finally {
      await client.end();
    }
    return;
  }

  if (pathname === '/auth/v1/logout' && req.method === 'POST') {
    sendJson(res, 200, {});
    return;
  }

  // --- 2. POSTGREST RPC ENDPOINTS ---
  if (pathname.startsWith('/rest/v1/rpc/')) {
    const funcName = pathname.replace('/rest/v1/rpc/', '');
    const body = await readBody(req);
    const client = await getPgClient();

    try {
      const resolved = await resolveEffectiveUser(client, userId, email, role);
      await client.query('BEGIN');
      if (resolved.userId) {
        await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [resolved.userId]);
        await client.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [resolved.role || 'authenticated']);
        await client.query(`SET LOCAL ROLE authenticated`);
      } else {
        await client.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
        await client.query(`SELECT set_config('request.jwt.claim.role', 'anon', true)`);
        await client.query(`SET LOCAL ROLE anon`);
      }

      const keys = Object.keys(body);
      let queryStr = '';
      let values: any[] = [];

      if (keys.length === 0) {
        queryStr = `SELECT public.${funcName}() as result`;
      } else {
        const args: string[] = [];
        keys.forEach((k, idx) => {
          const val = body[k];
          const placeholder = `$${idx + 1}`;
          if (val !== null && typeof val === 'object') {
            args.push(`"${k}" => ${placeholder}::jsonb`);
            values.push(JSON.stringify(val));
          } else {
            args.push(`"${k}" => ${placeholder}`);
            values.push(val);
          }
        });
        queryStr = `SELECT public.${funcName}(${args.join(', ')}) as result`;
      }

      const resDb = await client.query(queryStr, values);
      await client.query('COMMIT');

      const result = resDb.rows.length > 0 ? resDb.rows[0].result : null;
      sendJson(res, 200, result);
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`RPC error in ${funcName}:`, err.message);
      sendJson(res, 400, { code: err.code || 'P0001', message: err.message, details: err.detail });
    } finally {
      await client.end();
    }
    return;
  }

  // --- 3. POSTGREST TABLE ENDPOINTS ---
  if (pathname.startsWith('/rest/v1/')) {
    const table = pathname.replace('/rest/v1/', '').split('?')[0];
    const client = await getPgClient();

    try {
      const resolved = await resolveEffectiveUser(client, userId, email, role);
      await client.query('BEGIN');
      if (resolved.userId) {
        await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [resolved.userId]);
        await client.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [resolved.role || 'authenticated']);
        await client.query(`SET LOCAL ROLE authenticated`);
      } else {
        await client.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
        await client.query(`SELECT set_config('request.jwt.claim.role', 'anon', true)`);
        await client.query(`SET LOCAL ROLE anon`);
      }

      if (req.method === 'GET') {
        const selectParam = reqUrl.searchParams.get('select') || '*';
        const orderParam = reqUrl.searchParams.get('order');
        const limitParam = reqUrl.searchParams.get('limit');
        const offsetParam = reqUrl.searchParams.get('offset');

        const conditions: string[] = [];
        const values: any[] = [];
        let pIndex = 1;

        reqUrl.searchParams.forEach((val, key) => {
          if (['select', 'order', 'limit', 'offset'].includes(key)) return;

          if (key === 'or') {
            const rawOr = val.replace(/^\(|\)$/g, '');
            const subConds = rawOr.split(',').map(part => {
              const segs = part.split('.');
              const cName = segs[0];
              const op = segs[1];
              const searchVal = segs.slice(2).join('.');
              if (op === 'ilike') {
                values.push(searchVal);
                return `"${cName}" ILIKE $${pIndex++}`;
              }
              if (op === 'eq') {
                values.push(searchVal);
                return `"${cName}" = $${pIndex++}`;
              }
              return '';
            }).filter(Boolean);
            if (subConds.length > 0) {
              conditions.push(`(${subConds.join(' OR ')})`);
            }
            return;
          }

          if (val === 'is.null') {
            conditions.push(`"${key}" IS NULL`);
          } else if (val === 'is.not.null') {
            conditions.push(`"${key}" IS NOT NULL`);
          } else if (val.startsWith('eq.')) {
            conditions.push(`"${key}" = $${pIndex++}`);
            values.push(val.slice(3));
          } else if (val.startsWith('neq.')) {
            conditions.push(`"${key}" != $${pIndex++}`);
            values.push(val.slice(4));
          } else if (val.startsWith('gt.')) {
            conditions.push(`"${key}" > $${pIndex++}`);
            values.push(val.slice(3));
          } else if (val.startsWith('gte.')) {
            conditions.push(`"${key}" >= $${pIndex++}`);
            values.push(val.slice(4));
          } else if (val.startsWith('lt.')) {
            conditions.push(`"${key}" < $${pIndex++}`);
            values.push(val.slice(3));
          } else if (val.startsWith('lte.')) {
            conditions.push(`"${key}" <= $${pIndex++}`);
            values.push(val.slice(4));
          } else if (val.startsWith('ilike.')) {
            conditions.push(`"${key}" ILIKE $${pIndex++}`);
            values.push(val.slice(6));
          } else if (val.startsWith('like.')) {
            conditions.push(`"${key}" LIKE $${pIndex++}`);
            values.push(val.slice(5));
          }
        });

        // RBAC Enforce: Staff can only query their own invoices
        if (table === 'invoices' && resolved.role === 'STAFF' && resolved.userId) {
          const memRes = await client.query(
            'SELECT id FROM public.members WHERE auth_user_id = $1 AND active = true LIMIT 1',
            [resolved.userId]
          );
          if (memRes.rows.length > 0) {
            const staffMemberId = memRes.rows[0].id;
            if (!conditions.some((c) => c.includes('"created_by"'))) {
              conditions.push(`"created_by" = $${pIndex++}`);
              values.push(staffMemberId);
            }
          }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const orderParams = reqUrl.searchParams.getAll('order');
        let orderClause = '';
        if (orderParams.length > 0) {
          const parts: string[] = [];
          orderParams.forEach(param => {
            param.split(',').forEach(item => {
              const [col, dir] = item.split('.');
              if (col) {
                parts.push(`"${col}" ${dir?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`);
              }
            });
          });
          if (parts.length > 0) {
            orderClause = `ORDER BY ${parts.join(', ')}`;
          }
        }

        let limitClause = '';
        if (limitParam) limitClause += ` LIMIT ${parseInt(limitParam, 10)}`;
        if (offsetParam) limitClause += ` OFFSET ${parseInt(offsetParam, 10)}`;

        // Handle nested select if present
        let querySql = '';
        if (selectParam.includes('invoice_items')) {
          querySql = `
            SELECT i.*, COALESCE((
              SELECT json_agg(it) FROM public.invoice_items it WHERE it.invoice_id = i.id
            ), '[]'::json) as invoice_items
            FROM public.${table} i
            ${whereClause} ${orderClause} ${limitClause}
          `;
        } else if (selectParam.includes('vendors(')) {
          querySql = `
            SELECT p.*, (SELECT json_build_object('id', v.id, 'name', v.name, 'mobile', v.mobile) FROM public.vendors v WHERE v.id = p.vendor_id) as vendors
            FROM public.${table} p
            ${whereClause} ${orderClause} ${limitClause}
          `;
        } else if (selectParam.includes('expense_categories(')) {
          querySql = `
            SELECT e.*, (SELECT json_build_object('id', ec.id, 'name', ec.name) FROM public.expense_categories ec WHERE ec.id = e.category_id) as expense_categories
            FROM public.${table} e
            ${whereClause} ${orderClause} ${limitClause}
          `;
        } else if (table === 'receipts') {
          querySql = `
            SELECT r.*,
              COALESCE(
                (SELECT json_build_object('name', c.name, 'mobile', c.mobile) FROM public.customers c WHERE c.id = r.customer_id),
                (SELECT json_build_object('name', i.party_name, 'mobile', i.party_mobile)
                 FROM public.receipt_allocations ra
                 JOIN public.invoices i ON i.id = ra.invoice_id
                 WHERE ra.receipt_id = r.id
                 ORDER BY ra.created_at ASC
                 LIMIT 1),
                json_build_object('name', CASE WHEN r.kind = 'OTHER_INCOME' THEN COALESCE(r.income_category, 'Other Income') ELSE 'Walk-in Customer' END, 'mobile', null)
              ) as customer,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'amount', ra.amount,
                  'invoice_number', i.number,
                  'invoice', json_build_object('number', i.number, 'party_name', i.party_name, 'party_mobile', i.party_mobile)
                ))
                FROM public.receipt_allocations ra
                JOIN public.invoices i ON i.id = ra.invoice_id
                WHERE ra.receipt_id = r.id
              ), '[]'::json) as allocations
            FROM public.receipts r
            ${whereClause} ${orderClause} ${limitClause}
          `;
        } else {
          querySql = `SELECT * FROM public.${table} ${whereClause} ${orderClause} ${limitClause}`;
        }

        const dbRes = await client.query(querySql, values);
        await client.query('COMMIT');

        const isSingle = req.headers['accept']?.includes('vnd.pgrst.object+json');
        if (isSingle) {
          sendJson(res, 200, dbRes.rows[0] || null);
        } else {
          sendJson(res, 200, dbRes.rows);
        }
        return;
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const rows = Array.isArray(body) ? body : [body];
        if (rows.length === 0) {
          sendJson(res, 201, []);
          return;
        }

        const insertedRows: any[] = [];
        for (const item of rows) {
          const keys = Object.keys(item);
          const cols = keys.map(k => `"${k}"`).join(', ');
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const vals = keys.map(k => item[k]);

          const sql = `INSERT INTO public.${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
          const insertRes = await client.query(sql, vals);
          insertedRows.push(insertRes.rows[0]);
        }

        await client.query('COMMIT');
        const isSingle = req.headers['accept']?.includes('vnd.pgrst.object+json');
        if (isSingle) {
          sendJson(res, 201, insertedRows[0] || null);
        } else {
          sendJson(res, 201, insertedRows);
        }
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readBody(req);
        let pIndex = 1;

        const setAssignments: string[] = [];
        const setValues: any[] = [];
        for (const k of Object.keys(body)) {
          setAssignments.push(`"${k}" = $${pIndex++}`);
          setValues.push(body[k]);
        }

        const conditions: string[] = [];
        const whereValues: any[] = [];
        reqUrl.searchParams.forEach((val, key) => {
          if (val.startsWith('eq.')) {
            conditions.push(`"${key}" = $${pIndex++}`);
            whereValues.push(val.slice(3));
          }
        });

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `UPDATE public.${table} SET ${setAssignments.join(', ')} ${whereClause} RETURNING *`;
        const patchRes = await client.query(sql, [...setValues, ...whereValues]);
        await client.query('COMMIT');
        const isSinglePatch = req.headers['accept']?.includes('vnd.pgrst.object+json');
        if (isSinglePatch) {
          sendJson(res, 200, patchRes.rows[0] || null);
        } else {
          sendJson(res, 200, patchRes.rows);
        }
        return;
      }

      if (req.method === 'DELETE') {
        const conditions: string[] = [];
        const values: any[] = [];
        let pIndex = 1;

        reqUrl.searchParams.forEach((val, key) => {
          if (val.startsWith('eq.')) {
            conditions.push(`"${key}" = $${pIndex++}`);
            values.push(val.slice(3));
          }
        });

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `DELETE FROM public.${table} ${whereClause}`;
        await client.query(sql, values);
        await client.query('COMMIT');
        sendJson(res, 204, null);
        return;
      }
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`Table error in ${table}:`, err.message);
      sendJson(res, 400, { message: err.message, code: err.code });
    } finally {
      await client.end();
    }
    return;
  }

  // --- 4. SUPABASE STORAGE API (Private documents & signed URLs) ---
  if (pathname.startsWith('/storage/v1/')) {
    const storageRoot = path.join(process.cwd(), '.storage');
    if (!fs.existsSync(storageRoot)) {
      fs.mkdirSync(storageRoot, { recursive: true });
    }

    // 4.1 Create Signed URL: POST /storage/v1/object/sign/:bucket/*
    const signMatch = pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (signMatch && req.method === 'POST') {
      const bucket = signMatch[1];
      const filePath = decodeURIComponent(signMatch[2]);
      const body = await readBody(req);
      const expiresIn = Number(body?.expiresIn) || 604800; // default 7 days
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
      const signature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${bucket}/${filePath}:${expiresAt}`)
        .digest('hex');
      const token = `${expiresAt}.${signature}`;
      const signedURL = `/storage/v1/object/sign/${bucket}/${encodeURIComponent(filePath).replace(/%2F/g, '/')}?token=${token}`;
      sendJson(res, 200, { signedURL });
      return;
    }

    // 4.2 Access Signed URL: GET /storage/v1/object/sign/:bucket/*
    if (signMatch && req.method === 'GET') {
      const bucket = signMatch[1];
      const filePath = decodeURIComponent(signMatch[2]);
      const token = reqUrl.searchParams.get('token');

      if (!token || !token.includes('.')) {
        sendJson(res, 403, { statusCode: 403, error: 'Unauthorized', message: 'Missing or malformed signature token' });
        return;
      }

      const [expiresAtStr, signature] = token.split('.');
      const expiresAt = parseInt(expiresAtStr, 10);
      const now = Math.floor(Date.now() / 1000);

      // Check Expiration
      if (isNaN(expiresAt) || now > expiresAt) {
        const isHtml = req.headers['accept']?.includes('text/html');
        if (isHtml) {
          res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', ...getCorsHeaders(req) });
          res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Document Link Expired - SIMPLIFY</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #F8FAFC; color: #0F172A; margin: 0; padding: 16px; }
    .card { background: #FFFFFF; border-radius: 16px; padding: 36px 28px; max-width: 440px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.06); border: 1px solid #E2E8F0; }
    .icon { width: 52px; height: 52px; background: #FFF1F2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: #E11D48; font-size: 24px; font-weight: bold; }
    h2 { font-size: 20px; font-weight: 700; color: #0F172A; margin: 0 0 8px; }
    p { font-size: 14px; color: #64748B; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">!</div>
    <h2>Document Link Expired</h2>
    <p>This secure PDF download link has expired for your protection. Please contact the business to request an updated copy of your bill or receipt.</p>
  </div>
</body>
</html>`);
          return;
        }
        sendJson(res, 403, { statusCode: 403, error: 'Expired', message: 'Signed URL has expired' });
        return;
      }

      // Check HMAC Signature
      const expectedSignature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${bucket}/${filePath}:${expiresAt}`)
        .digest('hex');

      if (signature !== expectedSignature) {
        sendJson(res, 403, { statusCode: 403, error: 'Unauthorized', message: 'Invalid signature token' });
        return;
      }

      // Serve File
      const fullPath = path.join(storageRoot, bucket, ...filePath.split('/'));
      if (!fs.existsSync(fullPath)) {
        sendJson(res, 404, { statusCode: 404, error: 'NotFound', message: 'Document not found' });
        return;
      }

      const fileBuf = fs.readFileSync(fullPath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
        'Content-Length': fileBuf.length,
        'Cache-Control': 'public, max-age=86400',
        ...getCorsHeaders(req),
      });
      res.end(fileBuf);
      return;
    }

    // 4.3 Upload Object: POST /storage/v1/object/:bucket/*
    const uploadMatch = pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (uploadMatch && req.method === 'POST') {
      const bucket = uploadMatch[1];
      const filePath = decodeURIComponent(uploadMatch[2]);
      const fileBuf = await readRawBody(req);
      const targetDir = path.join(storageRoot, bucket, ...path.dirname(filePath).split('/'));
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const fullPath = path.join(storageRoot, bucket, ...filePath.split('/'));
      fs.writeFileSync(fullPath, fileBuf);
      sendJson(res, 200, {
        Key: `${bucket}/${filePath}`,
        Id: crypto.randomUUID(),
        path: filePath,
      });
      return;
    }

    // 4.4 Public Download: GET /storage/v1/object/public/:bucket/*
    const publicMatch = pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (publicMatch && req.method === 'GET') {
      const bucket = publicMatch[1];
      const filePath = decodeURIComponent(publicMatch[2]);
      const fullPath = path.join(storageRoot, bucket, ...filePath.split('/'));
      if (!fs.existsSync(fullPath)) {
        sendJson(res, 404, { statusCode: 404, error: 'NotFound', message: 'Document not found' });
        return;
      }
      const fileBuf = fs.readFileSync(fullPath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
        'Content-Length': fileBuf.length,
        'Cache-Control': 'public, max-age=86400',
        ...getCorsHeaders(req),
      });
      res.end(fileBuf);
      return;
    }

    // 4.5 Delete Object: DELETE /storage/v1/object/:bucket/*
    if (uploadMatch && req.method === 'DELETE') {
      const bucket = uploadMatch[1];
      const filePath = decodeURIComponent(uploadMatch[2]);
      const fullPath = path.join(storageRoot, bucket, ...filePath.split('/'));
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      sendJson(res, 200, { message: 'Successfully deleted' });
      return;
    }
  }

    sendJson(res, 404, { message: 'Not found' });
  } catch (fatalErr: any) {
    console.error('[Bridge Fatal Error]', fatalErr);
    try {
      sendJson(res, 500, { message: fatalErr?.message || 'Internal bridge error' });
    } catch {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Supabase Local Dev Bridge running on port ${PORT} (dual-stack IPv4/IPv6 ready)`);
  console.log(`Connected to PostgreSQL: postgresql://${DB_USER}:***@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
});

// Also bind to IPv6 loopback if available so 'localhost' resolves seamlessly
try {
  const serverIpv6 = http.createServer((req, res) => server.emit('request', req, res));
  serverIpv6.listen(PORT, '::1', () => {
    console.log(`🚀 IPv6 loopback [::1]:${PORT} bound successfully`);
  }).on('error', () => {
    // IPv6 not available or already mapped
  });
} catch {}
