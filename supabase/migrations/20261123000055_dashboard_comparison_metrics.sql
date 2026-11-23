-- Migration 55: Real Data Comparison Metrics for Dashboard (Income, Outgoing, Net Profit)
-- Computes actual previous period metrics for:
-- 1. Today -> compared vs Yesterday (vs yesterday)
-- 2. This Month -> compared vs Last Month (vs last month)
-- 3. This Year -> compared vs Last Financial Year (vs last year)

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

  -- Today Comparison (Yesterday)
  v_yesterday date;
  v_yesterday_income numeric(14,2) := 0;
  v_yesterday_payments numeric(14,2) := 0;
  v_yesterday_expenses numeric(14,2) := 0;
  v_yesterday_outgoing numeric(14,2) := 0;
  v_yesterday_net_profit numeric(14,2) := 0;

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

  -- Month Comparison (Last Month)
  v_last_month_start date;
  v_last_month_end date;
  v_last_month_income numeric(14,2) := 0;
  v_last_month_payments numeric(14,2) := 0;
  v_last_month_expenses numeric(14,2) := 0;
  v_last_month_outgoing numeric(14,2) := 0;
  v_last_month_net_profit numeric(14,2) := 0;

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

  -- Year Comparison (Last FY)
  v_last_fy_start date;
  v_last_fy_end date;
  v_last_year_income numeric(14,2) := 0;
  v_last_year_payments numeric(14,2) := 0;
  v_last_year_expenses numeric(14,2) := 0;
  v_last_year_outgoing numeric(14,2) := 0;
  v_last_year_net_profit numeric(14,2) := 0;

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

  -- Today Comparison: Yesterday
  v_yesterday := v_today - 1;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_yesterday_income
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date = v_yesterday AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_yesterday_payments
  FROM public.payments
  WHERE business_id = v_biz_id AND payment_date = v_yesterday AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_yesterday_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id AND expense_date = v_yesterday AND deleted_at IS NULL;

  v_yesterday_outgoing := v_yesterday_payments + v_yesterday_expenses;
  v_yesterday_net_profit := v_yesterday_income - v_yesterday_outgoing;

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

  -- Month Comparison: Last Month
  v_last_month_start := (date_trunc('month', v_today) - interval '1 month')::date;
  v_last_month_end := (date_trunc('month', v_today) - interval '1 day')::date;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_last_month_income
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND receipt_date >= v_last_month_start AND receipt_date <= v_last_month_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_last_month_payments
  FROM public.payments
  WHERE business_id = v_biz_id
    AND payment_date >= v_last_month_start AND payment_date <= v_last_month_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_last_month_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id
    AND expense_date >= v_last_month_start AND expense_date <= v_last_month_end
    AND deleted_at IS NULL;

  v_last_month_outgoing := v_last_month_payments + v_last_month_expenses;
  v_last_month_net_profit := v_last_month_income - v_last_month_outgoing;

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

  -- Year Comparison: Last Financial Year
  v_last_fy_start := (v_fy_start - interval '1 year')::date;
  v_last_fy_end := (v_fy_start - interval '1 day')::date;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_last_year_income
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND receipt_date >= v_last_fy_start AND receipt_date <= v_last_fy_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_last_year_payments
  FROM public.payments
  WHERE business_id = v_biz_id
    AND payment_date >= v_last_fy_start AND payment_date <= v_last_fy_end
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_last_year_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id
    AND expense_date >= v_last_fy_start AND expense_date <= v_last_fy_end
    AND deleted_at IS NULL;

  v_last_year_outgoing := v_last_year_payments + v_last_year_expenses;
  v_last_year_net_profit := v_last_year_income - v_last_year_outgoing;

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
    FROM generate_series(v_fy_start, v_today, '1 month'::interval) m(date)
    ORDER BY m.date ASC
  ) sub;

  -- =========================================================
  -- 4. DUES & LOANS
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
    (SELECT SUM(lr.principal) FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL), 0
  ) INTO v_loan_outstanding;

  -- =========================================================
  -- 5. JOBS
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
      'loan_outstanding', v_loan_outstanding,
      'prev_income', v_yesterday_income,
      'prev_outgoing', v_yesterday_outgoing,
      'prev_net_profit', v_yesterday_net_profit,
      'comparison_label', 'vs yesterday'
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
      'loan_outstanding', v_loan_outstanding,
      'prev_income', v_last_month_income,
      'prev_outgoing', v_last_month_outgoing,
      'prev_net_profit', v_last_month_net_profit,
      'comparison_label', 'vs last month'
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
      'loan_outstanding', v_loan_outstanding,
      'prev_income', v_last_year_income,
      'prev_outgoing', v_last_year_outgoing,
      'prev_net_profit', v_last_year_net_profit,
      'comparison_label', 'vs last year'
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
    'recent_bills', v_recent_bills,
    'recent_customers', v_recent_customers,
    'pending_payments', v_pending_payments
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
