-- Media URL rewrite (docs/DEMO_DATA.md §6). Run by import.ts against asifzone_demo_staging ONLY:
--   psql -1 -v ON_ERROR_STOP=1 -v pattern='<regex>' -v target='<demo api origin>/uploads/' -f rewrite-media.sql
--
-- Uploaded images are stored as absolute URLs on the production origin (upload.service.ts bakes API_ORIGIN in). Every
-- text / varchar / json(b) / text[] column of every table is scanned — not a hand-kept list — so a column added later is
-- covered too; matches are pointed at the demo API, which serves the copied files from its own local uploads directory.
SELECT set_config('demo.media_pattern', :'pattern', false), set_config('demo.media_target', :'target', false);

DO $$
DECLARE
  r record;
  pat text := current_setting('demo.media_pattern');
  tgt text := current_setting('demo.media_target');
  n bigint;
  total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.table_name <> '_prisma_migrations'
       AND (c.data_type IN ('text', 'character varying', 'jsonb', 'json') OR c.udt_name IN ('_text', '_varchar'))
  LOOP
    IF r.data_type IN ('text', 'character varying') THEN
      EXECUTE format('UPDATE %I SET %I = regexp_replace(%I, $1, $2, ''g'') WHERE %I ~ $1',
                     r.table_name, r.column_name, r.column_name, r.column_name) USING pat, tgt;
    ELSIF r.data_type IN ('jsonb', 'json') THEN
      EXECUTE format('UPDATE %I SET %I = regexp_replace(%I::text, $1, $2, ''g'')::%s WHERE %I::text ~ $1',
                     r.table_name, r.column_name, r.column_name, r.data_type, r.column_name) USING pat, tgt;
    ELSE
      EXECUTE format('UPDATE %I SET %I = ARRAY(SELECT regexp_replace(x, $1, $2, ''g'') FROM unnest(%I) WITH ORDINALITY u(x, i) ORDER BY i) '
                     'WHERE array_to_string(%I, '' '') ~ $1',
                     r.table_name, r.column_name, r.column_name, r.column_name) USING pat, tgt;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'media: %.% — % row(s)', r.table_name, r.column_name, n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'media: % row(s) rewritten to %', total, tgt;
END
$$;
