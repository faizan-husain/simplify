import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });

  try {
    await client.connect();
    console.log('Connected to simplify_dev');

    // 1. Update create_invoice to guarantee job creation and fallback steps
    await client.query(`
CREATE OR REPLACE FUNCTION public.create_invoice(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_biz public.businesses%ROWTYPE;

  v_invoice_date date;
  v_due_date date;
  v_fy text;

  v_customer_id uuid := NULL;
  v_party_name text;
  v_party_mobile text := NULL;
  v_walk_in jsonb;
  v_force_new_customer boolean;

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

  v_paid jsonb;
  v_paid_now numeric(14,2) := 0;
  v_payment_mode text;

  v_invoice_number text;
  v_invoice_id uuid;
  v_item_id uuid;

  v_receipt_number text;
  v_receipt_id uuid;

  v_service_row public.services%ROWTYPE;
  v_step_row record;
  v_step_count int := 0;
  v_job_id uuid;
  v_job_staff_id uuid;
  v_comm_percent numeric(5,2);
  v_comm_amount numeric(14,2);
  v_deadline_date date;

  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;

  -- 1. Parse Dates & FY
  v_invoice_date := COALESCE((payload->>'invoice_date')::date, app.today());
  v_fy := public.fy_label(v_invoice_date);
  v_due_date := COALESCE(
    (payload->>'due_date')::date,
    v_invoice_date + COALESCE(v_biz.default_terms_days, 0)
  );

  -- 2. Items & Subtotal computation (BR-2)
  v_items := payload->'items';
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->i;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
    v_rate := COALESCE((v_item->>'rate')::numeric, 0);
    v_line_amount := ROUND(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_line_amount;
  END LOOP;

  -- 3. Discount computation (BR-2)
  v_discount_type := COALESCE(payload->>'discount_type', 'NONE');
  v_discount_value := COALESCE((payload->>'discount_value')::numeric, 0);

  IF v_discount_type = 'FLAT' THEN
    v_discount_amount := LEAST(v_discount_value, v_subtotal);
  ELSIF v_discount_type = 'PERCENT' THEN
    v_discount_amount := ROUND(v_subtotal * (LEAST(GREATEST(v_discount_value, 0), 100) / 100), 2);
  ELSE
    v_discount_type := 'NONE';
    v_discount_amount := 0;
  END IF;

  v_total := GREATEST(0, v_subtotal - v_discount_amount);

  -- 4. Paid now computation
  v_paid := payload->'paid';
  IF v_paid IS NOT NULL AND (v_paid->>'amount') IS NOT NULL AND (v_paid->>'amount')::numeric > 0 THEN
    v_paid_now := LEAST((v_paid->>'amount')::numeric, v_total);
    v_payment_mode := COALESCE(v_paid->>'mode', 'CASH');
  ELSE
    v_paid_now := 0;
  END IF;

  -- 5. Customer Handling (BR-5)
  IF payload->>'customer_id' IS NOT NULL THEN
    v_customer_id := (payload->>'customer_id')::uuid;
    SELECT name, mobile INTO v_party_name, v_party_mobile
    FROM public.customers
    WHERE id = v_customer_id AND business_id = v_biz_id;
  ELSE
    -- Walk-in customer
    v_walk_in := payload->'walk_in';
    v_party_name := TRIM(COALESCE(v_walk_in->>'name', ''));
    v_party_mobile := REGEXP_REPLACE(COALESCE(v_walk_in->>'mobile', ''), '[^0-9]', '', 'g');
    IF LENGTH(v_party_mobile) = 12 AND v_party_mobile LIKE '91%' THEN
      v_party_mobile := SUBSTRING(v_party_mobile FROM 3);
    ELSIF LENGTH(v_party_mobile) = 11 AND v_party_mobile LIKE '0%' THEN
      v_party_mobile := SUBSTRING(v_party_mobile FROM 2);
    END IF;

    -- If balance > 0 (partial or unpaid), name and mobile are MANDATORY
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

      -- Check existing or create WALK_IN customer
      v_force_new_customer := COALESCE((payload->>'force_new_customer')::boolean, false);
      IF NOT v_force_new_customer AND v_party_mobile IS NOT NULL AND v_party_mobile <> '' THEN
        SELECT id INTO v_customer_id
        FROM public.customers
        WHERE business_id = v_biz_id AND mobile = v_party_mobile AND deleted_at IS NULL
        LIMIT 1;
      END IF;

      IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (business_id, name, mobile, type, possible_duplicate)
        VALUES (v_biz_id, v_party_name, v_party_mobile, 'WALK_IN', v_force_new_customer)
        RETURNING id INTO v_customer_id;
      END IF;
    END IF;
  END IF;

  -- 6. Generate Number with concurrency row lock (BR-4)
  v_invoice_number := public.next_invoice_number(
    v_biz_id,
    v_fy,
    v_biz.invoice_prefix,
    v_biz.numbering_mode,
    v_biz.invoice_start_number
  );

  -- 7. Insert Invoice
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
    v_paid_now,
    'ACTIVE',
    payload->>'notes',
    v_member_id,
    v_member_id
  )
  RETURNING id INTO v_invoice_id;

  -- 8. Insert Items & Jobs (BR-12)
  FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->i;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
    v_rate := COALESCE((v_item->>'rate')::numeric, 0);
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

    -- Job creation if service is job type or marked as job
    IF (v_item->>'service_id') IS NOT NULL THEN
      SELECT * INTO v_service_row
      FROM public.services
      WHERE id = (v_item->>'service_id')::uuid;

      IF FOUND AND (v_service_row.is_job_type OR COALESCE((v_item->>'is_job')::boolean, false)) THEN
        -- Auto-enable job_management_enabled if needed
        IF NOT v_biz.job_management_enabled THEN
          UPDATE public.businesses SET job_management_enabled = true WHERE id = v_biz_id;
          v_biz.job_management_enabled := true;
        END IF;

        v_deadline_date := v_invoice_date + COALESCE(v_service_row.deadline_days, 15);
        v_job_staff_id := CASE WHEN v_role = 'STAFF' THEN v_member_id ELSE NULL END;
        v_comm_percent := COALESCE(v_service_row.commission_percent, 0);

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
          v_service_row.id,
          v_service_row.name,
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
        FOR v_step_row IN
          SELECT position, name, whatsapp_message
          FROM public.job_type_steps
          WHERE service_id = v_service_row.id AND deleted_at IS NULL
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

        -- Fallback if service had 0 steps defined
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
    END IF;
  END LOOP;

  -- 9. If paid now > 0, create Receipt and Receipt Allocation in same transaction (BR-7)
  IF v_paid_now > 0 THEN
    v_receipt_number := public.next_receipt_number(v_biz_id, v_fy);

    INSERT INTO public.receipts (
      business_id,
      number,
      fy_label,
      receipt_date,
      customer_id,
      amount,
      mode,
      kind,
      unallocated_amount,
      created_by,
      updated_by
    )
    VALUES (
      v_biz_id,
      v_receipt_number,
      v_fy,
      v_invoice_date,
      v_customer_id,
      v_paid_now,
      v_payment_mode,
      'INVOICE_PAYMENT',
      0,
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
      v_paid_now,
      v_member_id,
      v_member_id
    );
  END IF;

  -- Return complete invoice details
  SELECT to_jsonb(invoices.*) INTO v_result
  FROM public.invoices
  WHERE id = v_invoice_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
    `);
    console.log('✓ create_invoice updated');

    // 2. Update list_jobs to support FIFO queue order, urgent sort, and return next_step_name
    await client.query(`
CREATE OR REPLACE FUNCTION public.list_jobs(
  p_tab text DEFAULT 'CURRENT',
  p_service_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0,
  p_sort text DEFAULT 'QUEUE'
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_today date;
  v_red_days int;
  v_yellow_days int;

  v_count_current int := 0;
  v_count_completed int := 0;
  v_count_due int := 0;
  v_count_yellow int := 0;
  v_count_red int := 0;

  v_jobs jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Load business red_days and yellow_days settings
  SELECT COALESCE(red_days, 3), COALESCE(yellow_days, 5)
  INTO v_red_days, v_yellow_days
  FROM public.businesses
  WHERE id = v_biz_id;

  -- Compute tab counts across all non-deleted jobs in business
  SELECT
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS'),
    COUNT(*) FILTER (WHERE j.status = 'COMPLETED'),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) <= 0),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) <= v_red_days)
  INTO
    v_count_current,
    v_count_completed,
    v_count_due,
    v_count_yellow,
    v_count_red
  FROM public.jobs j
  WHERE j.business_id = v_biz_id AND j.deleted_at IS NULL;

  -- Query jobs for active tab
  WITH job_steps_agg AS (
    SELECT
      js.job_id,
      COUNT(*)::int AS total_steps,
      COUNT(*) FILTER (WHERE js.ticked = true)::int AS ticked_steps,
      (
        SELECT s2.name 
        FROM public.job_steps s2 
        WHERE s2.job_id = js.job_id AND s2.ticked = false AND s2.deleted_at IS NULL 
        ORDER BY s2.position ASC 
        LIMIT 1
      ) AS next_step_name
    FROM public.job_steps js
    WHERE js.business_id = v_biz_id AND js.deleted_at IS NULL
    GROUP BY js.job_id
  ),
  filtered_jobs AS (
    SELECT
      j.id,
      j.invoice_id,
      i.number AS invoice_number,
      j.service_id,
      j.job_type_name,
      j.party_name,
      j.party_mobile,
      j.applicant_name,
      j.amount,
      j.deadline_date,
      (j.deadline_date - v_today) AS days_left,
      j.status,
      j.completed_at,
      j.assigned_staff_id,
      m.name AS assigned_staff_name,
      j.created_at,
      COALESCE(jsa.total_steps, 0) AS total_steps,
      COALESCE(jsa.ticked_steps, 0) AS ticked_steps,
      jsa.next_step_name,
      CASE
        WHEN COALESCE(jsa.total_steps, 0) = 0 THEN 0
        ELSE ROUND((COALESCE(jsa.ticked_steps, 0)::numeric / jsa.total_steps::numeric) * 100, 1)
      END AS progress_percent,
      CASE
        WHEN (j.deadline_date - v_today) <= v_red_days THEN 'RED'
        WHEN (j.deadline_date - v_today) <= v_yellow_days THEN 'YELLOW'
        ELSE 'NORMAL'
      END AS deadline_bucket
    FROM public.jobs j
    JOIN public.invoices i ON i.id = j.invoice_id
    LEFT JOIN public.members m ON m.id = j.assigned_staff_id
    LEFT JOIN job_steps_agg jsa ON jsa.job_id = j.id
    WHERE j.business_id = v_biz_id
      AND j.deleted_at IS NULL
      AND (p_service_id IS NULL OR j.service_id = p_service_id)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR j.party_name ILIKE '%' || p_search || '%'
        OR j.party_mobile ILIKE '%' || p_search || '%'
        OR j.applicant_name ILIKE '%' || p_search || '%'
        OR i.number ILIKE '%' || p_search || '%'
        OR j.job_type_name ILIKE '%' || p_search || '%'
      )
      AND (
        CASE UPPER(p_tab)
          WHEN 'CURRENT' THEN j.status = 'IN_PROGRESS'
          WHEN 'COMPLETED' THEN j.status = 'COMPLETED'
          WHEN 'DUE' THEN j.status = 'IN_PROGRESS'
          WHEN 'RED' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) <= v_red_days
          WHEN 'YELLOW' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days
          ELSE j.status = 'IN_PROGRESS'
        END
      )
    ORDER BY
      CASE UPPER(p_tab)
        WHEN 'COMPLETED' THEN j.completed_at
        ELSE NULL
      END DESC NULLS LAST,
      -- If user requested URGENT sort or tab is DUE/RED/YELLOW:
      CASE 
        WHEN UPPER(p_tab) IN ('DUE', 'RED', 'YELLOW') OR UPPER(p_sort) = 'URGENT' 
        THEN (j.deadline_date - v_today) 
      END ASC,
      -- If user requested PROGRESS sort:
      CASE 
        WHEN UPPER(p_sort) = 'PROGRESS' 
        THEN (COALESCE(jsa.ticked_steps, 0)::numeric / GREATEST(1, jsa.total_steps)::numeric) 
      END DESC NULLS LAST,
      -- Primary Work Queue Order: FIFO by creation time (First In, First Out)
      j.created_at ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(filtered_jobs.*)), '[]'::jsonb)
  INTO v_jobs
  FROM filtered_jobs;

  RETURN jsonb_build_object(
    'tab_counts', jsonb_build_object(
      'current', v_count_current,
      'completed', v_count_completed,
      'due', v_count_due,
      'yellow', v_count_yellow,
      'red', v_count_red
    ),
    'jobs', v_jobs
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.list_jobs(text, uuid, text, int, int, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_jobs(text, uuid, text, int, int, text) TO authenticated;
    `);
    console.log('✓ list_jobs updated with FIFO queue ordering and next_step_name');
  } finally {
    await client.end();
  }
}

main().catch(console.error);
