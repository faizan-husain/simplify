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
    businessId = checkBizId.rows[0].b;

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
  let cancelSuccess = false;
  let cancelConflictCaught = false;
  try {

    const p1 = cancelC1.query(`SELECT public.cancel_invoice($1::uuid, 'Double Cancel Test') as res;`, [billToCancelId])
      .then((r) => { cancelSuccess = true; return r.rows[0].res; })
      .catch((e: any) => {
        if (e.message?.includes('INVOICE_ALREADY_CANCELLED')) {
          cancelConflictCaught = true;
          return { already_cancelled: true };
        }
        throw e;
      });

    const p2 = cancelC2.query(`SELECT public.cancel_invoice($1::uuid, 'Double Cancel Test') as res;`, [billToCancelId])
      .then((r) => { cancelSuccess = true; return r.rows[0].res; })
      .catch((e: any) => {
        if (e.message?.includes('INVOICE_ALREADY_CANCELLED')) {
          cancelConflictCaught = true;
          return { already_cancelled: true };
        }
        throw e;
      });

    [cancelRes1, cancelRes2] = await Promise.all([p1, p2]);
  } finally {
    await cancelC1.end();
    await cancelC2.end();
  }

  if (!cancelSuccess || !cancelConflictCaught) {
    throw new Error(`TEST 4 FAILED: Expected 1 cancellation to succeed and the second to raise INVOICE_ALREADY_CANCELLED conflict. Got cancelSuccess=${cancelSuccess}, conflictCaught=${cancelConflictCaught}`);
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

  // --------------------------------------------------------------------------
  // TEST 7: Concurrent apply_advance & Advance Balance Race Safety
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Concurrent apply_advance & Advance Overdraft Prevention ---');
  const advClient1 = createDbClient();
  const advClient2 = createDbClient();
  await advClient1.connect();
  await advClient2.connect();

  try {
    await advClient1.query(`SET ROLE authenticated;`);
    await advClient1.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await advClient1.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    await advClient2.query(`SET ROLE authenticated;`);
    await advClient2.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await advClient2.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    // 1. Create a customer with 0 initial dues for advance test
    const advCustRes = await advClient1.query(`
      INSERT INTO public.customers (name, mobile, type)
      VALUES ('Suresh Advance', '9876500099', 'REGULAR')
      RETURNING id;
    `);
    const advCustomerId = advCustRes.rows[0].id;

    // 2. Create an advance receipt of 1000 with 0 allocations (no dues exist, so all becomes advance)
    const rcptRes = await advClient1.query(`
      SELECT public.create_receipt(jsonb_build_object(
        'customer_id', $1::text,
        'amount', 1000,
        'receipt_date', current_date::text,
        'mode', 'CASH',
        'kind', 'INVOICE_PAYMENT',
        'allocations', jsonb_build_array(),
        'idempotency_key', 'rcpt_adv_seed_1000'
      )) as r;
    `, [advCustomerId]);
    const advanceRcptId = rcptRes.rows[0].r.receipt_id || rcptRes.rows[0].r.id;

    // 3. Create 2 unpaid invoices of 600 each for Suresh Advance
    const invA = await advClient1.query(`
      SELECT public.create_invoice(jsonb_build_object(
        'customer_id', $1::text,
        'party_name', 'Suresh Advance',
        'party_mobile', '9876500099',
        'items', jsonb_build_array(jsonb_build_object('description', 'Adv Test A', 'quantity', 1, 'rate', 600)),
        'paid', jsonb_build_object('amount', 0, 'mode', 'CASH')
      )) as inv;
    `, [advCustomerId]);
    const invAId = invA.rows[0].inv.invoice_id || invA.rows[0].inv.id;

    const invB = await advClient1.query(`
      SELECT public.create_invoice(jsonb_build_object(
        'customer_id', $1::text,
        'party_name', 'Suresh Advance',
        'party_mobile', '9876500099',
        'items', jsonb_build_array(jsonb_build_object('description', 'Adv Test B', 'quantity', 1, 'rate', 600)),
        'paid', jsonb_build_object('amount', 0, 'mode', 'CASH')
      )) as inv;
    `, [advCustomerId]);
    const invBId = invB.rows[0].inv.invoice_id || invB.rows[0].inv.id;

    // 3. Both workers attempt to apply 600 advance at the exact same moment
    // Total advance is 1000, so 600 + 600 = 1200 would overdraft advance without row locking!
    let aSuccess = false;
    let bSuccess = false;
    let insufficientCaught = false;

    const pA = advClient1.query(`SELECT public.apply_advance($1::uuid, 600);`, [invAId])
      .then(() => { aSuccess = true; })
      .catch((e: any) => {
        if (e.message?.includes('INSUFFICIENT_ADVANCE')) insufficientCaught = true;
        else throw e;
      });

    const pB = advClient2.query(`SELECT public.apply_advance($1::uuid, 600);`, [invBId])
      .then(() => { bSuccess = true; })
      .catch((e: any) => {
        if (e.message?.includes('INSUFFICIENT_ADVANCE')) insufficientCaught = true;
        else throw e;
      });

    await Promise.all([pA, pB]);

    if (!((aSuccess && !bSuccess) || (!aSuccess && bSuccess)) || !insufficientCaught) {
      throw new Error(`TEST 7 FAILED: Expected exactly 1 success and 1 INSUFFICIENT_ADVANCE rejection. Got aSuccess=${aSuccess}, bSuccess=${bSuccess}, insufficientCaught=${insufficientCaught}`);
    }

    // Verify customer advance balance in DB: 1000 - 600 = 400 exactly
    const advCheck = await advClient1.query(`
      SELECT unallocated_amount FROM public.receipts WHERE id = $1::uuid;
    `, [advanceRcptId]);
    const remainingAdvance = parseFloat(advCheck.rows[0].unallocated_amount);
    if (Math.abs(remainingAdvance - 400) > 0.01) {
      throw new Error(`TEST 7 FAILED: Remaining advance should be 400, got ${remainingAdvance}`);
    }
  } finally {
    await advClient1.end();
    await advClient2.end();
  }
  console.log('✅ TEST 7 PASSED: Concurrent apply_advance serialized by customer row lock; zero overdrafts, remaining advance exactly ₹400.');

  // --------------------------------------------------------------------------
  // TEST 8: delete_receipt Atomic Reversal & Canonical Lock Ordering
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: delete_receipt Reversal & Anti-Double-Delete ---');
  const delClient1 = createDbClient();
  const delClient2 = createDbClient();
  await delClient1.connect();
  await delClient2.connect();

  try {
    await delClient1.query(`SET ROLE authenticated;`);
    await delClient1.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await delClient1.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    await delClient2.query(`SET ROLE authenticated;`);
    await delClient2.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await delClient2.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    // 1. Create a bill of 400
    const invRes = await delClient1.query(`
      SELECT public.create_invoice(jsonb_build_object(
        'customer_id', $1::text,
        'party_name', 'Ramesh Kumar',
        'party_mobile', '9876500001',
        'items', jsonb_build_array(jsonb_build_object('description', 'Delete Test Bill', 'quantity', 1, 'rate', 400)),
        'paid', jsonb_build_object('amount', 0, 'mode', 'CASH')
      )) as inv;
    `, [testCustomerId]);
    const delInvId = invRes.rows[0].inv.invoice_id || invRes.rows[0].inv.id;

    // 2. Create receipt paying 400 against this bill
    const rcptToDelRes = await delClient1.query(`
      SELECT public.create_receipt(jsonb_build_object(
        'customer_id', $1::text,
        'amount', 400,
        'receipt_date', current_date::text,
        'mode', 'CASH',
        'kind', 'INVOICE_PAYMENT',
        'allocations', jsonb_build_array(jsonb_build_object('invoice_id', $2::text, 'amount', 400)),
        'idempotency_key', 'rcpt_to_be_deleted_400'
      )) as r;
    `, [testCustomerId, delInvId]);
    const receiptToDelId = rcptToDelRes.rows[0].r.receipt_id || rcptToDelRes.rows[0].r.id;

    // Verify bill is fully paid (paid_amount = 400)
    const checkPaid = await delClient1.query(`SELECT paid_amount FROM public.invoices WHERE id = $1::uuid;`, [delInvId]);
    if (parseFloat(checkPaid.rows[0].paid_amount) !== 400) {
      throw new Error(`TEST 8 Setup FAILED: Bill paid_amount expected 400, got ${checkPaid.rows[0].paid_amount}`);
    }

    // 3. Two workers simultaneously call delete_receipt on the same receipt
    let d1Success = false;
    let d2Success = false;
    let notFoundCaught = false;

    const pDel1 = delClient1.query(`SELECT public.delete_receipt($1::uuid);`, [receiptToDelId])
      .then(() => { d1Success = true; })
      .catch((e: any) => {
        if (e.message?.includes('RECEIPT_NOT_FOUND')) notFoundCaught = true;
        else throw e;
      });

    const pDel2 = delClient2.query(`SELECT public.delete_receipt($1::uuid);`, [receiptToDelId])
      .then(() => { d2Success = true; })
      .catch((e: any) => {
        if (e.message?.includes('RECEIPT_NOT_FOUND')) notFoundCaught = true;
        else throw e;
      });

    await Promise.all([pDel1, pDel2]);

    if (!((d1Success && !d2Success) || (!d1Success && d2Success)) || !notFoundCaught) {
      throw new Error(`TEST 8 FAILED: Expected exactly 1 delete to succeed and 1 to fail with RECEIPT_NOT_FOUND.`);
    }

    // Verify bill paid_amount reopened to exactly 0 (not negative!)
    const checkReopened = await delClient1.query(`SELECT paid_amount, (total - paid_amount) as balance FROM public.invoices WHERE id = $1::uuid;`, [delInvId]);
    if (parseFloat(checkReopened.rows[0].paid_amount) !== 0 || parseFloat(checkReopened.rows[0].balance) !== 400) {
      throw new Error(`TEST 8 FAILED: Bill balance not correctly reopened! paid_amount=${checkReopened.rows[0].paid_amount}, balance=${checkReopened.rows[0].balance}`);
    }
  } finally {
    await delClient1.end();
    await delClient2.end();
  }
  console.log('✅ TEST 8 PASSED: Concurrent delete_receipt safely reversed allocations; bill reopened to ₹400 balance with 0 duplicate reversals.');

  // --------------------------------------------------------------------------
  // TEST 9: record_loan_repayment Idempotency & Auto-Expense Linking
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 9: record_loan_repayment Idempotency & Linked Expense ---');
  const loanClient = createDbClient();
  await loanClient.connect();

  try {
    await loanClient.query(`SET ROLE authenticated;`);
    await loanClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [ownerUserId]);
    await loanClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

    // 1. Create a loan of 10,000
    const loanRes = await loanClient.query(`
      INSERT INTO public.loans (lender_name, amount, loan_date, notes)
      VALUES ('HDFC Business Loan', 10000.00, current_date, 'Test loan for concurrency')
      RETURNING id;
    `);
    const loanId = loanRes.rows[0].id;

    // 2. Record repayment with principal 2000 and interest 300 with idempotency key
    const loanIdemKey = 'loan_repay_conc_key_999';
    const repayPayload = JSON.stringify({
      loan_id: loanId,
      repayment_date: new Date().toISOString().split('T')[0],
      principal: 2000,
      interest: 300,
      mode: 'BANK',
      bank_account_id: bankAId,
      notes: 'Monthly EMI payment',
      idempotency_key: loanIdemKey,
    });

    // Worker A records repayment
    const rep1 = await loanClient.query(`SELECT public.record_loan_repayment($1::jsonb) as res;`, [repayPayload]);
    const res1 = rep1.rows[0].res;
    console.log('Loan repayment initial response:', res1);

    if (parseFloat(res1.remaining_principal) !== 8000) {
      throw new Error(`TEST 9 FAILED: Remaining principal expected 8000, got ${res1.remaining_principal}`);
    }

    // Verify interest expense created
    if (!res1.interest_expense_id) {
      throw new Error('TEST 9 FAILED: Interest expense ID was not returned!');
    }
    const expCheck = await loanClient.query(`SELECT amount, loan_repayment_id FROM public.expenses WHERE id = $1::uuid;`, [res1.interest_expense_id]);
    if (parseFloat(expCheck.rows[0].amount) !== 300) {
      throw new Error(`TEST 9 FAILED: Interest expense amount mismatch, expected 300, got ${expCheck.rows[0].amount}`);
    }

    // 3. Retry with the SAME idempotency key (simulating retry on timeout)
    const rep2 = await loanClient.query(`SELECT public.record_loan_repayment($1::jsonb) as res;`, [repayPayload]);
    const res2 = rep2.rows[0].res;

    // Assert exact cached response returned
    if (res1.repayment.id !== res2.repayment.id) {
      throw new Error(`TEST 9 FAILED: Idempotency failed! Different repayment IDs: ${res1.repayment.id} vs ${res2.repayment.id}`);
    }

    // Verify total repayments count in DB is exactly 1 (not 2!)
    const countRepayments = await loanClient.query(`SELECT count(*) as total, sum(principal) as total_p FROM public.loan_repayments WHERE loan_id = $1::uuid;`, [loanId]);
    if (parseInt(countRepayments.rows[0].total, 10) !== 1 || parseFloat(countRepayments.rows[0].total_p) !== 2000) {
      throw new Error(`TEST 9 FAILED: Duplicate loan repayment was recorded! count=${countRepayments.rows[0].total}`);
    }

    // Verify total expenses count with loan_repayment_id is exactly 1
    const countExpenses = await loanClient.query(`SELECT count(*) as total FROM public.expenses WHERE loan_repayment_id = $1::uuid;`, [res1.repayment.id]);
    if (parseInt(countExpenses.rows[0].total, 10) !== 1) {
      throw new Error(`TEST 9 FAILED: Duplicate interest expense was created! count=${countExpenses.rows[0].total}`);
    }
  } finally {
    await loanClient.end();
  }
  console.log('✅ TEST 9 PASSED: record_loan_repayment idempotency verified; retry returned cached result with zero duplicate payments or expenses.');

  console.log('\n========================================================================');
  console.log('ALL ENTERPRISE MULTI-DEVICE & CONCURRENCY SAFETY TESTS PASSED! (9/9)');
  console.log('========================================================================\n');
}

runScenarioTests().catch(err => {
  console.error('\n❌ Enterprise Concurrency Test Suite Encountered Error:', err);
  process.exit(1);
});
