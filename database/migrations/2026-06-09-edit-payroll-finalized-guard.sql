-- 2026-06-09-edit-payroll-finalized-guard.sql
-- Chặn edit_shift_payroll_record sửa lương của một ngày đã chốt két
-- (cash_close_reports.report_status = 'final').
--
-- Lý do: finalize_cash_close_report lưu payroll_cash_total dưới dạng snapshot.
-- Nếu sửa total_pay của lượt lương sau khi đã chốt, RPC này còn xóa + ghi lại
-- cash_drawer_events 'payroll_cash_out' → ledger lệch so với snapshot bất biến
-- của báo cáo. Flow sửa đúng (đồng bộ với guard sẵn có ở update_cash_count):
--   void_cash_close_report → edit_shift_payroll_record → finalize_cash_close_report
-- Lần finalize lại recompute payroll_cash_total live qua compute_cash_theory
-- nên snapshot bám đúng ledger, không lệch.
--
-- Idempotent: create or replace, giữ nguyên signature (jsonb). create-or-replace
-- không reset quyền nên grant execute hiện có (bulk grant ở 003_rls.sql) vẫn còn.

create or replace function public.edit_shift_payroll_record(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_payroll_id uuid := (p_payload->>'payroll_record_id')::uuid;
  v_record public.shift_payroll_records%rowtype;
  v_in timestamptz;
  v_out timestamptz;
  v_minutes integer;
  v_base numeric(14,2);
  v_allowance numeric(14,2);
  v_total numeric(14,2);
  v_note text;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được sửa lượt lương đã chốt.';
  end if;

  select * into v_record
  from public.shift_payroll_records
  where id = v_payroll_id;

  if not found then
    raise exception 'Không tìm thấy dòng lương cần sửa.';
  end if;

  -- Chống sửa lương của ngày đã chốt két (final): cash_close_reports giữ
  -- payroll_cash_total dưới dạng snapshot khi finalize; sửa total_pay sau khi
  -- chốt sẽ làm lệch báo cáo so với ledger (cash_drawer_events). Flow sửa đúng
  -- = hủy báo cáo (void_cash_close_report) → sửa lương → finalize lại. Đồng bộ
  -- với guard sẵn có ở update_cash_count.
  if exists (
    select 1 from public.cash_close_reports
    where business_date = v_record.business_date and report_status = 'final'
  ) then
    raise exception 'Ngày % đã chốt két (final). Hủy báo cáo (qua flow void) trước khi sửa lương.', v_record.business_date;
  end if;

  v_in := coalesce((p_payload->>'check_in_at')::timestamptz, v_record.check_in_at);
  v_out := coalesce((p_payload->>'check_out_at')::timestamptz, v_record.check_out_at);
  v_allowance := coalesce((p_payload->>'allowance_amount')::numeric, v_record.allowance_amount, 0);
  v_note := case when p_payload ? 'note' then p_payload->>'note' else v_record.note end;

  if v_in is null or v_out is null then
    raise exception 'Thiếu giờ vào hoặc giờ ra.';
  end if;

  if v_out < v_in then
    raise exception 'Giờ ra không được nhỏ hơn giờ vào.';
  end if;

  v_minutes := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  v_base := round(((v_minutes::numeric / 60) * coalesce(v_record.hourly_rate, 0)) / 1000) * 1000;
  v_total := v_base + v_allowance;

  if v_record.shift_assignment_id is not null then
    update public.shift_assignments
    set check_in_at = v_in,
        check_out_at = v_out,
        total_minutes = v_minutes,
        status = 'checked_out',
        updated_by = auth.uid()
    where id = v_record.shift_assignment_id;
  end if;

  update public.shift_payroll_records
  set check_in_at = v_in,
      check_out_at = v_out,
      total_minutes = v_minutes,
      base_pay = v_base,
      allowance_amount = v_allowance,
      total_pay = v_total,
      note = v_note,
      edited_by = auth.uid(),
      edited_at = now()
  where id = v_payroll_id
  returning * into v_record;

  delete from public.cash_drawer_events
  where shift_payroll_record_id = v_payroll_id
    and event_type = 'payroll_cash_out';

  if v_total > 0 then
    insert into public.cash_drawer_events (
      business_date,
      occurred_at,
      event_type,
      direction,
      amount,
      shift_payroll_record_id,
      created_by,
      source,
      note
    )
    values (
      v_record.business_date,
      v_out,
      'payroll_cash_out',
      'out',
      v_total,
      v_payroll_id,
      auth.uid(),
      'app_action',
      'Sửa lượt lương đã chốt'
    );
  end if;

  return jsonb_build_object(
    'payroll_record_id', v_payroll_id,
    'shift_assignment_id', v_record.shift_assignment_id,
    'total_minutes', v_minutes,
    'base_pay', v_base,
    'allowance_amount', v_allowance,
    'total_pay', v_total
  );
end;
$$;
