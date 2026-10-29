-- Migration 19: Add customer fallback to receipt_detail and introduce receipts_list RPC with full customer resolution

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
      'invoice_balance', (i.total - i.paid_amount)
    )
    ORDER BY i.invoice_date ASC, i.created_at ASC
  ), '[]'::jsonb)
  INTO v_allocs
  FROM public.receipt_allocations ra
  JOIN public.invoices i ON i.id = ra.invoice_id
  WHERE ra.receipt_id = v_receipt.id;

  RETURN jsonb_build_object(
    'receipt', to_jsonb(v_receipt),
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

REVOKE ALL ON FUNCTION public.receipt_detail(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.receipt_detail(uuid) TO authenticated;


-- RPC: receipts_list
-- Returns list of receipts with full customer resolution (from customers table or invoice party snapshot),
-- bank account info, and linked bill allocations.
CREATE OR REPLACE FUNCTION public.receipts_list(
  p_search text DEFAULT NULL,
  p_mode text DEFAULT 'ALL',
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_member_id uuid;
  v_results jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'business_id', r.business_id,
      'number', r.number,
      'fy_label', r.fy_label,
      'receipt_date', r.receipt_date,
      'amount', r.amount,
      'mode', r.mode,
      'reference', r.reference,
      'kind', r.kind,
      'income_category', r.income_category,
      'unallocated_amount', r.unallocated_amount,
      'notes', r.notes,
      'created_at', r.created_at,
      'customer_id', r.customer_id,
      'customer', jsonb_build_object(
        'name', COALESCE(c.name, inv_party.party_name, CASE WHEN r.kind = 'OTHER_INCOME' THEN COALESCE(r.income_category, 'Other Income') ELSE 'Walk-in Customer' END),
        'mobile', COALESCE(c.mobile, inv_party.party_mobile, NULL)
      ),
      'bank_name', ba.bank_name,
      'allocations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'amount', ra.amount,
          'invoice_number', i.number,
          'invoice', jsonb_build_object(
            'number', i.number,
            'party_name', i.party_name,
            'party_mobile', i.party_mobile
          )
        ))
        FROM public.receipt_allocations ra
        JOIN public.invoices i ON i.id = ra.invoice_id
        WHERE ra.receipt_id = r.id
      ), '[]'::jsonb)
    ) AS row_data
    FROM public.receipts r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    LEFT JOIN public.bank_accounts ba ON ba.id = r.bank_account_id
    LEFT JOIN LATERAL (
      SELECT i.party_name, i.party_mobile
      FROM public.receipt_allocations ra
      JOIN public.invoices i ON i.id = ra.invoice_id
      WHERE ra.receipt_id = r.id
      ORDER BY ra.created_at ASC
      LIMIT 1
    ) inv_party ON true
    WHERE r.business_id = v_biz_id
      AND r.deleted_at IS NULL
      AND (v_role != 'STAFF' OR r.created_by = v_member_id)
      AND (
        p_mode IS NULL
        OR p_mode = 'ALL'
        OR (p_mode = 'CASH' AND r.mode = 'CASH')
        OR (p_mode = 'BANK_UPI' AND r.mode IN ('BANK', 'UPI', 'CARD', 'CHEQUE'))
      )
      AND (
        p_search IS NULL
        OR p_search = ''
        OR r.number ILIKE '%' || p_search || '%'
        OR r.reference ILIKE '%' || p_search || '%'
        OR COALESCE(c.name, inv_party.party_name, '') ILIKE '%' || p_search || '%'
        OR COALESCE(c.mobile, inv_party.party_mobile, '') ILIKE '%' || p_search || '%'
        OR COALESCE(r.notes, '') ILIKE '%' || p_search || '%'
        OR COALESCE(r.income_category, '') ILIKE '%' || p_search || '%'
      )
    ORDER BY r.receipt_date DESC, r.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) q;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.receipts_list(text, text, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.receipts_list(text, text, int, int) TO authenticated;
