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

    const bizRes = await client.query("SELECT id, name, yellow_days, red_days FROM public.businesses WHERE name ILIKE '%Global%' LIMIT 1");
    const biz = bizRes.rows[0];
    console.log(`Testing Business: ${biz.name} (Yellow alert: ${biz.yellow_days}d, Red alert: ${biz.red_days}d)`);

    const owner = await client.query("SELECT auth_user_id FROM public.members WHERE business_id = $1 AND role = 'OWNER' LIMIT 1", [biz.id]);
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner.rows[0].auth_user_id]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");

    // 1. Test Tab 'DUE' (Late Jobs)
    const lateRes = await client.query("SELECT public.list_jobs('DUE', NULL, NULL, 50, 0, 'QUEUE') as r");
    const lateJobs = lateRes.rows[0].r.jobs;
    console.log(`\n--- Late Jobs Tab: ${lateJobs.length} jobs (tabCount: ${lateRes.rows[0].r.tab_counts.due}) ---`);
    for (const j of lateJobs) {
      if (j.days_left >= 0) {
        throw new Error(`❌ Non-late job found in Late tab: ${j.party_name} (days_left: ${j.days_left})`);
      }
      console.log(`  ✓ ${j.party_name}: ${j.days_left}d (late) - OK`);
    }

    // 2. Test Tab 'YELLOW' (Yellow Box Jobs)
    const yellowRes = await client.query("SELECT public.list_jobs('YELLOW', NULL, NULL, 50, 0, 'QUEUE') as r");
    const yellowJobs = yellowRes.rows[0].r.jobs;
    console.log(`\n--- Yellow Box Jobs Tab: ${yellowJobs.length} jobs (tabCount: ${yellowRes.rows[0].r.tab_counts.yellow}) ---`);
    for (const j of yellowJobs) {
      if (j.days_left <= biz.red_days || j.days_left > biz.yellow_days) {
        throw new Error(`❌ Out-of-bounds job found in Yellow Box tab: ${j.party_name} (days_left: ${j.days_left}, expected ${biz.red_days + 1}..${biz.yellow_days})`);
      }
      console.log(`  ✓ ${j.party_name}: ${j.days_left}d left (in yellow window ${biz.red_days + 1}..${biz.yellow_days}) - OK`);
    }

    // 3. Test Tab 'RED' (Red Box Jobs)
    const redRes = await client.query("SELECT public.list_jobs('RED', NULL, NULL, 50, 0, 'QUEUE') as r");
    const redJobs = redRes.rows[0].r.jobs;
    console.log(`\n--- Red Box Jobs Tab: ${redJobs.length} jobs (tabCount: ${redRes.rows[0].r.tab_counts.red}) ---`);
    for (const j of redJobs) {
      if (j.days_left < 0 || j.days_left > biz.red_days) {
        throw new Error(`❌ Out-of-bounds job found in Red Box tab: ${j.party_name} (days_left: ${j.days_left}, expected 0..${biz.red_days})`);
      }
      console.log(`  ✓ ${j.party_name}: ${j.days_left}d left (in red window 0..${biz.red_days}) - OK`);
    }

    console.log('\n🎉 ALL TAB BUCKET ISOLATION CHECKS PASSED WITH 100% SUCCESS!');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
