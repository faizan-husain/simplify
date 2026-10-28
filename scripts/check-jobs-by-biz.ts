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

  const bizJobs = await client.query(`
    SELECT j.business_id, b.name as biz_name, count(*) as job_count,
           count(*) filter (where j.service_id = '0387e625-9572-4266-b69b-e0e12c621183') as srv1_count,
           count(*) filter (where j.service_id = '463af32a-3dc3-4a81-adff-52af29a87df3') as srv2_count,
           count(*) filter (where j.job_type_name ILIKE '%Passport%') as passport_count
    FROM public.jobs j
    JOIN public.businesses b ON b.id = j.business_id
    GROUP BY j.business_id, b.name
  `);
  console.log('Jobs by Business:', bizJobs.rows);

  await client.end();
}

check().catch(console.error);
