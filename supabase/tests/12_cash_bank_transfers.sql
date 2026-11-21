-- Test Suite: 12_cash_bank_transfers.sql
-- Covers Cash in Hand tracking, Contra Transfers (Cash to Bank, Bank to Cash, Bank to Bank),
-- Zero-impact on P&L Net Profit, Automatic dual-account balance updates, and Soft-delete reversal.

BEGIN;
SELECT plan(14);

-- Setup business and staff as admin
DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Cash & Bank Test Biz', 'Rajesh Gupta', '9876543401');
  v_biz_id := (v_biz->>'business_id')::uuid;

  -- Set opening cash balance to 1,000
  UPDATE public.businesses SET opening_cash_balance = 1000.00 WHERE id = v_biz_id;

  -- Add staff member
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Staff Cashier', '9876543499', 'STAFF', true, true, '66666666-6666-6666-6666-666666666666');
END $$;

-- Switch to authenticated role
SET ROLE authenticated;

DO $$
DECLARE
  v_owner_auth_id text := '77777777-7777-7777-7777-777777777777';
  v_staff_auth_id text := '66666666-6666-6666-6666-666666666666';
  v_sbi_id uuid;
  v_hdfc_id uuid;
  v_cust_id uuid;
  v_rcpt_res jsonb;
  v_transfer1 jsonb;
  v_transfer2 jsonb;
  v_transfer3 jsonb;
  v_transfer3_id uuid;
  v_summary jsonb;
  v_pnl_before jsonb;
  v_pnl_after jsonb;
  v_sbi_ledger jsonb;
  v_staff_error boolean := false;
  v_same_bank_error boolean := false;
