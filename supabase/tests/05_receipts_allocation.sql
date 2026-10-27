-- Test Suite: 05_receipts_allocation.sql
-- Covers BR-7 (Manual allocation, ALLOCATION_INCOMPLETE, advance, apply_advance),
-- BR-9 (delete receipt reversal reopening balance), dues_list and customer_ledger.

BEGIN;
SELECT plan(15);

-- Setup: Create business, owner, customer, invoices
DO $$
DECLARE
  v_biz jsonb;
  v_cust_res jsonb;
  v_cust_id uuid;
  v_inv1 jsonb;
  v_inv2 jsonb;
  v_inv3 jsonb;
  v_rcpt jsonb;
  v_err_code text;
  v_dues jsonb;
  v_ledger jsonb;
  v_inv_after jsonb;
BEGIN
  -- 1. Register Business
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Receipts Test Business', 'Owner Receipts', '9876543201');

  -- Create a customer
  INSERT INTO public.customers (name, mobile, type)
  VALUES ('Amit Sharma', '9876543202', 'REGULAR')
  RETURNING id INTO v_cust_id;

  -- Create Bill 1: Total ₹100, unpaid
  v_inv1 := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_id,
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Service A', 'quantity', 1, 'rate', 100)
    )
  ));

  -- Create Bill 2: Total ₹200, unpaid
  v_inv2 := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_id,
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Service B', 'quantity', 1, 'rate', 200)
    )
  ));

  -- Test 1: Check outstanding invoices for customer returns both bills (ordered oldest first)
  SELECT public.outstanding_invoices(v_cust_id) INTO v_dues;
  IF jsonb_array_length(v_dues) = 2
     AND (v_dues->0->>'balance')::numeric = 100
     AND (v_dues->1->>'balance')::numeric = 200 THEN
    PERFORM ok(true, 'outstanding_invoices returns 2 unpaid bills ordered oldest first');
  ELSE
    PERFORM ok(false, 'outstanding_invoices failed: ' || v_dues::text);
  END IF;

  -- Test 2: Over-allocation against a single bill is rejected
  BEGIN
    PERFORM public.create_receipt(jsonb_build_object(
      'customer_id', v_cust_id,
      'amount', 150,
      'mode', 'UPI',
      'allocations', jsonb_build_array(
        jsonb_build_object('invoice_id', (v_inv1->>'id')::uuid, 'amount', 150)
      )
    ));
    PERFORM ok(false, 'Over-allocation should have failed');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ALLOCATION_EXCEEDS_INVOICE_BALANCE' THEN
      PERFORM ok(true, 'Over-allocation against bill balance rejected with ALLOCATION_EXCEEDS_INVOICE_BALANCE');
    ELSE
      PERFORM ok(false, 'Unexpected error on over-allocation: ' || SQLERRM);
    END IF;
  END;

  -- Test 3: Total allocation exceeds receipt amount is rejected
  BEGIN
    PERFORM public.create_receipt(jsonb_build_object(
      'customer_id', v_cust_id,
      'amount', 100,
      'mode', 'CASH',
      'allocations', jsonb_build_array(
        jsonb_build_object('invoice_id', (v_inv1->>'id')::uuid, 'amount', 100),
        jsonb_build_object('invoice_id', (v_inv2->>'id')::uuid, 'amount', 50)
      )
    ));
    PERFORM ok(false, 'Allocation exceeding amount should have failed');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ALLOCATION_EXCEEDS_AMOUNT' THEN
      PERFORM ok(true, 'Allocation exceeding receipt amount rejected with ALLOCATION_EXCEEDS_AMOUNT');
    ELSE
      PERFORM ok(false, 'Unexpected error on allocation exceeding amount: ' || SQLERRM);
    END IF;
  END;

  -- Test 4: ALLOCATION_INCOMPLETE: Customer owes ₹300 total; user creates receipt of ₹150 but only allocates ₹100, leaving ₹50 unallocated while bill 2 still has ₹200 due
  BEGIN
    PERFORM public.create_receipt(jsonb_build_object(
      'customer_id', v_cust_id,
      'amount', 150,
      'mode', 'CASH',
      'allocations', jsonb_build_array(
        jsonb_build_object('invoice_id', (v_inv1->>'id')::uuid, 'amount', 100)
      )
    ));
    PERFORM ok(false, 'ALLOCATION_INCOMPLETE should have triggered');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ALLOCATION_INCOMPLETE' THEN
      PERFORM ok(true, 'Partial allocation with remaining dues raises ALLOCATION_INCOMPLETE per BR-7');
    ELSE
      PERFORM ok(false, 'Unexpected error on ALLOCATION_INCOMPLETE: ' || SQLERRM);
    END IF;
  END;

  -- Test 5: Exact manual allocation: user pays ₹100 for Bill 1
  v_rcpt := public.create_receipt(jsonb_build_object(
    'customer_id', v_cust_id,
    'amount', 100,
    'mode', 'UPI',
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', (v_inv1->>'id')::uuid, 'amount', 100)
    )
  ));
  PERFORM ok((v_rcpt->>'amount')::numeric = 100 AND (v_rcpt->>'unallocated_amount')::numeric = 0, 'Receipt 1 created with unallocated = 0');

  -- Test 6: Verify Bill 1 is now fully paid (paid_amount = 100)
  SELECT to_jsonb(i.*) INTO v_inv_after FROM public.invoices i WHERE id = (v_inv1->>'id')::uuid;
  PERFORM ok((v_inv_after->>'paid_amount')::numeric = 100, 'Bill 1 paid_amount updated to 100');

  -- Test 7: Excess payment when ALL bills are settled becomes customer advance (BR-7)
  -- Currently Bill 2 balance is 200. Customer pays 250 and allocates 200 to Bill 2.
  v_rcpt := public.create_receipt(jsonb_build_object(
    'customer_id', v_cust_id,
    'amount', 250,
    'mode', 'BANK',
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', (v_inv2->>'id')::uuid, 'amount', 200)
    )
  ));
  PERFORM ok((v_rcpt->>'unallocated_amount')::numeric = 50, 'Excess ₹50 becomes customer advance (unallocated_amount)');

  -- Test 8: Bill 2 is now fully paid
  SELECT to_jsonb(i.*) INTO v_inv_after FROM public.invoices i WHERE id = (v_inv2->>'id')::uuid;
  PERFORM ok((v_inv_after->>'paid_amount')::numeric = 200, 'Bill 2 paid_amount updated to 200');

  -- Create Bill 3: Total ₹120, unpaid
  v_inv3 := public.create_invoice(jsonb_build_object(
    'customer_id', v_cust_id,
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Service C', 'quantity', 1, 'rate', 120)
    )
  ));

  -- Test 9: Apply advance (₹50) from unallocated receipt to Bill 3
  v_inv_after := public.apply_advance((v_inv3->>'id')::uuid, 50, (v_rcpt->>'id')::uuid);
  PERFORM ok((v_inv_after->>'paid_amount')::numeric = 50, 'apply_advance applied ₹50 advance to Bill 3');

  -- Test 10: Verify receipt unallocated_amount is now 0 after advance was applied
  SELECT to_jsonb(r.*) INTO v_rcpt FROM public.receipts r WHERE r.id = (v_rcpt->>'id')::uuid;
  PERFORM ok((v_rcpt->>'unallocated_amount')::numeric = 0, 'Receipt unallocated_amount reduced to 0');
