-- 11. Upgrade record_loan_repayment with Two-Phase Idempotency & Row Locking
CREATE OR REPLACE FUNCTION public.record_loan_repayment(
  payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_loan_id uuid;
  v_loan public.loans%ROWTYPE;
  v_date date;
  v_principal numeric(14,2);
  v_interest numeric(14,2);
  v_mode text;
  v_notes text;
  v_bank_account_id uuid := NULL;
  v_bank_name text := NULL;
  v_total_principal_repaid numeric(14,2);
  v_outstanding numeric(14,2);
  v_repayment public.loan_repayments%ROWTYPE;
  v_interest_cat_id uuid;
  v_expense_id uuid := NULL;
  v_idem_key text;
  v_idem_status text;
  v_cached_resp jsonb;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Two-phase idempotency protection
  v_idem_key := NULLIF(TRIM(COALESCE(payload->>'idempotency_key', '')), '');
  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, updated_at)
    VALUES (v_biz_id, v_idem_key, 'LOAN_REPAYMENT', 'PROCESSING', now())
    ON CONFLICT (business_id, key) DO NOTHING;

    SELECT status, response INTO v_idem_status, v_cached_resp
    FROM public.idempotency_keys
    WHERE business_id = v_biz_id AND key = v_idem_key
    FOR UPDATE;

    IF v_idem_status = 'COMPLETED' AND v_cached_resp IS NOT NULL THEN
      RETURN v_cached_resp;
    END IF;
  END IF;

  v_loan_id := (payload->>'loan_id')::uuid;
  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'LOAN_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_loan
  FROM public.loans
  WHERE id = v_loan_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOAN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_date := COALESCE((payload->>'repayment_date')::date, (SELECT app.today()));
  v_principal := ROUND(COALESCE((payload->>'principal')::numeric, 0), 2);
  v_interest := ROUND(COALESCE((payload->>'interest')::numeric, 0), 2);

  IF v_principal < 0 OR v_interest < 0 OR (v_principal = 0 AND v_interest = 0) THEN
    RAISE EXCEPTION 'INVALID_REPAYMENT_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  v_mode := UPPER(COALESCE(payload->>'mode', 'BANK'));
  IF v_mode NOT IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MODE' USING ERRCODE = 'P0001';
  END IF;

  IF payload ? 'bank_account_id' AND payload->>'bank_account_id' <> '' THEN
    v_bank_account_id := (payload->>'bank_account_id')::uuid;
    SELECT bank_name INTO v_bank_name
    FROM public.bank_accounts
    WHERE id = v_bank_account_id AND business_id = v_biz_id AND deleted_at IS NULL;
  END IF;

  v_notes := NULLIF(TRIM(payload->>'notes'), '');

  SELECT COALESCE(SUM(principal), 0) INTO v_total_principal_repaid
  FROM public.loan_repayments
  WHERE loan_id = v_loan.id AND deleted_at IS NULL;

  v_outstanding := v_loan.amount - v_total_principal_repaid;
  IF v_principal > v_outstanding THEN
    RAISE EXCEPTION 'REPAYMENT_EXCEEDS_LOAN_BALANCE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('outstanding', v_outstanding, 'attempted', v_principal)::text;
  END IF;

  INSERT INTO public.loan_repayments (
    business_id, loan_id, repayment_date, principal, interest, mode,
    bank_account_id, bank_name, notes, created_by, updated_by
  ) VALUES (
    v_biz_id, v_loan.id, v_date, v_principal, v_interest, v_mode,
    v_bank_account_id, v_bank_name, v_notes, v_member_id, v_member_id
  ) RETURNING * INTO v_repayment;

  IF v_interest > 0 THEN
    SELECT id INTO v_interest_cat_id
    FROM public.expense_categories
    WHERE name = 'Loan Interest' AND (business_id = v_biz_id OR business_id IS NULL)
    LIMIT 1;

    INSERT INTO public.expenses (
      business_id, fy_label, expense_date, category_id, description,
      amount, mode, bank_account_id, bank_name, payee, notes, loan_repayment_id,
      created_by, updated_by
    ) VALUES (
      v_biz_id, public.fy_label(v_date), v_date, v_interest_cat_id,
      'Interest payment for loan from ' || v_loan.lender_name,
      v_interest, v_mode, v_bank_account_id, v_bank_name, v_loan.lender_name,
      v_notes, v_repayment.id, v_member_id, v_member_id
    ) RETURNING id INTO v_expense_id;
  END IF;

  v_result := jsonb_build_object(
    'repayment', to_jsonb(v_repayment),
    'remaining_principal', v_outstanding - v_principal,
    'interest_expense_id', v_expense_id
  );

  IF v_idem_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (business_id, key, operation, status, response, updated_at)
    VALUES (v_biz_id, v_idem_key, 'LOAN_REPAYMENT', 'COMPLETED', v_result, now())
    ON CONFLICT (business_id, key)
    DO UPDATE SET status = 'COMPLETED', response = v_result, updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_loan_repayment(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_loan_repayment(jsonb) TO authenticated;


-- 10. OCC Helper Functions for Direct Entity Edits
CREATE OR REPLACE FUNCTION public.update_customer_occ(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid := app.current_business_id();
  v_member_id uuid := app.current_member_id();
  v_cust_id uuid := (payload->>'id')::uuid;
  v_last_updated_at timestamptz;
  v_existing public.customers%ROWTYPE;
BEGIN
  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
  FROM public.customers
  WHERE id = v_cust_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF payload ? 'last_updated_at' AND payload->>'last_updated_at' IS NOT NULL AND payload->>'last_updated_at' <> '' THEN
    v_last_updated_at := (payload->>'last_updated_at')::timestamptz;
    IF date_trunc('milliseconds', v_existing.updated_at) > date_trunc('milliseconds', v_last_updated_at) THEN
      RAISE EXCEPTION 'CONFLICT_DETECTED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'message', 'Customer was modified on another device since you loaded it.',
          'db_updated_at', v_existing.updated_at,
          'your_updated_at', v_last_updated_at
        )::text;
    END IF;
  END IF;

  UPDATE public.customers
  SET name = COALESCE(payload->>'name', name),
      mobile = COALESCE(payload->>'mobile', mobile),
      whatsapp = COALESCE(payload->>'whatsapp', whatsapp),
      email = NULLIF(payload->>'email', ''),
      address = NULLIF(payload->>'address', ''),
      notes = NULLIF(payload->>'notes', ''),
      type = COALESCE(payload->>'type', type),
      possible_duplicate = CASE 
        WHEN payload ? 'possible_duplicate' AND payload->>'possible_duplicate' IS NOT NULL 
        THEN (payload->>'possible_duplicate')::boolean 
        ELSE possible_duplicate 
      END,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_cust_id
  RETURNING * INTO v_existing;

  RETURN to_jsonb(v_existing);
END;
$$;

REVOKE ALL ON FUNCTION public.update_customer_occ(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_customer_occ(jsonb) TO authenticated, anon;


-- 11. Enable Supabase Realtime Publication for Core Tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      CREATE PUBLICATION supabase_realtime;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE 
      public.invoices, 
      public.receipts, 
      public.customers, 
      public.jobs, 
      public.expenses, 
      public.payments, 
      public.money_transfers, 
      public.bank_accounts, 
      public.staff_payouts;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Publication might already contain these tables or be managed out-of-band
  END;
END $$;
