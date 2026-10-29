-- Migration 17: Bank Accounts, Bank IN/OUT Ledger, Vendor Ledger, and Enhanced Receipt Details
-- Supports multi-bank account management, bank passbook/ledger tracking, and full receipt printing.

-- 1. Create bank_accounts Table
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_name text NOT NULL,
  account_number text,
  ifsc text,
  upi_id text,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0.00,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_business ON public.bank_accounts(business_id);

CREATE OR REPLACE TRIGGER trg_bank_accounts_audit
BEFORE INSERT OR UPDATE ON public.bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_accounts_select_policy ON public.bank_accounts;
CREATE POLICY bank_accounts_select_policy ON public.bank_accounts
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS bank_accounts_insert_policy ON public.bank_accounts;
CREATE POLICY bank_accounts_insert_policy ON public.bank_accounts
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS bank_accounts_update_policy ON public.bank_accounts;
CREATE POLICY bank_accounts_update_policy ON public.bank_accounts
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );

-- 2. Alter Tables to support bank account linkage
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS bank_name text;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS bank_name text;

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS bank_name text;

ALTER TABLE public.loan_repayments ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.loan_repayments ADD COLUMN IF NOT EXISTS bank_name text;

-- 3. Upgrade create_receipt to store bank_account_id and bank_name
CREATE OR REPLACE FUNCTION public.create_receipt(
  payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_date date;
  v_fy text;
  v_num text;
  v_cust_id uuid;
  v_amount numeric(14,2);
  v_mode text;
  v_ref text;
  v_kind text;
  v_cat text;
  v_notes text;
  v_bank_account_id uuid;
  v_bank_name text;
  v_allocs jsonb;
  v_alloc_count int;
  v_alloc_elem jsonb;
  v_inv_id uuid;
  v_alloc_amt numeric(14,2);
  v_total_allocated numeric(14,2) := 0;
  v_unallocated numeric(14,2) := 0;
  v_inv public.invoices%ROWTYPE;
  v_inv_balance numeric(14,2);
  v_cust_total_due numeric(14,2);
  v_remaining_customer_due numeric(14,2);
  v_receipt public.receipts%ROWTYPE;
  i int;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_date := COALESCE((payload->>'receipt_date')::date, (SELECT app.today()));
  v_fy := public.fy_label(v_date);
  v_num := public.next_receipt_number(v_biz_id, v_fy);

  v_kind := UPPER(COALESCE(payload->>'kind', 'INVOICE_PAYMENT'));
  IF v_kind NOT IN ('INVOICE_PAYMENT', 'OTHER_INCOME') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = 'P0001';
  END IF;

  v_mode := UPPER(COALESCE(payload->>'mode', 'CASH'));
  IF v_mode NOT IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MODE' USING ERRCODE = 'P0001';
  END IF;

  v_amount := ROUND((payload->>'amount')::numeric, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  v_ref := payload->>'reference';
  v_notes := payload->>'notes';
  v_bank_name := payload->>'bank_name';
  IF payload->>'bank_account_id' IS NOT NULL AND payload->>'bank_account_id' <> '' THEN
    v_bank_account_id := (payload->>'bank_account_id')::uuid;
  END IF;

  IF v_kind = 'OTHER_INCOME' THEN
    v_cat := COALESCE(payload->>'income_category', 'Other Income');
    IF payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
      v_cust_id := (payload->>'customer_id')::uuid;
    END IF;

    -- OTHER_INCOME cannot have invoice allocations
    IF payload ? 'allocations' AND jsonb_array_length(payload->'allocations') > 0 THEN
      RAISE EXCEPTION 'OTHER_INCOME_CANNOT_HAVE_ALLOCATIONS' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.receipts (
      business_id, number, fy_label, receipt_date, customer_id, amount,
      mode, reference, kind, income_category, unallocated_amount, notes,
      bank_account_id, bank_name,
      created_by, updated_by
    ) VALUES (
      v_biz_id, v_num, v_fy, v_date, v_cust_id, v_amount,
      v_mode, v_ref, 'OTHER_INCOME', v_cat, 0, v_notes,
      v_bank_account_id, v_bank_name,
      v_member_id, v_member_id
    ) RETURNING * INTO v_receipt;

    RETURN to_jsonb(v_receipt);
  END IF;

  -- INVOICE_PAYMENT path
  IF payload->>'customer_id' IS NOT NULL AND payload->>'customer_id' <> '' THEN
    v_cust_id := (payload->>'customer_id')::uuid;
  END IF;

  v_allocs := payload->'allocations';
  v_alloc_count := COALESCE(jsonb_array_length(v_allocs), 0);

  -- Infer customer from invoice if not explicitly provided
  IF v_cust_id IS NULL AND v_alloc_count > 0 THEN
    SELECT customer_id INTO v_cust_id
    FROM public.invoices
    WHERE id = (v_allocs->0->>'invoice_id')::uuid AND business_id = v_biz_id;
  END IF;

  IF v_cust_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_RECEIPT' USING ERRCODE = 'P0001';
  END IF;

  -- Verify customer exists in business
  PERFORM 1 FROM public.customers
  WHERE id = v_cust_id AND business_id = v_biz_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Validate each allocation
  IF v_alloc_count > 0 THEN
    FOR i IN 0..(v_alloc_count - 1) LOOP
      v_alloc_elem := v_allocs->i;
      v_inv_id := (v_alloc_elem->>'invoice_id')::uuid;
      v_alloc_amt := ROUND((v_alloc_elem->>'amount')::numeric, 2);

      IF v_alloc_amt IS NULL OR v_alloc_amt <= 0 THEN
        RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT' USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_inv
      FROM public.invoices
      WHERE id = v_inv_id AND business_id = v_biz_id AND status = 'ACTIVE' AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('invoice_id', v_inv_id)::text;
      END IF;

      IF v_inv.customer_id IS NOT NULL AND v_inv.customer_id <> v_cust_id THEN
        RAISE EXCEPTION 'INVOICE_CUSTOMER_MISMATCH' USING ERRCODE = 'P0001';
      END IF;

      v_inv_balance := v_inv.total - v_inv.paid_amount;
      IF v_alloc_amt > v_inv_balance THEN
        RAISE EXCEPTION 'ALLOCATION_EXCEEDS_INVOICE_BALANCE' USING ERRCODE = 'P0001',
          DETAIL = jsonb_build_object('invoice_id', v_inv_id, 'balance', v_inv_balance, 'allocated', v_alloc_amt)::text;
      END IF;

      v_total_allocated := v_total_allocated + v_alloc_amt;
    END LOOP;
  END IF;

  IF v_total_allocated > v_amount THEN
    RAISE EXCEPTION 'ALLOCATION_EXCEEDS_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  -- BR-7 Rule: Save is allowed only if unallocated = 0, or all customer dues are fully allocated
  IF v_total_allocated < v_amount THEN
    SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_cust_total_due
    FROM public.invoices
    WHERE business_id = v_biz_id
      AND customer_id = v_cust_id
      AND status = 'ACTIVE'
      AND deleted_at IS NULL
      AND (total - paid_amount) > 0;

    v_remaining_customer_due := v_cust_total_due - v_total_allocated;

    IF v_remaining_customer_due > 0 THEN
      RAISE EXCEPTION 'ALLOCATION_INCOMPLETE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('unallocated', v_amount - v_total_allocated, 'remaining_due', v_remaining_customer_due)::text;
    ELSE
      -- All invoices for customer are settled; remainder becomes customer advance
      v_unallocated := v_amount - v_total_allocated;
    END IF;
  ELSE
    v_unallocated := 0;
  END IF;

  -- Insert receipt
  INSERT INTO public.receipts (
    business_id, number, fy_label, receipt_date, customer_id, amount,
    mode, reference, kind, income_category, unallocated_amount, notes,
    bank_account_id, bank_name,
    created_by, updated_by
  ) VALUES (
    v_biz_id, v_num, v_fy, v_date, v_cust_id, v_amount,
    v_mode, v_ref, 'INVOICE_PAYMENT', NULL, v_unallocated, v_notes,
    v_bank_account_id, v_bank_name,
    v_member_id, v_member_id
  ) RETURNING * INTO v_receipt;

  -- Insert allocations & update invoice paid amounts
  IF v_alloc_count > 0 THEN
    FOR i IN 0..(v_alloc_count - 1) LOOP
      v_alloc_elem := v_allocs->i;
      v_inv_id := (v_alloc_elem->>'invoice_id')::uuid;
      v_alloc_amt := ROUND((v_alloc_elem->>'amount')::numeric, 2);

      INSERT INTO public.receipt_allocations (
        business_id, receipt_id, invoice_id, amount, created_by, updated_by
      ) VALUES (
        v_biz_id, v_receipt.id, v_inv_id, v_alloc_amt, v_member_id, v_member_id
      );

      UPDATE public.invoices
      SET paid_amount = paid_amount + v_alloc_amt,
          updated_at = now(),
          updated_by = v_member_id
      WHERE id = v_inv_id;
    END LOOP;
  END IF;

  RETURN to_jsonb(v_receipt);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.create_receipt(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_receipt(jsonb) TO authenticated;

-- 4. RPC: receipt_detail
CREATE OR REPLACE FUNCTION public.receipt_detail(p_receipt_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_receipt public.receipts%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_biz public.businesses%ROWTYPE;
  v_allocs jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT * INTO v_receipt
  FROM public.receipts
  WHERE id = p_receipt_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_receipt.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust
    FROM public.customers
    WHERE id = v_receipt.customer_id AND business_id = v_biz_id;
  END IF;

  SELECT * INTO v_biz
  FROM public.businesses
  WHERE id = v_biz_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ra.id,
      'invoice_id', ra.invoice_id,
      'invoice_number', i.number,
      'invoice_date', i.invoice_date,
      'invoice_total', i.total,
      'allocated_amount', ra.amount,
      'invoice_balance', (i.total - i.paid_amount)
    )
  ), '[]'::jsonb)
  INTO v_allocs
  FROM public.receipt_allocations ra
  JOIN public.invoices i ON i.id = ra.invoice_id
  WHERE ra.receipt_id = v_receipt.id;

  RETURN jsonb_build_object(
    'receipt', to_jsonb(v_receipt),
    'customer', CASE WHEN v_cust.id IS NOT NULL THEN to_jsonb(v_cust) ELSE NULL END,
    'allocations', v_allocs,
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
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.receipt_detail(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.receipt_detail(uuid) TO authenticated;

-- 5. RPC: bank_ledger
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

  -- Bank accounts summary
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ba.id,
      'bank_name', ba.bank_name,
      'account_name', ba.account_name,
      'account_number', ba.account_number,
      'ifsc', ba.ifsc,
      'upi_id', ba.upi_id,
      'opening_balance', ba.opening_balance,
      'total_in', COALESCE((
        SELECT SUM(r.amount) FROM public.receipts r 
        WHERE r.business_id = v_biz_id AND r.deleted_at IS NULL 
          AND (r.bank_account_id = ba.id OR (r.bank_account_id IS NULL AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
      ), 0),
      'total_out', COALESCE((
        SELECT COALESCE(SUM(p.amount), 0) FROM public.payments p 
        WHERE p.business_id = v_biz_id AND p.deleted_at IS NULL 
          AND (p.bank_account_id = ba.id OR (p.bank_account_id IS NULL AND p.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
      ), 0) + COALESCE((
        SELECT COALESCE(SUM(e.amount), 0) FROM public.expenses e 
        WHERE e.business_id = v_biz_id AND e.deleted_at IS NULL 
          AND (e.bank_account_id = ba.id OR (e.bank_account_id IS NULL AND e.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
      ), 0) + COALESCE((
        SELECT COALESCE(SUM(lr.principal + lr.interest), 0) FROM public.loan_repayments lr 
        JOIN public.loans l ON l.id = lr.loan_id 
        WHERE l.business_id = v_biz_id AND lr.deleted_at IS NULL 
          AND (lr.bank_account_id = ba.id OR (lr.bank_account_id IS NULL AND lr.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE') AND (SELECT count(*) FROM public.bank_accounts WHERE business_id = v_biz_id AND deleted_at IS NULL) = 1))
      ), 0)
    )
  ), '[]'::jsonb)
  INTO v_accounts
  FROM public.bank_accounts ba
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

    -- 2. Money OUT: Vendor Payments
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

    -- 3. Money OUT: Expenses
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

    -- 4. Money OUT: Loan Repayments
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

-- 6. RPC: vendor_ledger
CREATE OR REPLACE FUNCTION public.vendor_ledger(
  p_vendor_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_vendor public.vendors%ROWTYPE;
  v_tot_paid numeric(14,2) := 0;
  v_payments jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT * INTO v_vendor
  FROM public.vendors
  WHERE id = p_vendor_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT 
    COALESCE(SUM(p.amount), 0),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'payment_date', p.payment_date,
        'description', p.description,
        'amount', p.amount,
        'mode', p.mode,
        'bank_name', p.bank_name,
        'notes', p.notes,
        'invoice_id', p.invoice_id,
        'invoice_number', i.number,
        'created_at', p.created_at
      ) ORDER BY p.payment_date DESC, p.created_at DESC
    ), '[]'::jsonb)
  INTO v_tot_paid, v_payments
  FROM public.payments p
  LEFT JOIN public.invoices i ON i.id = p.invoice_id
  WHERE p.vendor_id = p_vendor_id AND p.business_id = v_biz_id AND p.deleted_at IS NULL
    AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date IS NULL OR p.payment_date <= p_to_date);

  RETURN jsonb_build_object(
    'vendor', to_jsonb(v_vendor),
    'summary', jsonb_build_object(
      'total_paid', v_tot_paid,
      'payment_count', jsonb_array_length(v_payments)
    ),
    'payments', v_payments
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.vendor_ledger(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.vendor_ledger(uuid, date, date) TO authenticated;
