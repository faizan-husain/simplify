import http from 'http';
import { Client } from 'pg';

async function main() {
  // 1. Get an auth token for the owner
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });
  await client.connect();

  const bizRes = await client.query("SELECT id, name FROM public.businesses WHERE name ILIKE '%Global%' LIMIT 1");
  const biz = bizRes.rows[0];

  const owner = await client.query("SELECT auth_user_id, business_id FROM public.members WHERE business_id = $1 AND role = 'OWNER' LIMIT 1", [biz.id]);
  const user = await client.query("SELECT id, email FROM auth.users WHERE id = $1", [owner.rows[0].auth_user_id]);
  await client.end();

  // Login via bridge to get JWT
  const loginData = JSON.stringify({ email: user.rows[0].email, password: 'password123' });
  const token = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:54321/auth/v1/token?grant_type=password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(loginData),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const parsed = JSON.parse(data);
          resolve(parsed.access_token);
        });
      }
    );
    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  console.log('Got JWT Token for', user.rows[0].email);

  // 2. Fetch job types available in services table
  const srvRes = await new Promise<any[]>((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:54321/rest/v1/services?is_job_type=eq.true&active=eq.true&deleted_at=is.null',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: 'dummy',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          resolve(JSON.parse(data));
        });
      }
    );
    req.on('error', reject);
    req.end();
  });

  console.log('Job types fetched by frontend:', srvRes.map(s => ({ id: s.id, name: s.name })));

  const passportSrv = srvRes.find(s => s.name.includes('Passport'));
  if (!passportSrv) {
    console.log('No passport service in srvRes!');
    return;
  }

  // 3. Call list_jobs RPC with p_service_id = passportSrv.id
  console.log('Calling list_jobs with p_service_id =', passportSrv.id);
  const rpcPayload = JSON.stringify({
    p_tab: 'CURRENT',
    p_service_id: passportSrv.id,
    p_search: null,
    p_limit: 100,
    p_offset: 0,
    p_sort: 'QUEUE',
  });

  const listData = await new Promise<any>((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:54321/rest/v1/rpc/list_jobs',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rpcPayload),
          Authorization: `Bearer ${token}`,
          apikey: 'dummy',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(rpcPayload);
    req.end();
  });

  console.log('Result from list_jobs with p_service_id:', listData);
}

main().catch(console.error);
