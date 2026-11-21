-- Migration 28: Team Management, Accountant Role Enforcement, and Self-Service Password Change
-- Allows Owner to create Staff/Accountant via email + password
-- Accountant role strictly manages accounts (no jobs, no commission)
-- Staff work is tracked by creator/member without manual assignment dropdown
-- Any authenticated user can change their own password in Settings

-- 1. Schema updates for public.members
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.members ALTER COLUMN mobile DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_biz_email 
ON public.members(business_id, LOWER(email)) 
WHERE deleted_at IS NULL AND email IS NOT NULL;

-- 2. Update app auth helpers to support email
CREATE OR REPLACE FUNCTION app.current_member_id()
RETURNS uuid AS $$
  SELECT m.id
  FROM public.members m
  LEFT JOIN auth.users u ON u.id = auth.uid()
  WHERE (
    m.auth_user_id = auth.uid()
    OR (u.email IS NOT NULL AND m.email IS NOT NULL AND LOWER(u.email) = LOWER(m.email))
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com')
      )
    )
    OR (
      auth.uid() IS NULL
      AND (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL) = 1
      AND m.role = 'OWNER'
    )
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY 
    (m.auth_user_id = auth.uid()) DESC,
    (u.email IS NOT NULL AND m.email IS NOT NULL AND LOWER(u.email) = LOWER(m.email)) DESC,
    (m.role = 'OWNER') DESC,
    m.created_at ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION app.current_business_id()
RETURNS uuid AS $$
  SELECT m.business_id
  FROM public.members m
  LEFT JOIN auth.users u ON u.id = auth.uid()
  WHERE (
    m.auth_user_id = auth.uid()
    OR (u.email IS NOT NULL AND m.email IS NOT NULL AND LOWER(u.email) = LOWER(m.email))
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com')
      )
    )
    OR (
      auth.uid() IS NULL
      AND (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL) = 1
      AND m.role = 'OWNER'
    )
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY 
    (m.auth_user_id = auth.uid()) DESC,
    (u.email IS NOT NULL AND m.email IS NOT NULL AND LOWER(u.email) = LOWER(m.email)) DESC,
    (m.role = 'OWNER') DESC,
    m.created_at ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION app.current_role()
RETURNS text AS $$
  SELECT m.role
  FROM public.members m
  LEFT JOIN auth.users u ON u.id = auth.uid()
  WHERE (
    m.auth_user_id = auth.uid()
    OR (u.email IS NOT NULL AND m.email IS NOT NULL AND LOWER(u.email) = LOWER(m.email))
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com')
      )
    )
    OR (
      auth.uid() IS NULL
      AND (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL) = 1
      AND m.role = 'OWNER'
    )
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY 
    (m.auth_user_id = auth.uid()) DESC,
    (u.email IS NOT NULL AND m.email IS NOT NULL AND LOWER(u.email) = LOWER(m.email)) DESC,
    (m.role = 'OWNER') DESC,
    m.created_at ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';


