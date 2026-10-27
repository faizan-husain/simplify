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

function sendJson(res: http.ServerResponse, statusCode: number, data: any, headers?: Record<string, string>) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, range',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'content-range, range',
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
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, range',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'content-range, range',
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  const { userId, role } = extractJwtSub(req.headers['authorization']);

  // --- 1. AUTH ENDPOINTS ---
  if (pathname === '/auth/v1/token' && req.method === 'POST') {
    const body = await readBody(req);
    const email = body.email;
    const client = await getPgClient();
    try {
      const result = await client.query('SELECT id, email FROM auth.users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return;
      }
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
      sendJson(res, 200, result.rows[0]);
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
        user,
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

      // Check if function has parameters
      const keys = Object.keys(body);
      let queryStr = '';
      let values: any[] = [];

      if (keys.length === 0) {
        queryStr = `SELECT public.${funcName}() as result`;
      } else if (keys.length === 1 && (keys[0] === 'payload' || typeof body[keys[0]] === 'object')) {
        queryStr = `SELECT public.${funcName}($1) as result`;
        values = [JSON.stringify(body[keys[0]])];
      } else {
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        queryStr = `SELECT public.${funcName}(${placeholders}) as result`;
        values = keys.map(k => body[k]);
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

          if (val === 'is.null') {
            conditions.push(`${key} IS NULL`);
          } else if (val === 'is.not.null') {
            conditions.push(`${key} IS NOT NULL`);
          } else if (val.startsWith('eq.')) {
            conditions.push(`${key} = $${pIndex++}`);
            values.push(val.slice(3));
          } else if (val.startsWith('neq.')) {
            conditions.push(`${key} != $${pIndex++}`);
            values.push(val.slice(4));
          } else if (val.startsWith('ilike.')) {
            conditions.push(`${key} ILIKE $${pIndex++}`);
            values.push(val.slice(6));
          }
        });

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        let orderClause = '';
        if (orderParam) {
          const [col, dir] = orderParam.split('.');
          orderClause = `ORDER BY ${col} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
        }
        let limitClause = '';
        if (limitParam) limitClause += ` LIMIT ${parseInt(limitParam, 10)}`;
        if (offsetParam) limitClause += ` OFFSET ${parseInt(offsetParam, 10)}`;

        // Handle nested select if present (e.g. invoice_items(*))
        let querySql = '';
        if (selectParam.includes('invoice_items(*)')) {
          querySql = `
            SELECT i.*, COALESCE((
              SELECT json_agg(it) FROM public.invoice_items it WHERE it.invoice_id = i.id
            ), '[]'::json) as invoice_items
            FROM public.${table} i
            ${whereClause} ${orderClause} ${limitClause}
          `;
        } else if (selectParam.includes('vendors(name)')) {
          querySql = `
            SELECT p.*, (SELECT json_build_object('name', v.name) FROM public.vendors v WHERE v.id = p.vendor_id) as vendors
            FROM public.${table} p
            ${whereClause} ${orderClause} ${limitClause}
          `;
        } else if (selectParam.includes('expense_categories(name)')) {
          querySql = `
            SELECT e.*, (SELECT json_build_object('name', ec.name) FROM public.expense_categories ec WHERE ec.id = e.category_id) as expense_categories
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
          const cols = keys.join(', ');
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
        const conditions: string[] = [];
        const values: any[] = [];
        let pIndex = 1;

        reqUrl.searchParams.forEach((val, key) => {
          if (val.startsWith('eq.')) {
            conditions.push(`${key} = $${pIndex++}`);
            values.push(val.slice(3));
          }
        });

        const setAssignments: string[] = [];
        for (const k of Object.keys(body)) {
          setAssignments.push(`${k} = $${pIndex++}`);
          values.push(body[k]);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `UPDATE public.${table} SET ${setAssignments.join(', ')} ${whereClause} RETURNING *`;
        const patchRes = await client.query(sql, values);
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
            conditions.push(`${key} = $${pIndex++}`);
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
  console.log(`🚀 Supabase Local Dev Bridge running on http://127.0.0.1:${PORT}`);
  console.log(`Connected to PostgreSQL: postgresql://${DB_USER}:***@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
});
