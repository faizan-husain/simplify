import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });
  try {
    await client.connect();
    const services = await client.query(`SELECT id, name, is_job_type, deadline_days, commission_percent FROM public.services WHERE deleted_at IS NULL`);
    console.log('Services:', services.rows);

    const steps = await client.query(`SELECT id, service_id, position, name, whatsapp_message FROM public.job_type_steps WHERE deleted_at IS NULL ORDER BY position`);
    console.log('Job Type Steps:', steps.rows);

    const jobs = await client.query(`SELECT id, invoice_id, job_type_name, party_name, status, created_at FROM public.jobs WHERE deleted_at IS NULL ORDER BY created_at ASC`);
    console.log('Jobs in DB:', jobs.rows);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
