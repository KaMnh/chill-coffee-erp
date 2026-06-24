-- =============================================================================
-- get_cash_close_reports_by_period RPC (2026-06-24)
--
-- Trả báo cáo chốt két (final + voided) có business_date trong [p_from, p_to].
-- Sort business_date DESC, cùng ngày closed_at DESC (ổn định, tránh tráo
-- final/voided). Cùng shape với get_cash_close_reports_by_date để ReportList
-- tái dùng. Auth: staff trở lên (bám get_cash_close_reports_by_date).
--
-- DUAL-WRITE: function block byte-identical với database/002_functions.sql.
-- Spec: docs/superpowers/specs/2026-06-24-cash-close-daily-reports-design.md
-- =============================================================================

create or replace function public.get_cash_close_reports_by_period(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.business_date desc, r.closed_at desc), '[]'::jsonb)
  from public.daily_cash_close_report_view r
  where r.business_date between p_from and p_to and (public.app_is_owner_manager() or public.app_role() = 'staff_operator');
$$;

grant execute on function public.get_cash_close_reports_by_period(date, date) to authenticated;
