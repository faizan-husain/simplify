-- Helper RPC: next_receipt_number overload
CREATE OR REPLACE FUNCTION public.next_receipt_number(p_date date)
RETURNS text AS $$
DECLARE
  v_biz_id uuid;
  v_fy text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_fy := public.fy_label(p_date);
  RETURN public.next_receipt_number(v_biz_id, v_fy);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.next_receipt_number(date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.next_receipt_number(date) TO authenticated;

-- RPC: create_receipt (BR-7)
CREATE OR REPLACE FUNCTION public.create_receipt(
  payload jsonb
)
RETURNS jsonb AS $$
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
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_date := COALESCE((payload->>'receipt_date')::date, (SELECT app.today()));
  v_fy := public.fy_label(v_date);
  v_num := public.next_receipt_number(v_biz_id, v_fy);

  v_kind := UPPER(COALESCE(payload->>'kind', 'INVOICE_PAYMENT'));
  IF v_kind NOT IN ('INVOICE_PAYMENT', 'OTHER_INCOME') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = 'P0001';
  END IF;

  v_mode := UPPER(COALESCE(payload->>'mode', 'CASH'));
  IF v_mode NOT IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MODE' USING ERRCODE = 'P0001';
  END IF;

  v_amount := ROUND((payload->>'amount')::numeric, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  v_ref := payload->>'reference';
  v_notes := payload->>'notes';

  IF v_kind = 'OTHER_INCOME' THEN
    v_cat := COALESCE(payload->>'income_category', 'Other Income');
    IF payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
      v_cust_id := (payload->>'customer_id')::uuid;
    END IF;

    -- OTHER_INCOME cannot have invoice allocations
    IF payload ? 'allocations' AND jsonb_array_length(payload->'allocations') > 0 THEN
      RAISE EXCEPTION 'OTHER_INCOME_CANNOT_HAVE_ALLOCATIONS' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.receipts (
      business_id, number, fy_label, receipt_date, customer_id, amount,
      mode, reference, kind, income_category, unallocated_amount, notes,
      created_by, updated_by
    ) VALUES (
      v_biz_id, v_num, v_fy, v_date, v_cust_id, v_amount,
      v_mode, v_ref, 'OTHER_INCOME', v_cat, 0, v_notes,
      v_member_id, v_member_id
    ) RETURNING * INTO v_receipt;

    RETURN to_jsonb(v_receipt);
  END IF;

  -- INVOICE_PAYMENT path
  IF payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
    v_cust_id := (payload->>'customer_id')::uuid;
  END IF;

  v_allocs := payload->'allocations';
  v_alloc_count := COALESCE(jsonb_array_length(v_allocs), 0);

  -- Infer customer from invoice if not explicitly provided
  IF v_cust_id IS NULL AND v_alloc_count > 0 THEN
    SELECT customer_id INTO v_cust_id
    FROM public.invoices
    WHERE id = (v_allocs->0->>'invoice_id')::uuid AND business_id = v_biz_id;
  END IF;

  IF v_cust_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_RECEIPT' USING ERRCODE = 'P0001';
  END IF;

  -- Verify customer exists in business
  PERFORM 1 FROM public.customers
  WHERE id = v_cust_id AND business_id = v_biz_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Validate each allocation
  IF v_alloc_count > 0 THEN
    FOR i IN 0..(v_alloc_count - 1) LOOP
      v_alloc_elem := v_allocs->i;
      v_inv_id := (v_alloc_elem->>'invoice_id')::uuid;
      v_alloc_amt := ROUND((v_alloc_elem->>'amount')::numeric, 2);

      IF v_alloc_amt IS NULL OR v_alloc_amt <= 0 THEN
        RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT' USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_inv
      FROM public.invoices
      WHERE id = v_inv_id AND business_id = v_biz_id AND status = 'ACTIVE' AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('invoice_id', v_inv_id)::text;
      END IF;

      IF v_inv.customer_id IS NOT NULL AND v_inv.customer_id <> v_cust_id THEN
        RAISE EXCEPTION 'INVOICE_CUSTOMER_MISMATCH' USING ERRCODE = 'P0001';
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

  -- BR-7 Rule: Save is allowed only if unallocated = 0, or all customer dues are fully allocated
  IF v_total_allocated < v_amount THEN
    SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_cust_total_due
    FROM public.invoices
    WHERE business_id = v_biz_id
      AND customer_id = v_cust_id
      AND status = 'ACTIVE'
      AND deleted_at IS NULL
      AND (total - paid_amount) > 0;

    v_remaining_customer_due := v_cust_total_due - v_total_allocated;

    IF v_remaining_customer_due > 0 THEN
      RAISE EXCEPTION 'ALLOCATION_INCOMPLETE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('unallocated', v_amount - v_total_allocated, 'remaining_due', v_remaining_customer_due)::text;
    ELSE
      -- All invoices for customer are settled; remainder becomes customer advance
      v_unallocated := v_amount - v_total_allocated;
    END IF;
  ELSE
    v_unallocated := 0;
  END IF;

  -- Insert receipt
  INSERT INTO public.receipts (
    business_id, number, fy_label, receipt_date, customer_id, amount,
    mode, reference, kind, income_category, unallocated_amount, notes,
    created_by, updated_by
  ) VALUES (
    v_biz_id, v_num, v_fy, v_date, v_cust_id, v_amount,
    v_mode, v_ref, 'INVOICE_PAYMENT', NULL, v_unallocated, v_notes,
    v_member_id, v_member_id
  ) RETURNING * INTO v_receipt;

  -- Insert allocations & update invoice paid amounts
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
      SET paid_amount = paid_amount + v_alloc_amt,
          updated_at = now(),
          updated_by = v_member_id
      WHERE id = v_inv_id;
    END LOOP;
  END IF;

  RETURN to_jsonb(v_receipt);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.create_receipt(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_receipt(jsonb) TO authenticated;


-- RPC: delete_receipt (BR-9)
CREATE OR REPLACE FUNCTION public.delete_receipt(
  id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_rcpt public.receipts%ROWTYPE;
  v_alloc record;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rcpt
  FROM public.receipts
  WHERE receipts.id = delete_receipt.id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Reverse allocations (reopen invoice balance)
  FOR v_alloc IN
    SELECT * FROM public.receipt_allocations
    WHERE receipt_id = v_rcpt.id AND deleted_at IS NULL
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.delete_receipt(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_receipt(uuid) TO authenticated;


-- RPC: apply_advance (BR-7)
CREATE OR REPLACE FUNCTION public.apply_advance(
  invoice_id uuid,
  amount numeric,
  receipt_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
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

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
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

  RETURN to_jsonb(v_inv);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.apply_advance(uuid, numeric, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apply_advance(uuid, numeric, uuid) TO authenticated;


-- RPC: outstanding_invoices (BR-7)
CREATE OR REPLACE FUNCTION public.outstanding_invoices(
  customer_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'number', i.number,
        'fy_label', i.fy_label,
        'invoice_date', i.invoice_date,
        'due_date', i.due_date,
        'party_name', i.party_name,
        'party_mobile', i.party_mobile,
        'total', i.total,
        'paid_amount', i.paid_amount,
        'balance', (i.total - i.paid_amount),
        'days_overdue', GREATEST(0, (SELECT app.today()) - i.due_date),
        'is_overdue', (i.due_date < (SELECT app.today()))
      )
      ORDER BY i.invoice_date ASC, i.created_at ASC
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM public.invoices i
  WHERE i.business_id = v_biz_id
    AND i.customer_id = outstanding_invoices.customer_id
    AND i.status = 'ACTIVE'
    AND i.deleted_at IS NULL
    AND (i.total - i.paid_amount) > 0;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.outstanding_invoices(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.outstanding_invoices(uuid) TO authenticated;


-- RPC: dues_list (§8.11, §11)
CREATE OR REPLACE FUNCTION public.dues_list(
  p_filter text DEFAULT 'ALL',
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_today date;
  v_total_outstanding numeric(14,2) := 0;
  v_total_overdue numeric(14,2) := 0;
  v_total_bills_due int := 0;
  v_customer_count int := 0;
  v_customers jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_today := (SELECT app.today());

  -- Summary totals across all active unpaid bills
  SELECT
    COALESCE(SUM(i.total - i.paid_amount), 0),
    COALESCE(SUM(CASE WHEN i.due_date < v_today THEN (i.total - i.paid_amount) ELSE 0 END), 0),
    COUNT(i.id),
    COUNT(DISTINCT COALESCE(i.customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  INTO
    v_total_outstanding,
    v_total_overdue,
    v_total_bills_due,
    v_customer_count
  FROM public.invoices i
  WHERE i.business_id = v_biz_id
    AND i.status = 'ACTIVE'
    AND i.deleted_at IS NULL
    AND (i.total - i.paid_amount) > 0;

  -- Customers list grouped with their unpaid invoices
  WITH grouped_dues AS (
    SELECT
      c.id AS customer_id,
      COALESCE(c.name, i.party_name) AS customer_name,
      COALESCE(c.mobile, i.party_mobile) AS customer_mobile,
      COALESCE(c.type, 'WALK_IN') AS customer_type,
      SUM(i.total - i.paid_amount) AS total_due,
      SUM(CASE WHEN i.due_date < v_today THEN (i.total - i.paid_amount) ELSE 0 END) AS overdue_balance,
      COUNT(i.id) AS bill_count,
      MIN(i.invoice_date) AS oldest_bill_date,
      MIN(i.due_date) AS oldest_due_date,
      MAX(GREATEST(0, v_today - i.due_date)) AS max_days_overdue,
      jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'number', i.number,
          'invoice_date', i.invoice_date,
          'due_date', i.due_date,
          'total', i.total,
          'paid_amount', i.paid_amount,
          'balance', (i.total - i.paid_amount),
          'is_overdue', (i.due_date < v_today),
          'days_overdue', GREATEST(0, v_today - i.due_date)
        )
        ORDER BY i.invoice_date ASC, i.created_at ASC
      ) AS invoices
    FROM public.invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    WHERE i.business_id = v_biz_id
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
      AND (i.total - i.paid_amount) > 0
      AND (
        p_search IS NULL
        OR p_search = ''
        OR COALESCE(c.name, i.party_name) ILIKE '%' || p_search || '%'
        OR COALESCE(c.mobile, i.party_mobile) ILIKE '%' || p_search || '%'
        OR i.number ILIKE '%' || p_search || '%'
      )
    GROUP BY
      c.id,
      COALESCE(c.name, i.party_name),
      COALESCE(c.mobile, i.party_mobile),
      COALESCE(c.type, 'WALK_IN')
    HAVING
      CASE
        WHEN UPPER(p_filter) = 'OVERDUE' THEN
          SUM(CASE WHEN i.due_date < v_today THEN (i.total - i.paid_amount) ELSE 0 END) > 0
        WHEN UPPER(p_filter) = 'DUE_TODAY' THEN
          MIN(i.due_date) = v_today
        WHEN UPPER(p_filter) = 'DUE_SOON' THEN
          MIN(i.due_date) <= (v_today + 5) AND MIN(i.due_date) >= v_today
        WHEN UPPER(p_filter) = 'REGULAR' THEN
          COALESCE(c.type, 'WALK_IN') = 'REGULAR'
        WHEN UPPER(p_filter) = 'WALK_IN' THEN
          COALESCE(c.type, 'WALK_IN') = 'WALK_IN'
        ELSE TRUE
      END
    ORDER BY
      overdue_balance DESC,
      total_due DESC,
      oldest_bill_date ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(grouped_dues.*)), '[]'::jsonb)
  INTO v_customers
  FROM grouped_dues;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'total_outstanding', v_total_outstanding,
      'total_overdue', v_total_overdue,
      'total_bills_due', v_total_bills_due,
      'customer_count', v_customer_count
    ),
    'customers', v_customers
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.dues_list(text, text, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dues_list(text, text, int, int) TO authenticated;


-- RPC: customer_ledger (§8.3)
CREATE OR REPLACE FUNCTION public.customer_ledger(
  customer_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_cust public.customers%ROWTYPE;
  v_total_billed numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_total_advance numeric(14,2) := 0;
  v_current_balance numeric(14,2) := 0;
  v_entries jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT * INTO v_cust
  FROM public.customers
  WHERE id = customer_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Billed total
  SELECT COALESCE(SUM(total), 0) INTO v_total_billed
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND invoices.customer_id = customer_ledger.customer_id
    AND status = 'ACTIVE'
    AND deleted_at IS NULL;

  -- Paid total (from receipts allocated or unallocated for this customer)
  SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(unallocated_amount), 0)
  INTO v_total_paid, v_total_advance
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND receipts.customer_id = customer_ledger.customer_id
    AND deleted_at IS NULL;

  v_current_balance := v_total_billed - v_total_paid;

  -- Unified chronological ledger entries
  WITH combined_events AS (
    -- Invoices (Debit)
    SELECT
      i.invoice_date AS entry_date,
      i.created_at AS sort_ts,
      'INVOICE' AS type,
      i.id AS ref_id,
      i.number AS ref_number,
      'Bill #' || i.number AS description,
      i.total AS debit,
      0::numeric(14,2) AS credit
    FROM public.invoices i
    WHERE i.business_id = v_biz_id
      AND i.customer_id = customer_ledger.customer_id
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
      AND (p_from_date IS NULL OR i.invoice_date >= p_from_date)
      AND (p_to_date IS NULL OR i.invoice_date <= p_to_date)

    UNION ALL

    -- Receipts (Credit)
    SELECT
      r.receipt_date AS entry_date,
      r.created_at AS sort_ts,
      'RECEIPT' AS type,
      r.id AS ref_id,
      r.number AS ref_number,
      'Payment #' || r.number || ' (' || r.mode || ')' AS description,
      0::numeric(14,2) AS debit,
      r.amount AS credit
    FROM public.receipts r
    WHERE r.business_id = v_biz_id
      AND r.customer_id = customer_ledger.customer_id
      AND r.deleted_at IS NULL
      AND (p_from_date IS NULL OR r.receipt_date >= p_from_date)
      AND (p_to_date IS NULL OR r.receipt_date <= p_to_date)
  ),
  ordered_ledger AS (
    SELECT
      entry_date,
      type,
      ref_id,
      ref_number,
      description,
      debit,
      credit,
      SUM(debit - credit) OVER (ORDER BY entry_date ASC, sort_ts ASC) AS running_balance
    FROM combined_events
    ORDER BY entry_date ASC, sort_ts ASC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(ordered_ledger.*)), '[]'::jsonb)
  INTO v_entries
  FROM ordered_ledger;

  RETURN jsonb_build_object(
    'customer', jsonb_build_object(
      'id', v_cust.id,
      'name', v_cust.name,
      'mobile', v_cust.mobile,
      'type', v_cust.type
    ),
    'summary', jsonb_build_object(
      'total_billed', v_total_billed,
      'total_paid', v_total_paid,
      'balance', v_current_balance,
      'advance', v_total_advance
    ),
    'entries', v_entries
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.customer_ledger(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.customer_ledger(uuid, date, date) TO authenticated;
