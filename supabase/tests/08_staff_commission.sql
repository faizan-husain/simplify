-- Test Suite: 08_staff_commission.sql
-- Covers BR-15 (Commission lifecycle: upcoming -> earned on completion -> upcoming on reopen -> cancelled on invoice cancel),
-- BR-16 (Staff summary, period views, pay_staff payout & expense creation, staff isolation).

BEGIN;
SELECT plan(16);

DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
  v_owner_auth_id text := '11111111-2222-3333-4444-555555555555';
  v_staff_a_auth_id text := '22222222-3333-4444-5555-666666666666';
  v_staff_b_auth_id text := '33333333-4444-5555-6666-777777777777';
  v_staff_a_id uuid;
  v_staff_b_id uuid;
  v_service_id uuid;
  v_inv jsonb;
  v_job_a_id uuid;
  v_job_b_id uuid;
  v_step_a_id uuid;
  v_tick_res jsonb;
  v_untick_res jsonb;
  v_comm record;
  v_summary jsonb;
  v_comm_view jsonb;
  v_payout_res jsonb;
  v_payout_rec record;
  v_expense_rec record;
BEGIN
  -- 1. Setup Business
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Commission Test Biz', 'Owner Comm', '9876543501');
  v_biz_id := (v_biz->>'business_id')::uuid;

  UPDATE public.businesses SET job_management_enabled = true WHERE id = v_biz_id;

  -- Add 2 Staff members
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Staff Aman', '9876543502', 'STAFF', true, true, v_staff_a_auth_id::uuid)
  RETURNING id INTO v_staff_a_id;

  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Staff Bina', '9876543503', 'STAFF', true, true, v_staff_b_auth_id::uuid)
  RETURNING id INTO v_staff_b_id;

  -- Create Job Type: 20% commission on ₹1,000 = ₹200 commission per job
  INSERT INTO public.services (
    name, default_rate, is_job_type, deadline_days, commission_percent, active
  ) VALUES (
    'Certificate Service', 1000, true, 7, 20, true
  ) RETURNING id INTO v_service_id;

  INSERT INTO public.job_type_steps (service_id, position, name)
  VALUES (v_service_id, 1, 'Process Application');

  -- Create Bill with 2 jobs
  v_inv := public.create_invoice(jsonb_build_object(
    'walk_in', jsonb_build_object('name', 'Customer Vikram', 'mobile', '9876543509'),
    'paid', jsonb_build_object('amount', 2000, 'mode', 'CASH'),
    'items', jsonb_build_array(
      jsonb_build_object(
        'service_id', v_service_id,
        'description', 'Job For Staff A',
        'is_job', true,
        'applicant_name', 'Applicant One',
        'quantity', 1,
        'rate', 1000
      ),
      jsonb_build_object(
        'service_id', v_service_id,
        'description', 'Job For Staff B',
        'is_job', true,
        'applicant_name', 'Applicant Two',
        'quantity', 1,
        'rate', 1000
      )
    )
  ));

  -- Assign Job 1 to Staff A and Job 2 to Staff B
  SELECT id INTO v_job_a_id FROM public.jobs WHERE applicant_name = 'Applicant One';
  SELECT id INTO v_job_b_id FROM public.jobs WHERE applicant_name = 'Applicant Two';

  PERFORM public.update_job(v_job_a_id, (SELECT app.today()) + 7, v_staff_a_id);
  PERFORM public.update_job(v_job_b_id, (SELECT app.today()) + 7, v_staff_b_id);

  -- Test 1 & 2: Commission entries created with UPCOMING
  SELECT * INTO v_comm FROM public.commission_entries WHERE job_id = v_job_a_id;
  PERFORM ok(
    v_comm.status = 'UPCOMING' AND v_comm.amount = 200 AND v_comm.staff_id = v_staff_a_id,
    'Staff A commission entry created as UPCOMING with ₹200'
  );

  SELECT * INTO v_comm FROM public.commission_entries WHERE job_id = v_job_b_id;
  PERFORM ok(
    v_comm.status = 'UPCOMING' AND v_comm.amount = 200 AND v_comm.staff_id = v_staff_b_id,
    'Staff B commission entry created as UPCOMING with ₹200'
  );

  -- Test 3: staff_summary shows upcoming 400, earned 0, paid 0
  v_summary := public.staff_summary();
  PERFORM ok(
    (v_summary->>'upcoming')::numeric = 400 AND (v_summary->>'total_earned')::numeric = 0,
    'Staff summary shows total upcoming ₹400 and earned ₹0'
  );

  -- Test 4: Complete Job A -> Commission transitions to EARNED (BR-15)
  SELECT id INTO v_step_a_id FROM public.job_steps WHERE job_id = v_job_a_id;
  PERFORM public.tick_step(v_step_a_id);

  SELECT * INTO v_comm FROM public.commission_entries WHERE job_id = v_job_a_id;
  PERFORM ok(
    v_comm.status = 'EARNED' AND v_comm.earned_at IS NOT NULL,
    'Job A completion transitions Staff A commission to EARNED'
  );

  -- Test 5: Untick step -> Reopens job and reverts commission to UPCOMING (BR-15)
  PERFORM public.untick_step(v_step_a_id);
  SELECT * INTO v_comm FROM public.commission_entries WHERE job_id = v_job_a_id;
  PERFORM ok(
    v_comm.status = 'UPCOMING' AND v_comm.earned_at IS NULL,
    'Unticking step reverts commission status back to UPCOMING'
  );

  -- Re-complete Job A
  PERFORM public.tick_step(v_step_a_id);

  -- Test 6: Updated summary shows earned = 200, upcoming = 200, balance = 200
  v_summary := public.staff_summary();
  PERFORM ok(
    (v_summary->>'total_earned')::numeric = 200 AND
    (v_summary->>'upcoming')::numeric = 200 AND
    (v_summary->>'balance_payable')::numeric = 200,
    'Summary reflects earned ₹200, upcoming ₹200, balance payable ₹200'
  );

  -- Test 7: Owner calls pay_staff for Staff A (₹150, UPI)
  v_payout_res := public.pay_staff(jsonb_build_object(
    'staff_id', v_staff_a_id,
    'amount', 150,
    'mode', 'UPI',
    'notes', 'Partial commission payout'
  ));
  PERFORM ok((v_payout_res->>'success')::boolean = true, 'pay_staff succeeded for ₹150');

  -- Test 8: staff_payouts record created
  SELECT * INTO v_payout_rec FROM public.staff_payouts WHERE id = (v_payout_res->>'payout_id')::uuid;
  PERFORM ok(
    v_payout_rec.amount = 150 AND v_payout_rec.staff_id = v_staff_a_id AND v_payout_rec.mode = 'UPI',
    'staff_payouts row correctly recorded'
  );

  -- Test 9: Expense automatically created in system category "Salary / Commission" (BR-16)
  SELECT * INTO v_expense_rec FROM public.expenses WHERE id = (v_payout_res->>'expense_id')::uuid;
  PERFORM ok(
    v_expense_rec.amount = 150 AND v_expense_rec.staff_id = v_staff_a_id,
    'Expense automatically created in Salary / Commission linked to staff payout'
  );

  -- Test 10: Staff summary for Staff A shows earned 200, paid 150, balance 50
  v_summary := public.staff_summary(v_staff_a_id);
  PERFORM ok(
    (v_summary->>'total_earned')::numeric = 200 AND
    (v_summary->>'total_paid')::numeric = 150 AND
    (v_summary->>'balance_payable')::numeric = 50,
    'Staff A specific summary shows earned ₹200, paid ₹150, balance ₹50'
  );

  -- Test 11: staff_commission returns entries and payouts for Day period
  v_comm_view := public.staff_commission(v_staff_a_id, 'DAY');
  PERFORM ok(
    jsonb_array_length(v_comm_view->'entries') = 1 AND
    jsonb_array_length(v_comm_view->'payouts') = 1,
    'staff_commission returns 1 entry and 1 payout for Staff A'
  );

  -- Test 12: Invalid amount <= 0 rejected by pay_staff
  BEGIN
    PERFORM public.pay_staff(jsonb_build_object(
      'staff_id', v_staff_a_id,
      'amount', -50
    ));
    PERFORM ok(false, 'Negative payout amount should be rejected');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM = 'INVALID_AMOUNT', 'Negative payout amount correctly rejected with INVALID_AMOUNT');
  END;

  -- Test 13: Staff forbidden from calling pay_staff
  PERFORM set_config('request.jwt.claim.sub', v_staff_a_auth_id, true);
  BEGIN
    PERFORM public.pay_staff(jsonb_build_object(
      'staff_id', v_staff_a_id,
      'amount', 50
    ));
    PERFORM ok(false, 'Staff member should be forbidden from calling pay_staff');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM = 'FORBIDDEN', 'Staff forbidden from calling pay_staff');
  END;

  -- Test 14: Staff member calling staff_commission sees only their own data
  v_comm_view := public.staff_commission(v_staff_b_id, 'DAY');
  PERFORM ok(
    (v_comm_view->'entries'->0->>'staff_id')::uuid = v_staff_a_id,
    'Staff calling staff_commission is restricted to own entries even if requesting other staff'
  );

  -- Test 15: Cancelling invoice cancels uncompleted jobs & commission (BR-8)
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  -- Cancel the bill
  PERFORM public.cancel_invoice((v_inv->>'id')::uuid, 'Customer cancelled order');

  SELECT * INTO v_comm FROM public.commission_entries WHERE job_id = v_job_b_id;
  PERFORM ok(v_comm.status = 'CANCELLED', 'Cancelling invoice cancels linked job commission to CANCELLED');

END $$;

SET ROLE authenticated;

DO $$
DECLARE
  v_biz_id uuid;
BEGIN
  SELECT id INTO v_biz_id FROM public.businesses WHERE name = 'Commission Test Biz';
  -- Test 16: staff_payouts table RLS isolation - User from Business B sees 0 payouts
  PERFORM set_config('request.jwt.claim.sub', '99999999-0000-1111-2222-333333333333', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM ok(
    (SELECT COUNT(*) FROM public.staff_payouts WHERE business_id = v_biz_id) = 0,
    'RLS prevents other business auth user from querying staff payouts'
  );
END $$;

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

