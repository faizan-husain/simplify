-- Migration 39: Ensure staff_commission returns both total_earned and total_due
-- And correctly handles all-time vs period filters

CREATE OR REPLACE FUNCTION public.staff_commission(
  p_staff_id uuid DEFAULT NULL::uuid,
  p_period text DEFAULT 'MONTH'::text,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date
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
  v_staff record;
  v_entries jsonb := '[]'::jsonb;
  v_payouts jsonb := '[]'::jsonb;
  v_salary_months jsonb := '[]'::jsonb;
  v_total_due numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_total_upcoming numeric(14,2) := 0;
  v_balance numeric(14,2) := 0;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  IF v_role = 'STAFF' THEN
    v_target_staff_id := v_caller_id;
  ELSE
    v_target_staff_id := p_staff_id;
  END IF;

  -- Period calculation
  CASE UPPER(COALESCE(p_period, 'ALL'))
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
      v_start_date := NULL;
      v_end_date := NULL;
  END CASE;

  IF p_from IS NOT NULL THEN v_start_date := p_from; END IF;
  IF p_to IS NOT NULL THEN v_end_date := p_to; END IF;

  -- Get staff record if single staff targeted
  IF v_target_staff_id IS NOT NULL THEN
    SELECT 
      id, name, mobile, role, 
      COALESCE(compensation_type, 'COMMISSION') AS compensation_type,
      COALESCE(monthly_salary, 0) AS monthly_salary,
      COALESCE(salary_start_date, created_at::date) AS salary_start_date
    INTO v_staff
    FROM public.members
    WHERE id = v_target_staff_id AND business_id = v_biz_id;
  END IF;

  -- 1. Completed jobs / commission entries list
  WITH job_comm_list AS (
    SELECT
      j.id AS job_id,
      j.service_id,
      j.job_type_name,
      j.party_name,
      j.party_mobile,
      j.applicant_name,
      j.amount AS job_amount,
      j.deadline_date,
      j.status AS job_status,
      j.completed_at,
      i.id AS invoice_id,
      i.number AS invoice_number,
      i.invoice_date,
      ce.id AS commission_id,
      COALESCE(ce.percent, j.commission_percent, 0) AS commission_percent,
      COALESCE(ce.amount, 0) AS commission_amount,
      COALESCE(ce.status, 'NO_COMMISSION') AS commission_status,
      ce.earned_at
    FROM public.jobs j
    JOIN public.invoices i ON i.id = j.invoice_id
    LEFT JOIN public.commission_entries ce ON ce.job_id = j.id AND ce.staff_id = j.assigned_staff_id
    WHERE j.business_id = v_biz_id
      AND (v_target_staff_id IS NULL OR j.assigned_staff_id = v_target_staff_id)
      AND j.status = 'COMPLETED'
      AND (v_start_date IS NULL OR j.completed_at::date >= v_start_date)
      AND (v_end_date IS NULL OR j.completed_at::date <= v_end_date)
    ORDER BY j.completed_at DESC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(job_comm_list.*)), '[]'::jsonb)
  INTO v_entries
  FROM job_comm_list;

  -- 2. Payouts list
  WITH payout_list AS (
    SELECT
      sp.id,
      sp.staff_id,
      m.name AS staff_name,
      sp.amount,
      sp.payout_date,
      sp.mode,
      sp.notes,
      sp.created_at AS payout_created_at,
      e.description AS expense_description
    FROM public.staff_payouts sp
    JOIN public.members m ON m.id = sp.staff_id
    LEFT JOIN public.expenses e ON e.id = sp.expense_id
    WHERE sp.business_id = v_biz_id
      AND sp.deleted_at IS NULL
      AND (v_target_staff_id IS NULL OR sp.staff_id = v_target_staff_id)
      AND (v_start_date IS NULL OR sp.payout_date >= v_start_date)
      AND (v_end_date IS NULL OR sp.payout_date <= v_end_date)
    ORDER BY sp.payout_date DESC, sp.created_at DESC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(payout_list.*)), '[]'::jsonb)
  INTO v_payouts
  FROM payout_list;

  -- 3. If Salaried staff, generate monthly breakdown
  IF v_target_staff_id IS NOT NULL AND v_staff.compensation_type = 'SALARY' THEN
    WITH month_series AS (
      SELECT generate_series(
        date_trunc('month', v_staff.salary_start_date)::date,
        date_trunc('month', v_today)::date,
        '1 month'::interval
      )::date AS m_start
    ),
    monthly_data AS (
      SELECT 
        ms.m_start,
        to_char(ms.m_start, 'Mon YYYY') AS month_label,
        to_char(ms.m_start, 'YYYY-MM') AS month_key,
        v_staff.monthly_salary AS amount,
        COALESCE(sp.month_paid, 0) AS paid_in_month
      FROM month_series ms
      LEFT JOIN (
        SELECT 
          date_trunc('month', payout_date)::date AS p_month,
          SUM(amount) AS month_paid
        FROM public.staff_payouts
        WHERE staff_id = v_target_staff_id AND deleted_at IS NULL
        GROUP BY date_trunc('month', payout_date)::date
      ) sp ON sp.p_month = ms.m_start
      ORDER BY ms.m_start DESC
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(monthly_data.*)), '[]'::jsonb)
    INTO v_salary_months
    FROM monthly_data;
  END IF;

  -- Totals calculation
  IF v_target_staff_id IS NOT NULL AND v_staff.compensation_type = 'SALARY' THEN
    v_total_due := v_staff.monthly_salary;
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.staff_payouts
    WHERE staff_id = v_target_staff_id AND deleted_at IS NULL
      AND (v_start_date IS NULL OR payout_date >= v_start_date)
      AND (v_end_date IS NULL OR payout_date <= v_end_date);
    
    -- Net balance all-time
    v_balance := (
      GREATEST(0, (
        (EXTRACT(YEAR FROM v_today) - EXTRACT(YEAR FROM v_staff.salary_start_date)) * 12 +
        (EXTRACT(MONTH FROM v_today) - EXTRACT(MONTH FROM v_staff.salary_start_date)) + 1
      )::int) * v_staff.monthly_salary
    ) - (
      SELECT COALESCE(SUM(amount), 0)
      FROM public.staff_payouts
      WHERE staff_id = v_target_staff_id AND deleted_at IS NULL
    );
    v_total_upcoming := 0;
  ELSE
    SELECT 
      COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'EARNED'), 0),
      COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'UPCOMING'), 0)
    INTO v_total_due, v_total_upcoming
    FROM public.commission_entries ce
    WHERE ce.business_id = v_biz_id
      AND (v_target_staff_id IS NULL OR ce.staff_id = v_target_staff_id)
      AND (v_start_date IS NULL OR ce.earned_at::date >= v_start_date)
      AND (v_end_date IS NULL OR ce.earned_at::date <= v_end_date);

    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.staff_payouts
    WHERE business_id = v_biz_id AND deleted_at IS NULL
      AND (v_target_staff_id IS NULL OR staff_id = v_target_staff_id)
      AND (v_start_date IS NULL OR payout_date >= v_start_date)
      AND (v_end_date IS NULL OR payout_date <= v_end_date);

    -- All time balance
    v_balance := (
      SELECT COALESCE(SUM(amount), 0) FROM public.commission_entries
      WHERE business_id = v_biz_id AND status = 'EARNED'
        AND (v_target_staff_id IS NULL OR staff_id = v_target_staff_id)
    ) - (
      SELECT COALESCE(SUM(amount), 0) FROM public.staff_payouts
      WHERE business_id = v_biz_id AND deleted_at IS NULL
        AND (v_target_staff_id IS NULL OR staff_id = v_target_staff_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'period', p_period,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'total_earned', v_total_due,
    'total_due', v_total_due,
    'total_paid', v_total_paid,
    'balance_payable', v_balance,
    'upcoming', v_total_upcoming,
    'entries', v_entries,
    'payouts', v_payouts,
    'salary_months', v_salary_months
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_commission(uuid, text, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_commission(uuid, text, date, date) TO authenticated;

