-- Migration 37: Complete Staff Salary & Commission Management
-- Supports Commission Staff & Fixed Salary Staff, Accrued Monthly Salary, Advance Offsets, and Jobs Done Tracking

ALTER TABLE public.members 
  ADD COLUMN IF NOT EXISTS monthly_salary numeric(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS salary_start_date date DEFAULT NULL;

-- 1. RPC: set_staff_salary_config (Owner only)
CREATE OR REPLACE FUNCTION public.set_staff_salary_config(
  p_staff_id uuid,
  p_compensation_type text,
  p_monthly_salary numeric DEFAULT NULL,
  p_salary_start_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_member_id uuid;
  v_type text;
  v_salary numeric(14,2);
  v_start_date date;
  v_staff public.members%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001', DETAIL = 'Only Owner can update staff compensation';
  END IF;

  v_type := UPPER(TRIM(p_compensation_type));
  IF v_type NOT IN ('COMMISSION', 'SALARY') THEN
    RAISE EXCEPTION 'INVALID_COMPENSATION_TYPE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_staff
  FROM public.members
  WHERE id = p_staff_id AND business_id = v_biz_id AND active = true AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_type = 'SALARY' THEN
    v_salary := ROUND(COALESCE(p_monthly_salary, 0), 2);
    v_start_date := COALESCE(p_salary_start_date, date_trunc('month', (SELECT app.today()))::date);
    
    -- If switching to SALARY, remove pending UPCOMING commission since staff is now salaried
    DELETE FROM public.commission_entries
    WHERE staff_id = p_staff_id AND status = 'UPCOMING';
  ELSE
    v_salary := NULL;
    v_start_date := NULL;
  END IF;

  UPDATE public.members
  SET compensation_type = v_type,
      monthly_salary = v_salary,
      salary_start_date = v_start_date,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = p_staff_id;

  RETURN jsonb_build_object(
    'success', true,
    'staff_id', p_staff_id,
    'compensation_type', v_type,
    'monthly_salary', v_salary,
    'salary_start_date', v_start_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.set_staff_salary_config(uuid, text, numeric, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_staff_salary_config(uuid, text, numeric, date) TO authenticated;


-- 2. Enhanced staff_summary (Handles both Commission & Salaried staff)
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

  -- Per-staff calculations
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
          -- If period is current month or overlaps active salary month
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
          -- Total months accrued from start_date to current month
          GREATEST(0, (
            (EXTRACT(YEAR FROM v_today) - EXTRACT(YEAR FROM sb.salary_start_date)) * 12 +
            (EXTRACT(MONTH FROM v_today) - EXTRACT(MONTH FROM sb.salary_start_date)) + 1
          )::int) * sb.monthly_salary
        ELSE
          COALESCE(sca.earned_all, 0)
      END AS all_time_due,

      -- Total Paid All-Time
      COALESCE(spa.paid_all, 0) AS all_time_paid,

      -- Overall Balance = All Time Due - All Time Paid (Positive = Payable, Negative = Advance Given)
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


-- 3. Enhanced staff_commission drill-down (Includes Salary Months breakdown & Completed Jobs)
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
      v_start_date := date_trunc('month', v_today)::date;
      v_end_date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
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

