-- Test Suite: 14_team_management_and_accountant_role.sql
-- Covers:
-- 1. Owner creates Staff and Accountant via email + password
-- 2. Non-owner cannot create or delete team members
-- 3. Owner updates member and resets password
-- 4. Owner cannot delete self or modify owner role to non-owner
-- 5. Owner soft-deletes member
-- 6. Self-service password change via change_own_password
-- 7. Accountant role forbidden from job management (list_jobs)
-- 8. Accountant role forbidden from staff commission (staff_summary)

BEGIN;
SELECT plan(13);

DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
  v_owner_auth_id text := '11111111-2222-3333-4444-555555555555';
  v_owner_member_id uuid;
  v_staff_id uuid;
  v_acc_id uuid;
  v_staff_auth_id text;
  v_update_ok boolean;
  v_del_res boolean;
  v_pw_res jsonb;
  v_auth_user record;
BEGIN
  -- 1. Setup Business & Owner
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_owner_auth_id::uuid, 'owner@teamtest.com', public.crypt('initialpass', public.gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Team Management Biz', 'Owner Raj', '9876543601');
  v_biz_id := (v_biz->>'business_id')::uuid;
  v_owner_member_id := (SELECT app.current_member_id());

  -- 2. Owner creates Staff member
  v_staff_id := public.create_team_member(
    'Ramesh Staff',
    'ramesh@teamtest.com',
    'password123',
    'STAFF',
    '9876543602'
  );

  PERFORM ok(
    v_staff_id IS NOT NULL,
    'Owner created Staff member with email and password'
  );

  -- 3. Verify user was created in auth.users with crypted password
  SELECT * INTO v_auth_user FROM auth.users WHERE LOWER(email) = 'ramesh@teamtest.com';
  PERFORM ok(
    v_auth_user.id IS NOT NULL AND v_auth_user.encrypted_password = public.crypt('password123', v_auth_user.encrypted_password),
    'Staff auth.users row created with correctly encrypted password'
  );

  -- 4. Verify Accountant role is rejected (Migration 46: Strictly OWNER & STAFF only)
  BEGIN
    PERFORM public.create_team_member(
      'Suresh Accountant',
      'suresh@teamtest.com',
      'accpass123',
      'ACCOUNTANT',
      '9876543603'
    );
    PERFORM ok(false, 'Creating Accountant should have failed under 2-role architecture');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(true, 'Accountant role creation rejected under 2-role architecture');
  END;

  -- 4b. Create Staff 2 member
  v_acc_id := public.create_team_member(
    'Deepak Staff Two',
    'deepak2@teamtest.com',
    'staffpass123',
    'STAFF',
    '9876543604'
  );
  PERFORM ok(
    v_acc_id IS NOT NULL,
    'Owner created Staff 2 member with email and password'
  );

  -- 5. Duplicate email in same business rejected
  BEGIN
    PERFORM public.create_team_member('Duplicate Staff', 'ramesh@teamtest.com', 'pass123456', 'STAFF');
    PERFORM ok(false, 'Duplicate member email should have failed');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM LIKE '%MEMBER_EXISTS%' OR SQLSTATE = 'P0001', 'Duplicate member email rejected');
  END;

  -- 6. Owner updates team member (update mobile and toggle active)
  v_update_ok := public.update_team_member(
    v_staff_id,
    'Ramesh Kumar Staff',
    '9876543699',
    'STAFF',
    true,
    'newpassword456'
  );

  PERFORM ok(
    v_update_ok = true AND EXISTS(SELECT 1 FROM public.members WHERE id = v_staff_id AND name = 'Ramesh Kumar Staff'),
    'Owner updated team member details successfully'
  );

  -- Verify updated password
  SELECT * INTO v_auth_user FROM auth.users WHERE LOWER(email) = 'ramesh@teamtest.com';
  PERFORM ok(
    v_auth_user.encrypted_password = public.crypt('newpassword456', v_auth_user.encrypted_password),
    'Owner reset team member password successfully'
  );

  -- 7. Owner cannot delete self
  BEGIN
    PERFORM public.delete_team_member(v_owner_member_id);
    PERFORM ok(false, 'Owner deleting self should have failed');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM LIKE '%CANNOT_DELETE_OWNER%' OR SQLSTATE = 'P0001', 'Owner deleting self rejected');
  END;

  -- 8. Owner soft deletes staff member
  v_del_res := public.delete_team_member(v_staff_id);
  PERFORM ok(
    v_del_res = true AND EXISTS(SELECT 1 FROM public.members WHERE id = v_staff_id AND deleted_at IS NOT NULL),
    'Owner soft-deleted team member successfully'
  );

  -- 9. Self-service password change
  v_pw_res := public.change_own_password('brandnewpassword789');
  SELECT * INTO v_auth_user FROM auth.users WHERE id = v_owner_auth_id::uuid;
  PERFORM ok(
    (v_pw_res->>'success')::boolean = true AND v_auth_user.encrypted_password = public.crypt('brandnewpassword789', v_auth_user.encrypted_password),
    'Self-service password change succeeded via change_own_password'
  );

  -- 10. Switch context to Staff 2
  SELECT auth_user_id::text INTO v_staff_auth_id FROM public.members WHERE id = v_acc_id;
  PERFORM set_config('request.jwt.claim.sub', v_staff_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 11. Staff can access list_jobs to view queue and tick steps
  BEGIN
    PERFORM public.list_jobs();
    PERFORM ok(true, 'Staff can access list_jobs for workflow management');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(false, 'Staff should be allowed to access list_jobs');
  END;

  -- 12. Staff forbidden from payout_staff (pay_staff)
  BEGIN
    PERFORM public.pay_staff(jsonb_build_object('staff_id', v_acc_id, 'amount', 1000, 'mode', 'CASH'));
    PERFORM ok(false, 'Staff calling pay_staff should have been rejected');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM LIKE '%FORBIDDEN%' OR SQLSTATE = '42501' OR SQLSTATE = 'P0001', 'Staff forbidden from pay_staff');
  END;

  -- 13. Staff forbidden from creating team members
  BEGIN
    PERFORM public.create_team_member('Fake Member', 'fake@test.com', 'fake123', 'STAFF');
    PERFORM ok(false, 'Staff creating member should have failed');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM LIKE '%FORBIDDEN%' OR SQLSTATE = '42501' OR SQLSTATE = 'P0001', 'Staff forbidden from creating team members');
  END;

END $$;

SELECT * FROM finish();
ROLLBACK;
