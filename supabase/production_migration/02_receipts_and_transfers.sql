-- 7. Upgrade create_receipt with Idempotency, Customer Row Lock & Canonical Lock Order
CREATE OR REPLACE FUNCTION public.create_receipt(
  payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_date date;
  v_fy text;
  v_num text;
  v_cust_id uuid;
  v_amount numeric(14,2);
  v_mode text;
  v_ref text;
  v_kind text;
  v_cat text;
  v_notes text;
  v_bank_account_id uuid;
  v_bank_name text;

  v_allocs jsonb;
  v_alloc_count int;
  v_alloc_elem jsonb;
  v_inv_id uuid;
  v_alloc_amt numeric(14,2);
  v_total_allocated numeric(14,2) := 0;
  v_unallocated numeric(14,2) := 0;

  v_inv public.invoices%ROWTYPE;
  v_inv_balance numeric(14,2);
  v_cust_total_due numeric(14,2);
  v_remaining_customer_due numeric(14,2);
  v_receipt public.receipts%ROWTYPE;
  i int;

  v_idem_key text;
  v_idem_status text;
  v_cached_resp jsonb;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency Check
  v_idem_key := NULLIF(TRIM(COALESCE(payload->>'idempotency_key', '')), '');
  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, updated_at)
    VALUES (v_biz_id, v_idem_key, 'CREATE_RECEIPT', 'PROCESSING', now())
    ON CONFLICT (business_id, key) DO NOTHING;

    SELECT status, response INTO v_idem_status, v_cached_resp
    FROM public.idempotency_keys
    WHERE business_id = v_biz_id AND key = v_idem_key
    FOR UPDATE;

    IF v_idem_status = 'COMPLETED' AND v_cached_resp IS NOT NULL THEN
      RETURN v_cached_resp;
    END IF;
  END IF;

  v_date := COALESCE((payload->>'receipt_date')::date, (SELECT app.today()));
  v_fy := public.fy_label(v_date);

  v_kind := UPPER(COALESCE(payload->>'kind', 'INVOICE_PAYMENT'));
  v_mode := UPPER(COALESCE(payload->>'mode', 'CASH'));
  v_amount := ROUND(COALESCE((payload->>'amount')::numeric, 0), 2);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  v_ref := payload->>'reference';
  v_notes := payload->>'notes';

  IF payload->>'bank_account_id' IS NOT NULL AND payload->>'bank_account_id' <> '' THEN
    v_bank_account_id := (payload->>'bank_account_id')::uuid;
    v_bank_name := payload->>'bank_name';
  END IF;

  -- Race-free receipt numbering
  v_num := public.next_receipt_number(v_biz_id, v_fy);

  IF v_kind = 'OTHER_INCOME' THEN
    v_cat := COALESCE(payload->>'income_category', 'Other Income');
    IF payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
      v_cust_id := (payload->>'customer_id')::uuid;
    END IF;

    INSERT INTO public.receipts (
      business_id, number, fy_label, receipt_date, customer_id, amount,
      mode, reference, kind, income_category, unallocated_amount, notes,
      bank_account_id, bank_name, created_by, updated_by
    ) VALUES (
      v_biz_id, v_num, v_fy, v_date, v_cust_id, v_amount,
      v_mode, v_ref, 'OTHER_INCOME', v_cat, 0, v_notes,
      v_bank_account_id, v_bank_name, v_member_id, v_member_id
    ) RETURNING * INTO v_receipt;

    v_result := to_jsonb(v_receipt);

    IF v_idem_key IS NOT NULL THEN
      INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
      VALUES (v_biz_id, v_idem_key, 'CREATE_RECEIPT', 'COMPLETED', v_result, now())
      ON CONFLICT (business_id, key)
      DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
    END IF;

    RETURN v_result;
  END IF;

  -- INVOICE_PAYMENT PATH
  IF payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
    v_cust_id := (payload->>'customer_id')::uuid;
  END IF;

  v_allocs := payload->'allocations';
  v_alloc_count := COALESCE(jsonb_array_length(v_allocs), 0);

  IF v_cust_id IS NULL AND v_alloc_count > 0 THEN
    SELECT customer_id INTO v_cust_id
    FROM public.invoices
    WHERE id = (v_allocs->0->>'invoice_id')::uuid AND business_id = v_biz_id;
  END IF;

  IF v_cust_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_RECEIPT' USING ERRCODE = 'P0001';
  END IF;

  -- CRITICAL CONCURRENCY LOCK: Lock Customer Row FOR UPDATE
  -- This serializes concurrent receipt and advance operations for THIS customer only.
  PERFORM 1 FROM public.customers
  WHERE id = v_cust_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- DEADLOCK PREVENTION: Lock all allocated invoices in canonical UUID ascending order
  IF v_alloc_count > 0 THEN
    FOR v_inv IN
      SELECT *
      FROM public.invoices
      WHERE id IN (
        SELECT (elem->>'invoice_id')::uuid
        FROM jsonb_array_elements(v_allocs) elem
        WHERE (elem->>'invoice_id') IS NOT NULL AND (elem->>'invoice_id') <> ''
      )
      AND business_id = v_biz_id
      AND deleted_at IS NULL
      ORDER BY id ASC
      FOR UPDATE
    LOOP
      NULL; -- Rows are now locked in strict canonical order
    END LOOP;

    -- Validate each allocation against locked invoices
    FOR i IN 0..(v_alloc_count - 1) LOOP
      v_alloc_elem := v_allocs->i;
      v_inv_id := (v_alloc_elem->>'invoice_id')::uuid;
      v_alloc_amt := ROUND((v_alloc_elem->>'amount')::numeric, 2);

      IF v_alloc_amt IS NULL OR v_alloc_amt <= 0 THEN
        RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT' USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_inv
      FROM public.invoices
      WHERE id = v_inv_id AND business_id = v_biz_id AND status = 'ACTIVE' AND deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
      END IF;

      v_inv_balance := v_inv.total - v_inv.paid_amount;
      IF v_alloc_amt > v_inv_balance THEN
        RAISE EXCEPTION 'ALLOCATION_EXCEEDS_INVOICE_BALANCE' USING ERRCODE = 'P0001',
          DETAIL = jsonb_build_object('invoice_id', v_inv_id, 'balance', v_inv_balance, 'allocated', v_alloc_amt)::text;
      END IF;

      v_total_allocated := v_total_allocated + v_alloc_amt;
    END LOOP;
  END IF;

  IF v_total_allocated > v_amount THEN
    RAISE EXCEPTION 'ALLOCATION_EXCEEDS_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  -- BR-7 Rule check under Customer Lock
  IF v_total_allocated < v_amount THEN
    SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_cust_total_due
    FROM public.invoices
    WHERE business_id = v_biz_id AND customer_id = v_cust_id AND status = 'ACTIVE' AND deleted_at IS NULL
      AND (total - paid_amount) > 0;

    v_remaining_customer_due := v_cust_total_due - v_total_allocated;

    IF v_remaining_customer_due > 0 THEN
      RAISE EXCEPTION 'ALLOCATION_INCOMPLETE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('unallocated', v_amount - v_total_allocated, 'remaining_due', v_remaining_customer_due)::text;
    ELSE
      v_unallocated := v_amount - v_total_allocated;
    END IF;
  ELSE
    v_unallocated := 0;
  END IF;

  -- Insert receipt record
  INSERT INTO public.receipts (
    business_id, number, fy_label, receipt_date, customer_id, amount,
    mode, reference, kind, income_category, unallocated_amount, notes,
    bank_account_id, bank_name, created_by, updated_by
  ) VALUES (
    v_biz_id, v_num, v_fy, v_date, v_cust_id, v_amount,
    v_mode, v_ref, 'INVOICE_PAYMENT', NULL, v_unallocated, v_notes,
    v_bank_account_id, v_bank_name, v_member_id, v_member_id
  ) RETURNING * INTO v_receipt;

  -- Insert allocations and update invoice paid amounts
  IF v_alloc_count > 0 THEN
    FOR i IN 0..(v_alloc_count - 1) LOOP
      v_alloc_elem := v_allocs->i;
      v_inv_id := (v_alloc_elem->>'invoice_id')::uuid;
      v_alloc_amt := ROUND((v_alloc_elem->>'amount')::numeric, 2);

      INSERT INTO public.receipt_allocations (
        business_id, receipt_id, invoice_id, amount, created_by, updated_by
      ) VALUES (
        v_biz_id, v_receipt.id, v_inv_id, v_alloc_amt, v_member_id, v_member_id
      );

      UPDATE public.invoices
      SET paid_amount = paid_amount + v_alloc_amt, updated_at = now(), updated_by = v_member_id
      WHERE id = v_inv_id;
    END LOOP;
  END IF;

  v_result := to_jsonb(v_receipt);

  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
    VALUES (v_biz_id, v_idem_key, 'CREATE_RECEIPT', 'COMPLETED', v_result, now())
    ON CONFLICT (business_id, key)
    DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;


