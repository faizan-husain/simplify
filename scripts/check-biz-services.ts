import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });

  await client.connect();

  const res = await client.query(`
    SELECT b.id as biz_id, b.name as biz_name, s.id as service_id, s.name as service_name, s.is_job_type
    FROM businesses b
    JOIN services s ON s.business_id = b.id
    WHERE s.is_job_type = true
    ORDER BY b.name, s.name
  `);
  console.log('Job services across businesses:');
  console.table(res.rows);

  const jobsRes = await client.query(`
    SELECT j.id, j.business_id, j.service_id, j.job_type_name, j.party_name
    FROM jobs j
    LIMIT 10
  `);
  console.log('Sample jobs:');
  console.table(jobsRes.rows);

  await client.end();
}

main().catch(console.error);
