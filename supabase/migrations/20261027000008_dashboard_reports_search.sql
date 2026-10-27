-- Migration 8: Dashboard, Reports, Global Search, Privacy PIN helper, Frequent Services
-- Conforms to BR-1 (Cash-basis P&L, Loan exclusion), BR-17 (Privacy PIN & FY views), §8.2, §8.14, §8.15, and §5 Permissions

-- 1. Helper: has_privacy_pin
CREATE OR REPLACE FUNCTION public.has_privacy_pin()
RETURNS boolean AS $$
DECLARE
  v_biz_id uuid;
  v_hash text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  IF v_biz_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT privacy_pin_hash INTO v_hash
  FROM public.business_secrets
  WHERE business_id = v_biz_id;

  RETURN (v_hash IS NOT NULL);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.has_privacy_pin() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_privacy_pin() TO authenticated;


-- 2. RPC: frequent_services (last 30 days)
CREATE OR REPLACE FUNCTION public.frequent_services()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_services jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  IF v_biz_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH top_services AS (
    SELECT
      s.id,
      s.name,
      s.default_rate,
      s.is_job_type,
      s.deadline_days,
      s.commission_percent,
      COUNT(ii.id) AS usage_count
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    JOIN public.services s ON s.id = ii.service_id
    WHERE ii.business_id = v_biz_id
      AND i.invoice_date >= ((SELECT app.today()) - 30)
      AND s.active = true
      AND s.deleted_at IS NULL
    GROUP BY s.id, s.name, s.default_rate, s.is_job_type, s.deadline_days, s.commission_percent
    ORDER BY usage_count DESC
    LIMIT 6
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(top_services.*)), '[]'::jsonb)
  INTO v_services
  FROM top_services;

  RETURN v_services;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.frequent_services() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.frequent_services() TO authenticated;


-- 3. RPC: dashboard()
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

  -- 3. Job Alerts (when enabled)
  IF v_biz.job_management_enabled THEN
    SELECT
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS'),
      COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date = v_today),
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS' AND (deadline_date - v_today) <= v_red_days),
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS' AND (deadline_date - v_today) > v_red_days AND (deadline_date - v_today) <= v_yellow_days)
    INTO
      v_jobs_pending,
      v_jobs_completed_today,
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
      'red_count', v_jobs_red,
      'yellow_count', v_jobs_yellow
    ),
    'alerts', jsonb_build_object(
      'overdue_bills_count', v_overdue_bills_count,
      'due_today_bills_count', v_due_today_bills_count
    )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.dashboard() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dashboard() TO authenticated;


