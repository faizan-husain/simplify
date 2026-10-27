-- Migration 1: Core Schema, App Helpers, Tenancy & Roles, Business Registration
CREATE SCHEMA IF NOT EXISTS app;

-- Immutable Financial Year (FY) function (e.g. 2026-27 for 1 Apr 2026 to 31 Mar 2027)
CREATE OR REPLACE FUNCTION public.fy_label(p_date date)
RETURNS text AS $$
DECLARE
  v_year int;
  v_month int;
BEGIN
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;
  v_year := EXTRACT(YEAR FROM p_date)::int;
  v_month := EXTRACT(MONTH FROM p_date)::int;

  IF v_month >= 4 THEN
    RETURN v_year::text || '-' || LPAD(((v_year + 1) % 100)::text, 2, '0');
  ELSE
    RETURN (v_year - 1)::text || '-' || LPAD((v_year % 100)::text, 2, '0');
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Businesses table (no business_id column; its id IS the tenant id)
CREATE TABLE IF NOT EXISTS public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_name text NOT NULL,
  mobile text NOT NULL,
  whatsapp text,
  email text,
  address text,
  logo_path text,
  business_type text,
  upi_id text,
  invoice_prefix text NOT NULL DEFAULT 'INV-',
  invoice_start_number int NOT NULL DEFAULT 1,
  numbering_mode text NOT NULL DEFAULT 'CONTINUOUS' CHECK (numbering_mode IN ('CONTINUOUS', 'FY_RESET')),
  default_terms_days int NOT NULL DEFAULT 0,
  default_notes text,
  footer_text text,
  thermal_width int NOT NULL DEFAULT 58 CHECK (thermal_width IN (58, 80)),
  receipt_header text,
  receipt_footer text,
  job_management_enabled boolean NOT NULL DEFAULT false,
  yellow_days int NOT NULL DEFAULT 5,
  red_days int NOT NULL DEFAULT 3,
  commission_trigger text NOT NULL DEFAULT 'ON_COMPLETION' CHECK (commission_trigger IN ('ON_COMPLETION')),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  plan text NOT NULL DEFAULT 'FREE',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

-- Business secrets table (no client access at all)
CREATE TABLE IF NOT EXISTS public.business_secrets (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  privacy_pin_hash text
);

-- Members table
CREATE TABLE IF NOT EXISTS public.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  auth_user_id uuid UNIQUE,
  name text NOT NULL,
  mobile text NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER', 'ACCOUNTANT', 'STAFF')),
  can_login boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT uq_members_business_mobile UNIQUE (business_id, mobile)
);

CREATE INDEX IF NOT EXISTS idx_members_business_id ON public.members(business_id);
CREATE INDEX IF NOT EXISTS idx_members_auth_user_id ON public.members(auth_user_id);

-- Invoice counters table
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  fy_label text NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT uq_invoice_counters UNIQUE (business_id, fy_label)
);

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

-- Helper functions in schema 'app'
CREATE OR REPLACE FUNCTION app.current_member_id()
RETURNS uuid AS $$
  SELECT m.id
  FROM public.members m
  WHERE m.auth_user_id = auth.uid()
    AND m.active = true
    AND m.deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION app.current_business_id()
RETURNS uuid AS $$
  SELECT m.business_id
  FROM public.members m
  WHERE m.auth_user_id = auth.uid()
    AND m.active = true
    AND m.deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION app.current_role()
RETURNS text AS $$
  SELECT m.role
  FROM public.members m
  WHERE m.auth_user_id = auth.uid()
    AND m.active = true
    AND m.deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION app.today()
RETURNS date AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT b.timezone INTO v_tz
  FROM public.businesses b
  WHERE b.id = (SELECT app.current_business_id());

  IF v_tz IS NULL THEN
    v_tz := 'Asia/Kolkata';
  END IF;

  RETURN (now() AT TIME ZONE v_tz)::date;
