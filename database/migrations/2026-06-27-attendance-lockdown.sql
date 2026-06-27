-- =============================================================================
-- 2026-06-27 — Attendance Lockdown Phase 2b
-- =============================================================================
-- Mục tiêu (đối chiếu canonical 002_functions.sql + 003_rls.sql, dual-write byte-identical):
--   1. app_is_owner() helper — gate owner-only.
--   2. Khóa 3 RPC chấm công thủ công về OWNER-ONLY:
--        check_in_employee / check_out_employee / edit_shift_payroll_record.
--   3. Bỏ TẤT CẢ direct-write RLS trên shift_assignments + shift_payroll_records
--      (Codex #1): mọi write chỉ qua security-definer RPC. Read policy GIỮ NGUYÊN.
--   4. _audit_attendance_change() — audit trail actor-aware (Codex #2): coalesce
--      auth.uid() → created_by/updated_by/edited_by để self check-in/out (chạy bằng
--      service_role, auth.uid() null) vẫn ghi đúng actor. Gắn vào 2 trigger
--      audit_shift_assignments + audit_payroll.
--
-- Self-standing: chứa FULL body các function (không chỉ dòng đổi). Throwaway DB
-- runner áp dụng file này SAU 001/002/003 → create-or-replace ghi đè bản canonical.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 2 — app_is_owner() helper
-- ---------------------------------------------------------------------------
create or replace function public.app_is_owner()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select public.app_role() = 'owner'; $$;
