-- Migration 20: Link online payments to bank accounts across Bills, Receipts, Expenses, Loans & Staff payouts

-- 1. Upgrade create_invoice to store bank_account_id and bank_name on receipts
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
  v_bank_account_id uuid := NULL;
  v_bank_name text := NULL;

  v_invoice_number text;
  v_invoice_id uuid;
  v_item_id uuid;

  v_receipt_number text;
  v_receipt_id uuid;

  v_item_service_id uuid;
  v_service_row public.services%ROWTYPE;
  v_service_id uuid;
  v_job_type_name text;
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

    IF v_paid ? 'bank_account_id' AND v_paid->>'bank_account_id' <> '' THEN
      v_bank_account_id := (v_paid->>'bank_account_id')::uuid;
      SELECT bank_name INTO v_bank_name
      FROM public.bank_accounts
      WHERE id = v_bank_account_id AND business_id = v_biz_id AND deleted_at IS NULL;
    ELSIF v_payment_mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') THEN
      SELECT id, bank_name INTO v_bank_account_id, v_bank_name
      FROM public.bank_accounts
      WHERE business_id = v_biz_id AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;
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
        INSERT INTO public.customers (
          business_id,
          name,
          mobile,
          whatsapp,
          type,
          possible_duplicate,
          created_by,
          updated_by
        )
        VALUES (
          v_biz_id,
          v_party_name,
          v_party_mobile,
          v_party_mobile,
          'WALK_IN',
          false,
          v_member_id,
          v_member_id
        )
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

    -- Safe validation of service_id against current business services
    v_item_service_id := NULL;
    IF (v_item->>'service_id') IS NOT NULL AND (v_item->>'service_id') <> '' THEN
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

    -- Job creation if create_job (is_job) is explicitly true (checked by default)
    IF COALESCE((v_item->>'is_job')::boolean, false) = true THEN
      IF NOT v_biz.job_management_enabled THEN
        UPDATE public.businesses SET job_management_enabled = true WHERE id = v_biz_id;
        v_biz.job_management_enabled := true;
      END IF;

      v_service_id := NULL;
      v_job_type_name := COALESCE(v_item->>'description', 'Service Job');
      v_deadline_date := v_invoice_date + 15;
      v_comm_percent := 0;

      IF v_item_service_id IS NOT NULL THEN
        SELECT * INTO v_service_row
        FROM public.services
        WHERE id = v_item_service_id;

        IF FOUND THEN
          v_service_id := v_service_row.id;
          v_job_type_name := v_service_row.name;
          v_deadline_date := v_invoice_date + COALESCE(v_service_row.deadline_days, 15);
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

      -- Snapshot job type steps (BR-12)
      v_step_count := 0;
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

  -- 9. Receipt and Allocation in same transaction if paid now > 0 (BR-7)
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
      notes,
      bank_account_id,
      bank_name,
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
      'Payment for bill ' || v_invoice_number,
      v_bank_account_id,
      v_bank_name,
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

  -- Return complete invoice JSON
  SELECT to_jsonb(i.*) INTO v_result
  FROM public.invoices i
  WHERE i.id = v_invoice_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.create_invoice(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_invoice(jsonb) TO authenticated;


-- 2. Upgrade record_loan_repayment to record bank_account_id and bank_name
CREATE OR REPLACE FUNCTION public.record_loan_repayment(
  payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_loan_id uuid;
  v_loan public.loans%ROWTYPE;
  v_date date;
  v_principal numeric(14,2);
  v_interest numeric(14,2);
  v_mode text;
  v_notes text;
  v_bank_account_id uuid := NULL;
  v_bank_name text := NULL;
  v_total_principal_repaid numeric(14,2);
  v_outstanding numeric(14,2);
  v_repayment public.loan_repayments%ROWTYPE;
  v_interest_cat_id uuid;
  v_expense_id uuid := NULL;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_loan_id := (payload->>'loan_id')::uuid;
  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'LOAN_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_loan
  FROM public.loans
  WHERE id = v_loan_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOAN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_date := COALESCE((payload->>'repayment_date')::date, (SELECT app.today()));
  v_principal := ROUND(COALESCE((payload->>'principal')::numeric, 0), 2);
  v_interest := ROUND(COALESCE((payload->>'interest')::numeric, 0), 2);

  IF v_principal < 0 OR v_interest < 0 OR (v_principal = 0 AND v_interest = 0) THEN
    RAISE EXCEPTION 'INVALID_REPAYMENT_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  v_mode := UPPER(COALESCE(payload->>'mode', 'BANK'));
  IF v_mode NOT IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF payload ? 'bank_account_id' AND payload->>'bank_account_id' <> '' THEN
    v_bank_account_id := (payload->>'bank_account_id')::uuid;
    SELECT bank_name INTO v_bank_name
    FROM public.bank_accounts
    WHERE id = v_bank_account_id AND business_id = v_biz_id AND deleted_at IS NULL;
  ELSIF v_mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') THEN
    SELECT id, bank_name INTO v_bank_account_id, v_bank_name
    FROM public.bank_accounts
    WHERE business_id = v_biz_id AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  v_notes := payload->>'notes';

  SELECT COALESCE(SUM(principal), 0) INTO v_total_principal_repaid
  FROM public.loan_repayments
  WHERE loan_id = v_loan.id AND business_id = v_biz_id AND deleted_at IS NULL;

  v_outstanding := v_loan.amount - v_total_principal_repaid;

  IF v_principal > v_outstanding THEN
    RAISE EXCEPTION 'REPAYMENT_EXCEEDS_LOAN_BALANCE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('outstanding', v_outstanding, 'requested_principal', v_principal)::text;
  END IF;

  INSERT INTO public.loan_repayments (
    business_id, loan_id, repayment_date, principal, interest, mode, notes,
    bank_account_id, bank_name,
    created_by, updated_by
  ) VALUES (
    v_biz_id, v_loan.id, v_date, v_principal, v_interest, v_mode, v_notes,
    v_bank_account_id, v_bank_name,
    v_member_id, v_member_id
  ) RETURNING * INTO v_repayment;

  -- If interest > 0, auto-create Expense in system category "Loan Interest" (BR-11)
  IF v_interest > 0 THEN
    SELECT id INTO v_interest_cat_id
    FROM public.expense_categories
    WHERE business_id = v_biz_id AND name = 'Loan Interest' AND deleted_at IS NULL;

    IF v_interest_cat_id IS NULL THEN
      INSERT INTO public.expense_categories (business_id, name, system, created_by, updated_by)
      VALUES (v_biz_id, 'Loan Interest', true, v_member_id, v_member_id)
      RETURNING id INTO v_interest_cat_id;
    END IF;

    INSERT INTO public.expenses (
      business_id, fy_label, expense_date, category_id, description, amount,
      mode, payee, staff_id, loan_repayment_id, notes,
      bank_account_id, bank_name,
      created_by, updated_by
    ) VALUES (
      v_biz_id, public.fy_label(v_date), v_date, v_interest_cat_id,
      'Loan Interest: ' || v_loan.lender_name, v_interest,
      v_mode, v_loan.lender_name, NULL, v_repayment.id, v_notes,
      v_bank_account_id, v_bank_name,
      v_member_id, v_member_id
    ) RETURNING id INTO v_expense_id;
  END IF;

  RETURN jsonb_build_object(
    'repayment', to_jsonb(v_repayment),
    'interest_expense_id', v_expense_id,
    'loan_id', v_loan.id,
    'remaining_principal', (v_outstanding - v_principal)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.record_loan_repayment(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_loan_repayment(jsonb) TO authenticated;


-- 3. Upgrade pay_staff to record bank_account_id and bank_name
CREATE OR REPLACE FUNCTION public.pay_staff(
  payload jsonb
)
RETURNS jsonb AS $$
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
  v_bank_account_id uuid := NULL;
  v_bank_name text := NULL;
  v_cat_id uuid;
  v_expense_id uuid;
  v_payout_id uuid;
  v_fy text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
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

  IF v_mode NOT IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'INVALID_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF payload ? 'bank_account_id' AND payload->>'bank_account_id' <> '' THEN
    v_bank_account_id := (payload->>'bank_account_id')::uuid;
    SELECT bank_name INTO v_bank_name
    FROM public.bank_accounts
    WHERE id = v_bank_account_id AND business_id = v_biz_id AND deleted_at IS NULL;
  ELSIF v_mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') THEN
    SELECT id, bank_name INTO v_bank_account_id, v_bank_name
    FROM public.bank_accounts
    WHERE business_id = v_biz_id AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  SELECT id, name, role INTO v_staff
  FROM public.members
  WHERE id = v_staff_id AND business_id = v_biz_id AND active = true;

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
    business_id,
    fy_label,
    expense_date,
    category_id,
    description,
    amount,
    mode,
    payee,
    staff_id,
    notes,
    bank_account_id,
    bank_name,
    created_by,
    updated_by
  )
  VALUES (
    v_biz_id,
    v_fy,
    v_payout_date,
    v_cat_id,
    'Salary / Commission: ' || v_staff.name,
    v_amount,
    v_mode,
    v_staff.name,
    v_staff_id,
    v_notes,
    v_bank_account_id,
    v_bank_name,
    v_member_id,
    v_member_id
  )
  RETURNING id INTO v_expense_id;

  INSERT INTO public.staff_payouts (
    business_id,
    staff_id,
    amount,
    payout_date,
    mode,
    notes,
    expense_id,
    created_by,
    updated_by
  )
  VALUES (
    v_biz_id,
    v_staff_id,
    v_amount,
    v_payout_date,
    v_mode,
    v_notes,
    v_expense_id,
    v_member_id,
    v_member_id
  )
  RETURNING id INTO v_payout_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'expense_id', v_expense_id,
    'staff_id', v_staff.id,
    'staff_name', v_staff.name,
    'amount', v_amount,
    'payout_date', v_payout_date,
    'mode', v_mode
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.pay_staff(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pay_staff(jsonb) TO authenticated;
