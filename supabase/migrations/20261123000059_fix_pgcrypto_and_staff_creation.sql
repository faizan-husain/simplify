-- ==============================================================================
-- MIGRATION: 20261123000059_fix_pgcrypto_and_staff_creation.sql
-- DESCRIPTION: 1. Fix "function public.gen_salt(unknown) does not exist" in Supabase
--                 Cloud by exposing pgcrypto wrappers in public schema.
--              2. Fix "there is no unique or exclusion constraint matching the
--                 ON CONFLICT specification" on auth.users by using defensive
--                 SELECT-before-INSERT/UPDATE without depending on ON CONFLICT.
-- ==============================================================================

-- 1. Ensure extensions schema and pgcrypto extension exist
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Bidirectional wrappers between public and extensions for pgcrypto
DO $$
BEGIN
  -- Scenario A: pgcrypto is installed in extensions (Supabase Cloud default)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'extensions' AND p.proname = 'gen_salt') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'gen_salt') THEN
      EXECUTE $wrapper$
        CREATE OR REPLACE FUNCTION public.gen_salt(text)
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$ SELECT extensions.gen_salt($1); $fn$;

        CREATE OR REPLACE FUNCTION public.gen_salt(text, integer)
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$ SELECT extensions.gen_salt($1, $2); $fn$;

        CREATE OR REPLACE FUNCTION public.crypt(text, text)
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$ SELECT extensions.crypt($1, $2); $fn$;

        GRANT EXECUTE ON FUNCTION public.gen_salt(text) TO authenticated, service_role, postgres, anon;
        GRANT EXECUTE ON FUNCTION public.gen_salt(text, integer) TO authenticated, service_role, postgres, anon;
        GRANT EXECUTE ON FUNCTION public.crypt(text, text) TO authenticated, service_role, postgres, anon;
      $wrapper$;
    END IF;
  -- Scenario B: pgcrypto is installed in public, expose to extensions
  ELSIF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'gen_salt') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'extensions' AND p.proname = 'gen_salt') THEN
      EXECUTE $wrapper$
        CREATE OR REPLACE FUNCTION extensions.gen_salt(text)
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$ SELECT public.gen_salt($1); $fn$;

        CREATE OR REPLACE FUNCTION extensions.gen_salt(text, integer)
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$ SELECT public.gen_salt($1, $2); $fn$;

        CREATE OR REPLACE FUNCTION extensions.crypt(text, text)
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$ SELECT public.crypt($1, $2); $fn$;

        GRANT EXECUTE ON FUNCTION extensions.gen_salt(text) TO authenticated, service_role, postgres, anon;
        GRANT EXECUTE ON FUNCTION extensions.gen_salt(text, integer) TO authenticated, service_role, postgres, anon;
        GRANT EXECUTE ON FUNCTION extensions.crypt(text, text) TO authenticated, service_role, postgres, anon;
      $wrapper$;
    END IF;
  END IF;
END $$;

-- 3. Robust app-level password hashing helper that automatically finds pgcrypto
CREATE OR REPLACE FUNCTION app.hash_password(p_password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'extensions' AND p.proname = 'crypt') THEN
    RETURN extensions.crypt(TRIM(p_password), extensions.gen_salt('bf'));
  ELSIF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'crypt') THEN
    RETURN public.crypt(TRIM(p_password), public.gen_salt('bf'));
  ELSE
    RETURN crypt(TRIM(p_password), gen_salt('bf'));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hash_password(text) TO authenticated, service_role, postgres;


-- 4. Upgrade create_team_member: No ON CONFLICT constraint dependency, schema-safe
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
SET search_path = public, extensions, pg_temp
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
  v_hashed_password text;
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

  -- Check if an active member with this email already exists in this business
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

    -- Check if an active member already has this mobile
    IF EXISTS (
      SELECT 1 FROM public.members
      WHERE business_id = v_biz_id AND mobile = v_clean_mobile AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'MOBILE_EXISTS' USING ERRCODE = 'P0001', DETAIL = 'A member with this mobile number already exists';
    END IF;
  ELSE
    -- If mobile is omitted, generate unique dummy placeholder to satisfy NOT NULL + UNIQUE (business_id, mobile)
    v_clean_mobile := '00' || lpad(floor(random() * 100000000)::text, 8, '0');
  END IF;

  -- Compute password hash safely
  v_hashed_password := app.hash_password(p_password);

  -- 1. Check if auth user already exists in auth.users by email (Eliminates ON CONFLICT constraint error)
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE lower(email) = v_clean_email
  LIMIT 1;

  IF v_auth_user_id IS NOT NULL THEN
    -- Update existing auth user password and metadata
    UPDATE auth.users
    SET encrypted_password = v_hashed_password,
        raw_user_meta_data = jsonb_build_object('name', v_clean_name, 'role', 'STAFF', 'business_id', v_biz_id),
        updated_at = now()
    WHERE id = v_auth_user_id;
  ELSE
    -- Insert new auth user
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
      v_hashed_password,
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'STAFF'),
      jsonb_build_object('name', v_clean_name, 'role', 'STAFF', 'business_id', v_biz_id),
      now(),
      now()
    );
  END IF;

  -- 2. Check if member already exists in public.members (re-activating soft-deleted member or linking existing)
  SELECT id INTO v_member_id
  FROM public.members
  WHERE auth_user_id = v_auth_user_id
     OR (business_id = v_biz_id AND lower(email) = v_clean_email)
     OR (business_id = v_biz_id AND mobile = v_clean_mobile)
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.members
    SET business_id = v_biz_id,
        auth_user_id = v_auth_user_id,
        role = v_role,
        name = v_clean_name,
        email = v_clean_email,
        mobile = v_clean_mobile,
        can_login = true,
        active = true,
        deleted_at = NULL,
        deleted_by = NULL,
        updated_at = now(),
        updated_by = v_caller_id
    WHERE id = v_member_id;
  ELSE
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
    RETURNING id INTO v_member_id;
  END IF;

  RETURN v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_team_member(text, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, text) TO authenticated;


