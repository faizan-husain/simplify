import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { resetDatabase } from './db-reset';

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';

async function runTests() {
  console.log('--- Resetting Database & Running Migrations ---');
  await resetDatabase();

  console.log('--- Running Database Tests ---');
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  await client.connect();
  let hasFailures = false;

  try {
    // 1. Install pgTAP compatibility
    const compatSql = fs.readFileSync(path.resolve(__dirname, '../supabase/tests/pgtap_compat.sql'), 'utf8');
    await client.query(compatSql);

    // 2. Run all test files
    const testsDir = path.resolve(__dirname, '../supabase/tests');
    const files = fs.readdirSync(testsDir)
      .filter(f => f.endsWith('.sql') && f !== 'pgtap_compat.sql')
      .sort();

    if (files.length === 0) {
      console.log('No test files found in supabase/tests.');
      return;
    }

    for (const file of files) {
      console.log(`\n=== Running Test: ${file} ===`);
      const testSql = fs.readFileSync(path.join(testsDir, file), 'utf8');

      // Listen for notices from PostgreSQL
      const notices: string[] = [];
      const noticeListener = (msg: any) => {
        if (msg.message) notices.push(msg.message);
      };
      client.on('notice', noticeListener);

      try {
        await client.query(testSql);
        notices.forEach(n => console.log('  ' + n));
        console.log(`PASSED: ${file}`);
      } catch (err: any) {
        notices.forEach(n => console.log('  ' + n));
        console.error(`FAILED: ${file}`);
        console.error('Error message:', err.message);
        hasFailures = true;
      } finally {
        client.removeListener('notice', noticeListener);
      }
    }
  } finally {
    await client.end();
  }

  if (hasFailures) {
    console.error('\n❌ DB Tests Failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All DB Tests Passed!');
  }
}

runTests().catch(err => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
