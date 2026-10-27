-- Migration 5: Payments (Vendors), Expenses, and Capital Ledger (Loans)
-- Conforms to BR-1, BR-9, BR-10, BR-11, and §6 Data Model

-- 1. Vendors Table
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  mobile text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_vendors_business_name ON public.vendors(business_id, name);

CREATE OR REPLACE TRIGGER trg_vendors_audit
BEFORE INSERT OR UPDATE ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- 2. Payments (Money OUT to vendors)
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  fy_label text NOT NULL,
  payment_date date NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  description text NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_payments_business_date ON public.payments(business_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_business_vendor ON public.payments(business_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_payments_business_invoice ON public.payments(business_id, invoice_id);

CREATE OR REPLACE TRIGGER trg_payments_audit
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Trigger to auto-set fy_label on payments
CREATE OR REPLACE FUNCTION public.set_payment_fy_label()
RETURNS trigger AS $$
BEGIN
  NEW.fy_label := public.fy_label(NEW.payment_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_payments_fy_label
BEFORE INSERT OR UPDATE OF payment_date ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.set_payment_fy_label();


-- 3. Expense Categories
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_business ON public.expense_categories(business_id, name);

CREATE OR REPLACE TRIGGER trg_expense_categories_audit
BEFORE INSERT OR UPDATE ON public.expense_categories
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();


-- 4. Expenses (Business overhead not tied to a bill)
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  fy_label text NOT NULL,
  expense_date date NOT NULL,
  category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE')),
  payee text,
  staff_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  loan_repayment_id uuid, -- FK added below
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON public.expenses(business_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_business_category ON public.expenses(business_id, category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_business_staff ON public.expenses(business_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_expenses_business_loan ON public.expenses(business_id, loan_repayment_id);

CREATE OR REPLACE TRIGGER trg_expenses_audit
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Trigger to auto-set fy_label on expenses
CREATE OR REPLACE FUNCTION public.set_expense_fy_label()
RETURNS trigger AS $$
BEGIN
  NEW.fy_label := public.fy_label(NEW.expense_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_expenses_fy_label
BEFORE INSERT OR UPDATE OF expense_date ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.set_expense_fy_label();


-- 5. Loans Table (Capital Ledger - In & Out, non-operating per BR-1, BR-11)
CREATE TABLE IF NOT EXISTS public.loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  lender_name text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  loan_date date NOT NULL,
  interest_rate numeric(6,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_loans_business_date ON public.loans(business_id, loan_date);
CREATE INDEX IF NOT EXISTS idx_loans_business_lender ON public.loans(business_id, lender_name);

CREATE OR REPLACE TRIGGER trg_loans_audit
BEFORE INSERT OR UPDATE ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();


-- 6. Loan Repayments Table
CREATE TABLE IF NOT EXISTS public.loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  repayment_date date NOT NULL,
  principal numeric(14,2) NOT NULL CHECK (principal >= 0),
  interest numeric(14,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  mode text NOT NULL CHECK (mode IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT chk_repayment_positive CHECK (principal > 0 OR interest > 0)
);

CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON public.loan_repayments(business_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_date ON public.loan_repayments(business_id, repayment_date);

CREATE OR REPLACE TRIGGER trg_loan_repayments_audit
BEFORE INSERT OR UPDATE ON public.loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Add foreign key from expenses to loan_repayments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expenses_loan_repayment'
  ) THEN
    ALTER TABLE public.expenses
    ADD CONSTRAINT fk_expenses_loan_repayment
    FOREIGN KEY (loan_repayment_id) REFERENCES public.loan_repayments(id) ON DELETE CASCADE;
  END IF;
END $$;


-- Seed default expense categories for all existing businesses
INSERT INTO public.expense_categories (business_id, name, system)
SELECT b.id, cat.name, cat.system
FROM public.businesses b
CROSS JOIN (
  VALUES
    ('Rent', false),
    ('Electricity', false),
    ('Internet', false),
    ('Salary', false),
    ('Travel', false),
    ('Marketing', false),
    ('Software/Subscriptions', false),
    ('Maintenance', false),
    ('Office Supplies', false),
    ('Other', false),
    ('Salary / Commission', true),
    ('Loan Interest', true)
) AS cat(name, system)
ON CONFLICT DO NOTHING;


-- Enable & FORCE Row Level Security on all 6 tables
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors FORCE ROW LEVEL SECURITY;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans FORCE ROW LEVEL SECURITY;

ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_repayments FORCE ROW LEVEL SECURITY;


-- RLS Policies (Owner & Accountant ONLY; Staff has NO access per §5)

-- Vendors
DROP POLICY IF EXISTS vendors_select ON public.vendors;
CREATE POLICY vendors_select ON public.vendors
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS vendors_insert ON public.vendors;
CREATE POLICY vendors_insert ON public.vendors
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS vendors_update ON public.vendors;
CREATE POLICY vendors_update ON public.vendors
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );


-- Payments
DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS payments_insert ON public.payments;
CREATE POLICY payments_insert ON public.payments
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS payments_update ON public.payments;
CREATE POLICY payments_update ON public.payments
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );


-- Expense Categories
DROP POLICY IF EXISTS expense_categories_select ON public.expense_categories;
CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS expense_categories_insert ON public.expense_categories;
CREATE POLICY expense_categories_insert ON public.expense_categories
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
  );

DROP POLICY IF EXISTS expense_categories_update ON public.expense_categories;
CREATE POLICY expense_categories_update ON public.expense_categories
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
    AND system = false
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) = 'OWNER'
    AND system = false
  );


-- Expenses (Direct client CRUD allowed ONLY for manual expenses; staff_id/loan_repayment_id expenses are read-only)
DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND staff_id IS NULL
    AND loan_repayment_id IS NULL
  );

DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND staff_id IS NULL
    AND loan_repayment_id IS NULL
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND staff_id IS NULL
    AND loan_repayment_id IS NULL
  );


-- Loans
DROP POLICY IF EXISTS loans_select ON public.loans;
CREATE POLICY loans_select ON public.loans
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS loans_insert ON public.loans;
CREATE POLICY loans_insert ON public.loans
  FOR INSERT
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS loans_update ON public.loans;
CREATE POLICY loans_update ON public.loans
  FOR UPDATE
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
  );


-- Loan Repayments (SELECT only for clients; mutations via record_loan_repayment RPC)
DROP POLICY IF EXISTS loan_repayments_select ON public.loan_repayments;
CREATE POLICY loan_repayments_select ON public.loan_repayments
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    AND deleted_at IS NULL
  );


