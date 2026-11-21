-- Migration: 20261113000050_fix_create_team_member_validation.sql
-- Fixes create_team_member role validation and member duplicate email check

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

  -- Application supports strictly OWNER and STAFF roles. Team members created must be STAFF.
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
    jsonb_build_object('name', v_clean_name, 'role', v_role),
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

  RETURN v_member_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, text) TO authenticated;

