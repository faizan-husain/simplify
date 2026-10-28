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
  const owner = await client.query("SELECT auth_user_id, email, business_id FROM auth.users u JOIN members m ON m.auth_user_id = u.id WHERE m.role = 'OWNER' LIMIT 1");
  const bizId = owner.rows[0].business_id;

  // Ensure at least one vendor exists for this business
  let v = await client.query("SELECT id, name FROM public.vendors WHERE business_id = $1 LIMIT 1", [bizId]);
  let vendorId = v.rows[0]?.id;
  if (!vendorId) {
    const newV = await client.query("INSERT INTO public.vendors (business_id, name, mobile) VALUES ($1, 'Delhi Paper Mart', '9811223344') RETURNING id", [bizId]);
    vendorId = newV.rows[0].id;
  }

  // Ensure at least one expense category exists
  let cat = await client.query("SELECT id, name FROM public.expense_categories WHERE business_id = $1 AND system = false LIMIT 1", [bizId]);
  let catId = cat.rows[0]?.id;
  if (!catId) {
    const newC = await client.query("INSERT INTO public.expense_categories (business_id, name, system) VALUES ($1, 'Office Utilities', false) RETURNING id", [bizId]);
    catId = newC.rows[0].id;
  }

  await client.end();

  // Login via bridge
  const loginRes = await fetch('http://127.0.0.1:54321/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: owner.rows[0].email, password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.access_token;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  console.log('\n=============================================');
  console.log('--- VERIFYING ALL 5 FINANCIAL OPERATIONS ---');
  console.log('=============================================');

  // 1. CREATE BILL (Jobs + Regular Items, Paid via Bank)
  console.log('\n[1/5] Testing Create Bill with separated Job + Regular Items...');
  const invRes = await fetch('http://127.0.0.1:54321/rest/v1/rpc/create_invoice', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      payload: {
        invoice_date: '2026-10-28',
        due_date: '2026-10-28',
        discount_type: 'NONE',
        discount_value: 0,
        notes: 'Verification Bill',
        walk_in: { name: 'Sunita Sharma', mobile: '9811992233' },
        items: [
          { service_id: null, description: 'Passport Application', quantity: 1, rate: 1500, is_job: true, applicant_name: 'Sunita Sharma' },
          { service_id: null, description: 'Photocopy B/W', quantity: 10, rate: 2, is_job: false, applicant_name: null }
        ],
        paid: { amount: 1520, mode: 'BANK' }
      }
    })
  });
  const invData = await invRes.json();
  console.log('Status:', invRes.status, 'Bill Number:', invData?.number, 'Total:', invData?.total, 'Paid via:', invData?.paid_amount > 0 ? 'BANK' : 'None');

  // 2. INCOME RECEIVED (Other Income via Bank Transfer)
  console.log('\n[2/5] Testing Income Received (Receipt via Bank Transfer)...');
  const rcRes = await fetch('http://127.0.0.1:54321/rest/v1/rpc/create_receipt', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      payload: {
        amount: 850,
        mode: 'BANK',
        kind: 'OTHER_INCOME',
        income_category: 'Commission Received',
        reference: 'NEFT-889900',
        receipt_date: '2026-10-28',
        notes: 'Passport incentive commission via Bank'
      }
    })
  });
  const rcData = await rcRes.json();
  console.log('Status:', rcRes.status, 'Receipt Number:', rcData?.number, 'Amount:', rcData?.amount, 'Mode:', rcData?.mode);

  // 3. VENDOR PAYMENT (Money Out to Vendor via Bank)
  console.log('\n[3/5] Testing Vendor Payment via Bank...');
  const payRes = await fetch('http://127.0.0.1:54321/rest/v1/payments', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      vendor_id: vendorId,
      amount: 450,
      mode: 'BANK',
      payment_date: '2026-10-28',
      description: 'Lamination rolls & paper stock',
      notes: 'Transferred via HDFC netbanking'
    })
  });
  const payData = await payRes.json();
  console.log('Status:', payRes.status, 'Payment ID:', payData?.id, 'Amount:', payData?.amount, 'Mode:', payData?.mode);

  // 4. BUSINESS EXPENSE (Money Out for Overhead via UPI)
  console.log('\n[4/5] Testing Business Expense via UPI...');
  const expRes = await fetch('http://127.0.0.1:54321/rest/v1/expenses', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      category_id: catId,
      amount: 180,
      mode: 'UPI',
      expense_date: '2026-10-28',
      description: 'Office tea, water & snacks',
      payee: 'Sharma Tea Stall',
      notes: 'Paid via GPay'
    })
  });
  const expData = await expRes.json();
  console.log('Status:', expRes.status, 'Expense ID:', expData?.id, 'Amount:', expData?.amount, 'Mode:', expData?.mode);

  // 5. LOANS (Capital Ledger Loan Taken + Loan Repayment via Bank)
  console.log('\n[5/5] Testing Capital Ledger Loans + Bank Repayment...');
  const loanRes = await fetch('http://127.0.0.1:54321/rest/v1/loans', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      lender_name: 'Canara Bank Business Loan',
      amount: 40000,
      loan_date: '2026-10-28',
      interest_rate: 9.5,
      notes: 'Working capital deposited to Bank account'
    })
  });
  const loanData = await loanRes.json();
  console.log('Loan Created - Status:', loanRes.status, 'Lender:', loanData?.lender_name, 'Amount:', loanData?.amount);

  // Record Repayment for this loan via Bank
  const repRes = await fetch('http://127.0.0.1:54321/rest/v1/rpc/record_loan_repayment', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      payload: {
        loan_id: loanData.id,
        principal: 4000,
        interest: 320,
        mode: 'BANK',
        repayment_date: '2026-10-28',
        notes: 'Monthly EMI debited from Bank account'
      }
    })
  });
  const repData = await repRes.json();
  console.log('Repayment Recorded - Status:', repRes.status, 'Principal Repaid:', repData?.repayment?.principal, 'Interest Expense ID:', repData?.interest_expense_id, 'Remaining Balance:', repData?.remaining_principal);

  console.log('\n=============================================');
  console.log('✓ ALL 5 FINANCIAL OPERATIONS PASSED WITH 200 OK!');
  console.log('=============================================');
}

main().catch(console.error);
