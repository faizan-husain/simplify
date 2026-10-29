-- Migration: 20261029000011_dashboard_job_deadline_buckets.sql
-- Exact separation of Late Jobs (days_left < 0) vs Red Box Jobs (0 <= days_left <= red_days) in dashboard()

CREATE OR REPLACE FUNCTION public.dashboard()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_today date;
  v_biz public.businesses%ROWTYPE;
  v_red_days int;
  v_yellow_days int;

  -- Today
  v_today_bills_count int := 0;
  v_today_collection numeric(14,2) := 0;
  v_today_payments numeric(14,2) := 0;
  v_today_expenses numeric(14,2) := 0;

  -- Month
  v_month_start date;
  v_month_end date;
  v_month_income numeric(14,2) := 0;
  v_month_payments numeric(14,2) := 0;
  v_month_expenses numeric(14,2) := 0;
  v_month_outgoing numeric(14,2) := 0;
  v_month_net_profit numeric(14,2) := 0;
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

  v_month_start := date_trunc('month', v_today)::date;
  v_month_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;

  -- 1. Today Metrics
  SELECT COUNT(*)
  INTO v_today_bills_count
  FROM public.invoices
  WHERE business_id = v_biz_id AND invoice_date = v_today AND status = 'ACTIVE' AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_today_collection
  FROM public.receipts
  WHERE business_id = v_biz_id AND receipt_date = v_today AND deleted_at IS NULL;

  IF v_role IN ('OWNER', 'ACCOUNTANT') THEN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_today_payments
    FROM public.payments
    WHERE business_id = v_biz_id AND payment_date = v_today AND deleted_at IS NULL;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_today_expenses
    FROM public.expenses
    WHERE business_id = v_biz_id AND expense_date = v_today AND deleted_at IS NULL;

    -- 2. This Month Metrics
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

    -- Loan Outstanding: Total taken - Principal repaid (BR-1, BR-11)
    SELECT
      COALESCE((SELECT SUM(amount) FROM public.loans WHERE business_id = v_biz_id AND deleted_at IS NULL), 0)
      -
      COALESCE((SELECT SUM(principal) FROM public.loan_repayments WHERE business_id = v_biz_id AND deleted_at IS NULL), 0)
    INTO v_loan_outstanding;
  END IF;

  -- Total Outstanding Across All Bills (Receivables)
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

  -- 3. Job Alerts (when enabled) — Exact alignment with list_jobs tab counts
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

  RETURN jsonb_build_object(
    'today', jsonb_build_object(
      'bills_count', v_today_bills_count,
      'collection', v_today_collection,
      'payments', v_today_payments,
      'expenses', v_today_expenses
    ),
    'this_month', jsonb_build_object(
      'start_date', v_month_start,
      'end_date', v_month_end,
      'income', v_month_income,
      'outgoing', v_month_outgoing,
      'payments', v_month_payments,
      'expenses', v_month_expenses,
      'net_profit', v_month_net_profit,
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
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.dashboard() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dashboard() TO authenticated;
