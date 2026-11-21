-- Migration 32: Bi-directional step synchronization for jobs
-- When an admin updates a service from multi-step job to normal service (is_job_type = false),
-- open jobs for that service have their steps removed so the job card immediately reflects "---- NO STEPS ----".

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
  v_ticked_count int;
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

  -- If service is normal (not a job type), clean up job_type_steps immediately
  IF v_service.is_job_type = false THEN
    DELETE FROM public.job_type_steps WHERE service_id = p_service_id;
  END IF;

  -- Iterate through open/in-progress jobs for this service (matching ID or snapshotted name)
  FOR v_job IN
    SELECT j.id, j.deadline_date, i.invoice_date
    FROM public.jobs j
    LEFT JOIN public.invoices i ON i.id = j.invoice_id
    WHERE j.business_id = v_biz_id
      AND (j.service_id = p_service_id OR (j.service_id IS NULL AND LOWER(TRIM(j.job_type_name)) = LOWER(TRIM(v_service.name))))
      AND j.status = 'IN_PROGRESS'
      AND j.deleted_at IS NULL
  LOOP
    -- Count ticked steps for this job
    SELECT COUNT(*) INTO v_ticked_count
    FROM public.job_steps
    WHERE job_id = v_job.id AND ticked = true AND deleted_at IS NULL;

    -- Case 1: Service is updated to a NORMAL service (is_job_type = false)
    IF v_service.is_job_type = false THEN
      -- If no steps are ticked, remove all steps completely so card shows ---- NO STEPS ----
      IF v_ticked_count = 0 THEN
        DELETE FROM public.job_steps WHERE job_id = v_job.id;
      ELSE
        -- Remove unticked steps
        DELETE FROM public.job_steps WHERE job_id = v_job.id AND ticked = false;
      END IF;

      -- Update job snapshot fields
      UPDATE public.jobs
      SET
        service_id = p_service_id,
        job_type_name = v_service.name
      WHERE id = v_job.id;

      v_synced_jobs_count := v_synced_jobs_count + 1;

    -- Case 2: Service is a multi-step job (is_job_type = true)
    ELSE
      -- If no steps have been ticked yet, replace completely with new steps
      IF v_ticked_count = 0 THEN
        DELETE FROM public.job_steps WHERE job_id = v_job.id;

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
          service_id = p_service_id,
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
    END IF;
  END LOOP;

  RETURN v_synced_jobs_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.sync_service_steps_to_jobs(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sync_service_steps_to_jobs(uuid) TO authenticated;
