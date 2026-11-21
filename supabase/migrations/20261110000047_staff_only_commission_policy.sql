-- Migration 47: Enforce Staff-Created Job Commission Policy
-- Business Rule: Commission is strictly earned ONLY when a Staff member creates the bill/job
-- and completes it. Owner-created jobs carry NO staff commission (owner does not take commission).

CREATE OR REPLACE FUNCTION public.update_job(
  p_job_id uuid,
  p_deadline_date date DEFAULT NULL,
  p_assigned_staff_id uuid DEFAULT NULL,
  p_applicant_name text DEFAULT NULL,
  p_party_name text DEFAULT NULL,
  p_party_mobile text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_biz_id uuid;
  v_member_id uuid;
  v_role text;
  v_job public.jobs%ROWTYPE;
  v_old_staff_id uuid;
  v_updated public.jobs%ROWTYPE;
  v_creator_role text;
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
      applicant_name = COALESCE(p_applicant_name, applicant_name),
      party_name = COALESCE(p_party_name, party_name),
      party_mobile = COALESCE(p_party_mobile, party_mobile),
      updated_at = now(),
      updated_by = v_member_id
  WHERE id = v_job.id
  RETURNING * INTO v_updated;

  -- Check creator role: Commission ONLY applies if the job was created by a STAFF member!
  SELECT role INTO v_creator_role
  FROM public.members
  WHERE id = v_job.created_by AND business_id = v_biz_id;

  IF v_creator_role = 'STAFF' THEN
    -- If staff reassigned before completion, move commission entry
    IF p_assigned_staff_id IS DISTINCT FROM v_old_staff_id THEN
      IF p_assigned_staff_id IS NOT NULL AND v_job.commission_percent > 0 THEN
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
        DELETE FROM public.commission_entries WHERE job_id = v_job.id;
      END IF;
    END IF;
  ELSE
    -- Owner-created jobs carry NO commission
    DELETE FROM public.commission_entries WHERE job_id = v_job.id;
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.update_job(uuid, date, uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_job(uuid, date, uuid, text, text, text) TO authenticated;

