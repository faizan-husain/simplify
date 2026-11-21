-- Migration 27: Enhanced update_invoice with full party snapshot, item recalculation, job & commission recreation, and accounting integrity

DROP FUNCTION IF EXISTS public.update_invoice(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.update_invoice(
  p_invoice_id uuid,
  payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_inv public.invoices%ROWTYPE;
  v_items jsonb;
  v_item jsonb;
  v_subtotal numeric(14,2) := 0;
  v_line_amount numeric(14,2);
  v_qty numeric(10,2);
  v_rate numeric(14,2);
  v_discount_type text;
  v_discount_value numeric(14,2);
  v_discount_amount numeric(14,2) := 0;
  v_total numeric(14,2);
  v_party_name text;
  v_party_mobile text;
  v_customer_id uuid;
  v_invoice_date date;
  v_due_date date;
  v_notes text;
  v_result jsonb;

  -- Job creation vars
  v_item_id uuid;
  v_item_service_id uuid;
  v_service_id uuid;
  v_service_row public.services%ROWTYPE;
  v_job_type_name text;
  v_deadline_date date;
  v_comm_percent numeric(5,2);
  v_job_staff_id uuid;
  v_job_id uuid;
  v_step_row RECORD;
  v_step_count int;
  v_comm_amount numeric(14,2);
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoices
  WHERE invoices.id = p_invoice_id AND invoices.business_id = v_biz_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'INVOICE_CANCELLED' USING ERRCODE = 'P0001';
  END IF;

  -- Role check: Staff can only edit own invoice
  IF v_role = 'STAFF' AND v_inv.created_by <> v_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Lock check: if any allocations exist or paid_amount > 0, raise INVOICE_LOCKED per BR-8
  IF v_inv.paid_amount > 0 OR EXISTS (SELECT 1 FROM public.receipt_allocations ra WHERE ra.invoice_id = v_inv.id) THEN
    RAISE EXCEPTION 'INVOICE_LOCKED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('invoice_id', v_inv.id)::text;
  END IF;

  -- Customer / Party updates
  v_party_name := v_inv.party_name;
  v_party_mobile := v_inv.party_mobile;
  v_customer_id := v_inv.customer_id;

  IF payload ? 'customer_id' THEN
    IF payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
      v_customer_id := (payload->>'customer_id')::uuid;
      SELECT c.name, c.mobile INTO v_party_name, v_party_mobile
      FROM public.customers c
      WHERE c.id = v_customer_id AND c.business_id = v_biz_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      v_customer_id := NULL;
    END IF;
  END IF;

  IF payload ? 'walk_in' AND payload->'walk_in' IS NOT NULL THEN
    v_customer_id := NULL;
    v_party_name := COALESCE(payload->'walk_in'->>'name', 'Walk-in');
    v_party_mobile := payload->'walk_in'->>'mobile';
  END IF;

  v_invoice_date := COALESCE((payload->>'invoice_date')::date, v_inv.invoice_date);
  v_due_date := COALESCE((payload->>'due_date')::date, v_inv.due_date);
  v_notes := CASE WHEN payload ? 'notes' THEN payload->>'notes' ELSE v_inv.notes END;

  -- Recalculate items and handle jobs
  v_items := payload->'items';
  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    -- Check if any existing job step has been ticked (BR-12)
    IF EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.job_steps js ON js.job_id = j.id
      WHERE j.invoice_id = v_inv.id AND js.ticked = true
    ) THEN
      RAISE EXCEPTION 'JOB_HAS_PROGRESS' USING ERRCODE = 'P0001';
    END IF;

    -- Clean up previous unticked jobs & items safely
    DELETE FROM public.job_step_events jse
    WHERE jse.job_step_id IN (
      SELECT js.id FROM public.job_steps js
      JOIN public.jobs j ON j.id = js.job_id
      WHERE j.invoice_id = v_inv.id
    );

    DELETE FROM public.job_steps js
    WHERE js.job_id IN (
      SELECT j.id FROM public.jobs j WHERE j.invoice_id = v_inv.id
    );

    DELETE FROM public.commission_entries ce
    WHERE ce.job_id IN (
      SELECT j.id FROM public.jobs j WHERE j.invoice_id = v_inv.id
    );

    DELETE FROM public.jobs j WHERE j.invoice_id = v_inv.id;
    DELETE FROM public.invoice_items ii WHERE ii.invoice_id = v_inv.id;

    -- Insert new items & jobs
    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      v_item := v_items->i;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
      v_rate := COALESCE((v_item->>'rate')::numeric, 0);
      v_line_amount := ROUND(v_qty * v_rate, 2);
      v_subtotal := v_subtotal + v_line_amount;

      v_item_service_id := NULL;
      IF (v_item->>'service_id') IS NOT NULL AND (v_item->>'service_id') <> '' AND (v_item->>'service_id') <> 'null' THEN
        SELECT s.id INTO v_item_service_id
        FROM public.services s
        WHERE s.id = (v_item->>'service_id')::uuid
          AND s.business_id = v_biz_id
          AND s.deleted_at IS NULL;
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
        v_inv.id,
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
      RETURNING invoice_items.id INTO v_item_id;

      -- Job recreation if create_job (is_job) is true
      IF COALESCE((v_item->>'is_job')::boolean, false) = true THEN
        v_service_id := NULL;
        v_job_type_name := COALESCE(v_item->>'description', 'Service Job');
        v_deadline_date := v_invoice_date + 15;
        v_comm_percent := 0;

        IF v_item_service_id IS NOT NULL THEN
          SELECT * INTO v_service_row
          FROM public.services s
          WHERE s.id = v_item_service_id;

          IF FOUND THEN
            v_service_id := v_service_row.id;
            v_job_type_name := v_service_row.name;
            v_deadline_date := v_invoice_date + COALESCE(v_service_row.deadline_days, 15);
            v_comm_percent := COALESCE(v_service_row.commission_percent, 0);
          END IF;
        END IF;

        IF v_service_id IS NULL THEN
          SELECT * INTO v_service_row
          FROM public.services s
          WHERE s.business_id = v_biz_id
            AND LOWER(TRIM(s.name)) = LOWER(TRIM(COALESCE(v_item->>'description', 'Service Job')))
            AND s.deleted_at IS NULL
          LIMIT 1;

          IF FOUND THEN
            v_service_id := v_service_row.id;
            v_job_type_name := v_service_row.name;
            v_deadline_date := v_invoice_date + COALESCE(v_service_row.deadline_days, 15);
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
          v_inv.id,
          v_item_id,
          v_service_id,
          v_job_type_name,
          v_party_name,
          v_party_mobile,
          v_item->>'applicant_name',
          v_line_amount,
          v_deadline_date,
          v_job_staff_id,
          v_comm_percent,
          'IN_PROGRESS',
          v_member_id,
          v_member_id
        )
        RETURNING jobs.id INTO v_job_id;

        -- Job steps snapshot
        v_step_count := 0;
        IF v_service_id IS NOT NULL THEN
          FOR v_step_row IN
            SELECT jts.position, jts.name, jts.whatsapp_message
            FROM public.job_type_steps jts
            WHERE jts.service_id = v_service_id AND jts.business_id = v_biz_id
            ORDER BY jts.position ASC
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

        IF v_step_count = 0 THEN
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
            1,
            'Processing',
            NULL,
            false,
            v_member_id,
            v_member_id
          );
        END IF;

        -- Commission entry if applicable
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
  ELSE
    v_subtotal := v_inv.subtotal;
  END IF;

  -- Discount recalculation
  v_discount_type := COALESCE(payload->>'discount_type', v_inv.discount_type);
  v_discount_value := COALESCE((payload->>'discount_value')::numeric, v_inv.discount_value);

  IF v_discount_type = 'FLAT' THEN
    v_discount_amount := LEAST(v_discount_value, v_subtotal);
  ELSIF v_discount_type = 'PERCENT' THEN
    v_discount_amount := ROUND(v_subtotal * (LEAST(GREATEST(v_discount_value, 0), 100) / 100), 2);
  ELSE
    v_discount_amount := 0;
  END IF;

  v_total := GREATEST(0, v_subtotal - v_discount_amount);

  -- Update invoice
  UPDATE public.invoices
  SET
    party_name = v_party_name,
    party_mobile = v_party_mobile,
    customer_id = v_customer_id,
    invoice_date = v_invoice_date,
    due_date = v_due_date,
    subtotal = v_subtotal,
    discount_type = v_discount_type,
    discount_value = v_discount_value,
    discount_amount = v_discount_amount,
    total = v_total,
    notes = v_notes,
    updated_at = now(),
    updated_by = v_member_id
  WHERE invoices.id = v_inv.id
  RETURNING to_jsonb(invoices.*) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_invoice(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_invoice(uuid, jsonb) TO authenticated;
