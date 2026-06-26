-- =============================================================================
-- Migration: mở view "Chấm công" (checkin) cho manager + staff_operator
-- Spec: docs/superpowers/specs/2026-06-26-attendance-rbac-selfcheckin-design.md (Phase 1)
-- =============================================================================
-- Phase 1: mọi cấp DƯỚI owner (manager, staff_operator, employee_self_service)
-- đều tự chấm công. Code đã mở NAV_ITEMS["checkin"].roles + DEFAULT_SIDEBAR_BY_ROLE
-- cho manager/staff_operator.
--
-- Data-fix (CHỈ DB cũ): sidebar_defaults / sidebar_config đã LƯU qua Settings là
-- danh sách ĐÓNG — view 'checkin' sẽ bị ẩn vĩnh viễn với manager/staff_operator
-- nếu không chèn. Append cuối mảng là đủ: getVisibleNav render theo thứ tự
-- NAV_ITEMS canonical, không theo thứ tự mảng lưu. Idempotent (guard `not ? 'checkin'`).
-- (DB mới không có row sidebar_defaults → fallback DEFAULT_SIDEBAR_BY_ROLE đã chứa key.)
--
-- KHÔNG đụng owner (owner KHÔNG tự chấm công — quyết định thiết kế) và KHÔNG đụng
-- employee_self_service (đã có 'checkin').
-- =============================================================================

-- app_settings.sidebar_defaults: manager
update public.app_settings
   set value = jsonb_set(value, '{manager}', (value -> 'manager') || '"checkin"'::jsonb)
 where key = 'sidebar_defaults'
   and jsonb_typeof(value -> 'manager') = 'array'
   and not (value -> 'manager') ? 'checkin';

-- app_settings.sidebar_defaults: staff_operator
update public.app_settings
   set value = jsonb_set(value, '{staff_operator}', (value -> 'staff_operator') || '"checkin"'::jsonb)
 where key = 'sidebar_defaults'
   and jsonb_typeof(value -> 'staff_operator') = 'array'
   and not (value -> 'staff_operator') ? 'checkin';

-- profiles.sidebar_config: mọi account role manager / staff_operator đã lưu config
update public.profiles p
   set sidebar_config = p.sidebar_config || '"checkin"'::jsonb
  from public.employee_accounts ea
 where ea.auth_user_id = p.id
   and ea.role in ('manager', 'staff_operator')
   and p.sidebar_config is not null
   and jsonb_typeof(p.sidebar_config) = 'array'
   and not p.sidebar_config ? 'checkin';
