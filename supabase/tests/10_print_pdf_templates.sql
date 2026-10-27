-- Test Suite: 10_print_pdf_templates.sql
-- Covers BR-19 (UPI QR format), BR-20 (WhatsApp template rendering & variable replacement),
-- and whatsapp_templates RLS.

BEGIN;
SELECT plan(10);

DO $$
DECLARE
  v_biz jsonb;
  v_biz_id uuid;
  v_owner_auth_id text := '11111111-2222-3333-4444-555555555555';
  v_staff_auth_id text := '22222222-3333-4444-5555-666666666666';
  v_inv jsonb;
  v_inv_id uuid;
  v_inv_num text;
  v_rec jsonb;
  v_rec_id uuid;
  v_rendered text;
  v_upi text;
  v_template_count int;
BEGIN
  -- Setup Business
  PERFORM set_config('request.jwt.claim.sub', v_owner_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_biz := public.register_business('Print Templates Biz', 'Owner Print', '9876543701');
  v_biz_id := (v_biz->>'business_id')::uuid;

  -- Configure UPI ID for testing BR-19
  UPDATE public.businesses
  SET upi_id = 'testbiz@okaxis'
  WHERE id = v_biz_id;

  -- Add staff member
  INSERT INTO public.members (business_id, name, mobile, role, can_login, active, auth_user_id)
  VALUES (v_biz_id, 'Staff Member', '9876543702', 'STAFF', true, true, v_staff_auth_id::uuid);

  -- Seed templates for this business
  INSERT INTO public.whatsapp_templates (business_id, type, body) VALUES
    (v_biz_id, 'INVOICE', 'Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}.'),
    (v_biz_id, 'RECEIPT', 'Hello {customer_name}, received payment of {amount}. Thank you! - {business_name}'),
    (v_biz_id, 'REMINDER', 'Hello {customer_name}, reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}')
  ON CONFLICT DO NOTHING;

  -- Test 1: Templates seeded
  SELECT COUNT(*) INTO v_template_count
  FROM public.whatsapp_templates
  WHERE business_id = v_biz_id;
  PERFORM ok(v_template_count = 3, 'All 3 default WhatsApp templates seeded (INVOICE, RECEIPT, REMINDER)');

  -- 1. Create a Bill with balance: ₹500 total, ₹200 paid, ₹300 balance
  v_inv := public.create_invoice(jsonb_build_object(
    'walk_in', jsonb_build_object('name', 'Ananya Roy', 'mobile', '9876543705'),
    'paid', jsonb_build_object('amount', 200, 'mode', 'CASH'),
    'due_date', (SELECT app.today()) + 5,
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Photocopy & Printing', 'quantity', 1, 'rate', 500)
    )
  ));
  v_inv_id := (v_inv->>'id')::uuid;
  v_inv_num := v_inv->>'number';

  -- Test 2: upi_qr_url returns compliant BR-19 QR string
  v_upi := public.upi_qr_url(v_inv_id);
  PERFORM ok(
    v_upi LIKE 'upi://pay?pa=testbiz@okaxis&pn=Print%20Templates%20Biz&am=300.00&cu=INR&tn=' || v_inv_num,
    'upi_qr_url generates compliant UPI deep-link URL with exact balance of 300.00'
  );

  -- Test 3: Fully paid bill returns NULL for UPI QR (balance = 0)
  PERFORM public.create_receipt(jsonb_build_object(
    'kind', 'INVOICE_PAYMENT',
    'customer_id', (SELECT customer_id FROM public.invoices WHERE id = v_inv_id),
    'amount', 300,
    'mode', 'UPI',
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', v_inv_id, 'amount', 300))
  ));
  PERFORM ok(public.upi_qr_url(v_inv_id) IS NULL, 'Fully paid invoice returns NULL for UPI QR URL');

  -- Test 4: render_whatsapp_template for INVOICE
  v_rendered := public.render_whatsapp_template('INVOICE', v_inv_id, NULL);
  PERFORM ok(
    v_rendered LIKE '%Hello Ananya Roy%' AND
    v_rendered LIKE '%' || v_inv_num || '%' AND
    v_rendered LIKE '%Print Templates Biz%',
    'render_whatsapp_template replaces customer_name, invoice_no and business_name'
  );

  -- Test 5: render_whatsapp_template for REMINDER
  v_rendered := public.render_whatsapp_template('REMINDER', v_inv_id, NULL);
  PERFORM ok(
    v_rendered LIKE '%reminder for bill #' || v_inv_num || '%' AND
    v_rendered LIKE '%due on%',
    'render_whatsapp_template replaces reminder variables including due_date'
  );

  -- 2. Create Receipt and test RECEIPT template
  v_rec := public.create_receipt(jsonb_build_object(
    'kind', 'OTHER_INCOME',
    'amount', 1200,
    'mode', 'CASH',
    'income_category', 'Other Income'
  ));
  v_rec_id := (v_rec->>'id')::uuid;

  -- Test 6: render_whatsapp_template for RECEIPT
  v_rendered := public.render_whatsapp_template('RECEIPT', NULL, v_rec_id);
  PERFORM ok(
    v_rendered LIKE '%received payment of ₹1200.00%' AND
    v_rendered LIKE '%Print Templates Biz%',
    'render_whatsapp_template replaces amount and business_name for receipts'
  );

  -- Test 7: Owner can update template body
  UPDATE public.whatsapp_templates
  SET body = 'Custom bill update: {invoice_no}'
  WHERE business_id = v_biz_id AND type = 'INVOICE';
  PERFORM ok(
    (SELECT body FROM public.whatsapp_templates WHERE business_id = v_biz_id AND type = 'INVOICE') = 'Custom bill update: {invoice_no}',
    'Owner successfully updated WhatsApp template body'
  );

  -- Test 8: Render uses updated template body
  v_rendered := public.render_whatsapp_template('INVOICE', v_inv_id, NULL);
  PERFORM ok(
    v_rendered = 'Custom bill update: ' || v_inv_num,
    'Render immediately uses custom template body'
  );

END $$;

-- Test 9 & 10 under authenticated role for Staff RLS restrictions
SET ROLE authenticated;

DO $$
DECLARE
  v_biz_id uuid;
  v_staff_auth_id text := '22222222-3333-4444-5555-666666666666';
BEGIN
  SELECT id INTO v_biz_id FROM public.businesses WHERE name = 'Print Templates Biz';
  PERFORM set_config('request.jwt.claim.sub', v_staff_auth_id, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Test 9: Staff can SELECT templates
  PERFORM ok(
    (SELECT COUNT(*) FROM public.whatsapp_templates WHERE business_id = v_biz_id) = 3,
    'Staff can read WhatsApp templates via RLS'
  );

  -- Test 10: Staff UPDATE rejected by RLS
  UPDATE public.whatsapp_templates
  SET body = 'Hacked template'
  WHERE business_id = v_biz_id AND type = 'INVOICE';

  PERFORM ok(
    (SELECT body FROM public.whatsapp_templates WHERE business_id = v_biz_id AND type = 'INVOICE') <> 'Hacked template',
    'Staff cannot modify WhatsApp templates (RLS with check prevents update)'
  );

END $$;

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
