-- =============================================================================
-- 2026-06-25 — Employee login self-check-in
-- Cổng kép: danh tính (phiên đăng nhập) + IP công cộng quán (anchor tươi).
-- Spec:  docs/superpowers/specs/2026-06-25-employee-login-self-checkin-design.md
-- Plan:  docs/superpowers/plans/2026-06-25-employee-login-self-checkin.md (Task 4)
--
-- Idempotent (create or replace / if not exists / do $$ … $$). Các khối preflight
-- (c),(d) FAIL-FAST: raise exception nếu còn trùng không thể dọn — vì check_in_self
-- phụ thuộc unique index, deploy thiếu index = mọi check-in lỗi.
--
-- Dual-write byte-identical: mỗi khối dưới đây trùng khít với canonical file tương
-- ứng (001/002/003/004). Apply order vẫn 001 → 002 → 003 → 004 trên DB sạch;
-- migration này nâng cấp một DB đang chạy.
-- =============================================================================

-- (a) Named role CHECK constraint — thêm 'employee_self_service' (idempotent).
--     Dò theo CỘT role (conkey → pg_attribute) nên không phụ thuộc cách Postgres
--     render định nghĩa (in (...) vs = ANY (ARRAY[...])). Bỏ qua nếu constraint
--     hiện tại đã cho phép role mới (rerun an toàn / DB đã có named constraint).
do $$
declare v_name text; v_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
  from pg_constraint c
  where c.conrelid = 'public.employee_accounts'::regclass and c.contype = 'c'
    and c.conkey = array[
      (select attnum from pg_attribute
        where attrelid = 'public.employee_accounts'::regclass and attname = 'role')
    ];
  if v_name is not null and position('employee_self_service' in v_def) = 0 then
    execute format('alter table public.employee_accounts drop constraint %I', v_name);
    v_name := null;
  end if;
  if v_name is null then
    alter table public.employee_accounts add constraint employee_accounts_role_check
      check (role in ('owner','manager','staff_operator','employee_viewer','employee_self_service'));
  end if;
end $$;

-- (b) shift_assignments: dấu IP + thiết bị cho mỗi check-in.
alter table public.shift_assignments add column if not exists check_in_ip inet;
alter table public.shift_assignments add column if not exists check_in_user_agent text;

-- (c) FAIL-FAST preflight + partial unique index trên ca đang mở.
do $$
declare v_dupe int;
begin
  delete from public.shift_assignments sa using (
    select id, row_number() over (
      partition by employee_id, business_date
      order by check_in_at asc nulls first, created_at asc, id asc) rn
    from public.shift_assignments where status = 'checked_in'
  ) d
  where sa.id = d.id and d.rn > 1
    and not exists (select 1 from public.shift_payroll_records p where p.shift_assignment_id = sa.id);
  select count(*) into v_dupe from (
    select employee_id, business_date from public.shift_assignments
    where status = 'checked_in' group by employee_id, business_date having count(*) > 1
  ) x;
  if v_dupe > 0 then
    raise exception 'Khong the tao unique index open-shift: con % nhom trung co payroll. Don tay roi chay lai.', v_dupe;
  end if;
  create unique index if not exists shift_assignments_one_open_per_day
    on public.shift_assignments (employee_id, business_date) where status = 'checked_in';
end $$;

-- (d) FAIL-FAST preflight + unique employee_accounts.employee_id.
do $$
declare v_dupe int;
begin
  -- reconcile payroll-free duplicate accounts is unsafe (accounts ≠ shifts); fail-fast on ANY dup.
  select count(*) into v_dupe from (
    select employee_id from public.employee_accounts where employee_id is not null
    group by employee_id having count(*) > 1
  ) x;
  if v_dupe > 0 then
    raise exception 'Khong the tao unique employee_id: % nhan vien co >1 tai khoan. Don tay roi chay lai.', v_dupe;
  end if;
  create unique index if not exists employee_accounts_one_account_per_employee
    on public.employee_accounts (employee_id) where employee_id is not null;
end $$;

