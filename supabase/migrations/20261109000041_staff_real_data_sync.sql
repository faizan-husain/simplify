-- Migration 41: Real Business Data Sync for Staff (Jobs, Invoices, Services)
-- User request: Jobs all show karao jo owner jesa same data real load karao services bills aisa nhi k owner me kuch aur and staff ko kuch aur show horaha

-- 1. Invoices & Invoice Items RLS: Allow all business members (including Staff) to view all active invoices
DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS invoice_items_select ON public.invoice_items;
CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT
  USING (
    business_id = (SELECT app.current_business_id())
    AND deleted_at IS NULL
  );

-- 2. Update list_jobs: Remove staff assignment/creation filters so Staff sees ALL jobs of the business exactly like Owner
CREATE OR REPLACE FUNCTION public.list_jobs(
  p_tab text DEFAULT 'CURRENT',
  p_service_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0,
  p_sort text DEFAULT 'QUEUE'
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_caller_id uuid;
  v_today date;
  v_red_days int;
  v_yellow_days int;

  v_count_current int := 0;
  v_count_completed int := 0;
  v_count_due int := 0;
  v_count_yellow int := 0;
  v_count_red int := 0;

  v_jobs jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Accountants do not have access to job management';
  END IF;

  SELECT COALESCE(red_days, 3), COALESCE(yellow_days, 5)
  INTO v_red_days, v_yellow_days
  FROM public.businesses
  WHERE id = v_biz_id;

  -- Compute tab counts across ALL jobs of the business
  SELECT
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS'),
    COUNT(*) FILTER (WHERE j.status = 'COMPLETED'),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) < 0),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) >= 0 AND (j.deadline_date - v_today) <= v_red_days)
  INTO
    v_count_current,
    v_count_completed,
    v_count_due,
    v_count_yellow,
    v_count_red
  FROM public.jobs j
  WHERE j.business_id = v_biz_id 
    AND j.deleted_at IS NULL;

  WITH job_steps_agg AS (
    SELECT
      js.job_id,
      COUNT(*)::int AS total_steps,
      COUNT(*) FILTER (WHERE js.ticked = true)::int AS ticked_steps,
      (
        SELECT s2.name 
        FROM public.job_steps s2 
        WHERE s2.job_id = js.job_id AND s2.ticked = false AND s2.deleted_at IS NULL 
        ORDER BY s2.position ASC 
        LIMIT 1
      ) AS next_step_name
    FROM public.job_steps js
    WHERE js.business_id = v_biz_id AND js.deleted_at IS NULL
    GROUP BY js.job_id
  ),
  filtered_jobs AS (
    SELECT
      j.id,
      j.invoice_id,
      i.number AS invoice_number,
      j.service_id,
      j.job_type_name,
      j.party_name,
      j.party_mobile,
      j.applicant_name,
      j.amount,
      j.deadline_date,
      (j.deadline_date - v_today) AS days_left,
      j.status,
      j.completed_at,
      j.assigned_staff_id,
      m.name AS assigned_staff_name,
      j.created_at,
      COALESCE(jsa.total_steps, 0) AS total_steps,
      COALESCE(jsa.ticked_steps, 0) AS ticked_steps,
      jsa.next_step_name,
      CASE
        WHEN COALESCE(jsa.total_steps, 0) = 0 THEN 0
        ELSE ROUND((COALESCE(jsa.ticked_steps, 0)::numeric / jsa.total_steps::numeric) * 100, 1)
      END AS progress_percent,
      CASE
        WHEN (j.deadline_date - v_today) < 0 THEN 'LATE'
        WHEN (j.deadline_date - v_today) >= 0 AND (j.deadline_date - v_today) <= v_red_days THEN 'RED'
        WHEN (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days THEN 'YELLOW'
        ELSE 'NORMAL'
      END AS deadline_bucket
    FROM public.jobs j
    JOIN public.invoices i ON i.id = j.invoice_id
    LEFT JOIN public.members m ON m.id = j.assigned_staff_id
    LEFT JOIN job_steps_agg jsa ON jsa.job_id = j.id
    WHERE j.business_id = v_biz_id
      AND j.deleted_at IS NULL
      AND (
        p_service_id IS NULL 
        OR j.service_id = p_service_id 
        OR j.job_type_name = (SELECT name FROM public.services WHERE id = p_service_id)
      )
      AND (
        p_search IS NULL
        OR p_search = ''
        OR j.party_name ILIKE '%' || p_search || '%'
        OR j.party_mobile ILIKE '%' || p_search || '%'
        OR j.applicant_name ILIKE '%' || p_search || '%'
        OR i.number ILIKE '%' || p_search || '%'
        OR j.job_type_name ILIKE '%' || p_search || '%'
      )
      AND (
        CASE UPPER(p_tab)
          WHEN 'CURRENT' THEN j.status = 'IN_PROGRESS'
          WHEN 'COMPLETED' THEN j.status = 'COMPLETED'
          WHEN 'DUE' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) < 0
          WHEN 'LATE' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) < 0
          WHEN 'YELLOW' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days
          WHEN 'RED' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) >= 0 AND (j.deadline_date - v_today) <= v_red_days
          ELSE j.status = 'IN_PROGRESS'
        END
      )
    ORDER BY
      CASE
        WHEN UPPER(p_tab) = 'COMPLETED' THEN j.completed_at
        ELSE NULL
      END DESC NULLS LAST,
      CASE
        WHEN UPPER(p_sort) = 'PROGRESS' AND UPPER(p_tab) <> 'COMPLETED' THEN COALESCE(jsa.ticked_steps, 0)
        ELSE NULL
      END ASC,
      CASE
        WHEN UPPER(p_sort) = 'PROGRESS' AND UPPER(p_tab) <> 'COMPLETED' THEN
          CASE
            WHEN COALESCE(jsa.total_steps, 0) = 0 THEN 0
            ELSE (COALESCE(jsa.ticked_steps, 0)::numeric / jsa.total_steps::numeric)
          END
        ELSE NULL
      END ASC,
      CASE
        WHEN UPPER(p_tab) <> 'COMPLETED' THEN j.deadline_date
        ELSE NULL
      END ASC NULLS LAST,
      j.created_at ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_agg(row_to_json(f)) INTO v_jobs FROM filtered_jobs f;

  RETURN jsonb_build_object(
    'tab_counts', jsonb_build_object(
      'current', v_count_current,
      'completed', v_count_completed,
      'due', v_count_due,
      'yellow', v_count_yellow,
      'red', v_count_red
    ),
    'jobs', COALESCE(v_jobs, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 3. Update staff_dashboard: Return real business jobs, real business recent bills, and real business top services
CREATE OR REPLACE FUNCTION public.staff_dashboard(
  p_period text DEFAULT 'TODAY'
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_caller_id uuid;
  v_today date;
  v_biz public.businesses%ROWTYPE;
  v_start_date date;
  v_end_date date;

  -- 1. Bills (Real business counts & totals)
  v_bills_count int := 0;
  v_bills_total numeric(14,2) := 0;

  -- 2. My Collections (for shift-end cash handover)
  v_collection_total numeric(14,2) := 0;
  v_collection_cash numeric(14,2) := 0;
  v_collection_upi numeric(14,2) := 0;
  v_collection_bank numeric(14,2) := 0;
  v_collection_card numeric(14,2) := 0;

  -- 3. Staff Profile & Earnings
  v_staff record;
  v_total_earned numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_balance_payable numeric(14,2) := 0;
  v_upcoming numeric(14,2) := 0;

  -- 4. Jobs & Deadlines (ALL business jobs)
  v_red_days int;
  v_yellow_days int;
  v_jobs_pending int := 0;
  v_jobs_completed_today int := 0;
  v_jobs_completed_period int := 0;
  v_jobs_late int := 0;
  v_jobs_red int := 0;
  v_jobs_yellow int := 0;
  v_urgent_jobs jsonb := '[]'::jsonb;

  -- 5. Business Recent Bills
  v_recent_bills jsonb := '[]'::jsonb;

  -- 6. Business Bills per day
  v_bills_per_day jsonb := '[]'::jsonb;

  -- 7. Business Top Services
  v_top_services jsonb := '[]'::jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_caller_id := (SELECT app.current_member_id());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_caller_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_biz_id;
  v_red_days := COALESCE(v_biz.red_days, 3);
  v_yellow_days := COALESCE(v_biz.yellow_days, 5);

  -- Set period dates
  IF UPPER(COALESCE(p_period, 'TODAY')) = 'MONTH' THEN
    v_start_date := date_trunc('month', v_today)::date;
    v_end_date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  ELSE
    v_start_date := v_today;
    v_end_date := v_today;
  END IF;

  -- =========================================================
  -- 1. BILLS (Business-wide for real alignment)
  -- =========================================================
  SELECT
    COUNT(*),
    COALESCE(SUM(total), 0)
  INTO v_bills_count, v_bills_total
  FROM public.invoices
  WHERE business_id = v_biz_id
    AND invoice_date >= v_start_date
    AND invoice_date <= v_end_date
    AND status = 'ACTIVE'
    AND deleted_at IS NULL;

  -- =========================================================
  -- 2. MY COLLECTIONS (Receipts created by this staff member for shift-end handover)
  -- =========================================================
  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'CASH'), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'UPI'), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode IN ('BANK', 'CHEQUE')), 0),
    COALESCE(SUM(amount) FILTER (WHERE mode = 'CARD'), 0)
  INTO
    v_collection_total,
    v_collection_cash,
    v_collection_upi,
    v_collection_bank,
    v_collection_card
  FROM public.receipts
  WHERE business_id = v_biz_id
    AND created_by = v_caller_id
    AND receipt_date >= v_start_date
    AND receipt_date <= v_end_date
    AND deleted_at IS NULL;

  -- =========================================================
  -- 3. MY EARNINGS
  -- =========================================================
  SELECT 
    id, name, mobile, role,
    COALESCE(compensation_type, 'COMMISSION') AS compensation_type,
    COALESCE(monthly_salary, 0) AS monthly_salary,
    COALESCE(salary_start_date, created_at::date) AS salary_start_date
  INTO v_staff
  FROM public.members
  WHERE id = v_caller_id AND business_id = v_biz_id;

  IF v_staff.compensation_type = 'SALARY' THEN
    v_total_earned := v_staff.monthly_salary;
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.staff_payouts
    WHERE staff_id = v_caller_id AND business_id = v_biz_id AND deleted_at IS NULL
      AND payout_date >= v_start_date AND payout_date <= v_end_date;

    v_balance_payable := (
      GREATEST(0, (
        (EXTRACT(YEAR FROM v_today) - EXTRACT(YEAR FROM v_staff.salary_start_date)) * 12 +
        (EXTRACT(MONTH FROM v_today) - EXTRACT(MONTH FROM v_staff.salary_start_date)) + 1
      )::int) * v_staff.monthly_salary
    ) - (
      SELECT COALESCE(SUM(amount), 0)
      FROM public.staff_payouts
      WHERE staff_id = v_caller_id AND business_id = v_biz_id AND deleted_at IS NULL
    );
    v_upcoming := 0;
  ELSE
    SELECT 
      COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'EARNED'), 0),
      COALESCE(SUM(ce.amount) FILTER (WHERE ce.status = 'UPCOMING'), 0)
    INTO v_total_earned, v_upcoming
    FROM public.commission_entries ce
    WHERE ce.business_id = v_biz_id
      AND ce.staff_id = v_caller_id
      AND ce.earned_at::date >= v_start_date
      AND ce.earned_at::date <= v_end_date;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.staff_payouts
    WHERE business_id = v_biz_id AND staff_id = v_caller_id AND deleted_at IS NULL
      AND payout_date >= v_start_date AND payout_date <= v_end_date;

    v_balance_payable := (
      SELECT COALESCE(SUM(amount), 0) FROM public.commission_entries
      WHERE business_id = v_biz_id AND status = 'EARNED' AND staff_id = v_caller_id
    ) - (
      SELECT COALESCE(SUM(amount), 0) FROM public.staff_payouts
      WHERE business_id = v_biz_id AND staff_id = v_caller_id AND deleted_at IS NULL
    );
  END IF;

  -- =========================================================
  -- 4. JOBS QUEUE (Real ALL business jobs)
  -- =========================================================
  IF v_biz.job_management_enabled THEN
    SELECT COUNT(*) INTO v_jobs_pending
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_completed_today
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'COMPLETED'
      AND completed_at::date = v_today
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_completed_period
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'COMPLETED'
      AND completed_at::date >= v_start_date
      AND completed_at::date <= v_end_date
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_late
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND deadline_date < v_today
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_red
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND deadline_date >= v_today
      AND (deadline_date - v_today) <= v_red_days
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_jobs_yellow
    FROM public.jobs
    WHERE business_id = v_biz_id
      AND status = 'IN_PROGRESS'
      AND (deadline_date - v_today) > v_red_days
      AND (deadline_date - v_today) <= v_yellow_days
      AND deleted_at IS NULL;

    -- Fetch top urgent jobs across ALL business jobs for quick step ticking
    SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
    INTO v_urgent_jobs
    FROM (
      SELECT
        j.id,
        j.job_type_name,
        j.party_name,
        j.party_mobile,
        j.applicant_name,
        j.deadline_date,
        j.status,
        j.created_at,
        j.assigned_staff_id,
        m.name as assigned_staff_name,
        i.number as invoice_number,
        (j.deadline_date - v_today) as days_left,
        (SELECT COUNT(*) FROM public.job_steps js WHERE js.job_id = j.id) as total_steps,
        (SELECT COUNT(*) FROM public.job_steps js WHERE js.job_id = j.id AND js.ticked = true) as ticked_steps,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', js.id,
              'position', js.position,
              'name', js.name,
              'ticked', js.ticked,
              'ticked_at', js.ticked_at,
              'whatsapp_message', js.whatsapp_message
            ) ORDER BY js.position ASC
          )
          FROM public.job_steps js
          WHERE js.job_id = j.id
        ), '[]'::jsonb) as steps
      FROM public.jobs j
      JOIN public.invoices i ON i.id = j.invoice_id
      LEFT JOIN public.members m ON m.id = j.assigned_staff_id
      WHERE j.business_id = v_biz_id
        AND j.status = 'IN_PROGRESS'
        AND j.deleted_at IS NULL
      ORDER BY
        CASE WHEN j.deadline_date < v_today THEN 0 ELSE 1 END ASC,
        j.deadline_date ASC,
        j.created_at ASC
      LIMIT 30
    ) sub;
  END IF;

  -- =========================================================
  -- 5. REAL RECENT BILLS OF THE BUSINESS
  -- =========================================================
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_recent_bills
  FROM (
    SELECT
      id,
      number,
      invoice_date,
      due_date,
      party_name,
      party_mobile,
      total,
      paid_amount,
      (total - paid_amount) as balance,
      status,
      created_at
    FROM public.invoices
    WHERE business_id = v_biz_id
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 8
  ) sub;

  -- =========================================================
  -- 6. BUSINESS BILLS PER DAY (FOR CURRENT MONTH)
  -- =========================================================
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_bills_per_day
  FROM (
    SELECT
      to_char(d.date, 'DD Mon') as date_label,
      d.date as raw_date,
      COALESCE((
        SELECT COUNT(*)
        FROM public.invoices i
        WHERE i.business_id = v_biz_id
          AND i.invoice_date = d.date
          AND i.status = 'ACTIVE'
          AND i.deleted_at IS NULL
      ), 0) as bills_count,
      COALESCE((
        SELECT SUM(i.total)
        FROM public.invoices i
        WHERE i.business_id = v_biz_id
          AND i.invoice_date = d.date
          AND i.status = 'ACTIVE'
          AND i.deleted_at IS NULL
      ), 0) as bills_amount
    FROM generate_series(
      date_trunc('month', v_today)::date,
      v_today,
      '1 day'::interval
    ) d(date)
    ORDER BY d.date ASC
  ) sub;

  -- =========================================================
  -- 7. BUSINESS TOP SERVICES
  -- =========================================================
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_top_services
  FROM (
    SELECT
      COALESCE(s.name, ii.description) as name,
      COUNT(*)::int as count,
      COALESCE(SUM(ii.amount), 0) as total_amount
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    LEFT JOIN public.services s ON s.id = ii.service_id
    WHERE i.business_id = v_biz_id
      AND i.invoice_date >= v_start_date AND i.invoice_date <= v_end_date
      AND i.status = 'ACTIVE'
      AND i.deleted_at IS NULL
    GROUP BY COALESCE(s.name, ii.description)
    ORDER BY count DESC, total_amount DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'period', p_period,
    'today_date', v_today,
    'my_bills', jsonb_build_object(
      'count', v_bills_count,
      'total_amount', v_bills_total
    ),
    'my_collection', jsonb_build_object(
      'total', v_collection_total,
      'cash', v_collection_cash,
      'upi', v_collection_upi,
      'bank', v_collection_bank,
      'card', v_collection_card
    ),
    'my_earnings', jsonb_build_object(
      'compensation_type', v_staff.compensation_type,
      'monthly_salary', v_staff.monthly_salary,
      'total_earned', v_total_earned,
      'total_paid', v_total_paid,
      'balance_payable', v_balance_payable,
      'upcoming', v_upcoming
    ),
    'jobs', jsonb_build_object(
      'enabled', v_biz.job_management_enabled,
      'pending_count', v_jobs_pending,
      'completed_today_count', v_jobs_completed_today,
      'completed_period_count', v_jobs_completed_period,
      'late_count', v_jobs_late,
      'red_count', v_jobs_red,
      'yellow_count', v_jobs_yellow,
      'urgent_jobs', v_urgent_jobs
    ),
    'my_recent_bills', v_recent_bills,
    'my_bills_per_day', v_bills_per_day,
    'top_services', v_top_services
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.staff_dashboard(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_dashboard(text) TO authenticated;
