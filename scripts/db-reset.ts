import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';

export async function resetDatabase(targetDb = DB_NAME) {
  // 1. Connect to default postgres DB to drop/recreate target database
  const rootClient = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: 'postgres',
  });

  await rootClient.connect();
  try {
    // Terminate existing connections to targetDb
    await rootClient.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid();
    `, [targetDb]);

    await rootClient.query(`DROP DATABASE IF EXISTS ${targetDb};`);
    await rootClient.query(`CREATE DATABASE ${targetDb};`);
  } finally {
    await rootClient.end();
  }

  // 2. Connect to the target DB and initialize environment + migrations
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: targetDb,
  });

  await client.connect();
  try {
    // Ensure Supabase standard roles exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN;
        END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
    `);

    // Enable extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // Ensure auth schema exists (mimicking Supabase Auth for local test/dev)
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE,
        encrypted_password text,
        email_confirmed_at timestamptz DEFAULT now(),
        raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      -- Supabase mock auth.uid() function
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;

      -- Supabase mock auth.role() function
      CREATE OR REPLACE FUNCTION auth.role()
      RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
      $$ LANGUAGE sql STABLE;
    `);

    // 3. Run all migrations in /supabase/migrations
    const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        console.log(`Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
      }

      await client.query(`
        GRANT USAGE ON SCHEMA public, app, auth TO authenticated;
        GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
        GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, app TO authenticated;
      `);
    }

    console.log(`Database ${targetDb} reset and migrations applied successfully.`);
  } finally {
    await client.end();
  }
}

if (require.main === module || process.argv[1]?.endsWith('db-reset.ts')) {
  resetDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error during db reset:', err);
      process.exit(1);
    });
}
