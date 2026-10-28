import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });
  await client.connect();

  console.log('Patching create_invoice to strictly respect is_job flag...');

  await client.query(`
    ALTER TABLE public.jobs ALTER COLUMN service_id DROP NOT NULL;
  `);

  await client.query(`
CREATE OR REPLACE FUNCTION public.create_invoice(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_biz public.businesses%ROWTYPE;
  v_fy text;
  v_invoice_number text;
  v_invoice_date date;
  v_due_date date;
  v_customer_id uuid := NULL;
  v_party_name text;
  v_party_mobile text;
  v_subtotal numeric(14,2) := 0;
  v_discount_type text;
  v_discount_value numeric(14,2) := 0;
  v_discount_amount numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_paid_amount numeric(14,2) := 0;
  v_balance numeric(14,2) := 0;
  v_invoice_id uuid;
  v_item jsonb;
  v_qty numeric(14,2);
  v_rate numeric(14,2);
  v_line_amount numeric(14,2);
  v_item_id uuid;
  v_service_row public.services%ROWTYPE;
  v_service_id uuid;
  v_job_type_name text;
  v_deadline_date date;
  v_job_id uuid;
  v_job_staff_id uuid;
  v_comm_percent numeric(5,2);
  v_comm_amount numeric(14,2);
  v_step_row record;
  v_step_count int := 0;
  v_receipt_id uuid;
  v_receipt_number text;
  v_paid_obj jsonb;
  v_paid_val numeric(14,2) := 0;
  v_paid_mode text := 'CASH';
  v_walk_in jsonb;
  v_existing_customer_id uuid;
  v_counter_record record;
  v_inv_record record;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_invoice_date := COALESCE((payload->>'invoice_date')::date, (SELECT app.today()));
  v_due_date := COALESCE(
    (payload->>'due_date')::date,
    v_invoice_date + COALESCE(v_biz.default_terms_days, 0)
  );
  v_fy := public.fy_label(v_invoice_date);

  -- Customer handling (BR-5)
  IF payload ? 'customer_id' AND payload->>'customer_id' IS NOT NULL THEN
    v_customer_id := (payload->>'customer_id')::uuid;
    SELECT name, mobile INTO v_party_name, v_party_mobile
    FROM public.customers
    WHERE id = v_customer_id AND business_id = v_biz_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  ELSIF payload ? 'walk_in' AND payload->'walk_in' IS NOT NULL THEN
    v_walk_in := payload->'walk_in';
    v_party_name := TRIM(COALESCE(v_walk_in->>'name', ''));
    v_party_mobile := TRIM(COALESCE(v_walk_in->>'mobile', ''));

    IF v_party_name = '' AND v_party_mobile = '' THEN
      v_party_name := 'Walk-in';
      v_party_mobile := NULL;
      v_customer_id := NULL;
    ELSE
      IF v_party_name = '' THEN v_party_name := 'Walk-in'; END IF;
      IF v_party_mobile = '' THEN v_party_mobile := NULL; END IF;

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
        v_party_name,
        v_party_mobile,
        v_member_id,
        v_member_id
      )
      RETURNING id INTO v_customer_id;
    END IF;
  ELSE
    v_party_name := 'Walk-in';
    v_party_mobile := NULL;
    v_customer_id := NULL;
  END IF;

  -- Compute subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    v_qty := ROUND(COALESCE((v_item->>'quantity')::numeric, 1), 2);
    v_rate := ROUND(COALESCE((v_item->>'rate')::numeric, 0), 2);
    v_line_amount := ROUND(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_line_amount;
  END LOOP;

  -- Discount (BR-2)
  v_discount_type := COALESCE(payload->>'discount_type', 'NONE');
  v_discount_value := ROUND(COALESCE((payload->>'discount_value')::numeric, 0), 2);

  IF v_discount_type = 'FLAT' THEN
    v_discount_amount := LEAST(v_discount_value, v_subtotal);
  ELSIF v_discount_type = 'PERCENT' THEN
    v_discount_value := LEAST(GREATEST(v_discount_value, 0), 100);
    v_discount_amount := ROUND(v_subtotal * (v_discount_value / 100.0), 2);
  ELSE
    v_discount_type := 'NONE';
    v_discount_amount := 0;
  END IF;

  v_total := ROUND(v_subtotal - v_discount_amount, 2);

  -- Paid calculation
  IF payload ? 'paid' AND payload->'paid' IS NOT NULL THEN
    v_paid_obj := payload->'paid';
    v_paid_val := ROUND(COALESCE((v_paid_obj->>'amount')::numeric, 0), 2);
    v_paid_mode := COALESCE(v_paid_obj->>'mode', 'CASH');
    v_paid_amount := LEAST(v_paid_val, v_total);
  ELSE
    v_paid_amount := 0;
  END IF;

  v_balance := ROUND(v_total - v_paid_amount, 2);

  -- BR-5 Check: Due balance on walk-in requires name and mobile
  IF v_balance > 0 AND (v_customer_id IS NULL OR v_party_name = 'Walk-in' OR v_party_mobile IS NULL) THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_DUE' USING ERRCODE = 'P0001';
  END IF;

  -- Lock invoice counter & generate number
  v_invoice_number := public.next_invoice_number(
    v_biz_id,
    v_fy,
    v_biz.invoice_prefix,
    v_biz.numbering_mode,
    v_biz.invoice_start_number
  );

  -- Insert invoice
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
    v_invoice_date,
    v_due_date,
    v_customer_id,
    v_party_name,
    v_party_mobile,
    v_subtotal,
    v_discount_type,
    v_discount_value,
    v_discount_amount,
    v_total,
    v_paid_amount,
    'ACTIVE',
    payload->>'notes',
    v_member_id,
    v_member_id
  )
  RETURNING id INTO v_invoice_id;

  -- Insert invoice items & create jobs
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    v_qty := ROUND(COALESCE((v_item->>'quantity')::numeric, 1), 2);
    v_rate := ROUND(COALESCE((v_item->>'rate')::numeric, 0), 2);
    v_line_amount := ROUND(v_qty * v_rate, 2);

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
      (v_item->>'service_id')::uuid,
      v_item->>'description',
      v_qty,
      v_rate,
      v_line_amount,
      COALESCE((v_item->>'is_job')::boolean, false),
      v_item->>'applicant_name',
      v_member_id,
      v_member_id
    )
    RETURNING id INTO v_item_id;

    -- Job creation if create_job (is_job) is explicitly true (checked by default)
    IF COALESCE((v_item->>'is_job')::boolean, false) = true THEN
      IF NOT v_biz.job_management_enabled THEN
        UPDATE public.businesses SET job_management_enabled = true WHERE id = v_biz_id;
        v_biz.job_management_enabled := true;
      END IF;

      v_service_id := NULL;
      v_job_type_name := v_item->>'description';
      v_deadline_date := v_invoice_date + 15;
      v_comm_percent := 0;

      IF (v_item->>'service_id') IS NOT NULL THEN
        SELECT * INTO v_service_row
        FROM public.services
        WHERE id = (v_item->>'service_id')::uuid;

        IF FOUND THEN
          v_service_id := v_service_row.id;
          v_job_type_name := v_service_row.name;
          v_deadline_date := v_invoice_date + COALESCE(v_service_row.deadline_days, 15);
          v_comm_percent := COALESCE(v_service_row.commission_percent, 0);
        END IF;
      ELSE
        -- Look up service by name or auto-create for custom entries
        SELECT * INTO v_service_row
        FROM public.services
        WHERE business_id = v_biz_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_item->>'description')) AND deleted_at IS NULL
        LIMIT 1;

        IF FOUND THEN
          v_service_id := v_service_row.id;
          v_job_type_name := v_service_row.name;
          v_deadline_date := v_invoice_date + COALESCE(v_service_row.deadline_days, 15);
          v_comm_percent := COALESCE(v_service_row.commission_percent, 0);
        ELSE
          INSERT INTO public.services (
            business_id,
            name,
            default_rate,
            is_job_type,
            deadline_days,
            commission_percent,
            active,
            created_by,
            updated_by
          )
          VALUES (
            v_biz_id,
            TRIM(v_item->>'description'),
            v_rate,
            true,
            15,
            0,
            true,
            v_member_id,
            v_member_id
          )
          RETURNING * INTO v_service_row;

          v_service_id := v_service_row.id;
          v_job_type_name := v_service_row.name;
          v_deadline_date := v_invoice_date + 15;
          v_comm_percent := 0;
        END IF;
      END IF;

      v_job_staff_id := CASE WHEN v_role = 'STAFF' THEN v_member_id ELSE NULL END;

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
      RETURNING id INTO v_job_id;

      -- Snapshot steps (BR-12)
      v_step_count := 0;
      IF v_service_id IS NOT NULL THEN
        FOR v_step_row IN
          SELECT position, name, whatsapp_message
          FROM public.job_type_steps
          WHERE service_id = v_service_id AND deleted_at IS NULL
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
          'Processing / Document Verification',
          'Hello {party_name}, your {job_name} ({bill_no}) is currently in process. - {business_name}',
          false,
          v_member_id,
          v_member_id
        );
      END IF;

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

  -- Create receipt & allocation if paid > 0 (BR-7)
  IF v_paid_amount > 0 THEN
    v_receipt_number := public.next_receipt_number(v_biz_id, v_fy);

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
      created_by,
      updated_by
    )
    VALUES (
      v_biz_id,
      v_receipt_number,
      v_fy,
      v_invoice_date,
      v_customer_id,
      v_paid_amount,
      v_paid_mode,
      NULL,
      'INVOICE_PAYMENT',
      0,
      'Payment recorded at invoice creation',
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
      v_paid_amount,
      v_member_id,
      v_member_id
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_invoice_id,
    'number', v_invoice_number,
    'total', v_total,
    'paid_amount', v_paid_amount,
    'balance', v_balance,
    'status', 'ACTIVE',
    'party_name', v_party_name,
    'party_mobile', v_party_mobile
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
  `);

  console.log('✓ create_invoice patched successfully.');
  await client.end();
}

main().catch(console.error);
