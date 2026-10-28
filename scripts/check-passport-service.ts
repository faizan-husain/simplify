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

  const bizRes = await client.query("SELECT id, name FROM public.businesses WHERE name ILIKE '%Global%' LIMIT 1");
  const biz = bizRes.rows[0];
  console.log('Business:', biz.name, biz.id);

  const services = await client.query(
    "SELECT id, name, is_job_type, deleted_at FROM public.services WHERE business_id = $1 AND name ILIKE '%Passport%'",
    [biz.id]
  );
  console.log('Services with Passport:', services.rows);

  const jobs = await client.query(
    "SELECT id, party_name, service_id, job_type_name FROM public.jobs WHERE business_id = $1 LIMIT 10",
    [biz.id]
  );
  console.log('Sample Jobs service_id vs job_type_name:', jobs.rows);

  await client.end();
}

check().catch(console.error);
