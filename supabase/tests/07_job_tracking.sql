-- Test Suite: 07_job_tracking.sql
-- Covers BR-12 (Job creation, step snapshotting), BR-13 (Step ticking/unticking, auto-completion, reopening, sort order),
-- BR-14 (Deadline buckets Red/Yellow/Due), BR-15 (Commission UPCOMING -> EARNED -> UPCOMING).

BEGIN;
SELECT plan(21);

-- Setup business, job type service, staff, and invoice with job
DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
  v_service_id uuid;
  v_owner_auth_id text := '11111111-2222-3333-4444-555555555555';
  v_staff_auth_id text := '66666666-7777-8888-9999-000000000000';
  v_staff_member_id uuid;
  v_inv jsonb;
  v_job_id uuid;
  v_job_detail jsonb;
  v_step1_id uuid;
  v_step2_id uuid;
  v_step3_id uuid;
  v_tick_res jsonb;
  v_untick_res jsonb;
  v_comm record;
  v_jobs_list jsonb;
  v_updated_job jsonb;
BEGIN
  -- 1. Register business
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Jobs Tracking Biz', 'Owner Jobs', '9876543401');
  v_biz_id := (v_biz->>'business_id')::uuid;

  UPDATE public.businesses SET job_management_enabled = true WHERE id = v_biz_id;

  -- Add staff member
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Deepak Staff', '9876543402', 'STAFF', true, true, v_staff_auth_id::uuid)
  RETURNING id INTO v_staff_member_id;

  -- 2. Create Job Type Service (Passport Application with 3 steps, deadline 10 days, commission 15%)
  INSERT INTO public.services (
    name, default_rate, is_job_type, deadline_days, commission_percent, active
  ) VALUES (
    'Passport Service', 2000, true, 10, 15, true
  ) RETURNING id INTO v_service_id;

  -- Add 3 steps
  INSERT INTO public.job_type_steps (service_id, position, name, whatsapp_message) VALUES
    (v_service_id, 1, 'Documents Verification', 'Hello {party_name}, your documents for {job_name} have been verified.'),
    (v_service_id, 2, 'Police Verification', 'Hello {party_name}, police verification has been scheduled.'),
    (v_service_id, 3, 'Passport Dispatched', 'Namaste {party_name}, your passport is dispatched.');

  -- Switch to staff so bill is created by staff (BR: commission applies to staff-created jobs)
  PERFORM set_config('request.jwt.claim.sub', v_staff_auth_id, true);

  -- 3. Create Bill with this Job line
  v_inv := public.create_invoice(jsonb_build_object(
    'walk_in', jsonb_build_object('name', 'Rahul Sharma', 'mobile', '9876543405'),
    'paid', jsonb_build_object('amount', 2000, 'mode', 'CASH'),
    'items', jsonb_build_array(
      jsonb_build_object(
        'service_id', v_service_id,
        'description', 'Passport Application',
        'is_job', true,
        'applicant_name', 'Rahul Sharma',
        'quantity', 1,
        'rate', 2000
      )
    )
  ));

  -- Switch back to owner for assignment
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
END $$;

-- Switch to authenticated role
SET ROLE authenticated;