-- 4. RPC: global_search(q text)
CREATE OR REPLACE FUNCTION public.global_search(
  q text
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_term text;
  v_customers jsonb := '[]'::jsonb;
  v_invoices jsonb := '[]'::jsonb;
  v_receipts jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_term := TRIM(COALESCE(q, ''));
  IF LENGTH(v_term) < 2 THEN
    RETURN jsonb_build_object(
      'customers', '[]'::jsonb,
      'invoices', '[]'::jsonb,
      'receipts', '[]'::jsonb
    );
  END IF;

  -- Customers search
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'mobile', c.mobile,
        'type', c.type
      )
    ),
    '[]'::jsonb
  )
  INTO v_customers
  FROM public.customers c
  WHERE c.business_id = v_biz_id
    AND c.deleted_at IS NULL
    AND (c.name ILIKE '%' || v_term || '%' OR c.mobile ILIKE '%' || v_term || '%')
  LIMIT 5;

  -- Invoices search
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'number', i.number,
        'invoice_date', i.invoice_date,
        'party_name', i.party_name,
        'party_mobile', i.party_mobile,
        'total', i.total,
        'balance', (i.total - i.paid_amount),
        'status', i.status
      )
    ),
    '[]'::jsonb
  )
  INTO v_invoices
  FROM public.invoices i
  WHERE i.business_id = v_biz_id
    AND i.deleted_at IS NULL
    AND (
      i.number ILIKE '%' || v_term || '%'
      OR i.party_name ILIKE '%' || v_term || '%'
      OR i.party_mobile ILIKE '%' || v_term || '%'
    )
  LIMIT 5;

  -- Receipts search
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'number', r.number,
        'receipt_date', r.receipt_date,
        'amount', r.amount,
        'mode', r.mode,
        'kind', r.kind,
        'reference', r.reference
      )
    ),
    '[]'::jsonb
  )
  INTO v_receipts
  FROM public.receipts r
  WHERE r.business_id = v_biz_id
    AND r.deleted_at IS NULL
    AND (
      r.number ILIKE '%' || v_term || '%'
      OR r.reference ILIKE '%' || v_term || '%'
    )
  LIMIT 5;

  RETURN jsonb_build_object(
    'customers', v_customers,
    'invoices', v_invoices,
    'receipts', v_receipts
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.global_search(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.global_search(text) TO authenticated;


-- 5. RPC: report(type text, params jsonb)
CREATE OR REPLACE FUNCTION public.report(
  type text,
  params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_today date;
  v_fy text;
  v_from date;
  v_to date;
  v_data jsonb;

  -- P&L specific variables
  v_income numeric(14,2) := 0;
  v_payments numeric(14,2) := 0;
  v_expenses numeric(14,2) := 0;
  v_outgoing numeric(14,2) := 0;
  v_net_profit numeric(14,2) := 0;
  v_loans_taken numeric(14,2) := 0;
  v_principal_repaid numeric(14,2) := 0;
  v_interest_paid numeric(14,2) := 0;
  v_monthly_trend jsonb;
  v_expense_by_cat jsonb;
  v_income_by_cat jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  -- Reports are restricted to OWNER and ACCOUNTANT only per matrix §5
  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_fy := params->>'fy_label';
  IF v_fy IS NULL THEN
    v_fy := public.fy_label(v_today);
  END IF;

  v_from := (params->>'from')::date;
  v_to := (params->>'to')::date;

  -- Default date boundary from FY if explicit dates not provided
  IF v_from IS NULL AND v_to IS NULL THEN
    -- Calculate dates from v_fy (e.g. 2026-27 -> 2026-04-01 to 2027-03-31)
    DECLARE
      v_start_year int := split_part(v_fy, '-', 1)::int;
    BEGIN
      v_from := make_date(v_start_year, 4, 1);
      v_to := make_date(v_start_year + 1, 3, 31);
    EXCEPTION WHEN OTHERS THEN
      v_from := date_trunc('year', v_today)::date;
      v_to := (date_trunc('year', v_today) + interval '1 year - 1 day')::date;
    END;
  END IF;

  -- Case on report type
  CASE LOWER(type)
    ----------------------------------------------------------------------------
    -- 1. PROFIT & LOSS (BR-1: Cash-basis, loans excluded)
    ----------------------------------------------------------------------------
    WHEN 'pnl' THEN
      -- Total Income (all receipts)
      SELECT COALESCE(SUM(amount), 0)
      INTO v_income
      FROM public.receipts
      WHERE business_id = v_biz_id AND receipt_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      -- Vendor Payments
      SELECT COALESCE(SUM(amount), 0)
      INTO v_payments
      FROM public.payments
      WHERE business_id = v_biz_id AND payment_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      -- Expenses
      SELECT COALESCE(SUM(amount), 0)
      INTO v_expenses
      FROM public.expenses
      WHERE business_id = v_biz_id AND expense_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      v_outgoing := v_payments + v_expenses;
      v_net_profit := v_income - v_outgoing;

      -- Capital ledger non-operating entries (BR-1, BR-11)
      SELECT COALESCE(SUM(amount), 0)
      INTO v_loans_taken
      FROM public.loans
      WHERE business_id = v_biz_id AND loan_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      SELECT
        COALESCE(SUM(principal), 0),
        COALESCE(SUM(interest), 0)
      INTO
        v_principal_repaid,
        v_interest_paid
      FROM public.loan_repayments
      WHERE business_id = v_biz_id AND repayment_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      -- Breakdown by Expense Category
      WITH exp_grouped AS (
        SELECT
          ec.name AS category_name,
          COALESCE(SUM(e.amount), 0) AS total
        FROM public.expense_categories ec
        JOIN public.expenses e ON e.category_id = ec.id
        WHERE ec.business_id = v_biz_id
          AND e.expense_date BETWEEN v_from AND v_to
          AND e.deleted_at IS NULL
        GROUP BY ec.name
        ORDER BY total DESC
      )
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'category_name', eg.category_name,
            'total', eg.total
          )
        ),
        '[]'::jsonb
      )
      INTO v_expense_by_cat
      FROM exp_grouped eg;

      -- Breakdown by Receipt Kind
      WITH inc_grouped AS (
        SELECT
          r.kind,
          r.income_category,
          COALESCE(SUM(r.amount), 0) AS total
        FROM public.receipts r
        WHERE r.business_id = v_biz_id
          AND r.receipt_date BETWEEN v_from AND v_to
          AND r.deleted_at IS NULL
        GROUP BY r.kind, r.income_category
        ORDER BY total DESC
      )
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kind', ig.kind,
            'category', ig.income_category,
            'total', ig.total
          )
        ),
        '[]'::jsonb
      )
      INTO v_income_by_cat
      FROM inc_grouped ig;

      -- Monthly trend across FY
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', v_from),
          date_trunc('month', v_to),
          '1 month'::interval
        )::date AS m_start
      ),
      monthly_calc AS (
        SELECT
          to_char(m.m_start, 'Mon YYYY') AS month_label,
          m.m_start,
          COALESCE((
            SELECT SUM(r.amount)
            FROM public.receipts r
            WHERE r.business_id = v_biz_id
              AND r.receipt_date >= m.m_start
              AND r.receipt_date < (m.m_start + interval '1 month')::date
              AND r.deleted_at IS NULL
          ), 0) AS income,
          COALESCE((
            SELECT SUM(p.amount)
            FROM public.payments p
            WHERE p.business_id = v_biz_id
              AND p.payment_date >= m.m_start
              AND p.payment_date < (m.m_start + interval '1 month')::date
              AND p.deleted_at IS NULL
          ), 0)
          +
          COALESCE((
            SELECT SUM(e.amount)
            FROM public.expenses e
            WHERE e.business_id = v_biz_id
              AND e.expense_date >= m.m_start
              AND e.expense_date < (m.m_start + interval '1 month')::date
              AND e.deleted_at IS NULL
          ), 0) AS outgoing
        FROM months m
      )
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'month', mc.month_label,
            'income', mc.income,
            'outgoing', mc.outgoing,
            'profit', (mc.income - mc.outgoing)
          )
          ORDER BY mc.m_start ASC
        ),
        '[]'::jsonb
      )
      INTO v_monthly_trend
      FROM monthly_calc mc;

      RETURN jsonb_build_object(
        'type', 'pnl',
        'fy_label', v_fy,
        'from', v_from,
        'to', v_to,
        'income', v_income,
        'outgoing', v_outgoing,
        'payments', v_payments,
        'expenses', v_expenses,
        'net_profit', v_net_profit,
        'loans', jsonb_build_object(
          'taken', v_loans_taken,
          'principal_repaid', v_principal_repaid,
          'interest_paid', v_interest_paid
        ),
        'expense_categories', v_expense_by_cat,
        'income_categories', v_income_by_cat,
        'monthly_trend', v_monthly_trend
      );

    ----------------------------------------------------------------------------
    -- 2. INVOICES REPORT
    ----------------------------------------------------------------------------
    WHEN 'invoices' THEN
      WITH inv_list AS (
        SELECT
          i.id,
          i.number,
          i.invoice_date,
          i.due_date,
          i.party_name,
          i.party_mobile,
          i.subtotal,
          i.discount_amount,
          i.total,
          i.paid_amount,
          (i.total - i.paid_amount) AS balance,
          i.status,
          CASE
            WHEN i.status = 'ACTIVE' AND (i.total > i.paid_amount) AND i.due_date < v_today THEN true
            ELSE false
          END AS is_overdue
        FROM public.invoices i
        WHERE i.business_id = v_biz_id
          AND i.deleted_at IS NULL
          AND i.invoice_date BETWEEN v_from AND v_to
          AND (params->>'status' IS NULL OR i.status = params->>'status')
        ORDER BY i.invoice_date DESC, i.number DESC
      )
      SELECT jsonb_build_object(
        'type', 'invoices',
        'from', v_from,
        'to', v_to,
        'total_billed', COALESCE(SUM(total), 0),
        'total_paid', COALESCE(SUM(paid_amount), 0),
        'total_balance', COALESCE(SUM(balance), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(inv_list.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM inv_list;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 3. RECEIPTS REPORT
    ----------------------------------------------------------------------------
    WHEN 'receipts' THEN
      WITH rec_list AS (
        SELECT
          r.id,
          r.number,
          r.receipt_date,
          c.name AS customer_name,
          r.amount,
          r.mode,
          r.kind,
          r.income_category,
          r.reference,
          r.unallocated_amount
        FROM public.receipts r
        LEFT JOIN public.customers c ON c.id = r.customer_id
        WHERE r.business_id = v_biz_id
          AND r.deleted_at IS NULL
          AND r.receipt_date BETWEEN v_from AND v_to
          AND (params->>'mode' IS NULL OR r.mode = params->>'mode')
          AND (params->>'kind' IS NULL OR r.kind = params->>'kind')
        ORDER BY r.receipt_date DESC, r.number DESC
      )
      SELECT jsonb_build_object(
        'type', 'receipts',
        'from', v_from,
        'to', v_to,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(rec_list.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM rec_list;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 4. PAYMENTS REPORT
    ----------------------------------------------------------------------------
    WHEN 'payments' THEN
      WITH pay_list AS (
        SELECT
          p.id,
          p.payment_date,
          v.name AS vendor_name,
          p.description,
          i.number AS invoice_number,
          p.amount,
          p.mode,
          p.notes
        FROM public.payments p
        JOIN public.vendors v ON v.id = p.vendor_id
        LEFT JOIN public.invoices i ON i.id = p.invoice_id
        WHERE p.business_id = v_biz_id
          AND p.deleted_at IS NULL
          AND p.payment_date BETWEEN v_from AND v_to
          AND (params->>'vendor_id' IS NULL OR p.vendor_id = (params->>'vendor_id')::uuid)
        ORDER BY p.payment_date DESC
      )
      SELECT jsonb_build_object(
        'type', 'payments',
        'from', v_from,
        'to', v_to,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(pay_list.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM pay_list;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 5. EXPENSES REPORT
    ----------------------------------------------------------------------------
    WHEN 'expenses' THEN
      WITH exp_list AS (
        SELECT
          e.id,
          e.expense_date,
          ec.name AS category_name,
          e.description,
          e.amount,
          e.mode,
          e.payee,
          e.notes
        FROM public.expenses e
        JOIN public.expense_categories ec ON ec.id = e.category_id
        WHERE e.business_id = v_biz_id
          AND e.deleted_at IS NULL
          AND e.expense_date BETWEEN v_from AND v_to
          AND (params->>'category_id' IS NULL OR e.category_id = (params->>'category_id')::uuid)
        ORDER BY e.expense_date DESC
      )
      SELECT jsonb_build_object(
        'type', 'expenses',
        'from', v_from,
        'to', v_to,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(exp_list.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM exp_list;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 6. OUTSTANDING DUES REPORT
    ----------------------------------------------------------------------------
    WHEN 'outstanding' THEN
      WITH dues_query AS (
        SELECT
          c.id,
          c.name AS customer_name,
          c.mobile AS customer_mobile,
          c.type AS customer_type,
          COALESCE(SUM(i.total), 0) AS total_billed,
          COALESCE(SUM(i.paid_amount), 0) AS total_paid,
          COALESCE(SUM(i.total - i.paid_amount), 0) AS balance,
          COALESCE(SUM(CASE WHEN i.due_date < v_today THEN (i.total - i.paid_amount) ELSE 0 END), 0) AS overdue_balance,
          MIN(i.invoice_date) AS oldest_invoice_date
        FROM public.customers c
        JOIN public.invoices i ON i.customer_id = c.id
        WHERE c.business_id = v_biz_id
          AND c.deleted_at IS NULL
          AND i.status = 'ACTIVE'
          AND i.deleted_at IS NULL
        GROUP BY c.id, c.name, c.mobile, c.type
        HAVING SUM(i.total - i.paid_amount) > 0
        ORDER BY SUM(i.total - i.paid_amount) DESC
      )
      SELECT jsonb_build_object(
        'type', 'outstanding',
        'total_outstanding', COALESCE(SUM(balance), 0),
        'total_overdue', COALESCE(SUM(overdue_balance), 0),
        'customer_count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(dues_query.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM dues_query;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 7. LOANS REPORT
    ----------------------------------------------------------------------------
    WHEN 'loans' THEN
      WITH loan_agg AS (
        SELECT
          l.id,
          l.lender_name,
          l.amount AS taken,
          l.loan_date,
          COALESCE(SUM(lr.principal), 0) AS principal_repaid,
          COALESCE(SUM(lr.interest), 0) AS interest_paid,
          (l.amount - COALESCE(SUM(lr.principal), 0)) AS outstanding
        FROM public.loans l
        LEFT JOIN public.loan_repayments lr ON lr.loan_id = l.id AND lr.deleted_at IS NULL
        WHERE l.business_id = v_biz_id AND l.deleted_at IS NULL
        GROUP BY l.id, l.lender_name, l.amount, l.loan_date
        ORDER BY l.loan_date DESC
      )
      SELECT jsonb_build_object(
        'type', 'loans',
        'total_taken', COALESCE(SUM(taken), 0),
        'total_repaid', COALESCE(SUM(principal_repaid), 0),
        'total_outstanding', COALESCE(SUM(outstanding), 0),
        'total_interest_paid', COALESCE(SUM(interest_paid), 0),
        'rows', COALESCE(jsonb_agg(to_jsonb(loan_agg.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM loan_agg;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 8. JOBS REPORT
    ----------------------------------------------------------------------------
    WHEN 'jobs' THEN
      WITH job_list AS (
        SELECT
          j.job_type_name,
          COUNT(*) AS total_jobs,
          COUNT(*) FILTER (WHERE j.status = 'COMPLETED') AS completed_jobs,
          COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS') AS pending_jobs,
          COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND j.deadline_date < v_today) AS overdue_jobs,
          ROUND(AVG(
            CASE WHEN j.status = 'COMPLETED' THEN (j.completed_at::date - i.invoice_date) ELSE NULL END
          ), 1) AS avg_days_to_complete
        FROM public.jobs j
        JOIN public.invoices i ON i.id = j.invoice_id
        WHERE j.business_id = v_biz_id
          AND j.deleted_at IS NULL
          AND i.invoice_date BETWEEN v_from AND v_to
        GROUP BY j.job_type_name
        ORDER BY total_jobs DESC
      )
      SELECT jsonb_build_object(
        'type', 'jobs',
        'from', v_from,
        'to', v_to,
        'rows', COALESCE(jsonb_agg(to_jsonb(job_list.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM job_list;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 9. STAFF COMMISSION REPORT
    ----------------------------------------------------------------------------
    WHEN 'commission' THEN
      WITH comm_rep AS (
        SELECT
          m.id AS staff_id,
          m.name AS staff_name,
          COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'EARNED'), 0) AS total_earned,
          COALESCE((
            SELECT SUM(sp.amount)
            FROM public.staff_payouts sp
            WHERE sp.staff_id = m.id AND sp.business_id = v_biz_id
              AND sp.deleted_at IS NULL
              AND sp.payout_date BETWEEN v_from AND v_to
          ), 0) AS total_paid,
          COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'UPCOMING'), 0) AS upcoming
        FROM public.members m
        LEFT JOIN public.commission_entries ce ON ce.staff_id = m.id
          AND (ce.earned_at::date BETWEEN v_from AND v_to OR ce.status = 'UPCOMING')
        WHERE m.business_id = v_biz_id AND m.active = true
        GROUP BY m.id, m.name
        ORDER BY total_earned DESC
      )
      SELECT jsonb_build_object(
        'type', 'commission',
        'from', v_from,
        'to', v_to,
        'rows', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'staff_id', comm_rep.staff_id,
              'staff_name', comm_rep.staff_name,
              'earned', comm_rep.total_earned,
              'paid', comm_rep.total_paid,
              'balance', (comm_rep.total_earned - comm_rep.total_paid),
              'upcoming', comm_rep.upcoming
            )
          ),
          '[]'::jsonb
        )
      )
      INTO v_data
      FROM comm_rep;

      RETURN v_data;

    ELSE
      RAISE EXCEPTION 'INVALID_REPORT_TYPE' USING ERRCODE = 'P0001';
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.report(text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.report(text, jsonb) TO authenticated;
