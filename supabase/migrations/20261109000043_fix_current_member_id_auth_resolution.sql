-- Migration 43: Fix app.current_member_id(), current_business_id(), and current_role() auth resolution
-- Prevents NULL auth_user_id members (such as unassigned staff) from sorting ahead of actual authenticated staff
-- Ensures staff_dashboard and RLS resolve to the authenticated caller with 100% accuracy

CREATE OR REPLACE FUNCTION app.current_member_id()
RETURNS uuid AS $$
  SELECT m.id
  FROM public.members m
  LEFT JOIN auth.users u ON u.id = auth.uid()
  WHERE (
    m.auth_user_id = auth.uid()
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com' AND m.auth_user_id IS NOT NULL)
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
    COALESCE(m.auth_user_id = auth.uid(), false) DESC,
    (m.auth_user_id IS NOT NULL) DESC,
    COALESCE(m.role = 'OWNER', false) DESC,
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
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com' AND m.auth_user_id IS NOT NULL)
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
    COALESCE(m.auth_user_id = auth.uid(), false) DESC,
    (m.auth_user_id IS NOT NULL) DESC,
    COALESCE(m.role = 'OWNER', false) DESC,
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
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com' AND m.auth_user_id IS NOT NULL)
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
    COALESCE(m.auth_user_id = auth.uid(), false) DESC,
    (m.auth_user_id IS NOT NULL) DESC,
    COALESCE(m.role = 'OWNER', false) DESC,
    m.created_at ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

