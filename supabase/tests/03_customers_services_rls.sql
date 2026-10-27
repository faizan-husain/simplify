-- pgTAP Test: Customers, Services, Mobile Duplicates, and Soft Delete
SELECT plan(11);

-- 1. Setup mock auth users and business as admin
TRUNCATE auth.users CASCADE;
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', '919876543210@simplify.local'),
  ('33333333-3333-3333-3333-333333333333', '919876543212@simplify.local');

-- User A registers Business A
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_biz_a_id uuid;
BEGIN
  v_biz_a_id := (public.register_business('A Enterprises', 'Owner A', '9876543210')->>'business_id')::uuid;

  -- Insert Staff user for Business A (as admin/service-role)
  INSERT INTO public.members (business_id, auth_user_id, name, mobile, role, can_login, active)
  VALUES (v_biz_a_id, '33333333-3333-3333-3333-333333333333', 'Staff Member', '9876543212', 'STAFF', true, true);
END;
$$;

-- Switch to authenticated role to evaluate RLS policies authentically
SET ROLE authenticated;

DO $$
DECLARE
  v_user_a_id uuid := '11111111-1111-1111-1111-111111111111';
  v_user_staff_a uuid := '33333333-3333-3333-3333-333333333333';
  v_cust_1_id uuid;
  v_cust_2_id uuid;
  v_service_id uuid;
  v_dup_check jsonb;
  v_deleted_list jsonb;
  v_count_active int;
  v_count_after_del int;
BEGIN
  -- Set User A (Owner) session
  PERFORM set_config('request.jwt.claim.sub', v_user_a_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 2. Owner creates Customer 1
  INSERT INTO public.customers (name, mobile, type)
  VALUES ('Rohan Verma', '9876500001', 'REGULAR')
  RETURNING id INTO v_cust_1_id;

  PERFORM ok(v_cust_1_id IS NOT NULL, 'Customer 1 created successfully by Owner');

  -- 3. Duplicate mobile check
  v_dup_check := public.check_customer_mobile('+91 98765 00001');
  PERFORM is(jsonb_array_length(v_dup_check), 1, 'check_customer_mobile found 1 matching customer');
  PERFORM is(v_dup_check->0->>'name', 'Rohan Verma', 'Matching customer name is Rohan Verma');

  -- 4. Create new customer with same mobile (Create new anyway / family member)
  INSERT INTO public.customers (name, mobile, type, possible_duplicate)
  VALUES ('Sunita Verma', '9876500001', 'REGULAR', true)
  RETURNING id INTO v_cust_2_id;

  PERFORM ok(v_cust_2_id IS NOT NULL, 'Duplicate mobile allowed with possible_duplicate = true');

  -- 5. Owner creates Service and Job Type
  INSERT INTO public.services (name, default_rate, is_job_type, deadline_days, commission_percent)
  VALUES ('Passport Service', 1500, true, 15, 10)
  RETURNING id INTO v_service_id;

  PERFORM ok(v_service_id IS NOT NULL, 'Service created by Owner');

  INSERT INTO public.job_type_steps (service_id, position, name)
  VALUES (v_service_id, 1, 'Documents Received');

  -- 6. Switch to Staff user
  PERFORM set_config('request.jwt.claim.sub', v_user_staff_a::text, true);
  PERFORM is(app.current_role(), 'STAFF', 'Role switched to STAFF');

  -- Staff can create Walk-in customer
  INSERT INTO public.customers (name, mobile, type)
  VALUES ('Walkin Customer', '9876500002', 'WALK_IN');

  SELECT count(*)::int INTO v_count_active FROM public.customers;
  PERFORM is(v_count_active, 3, 'Staff can view all 3 customers in business');

  -- 7. Switch back to Owner for soft delete test
  PERFORM set_config('request.jwt.claim.sub', v_user_a_id::text, true);

  -- Soft delete customer 2
  PERFORM public.soft_delete('customers', v_cust_2_id);

  SELECT count(*)::int INTO v_count_after_del FROM public.customers;
  PERFORM is(v_count_after_del, 2, 'Soft-deleted customer is excluded from queries');

  -- 8. list_recently_deleted
  v_deleted_list := public.list_recently_deleted();
  PERFORM is(jsonb_array_length(v_deleted_list), 1, 'Recently deleted list contains 1 item');
  PERFORM is(v_deleted_list->0->>'label', 'Sunita Verma', 'Recently deleted item is Sunita Verma');

  -- 9. Restore record
  PERFORM public.restore_record('customers', v_cust_2_id);
  SELECT count(*)::int INTO v_count_active FROM public.customers;
  PERFORM is(v_count_active, 3, 'Restored customer is visible again');

END;
$$;

RESET ROLE;

SELECT finish();