END $$;

DO $$
DECLARE
  v_rcpt1_id uuid;
  v_inv1_id uuid;
  v_inv1_after jsonb;
  v_cust_id uuid;
  v_dues jsonb;
  v_ledger jsonb;
  v_other_rcpt jsonb;
BEGIN
  SELECT id INTO v_cust_id FROM public.customers WHERE mobile = '9876543202';
  SELECT id INTO v_inv1_id FROM public.invoices WHERE customer_id = v_cust_id AND total = 100;
  SELECT id INTO v_rcpt1_id FROM public.receipts WHERE customer_id = v_cust_id AND amount = 100;

  -- Test 11: Reversal via delete_receipt
  PERFORM public.delete_receipt(v_rcpt1_id);
  SELECT to_jsonb(i.*) INTO v_inv1_after FROM public.invoices i WHERE id = v_inv1_id;
  PERFORM ok((v_inv1_after->>'paid_amount')::numeric = 0, 'delete_receipt reversed allocation and Bill 1 balance reopened to 100');

  -- Test 12: OTHER_INCOME receipt creation (no allocations)
  v_other_rcpt := public.create_receipt(jsonb_build_object(
    'amount', 300,
    'mode', 'CASH',
    'kind', 'OTHER_INCOME',
    'income_category', 'Interest Received',
    'notes', 'Bank interest credit'
  ));
  PERFORM ok(v_other_rcpt->>'kind' = 'OTHER_INCOME' AND (v_other_rcpt->>'amount')::numeric = 300, 'OTHER_INCOME receipt created successfully');

  -- Test 13: dues_list RPC returns customer dues summary
  SELECT public.dues_list('ALL', NULL, 10, 0) INTO v_dues;
  PERFORM ok((v_dues->'summary'->>'total_bills_due')::int >= 1, 'dues_list returns active dues summary');

  -- Test 14: customer_ledger returns chronological entries with debit and credit
  SELECT public.customer_ledger(v_cust_id) INTO v_ledger;
  PERFORM ok(jsonb_array_length(v_ledger->'entries') >= 3, 'customer_ledger returns unified chronological entries');

  -- Test 15: Staff cannot delete receipt (only OWNER or ACCOUNTANT can delete)
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active)
  VALUES ((SELECT app.current_business_id()), 'Staff Person', '9876543209', 'STAFF', true, true);
  
  -- Test role restriction
  PERFORM set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
  UPDATE public.members SET auth_user_id = '99999999-9999-9999-9999-999999999999' WHERE mobile = '9876543209';

  BEGIN
    PERFORM public.delete_receipt((v_other_rcpt->>'id')::uuid);
    PERFORM ok(false, 'Staff should be forbidden from deleting receipts');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN
      PERFORM ok(true, 'Staff deleting receipt rejected with FORBIDDEN');
    ELSE
      PERFORM ok(false, 'Unexpected error on staff delete: ' || SQLERRM);
    END IF;
  END;

END $$;

SELECT * FROM finish();
ROLLBACK;
