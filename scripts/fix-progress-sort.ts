import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });

  try {
    await client.connect();
    console.log('Connected to simplify_dev');

    // 1. Drop old 5-arg list_jobs to eliminate ambiguity
    await client.query(`DROP FUNCTION IF EXISTS public.list_jobs(text, uuid, text, int, int);`);
    console.log('✓ Dropped old 5-arg list_jobs');

    // 2. Recreate 6-arg list_jobs with absolute PROGRESS precedence
    await client.query(`
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
  SELECT
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS'),
    COUNT(*) FILTER (WHERE j.status = 'COMPLETED'),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) <= 0),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days),
    COUNT(*) FILTER (WHERE j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) <= v_red_days)
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
        WHEN (j.deadline_date - v_today) <= v_red_days THEN 'RED'
        WHEN (j.deadline_date - v_today) <= v_yellow_days THEN 'YELLOW'
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
          WHEN 'DUE' THEN j.status = 'IN_PROGRESS'
          WHEN 'RED' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) <= v_red_days
          WHEN 'YELLOW' THEN j.status = 'IN_PROGRESS' AND (j.deadline_date - v_today) > v_red_days AND (j.deadline_date - v_today) <= v_yellow_days
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

REVOKE ALL ON FUNCTION public.list_jobs(text, uuid, text, int, int, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_jobs(text, uuid, text, int, int, text) TO authenticated;
    `);
    console.log('✓ Recreated list_jobs with exact PROGRESS sorting priority');

    // 3. Let's create a test job with 2 steps ticked to verify it ranks at #1 when sorted by PROGRESS
    const bizRes = await client.query("SELECT id, name FROM public.businesses WHERE name ILIKE '%Global%' LIMIT 1");
    const biz = bizRes.rows[0];
    const owner = await client.query("SELECT auth_user_id FROM public.members WHERE business_id = $1 AND role = 'OWNER' LIMIT 1", [biz.id]);
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner.rows[0].auth_user_id]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");

    // Find a job in Global Computers and tick 2 steps
    const jobsInBiz = await client.query(`
      SELECT j.id, j.party_name, COUNT(js.id) filter (where js.ticked = true) as ticked
      FROM public.jobs j
      LEFT JOIN public.job_steps js ON js.job_id = j.id
      WHERE j.business_id = $1 AND j.status = 'IN_PROGRESS' AND j.deleted_at IS NULL
      GROUP BY j.id, j.party_name
      LIMIT 3
    `, [biz.id]);

    if (jobsInBiz.rows.length > 0) {
      const topJob = jobsInBiz.rows[0];
      // Tick 2 steps for this job
      const stepsToTick = await client.query(`SELECT id FROM public.job_steps WHERE job_id = $1 AND ticked = false ORDER BY position ASC LIMIT 2`, [topJob.id]);
      for (const st of stepsToTick.rows) {
        await client.query("SELECT public.tick_step($1)", [st.id]);
      }
      console.log(`Ticked steps for ${topJob.party_name}`);
    }

    // Now test list_jobs with PROGRESS sort
    const testRes = await client.query("SELECT public.list_jobs('CURRENT', NULL, NULL, 5, 0, 'PROGRESS') as r");
    console.log('\n--- VERIFICATION: Top 5 Jobs with PROGRESS Sort ---');
    testRes.rows[0].r.jobs.forEach((j: any, i: number) => {
      console.log(`#${i + 1}: ${j.party_name} -> Steps Ticked: ${j.ticked_steps}/${j.total_steps} (${j.progress_percent}%) | Next: "${j.next_step_name || 'None'}"`);
    });

  } finally {
    await client.end();
  }
}

main().catch(console.error);
