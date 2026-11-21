-- Test Suite: 13_customer_vendor_ledgers.sql
-- Covers:
-- 1. customer_ledger with opening balance calculation when date filters are applied
-- 2. Running balance continuity starting from opening balance
-- 3. vendor_ledger with Cash vs Bank breakdown and cumulative payments
-- 4. party_ledger_report for CUSTOMER and VENDOR overview
-- 5. report(type, params) with 'customer_ledger' and 'vendor_ledger'

BEGIN;
SELECT plan(15);

-- Setup business and members
DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Ledger Test Business', 'Sunil Kumar', '9876543501');
  v_biz_id := (v_biz->>'business_id')::uuid;

  -- Add staff member
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Staff Member', '9876543599', 'STAFF', true, true, '55555555-5555-5555-5555-555555555555');
END $$;

SET ROLE authenticated;

DO $$
DECLARE
  v_owner_auth_id text := '88888888-8888-8888-8888-888888888888';
  v_cust_id uuid;
  v_vend_id uuid;
  v_inv1 jsonb;
  v_inv2 jsonb;
  v_rcpt1 jsonb;
  v_rcpt2 jsonb;
  v_pmt1 jsonb;
  v_pmt2 jsonb;
  v_cust_ledger_all jsonb;
  v_cust_ledger_oct jsonb;
  v_vend_ledger_oct jsonb;
  v_cust_rep jsonb;
  v_vend_rep jsonb;
  v_gen_cust_rep jsonb;
  v_gen_vend_rep jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. Create a customer
  INSERT INTO public.customers (name, mobile, type)
  VALUES ('Amit Sharma', '9876543511', 'REGULAR')
  RETURNING id INTO v_cust_id;

  -- 2. Create historical transactions (Prior to Oct 2026: September 2026)
  -- Bill #1: 5,000 on 2026-09-01
  v_inv1 := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_id,
    'invoice_date', '2026-09-01',
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Consulting Services', 'quantity', 1, 'rate', 5000.00)
    )
  ));

  -- Receipt #1: 2,000 on 2026-09-15 allocated to Bill #1
  v_rcpt1 := public.create_receipt(jsonb_build_object(
    'customer_id', v_cust_id,
    'receipt_date', '2026-09-15',
    'amount', 2000.00,
    'mode', 'CASH',
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', v_inv1->>'id', 'amount', 2000.00)
    )
  ));
  -- Net balance before 2026-10-01 is 5000 - 2000 = 3000

  -- 3. Create October transactions
  -- Bill #2: 4,000 on 2026-10-05
  v_inv2 := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_id,
    'invoice_date', '2026-10-05',
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Filing Work', 'quantity', 1, 'rate', 4000.00)
    )
  ));

  -- Receipt #2: 3,500 on 2026-10-15 (3,000 to Bill #1, 500 to Bill #2)
  v_rcpt2 := public.create_receipt(jsonb_build_object(
    'customer_id', v_cust_id,
    'receipt_date', '2026-10-15',
    'amount', 3500.00,
    'mode', 'UPI',
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', v_inv1->>'id', 'amount', 3000.00),
      jsonb_build_object('invoice_id', v_inv2->>'id', 'amount', 500.00)
    )
  ));

  -- 4. Test Customer Ledger - ALL TIME
  v_cust_ledger_all := public.customer_ledger(v_cust_id, NULL, NULL);
  PERFORM is((v_cust_ledger_all->'summary'->>'balance')::numeric, 3500.00, 'Customer all-time balance is 3,500');
  PERFORM is((v_cust_ledger_all->'summary'->>'opening_balance')::numeric, 0.00, 'Customer all-time opening balance is 0');

  -- 5. Test Customer Ledger - FILTERED BY OCTOBER 2026
  v_cust_ledger_oct := public.customer_ledger(v_cust_id, '2026-10-01', '2026-10-31');

  PERFORM is((v_cust_ledger_oct->'summary'->>'opening_balance')::numeric, 3000.00, 'Customer October opening balance is exactly 3,000');
  PERFORM is((v_cust_ledger_oct->'summary'->>'period_billed')::numeric, 4000.00, 'Customer October billed is 4,000');
  PERFORM is((v_cust_ledger_oct->'summary'->>'period_paid')::numeric, 3500.00, 'Customer October paid is 3,500');
  PERFORM is((v_cust_ledger_oct->'summary'->>'balance')::numeric, 3500.00, 'Customer closing balance in October is 3,500 (3000 + 4000 - 3500)');

  -- Check Opening Balance entry row in entries
  PERFORM is(v_cust_ledger_oct->'entries'->0->>'type', 'OPENING_BALANCE', 'First entry is OPENING_BALANCE');
  PERFORM is((v_cust_ledger_oct->'entries'->0->>'running_balance')::numeric, 3000.00, 'Opening balance entry running balance is 3,000');
  PERFORM is((v_cust_ledger_oct->'entries'->2->>'running_balance')::numeric, 3500.00, 'Final entry running balance matches closing balance 3,500');
  PERFORM ok(v_cust_ledger_oct ? 'business', 'Customer ledger returns business branding details');

  -- 6. Vendor Ledger testing
  INSERT INTO public.vendors (name, mobile)
  VALUES ('Apex Printing Solutions', '9876543522')
  RETURNING id INTO v_vend_id;

  -- Payment 1: 1,500 Cash on 2026-10-03
  INSERT INTO public.payments (vendor_id, payment_date, description, amount, mode, notes)
  VALUES (v_vend_id, '2026-10-03', 'Brochure Printing', 1500.00, 'CASH', 'Cash paid on counter');

  -- Payment 2: 2,500 UPI on 2026-10-10
  INSERT INTO public.payments (vendor_id, payment_date, description, amount, mode, notes)
  VALUES (v_vend_id, '2026-10-10', 'Flex Banner Work', 2500.00, 'UPI', 'UPI to vendor account');

  v_vend_ledger_oct := public.vendor_ledger(v_vend_id, '2026-10-01', '2026-10-31');

  PERFORM is((v_vend_ledger_oct->'summary'->>'total_paid')::numeric, 4000.00, 'Vendor total paid in October is 4,000');
  PERFORM is((v_vend_ledger_oct->'summary'->>'cash_paid')::numeric, 1500.00, 'Vendor cash paid is 1,500');
  PERFORM is((v_vend_ledger_oct->'summary'->>'bank_paid')::numeric, 2500.00, 'Vendor bank/UPI paid is 2,500');

  -- 7. Party Ledger Reports testing
  v_cust_rep := public.party_ledger_report('CUSTOMER', '2026-10-01', '2026-10-31');
  PERFORM is((v_cust_rep->>'total_opening_balance')::numeric, 3000.00, 'Party ledger customer report total opening balance is 3,000');

  v_vend_rep := public.party_ledger_report('VENDOR', '2026-10-01', '2026-10-31');
  PERFORM is((v_vend_rep->>'total_paid')::numeric, 4000.00, 'Party ledger vendor report total paid is 4,000');

  -- 8. General Report RPC testing
  v_gen_cust_rep := public.report('customer_ledger', jsonb_build_object('from', '2026-10-01', 'to', '2026-10-31'));
  PERFORM ok(v_gen_cust_rep ? 'rows', 'General report customer_ledger returns rows');

  v_gen_vend_rep := public.report('vendor_ledger', jsonb_build_object('from', '2026-10-01', 'to', '2026-10-31'));
  PERFORM ok(v_gen_vend_rep ? 'rows', 'General report vendor_ledger returns rows');
END $$;

ROLLBACK;
