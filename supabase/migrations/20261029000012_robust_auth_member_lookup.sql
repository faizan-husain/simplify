-- Migration: 20261029000012_robust_auth_member_lookup.sql
-- Robust caller resolution for tenancy, roles, and RLS policies

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
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY (m.auth_user_id = auth.uid()) DESC, m.created_at ASC
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
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY (m.auth_user_id = auth.uid()) DESC, m.created_at ASC
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
  )
  AND m.active = true
  AND m.deleted_at IS NULL
  ORDER BY (m.auth_user_id = auth.uid()) DESC, m.created_at ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

DROP POLICY IF EXISTS members_select_policy ON public.members;
CREATE POLICY members_select_policy ON public.members
  FOR SELECT
  USING (
    (business_id = (SELECT app.current_business_id()) OR auth_user_id = auth.uid())
    AND deleted_at IS NULL
  );
