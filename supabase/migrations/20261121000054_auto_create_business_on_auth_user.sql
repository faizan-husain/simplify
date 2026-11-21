-- Migration 54: Auto-create business and owner member when a new user signs up or is created in auth.users
-- This ensures that any user created via Supabase Auth Dashboard or SignUp gets an active business & member profile.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_biz_id uuid;
  v_clean_mobile text;
  v_name text;
  v_existing_member_id uuid;
BEGIN
  -- Check if member already exists for this auth user
  SELECT id INTO v_existing_member_id
  FROM public.members
  WHERE auth_user_id = NEW.id;

  IF v_existing_member_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Skip automated test users
  IF NEW.email LIKE '%@simplify.local' OR NEW.email LIKE '%@teamtest.com' THEN
    RETURN NEW;
  END IF;

  -- Derive owner name
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'owner_name',
    NULLIF(SPLIT_PART(NEW.email, '@', 1), ''),
    'Business Owner'
  );

  -- Derive mobile
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
  VALUES (v_biz_id, public.crypt('1234', public.gen_salt('bf')))
  ON CONFLICT (business_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Trigger for any new user in auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also immediately process existing users in auth.users who don't have a member profile yet
DO $$
DECLARE
  r RECORD;
  v_biz_id uuid;
  v_clean_mobile text;
  v_name text;
BEGIN
  FOR r IN 
    SELECT u.id, u.email, u.phone, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN public.members m ON m.auth_user_id = u.id
    WHERE m.id IS NULL
  LOOP
    v_name := COALESCE(
      r.raw_user_meta_data->>'name',
      r.raw_user_meta_data->>'owner_name',
      NULLIF(SPLIT_PART(r.email, '@', 1), ''),
      'Business Owner'
    );

    v_clean_mobile := COALESCE(
      NULLIF(REGEXP_REPLACE(COALESCE(r.phone, r.raw_user_meta_data->>'mobile', ''), '[^0-9]', '', 'g'), ''),
      '9876543210'
    );
    IF LENGTH(v_clean_mobile) = 12 AND v_clean_mobile LIKE '91%' THEN
      v_clean_mobile := SUBSTRING(v_clean_mobile FROM 3);
    ELSIF LENGTH(v_clean_mobile) = 11 AND v_clean_mobile LIKE '0%' THEN
      v_clean_mobile := SUBSTRING(v_clean_mobile FROM 2);
    END IF;

    -- Create Business
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
      r.email,
      true,
      'PRO',
      'Asia/Kolkata'
    )
    RETURNING id INTO v_biz_id;

    -- Create Owner Member
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
      r.id,
      v_name,
      r.email,
      v_clean_mobile,
      'OWNER',
      true,
      true
    );

    -- Initialize Invoice counter
    INSERT INTO public.invoice_counters (business_id, fy_label, last_number)
    VALUES (v_biz_id, 'ALL', 0)
    ON CONFLICT DO NOTHING;

    -- Seed Default Categories
    INSERT INTO public.expense_categories (business_id, name, system) VALUES
      (v_biz_id, 'Rent', false),
      (v_biz_id, 'Electricity', false),
      (v_biz_id, 'Internet & Utilities', false),
      (v_biz_id, 'Salary', false),
      (v_biz_id, 'Paper & Supplies', false),
      (v_biz_id, 'Salary / Commission', true),
      (v_biz_id, 'Loan Interest', true)
    ON CONFLICT DO NOTHING;

    -- Seed Default WhatsApp templates
    INSERT INTO public.whatsapp_templates (business_id, type, body) VALUES
      (v_biz_id, 'INVOICE', 'Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}.'),
      (v_biz_id, 'RECEIPT', 'Hello {customer_name}, received payment of {amount} for bill #{invoice_no}. Thank you! - {business_name}'),
      (v_biz_id, 'REMINDER', 'Hello {customer_name}, reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}')
    ON CONFLICT DO NOTHING;

    -- Seed Privacy PIN '1234'
    INSERT INTO public.business_secrets (business_id, privacy_pin_hash)
    VALUES (v_biz_id, public.crypt('1234', public.gen_salt('bf')))
    ON CONFLICT (business_id) DO NOTHING;

  END LOOP;
END $$;
