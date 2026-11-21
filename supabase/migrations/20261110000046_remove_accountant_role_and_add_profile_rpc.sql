-- ==============================================================================
-- Migration 46: Remove Accountant Role (Strictly OWNER & STAFF Only) & Add Profile RPC
-- ==============================================================================

-- 1. Migrate any existing ACCOUNTANT member to STAFF
UPDATE public.members
SET role = 'STAFF', updated_at = now()
WHERE role = 'ACCOUNTANT';

-- 2. Update role check constraint on public.members to only 'OWNER' and 'STAFF'
ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_role_check;
ALTER TABLE public.members ADD CONSTRAINT members_role_check CHECK (role IN ('OWNER', 'STAFF'));

-- 3. Update team management RPCs: ensure only STAFF can be added
DROP FUNCTION IF EXISTS public.create_team_member CASCADE;
DROP FUNCTION IF EXISTS public.update_team_member CASCADE;

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
  v_role text;
BEGIN
  v_biz_id := app.current_business_id();
  v_caller_role := app.current_role();
  v_caller_id := app.current_member_id();

  IF v_biz_id IS NULL OR v_caller_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only owners can add team members';
  END IF;

  IF trim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF trim(COALESCE(p_email, '')) = '' OR p_email NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'INVALID_EMAIL' USING ERRCODE = 'P0001';
  END IF;

  IF length(COALESCE(p_password, '')) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT' USING ERRCODE = 'P0001';
  END IF;

  -- Application supports strictly OWNER and STAFF roles only
  v_role := 'STAFF';

  v_clean_email := lower(trim(p_email));
  v_clean_mobile := NULL;
  IF p_mobile IS NOT NULL AND trim(p_mobile) <> '' THEN
    v_clean_mobile := regexp_replace(p_mobile, '\D', '', 'g');
    IF length(v_clean_mobile) >= 10 THEN
      v_clean_mobile := right(v_clean_mobile, 10);
    END IF;
  END IF;

  -- 1. Create or update auth.users
  v_auth_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    v_auth_user_id,
    v_clean_email,
    public.crypt(p_password, public.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', trim(p_name), 'role', v_role),
    now(),
    now()
  )
  ON CONFLICT (email) DO UPDATE
    SET encrypted_password = public.crypt(p_password, public.gen_salt('bf')),
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
    trim(p_name),
    v_clean_email,
    v_clean_mobile,
    v_role,
    true,
    true,
    v_caller_id,
    v_caller_id
  )
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, text) TO authenticated;

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
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_caller_role text;
  v_caller_id uuid;
  v_target_auth_id uuid;
  v_target_role text;
  v_clean_mobile text;
  v_role text;
BEGIN
  v_biz_id := app.current_business_id();
  v_caller_role := app.current_role();
  v_caller_id := app.current_member_id();

  IF v_biz_id IS NULL OR v_caller_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only owners can manage team members';
  END IF;

  SELECT auth_user_id, role INTO v_target_auth_id, v_target_role
  FROM public.members
  WHERE id = p_member_id AND business_id = v_biz_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_target_role = 'OWNER' THEN
    v_role := 'OWNER';
  ELSE
    v_role := 'STAFF';
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
      SET encrypted_password = public.crypt(trim(p_new_password), public.gen_salt('bf')),
          updated_at = now()
      WHERE id = v_target_auth_id;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, text) TO authenticated;

-- 4. New Self-Service Profile Update RPC for Staff & Owner:
-- Allows logged-in member to update their own Name and/or Password securely
DROP FUNCTION IF EXISTS public.update_my_profile CASCADE;
DROP FUNCTION IF EXISTS public.change_own_password CASCADE;

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_name text DEFAULT NULL,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
      SET encrypted_password = public.crypt(trim(p_password), public.gen_salt('bf')),
          updated_at = now()
      WHERE id = v_auth_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'member_id', v_caller_id,
    'name', v_updated_name,
    'message', 'Profile updated successfully'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_my_profile(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated;

-- Direct alias for change_own_password
CREATE OR REPLACE FUNCTION public.change_own_password(
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.update_my_profile(NULL, p_new_password);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.change_own_password(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.change_own_password(text) TO authenticated;
