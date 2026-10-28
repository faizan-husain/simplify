import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import { Client } from 'pg';

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

function extractJwtSub(authHeader?: string): { userId?: string; role?: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return {};
  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { userId: payload.sub, role: payload.role || 'authenticated' };
  } catch {
    return {};
  }
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

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  const { userId, role } = extractJwtSub(req.headers['authorization']);

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
        if (tokenSub.userId) {
          const result = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [tokenSub.userId]);
          if (result.rows.length > 0) {
            user = result.rows[0];
          }
        }
      } else {
        const input = (body.email || '').trim().toLowerCase();
        let result = await client.query('SELECT id, email FROM auth.users WHERE LOWER(email) = $1', [input]);
        if (result.rows.length === 0) {
          const cleanDigits = input.replace(/\D/g, '');
          if (cleanDigits.length >= 10) {
            const memberRes = await client.query(
              `SELECT m.auth_user_id, u.email 
               FROM members m 
               JOIN auth.users u ON u.id = m.auth_user_id 
               WHERE (m.mobile = $1 OR m.mobile = $2 OR u.email = '91' || $1 || '@simplify.local')
               LIMIT 1`,
              [cleanDigits.slice(-10), cleanDigits]
            );
            if (memberRes.rows.length > 0) {
              result = { rows: [{ id: memberRes.rows[0].auth_user_id, email: memberRes.rows[0].email }] } as any;
            }
          }
        }
        if (result.rows.length > 0) {
          user = result.rows[0];
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
    if (!userId) {
      sendJson(res, 401, { error: 'unauthorized', message: 'No valid token' });
      return;
    }
    const client = await getPgClient();
    try {
      const result = await client.query('SELECT id, email FROM auth.users WHERE id = $1', [userId]);
      if (result.rows.length === 0) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      const user = result.rows[0];
      sendJson(res, 200, {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
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
      await client.query('BEGIN');
      if (userId) {
        await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await client.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [role || 'authenticated']);
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
      await client.query('BEGIN');
      if (userId) {
        await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await client.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [role || 'authenticated']);
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

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        let orderClause = '';
        if (orderParam) {
          const parts = orderParam.split(',').map(item => {
            const [col, dir] = item.split('.');
            return `"${col}" ${dir?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`;
          });
          orderClause = `ORDER BY ${parts.join(', ')}`;
        }

        let limitClause = '';
        if (limitParam) limitClause += ` LIMIT ${parseInt(limitParam, 10)}`;
        if (offsetParam) limitClause += ` OFFSET ${parseInt(offsetParam, 10)}`;

        // Handle nested select if present
        let querySql = '';
        if (selectParam.includes('invoice_items(*)')) {
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
        sendJson(res, 201, Array.isArray(body) ? insertedRows : insertedRows[0]);
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
        sendJson(res, 200, patchRes.rows);
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

  sendJson(res, 404, { message: 'Not found' });
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
