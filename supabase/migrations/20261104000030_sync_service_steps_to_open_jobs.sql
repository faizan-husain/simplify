-- Migration 30: Support for Services with No Steps, Direct Completion, and Live Step Synchronization to Jobs
-- When an admin turns a simple service into a multi-step job, active jobs automatically receive the steps.

-- 1. RPC to sync newly defined job_type_steps to any active open jobs for that service
CREATE OR REPLACE FUNCTION public.sync_service_steps_to_jobs(
  p_service_id uuid
)
RETURNS int AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_member_id uuid;
  v_job RECORD;
  v_step RECORD;
  v_synced_jobs_count int := 0;
  v_existing_steps_count int;
  v_service RECORD;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_role != 'OWNER' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501', DETAIL = 'Only Owner can sync service steps';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Iterate through open/in-progress jobs for this service
  FOR v_job IN
    SELECT j.id, j.deadline_date, j.invoice_date
    FROM public.jobs j
    LEFT JOIN public.invoices i ON i.id = j.invoice_id
    WHERE j.business_id = v_biz_id
      AND j.service_id = p_service_id
      AND j.status = 'IN_PROGRESS'
      AND j.deleted_at IS NULL
  LOOP
    -- Count existing steps for this job
    SELECT COUNT(*) INTO v_existing_steps_count
    FROM public.job_steps
    WHERE job_id = v_job.id AND deleted_at IS NULL;

    -- If the job has 0 steps, populate from job_type_steps
    IF v_existing_steps_count = 0 THEN
      FOR v_step IN
        SELECT position, name, whatsapp_message
        FROM public.job_type_steps
        WHERE service_id = p_service_id AND deleted_at IS NULL
        ORDER BY position ASC
      LOOP
        INSERT INTO public.job_steps (
          business_id,
          job_id,
          position,
          name,
          whatsapp_message,
          ticked,
          created_by,
          updated_by
        )
        VALUES (
          v_biz_id,
          v_job.id,
          v_step.position,
          v_step.name,
          v_step.whatsapp_message,
          false,
          v_member_id,
          v_member_id
        );
      END LOOP;

      -- Update job snapshot fields to match updated service
      UPDATE public.jobs
      SET
        job_type_name = v_service.name,
        commission_percent = COALESCE(v_service.commission_percent, commission_percent),
        deadline_date = CASE
          WHEN v_service.deadline_days IS NOT NULL AND v_service.deadline_days > 0 AND v_job.invoice_date IS NOT NULL
          THEN (v_job.invoice_date + (v_service.deadline_days || ' days')::interval)::date
          ELSE deadline_date
        END
      WHERE id = v_job.id;

      v_synced_jobs_count := v_synced_jobs_count + 1;
    END IF;
  END LOOP;

  RETURN v_synced_jobs_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.sync_service_steps_to_jobs(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sync_service_steps_to_jobs(uuid) TO authenticated;

-- 2. RPC to complete a job directly (especially for jobs with 0 steps / single-step jobs)
CREATE OR REPLACE FUNCTION public.complete_job_directly(
  p_job_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_role text;
  v_member_id uuid;
  v_job public.jobs%ROWTYPE;
BEGIN
  v_biz_id := (SELECT app.current_business_id());
  v_role := (SELECT app.current_role());
  v_member_id := (SELECT app.current_member_id());

  IF v_biz_id IS NULL OR v_role NOT IN ('OWNER', 'STAFF') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id AND business_id = v_biz_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = 'Job not found';
  END IF;

  IF v_job.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'JOB_CANCELLED' USING ERRCODE = 'P0001', DETAIL = 'Cannot complete a cancelled job';
  END IF;

  -- Toggle status: if already COMPLETED, reopen; if IN_PROGRESS, mark COMPLETED
  IF v_job.status = 'COMPLETED' THEN
    UPDATE public.jobs
    SET status = 'IN_PROGRESS', completed_at = NULL, updated_by = v_member_id, updated_at = now()
    WHERE id = p_job_id;

    -- Update commission if exists
    UPDATE public.commission_entries
    SET status = 'UPCOMING', earned_at = NULL, updated_by = v_member_id, updated_at = now()
    WHERE job_id = p_job_id AND status != 'CANCELLED';

    RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS');
  ELSE
    UPDATE public.jobs
    SET status = 'COMPLETED', completed_at = now(), updated_by = v_member_id, updated_at = now()
    WHERE id = p_job_id;

    -- Earn commission on completion (BR-15)
    UPDATE public.commission_entries
    SET status = 'EARNED', earned_at = now(), updated_by = v_member_id, updated_at = now()
    WHERE job_id = p_job_id AND status != 'CANCELLED';

    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.complete_job_directly(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_job_directly(uuid) TO authenticated;