-- 3. RPC: create_team_member
CREATE OR REPLACE FUNCTION public.create_team_member(
  p_name text,
  p_email text,
  p_password text,
  p_role text,
  p_mobile text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_caller_role text;
  v_clean_email text;
  v_clean_mobile text;
  v_clean_name text;
  v_user_id uuid;
  v_new_member record;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_caller_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_caller_role != 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can add team members';
  END IF;

  v_clean_name := TRIM(COALESCE(p_name, ''));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'NAME_REQUIRED' USING ERRCODE = 'P0001', DETAIL = 'Name must be at least 2 characters';
  END IF;

  v_clean_email := LOWER(TRIM(COALESCE(p_email, '')));
  IF v_clean_email = '' OR v_clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL' USING ERRCODE = 'P0001', DETAIL = 'A valid email address is required';
  END IF;

  IF p_password IS NULL OR length(TRIM(p_password)) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT' USING ERRCODE = 'P0001', DETAIL = 'Password must be at least 6 characters';
  END IF;

  IF UPPER(p_role) NOT IN ('STAFF', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE = 'P0001', DETAIL = 'Role must be STAFF or ACCOUNTANT';
  END IF;

  v_clean_mobile := NULLIF(TRIM(COALESCE(p_mobile, '')), '');
  IF v_clean_mobile IS NOT NULL THEN
    v_clean_mobile := REGEXP_REPLACE(v_clean_mobile, '\D', '', 'g');
    IF length(v_clean_mobile) >= 10 THEN
      v_clean_mobile := RIGHT(v_clean_mobile, 10);
    END IF;
  END IF;

  -- Check if member email already exists in this business
  IF EXISTS (
    SELECT 1 FROM public.members 
    WHERE business_id = v_biz_id AND LOWER(email) = v_clean_email AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'MEMBER_EXISTS' USING ERRCODE = 'P0001', DETAIL = 'A member with this email already exists';
  END IF;

  -- Find or create user in auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = v_clean_email LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    -- Update existing auth user password
    UPDATE auth.users
    SET encrypted_password = public.crypt(TRIM(p_password), public.gen_salt('bf')),
        updated_at = now()
    WHERE id = v_user_id;
  ELSE
    v_user_id := gen_random_uuid();
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
      v_user_id,
      v_clean_email,
      public.crypt(TRIM(p_password), public.gen_salt('bf')),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('name', v_clean_name, 'role', UPPER(p_role)),
      now(),
      now()
    );
  END IF;

  -- Insert member record
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
    v_user_id,
    v_clean_name,
    v_clean_email,
    COALESCE(v_clean_mobile, ''),
    UPPER(p_role),
    true,
    true,
    v_member_id,
    v_member_id
  )
  RETURNING * INTO v_new_member;

  RETURN jsonb_build_object(
    'success', true,
    'member_id', v_new_member.id,
    'name', v_new_member.name,
    'email', v_new_member.email,
    'role', v_new_member.role,
    'active', v_new_member.active
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'auth';

REVOKE ALL ON FUNCTION public.create_team_member(text, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, text) TO authenticated;


-- 4. RPC: update_team_member
CREATE OR REPLACE FUNCTION public.update_team_member(
  p_member_id uuid,
  p_name text,
  p_mobile text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_new_password text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_caller_id uuid;
  v_caller_role text;
  v_target record;
  v_clean_name text;
  v_clean_mobile text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_caller_id := (SELECT app.current_member_id());
  v_caller_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_caller_role != 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can manage team members';
  END IF;

  SELECT * INTO v_target
  FROM public.members
  WHERE id = p_member_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = 'Member not found';
  END IF;

  -- Protect Owner role and self-demotion
  IF v_target.role = 'OWNER' THEN
    IF (p_role IS NOT NULL AND UPPER(p_role) != 'OWNER') OR p_active = false THEN
      RAISE EXCEPTION 'CANNOT_MODIFY_OWNER_ROLE' USING ERRCODE = 'P0001', DETAIL = 'Cannot change Owner role or deactivate Owner';
    END IF;
  ELSE
    IF p_role IS NOT NULL AND UPPER(p_role) NOT IN ('STAFF', 'ACCOUNTANT') THEN
      RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE = 'P0001', DETAIL = 'Role must be STAFF or ACCOUNTANT';
    END IF;
  END IF;

  v_clean_name := TRIM(COALESCE(p_name, v_target.name));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'NAME_REQUIRED' USING ERRCODE = 'P0001', DETAIL = 'Name must be at least 2 characters';
  END IF;

  IF p_mobile IS NOT NULL THEN
    v_clean_mobile := REGEXP_REPLACE(p_mobile, '\D', '', 'g');
    IF length(v_clean_mobile) >= 10 THEN
      v_clean_mobile := RIGHT(v_clean_mobile, 10);
    ELSE
      v_clean_mobile := p_mobile;
    END IF;
  ELSE
    v_clean_mobile := v_target.mobile;
  END IF;

  UPDATE public.members
  SET name = v_clean_name,
      mobile = COALESCE(v_clean_mobile, ''),
      role = COALESCE(UPPER(p_role), v_target.role),
      active = COALESCE(p_active, v_target.active),
      updated_at = now(),
      updated_by = v_caller_id
  WHERE id = p_member_id;

  -- Optional Password Reset by Owner
  IF p_new_password IS NOT NULL AND TRIM(p_new_password) != '' THEN
    IF length(TRIM(p_new_password)) < 6 THEN
      RAISE EXCEPTION 'PASSWORD_TOO_SHORT' USING ERRCODE = 'P0001', DETAIL = 'Password must be at least 6 characters';
    END IF;

    IF v_target.auth_user_id IS NOT NULL THEN
      UPDATE auth.users
      SET encrypted_password = public.crypt(TRIM(p_new_password), public.gen_salt('bf')),
          updated_at = now()
      WHERE id = v_target.auth_user_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'member_id', p_member_id,
    'name', v_clean_name,
    'role', COALESCE(UPPER(p_role), v_target.role),
    'active', COALESCE(p_active, v_target.active)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'auth';

REVOKE ALL ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, text) TO authenticated;


-- 5. RPC: delete_team_member
CREATE OR REPLACE FUNCTION public.delete_team_member(
  p_member_id uuid
)
RETURNS boolean AS $$
DECLARE
  v_biz_id uuid;
  v_caller_id uuid;
  v_caller_role text;
  v_target record;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_caller_id := (SELECT app.current_member_id());
  v_caller_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_caller_role != 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can delete team members';
  END IF;

  SELECT * INTO v_target
  FROM public.members
  WHERE id = p_member_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = 'Member not found';
  END IF;

  IF v_target.id = v_caller_id OR v_target.role = 'OWNER' THEN
    RAISE EXCEPTION 'CANNOT_DELETE_OWNER' USING ERRCODE = 'P0001', DETAIL = 'Cannot delete the Owner';
  END IF;

  UPDATE public.members
  SET deleted_at = now(),
      deleted_by = v_caller_id,
      active = false,
      updated_at = now()
  WHERE id = p_member_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'auth';

REVOKE ALL ON FUNCTION public.delete_team_member(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_team_member(uuid) TO authenticated;


-- 6. RPC: change_own_password (Self-service for any user)
CREATE OR REPLACE FUNCTION public.change_own_password(
  p_new_password text
)
RETURNS boolean AS $$
DECLARE
  v_uid uuid;
  v_member_id uuid;
BEGIN
  v_uid := auth.uid();
  v_member_id := (SELECT app.current_member_id());

  IF v_uid IS NULL AND v_member_id IS NOT NULL THEN
    SELECT auth_user_id INTO v_uid FROM public.members WHERE id = v_member_id;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501', DETAIL = 'Authentication required';
  END IF;

  IF p_new_password IS NULL OR length(TRIM(p_new_password)) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT' USING ERRCODE = 'P0001', DETAIL = 'Password must be at least 6 characters';
  END IF;

  UPDATE auth.users
  SET encrypted_password = public.crypt(TRIM(p_new_password), public.gen_salt('bf')),
      updated_at = now()
  WHERE id = v_uid;

  IF NOT FOUND THEN
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
      v_uid,
      COALESCE((SELECT email FROM public.members WHERE id = v_member_id), 'user@simplify.local'),
      public.crypt(TRIM(p_new_password), public.gen_salt('bf')),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      encrypted_password = public.crypt(TRIM(p_new_password), public.gen_salt('bf')),
      updated_at = now();
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'auth';

REVOKE ALL ON FUNCTION public.change_own_password(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.change_own_password(text) TO authenticated;


-- 7. RPC: list_team_members
CREATE OR REPLACE FUNCTION public.list_team_members()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_members jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role != 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can view team members';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'email', m.email,
        'mobile', m.mobile,
        'role', m.role,
        'active', m.active,
        'can_login', m.can_login,
        'has_auth_user', (m.auth_user_id IS NOT NULL),
        'created_at', m.created_at
      )
      ORDER BY 
        CASE WHEN m.role = 'OWNER' THEN 1 WHEN m.role = 'ACCOUNTANT' THEN 2 ELSE 3 END,
        m.name ASC
    ),
    '[]'::jsonb
  )
  INTO v_members
  FROM public.members m
  WHERE m.business_id = v_biz_id AND m.deleted_at IS NULL;

  RETURN v_members;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.list_team_members() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_team_members() TO authenticated;


-- 8. Restrict Accountant from Job Management and Commission functions
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
  v_caller_id uuid;
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
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Accountants do not have access to job management';
  END IF;

  SELECT COALESCE(red_days, 3), COALESCE(yellow_days, 5)
  INTO v_red_days, v_yellow_days
  FROM public.businesses
  WHERE id = v_biz_id;

  -- Compute tab counts (Staff only sees their own work counts)
  SELECT
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS'),
    COUNT(*) FILTER (WHERE j.status = 'COMPLETED'),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) < 0),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) >= 0 AND (j.deadline_date - v_today) <= v_red_days)
  INTO
    v_count_current,
    v_count_completed,
    v_count_due,
    v_count_yellow,
    v_count_red
  FROM public.jobs j
  WHERE j.business_id = v_biz_id 
    AND j.deleted_at IS NULL
    AND (v_role = 'OWNER' OR j.assigned_staff_id = v_caller_id OR j.created_by = v_caller_id);

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
        WHEN (j.deadline_date - v_today) < 0 THEN 'LATE'
        WHEN (j.deadline_date - v_today) >= 0 AND (j.deadline_date - v_today) <= v_red_days THEN 'RED'
        WHEN (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days THEN 'YELLOW'
        ELSE 'NORMAL'
      END AS deadline_bucket
    FROM public.jobs j
    JOIN public.invoices i ON i.id = j.invoice_id
    LEFT JOIN public.members m ON m.id = j.assigned_staff_id
    LEFT JOIN job_steps_agg jsa ON jsa.job_id = j.id
    WHERE j.business_id = v_biz_id
      AND j.deleted_at IS NULL
      AND (v_role = 'OWNER' OR j.assigned_staff_id = v_caller_id OR j.created_by = v_caller_id)
      AND (
        p_service_id IS NULL 
        OR j.service_id = p_service_id 
        OR j.job_type_name = (SELECT name FROM public.services WHERE id = p_service_id)
      )
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
          WHEN 'DUE' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) < 0
          WHEN 'LATE' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) < 0
          WHEN 'YELLOW' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days
          WHEN 'RED' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) >= 0 AND (j.deadline_date - v_today) <= v_red_days
          ELSE j.status = 'IN_PROGRESS'
        END
      )
    ORDER BY
      CASE UPPER(p_tab)
        WHEN 'COMPLETED' THEN j.completed_at
        ELSE NULL
      END DESC NULLS LAST,
      CASE 
        WHEN UPPER(p_sort) = 'PROGRESS' 
        THEN COALESCE(jsa.ticked_steps, 0)
      END DESC NULLS LAST,
      CASE 
        WHEN UPPER(p_sort) = 'PROGRESS' 
        THEN (COALESCE(jsa.ticked_steps, 0)::numeric / GREATEST(1, jsa.total_steps)::numeric) 
      END DESC NULLS LAST,
      CASE 
        WHEN UPPER(p_sort) = 'URGENT' OR (UPPER(p_tab) IN ('DUE', 'RED', 'YELLOW') AND UPPER(p_sort) != 'PROGRESS')
        THEN (j.deadline_date - v_today) 
      END ASC,
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