-- 5. Upgrade update_team_member
CREATE OR REPLACE FUNCTION public.update_team_member(
  p_member_id uuid,
  p_name text,
  p_mobile text DEFAULT NULL,
  p_role text DEFAULT 'STAFF',
  p_active boolean DEFAULT true,
  p_new_password text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_biz_id uuid;
  v_caller_role text;
  v_caller_id uuid;
  v_target_role text;
  v_target_auth_id uuid;
  v_role text;
  v_clean_mobile text;
BEGIN
  v_biz_id := app.current_business_id();
  v_caller_role := app.current_role();
  v_caller_id := app.current_member_id();

  IF v_biz_id IS NULL OR v_caller_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only owners can update team members';
  END IF;

  SELECT role, auth_user_id INTO v_target_role, v_target_auth_id
  FROM public.members
  WHERE id = p_member_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_target_role = 'OWNER' THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_OWNER' USING ERRCODE = 'P0001', DETAIL = 'Owner account cannot be modified via team management';
  END IF;

  v_role := upper(trim(COALESCE(p_role, 'STAFF')));
  IF v_role <> 'STAFF' THEN
    RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE = 'P0001', DETAIL = 'Only STAFF role is supported';
  END IF;

  v_clean_mobile := NULL;
  IF p_mobile IS NOT NULL AND trim(p_mobile) <> '' THEN
    v_clean_mobile := regexp_replace(p_mobile, '\D', '', 'g');
    IF length(v_clean_mobile) >= 10 THEN
      v_clean_mobile := right(v_clean_mobile, 10);
    END IF;
  END IF;

  UPDATE public.members
  SET name = trim(p_name),
      mobile = v_clean_mobile,
      role = v_role,
      active = p_active,
      updated_at = now(),
      updated_by = v_caller_id
  WHERE id = p_member_id AND business_id = v_biz_id;

  -- Update password if requested
  IF p_new_password IS NOT NULL AND trim(p_new_password) <> '' THEN
    IF length(trim(p_new_password)) < 6 THEN
      RAISE EXCEPTION 'PASSWORD_TOO_SHORT' USING ERRCODE = 'P0001';
    END IF;

    IF v_target_auth_id IS NOT NULL THEN
      UPDATE auth.users
      SET encrypted_password = app.hash_password(p_new_password),
          updated_at = now()
      WHERE id = v_target_auth_id;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, text) TO authenticated;


-- 6. Upgrade update_my_profile
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_name text DEFAULT NULL,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_auth_id uuid;
  v_biz_id uuid;
  v_updated_name text;
BEGIN
  v_caller_id := app.current_member_id();
  v_biz_id := app.current_business_id();
  v_auth_id := auth.uid();

  IF v_caller_id IS NULL OR v_biz_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501', DETAIL = 'No active member profile found';
  END IF;

  -- 1. Update Name if provided
  IF p_name IS NOT NULL AND trim(p_name) <> '' THEN
    v_updated_name := trim(p_name);
    IF length(v_updated_name) < 2 THEN
      RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = 'P0001', DETAIL = 'Name must be at least 2 characters';
    END IF;

    UPDATE public.members
    SET name = v_updated_name,
        updated_at = now(),
        updated_by = v_caller_id
    WHERE id = v_caller_id AND business_id = v_biz_id;
  ELSE
    SELECT name INTO v_updated_name FROM public.members WHERE id = v_caller_id;
  END IF;

  -- 2. Update Password if provided
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    IF length(trim(p_password)) < 6 THEN
      RAISE EXCEPTION 'PASSWORD_TOO_SHORT' USING ERRCODE = 'P0001', DETAIL = 'Password must be at least 6 characters';
    END IF;

    IF v_auth_id IS NOT NULL THEN
      UPDATE auth.users
      SET encrypted_password = app.hash_password(p_password),
          updated_at = now()
      WHERE id = v_auth_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'member_id', v_caller_id,
    'name', v_updated_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_my_profile(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated;


-- 7. Upgrade set_privacy_pin and verify_privacy_pin
CREATE OR REPLACE FUNCTION public.set_privacy_pin(pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
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
  VALUES (v_biz_id, app.hash_password(pin))
  ON CONFLICT (business_id)
  DO UPDATE SET privacy_pin_hash = app.hash_password(pin);

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_privacy_pin(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_privacy_pin(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.verify_privacy_pin(pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_biz_id uuid;
  v_hash text;
  v_computed text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  IF v_biz_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT privacy_pin_hash INTO v_hash
  FROM public.business_secrets
  WHERE business_id = v_biz_id;

  IF v_hash IS NULL THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'extensions' AND p.proname = 'crypt') THEN
    v_computed := extensions.crypt(pin, v_hash);
  ELSE
    v_computed := public.crypt(pin, v_hash);
  END IF;

  RETURN (v_hash = v_computed);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_privacy_pin(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_privacy_pin(text) TO authenticated;
