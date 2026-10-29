-- Migration 21: Enhanced dues_list RPC returning flat bills, filterable by partial, unpaid, overdue, and current
-- Authoritative reference: §8.11, §11, BR-3

CREATE OR REPLACE FUNCTION public.dues_list(
  p_filter text DEFAULT 'ALL',
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_today date;
  v_total_outstanding numeric(14,2) := 0;
  v_total_overdue numeric(14,2) := 0;
  v_total_current numeric(14,2) := 0;
  v_total_bills_due int := 0;
  v_partial_bills_count int := 0;
  v_unpaid_bills_count int := 0;
  v_overdue_bills_count int := 0;
  v_current_bills_count int := 0;
  v_customer_count int := 0;
  v_customers jsonb;
  v_bills jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Summary totals across all active unpaid bills in the business
  SELECT
    COALESCE(SUM(i.total - i.paid_amount), 0),
    COALESCE(SUM(CASE WHEN i.due_date < v_today THEN (i.total - i.paid_amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN i.due_date >= v_today THEN (i.total - i.paid_amount) ELSE 0 END), 0),
    COUNT(i.id),
    COUNT(CASE WHEN i.paid_amount > 0 AND (i.total - i.paid_amount) > 0 THEN 1 END),
    COUNT(CASE WHEN i.paid_amount = 0 AND i.total > 0 THEN 1 END),
    COUNT(CASE WHEN i.due_date < v_today THEN 1 END),
    COUNT(CASE WHEN i.due_date >= v_today THEN 1 END),
    COUNT(DISTINCT COALESCE(i.customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  INTO
    v_total_outstanding,
    v_total_overdue,
    v_total_current,
    v_total_bills_due,
    v_partial_bills_count,
    v_unpaid_bills_count,
    v_overdue_bills_count,
    v_current_bills_count,
    v_customer_count
  FROM public.invoices i
  WHERE i.business_id = v_biz_id
    AND i.status = 'ACTIVE'
    AND i.deleted_at IS NULL
    AND (i.total - i.paid_amount) > 0;

  -- 1. Flat list of individual pending bills (partial or unpaid)
  WITH filtered_invoices AS (
    SELECT
      i.id,
      i.number,
      i.invoice_date,
      i.due_date,
      i.customer_id,
      COALESCE(c.name, i.party_name, 'Walk-in') AS party_name,
      COALESCE(c.mobile, i.party_mobile) AS party_mobile,
      COALESCE(c.type, 'WALK_IN') AS customer_type,
      i.total,
      i.paid_amount,
      (i.total - i.paid_amount) AS balance,
      CASE WHEN i.paid_amount > 0 THEN 'PARTIAL' ELSE 'UNPAID' END AS status,
      (i.due_date < v_today) AS is_overdue,
      GREATEST(0, v_today - i.due_date) AS days_overdue,
      GREATEST(0, i.due_date - v_today) AS days_left,
      i.created_at
    FROM public.invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    WHERE i.business_id = v_biz_id
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
      AND (i.total - i.paid_amount) > 0
      AND (
        p_search IS NULL
        OR p_search = ''
        OR COALESCE(c.name, i.party_name) ILIKE '%' || p_search || '%'
        OR COALESCE(c.mobile, i.party_mobile) ILIKE '%' || p_search || '%'
        OR i.number ILIKE '%' || p_search || '%'
      )
      AND (
        CASE
          WHEN UPPER(p_filter) = 'OVERDUE' THEN i.due_date < v_today
          WHEN UPPER(p_filter) = 'CURRENT' OR UPPER(p_filter) = 'UPCOMING' THEN i.due_date >= v_today
          WHEN UPPER(p_filter) = 'DUE_TODAY' THEN i.due_date = v_today
          WHEN UPPER(p_filter) = 'DUE_SOON' THEN i.due_date <= (v_today + 5) AND i.due_date >= v_today
          WHEN UPPER(p_filter) = 'PARTIAL' THEN i.paid_amount > 0 AND (i.total - i.paid_amount) > 0
          WHEN UPPER(p_filter) = 'UNPAID' THEN i.paid_amount = 0 AND i.total > 0
          WHEN UPPER(p_filter) = 'REGULAR' THEN COALESCE(c.type, 'WALK_IN') = 'REGULAR'
          WHEN UPPER(p_filter) = 'WALK_IN' THEN COALESCE(c.type, 'WALK_IN') = 'WALK_IN'
          ELSE TRUE
        END
      )
    ORDER BY
      (i.due_date < v_today) DESC,
      i.due_date ASC,
      i.invoice_date ASC,
      i.created_at ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(filtered_invoices.*)), '[]'::jsonb)
  INTO v_bills
  FROM filtered_invoices;

  -- 2. Grouped customer dues list with their matching unpaid/partial invoices
  WITH matching_invoices AS (
    SELECT
      i.id,
      i.number,
      i.invoice_date,
      i.due_date,
      i.customer_id,
      COALESCE(c.name, i.party_name, 'Walk-in') AS party_name,
      COALESCE(c.mobile, i.party_mobile) AS party_mobile,
      COALESCE(c.type, 'WALK_IN') AS customer_type,
      i.total,
      i.paid_amount,
      (i.total - i.paid_amount) AS balance,
      CASE WHEN i.paid_amount > 0 THEN 'PARTIAL' ELSE 'UNPAID' END AS status,
      (i.due_date < v_today) AS is_overdue,
      GREATEST(0, v_today - i.due_date) AS days_overdue,
      GREATEST(0, i.due_date - v_today) AS days_left,
      i.created_at
    FROM public.invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    WHERE i.business_id = v_biz_id
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
      AND (i.total - i.paid_amount) > 0
      AND (
        p_search IS NULL
        OR p_search = ''
        OR COALESCE(c.name, i.party_name) ILIKE '%' || p_search || '%'
        OR COALESCE(c.mobile, i.party_mobile) ILIKE '%' || p_search || '%'
        OR i.number ILIKE '%' || p_search || '%'
      )
      AND (
        CASE
          WHEN UPPER(p_filter) = 'OVERDUE' THEN i.due_date < v_today
          WHEN UPPER(p_filter) = 'CURRENT' OR UPPER(p_filter) = 'UPCOMING' THEN i.due_date >= v_today
          WHEN UPPER(p_filter) = 'DUE_TODAY' THEN i.due_date = v_today
          WHEN UPPER(p_filter) = 'DUE_SOON' THEN i.due_date <= (v_today + 5) AND i.due_date >= v_today
          WHEN UPPER(p_filter) = 'PARTIAL' THEN i.paid_amount > 0 AND (i.total - i.paid_amount) > 0
          WHEN UPPER(p_filter) = 'UNPAID' THEN i.paid_amount = 0 AND i.total > 0
          WHEN UPPER(p_filter) = 'REGULAR' THEN COALESCE(c.type, 'WALK_IN') = 'REGULAR'
          WHEN UPPER(p_filter) = 'WALK_IN' THEN COALESCE(c.type, 'WALK_IN') = 'WALK_IN'
          ELSE TRUE
        END
      )
  ),
  grouped_dues AS (
    SELECT
      COALESCE(m.customer_id, '00000000-0000-0000-0000-000000000000'::uuid) AS customer_id,
      m.party_name AS customer_name,
      m.party_mobile AS customer_mobile,
      m.customer_type,
      SUM(m.balance) AS total_due,
      SUM(CASE WHEN m.is_overdue THEN m.balance ELSE 0 END) AS overdue_balance,
      COUNT(m.id) AS bill_count,
      COUNT(CASE WHEN m.status = 'PARTIAL' THEN 1 END) AS partial_bill_count,
      COUNT(CASE WHEN m.status = 'UNPAID' THEN 1 END) AS unpaid_bill_count,
      MIN(m.invoice_date) AS oldest_bill_date,
      MIN(m.due_date) AS oldest_due_date,
      MAX(m.days_overdue) AS max_days_overdue,
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'number', m.number,
          'invoice_date', m.invoice_date,
          'due_date', m.due_date,
          'total', m.total,
          'paid_amount', m.paid_amount,
          'balance', m.balance,
          'status', m.status,
          'is_overdue', m.is_overdue,
          'days_overdue', m.days_overdue,
          'days_left', m.days_left
        )
        ORDER BY m.due_date ASC, m.invoice_date ASC, m.created_at ASC
      ) AS invoices
    FROM matching_invoices m
    GROUP BY
      COALESCE(m.customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
      m.party_name,
      m.party_mobile,
      m.customer_type
    ORDER BY
      overdue_balance DESC,
      total_due DESC,
      oldest_bill_date ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(grouped_dues.*)), '[]'::jsonb)
  INTO v_customers
  FROM grouped_dues;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'total_outstanding', v_total_outstanding,
      'total_overdue', v_total_overdue,
      'total_current', v_total_current,
      'total_bills_due', v_total_bills_due,
      'partial_bills_count', v_partial_bills_count,
      'unpaid_bills_count', v_unpaid_bills_count,
      'overdue_bills_count', v_overdue_bills_count,
      'current_bills_count', v_current_bills_count,
      'customer_count', v_customer_count
    ),
    'bills', v_bills,
    'customers', v_customers
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.dues_list(text, text, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dues_list(text, text, int, int) TO authenticated;
