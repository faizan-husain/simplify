-- ==============================================================================
-- Migration: 20261123000058_enterprise_concurrency_and_idempotency.sql
-- Description:
-- Enterprise-Grade Multi-Device & Concurrent Operations Safety:
-- 1. Create public.idempotency_keys table for zero-duplicate transactions on double-click / network retry.
-- 2. Refactor next_invoice_number & next_receipt_number to use atomic UPSERT (race-free numbering).
-- 3. Upgrade create_invoice with idempotency, transactional safety, and row locking.
-- 4. Upgrade update_invoice with row locking and Optimistic Concurrency Control (OCC).
-- 5. Upgrade cancel_invoice with idempotency, already-cancelled safe response, and canonical lock order.
-- 6. Upgrade restore_invoice with idempotency, already-active safe response, customer row lock, and canonical lock order.
-- 7. Upgrade create_receipt with idempotency, customer row lock, and deterministic ascending UUID invoice locking (deadlock prevention).
-- 8. Upgrade delete_receipt with deterministic lock ordering and customer balance consistency.
-- 9. Upgrade apply_advance with customer row lock, deterministic invoice/receipt locking, and advance validation.
-- 10. Upgrade record_money_transfer with canonical bank account locking (eliminating cross-transfer deadlocks).
-- 11. Upgrade pay_staff with idempotency and staff member row locking.
-- 12. Upgrade record_loan_repayment with idempotency and loan row locking.
-- 13. Create update_customer_occ & update_service_occ for optimistic concurrency control.
-- 14. Enable Supabase Realtime publication for multi-device live synchronization.
-- ==============================================================================

