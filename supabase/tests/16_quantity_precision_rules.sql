-- Test: 16_quantity_precision_rules.sql
-- Verifies:
-- 1. Valid quantities: 1, 5, 1.5, 1.25, 0.01 succeed
-- 2. Invalid precision (scale > 2): 1.345 and 1.34535 are rejected with INVALID_QUANTITY_PRECISION (never silently rounded)
-- 3. Invalid minimum (<= 0): 0 and negative values are rejected with INVALID_QUANTITY_MIN
-- 4. Bill update preserves and validates quantity precision

SELECT plan(10);

-- Setup mock auth user and business
TRUNCATE auth.users, public.businesses CASCADE;
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', '919876543210@simplify.local');

SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
BEGIN
  PERFORM public.register_business('Sharma Services', 'Ramesh Sharma', '9876543210');
END;
$$;

SET ROLE authenticated;

DO $$
DECLARE
  v_inv jsonb;
  v_inv_id uuid;
  v_err text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Test 1: Valid integer quantity 1 succeeds
  v_inv := public.create_invoice(jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Test Item 1', 'quantity', 1, 'rate', 100)
    ),
    'paid', jsonb_build_object('amount', 100, 'mode', 'CASH')
  ));
  PERFORM ok(v_inv ? 'id', 'Valid quantity 1 succeeds');

  -- Test 2: Valid integer quantity 5 succeeds
  v_inv := public.create_invoice(jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Visiting Cards', 'quantity', 5, 'rate', 120)
    ),
    'paid', jsonb_build_object('amount', 600, 'mode', 'CASH')
  ));
  PERFORM ok(v_inv ? 'id', 'Valid quantity 5 succeeds');

  -- Test 3: Valid decimal quantity 1.5 succeeds
  v_inv := public.create_invoice(jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Service Hours', 'quantity', 1.5, 'rate', 200)
    ),
    'paid', jsonb_build_object('amount', 300, 'mode', 'CASH')
  ));
  PERFORM ok(v_inv ? 'id', 'Valid decimal quantity 1.5 succeeds');

  -- Test 4: Valid decimal quantity 1.25 succeeds
  v_inv := public.create_invoice(jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Consulting', 'quantity', 1.25, 'rate', 400)
    ),
    'paid', jsonb_build_object('amount', 500, 'mode', 'CASH')
  ));
  PERFORM ok(v_inv ? 'id', 'Valid decimal quantity 1.25 succeeds');

  -- Test 5: Valid minimum quantity 0.01 succeeds
  v_inv := public.create_invoice(jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Micro item', 'quantity', 0.01, 'rate', 1000)
    ),
    'paid', jsonb_build_object('amount', 10, 'mode', 'CASH')
  ));
  PERFORM ok(v_inv ? 'id', 'Valid minimum quantity 0.01 succeeds');

  -- Test 6: Reject 3 decimal places (1.345)
  BEGIN
    PERFORM public.create_invoice(jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('description', 'Precision Item', 'quantity', 1.345, 'rate', 100)
      )
    ));
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM ok(v_err LIKE '%INVALID_QUANTITY_PRECISION%', 'Quantity with 3 decimal places (1.345) is rejected');

  -- Test 7: Reject unlimited decimal precision (1.34535)
  BEGIN
    PERFORM public.create_invoice(jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('description', 'Precision Item', 'quantity', 1.34535, 'rate', 100)
      )
    ));
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM ok(v_err LIKE '%INVALID_QUANTITY_PRECISION%', 'Quantity with 5 decimal places (1.34535) is rejected');

  -- Test 8: Reject zero quantity
  BEGIN
    PERFORM public.create_invoice(jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('description', 'Zero Item', 'quantity', 0, 'rate', 100)
      )
    ));
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM ok(v_err LIKE '%INVALID_QUANTITY_MIN%', 'Quantity 0 is rejected');

  -- Test 9: Reject negative quantity
  BEGIN
    PERFORM public.create_invoice(jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('description', 'Negative Item', 'quantity', -1.5, 'rate', 100)
      )
    ));
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM ok(v_err LIKE '%INVALID_QUANTITY_MIN%', 'Negative quantity is rejected');

  -- Test 10: update_invoice rejects quantity with > 2 decimal places
  v_inv := public.create_invoice(jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Editable Item', 'quantity', 1, 'rate', 100)
    ),
    'paid', jsonb_build_object('amount', 100, 'mode', 'CASH')
  ));
  v_inv_id := (v_inv->>'id')::uuid;

  BEGIN
    PERFORM public.update_invoice(v_inv_id, jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('description', 'Editable Item', 'quantity', 2.345, 'rate', 100)
      )
    ));
    v_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM ok(v_err LIKE '%INVALID_QUANTITY_PRECISION%', 'update_invoice rejects quantity with > 2 decimal places');
END;
$$;

SELECT * FROM finish();
ROLLBACK;