EXCEPTION WHEN OTHERS THEN
  RETURN (now() AT TIME ZONE 'Asia/Kolkata')::date;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- Shared audit trigger function
CREATE OR REPLACE FUNCTION public.set_audit_fields()
RETURNS trigger AS $$
DECLARE
  v_member_id uuid;
BEGIN
  v_member_id := app.current_member_id();

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.created_by := COALESCE(NEW.created_by, v_member_id);
    NEW.updated_at := COALESCE(NEW.updated_at, now());
    NEW.updated_by := COALESCE(NEW.updated_by, v_member_id);
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(v_member_id, OLD.updated_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE TRIGGER trg_businesses_audit
BEFORE INSERT OR UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

CREATE OR REPLACE TRIGGER trg_members_audit
BEFORE INSERT OR UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Enable RLS on every table
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members FORCE ROW LEVEL SECURITY;

ALTER TABLE public.business_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_secrets FORCE ROW LEVEL SECURITY;

-- RLS policies for businesses
DROP POLICY IF EXISTS businesses_select_policy ON public.businesses;
CREATE POLICY businesses_select_policy ON public.businesses
  FOR SELECT
  USING (id = (SELECT app.current_business_id()) AND deleted_at IS NULL);

-- RLS policies for members
DROP POLICY IF EXISTS members_select_policy ON public.members;
CREATE POLICY members_select_policy ON public.members
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS members_update_policy ON public.members;
CREATE POLICY members_update_policy ON public.members
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

-- No client policies for business_secrets (purely accessed by SECURITY DEFINER functions)

-- Register Business RPC
CREATE OR REPLACE FUNCTION public.register_business(
  business_name text,
  owner_name text,
  mobile text
)
RETURNS jsonb AS $$
DECLARE
  v_auth_uid uuid;
  v_existing_member public.members%ROWTYPE;
  v_business_id uuid;
  v_member_id uuid;
  v_clean_mobile text;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Normalise mobile
  v_clean_mobile := REGEXP_REPLACE(mobile, '[^0-9]', '', 'g');
  IF LENGTH(v_clean_mobile) = 12 AND v_clean_mobile LIKE '91%' THEN
    v_clean_mobile := SUBSTRING(v_clean_mobile FROM 3);
  ELSIF LENGTH(v_clean_mobile) = 11 AND v_clean_mobile LIKE '0%' THEN
    v_clean_mobile := SUBSTRING(v_clean_mobile FROM 2);
  END IF;

  -- Check if already registered
  SELECT * INTO v_existing_member
  FROM public.members
  WHERE auth_user_id = v_auth_uid
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'business_id', v_existing_member.business_id,
      'member_id', v_existing_member.id,
      'role', v_existing_member.role
    );
  END IF;

  -- 1. Create Business
  INSERT INTO public.businesses (name, owner_name, mobile)
  VALUES (TRIM(business_name), TRIM(owner_name), v_clean_mobile)
  RETURNING id INTO v_business_id;

  -- 2. Create Owner Member
  INSERT INTO public.members (
    business_id,
    auth_user_id,
    name,
    mobile,
    role,
    can_login,
    active
  )
  VALUES (
    v_business_id,
    v_auth_uid,
    TRIM(owner_name),
    v_clean_mobile,
    'OWNER',
    true,
    true
  )
  RETURNING id INTO v_member_id;

  -- 3. Initialize Invoice & Receipt Counters
  INSERT INTO public.invoice_counters (business_id, fy_label, last_number)
  VALUES
    (v_business_id, 'ALL', 0)
  ON CONFLICT DO NOTHING;

  -- 4. Seed default expense categories if table exists
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'expense_categories') THEN
    INSERT INTO public.expense_categories (business_id, name, system) VALUES
      (v_business_id, 'Rent', false),
      (v_business_id, 'Electricity', false),
      (v_business_id, 'Internet', false),
      (v_business_id, 'Salary', false),
      (v_business_id, 'Travel', false),
      (v_business_id, 'Marketing', false),
      (v_business_id, 'Software/Subscriptions', false),
      (v_business_id, 'Maintenance', false),
      (v_business_id, 'Office Supplies', false),
      (v_business_id, 'Other', false),
      (v_business_id, 'Salary / Commission', true),
      (v_business_id, 'Loan Interest', true)
    ON CONFLICT DO NOTHING;
  END IF;

  -- 5. Seed default WhatsApp templates if table exists
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'whatsapp_templates') THEN
    INSERT INTO public.whatsapp_templates (business_id, type, body) VALUES
      (v_business_id, 'INVOICE', 'Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}.'),
      (v_business_id, 'RECEIPT', 'Hello {customer_name}, received payment of {amount} for bill #{invoice_no}. Thank you! - {business_name}'),
      (v_business_id, 'REMINDER', 'Hello {customer_name}, reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'business_id', v_business_id,
    'member_id', v_member_id,
    'role', 'OWNER'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.register_business(text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.register_business(text, text, text) TO authenticated;

-- Update Business RPC
CREATE OR REPLACE FUNCTION public.update_business(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_updated public.businesses%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.businesses
  SET
    name = COALESCE(payload->>'name', name),
    owner_name = COALESCE(payload->>'owner_name', owner_name),
    mobile = COALESCE(payload->>'mobile', mobile),
    whatsapp = COALESCE(payload->>'whatsapp', whatsapp),
    email = COALESCE(payload->>'email', email),
    address = COALESCE(payload->>'address', address),
    logo_path = COALESCE(payload->>'logo_path', logo_path),
    business_type = COALESCE(payload->>'business_type', business_type),
    upi_id = COALESCE(payload->>'upi_id', upi_id),
    invoice_prefix = COALESCE(payload->>'invoice_prefix', invoice_prefix),
    invoice_start_number = COALESCE((payload->>'invoice_start_number')::int, invoice_start_number),
    numbering_mode = COALESCE(payload->>'numbering_mode', numbering_mode),
    default_terms_days = COALESCE((payload->>'default_terms_days')::int, default_terms_days),
    default_notes = COALESCE(payload->>'default_notes', default_notes),
    footer_text = COALESCE(payload->>'footer_text', footer_text),
    thermal_width = COALESCE((payload->>'thermal_width')::int, thermal_width),
    receipt_header = COALESCE(payload->>'receipt_header', receipt_header),
    receipt_footer = COALESCE(payload->>'receipt_footer', receipt_footer),
    job_management_enabled = COALESCE((payload->>'job_management_enabled')::boolean, job_management_enabled),
    yellow_days = COALESCE((payload->>'yellow_days')::int, yellow_days),
    red_days = COALESCE((payload->>'red_days')::int, red_days),
    timezone = COALESCE(payload->>'timezone', timezone)
  WHERE id = v_biz_id
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_business(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_business(jsonb) TO authenticated;

-- Privacy PIN RPCs
CREATE OR REPLACE FUNCTION public.set_privacy_pin(pin text)
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

  IF LENGTH(pin) <> 4 OR pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'INVALID_PIN_FORMAT' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.business_secrets (business_id, privacy_pin_hash)
  VALUES (v_biz_id, public.crypt(pin, public.gen_salt('bf')))
  ON CONFLICT (business_id)
  DO UPDATE SET privacy_pin_hash = public.crypt(pin, public.gen_salt('bf'));

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.set_privacy_pin(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_privacy_pin(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_privacy_pin(pin text)
RETURNS boolean AS $$
DECLARE
  v_biz_id uuid;
  v_hash text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  IF v_biz_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT privacy_pin_hash INTO v_hash
  FROM public.business_secrets
  WHERE business_id = v_biz_id;

  IF v_hash IS NULL THEN
    -- If no PIN is set, verification always succeeds per BR-17
    RETURN true;
  END IF;

  RETURN (v_hash = public.crypt(pin, v_hash));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.verify_privacy_pin(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_privacy_pin(text) TO authenticated;
