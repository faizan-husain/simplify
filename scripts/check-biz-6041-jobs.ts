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

  const bizId = '6041db96-1153-4fb3-9a9f-dadfffae0997';
  const jobsRes = await client.query(`
    SELECT j.id, j.status, j.service_id, j.job_type_name, j.party_name, s.name as matched_service_name
    FROM jobs j
    LEFT JOIN services s ON s.id = j.service_id
    WHERE j.business_id = $1
    LIMIT 20
  `, [bizId]);
  console.log('Jobs in biz 6041db96:');
  console.table(jobsRes.rows);

  const services = await client.query(`
    SELECT id, name, is_job_type
    FROM services
    WHERE business_id = $1
  `, [bizId]);
  console.log('Services in biz 6041db96:');
  console.table(services.rows);

  await client.end();
}

main().catch(console.error);
