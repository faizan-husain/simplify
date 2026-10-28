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
  const owner = await client.query("SELECT auth_user_id FROM public.members WHERE business_id = $1 AND role = 'OWNER' LIMIT 1", [bizId]);
  const authUserId = owner.rows[0].auth_user_id;

  console.log('Testing with authUserId:', authUserId);

  await client.query('BEGIN');
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
  await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");

  // 1. Test create_invoice RPC
  console.log('\n--- 1. Testing create_invoice ---');
  try {
    const invRes = await client.query(`
      SELECT public.create_invoice(
        $1::jsonb
      ) as res
    `, [JSON.stringify({
      invoice_date: '2026-10-28',
      due_date: '2026-10-28',
      discount_type: 'NONE',
      discount_value: 0,
      notes: 'Test bill',
      walk_in: { name: 'Test Customer', mobile: '9876543299' },
      items: [
        { service_id: null, description: 'Test Item', quantity: 2, rate: 100, is_job: false },
        { service_id: null, description: 'Test Passport', quantity: 1, rate: 1500, is_job: true, applicant_name: 'Applicant 1' }
      ],
      paid: { amount: 1700, mode: 'UPI' }
    })]);
    console.log('✓ create_invoice success:', invRes.rows[0].res.number);
  } catch (err: any) {
    console.error('✗ create_invoice error:', err.message);
  }

  // 2. Test create_receipt RPC (Income Received)
  console.log('\n--- 2. Testing create_receipt (OTHER_INCOME) ---');
  try {
    const rcRes = await client.query(`
      SELECT public.create_receipt(
        $1::jsonb
      ) as res
    `, [JSON.stringify({
      amount: 500,
      mode: 'BANK',
      kind: 'OTHER_INCOME',
      income_category: 'Commission Received',
      reference: 'TXN123456',
      receipt_date: '2026-10-28',
      notes: 'Bank deposit commission'
    })]);
    console.log('✓ create_receipt success:', rcRes.rows[0].res.number);
  } catch (err: any) {
    console.error('✗ create_receipt error:', err.message);
  }

  // 3. Test insert payment (Vendor payment)
  console.log('\n--- 3. Testing payments table insert ---');
  try {
    let vendor = await client.query("SELECT id FROM public.vendors WHERE business_id = $1 LIMIT 1", [bizId]);
    let vId = vendor.rows[0]?.id;
    if (!vId) {
      const newV = await client.query("INSERT INTO public.vendors (business_id, name, mobile) VALUES ($1, 'Test Vendor', '9812345678') RETURNING id", [bizId]);
      vId = newV.rows[0].id;
    }
    const payRes = await client.query(`
      INSERT INTO public.payments (business_id, vendor_id, amount, mode, payment_date, description, notes, fy_label)
      VALUES ($1, $2, 250, 'BANK', '2026-10-28', 'Paper purchase', 'Bank transfer', '2026-27')
      RETURNING id, amount, mode
    `, [bizId, vId]);
    console.log('✓ payments insert success:', payRes.rows[0]);
  } catch (err: any) {
    console.error('✗ payments insert error:', err.message);
  }

  // 4. Test insert expense
  console.log('\n--- 4. Testing expenses table insert ---');
  try {
    let cat = await client.query("SELECT id FROM public.expense_categories WHERE business_id = $1 AND system = false LIMIT 1", [bizId]);
    let catId = cat.rows[0]?.id;
    if (!catId) {
      const newCat = await client.query("INSERT INTO public.expense_categories (business_id, name, system) VALUES ($1, 'Office Tea', false) RETURNING id", [bizId]);
      catId = newCat.rows[0].id;
    }
    const expRes = await client.query(`
      INSERT INTO public.expenses (business_id, category_id, amount, mode, expense_date, description, fy_label)
      VALUES ($1, $2, 120, 'CASH', '2026-10-28', 'Snacks & Tea', '2026-27')
      RETURNING id, amount, mode
    `, [bizId, catId]);
    console.log('✓ expenses insert success:', expRes.rows[0]);
  } catch (err: any) {
    console.error('✗ expenses insert error:', err.message);
  }

  // 5. Test Loans and record_loan_repayment
  console.log('\n--- 5. Testing loans insert and repayment ---');
  try {
    const loanRes = await client.query(`
      INSERT INTO public.loans (business_id, lender_name, amount, loan_date, interest_rate, notes)
      VALUES ($1, 'HDFC Bank Loan', 50000, '2026-10-28', 10.5, 'Working capital loan via Bank')
      RETURNING id, lender_name, amount
    `, [bizId]);
    const loanId = loanRes.rows[0].id;
    console.log('✓ loan insert success:', loanRes.rows[0]);

    // Repayment
    const repRes = await client.query(`
      SELECT public.record_loan_repayment($1::jsonb) as res
    `, [JSON.stringify({
      loan_id: loanId,
      principal: 5000,
      interest: 450,
      mode: 'BANK',
      repayment_date: '2026-10-28',
      notes: 'EMI via Bank transfer'
    })]);
    console.log('✓ record_loan_repayment success:', repRes.rows[0].res);
  } catch (err: any) {
    console.error('✗ loans error:', err.message);
  }

  await client.query('ROLLBACK');
  await client.end();
}

main().catch(console.error);
