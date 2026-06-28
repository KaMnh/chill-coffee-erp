-- 2026-06-28 — Đóng ca cưỡng bức (huỷ ca treo không lương) + dọn ca khi xoá TK
-- =============================================================================
-- Áp cho DB đã chạy bản trước (idempotent: create or replace + revoke/grant).
-- Mỗi function body Ở ĐÂY phải BYTE-IDENTICAL với canonical trong
-- database/002_functions.sql (block CANCEL-SHIFT-BEGIN..END). Migration tự đứng độc lập.
--
-- Nội dung:
--   1) _force_cancel_shift            — helper: set cancelled + check_out_at + audit reason.
--   2) cancel_shift_assignment        — authenticated, gate owner/manager (UI).
--   3) cancel_open_shifts_for_employee — service-role-only (route DELETE tài khoản).

create or replace function public._force_cancel_shift(
  p_shift_id uuid, p_reason text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_role text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Phải nhập lý do huỷ ca.';
  end if;
  if length(p_reason) > 500 then
    raise exception 'Lý do huỷ ca vượt 500 ký tự.';
  end if;

  update public.shift_assignments
     set status = 'cancelled', check_out_at = now(), updated_by = p_actor
   where id = p_shift_id and status = 'checked_in'
   returning employee_id into v_employee;
  if not found then
    raise exception 'Ca không tồn tại hoặc đã đóng.';
  end if;

  select name into v_name from public.employees where id = v_employee;

  v_role := coalesce(
    (select role from public.employee_accounts where auth_user_id = p_actor and status = 'active' limit 1),
    public.app_role());
  insert into public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, diff_json)
  values (p_actor, v_role, 'shift_assignments.cancel', 'shift_assignments', p_shift_id,
          jsonb_build_object('reason', p_reason, 'status', 'cancelled'));

  return jsonb_build_object('shift_assignment_id', p_shift_id, 'employee_name', v_name, 'status', 'cancelled');
end; $$;
revoke execute on function public._force_cancel_shift(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.cancel_shift_assignment(p_shift_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được huỷ ca.';
  end if;
  return public._force_cancel_shift(p_shift_id, p_reason, auth.uid());
end; $$;
-- Thu hồi PUBLIC mặc định rồi cấp lại authenticated → bề mặt gọi đúng (Codex):
revoke execute on function public.cancel_shift_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_shift_assignment(uuid, text) to authenticated;

create or replace function public.cancel_open_shifts_for_employee(
  p_employee_id uuid, p_reason text, p_actor uuid
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_id uuid; v_count integer := 0; v_ids jsonb := '[]'::jsonb;
begin
  for v_id in
    select id from public.shift_assignments
     where employee_id = p_employee_id and status = 'checked_in'
     order by check_in_at
  loop
    perform public._force_cancel_shift(v_id, p_reason, p_actor);
    v_count := v_count + 1;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  return jsonb_build_object('cancelled_count', v_count, 'shift_ids', v_ids);
end; $$;
revoke execute on function public.cancel_open_shifts_for_employee(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_open_shifts_for_employee(uuid, text, uuid) to service_role;