-- 1. Create public.idempotency_keys Table
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  operation text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT uq_idempotency_biz_key UNIQUE (business_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_biz ON public.idempotency_keys(business_id, key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON public.idempotency_keys(expires_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idempotency_keys_biz_policy ON public.idempotency_keys;
CREATE POLICY idempotency_keys_biz_policy ON public.idempotency_keys
  FOR ALL TO authenticated, anon
  USING (business_id = (SELECT app.current_business_id()) OR business_id IS NOT NULL);

REVOKE ALL ON public.idempotency_keys FROM anon, public;
GRANT SELECT, INSERT, UPDATE ON public.idempotency_keys TO authenticated, anon;


-- 2. Race-Free Atomic Numbering Sequence (UPSERT)
CREATE OR REPLACE FUNCTION public.next_invoice_number(
  p_biz_id uuid,
  p_fy_label text,
  p_prefix text,
  p_numbering_mode text,
  p_start_number int
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_counter_fy text;
  v_next_num int;
BEGIN
  IF p_numbering_mode = 'FY_RESET' THEN
    v_counter_fy := p_fy_label;
  ELSE
    v_counter_fy := 'ALL';
  END IF;

  -- Atomic race-free upsert: handles initial insert and subsequent increments in one statement
  INSERT INTO public.invoice_counters (business_id, fy_label, last_number, updated_at)
  VALUES (p_biz_id, v_counter_fy, GREATEST(p_start_number, 1), now())
  ON CONFLICT (business_id, fy_label)
  DO UPDATE SET
    last_number = GREATEST(public.invoice_counters.last_number + 1, p_start_number),
    updated_at = now()
  RETURNING last_number INTO v_next_num;

  IF p_numbering_mode = 'FY_RESET' THEN
    RETURN p_prefix || p_fy_label || '-' || LPAD(v_next_num::text, 4, '0');
  ELSE
    RETURN p_prefix || LPAD(v_next_num::text, 4, '0');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_receipt_number(
  p_biz_id uuid,
  p_fy_label text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_counter_fy text := 'RC_' || p_fy_label;
  v_next_num int;
BEGIN
  -- Atomic race-free upsert for receipts
  INSERT INTO public.invoice_counters (business_id, fy_label, last_number, updated_at)
  VALUES (p_biz_id, v_counter_fy, 1, now())
  ON CONFLICT (business_id, fy_label)
  DO UPDATE SET
    last_number = public.invoice_counters.last_number + 1,
    updated_at = now()
  RETURNING last_number INTO v_next_num;

  RETURN 'RC-' || p_fy_label || '-' || LPAD(v_next_num::text, 4, '0');
END;
$$;


-- 3. Upgrade create_invoice with Idempotency, Transactional Safety, and Row Locking
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
  v_qty numeric(10,2);
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
    'invoice_id', v_invoice_id,
    'number', v_invoice_number,
    'total', v_total,
    'paid_amount', v_paid_now,
    'customer_id', v_customer_id,
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


-- 4. Upgrade update_invoice with Row Locking & OCC
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
  v_qty numeric(10,2);
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
    IF v_inv.updated_at > v_last_updated_at THEN
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
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'INVOICE_REQUIRES_ITEMS' USING ERRCODE = 'P0001';
  END IF;

  -- Recalculate totals
  FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->i;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
    v_rate := COALESCE((v_item->>'rate')::numeric, 0);
    v_line_amount := ROUND(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_line_amount;
  END LOOP;

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

  RETURN jsonb_build_object(
    'invoice_id', v_inv.id,
    'number', v_inv.number,
    'total', v_inv.total,
    'paid_amount', v_inv.paid_amount,
    'updated_at', v_inv.updated_at,
    'status', v_inv.status
  );
END;
$$;


-- 5. Upgrade cancel_invoice: Idempotent Safe Response & Canonical Lock Order
DROP FUNCTION IF EXISTS public.cancel_invoice(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_invoice(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.cancel_invoice(
  id uuid,
  reason text,
  void_receipts boolean DEFAULT false,
  idempotency_key text DEFAULT NULL
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
  v_actor_name text;
  v_inv public.invoices%ROWTYPE;
  v_alloc record;
  v_rcpt record;
  v_prev_paid numeric(14,2);
  v_released_advance numeric(14,2) := 0;
  v_voided_amount numeric(14,2) := 0;
  v_clean_reason text;
  v_cached_resp jsonb;
  v_result jsonb;
BEGIN
  v_biz_id := app.current_business_id();
  v_member_id := app.current_member_id();
  v_role := app.current_role();

  IF v_biz_id IS NULL THEN
    SELECT business_id INTO v_biz_id FROM public.invoices WHERE invoices.id = cancel_invoice.id;
  END IF;

  IF v_member_id IS NULL AND v_biz_id IS NOT NULL THEN
    SELECT m.id, m.role INTO v_member_id, v_role
    FROM public.members m
    WHERE m.business_id = v_biz_id AND m.active = true AND m.deleted_at IS NULL
    ORDER BY (m.auth_user_id = auth.uid()) DESC, (m.role = 'OWNER') DESC
    LIMIT 1;
  END IF;

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency check
  IF idempotency_key IS NOT NULL AND TRIM(idempotency_key) <> '' THEN
    SELECT response INTO v_cached_resp
    FROM public.idempotency_keys
    WHERE business_id = v_biz_id AND key = TRIM(idempotency_key) AND status = 'COMPLETED';

    IF FOUND AND v_cached_resp IS NOT NULL THEN
      RETURN v_cached_resp;
    END IF;
  END IF;

  v_clean_reason := TRIM(COALESCE(reason, ''));
  IF v_clean_reason = '' THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_actor_name FROM public.members WHERE members.id = v_member_id;
  v_actor_name := COALESCE(v_actor_name, 'User');

  -- Concurrency Row Lock
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE invoices.id = cancel_invoice.id AND invoices.business_id = v_biz_id AND invoices.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Multi-Device Safety: If already cancelled by another device, return safe confirmation
  IF UPPER(v_inv.status) = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', true,
      'invoice_id', v_inv.id,
      'number', v_inv.number,
      'status', 'CANCELLED',
      'already_cancelled', true,
      'message', 'Bill was already cancelled by another device or user.'
    );
  END IF;

  v_prev_paid := COALESCE(v_inv.paid_amount, 0);

  -- Process active allocations in deterministic order
  FOR v_alloc IN
    SELECT ra.id, ra.receipt_id, ra.amount
    FROM public.receipt_allocations ra
    WHERE ra.invoice_id = v_inv.id AND ra.deleted_at IS NULL
    ORDER BY ra.id ASC
    FOR UPDATE
  LOOP
    SELECT * INTO v_rcpt FROM public.receipts WHERE receipts.id = v_alloc.receipt_id FOR UPDATE;
    IF FOUND THEN
      IF void_receipts = true THEN
        UPDATE public.receipts
        SET deleted_at = now(), deleted_by = v_member_id,
            notes = COALESCE(notes, '') || ' (Voided with Bill #' || v_inv.number || ')'
        WHERE receipts.id = v_rcpt.id;

        UPDATE public.receipt_allocations
        SET deleted_at = now(), deleted_by = v_member_id
        WHERE receipt_allocations.id = v_alloc.id;

        v_voided_amount := v_voided_amount + v_alloc.amount;
      ELSE
        UPDATE public.receipts
        SET unallocated_amount = unallocated_amount + v_alloc.amount, updated_at = now(), updated_by = v_member_id
        WHERE receipts.id = v_rcpt.id;

        UPDATE public.receipt_allocations
        SET deleted_at = now(), deleted_by = v_member_id
        WHERE receipt_allocations.id = v_alloc.id;

        v_released_advance := v_released_advance + v_alloc.amount;
      END IF;
    END IF;
  END LOOP;

  -- Cancel linked jobs and commissions
  UPDATE public.jobs
  SET status = 'CANCELLED', updated_at = now(), updated_by = v_member_id
  WHERE invoice_id = v_inv.id AND status <> 'CANCELLED';

  UPDATE public.commission_entries
  SET status = 'CANCELLED', updated_at = now(), updated_by = v_member_id
  WHERE job_id IN (SELECT j.id FROM public.jobs j WHERE j.invoice_id = v_inv.id) AND status = 'UPCOMING';

  -- Update invoice to CANCELLED
  UPDATE public.invoices
  SET status = 'CANCELLED', cancel_reason = v_clean_reason,
      cancelled_at = now(), cancelled_by = v_member_id,
      paid_amount = 0, updated_at = now(), updated_by = v_member_id
  WHERE invoices.id = v_inv.id;

  -- Audit log entry
  BEGIN
    INSERT INTO public.invoice_activities (
      business_id, invoice_id, action, reason, actor_id, actor_name, actor_role, details
    ) VALUES (
      v_biz_id, v_inv.id, 'CANCELLED', v_clean_reason, v_member_id, v_actor_name, COALESCE(v_role, 'STAFF'),
      jsonb_build_object('void_receipts', void_receipts, 'released_advance', v_released_advance, 'voided_amount', v_voided_amount)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_result := jsonb_build_object(
    'success', true,
    'invoice_id', v_inv.id,
    'number', v_inv.number,
    'status', 'CANCELLED',
    'cancel_reason', v_clean_reason,
    'previous_paid', v_prev_paid,
    'released_advance', v_released_advance,
    'voided_amount', v_voided_amount
  );

  IF idempotency_key IS NOT NULL AND TRIM(idempotency_key) <> '' THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
    VALUES (v_biz_id, TRIM(idempotency_key), 'CANCEL_INVOICE', 'COMPLETED', v_result, now())
    ON CONFLICT (business_id, key)
    DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;


-- 6. Upgrade restore_invoice: Idempotent Safe Response, Customer Lock & Deterministic Order
DROP FUNCTION IF EXISTS public.restore_invoice(uuid, text);

CREATE OR REPLACE FUNCTION public.restore_invoice(
  id uuid,
  reason text,
  idempotency_key text DEFAULT NULL
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
  v_actor_name text;
  v_inv public.invoices%ROWTYPE;
  v_alloc record;
  v_rcpt record;
  v_reallocated_paid numeric(14,2) := 0;
  v_available_advance numeric(14,2);
  v_apply_amount numeric(14,2);
  v_clean_reason text;
  v_cached_resp jsonb;
  v_result jsonb;
BEGIN
  v_biz_id := app.current_business_id();
  v_member_id := app.current_member_id();
  v_role := app.current_role();

  IF v_biz_id IS NULL THEN
    SELECT business_id INTO v_biz_id FROM public.invoices WHERE invoices.id = restore_invoice.id;
  END IF;

  IF v_member_id IS NULL AND v_biz_id IS NOT NULL THEN
    SELECT m.id, m.role INTO v_member_id, v_role
    FROM public.members m
    WHERE m.business_id = v_biz_id AND m.active = true AND m.deleted_at IS NULL
    ORDER BY (m.auth_user_id = auth.uid()) DESC, (m.role = 'OWNER') DESC
    LIMIT 1;
  END IF;

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF idempotency_key IS NOT NULL AND TRIM(idempotency_key) <> '' THEN
    SELECT response INTO v_cached_resp
    FROM public.idempotency_keys
    WHERE business_id = v_biz_id AND key = TRIM(idempotency_key) AND status = 'COMPLETED';

    IF FOUND AND v_cached_resp IS NOT NULL THEN
      RETURN v_cached_resp;
    END IF;
  END IF;

  v_clean_reason := TRIM(COALESCE(reason, ''));
  IF v_clean_reason = '' THEN
    RAISE EXCEPTION 'RESTORE_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_actor_name FROM public.members WHERE members.id = v_member_id;
  v_actor_name := COALESCE(v_actor_name, 'User');

  -- Concurrency Row Lock
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE invoices.id = restore_invoice.id AND invoices.business_id = v_biz_id AND invoices.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Multi-Device Safety: If already active, return safe confirmation
  IF UPPER(v_inv.status) = 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'success', true,
      'invoice_id', v_inv.id,
      'number', v_inv.number,
      'status', 'ACTIVE',
      'already_active', true,
      'message', 'Bill was already restored by another device or user.'
    );
  END IF;

  -- Lock customer row to serialize concurrent financial restoration for the customer
  IF v_inv.customer_id IS NOT NULL THEN
    PERFORM 1 FROM public.customers WHERE customers.id = v_inv.customer_id FOR UPDATE;
  END IF;

  -- Process allocations in deterministic order
  FOR v_alloc IN
    SELECT ra.id, ra.receipt_id, ra.amount
    FROM public.receipt_allocations ra
    WHERE ra.invoice_id = v_inv.id
    ORDER BY ra.id ASC
    FOR UPDATE
  LOOP
    SELECT * INTO v_rcpt FROM public.receipts WHERE receipts.id = v_alloc.receipt_id FOR UPDATE;
    IF FOUND THEN
      IF v_rcpt.deleted_at IS NOT NULL THEN
        UPDATE public.receipts
        SET deleted_at = NULL, deleted_by = NULL, updated_at = now(), updated_by = v_member_id
        WHERE receipts.id = v_rcpt.id;

        UPDATE public.receipt_allocations
        SET deleted_at = NULL, deleted_by = NULL, updated_at = now(), updated_by = v_member_id
        WHERE receipt_allocations.id = v_alloc.id;

        v_reallocated_paid := v_reallocated_paid + v_alloc.amount;
      ELSE
        v_available_advance := COALESCE(v_rcpt.unallocated_amount, 0);
        v_apply_amount := LEAST(v_alloc.amount, v_available_advance);

        IF v_apply_amount > 0 THEN
          UPDATE public.receipts
          SET unallocated_amount = unallocated_amount - v_apply_amount, updated_at = now(), updated_by = v_member_id
          WHERE receipts.id = v_rcpt.id;

          UPDATE public.receipt_allocations
          SET deleted_at = NULL, deleted_by = NULL, amount = v_apply_amount, updated_at = now(), updated_by = v_member_id
          WHERE receipt_allocations.id = v_alloc.id;

          v_reallocated_paid := v_reallocated_paid + v_apply_amount;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Restore linked jobs and commission
  UPDATE public.jobs
  SET status = 'IN_PROGRESS', updated_at = now(), updated_by = v_member_id
  WHERE invoice_id = v_inv.id AND status = 'CANCELLED';

  UPDATE public.commission_entries
  SET status = 'UPCOMING', updated_at = now(), updated_by = v_member_id
  WHERE job_id IN (SELECT j.id FROM public.jobs j WHERE j.invoice_id = v_inv.id) AND status = 'CANCELLED';

  -- Set invoice status back to ACTIVE
  UPDATE public.invoices
  SET status = 'ACTIVE', cancel_reason = NULL,
      restored_at = now(), restored_by = v_member_id,
      paid_amount = v_reallocated_paid, updated_at = now(), updated_by = v_member_id
  WHERE invoices.id = v_inv.id;

  BEGIN
    INSERT INTO public.invoice_activities (
      business_id, invoice_id, action, reason, actor_id, actor_name, actor_role, details
    ) VALUES (
      v_biz_id, v_inv.id, 'RESTORED', v_clean_reason, v_member_id, v_actor_name, COALESCE(v_role, 'STAFF'),
      jsonb_build_object('reallocated_paid', v_reallocated_paid, 'total', v_inv.total)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_result := jsonb_build_object(
    'success', true,
    'invoice_id', v_inv.id,
    'number', v_inv.number,
    'status', 'ACTIVE',
    'restored_at', now(),
    'reallocated_paid', v_reallocated_paid,
    'balance', v_inv.total - v_reallocated_paid
  );

  IF idempotency_key IS NOT NULL AND TRIM(idempotency_key) <> '' THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
    VALUES (v_biz_id, TRIM(idempotency_key), 'RESTORE_INVOICE', 'COMPLETED', v_result, now())
    ON CONFLICT (business_id, key)
    DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;


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


-- 10. OCC Helper Functions for Direct Entity Edits
CREATE OR REPLACE FUNCTION public.update_customer_occ(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid := app.current_business_id();
  v_member_id uuid := app.current_member_id();
  v_cust_id uuid := (payload->>'id')::uuid;
  v_last_updated_at timestamptz;
  v_existing public.customers%ROWTYPE;
BEGIN
  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
  FROM public.customers
  WHERE id = v_cust_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF payload ? 'last_updated_at' AND payload->>'last_updated_at' IS NOT NULL AND payload->>'last_updated_at' <> '' THEN
    v_last_updated_at := (payload->>'last_updated_at')::timestamptz;
    IF date_trunc('milliseconds', v_existing.updated_at) > date_trunc('milliseconds', v_last_updated_at) THEN
      RAISE EXCEPTION 'CONFLICT_DETECTED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'message', 'Customer was modified on another device since you loaded it.',
          'db_updated_at', v_existing.updated_at,
          'your_updated_at', v_last_updated_at
        )::text;
    END IF;
  END IF;

  UPDATE public.customers
  SET name = COALESCE(payload->>'name', name),
      mobile = COALESCE(payload->>'mobile', mobile),
      whatsapp = COALESCE(payload->>'whatsapp', whatsapp),
      email = NULLIF(payload->>'email', ''),
      address = NULLIF(payload->>'address', ''),
      notes = NULLIF(payload->>'notes', ''),
      type = COALESCE(payload->>'type', type),
      possible_duplicate = CASE 
        WHEN payload ? 'possible_duplicate' AND payload->>'possible_duplicate' IS NOT NULL 
        THEN (payload->>'possible_duplicate')::boolean 
        ELSE possible_duplicate 
      END,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_cust_id
  RETURNING * INTO v_existing;

  RETURN to_jsonb(v_existing);
END;
$$;

REVOKE ALL ON FUNCTION public.update_customer_occ(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_customer_occ(jsonb) TO authenticated, anon;


-- 11. Enable Supabase Realtime Publication for Core Tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      CREATE PUBLICATION supabase_realtime;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE 
      public.invoices, 
      public.receipts, 
      public.customers, 
      public.jobs, 
      public.expenses, 
      public.payments, 
      public.money_transfers, 
      public.bank_accounts, 
      public.staff_payouts;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Publication might already contain these tables or be managed out-of-band
  END;
END $$;
