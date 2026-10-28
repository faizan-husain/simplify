-- Migration 6: Job Management (Job listing, detail, tick/untick steps, deadline buckets, update_job)
-- Conforms to BR-12, BR-13, BR-14, BR-15, and §5 Permissions

-- Helper RPC: list_jobs
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
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- Load business red_days and yellow_days settings
  SELECT COALESCE(red_days, 3), COALESCE(yellow_days, 5)
  INTO v_red_days, v_yellow_days
  FROM public.businesses
  WHERE id = v_biz_id;

  -- Compute tab counts across all non-deleted jobs in business
  -- Late: strictly days_left < 0 (deadline has passed)
  -- Yellow: red_days < days_left <= yellow_days (e.g. 4 to 5 days left)
  -- Red: 0 <= days_left <= red_days (e.g. 0 to 3 days left)
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
  WHERE j.business_id = v_biz_id AND j.deleted_at IS NULL;

  -- Query jobs for active tab
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
      AND (p_service_id IS NULL OR j.service_id = p_service_id)
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
      CASE UPPER(p_tab)
        WHEN 'COMPLETED' THEN j.completed_at
        ELSE NULL
      END DESC NULLS LAST,
      -- 1. PROGRESS sort: jobs with most completed steps come first
      CASE 
        WHEN UPPER(p_sort) = 'PROGRESS' 
        THEN COALESCE(jsa.ticked_steps, 0)
      END DESC NULLS LAST,
      CASE 
        WHEN UPPER(p_sort) = 'PROGRESS' 
        THEN (COALESCE(jsa.ticked_steps, 0)::numeric / GREATEST(1, jsa.total_steps)::numeric) 
      END DESC NULLS LAST,
      -- 2. URGENT sort: nearest deadline and late jobs first
      CASE 
        WHEN UPPER(p_sort) = 'URGENT' OR (UPPER(p_tab) IN ('DUE', 'RED', 'YELLOW') AND UPPER(p_sort) != 'PROGRESS')
        THEN (j.deadline_date - v_today) 
      END ASC,
      -- 3. Primary FIFO Queue Order: earliest created_at first
      j.created_at ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(filtered_jobs.*)), '[]'::jsonb)
  INTO v_jobs
  FROM filtered_jobs;

  RETURN jsonb_build_object(
    'tab_counts', jsonb_build_object(
      'current', v_count_current,
      'completed', v_count_completed,
      'due', v_count_due,
      'yellow', v_count_yellow,
      'red', v_count_red
    ),
    'jobs', v_jobs
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.list_jobs(text, uuid, text, int, int) FROM anon, public;
REVOKE ALL ON FUNCTION public.list_jobs(text, uuid, text, int, int, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_jobs(text, uuid, text, int, int, text) TO authenticated;


-- RPC: job_detail
CREATE OR REPLACE FUNCTION public.job_detail(
  p_job_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_today date;
  v_red_days int;
  v_yellow_days int;
  v_job record;
  v_steps jsonb;
  v_events jsonb;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_today := (SELECT app.today());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(red_days, 3), COALESCE(yellow_days, 5)
  INTO v_red_days, v_yellow_days
  FROM public.businesses
  WHERE id = v_biz_id;

  SELECT
    j.id,
    j.invoice_id,
    i.number AS invoice_number,
    i.invoice_date,
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
    j.commission_percent,
    j.created_at,
    CASE
      WHEN (j.deadline_date - v_today) <= v_red_days THEN 'RED'
      WHEN (j.deadline_date - v_today) <= v_yellow_days THEN 'YELLOW'
      ELSE 'NORMAL'
    END AS deadline_bucket
  INTO v_job
  FROM public.jobs j
  JOIN public.invoices i ON i.id = j.invoice_id
  LEFT JOIN public.members m ON m.id = j.assigned_staff_id
  WHERE j.id = p_job_id AND j.business_id = v_biz_id AND j.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Ordered steps
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', js.id,
        'position', js.position,
        'name', js.name,
        'whatsapp_message', js.whatsapp_message,
        'ticked', js.ticked,
        'ticked_at', js.ticked_at,
        'ticked_by', js.ticked_by,
        'ticked_by_name', tm.name
      )
      ORDER BY js.position ASC
    ),
    '[]'::jsonb
  ) INTO v_steps
  FROM public.job_steps js
  LEFT JOIN public.members tm ON tm.id = js.ticked_by
  WHERE js.job_id = p_job_id AND js.business_id = v_biz_id AND js.deleted_at IS NULL;

  -- Step events log
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', jse.id,
        'step_id', jse.job_step_id,
        'action', jse.action,
        'member_name', em.name,
        'at', jse.at
      )
      ORDER BY jse.at DESC
    ),
    '[]'::jsonb
  ) INTO v_events
  FROM public.job_step_events jse
  JOIN public.job_steps js ON js.id = jse.job_step_id
  LEFT JOIN public.members em ON em.id = jse.member_id
  WHERE js.job_id = p_job_id AND js.business_id = v_biz_id
  LIMIT 30;

  RETURN jsonb_build_object(
    'job', to_jsonb(v_job),
    'steps', v_steps,
    'events', v_events
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.job_detail(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.job_detail(uuid) TO authenticated;


-- RPC: tick_step (BR-13, BR-15)
CREATE OR REPLACE FUNCTION public.tick_step(
  p_step_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_step public.job_steps%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_total_steps int;
  v_ticked_steps int;
  v_is_all_ticked boolean := false;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_step
  FROM public.job_steps
  WHERE id = p_step_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STEP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = v_step.job_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_job.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'JOB_IS_CANCELLED' USING ERRCODE = 'P0001';
  END IF;

  -- Tick the step
  UPDATE public.job_steps
  SET ticked = true,
      ticked_at = now(),
      ticked_by = v_member_id,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_step.id;

  -- Record event
  INSERT INTO public.job_step_events (job_step_id, action, member_id, at)
  VALUES (v_step.id, 'TICK', v_member_id, now());

  -- Check if all steps for this job are now ticked
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE ticked = true)::int
  INTO
    v_total_steps,
    v_ticked_steps
  FROM public.job_steps
  WHERE job_id = v_job.id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF v_total_steps > 0 AND v_ticked_steps = v_total_steps THEN
    v_is_all_ticked := true;

    -- Job completed
    UPDATE public.jobs
    SET status = 'COMPLETED',
        completed_at = now(),
        updated_at = now(),
        updated_by = v_member_id
    WHERE id = v_job.id;

    -- Transition commission entries from UPCOMING to EARNED (BR-15)
    UPDATE public.commission_entries
    SET status = 'EARNED',
        earned_at = now(),
        updated_at = now(),
        updated_by = v_member_id
    WHERE job_id = v_job.id AND status = 'UPCOMING';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'step_id', v_step.id,
    'job_id', v_job.id,
    'job_completed', v_is_all_ticked,
    'total_steps', v_total_steps,
    'ticked_steps', v_ticked_steps
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.tick_step(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.tick_step(uuid) TO authenticated;


-- RPC: untick_step (BR-13, BR-15)
CREATE OR REPLACE FUNCTION public.untick_step(
  p_step_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_step public.job_steps%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_total_steps int;
  v_ticked_steps int;
  v_was_completed boolean := false;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'ACCOUNTANT', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_step
  FROM public.job_steps
  WHERE id = p_step_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STEP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = v_step.job_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_job.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'JOB_IS_CANCELLED' USING ERRCODE = 'P0001';
  END IF;

  -- Untick step
  UPDATE public.job_steps
  SET ticked = false,
      ticked_at = NULL,
      ticked_by = NULL,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_step.id;

  -- Record event
  INSERT INTO public.job_step_events (job_step_id, action, member_id, at)
  VALUES (v_step.id, 'UNTICK', v_member_id, now());

  -- Check count
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE ticked = true)::int
  INTO
    v_total_steps,
    v_ticked_steps
  FROM public.job_steps
  WHERE job_id = v_job.id AND business_id = v_biz_id AND deleted_at IS NULL;

  -- If job was completed, unticking any step reopens it (BR-13)
  IF v_job.status = 'COMPLETED' THEN
    v_was_completed := true;

    UPDATE public.jobs
    SET status = 'IN_PROGRESS',
        completed_at = NULL,
        updated_at = now(),
        updated_by = v_member_id
    WHERE id = v_job.id;

    -- Commission reverts from EARNED back to UPCOMING (BR-15)
    UPDATE public.commission_entries
    SET status = 'UPCOMING',
        earned_at = NULL,
        updated_at = now(),
        updated_by = v_member_id
    WHERE job_id = v_job.id AND status = 'EARNED';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'step_id', v_step.id,
    'job_id', v_job.id,
    'job_reopened', v_was_completed,
    'total_steps', v_total_steps,
    'ticked_steps', v_ticked_steps
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.untick_step(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.untick_step(uuid) TO authenticated;


-- RPC: update_job (Owner only per BR-12, §5)
CREATE OR REPLACE FUNCTION public.update_job(
  p_job_id uuid,
  p_deadline_date date,
  p_assigned_staff_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_job public.jobs%ROWTYPE;
  v_old_staff_id uuid;
  v_updated public.jobs%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_member_id := (SELECT app.current_member_id());
  v_role := (SELECT app.current_role());

  IF v_biz_id IS NULL OR v_role <> 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id AND business_id = v_biz_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_old_staff_id := v_job.assigned_staff_id;

  -- Validate staff if provided
  IF p_assigned_staff_id IS NOT NULL THEN
    PERFORM 1 FROM public.members
    WHERE id = p_assigned_staff_id AND business_id = v_biz_id AND active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.jobs
  SET deadline_date = COALESCE(p_deadline_date, deadline_date),
      assigned_staff_id = p_assigned_staff_id,
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_job.id
  RETURNING * INTO v_updated;

  -- If staff reassigned before completion, move commission entry (BR-15)
  IF p_assigned_staff_id IS DISTINCT FROM v_old_staff_id THEN
    IF p_assigned_staff_id IS NOT NULL AND v_job.commission_percent > 0 THEN
      -- Upsert commission entry
      INSERT INTO public.commission_entries (
        business_id, job_id, staff_id, base_amount, percent, amount, status
      ) VALUES (
        v_biz_id,
        v_job.id,
        p_assigned_staff_id,
        v_job.amount,
        v_job.commission_percent,
        ROUND((v_job.amount * v_job.commission_percent / 100), 2),
        CASE WHEN v_job.status = 'COMPLETED' THEN 'EARNED' ELSE 'UPCOMING' END
      )
      ON CONFLICT (job_id) DO UPDATE
      SET staff_id = EXCLUDED.staff_id,
          updated_at = now(),
          updated_by = v_member_id;
    ELSE
      -- Remove or set null if staff removed
      DELETE FROM public.commission_entries WHERE job_id = v_job.id;
    END IF;
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_job(uuid, date, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_job(uuid, date, uuid) TO authenticated;