-- (e) checkin_anchor table.
create table if not exists public.checkin_anchor (
  id uuid primary key default gen_random_uuid(), label text not null,
  device_token_hash text not null, current_public_ip inet, last_heartbeat_at timestamptz,
  is_active boolean not null default true, created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists checkin_anchor_active_idx on public.checkin_anchor(is_active) where is_active;
drop trigger if exists checkin_anchor_set_updated_at on public.checkin_anchor;
create trigger checkin_anchor_set_updated_at before update on public.checkin_anchor
  for each row execute function public.set_updated_at();

-- (f) Settings seed (enabled:false = feature OFF/503 until owner configures).
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"enabled": false, "reject_message": "Chỉ chấm công được khi ở tại quán (nối wifi quán).", "grace_hours": 12}'::jsonb, false)
on conflict (key) do nothing;

-- (g) check_in_self — SERVICE-ROLE-ONLY (route đã verify JWT → trusted p_auth_user_id).
create or replace function public.check_in_self(p_auth_user_id uuid, p_ip inet, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_employee uuid; v_name text; v_id uuid; v_already boolean := false; v_check_in timestamptz := now(); v_date date := current_date;
begin
  if p_auth_user_id is null then raise exception 'Thiếu danh tính.'; end if;
  select ea.employee_id, e.name into v_employee, v_name
    from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
    where ea.auth_user_id = p_auth_user_id and ea.status = 'active' limit 1;
  if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;
  insert into public.shift_assignments
    (employee_id, business_date, check_in_at, status, created_by, updated_by, check_in_ip, check_in_user_agent)
  values (v_employee, v_date, v_check_in, 'checked_in', p_auth_user_id, p_auth_user_id, p_ip, p_user_agent)
  on conflict (employee_id, business_date) where status = 'checked_in' do nothing
  returning id into v_id;
  if v_id is null then
    v_already := true;
    select id into v_id from public.shift_assignments
      where employee_id = v_employee and business_date = v_date and status = 'checked_in'
      order by check_in_at desc limit 1;
  end if;
  select check_in_at into v_check_in from public.shift_assignments where id = v_id;
  return jsonb_build_object('shift_assignment_id', v_id, 'employee_name', v_name, 'check_in_at', v_check_in, 'already_checked_in', v_already);
end; $$;
revoke execute on function public.check_in_self(uuid, inet, text) from public, anon, authenticated;
grant execute on function public.check_in_self(uuid, inet, text) to service_role;

-- (h) get_my_checkin_status — authenticated, đọc của CHÍNH caller.
create or replace function public.get_my_checkin_status()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_employee uuid; v_name text; v_in timestamptz; v_found boolean;
begin
  select ea.employee_id, e.name into v_employee, v_name
    from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
    where ea.auth_user_id = auth.uid() and ea.status = 'active' limit 1;
  if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;
  select check_in_at into v_in from public.shift_assignments
    where employee_id = v_employee and business_date = current_date and status = 'checked_in'
    order by check_in_at desc limit 1;
  v_found := found;
  return jsonb_build_object('employee_name', v_name, 'checked_in_today', v_found, 'check_in_at', case when v_found then v_in else null end);
end; $$;

-- (i) Anchor RPCs — owner-only (inlined, no external reference).
create or replace function public.add_shop_anchor(p_label text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v public.checkin_anchor%rowtype;
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cấu hình thiết bị quán.'; end if;
  if p_label is null or length(btrim(p_label)) = 0 then raise exception 'Nhãn thiết bị trống.'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'Token thiết bị không hợp lệ.'; end if;
  insert into public.checkin_anchor (label, device_token_hash, is_active, created_by)
  values (btrim(p_label), lower(p_token_hash), true, auth.uid()) returning * into v;
  return jsonb_build_object('id', v.id, 'label', v.label, 'is_active', v.is_active);
end; $$;

create or replace function public.remove_shop_anchor(p_anchor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cấu hình thiết bị quán.'; end if;
  delete from public.checkin_anchor where id = p_anchor_id;
  return jsonb_build_object('removed', p_anchor_id);
end; $$;

create or replace function public.record_shop_anchor_heartbeat(p_anchor_id uuid, p_public_ip inet)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v public.checkin_anchor%rowtype;
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cập nhật thiết bị quán.'; end if;
  update public.checkin_anchor set current_public_ip = p_public_ip, last_heartbeat_at = now()
   where id = p_anchor_id returning * into v;
  if not found then raise exception 'Không tìm thấy thiết bị quán.'; end if;
  return jsonb_build_object('id', v.id, 'current_public_ip', host(v.current_public_ip), 'last_heartbeat_at', v.last_heartbeat_at);
end; $$;

create or replace function public.update_checkin_network_config(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cập nhật cấu hình check-in.'; end if;
  if jsonb_typeof(p_config) <> 'object' or not (p_config ? 'enabled') or not (p_config ? 'reject_message')
     or not (p_config ? 'grace_hours') or jsonb_typeof(p_config->'enabled') <> 'boolean'
     or (p_config->>'grace_hours')::numeric < 0 then raise exception 'Cấu hình check-in không hợp lệ.'; end if;
  -- R7/C3 guard: cannot enable until at least one active anchor has a non-null IP.
  if (p_config->>'enabled')::boolean = true
     and not exists (select 1 from public.checkin_anchor where is_active and current_public_ip is not null) then
    raise exception 'Chưa có thiết bị quán nào có IP — không thể bật cổng check-in.';
  end if;
  insert into public.app_settings (key, value, is_public, updated_by)
  values ('checkin_network', p_config, false, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = false, updated_by = auth.uid(), updated_at = now();
  return p_config;
end; $$;

-- (i-bis) fresh_anchor_ips — SERVICE-ROLE-ONLY read; freshness computed in Postgres (R7/S9/N3).
create or replace function public.fresh_anchor_ips(p_grace_hours numeric)
returns setof text language sql security definer set search_path = public, auth as $$
  select host(current_public_ip) from public.checkin_anchor
  where is_active and current_public_ip is not null
    and last_heartbeat_at > now() - make_interval(hours => greatest(0, p_grace_hours)::int);
$$;
revoke execute on function public.fresh_anchor_ips(numeric) from public, anon, authenticated;
grant execute on function public.fresh_anchor_ips(numeric) to service_role;

-- (j) RLS + grants ------------------------------------------------------------
-- (j.1) Re-assert service-role-only for both lock-down functions (after blanket grant).
revoke execute on function public.check_in_self(uuid, inet, text) from public, anon, authenticated;
grant execute on function public.check_in_self(uuid, inet, text) to service_role;
revoke execute on function public.fresh_anchor_ips(numeric) from public, anon, authenticated;
grant execute on function public.fresh_anchor_ips(numeric) to service_role;

-- (j.2) checkin_anchor owner-only RLS.
alter table public.checkin_anchor enable row level security;
drop policy if exists checkin_anchor_owner_read on public.checkin_anchor;
create policy checkin_anchor_owner_read on public.checkin_anchor for select
  using (public.app_role() = 'owner');
drop policy if exists checkin_anchor_no_direct_write on public.checkin_anchor;
create policy checkin_anchor_no_direct_write on public.checkin_anchor
  for all to authenticated using (false) with check (false);

-- (j.3) Operational-table lockdown (C5/R5): exclude employee_self_service.
drop policy if exists ingredients_select_all on public.ingredients;
create policy ingredients_select_all on public.ingredients for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
drop policy if exists menu_items_select_all on public.menu_items;
create policy menu_items_select_all on public.menu_items for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
drop policy if exists recipes_select_all on public.recipes;
create policy recipes_select_all on public.recipes for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
drop policy if exists recipe_items_select_all on public.recipe_items;
create policy recipe_items_select_all on public.recipe_items for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
drop policy if exists stock_movements_select_all on public.stock_movements;
create policy stock_movements_select_all on public.stock_movements for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));

-- (j.4) Explicit grants for authenticated, app_role-gated RPCs (migration-only:
--       canonical 003 re-grants all via the blanket grant on line 57).
grant execute on function public.add_shop_anchor(text, text) to authenticated;
grant execute on function public.remove_shop_anchor(uuid) to authenticated;
grant execute on function public.record_shop_anchor_heartbeat(uuid, inet) to authenticated;
grant execute on function public.update_checkin_network_config(jsonb) to authenticated;
grant execute on function public.get_my_checkin_status() to authenticated;
