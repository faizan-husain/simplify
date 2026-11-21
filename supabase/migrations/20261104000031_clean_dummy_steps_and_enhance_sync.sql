-- Migration 31: Clean dummy 'Processing' steps and enhance sync_service_steps_to_jobs
-- Ensures services without multi-steps have 0 dummy steps, and syncing to existing open jobs replaces dummy/unticked steps.

-- 1. Remove dummy 'Processing' step from existing jobs where ticked = false and count = 1
DELETE FROM public.job_steps
WHERE name IN ('Processing', 'Processing / Document Verification')
  AND ticked = false
  AND job_id IN (
    SELECT job_id
    FROM public.job_steps
    GROUP BY job_id
    HAVING COUNT(*) = 1
  );

-- 2. Enhanced sync_service_steps_to_jobs
CREATE OR REPLACE FUNCTION public.sync_service_steps_to_jobs(
  p_service_id uuid
)
RETURNS int AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_member_id uuid;
  v_job RECORD;
  v_step RECORD;
  v_synced_jobs_count int := 0;
  v_ticked_count int;
  v_service RECORD;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_role != 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can sync service steps';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Iterate through open/in-progress jobs for this service (matching ID or snapshotted name)
  FOR v_job IN
    SELECT j.id, j.deadline_date, i.invoice_date
    FROM public.jobs j
    LEFT JOIN public.invoices i ON i.id = j.invoice_id
    WHERE j.business_id = v_biz_id
      AND (j.service_id = p_service_id OR (j.service_id IS NULL AND LOWER(TRIM(j.job_type_name)) = LOWER(TRIM(v_service.name))))
      AND j.status = 'IN_PROGRESS'
      AND j.deleted_at IS NULL
  LOOP
    -- Count ticked steps for this job
    SELECT COUNT(*) INTO v_ticked_count
    FROM public.job_steps
    WHERE job_id = v_job.id AND ticked = true AND deleted_at IS NULL;

    -- If no steps have been ticked yet (e.g. 0 steps or unticked placeholder), replace completely with new steps
    IF v_ticked_count = 0 THEN
      -- Delete unticked steps
      DELETE FROM public.job_steps
      WHERE job_id = v_job.id AND ticked = false;

      -- Insert all steps from job_type_steps
      FOR v_step IN
        SELECT position, name, whatsapp_message
        FROM public.job_type_steps
        WHERE service_id = p_service_id AND deleted_at IS NULL
        ORDER BY position ASC
      LOOP
        INSERT INTO public.job_steps (
          business_id,
          job_id,
          position,
          name,
          whatsapp_message,
          ticked,
          created_by,
          updated_by
        )
        VALUES (
          v_biz_id,
          v_job.id,
          v_step.position,
          v_step.name,
          v_step.whatsapp_message,
          false,
          v_member_id,
          v_member_id
        );
      END LOOP;

      -- Update job snapshot fields to match updated service
      UPDATE public.jobs
      SET
        service_id = p_service_id,
        job_type_name = v_service.name,
        commission_percent = COALESCE(v_service.commission_percent, commission_percent),
        deadline_date = CASE
          WHEN v_service.deadline_days IS NOT NULL AND v_service.deadline_days > 0 AND v_job.invoice_date IS NOT NULL
          THEN (v_job.invoice_date + (v_service.deadline_days || ' days')::interval)::date
          ELSE deadline_date
        END
      WHERE id = v_job.id;

      v_synced_jobs_count := v_synced_jobs_count + 1;
    END IF;
  END LOOP;

  RETURN v_synced_jobs_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.sync_service_steps_to_jobs(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sync_service_steps_to_jobs(uuid) TO authenticated;

-- 3. Update create_invoice to NOT insert dummy 'Processing' steps when a service has 0 steps
CREATE OR REPLACE FUNCTION public.create_invoice(
  p_invoice_date date,
  p_due_date date,
  p_customer_id uuid,
  p_party_name text,
  p_party_mobile text,
  p_items jsonb,
  p_discount_type text DEFAULT 'NONE',
  p_discount_value numeric DEFAULT 0,
  p_paid_amount numeric DEFAULT 0,
  p_payment_mode text DEFAULT 'CASH',
  p_payment_ref text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_force_new_customer boolean DEFAULT false,
  p_bank_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_biz RECORD;
  v_member_id uuid;
  v_role text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_fy text;
  v_counter int;
  v_subtotal numeric(14,2) := 0;
  v_discount_amount numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_paid numeric(14,2) := 0;
  v_customer_id uuid;
  v_final_party_name text;
  v_final_party_mobile text;
  v_item jsonb;
  v_qty numeric(14,2);
  v_rate numeric(14,2);
  v_line_amount numeric(14,2);
  v_item_id uuid;
  v_job_id uuid;
  v_service_id uuid;
  v_item_service_id uuid;
  v_service_row RECORD;
  v_job_type_name text;
  v_deadline_date date;
  v_comm_percent numeric(5,2);
  v_comm_amount numeric(14,2);
  v_job_staff_id uuid;
  v_step_row RECORD;
  v_step_count int;
  v_receipt_id uuid;
  v_receipt_number text;
  v_receipt_counter int;
  v_alloc_amount numeric(14,2);
  v_norm_mobile text;
  v_existing_cust_id uuid;
  v_existing_count int;
  v_needs_bank boolean := false;
  v_bank_row RECORD;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_BUSINESS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'INVOICE_ITEMS_EMPTY' USING ERRCODE = 'P0001';
  END IF;

  v_fy := public.fy_label(p_invoice_date);

  -- Mandatory bank selection check
  v_paid := COALESCE(p_paid_amount, 0);
  IF v_paid > 0 AND UPPER(p_payment_mode) IN ('UPI', 'CARD', 'BANK', 'CHEQUE') THEN
    v_needs_bank := true;
    IF p_bank_id IS NULL THEN
      RAISE EXCEPTION 'BANK_ACCOUNT_REQUIRED'
        USING ERRCODE = 'P0001',
        DETAIL = 'Please select a Bank or Online Account for this online payment';
    END IF;

    SELECT * INTO v_bank_row
    FROM public.bank_accounts
    WHERE id = p_bank_id AND business_id = v_biz_id AND deleted_at IS NULL AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_BANK_ACCOUNT'
        USING ERRCODE = 'P0001',
        DETAIL = 'Selected bank account is invalid or inactive';
    END IF;
  END IF;

  -- Calculate line items and subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := ROUND(COALESCE((v_item->>'quantity')::numeric, 1), 2);
    v_rate := ROUND(COALESCE((v_item->>'rate')::numeric, 0), 2);
    v_line_amount := ROUND(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_line_amount;
  END LOOP;

  -- Apply discount
  IF p_discount_type = 'FLAT' THEN
    v_discount_amount := ROUND(LEAST(COALESCE(p_discount_value, 0), v_subtotal), 2);
  ELSIF p_discount_type = 'PERCENT' THEN
    v_discount_amount := ROUND(v_subtotal * (LEAST(COALESCE(p_discount_value, 0), 100) / 100.0), 2);
  ELSE
    v_discount_amount := 0;
  END IF;

  v_total := ROUND(v_subtotal - v_discount_amount, 2);

  IF v_paid > v_total THEN
    v_paid := v_total;
  END IF;

  -- Customer resolution (BR-5)
  v_customer_id := p_customer_id;
  v_final_party_name := TRIM(COALESCE(p_party_name, ''));
  v_final_party_mobile := TRIM(COALESCE(p_party_mobile, ''));

  IF v_customer_id IS NOT NULL THEN
    SELECT name, mobile INTO v_final_party_name, v_final_party_mobile
    FROM public.customers
    WHERE id = v_customer_id AND business_id = v_biz_id;
  ELSE
    IF (v_total - v_paid) > 0 THEN
      IF v_final_party_name = '' OR v_final_party_mobile = '' THEN
        RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_DUE' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF v_final_party_name = '' AND v_final_party_mobile = '' THEN
      v_final_party_name := 'Walk-in';
      v_final_party_mobile := NULL;
    ELSE
      IF v_final_party_mobile != '' THEN
        v_norm_mobile := regexp_replace(v_final_party_mobile, '[^0-9]', '', 'g');
        IF length(v_norm_mobile) = 12 AND v_norm_mobile LIKE '91%' THEN
          v_norm_mobile := substring(v_norm_mobile from 3);
        ELSIF length(v_norm_mobile) = 11 AND v_norm_mobile LIKE '0%' THEN
          v_norm_mobile := substring(v_norm_mobile from 2);
        END IF;

        IF NOT p_force_new_customer THEN
          SELECT id INTO v_existing_cust_id
          FROM public.customers
          WHERE business_id = v_biz_id
            AND mobile = v_norm_mobile
            AND deleted_at IS NULL
          LIMIT 1;

          IF FOUND THEN
            v_customer_id := v_existing_cust_id;
          END IF;
        END IF;

        IF v_customer_id IS NULL THEN
          SELECT COUNT(*) INTO v_existing_count
          FROM public.customers
          WHERE business_id = v_biz_id AND mobile = v_norm_mobile AND deleted_at IS NULL;

          INSERT INTO public.customers (
            business_id,
            type,
            name,
            mobile,
            possible_duplicate,
            created_by,
            updated_by
          )
          VALUES (
            v_biz_id,
            'WALK_IN',
            v_final_party_name,
            v_norm_mobile,
            (v_existing_count > 0),
            v_member_id,
            v_member_id
          )
          RETURNING id INTO v_customer_id;
        END IF;
      ELSE
        INSERT INTO public.customers (
          business_id,
          type,
          name,
          mobile,
          created_by,
          updated_by
        )
        VALUES (
          v_biz_id,
          'WALK_IN',
          v_final_party_name,
          NULL,
          v_member_id,
          v_member_id
        )
        RETURNING id INTO v_customer_id;
      END IF;
    END IF;
  END IF;

  -- Generate invoice number
  v_counter := public.next_invoice_number(v_biz_id, v_fy);
  IF v_biz.numbering_mode = 'FY_RESET' THEN
    v_invoice_number := COALESCE(v_biz.invoice_prefix, 'INV-') || v_fy || '-' || lpad(v_counter::text, 4, '0');
  ELSE
    v_invoice_number := COALESCE(v_biz.invoice_prefix, 'INV-') || lpad(v_counter::text, 4, '0');
  END IF;

  INSERT INTO public.invoices (
    business_id,
    number,
    fy_label,
    invoice_date,
    due_date,
    customer_id,
    party_name,
    party_mobile,
    subtotal,
    discount_type,
    discount_value,
    discount_amount,
    total,
    paid_amount,
    status,
    notes,
    created_by,
    updated_by
  )
  VALUES (
    v_biz_id,
    v_invoice_number,
    v_fy,
    p_invoice_date,
    COALESCE(p_due_date, p_invoice_date),
    v_customer_id,
    v_final_party_name,
    v_final_party_mobile,
    v_subtotal,
    p_discount_type,
    p_discount_value,
    v_discount_amount,
    v_total,
    0,
    'ACTIVE',
    p_notes,
    v_member_id,
    v_member_id
  )
  RETURNING id INTO v_invoice_id;

  -- Line items and job creation
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := ROUND(COALESCE((v_item->>'quantity')::numeric, 1), 2);
    v_rate := ROUND(COALESCE((v_item->>'rate')::numeric, 0), 2);
    v_line_amount := ROUND(v_qty * v_rate, 2);

    v_item_service_id := NULL;
    IF (v_item->>'service_id') IS NOT NULL AND (v_item->>'service_id') != '' THEN
      v_item_service_id := (v_item->>'service_id')::uuid;
    END IF;

    INSERT INTO public.invoice_items (
      business_id,
      invoice_id,
      service_id,
      description,
      quantity,
      rate,
      amount,
      is_job,
      applicant_name,
      created_by,
      updated_by
    )
    VALUES (
      v_biz_id,
      v_invoice_id,
      v_item_service_id,
      COALESCE(v_item->>'description', 'Item'),
      v_qty,
      v_rate,
      v_line_amount,
      COALESCE((v_item->>'is_job')::boolean, false),
      v_item->>'applicant_name',
      v_member_id,
      v_member_id
    )
    RETURNING id INTO v_item_id;

    -- Job creation if create_job (is_job) is explicitly true
    IF COALESCE((v_item->>'is_job')::boolean, false) = true THEN
      IF NOT v_biz.job_management_enabled THEN
        UPDATE public.businesses SET job_management_enabled = true WHERE id = v_biz_id;
        v_biz.job_management_enabled := true;
      END IF;

      v_service_id := NULL;
      v_job_type_name := COALESCE(v_item->>'description', 'Service Job');
      v_deadline_date := p_invoice_date + 15;
      v_comm_percent := 0;

      IF v_item_service_id IS NOT NULL THEN
        SELECT * INTO v_service_row
        FROM public.services
        WHERE id = v_item_service_id;

        IF FOUND THEN
          v_service_id := v_service_row.id;
          v_job_type_name := v_service_row.name;
          v_deadline_date := p_invoice_date + COALESCE(v_service_row.deadline_days, 15);
          v_comm_percent := COALESCE(v_service_row.commission_percent, 0);
        END IF;
      END IF;

      IF v_service_id IS NULL THEN
        SELECT * INTO v_service_row
        FROM public.services
        WHERE business_id = v_biz_id AND LOWER(TRIM(name)) = LOWER(TRIM(COALESCE(v_item->>'description', 'Service Job'))) AND deleted_at IS NULL
        LIMIT 1;

        IF FOUND THEN
          v_service_id := v_service_row.id;
          v_job_type_name := v_service_row.name;
          v_deadline_date := p_invoice_date + COALESCE(v_service_row.deadline_days, 15);
          v_comm_percent := COALESCE(v_service_row.commission_percent, 0);
        END IF;
      END IF;

      v_job_staff_id := NULL;
      IF v_role = 'STAFF' THEN
        v_job_staff_id := v_member_id;
      END IF;

      INSERT INTO public.jobs (
        business_id,
        invoice_id,
        invoice_item_id,
        service_id,
        job_type_name,
        party_name,
        party_mobile,
        applicant_name,
        amount,
        deadline_date,
        assigned_staff_id,
        commission_percent,
        status,
        created_by,
        updated_by
      )
      VALUES (
        v_biz_id,
        v_invoice_id,
        v_item_id,
        v_service_id,
        v_job_type_name,
        v_final_party_name,
        v_final_party_mobile,
        v_item->>'applicant_name',
        v_line_amount,
        v_deadline_date,
        v_job_staff_id,
        v_comm_percent,
        'IN_PROGRESS',
        v_member_id,
        v_member_id
      )
      RETURNING id INTO v_job_id;

      -- Snapshot job type steps if service exists and has steps (BR-12)
      v_step_count := 0;
      IF v_service_id IS NOT NULL THEN
        FOR v_step_row IN
          SELECT position, name, whatsapp_message
          FROM public.job_type_steps
          WHERE service_id = v_service_id AND business_id = v_biz_id
          ORDER BY position ASC
        LOOP
          v_step_count := v_step_count + 1;
          INSERT INTO public.job_steps (
            business_id,
            job_id,
            position,
            name,
            whatsapp_message,
            ticked,
            created_by,
            updated_by
          )
          VALUES (
            v_biz_id,
            v_job_id,
            v_step_row.position,
            v_step_row.name,
            v_step_row.whatsapp_message,
            false,
            v_member_id,
            v_member_id
          );
        END LOOP;
      END IF;

      -- NOTE: If v_step_count = 0, NO dummy step is inserted! Job has 0 steps as requested.

      -- Commission entry if staff assigned & commission > 0 (BR-15)
      IF v_job_staff_id IS NOT NULL AND v_comm_percent > 0 THEN
        v_comm_amount := ROUND(v_line_amount * (v_comm_percent / 100), 2);
        INSERT INTO public.commission_entries (
          business_id,
          job_id,
          staff_id,
          base_amount,
          percent,
          amount,
          status,
          created_by,
          updated_by
        )
        VALUES (
          v_biz_id,
          v_job_id,
          v_job_staff_id,
          v_line_amount,
          v_comm_percent,
          v_comm_amount,
          'UPCOMING',
          v_member_id,
          v_member_id
        );
      END IF;
    END IF;
  END LOOP;

  -- Payment / Receipt handling (BR-7)
  IF v_paid > 0 THEN
    v_receipt_counter := public.next_receipt_number(v_biz_id, v_fy);
    IF v_biz.numbering_mode = 'FY_RESET' THEN
      v_receipt_number := 'RC-' || v_fy || '-' || lpad(v_receipt_counter::text, 4, '0');
    ELSE
      v_receipt_number := 'RC-' || lpad(v_receipt_counter::text, 4, '0');
    END IF;

    INSERT INTO public.receipts (
      business_id,
      number,
      fy_label,
      receipt_date,
      customer_id,
      amount,
      mode,
      reference,
      kind,
      unallocated_amount,
      notes,
      bank_id,
      created_by,
      updated_by
    )
    VALUES (
      v_biz_id,
      v_receipt_number,
      v_fy,
      p_invoice_date,
      v_customer_id,
      v_paid,
      p_payment_mode,
      p_payment_ref,
      'INVOICE_PAYMENT',
      0,
      'Payment for ' || v_invoice_number,
      p_bank_id,
      v_member_id,
      v_member_id
    )
    RETURNING id INTO v_receipt_id;

    INSERT INTO public.receipt_allocations (
      business_id,
      receipt_id,
      invoice_id,
      amount,
      created_by,
      updated_by
    )
    VALUES (
      v_biz_id,
      v_receipt_id,
      v_invoice_id,
      v_paid,
      v_member_id,
      v_member_id
    );

    UPDATE public.invoices
    SET paid_amount = v_paid
    WHERE id = v_invoice_id;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'total', v_total,
    'paid_amount', v_paid,
    'balance', v_total - v_paid,
    'customer_id', v_customer_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.create_invoice(date, date, uuid, text, text, jsonb, text, numeric, numeric, text, text, text, boolean, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_invoice(date, date, uuid, text, text, jsonb, text, numeric, numeric, text, text, text, boolean, uuid) TO authenticated;

