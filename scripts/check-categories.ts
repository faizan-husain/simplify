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
  const cats = await client.query('SELECT id, name, system, deleted_at FROM public.expense_categories WHERE business_id = $1', [bizId]);
  console.log('Expense categories for 6041db96:');
  console.table(cats.rows);

  const vendors = await client.query('SELECT id, name, mobile FROM public.vendors WHERE business_id = $1', [bizId]);
  console.log('Vendors for 6041db96:');
  console.table(vendors.rows);

  await client.end();
}

main().catch(console.error);
