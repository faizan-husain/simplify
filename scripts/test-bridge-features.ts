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
  const owner = await client.query("SELECT auth_user_id, email FROM auth.users u JOIN members m ON m.auth_user_id = u.id WHERE m.role = 'OWNER' LIMIT 1");
  await client.end();

  console.log('Testing bridge HTTP requests for user:', owner.rows[0].email);

  // 1. Login or get token
  const loginRes = await fetch('http://127.0.0.1:54321/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: owner.rows[0].email, password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.access_token;
  console.log('Bridge Login Status:', loginRes.status, 'Has token:', Boolean(token));

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 2. Test create_invoice via bridge
  const invRes = await fetch('http://127.0.0.1:54321/rest/v1/rpc/create_invoice', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      payload: {
        invoice_date: '2026-10-28',
        due_date: '2026-10-28',
        discount_type: 'NONE',
        discount_value: 0,
        notes: 'Bridge test bill',
        walk_in: { name: 'Bridge Customer', mobile: '9876543219' },
        items: [
          { service_id: null, description: 'Normal Photocopy', quantity: 5, rate: 2, is_job: false },
          { service_id: null, description: 'Passport Work', quantity: 1, rate: 1200, is_job: true, applicant_name: 'Bridge Applicant' }
        ],
        paid: { amount: 1210, mode: 'BANK' }
      }
    })
  });
  const invData = await invRes.json();
  console.log('Bridge create_invoice status:', invRes.status, invData?.number || invData);

  // 3. Test payments insert via bridge
  const payRes = await fetch('http://127.0.0.1:54321/rest/v1/payments', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      amount: 150,
      mode: 'BANK',
      payment_date: '2026-10-28',
      description: 'Vendor payment test',
      notes: 'Via Bank'
    })
  });
  console.log('Bridge payments insert status:', payRes.status, await payRes.json());

  // 4. Test expenses insert via bridge
  const expRes = await fetch('http://127.0.0.1:54321/rest/v1/expenses', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      amount: 80,
      mode: 'UPI',
      expense_date: '2026-10-28',
      description: 'Tea expense test',
      notes: 'UPI payment'
    })
  });
  console.log('Bridge expenses insert status:', expRes.status, await expRes.json());

  // 5. Test loans insert via bridge
  const loanRes = await fetch('http://127.0.0.1:54321/rest/v1/loans', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      lender_name: 'SBI Bank',
      amount: 25000,
      loan_date: '2026-10-28',
      notes: 'Bank loan'
    })
  });
  console.log('Bridge loans insert status:', loanRes.status, await loanRes.json());
}

main().catch(console.error);
