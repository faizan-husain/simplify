-- pgTAP Test: Every public table MUST have Row Level Security (RLS) enabled
SELECT plan(1);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = false
  ),
  0,
  'Every table in public schema must have RLS enabled'
);

SELECT finish();