-- 8. Upgrade record_money_transfer with Canonical Locking (No Cross-Transfer Deadlocks)
CREATE OR REPLACE FUNCTION public.record_money_transfer(
  payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_type text;
  v_date date;
  v_from_id uuid := NULL;
  v_to_id uuid := NULL;
  v_amount numeric(14,2);
  v_ref text;
  v_notes text;
  v_transfer public.money_transfers%ROWTYPE;
  v_idem_key text;
  v_idem_status text;
  v_cached_resp jsonb;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency check
  v_idem_key := NULLIF(TRIM(COALESCE(payload->>'idempotency_key', '')), '');
  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, updated_at)
    VALUES (v_biz_id, v_idem_key, 'TRANSFER', 'PROCESSING', now())
    ON CONFLICT (business_id, key) DO NOTHING;

    SELECT status, response INTO v_idem_status, v_cached_resp
    FROM public.idempotency_keys
    WHERE business_id = v_biz_id AND key = v_idem_key
    FOR UPDATE;

    IF v_idem_status = 'COMPLETED' AND v_cached_resp IS NOT NULL THEN
      RETURN v_cached_resp;
    END IF;
  END IF;

  v_type := UPPER(COALESCE(payload->>'transfer_type', ''));
  v_amount := ROUND(COALESCE((payload->>'amount')::numeric, 0), 2);
  v_date := COALESCE((payload->>'transfer_date')::date, (SELECT app.today()));
  v_ref := NULLIF(TRIM(payload->>'reference'), '');
  v_notes := NULLIF(TRIM(payload->>'notes'), '');

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  IF payload->>'from_bank_account_id' IS NOT NULL AND payload->>'from_bank_account_id' <> '' THEN
    v_from_id := (payload->>'from_bank_account_id')::uuid;
  END IF;

  IF payload->>'to_bank_account_id' IS NOT NULL AND payload->>'to_bank_account_id' <> '' THEN
    v_to_id := (payload->>'to_bank_account_id')::uuid;
  END IF;

  -- CANONICAL ORDER ROW LOCKING: Eliminate deadlocks between simultaneous cross transfers
  IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bank_accounts
    WHERE id IN (v_from_id, v_to_id) AND business_id = v_biz_id AND active = true AND deleted_at IS NULL
    ORDER BY id ASC
    FOR UPDATE;
  ELSIF v_from_id IS NOT NULL THEN
    PERFORM 1 FROM public.bank_accounts
    WHERE id = v_from_id AND business_id = v_biz_id AND active = true AND deleted_at IS NULL
    FOR UPDATE;
  ELSIF v_to_id IS NOT NULL THEN
    PERFORM 1 FROM public.bank_accounts
    WHERE id = v_to_id AND business_id = v_biz_id AND active = true AND deleted_at IS NULL
    FOR UPDATE;
  END IF;

  INSERT INTO public.money_transfers (
    business_id, transfer_date, transfer_type, from_bank_account_id, to_bank_account_id,
    amount, reference, notes, created_by, updated_by
  ) VALUES (
    v_biz_id, v_date, v_type, v_from_id, v_to_id,
    v_amount, v_ref, v_notes, v_member_id, v_member_id
  ) RETURNING * INTO v_transfer;

  v_result := to_jsonb(v_transfer);

  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
    VALUES (v_biz_id, v_idem_key, 'TRANSFER', 'COMPLETED', v_result, now())
    ON CONFLICT (business_id, key)
    DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;


