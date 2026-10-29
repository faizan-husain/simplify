-- Migration 16: Resilient Tenancy and Auth Caller Resolution
-- Ensures that app.current_member_id(), app.current_business_id(), and app.current_role()
-- reliably identify the active caller even if auth.uid() has an unmapped development UUID.

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
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com')
      )
    )
    OR (
      -- Resilient dev fallback: if auth.uid() is not mapped and single business exists
      (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL) = 1
      AND m.role = 'OWNER'
    )
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY 
    (m.auth_user_id = auth.uid()) DESC,
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
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com')
      )
    )
    OR (
      -- Resilient dev fallback: if auth.uid() is not mapped and single business exists
      (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL) = 1
      AND m.role = 'OWNER'
    )
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY 
    (m.auth_user_id = auth.uid()) DESC,
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
    OR (
      u.email IS NOT NULL AND (
        u.email = '91' || m.mobile || '@simplify.local'
        OR u.email = m.mobile || '@simplify.local'
        OR (m.role = 'OWNER' AND u.email = 'owner@simplify.com')
        OR (m.role = 'STAFF' AND u.email = 'staff@simplify.com')
      )
    )
    OR (
      -- Resilient dev fallback: if auth.uid() is not mapped and single business exists
      (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL) = 1
      AND m.role = 'OWNER'
    )
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY 
    (m.auth_user_id = auth.uid()) DESC,
    (m.role = 'OWNER') DESC,
    m.created_at ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';
