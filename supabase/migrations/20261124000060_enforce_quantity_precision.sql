-- Migration: 20261124000060_enforce_quantity_precision.sql
-- Enforce QTY Precision Rules:
-- 1. Quantity must be at least 0.01 (no zero or negative quantities)
-- 2. Quantity must have at most 2 decimal places (scale <= 2)
-- 3. Reject values with more than 2 decimal places (e.g. 1.345, 1.34535) with explicit error; never silently round

-- 1. Table constraint on invoice_items
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_quantity_check;
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS chk_invoice_items_quantity_min;
ALTER TABLE public.invoice_items ADD CONSTRAINT chk_invoice_items_quantity_min CHECK (quantity >= 0.01);

-- 2. Upgrade create_invoice with explicit quantity validation
CREATE OR REPLACE FUNCTION public.create_invoice(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_biz public.businesses%ROWTYPE;

  v_invoice_date date;
  v_due_date date;
  v_fy text;

  v_customer_id uuid := NULL;
  v_party_name text := 'Walk-in';
  v_party_mobile text := NULL;
  v_walk_in jsonb;
  v_force_new_customer boolean;

  v_items jsonb;
  v_item jsonb;
  v_item_id uuid;
  v_item_service_id uuid;
  v_service_row public.services%ROWTYPE;
  v_is_job boolean;
  v_job_id uuid;
  v_comm_percent numeric(5,2);
  v_comm_amount numeric(14,2);
  v_deadline_date date;

  v_subtotal numeric(14,2) := 0;
  v_line_amount numeric(14,2);
  v_qty numeric; -- Unconstrained numeric to detect exact scale of user input without silent rounding
  v_rate numeric(14,2);

  v_discount_type text;
  v_discount_value numeric(14,2);
  v_discount_amount numeric(14,2) := 0;
  v_total numeric(14,2);

  v_paid jsonb;
  v_paid_now numeric(14,2) := 0;
  v_pay_mode text;
  v_pay_ref text;
  v_receipt_number text;
  v_receipt_id uuid;

  v_invoice_number text;
  v_invoice_id uuid;

  v_assigned_staff_id uuid;
  v_step_row record;
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

  -- Idempotency Check: prevent duplicate bill creation on double-click / network retry
  v_idem_key := NULLIF(TRIM(COALESCE(payload->>'idempotency_key', '')), '');
  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, updated_at)
    VALUES (v_biz_id, v_idem_key, 'CREATE_INVOICE', 'PROCESSING', now())
    ON CONFLICT (business_id, key) DO NOTHING;

    SELECT status, response INTO v_idem_status, v_cached_resp
    FROM public.idempotency_keys
    WHERE business_id = v_biz_id AND key = v_idem_key
    FOR UPDATE;

    IF v_idem_status = 'COMPLETED' AND v_cached_resp IS NOT NULL THEN
      RETURN v_cached_resp;
    END IF;
  END IF;

  SELECT * INTO v_biz
  FROM public.businesses
  WHERE id = v_biz_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_invoice_date := COALESCE((payload->>'invoice_date')::date, (SELECT app.today()));
  v_fy := public.fy_label(v_invoice_date);

  IF payload ? 'due_date' AND payload->>'due_date' IS NOT NULL AND payload->>'due_date' <> '' THEN
    v_due_date := (payload->>'due_date')::date;
  ELSE
    v_due_date := v_invoice_date + COALESCE(v_biz.default_terms_days, 0);
  END IF;

  v_items := payload->'items';
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'INVOICE_REQUIRES_ITEMS' USING ERRCODE = 'P0001';
  END IF;

  FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->i;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 1);

    -- Enforce precision and minimum rules strictly: no silent rounding
    IF v_qty < 0.01 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY_MIN' USING ERRCODE = 'P0001', DETAIL = 'Quantity must be at least 0.01';
    END IF;
    IF scale(v_qty) > 2 OR ROUND(v_qty, 2) <> v_qty THEN
      RAISE EXCEPTION 'INVALID_QUANTITY_PRECISION' USING ERRCODE = 'P0001', DETAIL = 'Quantity cannot have more than 2 decimal places';
    END IF;

    v_rate := COALESCE((v_item->>'rate')::numeric, 0);
    v_line_amount := ROUND(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_line_amount;
  END LOOP;

  v_discount_type := UPPER(COALESCE(payload->>'discount_type', 'NONE'));
  v_discount_value := COALESCE((payload->>'discount_value')::numeric, 0);

  IF v_discount_type = 'FLAT' THEN
    v_discount_amount := ROUND(LEAST(v_discount_value, v_subtotal), 2);
  ELSIF v_discount_type = 'PERCENT' THEN
    v_discount_amount := ROUND((v_subtotal * LEAST(v_discount_value, 100)) / 100, 2);
  ELSE
    v_discount_type := 'NONE';
    v_discount_value := 0;
    v_discount_amount := 0;
  END IF;

  v_total := ROUND(v_subtotal - v_discount_amount, 2);

  v_paid := payload->'paid';
  IF v_paid IS NOT NULL AND (v_paid->>'amount') IS NOT NULL THEN
    v_paid_now := ROUND(COALESCE((v_paid->>'amount')::numeric, 0), 2);
    v_pay_mode := UPPER(COALESCE(v_paid->>'mode', 'CASH'));
    v_pay_ref := v_paid->>'reference';
  END IF;

  IF v_paid_now > v_total THEN
    RAISE EXCEPTION 'PAID_EXCEEDS_TOTAL' USING ERRCODE = 'P0001';
  END IF;

  IF payload ? 'customer_id' AND payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
    v_customer_id := (payload->>'customer_id')::uuid;

    -- Lock customer record for consistency
    SELECT name, mobile INTO v_party_name, v_party_mobile
    FROM public.customers
    WHERE id = v_customer_id AND business_id = v_biz_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_walk_in := payload->'walk_in';
    v_party_name := TRIM(COALESCE(v_walk_in->>'name', ''));
    v_party_mobile := REGEXP_REPLACE(COALESCE(v_walk_in->>'mobile', ''), '[^0-9]', '', 'g');
    IF LENGTH(v_party_mobile) = 12 AND v_party_mobile LIKE '91%' THEN
      v_party_mobile := SUBSTRING(v_party_mobile FROM 3);
    ELSIF LENGTH(v_party_mobile) = 11 AND v_party_mobile LIKE '0%' THEN
      v_party_mobile := SUBSTRING(v_party_mobile FROM 2);
    END IF;

    IF v_total > v_paid_now THEN
      IF v_party_name = '' OR v_party_mobile = '' OR LENGTH(v_party_mobile) < 10 THEN
        RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_DUE' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF v_party_name = '' AND (v_party_mobile IS NULL OR v_party_mobile = '') THEN
      v_party_name := 'Walk-in';
      v_party_mobile := NULL;
      v_customer_id := NULL;
    ELSE
      IF v_party_name = '' THEN
        v_party_name := 'Walk-in';
      END IF;

      v_force_new_customer := COALESCE((payload->>'force_new_customer')::boolean, false);
      IF NOT v_force_new_customer AND v_party_mobile IS NOT NULL AND v_party_mobile <> '' THEN
        SELECT id INTO v_customer_id
        FROM public.customers
        WHERE business_id = v_biz_id AND mobile = v_party_mobile AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (
          business_id, name, mobile, whatsapp, type, possible_duplicate, created_by, updated_by
        ) VALUES (
          v_biz_id, v_party_name, v_party_mobile, v_party_mobile, 'WALK_IN', false, v_member_id, v_member_id
        ) RETURNING id INTO v_customer_id;
      END IF;
    END IF;
  END IF;

  -- Atomic Race-Free Invoice Numbering
  v_invoice_number := public.next_invoice_number(
    v_biz_id, v_fy, v_biz.invoice_prefix, v_biz.numbering_mode, v_biz.invoice_start_number
  );

  INSERT INTO public.invoices (
    business_id, number, fy_label, invoice_date, due_date, customer_id, party_name, party_mobile,
    subtotal, discount_type, discount_value, discount_amount, total, paid_amount, status, notes,
    created_by, updated_by
  ) VALUES (
    v_biz_id, v_invoice_number, v_fy, v_invoice_date, v_due_date, v_customer_id, v_party_name, v_party_mobile,
    v_subtotal, v_discount_type, v_discount_value, v_discount_amount, v_total, v_paid_now, 'ACTIVE', payload->>'notes',
    v_member_id, v_member_id
  ) RETURNING id INTO v_invoice_id;

  -- Insert items and jobs
  FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->i;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
    v_rate := COALESCE((v_item->>'rate')::numeric, 0);
    v_line_amount := ROUND(v_qty * v_rate, 2);

    v_item_service_id := NULL;
    IF (v_item->>'service_id') IS NOT NULL AND (v_item->>'service_id') <> '' THEN
      SELECT s.id INTO v_item_service_id
      FROM public.services s
      WHERE s.id = (v_item->>'service_id')::uuid AND s.business_id = v_biz_id AND s.deleted_at IS NULL;
    END IF;

    INSERT INTO public.invoice_items (
      business_id, invoice_id, service_id, description, quantity, rate, amount,
      is_job, applicant_name, created_by, updated_by
    ) VALUES (
      v_biz_id, v_invoice_id, v_item_service_id, COALESCE(v_item->>'description', 'Item'),
      v_qty, v_rate, v_line_amount, COALESCE((v_item->>'is_job')::boolean, false),
      v_item->>'applicant_name', v_member_id, v_member_id
    ) RETURNING id INTO v_item_id;

    v_is_job := COALESCE((v_item->>'is_job')::boolean, false);
    IF v_biz.job_management_enabled AND (v_is_job OR v_item_service_id IS NOT NULL) THEN
      IF v_item_service_id IS NOT NULL THEN
        SELECT * INTO v_service_row
        FROM public.services
        WHERE id = v_item_service_id AND business_id = v_biz_id;
      ELSE
        v_service_row.is_job_type := false;
      END IF;

      IF v_is_job OR (v_service_row.id IS NOT NULL AND v_service_row.is_job_type) THEN
        v_deadline_date := v_invoice_date + COALESCE(v_service_row.deadline_days, 7);
        v_comm_percent := COALESCE(v_service_row.commission_percent, 0);
        v_comm_amount := ROUND((v_line_amount * v_comm_percent) / 100, 2);

        IF v_role = 'STAFF' THEN
          v_assigned_staff_id := v_member_id;
        ELSE
          v_assigned_staff_id := NULL;
        END IF;

        INSERT INTO public.jobs (
          business_id, invoice_id, invoice_item_id, service_id, job_type_name,
          party_name, party_mobile, applicant_name, amount, deadline_date,
          assigned_staff_id, commission_percent, status, created_by, updated_by
        ) VALUES (
          v_biz_id, v_invoice_id, v_item_id, v_service_row.id,
          COALESCE(v_service_row.name, v_item->>'description', 'Job'),
          v_party_name, v_party_mobile, v_item->>'applicant_name', v_line_amount,
          v_deadline_date, v_assigned_staff_id, v_comm_percent, 'IN_PROGRESS',
          v_member_id, v_member_id
        ) RETURNING id INTO v_job_id;

        IF v_service_row.id IS NOT NULL THEN
          FOR v_step_row IN
            SELECT position, name, whatsapp_message
            FROM public.job_type_steps
            WHERE service_id = v_service_row.id AND deleted_at IS NULL
            ORDER BY position ASC
          LOOP
            INSERT INTO public.job_steps (
              business_id, job_id, position, name, whatsapp_message, ticked, created_by, updated_by
            ) VALUES (
              v_biz_id, v_job_id, v_step_row.position, v_step_row.name,
              v_step_row.whatsapp_message, false, v_member_id, v_member_id
            );
          END LOOP;
        END IF;

        IF v_assigned_staff_id IS NOT NULL AND v_comm_percent > 0 THEN
          INSERT INTO public.commission_entries (
            business_id, job_id, staff_id, base_amount, percent, amount, status, created_by, updated_by
          ) VALUES (
            v_biz_id, v_job_id, v_assigned_staff_id, v_line_amount, v_comm_percent,
            v_comm_amount, 'UPCOMING', v_member_id, v_member_id
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Same transaction payment receipt
  IF v_paid_now > 0 THEN
    v_receipt_number := public.next_receipt_number(v_biz_id, v_fy);

    INSERT INTO public.receipts (
      business_id, number, fy_label, receipt_date, customer_id, amount,
      mode, reference, kind, unallocated_amount, notes,
      bank_account_id, bank_name,
      created_by, updated_by
    ) VALUES (
      v_biz_id, v_receipt_number, v_fy, v_invoice_date, v_customer_id, v_paid_now,
      v_pay_mode, v_pay_ref, 'INVOICE_PAYMENT', 0,
      'Payment at bill creation #' || v_invoice_number,
      CASE WHEN v_paid->>'bank_account_id' IS NOT NULL AND v_paid->>'bank_account_id' <> '' THEN (v_paid->>'bank_account_id')::uuid ELSE NULL END,
      v_paid->>'bank_name',
      v_member_id, v_member_id
    ) RETURNING id INTO v_receipt_id;

    INSERT INTO public.receipt_allocations (
      business_id, receipt_id, invoice_id, amount, created_by, updated_by
    ) VALUES (
      v_biz_id, v_receipt_id, v_invoice_id, v_paid_now, v_member_id, v_member_id
    );
  END IF;

  v_result := jsonb_build_object(
    'id', v_invoice_id,
    'invoice_id', v_invoice_id,
    'number', v_invoice_number,
    'subtotal', v_subtotal,
    'total', v_total,
    'paid_amount', v_paid_now,
    'customer_id', v_customer_id,
    'party_name', v_party_name,
    'party_mobile', v_party_mobile,
    'status', 'ACTIVE'
  );

  -- Record idempotency entry
  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
    VALUES (v_biz_id, v_idem_key, 'CREATE_INVOICE', 'COMPLETED', v_result, now())
    ON CONFLICT (business_id, key)
    DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;

-- 3. Upgrade update_invoice with explicit quantity validation
CREATE OR REPLACE FUNCTION public.update_invoice(
  p_invoice_id uuid,
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
  v_inv public.invoices%ROWTYPE;

  v_customer_id uuid;
  v_party_name text;
  v_party_mobile text;

  v_invoice_date date;
  v_due_date date;
  v_notes text;

  v_items jsonb;
  v_item jsonb;
  v_item_id uuid;
  v_item_service_id uuid;
  v_service_row public.services%ROWTYPE;
  v_job_type_name text;
  v_step_row record;
  v_job_id uuid;
  v_job_staff_id uuid;
  v_comm_percent numeric(5,2);
  v_comm_amount numeric(14,2);
  v_deadline_date date;

  v_subtotal numeric(14,2) := 0;
  v_line_amount numeric(14,2);
  v_qty numeric; -- Unconstrained numeric to detect exact scale of user input without silent rounding
  v_rate numeric(14,2);

  v_discount_type text;
  v_discount_value numeric(14,2);
  v_discount_amount numeric(14,2) := 0;
  v_total numeric(14,2);

  v_paid jsonb;
  v_new_paid numeric(14,2);
  v_new_mode text;
  v_new_bank_id uuid := NULL;
  v_new_bank_name text := NULL;
  v_existing_rcpt record;
  v_final_paid numeric(14,2);
  v_receipt_number text;
  v_receipt_id uuid;
  v_last_updated_at timestamptz;
  i int;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Row lock with FOR UPDATE to prevent race conditions during edit
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF UPPER(v_inv.status) = 'CANCELLED' THEN
    RAISE EXCEPTION 'CANNOT_EDIT_CANCELLED_INVOICE' USING ERRCODE = 'P0001';
  END IF;

  -- Optimistic Concurrency Control (OCC) Check
  IF payload ? 'last_updated_at' AND payload->>'last_updated_at' IS NOT NULL AND payload->>'last_updated_at' <> '' THEN
    v_last_updated_at := (payload->>'last_updated_at')::timestamptz;
    IF date_trunc('milliseconds', v_inv.updated_at) > date_trunc('milliseconds', v_last_updated_at) THEN
      RAISE EXCEPTION 'CONFLICT_DETECTED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'message', 'Invoice was modified on another device since you loaded it.',
          'db_updated_at', v_inv.updated_at,
          'your_updated_at', v_last_updated_at
        )::text;
    END IF;
  END IF;

  v_invoice_date := COALESCE((payload->>'invoice_date')::date, v_inv.invoice_date);
  v_due_date := COALESCE((payload->>'due_date')::date, v_inv.due_date);
  v_notes := COALESCE(payload->>'notes', v_inv.notes);

  IF payload ? 'customer_id' AND payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
    v_customer_id := (payload->>'customer_id')::uuid;
    SELECT name, mobile INTO v_party_name, v_party_mobile
    FROM public.customers
    WHERE id = v_customer_id AND business_id = v_biz_id AND deleted_at IS NULL
    FOR UPDATE;
  ELSE
    v_customer_id := v_inv.customer_id;
    v_party_name := COALESCE(payload->>'party_name', v_inv.party_name);
    v_party_mobile := COALESCE(payload->>'party_mobile', v_inv.party_mobile);
  END IF;

  v_items := payload->'items';
  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    -- Recalculate totals
    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      v_item := v_items->i;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 1);

      -- Enforce precision and minimum rules strictly: no silent rounding
      IF v_qty < 0.01 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY_MIN' USING ERRCODE = 'P0001', DETAIL = 'Quantity must be at least 0.01';
      END IF;
      IF scale(v_qty) > 2 OR ROUND(v_qty, 2) <> v_qty THEN
        RAISE EXCEPTION 'INVALID_QUANTITY_PRECISION' USING ERRCODE = 'P0001', DETAIL = 'Quantity cannot have more than 2 decimal places';
      END IF;

      v_rate := COALESCE((v_item->>'rate')::numeric, 0);
      v_line_amount := ROUND(v_qty * v_rate, 2);
      v_subtotal := v_subtotal + v_line_amount;
    END LOOP;
  ELSE
    v_subtotal := v_inv.subtotal;
  END IF;

  v_discount_type := UPPER(COALESCE(payload->>'discount_type', v_inv.discount_type));
  v_discount_value := COALESCE((payload->>'discount_value')::numeric, v_inv.discount_value);

  IF v_discount_type = 'FLAT' THEN
    v_discount_amount := ROUND(LEAST(v_discount_value, v_subtotal), 2);
  ELSIF v_discount_type = 'PERCENT' THEN
    v_discount_amount := ROUND((v_subtotal * LEAST(v_discount_value, 100)) / 100, 2);
  ELSE
    v_discount_type := 'NONE';
    v_discount_value := 0;
    v_discount_amount := 0;
  END IF;

  v_total := ROUND(v_subtotal - v_discount_amount, 2);
  v_final_paid := v_inv.paid_amount;

  -- Handle payment edits if provided
  v_paid := payload->'paid';
  IF v_paid IS NOT NULL AND (v_paid->>'amount') IS NOT NULL THEN
    v_new_paid := ROUND(COALESCE((v_paid->>'amount')::numeric, 0), 2);
    v_new_mode := UPPER(COALESCE(v_paid->>'mode', 'CASH'));

    IF v_paid->>'bank_account_id' IS NOT NULL AND v_paid->>'bank_account_id' <> '' THEN
      v_new_bank_id := (v_paid->>'bank_account_id')::uuid;
      v_new_bank_name := v_paid->>'bank_name';
    END IF;

    IF v_new_paid > v_total THEN
      RAISE EXCEPTION 'PAID_EXCEEDS_TOTAL' USING ERRCODE = 'P0001';
    END IF;

    -- Find existing creation receipt
    SELECT r.id, r.amount, ra.id AS allocation_id INTO v_existing_rcpt
    FROM public.receipt_allocations ra
    JOIN public.receipts r ON r.id = ra.receipt_id
    WHERE ra.invoice_id = p_invoice_id AND ra.deleted_at IS NULL AND r.deleted_at IS NULL
    ORDER BY ra.created_at ASC
    LIMIT 1;

    IF FOUND THEN
      IF v_new_paid = 0 THEN
        UPDATE public.receipt_allocations SET deleted_at = now(), deleted_by = v_member_id WHERE id = v_existing_rcpt.allocation_id;
        UPDATE public.receipts SET deleted_at = now(), deleted_by = v_member_id WHERE id = v_existing_rcpt.id;
        v_final_paid := 0;
      ELSE
        UPDATE public.receipts
        SET amount = v_new_paid, mode = v_new_mode, bank_account_id = v_new_bank_id, bank_name = v_new_bank_name,
            updated_at = now(), updated_by = v_member_id
        WHERE id = v_existing_rcpt.id;

        UPDATE public.receipt_allocations
        SET amount = v_new_paid, updated_at = now(), updated_by = v_member_id
        WHERE id = v_existing_rcpt.allocation_id;
        v_final_paid := v_new_paid;
      END IF;
    ELSIF v_new_paid > 0 THEN
      v_receipt_number := public.next_receipt_number(v_biz_id, v_inv.fy_label);
      INSERT INTO public.receipts (
        business_id, number, fy_label, receipt_date, customer_id, amount,
        mode, reference, kind, unallocated_amount, notes, bank_account_id, bank_name,
        created_by, updated_by
      ) VALUES (
        v_biz_id, v_receipt_number, v_inv.fy_label, v_invoice_date, v_customer_id, v_new_paid,
        v_new_mode, v_paid->>'reference', 'INVOICE_PAYMENT', 0, 'Payment for Bill #' || v_inv.number,
        v_new_bank_id, v_new_bank_name, v_member_id, v_member_id
      ) RETURNING id INTO v_receipt_id;

      INSERT INTO public.receipt_allocations (
        business_id, receipt_id, invoice_id, amount, created_by, updated_by
      ) VALUES (
        v_biz_id, v_receipt_id, p_invoice_id, v_new_paid, v_member_id, v_member_id
      );
      v_final_paid := v_new_paid;
    END IF;
  END IF;

  -- Update invoice record
  UPDATE public.invoices
  SET invoice_date = v_invoice_date, due_date = v_due_date, customer_id = v_customer_id,
      party_name = v_party_name, party_mobile = v_party_mobile, subtotal = v_subtotal,
      discount_type = v_discount_type, discount_value = v_discount_value, discount_amount = v_discount_amount,
      total = v_total, paid_amount = v_final_paid, notes = v_notes,
      updated_at = now(), updated_by = v_member_id
  WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  -- Re-sync items: remove unticked non-progress jobs and recreate items
  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      v_item := v_items->i;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
      v_rate := COALESCE((v_item->>'rate')::numeric, 0);
      v_line_amount := ROUND(v_qty * v_rate, 2);

      v_item_service_id := NULL;
      IF (v_item->>'service_id') IS NOT NULL AND (v_item->>'service_id') <> '' THEN
        SELECT s.id INTO v_item_service_id
        FROM public.services s
        WHERE s.id = (v_item->>'service_id')::uuid AND s.business_id = v_biz_id;
      END IF;

      INSERT INTO public.invoice_items (
        business_id, invoice_id, service_id, description, quantity, rate, amount,
        is_job, applicant_name, created_by, updated_by
      ) VALUES (
        v_biz_id, p_invoice_id, v_item_service_id, COALESCE(v_item->>'description', 'Item'),
        v_qty, v_rate, v_line_amount, COALESCE((v_item->>'is_job')::boolean, false),
        v_item->>'applicant_name', v_member_id, v_member_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', v_inv.id,
    'invoice_id', v_inv.id,
    'number', v_inv.number,
    'subtotal', v_inv.subtotal,
    'total', v_inv.total,
    'paid_amount', v_inv.paid_amount,
    'customer_id', v_inv.customer_id,
    'party_name', v_inv.party_name,
    'party_mobile', v_inv.party_mobile,
    'updated_at', v_inv.updated_at,
    'status', v_inv.status
  );
END;
$$;