-- 9. Upgrade pay_staff with Idempotency and Staff Row Lock
CREATE OR REPLACE FUNCTION public.pay_staff(
  payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_today date;
  v_staff_id uuid;
  v_staff record;
  v_amount numeric(14,2);
  v_payout_date date;
  v_mode text;
  v_notes text;
  v_cat_id uuid;
  v_expense_id uuid;
  v_payout_id uuid;
  v_fy text;
  v_idem_key text;
  v_idem_status text;
  v_cached_resp jsonb;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_idem_key := NULLIF(TRIM(COALESCE(payload->>'idempotency_key', '')), '');
  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, updated_at)
    VALUES (v_biz_id, v_idem_key, 'PAY_STAFF', 'PROCESSING', now())
    ON CONFLICT (business_id, key) DO NOTHING;

    SELECT status, response INTO v_idem_status, v_cached_resp
    FROM public.idempotency_keys
    WHERE business_id = v_biz_id AND key = v_idem_key
    FOR UPDATE;

    IF v_idem_status = 'COMPLETED' AND v_cached_resp IS NOT NULL THEN
      RETURN v_cached_resp;
    END IF;
  END IF;

  v_staff_id := (payload->>'staff_id')::uuid;
  v_amount := ROUND(COALESCE((payload->>'amount')::numeric, 0), 2);
  v_payout_date := COALESCE((payload->>'payout_date')::date, v_today);
  v_mode := COALESCE(payload->>'mode', 'CASH');
  v_notes := payload->>'notes';

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  -- Lock Staff Row FOR UPDATE to prevent simultaneous double payouts
  SELECT id, name, role INTO v_staff
  FROM public.members
  WHERE id = v_staff_id AND business_id = v_biz_id AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_cat_id
  FROM public.expense_categories
  WHERE business_id = v_biz_id AND name = 'Salary / Commission';

  IF v_cat_id IS NULL THEN
    INSERT INTO public.expense_categories (business_id, name, system)
    VALUES (v_biz_id, 'Salary / Commission', true)
    RETURNING id INTO v_cat_id;
  END IF;

  v_fy := public.fy_label(v_payout_date);

  INSERT INTO public.expenses (
    business_id, fy_label, expense_date, category_id, description, amount,
    mode, payee, staff_id, notes, created_by, updated_by
  ) VALUES (
    v_biz_id, v_fy, v_payout_date, v_cat_id, 'Staff Payout: ' || v_staff.name,
    v_amount, v_mode, v_staff.name, v_staff.id, v_notes, v_member_id, v_member_id
  ) RETURNING id INTO v_expense_id;

  INSERT INTO public.staff_payouts (
    business_id, staff_id, amount, payout_date, mode, notes, expense_id, created_by, updated_by
  ) VALUES (
    v_biz_id, v_staff_id, v_amount, v_payout_date, v_mode, v_notes, v_expense_id, v_member_id, v_member_id
  ) RETURNING id INTO v_payout_id;

  v_result := jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'expense_id', v_expense_id,
    'staff_id', v_staff_id,
    'amount', v_amount
  );

  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
    VALUES (v_biz_id, v_idem_key, 'PAY_STAFF', 'COMPLETED', v_result, now())
    ON CONFLICT (business_id, key)
    DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;


