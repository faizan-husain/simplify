-- Migration 40: Staff Dashboard RPC and Strict RBAC Dashboard Protection
-- 1. Restrict public.dashboard() to OWNER and ACCOUNTANT only (blocks STAFF callers)
-- 2. Create public.staff_dashboard(p_period text) returning only caller staff's data
--    (bills count, collection by mode for cash handover, earnings, jobs queue, recent bills)

-- 1. Protect public.dashboard() against unauthorized access by staff
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

  -- STRICT RBAC: Only OWNER and ACCOUNTANT can access the business-wide dashboard
  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
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

  -- =========================================================
  -- 2. THIS MONTH DATA
  -- =========================================================
  SELECT COUNT(*)
  INTO v_month_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND invoice_date >= v_month_start AND invoice_date <= v_month_end
    AND status = 'ACTIVE' AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_month_income
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND receipt_date >= v_month_start AND receipt_date <= v_month_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_month_payments
  FROM public.payments
  WHERE business_id = v_biz_id
    AND payment_date >= v_month_start AND payment_date <= v_month_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_month_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id
    AND expense_date >= v_month_start AND expense_date <= v_month_end
    AND deleted_at IS NULL;

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
  WHERE business_id = v_biz_id
    AND receipt_date >= v_month_start AND receipt_date <= v_month_end
    AND deleted_at IS NULL;

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
      AND i.invoice_date >= v_month_start AND i.invoice_date <= v_month_end
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
    GROUP BY COALESCE(s.name, ii.description)
    ORDER BY count DESC, total_amount DESC
    LIMIT 5
  ) sub;

  -- Month Chart Data: Daily breakdown for current month
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_month_chart_data
  FROM (
    SELECT
      to_char(d.date, 'DD Mon') as date,
      d.date as raw_date,
      COALESCE((
        SELECT SUM(r.amount)
        FROM public.receipts r
        WHERE r.business_id = v_biz_id AND r.receipt_date = d.date AND r.deleted_at IS NULL
      ), 0) as income,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p
        WHERE p.business_id = v_biz_id AND p.payment_date = d.date AND p.deleted_at IS NULL
      ), 0) +
      COALESCE((
        SELECT SUM(e.amount)
        FROM public.expenses e
        WHERE e.business_id = v_biz_id AND e.expense_date = d.date AND e.deleted_at IS NULL
      ), 0) as outgoing
    FROM generate_series(v_month_start, v_today, '1 day'::interval) d(date)
    ORDER BY d.date ASC
  ) sub;

  -- =========================================================
  -- 3. THIS YEAR DATA (FY)
  -- =========================================================
  SELECT COUNT(*)
  INTO v_year_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND invoice_date >= v_fy_start AND invoice_date <= v_fy_end
    AND status = 'ACTIVE' AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_year_income
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND receipt_date >= v_fy_start AND receipt_date <= v_fy_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_year_payments
  FROM public.payments
  WHERE business_id = v_biz_id
    AND payment_date >= v_fy_start AND payment_date <= v_fy_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_year_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id
    AND expense_date >= v_fy_start AND expense_date <= v_fy_end
    AND deleted_at IS NULL;

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
  WHERE business_id = v_biz_id
    AND receipt_date >= v_fy_start AND receipt_date <= v_fy_end
    AND deleted_at IS NULL;

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
      AND i.invoice_date >= v_fy_start AND i.invoice_date <= v_fy_end
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
    GROUP BY COALESCE(s.name, ii.description)
    ORDER BY count DESC, total_amount DESC
    LIMIT 5
  ) sub;

  -- Year Chart Data: Monthly breakdown for financial year
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_year_chart_data
  FROM (
    SELECT
      to_char(m.date, 'Mon YYYY') as date,
      m.date as raw_date,
      COALESCE((
        SELECT SUM(r.amount)
        FROM public.receipts r
        WHERE r.business_id = v_biz_id
          AND r.receipt_date >= m.date::date
          AND r.receipt_date < (m.date + '1 month'::interval)::date
          AND r.deleted_at IS NULL
      ), 0) as income,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p
        WHERE p.business_id = v_biz_id
          AND p.payment_date >= m.date::date
          AND p.payment_date < (m.date + '1 month'::interval)::date
          AND p.deleted_at IS NULL
      ), 0) +
      COALESCE((
        SELECT SUM(e.amount)
        FROM public.expenses e
        WHERE e.business_id = v_biz_id
          AND e.expense_date >= m.date::date
          AND e.expense_date < (m.date + '1 month'::interval)::date
          AND e.deleted_at IS NULL
      ), 0) as outgoing
    FROM generate_series(v_fy_start, LEAST(v_fy_end, v_today), '1 month'::interval) m(date)
    ORDER BY m.date ASC
  ) sub;

  -- =========================================================
  -- 4. ALL-TIME TOTALS (Dues & Loans)
  -- =========================================================
  SELECT COALESCE(SUM(total - paid_amount), 0)
  INTO v_total_outstanding
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND status = 'ACTIVE'
    AND total > paid_amount
    AND deleted_at IS NULL;

  SELECT COALESCE(
    (SELECT SUM(amount) FROM public.loans WHERE business_id = v_biz_id AND deleted_at IS NULL), 0
  ) - COALESCE(
    (SELECT SUM(principal) FROM public.loan_repayments WHERE business_id = v_biz_id AND deleted_at IS NULL), 0
  )
  INTO v_loan_outstanding;

  -- =========================================================
  -- 5. JOBS STATS
  -- =========================================================
  IF v_biz.job_management_enabled THEN
    SELECT COUNT(*) INTO v_jobs_pending
    FROM public.jobs
    WHERE business_id = v_biz_id AND status = 'IN_PROGRESS' AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_completed_today
    FROM public.jobs
    WHERE business_id = v_biz_id AND status = 'COMPLETED' AND completed_at::date = v_today AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_completed_total
    FROM public.jobs
    WHERE business_id = v_biz_id AND status = 'COMPLETED' AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_late
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND deadline_date < v_today
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_red
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND deadline_date >= v_today
      AND (deadline_date - v_today) <= v_red_days
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_yellow
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND (deadline_date - v_today) > v_red_days
      AND (deadline_date - v_today) <= v_yellow_days
      AND deleted_at IS NULL;
  END IF;

  -- =========================================================
  -- 6. ALERTS
  -- =========================================================
  SELECT COUNT(*)
  INTO v_overdue_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND status = 'ACTIVE'
    AND total > paid_amount
    AND due_date < v_today
    AND deleted_at IS NULL;

  SELECT COUNT(*)
  INTO v_due_today_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND status = 'ACTIVE'
    AND total > paid_amount
    AND due_date = v_today
    AND deleted_at IS NULL;

  -- =========================================================
  -- 7. RECENT DATA
  -- =========================================================
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_recent_bills
  FROM (
    SELECT
      id, number, invoice_date, due_date, party_name, party_mobile,
      total, paid_amount, (total - paid_amount) as balance, status, created_at
    FROM public.invoices
    WHERE business_id = v_biz_id AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 6
  ) sub;

  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_recent_customers
  FROM (
    SELECT id, name, mobile, type, created_at
    FROM public.customers
    WHERE business_id = v_biz_id AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 5
  ) sub;

  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_pending_payments
  FROM (
    SELECT
      id, number, party_name, party_mobile, total, paid_amount,
      (total - paid_amount) as balance, due_date
    FROM public.invoices
    WHERE business_id = v_biz_id
      AND status = 'ACTIVE'
      AND total > paid_amount
      AND due_date < v_today
      AND deleted_at IS NULL
    ORDER BY due_date ASC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'today', jsonb_build_object(
      'label', 'Today',
      'date', v_today,
      'bills_count', v_today_bills_count,
      'income', v_today_income,
      'payments', v_today_payments,
      'expenses', v_today_expenses,
      'outgoing', v_today_outgoing,
      'net_profit', v_today_net_profit,
      'payment_methods', v_today_payment_methods,
      'top_services', v_today_top_services,
      'chart_data', v_today_chart_data,
      'total_outstanding', v_total_outstanding,
      'loan_outstanding', v_loan_outstanding
    ),
    'this_month', jsonb_build_object(
      'label', 'This Month',
      'month_label', to_char(v_today, 'Mon YYYY'),
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


-- ====================================================================
-- 2. STAFF DASHBOARD ("My day" data provider)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.staff_dashboard(
  p_period text DEFAULT 'TODAY'
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_caller_id uuid;
  v_today date;
  v_biz public.businesses%ROWTYPE;
  v_start_date date;
  v_end_date date;

  -- 1. My Bills
  v_bills_count int := 0;
  v_bills_total numeric(14,2) := 0;

  -- 2. My Collections (for shift-end cash handover)
  v_collection_total numeric(14,2) := 0;
  v_collection_cash numeric(14,2) := 0;
  v_collection_upi numeric(14,2) := 0;
  v_collection_bank numeric(14,2) := 0;
  v_collection_card numeric(14,2) := 0;

  -- 3. Staff Profile & Earnings
  v_staff record;
  v_total_earned numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_balance_payable numeric(14,2) := 0;
  v_upcoming numeric(14,2) := 0;

  -- 4. Jobs & Deadlines
  v_red_days int;
  v_yellow_days int;
  v_jobs_pending int := 0;
  v_jobs_completed_today int := 0;
  v_jobs_completed_period int := 0;
  v_jobs_late int := 0;
  v_jobs_red int := 0;
  v_jobs_yellow int := 0;
  v_urgent_jobs jsonb := '[]'::jsonb;

  -- 5. Staff's Recent Bills
  v_recent_bills jsonb := '[]'::jsonb;

  -- 6. Staff's Bills per day
  v_bills_per_day jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_caller_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;
  v_red_days := COALESCE(v_biz.red_days, 3);
  v_yellow_days := COALESCE(v_biz.yellow_days, 5);

  -- Set period dates (only TODAY or MONTH supported for staff)
  IF UPPER(COALESCE(p_period, 'TODAY')) = 'MONTH' THEN
    v_start_date := date_trunc('month', v_today)::date;
    v_end_date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  ELSE
    v_start_date := v_today;
    v_end_date := v_today;
  END IF;

  -- =========================================================
  -- 1. MY BILLS (Created by this staff member)
  -- =========================================================
  SELECT
    COUNT(*),
    COALESCE(SUM(total), 0)
  INTO v_bills_count, v_bills_total
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND created_by = v_caller_id
    AND invoice_date >= v_start_date
    AND invoice_date <= v_end_date
    AND status = 'ACTIVE'
    AND deleted_at IS NULL;

  -- =========================================================
  -- 2. MY COLLECTIONS (Receipts created by this staff member)
  -- =========================================================
  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'CASH'), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'UPI'), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode IN ('BANK', 'CHEQUE')), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'CARD'), 0)
  INTO
    v_collection_total,
    v_collection_cash,
    v_collection_upi,
    v_collection_bank,
    v_collection_card
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND created_by = v_caller_id
    AND receipt_date >= v_start_date
    AND receipt_date <= v_end_date
    AND deleted_at IS NULL;

  -- =========================================================
  -- 3. MY EARNINGS
  -- =========================================================
  SELECT 
    id, name, mobile, role,
    COALESCE(compensation_type, 'COMMISSION') AS compensation_type,
    COALESCE(monthly_salary, 0) AS monthly_salary,
    COALESCE(salary_start_date, created_at::date) AS salary_start_date
  INTO v_staff
  FROM public.members
  WHERE id = v_caller_id AND business_id = v_biz_id;

  IF v_staff.compensation_type = 'SALARY' THEN
    v_total_earned := v_staff.monthly_salary;
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.staff_payouts
    WHERE staff_id = v_caller_id AND business_id = v_biz_id AND deleted_at IS NULL
      AND payout_date >= v_start_date AND payout_date <= v_end_date;

    v_balance_payable := (
      GREATEST(0, (
        (EXTRACT(YEAR FROM v_today) - EXTRACT(YEAR FROM v_staff.salary_start_date)) * 12 +
        (EXTRACT(MONTH FROM v_today) - EXTRACT(MONTH FROM v_staff.salary_start_date)) + 1
      )::int) * v_staff.monthly_salary
    ) - (
      SELECT COALESCE(SUM(amount), 0)
      FROM public.staff_payouts
      WHERE staff_id = v_caller_id AND business_id = v_biz_id AND deleted_at IS NULL
    );
    v_upcoming := 0;
  ELSE
    -- Commission based
    SELECT 
      COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'EARNED'), 0),
      COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'UPCOMING'), 0)
    INTO v_total_earned, v_upcoming
    FROM public.commission_entries ce
    WHERE ce.business_id = v_biz_id
      AND ce.staff_id = v_caller_id
      AND ce.earned_at::date >= v_start_date
      AND ce.earned_at::date <= v_end_date;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.staff_payouts
    WHERE business_id = v_biz_id AND staff_id = v_caller_id AND deleted_at IS NULL
      AND payout_date >= v_start_date AND payout_date <= v_end_date;

    v_balance_payable := (
      SELECT COALESCE(SUM(amount), 0) FROM public.commission_entries
      WHERE business_id = v_biz_id AND status = 'EARNED' AND staff_id = v_caller_id
    ) - (
      SELECT COALESCE(SUM(amount), 0) FROM public.staff_payouts
      WHERE business_id = v_biz_id AND staff_id = v_caller_id AND deleted_at IS NULL
    );
  END IF;

  -- =========================================================
  -- 4. JOBS QUEUE (Pending & Urgent)
  -- =========================================================
  IF v_biz.job_management_enabled THEN
    -- Count open jobs
    SELECT COUNT(*) INTO v_jobs_pending
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND (assigned_staff_id = v_caller_id OR assigned_staff_id IS NULL)
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_completed_today
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'COMPLETED'
      AND completed_at::date = v_today
      AND (assigned_staff_id = v_caller_id OR assigned_staff_id IS NULL)
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_completed_period
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'COMPLETED'
      AND completed_at::date >= v_start_date
      AND completed_at::date <= v_end_date
      AND (assigned_staff_id = v_caller_id OR assigned_staff_id IS NULL)
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_late
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND deadline_date < v_today
      AND (assigned_staff_id = v_caller_id OR assigned_staff_id IS NULL)
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_red
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND deadline_date >= v_today
      AND (deadline_date - v_today) <= v_red_days
      AND (assigned_staff_id = v_caller_id OR assigned_staff_id IS NULL)
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_yellow
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND (deadline_date - v_today) > v_red_days
      AND (deadline_date - v_today) <= v_yellow_days
      AND (assigned_staff_id = v_caller_id OR assigned_staff_id IS NULL)
      AND deleted_at IS NULL;

    -- Fetch top urgent jobs for quick step ticking
    SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
    INTO v_urgent_jobs
    FROM (
      SELECT
        j.id,
        j.job_type_name,
        j.party_name,
        j.party_mobile,
        j.applicant_name,
        j.deadline_date,
        j.status,
        j.created_at,
        i.number as invoice_number,
        (j.deadline_date - v_today) as days_left,
        (SELECT COUNT(*) FROM public.job_steps js WHERE js.job_id = j.id) as total_steps,
        (SELECT COUNT(*) FROM public.job_steps js WHERE js.job_id = j.id AND js.ticked = true) as ticked_steps,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', js.id,
              'position', js.position,
              'name', js.name,
              'ticked', js.ticked,
              'ticked_at', js.ticked_at,
              'whatsapp_message', js.whatsapp_message
            ) ORDER BY js.position ASC
          )
          FROM public.job_steps js
          WHERE js.job_id = j.id
        ), '[]'::jsonb) as steps
      FROM public.jobs j
      LEFT JOIN public.invoices i ON i.id = j.invoice_id
      WHERE j.business_id = v_biz_id
        AND j.status = 'IN_PROGRESS'
        AND (j.assigned_staff_id = v_caller_id OR j.assigned_staff_id IS NULL)
        AND j.deleted_at IS NULL
      ORDER BY
        -- Sort: late/urgent first, then progress descending
        CASE WHEN j.deadline_date < v_today THEN 0 ELSE 1 END ASC,
        j.deadline_date ASC,
        j.created_at ASC
      LIMIT 8
    ) sub;
  END IF;

  -- =========================================================
  -- 5. STAFF'S RECENT BILLS (ONLY own bills)
  -- =========================================================
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_recent_bills
  FROM (
    SELECT
      id,
      number,
      invoice_date,
      due_date,
      party_name,
      party_mobile,
      total,
      paid_amount,
      (total - paid_amount) as balance,
      status,
      created_at
    FROM public.invoices
    WHERE business_id = v_biz_id
      AND created_by = v_caller_id
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 8
  ) sub;

  -- =========================================================
  -- 6. STAFF'S BILLS PER DAY (FOR CURRENT MONTH)
  -- =========================================================
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_bills_per_day
  FROM (
    SELECT
      to_char(d.date, 'DD Mon') as date_label,
      d.date as raw_date,
      COALESCE((
        SELECT COUNT(*)
        FROM public.invoices i
        WHERE i.business_id = v_biz_id
          AND i.created_by = v_caller_id
          AND i.invoice_date = d.date
          AND i.status = 'ACTIVE'
          AND i.deleted_at IS NULL
      ), 0) as bills_count,
      COALESCE((
        SELECT SUM(i.total)
        FROM public.invoices i
        WHERE i.business_id = v_biz_id
          AND i.created_by = v_caller_id
          AND i.invoice_date = d.date
          AND i.status = 'ACTIVE'
          AND i.deleted_at IS NULL
      ), 0) as bills_amount
    FROM generate_series(
      date_trunc('month', v_today)::date,
      v_today,
      '1 day'::interval
    ) d(date)
    ORDER BY d.date ASC
  ) sub;

  RETURN jsonb_build_object(
    'period', p_period,
    'today_date', v_today,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'staff_member', jsonb_build_object(
      'id', v_staff.id,
      'name', v_staff.name,
      'role', v_staff.role,
      'mobile', v_staff.mobile,
      'compensation_type', v_staff.compensation_type,
      'monthly_salary', v_staff.monthly_salary
    ),
    'my_bills', jsonb_build_object(
      'count', v_bills_count,
      'total_amount', v_bills_total
    ),
    'my_collection', jsonb_build_object(
      'total', v_collection_total,
      'cash', v_collection_cash,
      'upi', v_collection_upi,
      'bank', v_collection_bank,
      'card', v_collection_card
    ),
    'my_earnings', jsonb_build_object(
      'compensation_type', v_staff.compensation_type,
      'monthly_salary', v_staff.monthly_salary,
      'total_earned', v_total_earned,
      'total_paid', v_total_paid,
      'balance_payable', v_balance_payable,
      'upcoming', v_upcoming
    ),
    'jobs', jsonb_build_object(
      'enabled', v_biz.job_management_enabled,
      'pending_count', v_jobs_pending,
      'completed_today_count', v_jobs_completed_today,
      'completed_period_count', v_jobs_completed_period,
      'late_count', v_jobs_late,
      'red_count', v_jobs_red,
      'yellow_count', v_jobs_yellow,
      'red_days', v_red_days,
      'yellow_days', v_yellow_days,
      'urgent_jobs', v_urgent_jobs
    ),
    'my_recent_bills', v_recent_bills,
    'my_bills_per_day', v_bills_per_day
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_dashboard(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_dashboard(text) TO authenticated;

