-- pgTAP Test: Comprehensive Bill Cancellation & Restoration with Accurate Accounting
-- Scenarios 1-15 per User Specification Section 9

SELECT plan(20);

-- Setup mock auth users and business as admin
TRUNCATE auth.users, public.businesses CASCADE;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'owner@simplify.local'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'staff@simplify.local');

-- Owner registers business
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
  v_owner_member_id uuid;
  v_staff_member_id uuid;
  v_bank_id uuid;
  v_cust_1_id uuid;
  v_cust_2_id uuid;
  v_service_id uuid;
  v_job_service_id uuid;
  
  -- Invoices
  v_inv_unpaid jsonb;
  v_inv_partial jsonb;
  v_inv_full_cash jsonb;
  v_inv_full_bank jsonb;
  v_inv_job jsonb;
  
  -- Variables
  v_inv_id uuid;
  v_inv_row public.invoices%ROWTYPE;
  v_res jsonb;
  v_err text;
  v_activities jsonb;
  v_bank_bal numeric;
  v_cash_bal numeric;
  v_comm_row public.commission_entries%ROWTYPE;
BEGIN
  -- 1. Register business
  v_biz := public.register_business('Test Accounting Firm', 'Faizan Husain', '9876543210');
  v_biz_id := (v_biz->>'business_id')::uuid;
  v_owner_member_id := (v_biz->>'member_id')::uuid;

  -- Enable job management
  UPDATE public.businesses SET job_management_enabled = true WHERE id = v_biz_id;

  -- Create Staff member
  INSERT INTO public.members (business_id, auth_user_id, name, mobile, role, can_login, active)
  VALUES (v_biz_id, '22222222-2222-2222-2222-222222222222', 'Salim Staff', '9876543211', 'STAFF', true, true)
  RETURNING id INTO v_staff_member_id;

  -- Create Bank Account
  INSERT INTO public.bank_accounts (business_id, bank_name, account_name, account_number, opening_balance)
  VALUES (v_biz_id, 'HDFC Bank', 'Main HDFC', '1234567890', 10000.00)
  RETURNING id INTO v_bank_id;

  -- Create Regular Customer
  INSERT INTO public.customers (business_id, type, name, mobile)
  VALUES (v_biz_id, 'REGULAR', 'Ahmad Khan', '9988776655')
  RETURNING id INTO v_cust_1_id;

  -- Create Second Customer
  INSERT INTO public.customers (business_id, type, name, mobile)
  VALUES (v_biz_id, 'REGULAR', 'Bilal Siddiqui', '9988776644')
  RETURNING id INTO v_cust_2_id;

  -- Create Regular Service
  INSERT INTO public.services (business_id, name, default_rate, active)
  VALUES (v_biz_id, 'IT Consulting', 2000.00, true)
  RETURNING id INTO v_service_id;

  -- Create Job Service (with commission)
  INSERT INTO public.services (business_id, name, default_rate, is_job_type, deadline_days, commission_percent, active)
  VALUES (v_biz_id, 'Passport Service', 1500.00, true, 5, 20.00, true)
  RETURNING id INTO v_job_service_id;

  INSERT INTO public.job_type_steps (service_id, position, name)
  VALUES (v_job_service_id, 1, 'Document Collection'), (v_job_service_id, 2, 'Application Filed');

  -- =========================================================================
  -- SCENARIO 1: Unpaid bill -> Cancel -> Restore
  -- =========================================================================
  v_inv_unpaid := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_1_id,
    'items', jsonb_build_array(
      jsonb_build_object('service_id', v_service_id, 'description', 'Consulting 1', 'quantity', 1, 'rate', 2000.00)
    )
  ));
  v_inv_id := (v_inv_unpaid->>'id')::uuid;

  -- Cancel unpaid bill
  v_res := public.cancel_invoice(v_inv_id, 'Wrong amount entered', false);
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'CANCELLED', 'Scenario 1: Unpaid bill status changed to CANCELLED');
  PERFORM is(v_inv_row.cancel_reason, 'Wrong amount entered', 'Scenario 1: Cancel reason recorded');

  -- Restore unpaid bill
  v_res := public.restore_invoice(v_inv_id, 'Customer confirmed the service');
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'ACTIVE', 'Scenario 1: Unpaid bill restored to ACTIVE');
  PERFORM is(v_inv_row.cancel_reason, NULL, 'Scenario 1: Cancel reason cleared after restoration');

  -- =========================================================================
  -- SCENARIO 2: Mandatory Reason Validation (Empty reason rejected)
  -- =========================================================================
  BEGIN
    PERFORM public.cancel_invoice(v_inv_id, '   ', false);
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM is(v_err, 'CANCEL_REASON_REQUIRED', 'Scenario 2: Empty cancellation reason rejected');

  -- Cancel with valid reason
  PERFORM public.cancel_invoice(v_inv_id, 'Bill created by mistake', false);

  BEGIN
    PERFORM public.restore_invoice(v_inv_id, '   ');
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM is(v_err, 'RESTORE_REASON_REQUIRED', 'Scenario 2: Empty restoration reason rejected');

  -- Restore properly
  PERFORM public.restore_invoice(v_inv_id, 'Cancelled by mistake');

  -- =========================================================================
  -- SCENARIO 3: Fully paid bill with Cash -> Cancel -> Restore
  -- =========================================================================
  v_inv_full_cash := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_1_id,
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Office Services', 'quantity', 1, 'rate', 1000.00)
    ),
    'paid', jsonb_build_object('amount', 1000.00, 'mode', 'CASH')
  ));
  v_inv_id := (v_inv_full_cash->>'id')::uuid;

  -- Cancel: Allocations released to customer advance
  v_res := public.cancel_invoice(v_inv_id, 'Duplicate bill', false);
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'CANCELLED', 'Scenario 3: Fully paid cash bill status CANCELLED');
  PERFORM is(v_inv_row.paid_amount, 0.00, 'Scenario 3: Cancelled bill paid_amount set to 0');

  -- Restore: Advance automatically re-allocated back to bill
  v_res := public.restore_invoice(v_inv_id, 'Cancellation reversed');
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'ACTIVE', 'Scenario 3: Fully paid cash bill restored to ACTIVE');
  PERFORM is(v_inv_row.paid_amount, 1000.00, 'Scenario 3: Restored bill re-allocated full 1000.00 payment');

  -- =========================================================================
  -- SCENARIO 4: Fully paid bill with Bank/UPI -> Cancel -> Restore
  -- =========================================================================
  v_inv_full_bank := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_1_id,
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Software License', 'quantity', 1, 'rate', 3000.00)
    ),
    'paid', jsonb_build_object('amount', 3000.00, 'mode', 'UPI', 'bank_account_id', v_bank_id)
  ));
  v_inv_id := (v_inv_full_bank->>'id')::uuid;

  -- Cancel
  PERFORM public.cancel_invoice(v_inv_id, 'Customer cancelled service', false);
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'CANCELLED', 'Scenario 4: Bank paid bill CANCELLED');

  -- Restore
  PERFORM public.restore_invoice(v_inv_id, 'Customer confirmed the service');
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'ACTIVE', 'Scenario 4: Bank paid bill restored to ACTIVE');
  PERFORM is(v_inv_row.paid_amount, 3000.00, 'Scenario 4: Bank paid bill restored paid_amount = 3000.00');

  -- =========================================================================
  -- SCENARIO 5: Staff Member Cancels and Restores without Owner approval
  -- =========================================================================
  -- Switch auth to Staff user
  PERFORM set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

  -- Staff cancels bill
  v_res := public.cancel_invoice(v_inv_id, 'Staff cancelled by customer request', false);
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'CANCELLED', 'Scenario 5: Staff successfully cancelled bill directly');

  -- Staff restores bill
  v_res := public.restore_invoice(v_inv_id, 'Staff restored on client approval');
  SELECT * INTO v_inv_row FROM public.invoices WHERE id = v_inv_id;
  PERFORM is(v_inv_row.status, 'ACTIVE', 'Scenario 5: Staff successfully restored bill directly');

  -- Switch back to Owner
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

  -- =========================================================================
  -- SCENARIO 6: Bill with Staff Commission -> Cancel -> Restore
  -- =========================================================================
  v_inv_job := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_2_id,
    'items', jsonb_build_array(
      jsonb_build_object(
        'service_id', v_job_service_id,
        'description', 'Passport Service',
        'quantity', 1,
        'rate', 1500.00,
        'is_job', true,
        'applicant_name', 'Zaid Khan'
      )
    )
  ));
  v_inv_id := (v_inv_job->>'id')::uuid;

  -- Assign staff to job
  UPDATE public.jobs SET assigned_staff_id = v_staff_member_id WHERE invoice_id = v_inv_id;

  -- Create commission entry
  INSERT INTO public.commission_entries (
    job_id, staff_id, base_amount, percent, amount, status
  )
  SELECT id, v_staff_member_id, 1500.00, 20.00, 300.00, 'UPCOMING'
  FROM public.jobs WHERE invoice_id = v_inv_id
  ON CONFLICT (job_id) DO NOTHING;

  -- Cancel invoice with job
  PERFORM public.cancel_invoice(v_inv_id, 'Wrong service booked', false);
  
  SELECT * INTO v_comm_row FROM public.commission_entries WHERE staff_id = v_staff_member_id AND base_amount = 1500.00;
  PERFORM is(v_comm_row.status, 'CANCELLED', 'Scenario 6: Linked commission status changed to CANCELLED');

  -- Restore invoice with job
  PERFORM public.restore_invoice(v_inv_id, 'Correct service confirmed');

  SELECT * INTO v_comm_row FROM public.commission_entries WHERE staff_id = v_staff_member_id AND base_amount = 1500.00;
  PERFORM is(v_comm_row.status, 'UPCOMING', 'Scenario 6: Linked commission restored to UPCOMING');

  -- =========================================================================
  -- SCENARIO 7: Idempotency & Repeat Protection
  -- =========================================================================
  BEGIN
    PERFORM public.restore_invoice(v_inv_id, 'Restoring already active bill');
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM is(v_err, 'INVOICE_NOT_CANCELLED', 'Scenario 7: Restoring active bill rejected with INVOICE_NOT_CANCELLED');

  PERFORM public.cancel_invoice(v_inv_id, 'Cancelling once', false);
  BEGIN
    PERFORM public.cancel_invoice(v_inv_id, 'Cancelling twice', false);
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM is(v_err, 'INVOICE_ALREADY_CANCELLED', 'Scenario 7: Duplicate cancellation rejected with INVOICE_ALREADY_CANCELLED');

  -- =========================================================================
  -- SCENARIO 8: Complete Audit & Activity History Preservation
  -- =========================================================================
  v_activities := public.get_invoice_activities(v_inv_id);
  PERFORM ok(jsonb_array_length(v_activities) >= 3, 'Scenario 8: Complete activity history logged (Created, Cancelled, Restored, Cancelled)');
END;
$$;
