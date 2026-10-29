-- Migration 15: Comprehensive Dashboard with Multi-Period Filters (Today, This Month, This Year)
-- Allows switching between Today, This Month, and This Year seamlessly with instant zero-lag updates

CREATE OR REPLACE FUNCTION public.dashboard()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_today date;
  v_biz public.businesses%ROWTYPE;
  v_red_days int;
  v_yellow_days int;

  -- 1. Today
  v_today_bills_count int := 0;
  v_today_income numeric(14,2) := 0;
  v_today_payments numeric(14,2) := 0;
  v_today_expenses numeric(14,2) := 0;
  v_today_outgoing numeric(14,2) := 0;
  v_today_net_profit numeric(14,2) := 0;
  v_today_payment_methods jsonb := '{}'::jsonb;
  v_today_top_services jsonb := '[]'::jsonb;
  v_today_chart_data jsonb := '[]'::jsonb;

  -- 2. This Month
  v_month_start date;
  v_month_end date;
  v_month_bills_count int := 0;
  v_month_income numeric(14,2) := 0;
  v_month_payments numeric(14,2) := 0;
  v_month_expenses numeric(14,2) := 0;
  v_month_outgoing numeric(14,2) := 0;
  v_month_net_profit numeric(14,2) := 0;
  v_month_payment_methods jsonb := '{}'::jsonb;
  v_month_top_services jsonb := '[]'::jsonb;
  v_month_chart_data jsonb := '[]'::jsonb;

  -- 3. This Year (Financial Year)
  v_fy_label text;
  v_fy_start date;
  v_fy_end date;
  v_year_bills_count int := 0;
  v_year_income numeric(14,2) := 0;
  v_year_payments numeric(14,2) := 0;
  v_year_expenses numeric(14,2) := 0;
  v_year_outgoing numeric(14,2) := 0;
  v_year_net_profit numeric(14,2) := 0;
  v_year_payment_methods jsonb := '{}'::jsonb;
  v_year_top_services jsonb := '[]'::jsonb;
  v_year_chart_data jsonb := '[]'::jsonb;

  -- Dues & Loans
  v_total_outstanding numeric(14,2) := 0;
  v_loan_outstanding numeric(14,2) := 0;

  -- Jobs
  v_jobs_pending int := 0;
  v_jobs_completed_today int := 0;
  v_jobs_completed_total int := 0;
  v_jobs_late int := 0;
  v_jobs_red int := 0;
  v_jobs_yellow int := 0;

  -- Alerts
  v_overdue_bills_count int := 0;
  v_due_today_bills_count int := 0;

  -- Recent Data
  v_recent_bills jsonb := '[]'::jsonb;
  v_recent_customers jsonb := '[]'::jsonb;
  v_pending_payments jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;
  v_red_days := COALESCE(v_biz.red_days, 3);
  v_yellow_days := COALESCE(v_biz.yellow_days, 5);

  -- Month range
  v_month_start := date_trunc('month', v_today)::date;
  v_month_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;

  -- FY range (Indian Financial Year: 1 Apr to 31 Mar)
  v_fy_label := public.fy_label(v_today);
  IF EXTRACT(MONTH FROM v_today) >= 4 THEN
    v_fy_start := make_date(EXTRACT(YEAR FROM v_today)::int, 4, 1);
    v_fy_end := make_date(EXTRACT(YEAR FROM v_today)::int + 1, 3, 31);
  ELSE
    v_fy_start := make_date(EXTRACT(YEAR FROM v_today)::int - 1, 4, 1);
    v_fy_end := make_date(EXTRACT(YEAR FROM v_today)::int, 3, 31);
  END IF;

  -- =========================================================
  -- 1. TODAY DATA
  -- =========================================================
  SELECT COUNT(*)
  INTO v_today_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id AND invoice_date = v_today AND status = 'ACTIVE' AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_today_income
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date = v_today AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_today_payments
  FROM public.payments
  WHERE business_id = v_biz_id AND payment_date = v_today AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_today_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id AND expense_date = v_today AND deleted_at IS NULL;

  v_today_outgoing := v_today_payments + v_today_expenses;
  v_today_net_profit := v_today_income - v_today_outgoing;

  -- Today payment methods
  SELECT jsonb_build_object(
    'cash', COALESCE(SUM(amount) FILTER (WHERE mode = 'CASH'), 0),
    'upi', COALESCE(SUM(amount) FILTER (WHERE mode = 'UPI'), 0),
    'bank', COALESCE(SUM(amount) FILTER (WHERE mode IN ('BANK', 'CHEQUE')), 0),
    'card', COALESCE(SUM(amount) FILTER (WHERE mode = 'CARD'), 0),
    'total', COALESCE(SUM(amount), 0)
  )
  INTO v_today_payment_methods
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date = v_today AND deleted_at IS NULL;

  -- Today top services
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_today_top_services
  FROM (
    SELECT
      COALESCE(s.name, ii.description) as name,
      COUNT(*)::int as count,
      COALESCE(SUM(ii.amount), 0) as total_amount
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    LEFT JOIN public.services s ON s.id = ii.service_id
    WHERE i.business_id = v_biz_id
      AND i.invoice_date = v_today
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
    GROUP BY COALESCE(s.name, ii.description)
    ORDER BY count DESC, total_amount DESC
    LIMIT 5
  ) sub;

  -- Today chart (Last 7 days trend leading to today)
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_today_chart_data
  FROM (
    WITH days AS (
      SELECT generate_series((v_today - 6)::date, v_today, '1 day'::interval)::date as d
    )
    SELECT
      CASE WHEN days.d = v_today THEN 'Today' ELSE to_char(days.d, 'FMDD Mon') END as label,
      to_char(days.d, 'YYYY-MM-DD') as date_str,
      COALESCE((
        SELECT SUM(amount) FROM public.receipts r
        WHERE r.business_id = v_biz_id AND r.receipt_date = days.d AND r.deleted_at IS NULL
      ), 0) as income,
      COALESCE((
        SELECT SUM(amount) FROM public.expenses e
        WHERE e.business_id = v_biz_id AND e.expense_date = days.d AND e.deleted_at IS NULL
      ), 0) + COALESCE((
        SELECT SUM(amount) FROM public.payments p
        WHERE p.business_id = v_biz_id AND p.payment_date = days.d AND p.deleted_at IS NULL
      ), 0) as expenses
    FROM days
    ORDER BY days.d ASC
  ) sub;

  -- =========================================================
  -- 2. THIS MONTH DATA
  -- =========================================================
  SELECT COUNT(*)
  INTO v_month_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id AND invoice_date BETWEEN v_month_start AND v_month_end AND status = 'ACTIVE' AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_month_income
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date BETWEEN v_month_start AND v_month_end AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_month_payments
  FROM public.payments
  WHERE business_id = v_biz_id AND payment_date BETWEEN v_month_start AND v_month_end AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_month_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id AND expense_date BETWEEN v_month_start AND v_month_end AND deleted_at IS NULL;

  v_month_outgoing := v_month_payments + v_month_expenses;
  v_month_net_profit := v_month_income - v_month_outgoing;

  -- Month payment methods
  SELECT jsonb_build_object(
    'cash', COALESCE(SUM(amount) FILTER (WHERE mode = 'CASH'), 0),
    'upi', COALESCE(SUM(amount) FILTER (WHERE mode = 'UPI'), 0),
    'bank', COALESCE(SUM(amount) FILTER (WHERE mode IN ('BANK', 'CHEQUE')), 0),
    'card', COALESCE(SUM(amount) FILTER (WHERE mode = 'CARD'), 0),
    'total', COALESCE(SUM(amount), 0)
  )
  INTO v_month_payment_methods
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date BETWEEN v_month_start AND v_month_end AND deleted_at IS NULL;

  -- Month top services
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_month_top_services
  FROM (
    SELECT
      COALESCE(s.name, ii.description) as name,
      COUNT(*)::int as count,
      COALESCE(SUM(ii.amount), 0) as total_amount
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    LEFT JOIN public.services s ON s.id = ii.service_id
    WHERE i.business_id = v_biz_id
      AND i.invoice_date BETWEEN v_month_start AND v_month_end
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
    GROUP BY COALESCE(s.name, ii.description)
    ORDER BY count DESC, total_amount DESC
    LIMIT 5
  ) sub;

  -- Month chart (Day by day from start of month to today)
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_month_chart_data
  FROM (
    WITH days AS (
      SELECT generate_series(v_month_start, LEAST(v_month_end, v_today), '1 day'::interval)::date as d
    )
    SELECT
      to_char(days.d, 'FMDD Mon') as label,
      to_char(days.d, 'YYYY-MM-DD') as date_str,
      COALESCE((
        SELECT SUM(amount) FROM public.receipts r
        WHERE r.business_id = v_biz_id AND r.receipt_date = days.d AND r.deleted_at IS NULL
      ), 0) as income,
      COALESCE((
        SELECT SUM(amount) FROM public.expenses e
        WHERE e.business_id = v_biz_id AND e.expense_date = days.d AND e.deleted_at IS NULL
      ), 0) + COALESCE((
        SELECT SUM(amount) FROM public.payments p
        WHERE p.business_id = v_biz_id AND p.payment_date = days.d AND p.deleted_at IS NULL
      ), 0) as expenses
    FROM days
    ORDER BY days.d ASC
  ) sub;

  -- =========================================================
  -- 3. THIS YEAR (FINANCIAL YEAR) DATA
  -- =========================================================
  SELECT COUNT(*)
  INTO v_year_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id AND invoice_date BETWEEN v_fy_start AND v_fy_end AND status = 'ACTIVE' AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_year_income
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date BETWEEN v_fy_start AND v_fy_end AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_year_payments
  FROM public.payments
  WHERE business_id = v_biz_id AND payment_date BETWEEN v_fy_start AND v_fy_end AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_year_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id AND expense_date BETWEEN v_fy_start AND v_fy_end AND deleted_at IS NULL;

  v_year_outgoing := v_year_payments + v_year_expenses;
  v_year_net_profit := v_year_income - v_year_outgoing;

  -- Year payment methods
  SELECT jsonb_build_object(
    'cash', COALESCE(SUM(amount) FILTER (WHERE mode = 'CASH'), 0),
    'upi', COALESCE(SUM(amount) FILTER (WHERE mode = 'UPI'), 0),
    'bank', COALESCE(SUM(amount) FILTER (WHERE mode IN ('BANK', 'CHEQUE')), 0),
    'card', COALESCE(SUM(amount) FILTER (WHERE mode = 'CARD'), 0),
    'total', COALESCE(SUM(amount), 0)
  )
  INTO v_year_payment_methods
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date BETWEEN v_fy_start AND v_fy_end AND deleted_at IS NULL;

  -- Year top services
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_year_top_services
  FROM (
    SELECT
      COALESCE(s.name, ii.description) as name,
      COUNT(*)::int as count,
      COALESCE(SUM(ii.amount), 0) as total_amount
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    LEFT JOIN public.services s ON s.id = ii.service_id
    WHERE i.business_id = v_biz_id
      AND i.invoice_date BETWEEN v_fy_start AND v_fy_end
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
    GROUP BY COALESCE(s.name, ii.description)
    ORDER BY count DESC, total_amount DESC
    LIMIT 5
  ) sub;

  -- Year chart (Month by month across the financial year)
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_year_chart_data
  FROM (
    WITH months AS (
      SELECT generate_series(v_fy_start, LEAST(v_fy_end, date_trunc('month', v_today)::date), '1 month'::interval)::date as m
    )
    SELECT
      to_char(months.m, 'Mon') as label,
      to_char(months.m, 'YYYY-MM') as date_str,
      COALESCE((
        SELECT SUM(amount) FROM public.receipts r
        WHERE r.business_id = v_biz_id
          AND r.receipt_date >= months.m
          AND r.receipt_date < (months.m + interval '1 month')::date
          AND r.deleted_at IS NULL
      ), 0) as income,
      COALESCE((
        SELECT SUM(amount) FROM public.expenses e
        WHERE e.business_id = v_biz_id
          AND e.expense_date >= months.m
          AND e.expense_date < (months.m + interval '1 month')::date
          AND e.deleted_at IS NULL
      ), 0) + COALESCE((
        SELECT SUM(amount) FROM public.payments p
        WHERE p.business_id = v_biz_id
          AND p.payment_date >= months.m
          AND p.payment_date < (months.m + interval '1 month')::date
          AND p.deleted_at IS NULL
      ), 0) as expenses
    FROM months
    ORDER BY months.m ASC
  ) sub;

  -- =========================================================
  -- 4. CAPITAL LEDGER & DUES (Cross-period balances)
  -- =========================================================
  SELECT
    COALESCE((SELECT SUM(amount) FROM public.loans WHERE business_id = v_biz_id AND deleted_at IS NULL), 0)
    -
    COALESCE((SELECT SUM(principal) FROM public.loan_repayments WHERE business_id = v_biz_id AND deleted_at IS NULL), 0)
  INTO v_loan_outstanding;

  SELECT COALESCE(SUM(total - paid_amount), 0)
  INTO v_total_outstanding
  FROM public.invoices
  WHERE business_id = v_biz_id AND status = 'ACTIVE' AND deleted_at IS NULL AND (total > paid_amount);

  -- Bill Alerts
  SELECT
    COUNT(*) FILTER (WHERE due_date < v_today),
    COUNT(*) FILTER (WHERE due_date = v_today)
  INTO
    v_overdue_bills_count,
    v_due_today_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id AND status = 'ACTIVE' AND deleted_at IS NULL AND (total > paid_amount);

  -- =========================================================
  -- 5. JOB ALERTS & COUNTS
  -- =========================================================
  IF v_biz.job_management_enabled THEN
    SELECT
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS'),
      COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date = v_today),
      COUNT(*) FILTER (WHERE status = 'COMPLETED'),
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS' AND (deadline_date - v_today) < 0),
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS' AND (deadline_date - v_today) >= 0 AND (deadline_date - v_today) <= v_red_days),
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS' AND (deadline_date - v_today) > v_red_days AND (deadline_date - v_today) <= v_yellow_days)
    INTO
      v_jobs_pending,
      v_jobs_completed_today,
      v_jobs_completed_total,
      v_jobs_late,
      v_jobs_red,
      v_jobs_yellow
    FROM public.jobs
    WHERE business_id = v_biz_id AND deleted_at IS NULL;
  END IF;

  -- =========================================================
  -- 6. RECENT ACTIVITY LISTS
  -- =========================================================
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_recent_bills
  FROM (
    SELECT id, number, party_name, total, paid_amount, status, invoice_date
    FROM public.invoices
    WHERE business_id = v_biz_id AND deleted_at IS NULL
    ORDER BY invoice_date DESC, created_at DESC
    LIMIT 5
  ) sub;

  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_recent_customers
  FROM (
    SELECT
      c.id,
      c.name,
      c.mobile,
      (SELECT COUNT(*)::int FROM public.invoices i WHERE i.customer_id = c.id AND i.deleted_at IS NULL) as bills_count
    FROM public.customers c
    WHERE c.business_id = v_biz_id AND c.deleted_at IS NULL
    ORDER BY c.created_at DESC
    LIMIT 5
  ) sub;

  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_pending_payments
  FROM (
    SELECT
      id,
      number,
      party_name,
      party_mobile,
      (total - paid_amount) as due_amount,
      GREATEST(0, (v_today - due_date)) as days_overdue,
      due_date
    FROM public.invoices
    WHERE business_id = v_biz_id
      AND status = 'ACTIVE'
      AND deleted_at IS NULL
      AND (total > paid_amount)
    ORDER BY due_date ASC, (total - paid_amount) DESC
    LIMIT 5
  ) sub;

  -- Return comprehensive dashboard payload with Today, This Month, and This Year structures
  RETURN jsonb_build_object(
    'today', jsonb_build_object(
      'label', 'Today',
      'date_str', v_today::text,
      'bills_count', v_today_bills_count,
      'collection', v_today_income,
      'income', v_today_income,
      'payments', v_today_payments,
      'expenses', v_today_expenses,
      'outgoing', v_today_outgoing,
      'net_profit', v_today_net_profit,
      'payment_methods', v_today_payment_methods,
      'top_services', v_today_top_services,
      'chart_data', v_today_chart_data
    ),
    'this_month', jsonb_build_object(
      'label', 'This Month',
      'start_date', v_month_start,
      'end_date', v_month_end,
      'bills_count', v_month_bills_count,
      'income', v_month_income,
      'payments', v_month_payments,
      'expenses', v_month_expenses,
      'outgoing', v_month_outgoing,
      'net_profit', v_month_net_profit,
      'payment_methods', v_month_payment_methods,
      'top_services', v_month_top_services,
      'chart_data', v_month_chart_data,
      'total_outstanding', v_total_outstanding,
      'loan_outstanding', v_loan_outstanding
    ),
    'this_year', jsonb_build_object(
      'label', 'This Year',
      'fy_label', v_fy_label,
      'start_date', v_fy_start,
      'end_date', v_fy_end,
      'bills_count', v_year_bills_count,
      'income', v_year_income,
      'payments', v_year_payments,
      'expenses', v_year_expenses,
      'outgoing', v_year_outgoing,
      'net_profit', v_year_net_profit,
      'payment_methods', v_year_payment_methods,
      'top_services', v_year_top_services,
      'chart_data', v_year_chart_data,
      'total_outstanding', v_total_outstanding,
      'loan_outstanding', v_loan_outstanding
    ),
    'jobs', jsonb_build_object(
      'enabled', v_biz.job_management_enabled,
      'pending', v_jobs_pending,
      'completed_today', v_jobs_completed_today,
      'completed_total', v_jobs_completed_total,
      'late_count', v_jobs_late,
      'red_count', v_jobs_red,
      'yellow_count', v_jobs_yellow,
      'red_days', v_red_days,
      'yellow_days', v_yellow_days
    ),
    'alerts', jsonb_build_object(
      'overdue_bills_count', v_overdue_bills_count,
      'due_today_bills_count', v_due_today_bills_count
    ),
    -- Backward-compatible top-level properties (defaults to this_month)
    'payment_methods', v_month_payment_methods,
    'top_services', v_month_top_services,
    'chart_data', v_month_chart_data,
    'recent_bills', v_recent_bills,
    'recent_customers', v_recent_customers,
    'pending_payments', v_pending_payments,
    'total_outstanding', v_total_outstanding,
    'loan_outstanding', v_loan_outstanding
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.dashboard() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dashboard() TO authenticated;
