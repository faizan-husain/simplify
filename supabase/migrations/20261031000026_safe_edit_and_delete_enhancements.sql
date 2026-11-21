-- Migration 26: Safe Edit and Delete enhancements across all major modules
-- Conforms to accounting integrity, audit logging, and hard multi-tenant isolation

-- 1. RPC: update_receipt (Owner & Accountant)
-- Allows editing receipt metadata (date, payment mode, bank account, reference, notes, category)
-- without corrupting invoice allocations
CREATE OR REPLACE FUNCTION public.update_receipt(
  id uuid,
  payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_rec public.receipts%ROWTYPE;
  v_date date;
  v_mode text;
  v_bank_id uuid;
  v_ref text;
  v_notes text;
  v_cat text;
  v_result jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rec
  FROM public.receipts
  WHERE receipts.id = update_receipt.id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Extract fields from payload
  IF payload ? 'receipt_date' THEN
    v_date := (payload->>'receipt_date')::date;
  ELSE
    v_date := v_rec.receipt_date;
  END IF;

  IF payload ? 'mode' THEN
    v_mode := payload->>'mode';
    IF v_mode NOT IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE') THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_MODE' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_mode := v_rec.mode;
  END IF;

  IF payload ? 'bank_account_id' THEN
    IF payload->>'bank_account_id' IS NOT NULL AND payload->>'bank_account_id' <> '' THEN
      v_bank_id := (payload->>'bank_account_id')::uuid;
      PERFORM 1 FROM public.bank_accounts WHERE bank_accounts.id = v_bank_id AND business_id = v_biz_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BANK_ACCOUNT_NOT_FOUND' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      v_bank_id := NULL;
    END IF;
  ELSE
    v_bank_id := v_rec.bank_account_id;
  END IF;

  v_ref := CASE WHEN payload ? 'reference' THEN NULLIF(TRIM(payload->>'reference'), '') ELSE v_rec.reference END;
  v_notes := CASE WHEN payload ? 'notes' THEN NULLIF(TRIM(payload->>'notes'), '') ELSE v_rec.notes END;
  v_cat := CASE WHEN payload ? 'income_category' THEN NULLIF(TRIM(payload->>'income_category'), '') ELSE v_rec.income_category END;

  UPDATE public.receipts
  SET
    receipt_date = v_date,
    fy_label = app.fy_label(v_date),
    mode = v_mode,
    bank_account_id = v_bank_id,
    reference = v_ref,
    notes = v_notes,
    income_category = v_cat,
    updated_at = now(),
    updated_by = v_member_id
  WHERE receipts.id = v_rec.id
  RETURNING to_jsonb(receipts.*) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_receipt(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_receipt(uuid, jsonb) TO authenticated;


-- 2. RPC: delete_loan_repayment (Owner & Accountant)
-- Safely reverses a loan repayment and cleans up any linked interest expense
CREATE OR REPLACE FUNCTION public.delete_loan_repayment(
  repayment_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_rep public.loan_repayments%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rep
  FROM public.loan_repayments
  WHERE id = repayment_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPAYMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 1. If interest expense was generated, soft-delete it
  UPDATE public.expenses
  SET deleted_at = now(),
      deleted_by = v_member_id,
      updated_at = now(),
      updated_by = v_member_id
  WHERE loan_repayment_id = v_rep.id AND business_id = v_biz_id AND deleted_at IS NULL;

  -- 2. Soft-delete the repayment row itself
  UPDATE public.loan_repayments
  SET deleted_at = now(),
      deleted_by = v_member_id,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_rep.id;

  RETURN jsonb_build_object('success', true, 'repayment_id', v_rep.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.delete_loan_repayment(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_loan_repayment(uuid) TO authenticated;


-- 3. RPC: delete_staff_payout (Owner only)
-- Safely reverses a staff payout and cleans up the linked Salary/Commission expense
CREATE OR REPLACE FUNCTION public.delete_staff_payout(
  payout_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_payout public.staff_payouts%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_payout
  FROM public.staff_payouts
  WHERE id = payout_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Soft-delete the linked Expense in Salary / Commission
  IF v_payout.expense_id IS NOT NULL THEN
    UPDATE public.expenses
    SET deleted_at = now(),
        deleted_by = v_member_id,
        updated_at = now(),
        updated_by = v_member_id
    WHERE id = v_payout.expense_id AND business_id = v_biz_id AND deleted_at IS NULL;
  END IF;

  -- Also handle any expense linked via staff_id matching this payout if expense_id was null
  UPDATE public.expenses
  SET deleted_at = now(),
      deleted_by = v_member_id,
      updated_at = now(),
      updated_by = v_member_id
  WHERE staff_id = v_payout.staff_id
    AND expense_date = v_payout.payout_date
    AND amount = v_payout.amount
    AND business_id = v_biz_id
    AND deleted_at IS NULL;

  -- 2. Soft-delete staff_payout
  UPDATE public.staff_payouts
  SET deleted_at = now(),
      deleted_by = v_member_id,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_payout.id;

  RETURN jsonb_build_object('success', true, 'payout_id', v_payout.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.delete_staff_payout(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_staff_payout(uuid) TO authenticated;


-- 4. RPC: cancel_job (Owner & Accountant)
-- Directly cancels a job and its associated commission entry
CREATE OR REPLACE FUNCTION public.cancel_job(
  p_job_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_job public.jobs%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Update job status to CANCELLED
  UPDATE public.jobs
  SET status = 'CANCELLED',
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = p_job_id;

  -- Cancel linked commission entry
  UPDATE public.commission_entries
  SET status = 'CANCELLED',
      updated_at = now(),
      updated_by = v_member_id
  WHERE job_id = p_job_id;

  RETURN jsonb_build_object('success', true, 'job_id', p_job_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.cancel_job(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_job(uuid, text) TO authenticated;


-- 5. Enhanced update_job (Owner only)
-- Also allows editing applicant_name and party snapshots
DROP FUNCTION IF EXISTS public.update_job(uuid, date, uuid);
CREATE OR REPLACE FUNCTION public.update_job(
  p_job_id uuid,
  p_deadline_date date,
  p_assigned_staff_id uuid DEFAULT NULL,
  p_applicant_name text DEFAULT NULL,
  p_party_name text DEFAULT NULL,
  p_party_mobile text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_job public.jobs%ROWTYPE;
  v_old_staff_id uuid;
  v_updated public.jobs%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_old_staff_id := v_job.assigned_staff_id;

  -- Validate staff if provided
  IF p_assigned_staff_id IS NOT NULL THEN
    PERFORM 1 FROM public.members
    WHERE id = p_assigned_staff_id AND business_id = v_biz_id AND active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Update job fields
  UPDATE public.jobs
  SET
    deadline_date = COALESCE(p_deadline_date, v_job.deadline_date),
    assigned_staff_id = p_assigned_staff_id,
    applicant_name = COALESCE(p_applicant_name, v_job.applicant_name),
    party_name = COALESCE(p_party_name, v_job.party_name),
    party_mobile = COALESCE(p_party_mobile, v_job.party_mobile),
    updated_at = now(),
    updated_by = v_member_id
  WHERE id = p_job_id
  RETURNING * INTO v_updated;

  -- Handle commission entry reassignment
  IF v_old_staff_id IS DISTINCT FROM p_assigned_staff_id THEN
    IF p_assigned_staff_id IS NOT NULL AND v_job.commission_percent > 0 THEN
      INSERT INTO public.commission_entries (
        job_id, staff_id, base_amount, percent, amount, status
      )
      VALUES (
        v_job.id,
        p_assigned_staff_id,
        v_job.amount,
        v_job.commission_percent,
        ROUND(v_job.amount * v_job.commission_percent / 100.0, 2),
        CASE WHEN v_job.status = 'COMPLETED' THEN 'EARNED' ELSE 'UPCOMING' END
      )
      ON CONFLICT (job_id) DO UPDATE SET
        staff_id = EXCLUDED.staff_id,
        updated_at = now(),
        updated_by = v_member_id;
    ELSIF p_assigned_staff_id IS NULL THEN
      DELETE FROM public.commission_entries WHERE job_id = v_job.id;
    END IF;
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_job(uuid, date, uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_job(uuid, date, uuid, text, text, text) TO authenticated;


-- 6. Comprehensive soft_delete with accounting safeguards
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
  v_has_records boolean;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Validate table
  IF p_table NOT IN (
    'customers', 'services', 'job_type_steps', 'vendors', 'payments',
    'expense_categories', 'expenses', 'loans', 'receipts', 'money_transfers', 'bank_accounts'
  ) THEN
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

  -- 1. Safeguard Customers: cannot delete if customer has invoices (BR-9)
  IF p_table = 'customers' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.invoices
      WHERE customer_id = p_id AND business_id = v_biz_id AND deleted_at IS NULL
    ) INTO v_has_records;
    IF v_has_records THEN
      RAISE EXCEPTION 'CUSTOMER_HAS_INVOICES' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2. Safeguard Expense Categories: system categories cannot be deleted
  IF p_table = 'expense_categories' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.expense_categories
      WHERE id = p_id AND system = true
    ) INTO v_has_records;
    IF v_has_records THEN
      RAISE EXCEPTION 'SYSTEM_CATEGORY_CANNOT_BE_DELETED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 3. Safeguard Expenses: system-generated expenses (from loan repayments or commission payouts) cannot be deleted directly
  IF p_table = 'expenses' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.expenses
      WHERE id = p_id AND business_id = v_biz_id AND (loan_repayment_id IS NOT NULL OR staff_id IS NOT NULL)
    ) INTO v_has_records;
    IF v_has_records THEN
      RAISE EXCEPTION 'SYSTEM_EXPENSE_READ_ONLY' USING ERRCODE = 'P0001';
    END IF;
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
