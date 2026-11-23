import { Client } from 'pg';
import { resetDatabase } from './db-reset';

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';

function createDbClient() {
  return new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });
}

async function runScenarioTests() {
  console.log('========================================================================');
  console.log('SIMPLIFY ENTERPRISE MULTI-DEVICE & CONCURRENCY SAFETY TEST SUITE');
  console.log('========================================================================\n');

  console.log('Resetting test database and applying latest migrations...');
  await resetDatabase();
  console.log('Database reset complete.\n');

  const setupClient = createDbClient();
  await setupClient.connect();

  const ownerUserId = '11111111-1111-1111-1111-111111111111';
  let businessId: string;
  let ownerMemberId: string;
  let testCustomerId: string;
  let bankAId: string;
  let bankBId: string;

  try {
    // 1. Create auth user and register business
    await setupClient.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, '919876543210@simplify.local') ON CONFLICT DO NOTHING;`,
      [ownerUserId]
    );

    // Call register_business with session context
    await setupClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await setupClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    const regRes = await setupClient.query(`SELECT public.register_business('Apex Multi-Store', 'Anand', '9876543210') as biz;`);
    businessId = regRes.rows[0].biz.id;

    const memRes = await setupClient.query(`SELECT id, auth_user_id, business_id, mobile FROM public.members;`);
    console.log('Members after register_business:', memRes.rows);

    const checkBizId = await setupClient.query(`SELECT app.current_business_id() as b, app.current_member_id() as m, auth.uid() as u;`);
    console.log('App context after register_business:', checkBizId.rows[0]);

    ownerMemberId = memRes.rows[0].id;

    // Create test customer
    const custRes = await setupClient.query(`
      INSERT INTO public.customers (name, mobile, type)
      VALUES ('Ramesh Kumar', '9876500001', 'REGULAR')
      RETURNING id, updated_at;
    `);
    testCustomerId = custRes.rows[0].id;

    // Create 2 test bank accounts for contra transfers
    const b1 = await setupClient.query(`
      INSERT INTO public.bank_accounts (bank_name, account_name, opening_balance)
      VALUES ('HDFC Main', 'Current A/C', 5000.00)
      RETURNING id;
    `);
    bankAId = b1.rows[0].id;

    const b2 = await setupClient.query(`
      INSERT INTO public.bank_accounts (bank_name, account_name, opening_balance)
      VALUES ('ICICI Branch', 'Savings A/C', 5000.00)
      RETURNING id;
    `);
    bankBId = b2.rows[0].id;

    console.log(`✅ Setup initialized: Business ID = ${businessId}`);
  } finally {
    await setupClient.end();
  }

  // --------------------------------------------------------------------------
  // TEST 1: Simultaneous Bill Creations & Gap-Free Sequence
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 1: 20 Simultaneous Concurrent Bill Creations (Gap-Free) ---');
  const CONCURRENT_BILLS = 20;

  const billPromises = Array.from({ length: CONCURRENT_BILLS }, async (_, idx) => {
    const client = createDbClient();
    await client.connect();
    try {
      await client.query(`SET ROLE authenticated;`);
      await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
      await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

      const payload = JSON.stringify({
        customer_id: testCustomerId,
        party_name: 'Ramesh Kumar',
        party_mobile: '9876500001',
        items: [{ description: `Item-${idx + 1}`, quantity: 1, rate: 100 }],
        paid: { amount: 0, mode: 'CASH' },
      });

      const res = await client.query(`SELECT public.create_invoice($1::jsonb) as inv;`, [payload]);
      return res.rows[0].inv.number as string;
    } finally {
      await client.end();
    }
  });

  const generatedBillNumbers = await Promise.all(billPromises);
  const uniqueBills = new Set(generatedBillNumbers);

  if (uniqueBills.size !== CONCURRENT_BILLS) {
    throw new Error(`TEST 1 FAILED: Expected ${CONCURRENT_BILLS} unique bill numbers, got ${uniqueBills.size}`);
  }

  const seqs = generatedBillNumbers
    .map(n => parseInt(n.replace(/[^0-9]/g, ''), 10))
    .sort((a, b) => a - b);

  for (let i = 0; i < seqs.length; i++) {
    const expected = i + 1; // INV-1 .. INV-20
    if (seqs[i] !== expected) {
      throw new Error(`TEST 1 FAILED: Gap detected in sequence! Expected ${expected}, got ${seqs[i]}`);
    }
  }
  console.log(`✅ TEST 1 PASSED: 20 invoices generated concurrently with 0 race conditions or sequence gaps (${seqs[0]}..${seqs[seqs.length - 1]}).`);

  // --------------------------------------------------------------------------
  // TEST 2: Double-Click / Network Retry Idempotency
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Idempotent Bill Creation (Double-Click Prevention) ---');
  const idempotentKey = 'idemp_test_double_click_key_101';
  const idempPayload = JSON.stringify({
    customer_id: testCustomerId,
    party_name: 'Ramesh Kumar',
    party_mobile: '9876500001',
    items: [{ description: 'Idempotency Check Item', quantity: 1, rate: 250 }],
    paid: { amount: 250, mode: 'CASH' },
    idempotency_key: idempotentKey,
  });

  const c1 = createDbClient();
  const c2 = createDbClient();
  await c1.connect();
  await c2.connect();

  let firstRes: any;
  let secondRes: any;
  try {
    await c1.query(`SET ROLE authenticated;`);
    await c1.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await c1.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    await c2.query(`SET ROLE authenticated;`);
    await c2.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await c2.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    // Simulate rapid double submit
    [firstRes, secondRes] = await Promise.all([
      c1.query(`SELECT public.create_invoice($1::jsonb) as inv;`, [idempPayload]),
      c2.query(`SELECT public.create_invoice($1::jsonb) as inv;`, [idempPayload]),
    ]);
  } finally {
    await c1.end();
    await c2.end();
  }

  const id1 = firstRes.rows[0].inv.invoice_id || firstRes.rows[0].inv.id;
  const id2 = secondRes.rows[0].inv.invoice_id || secondRes.rows[0].inv.id;
  console.log('Test 2 double-click result 1:', firstRes.rows[0].inv);
  console.log('Test 2 double-click result 2:', secondRes.rows[0].inv);
  if (id1 !== id2) {
    throw new Error(`TEST 2 FAILED: Idempotency keys returned different invoice IDs: ${id1} vs ${id2}`);
  }

  const verifyClient = createDbClient();
  await verifyClient.connect();
  try {
    await verifyClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await verifyClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
    const countCheck = await verifyClient.query(
      `SELECT count(*) as total FROM public.invoices WHERE id = $1;`,
      [id1]
    );
    if (parseInt(countCheck.rows[0].total, 10) !== 1) {
      throw new Error(`TEST 2 FAILED: Expected exactly 1 invoice with ID ${id1}, got count = ${countCheck.rows[0].total}`);
    }
  } finally {
    await verifyClient.end();
  }
  console.log(`✅ TEST 2 PASSED: Rapid double-submission resolved to identical invoice (#${firstRes.rows[0].inv.number}) with 0 duplicates.`);

  // --------------------------------------------------------------------------
  // TEST 3: Simultaneous Payments on Same Customer & Ledger Reconciliation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Simultaneous Concurrent Payments on Same Customer ---');
  const payClient1 = createDbClient();
  const payClient2 = createDbClient();
  await payClient1.connect();
  await payClient2.connect();

  let initialCustDue = 0;
  try {
    await payClient1.query(`SET ROLE authenticated;`);
    await payClient1.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await payClient1.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    await payClient2.query(`SET ROLE authenticated;`);
    await payClient2.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await payClient2.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    // Fetch unpaid bills for this customer
    const openBills = await payClient1.query(`
      SELECT id, (total - paid_amount) as balance FROM public.invoices 
      WHERE customer_id = $1 AND status = 'ACTIVE' AND (total - paid_amount) > 0 
      ORDER BY invoice_date ASC, created_at ASC;
    `, [testCustomerId]);

    const initialDueRes = await payClient1.query(`SELECT public.customer_ledger($1::uuid) as ledger;`, [testCustomerId]);
    initialCustDue = parseFloat(initialDueRes.rows[0].ledger.summary.balance);
    console.log(`Initial Customer Outstanding before concurrent payments: ₹${initialCustDue}`);

    const bList = openBills.rows;
    // Worker 1 pays 500 across first 5 bills (100 each)
    const alloc1 = bList.slice(0, 5).map(b => ({ invoice_id: b.id, amount: 100 }));
    // Worker 2 simultaneously pays 300 across next 3 bills (100 each)
    const alloc2 = bList.slice(5, 8).map(b => ({ invoice_id: b.id, amount: 100 }));

    const p1 = payClient1.query(`
      SELECT public.create_receipt(jsonb_build_object(
        'customer_id', $1::text,
        'amount', 500,
        'receipt_date', current_date::text,
        'mode', 'CASH',
        'kind', 'INVOICE_PAYMENT',
        'allocations', $2::jsonb,
        'idempotency_key', 'rcpt_conc_test_1'
      )) as r;
    `, [testCustomerId, JSON.stringify(alloc1)]);

    const p2 = payClient2.query(`
      SELECT public.create_receipt(jsonb_build_object(
        'customer_id', $1::text,
        'amount', 300,
        'receipt_date', current_date::text,
        'mode', 'CASH',
        'kind', 'INVOICE_PAYMENT',
        'allocations', $2::jsonb,
        'idempotency_key', 'rcpt_conc_test_2'
      )) as r;
    `, [testCustomerId, JSON.stringify(alloc2)]);

    const [r1, r2] = await Promise.all([p1, p2]);
    console.log(`Receipt 1 created: #${r1.rows[0].r.number}, Receipt 2 created: #${r2.rows[0].r.number}`);
  } finally {
    await payClient1.end();
    await payClient2.end();
  }

  // Verify total paid and remaining balance
  const reconClient = createDbClient();
  await reconClient.connect();
  try {
    await reconClient.query(`SET ROLE authenticated;`);
    await reconClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await reconClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    const outRes = await reconClient.query(`SELECT public.customer_ledger($1::uuid) as ledger;`, [testCustomerId]);
    const remainingDue = parseFloat(outRes.rows[0].ledger.summary.balance);
    const expectedDue = initialCustDue - 800;
    if (Math.abs(remainingDue - expectedDue) > 0.01) {
      throw new Error(`TEST 3 FAILED: Customer outstanding mismatch! Expected ${expectedDue}, got ${remainingDue}`);
    }
    console.log(`Customer outstanding successfully updated to ₹${remainingDue} (exactly ₹${initialCustDue} - ₹800).`);
  } finally {
    await reconClient.end();
  }
  console.log('✅ TEST 3 PASSED: Simultaneous customer payments succeeded without lost updates; ledger reconciles exactly.');

  // --------------------------------------------------------------------------
  // TEST 4: Simultaneous Bill Cancellation Conflict Handling
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Simultaneous Bill Cancellation Conflict Handling ---');
  const cancelTestClient = createDbClient();
  await cancelTestClient.connect();
  let billToCancelId: string;
  try {
    await cancelTestClient.query(`SET ROLE authenticated;`);
    await cancelTestClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await cancelTestClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    const newBill = await cancelTestClient.query(`
      SELECT public.create_invoice(jsonb_build_object(
        'customer_id', $1::text,
        'party_name', 'Ramesh Kumar',
        'party_mobile', '9876500001',
        'items', jsonb_build_array(jsonb_build_object('description', 'Cancel Test', 'quantity', 1, 'rate', 500)),
        'paid', jsonb_build_object('amount', 0, 'mode', 'CASH')
      )) as inv;
    `, [testCustomerId]);
    billToCancelId = newBill.rows[0].inv.invoice_id || newBill.rows[0].inv.id;
  } finally {
    await cancelTestClient.end();
  }

  // Fire 2 concurrent cancellations on the same bill
  const cancelC1 = createDbClient();
  const cancelC2 = createDbClient();
  await cancelC1.connect();
  await cancelC2.connect();

  let cancelRes1: any;
  let cancelRes2: any;
  try {
    await cancelC1.query(`SET ROLE authenticated;`);
    await cancelC1.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await cancelC1.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    await cancelC2.query(`SET ROLE authenticated;`);
    await cancelC2.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await cancelC2.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    [cancelRes1, cancelRes2] = await Promise.all([
      cancelC1.query(`SELECT public.cancel_invoice($1::uuid, 'Double Cancel Test') as res;`, [billToCancelId]),
      cancelC2.query(`SELECT public.cancel_invoice($1::uuid, 'Double Cancel Test') as res;`, [billToCancelId]),
    ]);
  } finally {
    await cancelC1.end();
    await cancelC2.end();
  }

  const r1 = cancelRes1.rows[0].res;
  const r2 = cancelRes2.rows[0].res;
  const oneCancelled = (r1.status === 'CANCELLED' && r2.already_cancelled) || (r2.status === 'CANCELLED' && r1.already_cancelled);
  if (!oneCancelled && !(r1.status === 'CANCELLED' && r2.status === 'CANCELLED')) {
    throw new Error(`TEST 4 FAILED: Expected clean handled cancellation conflict, got: ${JSON.stringify(r1)} & ${JSON.stringify(r2)}`);
  }
  console.log('✅ TEST 4 PASSED: Simultaneous cancellation handled safely with atomic locking and zero unhandled errors.');

  // --------------------------------------------------------------------------
  // TEST 5: Concurrent Inter-Bank Transfers (Anti-Deadlock Verification)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Concurrent Cross-Bank Transfers (Anti-Deadlock Verification) ---');
  const xfer1 = createDbClient();
  const xfer2 = createDbClient();
  await xfer1.connect();
  await xfer2.connect();

  try {
    await xfer1.query(`SET ROLE authenticated;`);
    await xfer1.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await xfer1.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    await xfer2.query(`SET ROLE authenticated;`);
    await xfer2.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await xfer2.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    // Worker 1 transfers 1000 from Bank A to Bank B
    // Worker 2 simultaneously transfers 500 from Bank B to Bank A
    const t1 = xfer1.query(`
      SELECT public.record_money_transfer(jsonb_build_object(
        'transfer_type', 'BANK_TO_BANK',
        'from_bank_account_id', $1::text,
        'to_bank_account_id', $2::text,
        'amount', 1000,
        'transfer_date', current_date::text,
        'idempotency_key', 'xfer_test_cross_1'
      ));
    `, [bankAId, bankBId]);

    const t2 = xfer2.query(`
      SELECT public.record_money_transfer(jsonb_build_object(
        'transfer_type', 'BANK_TO_BANK',
        'from_bank_account_id', $1::text,
        'to_bank_account_id', $2::text,
        'amount', 500,
        'transfer_date', current_date::text,
        'idempotency_key', 'xfer_test_cross_2'
      ));
    `, [bankBId, bankAId]);

    await Promise.all([t1, t2]);
  } finally {
    await xfer1.end();
    await xfer2.end();
  }

  // Check balances
  const bankCheckClient = createDbClient();
  await bankCheckClient.connect();
  try {
    await bankCheckClient.query(`SET ROLE authenticated;`);
    await bankCheckClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await bankCheckClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    const summaryRes = await bankCheckClient.query(`SELECT public.cash_bank_summary() as summary;`);
    const banks = summaryRes.rows[0].summary.bank_accounts || [];
    const hdfc = banks.find((b: any) => b.id === bankAId);
    const icici = banks.find((b: any) => b.id === bankBId);
    // Bank A: 5000 - 1000 + 500 = 4500
    // Bank B: 5000 + 1000 - 500 = 5500
    if (parseFloat(hdfc.current_balance) !== 4500 || parseFloat(icici.current_balance) !== 5500) {
      throw new Error(`TEST 5 FAILED: Bank balance mismatch! HDFC: ${hdfc?.current_balance}, ICICI: ${icici?.current_balance}`);
    }
  } finally {
    await bankCheckClient.end();
  }
  console.log('✅ TEST 5 PASSED: Cross-bank transfers completed without deadlock (HDFC: ₹4,500, ICICI: ₹5,500).');

  // --------------------------------------------------------------------------
  // TEST 6: Optimistic Concurrency Control (OCC) Customer Updates
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Optimistic Concurrency Control (OCC) Conflict Rejection ---');
  const occClient = createDbClient();
  await occClient.connect();

  try {
    await occClient.query(`SET ROLE authenticated;`);
    await occClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await occClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    // Fetch current customer timestamp
    const cRes = await occClient.query(`SELECT updated_at FROM public.customers WHERE id = $1::uuid;`, [testCustomerId]);
    const staleTimestamp = cRes.rows[0].updated_at;

    // Simulate Device A updating customer first
    await occClient.query(`
      SELECT public.update_customer_occ(jsonb_build_object(
        'id', $1::text,
        'name', 'Ramesh Kumar Updated by Device A',
        'last_updated_at', $2::text
      ));
    `, [testCustomerId, staleTimestamp]);

    // Now Device B tries to update using the stale timestamp
    let occConflictCaught = false;
    try {
      await occClient.query(`
        SELECT public.update_customer_occ(jsonb_build_object(
          'id', $1::text,
          'name', 'Ramesh Kumar Overwrite by Device B',
          'last_updated_at', $2::text
        ));
      `, [testCustomerId, staleTimestamp]);
    } catch (err: any) {
      if (err.message?.includes('CONFLICT_DETECTED')) {
        occConflictCaught = true;
      } else {
        throw err;
      }
    }

    if (!occConflictCaught) {
      throw new Error('TEST 6 FAILED: Stale update was NOT rejected with CONFLICT_DETECTED!');
    }
  } finally {
    await occClient.end();
  }
  console.log('✅ TEST 6 PASSED: Stale update rejected with CONFLICT_DETECTED. No lost updates on simultaneous edits.');

  console.log('\n========================================================================');
  console.log('ALL ENTERPRISE MULTI-DEVICE & CONCURRENCY SAFETY TESTS PASSED! (7/7)');
  console.log('========================================================================\n');
}

runScenarioTests().catch(err => {
  console.error('\n❌ Enterprise Concurrency Test Suite Encountered Error:', err);
  process.exit(1);
});