DO $$
DECLARE
  v_owner_auth_id text := '11111111-2222-3333-4444-555555555555';
  v_staff_auth_id text := '66666666-7777-8888-9999-000000000000';
  v_staff_id uuid;
  v_job_id uuid;
  v_job_detail jsonb;
  v_step1_id uuid;
  v_step2_id uuid;
  v_step3_id uuid;
  v_tick_res jsonb;
  v_untick_res jsonb;
  v_comm record;
  v_jobs_list jsonb;
  v_updated_job jsonb;
  v_service_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT id INTO v_staff_id FROM public.members WHERE mobile = '9876543402';
  SELECT id INTO v_job_id FROM public.jobs WHERE party_name = 'Rahul Sharma';

  -- Test 1: Job was created inside create_invoice (BR-12)
  PERFORM ok(v_job_id IS NOT NULL, 'Job automatically created from invoice job item');

  -- Test 2: Job detail returns 3 snapshot steps
  SELECT public.job_detail(v_job_id) INTO v_job_detail;
  PERFORM ok(jsonb_array_length(v_job_detail->'steps') = 3, 'Job has 3 snapshot steps');

  -- Test 3: Steps are unticked initially
  PERFORM ok((v_job_detail->'steps'->0->>'ticked')::boolean = false, 'Step 1 is unticked initially');

  -- Test 4: Assign staff to job via update_job (Owner only)
  v_updated_job := public.update_job(v_job_id, '2026-11-06'::date, v_staff_id);
  PERFORM ok((v_updated_job->>'assigned_staff_id')::uuid = v_staff_id, 'Owner assigned staff to job');

  -- Test 5: Commission entry created with status UPCOMING (BR-15: 15% of 2000 = ₹300)
  SELECT * INTO v_comm FROM public.commission_entries WHERE job_id = v_job_id;
  PERFORM ok(
    v_comm.status = 'UPCOMING' AND v_comm.amount = 300 AND v_comm.staff_id = v_staff_id,
    'Commission entry created with status UPCOMING and amount ₹300'
  );

  -- Test 6: Snapshot isolation - editing job type later NEVER affects existing jobs (BR-12)
  SELECT service_id INTO v_service_id FROM public.jobs WHERE id = v_job_id;
  INSERT INTO public.job_type_steps (service_id, position, name) VALUES (v_service_id, 4, 'New Extra Step');
  SELECT public.job_detail(v_job_id) INTO v_job_detail;
  PERFORM ok(jsonb_array_length(v_job_detail->'steps') = 3, 'Existing job snapshot unaffected by later job type step addition');

  -- Extract step IDs
  v_step1_id := (v_job_detail->'steps'->0->>'id')::uuid;
  v_step2_id := (v_job_detail->'steps'->1->>'id')::uuid;
  v_step3_id := (v_job_detail->'steps'->2->>'id')::uuid;

  -- Test 7: Staff can tick step 1 (BR-13)
  PERFORM set_config('request.jwt.claim.sub', v_staff_auth_id, true);
  v_tick_res := public.tick_step(v_step1_id);
  PERFORM ok((v_tick_res->>'job_completed')::boolean = false, 'Step 1 ticked by staff, job still IN_PROGRESS');

  -- Test 8: Event logged in job_step_events
  PERFORM ok(
    EXISTS (SELECT 1 FROM public.job_step_events WHERE job_step_id = v_step1_id AND action = 'TICK'),
    'Step tick event recorded in job_step_events'
  );

  -- Test 9: Tick step 2
  v_tick_res := public.tick_step(v_step2_id);
  PERFORM ok((v_tick_res->>'ticked_steps')::int = 2, '2 of 3 steps ticked');

  -- Test 10: Current jobs sort order: sorted by progress % descending (BR-13)
  SELECT public.list_jobs('CURRENT') INTO v_jobs_list;
  PERFORM ok((v_jobs_list->'jobs'->0->>'progress_percent')::numeric = 66.7, 'Current jobs list displays 66.7% progress');

  -- Test 11: Tick final step 3 -> Auto-complete job & Commission becomes EARNED (BR-13, BR-15)
  v_tick_res := public.tick_step(v_step3_id);
  PERFORM ok((v_tick_res->>'job_completed')::boolean = true, 'All steps ticked -> Job automatically completed');

  -- Test 12: Job status is now COMPLETED
  SELECT status INTO v_comm FROM public.jobs WHERE id = v_job_id;
  PERFORM ok(v_comm.status = 'COMPLETED', 'Job status updated to COMPLETED in database');

  -- Test 13: Commission status transitioned to EARNED
  SELECT status INTO v_comm FROM public.commission_entries WHERE job_id = v_job_id;
  PERFORM ok(v_comm.status = 'EARNED', 'Commission entry automatically transitioned to EARNED on completion');

  -- Test 14: Job now appears in COMPLETED tab and leaves CURRENT tab
  SELECT public.list_jobs('CURRENT') INTO v_jobs_list;
  PERFORM ok(jsonb_array_length(v_jobs_list->'jobs') = 0, 'Completed job leaves CURRENT tab');

  SELECT public.list_jobs('COMPLETED') INTO v_jobs_list;
  PERFORM ok(jsonb_array_length(v_jobs_list->'jobs') = 1, 'Completed job visible in COMPLETED tab');

  -- Test 15: Unticking any step on completed job reopens it and reverts commission to UPCOMING (BR-13, BR-15)
  v_untick_res := public.untick_step(v_step3_id);
  PERFORM ok((v_untick_res->>'job_reopened')::boolean = true, 'Unticking step on completed job reopens it');

  SELECT status INTO v_comm FROM public.jobs WHERE id = v_job_id;
  PERFORM ok(v_comm.status = 'IN_PROGRESS', 'Reopened job status is back to IN_PROGRESS');

  SELECT status INTO v_comm FROM public.commission_entries WHERE job_id = v_job_id;
  PERFORM ok(v_comm.status = 'UPCOMING', 'Commission entry reverted back to UPCOMING on job reopen');

  -- Test 16: Staff cannot call update_job (Owner only)
  BEGIN
    PERFORM public.update_job(v_job_id, '2026-12-01'::date, NULL);
    PERFORM ok(false, 'Staff should be forbidden from update_job');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN
      PERFORM ok(true, 'Staff forbidden from updating job deadline/assignment');
    ELSE
      PERFORM ok(false, 'Unexpected error on staff update_job: ' || SQLERRM);
    END IF;
  END;

  -- Test 17: Deadline bucket boundaries (Red <= 3 days, Yellow 4-5 days) (BR-14)
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  -- Set deadline to today + 2 days (Red)
  PERFORM public.update_job(v_job_id, (SELECT app.today()) + 2, v_staff_id);
  SELECT public.list_jobs('RED') INTO v_jobs_list;
  PERFORM ok(jsonb_array_length(v_jobs_list->'jobs') = 1, 'Job with 2 days left falls in RED tab');

  -- Set deadline to today + 4 days (Yellow)
  PERFORM public.update_job(v_job_id, (SELECT app.today()) + 4, v_staff_id);
  SELECT public.list_jobs('YELLOW') INTO v_jobs_list;
  PERFORM ok(jsonb_array_length(v_jobs_list->'jobs') = 1, 'Job with 4 days left falls in YELLOW tab');

END $$;

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
