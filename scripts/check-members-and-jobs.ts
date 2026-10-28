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

  const membersRes = await client.query(`
    SELECT m.id, m.name, m.mobile, m.role, m.business_id, b.name as biz_name, m.auth_user_id
    FROM members m
    JOIN businesses b ON b.id = m.business_id
  `);
  console.log('Members:');
  console.table(membersRes.rows);

  const jobsByBiz = await client.query(`
    SELECT business_id, count(*) as job_count
    FROM jobs
    GROUP BY business_id
  `);
  console.log('Jobs by business:');
  console.table(jobsByBiz.rows);

  await client.end();
}

main().catch(console.error);
