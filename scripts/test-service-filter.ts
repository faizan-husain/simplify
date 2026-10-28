import { Client } from 'pg';

async function check() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });
  await client.connect();

  const bizId = '6041db96-1153-4fb3-9a9f-dadfffae0997';
  const owner = await client.query("SELECT auth_user_id FROM public.members WHERE business_id = $1 AND role = 'OWNER' LIMIT 1", [bizId]);
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner.rows[0].auth_user_id]);
  await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");

  // Get services in this business
  const srvs = await client.query("SELECT id, name FROM public.services WHERE business_id = $1 AND is_job_type = true", [bizId]);
  console.log('Services in biz:', srvs.rows);

  for (const s of srvs.rows) {
    const res = await client.query("SELECT public.list_jobs('CURRENT', $1, NULL, 50, 0, 'QUEUE') as r", [s.id]);
    console.log(`Query list_jobs for service "${s.name}" (${s.id}) -> Count: ${res.rows[0].r.jobs.length}`);
  }

  await client.end();
}

check().catch(console.error);
