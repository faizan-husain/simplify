-- Migration 45: Staff Earnings History Month Ordering (Ascending Chronological Order)
-- Updates staff_earnings_history to return monthly statements sorted in ASCENDING order (top to bottom)

CREATE OR REPLACE FUNCTION public.staff_earnings_history(
  p_staff_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_caller_id uuid;
  v_target_staff_id uuid;
  v_today date;
  v_staff record;
  v_monthly jsonb := '[]'::jsonb;
  v_yearly jsonb := '[]'::jsonb;
  v_all_time_earned numeric(14,2) := 0;
  v_all_time_paid numeric(14,2) := 0;
  v_all_time_balance numeric(14,2) := 0;
  v_total_jobs int := 0;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Staff can only view own earnings history
  IF v_role = 'STAFF' THEN
    v_target_staff_id := v_caller_id;
  ELSE
    v_target_staff_id := COALESCE(p_staff_id, v_caller_id);
  END IF;

  IF v_target_staff_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT 
    id, name, mobile, role,
    COALESCE(compensation_type, 'COMMISSION') AS compensation_type,
    COALESCE(monthly_salary, 0) AS monthly_salary,
    COALESCE(salary_start_date, created_at::date) AS salary_start_date
  INTO v_staff
  FROM public.members
  WHERE id = v_target_staff_id AND business_id = v_biz_id;

  IF v_staff.id IS NULL THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_staff.compensation_type = 'SALARY' THEN
    -- 1. Salaried Staff History (Ordered ASC top to bottom)
    WITH month_series AS (
      SELECT generate_series(
        date_trunc('month', v_staff.salary_start_date)::date,
        date_trunc('month', v_today)::date,
        '1 month'::interval
      )::date AS m_start
    ),
    sal_monthly AS (
      SELECT 
        to_char(ms.m_start, 'YYYY-MM') AS month_key,
        to_char(ms.m_start, 'Mon YYYY') AS month_label,
        public.fy_label(ms.m_start) AS fy_label,
        COALESCE(sj.jobs_count, 0) AS jobs_count,
        v_staff.monthly_salary AS earned,
        COALESCE(sp.month_paid, 0) AS paid,
        (v_staff.monthly_salary - COALESCE(sp.month_paid, 0)) AS balance,
        ms.m_start
      FROM month_series ms
      LEFT JOIN (
        SELECT 
          date_trunc('month', payout_date)::date AS p_month,
          SUM(amount) AS month_paid
        FROM public.staff_payouts
        WHERE staff_id = v_target_staff_id AND business_id = v_biz_id AND deleted_at IS NULL
        GROUP BY 1
      ) sp ON sp.p_month = ms.m_start
      LEFT JOIN (
        SELECT 
          date_trunc('month', completed_at)::date AS j_month,
          COUNT(*) AS jobs_count
        FROM public.jobs
        WHERE assigned_staff_id = v_target_staff_id AND business_id = v_biz_id AND status = 'COMPLETED'
        GROUP BY 1
      ) sj ON sj.j_month = ms.m_start
      ORDER BY ms.m_start ASC
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(sal_monthly.*)), '[]'::jsonb)
    INTO v_monthly
    FROM sal_monthly;

    -- Salaried FY Yearly Breakdown
    WITH month_series AS (
      SELECT generate_series(
        date_trunc('month', v_staff.salary_start_date)::date,
        date_trunc('month', v_today)::date,
        '1 month'::interval
      )::date AS m_start
    ),
    sal_yearly AS (
      SELECT 
        public.fy_label(ms.m_start) AS fy_label,
        COALESCE(SUM(sj.jobs_count), 0)::int AS jobs_count,
        SUM(v_staff.monthly_salary) AS earned,
        COALESCE(SUM(sp.month_paid), 0) AS paid,
        (SUM(v_staff.monthly_salary) - COALESCE(SUM(sp.month_paid), 0)) AS balance,
        MIN(ms.m_start) AS min_date
      FROM month_series ms
      LEFT JOIN (
        SELECT 
          date_trunc('month', payout_date)::date AS p_month,
          SUM(amount) AS month_paid
        FROM public.staff_payouts
        WHERE staff_id = v_target_staff_id AND business_id = v_biz_id AND deleted_at IS NULL
        GROUP BY 1
      ) sp ON sp.p_month = ms.m_start
      LEFT JOIN (
        SELECT 
          date_trunc('month', completed_at)::date AS j_month,
          COUNT(*) AS jobs_count
        FROM public.jobs
        WHERE assigned_staff_id = v_target_staff_id AND business_id = v_biz_id AND status = 'COMPLETED'
        GROUP BY 1
      ) sj ON sj.j_month = ms.m_start
      GROUP BY public.fy_label(ms.m_start)
      ORDER BY MIN(ms.m_start) DESC
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(sal_yearly.*)), '[]'::jsonb)
    INTO v_yearly
    FROM sal_yearly;

  ELSE
    -- 2. Commission-based Staff History (Ordered ASC top to bottom)
    WITH activity_months AS (
      SELECT DISTINCT date_trunc('month', ce.earned_at)::date AS m_start
      FROM public.commission_entries ce
      WHERE ce.staff_id = v_target_staff_id AND ce.business_id = v_biz_id AND ce.status = 'EARNED'
      UNION
      SELECT DISTINCT date_trunc('month', sp.payout_date)::date AS m_start
      FROM public.staff_payouts sp
      WHERE sp.staff_id = v_target_staff_id AND sp.business_id = v_biz_id AND sp.deleted_at IS NULL
      UNION
      SELECT DISTINCT date_trunc('month', j.completed_at)::date AS m_start
      FROM public.jobs j
      WHERE j.assigned_staff_id = v_target_staff_id AND j.business_id = v_biz_id AND j.status = 'COMPLETED'
      UNION
      SELECT date_trunc('month', v_today)::date AS m_start
    ),
    comm_monthly AS (
      SELECT 
        to_char(am.m_start, 'YYYY-MM') AS month_key,
        to_char(am.m_start, 'Mon YYYY') AS month_label,
        public.fy_label(am.m_start) AS fy_label,
        COALESCE(sj.jobs_count, 0)::int AS jobs_count,
        COALESCE(ce.month_earned, 0) AS earned,
        COALESCE(sp.month_paid, 0) AS paid,
        (COALESCE(ce.month_earned, 0) - COALESCE(sp.month_paid, 0)) AS balance,
        am.m_start
      FROM activity_months am
      LEFT JOIN (
        SELECT 
          date_trunc('month', ce.earned_at)::date AS c_month,
          SUM(ce.amount) AS month_earned
        FROM public.commission_entries ce
        WHERE ce.staff_id = v_target_staff_id AND ce.business_id = v_biz_id AND ce.status = 'EARNED'
        GROUP BY 1
      ) ce ON ce.c_month = am.m_start
      LEFT JOIN (
        SELECT 
          date_trunc('month', sp.payout_date)::date AS p_month,
          SUM(sp.amount) AS month_paid
        FROM public.staff_payouts sp
        WHERE sp.staff_id = v_target_staff_id AND sp.business_id = v_biz_id AND sp.deleted_at IS NULL
        GROUP BY 1
      ) sp ON sp.p_month = am.m_start
      LEFT JOIN (
        SELECT 
          date_trunc('month', j.completed_at)::date AS j_month,
          COUNT(*) AS jobs_count
        FROM public.jobs j
        WHERE j.assigned_staff_id = v_target_staff_id AND j.business_id = v_biz_id AND j.status = 'COMPLETED'
        GROUP BY 1
      ) sj ON sj.j_month = am.m_start
      WHERE (COALESCE(ce.month_earned, 0) > 0 OR COALESCE(sp.month_paid, 0) > 0 OR COALESCE(sj.jobs_count, 0) > 0 OR am.m_start = date_trunc('month', v_today)::date)
      ORDER BY am.m_start ASC
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(comm_monthly.*)), '[]'::jsonb)
    INTO v_monthly
    FROM comm_monthly;

    -- Commission FY Yearly Breakdown
    WITH activity_dates AS (
      SELECT 
        ce.earned_at::date AS act_date,
        ce.amount AS earned,
        0::numeric AS paid,
        0 AS is_job
      FROM public.commission_entries ce
      WHERE ce.staff_id = v_target_staff_id AND ce.business_id = v_biz_id AND ce.status = 'EARNED'
      UNION ALL
      SELECT 
        sp.payout_date AS act_date,
        0::numeric AS earned,
        sp.amount AS paid,
        0 AS is_job
      FROM public.staff_payouts sp
      WHERE sp.staff_id = v_target_staff_id AND sp.business_id = v_biz_id AND sp.deleted_at IS NULL
      UNION ALL
      SELECT 
        j.completed_at::date AS act_date,
        0::numeric AS earned,
        0::numeric AS paid,
        1 AS is_job
      FROM public.jobs j
      WHERE j.assigned_staff_id = v_target_staff_id AND j.business_id = v_biz_id AND j.status = 'COMPLETED'
      UNION ALL
      SELECT 
        v_today AS act_date,
        0::numeric AS earned,
        0::numeric AS paid,
        0 AS is_job
    ),
    comm_yearly AS (
      SELECT 
        public.fy_label(ad.act_date) AS fy_label,
        COALESCE(SUM(ad.is_job), 0)::int AS jobs_count,
        COALESCE(SUM(ad.earned), 0) AS earned,
        COALESCE(SUM(ad.paid), 0) AS paid,
        (COALESCE(SUM(ad.earned), 0) - COALESCE(SUM(ad.paid), 0)) AS balance,
        MIN(ad.act_date) AS min_date
      FROM activity_dates ad
      GROUP BY public.fy_label(ad.act_date)
      ORDER BY MIN(ad.act_date) DESC
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(comm_yearly.*)), '[]'::jsonb)
    INTO v_yearly
    FROM comm_yearly;

  END IF;

  -- Overall totals
  SELECT 
    COALESCE(SUM((m->>'earned')::numeric), 0),
    COALESCE(SUM((m->>'paid')::numeric), 0),
    COALESCE(SUM((m->>'jobs_count')::int), 0)
  INTO 
    v_all_time_earned,
    v_all_time_paid,
    v_total_jobs
  FROM jsonb_array_elements(v_monthly) m;

  v_all_time_balance := v_all_time_earned - v_all_time_paid;

  RETURN jsonb_build_object(
    'staff_id', v_staff.id,
    'staff_name', v_staff.name,
    'compensation_type', v_staff.compensation_type,
    'monthly_salary', v_staff.monthly_salary,
    'monthly', v_monthly,
    'yearly', v_yearly,
    'overall', jsonb_build_object(
      'all_time_earned', v_all_time_earned,
      'all_time_paid', v_all_time_paid,
      'all_time_balance', v_all_time_balance,
      'total_jobs', v_total_jobs
    )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_earnings_history(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_earnings_history(uuid) TO authenticated;

