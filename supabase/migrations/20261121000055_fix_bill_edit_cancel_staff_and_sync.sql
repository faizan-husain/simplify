-- ==============================================================================
-- Migration: 20261121000055_fix_bill_edit_cancel_staff_and_sync.sql
-- Description:
-- 1. Fix create_invoice: ensure bank_account_id and bank_name are populated on upfront receipts.
-- 2. Fix cancel_invoice: soft-delete upfront receipts on bill cancellation so money is deducted from bank/cash balance.
-- 3. Fix bank_ledger: show receipts even if bank_account_id was not explicitly linked when business has a bank.
-- 4. Upgrade update_invoice: allow Owner/Accountant to edit active bills, update payment mode (UPI <-> Cash), and adjust receipts.
-- 5. Fix handle_new_user trigger & create_team_member: prevent duplicate key and orphan business creation for staff.
-- 6. Upgrade sync_service_steps_to_jobs: sync step additions, deletions and updates to all in-progress jobs.
-- 7. Retroactive cleanup: fix orphan receipts from previously cancelled bills and missing bank_account_id on receipts.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Fix handle_new_user: Skip STAFF users created by Business Owners
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_biz_id uuid;
  v_name text;
  v_clean_mobile text;
  v_role text;
BEGIN
  -- If this user is marked as STAFF or already attached to a member profile, skip business creation
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', NEW.raw_app_meta_data->>'role', '');
  IF UPPER(v_role) = 'STAFF' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.members WHERE auth_user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Derive owner name
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'owner_name',
    NULLIF(SPLIT_PART(NEW.email, '@', 1), ''),
    'Business Owner'
  );

  v_clean_mobile := COALESCE(
    NULLIF(REGEXP_REPLACE(COALESCE(NEW.phone, NEW.raw_user_meta_data->>'mobile', ''), '[^0-9]', '', 'g'), ''),
    '9876543210'
  );
  IF LENGTH(v_clean_mobile) = 12 AND v_clean_mobile LIKE '91%' THEN
    v_clean_mobile := SUBSTRING(v_clean_mobile FROM 3);
  ELSIF LENGTH(v_clean_mobile) = 11 AND v_clean_mobile LIKE '0%' THEN
    v_clean_mobile := SUBSTRING(v_clean_mobile FROM 2);
  END IF;

  -- 1. Create Business
  INSERT INTO public.businesses (
    name,
    owner_name,
    mobile,
    email,
    job_management_enabled,
    plan,
    timezone
  )
  VALUES (
    v_name || ' Store',
    v_name,
    v_clean_mobile,
    NEW.email,
    true,
    'PRO',
    'Asia/Kolkata'
  )
  RETURNING id INTO v_biz_id;

  -- 2. Create Owner Member
  INSERT INTO public.members (
    business_id,
    auth_user_id,
    name,
    email,
    mobile,
    role,
    can_login,
    active
  )
  VALUES (
    v_biz_id,
    NEW.id,
    v_name,
    NEW.email,
    v_clean_mobile,
    'OWNER',
    true,
    true
  );

  -- 3. Invoice counter
  INSERT INTO public.invoice_counters (business_id, fy_label, last_number)
  VALUES (v_biz_id, 'ALL', 0)
  ON CONFLICT DO NOTHING;

  -- 4. Default expense categories
  INSERT INTO public.expense_categories (business_id, name, system) VALUES
    (v_biz_id, 'Rent', false),
    (v_biz_id, 'Electricity', false),
    (v_biz_id, 'Internet & Utilities', false),
    (v_biz_id, 'Salary', false),
    (v_biz_id, 'Paper & Supplies', false),
    (v_biz_id, 'Salary / Commission', true),
    (v_biz_id, 'Loan Interest', true)
  ON CONFLICT DO NOTHING;

  -- 5. Default WhatsApp templates
  INSERT INTO public.whatsapp_templates (business_id, type, body) VALUES
    (v_biz_id, 'INVOICE', 'Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}.'),
    (v_biz_id, 'RECEIPT', 'Hello {customer_name}, received payment of {amount} for bill #{invoice_no}. Thank you! - {business_name}'),
    (v_biz_id, 'REMINDER', 'Hello {customer_name}, reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}')
  ON CONFLICT DO NOTHING;

  -- 6. Privacy PIN '1234'
  INSERT INTO public.business_secrets (business_id, privacy_pin_hash)
  VALUES (v_biz_id, crypt('1234', gen_salt('bf')))
  ON CONFLICT (business_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';


-- ------------------------------------------------------------------------------
-- 2. Fix create_team_member: Create Staff user safely without conflict
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_team_member(
  p_name text,
  p_email text,
  p_password text,
  p_role text DEFAULT 'STAFF',
  p_mobile text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_caller_role text;
  v_caller_id uuid;
  v_auth_user_id uuid;
  v_member_id uuid;
  v_clean_mobile text;
  v_clean_email text;
  v_clean_name text;
  v_role text;
BEGIN
  v_biz_id := app.current_business_id();
  v_caller_role := app.current_role();
  v_caller_id := app.current_member_id();

  IF v_biz_id IS NULL OR v_caller_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only owners can add team members';
  END IF;

  v_clean_name := trim(COALESCE(p_name, ''));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'NAME_REQUIRED' USING ERRCODE = 'P0001', DETAIL = 'Name must be at least 2 characters';
  END IF;

  v_clean_email := lower(trim(COALESCE(p_email, '')));
  IF v_clean_email = '' OR v_clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL' USING ERRCODE = 'P0001', DETAIL = 'A valid email address is required';
  END IF;

  IF length(COALESCE(p_password, '')) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT' USING ERRCODE = 'P0001', DETAIL = 'Password must be at least 6 characters';
  END IF;

  v_role := upper(trim(COALESCE(p_role, 'STAFF')));
  IF v_role <> 'STAFF' THEN
    RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE = 'P0001', DETAIL = 'Only STAFF role can be created for team members';
  END IF;

  -- Check if member email already exists in this business
  IF EXISTS (
    SELECT 1 FROM public.members 
    WHERE business_id = v_biz_id AND lower(email) = v_clean_email AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'MEMBER_EXISTS' USING ERRCODE = 'P0001', DETAIL = 'A member with this email already exists';
  END IF;

  v_clean_mobile := NULL;
  IF p_mobile IS NOT NULL AND trim(p_mobile) <> '' THEN
    v_clean_mobile := regexp_replace(p_mobile, '\D', '', 'g');
    IF length(v_clean_mobile) >= 10 THEN
      v_clean_mobile := right(v_clean_mobile, 10);
    END IF;
  END IF;

  -- 1. Create or update auth.users with role=STAFF so trigger doesn't create duplicate business
  v_auth_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    v_auth_user_id,
    'authenticated',
    'authenticated',
    v_clean_email,
    public.crypt(p_password, public.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'STAFF'),
    jsonb_build_object('name', v_clean_name, 'role', 'STAFF', 'business_id', v_biz_id),
    now(),
    now()
  )
  ON CONFLICT (email) DO UPDATE
    SET encrypted_password = public.crypt(p_password, public.gen_salt('bf')),
        raw_user_meta_data = jsonb_build_object('name', v_clean_name, 'role', 'STAFF', 'business_id', v_biz_id),
        updated_at = now()
  RETURNING id INTO v_auth_user_id;

  -- 2. Insert into public.members
  INSERT INTO public.members (
    business_id,
    auth_user_id,
    name,
    email,
    mobile,
    role,
    can_login,
    active,
    created_by,
    updated_by
  )
  VALUES (
    v_biz_id,
    v_auth_user_id,
    v_clean_name,
    v_clean_email,
    v_clean_mobile,
    v_role,
    true,
    true,
    v_caller_id,
    v_caller_id
  )
  ON CONFLICT (auth_user_id) DO UPDATE
    SET business_id = v_biz_id,
        role = v_role,
        name = v_clean_name,
        email = v_clean_email,
        mobile = v_clean_mobile,
        can_login = true,
        active = true,
        deleted_at = NULL,
        updated_at = now(),
        updated_by = v_caller_id
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_team_member(text, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3. Fix create_invoice: Populate bank_account_id & bank_name on upfront receipts
-- ------------------------------------------------------------------------------
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
    v_payment_mode := UPPER(COALESCE(v_paid->>'mode', 'CASH'));

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

    -- Job creation if create_job (is_job) is true
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
      'Payment for bill #' || v_invoice_number,
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

  RETURN jsonb_build_object(
    'id', v_invoice_id,
    'number', v_invoice_number,
    'total', v_total,
    'paid_amount', v_paid_now,
    'balance', v_total - v_paid_now,
    'status', 'ACTIVE'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';


-- ------------------------------------------------------------------------------
-- 4. Fix cancel_invoice: Soft-delete upfront receipt on cancellation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invoice(id uuid, reason text)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_inv public.invoices%ROWTYPE;
  v_alloc record;
  v_rcpt record;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());

  IF reason IS NULL OR TRIM(reason) = '' THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE invoices.id = cancel_invoice.id AND business_id = v_biz_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.status = 'CANCELLED' THEN
    RETURN to_jsonb(v_inv);
  END IF;

  -- Process allocations:
  -- If a receipt was created for this invoice (kind = INVOICE_PAYMENT and all allocations belong to this invoice),
  -- soft-delete the receipt so cash/bank balance & income decrease immediately!
  FOR v_alloc IN
    SELECT receipt_id, amount
    FROM public.receipt_allocations
    WHERE invoice_id = v_inv.id
  LOOP
    SELECT * INTO v_rcpt FROM public.receipts WHERE id = v_alloc.receipt_id;
    IF FOUND THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.receipt_allocations
        WHERE receipt_id = v_rcpt.id AND invoice_id <> v_inv.id
      ) THEN
        -- Only allocated to this bill -> soft delete the receipt
        UPDATE public.receipts
        SET deleted_at = now(),
            deleted_by = v_member_id,
            notes = COALESCE(notes, '') || ' (Cancelled with Bill #' || v_inv.number || ')'
        WHERE id = v_rcpt.id;
      ELSE
        -- Shared receipt across multiple invoices -> return to unallocated advance
        UPDATE public.receipts
        SET unallocated_amount = unallocated_amount + v_alloc.amount,
            updated_at = now(),
            updated_by = v_member_id
        WHERE id = v_rcpt.id;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.receipt_allocations WHERE invoice_id = v_inv.id;

  -- Cancel linked jobs and commissions (BR-8)
  UPDATE public.jobs
  SET status = 'CANCELLED', updated_at = now(), updated_by = v_member_id
  WHERE invoice_id = v_inv.id;

  UPDATE public.commission_entries
  SET status = 'CANCELLED', updated_at = now(), updated_by = v_member_id
  WHERE job_id IN (SELECT jobs.id FROM public.jobs WHERE jobs.invoice_id = v_inv.id);

  -- Set invoice status CANCELLED and reset paid_amount to 0
  UPDATE public.invoices
  SET
    status = 'CANCELLED',
    cancel_reason = TRIM(reason),
    paid_amount = 0,
    updated_at = now(),
    updated_by = v_member_id
  WHERE invoices.id = v_inv.id
  RETURNING to_jsonb(invoices.*) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';


-- ------------------------------------------------------------------------------
-- 5. Fix bank_ledger: Show receipts when business has bank account
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bank_ledger(
  p_bank_account_id uuid DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_txns jsonb := '[]'::jsonb;
  v_opening numeric(14,2) := 0;
  v_summary_data jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner and Accountant can view bank ledger';
  END IF;

  WITH bank_txns AS (
    -- 1. Money IN: Receipts
    SELECT
      r.id,
      r.receipt_date AS date,
      'RECEIPT' AS txn_type,
      'Receipt: ' || r.number || COALESCE(' - ' || c.name, '') AS description,
      COALESCE(r.bank_account_id, ba.id) AS bank_account_id,
      COALESCE(r.bank_name, ba.bank_name) AS bank_name,
      ba.account_number,
      r.amount AS in_amount,
      0::numeric(14,2) AS out_amount,
      r.mode,
      r.reference,
      r.created_at
    FROM public.receipts r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    LEFT JOIN public.bank_accounts ba ON (
      ba.id = r.bank_account_id 
      OR (r.bank_account_id IS NULL AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1)
    )
    WHERE r.business_id = v_biz_id
      AND r.deleted_at IS NULL
      AND (r.bank_account_id IS NOT NULL OR (r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND ba.id IS NOT NULL))
      AND (p_bank_account_id IS NULL OR r.bank_account_id = p_bank_account_id OR ba.id = p_bank_account_id)
      AND (p_from_date IS NULL OR r.receipt_date >= p_from_date)
      AND (p_to_date IS NULL OR r.receipt_date <= p_to_date)

    UNION ALL

    -- 2. Money IN: Transfer to bank
    SELECT
      mt.id,
      mt.transfer_date AS date,
      'TRANSFER_IN' AS txn_type,
      CASE 
        WHEN mt.transfer_type = 'CASH_TO_BANK' THEN 'Cash Deposit'
        ELSE 'Transfer from ' || COALESCE(fb.bank_name, 'Other Bank')
      END AS description,
      mt.to_bank_account_id AS bank_account_id,
      tb.bank_name,
      tb.account_number,
      mt.amount AS in_amount,
      0::numeric(14,2) AS out_amount,
      'CONTRA' AS mode,
      mt.notes AS reference,
      mt.created_at
    FROM public.money_transfers mt
    JOIN public.bank_accounts tb ON tb.id = mt.to_bank_account_id
    LEFT JOIN public.bank_accounts fb ON fb.id = mt.from_bank_account_id
    WHERE mt.business_id = v_biz_id
      AND mt.deleted_at IS NULL
      AND (p_bank_account_id IS NULL OR mt.to_bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
      AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)

    UNION ALL

    -- 3. Money OUT: Payments
    SELECT
      p.id,
      p.payment_date AS date,
      'PAYMENT' AS txn_type,
      'Payment to ' || COALESCE(v.name, 'Vendor') || ': ' || p.description AS description,
      p.bank_account_id,
      ba.bank_name,
      ba.account_number,
      0::numeric(14,2) AS in_amount,
      p.amount AS out_amount,
      p.mode,
      p.notes AS reference,
      p.created_at
    FROM public.payments p
    LEFT JOIN public.vendors v ON v.id = p.vendor_id
    JOIN public.bank_accounts ba ON ba.id = p.bank_account_id
    WHERE p.business_id = v_biz_id
      AND p.deleted_at IS NULL
      AND p.bank_account_id IS NOT NULL
      AND (p_bank_account_id IS NULL OR p.bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR p.payment_date <= p_to_date)

    UNION ALL

    -- 4. Money OUT: Expenses
    SELECT
      e.id,
      e.expense_date AS date,
      'EXPENSE' AS txn_type,
      'Expense: ' || ec.name || COALESCE(' - ' || e.payee, '') || ': ' || e.description AS description,
      e.bank_account_id,
      ba.bank_name,
      ba.account_number,
      0::numeric(14,2) AS in_amount,
      e.amount AS out_amount,
      e.mode,
      e.notes AS reference,
      e.created_at
    FROM public.expenses e
    JOIN public.expense_categories ec ON ec.id = e.category_id
    JOIN public.bank_accounts ba ON ba.id = e.bank_account_id
    WHERE e.business_id = v_biz_id
      AND e.deleted_at IS NULL
      AND e.bank_account_id IS NOT NULL
      AND (p_bank_account_id IS NULL OR e.bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR e.expense_date >= p_from_date)
      AND (p_to_date IS NULL OR e.expense_date <= p_to_date)

    UNION ALL

    -- 5. Money OUT: Loan Repayments
    SELECT
      lr.id,
      lr.repayment_date AS date,
      'LOAN_REPAY' AS txn_type,
      'Loan Repayment to ' || l.lender_name || ' (P: ' || lr.principal || ' + I: ' || lr.interest || ')' AS description,
      lr.bank_account_id,
      ba.bank_name,
      ba.account_number,
      0::numeric(14,2) AS in_amount,
      (lr.principal + lr.interest) AS out_amount,
      lr.mode,
      lr.notes AS reference,
      lr.created_at
    FROM public.loan_repayments lr
    JOIN public.loans l ON l.id = lr.loan_id
    JOIN public.bank_accounts ba ON ba.id = lr.bank_account_id
    WHERE l.business_id = v_biz_id
      AND lr.deleted_at IS NULL
      AND lr.bank_account_id IS NOT NULL
      AND (p_bank_account_id IS NULL OR lr.bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date)
      AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date)

    UNION ALL

    -- 6. Money OUT: Transfer from bank
    SELECT
      mt.id,
      mt.transfer_date AS date,
      'TRANSFER_OUT' AS txn_type,
      CASE 
        WHEN mt.transfer_type = 'BANK_TO_CASH' THEN 'Cash Withdrawal'
        ELSE 'Transfer to ' || COALESCE(tb.bank_name, 'Other Bank')
      END AS description,
      mt.from_bank_account_id AS bank_account_id,
      fb.bank_name,
      fb.account_number,
      0::numeric(14,2) AS in_amount,
      mt.amount AS out_amount,
      'CONTRA' AS mode,
      mt.notes AS reference,
      mt.created_at
    FROM public.money_transfers mt
    JOIN public.bank_accounts fb ON fb.id = mt.from_bank_account_id
    LEFT JOIN public.bank_accounts tb ON tb.id = mt.to_bank_account_id
    WHERE mt.business_id = v_biz_id
      AND mt.deleted_at IS NULL
      AND (p_bank_account_id IS NULL OR mt.from_bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
      AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'date', t.date,
      'txn_type', t.txn_type,
      'description', t.description,
      'bank_account_id', t.bank_account_id,
      'bank_name', t.bank_name,
      'account_number', t.account_number,
      'in_amount', t.in_amount,
      'out_amount', t.out_amount,
      'mode', t.mode,
      'reference', t.reference,
      'created_at', t.created_at
    ) ORDER BY t.date ASC, t.created_at ASC
  ), '[]'::jsonb)
  INTO v_txns
  FROM bank_txns t;

  RETURN jsonb_build_object(
    'transactions', v_txns,
    'total_count', jsonb_array_length(v_txns)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';


-- ------------------------------------------------------------------------------
-- 6. Upgrade update_invoice: Allow Owner & Accountant to Edit Active Bills & Payments
-- ------------------------------------------------------------------------------
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
  v_service_id uuid;
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
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'INVOICE_CANCELLED' USING ERRCODE = 'P0001';
  END IF;

  IF v_role = 'STAFF' AND v_inv.created_by <> v_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Customer / Party updates
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

  -- 2. Recalculate items and handle jobs
  v_items := payload->'items';
  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    -- Check if any existing job step has been ticked (BR-12)
    IF EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.job_steps js ON js.job_id = j.id
      WHERE j.invoice_id = v_inv.id AND js.ticked = true
    ) THEN
      RAISE EXCEPTION 'JOB_HAS_PROGRESS' USING ERRCODE = 'P0001', DETAIL = 'Cannot change items for a bill with ticked job steps';
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

    -- Insert updated items & recreate jobs
    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      v_item := v_items->i;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
      v_rate := COALESCE((v_item->>'rate')::numeric, 0);
      v_line_amount := ROUND(v_qty * v_rate, 2);
      v_subtotal := v_subtotal + v_line_amount;

      v_item_service_id := NULL;
      IF (v_item->>'service_id') IS NOT NULL AND (v_item->>'service_id') <> '' THEN
        SELECT s.id INTO v_item_service_id
        FROM public.services s
        WHERE s.id = (v_item->>'service_id')::uuid AND s.business_id = v_biz_id AND s.deleted_at IS NULL;
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
      RETURNING id INTO v_item_id;

      IF COALESCE((v_item->>'is_job')::boolean, false) = true THEN
        v_service_id := NULL;
        v_job_type_name := COALESCE(v_item->>'description', 'Service Job');
        v_deadline_date := v_invoice_date + 15;
        v_comm_percent := 0;

        IF v_item_service_id IS NOT NULL THEN
          SELECT * INTO v_service_row FROM public.services WHERE id = v_item_service_id;
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
        RETURNING id INTO v_job_id;

        IF v_service_id IS NOT NULL THEN
          FOR v_step_row IN
            SELECT position, name, whatsapp_message
            FROM public.job_type_steps
            WHERE service_id = v_service_id AND business_id = v_biz_id
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
      END IF;
    END LOOP;
  ELSE
    v_subtotal := v_inv.subtotal;
  END IF;

  -- 3. Discount computation
  v_discount_type := COALESCE(payload->>'discount_type', v_inv.discount_type);
  v_discount_value := COALESCE((payload->>'discount_value')::numeric, v_inv.discount_value);

  IF v_discount_type = 'FLAT' THEN
    v_discount_amount := LEAST(v_discount_value, v_subtotal);
  ELSIF v_discount_type = 'PERCENT' THEN
    v_discount_amount := ROUND(v_subtotal * (LEAST(GREATEST(v_discount_value, 0), 100) / 100), 2);
  ELSE
    v_discount_type := 'NONE';
    v_discount_amount := 0;
  END IF;

  v_total := GREATEST(0, v_subtotal - v_discount_amount);

  -- 4. Payment & Receipt Update (BR-7 / BR-8)
  v_final_paid := v_inv.paid_amount;
  IF payload ? 'paid' AND payload->'paid' IS NOT NULL THEN
    v_paid := payload->'paid';
    v_new_paid := LEAST(COALESCE((v_paid->>'amount')::numeric, 0), v_total);
    v_new_mode := UPPER(COALESCE(v_paid->>'mode', 'CASH'));

    IF v_paid ? 'bank_account_id' AND v_paid->>'bank_account_id' <> '' THEN
      v_new_bank_id := (v_paid->>'bank_account_id')::uuid;
      SELECT bank_name INTO v_new_bank_name
      FROM public.bank_accounts
      WHERE id = v_new_bank_id AND business_id = v_biz_id AND deleted_at IS NULL;
    ELSIF v_new_mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') THEN
      SELECT id, bank_name INTO v_new_bank_id, v_new_bank_name
      FROM public.bank_accounts
      WHERE business_id = v_biz_id AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    -- Look for existing upfront receipt for this invoice
    SELECT r.* INTO v_existing_rcpt
    FROM public.receipt_allocations ra
    JOIN public.receipts r ON r.id = ra.receipt_id
    WHERE ra.invoice_id = v_inv.id AND r.deleted_at IS NULL
    ORDER BY r.created_at ASC
    LIMIT 1;

    IF v_existing_rcpt.id IS NOT NULL THEN
      IF v_new_paid > 0 THEN
        UPDATE public.receipts
        SET amount = v_new_paid,
            mode = v_new_mode,
            bank_account_id = v_new_bank_id,
            bank_name = v_new_bank_name,
            customer_id = v_customer_id,
            updated_at = now(),
            updated_by = v_member_id
        WHERE id = v_existing_rcpt.id;

        UPDATE public.receipt_allocations
        SET amount = v_new_paid,
            updated_at = now(),
            updated_by = v_member_id
        WHERE receipt_id = v_existing_rcpt.id AND invoice_id = v_inv.id;
      ELSE
        -- Paid amount reset to 0: soft delete receipt
        UPDATE public.receipts
        SET deleted_at = now(),
            deleted_by = v_member_id
        WHERE id = v_existing_rcpt.id;

        DELETE FROM public.receipt_allocations
        WHERE receipt_id = v_existing_rcpt.id AND invoice_id = v_inv.id;
      END IF;
      v_final_paid := v_new_paid;
    ELSE
      -- No existing receipt; create if paid > 0
      IF v_new_paid > 0 THEN
        v_receipt_number := public.next_receipt_number(v_biz_id, v_inv.fy_label);
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
          v_inv.fy_label,
          v_invoice_date,
          v_customer_id,
          v_new_paid,
          v_new_mode,
          'INVOICE_PAYMENT',
          0,
          'Payment for bill #' || v_inv.number,
          v_new_bank_id,
          v_new_bank_name,
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
          v_inv.id,
          v_new_paid,
          v_member_id,
          v_member_id
        );
        v_final_paid := v_new_paid;
      END IF;
    END IF;
  ELSE
    v_final_paid := LEAST(v_inv.paid_amount, v_total);
  END IF;

  -- 5. Update Invoice
  UPDATE public.invoices
  SET
    invoice_date = v_invoice_date,
    due_date = v_due_date,
    customer_id = v_customer_id,
    party_name = v_party_name,
    party_mobile = v_party_mobile,
    subtotal = v_subtotal,
    discount_type = v_discount_type,
    discount_value = v_discount_value,
    discount_amount = v_discount_amount,
    total = v_total,
    paid_amount = v_final_paid,
    notes = v_notes,
    updated_at = now(),
    updated_by = v_member_id
  WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'id', v_inv.id,
    'number', v_inv.number,
    'total', v_total,
    'paid_amount', v_final_paid,
    'balance', v_total - v_final_paid,
    'status', 'ACTIVE'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_invoice(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_invoice(uuid, jsonb) TO authenticated;


-- ------------------------------------------------------------------------------
-- 7. Upgrade sync_service_steps_to_jobs: Sync all step updates to in-progress jobs
-- ------------------------------------------------------------------------------
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
  v_step_pos_arr int[];
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

  -- Array of valid positions currently in job_type_steps
  SELECT COALESCE(array_agg(position), ARRAY[]::int[])
  INTO v_step_pos_arr
  FROM public.job_type_steps
  WHERE service_id = p_service_id AND deleted_at IS NULL;

  -- Iterate through open/in-progress jobs for this service
  FOR v_job IN
    SELECT j.id
    FROM public.jobs j
    WHERE j.business_id = v_biz_id
      AND (j.service_id = p_service_id OR (j.service_id IS NULL AND LOWER(TRIM(j.job_type_name)) = LOWER(TRIM(v_service.name))))
      AND j.status = 'IN_PROGRESS'
      AND j.deleted_at IS NULL
  LOOP
    SELECT COUNT(*) INTO v_ticked_count
    FROM public.job_steps
    WHERE job_id = v_job.id AND ticked = true AND deleted_at IS NULL;

    -- Case 1: Service switched to NORMAL service (is_job_type = false)
    IF v_service.is_job_type = false THEN
      IF v_ticked_count = 0 THEN
        DELETE FROM public.job_steps WHERE job_id = v_job.id;
      ELSE
        DELETE FROM public.job_steps WHERE job_id = v_job.id AND ticked = false;
      END IF;

      UPDATE public.jobs
      SET service_id = p_service_id, job_type_name = v_service.name
      WHERE id = v_job.id;

      v_synced_jobs_count := v_synced_jobs_count + 1;

    -- Case 2: Service is a multi-step job (is_job_type = true)
    ELSE
      IF v_ticked_count = 0 THEN
        -- Completely replace with new steps cleanly
        DELETE FROM public.job_steps WHERE job_id = v_job.id;

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
      ELSE
        -- Some steps are ticked: intelligently sync!
        -- 1. Remove unticked steps whose position is no longer in definition
        DELETE FROM public.job_steps
        WHERE job_id = v_job.id
          AND ticked = false
          AND position != ALL(v_step_pos_arr);

        -- 2. Update existing steps matching position
        FOR v_step IN
          SELECT position, name, whatsapp_message
          FROM public.job_type_steps
          WHERE service_id = p_service_id AND deleted_at IS NULL
          ORDER BY position ASC
        LOOP
          IF EXISTS (SELECT 1 FROM public.job_steps WHERE job_id = v_job.id AND position = v_step.position) THEN
            UPDATE public.job_steps
            SET name = v_step.name,
                whatsapp_message = v_step.whatsapp_message,
                updated_at = now(),
                updated_by = v_member_id
            WHERE job_id = v_job.id AND position = v_step.position;
          ELSE
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
          END IF;
        END LOOP;
      END IF;

      -- Update job snapshot fields to match updated service
      UPDATE public.jobs
      SET
        service_id = p_service_id,
        job_type_name = v_service.name,
        commission_percent = COALESCE(v_service.commission_percent, commission_percent)
      WHERE id = v_job.id;

      v_synced_jobs_count := v_synced_jobs_count + 1;
    END IF;
  END LOOP;

  RETURN v_synced_jobs_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.sync_service_steps_to_jobs(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sync_service_steps_to_jobs(uuid) TO authenticated;


-- ------------------------------------------------------------------------------
-- 8. Retroactive Data Cleanup: Fix existing orphan cancelled receipts & missing bank_account_id
-- ------------------------------------------------------------------------------

-- A. Soft-delete receipts created for bills that are currently CANCELLED
UPDATE public.receipts r
SET deleted_at = now(),
    notes = COALESCE(r.notes, '') || ' (Cancelled retroactively with cancelled bill)'
WHERE r.deleted_at IS NULL
  AND r.kind = 'INVOICE_PAYMENT'
  AND (
    r.notes LIKE 'Payment for bill %' OR r.notes LIKE 'Payment for %'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.receipt_allocations ra
    JOIN public.invoices i ON i.id = ra.invoice_id
    WHERE ra.receipt_id = r.id AND i.status = 'ACTIVE'
  );

-- B. Populate bank_account_id and bank_name on receipts where mode was online but bank was null
UPDATE public.receipts r
SET bank_account_id = (SELECT id FROM public.bank_accounts WHERE business_id = r.business_id AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1),
    bank_name = (SELECT bank_name FROM public.bank_accounts WHERE business_id = r.business_id AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1)
WHERE r.bank_account_id IS NULL
  AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE')
  AND EXISTS (SELECT 1 FROM public.bank_accounts WHERE business_id = r.business_id AND deleted_at IS NULL);
