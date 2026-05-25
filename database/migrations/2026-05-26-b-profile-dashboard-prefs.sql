-- 2026-05-26-b-profile-dashboard-prefs.sql
-- Generic per-user dashboard preferences (JSON). Initial use: stock_sort
-- preference cho card "Tồn kho hiện tại" trên Dashboard.
-- Pattern theo `sidebar_config` đã có sẵn ở profiles.

alter table public.profiles
  add column if not exists dashboard_preferences jsonb default '{}'::jsonb;

create or replace function public.update_user_dashboard_preferences(
  p_profile_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing jsonb;
begin
  -- Cho phép user tự cập nhật prefs của mình; owner/manager có thể chỉnh
  -- prefs của user khác (vd: reset).
  if auth.uid() <> p_profile_id and not public.app_is_owner_manager() then
    raise exception 'Không có quyền cập nhật preferences của user khác.';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch phải là JSON object.';
  end if;

  -- Validate các key biết trước (chỉ stock_sort hiện tại).
  if p_patch ? 'stock_sort' then
    if p_patch->>'stock_sort' is not null
       and (p_patch->>'stock_sort') !~ '^(name|balance|low_stock)\|(asc|desc)$' then
      raise exception 'stock_sort không hợp lệ.';
    end if;
  end if;

  update public.profiles
    set dashboard_preferences = coalesce(dashboard_preferences, '{}'::jsonb) || p_patch,
        updated_at = now()
    where id = p_profile_id
    returning dashboard_preferences into v_existing;

  if v_existing is null then
    raise exception 'Không tìm thấy profile.';
  end if;

  return v_existing;
end;
$$;

grant execute on function public.update_user_dashboard_preferences(uuid, jsonb) to authenticated;
