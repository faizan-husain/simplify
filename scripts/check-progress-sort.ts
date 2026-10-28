import { Client } from 'pg';

async function test() {
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
  console.log('Business:', biz.name, biz.id);

  const owner = await client.query("SELECT auth_user_id, business_id FROM public.members WHERE business_id = $1 AND role = 'OWNER' LIMIT 1", [biz.id]);
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner.rows[0].auth_user_id]);
  await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");

  const res = await client.query("SELECT public.list_jobs('CURRENT', NULL, NULL, 50, 0, 'PROGRESS') as r");
  console.log(`--- Jobs returned for ${biz.name} with PROGRESS sort (${res.rows[0].r.jobs.length} jobs): ---`);
  res.rows[0].r.jobs.forEach((j: any, i: number) => {
    console.log(`${i + 1}. [${j.job_type_name}] ${j.party_name} -> Ticked Steps: ${j.ticked_steps}/${j.total_steps} (${j.progress_percent}%) | Created: ${j.created_at}`);
  });

  await client.end();
}

test().catch(console.error);
