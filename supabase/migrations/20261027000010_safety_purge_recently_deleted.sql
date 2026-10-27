-- Migration 10: Safety, 30-day purge, and comprehensive Recently Deleted
-- =====================================================================

-- 1. Enhanced list_recently_deleted covering all soft-deletable entities
CREATE OR REPLACE FUNCTION public.list_recently_deleted()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_agg(item) INTO v_result FROM (
    SELECT 'customers' as table_name, id, name as label, 'Customer' as type_label, deleted_at
    FROM public.customers
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    UNION ALL
    SELECT 'services' as table_name, id, name as label, 'Service' as type_label, deleted_at
    FROM public.services
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    UNION ALL
    SELECT 'vendors' as table_name, id, name as label, 'Vendor' as type_label, deleted_at
    FROM public.vendors
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    UNION ALL
    SELECT 'payments' as table_name, id, COALESCE(description, 'Vendor Payment - ₹' || amount) as label, 'Payment' as type_label, deleted_at
    FROM public.payments
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    UNION ALL
    SELECT 'expenses' as table_name, id, COALESCE(description, 'Expense - ₹' || amount) as label, 'Expense' as type_label, deleted_at
    FROM public.expenses
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    UNION ALL
    SELECT 'loans' as table_name, id, 'Loan from ' || lender_name || ' (₹' || amount || ')' as label, 'Loan' as type_label, deleted_at
    FROM public.loans
    WHERE business_id = v_biz_id AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  ) item;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.list_recently_deleted() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_recently_deleted() TO authenticated;

-- 2. Permanent 30-day purge function per BR-18
CREATE OR REPLACE FUNCTION public.purge_deleted_records()
RETURNS jsonb AS $$
DECLARE
  v_cutoff timestamptz := now() - interval '30 days';
  v_count int := 0;
  v_step_count int := 0;
BEGIN
  -- 1. Purge job_type_steps for soft-deleted services
  DELETE FROM public.job_type_steps
  WHERE service_id IN (SELECT id FROM public.services WHERE deleted_at < v_cutoff);
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 2. Purge standalone receipts (no allocations)
  DELETE FROM public.receipts
  WHERE deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.receipt_allocations WHERE receipt_id = receipts.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 3. Purge payments
  DELETE FROM public.payments WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 4. Purge unlinked expenses (no salary payout or loan repayment links)
  DELETE FROM public.expenses
  WHERE deleted_at < v_cutoff AND staff_id IS NULL AND loan_repayment_id IS NULL;
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 5. Purge loans (if no repayments)
  DELETE FROM public.loans
  WHERE deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.loan_repayments WHERE loan_id = loans.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 6. Purge vendors (if no payments)
  DELETE FROM public.vendors
  WHERE deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.payments WHERE vendor_id = vendors.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 7. Purge services (if not used in invoice items or jobs)
  DELETE FROM public.services
  WHERE deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.invoice_items WHERE service_id = services.id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.jobs WHERE service_id = services.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 8. Purge customers (if no invoices and no receipts)
  DELETE FROM public.customers
  WHERE deleted_at < v_cutoff AND NOT EXISTS (
    SELECT 1 FROM public.invoices WHERE customer_id = customers.id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.receipts WHERE customer_id = customers.id
  );
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  -- 9. Purge whatsapp_templates
  DELETE FROM public.whatsapp_templates WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_step_count = ROW_COUNT;
  v_count := v_count + v_step_count;

  RETURN jsonb_build_object('purged_rows', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.purge_deleted_records() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.purge_deleted_records() TO authenticated, service_role;

-- 3. Register nightly cron job if pg_cron is present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.schedule('nightly-purge-deleted', '0 3 * * *', 'SELECT public.purge_deleted_records()');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;
