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
  const jobs = await client.query(`
    SELECT status, count(*) 
    FROM public.jobs 
    WHERE business_id = $1 
    GROUP BY status
  `, [bizId]);
  console.log('Job status counts for current logged-in business (6041db96):', jobs.rows);

  const jobsList = await client.query(`
    SELECT id, party_name, status, service_id, job_type_name, deadline_date
    FROM public.jobs 
    WHERE business_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [bizId]);
  console.log('Sample jobs in 6041db96:', jobsList.rows);

  await client.end();
}

check().catch(console.error);
