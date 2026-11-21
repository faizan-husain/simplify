-- Migration 52: Support status-wise filtering in Invoices Report
-- Allows generating bills report filtered by ALL, PAID, UNPAID, PARTIAL, OVERDUE, CANCELLED

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
  v_period text;
  v_period_label text;
  v_biz public.businesses%ROWTYPE;

  -- P&L specific variables
  v_income numeric(14,2) := 0;
  v_payments numeric(14,2) := 0;
  v_expenses numeric(14,2) := 0;
  v_outgoing numeric(14,2) := 0;
  v_net_profit numeric(14,2) := 0;
  v_total_outstanding numeric(14,2) := 0;
  v_loans_taken numeric(14,2) := 0;
  v_principal_repaid numeric(14,2) := 0;
  v_interest_paid numeric(14,2) := 0;
  v_monthly_trend jsonb;
  v_expense_by_cat jsonb;
  v_income_by_cat jsonb;
  v_min_trend_date date;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz
  FROM public.businesses
  WHERE id = v_biz_id;

  v_period := UPPER(COALESCE(params->>'period', ''));
  v_fy := params->>'fy_label';
  IF v_fy IS NULL THEN
    v_fy := public.fy_label(v_today);
  END IF;

  -- 1. Resolve Date Boundaries
  IF v_period = 'TODAY' THEN
    v_from := v_today;
    v_to := v_today;
    v_period_label := 'Today (' || to_char(v_today, 'DD Mon YYYY') || ')';
  ELSIF v_period = 'MONTH' THEN
    v_from := date_trunc('month', v_today)::date;
    v_to := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    v_period_label := 'This Month (' || to_char(v_today, 'Mon YYYY') || ')';
  ELSIF v_period = 'CUSTOM' THEN
    v_from := COALESCE((params->>'from')::date, v_today);
    v_to := COALESCE((params->>'to')::date, v_today);
    v_period_label := to_char(v_from, 'DD Mon YYYY') || ' – ' || to_char(v_to, 'DD Mon YYYY');
  ELSIF v_period = 'ALL' OR (params->>'all_time')::boolean IS TRUE THEN
    v_from := '1970-01-01'::date;
    v_to := (v_today + interval '5 years')::date;
    v_period_label := 'All Time';
  ELSE
    -- Default or YEAR
    v_from := (params->>'from')::date;
    v_to := (params->>'to')::date;

    IF v_from IS NULL AND v_to IS NULL THEN
      DECLARE
        v_start_year int := split_part(v_fy, '-', 1)::int;
      BEGIN
        v_from := make_date(v_start_year, 4, 1);
        v_to := make_date(v_start_year + 1, 3, 31);
      EXCEPTION WHEN OTHERS THEN
        v_from := date_trunc('year', v_today)::date;
        v_to := (date_trunc('year', v_today) + interval '1 year - 1 day')::date;
      END;
      v_period_label := 'FY ' || v_fy;
    ELSE
      v_period_label := to_char(v_from, 'DD Mon YYYY') || ' – ' || to_char(v_to, 'DD Mon YYYY');
    END IF;
  END IF;

  CASE LOWER(type)
    ----------------------------------------------------------------------------
    -- CUSTOMER LEDGER REPORT
    ----------------------------------------------------------------------------
    WHEN 'customer_ledger' THEN
      v_data := public.party_ledger_report(
        'CUSTOMER',
        CASE WHEN v_period = 'ALL' THEN NULL ELSE v_from END,
        CASE WHEN v_period = 'ALL' THEN NULL ELSE v_to END,
        params->>'search'
      );
      RETURN v_data || jsonb_build_object(
        'period', v_period,
        'period_label', v_period_label,
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
      );

    ----------------------------------------------------------------------------
    -- VENDOR LEDGER REPORT
    ----------------------------------------------------------------------------
    WHEN 'vendor_ledger' THEN
      v_data := public.party_ledger_report(
        'VENDOR',
        CASE WHEN v_period = 'ALL' THEN NULL ELSE v_from END,
        CASE WHEN v_period = 'ALL' THEN NULL ELSE v_to END,
        params->>'search'
      );
      RETURN v_data || jsonb_build_object(
        'period', v_period,
        'period_label', v_period_label,
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
      );

    ----------------------------------------------------------------------------
    -- 1. PROFIT & LOSS (BR-1: Cash-basis, loans excluded)
    ----------------------------------------------------------------------------
    WHEN 'pnl' THEN
      SELECT COALESCE(SUM(amount), 0) INTO v_income
      FROM public.receipts
      WHERE business_id = v_biz_id AND receipt_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      SELECT COALESCE(SUM(amount), 0) INTO v_payments
      FROM public.payments
      WHERE business_id = v_biz_id AND payment_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      SELECT COALESCE(SUM(amount), 0) INTO v_expenses
      FROM public.expenses
      WHERE business_id = v_biz_id AND expense_date BETWEEN v_from AND v_to AND deleted_at IS NULL;

      v_outgoing := v_payments + v_expenses;
      v_net_profit := v_income - v_outgoing;

      SELECT COALESCE(SUM(amount), 0) INTO v_loans_taken
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

      IF v_period = 'ALL' THEN
        SELECT COALESCE(MIN(receipt_date), date_trunc('year', v_today)::date)
        INTO v_min_trend_date
        FROM public.receipts
        WHERE business_id = v_biz_id AND deleted_at IS NULL;
      ELSE
        v_min_trend_date := v_from;
      END IF;

      WITH months AS (
        SELECT generate_series(
          date_trunc('month', v_min_trend_date),
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

      -- Total Outstanding (Pending customer dues across active invoices)
      SELECT COALESCE(SUM(total - paid_amount), 0)
      INTO v_total_outstanding
      FROM public.invoices
      WHERE business_id = v_biz_id AND status = 'ACTIVE' AND deleted_at IS NULL;

      RETURN jsonb_build_object(
        'type', 'pnl',
        'fy_label', v_fy,
        'from', v_from,
        'to', v_to,
        'period_label', v_period_label,
        'income', v_income,
        'outgoing', v_outgoing,
        'payments', v_payments,
        'expenses', v_expenses,
        'net_profit', v_net_profit,
        'total_outstanding', v_total_outstanding,
        'loans', jsonb_build_object(
          'taken', v_loans_taken,
          'principal_repaid', v_principal_repaid,
          'interest_paid', v_interest_paid
        ),
        'expense_categories', v_expense_by_cat,
        'income_categories', v_income_by_cat,
        'monthly_trend', v_monthly_trend,
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
      );

    ----------------------------------------------------------------------------
    -- 2. INVOICES REPORT (Enhanced with status-wise filtering)
    ----------------------------------------------------------------------------
    WHEN 'invoices' THEN
      WITH inv_base AS (
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
      ),
      inv_list AS (
        SELECT *
        FROM inv_base i
        WHERE (
          params->>'status' IS NULL 
          OR UPPER(params->>'status') = 'ALL'
          OR (UPPER(params->>'status') = 'PAID' AND i.status = 'ACTIVE' AND (i.balance = 0 OR i.paid_amount >= i.total))
          OR (UPPER(params->>'status') = 'UNPAID' AND i.status = 'ACTIVE' AND i.paid_amount = 0)
          OR (UPPER(params->>'status') = 'PARTIAL' AND i.status = 'ACTIVE' AND i.paid_amount > 0 AND i.paid_amount < i.total)
          OR (UPPER(params->>'status') = 'OVERDUE' AND i.status = 'ACTIVE' AND i.is_overdue = true)
          OR (UPPER(params->>'status') = 'CANCELLED' AND i.status = 'CANCELLED')
          OR (i.status = params->>'status')
        )
        ORDER BY i.invoice_date DESC, i.number DESC
      )
      SELECT jsonb_build_object(
        'type', 'invoices',
        'from', v_from,
        'to', v_to,
        'period_label', v_period_label,
        'status_filter', COALESCE(params->>'status', 'ALL'),
        'total_billed', COALESCE(SUM(total), 0),
        'total_paid', COALESCE(SUM(paid_amount), 0),
        'total_balance', COALESCE(SUM(balance), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(inv_list.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
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
        'period_label', v_period_label,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(rec_list.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
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
        'period_label', v_period_label,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(pay_list.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
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
        'period_label', v_period_label,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(exp_list.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
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
          AND i.business_id = v_biz_id
          AND i.status = 'ACTIVE'
          AND i.deleted_at IS NULL
          AND (i.total > i.paid_amount)
          AND (v_period = 'ALL' OR i.invoice_date BETWEEN v_from AND v_to)
        GROUP BY c.id, c.name, c.mobile, c.type
        HAVING COALESCE(SUM(i.total - i.paid_amount), 0) > 0
        ORDER BY balance DESC
      )
      SELECT jsonb_build_object(
        'type', 'outstanding',
        'from', v_from,
        'to', v_to,
        'period_label', v_period_label,
        'total_outstanding', COALESCE(SUM(balance), 0),
        'total_balance', COALESCE(SUM(balance), 0),
        'total_overdue', COALESCE(SUM(overdue_balance), 0),
        'customer_count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(dues_query.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
      )
      INTO v_data
      FROM dues_query;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 7. LOANS REPORT
    ----------------------------------------------------------------------------
    WHEN 'loans' THEN
      WITH loan_list AS (
        SELECT
          l.id,
          l.lender_name,
          l.loan_date,
          l.amount AS taken_amount,
          COALESCE(SUM(lr.principal), 0) AS principal_repaid,
          COALESCE(SUM(lr.interest), 0) AS interest_paid,
          (l.amount - COALESCE(SUM(lr.principal), 0)) AS current_outstanding
        FROM public.loans l
        LEFT JOIN public.loan_repayments lr ON lr.loan_id = l.id AND lr.deleted_at IS NULL
          AND (v_period = 'ALL' OR lr.repayment_date BETWEEN v_from AND v_to)
        WHERE l.business_id = v_biz_id
          AND l.deleted_at IS NULL
          AND (
            v_period = 'ALL'
            OR l.loan_date BETWEEN v_from AND v_to
            OR EXISTS (
              SELECT 1 FROM public.loan_repayments r
              WHERE r.loan_id = l.id AND r.deleted_at IS NULL AND r.repayment_date BETWEEN v_from AND v_to
            )
          )
        GROUP BY l.id, l.lender_name, l.loan_date, l.amount
        ORDER BY l.loan_date DESC
      )
      SELECT jsonb_build_object(
        'type', 'loans',
        'from', v_from,
        'to', v_to,
        'period_label', v_period_label,
        'total_taken', COALESCE(SUM(taken_amount), 0),
        'total_principal_repaid', COALESCE(SUM(principal_repaid), 0),
        'total_outstanding', COALESCE(SUM(current_outstanding), 0),
        'rows', COALESCE(jsonb_agg(to_jsonb(loan_list.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
      )
      INTO v_data
      FROM loan_list;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 8. JOBS REPORT
    ----------------------------------------------------------------------------
    WHEN 'jobs' THEN
      WITH job_list AS (
        SELECT
          j.id,
          j.job_type_name,
          j.party_name,
          j.applicant_name,
          j.amount,
          j.deadline_date,
          j.status,
          m.name AS assigned_staff_name,
          i.number AS invoice_number,
          i.invoice_date
        FROM public.jobs j
        JOIN public.invoices i ON i.id = j.invoice_id
        LEFT JOIN public.members m ON m.id = j.assigned_staff_id
        WHERE j.business_id = v_biz_id
          AND j.deleted_at IS NULL
          AND (v_period = 'ALL' OR i.invoice_date BETWEEN v_from AND v_to)
          AND (params->>'status' IS NULL OR j.status = params->>'status')
        ORDER BY j.deadline_date ASC
      )
      SELECT jsonb_build_object(
        'type', 'jobs',
        'from', v_from,
        'to', v_to,
        'period_label', v_period_label,
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(job_list.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
      )
      INTO v_data
      FROM job_list;

      RETURN v_data;

    ----------------------------------------------------------------------------
    -- 9. COMMISSION REPORT
    ----------------------------------------------------------------------------
    WHEN 'commission' THEN
      WITH comm_list AS (
        SELECT
          ce.id,
          m.name AS staff_name,
          j.job_type_name,
          ce.base_amount,
          ce.percent,
          ce.amount,
          ce.status,
          ce.earned_at
        FROM public.commission_entries ce
        JOIN public.members m ON m.id = ce.staff_id
        JOIN public.jobs j ON j.id = ce.job_id
        WHERE ce.business_id = v_biz_id
          AND ce.deleted_at IS NULL
          AND (params->>'staff_id' IS NULL OR ce.staff_id = (params->>'staff_id')::uuid)
          AND (
            v_period = 'ALL'
            OR (ce.earned_at IS NOT NULL AND ce.earned_at::date BETWEEN v_from AND v_to)
            OR (ce.earned_at IS NULL AND ce.created_at::date BETWEEN v_from AND v_to)
          )
        ORDER BY ce.created_at DESC
      )
      SELECT jsonb_build_object(
        'type', 'commission',
        'from', v_from,
        'to', v_to,
        'period_label', v_period_label,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(comm_list.*)), '[]'::jsonb),
        'business', jsonb_build_object(
          'id', v_biz.id,
          'name', v_biz.name,
          'owner_name', v_biz.owner_name,
          'mobile', v_biz.mobile,
          'email', v_biz.email,
          'address', v_biz.address,
          'upi_id', v_biz.upi_id
        )
      )
      INTO v_data
      FROM comm_list;

      RETURN v_data;

    ELSE
      RAISE EXCEPTION 'UNKNOWN_REPORT_TYPE' USING ERRCODE = 'P0001';
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.report(text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.report(text, jsonb) TO authenticated;
