import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });
  await client.connect();

  console.log('Adding overloaded render_whatsapp_template(p_type text, p_context jsonb)...');

  await client.query(`
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
`);

  console.log('✓ render_whatsapp_template(p_type text, p_context jsonb) created successfully.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
