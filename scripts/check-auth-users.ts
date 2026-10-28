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

  const users = await client.query("SELECT id, email FROM auth.users");
  console.log('auth.users:', users.rows);

  const members = await client.query("SELECT id, name, mobile, role, auth_user_id, business_id FROM public.members");
  console.log('members:', members.rows);

  await client.end();
}

check().catch(console.error);
