-- Migration: 20261113000051_enforce_owner_role_on_financial_rpcs.sql
-- Enforces Owner RBAC on cash_bank_summary, bank_ledger, and purge_deleted_records per Section 5

-- 1. Upgrade cash_bank_summary with Owner check
CREATE OR REPLACE FUNCTION public.cash_bank_summary(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_biz public.businesses%ROWTYPE;
  v_cash_opening numeric(14,2) := 0;
  v_cash_prior_in numeric(14,2) := 0;
  v_cash_prior_out numeric(14,2) := 0;
  v_cash_receipts numeric(14,2) := 0;
  v_cash_withdrawals numeric(14,2) := 0;
  v_cash_total_in numeric(14,2) := 0;
  v_cash_payments numeric(14,2) := 0;
  v_cash_expenses numeric(14,2) := 0;
  v_cash_loan_repayments numeric(14,2) := 0;
  v_cash_deposits numeric(14,2) := 0;
  v_cash_total_out numeric(14,2) := 0;
  v_cash_current_balance numeric(14,2) := 0;
  v_cash_all_time_balance numeric(14,2) := 0;

  v_bank_accounts jsonb := '[]'::jsonb;
  v_total_bank_balance numeric(14,2) := 0;
  v_recent_transfers jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only owners can access cash and bank ledgers';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;

  -- 1. Compute Cash in Hand Opening Balance as of p_from_date
  IF p_from_date IS NOT NULL THEN
    -- Inflows prior to p_from_date
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_prior_in
    FROM (
      SELECT amount FROM public.receipts
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH' AND receipt_date < p_from_date
      UNION ALL
      SELECT amount FROM public.money_transfers
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'BANK_TO_CASH' AND transfer_date < p_from_date
    ) prior_in;

    -- Outflows prior to p_from_date
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_prior_out
    FROM (
      SELECT amount FROM public.payments
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH' AND payment_date < p_from_date
      UNION ALL
      SELECT amount FROM public.expenses
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH' AND expense_date < p_from_date
      UNION ALL
      SELECT principal FROM public.loan_repayments lr
      JOIN public.loans l ON l.id = lr.loan_id
      WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.mode = 'CASH' AND lr.repayment_date < p_from_date
      UNION ALL
      SELECT amount FROM public.money_transfers
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'CASH_TO_BANK' AND transfer_date < p_from_date
    ) prior_out;

    v_cash_opening := COALESCE(v_biz.opening_cash_balance, 0) + v_cash_prior_in - v_cash_prior_out;
  ELSE
    v_cash_opening := COALESCE(v_biz.opening_cash_balance, 0);
  END IF;

  -- 2. Receipts in cash
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_receipts
  FROM public.receipts
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'
    AND (p_from_date IS NULL OR receipt_date >= p_from_date)
    AND (p_to_date IS NULL OR receipt_date <= p_to_date);

  -- 3. Withdrawals (Bank to Cash)
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_withdrawals
  FROM public.money_transfers
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'BANK_TO_CASH'
    AND (p_from_date IS NULL OR transfer_date >= p_from_date)
    AND (p_to_date IS NULL OR transfer_date <= p_to_date);

  v_cash_total_in := v_cash_receipts + v_cash_withdrawals;

  -- 4. Payments in cash
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_payments
  FROM public.payments
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'
    AND (p_from_date IS NULL OR payment_date >= p_from_date)
    AND (p_to_date IS NULL OR payment_date <= p_to_date);

  -- 5. Expenses in cash
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'
    AND (p_from_date IS NULL OR expense_date >= p_from_date)
    AND (p_to_date IS NULL OR expense_date <= p_to_date);

  -- 6. Loan principal repayments in cash
  SELECT COALESCE(SUM(lr.principal), 0) INTO v_cash_loan_repayments
  FROM public.loan_repayments lr
  JOIN public.loans l ON l.id = lr.loan_id
  WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.mode = 'CASH'
    AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date)
    AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date);

  -- 7. Deposits (Cash to Bank)
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_deposits
  FROM public.money_transfers
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'CASH_TO_BANK'
    AND (p_from_date IS NULL OR transfer_date >= p_from_date)
    AND (p_to_date IS NULL OR transfer_date <= p_to_date);

  v_cash_total_out := v_cash_payments + v_cash_expenses + v_cash_loan_repayments + v_cash_deposits;

  v_cash_current_balance := v_cash_opening + v_cash_total_in - v_cash_total_out;

  -- All-time balance
  v_cash_all_time_balance := COALESCE(v_biz.opening_cash_balance, 0)
    + COALESCE((SELECT SUM(amount) FROM public.receipts WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'), 0)
    + COALESCE((SELECT SUM(amount) FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'BANK_TO_CASH'), 0)
    - COALESCE((SELECT SUM(amount) FROM public.payments WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'), 0)
    - COALESCE((SELECT SUM(amount) FROM public.expenses WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'), 0)
    - COALESCE((SELECT SUM(lr.principal) FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.mode = 'CASH'), 0)
    - COALESCE((SELECT SUM(amount) FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'CASH_TO_BANK'), 0);

  -- 8. Bank Accounts with individual opening & closing balances
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ba.id,
        'bank_name', ba.bank_name,
        'account_name', ba.account_name,
        'account_number', ba.account_number,
        'ifsc', ba.ifsc,
        'upi_id', ba.upi_id,
        'active', ba.active,
        'opening_balance', ba_calc.opening_bal,
        'total_in', ba_calc.period_in,
        'total_out', ba_calc.period_out,
        'current_balance', ba_calc.closing_bal,
        'all_time_balance', ba_calc.all_time_bal
      ) ORDER BY ba.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_bank_accounts
  FROM public.bank_accounts ba
  CROSS JOIN LATERAL (
    SELECT
      -- Prior in
      COALESCE(ba.opening_balance, 0)
      + COALESCE((
        SELECT SUM(amount) FROM (
          SELECT amount FROM public.receipts WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NOT NULL AND receipt_date < p_from_date)
          UNION ALL
          SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND to_bank_account_id = ba.id AND (p_from_date IS NOT NULL AND transfer_date < p_from_date)
        ) b_prior_in
      ), 0)
      - COALESCE((
        SELECT SUM(amount) FROM (
          SELECT amount FROM public.payments WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NOT NULL AND payment_date < p_from_date)
          UNION ALL
          SELECT amount FROM public.expenses WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NOT NULL AND expense_date < p_from_date)
          UNION ALL
          SELECT lr.principal FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.bank_account_id = ba.id AND (p_from_date IS NOT NULL AND lr.repayment_date < p_from_date)
          UNION ALL
          SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND from_bank_account_id = ba.id AND (p_from_date IS NOT NULL AND transfer_date < p_from_date)
        ) b_prior_out
      ), 0) AS opening_bal,

      -- Period in
      COALESCE((
        SELECT SUM(amount) FROM (
          SELECT amount FROM public.receipts WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NULL OR receipt_date >= p_from_date) AND (p_to_date IS NULL OR receipt_date <= p_to_date)
          UNION ALL
          SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND to_bank_account_id = ba.id AND (p_from_date IS NULL OR transfer_date >= p_from_date) AND (p_to_date IS NULL OR transfer_date <= p_to_date)
        ) b_period_in
      ), 0) AS period_in,

      -- Period out
      COALESCE((
        SELECT SUM(amount) FROM (
          SELECT amount FROM public.payments WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NULL OR payment_date >= p_from_date) AND (p_to_date IS NULL OR payment_date <= p_to_date)
          UNION ALL
          SELECT amount FROM public.expenses WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NULL OR expense_date >= p_from_date) AND (p_to_date IS NULL OR expense_date <= p_to_date)
          UNION ALL
          SELECT lr.principal FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.bank_account_id = ba.id AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date) AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date)
          UNION ALL
          SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND from_bank_account_id = ba.id AND (p_from_date IS NULL OR transfer_date >= p_from_date) AND (p_to_date IS NULL OR transfer_date <= p_to_date)
        ) b_period_out
      ), 0) AS period_out,

      -- Closing balance
      (
        COALESCE(ba.opening_balance, 0)
        + COALESCE((
          SELECT SUM(amount) FROM (
            SELECT amount FROM public.receipts WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NOT NULL AND receipt_date < p_from_date)
            UNION ALL
            SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND to_bank_account_id = ba.id AND (p_from_date IS NOT NULL AND transfer_date < p_from_date)
          ) b_p_in
        ), 0)
        - COALESCE((
          SELECT SUM(amount) FROM (
            SELECT amount FROM public.payments WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NOT NULL AND payment_date < p_from_date)
            UNION ALL
            SELECT amount FROM public.expenses WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NOT NULL AND expense_date < p_from_date)
            UNION ALL
            SELECT lr.principal FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.bank_account_id = ba.id AND (p_from_date IS NOT NULL AND lr.repayment_date < p_from_date)
            UNION ALL
            SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND from_bank_account_id = ba.id AND (p_from_date IS NOT NULL AND transfer_date < p_from_date)
          ) b_p_out
        ), 0)
      ) + (
        COALESCE((
          SELECT SUM(amount) FROM (
            SELECT amount FROM public.receipts WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NULL OR receipt_date >= p_from_date) AND (p_to_date IS NULL OR receipt_date <= p_to_date)
            UNION ALL
            SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND to_bank_account_id = ba.id AND (p_from_date IS NULL OR transfer_date >= p_from_date) AND (p_to_date IS NULL OR transfer_date <= p_to_date)
          ) b_cur_in
        ), 0)
        - COALESCE((
          SELECT SUM(amount) FROM (
            SELECT amount FROM public.payments WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NULL OR payment_date >= p_from_date) AND (p_to_date IS NULL OR payment_date <= p_to_date)
            UNION ALL
            SELECT amount FROM public.expenses WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id AND (p_from_date IS NULL OR expense_date >= p_from_date) AND (p_to_date IS NULL OR expense_date <= p_to_date)
            UNION ALL
            SELECT lr.principal FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.bank_account_id = ba.id AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date) AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date)
            UNION ALL
            SELECT amount FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND from_bank_account_id = ba.id AND (p_from_date IS NULL OR transfer_date >= p_from_date) AND (p_to_date IS NULL OR transfer_date <= p_to_date)
          ) b_cur_out
        ), 0)
      ) AS closing_bal,

      -- All time balance
      COALESCE(ba.opening_balance, 0)
      + COALESCE((SELECT SUM(amount) FROM public.receipts WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id), 0)
      + COALESCE((SELECT SUM(amount) FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND to_bank_account_id = ba.id), 0)
      - COALESCE((SELECT SUM(amount) FROM public.payments WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id), 0)
      - COALESCE((SELECT SUM(amount) FROM public.expenses WHERE business_id = v_biz_id AND deleted_at IS NULL AND bank_account_id = ba.id), 0)
      - COALESCE((SELECT SUM(lr.principal) FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.bank_account_id = ba.id), 0)
      - COALESCE((SELECT SUM(amount) FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND from_bank_account_id = ba.id), 0) AS all_time_bal
  ) ba_calc
  WHERE ba.business_id = v_biz_id AND ba.deleted_at IS NULL;

  -- 9. Sum of closing bank balances
  SELECT COALESCE(SUM((elem->>'current_balance')::numeric), 0)
  INTO v_total_bank_balance
  FROM jsonb_array_elements(v_bank_accounts) AS elem;

  -- 10. Recent Transfers
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', mt.id,
        'transfer_date', mt.transfer_date,
        'transfer_type', mt.transfer_type,
        'amount', mt.amount,
        'from_bank_account_id', mt.from_bank_account_id,
        'to_bank_account_id', mt.to_bank_account_id,
        'from_bank_name', fb.bank_name,
        'to_bank_name', tb.bank_name,
        'notes', mt.notes,
        'created_at', mt.created_at
      ) ORDER BY mt.transfer_date DESC, mt.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_recent_transfers
  FROM public.money_transfers mt
  LEFT JOIN public.bank_accounts fb ON fb.id = mt.from_bank_account_id
  LEFT JOIN public.bank_accounts tb ON tb.id = mt.to_bank_account_id
  WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
    AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
    AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)
  LIMIT 20;

  RETURN jsonb_build_object(
    'cash', jsonb_build_object(
      'opening_balance', v_cash_opening,
      'total_in', v_cash_total_in,
      'total_out', v_cash_total_out,
      'current_balance', v_cash_current_balance,
      'all_time_balance', v_cash_all_time_balance
    ),
    'cash_in_hand', jsonb_build_object(
      'opening_balance', v_cash_opening,
      'total_in', v_cash_total_in,
      'total_out', v_cash_total_out,
      'current_balance', v_cash_current_balance,
      'all_time_balance', v_cash_all_time_balance
    ),
    'bank_accounts', v_bank_accounts,
    'total_bank_balance', v_total_bank_balance,
    'total_liquid_funds', v_cash_current_balance + v_total_bank_balance,
    'recent_transfers', v_recent_transfers
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.cash_bank_summary(date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cash_bank_summary(date, date) TO authenticated;


-- 2. Upgrade bank_ledger with Owner check
CREATE OR REPLACE FUNCTION public.bank_ledger(
  p_bank_account_id uuid DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_accounts jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_tot_in numeric(14,2) := 0;
  v_tot_out numeric(14,2) := 0;
  v_opening_balance numeric(14,2) := 0;
  v_closing_balance numeric(14,2) := 0;
  v_summary_data jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can view bank ledgers';
  END IF;

  -- 1. Get accurate opening & summary info from upgraded cash_bank_summary
  v_summary_data := public.cash_bank_summary(p_from_date, p_to_date);
  v_accounts := COALESCE(v_summary_data->'bank_accounts', '[]'::jsonb);

  -- 2. Determine target opening balance
  IF p_bank_account_id IS NOT NULL THEN
    SELECT COALESCE((elem->>'opening_balance')::numeric, 0)
    INTO v_opening_balance
    FROM jsonb_array_elements(v_accounts) AS elem
    WHERE (elem->>'id')::uuid = p_bank_account_id;
  ELSE
    SELECT COALESCE(SUM((elem->>'opening_balance')::numeric), 0)
    INTO v_opening_balance
    FROM jsonb_array_elements(v_accounts) AS elem;
  END IF;

  -- 3. Union of all bank movements within [p_from_date, p_to_date]
  WITH bank_txns AS (
    -- 1. Money IN: Receipts
    SELECT
      r.id,
      r.receipt_date AS date,
      'RECEIPT' AS txn_type,
      'Receipt: ' || r.number || COALESCE(' - ' || c.name, '') AS description,
      r.bank_account_id,
      ba.bank_name,
      ba.account_number,
      r.amount AS in_amount,
      0::numeric(14,2) AS out_amount,
      r.mode,
      r.reference,
      r.created_at
    FROM public.receipts r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    LEFT JOIN public.bank_accounts ba ON ba.id = r.bank_account_id
    WHERE r.business_id = v_biz_id
      AND r.deleted_at IS NULL
      AND r.bank_account_id IS NOT NULL
      AND (p_bank_account_id IS NULL OR r.bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR r.receipt_date >= p_from_date)
      AND (p_to_date IS NULL OR r.receipt_date <= p_to_date)

    UNION ALL

    -- 2. Money IN: Transfer to bank
    SELECT
      mt.id,
      mt.transfer_date AS date,
      'TRANSFER_IN' AS txn_type,
      CASE 
        WHEN mt.transfer_type = 'CASH_TO_BANK' THEN 'Cash Deposit'
        ELSE 'Transfer from ' || COALESCE(fb.bank_name, 'Other Bank')
      END AS description,
      mt.to_bank_account_id AS bank_account_id,
      tb.bank_name,
      tb.account_number,
      mt.amount AS in_amount,
      0::numeric(14,2) AS out_amount,
      'CONTRA' AS mode,
      mt.notes AS reference,
      mt.created_at
    FROM public.money_transfers mt
    JOIN public.bank_accounts tb ON tb.id = mt.to_bank_account_id
    LEFT JOIN public.bank_accounts fb ON fb.id = mt.from_bank_account_id
    WHERE mt.business_id = v_biz_id
      AND mt.deleted_at IS NULL
      AND (p_bank_account_id IS NULL OR mt.to_bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
      AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)

    UNION ALL

    -- 3. Money OUT: Payments
    SELECT
      p.id,
      p.payment_date AS date,
      'PAYMENT' AS txn_type,
      'Payment to ' || COALESCE(v.name, 'Vendor') || ': ' || p.description AS description,
      p.bank_account_id,
      ba.bank_name,
      ba.account_number,
      0::numeric(14,2) AS in_amount,
      p.amount AS out_amount,
      p.mode,
      p.notes AS reference,
      p.created_at
    FROM public.payments p
    LEFT JOIN public.vendors v ON v.id = p.vendor_id
    LEFT JOIN public.bank_accounts ba ON ba.id = p.bank_account_id
    WHERE p.business_id = v_biz_id
      AND p.deleted_at IS NULL
      AND p.bank_account_id IS NOT NULL
      AND (p_bank_account_id IS NULL OR p.bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR p.payment_date <= p_to_date)

    UNION ALL

    -- 4. Money OUT: Expenses
    SELECT
      e.id,
      e.expense_date AS date,
      'EXPENSE' AS txn_type,
      'Expense: ' || ec.name || ' - ' || e.description AS description,
      e.bank_account_id,
      ba.bank_name,
      ba.account_number,
      0::numeric(14,2) AS in_amount,
      e.amount AS out_amount,
      e.mode,
      e.notes AS reference,
      e.created_at
    FROM public.expenses e
    LEFT JOIN public.expense_categories ec ON ec.id = e.category_id
    LEFT JOIN public.bank_accounts ba ON ba.id = e.bank_account_id
    WHERE e.business_id = v_biz_id
      AND e.deleted_at IS NULL
      AND e.bank_account_id IS NOT NULL
      AND (p_bank_account_id IS NULL OR e.bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR e.expense_date >= p_from_date)
      AND (p_to_date IS NULL OR e.expense_date <= p_to_date)

    UNION ALL

    -- 5. Money OUT: Loan Repayments
    SELECT
      lr.id,
      lr.repayment_date AS date,
      'LOAN_REPAY' AS txn_type,
      'Loan Repayment to ' || l.lender_name || ' (P: ' || lr.principal || ', I: ' || lr.interest || ')' AS description,
      lr.bank_account_id,
      ba.bank_name,
      ba.account_number,
      0::numeric(14,2) AS in_amount,
      (lr.principal + lr.interest) AS out_amount,
      lr.mode,
      lr.notes AS reference,
      lr.created_at
    FROM public.loan_repayments lr
    JOIN public.loans l ON l.id = lr.loan_id
    LEFT JOIN public.bank_accounts ba ON ba.id = lr.bank_account_id
    WHERE l.business_id = v_biz_id
      AND lr.deleted_at IS NULL
      AND lr.bank_account_id IS NOT NULL
      AND (p_bank_account_id IS NULL OR lr.bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date)
      AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date)

    UNION ALL

    -- 6. Money OUT: Transfer from bank
    SELECT
      mt.id,
      mt.transfer_date AS date,
      'TRANSFER_OUT' AS txn_type,
      CASE 
        WHEN mt.transfer_type = 'BANK_TO_CASH' THEN 'Cash Withdrawal'
        ELSE 'Transfer to ' || COALESCE(tb.bank_name, 'Other Bank')
      END AS description,
      mt.from_bank_account_id AS bank_account_id,
      fb.bank_name,
      fb.account_number,
      0::numeric(14,2) AS in_amount,
      mt.amount AS out_amount,
      'CONTRA' AS mode,
      mt.notes AS reference,
      mt.created_at
    FROM public.money_transfers mt
    JOIN public.bank_accounts fb ON fb.id = mt.from_bank_account_id
    LEFT JOIN public.bank_accounts tb ON tb.id = mt.to_bank_account_id
    WHERE mt.business_id = v_biz_id
      AND mt.deleted_at IS NULL
      AND (p_bank_account_id IS NULL OR mt.from_bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
      AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)
  ),
  running_txns AS (
    SELECT 
      bt.*,
      SUM(bt.in_amount - bt.out_amount) OVER (
        ORDER BY bt.date ASC, bt.created_at ASC 
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) + v_opening_balance AS running_balance
    FROM bank_txns bt
  )
  SELECT 
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', rt.id,
          'date', rt.date,
          'txn_type', rt.txn_type,
          'description', rt.description,
          'bank_account_id', rt.bank_account_id,
          'bank_name', rt.bank_name,
          'account_number', rt.account_number,
          'in_amount', rt.in_amount,
          'out_amount', rt.out_amount,
          'mode', rt.mode,
          'reference', rt.reference,
          'running_balance', rt.running_balance,
          'created_at', rt.created_at
        ) ORDER BY rt.date ASC, rt.created_at ASC
      ),
      '[]'::jsonb
    ),
    COALESCE(SUM(rt.in_amount), 0),
    COALESCE(SUM(rt.out_amount), 0)
  INTO v_entries, v_tot_in, v_tot_out
  FROM running_txns rt;

  v_closing_balance := v_opening_balance + v_tot_in - v_tot_out;

  RETURN jsonb_build_object(
    'bank_account_id', p_bank_account_id,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'opening_balance', v_opening_balance,
    'total_in', v_tot_in,
    'total_out', v_tot_out,
    'closing_balance', v_closing_balance,
    'entries', v_entries
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.bank_ledger(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bank_ledger(uuid, date, date) TO authenticated;


-- 3. Upgrade purge_deleted_records with Owner check and tenant scoping
CREATE OR REPLACE FUNCTION public.purge_deleted_records()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_cutoff timestamptz := now() - interval '30 days';
  v_count int := 0;
  v_step_count int := 0;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can purge deleted records';
  END IF;

  -- 1. Purge job_type_steps for soft-deleted services
  DELETE FROM public.job_type_steps
  WHERE business_id = v_biz_id AND service_id IN (SELECT id FROM public.services WHERE business_id = v_biz_id AND deleted_at < v_cutoff);
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 2. Purge standalone receipts (no allocations)
  DELETE FROM public.receipts
  WHERE business_id = v_biz_id AND deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.receipt_allocations WHERE business_id = v_biz_id AND receipt_id = receipts.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 3. Purge payments
  DELETE FROM public.payments WHERE business_id = v_biz_id AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 4. Purge unlinked expenses (no salary payout or loan repayment links)
  DELETE FROM public.expenses
  WHERE business_id = v_biz_id AND deleted_at < v_cutoff AND staff_id IS NULL AND loan_repayment_id IS NULL;
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 5. Purge loans (if no repayments)
  DELETE FROM public.loans
  WHERE business_id = v_biz_id AND deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.loan_repayments WHERE loan_id = loans.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 6. Purge vendors (if no payments)
  DELETE FROM public.vendors
  WHERE business_id = v_biz_id AND deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.payments WHERE business_id = v_biz_id AND vendor_id = vendors.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 7. Purge services (if not used in invoice items or jobs)
  DELETE FROM public.services
  WHERE business_id = v_biz_id AND deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.invoice_items WHERE business_id = v_biz_id AND service_id = services.id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.jobs WHERE business_id = v_biz_id AND service_id = services.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 8. Purge customers (if no invoices and no receipts)
  DELETE FROM public.customers
  WHERE business_id = v_biz_id AND deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.invoices WHERE business_id = v_biz_id AND customer_id = customers.id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.receipts WHERE business_id = v_biz_id AND customer_id = customers.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 9. Purge whatsapp_templates
  DELETE FROM public.whatsapp_templates WHERE business_id = v_biz_id AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 10. Purge money_transfers
  DELETE FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  RETURN jsonb_build_object(
    'success', true,
    'purged_rows', v_count,
    'purged_count', v_count,
    'cutoff', v_cutoff
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.purge_deleted_records() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.purge_deleted_records() TO authenticated;
