-- pgTAP compatibility harness for standard PostgreSQL
CREATE SCHEMA IF NOT EXISTS tap;

CREATE TABLE IF NOT EXISTS tap.test_state (
  total_tests int DEFAULT 0,
  failed_tests int DEFAULT 0,
  plan_count int DEFAULT 0
);

CREATE OR REPLACE FUNCTION tap.reset_state() RETURNS void AS $$
BEGIN
  DELETE FROM tap.test_state;
  INSERT INTO tap.test_state (total_tests, failed_tests, plan_count) VALUES (0, 0, 0);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION plan(tests integer) RETURNS text AS $$
BEGIN
  PERFORM tap.reset_state();
  UPDATE tap.test_state SET plan_count = tests;
  RETURN '1..' || tests::text;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ok(predicate boolean, description text DEFAULT '') RETURNS text AS $$
DECLARE
  v_num int;
  v_res text;
BEGIN
  UPDATE tap.test_state SET total_tests = total_tests + 1 RETURNING total_tests INTO v_num;
  IF predicate IS TRUE THEN
    v_res := 'ok ' || v_num::text || ' - ' || description;
  ELSE
    UPDATE tap.test_state SET failed_tests = failed_tests + 1;
    v_res := 'not ok ' || v_num::text || ' - ' || description;
  END IF;
  RAISE NOTICE '%', v_res;
  RETURN v_res;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is(actual anyelement, expected anyelement, description text DEFAULT '') RETURNS text AS $$
BEGIN
  IF (actual IS NULL AND expected IS NULL) OR (actual = expected) THEN
    RETURN ok(true, description);
  ELSE
    RETURN ok(false, description || ' (expected: ' || COALESCE(expected::text, 'NULL') || ', got: ' || COALESCE(actual::text, 'NULL') || ')');
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION isnt(actual anyelement, expected anyelement, description text DEFAULT '') RETURNS text AS $$
BEGIN
  IF (actual IS NULL AND expected IS NOT NULL) OR (actual IS NOT NULL AND expected IS NULL) OR (actual <> expected) THEN
    RETURN ok(true, description);
  ELSE
    RETURN ok(false, description || ' (expected NOT: ' || COALESCE(expected::text, 'NULL') || ', got: ' || COALESCE(actual::text, 'NULL') || ')');
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION finish() RETURNS text AS $$
DECLARE
  v_total int;
  v_failed int;
  v_plan int;
  v_summary text;
BEGIN
  SELECT total_tests, failed_tests, plan_count INTO v_total, v_failed, v_plan FROM tap.test_state;
  IF v_failed > 0 THEN
    v_summary := 'FAILED: ' || v_failed || ' of ' || v_total || ' tests failed.';
    RAISE NOTICE '%', v_summary;
    RAISE EXCEPTION '%', v_summary;
  ELSE
    v_summary := 'PASSED: all ' || v_total || ' tests passed.';
    RAISE NOTICE '%', v_summary;
  END IF;
  RETURN v_summary;
END;
$$ LANGUAGE plpgsql;
