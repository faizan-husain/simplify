-- Migration 7: Staff & Commission (staff_payouts, pay_staff, staff_summary, staff_commission)
-- Conforms to BR-15, BR-16, and §5 Roles & Permissions

-- 1. Table: staff_payouts
CREATE TABLE IF NOT EXISTS public.staff_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT (app.current_business_id()) REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payout_date date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE')),
  notes text,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_staff_payouts_business_staff ON public.staff_payouts(business_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_payouts_business_date ON public.staff_payouts(business_id, payout_date);

CREATE OR REPLACE TRIGGER trg_staff_payouts_audit
BEFORE INSERT OR UPDATE ON public.staff_payouts
FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- Enable RLS and FORCE RLS on staff_payouts
ALTER TABLE public.staff_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_payouts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_payouts_select ON public.staff_payouts;
CREATE POLICY staff_payouts_select ON public.staff_payouts
FOR SELECT TO authenticated
USING (
  business_id = (SELECT app.current_business_id())
  AND deleted_at IS NULL
  AND (
    (SELECT app.current_role()) IN ('OWNER', 'ACCOUNTANT')
    OR staff_id = (SELECT app.current_member_id())
  )
);


-- 2. RPC: pay_staff (Owner only per BR-16, §5)
CREATE OR REPLACE FUNCTION public.pay_staff(
  payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_today date;
  v_staff_id uuid;
  v_staff record;
  v_amount numeric(14,2);
  v_payout_date date;
  v_mode text;
  v_notes text;
  v_cat_id uuid;
  v_expense_id uuid;
  v_payout_id uuid;
  v_fy text;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_staff_id := (payload->>'staff_id')::uuid;
  v_amount := ROUND(COALESCE((payload->>'amount')::numeric, 0), 2);
  v_payout_date := COALESCE((payload->>'payout_date')::date, v_today);
  v_mode := COALESCE(payload->>'mode', 'CASH');
  v_notes := payload->>'notes';

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  IF v_mode NOT IN ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'INVALID_MODE' USING ERRCODE = 'P0001';
  END IF;

  -- Verify staff exists in this business
  SELECT id, name, role INTO v_staff
  FROM public.members
  WHERE id = v_staff_id AND business_id = v_biz_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Find or fallback "Salary / Commission" system category
  SELECT id INTO v_cat_id
  FROM public.expense_categories
  WHERE business_id = v_biz_id AND name = 'Salary / Commission';

  IF v_cat_id IS NULL THEN
    -- In case it was somehow missing, grab any system category or insert
    INSERT INTO public.expense_categories (business_id, name, system)
    VALUES (v_biz_id, 'Salary / Commission', true)
    RETURNING id INTO v_cat_id;
  END IF;

  v_fy := public.fy_label(v_payout_date);

  -- 1. Create Expense in "Salary / Commission"
  INSERT INTO public.expenses (
    business_id,
    fy_label,
    expense_date,
    category_id,
    description,
    amount,
    mode,
    payee,
    staff_id,
    notes,
    created_by,
    updated_by
  )
  VALUES (
    v_biz_id,
    v_fy,
    v_payout_date,
    v_cat_id,
    'Staff Payout: ' || v_staff.name,
    v_amount,
    v_mode,
    v_staff.name,
    v_staff.id,
    v_notes,
    v_member_id,
    v_member_id
  )
  RETURNING id INTO v_expense_id;

  -- 2. Create staff_payouts record linked to expense
  INSERT INTO public.staff_payouts (
    business_id,
    staff_id,
    amount,
    payout_date,
    mode,
    notes,
    expense_id,
    created_by,
    updated_by
  )
  VALUES (
    v_biz_id,
    v_staff.id,
    v_amount,
    v_payout_date,
    v_mode,
    v_notes,
    v_expense_id,
    v_member_id,
    v_member_id
  )
  RETURNING id INTO v_payout_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'expense_id', v_expense_id,
    'staff_id', v_staff.id,
    'staff_name', v_staff.name,
    'amount', v_amount,
    'payout_date', v_payout_date,
    'mode', v_mode
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.pay_staff(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pay_staff(jsonb) TO authenticated;


-- 3. RPC: staff_summary
CREATE OR REPLACE FUNCTION public.staff_summary(
  p_staff_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_caller_id uuid;
  v_target_staff_id uuid;
  v_total_earned numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_balance_payable numeric(14,2) := 0;
  v_total_upcoming numeric(14,2) := 0;
  v_staff_list jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Staff can only view their own summary
  IF v_role = 'STAFF' THEN
    v_target_staff_id := v_caller_id;
  ELSE
    v_target_staff_id := p_staff_id;
  END IF;

  -- Total Earned
  SELECT COALESCE(SUM(ce.amount), 0)
  INTO v_total_earned
  FROM public.commission_entries ce
  WHERE ce.business_id = v_biz_id
    AND ce.status = 'EARNED'
    AND (v_target_staff_id IS NULL OR ce.staff_id = v_target_staff_id)
    AND (p_from IS NULL OR ce.earned_at::date >= p_from)
    AND (p_to IS NULL OR ce.earned_at::date <= p_to);

  -- Total Paid
  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_total_paid
  FROM public.staff_payouts sp
  WHERE sp.business_id = v_biz_id
    AND sp.deleted_at IS NULL
    AND (v_target_staff_id IS NULL OR sp.staff_id = v_target_staff_id)
    AND (p_from IS NULL OR sp.payout_date >= p_from)
    AND (p_to IS NULL OR sp.payout_date <= p_to);

  -- Upcoming
  SELECT COALESCE(SUM(ce.amount), 0)
  INTO v_total_upcoming
  FROM public.commission_entries ce
  WHERE ce.business_id = v_biz_id
    AND ce.status = 'UPCOMING'
    AND (v_target_staff_id IS NULL OR ce.staff_id = v_target_staff_id);

  v_balance_payable := v_total_earned - v_total_paid;

  -- Per-staff breakdown (visible to Owner & Accountant)
  IF v_role IN ('OWNER', 'ACCOUNTANT') AND v_target_staff_id IS NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'mobile', m.mobile,
          'role', m.role,
          'earned', COALESCE(e.earned, 0),
          'paid', COALESCE(p.paid, 0),
          'balance', (COALESCE(e.earned, 0) - COALESCE(p.paid, 0)),
          'upcoming', COALESCE(u.upcoming, 0)
        )
        ORDER BY m.name ASC
      ),
      '[]'::jsonb
    )
    INTO v_staff_list
    FROM public.members m
    LEFT JOIN (
      SELECT staff_id, SUM(amount) AS earned
      FROM public.commission_entries
      WHERE business_id = v_biz_id AND status = 'EARNED'
        AND (p_from IS NULL OR earned_at::date >= p_from)
        AND (p_to IS NULL OR earned_at::date <= p_to)
      GROUP BY staff_id
    ) e ON e.staff_id = m.id
    LEFT JOIN (
      SELECT staff_id, SUM(amount) AS paid
      FROM public.staff_payouts
      WHERE business_id = v_biz_id AND deleted_at IS NULL
        AND (p_from IS NULL OR payout_date >= p_from)
        AND (p_to IS NULL OR payout_date <= p_to)
      GROUP BY staff_id
    ) p ON p.staff_id = m.id
    LEFT JOIN (
      SELECT staff_id, SUM(amount) AS upcoming
      FROM public.commission_entries
      WHERE business_id = v_biz_id AND status = 'UPCOMING'
      GROUP BY staff_id
    ) u ON u.staff_id = m.id
    WHERE m.business_id = v_biz_id AND m.active = true;
  END IF;

  RETURN jsonb_build_object(
    'total_earned', v_total_earned,
    'total_paid', v_total_paid,
    'balance_payable', v_balance_payable,
    'upcoming', v_total_upcoming,
    'staff', v_staff_list
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_summary(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_summary(uuid, date, date) TO authenticated;


-- 4. RPC: staff_commission
CREATE OR REPLACE FUNCTION public.staff_commission(
  p_staff_id uuid DEFAULT NULL,
  p_period text DEFAULT 'DAY',
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_caller_id uuid;
  v_target_staff_id uuid;
  v_today date;
  v_start_date date;
  v_end_date date;
  v_year int;
  v_month int;
  v_entries jsonb;
  v_payouts jsonb;
  v_total_earned numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_total_upcoming numeric(14,2) := 0;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Staff can only view own
  IF v_role = 'STAFF' THEN
    v_target_staff_id := v_caller_id;
  ELSE
    v_target_staff_id := p_staff_id;
  END IF;

  -- Calculate date boundaries based on period
  CASE UPPER(p_period)
    WHEN 'DAY' THEN
      v_start_date := v_today;
      v_end_date := v_today;
    WHEN 'MONTH' THEN
      v_start_date := date_trunc('month', v_today)::date;
      v_end_date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    WHEN 'YEAR' THEN
      v_year := EXTRACT(YEAR FROM v_today)::int;
      v_month := EXTRACT(MONTH FROM v_today)::int;
      IF v_month >= 4 THEN
        v_start_date := make_date(v_year, 4, 1);
        v_end_date := make_date(v_year + 1, 3, 31);
      ELSE
        v_start_date := make_date(v_year - 1, 4, 1);
        v_end_date := make_date(v_year, 3, 31);
      END IF;
    WHEN 'ALL' THEN
      v_start_date := NULL;
      v_end_date := NULL;
    ELSE
      v_start_date := v_today;
      v_end_date := v_today;
  END CASE;

  -- Explicit from/to overrides
  IF p_from IS NOT NULL THEN
    v_start_date := p_from;
  END IF;
  IF p_to IS NOT NULL THEN
    v_end_date := p_to;
  END IF;

  -- Commission entries drill-down
  WITH comm_list AS (
    SELECT
      ce.id,
      ce.job_id,
      ce.staff_id,
      m.name AS staff_name,
      ce.base_amount,
      ce.percent,
      ce.amount,
      ce.status,
      ce.earned_at,
      j.job_type_name,
      j.applicant_name,
      j.party_name,
      j.party_mobile,
      i.id AS invoice_id,
      i.number AS invoice_number,
      i.invoice_date
    FROM public.commission_entries ce
    JOIN public.members m ON m.id = ce.staff_id
    JOIN public.jobs j ON j.id = ce.job_id
    JOIN public.invoices i ON i.id = j.invoice_id
    WHERE ce.business_id = v_biz_id
      AND (v_target_staff_id IS NULL OR ce.staff_id = v_target_staff_id)
      AND (
        (ce.status = 'EARNED' AND (v_start_date IS NULL OR ce.earned_at::date >= v_start_date) AND (v_end_date IS NULL OR ce.earned_at::date <= v_end_date))
        OR
        (ce.status = 'UPCOMING' AND (v_start_date IS NULL OR i.invoice_date >= v_start_date) AND (v_end_date IS NULL OR i.invoice_date <= v_end_date))
      )
    ORDER BY COALESCE(ce.earned_at, ce.created_at) DESC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(comm_list.*)), '[]'::jsonb)
  INTO v_entries
  FROM comm_list;

  -- Staff Payouts in this period
  WITH payout_list AS (
    SELECT
      sp.id,
      sp.staff_id,
      m.name AS staff_name,
      sp.amount,
      sp.payout_date,
      sp.mode,
      sp.notes
    FROM public.staff_payouts sp
    JOIN public.members m ON m.id = sp.staff_id
    WHERE sp.business_id = v_biz_id
      AND sp.deleted_at IS NULL
      AND (v_target_staff_id IS NULL OR sp.staff_id = v_target_staff_id)
      AND (v_start_date IS NULL OR sp.payout_date >= v_start_date)
      AND (v_end_date IS NULL OR sp.payout_date <= v_end_date)
    ORDER BY sp.payout_date DESC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(payout_list.*)), '[]'::jsonb)
  INTO v_payouts
  FROM payout_list;

  -- Totals in this scope
  SELECT
    COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'EARNED'), 0),
    COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'UPCOMING'), 0)
  INTO
    v_total_earned,
    v_total_upcoming
  FROM public.commission_entries ce
  JOIN public.invoices i ON i.id = (SELECT invoice_id FROM public.jobs WHERE id = ce.job_id)
  WHERE ce.business_id = v_biz_id
    AND (v_target_staff_id IS NULL OR ce.staff_id = v_target_staff_id)
    AND (
      (ce.status = 'EARNED' AND (v_start_date IS NULL OR ce.earned_at::date >= v_start_date) AND (v_end_date IS NULL OR ce.earned_at::date <= v_end_date))
      OR
      (ce.status = 'UPCOMING' AND (v_start_date IS NULL OR i.invoice_date >= v_start_date) AND (v_end_date IS NULL OR i.invoice_date <= v_end_date))
    );

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_paid
  FROM public.staff_payouts
  WHERE business_id = v_biz_id AND deleted_at IS NULL
    AND (v_target_staff_id IS NULL OR staff_id = v_target_staff_id)
    AND (v_start_date IS NULL OR payout_date >= v_start_date)
    AND (v_end_date IS NULL OR payout_date <= v_end_date);

  RETURN jsonb_build_object(
    'period', p_period,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'total_earned', v_total_earned,
    'total_paid', v_total_paid,
    'balance_payable', (v_total_earned - v_total_paid),
    'upcoming', v_total_upcoming,
    'entries', v_entries,
    'payouts', v_payouts
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_commission(uuid, text, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_commission(uuid, text, date, date) TO authenticated;
