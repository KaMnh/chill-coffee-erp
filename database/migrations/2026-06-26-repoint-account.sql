-- =============================================================================
-- 2026-06-26 — Re-point account (đổi nhân viên cho tài khoản)
-- Nâng cấp DB đang chạy. Dual-write: định nghĩa hàm TRÙNG KHÍT database/002_functions.sql;
-- re-assert lock-down TRÙNG database/003_rls.sql. Idempotent (create or replace + revoke/grant).
-- Spec: docs/superpowers/specs/2026-06-26-repoint-account-design.md
-- =============================================================================

create or replace function public.repoint_account(
  p_auth_user_id uuid,
  p_target_employee_id uuid,
  p_expected_source_employee_id uuid
)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_source uuid;
  v_target_name text;
  v_target_active boolean;
  v_updated int;
begin
  if p_auth_user_id is null or p_target_employee_id is null or p_expected_source_employee_id is null then
    raise exception 'Thiếu tham số.' using errcode = 'P0001';
  end if;

  select employee_id into v_source
    from public.employee_accounts
    where auth_user_id = p_auth_user_id
    for update;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'P0002';
  end if;
  if v_source is null then
    raise exception 'Tài khoản chưa gắn nhân viên — dùng chức năng liên kết.' using errcode = 'P0001';
  end if;
  if v_source = p_target_employee_id then
    raise exception 'Tài khoản đã gắn đúng nhân viên này rồi.' using errcode = 'P0001';
  end if;

  select name, is_active into v_target_name, v_target_active
    from public.employees where id = p_target_employee_id;
  if not found or v_target_active is not true then
    raise exception 'Nhân viên đích không tồn tại hoặc đã nghỉ.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.employee_accounts where employee_id = p_target_employee_id) then
    raise exception 'Nhân viên đích đã có tài khoản.' using errcode = '23505';
  end if;

  update public.employee_accounts
     set employee_id = p_target_employee_id
   where auth_user_id = p_auth_user_id
     and employee_id = p_expected_source_employee_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Dữ liệu đã thay đổi — tải lại trang rồi thử lại.' using errcode = 'P0001';
  end if;

  update public.employees set is_active = false where id = v_source;

  insert into public.profiles (id, display_name)
  values (p_auth_user_id, v_target_name)
  on conflict (id) do update set display_name = excluded.display_name;

  return jsonb_build_object(
    'auth_user_id', p_auth_user_id,
    'employee_id', p_target_employee_id,
    'source_employee_id', v_source,
    'source_deactivated', true
  );
end; $$;
revoke execute on function public.repoint_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.repoint_account(uuid, uuid, uuid) to service_role;
