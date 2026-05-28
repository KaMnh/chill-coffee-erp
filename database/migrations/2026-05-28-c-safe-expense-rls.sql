-- =============================================================================
-- RLS: hide safe-sourced expenses from non-owner roles (2026-05-28)
--
-- Replaces 3 existing policies on public.expenses with case-based logic:
--   - SELECT: safe-sourced rows visible to owner only; manual rows keep
--     existing logic (staff+ OR employee_viewer with date-range permission).
--   - UPDATE: safe-sourced rows mutable by owner only; manual by owner/manager.
--   - DELETE: same as UPDATE.
--
-- INSERT policy unchanged (auto-insert from safe_withdraw_other runs
-- SECURITY DEFINER → bypasses RLS; manual creates from staff+ still allowed).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SELECT: safe-sourced → owner only; manual → existing logic
-- ---------------------------------------------------------------------------
drop policy if exists expenses_staff_read on public.expenses;
create policy expenses_staff_read on public.expenses for select to authenticated using (
  case
    when expenses.safe_transaction_id is not null then
      public.app_role() = 'owner'
    else
      public.app_is_staff_or_above()
      or (
        public.app_role() = 'employee_viewer'
        and exists (
          select 1
          from public.employee_accounts ea
          join public.expense_history_permissions p on p.employee_id = ea.employee_id
          where ea.auth_user_id = auth.uid()
            and expenses.business_date between p.date_from and p.date_to
        )
      )
  end
);

-- ---------------------------------------------------------------------------
-- UPDATE: safe-sourced → owner only; manual → owner/manager (existing)
-- ---------------------------------------------------------------------------
drop policy if exists expenses_manager_update on public.expenses;
create policy expenses_manager_update on public.expenses for update to authenticated
using (
  case
    when expenses.safe_transaction_id is not null then public.app_role() = 'owner'
    else public.app_is_owner_manager()
  end
)
with check (
  case
    when safe_transaction_id is not null then public.app_role() = 'owner'
    else public.app_is_owner_manager()
  end
);

-- ---------------------------------------------------------------------------
-- DELETE: safe-sourced → owner only; manual → owner/manager (existing)
-- ---------------------------------------------------------------------------
drop policy if exists expenses_manager_delete on public.expenses;
create policy expenses_manager_delete on public.expenses for delete to authenticated
using (
  case
    when expenses.safe_transaction_id is not null then public.app_role() = 'owner'
    else public.app_is_owner_manager()
  end
);

-- INSERT policy unchanged (kept as-is from database/003_rls.sql)
