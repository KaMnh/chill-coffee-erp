-- =============================================================================
-- pgTAP — RLS period_closes: owner-read, no-direct-write, non-owner RPC chặn
-- (khuôn SET LOCAL ROLE / RESET ROLE theo 070_rls_safe_tables.sql)
-- 5 assertions:
--   1. owner SELECT thấy kỳ vừa tạo (>= 1 dòng)
--   2. staff SELECT được 0 dòng (RLS)
--   3. owner INSERT trực tiếp bị chặn (with check false)
--   4. staff gọi list_period_closes bị raise
--   5. staff gọi void_period_close bị raise
-- =============================================================================
begin;
select plan(5);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner_rls@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'staff_rls@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'OwnerRls'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'StaffRls');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner', 'active'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'staff_operator', 'active');

-- Fixture chạy với role superuser (act_as chỉ set claims cho app_role()).
select pg_temp.act_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select public.safe_adjust('cash', 1000000, 'fixture rls 293');
create temp table _rls_k as select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 0, 'rls fixture') as r;

-- 1. owner đọc được (qua RLS thật)
select pg_temp.act_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
set local role authenticated;
select cmp_ok((select count(*) from public.period_closes), '>=', 1::bigint,
  '1. owner doc duoc period_closes');
reset role;

-- 2. staff đọc 0 dòng
select pg_temp.act_as('ffffffff-ffff-ffff-ffff-ffffffffffff');
set local role authenticated;
select is((select count(*) from public.period_closes), 0::bigint,
  '2. staff doc 0 dong (RLS)');
reset role;

-- 3. insert trực tiếp bị chặn kể cả owner (with check false)
select pg_temp.act_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
set local role authenticated;
select throws_like(
  $q$ insert into public.period_closes (close_date, period_start, period_end)
      values (current_date, current_date, current_date) $q$,
  '%row-level security%', '3. insert truc tiep bi chan ke ca owner');
reset role;

-- 4..5 RPC guard theo app_role() (security definer — không cần đổi role)
select pg_temp.act_as('ffffffff-ffff-ffff-ffff-ffffffffffff');
select throws_like($q$ select public.list_period_closes() $q$,
  '%owner%', '4. staff bi chan list_period_closes');
select throws_like(
  $q$ select public.void_period_close((((select r from _rls_k) ->> 'id')::uuid), 'staff thu huy ky') $q$,
  '%owner%', '5. staff bi chan void_period_close');

select * from finish();
rollback;
