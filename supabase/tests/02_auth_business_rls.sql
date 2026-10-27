-- pgTAP Test: Auth, Tenancy, Business Registration, and RLS Isolation
SELECT plan(10);

-- 1. Insert mock auth users as superuser/admin
TRUNCATE auth.users CASCADE;
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', '919876543210@simplify.local'),
  ('22222222-2222-2222-2222-222222222222', '919876543211@simplify.local'),
  ('33333333-3333-3333-3333-333333333333', '919876543212@simplify.local');

-- Switch to authenticated role to evaluate RLS policies authentically
SET ROLE authenticated;

DO $$
DECLARE
  v_user_a_id uuid := '11111111-1111-1111-1111-111111111111';
  v_user_b_id uuid := '22222222-2222-2222-2222-222222222222';
  v_res_a jsonb;
  v_res_b jsonb;
  v_biz_a_id uuid;
  v_biz_b_id uuid;
  v_pin_ok boolean;
  v_pin_bad boolean;
  v_count_biz int;
  v_count_members int;
BEGIN
  -- 2. Simulate User A signing in and registering Business A
  PERFORM set_config('request.jwt.claim.sub', v_user_a_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_res_a := public.register_business('A Enterprises', 'Owner A', '9876543210');
  v_biz_a_id := (v_res_a->>'business_id')::uuid;

  PERFORM ok(v_biz_a_id IS NOT NULL, 'User A registered Business A successfully');
  PERFORM is(v_res_a->>'role', 'OWNER', 'User A has role OWNER');

  -- 3. Idempotent registration test
  v_res_a := public.register_business('A Enterprises Again', 'Owner A', '9876543210');
  PERFORM is((v_res_a->>'business_id')::uuid, v_biz_a_id, 'Calling register_business again is idempotent');

  -- 4. Check app helper functions for User A
  PERFORM is(app.current_business_id(), v_biz_a_id, 'app.current_business_id matches Business A');
  PERFORM is(app.current_role(), 'OWNER', 'app.current_role matches OWNER');

  -- 5. Set and verify Privacy PIN
  PERFORM public.set_privacy_pin('4321');
  v_pin_ok := public.verify_privacy_pin('4321');
  v_pin_bad := public.verify_privacy_pin('9999');
  PERFORM ok(v_pin_ok IS TRUE, 'Privacy PIN verification succeeded for correct PIN');
  PERFORM ok(v_pin_bad IS FALSE, 'Privacy PIN verification failed for incorrect PIN');

  -- 6. User B signs in and registers Business B
  PERFORM set_config('request.jwt.claim.sub', v_user_b_id::text, true);
  v_res_b := public.register_business('B Services', 'Owner B', '9876543211');
  v_biz_b_id := (v_res_b->>'business_id')::uuid;

  PERFORM ok(v_biz_b_id <> v_biz_a_id, 'Business B has distinct ID from Business A');

  -- 7. Tenant Isolation test: User B can only see Business B through RLS
  SELECT count(*)::int INTO v_count_biz FROM public.businesses;
  PERFORM is(v_count_biz, 1, 'User B sees only 1 business (their own)');

  -- 8. Tenant Isolation test: User B cannot see members of Business A
  SELECT count(*)::int INTO v_count_members
  FROM public.members
  WHERE business_id = v_biz_a_id;
  PERFORM is(v_count_members, 0, 'User B cannot see any members belonging to Business A');

END;
$$;

RESET ROLE;

SELECT finish();