-- 9. Upgrade delete_receipt with Deterministic Canonical Lock Ordering & Customer Row Lock
CREATE OR REPLACE FUNCTION public.delete_receipt(id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_rcpt public.receipts%ROWTYPE;
  v_alloc record;
  v_inv_ids uuid[];
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rcpt
  FROM public.receipts
  WHERE receipts.id = delete_receipt.id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Lock customer row to serialize ledger operations
  IF v_rcpt.customer_id IS NOT NULL THEN
    PERFORM 1 FROM public.customers
    WHERE customers.id = v_rcpt.customer_id AND business_id = v_biz_id
    FOR UPDATE;
  END IF;

  -- Lock all affected invoices in canonical ascending order to prevent deadlocks
  SELECT array_agg(DISTINCT invoice_id ORDER BY invoice_id ASC) INTO v_inv_ids
  FROM public.receipt_allocations
  WHERE receipt_id = v_rcpt.id AND deleted_at IS NULL;

  IF v_inv_ids IS NOT NULL AND array_length(v_inv_ids, 1) > 0 THEN
    PERFORM 1 FROM public.invoices
    WHERE invoices.id = ANY(v_inv_ids) AND business_id = v_biz_id
    ORDER BY invoices.id ASC
    FOR UPDATE;
  END IF;

  -- Reverse allocations (reopen invoice balance)
  FOR v_alloc IN
    SELECT * FROM public.receipt_allocations
    WHERE receipt_id = v_rcpt.id AND deleted_at IS NULL
    ORDER BY id ASC
    FOR UPDATE
  LOOP
    UPDATE public.invoices
    SET paid_amount = GREATEST(0, paid_amount - v_alloc.amount),
        updated_at = now(),
        updated_by = v_member_id
    WHERE invoices.id = v_alloc.invoice_id;

    UPDATE public.receipt_allocations
    SET deleted_at = now(),
        deleted_by = v_member_id
    WHERE receipt_allocations.id = v_alloc.id;
  END LOOP;

  -- Soft-delete receipt
  UPDATE public.receipts
  SET deleted_at = now(),
      deleted_by = v_member_id
  WHERE receipts.id = v_rcpt.id;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_rcpt.id,
    'amount', v_rcpt.amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_receipt(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_receipt(uuid) TO authenticated;


-- 10. Upgrade apply_advance with Customer Row Lock & Canonical Lock Ordering
CREATE OR REPLACE FUNCTION public.apply_advance(
  invoice_id uuid,
  amount numeric,
  receipt_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_inv public.invoices%ROWTYPE;
  v_rcpt public.receipts%ROWTYPE;
  v_amt numeric(14,2);
  v_inv_balance numeric(14,2);
  v_remaining_to_apply numeric(14,2);
  v_step_amt numeric(14,2);
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_amt := ROUND(amount, 2);
  IF v_amt IS NULL OR v_amt <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoices
  WHERE invoices.id = apply_advance.invoice_id
    AND business_id = v_biz_id
    AND status = 'ACTIVE'
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.customer_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_ADVANCE' USING ERRCODE = 'P0001';
  END IF;

  -- Lock customer row to serialize advance ledger movements
  PERFORM 1 FROM public.customers
  WHERE customers.id = v_inv.customer_id AND business_id = v_biz_id
  FOR UPDATE;

  v_inv_balance := v_inv.total - v_inv.paid_amount;
  IF v_amt > v_inv_balance THEN
    RAISE EXCEPTION 'ADVANCE_EXCEEDS_INVOICE_BALANCE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('balance', v_inv_balance, 'requested', v_amt)::text;
  END IF;

  IF receipt_id IS NOT NULL THEN
    SELECT * INTO v_rcpt
    FROM public.receipts
    WHERE receipts.id = apply_advance.receipt_id
      AND business_id = v_biz_id
      AND customer_id = v_inv.customer_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    IF v_rcpt.unallocated_amount < v_amt THEN
      RAISE EXCEPTION 'INSUFFICIENT_ADVANCE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('available', v_rcpt.unallocated_amount, 'requested', v_amt)::text;
    END IF;

    UPDATE public.receipts
    SET unallocated_amount = unallocated_amount - v_amt,
        updated_at = now(),
        updated_by = v_member_id
    WHERE receipts.id = v_rcpt.id;

    INSERT INTO public.receipt_allocations (
      business_id, receipt_id, invoice_id, amount, created_by, updated_by
    ) VALUES (
      v_biz_id, v_rcpt.id, v_inv.id, v_amt, v_member_id, v_member_id
    );

    UPDATE public.invoices
    SET paid_amount = paid_amount + v_amt,
        updated_at = now(),
        updated_by = v_member_id
    WHERE invoices.id = v_inv.id
    RETURNING * INTO v_inv;
  ELSE
    -- FIFO across receipts with unallocated advance for customer
    v_remaining_to_apply := v_amt;

    FOR v_rcpt IN
      SELECT * FROM public.receipts
      WHERE business_id = v_biz_id
        AND customer_id = v_inv.customer_id
        AND unallocated_amount > 0
        AND deleted_at IS NULL
      ORDER BY receipt_date ASC, created_at ASC
      FOR UPDATE
    LOOP
      v_step_amt := LEAST(v_remaining_to_apply, v_rcpt.unallocated_amount);
      IF v_step_amt > 0 THEN
        UPDATE public.receipts
        SET unallocated_amount = unallocated_amount - v_step_amt,
            updated_at = now(),
            updated_by = v_member_id
        WHERE receipts.id = v_rcpt.id;

        INSERT INTO public.receipt_allocations (
          business_id, receipt_id, invoice_id, amount, created_by, updated_by
        ) VALUES (
          v_biz_id, v_rcpt.id, v_inv.id, v_step_amt, v_member_id, v_member_id
        );

        v_remaining_to_apply := v_remaining_to_apply - v_step_amt;
      END IF;

      EXIT WHEN v_remaining_to_apply <= 0;
    END LOOP;

    IF v_remaining_to_apply > 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_ADVANCE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('unapplied', v_remaining_to_apply)::text;
    END IF;

    UPDATE public.invoices
    SET paid_amount = paid_amount + v_amt,
        updated_at = now(),
        updated_by = v_member_id
    WHERE invoices.id = v_inv.id
    RETURNING * INTO v_inv;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv.id,
    'applied_amount', v_amt,
    'paid_amount', v_inv.paid_amount,
    'balance', v_inv.total - v_inv.paid_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_advance(uuid, numeric, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apply_advance(uuid, numeric, uuid) TO authenticated;

