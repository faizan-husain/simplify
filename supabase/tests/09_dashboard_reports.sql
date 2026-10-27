-- Test Suite: 09_dashboard_reports.sql
-- Covers BR-1 (P&L calculations, loan exclusion), BR-17 (Privacy PIN session gate),
-- dashboard() metrics, global_search(), and Staff report access restrictions.

BEGIN;
SELECT plan(15);

DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
  v_owner_auth_id text := '11111111-2222-3333-4444-555555555555';
  v_staff_auth_id text := '22222222-3333-4444-5555-666666666666';
  v_vendor_id uuid;
  v_cat_id uuid;
  v_cust_id uuid;
  v_inv jsonb;
  v_dash jsonb;
  v_pnl jsonb;
  v_search jsonb;
  v_pin_res boolean;
  v_loan_id uuid;
BEGIN
  -- Setup Business
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Reports Test Biz', 'Owner Reports', '9876543601');
  v_biz_id := (v_biz->>'business_id')::uuid;

  -- Add staff member
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Staff Tester', '9876543602', 'STAFF', true, true, v_staff_auth_id::uuid);

  -- 1. Create a customer & bill: Total ₹1,000, Paid ₹600, Balance ₹400
  v_inv := public.create_invoice(jsonb_build_object(
    'walk_in', jsonb_build_object('name', 'Pooja Aggarwal', 'mobile', '9876543605'),
    'paid', jsonb_build_object('amount', 600, 'mode', 'UPI'),
    'items', jsonb_build_array(
      jsonb_build_object(
        'description', 'Consulting Service',
        'quantity', 1,
        'rate', 1000
      )
    )
  ));

  -- 2. Create Vendor & Vendor Payment: ₹200 (Mode: CASH)
  INSERT INTO public.vendors (name, mobile) VALUES ('Hardware Vendor', '9876543606')
  RETURNING id INTO v_vendor_id;

  INSERT INTO public.payments (vendor_id, description, amount, mode, payment_date)
  VALUES (v_vendor_id, 'Raw supplies', 200, 'CASH', (SELECT app.today()));

  -- 3. Create Operating Expense: ₹150 (Internet)
  SELECT id INTO v_cat_id FROM public.expense_categories WHERE business_id = v_biz_id AND name = 'Internet';
  INSERT INTO public.expenses (category_id, description, amount, mode, expense_date)
  VALUES (v_cat_id, 'Monthly Broadband', 150, 'BANK', (SELECT app.today()));

  -- 4. Create Loan of ₹20,000 and Repayment of ₹5,000 Principal + ₹300 Interest (BR-1, BR-11)
  INSERT INTO public.loans (lender_name, amount, loan_date)
  VALUES ('Bank Of Baroda', 20000, (SELECT app.today()))
  RETURNING id INTO v_loan_id;

  PERFORM public.record_loan_repayment(jsonb_build_object(
    'loan_id', v_loan_id,
    'principal', 5000,
    'interest', 300,
    'mode', 'BANK'
  ));

  -- Test 1: dashboard() today collection = 600, payments = 200, expenses = 450 (150 + 300 interest)
  v_dash := public.dashboard();
  PERFORM ok(
    (v_dash->'today'->>'collection')::numeric = 600 AND
    (v_dash->'today'->>'payments')::numeric = 200 AND
    (v_dash->'today'->>'expenses')::numeric = 450,
    'dashboard() today metrics accurately computed'
  );

  -- Test 2: dashboard() this_month Net Profit = Income (600) - Outgoing (200 + 450 = 650) = -50 (BR-1)
  PERFORM ok(
    (v_dash->'this_month'->>'net_profit')::numeric = -50,
    'dashboard() net profit excludes loan principal and includes loan interest per BR-1'
  );

  -- Test 3: dashboard() loan_outstanding = 20,000 - 5,000 = 15,000
  PERFORM ok(
    (v_dash->'this_month'->>'loan_outstanding')::numeric = 15000,
    'dashboard() reports accurate loan outstanding of ₹15,000'
  );

  -- Test 4: dashboard() total_outstanding = ₹400 (unpaid bill balance)
  PERFORM ok(
    (v_dash->'this_month'->>'total_outstanding')::numeric = 400,
    'dashboard() reports total accounts receivable of ₹400'
  );

  -- Test 5: report('pnl') verifies BR-1 Cash-basis Profit & Loss
  v_pnl := public.report('pnl', jsonb_build_object('fy_label', public.fy_label((SELECT app.today()))));
  PERFORM ok(
    (v_pnl->>'income')::numeric = 600 AND
    (v_pnl->>'outgoing')::numeric = 650 AND
    (v_pnl->>'net_profit')::numeric = -50,
    'report(pnl) matches cash-basis formula: Income 600 - Outgoing 650 = Net Profit -50'
  );

  -- Test 6: report('pnl') separates loan non-operating movements
  PERFORM ok(
    (v_pnl->'loans'->>'taken')::numeric = 20000 AND
    (v_pnl->'loans'->>'principal_repaid')::numeric = 5000 AND
    (v_pnl->'loans'->>'interest_paid')::numeric = 300,
    'report(pnl) reports capital ledger movements separately without polluting P&L'
  );

  -- Test 7: report('invoices') returns bill with balance
  PERFORM ok(
    (SELECT (public.report('invoices'))->>'count')::int = 1,
    'report(invoices) returns active invoice'
  );

  -- Test 8: report('outstanding') returns customer due
  PERFORM ok(
    (SELECT (public.report('outstanding'))->>'total_outstanding')::numeric = 400,
    'report(outstanding) accurately reports ₹400 receivable'
  );

  -- Test 9: global_search finds customer by name
  v_search := public.global_search('Pooja');
  PERFORM ok(
    jsonb_array_length(v_search->'customers') = 1 AND
    (v_search->'customers'->0->>'name') = 'Pooja Aggarwal',
    'global_search finds customer by partial name'
  );

  -- Test 10: global_search finds invoice by number
  v_search := public.global_search((v_inv->>'number'));
  PERFORM ok(
    jsonb_array_length(v_search->'invoices') = 1 AND
    (v_search->'invoices'->0->>'number') = (v_inv->>'number'),
    'global_search finds invoice by exact or partial invoice number'
  );

  -- Test 11: Privacy PIN initial state (no PIN configured)
  PERFORM ok(
    public.has_privacy_pin() = false AND public.verify_privacy_pin('0000') = true,
    'Without privacy PIN configured, has_privacy_pin is false and verify succeeds'
  );

  -- Test 12: Owner sets privacy PIN '5432' (BR-17)
  PERFORM public.set_privacy_pin('5432');
  PERFORM ok(public.has_privacy_pin() = true, 'has_privacy_pin is true after setting PIN');

  -- Test 13: Privacy PIN verification
  PERFORM ok(
    public.verify_privacy_pin('5432') = true AND public.verify_privacy_pin('0000') = false,
    'verify_privacy_pin succeeds for 5432 and fails for incorrect PIN'
  );

  -- Test 14: Staff forbidden from accessing report() (Permissions Matrix §5)
  PERFORM set_config('request.jwt.claim.sub', v_staff_auth_id, true);
  BEGIN
    PERFORM public.report('pnl');
    PERFORM ok(false, 'Staff should be forbidden from report(pnl)');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM = 'FORBIDDEN', 'Staff forbidden from viewing reports');
  END;

  -- Test 15: Staff forbidden from set_privacy_pin()
  BEGIN
    PERFORM public.set_privacy_pin('9999');
    PERFORM ok(false, 'Staff should be forbidden from set_privacy_pin');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM IN ('FORBIDDEN', 'UNAUTHORIZED'), 'Staff forbidden from setting privacy PIN');
  END;

END $$;

SELECT * FROM finish();
ROLLBACK;
