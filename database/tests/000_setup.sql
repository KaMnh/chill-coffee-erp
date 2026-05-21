-- Phase 3B.2b.ii.b — pgTAP extension setup.
-- Idempotent: safe to run on a DB that already has pgtap.
-- Runs as the first file in scripts/pgtap-run.mjs iteration.

create extension if not exists pgtap;

-- Sanity probe: emit one TAP line so the runner can confirm the extension is live.
select case
  when (select true from pg_extension where extname = 'pgtap') then '1..1
ok 1 - pgtap extension installed'
  else '1..1
not ok 1 - pgtap extension MISSING after CREATE EXTENSION'
end as tap;
