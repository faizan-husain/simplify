-- Migration 38: Exclude non-staff (e.g. Owner, Accountant) from staff_summary
-- Staff summary must strictly calculate and display members with role = 'STAFF'

CREATE OR REPLACE FUNCTION public.staff_summary(
  p_staff_id uuid DEFAULT NULL::uuid,
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
  v_month_start date;
  v_month_end date;
  v_fy_start date;
  v_fy_end date;
  v_year int;
  v_month int;
  
  -- Query scope date filters
  v_scope_from date;
  v_scope_to date;

  v_total_due numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_balance_payable numeric(14,2) := 0;
  v_total_upcoming numeric(14,2) := 0;
  v_staff_list jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Staff can only view own summary
  IF v_role = 'STAFF' THEN
    v_target_staff_id := v_caller_id;
  ELSE
    v_target_staff_id := p_staff_id;
  END IF;

  -- Dates calculation
  v_month_start := date_trunc('month', v_today)::date;
  v_month_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;

  v_year := EXTRACT(YEAR FROM v_today)::int;
  v_month := EXTRACT(MONTH FROM v_today)::int;
  IF v_month >= 4 THEN
    v_fy_start := make_date(v_year, 4, 1);
    v_fy_end := make_date(v_year + 1, 3, 31);
  ELSE
    v_fy_start := make_date(v_year - 1, 4, 1);
    v_fy_end := make_date(v_year, 3, 31);
  END IF;

  v_scope_from := COALESCE(p_from, v_month_start);
  v_scope_to := COALESCE(p_to, v_month_end);

  -- Per-staff calculations (STRICTLY role = 'STAFF')
  WITH staff_base AS (
    SELECT 
      m.id,
      m.name,
      m.mobile,
      m.role,
      COALESCE(m.compensation_type, 'COMMISSION') AS compensation_type,
      COALESCE(m.monthly_salary, 0) AS monthly_salary,
      COALESCE(m.salary_start_date, m.created_at::date) AS salary_start_date,
      m.created_at
    FROM public.members m
    WHERE m.business_id = v_biz_id 
      AND m.active = true 
      AND m.deleted_at IS NULL
      AND m.role = 'STAFF'
      AND (v_target_staff_id IS NULL OR m.id = v_target_staff_id)
  ),
  staff_jobs AS (
    -- Count of jobs completed in this period
    SELECT 
      j.assigned_staff_id AS staff_id,
      COUNT(*) AS jobs_done_period
    FROM public.jobs j
    WHERE j.business_id = v_biz_id
      AND j.status = 'COMPLETED'
      AND j.completed_at IS NOT NULL
      AND j.completed_at::date >= v_scope_from 
      AND j.completed_at::date <= v_scope_to
    GROUP BY j.assigned_staff_id
  ),
  staff_comm_period AS (
    -- Commission earned in this period
    SELECT 
      ce.staff_id,
      COALESCE(SUM(ce.amount), 0) AS earned_period
    FROM public.commission_entries ce
    WHERE ce.business_id = v_biz_id
      AND ce.status = 'EARNED'
      AND ce.earned_at::date >= v_scope_from
      AND ce.earned_at::date <= v_scope_to
    GROUP BY ce.staff_id
  ),
  staff_comm_all AS (
    -- All-time commission earned
    SELECT 
      ce.staff_id,
      COALESCE(SUM(ce.amount), 0) AS earned_all
    FROM public.commission_entries ce
    WHERE ce.business_id = v_biz_id
      AND ce.status = 'EARNED'
    GROUP BY ce.staff_id
  ),
  staff_comm_upcoming AS (
    -- Pending upcoming commission on in-progress jobs
    SELECT 
      ce.staff_id,
      COALESCE(SUM(ce.amount), 0) AS upcoming
    FROM public.commission_entries ce
    WHERE ce.business_id = v_biz_id
      AND ce.status = 'UPCOMING'
    GROUP BY ce.staff_id
  ),
  staff_payouts_period AS (
    -- Payouts paid in this period
    SELECT 
      sp.staff_id,
      COALESCE(SUM(sp.amount), 0) AS paid_period
    FROM public.staff_payouts sp
    WHERE sp.business_id = v_biz_id
      AND sp.deleted_at IS NULL
      AND sp.payout_date >= v_scope_from
      AND sp.payout_date <= v_scope_to
    GROUP BY sp.staff_id
  ),
  staff_payouts_all AS (
    -- All-time payouts
    SELECT 
      sp.staff_id,
      COALESCE(SUM(sp.amount), 0) AS paid_all
    FROM public.staff_payouts sp
    WHERE sp.business_id = v_biz_id
      AND sp.deleted_at IS NULL
    GROUP BY sp.staff_id
  ),
  computed_staff AS (
    SELECT
      sb.id,
      sb.name,
      sb.mobile,
      sb.role,
      sb.compensation_type,
      sb.monthly_salary,
      sb.salary_start_date,
      COALESCE(sj.jobs_done_period, 0) AS jobs_done,
      
      -- Due in period
      CASE 
        WHEN sb.compensation_type = 'SALARY' THEN
          CASE 
            WHEN sb.salary_start_date <= v_scope_to THEN sb.monthly_salary
            ELSE 0
          END
        ELSE
          COALESCE(scp.earned_period, 0)
      END AS period_due,

      -- Paid in period
      COALESCE(spp.paid_period, 0) AS period_paid,

      -- Total Accrued / Earned All-Time
      CASE 
        WHEN sb.compensation_type = 'SALARY' THEN
          GREATEST(0, (
            (EXTRACT(YEAR FROM v_today) - EXTRACT(YEAR FROM sb.salary_start_date)) * 12 +
            (EXTRACT(MONTH FROM v_today) - EXTRACT(MONTH FROM sb.salary_start_date)) + 1
          )::int) * sb.monthly_salary
        ELSE
          COALESCE(sca.earned_all, 0)
      END AS all_time_due,

      -- Total Paid All-Time
      COALESCE(spa.paid_all, 0) AS all_time_paid,

      -- Overall Balance = All Time Due - All Time Paid
      CASE 
        WHEN sb.compensation_type = 'SALARY' THEN
          (GREATEST(0, (
            (EXTRACT(YEAR FROM v_today) - EXTRACT(YEAR FROM sb.salary_start_date)) * 12 +
            (EXTRACT(MONTH FROM v_today) - EXTRACT(MONTH FROM sb.salary_start_date)) + 1
          )::int) * sb.monthly_salary) - COALESCE(spa.paid_all, 0)
        ELSE
          COALESCE(sca.earned_all, 0) - COALESCE(spa.paid_all, 0)
      END AS balance,

      -- Upcoming commission (Only for commission staff)
      CASE 
        WHEN sb.compensation_type = 'COMMISSION' THEN COALESCE(scu.upcoming, 0)
        ELSE 0
      END AS upcoming
    FROM staff_base sb
    LEFT JOIN staff_jobs sj ON sj.staff_id = sb.id
    LEFT JOIN staff_comm_period scp ON scp.staff_id = sb.id
    LEFT JOIN staff_comm_all sca ON sca.staff_id = sb.id
    LEFT JOIN staff_comm_upcoming scu ON scu.staff_id = sb.id
    LEFT JOIN staff_payouts_period spp ON spp.staff_id = sb.id
    LEFT JOIN staff_payouts_all spa ON spa.staff_id = sb.id
  )
  SELECT 
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', cs.id,
        'name', cs.name,
        'mobile', cs.mobile,
        'role', cs.role,
        'compensation_type', cs.compensation_type,
        'monthly_salary', cs.monthly_salary,
        'salary_start_date', cs.salary_start_date,
        'jobs_done', cs.jobs_done,
        'earned', cs.period_due,     -- Due in this period
        'paid', cs.period_paid,       -- Paid in this period
        'balance', cs.balance,        -- Net balance payable (or negative advance)
        'upcoming', cs.upcoming,
        'all_time_due', cs.all_time_due,
        'all_time_paid', cs.all_time_paid
      )
      ORDER BY cs.name ASC
    ), '[]'::jsonb),
    COALESCE(SUM(cs.period_due), 0),
    COALESCE(SUM(cs.period_paid), 0),
    COALESCE(SUM(CASE WHEN cs.balance > 0 THEN cs.balance ELSE 0 END), 0),
    COALESCE(SUM(cs.upcoming), 0)
  INTO 
    v_staff_list,
    v_total_due,
    v_total_paid,
    v_balance_payable,
    v_total_upcoming
  FROM computed_staff cs;

  RETURN jsonb_build_object(
    'total_earned', v_total_due,
    'total_paid', v_total_paid,
    'balance_payable', v_balance_payable,
    'upcoming', v_total_upcoming,
    'period_from', v_scope_from,
    'period_to', v_scope_to,
    'staff', v_staff_list
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_summary(uuid, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_summary(uuid, date, date) TO authenticated;