BEGIN
  -- Set Owner session
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. Create two bank accounts: SBI (opening 5,000) and HDFC (opening 2,000)
  INSERT INTO public.bank_accounts (bank_name, account_name, account_number, opening_balance)
  VALUES ('State Bank of India', 'Rajesh Gupta Current', '111122223333', 5000.00)
  RETURNING id INTO v_sbi_id;

  INSERT INTO public.bank_accounts (bank_name, account_name, account_number, opening_balance)
  VALUES ('HDFC Bank', 'Rajesh Gupta Business', '444455556666', 2000.00)
  RETURNING id INTO v_hdfc_id;

  PERFORM ok(v_sbi_id IS NOT NULL AND v_hdfc_id IS NOT NULL, 'SBI and HDFC bank accounts created successfully');

  -- 2. Create customer and record Cash Receipt of ₹1,500
  INSERT INTO public.customers (name, mobile, type)
  VALUES ('Amit Verma', '9876543402', 'REGULAR')
  RETURNING id INTO v_cust_id;

  v_rcpt_res := public.create_receipt(jsonb_build_object(
    'customer_id', v_cust_id,
    'amount', 1500.00,
    'mode', 'CASH',
    'receipt_date', (SELECT app.today())
  ));

  -- Initial summary check
  v_summary := public.cash_bank_summary();
  PERFORM is((v_summary->'cash_in_hand'->>'current_balance')::numeric, 2500.00,
    'Initial Cash in Hand = opening 1,000 + cash receipt 1,500 = ₹2,500');

  -- Record initial P&L Net Profit
  v_pnl_before := public.report('pnl', jsonb_build_object('from_date', (SELECT app.today()), 'to_date', (SELECT app.today())));

  -- 3. Transfer 1: CASH_TO_BANK (Deposit ₹1,000 cash into SBI)
  v_transfer1 := public.record_money_transfer(jsonb_build_object(
    'transfer_type', 'CASH_TO_BANK',
    'to_bank_account_id', v_sbi_id,
    'amount', 1000.00,
    'reference', 'CHQ-101',
    'notes', 'Cash deposited at branch'
  ));
  PERFORM ok(v_transfer1->>'id' IS NOT NULL, 'Cash to Bank deposit recorded successfully');

  v_summary := public.cash_bank_summary();
  PERFORM is((v_summary->'cash_in_hand'->>'current_balance')::numeric, 1500.00,
    'Cash in Hand decreased by ₹1,000 to ₹1,500 after deposit');

  -- 4. Transfer 2: BANK_TO_CASH (Withdraw ₹500 cash from HDFC)
  v_transfer2 := public.record_money_transfer(jsonb_build_object(
    'transfer_type', 'BANK_TO_CASH',
    'from_bank_account_id', v_hdfc_id,
    'amount', 500.00,
    'reference', 'ATM-778',
    'notes', 'ATM cash withdrawal for counter'
  ));
  PERFORM ok(v_transfer2->>'id' IS NOT NULL, 'Bank to Cash withdrawal recorded successfully');

  v_summary := public.cash_bank_summary();
  PERFORM is((v_summary->'cash_in_hand'->>'current_balance')::numeric, 2000.00,
    'Cash in Hand increased by ₹500 to ₹2,000 after withdrawal');

  -- 5. Transfer 3: BANK_TO_BANK (Transfer ₹1,000 from SBI to HDFC)
  v_transfer3 := public.record_money_transfer(jsonb_build_object(
    'transfer_type', 'BANK_TO_BANK',
    'from_bank_account_id', v_sbi_id,
    'to_bank_account_id', v_hdfc_id,
    'amount', 1000.00,
    'reference', 'IMPS998811',
    'notes', 'Fund transfer to HDFC'
  ));
  v_transfer3_id := (v_transfer3->>'id')::uuid;
  PERFORM ok(v_transfer3_id IS NOT NULL, 'Bank to Bank transfer recorded successfully');

  -- 6. Verify individual bank balances:
  -- SBI: 5000 (opening) + 1000 (deposit from cash) - 1000 (transfer to HDFC) = 5000
  -- HDFC: 2000 (opening) - 500 (ATM withdrawal) + 1000 (transfer from SBI) = 2500
  v_summary := public.cash_bank_summary();
  PERFORM is(
    (SELECT (elem->>'current_balance')::numeric FROM jsonb_array_elements(v_summary->'bank_accounts') elem WHERE (elem->>'id')::uuid = v_sbi_id),
    5000.00,
    'SBI balance correctly computed as ₹5,000 after transfers'
  );

  PERFORM is(
    (SELECT (elem->>'current_balance')::numeric FROM jsonb_array_elements(v_summary->'bank_accounts') elem WHERE (elem->>'id')::uuid = v_hdfc_id),
    2500.00,
    'HDFC balance correctly computed as ₹2,500 after transfers'
  );

  -- Total liquid funds: 2000 (cash) + 7500 (banks) = 9500
  PERFORM is((v_summary->>'total_liquid_funds')::numeric, 9500.00,
    'Total liquid funds = Cash ₹2,000 + Banks ₹7,500 = ₹9,500');

  -- 7. CRITICAL TEST: Zero P&L / Net Profit Impact
  v_pnl_after := public.report('pnl', jsonb_build_object('from_date', (SELECT app.today()), 'to_date', (SELECT app.today())));
  PERFORM is((v_pnl_after->>'net_profit')::numeric, (v_pnl_before->>'net_profit')::numeric,
    'Net Profit is IDENTICAL before and after all transfers (Transfers have ZERO P&L effect)');

  -- 8. Verify bank_ledger integration for SBI includes TRANSFER_IN and TRANSFER_OUT
  v_sbi_ledger := public.bank_ledger(v_sbi_id);
  PERFORM ok(
    jsonb_path_exists(v_sbi_ledger, '$.entries[*] ? (@.txn_type == "TRANSFER_IN")') AND
    jsonb_path_exists(v_sbi_ledger, '$.entries[*] ? (@.txn_type == "TRANSFER_OUT")'),
    'bank_ledger for SBI accurately includes incoming and outgoing transfers in passbook'
  );

  -- 9. Soft-delete Transfer 3 (SBI -> HDFC reversal)
  PERFORM public.soft_delete('money_transfers', v_transfer3_id);
  v_summary := public.cash_bank_summary();

  -- SBI balance restored back to 6,000 and HDFC back to 1,500
  PERFORM is(
    (SELECT (elem->>'current_balance')::numeric FROM jsonb_array_elements(v_summary->'bank_accounts') elem WHERE (elem->>'id')::uuid = v_sbi_id),
    6000.00,
    'Deleting transfer 3 automatically restores SBI balance to ₹6,000'
  );

  -- 10. Security: Staff forbidden from recording money transfer
  PERFORM set_config('request.jwt.claim.sub', v_staff_auth_id, true);
  BEGIN
    PERFORM public.record_money_transfer(jsonb_build_object(
      'transfer_type', 'CASH_TO_BANK',
      'to_bank_account_id', v_sbi_id,
      'amount', 100.00
    ));
  EXCEPTION WHEN OTHERS THEN
    v_staff_error := true;
  END;
  PERFORM ok(v_staff_error, 'Staff is FORBIDDEN from recording money transfers');

END $$;

ROLLBACK;
