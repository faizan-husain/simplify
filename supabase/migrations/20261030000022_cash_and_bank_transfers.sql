-- Migration 22: Cash & Bank Management, Money Transfers (Contra), and Cash in Hand Tracking
-- Enables internal balance movements (Cash to Bank, Bank to Cash, Bank to Bank) with zero P&L impact.

-- 1. Add opening_cash_balance to businesses
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS opening_cash_balance numeric(14,2) NOT NULL DEFAULT 0.00;

-- 2. Create money_transfers table
CREATE TABLE IF NOT EXISTS public.money_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  transfer_date date NOT NULL DEFAULT (app.today()),
  transfer_type text NOT NULL CHECK (transfer_type IN ('CASH_TO_BANK', 'BANK_TO_CASH', 'BANK_TO_BANK')),
  from_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  to_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT chk_transfer_accounts CHECK (
    (transfer_type = 'CASH_TO_BANK' AND from_bank_account_id IS NULL AND to_bank_account_id IS NOT NULL) OR
    (transfer_type = 'BANK_TO_CASH' AND from_bank_account_id IS NOT NULL AND to_bank_account_id IS NULL) OR
    (transfer_type = 'BANK_TO_BANK' AND from_bank_account_id IS NOT NULL AND to_bank_account_id IS NOT NULL AND from_bank_account_id <> to_bank_account_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_money_transfers_business ON public.money_transfers(business_id);
CREATE INDEX IF NOT EXISTS idx_money_transfers_date ON public.money_transfers(business_id, transfer_date);
CREATE INDEX IF NOT EXISTS idx_money_transfers_from_bank ON public.money_transfers(from_bank_account_id);
CREATE INDEX IF NOT EXISTS idx_money_transfers_to_bank ON public.money_transfers(to_bank_account_id);

CREATE OR REPLACE TRIGGER trg_money_transfers_audit
BEFORE INSERT OR UPDATE ON public.money_transfers
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Enable RLS
ALTER TABLE public.money_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_transfers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS money_transfers_select ON public.money_transfers;
CREATE POLICY money_transfers_select ON public.money_transfers
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

-- 3. RPC: record_money_transfer
CREATE OR REPLACE FUNCTION public.record_money_transfer(
  payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_type text;
  v_date date;
  v_from_id uuid := NULL;
  v_to_id uuid := NULL;
  v_amount numeric(14,2);
  v_ref text;
  v_notes text;
  v_transfer public.money_transfers%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_type := UPPER(COALESCE(payload->>'transfer_type', ''));
  IF v_type NOT IN ('CASH_TO_BANK', 'BANK_TO_CASH', 'BANK_TO_BANK') THEN
    RAISE EXCEPTION 'INVALID_TRANSFER_TYPE' USING ERRCODE = 'P0001';
  END IF;

  v_amount := ROUND((payload->>'amount')::numeric, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  v_date := COALESCE((payload->>'transfer_date')::date, (SELECT app.today()));
  v_ref := NULLIF(TRIM(payload->>'reference'), '');
  v_notes := NULLIF(TRIM(payload->>'notes'), '');

  IF payload->>'from_bank_account_id' IS NOT NULL AND payload->>'from_bank_account_id' <> '' THEN
    v_from_id := (payload->>'from_bank_account_id')::uuid;
  END IF;

  IF payload->>'to_bank_account_id' IS NOT NULL AND payload->>'to_bank_account_id' <> '' THEN
    v_to_id := (payload->>'to_bank_account_id')::uuid;
  END IF;

  -- Validate based on type
  IF v_type = 'CASH_TO_BANK' THEN
    v_from_id := NULL;
    IF v_to_id IS NULL THEN
      RAISE EXCEPTION 'DESTINATION_BANK_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    -- Verify destination bank belongs to business and is active
    PERFORM 1 FROM public.bank_accounts
    WHERE id = v_to_id AND business_id = v_biz_id AND active = true AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DESTINATION_BANK_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_type = 'BANK_TO_CASH' THEN
    v_to_id := NULL;
    IF v_from_id IS NULL THEN
      RAISE EXCEPTION 'SOURCE_BANK_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    -- Verify source bank belongs to business and is active
    PERFORM 1 FROM public.bank_accounts
    WHERE id = v_from_id AND business_id = v_biz_id AND active = true AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SOURCE_BANK_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_type = 'BANK_TO_BANK' THEN
    IF v_from_id IS NULL OR v_to_id IS NULL THEN
      RAISE EXCEPTION 'BOTH_BANKS_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_from_id = v_to_id THEN
      RAISE EXCEPTION 'CANNOT_TRANSFER_TO_SAME_BANK' USING ERRCODE = 'P0001';
    END IF;

    -- Verify source bank
    PERFORM 1 FROM public.bank_accounts
    WHERE id = v_from_id AND business_id = v_biz_id AND active = true AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SOURCE_BANK_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    -- Verify destination bank
    PERFORM 1 FROM public.bank_accounts
    WHERE id = v_to_id AND business_id = v_biz_id AND active = true AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DESTINATION_BANK_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.money_transfers (
    business_id, transfer_date, transfer_type,
    from_bank_account_id, to_bank_account_id,
    amount, reference, notes,
    created_by, updated_by
  ) VALUES (
    v_biz_id, v_date, v_type,
    v_from_id, v_to_id,
    v_amount, v_ref, v_notes,
    v_member_id, v_member_id
  ) RETURNING * INTO v_transfer;

  RETURN to_jsonb(v_transfer);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.record_money_transfer(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_money_transfer(jsonb) TO authenticated;

-- 4. RPC: cash_bank_summary
CREATE OR REPLACE FUNCTION public.cash_bank_summary(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_biz public.businesses%ROWTYPE;
  v_cash_opening numeric(14,2) := 0;
  v_cash_receipts numeric(14,2) := 0;
  v_cash_withdrawals numeric(14,2) := 0;
  v_cash_total_in numeric(14,2) := 0;
  v_cash_payments numeric(14,2) := 0;
  v_cash_expenses numeric(14,2) := 0;
  v_cash_loan_repayments numeric(14,2) := 0;
  v_cash_deposits numeric(14,2) := 0;
  v_cash_total_out numeric(14,2) := 0;
  v_cash_current_balance numeric(14,2) := 0;

  v_bank_accounts jsonb := '[]'::jsonb;
  v_total_bank_balance numeric(14,2) := 0;
  v_recent_transfers jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;
  v_cash_opening := COALESCE(v_biz.opening_cash_balance, 0.00);

  -- 1. Cash Inflow
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

  -- 2. Cash Outflow
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

  -- 3. Individual Bank Accounts breakdown (including transfers)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ba.id,
      'bank_name', ba.bank_name,
      'account_name', ba.account_name,
      'account_number', ba.account_number,
      'ifsc', ba.ifsc,
      'upi_id', ba.upi_id,
      'opening_balance', ba.opening_balance,
      'total_in', sub.total_in,
      'total_out', sub.total_out,
      'current_balance', (ba.opening_balance + sub.total_in - sub.total_out)
    ) ORDER BY ba.created_at ASC
  ), '[]'::jsonb)
  INTO v_bank_accounts
  FROM public.bank_accounts ba
  CROSS JOIN LATERAL (
    SELECT
      -- Bank IN: Receipts + Cash Deposits + Incoming Inter-Bank Transfers
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
      ) AS total_in,
      -- Bank OUT: Payments + Expenses + Loan Repayments + Cash Withdrawals + Outgoing Inter-Bank Transfers
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
      ) AS total_out
  ) sub
  WHERE ba.business_id = v_biz_id AND ba.deleted_at IS NULL;

  -- 4. Calculate total bank balance
  SELECT COALESCE(SUM((elem->>'current_balance')::numeric), 0)
  INTO v_total_bank_balance
  FROM jsonb_array_elements(v_bank_accounts) elem;

  -- 5. Recent Transfers list
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', mt.id,
      'transfer_date', mt.transfer_date,
      'transfer_type', mt.transfer_type,
      'amount', mt.amount,
      'reference', mt.reference,
      'notes', mt.notes,
      'from_bank_account_id', mt.from_bank_account_id,
      'from_bank_name', COALESCE(fba.bank_name, 'Cash in Hand'),
      'from_account_name', fba.account_name,
      'to_bank_account_id', mt.to_bank_account_id,
      'to_bank_name', COALESCE(tba.bank_name, 'Cash in Hand'),
      'to_account_name', tba.account_name,
      'created_at', mt.created_at
    ) ORDER BY mt.transfer_date DESC, mt.created_at DESC
  ), '[]'::jsonb)
  INTO v_recent_transfers
  FROM (
    SELECT * FROM public.money_transfers
    WHERE business_id = v_biz_id AND deleted_at IS NULL
      AND (p_from_date IS NULL OR transfer_date >= p_from_date)
      AND (p_to_date IS NULL OR transfer_date <= p_to_date)
    ORDER BY transfer_date DESC, created_at DESC
    LIMIT 100
  ) mt
  LEFT JOIN public.bank_accounts fba ON fba.id = mt.from_bank_account_id
  LEFT JOIN public.bank_accounts tba ON tba.id = mt.to_bank_account_id;

  RETURN jsonb_build_object(
    'cash_in_hand', jsonb_build_object(
      'opening_balance', v_cash_opening,
      'total_in', v_cash_total_in,
      'total_out', v_cash_total_out,
      'current_balance', v_cash_current_balance,
      'receipts', v_cash_receipts,
      'withdrawals', v_cash_withdrawals,
      'payments', v_cash_payments,
      'expenses', v_cash_expenses,
      'deposits', v_cash_deposits
    ),
    'bank_summary', jsonb_build_object(
      'total_bank_balance', v_total_bank_balance,
      'account_count', jsonb_array_length(v_bank_accounts)
    ),
    'total_liquid_funds', (v_cash_current_balance + v_total_bank_balance),
    'bank_accounts', v_bank_accounts,
    'recent_transfers', v_recent_transfers
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.cash_bank_summary(date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cash_bank_summary(date, date) TO authenticated;

-- 5. Upgrade bank_ledger to fully integrate money transfers
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
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  -- Bank accounts summary (including transfers)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ba.id,
      'bank_name', ba.bank_name,
      'account_name', ba.account_name,
      'account_number', ba.account_number,
      'ifsc', ba.ifsc,
      'upi_id', ba.upi_id,
      'opening_balance', ba.opening_balance,
      'total_in', sub.total_in,
      'total_out', sub.total_out,
      'current_balance', (ba.opening_balance + sub.total_in - sub.total_out)
    ) ORDER BY ba.created_at ASC
  ), '[]'::jsonb)
  INTO v_accounts
  FROM public.bank_accounts ba
  CROSS JOIN LATERAL (
    SELECT
      (
        COALESCE((
          SELECT SUM(r.amount) FROM public.receipts r 
          WHERE r.business_id = v_biz_id AND r.deleted_at IS NULL 
            AND (r.bank_account_id = ba.id OR (r.bank_account_id IS NULL AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT SUM(mt.amount) FROM public.money_transfers mt
          WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL AND mt.to_bank_account_id = ba.id
        ), 0)
      ) AS total_in,
      (
        COALESCE((
          SELECT COALESCE(SUM(p.amount), 0) FROM public.payments p 
          WHERE p.business_id = v_biz_id AND p.deleted_at IS NULL 
            AND (p.bank_account_id = ba.id OR (p.bank_account_id IS NULL AND p.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT COALESCE(SUM(e.amount), 0) FROM public.expenses e 
          WHERE e.business_id = v_biz_id AND e.deleted_at IS NULL 
            AND (e.bank_account_id = ba.id OR (e.bank_account_id IS NULL AND e.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT COALESCE(SUM(lr.principal + lr.interest), 0) FROM public.loan_repayments lr 
          JOIN public.loans l ON l.id = lr.loan_id 
          WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL 
            AND (lr.bank_account_id = ba.id OR (lr.bank_account_id IS NULL AND lr.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
        ), 0) +
        COALESCE((
          SELECT SUM(mt.amount) FROM public.money_transfers mt
          WHERE mt.business_id = v_biz_id AND mt.deleted_at IS NULL AND mt.from_bank_account_id = ba.id
        ), 0)
      ) AS total_out
  ) sub
  WHERE ba.business_id = v_biz_id AND ba.deleted_at IS NULL;

  -- Union of all bank movements
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
    JOIN public.vendors v ON v.id = p.vendor_id
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
      COALESCE(e.notes, ec.name) AS ref_no,
      COALESCE(e.payee, ec.name) AS party_name,
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
      SUM(t.in_amount - t.out_amount) OVER (ORDER BY t.txn_date ASC, t.created_at ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
    FROM bank_txns t
    ORDER BY t.txn_date DESC, t.created_at DESC
  )
  SELECT 
    COALESCE(SUM(in_amount), 0),
    COALESCE(SUM(out_amount), 0),
    COALESCE(jsonb_agg(to_jsonb(ot.*)), '[]'::jsonb)
  INTO v_tot_in, v_tot_out, v_entries
  FROM ordered_txns ot;

  RETURN jsonb_build_object(
    'bank_accounts', v_accounts,
    'summary', jsonb_build_object(
      'total_in', v_tot_in,
      'total_out', v_tot_out,
      'net_flow', (v_tot_in - v_tot_out)
    ),
    'entries', v_entries
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.bank_ledger(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bank_ledger(uuid, date, date) TO authenticated;

-- 6. Update soft_delete to support money_transfers and bank_accounts
CREATE OR REPLACE FUNCTION public.soft_delete(
  p_table text,
  p_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_member_id uuid;
  v_allowed boolean := false;
  v_has_invoices boolean;
  v_has_cust_invoices boolean := false;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Validate table
  IF p_table NOT IN ('customers', 'services', 'job_type_steps', 'vendors', 'payments', 'expense_categories', 'expenses', 'loans', 'receipts', 'money_transfers', 'bank_accounts') THEN
    RAISE EXCEPTION 'INVALID_TABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Role checks per §5
  IF v_role = 'OWNER' THEN
    v_allowed := true;
  ELSIF v_role = 'ACCOUNTANT' THEN
    IF p_table IN ('customers', 'payments', 'expenses', 'loans', 'money_transfers') THEN
      v_allowed := true;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Customers cannot be deleted if they have invoices (BR-9)
  SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices') INTO v_has_invoices;
  IF p_table = 'customers' AND v_has_invoices THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.invoices WHERE customer_id = %L AND business_id = %L AND deleted_at IS NULL)', p_id, v_biz_id)
    INTO v_has_cust_invoices;
    IF v_has_cust_invoices THEN
      RAISE EXCEPTION 'CUSTOMER_HAS_INVOICES' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Expense categories: system categories cannot be deleted
  IF p_table = 'expense_categories' AND EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'expense_categories'
  ) THEN
    DECLARE
      v_is_system boolean := false;
    BEGIN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.expense_categories WHERE id = %L AND system = true)', p_id)
      INTO v_is_system;
      IF v_is_system THEN
        RAISE EXCEPTION 'SYSTEM_CATEGORY_CANNOT_BE_DELETED' USING ERRCODE = 'P0001';
      END IF;
    END;
  END IF;

  -- Execute soft delete
  EXECUTE format(
    'UPDATE public.%I SET deleted_at = now(), deleted_by = %L WHERE id = %L AND business_id = %L AND deleted_at IS NULL',
    p_table, v_member_id, p_id, v_biz_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.soft_delete(text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.soft_delete(text, uuid) TO authenticated;
