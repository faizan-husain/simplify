import { Client } from 'pg';

async function verifyUnifiedBilling() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin',
    database: 'simplify_dev',
  });
  await client.connect();

  const owner = await client.query(
    "SELECT auth_user_id, email, business_id FROM auth.users u JOIN members m ON m.auth_user_id = u.id WHERE m.role = 'OWNER' LIMIT 1"
  );
  const bizId = owner.rows[0].business_id;
  const ownerEmail = owner.rows[0].email;
  await client.end();

  // Login via bridge
  const loginRes = await fetch('http://127.0.0.1:54321/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ownerEmail, password: 'password123' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.access_token;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  console.log('\n======================================================');
  console.log('--- TESTING UNIFIED BILL ENTRY WITH PARTICULAR & JOBS ---');
  console.log('======================================================');

  const invoicePayload = {
    payload: {
      invoice_date: '2026-10-28',
      due_date: '2026-10-28',
      discount_type: 'NONE',
      discount_value: 0,
      walk_in: {
        name: 'Dinesh Kumar Sharma',
        mobile: '9812345678',
      },
      paid: {
        amount: 1550,
        mode: 'UPI',
      },
      notes: 'Testing unified bill entry with Particular and Create Job checkbox',
      items: [
        {
          description: 'Driving Licence Renewal',
          applicant_name: 'Dinesh Sharma HMV License Renewal', // Particular field
          quantity: 1,
          rate: 1500,
          is_job: true, // Default checked true -> MUST CREATE JOB IN QUEUE
        },
        {
          description: 'Aadhaar Print & Lamination',
          applicant_name: 'Glossy Laminated Card', // Particular field
          quantity: 1,
          rate: 50,
          is_job: false, // User unchecked -> MUST NOT CREATE JOB
        },
      ],
    },
  };

  const invRes = await fetch('http://127.0.0.1:54321/rest/v1/rpc/create_invoice', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(invoicePayload),
  });

  const invData = await invRes.json();
  console.log('Invoice creation HTTP status:', invRes.status);
  if (!invRes.ok) {
    console.error('Invoice creation failed:', invData);
    process.exit(1);
  }

  console.log(`Invoice created: Number = ${invData.number}, Total = Rs ${invData.total}`);

  // Fetch created jobs from list_jobs
  const jobsRes = await fetch('http://127.0.0.1:54321/rest/v1/rpc/list_jobs', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      p_tab: 'CURRENT',
      p_sort: 'QUEUE',
      p_limit: 100,
      p_offset: 0,
    }),
  });

  const jobsData = await jobsRes.json();
  const jobsList = jobsData.jobs || [];
  const matchedJob = jobsList.find((j: any) => j.invoice_id === invData.id);

  if (!matchedJob) {
    throw new Error('Verification failed: Job was not created in the queue!');
  }

  console.log('\n--- VERIFYING JOB DETAILS IN QUEUE ---');
  console.log(`Job ID: ${matchedJob.id}`);
  console.log(`Job Type / Service: ${matchedJob.job_type_name}`);
  console.log(`Customer: ${matchedJob.party_name} (${matchedJob.party_mobile})`);
  console.log(`Particular: ${matchedJob.applicant_name}`);

  if (matchedJob.applicant_name !== 'Dinesh Sharma HMV License Renewal') {
    throw new Error(`Verification failed: Expected Particular 'Dinesh Sharma HMV License Renewal' but got '${matchedJob.applicant_name}'`);
  }

  // Verify that ONLY 1 job was created for this invoice (since item 2 had is_job: false)
  const allJobsForInvoice = jobsList.filter((j: any) => j.invoice_id === invData.id);
  console.log(`Jobs created for this invoice: ${allJobsForInvoice.length} (Expected: 1)`);
  if (allJobsForInvoice.length !== 1) {
    throw new Error(`Verification failed: Expected exactly 1 job, but found ${allJobsForInvoice.length}`);
  }

  console.log('\n======================================================');
  console.log(' ALL VERIFICATIONS PASSED 100%! UNIFIED BILLING WORKS PERFECTLY!');
  console.log('======================================================\n');
}

verifyUnifiedBilling().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
