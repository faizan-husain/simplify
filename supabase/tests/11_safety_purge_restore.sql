-- Test 11: Safety, Recently Deleted, and 30-Day Purge
-- ===================================================

BEGIN;
SELECT plan(12);

-- 1. Setup Business & Auth Users
INSERT INTO auth.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', '919876543291@simplify.local'),
  ('a2222222-2222-2222-2222-222222222222', '919876543292@simplify.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.businesses (id, name, owner_name, mobile)
VALUES ('b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Safety Test Business', 'Test Owner', '9876543291')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.members (id, business_id, auth_user_id, name, mobile, role, can_login, active)
VALUES
  ('c1111111-beef-beef-beef-beefbeef0001', 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a1111111-1111-1111-1111-111111111111', 'Owner User', '9876543291', 'OWNER', true, true),
  ('c2222222-beef-beef-beef-beefbeef0002', 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a2222222-2222-2222-2222-222222222222', 'Staff User', '9876543292', 'STAFF', true, true)
ON CONFLICT (id) DO NOTHING;

-- Act as Owner
SET LOCAL request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
SET LOCAL request.jwt.claim.role = 'authenticated';

-- Create deletable records: Customer, Service, Vendor, Expense
INSERT INTO public.customers (id, business_id, name, mobile, type)
VALUES ('cccccccc-1111-0000-0000-000000000001', 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Customer To Delete', '9100000001', 'REGULAR');

INSERT INTO public.services (id, business_id, name, default_rate, active)
VALUES ('faaa0000-1111-0000-0000-000000000001', 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Service To Delete', 150, true);

INSERT INTO public.vendors (id, business_id, name, mobile)
VALUES ('feee0000-1111-0000-0000-000000000001', 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Vendor To Delete', '9100000002');

INSERT INTO public.expense_categories (id, business_id, name, system)
VALUES ('eccccccc-0000-0000-0000-000000000001', 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Rent', false);

INSERT INTO public.expenses (id, business_id, fy_label, expense_date, category_id, description, amount, mode)
VALUES (
  'eeeeeeee-1111-0000-0000-000000000001',
  'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '2026-27',
  '2026-10-27',
  'eccccccc-0000-0000-0000-000000000001',
  'Office Stationery',
  500,
  'CASH'
);



-- Test 1: Soft delete customer
SELECT ok(
  (public.soft_delete('customers', 'cccccccc-1111-0000-0000-000000000001')->>'success')::boolean,
  'Customer soft-deleted successfully'
);

-- Test 2: Soft delete service
SELECT ok(
  (public.soft_delete('services', 'faaa0000-1111-0000-0000-000000000001')->>'success')::boolean,
  'Service soft-deleted successfully'
);

-- Test 3: Soft delete vendor
SELECT ok(
  (public.soft_delete('vendors', 'feee0000-1111-0000-0000-000000000001')->>'success')::boolean,
  'Vendor soft-deleted successfully'
);

-- Test 4: Soft delete expense
SELECT ok(
  (public.soft_delete('expenses', 'eeeeeeee-1111-0000-0000-000000000001')->>'success')::boolean,
  'Expense soft-deleted successfully'
);

-- Test 5: list_recently_deleted contains all 4 deleted records
SELECT is(
  jsonb_array_length(public.list_recently_deleted()),
  4,
  'list_recently_deleted contains all 4 soft-deleted records'
);

-- Test 6: Verify types in list_recently_deleted
SELECT ok(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.list_recently_deleted()) elem
    WHERE elem->>'table_name' = 'customers' AND elem->>'label' = 'Customer To Delete'
  ),
  'Deleted customer present in list_recently_deleted'
);

-- Test 7: Verify service in list_recently_deleted
SELECT ok(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.list_recently_deleted()) elem
    WHERE elem->>'table_name' = 'services' AND elem->>'label' = 'Service To Delete'
  ),
  'Deleted service present in list_recently_deleted'
);

-- Test 8: Restore customer
SELECT ok(
  (public.restore_record('customers', 'cccccccc-1111-0000-0000-000000000001')->>'success')::boolean,
  'Customer restored successfully'
);

-- Test 9: Restored customer is no longer in recently deleted
SELECT is(
  jsonb_array_length(public.list_recently_deleted()),
  3,
  'list_recently_deleted count reduced to 3 after customer restoration'
);

-- Test 10: Simulate 35-day-old soft-deleted record and test purge_deleted_records
UPDATE public.services
SET deleted_at = now() - interval '35 days'
WHERE id = 'faaa0000-1111-0000-0000-000000000001';

SELECT ok(
  (public.purge_deleted_records()->>'purged_rows')::int >= 1,
  'purge_deleted_records executed cleanly and purged records'
);

-- Test 11: The 35-day-old service was permanently purged from table
SELECT is(
  (SELECT count(*)::int FROM public.services WHERE id = 'faaa0000-1111-0000-0000-000000000001'),
  0,
  'Expired service record was permanently deleted'
);



-- Test 12: Staff is forbidden from accessing list_recently_deleted
SET LOCAL request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
DO $$
BEGIN
  BEGIN
    PERFORM public.list_recently_deleted();
    PERFORM ok(false, 'Staff should be forbidden from list_recently_deleted');
  EXCEPTION WHEN OTHERS THEN
    PERFORM ok(SQLERRM = 'UNAUTHORIZED', 'Staff forbidden from viewing recently deleted items');
  END;
END $$;


SELECT * FROM finish();
ROLLBACK;