-- RPC: record_loan_repayment (BR-11)
CREATE OR REPLACE FUNCTION public.record_loan_repayment(
  payload jsonb
)
RETURNS jsonb AS $$
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
  v_total_principal_repaid numeric(14,2);
  v_outstanding numeric(14,2);
  v_repayment public.loan_repayments%ROWTYPE;
  v_interest_cat_id uuid;
  v_expense_id uuid := NULL;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
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

  v_notes := payload->>'notes';

  -- Check outstanding balance on loan
  SELECT COALESCE(SUM(principal), 0) INTO v_total_principal_repaid
  FROM public.loan_repayments
  WHERE loan_id = v_loan.id AND business_id = v_biz_id AND deleted_at IS NULL;

  v_outstanding := v_loan.amount - v_total_principal_repaid;

  IF v_principal > v_outstanding THEN
    RAISE EXCEPTION 'REPAYMENT_EXCEEDS_LOAN_BALANCE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('outstanding', v_outstanding, 'requested_principal', v_principal)::text;
  END IF;

  -- Insert loan repayment
  INSERT INTO public.loan_repayments (
    business_id, loan_id, repayment_date, principal, interest, mode, notes,
    created_by, updated_by
  ) VALUES (
    v_biz_id, v_loan.id, v_date, v_principal, v_interest, v_mode, v_notes,
    v_member_id, v_member_id
  ) RETURNING * INTO v_repayment;

  -- If interest > 0, auto-create Expense in system category "Loan Interest" (BR-11)
  IF v_interest > 0 THEN
    SELECT id INTO v_interest_cat_id
    FROM public.expense_categories
    WHERE business_id = v_biz_id AND name = 'Loan Interest' AND deleted_at IS NULL;

    IF v_interest_cat_id IS NULL THEN
      -- Create if not present
      INSERT INTO public.expense_categories (business_id, name, system, created_by, updated_by)
      VALUES (v_biz_id, 'Loan Interest', true, v_member_id, v_member_id)
      RETURNING id INTO v_interest_cat_id;
    END IF;

    INSERT INTO public.expenses (
      business_id, fy_label, expense_date, category_id, description, amount,
      mode, payee, staff_id, loan_repayment_id, notes, created_by, updated_by
    ) VALUES (
      v_biz_id, public.fy_label(v_date), v_date, v_interest_cat_id,
      'Loan Interest: ' || v_loan.lender_name, v_interest,
      v_mode, v_loan.lender_name, NULL, v_repayment.id, v_notes,
      v_member_id, v_member_id
    ) RETURNING id INTO v_expense_id;
  END IF;

  RETURN jsonb_build_object(
    'repayment', to_jsonb(v_repayment),
    'interest_expense_id', v_expense_id,
    'loan_id', v_loan.id,
    'remaining_principal', (v_outstanding - v_principal)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.record_loan_repayment(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_loan_repayment(jsonb) TO authenticated;


-- RPC: loans_summary (BR-11)
CREATE OR REPLACE FUNCTION public.loans_summary()
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_total_taken numeric(14,2) := 0;
  v_total_repaid numeric(14,2) := 0;
  v_total_outstanding numeric(14,2) := 0;
  v_total_interest_paid numeric(14,2) := 0;
  v_lenders jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Global totals
  SELECT
    COALESCE(SUM(l.amount), 0),
    COALESCE(SUM(lr.principal), 0),
    COALESCE(SUM(lr.interest), 0)
  INTO
    v_total_taken,
    v_total_repaid,
    v_total_interest_paid
  FROM public.loans l
  LEFT JOIN public.loan_repayments lr ON lr.loan_id = l.id AND lr.deleted_at IS NULL
  WHERE l.business_id = v_biz_id AND l.deleted_at IS NULL;

  v_total_outstanding := v_total_taken - v_total_repaid;

  -- Per-lender breakdown
  WITH lender_agg AS (
    SELECT
      l.id AS loan_id,
      l.lender_name,
      l.amount AS taken_amount,
      l.loan_date,
      l.interest_rate,
      l.notes,
      COALESCE(SUM(lr.principal), 0) AS principal_repaid,
      COALESCE(SUM(lr.interest), 0) AS interest_paid,
      (l.amount - COALESCE(SUM(lr.principal), 0)) AS outstanding,
      jsonb_agg(
        jsonb_build_object(
          'id', lr.id,
          'repayment_date', lr.repayment_date,
          'principal', lr.principal,
          'interest', lr.interest,
          'mode', lr.mode,
          'notes', lr.notes
        ) ORDER BY lr.repayment_date ASC, lr.created_at ASC
      ) FILTER (WHERE lr.id IS NOT NULL) AS repayments
    FROM public.loans l
    LEFT JOIN public.loan_repayments lr ON lr.loan_id = l.id AND lr.deleted_at IS NULL
    WHERE l.business_id = v_biz_id AND l.deleted_at IS NULL
    GROUP BY l.id, l.lender_name, l.amount, l.loan_date, l.interest_rate, l.notes
    ORDER BY outstanding DESC, l.loan_date DESC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(lender_agg.*)), '[]'::jsonb)
  INTO v_lenders
  FROM lender_agg;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'total_taken', v_total_taken,
      'total_principal_repaid', v_total_repaid,
      'total_outstanding', v_total_outstanding,
      'total_interest_paid', v_total_interest_paid
    ),
    'loans', v_lenders
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.loans_summary() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.loans_summary() TO authenticated;


-- RPC: vendor_detail (BR-10)
CREATE OR REPLACE FUNCTION public.vendor_detail(
  p_vendor_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_vendor public.vendors%ROWTYPE;
  v_total_paid numeric(14,2) := 0;
  v_payments jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());

  IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vendor
  FROM public.vendors
  WHERE id = p_vendor_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM public.payments
  WHERE vendor_id = p_vendor_id AND business_id = v_biz_id AND deleted_at IS NULL;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'payment_date', p.payment_date,
        'amount', p.amount,
        'mode', p.mode,
        'description', p.description,
        'invoice_id', p.invoice_id,
        'notes', p.notes
      ) ORDER BY p.payment_date DESC, p.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_payments
  FROM public.payments p
  WHERE p.vendor_id = p_vendor_id AND p.business_id = v_biz_id AND p.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'vendor', to_jsonb(v_vendor),
    'total_paid', v_total_paid,
    'payments', v_payments
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.vendor_detail(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.vendor_detail(uuid) TO authenticated;