-- 9. Restrict staff_summary to Owner and Staff (exclude Accountant)
CREATE OR REPLACE FUNCTION public.staff_summary(
  p_staff_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_caller_id uuid;
  v_target_staff_id uuid;
  v_total_earned numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_balance_payable numeric(14,2) := 0;
  v_total_upcoming numeric(14,2) := 0;
  v_staff_list jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Accountants do not have access to staff commission';
  END IF;

  IF v_role = 'STAFF' THEN
    v_target_staff_id := v_caller_id;
  ELSE
    v_target_staff_id := p_staff_id;
  END IF;

  SELECT COALESCE(SUM(ce.amount), 0)
  INTO v_total_earned
  FROM public.commission_entries ce
  WHERE ce.business_id = v_biz_id
    AND ce.status = 'EARNED'
    AND (v_target_staff_id IS NULL OR ce.staff_id = v_target_staff_id)
    AND (p_from IS NULL OR ce.earned_at::date >= p_from)
    AND (p_to IS NULL OR ce.earned_at::date <= p_to);

  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_total_paid
  FROM public.staff_payouts sp
  WHERE sp.business_id = v_biz_id
    AND sp.deleted_at IS NULL
    AND (v_target_staff_id IS NULL OR sp.staff_id = v_target_staff_id)
    AND (p_from IS NULL OR sp.payout_date >= p_from)
    AND (p_to IS NULL OR sp.payout_date <= p_to);

  SELECT COALESCE(SUM(ce.amount), 0)
  INTO v_total_upcoming
  FROM public.commission_entries ce
  WHERE ce.business_id = v_biz_id
    AND ce.status = 'UPCOMING'
    AND (v_target_staff_id IS NULL OR ce.staff_id = v_target_staff_id);

  v_balance_payable := v_total_earned - v_total_paid;

  -- Breakdown: only members with role = 'STAFF'
  IF v_role = 'OWNER' AND v_target_staff_id IS NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'mobile', m.mobile,
          'email', m.email,
          'active', m.active,
          'total_earned', COALESCE(sub.earned, 0),
          'total_paid', COALESCE(sub.paid, 0),
          'balance', COALESCE(sub.earned, 0) - COALESCE(sub.paid, 0),
          'upcoming', COALESCE(sub.upcoming, 0)
        )
        ORDER BY m.name ASC
      ),
      '[]'::jsonb
    )
    INTO v_staff_list
    FROM public.members m
    LEFT JOIN LATERAL (
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM public.commission_entries WHERE staff_id = m.id AND status = 'EARNED') AS earned,
        (SELECT COALESCE(SUM(amount), 0) FROM public.staff_payouts WHERE staff_id = m.id AND deleted_at IS NULL) AS paid,
        (SELECT COALESCE(SUM(amount), 0) FROM public.commission_entries WHERE staff_id = m.id AND status = 'UPCOMING') AS upcoming
    ) sub ON true
    WHERE m.business_id = v_biz_id 
      AND m.role = 'STAFF'
      AND m.deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'total_earned', v_total_earned,
    'total_paid', v_total_paid,
    'balance_payable', v_balance_payable,
    'upcoming', v_total_upcoming,
    'total_upcoming', v_total_upcoming,
    'staff', v_staff_list,
    'staff_list', v_staff_list
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_summary(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_summary(uuid, date, date) TO authenticated;
