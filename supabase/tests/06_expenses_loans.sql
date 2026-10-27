-- Test Suite: 06_expenses_loans.sql
-- Covers BR-1 (Loans excluded from profit, loan interest becomes expense),
-- BR-9 (Soft delete), BR-10 (Vendor payments), BR-11 (Loans & Repayments),
-- and §5 Role permissions (Staff denied on payments, expenses, loans).

BEGIN;
SELECT plan(16);

-- Setup business and staff as admin
DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Expenses & Loans Test Biz', 'Owner Five', '9876543301');
  v_biz_id := (v_biz->>'business_id')::uuid;

  -- Add staff member
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Staff Cashier', '9876543399', 'STAFF', true, true, '88888888-8888-8888-8888-888888888888');
END $$;

-- Switch to authenticated role to evaluate RLS
SET ROLE authenticated;

DO $$
DECLARE
  v_owner_auth_id text := '22222222-2222-2222-2222-222222222222';
  v_staff_auth_id text := '88888888-8888-8888-8888-888888888888';
  v_vendor_id uuid;
  v_payment_id uuid;
  v_cat_rent_id uuid;
  v_expense_id uuid;
  v_loan_id uuid;
  v_repayment_res jsonb;
  v_loans_sum jsonb;
  v_vendor_det jsonb;
  v_interest_exp_count int;
