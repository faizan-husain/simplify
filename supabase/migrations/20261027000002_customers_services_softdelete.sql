-- Migration 2: Customers, Services, Job Type Steps, and Soft Delete / Mobile check RPCs

-- Customers table
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'REGULAR' CHECK (type IN ('REGULAR', 'WALK_IN')),
  name text NOT NULL,
  mobile text,
  whatsapp text,
  email text,
  address text,
  notes text,
  possible_duplicate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_customers_business_mobile ON public.customers(business_id, mobile);
CREATE INDEX IF NOT EXISTS idx_customers_business_name ON public.customers(business_id, name);

CREATE OR REPLACE TRIGGER trg_customers_audit
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Services table
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  default_rate numeric(14,2),
  category text,
  active boolean NOT NULL DEFAULT true,
  is_job_type boolean NOT NULL DEFAULT false,
  deadline_days int,
  commission_percent numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_services_business_active ON public.services(business_id, active);

CREATE OR REPLACE TRIGGER trg_services_audit
BEFORE INSERT OR UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Job Type Steps table
CREATE TABLE IF NOT EXISTS public.job_type_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 1,
  name text NOT NULL,
  whatsapp_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_job_type_steps_service ON public.job_type_steps(business_id, service_id);

CREATE OR REPLACE TRIGGER trg_job_type_steps_audit
BEFORE INSERT OR UPDATE ON public.job_type_steps
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Enable RLS and FORCE RLS on all three tables
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services FORCE ROW LEVEL SECURITY;

ALTER TABLE public.job_type_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_type_steps FORCE ROW LEVEL SECURITY;

-- Customers RLS policies
DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS customers_insert ON public.customers;
CREATE POLICY customers_insert ON public.customers
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT', 'STAFF')
  );

DROP POLICY IF EXISTS customers_update ON public.customers;
CREATE POLICY customers_update ON public.customers
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );

-- Services RLS policies
DROP POLICY IF EXISTS services_select ON public.services;
CREATE POLICY services_select ON public.services
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS services_insert ON public.services;
CREATE POLICY services_insert ON public.services
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
  );

DROP POLICY IF EXISTS services_update ON public.services;
CREATE POLICY services_update ON public.services
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
  );

-- Job Type Steps RLS policies
DROP POLICY IF EXISTS job_type_steps_select ON public.job_type_steps;
CREATE POLICY job_type_steps_select ON public.job_type_steps
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS job_type_steps_insert ON public.job_type_steps;
CREATE POLICY job_type_steps_insert ON public.job_type_steps
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
  );

DROP POLICY IF EXISTS job_type_steps_update ON public.job_type_steps;
CREATE POLICY job_type_steps_update ON public.job_type_steps
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
  );

DROP POLICY IF EXISTS job_type_steps_delete ON public.job_type_steps;
CREATE POLICY job_type_steps_delete ON public.job_type_steps
  FOR DELETE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
  );

