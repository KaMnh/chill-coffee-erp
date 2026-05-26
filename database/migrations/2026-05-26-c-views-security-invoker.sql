-- 2026-05-26-c-views-security-invoker.sql
-- Fix Supabase linter ERROR security_definer_view cho 6 views (public schema).
--
-- ALTER chỉ đổi 1 reloption — không đụng view definition, không đụng data.
-- Sau khi áp:
--   - Direct caller (anon/authenticated qua PostgREST) sẽ chạy view với JWT
--     của họ → RLS của underlying tables (sales_orders, cash_*, etc.) áp đúng.
--   - RPC `get_cash_close_report`/`get_cash_close_reports_by_date` vẫn hoạt
--     động vì chính RPC có `security definer` → chạy như postgres, view bên
--     trong RPC vẫn bypass RLS như cũ.
--
-- Idempotent: nếu reloption đã =true, ALTER no-op.
-- Reversible: `ALTER VIEW ... SET (security_invoker = false);` để rollback từng view.

alter view public.daily_product_summary_view     set (security_invoker = true);
alter view public.product_sales_hourly_view      set (security_invoker = true);
alter view public.cash_drawer_timeline_view      set (security_invoker = true);
alter view public.cash_reconciliation_input_view set (security_invoker = true);
alter view public.daily_cash_summary_view        set (security_invoker = true);
alter view public.daily_cash_close_report_view   set (security_invoker = true);
