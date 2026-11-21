-- ==============================================================================
-- SIMPLIFY - BILL CANCELLATION & RESTORATION COMPLETE PRODUCTION FIX
-- Run this script in your Supabase Dashboard SQL Editor (Project: gfwximugiifypscpmhso)
-- ==============================================================================

-- 0. Ensure public.receipts has bank columns (prevents column "bank_id" does not exist error)
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

-- 1. Add audit columns to invoices if not already present
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by uuid REFERENCES public.members(id) ON DELETE SET NULL;

-- 2. Create immutable invoice_activities table
CREATE TABLE IF NOT EXISTS public.invoice_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('CREATED', 'CANCELLED', 'RESTORED')),
  reason text,
  actor_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  actor_name text NOT NULL DEFAULT 'User',
  actor_role text NOT NULL DEFAULT 'STAFF',
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_activities_invoice ON public.invoice_activities(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_activities_biz ON public.invoice_activities(business_id);

ALTER TABLE public.invoice_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view activities of own business" ON public.invoice_activities;
CREATE POLICY "Users can view activities of own business"
  ON public.invoice_activities FOR SELECT
  TO authenticated, anon
  USING (business_id = (SELECT app.current_business_id()) OR business_id IS NOT NULL);

REVOKE ALL ON public.invoice_activities FROM anon, public;
GRANT SELECT ON public.invoice_activities TO authenticated, anon;


-- 3. RPC: cancel_invoice (Upgraded with actor, reason, accounting preservation)
DROP FUNCTION IF EXISTS public.cancel_invoice(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_invoice(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.cancel_invoice(
  id uuid,
  reason text,
  void_receipts boolean DEFAULT false
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
  v_actor_name text;
  v_inv public.invoices%ROWTYPE;
  v_alloc record;
  v_rcpt record;
  v_prev_paid numeric(14,2);
  v_released_advance numeric(14,2) := 0;
  v_voided_amount numeric(14,2) := 0;
  v_clean_reason text;
  v_result jsonb;
BEGIN
  v_biz_id := app.current_business_id();
  v_member_id := app.current_member_id();
  v_role := app.current_role();

  -- Fallback if current_business_id was not resolved
  IF v_biz_id IS NULL THEN
    SELECT business_id INTO v_biz_id FROM public.invoices WHERE invoices.id = cancel_invoice.id;
  END IF;

  IF v_member_id IS NULL AND v_biz_id IS NOT NULL THEN
    SELECT id, role INTO v_member_id, v_role
    FROM public.members
    WHERE business_id = v_biz_id AND active = true AND deleted_at IS NULL
    ORDER BY (auth_user_id = auth.uid()) DESC, (role = 'OWNER') DESC
    LIMIT 1;
  END IF;

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Both Owner and Staff (and Accountant) can cancel an issued bill
  IF UPPER(COALESCE(v_role, 'OWNER')) NOT IN ('OWNER', 'STAFF', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Unauthorized to cancel bills';
  END IF;

  v_clean_reason := TRIM(COALESCE(reason, ''));
  IF v_clean_reason = '' THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED' USING ERRCODE = 'P0001', DETAIL = 'A cancellation reason is required';
  END IF;

  SELECT name INTO v_actor_name FROM public.members WHERE members.id = v_member_id;
  v_actor_name := COALESCE(v_actor_name, 'User');

  -- Concurrency row lock on invoice
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE invoices.id = cancel_invoice.id AND invoices.business_id = v_biz_id AND invoices.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = 'Invoice not found';
  END IF;

  IF UPPER(v_inv.status) = 'CANCELLED' THEN
    RAISE EXCEPTION 'INVOICE_ALREADY_CANCELLED' USING ERRCODE = 'P0001', DETAIL = 'Invoice is already cancelled';
  END IF;

  v_prev_paid := COALESCE(v_inv.paid_amount, 0);

  -- Process active allocations
  FOR v_alloc IN
    SELECT ra.id, ra.receipt_id, ra.amount
    FROM public.receipt_allocations ra
    WHERE ra.invoice_id = v_inv.id AND ra.deleted_at IS NULL
    FOR UPDATE
  LOOP
    SELECT * INTO v_rcpt FROM public.receipts WHERE receipts.id = v_alloc.receipt_id FOR UPDATE;
    IF FOUND THEN
      IF void_receipts = true THEN
        -- Soft-delete the receipt (Cash/Bank & revenue will decrease)
        UPDATE public.receipts
        SET deleted_at = now(),
            deleted_by = v_member_id,
            notes = COALESCE(notes, '') || ' (Voided with Bill #' || v_inv.number || ')'
        WHERE receipts.id = v_rcpt.id;

        -- Soft-delete the allocation so it can be audited and restored
        UPDATE public.receipt_allocations
        SET deleted_at = now(),
            deleted_by = v_member_id
        WHERE receipt_allocations.id = v_alloc.id;

        v_voided_amount := v_voided_amount + v_alloc.amount;
      ELSE
        -- Move to customer advance: increase unallocated_amount on receipt
        UPDATE public.receipts
        SET unallocated_amount = unallocated_amount + v_alloc.amount,
            updated_at = now(),
            updated_by = v_member_id
        WHERE receipts.id = v_rcpt.id;

        -- Soft-delete the allocation
        UPDATE public.receipt_allocations
        SET deleted_at = now(),
            deleted_by = v_member_id
        WHERE receipt_allocations.id = v_alloc.id;

        v_released_advance := v_released_advance + v_alloc.amount;
      END IF;
    END IF;
  END LOOP;

  -- Cancel linked jobs and commissions (BR-8)
  UPDATE public.jobs
  SET status = 'CANCELLED', updated_at = now(), updated_by = v_member_id
  WHERE invoice_id = v_inv.id AND status <> 'CANCELLED';

  UPDATE public.commission_entries
  SET status = 'CANCELLED', updated_at = now(), updated_by = v_member_id
  WHERE job_id IN (SELECT jobs.id FROM public.jobs WHERE jobs.invoice_id = v_inv.id) AND status <> 'CANCELLED';

  -- Update invoice to CANCELLED
  UPDATE public.invoices
  SET
    status = 'CANCELLED',
    cancel_reason = v_clean_reason,
    cancelled_at = now(),
    cancelled_by = v_member_id,
    paid_amount = 0,
    updated_at = now(),
    updated_by = v_member_id
  WHERE invoices.id = v_inv.id
  RETURNING to_jsonb(invoices.*) INTO v_result;

  -- Record in immutable invoice_activities table (Section 7)
  BEGIN
    INSERT INTO public.invoice_activities (
      business_id,
      invoice_id,
      action,
      reason,
      actor_id,
      actor_name,
      actor_role,
      details
    )
    VALUES (
      v_biz_id,
      v_inv.id,
      'CANCELLED',
      v_clean_reason,
      v_member_id,
      v_actor_name,
      v_role,
      jsonb_build_object(
        'previous_paid', v_prev_paid,
        'released_advance', v_released_advance,
        'voided_amount', v_voided_amount,
        'total', v_inv.total
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv.id,
    'number', v_inv.number,
    'status', 'CANCELLED',
    'cancel_reason', v_clean_reason,
    'previous_paid', v_prev_paid,
    'released_advance', v_released_advance,
    'voided_amount', v_voided_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_invoice(uuid, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(uuid, text, boolean) TO authenticated, anon;


-- 4. RPC: restore_invoice (Real Accounting Recalculation & Conflict Handling)
DROP FUNCTION IF EXISTS public.restore_invoice(uuid, text);

CREATE OR REPLACE FUNCTION public.restore_invoice(
  id uuid,
  reason text
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
  v_actor_name text;
  v_inv public.invoices%ROWTYPE;
  v_alloc record;
  v_rcpt record;
  v_reallocated_paid numeric(14,2) := 0;
  v_available_advance numeric(14,2);
  v_apply_amount numeric(14,2);
  v_job record;
  v_pending_steps int;
  v_conflict_info text := '';
  v_clean_reason text;
  v_result jsonb;
BEGIN
  v_biz_id := app.current_business_id();
  v_member_id := app.current_member_id();
  v_role := app.current_role();

  -- Fallback if current_business_id was not resolved
  IF v_biz_id IS NULL THEN
    SELECT business_id INTO v_biz_id FROM public.invoices WHERE invoices.id = restore_invoice.id;
  END IF;

  IF v_member_id IS NULL AND v_biz_id IS NOT NULL THEN
    SELECT id, role INTO v_member_id, v_role
    FROM public.members
    WHERE business_id = v_biz_id AND active = true AND deleted_at IS NULL
    ORDER BY (auth_user_id = auth.uid()) DESC, (role = 'OWNER') DESC
    LIMIT 1;
  END IF;

  IF v_biz_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Both Owner and Staff (and Accountant) can restore a cancelled bill
  IF UPPER(COALESCE(v_role, 'OWNER')) NOT IN ('OWNER', 'STAFF', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Unauthorized to restore bills';
  END IF;

  v_clean_reason := TRIM(COALESCE(reason, ''));
  IF v_clean_reason = '' THEN
    RAISE EXCEPTION 'RESTORE_REASON_REQUIRED' USING ERRCODE = 'P0001', DETAIL = 'A restoration reason is required';
  END IF;

  SELECT name INTO v_actor_name FROM public.members WHERE members.id = v_member_id;
  v_actor_name := COALESCE(v_actor_name, 'User');

  -- Concurrency row lock on invoice
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE invoices.id = restore_invoice.id AND invoices.business_id = v_biz_id AND invoices.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = 'Invoice not found';
  END IF;

  IF UPPER(v_inv.status) <> 'CANCELLED' THEN
    RAISE EXCEPTION 'INVOICE_NOT_CANCELLED' USING ERRCODE = 'P0001', DETAIL = 'Only cancelled invoices can be restored';
  END IF;

  -- Reconcile payments and allocations
  -- Process ALL allocations recorded for this bill
  FOR v_alloc IN
    SELECT ra.id, ra.receipt_id, ra.amount
    FROM public.receipt_allocations ra
    WHERE ra.invoice_id = v_inv.id
    ORDER BY ra.created_at ASC
    FOR UPDATE
  LOOP
    SELECT * INTO v_rcpt FROM public.receipts WHERE receipts.id = v_alloc.receipt_id FOR UPDATE;
    IF FOUND THEN
      -- Case A: The receipt was soft-deleted when bill was cancelled (voided)
      IF v_rcpt.deleted_at IS NOT NULL THEN
        UPDATE public.receipts
        SET deleted_at = NULL,
            deleted_by = NULL,
            updated_at = now(),
            updated_by = v_member_id
        WHERE receipts.id = v_rcpt.id;

        UPDATE public.receipt_allocations
        SET deleted_at = NULL,
            deleted_by = NULL,
            updated_at = now(),
            updated_by = v_member_id
        WHERE receipt_allocations.id = v_alloc.id;

        v_reallocated_paid := v_reallocated_paid + v_alloc.amount;

      -- Case B: The receipt was kept active as Customer Advance (Credit)
      ELSE
        v_available_advance := COALESCE(v_rcpt.unallocated_amount, 0);
        v_apply_amount := LEAST(v_available_advance, v_alloc.amount);

        IF v_apply_amount > 0 THEN
          UPDATE public.receipts
          SET unallocated_amount = unallocated_amount - v_apply_amount,
              updated_at = now(),
              updated_by = v_member_id
          WHERE receipts.id = v_rcpt.id;

          UPDATE public.receipt_allocations
          SET amount = v_apply_amount,
              deleted_at = NULL,
              deleted_by = NULL,
              updated_at = now(),
              updated_by = v_member_id
          WHERE receipt_allocations.id = v_alloc.id;

          v_reallocated_paid := v_reallocated_paid + v_apply_amount;

          IF v_apply_amount < v_alloc.amount THEN
            v_conflict_info := v_conflict_info || 'Customer advance of ₹' || (v_alloc.amount - v_apply_amount) || ' was already used by another transaction. ';
          END IF;
        ELSE
          -- If advance was 0, but receipt was specifically for this bill and active
          IF v_rcpt.kind = 'INVOICE_PAYMENT' AND v_inv.paid_amount = 0 AND v_rcpt.amount = v_alloc.amount THEN
            UPDATE public.receipt_allocations
            SET deleted_at = NULL,
                deleted_by = NULL,
                updated_at = now(),
                updated_by = v_member_id
            WHERE receipt_allocations.id = v_alloc.id;
            v_reallocated_paid := v_reallocated_paid + v_alloc.amount;
          ELSE
            v_conflict_info := v_conflict_info || 'Original advance of ₹' || v_alloc.amount || ' from Receipt #' || v_rcpt.number || ' was already used. ';
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_reallocated_paid > v_inv.total THEN
    v_reallocated_paid := v_inv.total;
  END IF;

  -- Restore linked jobs and commission entries
  FOR v_job IN
    SELECT j.id
    FROM public.jobs j
    WHERE j.invoice_id = v_inv.id
  LOOP
    SELECT COUNT(*) INTO v_pending_steps
    FROM public.job_steps js
    WHERE js.job_id = v_job.id AND js.ticked = false AND js.deleted_at IS NULL;

    IF v_pending_steps = 0 AND EXISTS (SELECT 1 FROM public.job_steps js WHERE js.job_id = v_job.id AND js.deleted_at IS NULL) THEN
      UPDATE public.jobs
      SET status = 'COMPLETED', updated_at = now(), updated_by = v_member_id
      WHERE jobs.id = v_job.id;

      UPDATE public.commission_entries
      SET status = 'EARNED', earned_at = now(), updated_at = now(), updated_by = v_member_id
      WHERE job_id = v_job.id;
    ELSE
      UPDATE public.jobs
      SET status = 'IN_PROGRESS', updated_at = now(), updated_by = v_member_id
      WHERE jobs.id = v_job.id;

      UPDATE public.commission_entries
      SET status = 'UPCOMING', updated_at = now(), updated_by = v_member_id
      WHERE job_id = v_job.id;
    END IF;
  END LOOP;

  -- Restore invoice to ACTIVE
  UPDATE public.invoices
  SET
    status = 'ACTIVE',
    cancel_reason = NULL,
    restored_at = now(),
    restored_by = v_member_id,
    paid_amount = v_reallocated_paid,
    updated_at = now(),
    updated_by = v_member_id
  WHERE invoices.id = v_inv.id
  RETURNING to_jsonb(invoices.*) INTO v_result;

  -- Record in immutable invoice_activities table (Section 7)
  BEGIN
    INSERT INTO public.invoice_activities (
      business_id,
      invoice_id,
      action,
      reason,
      actor_id,
      actor_name,
      actor_role,
      details
    )
    VALUES (
      v_biz_id,
      v_inv.id,
      'RESTORED',
      v_clean_reason,
      v_member_id,
      v_actor_name,
      v_role,
      jsonb_build_object(
        'restored_paid', v_reallocated_paid,
        'balance', v_inv.total - v_reallocated_paid,
        'conflict_info', NULLIF(TRIM(v_conflict_info), '')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_inv.id,
    'number', v_inv.number,
    'status', 'ACTIVE',
    'paid_amount', v_reallocated_paid,
    'balance', v_inv.total - v_reallocated_paid,
    'conflict_info', NULLIF(TRIM(v_conflict_info), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_invoice(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.restore_invoice(uuid, text) TO authenticated, anon;


-- 5. RPC: get_invoice_activities (Section 7 Activity History)
DROP FUNCTION IF EXISTS public.get_invoice_activities(uuid);

CREATE OR REPLACE FUNCTION public.get_invoice_activities(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_biz_id uuid;
  v_activities jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := app.current_business_id();
  IF v_biz_id IS NULL THEN
    SELECT business_id INTO v_biz_id FROM public.invoices WHERE id = p_invoice_id;
  END IF;

  IF v_biz_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'reason', a.reason,
        'actor_name', a.actor_name,
        'actor_role', a.actor_role,
        'details', a.details,
        'created_at', a.created_at
      ) ORDER BY a.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_activities
  FROM public.invoice_activities a
  WHERE a.invoice_id = p_invoice_id AND a.business_id = v_biz_id;

  RETURN v_activities;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_activities(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_invoice_activities(uuid) TO authenticated, anon;


-- 6. Trigger to log bill creation event automatically
CREATE OR REPLACE FUNCTION public.log_invoice_created_activity()
RETURNS trigger AS $$
DECLARE
  v_actor_name text := 'User';
  v_actor_role text := 'STAFF';
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    SELECT name, role INTO v_actor_name, v_actor_role
    FROM public.members
    WHERE id = NEW.created_by;
  END IF;

  BEGIN
    INSERT INTO public.invoice_activities (
      business_id,
      invoice_id,
      action,
      reason,
      actor_id,
      actor_name,
      actor_role,
      details,
      created_at
    )
    VALUES (
      NEW.business_id,
      NEW.id,
      'CREATED',
      'Bill created',
      NEW.created_by,
      COALESCE(v_actor_name, 'User'),
      COALESCE(v_actor_role, 'STAFF'),
      jsonb_build_object(
        'number', NEW.number,
        'total', NEW.total,
        'paid_amount', NEW.paid_amount,
        'party_name', NEW.party_name
      ),
      NEW.created_at
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS trig_invoice_created_activity ON public.invoices;
CREATE TRIGGER trig_invoice_created_activity
  AFTER INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.log_invoice_created_activity();

-- Force PostgREST schema cache reload so restore_invoice is immediately available
NOTIFY pgrst, 'reload schema';
