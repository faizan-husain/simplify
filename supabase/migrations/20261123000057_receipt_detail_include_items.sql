-- ==============================================================================
-- Migration: 20261123000057_receipt_detail_include_items.sql
-- Description: Update receipt_detail function to include invoice items and particulars
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.receipt_detail(p_receipt_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_receipt public.receipts%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_biz public.businesses%ROWTYPE;
  v_allocs jsonb := '[]'::jsonb;
  v_cust_current_due numeric(14,2) := 0;
  v_allocated_total numeric(14,2) := 0;
  v_ledger_summary jsonb := NULL;
  v_walkin_name text;
  v_walkin_mobile text;
  v_bank_name text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT * INTO v_receipt
  FROM public.receipts
  WHERE id = p_receipt_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Lookup bank name if bank_id is present
  IF v_receipt.bank_id IS NOT NULL THEN
    SELECT name INTO v_bank_name
    FROM public.bank_accounts
    WHERE id = v_receipt.bank_id AND business_id = v_biz_id;
  END IF;

  IF v_receipt.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust
    FROM public.customers
    WHERE id = v_receipt.customer_id AND business_id = v_biz_id;

    -- Calculate current customer remaining dues across active bills
    SELECT COALESCE(SUM(i.total - i.paid_amount), 0)
    INTO v_cust_current_due
    FROM public.invoices i
    WHERE i.customer_id = v_receipt.customer_id
      AND i.business_id = v_biz_id
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL;

    -- Calculate total allocated from this receipt
    SELECT COALESCE(SUM(amount), 0)
    INTO v_allocated_total
    FROM public.receipt_allocations
    WHERE receipt_id = v_receipt.id;

    v_ledger_summary := jsonb_build_object(
      'previous_due', v_cust_current_due + v_allocated_total,
      'amount_paid', v_receipt.amount,
      'allocated_to_bills', v_allocated_total,
      'remaining_due', v_cust_current_due,
      'customer_advance', COALESCE(v_receipt.unallocated_amount, 0)
    );
  ELSE
    -- For walk-in receipts without customer record: check invoice party snapshot
    SELECT i.party_name, i.party_mobile
    INTO v_walkin_name, v_walkin_mobile
    FROM public.receipt_allocations ra
    JOIN public.invoices i ON i.id = ra.invoice_id
    WHERE ra.receipt_id = v_receipt.id
    ORDER BY ra.created_at ASC
    LIMIT 1;

    IF v_walkin_name IS NOT NULL THEN
      v_cust.name := v_walkin_name;
      v_cust.mobile := v_walkin_mobile;
    ELSIF v_receipt.kind = 'OTHER_INCOME' THEN
      v_cust.name := COALESCE(v_receipt.income_category, 'Other Income');
    ELSE
      v_cust.name := 'Direct / Walk-in Customer';
    END IF;
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
      'invoice_balance', (i.total - i.paid_amount),
      'items', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ii.id,
            'description', ii.description,
            'quantity', ii.quantity,
            'rate', ii.rate,
            'amount', ii.amount,
            'applicant_name', ii.applicant_name
          )
        )
        FROM public.invoice_items ii
        WHERE ii.invoice_id = i.id
      ), '[]'::jsonb)
    )
    ORDER BY i.invoice_date ASC, i.created_at ASC
  ), '[]'::jsonb)
  INTO v_allocs
  FROM public.receipt_allocations ra
  JOIN public.invoices i ON i.id = ra.invoice_id
  WHERE ra.receipt_id = v_receipt.id;

  RETURN jsonb_build_object(
    'receipt', jsonb_set(to_jsonb(v_receipt), '{bank_name}', to_jsonb(COALESCE(v_bank_name, ''))),
    'customer', jsonb_build_object(
      'id', v_cust.id,
      'name', COALESCE(v_cust.name, 'Customer'),
      'mobile', v_cust.mobile,
      'address', v_cust.address,
      'type', v_cust.type
    ),
    'allocations', v_allocs,
    'ledger_summary', v_ledger_summary,
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

REVOKE ALL ON FUNCTION public.receipt_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.receipt_detail(uuid) TO authenticated;
