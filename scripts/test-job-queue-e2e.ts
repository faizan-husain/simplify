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
    console.log('--- Testing Job Queue & Creation E2E ---');

    // 1. Get owner member & business
    const ownerRes = await client.query(`
      SELECT m.id as member_id, m.business_id, m.auth_user_id, b.name as biz_name 
      FROM public.members m 
      JOIN public.businesses b ON b.id = m.business_id 
      WHERE m.role = 'OWNER' AND m.active = true 
      LIMIT 1
    `);
    const owner = ownerRes.rows[0];
    console.log(`Testing with Business: ${owner.biz_name} (${owner.business_id}), Member: ${owner.member_id}`);

    // Set JWT claims in session for RLS & app helper functions
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [owner.auth_user_id]);
    await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`);

    // 2. Check if a Job Type with steps exists, or create one
    let jobTypeRes = await client.query(`
      SELECT id, name FROM public.services 
      WHERE business_id = $1 AND is_job_type = true AND deleted_at IS NULL 
      LIMIT 1
    `, [owner.business_id]);

    let serviceId: string;
    if (jobTypeRes.rows.length === 0) {
      const insSrv = await client.query(`
        INSERT INTO public.services (business_id, name, default_rate, is_job_type, deadline_days, commission_percent)
        VALUES ($1, 'Voter ID Application', 250, true, 10, 15)
        RETURNING id
      `, [owner.business_id]);
      serviceId = insSrv.rows[0].id;
      console.log('Created new job type service:', serviceId);

      // Insert steps
      await client.query(`
        INSERT INTO public.job_type_steps (business_id, service_id, position, name, whatsapp_message)
        VALUES 
          ($1, $2, 1, 'Form 6 Filled & Documents Verified', 'Hello {party_name}, your Voter ID Form 6 has been verified. Ref #{bill_no}.'),
          ($1, $2, 2, 'BLO Verification Done', 'Hello {party_name}, BLO field verification is complete.'),
          ($1, $2, 3, 'EPIC Card Generated & Delivered', 'Hello {party_name}, your Voter ID card is ready!')
      `, [owner.business_id, serviceId]);
    } else {
      serviceId = jobTypeRes.rows[0].id;
      console.log(`Found existing job type: ${jobTypeRes.rows[0].name} (${serviceId})`);
    }

    // 3. Create an invoice with this job type via create_invoice RPC
    console.log('Calling create_invoice with Job Type item...');
    const invoicePayload = {
      invoice_date: new Date().toISOString().split('T')[0],
      discount_type: 'NONE',
      discount_value: 0,
      walk_in: {
        name: 'Suresh Kumar',
        mobile: '9876543210',
      },
      items: [
        {
          service_id: serviceId,
          description: 'Voter ID Application',
          quantity: 1,
          rate: 250,
          is_job: true,
          applicant_name: 'Suresh Kumar (Self)',
        },
      ],
      paid: {
        amount: 250,
        mode: 'UPI',
      },
    };

    const invRes = await client.query(`SELECT public.create_invoice($1::jsonb) as inv`, [JSON.stringify(invoicePayload)]);
    const rawInv = typeof invRes.rows[0].inv === 'string' ? JSON.parse(invRes.rows[0].inv) : invRes.rows[0].inv;
    const invoiceId = rawInv.invoice_id || rawInv.id;
    const invoiceNumber = rawInv.invoice_number || rawInv.number;
    console.log(`✓ Invoice created: #${invoiceNumber} (ID: ${invoiceId})`);

    // 4. Verify job was auto-created
    const jobRes = await client.query(`
      SELECT j.*, COUNT(js.id) as step_count 
      FROM public.jobs j 
      LEFT JOIN public.job_steps js ON js.job_id = j.id 
      WHERE j.invoice_id = $1 
      GROUP BY j.id
    `, [invoiceId]);

    if (jobRes.rows.length === 0) {
      throw new Error('❌ Job was NOT created for invoice ' + invoiceId);
    }
    const job = jobRes.rows[0];
    console.log(`✓ Job successfully created! Job ID: ${job.id}`);
    console.log(`  Job Type: ${job.job_type_name}`);
    console.log(`  Party: ${job.party_name} (${job.party_mobile})`);
    console.log(`  Applicant: ${job.applicant_name}`);
    console.log(`  Deadline Date: ${job.deadline_date}`);
    console.log(`  Steps Snapshotted: ${job.step_count}`);

    // 5. Query list_jobs with FIFO Queue order
    const listRes = await client.query(`
      SELECT public.list_jobs('CURRENT', NULL, NULL, 50, 0, 'QUEUE') as result
    `);
    const queueData = listRes.rows[0].result;
    console.log(`✓ list_jobs returned ${queueData.jobs.length} jobs in Current Queue.`);
    console.log(`  Tab counts:`, queueData.tab_counts);
    const foundInQueue = queueData.jobs.find((j: any) => j.id === job.id);
    if (!foundInQueue) {
      throw new Error('❌ Newly created job not found in list_jobs queue!');
    }
    console.log(`✓ Found newly created job in Work Queue!`);
    console.log(`  Queue Next Step: "${foundInQueue.next_step_name}"`);
    console.log(`  Progress: ${foundInQueue.progress_percent}% (${foundInQueue.ticked_steps}/${foundInQueue.total_steps})`);

    // 6. Test tick_step
    const firstStepRes = await client.query(`
      SELECT id, name FROM public.job_steps WHERE job_id = $1 ORDER BY position ASC LIMIT 1
    `, [job.id]);
    const firstStep = firstStepRes.rows[0];
    console.log(`Ticking first step: "${firstStep.name}" (${firstStep.id})...`);

    await client.query(`SELECT public.tick_step($1)`, [firstStep.id]);
    console.log(`✓ Step ticked successfully!`);

    // Recheck job progress
    const updatedJobRes = await client.query(`
      SELECT public.list_jobs('CURRENT', NULL, NULL, 50, 0, 'QUEUE') as result
    `);
    const updatedFound = updatedJobRes.rows[0].result.jobs.find((j: any) => j.id === job.id);
    console.log(`✓ Updated Progress in Queue: ${updatedFound.progress_percent}% (${updatedFound.ticked_steps}/${updatedFound.total_steps})`);
    console.log(`  Next pending step: "${updatedFound.next_step_name}"`);

    console.log('\n🎉 ALL E2E JOB CREATION & QUEUE TESTS PASSED WITH 100% SUCCESS!');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
