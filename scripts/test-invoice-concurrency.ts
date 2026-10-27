import { Client } from 'pg';
import { resetDatabase } from './db-reset';

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';

async function testConcurrency() {
  console.log('--- Testing Invoice Concurrency (Gap-free, Race-free) ---');
  await resetDatabase();

  const setupClient = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  await setupClient.connect();
  const userId = '11111111-1111-1111-1111-111111111111';

  try {
    // 1. Setup mock user and business
    await setupClient.query(`INSERT INTO auth.users (id, email) VALUES ($1, '919876543210@simplify.local');`, [userId]);
    await setupClient.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [userId]);
    await setupClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
    await setupClient.query(`SELECT public.register_business('Speed Xerox', 'Suresh', '9876543210');`);
  } finally {
    await setupClient.end();
  }

  // 2. Launch 50 concurrent create_invoice calls
  const CONCURRENT_BILLS = 50;
  console.log(`Firing ${CONCURRENT_BILLS} concurrent create_invoice calls...`);

  const promises = Array.from({ length: CONCURRENT_BILLS }, async (_, idx) => {
    const client = new Client({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
    });
    await client.connect();

    try {
      await client.query(`SET ROLE authenticated;`);
      await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [userId]);
      await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

      const payload = JSON.stringify({
        items: [{ description: `Item ${idx}`, quantity: 1, rate: 10 }],
        paid: { amount: 10, mode: 'CASH' }
      });

      const res = await client.query(`SELECT public.create_invoice($1::jsonb) as inv;`, [payload]);
      return res.rows[0].inv.number as string;
    } finally {
      await client.end();
    }
  });

  const numbers = await Promise.all(promises);

  console.log(`Generated ${numbers.length} invoice numbers.`);

  // 3. Assert uniqueness and gap-free
  const uniqueNumbers = new Set(numbers);
  if (uniqueNumbers.size !== CONCURRENT_BILLS) {
    throw new Error(`Concurrency failed: Expected ${CONCURRENT_BILLS} unique numbers, got ${uniqueNumbers.size}`);
  }

  // Extract numerical parts and verify no gaps
  const seqs = numbers
    .map(n => parseInt(n.replace(/[^0-9]/g, ''), 10))
    .sort((a, b) => a - b);

  for (let i = 0; i < seqs.length; i++) {
    const expected = i + 1;
    if (seqs[i] !== expected) {
      throw new Error(`Gap detected in invoice sequence! Expected ${expected}, got ${seqs[i]}`);
    }
  }

  console.log(`✅ Concurrency test PASSED: ${CONCURRENT_BILLS} invoices generated with strictly unique, gap-free numbers: ${seqs[0]}..${seqs[seqs.length - 1]}`);
}

testConcurrency().catch(err => {
  console.error('❌ Concurrency test failed:', err);
  process.exit(1);
});
