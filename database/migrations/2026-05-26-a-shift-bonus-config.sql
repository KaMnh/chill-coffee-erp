-- 2026-05-26-a-shift-bonus-config.sql
-- Add `shift_bonus_config` app_settings key + update RPC.
-- Mục đích: khi nhân viên check-out, modal pre-fill "Bồi dưỡng" theo config
-- (threshold giờ + tiền thưởng cố định). User vẫn có thể override.

insert into public.app_settings (key, value, is_public)
values (
  'shift_bonus_config',
  '{"threshold_hours": 7, "bonus_amount": 10000}'::jsonb,
  true
)
on conflict (key) do nothing;

create or replace function public.update_shift_bonus_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.app_is_owner_manager() then
    raise exception 'Bạn không có quyền cập nhật cấu hình bồi dưỡng.';
  end if;

  if jsonb_typeof(p_config) <> 'object'
     or not (p_config ? 'threshold_hours')
     or not (p_config ? 'bonus_amount')
     or (p_config->>'threshold_hours')::numeric < 0
     or (p_config->>'bonus_amount')::numeric < 0 then
    raise exception 'Cấu hình bồi dưỡng không hợp lệ.';
  end if;

  insert into public.app_settings (key, value, is_public, updated_by)
  values ('shift_bonus_config', p_config, true, auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        is_public = true,
        updated_by = auth.uid(),
        updated_at = now();

  return p_config;
end;
$$;

grant execute on function public.update_shift_bonus_config(jsonb) to authenticated;
