-- Migration 9: Print, PDF, QR & WhatsApp templates
-- Conforms to BR-19 (UPI QR format), BR-20 (WhatsApp templates & deep links), and §8.16

-- 1. Table: whatsapp_templates
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('INVOICE', 'RECEIPT', 'REMINDER')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT uq_whatsapp_templates_biz_type UNIQUE (business_id, type)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_biz_type ON public.whatsapp_templates(business_id, type);

CREATE OR REPLACE TRIGGER trg_whatsapp_templates_audit
BEFORE INSERT OR UPDATE ON public.whatsapp_templates
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Enable RLS and FORCE RLS
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_templates_select ON public.whatsapp_templates;
CREATE POLICY whatsapp_templates_select ON public.whatsapp_templates
FOR SELECT TO authenticated
USING (
  business_id = (SELECT app.current_business_id())
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS whatsapp_templates_insert ON public.whatsapp_templates;
CREATE POLICY whatsapp_templates_insert ON public.whatsapp_templates
FOR INSERT TO authenticated
WITH CHECK (
  business_id = (SELECT app.current_business_id())
  AND (SELECT app.current_role()) = 'OWNER'
);

DROP POLICY IF EXISTS whatsapp_templates_update ON public.whatsapp_templates;
CREATE POLICY whatsapp_templates_update ON public.whatsapp_templates
FOR UPDATE TO authenticated
USING (
  business_id = (SELECT app.current_business_id())
  AND (SELECT app.current_role()) = 'OWNER'
)
WITH CHECK (
  business_id = (SELECT app.current_business_id())
  AND (SELECT app.current_role()) = 'OWNER'
);

-- Seed default templates for existing businesses
INSERT INTO public.whatsapp_templates (business_id, type, body)
SELECT b.id, 'INVOICE', 'Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}.'
FROM public.businesses b
ON CONFLICT (business_id, type) DO NOTHING;

INSERT INTO public.whatsapp_templates (business_id, type, body)
SELECT b.id, 'RECEIPT', 'Hello {customer_name}, received payment of {amount} for bill #{invoice_no}. Thank you! - {business_name}'
FROM public.businesses b
ON CONFLICT (business_id, type) DO NOTHING;

INSERT INTO public.whatsapp_templates (business_id, type, body)
SELECT b.id, 'REMINDER', 'Hello {customer_name}, reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}'
FROM public.businesses b
ON CONFLICT (business_id, type) DO NOTHING;


-- 2. Helper RPC: upi_qr_url (BR-19)
CREATE OR REPLACE FUNCTION public.upi_qr_url(
  p_invoice_id uuid
)
RETURNS text AS $$
DECLARE
  v_biz_id uuid;
  v_upi_id text;
  v_biz_name text;
  v_inv record;
  v_balance numeric(14,2);
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT upi_id, name INTO v_upi_id, v_biz_name
  FROM public.businesses
  WHERE id = v_biz_id;

  IF v_upi_id IS NULL OR v_upi_id = '' THEN
    RETURN NULL;
  END IF;

  SELECT number, total, paid_amount INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_balance := GREATEST(0, v_inv.total - v_inv.paid_amount);
  IF v_balance <= 0 THEN
    RETURN NULL;
  END IF;

  -- upi://pay?pa=<upi_id>&pn=<business name>&am=<balance>&cu=INR&tn=<invoice number>
  RETURN 'upi://pay?pa=' || v_upi_id ||
         '&pn=' || replace(v_biz_name, ' ', '%20') ||
         '&am=' || to_char(v_balance, 'FM999999999990.00') ||
         '&cu=INR' ||
         '&tn=' || v_inv.number;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.upi_qr_url(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.upi_qr_url(uuid) TO authenticated;


-- 3. Helper RPC: render_whatsapp_template (BR-20)
CREATE OR REPLACE FUNCTION public.render_whatsapp_template(
  p_type text,
  p_invoice_id uuid DEFAULT NULL,
  p_receipt_id uuid DEFAULT NULL
)
RETURNS text AS $$
DECLARE
  v_biz_id uuid;
  v_biz_name text;
  v_template text;
  v_inv record;
  v_rec record;
  v_cust_name text := 'Customer';
  v_result text;
  v_balance numeric(14,2);
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT name INTO v_biz_name FROM public.businesses WHERE id = v_biz_id;

  -- Get template body
  SELECT body INTO v_template
  FROM public.whatsapp_templates
  WHERE business_id = v_biz_id AND type = UPPER(p_type) AND deleted_at IS NULL;

  IF v_template IS NULL THEN
    CASE UPPER(p_type)
      WHEN 'INVOICE' THEN
        v_template := 'Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}.';
      WHEN 'RECEIPT' THEN
        v_template := 'Hello {customer_name}, received payment of {amount} for bill #{invoice_no}. Thank you! - {business_name}';
      WHEN 'REMINDER' THEN
        v_template := 'Hello {customer_name}, reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}';
      ELSE
        RETURN NULL;
    END CASE;
  END IF;

  v_result := v_template;

  -- If Invoice or Reminder
  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND business_id = v_biz_id;
    IF FOUND THEN
      v_cust_name := COALESCE(v_inv.party_name, 'Customer');
      v_balance := GREATEST(0, v_inv.total - v_inv.paid_amount);

      v_result := replace(v_result, '{customer_name}', v_cust_name);
      v_result := replace(v_result, '{invoice_no}', v_inv.number);
      v_result := replace(v_result, '{amount}', '₹' || to_char(v_inv.total, 'FM999999999990.00'));
      v_result := replace(v_result, '{balance}', '₹' || to_char(v_balance, 'FM999999999990.00'));
      v_result := replace(v_result, '{due_date}', to_char(v_inv.due_date, 'DD Mon YYYY'));
    END IF;
  END IF;

  -- If Receipt
  IF p_receipt_id IS NOT NULL THEN
    SELECT r.*, c.name AS customer_name INTO v_rec
    FROM public.receipts r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.id = p_receipt_id AND r.business_id = v_biz_id;

    IF FOUND THEN
      v_cust_name := COALESCE(v_rec.customer_name, 'Customer');
      v_result := replace(v_result, '{customer_name}', v_cust_name);
      v_result := replace(v_result, '{amount}', '₹' || to_char(v_rec.amount, 'FM999999999990.00'));
    END IF;
  END IF;

  v_result := replace(v_result, '{business_name}', COALESCE(v_biz_name, 'SIMPLIFY'));

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.render_whatsapp_template(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.render_whatsapp_template(text, uuid, uuid) TO authenticated;

-- Overload: render_whatsapp_template with JSON context
CREATE OR REPLACE FUNCTION public.render_whatsapp_template(
  p_type text,
  p_context jsonb
)
RETURNS text AS $$
DECLARE
  v_biz_id uuid;
  v_template text;
  v_result text;
  v_k text;
  v_v text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());

  SELECT body INTO v_template
  FROM public.whatsapp_templates
  WHERE business_id = v_biz_id AND type = p_type AND deleted_at IS NULL;

  IF NOT FOUND OR v_template IS NULL OR TRIM(v_template) = '' THEN
    IF p_type = 'INVOICE' THEN
      v_template := 'Hello {customer_name}, your bill #{invoice_no} of {amount} has balance {balance} due on {due_date}. - {business_name}';
    ELSIF p_type = 'RECEIPT' THEN
      v_template := 'Hello {customer_name}, received payment of {amount} against #{invoice_no}. Thank you! - {business_name}';
    ELSE
      v_template := 'Hello {customer_name}, reminder for pending balance of {balance} due on {due_date}. - {business_name}';
    END IF;
  END IF;

  v_result := v_template;

  -- Replace context variables
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each_text(p_context)
  LOOP
    v_result := replace(v_result, '{' || v_k || '}', COALESCE(v_v, ''));
  END LOOP;

  -- Also replace alternate key aliases
  IF p_context ? 'customer_name' THEN
    v_result := replace(v_result, '{party_name}', COALESCE(p_context->>'customer_name', ''));
  END IF;
  IF p_context ? 'invoice_no' THEN
    v_result := replace(v_result, '{bill_no}', COALESCE(p_context->>'invoice_no', ''));
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.render_whatsapp_template(text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.render_whatsapp_template(text, jsonb) TO authenticated;