-- Helper RPC: check_customer_mobile
CREATE OR REPLACE FUNCTION public.check_customer_mobile(
  mobile text,
  exclude_customer_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_clean_mobile text;
  v_matches jsonb;
  v_has_invoices boolean := false;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  IF v_biz_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices') INTO v_has_invoices;

  v_clean_mobile := REGEXP_REPLACE(mobile, '[^0-9]', '', 'g');
  IF LENGTH(v_clean_mobile) = 12 AND v_clean_mobile LIKE '91%' THEN
    v_clean_mobile := SUBSTRING(v_clean_mobile FROM 3);
  ELSIF LENGTH(v_clean_mobile) = 11 AND v_clean_mobile LIKE '0%' THEN
    v_clean_mobile := SUBSTRING(v_clean_mobile FROM 2);
  END IF;

  IF v_clean_mobile IS NULL OR LENGTH(v_clean_mobile) < 5 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Dynamic check for customer invoices if table exists
  IF v_has_invoices THEN
    EXECUTE 'SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          ''id'', c.id,
          ''name'', c.name,
          ''mobile'', c.mobile,
          ''type'', c.type,
          ''outstanding'', COALESCE(
            (SELECT SUM(i.total - i.paid_amount)
             FROM public.invoices i
             WHERE i.customer_id = c.id
               AND i.business_id = $1
               AND i.status = ''ACTIVE''
               AND i.deleted_at IS NULL),
            0
          )
        )
      ),
      ''[]''::jsonb
    )
    FROM public.customers c
    WHERE c.business_id = $1
      AND c.mobile = $2
      AND ($3 IS NULL OR c.id <> $3)
      AND c.deleted_at IS NULL'
    INTO v_matches
    USING v_biz_id, v_clean_mobile, exclude_customer_id;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'mobile', c.mobile,
          'type', c.type,
          'outstanding', 0
        )
      ),
      '[]'::jsonb
    )
    INTO v_matches
    FROM public.customers c
    WHERE c.business_id = v_biz_id
      AND c.mobile = v_clean_mobile
      AND (exclude_customer_id IS NULL OR c.id <> exclude_customer_id)
      AND c.deleted_at IS NULL;
  END IF;

  RETURN v_matches;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.check_customer_mobile(text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.check_customer_mobile(text, uuid) TO authenticated;

-- Helper RPC: soft_delete
CREATE OR REPLACE FUNCTION public.soft_delete(
  p_table text,
  p_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_member_id uuid;
  v_allowed boolean := false;
  v_has_invoices boolean;
  v_has_cust_invoices boolean := false;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Validate table
  IF p_table NOT IN ('customers', 'services', 'job_type_steps', 'vendors', 'payments', 'expense_categories', 'expenses', 'loans', 'receipts') THEN
    RAISE EXCEPTION 'INVALID_TABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Role checks per §5
  IF v_role = 'OWNER' THEN
    v_allowed := true;
  ELSIF v_role = 'ACCOUNTANT' THEN
    IF p_table IN ('customers', 'payments', 'expenses', 'loans') THEN
      v_allowed := true;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Customers cannot be deleted if they have invoices (BR-9)
  SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices') INTO v_has_invoices;
  IF p_table = 'customers' AND v_has_invoices THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.invoices WHERE customer_id = %L AND business_id = %L AND deleted_at IS NULL)', p_id, v_biz_id)
    INTO v_has_cust_invoices;
    IF v_has_cust_invoices THEN
      RAISE EXCEPTION 'CUSTOMER_HAS_INVOICES' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Expense categories: system categories cannot be deleted
  IF p_table = 'expense_categories' AND EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'expense_categories'
  ) THEN
    DECLARE
      v_is_system boolean := false;
    BEGIN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.expense_categories WHERE id = %L AND system = true)', p_id)
      INTO v_is_system;
      IF v_is_system THEN
        RAISE EXCEPTION 'SYSTEM_CATEGORY_CANNOT_BE_DELETED' USING ERRCODE = 'P0001';
      END IF;
    END;
  END IF;

  -- Execute soft delete
  EXECUTE format(
    'UPDATE public.%I SET deleted_at = now(), deleted_by = %L WHERE id = %L AND business_id = %L AND deleted_at IS NULL',
    p_table, v_member_id, p_id, v_biz_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.soft_delete(text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.soft_delete(text, uuid) TO authenticated;

-- Helper RPC: restore_record
CREATE OR REPLACE FUNCTION public.restore_record(
  p_table text,
  p_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF p_table NOT IN ('customers', 'services', 'job_type_steps', 'vendors', 'payments', 'expense_categories', 'expenses', 'loans', 'receipts') THEN
    RAISE EXCEPTION 'INVALID_TABLE' USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET deleted_at = NULL, deleted_by = NULL WHERE id = %L AND business_id = %L',
    p_table, p_id, v_biz_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.restore_record(text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.restore_record(text, uuid) TO authenticated;

-- Helper RPC: list_recently_deleted
CREATE OR REPLACE FUNCTION public.list_recently_deleted()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_agg(item) INTO v_result FROM (
    SELECT 'customers' as table_name, id, name as label, deleted_at
    FROM public.customers
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    UNION ALL
    SELECT 'services' as table_name, id, name as label, deleted_at
    FROM public.services
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  ) item;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.list_recently_deleted() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_recently_deleted() TO authenticated;

-- Helper RPC: frequent_services
CREATE OR REPLACE FUNCTION public.frequent_services()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  IF v_biz_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Return top active services
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'default_rate', s.default_rate,
        'is_job_type', s.is_job_type
      )
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT *
    FROM public.services
    WHERE business_id = v_biz_id
      AND active = true
      AND deleted_at IS NULL
    ORDER BY name ASC
    LIMIT 8
  ) s;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.frequent_services() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.frequent_services() TO authenticated;
