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

  const members = await client.query(`
    SELECT m.id, m.name, m.business_id, m.auth_user_id, b.name as biz_name 
    FROM public.members m 
    JOIN public.businesses b ON b.id = m.business_id 
    WHERE m.auth_user_id IS NOT NULL
  `);
  console.log('Members with logins:', members.rows);

  // Check all job types in services table
  const services = await client.query(`
    SELECT s.id, s.name, s.business_id, b.name as biz_name, s.is_job_type, s.active
    FROM public.services s
    JOIN public.businesses b ON b.id = s.business_id
    WHERE s.is_job_type = true
  `);
  console.log('All Job Type Services:', services.rows);

  await client.end();
}

check().catch(console.error);
