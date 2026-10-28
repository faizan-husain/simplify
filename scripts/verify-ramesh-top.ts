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

    const bizRes = await client.query("SELECT id, name FROM public.businesses WHERE name ILIKE '%Global%' LIMIT 1");
    const biz = bizRes.rows[0];
    const owner = await client.query("SELECT auth_user_id FROM public.members WHERE business_id = $1 AND role = 'OWNER' LIMIT 1", [biz.id]);
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner.rows[0].auth_user_id]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");

    // Find Walk-in Ramesh job
    const rameshJob = await client.query(`
      SELECT j.id, j.party_name 
      FROM public.jobs j 
      WHERE j.business_id = $1 AND j.status = 'IN_PROGRESS' AND j.party_name ILIKE '%Ramesh%' 
      LIMIT 1
    `, [biz.id]);

    if (rameshJob.rows.length > 0) {
      const jId = rameshJob.rows[0].id;
      // Get step 2 (unticked)
      const nextStep = await client.query(`
        SELECT id, name FROM public.job_steps 
        WHERE job_id = $1 AND ticked = false 
        ORDER BY position ASC 
        LIMIT 1
      `, [jId]);
      if (nextStep.rows.length > 0) {
        await client.query("SELECT public.tick_step($1)", [nextStep.rows[0].id]);
        console.log(`Ticked step "${nextStep.rows[0].name}" for Ramesh! Now Ramesh has 2/3 steps.`);
      }
    }

    // Now test list_jobs with PROGRESS sort
    const testRes = await client.query("SELECT public.list_jobs('CURRENT', NULL, NULL, 5, 0, 'PROGRESS') as r");
    console.log('\n--- VERIFICATION: Top Jobs with PROGRESS Sort ---');
    testRes.rows[0].r.jobs.forEach((j: any, i: number) => {
      console.log(`#${i + 1}: ${j.party_name} -> Steps Ticked: ${j.ticked_steps}/${j.total_steps} (${j.progress_percent}%) | Next: "${j.next_step_name || 'None'}"`);
    });

  } finally {
    await client.end();
  }
}

main().catch(console.error);
