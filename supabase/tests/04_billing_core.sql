-- pgTAP Test: Billing Core (Maths, Walk-in rules, Numbering, Lock on edit, Cancel)
SELECT plan(12);

-- 1. Setup mock auth users and business as admin
TRUNCATE auth.users CASCADE;
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', '919876543210@simplify.local');

-- User A registers Business A
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
  v_inv_1 jsonb;
  v_inv_2 jsonb;
  v_inv_3 jsonb;
  v_inv_4 jsonb;
  v_inv_cancel jsonb;
  v_receipt_row public.receipts%ROWTYPE;
  v_due_err text;
  v_lock_err text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. Full-paid walk-in without customer details (BR-5)
  v_inv_1 := public.create_invoice(jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Photocopy', 'quantity', 5, 'rate', 2)
    ),
    'paid', jsonb_build_object('amount', 10, 'mode', 'CASH')
  ));

  PERFORM is(v_inv_1->>'party_name', 'Walk-in', 'Full-paid walk-in party_name defaults to Walk-in');
  PERFORM is(v_inv_1->>'customer_id', NULL, 'Full-paid blank walk-in creates no customer_id');
  PERFORM is((v_inv_1->>'total')::numeric, 10.00::numeric, 'Bill 1 total is 10');
  PERFORM is((v_inv_1->>'paid_amount')::numeric, 10.00::numeric, 'Bill 1 paid_amount is 10');

  -- 2. Partial/Unpaid walk-in WITHOUT name/mobile must fail (BR-5)
  BEGIN
    PERFORM public.create_invoice(jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('description', 'Spiral Binding', 'quantity', 1, 'rate', 50)
      ),
      'paid', jsonb_build_object('amount', 20, 'mode', 'CASH')
    ));
    v_due_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_due_err := SQLERRM;
  END;

  PERFORM is(v_due_err, 'CUSTOMER_REQUIRED_FOR_DUE', 'Unpaid walk-in without customer name/mobile raises CUSTOMER_REQUIRED_FOR_DUE');

  -- 3. Partial walk-in WITH name & mobile creates WALK_IN customer (BR-5)
  v_inv_2 := public.create_invoice(jsonb_build_object(
    'walk_in', jsonb_build_object('name', 'Amit Kumar', 'mobile', '9876512345'),
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Spiral Binding', 'quantity', 2, 'rate', 50)
    ),
    'discount_type', 'FLAT',
    'discount_value', 10,
    'paid', jsonb_build_object('amount', 40, 'mode', 'UPI')
  ));

  PERFORM ok(v_inv_2->>'customer_id' IS NOT NULL, 'Partial walk-in creates WALK_IN customer');
  PERFORM is((v_inv_2->>'subtotal')::numeric, 100.00::numeric, 'Subtotal is 100');
  PERFORM is((v_inv_2->>'total')::numeric, 90.00::numeric, 'Total after 10 discount is 90');
  PERFORM is((v_inv_2->>'paid_amount')::numeric, 40.00::numeric, 'Paid amount is 40');

  -- 4. Unpaid bill without payments can be updated via update_invoice (BR-8)
  v_inv_3 := public.create_invoice(jsonb_build_object(
    'walk_in', jsonb_build_object('name', 'Pooja Singh', 'mobile', '9876523456'),
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Lamination', 'quantity', 1, 'rate', 30)
    )
  ));

  v_inv_4 := public.update_invoice(
    (v_inv_3->>'id')::uuid,
    jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('description', 'Lamination A3', 'quantity', 2, 'rate', 30)
      )
    )
  );
  PERFORM is((v_inv_4->>'total')::numeric, 60.00::numeric, 'Unpaid invoice successfully updated to 60');

  -- 5. Paid invoice CANNOT be updated (raises INVOICE_LOCKED per BR-8)
  BEGIN
    PERFORM public.update_invoice(
      (v_inv_2->>'id')::uuid,
      jsonb_build_object('notes', 'New notes')
    );
    v_lock_err := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_lock_err := SQLERRM;
  END;

  PERFORM is(v_lock_err, 'INVOICE_LOCKED', 'Invoice with payments raises INVOICE_LOCKED on update');

  -- 6. Cancel invoice releases payments to customer advance (BR-8)
  v_inv_cancel := public.cancel_invoice((v_inv_2->>'id')::uuid, 'Customer changed mind');
  PERFORM is(v_inv_cancel->>'status', 'CANCELLED', 'Invoice status is CANCELLED');

  -- Verify allocation released and moved to receipt unallocated_amount
  SELECT * INTO v_receipt_row
  FROM public.receipts
  WHERE customer_id = (v_inv_2->>'customer_id')::uuid;

  PERFORM is(v_receipt_row.unallocated_amount, 40.00::numeric, 'Receipt unallocated_amount increased by 40 (moved to advance)');

END;
$$;

RESET ROLE;

SELECT finish();
