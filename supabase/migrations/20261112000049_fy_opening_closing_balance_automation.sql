-- Migration 49: Financial Year (FY) Automatic Opening & Closing Balance Roll-Forward
-- Seamlessly computes Opening Balance strictly before p_from_date from prior transactions,
-- ensuring that when a new FY begins, previous year's closing balances carry forward automatically
-- without any manual year-end closing entries or user headaches.

-- 1. Upgrade cash_bank_summary to dynamically calculate Opening & Closing balances per period
CREATE OR REPLACE FUNCTION public.cash_bank_summary(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
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
    ) prior_in_q;

    -- Outflows prior to p_from_date
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_prior_out
    FROM (
      SELECT amount FROM public.payments
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH' AND payment_date < p_from_date
      UNION ALL
      SELECT amount FROM public.expenses
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH' AND expense_date < p_from_date
      UNION ALL
      SELECT (lr.principal + lr.interest) AS amount FROM public.loan_repayments lr
      JOIN public.loans l ON l.id = lr.loan_id
      WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.mode = 'CASH' AND lr.repayment_date < p_from_date
      UNION ALL
      SELECT amount FROM public.money_transfers
      WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'CASH_TO_BANK' AND transfer_date < p_from_date
    ) prior_out_q;

    v_cash_opening := COALESCE(v_biz.opening_cash_balance, 0.00) + v_cash_prior_in - v_cash_prior_out;
  ELSE
    v_cash_opening := COALESCE(v_biz.opening_cash_balance, 0.00);
  END IF;

  -- 2. Cash Inflow during the period [p_from_date, p_to_date]
  -- A. Cash Receipts
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_receipts
  FROM public.receipts
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'
    AND (p_from_date IS NULL OR receipt_date >= p_from_date)
    AND (p_to_date IS NULL OR receipt_date <= p_to_date);

  -- B. Withdrawals to Cash (Contra transfers: BANK_TO_CASH)
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_withdrawals
  FROM public.money_transfers
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'BANK_TO_CASH'
    AND (p_from_date IS NULL OR transfer_date >= p_from_date)
    AND (p_to_date IS NULL OR transfer_date <= p_to_date);

  v_cash_total_in := v_cash_receipts + v_cash_withdrawals;

  -- 3. Cash Outflow during the period [p_from_date, p_to_date]
  -- A. Cash Vendor Payments
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_payments
  FROM public.payments
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'
    AND (p_from_date IS NULL OR payment_date >= p_from_date)
    AND (p_to_date IS NULL OR payment_date <= p_to_date);

  -- B. Cash Expenses
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
  FROM public.expenses
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'
    AND (p_from_date IS NULL OR expense_date >= p_from_date)
    AND (p_to_date IS NULL OR expense_date <= p_to_date);

  -- C. Cash Loan Repayments
  SELECT COALESCE(SUM(lr.principal + lr.interest), 0) INTO v_cash_loan_repayments
  FROM public.loan_repayments lr
  JOIN public.loans l ON l.id = lr.loan_id
  WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.mode = 'CASH'
    AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date)
    AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date);

  -- D. Deposits to Bank from Cash (Contra transfers: CASH_TO_BANK)
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_deposits
  FROM public.money_transfers
  WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'CASH_TO_BANK'
    AND (p_from_date IS NULL OR transfer_date >= p_from_date)
    AND (p_to_date IS NULL OR transfer_date <= p_to_date);

  v_cash_total_out := v_cash_payments + v_cash_expenses + v_cash_loan_repayments + v_cash_deposits;
  v_cash_current_balance := v_cash_opening + v_cash_total_in - v_cash_total_out;

  -- All-time drawer cash (live right now)
  SELECT (
    COALESCE(v_biz.opening_cash_balance, 0.00)
    + COALESCE((SELECT SUM(amount) FROM public.receipts WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'), 0)
    + COALESCE((SELECT SUM(amount) FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'BANK_TO_CASH'), 0)
    - COALESCE((SELECT SUM(amount) FROM public.payments WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'), 0)
    - COALESCE((SELECT SUM(amount) FROM public.expenses WHERE business_id = v_biz_id AND deleted_at IS NULL AND mode = 'CASH'), 0)
    - COALESCE((SELECT SUM(lr.principal + lr.interest) FROM public.loan_repayments lr JOIN public.loans l ON l.id = lr.loan_id WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL AND lr.mode = 'CASH'), 0)
    - COALESCE((SELECT SUM(amount) FROM public.money_transfers WHERE business_id = v_biz_id AND deleted_at IS NULL AND transfer_type = 'CASH_TO_BANK'), 0)
  ) INTO v_cash_all_time_balance;

  -- 4. Individual Bank Accounts breakdown (Accurate Opening + Period Flow = Closing)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ba.id,
      'bank_name', ba.bank_name,
      'account_name', ba.account_name,
      'account_number', ba.account_number,
      'ifsc', ba.ifsc,
      'upi_id', ba.upi_id,
      'initial_setup_balance', ba.opening_balance,
      'opening_balance', sub.period_opening,
      'total_in', sub.period_in,
      'total_out', sub.period_out,
      'current_balance', (sub.period_opening + sub.period_in - sub.period_out),
      'all_time_balance', (ba.opening_balance + sub.all_in - sub.all_out)
    ) ORDER BY ba.created_at ASC
  ), '[]'::jsonb)
  INTO v_bank_accounts
  FROM public.bank_accounts ba
  CROSS JOIN LATERAL (
    SELECT
      -- A. Prior IN strictly before p_from_date
      COALESCE((
        CASE WHEN p_from_date IS NOT NULL THEN
          COALESCE((
            SELECT SUM(r.amount) FROM public.receipts r
            WHERE r.business_id = v_biz_id AND r.deleted_at IS NULL
              AND (r.bank_account_id = ba.id OR (r.bank_account_id IS NULL AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
              AND r.receipt_date < p_from_date
          ), 0) +
          COALESCE((
            SELECT SUM(mt.amount) FROM public.money_transfers mt
            WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
              AND mt.to_bank_account_id = ba.id
              AND mt.transfer_date < p_from_date
          ), 0)
        ELSE 0 END
      ), 0) AS prior_in,

      -- B. Prior OUT strictly before p_from_date
      COALESCE((
        CASE WHEN p_from_date IS NOT NULL THEN
          COALESCE((
            SELECT SUM(p.amount) FROM public.payments p
            WHERE p.business_id = v_biz_id AND p.deleted_at IS NULL
              AND (p.bank_account_id = ba.id OR (p.bank_account_id IS NULL AND p.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
              AND p.payment_date < p_from_date
          ), 0) +
          COALESCE((
            SELECT SUM(e.amount) FROM public.expenses e
            WHERE e.business_id = v_biz_id AND e.deleted_at IS NULL
              AND (e.bank_account_id = ba.id OR (e.bank_account_id IS NULL AND e.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
              AND e.expense_date < p_from_date
          ), 0) +
          COALESCE((
            SELECT SUM(lr.principal + lr.interest) FROM public.loan_repayments lr
            JOIN public.loans l ON l.id = lr.loan_id
            WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL
              AND (lr.bank_account_id = ba.id OR (lr.bank_account_id IS NULL AND lr.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
              AND lr.repayment_date < p_from_date
          ), 0) +
          COALESCE((
            SELECT SUM(mt.amount) FROM public.money_transfers mt
            WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
              AND mt.from_bank_account_id = ba.id
              AND mt.transfer_date < p_from_date
          ), 0)
        ELSE 0 END
      ), 0) AS prior_out,

      -- C. Period IN [p_from_date, p_to_date]
      (
        COALESCE((
          SELECT SUM(r.amount) FROM public.receipts r
          WHERE r.business_id = v_biz_id AND r.deleted_at IS NULL
            AND (r.bank_account_id = ba.id OR (r.bank_account_id IS NULL AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
            AND (p_from_date IS NULL OR r.receipt_date >= p_from_date)
            AND (p_to_date IS NULL OR r.receipt_date <= p_to_date)
        ), 0) +
        COALESCE((
          SELECT SUM(mt.amount) FROM public.money_transfers mt
          WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
            AND mt.to_bank_account_id = ba.id
            AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
            AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)
        ), 0)
      ) AS period_in,

      -- D. Period OUT [p_from_date, p_to_date]
      (
        COALESCE((
          SELECT SUM(p.amount) FROM public.payments p
          WHERE p.business_id = v_biz_id AND p.deleted_at IS NULL
            AND (p.bank_account_id = ba.id OR (p.bank_account_id IS NULL AND p.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
            AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
            AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
        ), 0) +
        COALESCE((
          SELECT SUM(e.amount) FROM public.expenses e
          WHERE e.business_id = v_biz_id AND e.deleted_at IS NULL
            AND (e.bank_account_id = ba.id OR (e.bank_account_id IS NULL AND e.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
            AND (p_from_date IS NULL OR e.expense_date >= p_from_date)
            AND (p_to_date IS NULL OR e.expense_date <= p_to_date)
        ), 0) +
        COALESCE((
          SELECT SUM(lr.principal + lr.interest) FROM public.loan_repayments lr
          JOIN public.loans l ON l.id = lr.loan_id
          WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL
            AND (lr.bank_account_id = ba.id OR (lr.bank_account_id IS NULL AND lr.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
            AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date)
            AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date)
        ), 0) +
        COALESCE((
          SELECT SUM(mt.amount) FROM public.money_transfers mt
          WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
            AND mt.from_bank_account_id = ba.id
            AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
            AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)
        ), 0)
      ) AS period_out,

      -- E. All-time IN (regardless of dates)
      (
        COALESCE((
          SELECT SUM(r.amount) FROM public.receipts r
          WHERE r.business_id = v_biz_id AND r.deleted_at IS NULL
            AND (r.bank_account_id = ba.id OR (r.bank_account_id IS NULL AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT SUM(mt.amount) FROM public.money_transfers mt
          WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
            AND mt.to_bank_account_id = ba.id
        ), 0)
      ) AS all_in,

      -- F. All-time OUT (regardless of dates)
      (
        COALESCE((
          SELECT SUM(p.amount) FROM public.payments p
          WHERE p.business_id = v_biz_id AND p.deleted_at IS NULL
            AND (p.bank_account_id = ba.id OR (p.bank_account_id IS NULL AND p.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT SUM(e.amount) FROM public.expenses e
          WHERE e.business_id = v_biz_id AND e.deleted_at IS NULL
            AND (e.bank_account_id = ba.id OR (e.bank_account_id IS NULL AND e.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT SUM(lr.principal + lr.interest) FROM public.loan_repayments lr
          JOIN public.loans l ON l.id = lr.loan_id
          WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL
            AND (lr.bank_account_id = ba.id OR (lr.bank_account_id IS NULL AND lr.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT SUM(mt.amount) FROM public.money_transfers mt
          WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
            AND mt.from_bank_account_id = ba.id
        ), 0)
      ) AS all_out,

      -- G. Dynamic Period Opening Balance
      (ba.opening_balance + 
        CASE WHEN p_from_date IS NOT NULL THEN
          (
            COALESCE((
              SELECT SUM(r.amount) FROM public.receipts r
              WHERE r.business_id = v_biz_id AND r.deleted_at IS NULL
                AND (r.bank_account_id = ba.id OR (r.bank_account_id IS NULL AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
                AND r.receipt_date < p_from_date
            ), 0) +
            COALESCE((
              SELECT SUM(mt.amount) FROM public.money_transfers mt
              WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
                AND mt.to_bank_account_id = ba.id
                AND mt.transfer_date < p_from_date
            ), 0)
          ) - (
            COALESCE((
              SELECT SUM(p.amount) FROM public.payments p
              WHERE p.business_id = v_biz_id AND p.deleted_at IS NULL
                AND (p.bank_account_id = ba.id OR (p.bank_account_id IS NULL AND p.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
                AND p.payment_date < p_from_date
            ), 0) +
            COALESCE((
              SELECT SUM(e.amount) FROM public.expenses e
              WHERE e.business_id = v_biz_id AND e.deleted_at IS NULL
                AND (e.bank_account_id = ba.id OR (e.bank_account_id IS NULL AND e.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
                AND e.expense_date < p_from_date
            ), 0) +
            COALESCE((
              SELECT SUM(lr.principal + lr.interest) FROM public.loan_repayments lr
              JOIN public.loans l ON l.id = lr.loan_id
              WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL
                AND (lr.bank_account_id = ba.id OR (lr.bank_account_id IS NULL AND lr.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
                AND lr.repayment_date < p_from_date
            ), 0) +
            COALESCE((
              SELECT SUM(mt.amount) FROM public.money_transfers mt
              WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
                AND mt.from_bank_account_id = ba.id
                AND mt.transfer_date < p_from_date
            ), 0)
          )
        ELSE 0 END
      ) AS period_opening
  ) sub
  WHERE ba.business_id = v_biz_id AND ba.deleted_at IS NULL;

  -- 5. Total Bank Balance across all active accounts for the period
  SELECT COALESCE(SUM((val->>'current_balance')::numeric), 0)
  INTO v_total_bank_balance
  FROM jsonb_array_elements(v_bank_accounts) AS val;

  -- 6. Recent Contra Transfers in period
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', mt.id,
      'transfer_date', mt.transfer_date,
      'transfer_type', mt.transfer_type,
      'amount', mt.amount,
      'from_account_name', COALESCE(fba.bank_name, 'Cash in Hand'),
      'to_account_name', COALESCE(tba.bank_name, 'Cash in Hand'),
      'reference', mt.reference,
      'notes', mt.notes,
      'created_at', mt.created_at
    ) ORDER BY mt.transfer_date DESC, mt.created_at DESC
  ), '[]'::jsonb)
  INTO v_recent_transfers
  FROM public.money_transfers mt
  LEFT JOIN public.bank_accounts fba ON fba.id = mt.from_bank_account_id
  LEFT JOIN public.bank_accounts tba ON tba.id = mt.to_bank_account_id
  WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
    AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
    AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date);

  RETURN jsonb_build_object(
    'cash_in_hand', jsonb_build_object(
      'opening_balance', v_cash_opening,
      'total_in', v_cash_total_in,
      'total_out', v_cash_total_out,
      'current_balance', v_cash_current_balance,
      'live_balance', v_cash_all_time_balance,
      'receipts', v_cash_receipts,
      'withdrawals', v_cash_withdrawals,
      'payments', v_cash_payments,
      'expenses', v_cash_expenses,
      'loan_repayments', v_cash_loan_repayments,
      'deposits', v_cash_deposits
    ),
    'bank_accounts', v_bank_accounts,
    'total_bank_balance', v_total_bank_balance,
    'total_liquid_funds', (v_cash_current_balance + v_total_bank_balance),
    'recent_transfers', v_recent_transfers
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.cash_bank_summary(date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cash_bank_summary(date, date) TO authenticated;

-- 2. Upgrade bank_ledger to automatically compute true Opening Balance on p_from_date
-- and provide consecutive running passbook balances
CREATE OR REPLACE FUNCTION public.bank_ledger(
  p_bank_account_id uuid DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_accounts jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_tot_in numeric(14,2) := 0;
  v_tot_out numeric(14,2) := 0;
  v_opening_balance numeric(14,2) := 0;
  v_closing_balance numeric(14,2) := 0;
  v_summary_data jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

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
      r.receipt_date AS txn_date,
      'RECEIPT' AS txn_type,
      'IN' AS direction,
      r.amount AS in_amount,
      0::numeric(14,2) AS out_amount,
      r.mode,
      COALESCE(r.reference, r.number) AS ref_no,
      COALESCE(c.name, 'Other Income') AS party_name,
      COALESCE(r.notes, r.income_category, 'Customer Receipt') AS description,
      r.bank_account_id,
      COALESCE(r.bank_name, ba.bank_name, r.mode) AS bank_label,
      r.created_at
    FROM public.receipts r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    LEFT JOIN public.bank_accounts ba ON ba.id = r.bank_account_id
    WHERE r.business_id = v_biz_id AND r.deleted_at IS NULL
      AND (
        (p_bank_account_id IS NOT NULL AND r.bank_account_id = p_bank_account_id)
        OR (p_bank_account_id IS NULL AND (r.bank_account_id IS NOT NULL OR r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE')))
      )
      AND (p_from_date IS NULL OR r.receipt_date >= p_from_date)
      AND (p_to_date IS NULL OR r.receipt_date <= p_to_date)

    UNION ALL

    -- 2. Money IN: Incoming Transfers (Cash Deposit or Inward Bank-to-Bank)
    SELECT
      mt.id,
      mt.transfer_date AS txn_date,
      'TRANSFER_IN' AS txn_type,
      'IN' AS direction,
      mt.amount AS in_amount,
      0::numeric(14,2) AS out_amount,
      CASE WHEN mt.transfer_type = 'CASH_TO_BANK' THEN 'CASH' ELSE 'BANK' END AS mode,
      COALESCE(mt.reference, 'Deposit') AS ref_no,
      CASE 
        WHEN mt.transfer_type = 'CASH_TO_BANK' THEN 'Cash Deposit (Contra)'
        ELSE 'Transfer from ' || COALESCE(fba.bank_name, 'Bank')
      END AS party_name,
      COALESCE(mt.notes, 'Internal Contra Transfer') AS description,
      mt.to_bank_account_id AS bank_account_id,
      tba.bank_name AS bank_label,
      mt.created_at
    FROM public.money_transfers mt
    JOIN public.bank_accounts tba ON tba.id = mt.to_bank_account_id
    LEFT JOIN public.bank_accounts fba ON fba.id = mt.from_bank_account_id
    WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
      AND (p_bank_account_id IS NULL OR mt.to_bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
      AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)

    UNION ALL

    -- 3. Money OUT: Vendor Payments
    SELECT 
      p.id,
      p.payment_date AS txn_date,
      'PAYMENT' AS txn_type,
      'OUT' AS direction,
      0::numeric(14,2) AS in_amount,
      p.amount AS out_amount,
      p.mode,
      COALESCE(p.notes, 'Vendor Pmt') AS ref_no,
      v.name AS party_name,
      p.description AS description,
      p.bank_account_id,
      COALESCE(p.bank_name, ba.bank_name, p.mode) AS bank_label,
      p.created_at
    FROM public.payments p
    LEFT JOIN public.vendors v ON v.id = p.vendor_id
    LEFT JOIN public.bank_accounts ba ON ba.id = p.bank_account_id
    WHERE p.business_id = v_biz_id AND p.deleted_at IS NULL
      AND (
        (p_bank_account_id IS NOT NULL AND p.bank_account_id = p_bank_account_id)
        OR (p_bank_account_id IS NULL AND (p.bank_account_id IS NOT NULL OR p.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE')))
      )
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR p.payment_date <= p_to_date)

    UNION ALL

    -- 4. Money OUT: Expenses
    SELECT 
      e.id,
      e.expense_date AS txn_date,
      'EXPENSE' AS txn_type,
      'OUT' AS direction,
      0::numeric(14,2) AS in_amount,
      e.amount AS out_amount,
      e.mode,
      COALESCE(e.notes, 'Expense') AS ref_no,
      ec.name AS party_name,
      e.description AS description,
      e.bank_account_id,
      COALESCE(e.bank_name, ba.bank_name, e.mode) AS bank_label,
      e.created_at
    FROM public.expenses e
    JOIN public.expense_categories ec ON ec.id = e.category_id
    LEFT JOIN public.bank_accounts ba ON ba.id = e.bank_account_id
    WHERE e.business_id = v_biz_id AND e.deleted_at IS NULL
      AND (
        (p_bank_account_id IS NOT NULL AND e.bank_account_id = p_bank_account_id)
        OR (p_bank_account_id IS NULL AND (e.bank_account_id IS NOT NULL OR e.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE')))
      )
      AND (p_from_date IS NULL OR e.expense_date >= p_from_date)
      AND (p_to_date IS NULL OR e.expense_date <= p_to_date)

    UNION ALL

    -- 5. Money OUT: Loan Repayments
    SELECT 
      lr.id,
      lr.repayment_date AS txn_date,
      'LOAN_REPAYMENT' AS txn_type,
      'OUT' AS direction,
      0::numeric(14,2) AS in_amount,
      (lr.principal + lr.interest) AS out_amount,
      lr.mode,
      COALESCE(lr.notes, 'Loan Repayment') AS ref_no,
      l.lender_name AS party_name,
      'Loan Repayment: Principal ' || lr.principal || ' + Interest ' || lr.interest AS description,
      lr.bank_account_id,
      COALESCE(lr.bank_name, ba.bank_name, lr.mode) AS bank_label,
      lr.created_at
    FROM public.loan_repayments lr
    JOIN public.loans l ON l.id = lr.loan_id
    LEFT JOIN public.bank_accounts ba ON ba.id = lr.bank_account_id
    WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL
      AND (
        (p_bank_account_id IS NOT NULL AND lr.bank_account_id = p_bank_account_id)
        OR (p_bank_account_id IS NULL AND (lr.bank_account_id IS NOT NULL OR lr.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE')))
      )
      AND (p_from_date IS NULL OR lr.repayment_date >= p_from_date)
      AND (p_to_date IS NULL OR lr.repayment_date <= p_to_date)

    UNION ALL

    -- 6. Money OUT: Outgoing Transfers (Cash Withdrawal or Outward Bank-to-Bank)
    SELECT
      mt.id,
      mt.transfer_date AS txn_date,
      'TRANSFER_OUT' AS txn_type,
      'OUT' AS direction,
      0::numeric(14,2) AS in_amount,
      mt.amount AS out_amount,
      CASE WHEN mt.transfer_type = 'BANK_TO_CASH' THEN 'CASH' ELSE 'BANK' END AS mode,
      COALESCE(mt.reference, 'Withdrawal') AS ref_no,
      CASE 
        WHEN mt.transfer_type = 'BANK_TO_CASH' THEN 'Cash Withdrawal (Contra)'
        ELSE 'Transfer to ' || COALESCE(tba.bank_name, 'Bank')
      END AS party_name,
      COALESCE(mt.notes, 'Internal Contra Transfer') AS description,
      mt.from_bank_account_id AS bank_account_id,
      fba.bank_name AS bank_label,
      mt.created_at
    FROM public.money_transfers mt
    JOIN public.bank_accounts fba ON fba.id = mt.from_bank_account_id
    LEFT JOIN public.bank_accounts tba ON tba.id = mt.to_bank_account_id
    WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL
      AND (p_bank_account_id IS NULL OR mt.from_bank_account_id = p_bank_account_id)
      AND (p_from_date IS NULL OR mt.transfer_date >= p_from_date)
      AND (p_to_date IS NULL OR mt.transfer_date <= p_to_date)
  ),
  ordered_txns AS (
    SELECT 
      t.*,
      (v_opening_balance + SUM(t.in_amount - t.out_amount) OVER (ORDER BY t.txn_date ASC, t.created_at ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS running_balance
    FROM bank_txns t
    ORDER BY t.txn_date DESC, t.created_at DESC
  )
  SELECT 
    COALESCE(SUM(in_amount), 0),
    COALESCE(SUM(out_amount), 0),
    COALESCE(jsonb_agg(to_jsonb(ot.*)), '[]'::jsonb)
  INTO v_tot_in, v_tot_out, v_entries
  FROM ordered_txns ot;

  v_closing_balance := v_opening_balance + v_tot_in - v_tot_out;

  RETURN jsonb_build_object(
    'bank_accounts', v_accounts,
    'summary', jsonb_build_object(
      'opening_balance', v_opening_balance,
      'total_in', v_tot_in,
      'total_out', v_tot_out,
      'net_flow', (v_tot_in - v_tot_out),
      'closing_balance', v_closing_balance,
      'current_balance', v_closing_balance
    ),
    'entries', v_entries
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.bank_ledger(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bank_ledger(uuid, date, date) TO authenticated;

