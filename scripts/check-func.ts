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

  const res = await client.query(`
    SELECT proname, proargnames, pg_get_function_identity_arguments(oid) as args
    FROM pg_proc
    WHERE proname = 'list_jobs'
  `);
  console.log('Functions named list_jobs:', res.rows);

  await client.end();
}

check().catch(console.error);
