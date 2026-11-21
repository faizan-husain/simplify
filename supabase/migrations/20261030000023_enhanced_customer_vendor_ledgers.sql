-- Migration 23: Enhanced Customer & Vendor Ledgers with Opening Balances, Reports & Statements
-- Provides:
-- 1. Overhauled customer_ledger with proper opening balance row & running balance on date filters
-- 2. Overhauled vendor_ledger with business details, cash vs bank breakdown & cumulative paid
-- 3. New party_ledger_report for all-customer and all-vendor overview reports
-- 4. Upgraded report(type, params) with 'customer_ledger' and 'vendor_ledger' support

-- 1. OVERHAUL: customer_ledger
CREATE OR REPLACE FUNCTION public.customer_ledger(
  customer_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_cust public.customers%ROWTYPE;
  v_biz public.businesses%ROWTYPE;
  v_opening_billed numeric(14,2) := 0;
  v_opening_paid numeric(14,2) := 0;
  v_opening_balance numeric(14,2) := 0;
  v_period_billed numeric(14,2) := 0;
  v_period_paid numeric(14,2) := 0;
  v_closing_balance numeric(14,2) := 0;
  v_total_advance numeric(14,2) := 0;
  v_entries jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT * INTO v_cust
  FROM public.customers
  WHERE id = customer_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz
  FROM public.businesses
  WHERE id = v_biz_id;

  -- 1. Opening Balance computation (strictly prior to p_from_date)
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(total), 0) INTO v_opening_billed
    FROM public.invoices
    WHERE business_id = v_biz_id
      AND invoices.customer_id = customer_ledger.customer_id
      AND invoice_date < p_from_date
      AND status = 'ACTIVE'
      AND deleted_at IS NULL;

    SELECT COALESCE(SUM(amount), 0) INTO v_opening_paid
    FROM public.receipts
    WHERE business_id = v_biz_id
      AND receipts.customer_id = customer_ledger.customer_id
      AND receipt_date < p_from_date
      AND deleted_at IS NULL;

    v_opening_balance := v_opening_billed - v_opening_paid;
  ELSE
    v_opening_balance := 0;
  END IF;

  -- 2. Period Billed and Paid
  SELECT COALESCE(SUM(total), 0) INTO v_period_billed
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND invoices.customer_id = customer_ledger.customer_id
    AND status = 'ACTIVE'
    AND deleted_at IS NULL
    AND (p_from_date IS NULL OR invoice_date >= p_from_date)
    AND (p_to_date IS NULL OR invoice_date <= p_to_date);

  SELECT COALESCE(SUM(amount), 0) INTO v_period_paid
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND receipts.customer_id = customer_ledger.customer_id
    AND deleted_at IS NULL
    AND (p_from_date IS NULL OR receipt_date >= p_from_date)
    AND (p_to_date IS NULL OR receipt_date <= p_to_date);

  -- 3. Closing Balance & Advance
  v_closing_balance := v_opening_balance + v_period_billed - v_period_paid;

  SELECT COALESCE(SUM(unallocated_amount), 0) INTO v_total_advance
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND receipts.customer_id = customer_ledger.customer_id
    AND deleted_at IS NULL;

  -- 4. Assemble Chronological Ledger Entries with Opening Balance
  WITH combined_events AS (
    -- Injected Opening Balance row if p_from_date is set
    SELECT
      p_from_date AS entry_date,
      p_from_date::timestamptz AS sort_ts,
      'OPENING_BALANCE'::text AS type,
      NULL::uuid AS ref_id,
      'OPENING'::text AS ref_number,
      'Opening Balance as of ' || to_char(p_from_date, 'DD Mon YYYY') AS description,
      CASE WHEN v_opening_balance > 0 THEN v_opening_balance ELSE 0::numeric(14,2) END AS debit,
      CASE WHEN v_opening_balance < 0 THEN ABS(v_opening_balance) ELSE 0::numeric(14,2) END AS credit
    WHERE p_from_date IS NOT NULL

    UNION ALL

    -- Invoices (Debit)
    SELECT
      i.invoice_date AS entry_date,
      i.created_at AS sort_ts,
      'INVOICE'::text AS type,
      i.id AS ref_id,
      i.number AS ref_number,
      'Bill #' || i.number AS description,
      i.total AS debit,
      0::numeric(14,2) AS credit
    FROM public.invoices i
    WHERE i.business_id = v_biz_id
      AND i.customer_id = customer_ledger.customer_id
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
      AND (p_from_date IS NULL OR i.invoice_date >= p_from_date)
      AND (p_to_date IS NULL OR i.invoice_date <= p_to_date)

    UNION ALL

    -- Receipts (Credit)
    SELECT
      r.receipt_date AS entry_date,
      r.created_at AS sort_ts,
      'RECEIPT'::text AS type,
      r.id AS ref_id,
      r.number AS ref_number,
      'Payment #' || r.number || ' (' || r.mode || ')' AS description,
      0::numeric(14,2) AS debit,
      r.amount AS credit
    FROM public.receipts r
    WHERE r.business_id = v_biz_id
      AND r.customer_id = customer_ledger.customer_id
      AND r.deleted_at IS NULL
      AND (p_from_date IS NULL OR r.receipt_date >= p_from_date)
      AND (p_to_date IS NULL OR r.receipt_date <= p_to_date)
  ),
  ordered_ledger AS (
    SELECT
      entry_date,
      type,
      ref_id,
      ref_number,
      description,
      debit,
      credit,
      SUM(debit - credit) OVER (ORDER BY entry_date ASC, sort_ts ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
    FROM combined_events
    ORDER BY entry_date ASC, sort_ts ASC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(ordered_ledger.*)), '[]'::jsonb)
  INTO v_entries
  FROM ordered_ledger;

  RETURN jsonb_build_object(
    'customer', jsonb_build_object(
      'id', v_cust.id,
      'name', v_cust.name,
      'mobile', v_cust.mobile,
      'type', v_cust.type,
      'address', v_cust.address
    ),
    'business', jsonb_build_object(
      'id', v_biz.id,
      'name', v_biz.name,
      'owner_name', v_biz.owner_name,
      'mobile', v_biz.mobile,
      'email', v_biz.email,
      'address', v_biz.address,
      'upi_id', v_biz.upi_id,
      'receipt_header', v_biz.receipt_header,
      'receipt_footer', v_biz.receipt_footer
    ),
    'summary', jsonb_build_object(
      'opening_balance', v_opening_balance,
      'period_billed', v_period_billed,
      'period_paid', v_period_paid,
      'balance', v_closing_balance,
      'advance', v_total_advance,
      'from_date', p_from_date,
      'to_date', p_to_date
    ),
    'entries', v_entries
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.customer_ledger(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.customer_ledger(uuid, date, date) TO authenticated;


-- 2. OVERHAUL: vendor_ledger
CREATE OR REPLACE FUNCTION public.vendor_ledger(
  p_vendor_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARe
  v_biz_id uuid;
  v_vendor public.vendors%ROWTYPE;
  v_biz public.businesses%ROWTYPE;
  v_tot_paid numeric(14,2) := 0;
  v_cash_paid numeric(14,2) := 0;
  v_bank_paid numeric(14,2) := 0;
  v_count int := 0;
  v_payments jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT * INTO v_vendor
  FROM public.vendors
  WHERE id = p_vendor_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz
  FROM public.businesses
  WHERE id = v_biz_id;

  WITH raw_payments AS (
    SELECT
      p.id,
      p.payment_date,
      p.description,
      p.amount,
      p.mode,
      p.bank_name,
      p.notes,
      p.invoice_id,
      i.number AS invoice_number,
      p.created_at,
      SUM(p.amount) OVER (ORDER BY p.payment_date ASC, p.created_at ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_paid
    FROM public.payments p
    LEFT JOIN public.invoices i ON i.id = p.invoice_id
    WHERE p.vendor_id = p_vendor_id
      AND p.business_id = v_biz_id
      AND p.deleted_at IS NULL
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    ORDER BY p.payment_date DESC, p.created_at DESC
  )
  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(CASE WHEN mode = 'CASH' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN mode <> 'CASH' THEN amount ELSE 0 END), 0),
    COUNT(*),
    COALESCE(jsonb_agg(to_jsonb(raw_payments.*)), '[]'::jsonb)
  INTO v_tot_paid, v_cash_paid, v_bank_paid, v_count, v_payments
  FROM raw_payments;

  RETURN jsonb_build_object(
    'vendor', jsonb_build_object(
      'id', v_vendor.id,
      'name', v_vendor.name,
      'mobile', v_vendor.mobile,
      'created_at', v_vendor.created_at
    ),
    'business', jsonb_build_object(
      'id', v_biz.id,
      'name', v_biz.name,
      'owner_name', v_biz.owner_name,
      'mobile', v_biz.mobile,
      'email', v_biz.email,
      'address', v_biz.address,
      'upi_id', v_biz.upi_id
    ),
    'summary', jsonb_build_object(
      'total_paid', v_tot_paid,
      'payment_count', v_count,
      'cash_paid', v_cash_paid,
      'bank_paid', v_bank_paid,
      'from_date', p_from_date,
      'to_date', p_to_date
    ),
    'payments', v_payments
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.vendor_ledger(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.vendor_ledger(uuid, date, date) TO authenticated;


-- 3. NEW RPC: party_ledger_report(p_party_type text, p_from_date date, p_to_date date, p_search text)
CREATE OR REPLACE FUNCTION public.party_ledger_report(
  p_party_type text,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_data jsonb;
  v_clean_search text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_clean_search := TRIM(COALESCE(p_search, ''));

  IF UPPER(p_party_type) = 'CUSTOMER' THEN
    WITH cust_ledger_data AS (
      SELECT
        c.id,
        c.name AS customer_name,
        c.mobile AS customer_mobile,
        c.type AS customer_type,
        -- Opening balance (strictly before p_from_date)
        COALESCE(
          (SELECT SUM(i_pre.total) FROM public.invoices i_pre
           WHERE i_pre.customer_id = c.id AND i_pre.business_id = v_biz_id
             AND i_pre.status = 'ACTIVE' AND i_pre.deleted_at IS NULL
             AND p_from_date IS NOT NULL AND i_pre.invoice_date < p_from_date),
          0
        ) - COALESCE(
          (SELECT SUM(r_pre.amount) FROM public.receipts r_pre
           WHERE r_pre.customer_id = c.id AND r_pre.business_id = v_biz_id
             AND r_pre.deleted_at IS NULL
             AND p_from_date IS NOT NULL AND r_pre.receipt_date < p_from_date),
          0
        ) AS opening_balance,

        -- Period billed
        COALESCE(
          (SELECT SUM(i_cur.total) FROM public.invoices i_cur
           WHERE i_cur.customer_id = c.id AND i_cur.business_id = v_biz_id
             AND i_cur.status = 'ACTIVE' AND i_cur.deleted_at IS NULL
             AND (p_from_date IS NULL OR i_cur.invoice_date >= p_from_date)
             AND (p_to_date IS NULL OR i_cur.invoice_date <= p_to_date)),
          0
        ) AS period_billed,

        -- Period paid
        COALESCE(
          (SELECT SUM(r_cur.amount) FROM public.receipts r_cur
           WHERE r_cur.customer_id = c.id AND r_cur.business_id = v_biz_id
             AND r_cur.deleted_at IS NULL
             AND (p_from_date IS NULL OR r_cur.receipt_date >= p_from_date)
             AND (p_to_date IS NULL OR r_cur.receipt_date <= p_to_date)),
          0
        ) AS period_paid,

        -- Bill count in period
        COALESCE(
          (SELECT COUNT(*) FROM public.invoices i_cnt
           WHERE i_cnt.customer_id = c.id AND i_cnt.business_id = v_biz_id
             AND i_cnt.status = 'ACTIVE' AND i_cnt.deleted_at IS NULL
             AND (p_from_date IS NULL OR i_cnt.invoice_date >= p_from_date)
             AND (p_to_date IS NULL OR i_cnt.invoice_date <= p_to_date)),
          0
        ) AS bill_count,

        -- Receipt count in period
        COALESCE(
          (SELECT COUNT(*) FROM public.receipts r_cnt
           WHERE r_cnt.customer_id = c.id AND r_cnt.business_id = v_biz_id
             AND r_cnt.deleted_at IS NULL
             AND (p_from_date IS NULL OR r_cnt.receipt_date >= p_from_date)
             AND (p_to_date IS NULL OR r_cnt.receipt_date <= p_to_date)),
          0
        ) AS receipt_count,

        -- Total Advance (current unallocated balance)
        COALESCE(
          (SELECT SUM(r_adv.unallocated_amount) FROM public.receipts r_adv
           WHERE r_adv.customer_id = c.id AND r_adv.business_id = v_biz_id
             AND r_adv.deleted_at IS NULL),
          0
        ) AS advance
      FROM public.customers c
      WHERE c.business_id = v_biz_id
        AND c.deleted_at IS NULL
        AND (
          v_clean_search = ''
          OR c.name ILIKE ('%' || v_clean_search || '%')
          OR c.mobile ILIKE ('%' || v_clean_search || '%')
        )
    ),
    calculated_customers AS (
      SELECT
        cld.*,
        (cld.opening_balance + cld.period_billed - cld.period_paid) AS closing_due
      FROM cust_ledger_data cld
      ORDER BY (cld.opening_balance + cld.period_billed - cld.period_paid) DESC, cld.customer_name ASC
    )
    SELECT jsonb_build_object(
      'party_type', 'CUSTOMER',
      'from_date', p_from_date,
      'to_date', p_to_date,
      'total_opening_balance', COALESCE(SUM(opening_balance), 0),
      'total_period_billed', COALESCE(SUM(period_billed), 0),
      'total_period_paid', COALESCE(SUM(period_paid), 0),
      'total_closing_due', COALESCE(SUM(closing_due), 0),
      'total_advance', COALESCE(SUM(advance), 0),
      'customer_count', COUNT(*),
      'rows', COALESCE(jsonb_agg(to_jsonb(calculated_customers.*)), '[]'::jsonb)
    )
    INTO v_data
    FROM calculated_customers;

    RETURN v_data;

  ELSIF UPPER(p_party_type) = 'VENDOR' THEN
    WITH vendor_ledger_data AS (
      SELECT
        v.id,
        v.name AS vendor_name,
        v.mobile AS vendor_mobile,
        COALESCE(SUM(p.amount), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN p.mode = 'CASH' THEN p.amount ELSE 0 END), 0) AS cash_paid,
        COALESCE(SUM(CASE WHEN p.mode <> 'CASH' THEN p.amount ELSE 0 END), 0) AS bank_paid,
        COUNT(p.id) AS payment_count,
        MAX(p.payment_date) AS last_payment_date
      FROM public.vendors v
      LEFT JOIN public.payments p ON p.vendor_id = v.id
        AND p.business_id = v_biz_id
        AND p.deleted_at IS NULL
        AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
        AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
      WHERE v.business_id = v_biz_id
        AND v.deleted_at IS NULL
        AND (
          v_clean_search = ''
          OR v.name ILIKE ('%' || v_clean_search || '%')
          OR v.mobile ILIKE ('%' || v_clean_search || '%')
        )
      GROUP BY v.id, v.name, v.mobile
      ORDER BY total_paid DESC, v.name ASC
    )
    SELECT jsonb_build_object(
      'party_type', 'VENDOR',
      'from_date', p_from_date,
      'to_date', p_to_date,
      'total_paid', COALESCE(SUM(total_paid), 0),
      'total_cash_paid', COALESCE(SUM(cash_paid), 0),
      'total_bank_paid', COALESCE(SUM(bank_paid), 0),
      'vendor_count', COUNT(*),
      'rows', COALESCE(jsonb_agg(to_jsonb(vendor_ledger_data.*)), '[]'::jsonb)
    )
    INTO v_data
    FROM vendor_ledger_data;

    RETURN v_data;

  ELSE
    RAISE EXCEPTION 'INVALID_PARTY_TYPE' USING ERRCODE = 'P0001';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.party_ledger_report(text, date, date, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.party_ledger_report(text, date, date, text) TO authenticated;


-- 4. UPGRADE: report(type text, params jsonb) to support customer_ledger and vendor_ledger
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

  CASE LOWER(type)
    -- CUSTOMER LEDGER REPORT
    WHEN 'customer_ledger' THEN
      RETURN public.party_ledger_report('CUSTOMER', v_from, v_to, params->>'search');

    -- VENDOR LEDGER REPORT
    WHEN 'vendor_ledger' THEN
      RETURN public.party_ledger_report('VENDOR', v_from, v_to, params->>'search');

    -- 1. PROFIT & LOSS (BR-1: Cash-basis, loans excluded)
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

    -- 2. INVOICES REPORT
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

    -- 3. RECEIPTS REPORT
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

    -- 4. PAYMENTS REPORT
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

    -- 5. EXPENSES REPORT
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

    -- 6. OUTSTANDING DUES REPORT
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
        GROUP BY c.id, c.name, c.mobile, c.type
        HAVING COALESCE(SUM(i.total - i.paid_amount), 0) > 0
        ORDER BY balance DESC
      )
      SELECT jsonb_build_object(
        'type', 'outstanding',
        'total_outstanding', COALESCE(SUM(balance), 0),
        'total_balance', COALESCE(SUM(balance), 0),
        'total_overdue', COALESCE(SUM(overdue_balance), 0),
        'customer_count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(dues_query.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM dues_query;

      RETURN v_data;

    -- 7. LOANS REPORT
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
        WHERE l.business_id = v_biz_id
          AND l.deleted_at IS NULL
        GROUP BY l.id, l.lender_name, l.loan_date, l.amount
        ORDER BY l.loan_date DESC
      )
      SELECT jsonb_build_object(
        'type', 'loans',
        'total_taken', COALESCE(SUM(taken_amount), 0),
        'total_principal_repaid', COALESCE(SUM(principal_repaid), 0),
        'total_outstanding', COALESCE(SUM(current_outstanding), 0),
        'rows', COALESCE(jsonb_agg(to_jsonb(loan_list.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM loan_list;

      RETURN v_data;

    -- 8. JOBS REPORT
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
          i.number AS invoice_number
        FROM public.jobs j
        JOIN public.invoices i ON i.id = j.invoice_id
        LEFT JOIN public.members m ON m.id = j.assigned_staff_id
        WHERE j.business_id = v_biz_id
          AND j.deleted_at IS NULL
          AND i.invoice_date BETWEEN v_from AND v_to
          AND (params->>'status' IS NULL OR j.status = params->>'status')
        ORDER BY j.deadline_date ASC
      )
      SELECT jsonb_build_object(
        'type', 'jobs',
        'from', v_from,
        'to', v_to,
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(job_list.*)), '[]'::jsonb)
      )
      INTO v_data
      FROM job_list;

      RETURN v_data;

    -- 9. COMMISSION REPORT
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
          AND (ce.earned_at IS NULL OR ce.earned_at::date BETWEEN v_from AND v_to)
        ORDER BY ce.created_at DESC
      )
      SELECT jsonb_build_object(
        'type', 'commission',
        'from', v_from,
        'to', v_to,
        'total_amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*),
        'rows', COALESCE(jsonb_agg(to_jsonb(comm_list.*)), '[]'::jsonb)
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
