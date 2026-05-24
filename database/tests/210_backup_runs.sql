-- =============================================================================
-- pgTAP: backup_runs table schema + RLS invariants
-- =============================================================================
begin;
select plan(11);

-- Existence
select has_table('public', 'backup_runs', 'backup_runs table exists');
select has_column('public', 'backup_runs', 'id', 'has id column');
select has_column('public', 'backup_runs', 'kind', 'has kind column');
select has_column('public', 'backup_runs', 'status', 'has status column');
select has_column('public', 'backup_runs', 'log_text', 'has log_text column');

-- Types
select col_type_is('public', 'backup_runs', 'id', 'uuid', 'id is uuid');
select col_type_is('public', 'backup_runs', 'byte_size', 'bigint', 'byte_size is bigint');

-- CHECK constraints (validate kind + status enums)
prepare bad_kind as
  insert into public.backup_runs (kind, status) values ('invalid', 'running');
select throws_ok('bad_kind', '23514', null, 'kind CHECK rejects invalid value');

prepare bad_status as
  insert into public.backup_runs (kind, status) values ('backup', 'pending');
select throws_ok('bad_status', '23514', null, 'status CHECK rejects invalid value');

-- Indexes
select has_index('public', 'backup_runs', 'backup_runs_started_idx', 'started_at index exists');

-- RLS
select policies_are('public', 'backup_runs',
  array['backup_runs_owner_read'],
  'owner_read policy exists');

select * from finish();
rollback;
