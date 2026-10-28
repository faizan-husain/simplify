-- Migration 3: Billing Core (Invoices, Items, Receipts, Allocations, Jobs schema & create/update/cancel RPCs)

-- Receipts table
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  number text NOT NULL,
  fy_label text NOT NULL,
  receipt_date date NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE')),
  reference text,
  kind text NOT NULL DEFAULT 'INVOICE_PAYMENT' CHECK (kind IN ('INVOICE_PAYMENT', 'OTHER_INCOME')),
  income_category text,
  unallocated_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_receipts_business_date ON public.receipts(business_id, receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipts_business_customer ON public.receipts(business_id, customer_id);

CREATE OR REPLACE TRIGGER trg_receipts_audit
BEFORE INSERT OR UPDATE ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  number text NOT NULL,
  fy_label text NOT NULL,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  party_name text NOT NULL DEFAULT 'Walk-in',
  party_mobile text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'NONE' CHECK (discount_type IN ('NONE', 'FLAT', 'PERCENT')),
  discount_value numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  cancel_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_invoices_business_date ON public.invoices(business_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_business_status ON public.invoices(business_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_business_customer ON public.invoices(business_id, customer_id);

CREATE OR REPLACE TRIGGER trg_invoices_audit
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Invoice items table
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_job boolean NOT NULL DEFAULT false,
  applicant_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(business_id, invoice_id);

CREATE OR REPLACE TRIGGER trg_invoice_items_audit
BEFORE INSERT OR UPDATE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Receipt allocations table
CREATE TABLE IF NOT EXISTS public.receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_receipt_allocations_receipt ON public.receipt_allocations(business_id, receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_invoice ON public.receipt_allocations(business_id, invoice_id);

CREATE OR REPLACE TRIGGER trg_receipt_allocations_audit
BEFORE INSERT OR UPDATE ON public.receipt_allocations
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Jobs table
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id),
  job_type_name text NOT NULL,
  party_name text NOT NULL,
  party_mobile text,
  applicant_name text,
  amount numeric(14,2) NOT NULL,
  deadline_date date NOT NULL,
  assigned_staff_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  commission_percent numeric(5,2),
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_jobs_business_deadline ON public.jobs(business_id, deadline_date);
CREATE INDEX IF NOT EXISTS idx_jobs_business_status ON public.jobs(business_id, status);

CREATE OR REPLACE TRIGGER trg_jobs_audit
BEFORE INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Job steps table
CREATE TABLE IF NOT EXISTS public.job_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 1,
  name text NOT NULL,
  whatsapp_message text,
  ticked boolean NOT NULL DEFAULT false,
  ticked_at timestamptz,
  ticked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_job_steps_job ON public.job_steps(business_id, job_id);

CREATE OR REPLACE TRIGGER trg_job_steps_audit
BEFORE INSERT OR UPDATE ON public.job_steps
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Job step events table (audit log of ticks/unticks)
CREATE TABLE IF NOT EXISTS public.job_step_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_step_id uuid NOT NULL REFERENCES public.job_steps(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('TICK', 'UNTICK')),
  member_id uuid NOT NULL REFERENCES public.members(id),
  at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_job_step_events_step ON public.job_step_events(business_id, job_step_id);

-- Commission entries table
CREATE TABLE IF NOT EXISTS public.commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.members(id),
  base_amount numeric(14,2) NOT NULL,
  percent numeric(5,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING', 'EARNED', 'CANCELLED')),
  earned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_commission_entries_staff ON public.commission_entries(business_id, staff_id);

CREATE OR REPLACE TRIGGER trg_commission_entries_audit
BEFORE INSERT OR UPDATE ON public.commission_entries
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Enable RLS and FORCE RLS on all ledger-critical tables
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.receipt_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_allocations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.job_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_steps FORCE ROW LEVEL SECURITY;

ALTER TABLE public.job_step_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_step_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.commission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_entries FORCE ROW LEVEL SECURITY;

-- SELECT policies (NO client INSERT/UPDATE/DELETE policies - ledger critical per §6.1)
DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (
      (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
      OR created_by = (SELECT app.current_member_id())
    )
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS invoice_items_select ON public.invoice_items;
CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND (
          (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
          OR i.created_by = (SELECT app.current_member_id())
        )
    )
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS receipts_select ON public.receipts;
CREATE POLICY receipts_select ON public.receipts
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (
      (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
      OR created_by = (SELECT app.current_member_id())
    )
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS receipt_allocations_select ON public.receipt_allocations;
CREATE POLICY receipt_allocations_select ON public.receipt_allocations
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS jobs_select ON public.jobs;
CREATE POLICY jobs_select ON public.jobs
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS job_steps_select ON public.job_steps;
CREATE POLICY job_steps_select ON public.job_steps
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS job_step_events_select ON public.job_step_events;
CREATE POLICY job_step_events_select ON public.job_step_events
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS commission_entries_select ON public.commission_entries;
CREATE POLICY commission_entries_select ON public.commission_entries
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (
      (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
      OR staff_id = (SELECT app.current_member_id())
    )
    AND deleted_at IS NULL
  );

-- Sequence helper for numbering
CREATE OR REPLACE FUNCTION public.next_invoice_number(
  p_biz_id uuid,
  p_fy_label text,
  p_prefix text,
  p_numbering_mode text,
  p_start_number int
)
RETURNS text AS $$
DECLARE
  v_counter_fy text;
  v_last_num int;
  v_next_num int;
BEGIN
  IF p_numbering_mode = 'FY_RESET' THEN
    v_counter_fy := p_fy_label;
  ELSE
    v_counter_fy := 'ALL';
  END IF;

  -- Lock row or insert initial counter
  SELECT last_number INTO v_last_num
  FROM public.invoice_counters
  WHERE business_id = p_biz_id AND fy_label = v_counter_fy
  FOR UPDATE;

  IF NOT FOUND THEN
    v_next_num := GREATEST(p_start_number, 1);
    INSERT INTO public.invoice_counters (business_id, fy_label, last_number)
    VALUES (p_biz_id, v_counter_fy, v_next_num);
  ELSE
    v_next_num := GREATEST(v_last_num + 1, p_start_number);
    UPDATE public.invoice_counters
    SET last_number = v_next_num, updated_at = now()
    WHERE business_id = p_biz_id AND fy_label = v_counter_fy;
  END IF;

  IF p_numbering_mode = 'FY_RESET' THEN
    RETURN p_prefix || p_fy_label || '-' || LPAD(v_next_num::text, 4, '0');
  ELSE
    RETURN p_prefix || LPAD(v_next_num::text, 4, '0');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Next receipt number helper
CREATE OR REPLACE FUNCTION public.next_receipt_number(
  p_biz_id uuid,
  p_fy_label text
)
RETURNS text AS $$
DECLARE
  v_last_num int;
  v_next_num int;
BEGIN
  SELECT last_number INTO v_last_num
  FROM public.invoice_counters
  WHERE business_id = p_biz_id AND fy_label = 'RC_' || p_fy_label
  FOR UPDATE;

  IF NOT FOUND THEN
    v_next_num := 1;
    INSERT INTO public.invoice_counters (business_id, fy_label, last_number)
    VALUES (p_biz_id, 'RC_' || p_fy_label, 1);
  ELSE
    v_next_num := v_last_num + 1;
    UPDATE public.invoice_counters
    SET last_number = v_next_num, updated_at = now()
    WHERE business_id = p_biz_id AND fy_label = 'RC_' || p_fy_label;
  END IF;

  RETURN 'RC-' || p_fy_label || '-' || LPAD(v_next_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- RPC: create_invoice
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

-- RPC: update_invoice (only allowed if NO allocations exist per BR-8)
CREATE OR REPLACE FUNCTION public.update_invoice(
  id uuid,
  payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
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
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());

  SELECT * INTO v_inv FROM public.invoices WHERE invoices.id = update_invoice.id AND business_id = v_biz_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'INVOICE_CANCELLED' USING ERRCODE = 'P0001';
  END IF;

  -- Lock check: if any allocations exist, raise INVOICE_LOCKED per BR-8
  IF EXISTS (SELECT 1 FROM public.receipt_allocations WHERE invoice_id = v_inv.id) THEN
    RAISE EXCEPTION 'INVOICE_LOCKED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('invoice_id', v_inv.id)::text;
  END IF;

  -- Recalculate items
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

    -- Delete old items & unticked jobs
    DELETE FROM public.jobs WHERE invoice_id = v_inv.id;
    DELETE FROM public.invoice_items WHERE invoice_id = v_inv.id;

    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      v_item := v_items->i;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 1);
      v_rate := COALESCE((v_item->>'rate')::numeric, 0);
      v_line_amount := ROUND(v_qty * v_rate, 2);
      v_subtotal := v_subtotal + v_line_amount;

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
        (v_item->>'service_id')::uuid,
        v_item->>'description',
        v_qty,
        v_rate,
        v_line_amount,
        COALESCE((v_item->>'is_job')::boolean, false),
        v_item->>'applicant_name',
        v_member_id,
        v_member_id
      );
    END LOOP;
  ELSE
    v_subtotal := v_inv.subtotal;
  END IF;

  -- Discounts
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

  UPDATE public.invoices
  SET
    subtotal = v_subtotal,
    discount_type = v_discount_type,
    discount_value = v_discount_value,
    discount_amount = v_discount_amount,
    total = v_total,
    due_date = COALESCE((payload->>'due_date')::date, due_date),
    notes = COALESCE(payload->>'notes', notes),
    updated_at = now(),
    updated_by = v_member_id
  WHERE invoices.id = v_inv.id
  RETURNING to_jsonb(invoices.*) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_invoice(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_invoice(uuid, jsonb) TO authenticated;

-- RPC: cancel_invoice (BR-8)
CREATE OR REPLACE FUNCTION public.cancel_invoice(
  id uuid,
  reason text
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_inv public.invoices%ROWTYPE;
  v_alloc record;
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

  -- If invoice had payments but customer_id is NULL, require name/mobile so advance can be held (BR-8)
  IF v_inv.paid_amount > 0 AND v_inv.customer_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_ADVANCE' USING ERRCODE = 'P0001';
  END IF;

  -- Release allocations: increase each affected receipt's unallocated_amount (BR-8)
  FOR v_alloc IN
    SELECT receipt_id, amount
    FROM public.receipt_allocations
    WHERE invoice_id = v_inv.id
  LOOP
    UPDATE public.receipts
    SET unallocated_amount = unallocated_amount + v_alloc.amount,
        updated_at = now(),
        updated_by = v_member_id
    WHERE receipts.id = v_alloc.receipt_id;
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

REVOKE ALL ON FUNCTION public.cancel_invoice(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(uuid, text) TO authenticated;