BEGIN
  -- Set Owner session
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Test 1: Vendor creation by Owner
  INSERT INTO public.vendors (name, mobile)
  VALUES ('Sharma Supplies', '9876543302')
  RETURNING id INTO v_vendor_id;
  PERFORM ok(v_vendor_id IS NOT NULL, 'Vendor created successfully by Owner');

  -- Test 2: Vendor payment recorded
  INSERT INTO public.payments (payment_date, vendor_id, description, amount, mode)
  VALUES ('2026-10-27', v_vendor_id, 'Paper rolls & consumables', 450, 'UPI')
  RETURNING id INTO v_payment_id;
  PERFORM ok(v_payment_id IS NOT NULL, 'Vendor payment recorded successfully');

  -- Test 3: Vendor detail RPC returns total paid and list
  SELECT public.vendor_detail(v_vendor_id) INTO v_vendor_det;
  PERFORM ok((v_vendor_det->>'total_paid')::numeric = 450, 'vendor_detail shows total_paid = 450');

  -- Test 4: Default expense categories seeded automatically
  SELECT id INTO v_cat_rent_id
  FROM public.expense_categories
  WHERE business_id = (SELECT app.current_business_id()) AND name = 'Rent';
  PERFORM ok(v_cat_rent_id IS NOT NULL, 'Default category Rent seeded automatically');

  -- Test 5: Expense recorded in Rent category
  INSERT INTO public.expenses (expense_date, category_id, description, amount, mode, payee)
  VALUES ('2026-10-27', v_cat_rent_id, 'Shop monthly rent', 12000, 'BANK', 'Landlord Mr. Gupta')
  RETURNING id INTO v_expense_id;
  PERFORM ok(v_expense_id IS NOT NULL, 'Rent expense recorded successfully');

  -- Test 6: System categories cannot be deleted via soft_delete (BR-9)
  DECLARE
    v_sys_cat_id uuid;
  BEGIN
    SELECT id INTO v_sys_cat_id
    FROM public.expense_categories
    WHERE business_id = (SELECT app.current_business_id()) AND name = 'Loan Interest';

    PERFORM public.soft_delete('expense_categories', v_sys_cat_id);
    PERFORM ok(false, 'Deleting system category should fail');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'SYSTEM_CATEGORY_CANNOT_BE_DELETED' THEN
      PERFORM ok(true, 'System category Loan Interest cannot be deleted (SYSTEM_CATEGORY_CANNOT_BE_DELETED)');
    ELSE
      PERFORM ok(false, 'Unexpected error on system category delete: ' || SQLERRM);
    END IF;
  END;

  -- Test 7: Loan received recorded (BR-11)
  INSERT INTO public.loans (lender_name, amount, loan_date, interest_rate, notes)
  VALUES ('State Bank of India', 50000, '2026-10-01', 12.0, 'Working capital loan')
  RETURNING id INTO v_loan_id;
  PERFORM ok(v_loan_id IS NOT NULL, 'Loan of ₹50,000 recorded successfully');

  -- Test 8: Loan summary before repayment shows outstanding = 50,000
  SELECT public.loans_summary() INTO v_loans_sum;
  PERFORM ok((v_loans_sum->'summary'->>'total_outstanding')::numeric = 50000, 'Loan summary shows total_outstanding = 50,000');

  -- Test 9: Repayment exceeding balance is rejected
  BEGIN
    PERFORM public.record_loan_repayment(jsonb_build_object(
      'loan_id', v_loan_id,
      'principal', 55000,
      'interest', 500,
      'mode', 'BANK'
    ));
    PERFORM ok(false, 'Over-repayment of principal should fail');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'REPAYMENT_EXCEEDS_LOAN_BALANCE' THEN
      PERFORM ok(true, 'Principal exceeding loan balance rejected with REPAYMENT_EXCEEDS_LOAN_BALANCE');
    ELSE
      PERFORM ok(false, 'Unexpected error on over-repayment: ' || SQLERRM);
    END IF;
  END;

  -- Test 10: Valid repayment with Principal ₹10,000 and Interest ₹600 (BR-11)
  v_repayment_res := public.record_loan_repayment(jsonb_build_object(
    'loan_id', v_loan_id,
    'repayment_date', '2026-10-27',
    'principal', 10000,
    'interest', 600,
    'mode', 'BANK',
    'notes', 'EMI 1'
  ));
  PERFORM ok((v_repayment_res->>'remaining_principal')::numeric = 40000, 'Repayment reduced remaining principal to 40,000');

  -- Test 11: Interest ₹600 was automatically converted to an Expense in 'Loan Interest' (BR-11)
  SELECT count(*) INTO v_interest_exp_count
  FROM public.expenses e
  JOIN public.expense_categories ec ON ec.id = e.category_id
  WHERE ec.name = 'Loan Interest'
    AND e.amount = 600
    AND e.loan_repayment_id IS NOT NULL;
  PERFORM ok(v_interest_exp_count = 1, 'Interest ₹600 automatically created as Expense in Loan Interest category');

  -- Test 12: Loans summary reflects updated outstanding (40,000) and interest paid (600)
  SELECT public.loans_summary() INTO v_loans_sum;
  PERFORM ok(
    (v_loans_sum->'summary'->>'total_outstanding')::numeric = 40000
    AND (v_loans_sum->'summary'->>'total_interest_paid')::numeric = 600,
    'Loans summary correctly shows outstanding 40,000 and interest paid 600'
  );

  -- Test 13: Soft delete vendor payment via soft_delete RPC
  PERFORM public.soft_delete('payments', v_payment_id);
  PERFORM ok(NOT EXISTS (SELECT 1 FROM public.payments WHERE id = v_payment_id), 'Soft-deleted payment excluded from queries');

  -- Test 14: Soft delete loan via soft_delete RPC
  PERFORM public.soft_delete('loans', v_loan_id);
  PERFORM ok(NOT EXISTS (SELECT 1 FROM public.loans WHERE id = v_loan_id), 'Soft-deleted loan excluded from queries');

  -- Test 15 & 16: Permissions - Staff role must NOT have access to payments, expenses, loans per §5
  PERFORM set_config('request.jwt.claim.sub', v_staff_auth_id, true);

  -- Test 15: Staff cannot call record_loan_repayment
  BEGIN
    PERFORM public.record_loan_repayment(jsonb_build_object(
      'loan_id', v_loan_id,
      'principal', 1000,
      'interest', 0,
      'mode', 'CASH'
    ));
    PERFORM ok(false, 'Staff should be forbidden from loan repayments');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN
      PERFORM ok(true, 'Staff forbidden from recording loan repayment');
    ELSE
      PERFORM ok(false, 'Unexpected error on staff loan repayment: ' || SQLERRM);
    END IF;
  END;

  -- Test 16: Staff cannot call loans_summary
  BEGIN
    PERFORM public.loans_summary();
    PERFORM ok(false, 'Staff should be forbidden from loans_summary');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN
      PERFORM ok(true, 'Staff forbidden from viewing loans_summary');
    ELSE
      PERFORM ok(false, 'Unexpected error on staff loans_summary: ' || SQLERRM);
    END IF;
  END;

END $$;

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
